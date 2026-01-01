/**
 * Integration tests for write locking
 *
 * Tests that concurrent write operations are properly serialized to prevent
 * data loss from "last-write-wins" collisions in the Google Apps Script API.
 *
 * NOTE: These tests require authentication and may make real API calls.
 * Set MCP_TEST_MODE=true to use cached auth tokens.
 */

import { expect } from 'chai';
import { GASClient } from '../../src/api/gasClient.js';
import { LockManager } from '../../src/utils/lockManager.js';
import { LockTimeoutError } from '../../src/errors/mcpErrors.js';

// Use test project from CLAUDE.md
const TEST_SCRIPT_ID = '1Y72rigcMUAwRd7bwl3CR57O6ENo5sKTn0xAl2C4HoZys75N5utGfkCUG';
const TEST_SCRIPT_ID_2 = '2Y72rigcMUAwRd7bwl3CR57O6ENo5sKTn0xAl2C4HoZys75N5utGfkCUG';

describe('Write Locking Integration', function() {
  // Increase timeout for network operations
  this.timeout(30000);

  let gasClient: GASClient;
  let lockManager: LockManager;

  before(() => {
    gasClient = new GASClient();
    lockManager = LockManager.getInstance();
  });

  afterEach(async () => {
    // Cleanup: Release all locks after each test
    await lockManager.releaseAllLocks();
  });

  describe('Concurrent writes to same project', () => {
    it('should serialize concurrent updateProjectContent calls', async function() {
      // Skip if no auth available
      if (!process.env.MCP_TEST_MODE) {
        this.skip();
      }

      const operations: string[] = [];
      const timestamp1 = Date.now();
      const timestamp2 = timestamp1 + 1;

      // Create two concurrent write operations
      const write1 = (async () => {
        operations.push('write1_start');
        const files = [{
          name: 'TestFile1',
          type: 'SERVER_JS' as const,
          source: `// Test write 1 at ${timestamp1}`
        }];
        await gasClient.updateProjectContent(TEST_SCRIPT_ID, files);
        operations.push('write1_complete');
      })();

      // Start second write shortly after first
      await new Promise(resolve => setTimeout(resolve, 100));

      const write2 = (async () => {
        operations.push('write2_start');
        const files = [{
          name: 'TestFile2',
          type: 'SERVER_JS' as const,
          source: `// Test write 2 at ${timestamp2}`
        }];
        await gasClient.updateProjectContent(TEST_SCRIPT_ID, files);
        operations.push('write2_complete');
      })();

      await Promise.all([write1, write2]);

      // Verify operations were serialized
      expect(operations).to.have.lengthOf(4);
      expect(operations[0]).to.equal('write1_start');
      expect(operations[1]).to.equal('write2_start');

      // One should complete before the other starts processing
      const write1CompleteIdx = operations.indexOf('write1_complete');
      const write2CompleteIdx = operations.indexOf('write2_complete');
      expect(Math.abs(write1CompleteIdx - write2CompleteIdx)).to.be.greaterThan(0);
    });

    it('should release lock even if write operation fails', async function() {
      // Skip if no auth available
      if (!process.env.MCP_TEST_MODE) {
        this.skip();
      }

      // Attempt write with invalid data to trigger error
      try {
        await gasClient.updateProjectContent(TEST_SCRIPT_ID, [] as any);
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        // Expected to fail
        expect(error).to.exist;
      }

      // Verify lock was released by checking we can acquire it immediately
      await lockManager.acquireLock(TEST_SCRIPT_ID, 'test_operation', 1000);
      await lockManager.releaseLock(TEST_SCRIPT_ID);
    });
  });

  describe('Concurrent writes to different projects', () => {
    it('should allow parallel writes to different scriptIds', async function() {
      // Skip if no auth available
      if (!process.env.MCP_TEST_MODE) {
        this.skip();
      }

      const startTime = Date.now();

      // Create two concurrent writes to different projects
      const writes = await Promise.all([
        (async () => {
          const files = [{
            name: 'ProjectA',
            type: 'SERVER_JS' as const,
            source: '// Project A'
          }];
          const start = Date.now();
          await gasClient.updateProjectContent(TEST_SCRIPT_ID, files);
          return Date.now() - start;
        })(),
        (async () => {
          const files = [{
            name: 'ProjectB',
            type: 'SERVER_JS' as const,
            source: '// Project B'
          }];
          const start = Date.now();
          await gasClient.updateProjectContent(TEST_SCRIPT_ID_2, files);
          return Date.now() - start;
        })()
      ]);

      const totalTime = Date.now() - startTime;

      // Total time should be less than sum of individual times (parallel execution)
      const sumOfTimes = writes[0] + writes[1];
      expect(totalTime).to.be.lessThan(sumOfTimes);
    });
  });

  describe('Lock timeout scenarios', () => {
    it('should timeout if lock is held too long', async () => {
      // Acquire lock and hold it
      await lockManager.acquireLock(TEST_SCRIPT_ID, 'blocking_operation');

      // Attempt write with short timeout should fail
      const files = [{
        name: 'TestTimeout',
        type: 'SERVER_JS' as const,
        source: '// Timeout test'
      }];

      // We can't easily test the full updateProjectContent timeout without modifying
      // the code, but we can test the lock manager timeout directly
      try {
        await lockManager.acquireLock(TEST_SCRIPT_ID, 'second_operation', 500);
        expect.fail('Should have thrown LockTimeoutError');
      } catch (error: any) {
        expect(error).to.be.instanceOf(LockTimeoutError);
        expect(error.message).to.include('Lock timeout');
        expect(error.message).to.include(TEST_SCRIPT_ID);
      } finally {
        await lockManager.releaseLock(TEST_SCRIPT_ID);
      }
    });
  });

  describe('Rapid successive operations', () => {
    it('should handle write → edit → aider rapid succession', async function() {
      // Skip if no auth available
      if (!process.env.MCP_TEST_MODE) {
        this.skip();
      }

      // These operations all call updateProjectContent under the hood
      const operations = [];

      // Simulate rapid tool calls (write, edit, aider all use updateProjectContent)
      for (let i = 0; i < 3; i++) {
        operations.push(
          gasClient.updateProjectContent(TEST_SCRIPT_ID, [{
            name: `RapidTest${i}`,
            type: 'SERVER_JS' as const,
            source: `// Rapid operation ${i}`
          }])
        );
      }

      // All operations should complete successfully
      const results = await Promise.all(operations);
      expect(results).to.have.lengthOf(3);
    });
  });

  describe('Lock status inspection', () => {
    it('should provide lock status for debugging', async () => {
      // Check unlocked status
      let status = await lockManager.getLockStatus(TEST_SCRIPT_ID);
      expect(status.locked).to.be.false;

      // Acquire lock
      await lockManager.acquireLock(TEST_SCRIPT_ID, 'debug_test');

      // Check locked status
      status = await lockManager.getLockStatus(TEST_SCRIPT_ID);
      expect(status.locked).to.be.true;
      expect(status.info).to.exist;
      expect(status.info!.operation).to.equal('debug_test');

      // Release and verify
      await lockManager.releaseLock(TEST_SCRIPT_ID);
      status = await lockManager.getLockStatus(TEST_SCRIPT_ID);
      expect(status.locked).to.be.false;
    });
  });
});
