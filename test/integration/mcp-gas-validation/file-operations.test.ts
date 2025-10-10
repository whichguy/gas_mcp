/**
 * File Operations Validation Tests
 *
 * Tests file management operations with real GAS projects:
 * - File CRUD (create, read, update, delete)
 * - File copy, move, rename operations
 * - File listing and pattern matching
 * - Batch file creation
 * - Special characters in file names
 */

import { expect } from 'chai';
import { MCPTestClient, AuthTestHelper, GASTestHelper } from '../../helpers/mcpClient.js';
import { setupIntegrationTest, globalAuthState } from '../../setup/integrationSetup.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';

describe('File Operations Validation Tests', () => {
  let client: MCPTestClient;
  let auth: AuthTestHelper;
  let gas: GASTestHelper;
  let testProjectId: string | null = null;

  before(async function() {
    this.timeout(130000); // Allow time for OAuth if needed

    // Explicit setup call - this is where auth happens
    await setupIntegrationTest();

    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️  Skipping integration tests - authentication failed');
      this.skip();
    }

    client = globalAuthState.client;
    auth = globalAuthState.auth!;
    gas = new GASTestHelper(client);

    // Create test project
    const result = await gas.createTestProject('MCP-FileOps-Test');
    testProjectId = result.scriptId;
    console.log(`✅ Created test project: ${testProjectId}`);
  });

  after(async function() {
    this.timeout(TEST_TIMEOUTS.STANDARD);
    if (testProjectId) {
      console.log(`🧹 Cleaning up test project: ${testProjectId}`);
      await gas.cleanupTestProject(testProjectId);
    }
  });

  describe('File CRUD Operations', () => {
    const testFileName = 'TestFile';
    const testContent = 'function test() { return "Hello from test"; }';
    const updatedContent = 'function test() { return "Updated test"; }';

    it('should create file with gas_write', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await gas.writeTestFile(testProjectId!, testFileName, testContent);

      expect(result).to.have.property('success', true);
      expect(result).to.have.property('filePath');
      expect(result.filePath).to.include(testFileName);
    });

    it('should read file with gas_cat', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await gas.readFile(testProjectId!, testFileName);

      expect(result).to.be.a('string');
      expect(result).to.include('Hello from test');
    });

    it('should update file content', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const writeResult = await gas.writeTestFile(testProjectId!, testFileName, updatedContent);
      expect(writeResult).to.have.property('success', true);

      const readResult = await gas.readFile(testProjectId!, testFileName);
      expect(readResult).to.include('Updated test');
    });

    it('should verify file via gas_ls', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('ls', {
        scriptId: testProjectId
      });

      expect(result.content[0].text).to.include(testFileName);
    });

    it('should delete file with gas_rm', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const deleteResult = await client.callTool('rm', {
        scriptId: testProjectId,
        path: testFileName
      });

      expect(deleteResult.content[0].text).to.include('deleted');

      // Verify file is gone
      const lsResult = await client.callTool('ls', {
        scriptId: testProjectId
      });

      expect(lsResult.content[0].text).to.not.include(testFileName);
    });
  });

  describe('File Copy and Move Operations', () => {
    const sourceFile = 'SourceFile';
    const copyTarget = 'CopiedFile';
    const moveTarget = 'MovedFile';
    const fileContent = 'function source() { return "source content"; }';

    before(async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      if (testProjectId) {
        await gas.writeTestFile(testProjectId, sourceFile, fileContent);
      }
    });

    it('should copy file with gas_cp', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('cp', {
        scriptId: testProjectId,
        from: sourceFile,
        to: copyTarget
      });

      expect(result.content[0].text).to.include('copied');

      // Verify both files exist
      const lsResult = await client.callTool('ls', {
        scriptId: testProjectId
      });

      expect(lsResult.content[0].text).to.include(sourceFile);
      expect(lsResult.content[0].text).to.include(copyTarget);
    });

    it('should move/rename file with gas_mv', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('mv', {
        scriptId: testProjectId,
        from: copyTarget,
        to: moveTarget
      });

      expect(result.content[0].text).to.include('moved');

      // Verify old name gone, new name exists
      const lsResult = await client.callTool('ls', {
        scriptId: testProjectId
      });

      expect(lsResult.content[0].text).to.not.include(copyTarget);
      expect(lsResult.content[0].text).to.include(moveTarget);
    });

    it('should perform bulk copy operations', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      // Create 5 source files
      for (let i = 1; i <= 5; i++) {
        await gas.writeTestFile(testProjectId!, `Module${i}`, `exports.value = ${i};`);
      }

      // Copy them
      for (let i = 1; i <= 5; i++) {
        const result = await client.callTool('cp', {
          scriptId: testProjectId,
          from: `Module${i}`,
          to: `ModuleCopy${i}`
        });

        expect(result.content[0].text).to.include('copied');
      }

      // Verify copies exist
      const lsResult = await client.callTool('ls', {
        scriptId: testProjectId
      });

      const output = lsResult.content[0].text;
      for (let i = 1; i <= 5; i++) {
        expect(output).to.include(`ModuleCopy${i}`);
      }
    });

    it('should perform bulk delete operations', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      // Delete copied modules
      for (let i = 1; i <= 5; i++) {
        const result = await client.callTool('rm', {
          scriptId: testProjectId,
          path: `ModuleCopy${i}`
        });

        expect(result.content[0].text).to.include('deleted');
      }

      // Verify deletions
      const lsResult = await client.callTool('ls', {
        scriptId: testProjectId
      });

      const output = lsResult.content[0].text;
      for (let i = 1; i <= 5; i++) {
        expect(output).to.not.include(`ModuleCopy${i}`);
      }
    });
  });

  describe('File Listing and Pattern Matching', () => {
    it('should list files with pattern matching', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      // Create multiple files
      await gas.writeTestFile(testProjectId!, 'File1', 'content1');
      await gas.writeTestFile(testProjectId!, 'File2', 'content2');
      await gas.writeTestFile(testProjectId!, 'Other', 'other');

      const result = await client.callTool('ls', {
        scriptId: testProjectId,
        path: 'File*'
      });

      const output = result.content[0].text;
      expect(output).to.include('File1');
      expect(output).to.include('File2');
    });
  });

  describe('Batch File Creation', () => {
    it('should create multiple files in batch', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const files = [
        { name: 'Batch1', content: 'batch content 1' },
        { name: 'Batch2', content: 'batch content 2' },
        { name: 'Batch3', content: 'batch content 3' }
      ];

      for (const file of files) {
        await gas.writeTestFile(testProjectId!, file.name, file.content);
      }

      const lsResult = await client.callTool('ls', {
        scriptId: testProjectId
      });

      const output = lsResult.content[0].text;
      files.forEach(file => {
        expect(output).to.include(file.name);
      });
    });

    it('should handle bulk file creation (30+ files)', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;

      const start = Date.now();

      // Create 30 files
      const fileCount = 30;
      for (let i = 1; i <= fileCount; i++) {
        await gas.writeTestFile(
          testProjectId!,
          `BulkFile${i}`,
          `function bulk${i}() { return ${i}; }`
        );
      }

      const elapsed = Date.now() - start;

      // Verify all created
      const lsResult = await client.callTool('ls', {
        scriptId: testProjectId
      });

      const output = lsResult.content[0].text;
      for (let i = 1; i <= fileCount; i++) {
        expect(output).to.include(`BulkFile${i}`);
      }

      console.log(`✅ Created ${fileCount} files in ${elapsed}ms`);
    });
  });

  describe('Special Characters and Edge Cases', () => {
    it('should handle special characters in file names', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const specialName = 'File_With-Special.Chars';

      const result = await gas.writeTestFile(
        testProjectId!,
        specialName,
        'exports.special = true;'
      );

      expect(result).to.have.property('success', true);

      // Verify can read it back
      const readResult = await gas.readFile(testProjectId!, specialName);
      expect(readResult).to.include('special');
    });

    it('should handle large file operations (100KB+)', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      // Create 100KB+ file
      const largeContent = `
function largeFunction() {
  const data = ${JSON.stringify('x'.repeat(100000))};
  return data.length;
}
`;

      const result = await gas.writeTestFile(testProjectId!, 'LargeFile', largeContent);
      expect(result).to.have.property('success', true);

      // Read it back
      const readResult = await gas.readFile(testProjectId!, 'LargeFile');
      expect(readResult).to.include('largeFunction');
    });
  });

  describe('File Reordering', () => {
    it('should reorder files', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      // Create a file to reorder
      await gas.writeTestFile(testProjectId!, 'ReorderTest', 'exports.test = true;');

      const result = await client.callTool('reorder', {
        scriptId: testProjectId,
        fileName: 'ReorderTest',
        newPosition: 5
      });

      expect(result.content[0].text).to.include('success');
    });
  });

  describe('Concurrent File Operations', () => {
    it('should handle concurrent file operations', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      // Create multiple files concurrently
      const promises = [];
      for (let i = 1; i <= 10; i++) {
        promises.push(
          gas.writeTestFile(
            testProjectId!,
            `Concurrent${i}`,
            `exports.value = ${i};`
          )
        );
      }

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach(result => {
        expect(result).to.have.property('success', true);
      });

      // Verify all files exist
      const lsResult = await client.callTool('ls', {
        scriptId: testProjectId
      });

      const output = lsResult.content[0].text;
      for (let i = 1; i <= 10; i++) {
        expect(output).to.include(`Concurrent${i}`);
      }
    });
  });
});
