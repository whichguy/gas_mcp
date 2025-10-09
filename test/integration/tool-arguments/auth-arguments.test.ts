import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { MCPGasTestHelper, GasTestContext } from '../../helpers/mcpGasTestHelpers.js';
import { ArgumentTestHelper } from './helpers/argument-test-helper.js';

describe('MCP Tool: auth - Argument Validation', function() {
  let context: GasTestContext;

  before(async function() {
    context = await MCPGasTestHelper.createTestContext({
      testName: 'auth-args'
    });
  });

  after(async function() {
    await context.cleanup();
  });

  describe('Valid Arguments', function() {
    it('should accept mode: "status"', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'auth',
        { mode: 'status' },
        'mode: status should succeed'
      );

      expect(result).to.have.property('authenticated');
      expect(result).to.have.property('tokenValid');
    });

    it('should accept mode: "start"', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'auth',
        { mode: 'start' },
        'mode: start should succeed'
      );

      expect(result).to.have.property('authUrl');
      expect(result.authUrl).to.include('accounts.google.com');
    });

    it('should accept mode: "logout"', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'auth',
        { mode: 'logout' },
        'mode: logout should succeed'
      );

      expect(result).to.have.property('status');
    });

    it('should accept mode: "start" with openBrowser: false', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'auth',
        { mode: 'start', openBrowser: false },
        'mode: start with openBrowser flag'
      );

      expect(result).to.have.property('authUrl');
    });

    it('should accept mode: "start" with waitForCompletion: false', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'auth',
        { mode: 'start', waitForCompletion: false },
        'mode: start with waitForCompletion flag'
      );

      expect(result).to.have.property('authUrl');
    });

    it('should accept mode: "callback" with code parameter', async function() {
      // This will fail authentication but should accept the parameters
      try {
        await context.client.callAndParse('auth', {
          mode: 'callback',
          code: 'test_authorization_code_12345'
        });
      } catch (error: any) {
        // Should fail with auth error, not validation error
        expect(error.message).to.match(/auth|token|invalid|failed/i);
        expect(error.message).to.not.match(/required|validation|parameter/i);
      }
    });
  });

  describe('Invalid Arguments', function() {
    it('should reject missing mode parameter', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'auth',
        {},
        /mode|required/i,
        'mode is required'
      );
    });

    it('should reject invalid mode values', async function() {
      const invalidModes = [
        'invalid',
        'STATUS', // case sensitive
        'login',
        'signin',
        123,
        null
      ];

      for (const mode of invalidModes) {
        await ArgumentTestHelper.expectError(
          context.client,
          'auth',
          { mode },
          /mode|invalid|enum/i,
          `Invalid mode: ${mode}`
        );
      }
    });

    it('should reject callback mode without code', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'auth',
        { mode: 'callback' },
        /code|required/i,
        'callback mode requires code parameter'
      );
    });

    it('should reject invalid openBrowser type', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'auth',
        { mode: 'start', openBrowser: 'yes' }, // Should be boolean
        /openBrowser|boolean|type/i,
        'openBrowser must be boolean'
      );
    });

    it('should reject invalid waitForCompletion type', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'auth',
        { mode: 'start', waitForCompletion: 1 }, // Should be boolean
        /waitForCompletion|boolean|type/i,
        'waitForCompletion must be boolean'
      );
    });

    it('should reject additional unknown parameters', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'auth',
        { mode: 'status', unknownParam: 'value' },
        /additional|unknown|invalid/i,
        'should reject additional properties'
      );
    });

    it('should reject accessToken with invalid format', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'auth',
        { mode: 'status', accessToken: 'invalid_token_format' },
        /accessToken|pattern|invalid/i,
        'accessToken must match ya29. pattern'
      );
    });
  });

  describe('Edge Cases', function() {
    it('should handle mode with extra whitespace', async function() {
      // Depending on validation, might trim or reject
      try {
        await context.client.callAndParse('auth', { mode: ' status ' });
        // If it succeeds, validation trimmed the value
      } catch (error: any) {
        // If it fails, validation is strict about format
        expect(error.message).to.match(/mode|invalid/i);
      }
    });

    it('should handle empty string mode', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'auth',
        { mode: '' },
        /mode|invalid|empty/i,
        'empty mode should be rejected'
      );
    });

    it('should handle valid accessToken format', async function() {
      // Valid accessToken pattern starts with ya29.
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'auth',
        {
          mode: 'status',
          accessToken: 'ya29.a0AfB_byC1234567890abcdefghijklmnopqrstuvwxyz'
        },
        'valid accessToken format should be accepted'
      );

      // Will likely indicate not authenticated (invalid token) but should accept the parameter
      expect(result).to.have.property('authenticated');
    });
  });

  describe('Authentication State Transitions', function() {
    it('should maintain consistent state across mode changes', async function() {
      // Status check
      const status1 = await context.client.callAndParse('auth', { mode: 'status' });
      const wasAuth = status1.authenticated;

      // Start auth (creates new auth URL)
      const authStart = await context.client.callAndParse('auth', { mode: 'start' });
      expect(authStart).to.have.property('authUrl');

      // Status should still be consistent
      const status2 = await context.client.callAndParse('auth', { mode: 'status' });
      expect(status2.authenticated).to.equal(wasAuth);

      // Logout
      await context.client.callAndParse('auth', { mode: 'logout' });

      // Status should now show not authenticated
      const status3 = await context.client.callAndParse('auth', { mode: 'status' });
      expect(status3.authenticated).to.be.false;
    });
  });
});
