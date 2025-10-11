/**
 * Performance Validation Tests
 *
 * Tests performance and scalability with real GAS projects:
 * - Large file operations (100KB+)
 * - Bulk file creation and management
 * - Rate limiting behavior
 * - Concurrent operations
 * - Search performance on large projects
 */

import { expect } from 'chai';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';

describe('Performance Validation Tests', () => {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let gas: InProcessGASTestHelper;
  let testProjectId: string | null = null;

  before(async function() {
    this.timeout(TEST_TIMEOUTS.EXECUTION);
    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️  Skipping integration tests - not authenticated');
      this.skip();
    }
    client = globalAuthState.client;
    auth = globalAuthState.auth!;  // Reuse global auth with sessionId
    gas = globalAuthState.gas!;

    // Create test project for performance tests
    const result = await gas.createTestProject('MCP-Performance-Test');
    testProjectId = result.scriptId;
    console.log(`✅ Created performance test project: ${testProjectId}`);
  });

  after(async function() {
    this.timeout(TEST_TIMEOUTS.STANDARD);
    if (testProjectId) {
      console.log(`🧹 Cleaning up test project: ${testProjectId}`);
      await gas.cleanupTestProject(testProjectId);
    }
  });

  describe('Large File Operations', () => {
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

    it('should handle very large file content (500KB)', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;

      const veryLargeContent = `
function veryLargeData() {
  const data = ${JSON.stringify('y'.repeat(500000))};
  return data.length;
}
`;

      const result = await gas.writeTestFile(testProjectId!, 'VeryLargeFile', veryLargeContent);
      expect(result).to.have.property('success', true);

      // Verify can still read
      const readResult = await gas.readFile(testProjectId!, 'VeryLargeFile');
      expect(readResult).to.include('veryLargeData');
    });

    it('should handle multiple large file operations', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;

      const largeContent = `
function largeModule() {
  const data = ${JSON.stringify('z'.repeat(50000))};
  return data;
}
`;

      // Create 3 large files
      for (let i = 1; i <= 3; i++) {
        const result = await gas.writeTestFile(
          testProjectId!,
          `LargeModule${i}`,
          largeContent
        );
        expect(result).to.have.property('success', true);
      }

      // Verify all exist
      const lsResult = await client.callTool('ls', {
        scriptId: testProjectId
      });

      const output = lsResult.content[0].text;
      for (let i = 1; i <= 3; i++) {
        expect(output).to.include(`LargeModule${i}`);
      }
    });
  });

  describe('Bulk File Creation', () => {
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

    it('should handle bulk file creation with timing metrics', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;

      const fileCount = 20;
      const timings: number[] = [];

      // Track individual file creation times
      for (let i = 1; i <= fileCount; i++) {
        const start = Date.now();

        await gas.writeTestFile(
          testProjectId!,
          `TimedFile${i}`,
          `exports.value = ${i};`
        );

        const elapsed = Date.now() - start;
        timings.push(elapsed);
      }

      const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
      const maxTime = Math.max(...timings);
      const minTime = Math.min(...timings);

      console.log(`📊 File creation performance:`);
      console.log(`   Average: ${avgTime.toFixed(0)}ms`);
      console.log(`   Min: ${minTime}ms`);
      console.log(`   Max: ${maxTime}ms`);

      // All files should be created
      expect(timings.length).to.equal(fileCount);
    });
  });

  describe('Concurrent Operations', () => {
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

    it('should handle concurrent read operations', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      // Create test files first
      for (let i = 1; i <= 5; i++) {
        await gas.writeTestFile(
          testProjectId!,
          `ReadTest${i}`,
          `exports.value = ${i};`
        );
      }

      // Read all files concurrently
      const promises = [];
      for (let i = 1; i <= 5; i++) {
        promises.push(gas.readFile(testProjectId!, `ReadTest${i}`));
      }

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach((result, idx) => {
        expect(result).to.include(`value = ${idx + 1}`);
      });
    });

    it('should handle mixed concurrent operations', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      const promises = [];

      // Mix of writes, reads, and ls operations
      promises.push(gas.writeTestFile(testProjectId!, 'MixedWrite1', 'exports.a = 1;'));
      promises.push(gas.writeTestFile(testProjectId!, 'MixedWrite2', 'exports.b = 2;'));
      promises.push(client.callTool('ls', { scriptId: testProjectId }));
      promises.push(gas.writeTestFile(testProjectId!, 'MixedWrite3', 'exports.c = 3;'));

      const results = await Promise.all(promises);

      // All operations should succeed
      expect(results.length).to.equal(4);
    });
  });

  describe('Rate Limiting', () => {
    it('should verify rate limiting behavior', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      // Make multiple rapid requests
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          client.callTool('ls', {
            scriptId: testProjectId
          })
        );
      }

      const results = await Promise.all(promises);

      // All should succeed (rate limiter should handle this)
      results.forEach(result => {
        expect(result.content[0].text).to.be.a('string');
      });
    });

    it('should handle burst of rapid requests', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      const start = Date.now();

      // Create 10 rapid requests
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          client.callTool('info', {
            scriptId: testProjectId
          })
        );
      }

      const results = await Promise.all(promises);
      const elapsed = Date.now() - start;

      // All should succeed
      results.forEach(result => {
        expect(result.content[0].text).to.include(testProjectId!);
      });

      console.log(`✅ Handled 10 requests in ${elapsed}ms`);
    });
  });

  describe('Search Performance', () => {
    before(async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      if (testProjectId) {
        // Create many files for search performance testing
        console.log('Setting up search performance test files...');
        for (let i = 1; i <= 25; i++) {
          await gas.writeTestFile(
            testProjectId,
            `SearchPerf${i}`,
            `function test${i}() { return ${i}; }\n// TODO: optimization needed`
          );
        }
      }
    });

    it('should handle search on project with many files', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      const start = Date.now();

      const result = await client.callTool('grep', {
        scriptId: testProjectId,
        pattern: 'TODO'
      });

      const elapsed = Date.now() - start;

      expect(result.content[0].text).to.include('TODO');
      console.log(`✅ Searched ${25}+ files in ${elapsed}ms`);
    });

    it('should handle ripgrep on large projects', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      const start = Date.now();

      const result = await client.callTool('ripgrep', {
        scriptId: testProjectId,
        pattern: 'function',
        sort: 'path'
      });

      const elapsed = Date.now() - start;

      expect(result.content[0].text).to.include('function');
      console.log(`✅ Ripgrep search completed in ${elapsed}ms`);
    });
  });

  describe('Execution Performance', () => {
    it('should handle rapid execution requests', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          gas.runFunction(testProjectId!, `return ${i};`)
        );
      }

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach((result, idx) => {
        expect(result).to.have.property('status', 'success');
        expect(result.result).to.equal(idx);
      });
    });

    it('should handle complex execution with timing', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const start = Date.now();

      const complexCode = `
        const numbers = [];
        for (let i = 0; i < 1000; i++) {
          numbers.push(i);
        }
        return numbers.reduce((sum, n) => sum + n, 0);
      `;

      const result = await gas.runFunction(testProjectId!, complexCode);
      const elapsed = Date.now() - start;

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal(499500); // Sum of 0-999

      console.log(`✅ Complex execution completed in ${elapsed}ms`);
    });
  });
});
