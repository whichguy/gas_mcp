/**
 * Code Execution Validation Tests
 *
 * Tests exec functionality with real GAS projects:
 * - Simple expression execution
 * - Logger.log output capture
 * - Function execution and return values
 * - Error handling and graceful failures
 * - Google Apps Script service calls
 * - Concurrent execution
 */

import { expect } from 'chai';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';
import { resetSharedProject } from '../../setup/integrationSetup.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';

describe('Code Execution Validation Tests', () => {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let gas: InProcessGASTestHelper;
  let testProjectId: string | null = null;

  before(async function() {
    this.timeout(30000);
    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️  Skipping integration tests - not authenticated');
      this.skip();
      return;
    }
    client = globalAuthState.client;
    auth = globalAuthState.auth!;
    gas = globalAuthState.gas!;

    testProjectId = globalAuthState.sharedProjectId!;
    if (!testProjectId) { this.skip(); return; }
    console.log(`✅ Using shared test project: ${testProjectId}`);
    await resetSharedProject();
  });

  describe('Basic Expression Execution', () => {
    it('should execute simple expression with exec', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(testProjectId!, 'Math.PI * 2');

      expect(result).to.have.property('status', 'success');
      expect(result).to.have.property('result');
      expect(result.result).to.be.closeTo(6.283185307179586, 0.0001);
    });

    it('should execute function that returns value', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        'new Date().getFullYear()'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.be.a('number');
      expect(result.result).to.be.at.least(2025);
    });

    it('should handle complex JavaScript expressions', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        '[1,2,3,4,5].reduce((sum, n) => sum + n, 0)'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal(15);
    });

    it('should execute JSON operations', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        'JSON.stringify({message: "Hello", timestamp: new Date().getTime()})'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.be.a('string');
      expect(result.result).to.include('message');
      expect(result.result).to.include('Hello');
    });
  });

  describe('Logger Output Capture', () => {
    it('should verify Logger.log output capture', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        'Logger.log("Test message"); return 42;'
      );

      expect(result).to.have.property('status', 'success');
      expect(result).to.have.property('logger_output');
      expect(result.logger_output).to.include('Test message');
      expect(result.result).to.equal(42);
    });

    it('should capture multiple Logger.log calls', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        `
        Logger.log("First log");
        Logger.log("Second log");
        Logger.log("Third log");
        return "done";
        `
      );

      expect(result).to.have.property('status', 'success');
      expect(result.logger_output).to.include('First log');
      expect(result.logger_output).to.include('Second log');
      expect(result.logger_output).to.include('Third log');
      expect(result.result).to.equal('done');
    });

    it('should capture Logger.log with formatted output', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        'const value = 42; Logger.log("The answer is: " + value); return value;'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.logger_output).to.include('The answer is: 42');
      expect(result.result).to.equal(42);
    });
  });

  describe('Google Apps Script Service Calls', () => {
    it('should execute GAS service calls', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        'Session.getActiveUser().getEmail()'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.be.a('string');
      expect(result.result).to.include('@');
    });

    it('should execute Utilities service calls', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        'Utilities.getUuid()'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.be.a('string');
      expect(result.result.length).to.be.greaterThan(0);
    });

    it('should execute date formatting with Utilities', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        'Utilities.formatDate(new Date(), "GMT", "yyyy-MM-dd")'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.match(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should execute Session timezone retrieval', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        'Session.getScriptTimeZone()'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.be.a('string');
      expect(result.result.length).to.be.greaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle execution errors gracefully', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      try {
        await gas.runFunction(testProjectId!, 'throw new Error("Test error");');
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Test error');
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

    it('should handle division by zero gracefully', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(testProjectId!, '10 / 0');

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal(Infinity);
    });
  });

  describe('Complex Code Execution', () => {
    it('should execute multi-line code blocks', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const code = `
        const numbers = [1, 2, 3, 4, 5];
        const sum = numbers.reduce((a, b) => a + b, 0);
        const avg = sum / numbers.length;
        Logger.log("Sum: " + sum);
        Logger.log("Average: " + avg);
        return { sum: sum, average: avg };
      `;

      const result = await gas.runFunction(testProjectId!, code);

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.deep.equal({ sum: 15, average: 3 });
      expect(result.logger_output).to.include('Sum: 15');
      expect(result.logger_output).to.include('Average: 3');
    });

    it('should execute code with try-catch blocks', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const code = `
        try {
          const result = Math.sqrt(16);
          Logger.log("Square root: " + result);
          return result;
        } catch (error) {
          Logger.log("Error: " + error);
          return null;
        }
      `;

      const result = await gas.runFunction(testProjectId!, code);

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal(4);
      expect(result.logger_output).to.include('Square root: 4');
    });

    it('should execute code with arrow functions', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const code = `
        const square = (x) => x * x;
        const cube = (x) => x * x * x;
        return [square(5), cube(3)];
      `;

      const result = await gas.runFunction(testProjectId!, code);

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.deep.equal([25, 27]);
    });
  });

  describe('Module Integration', () => {
    before(async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      if (testProjectId) {
        // Create a test module
        await gas.writeTestFile(
          testProjectId,
          'ExecutionHelper',
          `
          function double(x) { return x * 2; }
          function triple(x) { return x * 3; }
          module.exports = { double, triple };
          `
        );
      }
    });

    it('should execute module functions via require()', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        'const helper = require("ExecutionHelper"); return helper.double(21);'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal(42);
    });

    it('should execute multiple module functions in one call', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const code = `
        const helper = require("ExecutionHelper");
        const doubled = helper.double(10);
        const tripled = helper.triple(10);
        Logger.log("Doubled: " + doubled);
        Logger.log("Tripled: " + tripled);
        return { doubled: doubled, tripled: tripled };
      `;

      const result = await gas.runFunction(testProjectId!, code);

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.deep.equal({ doubled: 20, tripled: 30 });
      expect(result.logger_output).to.include('Doubled: 20');
      expect(result.logger_output).to.include('Tripled: 30');
    });
  });

  describe('Rate Limiting and Concurrency', () => {
    it('should verify rate limiting behavior', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      // Make multiple rapid requests
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          gas.runFunction(testProjectId!, `return ${i};`)
        );
      }

      const results = await Promise.all(promises);

      // All should succeed (rate limiter should handle this)
      results.forEach((result, idx) => {
        expect(result).to.have.property('status', 'success');
        expect(result.result).to.equal(idx);
      });
    });
  });
});
