/**
 * Consolidated Integration Test Suite
 *
 * Single suite that:
 * - Authenticates ONCE (via globalAuth.ts)
 * - Reuses the shared test project across all tests
 * - Cleans up resources at the end
 *
 * This eliminates repeated OAuth prompts and speeds up test execution.
 */

import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { globalAuthState } from '../setup/globalAuth.js';
import { TestProjectFactory, TestProjectTemplate } from '../fixtures/mock-projects/testProjectFactory.js';
import { resetSharedProject } from '../setup/integrationSetup.js';

describe('Consolidated Integration Test Suite', function() {
  // Increase timeout for project creation
  this.timeout(300000); // 5 minutes

  // Shared test resources
  let testProjectId: string;

  let mathTemplate: TestProjectTemplate;
  let dataTemplate: TestProjectTemplate;
  let webAppTemplate: TestProjectTemplate;

  before(async function() {
    console.log('\n🏗️  ===== CONSOLIDATED SUITE SETUP =====');

    // Verify authentication
    if (!globalAuthState.isAuthenticated || !globalAuthState.gas) {
      throw new Error('Global authentication not available. Check globalAuth.ts setup.');
    }

    console.log('✅ Using global authenticated client and GAS helper');

    // Create test project templates
    mathTemplate = TestProjectFactory.createMathOperationsProject();
    dataTemplate = TestProjectFactory.createDataProcessingProject();
    webAppTemplate = TestProjectFactory.createWebAppProject();

    testProjectId = globalAuthState.sharedProjectId!;
    if (!testProjectId) { throw new Error('No shared test project available'); }
    await resetSharedProject();

    // Add files from all templates to single project
    for (const file of mathTemplate.files) {
      await globalAuthState.gas!.writeTestFile(testProjectId, file.name, file.content);
    }
    for (const file of dataTemplate.files) {
      await globalAuthState.gas!.writeTestFile(testProjectId, file.name, file.content);
    }
    for (const file of webAppTemplate.files) {
      await globalAuthState.gas!.writeTestFile(testProjectId, file.name, file.content);
    }
    console.log(`✅ Shared test project populated with all template files: ${testProjectId}`);
  });

  describe('File Operations', () => {
    describe('List Files (ls)', () => {
      it('should list all files in test project', async () => {
        const result = await globalAuthState.client!.callAndParse('ls', {
          scriptId: testProjectId,
          path: ''
        });

        expect(result.items).to.be.an('array');
        expect(result.items.length).to.be.greaterThan(0);

        // Should have appsscript.json and mathOperations.gs
        const text = JSON.stringify(result.items);
        expect(text).to.include('appsscript.json');
        expect(text).to.include('mathOperations');
      });

      it('should list files with checksums', async () => {
        const result = await globalAuthState.client!.callAndParse('ls', {
          scriptId: testProjectId,
          path: '',
          checksums: true
        });

        expect(result.items).to.be.an('array');
        const text = JSON.stringify(result.items);
        expect(text).to.include('gitSha1');
      });

      it('should list files in detailed mode', async () => {
        const result = await globalAuthState.client!.callAndParse('ls', {
          scriptId: testProjectId,
          path: '',
          detailed: true
        });

        expect(result.items).to.be.an('array');
        const text = JSON.stringify(result.items);
        expect(text).to.include('size');
        expect(text).to.include('createTime');
        expect(text).to.include('updateTime');
      });
    });

    describe('Read Files (cat)', () => {
      it('should read math operations file', async () => {
        const result = await globalAuthState.client!.callAndParse('cat', {
          path: `${testProjectId}/mathOperations.gs`
        });

        expect(result.content).to.be.a('string');
        expect(result.content).to.include('function add');
        expect(result.content).to.include('function multiply');
        expect(result.content).to.include('function fibonacci');
      });

      it('should read data processor file', async () => {
        const result = await globalAuthState.client!.callAndParse('cat', {
          path: `${testProjectId}/dataProcessor.gs`
        });

        expect(result.content).to.be.a('string');
        expect(result.content).to.include('function processArray');
        expect(result.content).to.include('function transformObject');
      });

      it('should read appsscript.json manifest', async () => {
        const result = await globalAuthState.client!.callAndParse('cat', {
          path: `${testProjectId}/appsscript.json`
        });

        expect(result.content).to.be.a('string');
        expect(result.content).to.include('timeZone');
        expect(result.content).to.include('runtimeVersion');
      });
    });

    describe('Write Files (write)', () => {
      it('should create a new utility file', async () => {
        const content = `/**
 * Test utility functions
 */

function testHelper() {
  return 'helper';
}

function anotherHelper(x) {
  return x * 2;
}`;

        const result = await globalAuthState.client!.callAndParse('write', {
          path: `${testProjectId}/testUtils.gs`,
          content: content
        });

        expect(result.success).to.be.true;
        expect(result.path).to.include('testUtils.gs');
      });

      it('should update existing file', async () => {
        // Modify content
        const newContent = `/**
 * Test utility functions - UPDATED
 */

function testHelper() {
  return 'updated helper';
}`;

        // Write updated content
        const writeResult = await globalAuthState.client!.callAndParse('write', {
          path: `${testProjectId}/testUtils.gs`,
          content: newContent
        });

        expect(writeResult.success).to.be.true;

        // Verify update
        const verifyResult = await globalAuthState.client!.callAndParse('cat', {
          path: `${testProjectId}/testUtils.gs`
        });

        expect(verifyResult.content).to.include('UPDATED');
      });
    });
  });

  describe('Code Execution', () => {
    describe('Mathematical Operations', () => {
      it('should execute simple addition', async () => {
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: testProjectId,
          js_statement: 'add(15, 27)'
        });

        expect(result.response.result).to.equal(42);
      });

      it('should execute multiplication', async () => {
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: testProjectId,
          js_statement: 'multiply(6, 7)'
        });

        expect(result.response.result).to.equal(42);
      });

      it('should calculate fibonacci number', async () => {
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: testProjectId,
          js_statement: 'fibonacci(10)'
        });

        expect(result.response.result).to.equal(55);
      });

      it('should check prime numbers', async () => {
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: testProjectId,
          js_statement: 'isPrime(17)'
        });

        expect(result.response.result).to.be.true;
      });

      it('should run all math tests', async () => {
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: testProjectId,
          js_statement: 'runAllTests()'
        });

        expect(result.response.result).to.be.an('object');
        expect(result.response.result.add).to.equal(42);
        expect(result.response.result.multiply).to.equal(42);
        expect(result.response.result.fibonacci).to.equal(55);
        expect(result.response.result.success).to.be.true;
      });
    });

    describe('Data Processing', () => {
      it('should process array data', async () => {
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: testProjectId,
          js_statement: 'processArray([-1, 2, -3, 4, 5])'
        });

        expect(result.response.result).to.equal(22); // (2+4+5)*2 = 22
      });

      it('should transform object keys and values', async () => {
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: testProjectId,
          js_statement: 'transformObject({name: "test", value: "hello"})'
        });

        expect(result.response.result).to.have.property('NAME', 'TEST');
        expect(result.response.result).to.have.property('VALUE', 'HELLO');
      });

      it('should parse and validate JSON', async () => {
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: testProjectId,
          js_statement: 'parseAndValidateJSON(\'{"test": true}\')'
        });

        expect(result.response.result.valid).to.be.true;
        expect(result.response.result.type).to.equal('object');
      });
    });

    describe('Module System', () => {
      it('should load and execute module functions', async () => {
        // Create a simple module
        const moduleContent = `/**
 * Calculator Module
 */

module.exports = {
  calculate: function(operation, a, b) {
    switch(operation) {
      case 'add': return a + b;
      case 'subtract': return a - b;
      case 'multiply': return a * b;
      case 'divide': return b !== 0 ? a / b : null;
      default: return null;
    }
  }
};`;

        await globalAuthState.client!.callAndParse('write', {
          path: `${testProjectId}/Calculator.gs`,
          content: moduleContent
        });

        // Use the module
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: testProjectId,
          js_statement: 'require("Calculator").calculate("multiply", 6, 7)'
        });

        expect(result.response.result).to.equal(42);
      });
    });
  });

  describe('Search Operations', () => {
    describe('Grep - Content Search', () => {
      it('should find function definitions', async () => {
        const result = await globalAuthState.client!.callAndParse('grep', {
          scriptId: testProjectId,
          pattern: 'function.*\\(',
          regex: true
        });

        expect(result.content).to.be.an('array');
        const text = JSON.stringify(result.content);
        expect(text).to.include('function add');
        expect(text).to.include('function multiply');
      });

      it('should find specific strings', async () => {
        const result = await globalAuthState.client!.callAndParse('grep', {
          scriptId: testProjectId,
          pattern: 'processArray',
          regex: false
        });

        expect(result.content).to.be.an('array');
        const text = JSON.stringify(result.content);
        expect(text).to.include('processArray');
      });
    });

    describe('Find - File Search', () => {
      it('should find .gs files', async () => {
        const result = await globalAuthState.client!.callAndParse('find', {
          scriptId: testProjectId,
          pattern: '*.gs'
        });

        expect(result.content).to.be.an('array');
        const text = JSON.stringify(result.content);
        expect(text).to.include('.gs');
      });

      it('should find JSON files', async () => {
        const result = await globalAuthState.client!.callAndParse('find', {
          scriptId: testProjectId,
          pattern: '*.json'
        });

        expect(result.content).to.be.an('array');
        const text = JSON.stringify(result.content);
        expect(text).to.include('appsscript.json');
      });
    });
  });

  describe('Project Management', () => {
    it('should get project info', async () => {
      const result = await globalAuthState.client!.callAndParse('project_info', {
        scriptId: testProjectId
      });

      expect(result.content).to.be.an('array');
      const text = JSON.stringify(result.content);
      expect(text).to.include(testProjectId);
      expect(text).to.include('title');
    });

    it('should list all accessible projects', async () => {
      const result = await globalAuthState.client!.callAndParse('project_list', {});

      expect(result.content).to.be.an('array');
      const text = JSON.stringify(result.content);

      // Should include our test project
      expect(text).to.include(testProjectId);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid scriptId', async () => {
      try {
        await globalAuthState.client!.callAndParse('cat', {
          path: 'invalid-script-id/Code.gs'
        });
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).to.match(/validation|invalid|not found/i);
      }
    });

    it('should handle file not found', async () => {
      try {
        await globalAuthState.client!.callAndParse('cat', {
          path: `${testProjectId}/NonExistentFile.gs`
        });
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).to.match(/not found|does not exist/i);
      }
    });

    it('should handle execution errors', async () => {
      try {
        await globalAuthState.client!.callAndParse('exec', {
          scriptId: testProjectId,
          js_statement: 'nonExistentFunction()'
        });
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).to.match(/error|not defined/i);
      }
    });
  });

  describe('Performance', () => {
    it('should execute multiple operations quickly', async function() {
      this.timeout(30000); // 30 seconds

      const operations = [
        { scriptId: testProjectId, js_statement: 'add(1, 2)' },
        { scriptId: testProjectId, js_statement: 'multiply(3, 4)' },
        { scriptId: testProjectId, js_statement: 'processArray([1,2,3])' },
        { scriptId: testProjectId, js_statement: 'fibonacci(5)' },
        { scriptId: testProjectId, js_statement: 'generateTestData()' }
      ];

      const startTime = Date.now();

      for (const op of operations) {
        const result = await globalAuthState.client!.callAndParse('exec', op);
        expect(result.content).to.be.an('array');
      }

      const duration = Date.now() - startTime;
      console.log(`    ⏱️  5 operations completed in ${duration}ms`);

      // Should complete in reasonable time (allowing for API calls)
      expect(duration).to.be.lessThan(30000);
    });
  });
});
