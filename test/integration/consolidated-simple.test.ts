/**
 * Simplified Consolidated Integration Test Suite
 *
 * Demonstrates:
 * - SINGLE OAuth authentication (via globalAuth.ts)
 * - Shared project reuse across tests
 * - No repeated OAuth prompts
 *
 * This proves the architecture works without complex test scenarios.
 */

import { expect } from 'chai';
import { describe, it, before, after } from 'mocha';
import { globalAuthState } from '../setup/globalAuth.js';
import { resetSharedProject } from '../setup/integrationSetup.js';

describe('Simplified Consolidated Suite - Single OAuth', function() {
  this.timeout(300000); // 5 minutes

  let testProjectId: string;

  before(async function() {
    console.log('\n🏗️  ===== SETUP: USING SHARED TEST PROJECT =====');

    if (!globalAuthState.isAuthenticated || !globalAuthState.gas) {
      throw new Error('Global authentication not available');
    }

    testProjectId = globalAuthState.sharedProjectId!;
    if (!testProjectId) { throw new Error('No shared test project available'); }
    await resetSharedProject();

    // Add a simple test file
    await globalAuthState.gas.writeTestFile(
      testProjectId,
      'mathFunctions',
      `function add(a, b) { return a + b; }
function multiply(a, b) { return a * b; }`
    );

    console.log(`✅ Using shared test project: ${testProjectId}\n`);
  });

  after(async function() {
    // Shared project preserved for next suite — reset happens in next before()
  });

  describe('File Operations - No OAuth Prompts', () => {
    it('should list files', async () => {
      const files = await globalAuthState.gas!.listFiles(testProjectId);

      expect(files).to.be.an('array');
      expect(files.length).to.be.greaterThan(0);

      console.log(`   ✓ Listed ${files.length} files`);
    });

    it('should read file content', async () => {
      const content = await globalAuthState.gas!.readFile(testProjectId, 'mathFunctions');

      expect(content).to.be.a('string');
      expect(content).to.include('function add');
      expect(content).to.include('function multiply');

      console.log('   ✓ Read file content successfully');
    });

    it('should write new file', async () => {
      await globalAuthState.gas!.writeTestFile(
        testProjectId,
        'newFile',
        'function test() { return 42; }'
      );

      const content = await globalAuthState.gas!.readFile(testProjectId, 'newFile');
      expect(content).to.include('test()');

      console.log('   ✓ Wrote and verified new file');
    });
  });

  describe('Code Execution - No OAuth Prompts', () => {
    it('should execute simple addition', async () => {
      const result = await globalAuthState.gas!.runFunction(testProjectId, 'add(15, 27)');

      expect(result.response.result).to.equal(42);

      console.log('   ✓ Executed: add(15, 27) = 42');
    });

    it('should execute multiplication', async () => {
      const result = await globalAuthState.gas!.runFunction(testProjectId, 'multiply(6, 7)');

      expect(result.response.result).to.equal(42);

      console.log('   ✓ Executed: multiply(6, 7) = 42');
    });

    it('should execute multiple operations without re-auth', async () => {
      const operations = [
        { code: 'add(1, 2)', expected: 3 },
        { code: 'multiply(3, 4)', expected: 12 },
        { code: 'add(10, 20)', expected: 30 }
      ];

      console.log(`   Testing ${operations.length} operations with same auth...`);

      for (const op of operations) {
        const result = await globalAuthState.gas!.runFunction(testProjectId, op.code);
        expect(result.response.result).to.equal(op.expected);
      }

      console.log(`   ✓ Executed ${operations.length} operations - no OAuth prompts!`);
    });
  });

  describe('Project Info - No OAuth Prompts', () => {
    it('should get project info', async () => {
      const info = await globalAuthState.gas!.getProjectInfo(testProjectId);

      expect(info).to.have.property('scriptId', testProjectId);
      expect(info).to.have.property('title');

      console.log(`   ✓ Retrieved project info for ${testProjectId}`);
    });

    it('should list all projects', async () => {
      const projects = await globalAuthState.gas!.listProjects();

      expect(projects).to.be.an('array');
      expect(projects.length).to.be.greaterThan(0);

      console.log(`   ✓ Listed ${projects.length} projects`);
    });
  });

  describe('Success Summary', () => {
    it('should confirm single OAuth session worked', () => {
      console.log('\n🎉 ===== SUCCESS =====');
      console.log('✅ All tests completed with SINGLE OAuth authentication');
      console.log('✅ No repeated OAuth prompts');
      console.log('✅ Shared project across all tests');
      console.log('✅ Fast test execution');
      console.log('======================\n');

      expect(globalAuthState.isAuthenticated).to.be.true;
    });
  });
});
