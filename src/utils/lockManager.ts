/**
 * LockManager - Filesystem-based per-project write locks
 *
 * Prevents concurrent write collisions to Google Apps Script projects.
 * Since the GAS API provides no server-side concurrency control (no ETags,
 * version checking, or conflict detection), we implement client-side locking
 * to prevent "last-write-wins" data loss.
 *
 * Architecture:
 * - Per-project locks (by scriptId) - allows concurrent writes to different projects
 * - Filesystem-based - works across multiple MCP server instances
 * - Timeout-based waiting - prevents indefinite hangs
 * - Stale lock detection - recovers from process crashes
 * - Automatic cleanup - on startup and shutdown
 *
 * Lock Storage:
 * - Directory: ~/.auth/mcp-gas/locks/
 * - Format: {scriptId}.lock
 * - Permissions: 0600 (owner-only)
 *
 * Lock File Content:
 * {
 *   "pid": 12345,
 *   "hostname": "mycomputer.local",
 *   "timestamp": 1704067200000,
 *   "operation": "updateProjectContent",
 *   "scriptId": "1Y72rigc...CUG"
 * }
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { LockTimeoutError } from '../errors/mcpErrors.js';

// Lock directory in user home directory
const LOCK_DIR = path.join(os.homedir(), '.auth', 'mcp-gas', 'locks');

// Default timeout for lock acquisition (30 seconds, configurable via environment)
// Can be overridden with MCP_GAS_LOCK_TIMEOUT environment variable (in milliseconds)
const DEFAULT_LOCK_TIMEOUT = (() => {
  const envTimeout = process.env.MCP_GAS_LOCK_TIMEOUT;
  if (!envTimeout) {
    return 30000; // Default 30 seconds
  }

  const parsed = parseInt(envTimeout, 10);
  if (isNaN(parsed) || parsed < 1000) {
    console.error(`⚠️ [LOCK] Invalid MCP_GAS_LOCK_TIMEOUT="${envTimeout}", must be >= 1000ms. Using default 30000ms`);
    return 30000;
  }

  console.error(`🔧 [LOCK] Using custom timeout from MCP_GAS_LOCK_TIMEOUT: ${parsed}ms`);
  return parsed;
})();

// Retry interval for lock acquisition polling (100ms)
const LOCK_RETRY_INTERVAL = 100;

// Maximum age for stale lock detection (5 minutes)
const STALE_LOCK_MAX_AGE = 5 * 60 * 1000;

/**
 * Lock information stored in lock file
 */
interface LockInfo {
  pid: number;
  hostname: string;
  timestamp: number;
  operation: string;
  scriptId: string;
}

/**
 * LockManager singleton class
 *
 * Provides per-project filesystem locks to prevent concurrent write collisions
 */
export class LockManager {
  private static instance: LockManager;
  private heldLocks: Set<string> = new Set(); // Track locks held by this process
  private cleanupInProgress = false; // Prevent concurrent cleanup calls

  // Simple metrics for observability and debugging
  private metrics = {
    acquisitions: 0,      // Total successful lock acquisitions
    contentions: 0,       // Times we had to wait for a lock
    timeouts: 0,          // Lock timeout errors thrown
    staleRemoved: 0       // Stale locks cleaned up
  };

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get singleton instance
   */
  static getInstance(): LockManager {
    if (!LockManager.instance) {
      LockManager.instance = new LockManager();
    }
    return LockManager.instance;
  }

  /**
   * Get lock file path for a scriptId
   */
  private getLockPath(scriptId: string): string {
    return path.join(LOCK_DIR, `${scriptId}.lock`);
  }

