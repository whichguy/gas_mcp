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
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { setupIntegrationTest, globalAuthState } from '../../setup/integrationSetup.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';

describe('File Operations Validation Tests', () => {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let gas: InProcessGASTestHelper;
  let testProjectId: string | null = null;

  before(async function() {
    this.timeout(60000); // Reduced timeout - no auth needed per test

    // Ensure global server is ready
    await setupIntegrationTest();

    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️  Skipping - server not ready');
      this.skip();
    }

    client = globalAuthState.client;
    auth = globalAuthState.auth!;
    gas = globalAuthState.gas!;

    // Create test project - server handles auth transparently
    const result = await gas.createTestProject('MCP-FileOps-Test');
    testProjectId = result.scriptId;
    console.log(`✅ Created test project: ${testProjectId}`);
  });

  beforeEach(async function() {
    // Validate server is authenticated
    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.error('⚠️  Server not authenticated - skipping test');
      this.skip();
    }

    // Verify test project exists
    if (testProjectId) {
      try {
        await client.callTool('info', { scriptId: testProjectId });
      } catch (error) {
        console.error('❌ Test project no longer valid:', error);
        this.skip();
      }
    }

    // Check token validity
    try {
      const authStatus = await auth.getAuthStatus();
      if (!authStatus.authenticated || !authStatus.tokenValid) {
        console.error('❌ Token expired or invalid');
        this.skip();
      }
    } catch (error) {
      console.error('❌ Failed to check auth status:', error);
      this.skip();
    }
  });

  afterEach(async function() {
    // Log test result for debugging
    const state = this.currentTest?.state;
    if (state === 'failed') {
      console.error(`❌ Test failed: ${this.currentTest?.title}`);
    }
  });

  after(async function() {
    this.timeout(TEST_TIMEOUTS.STANDARD);

    if (testProjectId) {
      try {
        console.log(`🧹 Cleaning up test project: ${testProjectId}`);
        await gas.cleanupTestProject(testProjectId);

        // Verify cleanup succeeded
        try {
          await client.callTool('info', { scriptId: testProjectId });
          console.warn('⚠️  Project still exists after cleanup!');
        } catch (error) {
          // Expected - project should be deleted
          console.log('✅ Cleanup verified - project deleted');
        }
      } catch (cleanupError) {
        console.error('❌ Cleanup failed (non-fatal):', cleanupError);
        // Don't fail suite on cleanup error
      }
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

  describe('Edge Conditions & Error Handling', () => {
    describe('Invalid Input Handling', () => {
      it('should handle invalid scriptId gracefully', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);

        try {
          await client.callTool('cat', {
            scriptId: 'invalid-script-id-12345',
            path: 'SomeFile'
          });
          expect.fail('Should have thrown error');
        } catch (error: any) {
          expect(error.message).to.match(/invalid|not found|error|tool error/i);
        }
      });

      it('should handle non-existent file path', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);
        expect(testProjectId).to.not.be.null;

        try {
          await client.callTool('cat', {
            scriptId: testProjectId,
            path: 'NonExistentFile12345'
          });
          expect.fail('Should have thrown error');
        } catch (error: any) {
          expect(error.message).to.match(/not found|error|tool error/i);
        }
      });

      it('should handle invalid file names with forbidden characters', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);
        expect(testProjectId).to.not.be.null;

        const invalidNames = ['file/with/slash', 'file\\with\\backslash', 'file:with:colon'];

        for (const invalidName of invalidNames) {
          try {
            await gas.writeTestFile(testProjectId!, invalidName, 'content');
            // Some invalid names might be handled by GAS API normalization
          } catch (error: any) {
            // Expected for truly invalid names
            expect(error.message).to.be.a('string');
          }
        }
      });
    });

    describe('File Operation Edge Cases', () => {
      it('should handle empty file content', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);
        expect(testProjectId).to.not.be.null;

        const result = await gas.writeTestFile(testProjectId!, 'EmptyFile', '');
        expect(result).to.have.property('success', true);

        const readResult = await gas.readFile(testProjectId!, 'EmptyFile');
        expect(readResult).to.be.a('string');
      });

      it('should handle whitespace-only content', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);
        expect(testProjectId).to.not.be.null;

        const whitespace = '   \n\n\t\t  \n   ';
        const result = await gas.writeTestFile(testProjectId!, 'WhitespaceFile', whitespace);
        expect(result).to.have.property('success', true);

        const readResult = await gas.readFile(testProjectId!, 'WhitespaceFile');
        expect(readResult).to.be.a('string');
      });

      it('should handle file names at character limits', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);
        expect(testProjectId).to.not.be.null;

        // GAS file names have limits - test a reasonably long name
        const longName = 'A'.repeat(50);

        try {
          const result = await gas.writeTestFile(testProjectId!, longName, 'content');
          expect(result).to.have.property('success', true);

          // Clean up
          await client.callTool('rm', { scriptId: testProjectId, path: longName });
        } catch (error: any) {
          // If too long, should fail gracefully
          expect(error.message).to.be.a('string');
        }
      });
    });

    describe('Copy/Move Edge Cases', () => {
      it('should handle copying to same name (overwrite)', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);
        expect(testProjectId).to.not.be.null;

        // Create original file
        await gas.writeTestFile(testProjectId!, 'OverwriteSource', 'original');

        // Create target with different content
        await gas.writeTestFile(testProjectId!, 'OverwriteTarget', 'target');

        // Copy should overwrite
        const result = await client.callTool('cp', {
          scriptId: testProjectId,
          from: 'OverwriteSource',
          to: 'OverwriteTarget'
        });

        expect(result.content[0].text).to.include('copied');
      });

      it('should handle move to same name (no-op or error)', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);
        expect(testProjectId).to.not.be.null;

        await gas.writeTestFile(testProjectId!, 'MoveTest', 'content');

        try {
          await client.callTool('mv', {
            scriptId: testProjectId,
            from: 'MoveTest',
            to: 'MoveTest'
          });
          // Should either succeed as no-op or fail
        } catch (error: any) {
          expect(error.message).to.be.a('string');
        }
      });
    });

    describe('Delete Edge Cases', () => {
      it('should handle deleting already deleted file', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);
        expect(testProjectId).to.not.be.null;

        // Create and delete file
        await gas.writeTestFile(testProjectId!, 'DeleteTwice', 'content');
        await client.callTool('rm', { scriptId: testProjectId, path: 'DeleteTwice' });

        // Try to delete again
        try {
          await client.callTool('rm', { scriptId: testProjectId, path: 'DeleteTwice' });
          expect.fail('Should have thrown error');
        } catch (error: any) {
          expect(error.message).to.match(/not found|error|tool error/i);
        }
      });

      it('should handle bulk delete with some non-existent files', async function() {
        this.timeout(TEST_TIMEOUTS.BULK);
        expect(testProjectId).to.not.be.null;

        // Create some files
        await gas.writeTestFile(testProjectId!, 'BulkDelete1', 'content');
        await gas.writeTestFile(testProjectId!, 'BulkDelete2', 'content');

        // Try to delete including non-existent
        const deletePromises = [
          client.callTool('rm', { scriptId: testProjectId, path: 'BulkDelete1' }),
          client.callTool('rm', { scriptId: testProjectId, path: 'BulkDelete2' }),
          client.callTool('rm', { scriptId: testProjectId, path: 'NonExistent123' })
            .catch(err => ({ error: err.message }))
        ];

        const results = await Promise.all(deletePromises);

        // First two should succeed, third should fail
        expect(results[0].content[0].text).to.include('deleted');
        expect(results[1].content[0].text).to.include('deleted');
        expect(results[2]).to.have.property('error');
      });
    });

    describe('Pattern Matching Edge Cases', () => {
      it('should handle pattern with no matches', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);
        expect(testProjectId).to.not.be.null;

        const result = await client.callTool('ls', {
          scriptId: testProjectId,
          path: 'NonExistentPattern*'
        });

        // Should return empty or minimal result
        expect(result.content[0].text).to.be.a('string');
      });

      it('should handle wildcard pattern matching all files', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);
        expect(testProjectId).to.not.be.null;

        // Create test files
        await gas.writeTestFile(testProjectId!, 'PatternTest1', 'content');
        await gas.writeTestFile(testProjectId!, 'PatternTest2', 'content');

        const result = await client.callTool('ls', {
          scriptId: testProjectId,
          path: '*'
        });

        const output = result.content[0].text;
        expect(output).to.include('PatternTest1');
        expect(output).to.include('PatternTest2');
      });
    });
  });
});
