import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { MCPGasTestHelper, GasTestContext } from '../../helpers/mcpGasTestHelpers.js';
import { ArgumentTestHelper } from './helpers/argument-test-helper.js';

describe('MCP Tool: Execution - Argument Validation', function() {
  let context: GasTestContext;
  let testProjectId: string | null = null;

  before(async function() {
    context = await MCPGasTestHelper.createTestContext({
      testName: 'execution-args',
      requireAuth: true
    });

    if (!context.authenticated) {
      this.skip();
    }
  });

  beforeEach(async function() {
    // Create fresh test project with code
    const result = await context.client.callAndParse('project_create', {
      title: `TEST_Exec_${context.testId}_${Date.now()}`,
      localName: `test-exec-${context.testId}-${Date.now()}`
    });
    testProjectId = result.scriptId;
    context.projectIds.push(testProjectId!);

    // Upload test functions
    await context.client.callAndParse('write', {
      scriptId: testProjectId!,
      path: 'math',
      content: `
        function add(a, b) { return a + b; }
        function multiply(a, b) { return a * b; }
        module.exports = { add, multiply };
      `
    });

    // Wait for compilation
    await ArgumentTestHelper.sleep(2000);
  });

  afterEach(async function() {
    // Cleanup handled by context
  });

  after(async function() {
    await context.cleanup();
  });

  describe('exec: Valid Arguments', function() {
    it('should accept simple expression', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '1 + 1'
        },
        'simple expression'
      );

      expect(result).to.have.property('result', 2);
      expect(result).to.have.property('status', 'success');
    });

    it('should accept function call', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: 'Math.PI * 2'
        },
        'Math function call'
      );

      expect(result.result).to.be.closeTo(Math.PI * 2, 0.0001);
    });

    it('should accept module require', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: 'require("math").add(3, 5)'
        },
        'module require and call'
      );

      expect(result.result).to.equal(8);
    });

    it('should accept with executionTimeout parameter', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '1 + 1',
          executionTimeout: 900
        },
        'with executionTimeout'
      );

      expect(result.result).to.equal(2);
    });

    it('should accept with responseTimeout parameter', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '2 + 2',
          responseTimeout: 900
        },
        'with responseTimeout'
      );

      expect(result.result).to.equal(4);
    });

    it('should accept with autoRedeploy: false', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '3 + 3',
          autoRedeploy: false
        },
        'with autoRedeploy=false'
      );

      expect(result.result).to.equal(6);
    });

    it('should accept with logFilter parameter', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: 'Logger.log("test"); 1',
          logFilter: 'test'
        },
        'with logFilter'
      );

      expect(result).to.have.property('logger_output');
    });

    it('should accept with logTail parameter', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '1',
          logTail: 10
        },
        'with logTail'
      );

      expect(result).to.have.property('logger_output');
    });

    it('should accept multi-line JavaScript', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: `
            const a = 5;
            const b = 10;
            a + b;
          `
        },
        'multi-line JavaScript'
      );

      expect(result.result).to.equal(15);
    });
  });

  describe('exec: Invalid Arguments', function() {
    it('should reject missing scriptId', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'run',
        {
          js_statement: '1 + 1'
        },
        /scriptId|required/i,
        'scriptId is required'
      );
    });

    it('should reject missing js_statement', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'run',
        {
          scriptId: testProjectId!
        },
        /js_statement|required/i,
        'js_statement is required'
      );
    });

    it('should reject invalid scriptId format', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'run',
        {
          scriptId: 'bad_format',
          js_statement: '1 + 1'
        },
        /scriptId|invalid|format/i,
        'invalid scriptId format'
      );
    });

    it('should reject empty js_statement', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: ''
        },
        /js_statement|empty|required/i,
        'empty js_statement'
      );
    });

    it('should reject executionTimeout below minimum', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '1',
          executionTimeout: 100 // Minimum is 780
        },
        /executionTimeout|minimum|780/i,
        'executionTimeout below minimum'
      );
    });

    it('should reject executionTimeout above maximum', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '1',
          executionTimeout: 5000 // Maximum is 3600
        },
        /executionTimeout|maximum|3600/i,
        'executionTimeout above maximum'
      );
    });

    it('should reject invalid executionTimeout type', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '1',
          executionTimeout: 'fast' // Should be number
        },
        /executionTimeout|number|type/i,
        'executionTimeout must be number'
      );
    });

    it('should reject responseTimeout below minimum', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '1',
          responseTimeout: 100 // Minimum is 780
        },
        /responseTimeout|minimum|780/i,
        'responseTimeout below minimum'
      );
    });

    it('should reject responseTimeout above maximum', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '1',
          responseTimeout: 5000 // Maximum is 3600
        },
        /responseTimeout|maximum|3600/i,
        'responseTimeout above maximum'
      );
    });

    it('should reject invalid autoRedeploy type', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '1',
          autoRedeploy: 'yes' // Should be boolean
        },
        /autoRedeploy|boolean|type/i,
        'autoRedeploy must be boolean'
      );
    });

    it('should reject invalid logTail value', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '1',
          logTail: 0 // Minimum is 1
        },
        /logTail|minimum|1/i,
        'logTail must be at least 1'
      );
    });

    it('should reject logTail above maximum', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '1',
          logTail: 50000 // Maximum is 10000
        },
        /logTail|maximum|10000/i,
        'logTail above maximum'
      );
    });
  });

  describe('exec: Edge Cases', function() {
    it('should handle very long js_statement', async function() {
      const longStatement = 'const arr = [' + Array(1000).fill('1').join(',') + ']; arr.length';

      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: longStatement
        },
        'very long js_statement'
      );

      expect(result.result).to.equal(1000);
    });

    it('should handle JavaScript with special characters', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '"Hello\\nWorld\\t!"'
        },
        'special characters in string'
      );

      expect(result.result).to.equal('Hello\nWorld\t!');
    });

    it('should handle JSON.stringify in statement', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: 'JSON.stringify({test: true, value: 123})'
        },
        'JSON.stringify'
      );

      expect(result.result).to.equal('{"test":true,"value":123}');
    });

    it('should handle boundary executionTimeout values', async function() {
      // Minimum value
      const result1 = await ArgumentTestHelper.expectSuccess(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '1',
          executionTimeout: 780
        },
        'executionTimeout at minimum (780)'
      );
      expect(result1.result).to.equal(1);

      // Maximum value
      const result2 = await ArgumentTestHelper.expectSuccess(
        context.client,
        'run',
        {
          scriptId: testProjectId!,
          js_statement: '2',
          executionTimeout: 3600
        },
        'executionTimeout at maximum (3600)'
      );
      expect(result2.result).to.equal(2);
    });
  });

  describe('exec: Valid Arguments', function() {
    it('should accept minimal arguments (same as run)', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'exec',
        {
          scriptId: testProjectId!,
          js_statement: 'Math.sqrt(16)'
        },
        'minimal exec arguments'
      );

      expect(result.result).to.equal(4);
    });

    it('should accept all run parameters', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'exec',
        {
          scriptId: testProjectId!,
          js_statement: '5 * 5',
          executionTimeout: 900,
          responseTimeout: 900,
          autoRedeploy: true
        },
        'exec with all parameters'
      );

      expect(result.result).to.equal(25);
    });
  });

  describe('exec: Invalid Arguments', function() {
    it('should reject same invalid arguments as run', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'exec',
        {
          js_statement: '1'
        },
        /scriptId|required/i,
        'exec without scriptId'
      );

      await ArgumentTestHelper.expectError(
        context.client,
        'exec',
        {
          scriptId: testProjectId!
        },
        /js_statement|required/i,
        'exec without js_statement'
      );
    });
  });
});
