/**
 * Unit tests for LockManager
 *
 * Tests filesystem-based write locking to prevent concurrent write collisions
 */

import { expect } from 'chai';
import { LockManager } from '../../src/utils/lockManager.js';
import { LockTimeoutError } from '../../src/errors/mcpErrors.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const LOCK_DIR = path.join(os.homedir(), '.auth', 'mcp-gas', 'locks');
const TEST_SCRIPT_ID = '1Y72rigcMUAwRd7bwl3CR57O6ENo5sKTn0xAl2C4HoZys75N5utGfkCUG';
const TEST_SCRIPT_ID_2 = '2Y72rigcMUAwRd7bwl3CR57O6ENo5sKTn0xAl2C4HoZys75N5utGfkCUG';

describe('LockManager', () => {
  let lockManager: LockManager;

  beforeEach(() => {
    lockManager = LockManager.getInstance();
  });

  afterEach(async () => {
    // Cleanup: Release all locks and remove test lock files
    await lockManager.releaseAllLocks();
    try {
      await fs.unlink(path.join(LOCK_DIR, `${TEST_SCRIPT_ID}.lock`));
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await fs.unlink(path.join(LOCK_DIR, `${TEST_SCRIPT_ID_2}.lock`));
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
  });

  describe('acquireLock and releaseLock', () => {
    it('should acquire and release a lock successfully', async () => {
      // Acquire lock
      await lockManager.acquireLock(TEST_SCRIPT_ID, 'test_operation');

      // Verify lock file exists
      const lockPath = path.join(LOCK_DIR, `${TEST_SCRIPT_ID}.lock`);
      const exists = await fs.access(lockPath).then(() => true).catch(() => false);
      expect(exists).to.be.true;

      // Release lock
      await lockManager.releaseLock(TEST_SCRIPT_ID);

      // Verify lock file is removed
      const existsAfter = await fs.access(lockPath).then(() => true).catch(() => false);
      expect(existsAfter).to.be.false;
    });

    it('should allow acquiring locks for different scriptIds concurrently', async () => {
      // Acquire locks for two different projects
      await Promise.all([
        lockManager.acquireLock(TEST_SCRIPT_ID, 'test_op_1'),
        lockManager.acquireLock(TEST_SCRIPT_ID_2, 'test_op_2')
      ]);

      // Both locks should exist
      const lock1Exists = await fs.access(path.join(LOCK_DIR, `${TEST_SCRIPT_ID}.lock`))
        .then(() => true).catch(() => false);
      const lock2Exists = await fs.access(path.join(LOCK_DIR, `${TEST_SCRIPT_ID_2}.lock`))
        .then(() => true).catch(() => false);

      expect(lock1Exists).to.be.true;
      expect(lock2Exists).to.be.true;

      // Release both locks
      await Promise.all([
        lockManager.releaseLock(TEST_SCRIPT_ID),
        lockManager.releaseLock(TEST_SCRIPT_ID_2)
      ]);
    });

    it('should serialize concurrent acquisitions of the same lock', async () => {
      const operations: string[] = [];

      // First operation holds lock for 200ms
      const op1 = (async () => {
        await lockManager.acquireLock(TEST_SCRIPT_ID, 'operation_1');
        operations.push('op1_acquired');
        await new Promise(resolve => setTimeout(resolve, 200));
        operations.push('op1_released');
        await lockManager.releaseLock(TEST_SCRIPT_ID);
      })();

      // Second operation tries to acquire immediately after
      await new Promise(resolve => setTimeout(resolve, 50)); // Let op1 acquire first
      const op2 = (async () => {
        operations.push('op2_waiting');
        await lockManager.acquireLock(TEST_SCRIPT_ID, 'operation_2');
        operations.push('op2_acquired');
        await lockManager.releaseLock(TEST_SCRIPT_ID);
      })();

      await Promise.all([op1, op2]);

      // Verify order: op1 acquires, op2 waits, op1 releases, op2 acquires
      expect(operations).to.deep.equal([
        'op1_acquired',
        'op2_waiting',
        'op1_released',
        'op2_acquired'
      ]);
    });
  });

  describe('timeout behavior', () => {
    it('should throw LockTimeoutError when timeout is exceeded', async () => {
      // Acquire lock
      await lockManager.acquireLock(TEST_SCRIPT_ID, 'blocking_operation');

      // Try to acquire again with short timeout
      try {
        await lockManager.acquireLock(TEST_SCRIPT_ID, 'second_operation', 500);
        expect.fail('Should have thrown LockTimeoutError');
      } catch (error: any) {
        expect(error).to.be.instanceOf(LockTimeoutError);
        expect(error.message).to.include('Lock timeout after 500ms');
        expect(error.message).to.include(TEST_SCRIPT_ID);
      } finally {
        // Cleanup
        await lockManager.releaseLock(TEST_SCRIPT_ID);
      }
    });

    it('should include current lock holder info in timeout error', async () => {
      // Acquire lock
      await lockManager.acquireLock(TEST_SCRIPT_ID, 'first_operation');

      try {
        // Try to acquire with timeout
        await lockManager.acquireLock(TEST_SCRIPT_ID, 'second_operation', 300);
        expect.fail('Should have thrown LockTimeoutError');
      } catch (error: any) {
        expect(error).to.be.instanceOf(LockTimeoutError);
        expect(error.message).to.include('Currently held by PID');
        expect(error.message).to.include(os.hostname());
        expect(error.message).to.include('first_operation');
      } finally {
        await lockManager.releaseLock(TEST_SCRIPT_ID);
      }
    });
  });

  describe('stale lock detection', () => {
    it('should remove stale lock if process no longer exists', async () => {
      const lockPath = path.join(LOCK_DIR, `${TEST_SCRIPT_ID}.lock`);

      // Create a fake stale lock with non-existent PID
      const staleLock = {
        pid: 999999, // Very unlikely to exist
        hostname: os.hostname(),
        timestamp: Date.now() - 1000,
        operation: 'stale_operation',
        scriptId: TEST_SCRIPT_ID
      };

      await fs.mkdir(LOCK_DIR, { recursive: true, mode: 0o700 });
      await fs.writeFile(lockPath, JSON.stringify(staleLock, null, 2), { mode: 0o600 });

      // Try to acquire lock - should detect stale lock and acquire
      await lockManager.acquireLock(TEST_SCRIPT_ID, 'new_operation');

      // Verify new lock was acquired
      const lockContent = await fs.readFile(lockPath, 'utf-8');
      const currentLock = JSON.parse(lockContent);
      expect(currentLock.pid).to.equal(process.pid);
      expect(currentLock.operation).to.equal('new_operation');

      // Cleanup
      await lockManager.releaseLock(TEST_SCRIPT_ID);
    });

    it('should remove old locks from different hostname', async () => {
      const lockPath = path.join(LOCK_DIR, `${TEST_SCRIPT_ID}.lock`);

      // Create a fake old lock from different host (6 minutes old)
      const oldLock = {
        pid: 12345,
        hostname: 'different-host.local',
        timestamp: Date.now() - (6 * 60 * 1000),
        operation: 'old_operation',
        scriptId: TEST_SCRIPT_ID
      };

      await fs.mkdir(LOCK_DIR, { recursive: true, mode: 0o700 });
      await fs.writeFile(lockPath, JSON.stringify(oldLock, null, 2), { mode: 0o600 });

      // Try to acquire lock - should detect old lock and acquire
      await lockManager.acquireLock(TEST_SCRIPT_ID, 'new_operation', 1000);

      // Verify new lock was acquired
      const lockContent = await fs.readFile(lockPath, 'utf-8');
      const currentLock = JSON.parse(lockContent);
      expect(currentLock.hostname).to.equal(os.hostname());

      // Cleanup
      await lockManager.releaseLock(TEST_SCRIPT_ID);
    });
  });

  describe('cleanupStaleLocks', () => {
    it('should remove all stale locks on startup', async () => {
      // Create multiple stale locks
      const staleLocks = [
        { scriptId: TEST_SCRIPT_ID, pid: 999998 },
        { scriptId: TEST_SCRIPT_ID_2, pid: 999999 }
      ];

      await fs.mkdir(LOCK_DIR, { recursive: true, mode: 0o700 });

      for (const { scriptId, pid } of staleLocks) {
        const lockPath = path.join(LOCK_DIR, `${scriptId}.lock`);
        const lockInfo = {
          pid,
          hostname: os.hostname(),
          timestamp: Date.now(),
          operation: 'stale_op',
          scriptId
        };
        await fs.writeFile(lockPath, JSON.stringify(lockInfo, null, 2), { mode: 0o600 });
      }

      // Run cleanup
      await lockManager.cleanupStaleLocks();

      // Verify locks are removed
      for (const { scriptId } of staleLocks) {
        const lockPath = path.join(LOCK_DIR, `${scriptId}.lock`);
        const exists = await fs.access(lockPath).then(() => true).catch(() => false);
        expect(exists).to.be.false;
      }
    });

    it('should not remove valid locks during cleanup', async () => {
      // Acquire a valid lock
      await lockManager.acquireLock(TEST_SCRIPT_ID, 'valid_operation');

      // Run cleanup
      await lockManager.cleanupStaleLocks();

      // Verify lock still exists
      const lockPath = path.join(LOCK_DIR, `${TEST_SCRIPT_ID}.lock`);
      const exists = await fs.access(lockPath).then(() => true).catch(() => false);
      expect(exists).to.be.true;

      // Cleanup
      await lockManager.releaseLock(TEST_SCRIPT_ID);
    });
  });

  describe('releaseAllLocks', () => {
    it('should release all locks held by this process', async () => {
      // Acquire multiple locks
      await lockManager.acquireLock(TEST_SCRIPT_ID, 'operation_1');
      await lockManager.acquireLock(TEST_SCRIPT_ID_2, 'operation_2');

      // Release all
      await lockManager.releaseAllLocks();

      // Verify all locks are removed
      const lock1Exists = await fs.access(path.join(LOCK_DIR, `${TEST_SCRIPT_ID}.lock`))
        .then(() => true).catch(() => false);
      const lock2Exists = await fs.access(path.join(LOCK_DIR, `${TEST_SCRIPT_ID_2}.lock`))
        .then(() => true).catch(() => false);

      expect(lock1Exists).to.be.false;
      expect(lock2Exists).to.be.false;
    });
  });

  describe('lock file permissions', () => {
    it('should create lock files with 0600 permissions (owner-only)', async () => {
      await lockManager.acquireLock(TEST_SCRIPT_ID, 'permission_test');

      const lockPath = path.join(LOCK_DIR, `${TEST_SCRIPT_ID}.lock`);
      const stats = await fs.stat(lockPath);

      // Check permissions (0600 = -rw-------)
      const mode = stats.mode & 0o777;
      expect(mode).to.equal(0o600);

      await lockManager.releaseLock(TEST_SCRIPT_ID);
    });
  });

  describe('getLockStatus', () => {
    it('should return lock status for unlocked scriptId', async () => {
      const status = await lockManager.getLockStatus(TEST_SCRIPT_ID);
      expect(status.locked).to.be.false;
      expect(status.info).to.be.undefined;
    });

    it('should return lock status for locked scriptId', async () => {
      await lockManager.acquireLock(TEST_SCRIPT_ID, 'test_operation');

      const status = await lockManager.getLockStatus(TEST_SCRIPT_ID);
      expect(status.locked).to.be.true;
      expect(status.info).to.exist;
      expect(status.info!.pid).to.equal(process.pid);
      expect(status.info!.operation).to.equal('test_operation');
      expect(status.info!.scriptId).to.equal(TEST_SCRIPT_ID);

      await lockManager.releaseLock(TEST_SCRIPT_ID);
    });
  });
});
