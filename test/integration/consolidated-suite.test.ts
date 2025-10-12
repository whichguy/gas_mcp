/**
 * Consolidated Integration Test Suite
 *
 * Single suite that:
 * - Authenticates ONCE (via globalAuth.ts)
 * - Creates test projects ONCE
 * - Reuses projects and credentials across all tests
 * - Cleans up resources at the end
 *
 * This eliminates repeated OAuth prompts and speeds up test execution.
 */

import { expect } from 'chai';
import { describe, it, before, after } from 'mocha';
import { globalAuthState } from '../setup/globalAuth.js';
import { TestProjectFactory, TestProjectTemplate } from '../fixtures/mock-projects/testProjectFactory.js';

describe('Consolidated Integration Test Suite', function() {
  // Increase timeout for project creation
  this.timeout(300000); // 5 minutes

  // Shared test resources
  let mathProjectId: string;
  let dataProjectId: string;
  let webAppProjectId: string;

  let mathTemplate: TestProjectTemplate;
  let dataTemplate: TestProjectTemplate;
  let webAppTemplate: TestProjectTemplate;

  // Track created projects for cleanup
  const createdProjects: string[] = [];

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

    // Create test projects ONCE using the helper
    console.log('📦 Creating test projects (one-time setup)...');

    try {
      // Create math operations project
      console.log('  Creating math operations project...');
      const mathResult = await globalAuthState.gas!.createTestProject(mathTemplate.title);
      mathProjectId = mathResult.scriptId;
      createdProjects.push(mathProjectId);

      // Add files to math project
      for (const file of mathTemplate.files) {
        await globalAuthState.gas!.writeTestFile(mathProjectId, file.name, file.content);
      }
      console.log(`  ✅ Math project: ${mathProjectId}`);

      // Create data processing project
      console.log('  Creating data processing project...');
      const dataResult = await globalAuthState.gas!.createTestProject(dataTemplate.title);
      dataProjectId = dataResult.scriptId;
      createdProjects.push(dataProjectId);

      // Add files to data project
      for (const file of dataTemplate.files) {
        await globalAuthState.gas!.writeTestFile(dataProjectId, file.name, file.content);
      }
      console.log(`  ✅ Data project: ${dataProjectId}`);

      // Create web app project
      console.log('  Creating web app project...');
      const webAppResult = await globalAuthState.gas!.createTestProject(webAppTemplate.title);
      webAppProjectId = webAppResult.scriptId;
      createdProjects.push(webAppProjectId);

      // Add files to web app project
      for (const file of webAppTemplate.files) {
        await globalAuthState.gas!.writeTestFile(webAppProjectId, file.name, file.content);
      }
      console.log(`  ✅ Web app project: ${webAppProjectId}`);

      console.log('✅ All test projects created and ready');
    } catch (error) {
      console.error('❌ Failed to create test projects:', error);
      throw error;
    }
  });

  after(async function() {
    console.log('\n🧹 ===== CONSOLIDATED SUITE CLEANUP =====');

    // Cleanup projects (optional - projects can be left for debugging)
    if (process.env.CLEANUP_TEST_PROJECTS === 'true') {
      for (const projectId of createdProjects) {
        try {
          console.log(`  Cleaning up project: ${projectId}`);
          // List and delete files
          const files = await globalAuthState.client!.callAndParse('ls', {
            scriptId: projectId,
            path: ''
          });

          if (files.items) {
            for (const file of files.items) {
              await globalAuthState.client!.callAndParse('rm', {
                path: `${projectId}/${file.name}`
              });
            }
          }
        } catch (error) {
          console.warn(`  ⚠️  Failed to cleanup project ${projectId}:`, error);
        }
      }
    } else {
      console.log('  Skipping project cleanup (set CLEANUP_TEST_PROJECTS=true to enable)');
      console.log(`  Created projects: ${createdProjects.join(', ')}`);
    }

    console.log('✅ Suite cleanup complete');
  });

  describe('File Operations', () => {
    describe('List Files (ls)', () => {
      it('should list all files in math project', async () => {
        const result = await globalAuthState.client!.callAndParse('ls', {
          scriptId: mathProjectId,
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
          scriptId: mathProjectId,
          path: '',
          checksums: true
        });

        expect(result.items).to.be.an('array');
        const text = JSON.stringify(result.items);
        expect(text).to.include('gitSha1');
      });

      it('should list files in detailed mode', async () => {
        const result = await globalAuthState.client!.callAndParse('ls', {
          scriptId: dataProjectId,
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
          path: `${mathProjectId}/mathOperations.gs`
        });

        expect(result.content).to.be.a('string');
        expect(result.content).to.include('function add');
        expect(result.content).to.include('function multiply');
        expect(result.content).to.include('function fibonacci');
      });

      it('should read data processor file', async () => {
        const result = await globalAuthState.client!.callAndParse('cat', {
          path: `${dataProjectId}/dataProcessor.gs`
        });

        expect(result.content).to.be.a('string');
        expect(result.content).to.include('function processArray');
        expect(result.content).to.include('function transformObject');
      });

      it('should read appsscript.json manifest', async () => {
        const result = await globalAuthState.client!.callAndParse('cat', {
          path: `${mathProjectId}/appsscript.json`
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
          path: `${mathProjectId}/testUtils.gs`,
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
          path: `${mathProjectId}/testUtils.gs`,
          content: newContent
        });

        expect(writeResult.success).to.be.true;

        // Verify update
        const verifyResult = await globalAuthState.client!.callAndParse('cat', {
          path: `${mathProjectId}/testUtils.gs`
        });

        expect(verifyResult.content).to.include('UPDATED');
      });
    });
  });

  describe('Code Execution', () => {
    describe('Mathematical Operations', () => {
      it('should execute simple addition', async () => {
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: mathProjectId,
          js_statement: 'add(15, 27)'
        });

        expect(result.response.result).to.equal(42);
      });

      it('should execute multiplication', async () => {
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: mathProjectId,
          js_statement: 'multiply(6, 7)'
        });

        expect(result.response.result).to.equal(42);
      });

      it('should calculate fibonacci number', async () => {
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: mathProjectId,
          js_statement: 'fibonacci(10)'
        });

        expect(result.response.result).to.equal(55);
      });

      it('should check prime numbers', async () => {
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: mathProjectId,
          js_statement: 'isPrime(17)'
        });

        expect(result.response.result).to.be.true;
      });

      it('should run all math tests', async () => {
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: mathProjectId,
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
          scriptId: dataProjectId,
          js_statement: 'processArray([-1, 2, -3, 4, 5])'
        });

        expect(result.response.result).to.equal(22); // (2+4+5)*2 = 22
      });

      it('should transform object keys and values', async () => {
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: dataProjectId,
          js_statement: 'transformObject({name: "test", value: "hello"})'
        });

        expect(result.response.result).to.have.property('NAME', 'TEST');
        expect(result.response.result).to.have.property('VALUE', 'HELLO');
      });

      it('should parse and validate JSON', async () => {
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: dataProjectId,
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
          path: `${mathProjectId}/Calculator.gs`,
          content: moduleContent
        });

        // Use the module
        const result = await globalAuthState.client!.callAndParse('exec', {
          scriptId: mathProjectId,
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
          scriptId: mathProjectId,
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
          scriptId: dataProjectId,
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
          scriptId: mathProjectId,
          pattern: '*.gs'
        });

        expect(result.content).to.be.an('array');
        const text = JSON.stringify(result.content);
        expect(text).to.include('.gs');
      });

      it('should find JSON files', async () => {
        const result = await globalAuthState.client!.callAndParse('find', {
          scriptId: dataProjectId,
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
        scriptId: mathProjectId
      });

      expect(result.content).to.be.an('array');
      const text = JSON.stringify(result.content);
      expect(text).to.include(mathProjectId);
      expect(text).to.include('title');
    });

    it('should list all accessible projects', async () => {
      const result = await globalAuthState.client!.callAndParse('project_list', {});

      expect(result.content).to.be.an('array');
      const text = JSON.stringify(result.content);

      // Should include our test projects
      expect(text).to.include(mathProjectId) ||
      expect(text).to.include(dataProjectId) ||
      expect(text).to.include(webAppProjectId);
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
        expect(error.message).to.include('validation') ||
        expect(error.message).to.include('invalid') ||
        expect(error.message).to.include('not found');
      }
    });

    it('should handle file not found', async () => {
      try {
        await globalAuthState.client!.callAndParse('cat', {
          path: `${mathProjectId}/NonExistentFile.gs`
        });
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).to.include('not found') ||
        expect(error.message).to.include('does not exist');
      }
    });

    it('should handle execution errors', async () => {
      try {
        await globalAuthState.client!.callAndParse('exec', {
          scriptId: mathProjectId,
          js_statement: 'nonExistentFunction()'
        });
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).to.include('error') ||
        expect(error.message).to.include('not defined');
      }
    });
  });

  describe('Performance', () => {
    it('should execute multiple operations quickly', async function() {
      this.timeout(30000); // 30 seconds

      const operations = [
        { scriptId: mathProjectId, js_statement: 'add(1, 2)' },
        { scriptId: mathProjectId, js_statement: 'multiply(3, 4)' },
        { scriptId: dataProjectId, js_statement: 'processArray([1,2,3])' },
        { scriptId: mathProjectId, js_statement: 'fibonacci(5)' },
        { scriptId: dataProjectId, js_statement: 'generateTestData()' }
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
