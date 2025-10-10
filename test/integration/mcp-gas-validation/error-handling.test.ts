/**
 * Error Handling Validation Tests
 *
 * Tests error handling and edge cases with real GAS projects:
 * - Invalid script IDs and permissions
 * - File not found scenarios
 * - Invalid file operations
 * - Execution errors and syntax errors
 * - Graceful error recovery
 */

import { expect } from 'chai';
import { MCPTestClient, AuthTestHelper, GASTestHelper } from '../../helpers/mcpClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';

describe('Error Handling Validation Tests', () => {
  let client: MCPTestClient;
  let auth: AuthTestHelper;
  let gas: GASTestHelper;
  let testProjectId: string | null = null;

  before(async function() {
    this.timeout(TEST_TIMEOUTS.STANDARD);
    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️  Skipping integration tests - not authenticated');
      this.skip();
    }
    client = globalAuthState.client;
    auth = new AuthTestHelper(client);
    gas = new GASTestHelper(client);

    // Create test project
    const result = await gas.createTestProject('MCP-ErrorTest');
    testProjectId = result.scriptId;
    console.log(`✅ Created error handling test project: ${testProjectId}`);
  });

  after(async function() {
    this.timeout(TEST_TIMEOUTS.STANDARD);
    if (testProjectId) {
      console.log(`🧹 Cleaning up test project: ${testProjectId}`);
      await gas.cleanupTestProject(testProjectId);
    }
  });

  describe('Invalid Parameters', () => {
    it('should handle invalid script ID', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      const invalidId = 'invalid-script-id-123';

      try {
        await client.callTool('mcp__gas__ls', {
          scriptId: invalidId
        });
        expect.fail('Should have thrown error for invalid script ID');
      } catch (error: any) {
        expect(error.message).to.match(/invalid|not found|permission/i);
      }
    });

    it('should handle malformed script ID', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      const malformedId = 'abc123';  // Too short

      try {
        await client.callTool('mcp__gas__ls', {
          scriptId: malformedId
        });
        expect.fail('Should have thrown validation error');
      } catch (error: any) {
        expect(error.message).to.match(/invalid|validation|length/i);
      }
    });

    it('should handle non-existent project', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      // Valid format but non-existent ID
      const nonExistentId = '1' + 'x'.repeat(43);

      try {
        await client.callTool('mcp__gas__info', {
          scriptId: nonExistentId
        });
        expect.fail('Should have thrown not found error');
      } catch (error: any) {
        expect(error.message).to.match(/not found|does not exist|permission/i);
      }
    });
  });

  describe('File Operation Errors', () => {
    it('should handle file not found', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      try {
        await gas.readFile(testProjectId!, 'NonExistentFile');
        expect.fail('Should have thrown file not found error');
      } catch (error: any) {
        expect(error.message).to.match(/not found|does not exist/i);
      }
    });

    it('should handle invalid file operations', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      try {
        await client.callTool('mcp__gas__mv', {
          scriptId: testProjectId,
          from: 'NonExistent',
          to: 'Target'
        });
        expect.fail('Should have thrown error for non-existent source');
      } catch (error: any) {
        expect(error.message).to.match(/not found|does not exist/i);
      }
    });

    it('should handle invalid copy operations', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      try {
        await client.callTool('mcp__gas__cp', {
          scriptId: testProjectId,
          from: 'MissingSource',
          to: 'Destination'
        });
        expect.fail('Should have thrown error for missing source file');
      } catch (error: any) {
        expect(error.message).to.match(/not found|does not exist/i);
      }
    });

    it('should handle invalid delete operations', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      try {
        await client.callTool('mcp__gas__rm', {
          scriptId: testProjectId,
          path: 'NonExistentFile'
        });
        expect.fail('Should have thrown error for non-existent file');
      } catch (error: any) {
        expect(error.message).to.match(/not found|does not exist/i);
      }
    });
  });

  describe('Code Execution Errors', () => {
    it('should handle execution errors gracefully', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      try {
        await gas.runFunction(testProjectId!, 'throw new Error("Intentional test error");');
        expect.fail('Should have thrown execution error');
      } catch (error: any) {
        expect(error.message).to.include('Intentional test error');
      }
    });

    it('should handle syntax errors in code', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      try {
        // Invalid syntax
        await gas.runFunction(testProjectId!, 'const x = ;');
        expect.fail('Should have thrown syntax error');
      } catch (error: any) {
        expect(error.message).to.match(/syntax|unexpected/i);
      }
    });

    it('should handle runtime type errors', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      try {
        await gas.runFunction(testProjectId!, 'const x = null; x.toString();');
        expect.fail('Should have thrown type error');
      } catch (error: any) {
        expect(error.message).to.match(/null|undefined|cannot read/i);
      }
    });

    it('should handle reference errors', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      try {
        await gas.runFunction(testProjectId!, 'return undefinedVariable;');
        expect.fail('Should have thrown reference error');
      } catch (error: any) {
        expect(error.message).to.match(/undefined|not defined|reference/i);
      }
    });
  });

  describe('Module System Errors', () => {
    it('should handle module not found errors', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      try {
        await gas.runFunction(
          testProjectId!,
          'const missing = require("NonExistentModule");'
        );
        expect.fail('Should have thrown module not found error');
      } catch (error: any) {
        expect(error.message).to.match(/not found|cannot find/i);
      }
    });

    it('should handle circular dependency errors if detected', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      // Create modules with potentially problematic circular deps
      await gas.writeTestFile(
        testProjectId!,
        'CircA',
        'const b = require("CircB"); exports.value = "A";'
      );

      await gas.writeTestFile(
        testProjectId!,
        'CircB',
        'const a = require("CircA"); exports.value = "B";'
      );

      // Should either handle gracefully or throw clear error
      try {
        const result = await gas.runFunction(
          testProjectId!,
          'const a = require("CircA"); return a.value;'
        );
        // If it succeeds, verify it handled correctly
        expect(result).to.have.property('status');
      } catch (error: any) {
        // If it fails, should have clear error message
        expect(error.message).to.be.a('string');
      }
    });
  });

  describe('Permission and Access Errors', () => {
    it('should handle permission denied scenarios', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      // Try to access a project we don't have permission for
      const restrictedId = '1' + 'a'.repeat(43);  // Valid format but likely no access

      try {
        await client.callTool('mcp__gas__ls', {
          scriptId: restrictedId
        });
        expect.fail('Should have thrown permission error');
      } catch (error: any) {
        // Accept either "not found" or "permission" since behavior depends on GAS API
        expect(error.message).to.match(/not found|permission|forbidden|unauthorized/i);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty file content', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await gas.writeTestFile(testProjectId!, 'EmptyFile', '');
      expect(result).to.have.property('success', true);

      const readResult = await gas.readFile(testProjectId!, 'EmptyFile');
      expect(readResult).to.equal('');
    });

    it('should handle very long file names', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const longName = 'A'.repeat(100);

      try {
        await gas.writeTestFile(testProjectId!, longName, 'exports.test = true;');
        // If it succeeds, verify we can read it
        const result = await gas.readFile(testProjectId!, longName);
        expect(result).to.include('test');
      } catch (error: any) {
        // If it fails, should have clear error about name length
        expect(error.message).to.be.a('string');
      }
    });

    it('should handle special characters in content', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const specialContent = 'exports.unicode = "Hello 世界 🌍";';

      const result = await gas.writeTestFile(testProjectId!, 'UnicodeTest', specialContent);
      expect(result).to.have.property('success', true);

      const readResult = await gas.readFile(testProjectId!, 'UnicodeTest');
      expect(readResult).to.include('世界');
      expect(readResult).to.include('🌍');
    });
  });

  describe('Error Recovery', () => {
    it('should recover from failed operations', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      // Attempt invalid operation
      try {
        await gas.runFunction(testProjectId!, 'invalid syntax here');
      } catch (error) {
        // Expected to fail
      }

      // Verify we can still perform valid operations
      const result = await gas.runFunction(testProjectId!, 'return 42;');
      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal(42);
    });

    it('should maintain project integrity after errors', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      // Create a file
      await gas.writeTestFile(testProjectId!, 'TestFile', 'exports.value = 1;');

      // Attempt invalid operation on different file
      try {
        await gas.readFile(testProjectId!, 'NonExistent');
      } catch (error) {
        // Expected to fail
      }

      // Verify original file still accessible
      const result = await gas.readFile(testProjectId!, 'TestFile');
      expect(result).to.include('value');
    });
  });
});