  /**
   * Ensure lock directory exists
   */
  private async ensureLockDir(): Promise<void> {
    try {
      await fs.mkdir(LOCK_DIR, { recursive: true, mode: 0o700 });
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        console.error(`Failed to create lock directory:`, error);
        throw error;
      }
    }
  }

  /**
   * Read lock info from file
   */
  private async readLockInfo(lockPath: string): Promise<LockInfo | null> {
    try {
      const content = await fs.readFile(lockPath, 'utf-8');
      return JSON.parse(content);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null; // Lock file doesn't exist
      }
      console.error(`Failed to read lock file ${lockPath}:`, error);
      return null;
    }
  }

  /**
   * Write lock info to file
   */
  private async writeLockInfo(lockPath: string, lockInfo: LockInfo): Promise<void> {
    await fs.writeFile(lockPath, JSON.stringify(lockInfo, null, 2), {
      mode: 0o600, // Owner-only read/write
      flag: 'wx'  // Exclusive write (fails if file exists)
    });
  }

  /**
   * Check if a process is running using Unix signal 0 probe
   *
   * Despite the misleading name, process.kill(pid, 0) does NOT harm the target process.
   * Signal 0 is a "null signal" that only checks if the process exists and is accessible,
   * without actually sending any signal or affecting the process in any way.
   *
   * This is the standard POSIX idiom for checking process existence atomically.
   *
   * @param pid - Process ID to check
   * @returns true if process exists, false if it doesn't exist
   */
  private isProcessRunning(pid: number): boolean {
    try {
      // Send signal 0 (null signal) - checks process existence without affecting it
      // The target process continues running completely unaffected
      process.kill(pid, 0);
      return true; // Process exists and we can signal it
    } catch (error: any) {
      if (error.code === 'ESRCH') {
        // "No such process" - definitively doesn't exist
        return false;
      }
      if (error.code === 'EPERM') {
        // Process exists but we lack permission to signal it
        // This means the process is running, we just can't interact with it
        return true;
      }
      // Unexpected error (EIO, EINVAL, etc.) - be conservative
      // Better to wait unnecessarily than incorrectly mark a valid lock as stale
      console.error(`⚠️ [LOCK] Unexpected error checking PID ${pid}:`, error);
      return true;
    }
  }

  /**
   * Check if lock is stale (process died or very old)
   */
  private async isLockStale(lockInfo: LockInfo): Promise<boolean> {
    // Different hostname = can't check process, rely on age
    if (lockInfo.hostname !== os.hostname()) {
      const age = Date.now() - lockInfo.timestamp;
      return age > STALE_LOCK_MAX_AGE;
    }

    // Same hostname = check if process is running
    return !this.isProcessRunning(lockInfo.pid);
  }

  /**
   * Acquire lock for a scriptId
   *
   * @param scriptId - Google Apps Script project ID
   * @param operation - Operation name (for debugging)
   * @param timeout - Timeout in milliseconds (default: 30000)
   * @throws LockTimeoutError if timeout exceeded
   */
  async acquireLock(
    scriptId: string,
    operation: string,
    timeout: number = DEFAULT_LOCK_TIMEOUT
  ): Promise<void> {
    await this.ensureLockDir();

    const lockPath = this.getLockPath(scriptId);
    const lockInfo: LockInfo = {
      pid: process.pid,
      hostname: os.hostname(),
      timestamp: Date.now(),
      operation,
      scriptId
    };

    const startTime = Date.now();
    const maxAttempts = Math.ceil(timeout / LOCK_RETRY_INTERVAL);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Try to create lock file exclusively
        await this.writeLockInfo(lockPath, lockInfo);

        // Success! Track this lock
        this.heldLocks.add(scriptId);
        this.metrics.acquisitions++;
        console.error(`🔒 [LOCK] Acquired lock for ${scriptId} (${operation})`);
        return;

      } catch (error: any) {
        if (error.code === 'EEXIST') {
          // Lock file exists, check if it's stale
          const existingLock = await this.readLockInfo(lockPath);

          if (existingLock && await this.isLockStale(existingLock)) {
            // Stale lock, remove it and retry
            console.error(`⚠️  [LOCK] Removing stale lock for ${scriptId} (PID ${existingLock.pid} on ${existingLock.hostname})`);
            try {
              await fs.unlink(lockPath);
              this.metrics.staleRemoved++;
              continue; // Retry immediately
            } catch (unlinkError: any) {
              if (unlinkError.code !== 'ENOENT') {
                console.error(`Failed to remove stale lock:`, unlinkError);
              }
            }
          }

          // Lock is valid, wait and retry
          if (attempt === 0) {
            const holder = existingLock ? `PID ${existingLock.pid} on ${existingLock.hostname}` : 'unknown';
            console.error(`⏳ [LOCK] Waiting for lock on ${scriptId} (held by ${holder})...`);
            this.metrics.contentions++;
          }

          await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL));
          continue;
        }

        // Other error, rethrow
        throw error;
      }
    }

    // Timeout exceeded
    this.metrics.timeouts++;
    const existingLock = await this.readLockInfo(lockPath);
    throw new LockTimeoutError(scriptId, timeout, operation, existingLock || undefined);
  }

  /**
   * Release lock for a scriptId
   *
   * Safe to call even if lock is not held or already released.
   * Errors during unlock are logged but don't throw - lock will be cleaned as stale on restart.
   *
   * @param scriptId - Google Apps Script project ID
   */
  async releaseLock(scriptId: string): Promise<void> {
    const lockPath = this.getLockPath(scriptId);

    try {
      // Only delete if we hold this lock
      if (this.heldLocks.has(scriptId)) {
        await fs.unlink(lockPath);
        this.heldLocks.delete(scriptId);
        console.error(`🔓 [LOCK] Released lock for ${scriptId}`);
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Lock file already removed (race with cleanup or another process?) - not an error
        // Remove from tracking since file is gone
        this.heldLocks.delete(scriptId);
        return;
      }

      // Unexpected error (permissions, I/O error, readonly filesystem, etc.)
      // Log details but don't throw - we want shutdown to proceed gracefully
      console.error(`⚠️ [LOCK] Failed to release lock for ${scriptId}:`, error);
      console.error(`   Lock file: ${lockPath}`);
      console.error(`   Lock file may remain orphaned and will be cleaned as stale on next server startup`);

      // Still remove from tracking to prevent double-release attempts
      // and to allow process to shutdown cleanly
      this.heldLocks.delete(scriptId);
    }
  }

  /**
   * Cleanup stale locks from dead processes
   *
   * Called on server startup to remove orphaned locks.
   * Protected against concurrent cleanup calls to prevent race conditions.
   */
  async cleanupStaleLocks(): Promise<void> {
    // Prevent concurrent cleanup calls
    if (this.cleanupInProgress) {
      console.error('⏭️  [LOCK] Cleanup already in progress, skipping...');
      return;
    }

    this.cleanupInProgress = true;
    try {
      await this.ensureLockDir();

      const files = await fs.readdir(LOCK_DIR);
      let cleanedCount = 0;

      for (const file of files) {
        if (!file.endsWith('.lock')) continue;

        const lockPath = path.join(LOCK_DIR, file);
        const lockInfo = await this.readLockInfo(lockPath);

        if (lockInfo && await this.isLockStale(lockInfo)) {
          try {
            await fs.unlink(lockPath);
            cleanedCount++;
            this.metrics.staleRemoved++;
            console.error(`🧹 [LOCK] Removed stale lock: ${file} (PID ${lockInfo.pid})`);
          } catch (error: any) {
            if (error.code !== 'ENOENT') {
              console.error(`Failed to remove stale lock ${file}:`, error);
            }
          }
        }
      }

      if (cleanedCount > 0) {
        console.error(`✅ [LOCK] Cleaned up ${cleanedCount} stale lock(s)`);
      }

    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`Failed to cleanup stale locks:`, error);
      }
    } finally {
      this.cleanupInProgress = false;
    }
  }

  /**
   * Release all locks held by this process
   *
   * Called on server shutdown
   */
  async releaseAllLocks(): Promise<void> {
    const locks = Array.from(this.heldLocks);

    if (locks.length > 0) {
      console.error(`🔓 [LOCK] Releasing ${locks.length} held lock(s)...`);

      await Promise.all(
        locks.map(scriptId => this.releaseLock(scriptId))
      );
    }
  }

  /**
   * Get current lock status (for debugging)
   */
  async getLockStatus(scriptId: string): Promise<{ locked: boolean; info?: LockInfo }> {
    const lockPath = this.getLockPath(scriptId);
    const lockInfo = await this.readLockInfo(lockPath);

    return {
      locked: lockInfo !== null,
      info: lockInfo || undefined
    };
  }

  /**
   * Get current metrics for monitoring and debugging
   *
   * @returns Object with lock usage statistics
   */
  getMetrics() {
    return {
      ...this.metrics,
      currentlyHeld: this.heldLocks.size
    };
  }
}
