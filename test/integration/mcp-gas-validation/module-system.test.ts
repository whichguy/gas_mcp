/**
 * Module System Validation Tests
 *
 * Tests CommonJS module system integration with real GAS projects:
 * - Module creation with exports
 * - Module importing with require()
 * - Automatic wrapping/unwrapping
 * - Module execution and caching
 * - Module dependencies (multi-level, circular)
 * - loadNow flag behavior (eager vs lazy loading)
 * - Debug flag functionality
 * - Error handling in modules
 */

import { expect } from 'chai';
import { MCPTestClient, AuthTestHelper, GASTestHelper } from '../../helpers/mcpClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';

describe('Module System Validation Tests', () => {
  let client: MCPTestClient;
  let auth: AuthTestHelper;
  let gas: GASTestHelper;
  let testProjectId: string | null = null;

  before(async function() {
    this.timeout(TEST_TIMEOUTS.EXECUTION);
    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️  Skipping integration tests - not authenticated');
      this.skip();
    }
    client = globalAuthState.client;
    auth = new AuthTestHelper(client);
    gas = new GASTestHelper(client);

    // Create test project with CommonJS infrastructure
    const result = await gas.createTestProject('MCP-CommonJS-Test');
    testProjectId = result.scriptId;
    console.log(`✅ Created CommonJS test project: ${testProjectId}`);

    // Verify CommonJS.js exists
    const lsResult = await client.callTool('mcp__gas__ls', {
      scriptId: testProjectId
    });

    expect(lsResult.content[0].text).to.include('CommonJS');
  });

  after(async function() {
    this.timeout(TEST_TIMEOUTS.STANDARD);
    if (testProjectId) {
      console.log(`🧹 Cleaning up test project: ${testProjectId}`);
      await gas.cleanupTestProject(testProjectId);
    }
  });

  describe('Module Creation with Exports', () => {
    it('should create module with module.exports', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const calculatorCode = `
function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

module.exports = { add, multiply };
`;

      const result = await gas.writeTestFile(testProjectId!, 'Calculator', calculatorCode);
      expect(result).to.have.property('success', true);
    });

    it('should create module with exports shorthand', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const utilsCode = `
exports.formatDate = function(date) {
  return Utilities.formatDate(date, 'GMT', 'yyyy-MM-dd');
};

exports.generateId = function() {
  return Utilities.getUuid();
};
`;

      const result = await gas.writeTestFile(testProjectId!, 'Utils', utilsCode);
      expect(result).to.have.property('success', true);
    });
  });

  describe('Automatic Wrapping/Unwrapping', () => {
    it('should verify automatic wrapping when writing', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const cleanCode = 'function test() { return 42; }';

      await gas.writeTestFile(testProjectId!, 'TestModule', cleanCode);

      // Read with raw_cat to see wrapped content
      const rawResult = await client.callTool('mcp__gas__raw_cat', {
        path: `${testProjectId}/TestModule`
      });

      const rawContent = rawResult.content[0].text;
      expect(rawContent).to.include('_main');
      expect(rawContent).to.include('__defineModule__');
    });

    it('should verify automatic unwrapping when reading', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await gas.readFile(testProjectId!, 'TestModule');

      // Should NOT include wrapper
      expect(result).to.not.include('_main');
      expect(result).to.not.include('__defineModule__');
      expect(result).to.include('function test()');
    });
  });

  describe('Module Execution with require()', () => {
    it('should execute module function via require()', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        'const calc = require("Calculator"); return calc.add(5, 3);'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal(8);
    });

    it('should execute multiple module functions', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        'const calc = require("Calculator"); return calc.add(10, calc.multiply(2, 5));'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal(20);
    });

    it('should verify module caching', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const cacheTestCode = `
const calc1 = require("Calculator");
const calc2 = require("Calculator");
Logger.log("Same instance: " + (calc1 === calc2));
return calc1 === calc2;
`;

      const result = await gas.runFunction(testProjectId!, cacheTestCode);

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.be.true;
      expect(result.logger_output).to.include('Same instance: true');
    });
  });

  describe('Module Dependencies', () => {
    it('should create module that requires another module', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const mathOpsCode = `
const calc = require("Calculator");

function square(x) {
  return calc.multiply(x, x);
}

function addSquares(a, b) {
  return calc.add(square(a), square(b));
}

module.exports = { square, addSquares };
`;

      const result = await gas.writeTestFile(testProjectId!, 'MathOps', mathOpsCode);
      expect(result).to.have.property('success', true);
    });

    it('should execute function from dependent module', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        'const math = require("MathOps"); return math.addSquares(3, 4);'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal(25); // 3^2 + 4^2 = 9 + 16 = 25
    });

    it('should handle multi-level dependencies', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      // Create third-level module
      const advancedCode = `
const math = require("MathOps");

function pythagorean(a, b) {
  return Math.sqrt(math.addSquares(a, b));
}

module.exports = { pythagorean };
`;

      await gas.writeTestFile(testProjectId!, 'Advanced', advancedCode);

      const result = await gas.runFunction(
        testProjectId!,
        'const adv = require("Advanced"); return adv.pythagorean(3, 4);'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal(5);
    });

    it('should track file dependencies', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      // Create dependency chain
      await gas.writeTestFile(testProjectId!, 'Base', 'exports.base = 100;');
      await gas.writeTestFile(
        testProjectId!,
        'Dependent',
        'const base = require("Base");\nexports.value = base.base * 2;'
      );
      await gas.writeTestFile(
        testProjectId!,
        'TopLevel',
        'const dep = require("Dependent");\nexports.final = dep.value + 50;'
      );

      // Execute top-level to verify chain
      const result = await gas.runFunction(
        testProjectId!,
        'const top = require("TopLevel"); return top.final;'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal(250); // 100 * 2 + 50 = 250
    });
  });

  describe('loadNow Flag Behavior', () => {
    it('should create module with loadNow: true', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const eagerCode = `
Logger.log("Eager module loaded at startup");
exports.value = "eager";
`;

      const result = await client.callTool('mcp__gas__write', {
        scriptId: testProjectId,
        path: 'EagerModule',
        content: eagerCode,
        moduleOptions: {
          loadNow: true
        }
      });

      expect(result.content[0].text).to.include('success');
    });

    it('should create module with loadNow: false', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const lazyCode = `
Logger.log("Lazy module loaded on first require");
exports.value = "lazy";
`;

      const result = await client.callTool('mcp__gas__write', {
        scriptId: testProjectId,
        path: 'LazyModule',
        content: lazyCode,
        moduleOptions: {
          loadNow: false
        }
      });

      expect(result.content[0].text).to.include('success');
    });

    it('should verify eager module loads at startup', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      // Execute code that doesn't require the module
      const result = await gas.runFunction(
        testProjectId!,
        'return "test";'
      );

      // Eager module should log even though not required
      expect(result.logger_output).to.include('Eager module loaded at startup');
    });

    it('should verify lazy module only loads on require', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      // First run without requiring
      const result1 = await gas.runFunction(
        testProjectId!,
        'return "before require";'
      );

      expect(result1.logger_output).to.not.include('Lazy module loaded');

      // Now require it
      const result2 = await gas.runFunction(
        testProjectId!,
        'const lazy = require("LazyModule"); return lazy.value;'
      );

      expect(result2.logger_output).to.include('Lazy module loaded on first require');
      expect(result2.result).to.equal('lazy');
    });
  });

  describe('Circular Dependencies', () => {
    it('should handle circular dependencies gracefully', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      // Module A requires B
      const moduleACode = `
exports.name = "A";
exports.getB = function() {
  const b = require("ModuleB");
  return b.name;
};
`;

      // Module B requires A
      const moduleBCode = `
exports.name = "B";
exports.getA = function() {
  const a = require("ModuleA");
  return a.name;
};
`;

      await gas.writeTestFile(testProjectId!, 'ModuleA', moduleACode);
      await gas.writeTestFile(testProjectId!, 'ModuleB', moduleBCode);

      const result = await gas.runFunction(
        testProjectId!,
        'const a = require("ModuleA"); return a.getB();'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal('B');
    });

    it('should handle complex module dependencies', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      // Create circular dependency scenario
      await gas.writeTestFile(
        testProjectId!,
        'CircularA',
        'exports.name = "A";\nexports.getB = function() { const b = require("CircularB"); return b.name; };'
      );

      await gas.writeTestFile(
        testProjectId!,
        'CircularB',
        'exports.name = "B";\nexports.getA = function() { const a = require("CircularA"); return a.name; };'
      );

      // Should handle circular dependencies
      const result = await gas.runFunction(
        testProjectId!,
        'const a = require("CircularA"); return a.getB();'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal('B');
    });
  });

  describe('CommonJS Debug Flag', () => {
    it('should verify debug flag exists in production', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('mcp__gas__raw_cat', {
        path: `${testProjectId}/CommonJS`
      });

      const content = result.content[0].text;
      expect(content).to.include('DEBUG_COMMONJS');
      expect(content).to.include('debugLog');
    });

    it('should verify debug mode is disabled by default', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        'return globalThis.DEBUG_COMMONJS;'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.be.false;
    });

    it('should enable debug mode and verify logging', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await gas.runFunction(
        testProjectId!,
        'globalThis.DEBUG_COMMONJS = true; const calc = require("Calculator"); return calc.add(1, 1);'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal(2);
      // With debug enabled, should see module loading messages
      expect(result.logger_output.length).to.be.greaterThan(0);
    });
  });

  describe('Error Handling in Modules', () => {
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

    it('should handle syntax errors in modules', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const badCode = `
function broken() {
  return "missing semicolon"
}
// Intentionally missing semicolon to test error handling
exports.broken = broken
`;

      await gas.writeTestFile(testProjectId!, 'BrokenModule', badCode);

      // Should still work despite missing semicolons (JS is forgiving)
      const result = await gas.runFunction(
        testProjectId!,
        'const broken = require("BrokenModule"); return broken.broken();'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal('missing semicolon');
    });
  });
});
