/**
 * WorktreeLockManager - Configuration-level locking for worktree operations
 *
 * Provides atomic read/write access to gas-config.json worktrees section
 * with cross-process safety using filesystem locking.
 *
 * Key differences from the per-project LockManager:
 * - Locks the config file, not individual projects
 * - Longer timeout (15 min) for complex worktree operations
 * - Heartbeat refresh during long operations
 * - Atomic write pattern (tmp → rename) with backup
 *
 * Architecture:
 * - Single lock for all worktree config operations
 * - Uses .lock file adjacent to gas-config.json
 * - JSON lock content with PID, hostname, operation, expiry
 * - Automatic stale lock detection based on PID + timestamp
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { WorktreeLock, WorktreesConfig, WorktreeEntry } from '../../types/worktreeTypes.js';

// Lock timeout (15 minutes for complex operations)
const DEFAULT_LOCK_TIMEOUT = 15 * 60 * 1000;

// Retry interval for lock acquisition polling
const LOCK_RETRY_INTERVAL = 200;

// Stale lock threshold (30 minutes)
const STALE_LOCK_MAX_AGE = 30 * 60 * 1000;

// Heartbeat refresh interval (every 60 seconds)
const HEARTBEAT_INTERVAL = 60 * 1000;

/**
 * Lock file content
 */
interface LockFileContent {
  holder: string;       // "pid@hostname"
  pid: number;
  hostname: string;
  acquiredAt: string;   // ISO timestamp
  expiresAt: string;    // ISO timestamp
  operation: string;
  heartbeat?: string;   // Last heartbeat ISO timestamp
}

/**
 * Error thrown when lock acquisition times out
 */
export class WorktreeLockTimeoutError extends Error {
  constructor(
    public readonly timeout: number,
    public readonly operation: string,
    public readonly currentHolder?: LockFileContent
  ) {
    const holderInfo = currentHolder
      ? ` (held by PID ${currentHolder.pid} on ${currentHolder.hostname} for ${currentHolder.operation})`
      : '';
    super(`Failed to acquire worktree config lock after ${timeout}ms${holderInfo}`);
    this.name = 'WorktreeLockTimeoutError';
  }
}

/**
 * WorktreeLockManager singleton class
 *
 * Provides config-level locking and atomic read/write for worktrees section
 */
export class WorktreeLockManager {
  private static instance: WorktreeLockManager;
  private configPath: string | null = null;
  private lockPath: string | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isLockHeld = false;
  private shutdownHandlersRegistered = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): WorktreeLockManager {
    if (!WorktreeLockManager.instance) {
      WorktreeLockManager.instance = new WorktreeLockManager();
    }
    return WorktreeLockManager.instance;
  }

  /**
   * Reset singleton instance (for testing only)
   */
  static resetInstance(): void {
    if (WorktreeLockManager.instance) {
      WorktreeLockManager.instance.stopHeartbeat();
    }
    WorktreeLockManager.instance = undefined as any;
  }

  /**
   * Initialize with config path
   */
  async initialize(configPath: string): Promise<void> {
    this.configPath = configPath;
    this.lockPath = configPath + '.worktree.lock';

    // Register shutdown handlers to clean up locks on process exit
    this.registerShutdownHandlers();

    console.error(`🔧 [WORKTREE-LOCK] Initialized with config: ${configPath}`);
  }

  /**
   * Register process shutdown handlers to release locks
   */
  private registerShutdownHandlers(): void {
    if (this.shutdownHandlersRegistered) return;

    const cleanup = async () => {
      if (this.isLockHeld) {
        console.error(`🧹 [WORKTREE-LOCK] Releasing lock on process exit`);
        await this.releaseLock();
      }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', () => {
      // Synchronous cleanup on exit - can't await
      if (this.isLockHeld && this.lockPath) {
        try {
          require('fs').unlinkSync(this.lockPath);
          console.error(`🧹 [WORKTREE-LOCK] Released lock synchronously on exit`);
        } catch (e) {
          // Ignore errors during exit
        }
      }
    });

    this.shutdownHandlersRegistered = true;
  }

  /**
   * Get lock file path (ensures initialized)
   */
  private getLockPath(): string {
    if (!this.lockPath) {
      throw new Error('WorktreeLockManager not initialized. Call initialize() first.');
    }
    return this.lockPath;
  }

  /**
   * Get config file path (ensures initialized)
   */
  private getConfigPath(): string {
    if (!this.configPath) {
      throw new Error('WorktreeLockManager not initialized. Call initialize() first.');
    }
    return this.configPath;
  }

  /**
   * Check if process is running
   */
  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: any) {
      return error.code !== 'ESRCH';
    }
  }

  /**
   * Check if lock is stale
   */
  private isLockStale(lockContent: LockFileContent): boolean {
    // Different hostname - rely on age
    if (lockContent.hostname !== os.hostname()) {
      const age = Date.now() - new Date(lockContent.acquiredAt).getTime();
      return age > STALE_LOCK_MAX_AGE;
    }

    // Same hostname - check if process is running
    if (!this.isProcessRunning(lockContent.pid)) {
      return true;
    }

    // Check expiry
    if (new Date(lockContent.expiresAt).getTime() < Date.now()) {
      return true;
    }

    return false;
  }

  /**
   * Read lock file content
   */
  private async readLockFile(): Promise<LockFileContent | null> {
    try {
      const content = await fs.readFile(this.getLockPath(), 'utf-8');
      return JSON.parse(content);
    } catch (error: any) {
      if (error.code === 'ENOENT') return null;
      console.error(`Failed to read lock file:`, error);
      return null;
    }
  }

  /**
   * Write lock file with exclusive flag
   */
  private async writeLockFile(content: LockFileContent): Promise<boolean> {
    try {
      await fs.writeFile(
        this.getLockPath(),
        JSON.stringify(content, null, 2),
        { mode: 0o600, flag: 'wx' }
      );
      return true;
    } catch (error: any) {
      if (error.code === 'EEXIST') return false;
      throw error;
    }
  }

  /**
   * Start heartbeat refresh
   *
   * Note: Heartbeat is best-effort. If we've lost the lock due to timeout,
   * we detect it here and stop the heartbeat to prevent overwriting
   * another process's legitimate lock.
   */
  private startHeartbeat(operation: string): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(async () => {
      try {
        const lockContent = await this.readLockFile();

        // Verify we still own the lock (same PID AND hostname)
        if (!lockContent ||
            lockContent.pid !== process.pid ||
            lockContent.hostname !== os.hostname()) {
          // We've lost the lock - stop heartbeat to prevent overwriting new owner
          console.error(`⚠️  [WORKTREE-LOCK] Lost lock during heartbeat - stopping refresh`);
          this.stopHeartbeat();
          this.isLockHeld = false;
          return;
        }

        // Check if our lock was detected as stale and removed
        if (this.isLockStale(lockContent)) {
          console.error(`⚠️  [WORKTREE-LOCK] Our lock expired - stopping heartbeat`);
          this.stopHeartbeat();
          this.isLockHeld = false;
          return;
        }

        // Safe to update - we verified we still own it
        lockContent.heartbeat = new Date().toISOString();
        lockContent.expiresAt = new Date(Date.now() + DEFAULT_LOCK_TIMEOUT).toISOString();
        await fs.writeFile(this.getLockPath(), JSON.stringify(lockContent, null, 2), { mode: 0o600 });
        console.error(`💓 [WORKTREE-LOCK] Heartbeat refreshed for ${operation}`);
      } catch (error) {
        console.error(`⚠️  [WORKTREE-LOCK] Heartbeat failed:`, error);
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Stop heartbeat refresh
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Acquire config lock
   *
   * @param operation - Operation name for debugging
   * @param timeout - Timeout in milliseconds (default: 15 min)
   */
  async acquireLock(
    operation: string,
    timeout: number = DEFAULT_LOCK_TIMEOUT
  ): Promise<void> {
    const lockPath = this.getLockPath();
    const now = new Date();
    const lockContent: LockFileContent = {
      holder: `${process.pid}@${os.hostname()}`,
      pid: process.pid,
      hostname: os.hostname(),
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + timeout).toISOString(),
      operation
    };

    const startTime = Date.now();
    const maxAttempts = Math.ceil(timeout / LOCK_RETRY_INTERVAL);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Try to create lock file exclusively
      if (await this.writeLockFile(lockContent)) {
        this.isLockHeld = true;
        this.startHeartbeat(operation);
        console.error(`🔒 [WORKTREE-LOCK] Acquired lock for: ${operation}`);
        return;
      }

      // Lock exists, check if stale
      const existing = await this.readLockFile();
      if (existing && this.isLockStale(existing)) {
        console.error(`⚠️  [WORKTREE-LOCK] Removing stale lock from PID ${existing.pid}`);
        try {
          await fs.unlink(lockPath);
          continue; // Retry immediately
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            console.error(`Failed to remove stale lock:`, error);
          }
        }
      }

      // Wait and retry
      if (attempt === 0 && existing) {
        console.error(`⏳ [WORKTREE-LOCK] Waiting for lock (held by ${existing.holder} for ${existing.operation})...`);
      }

      await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL));
    }

    // Timeout exceeded
    const existing = await this.readLockFile();
    throw new WorktreeLockTimeoutError(timeout, operation, existing || undefined);
  }

  /**
   * Release config lock
   */
  async releaseLock(): Promise<void> {
    this.stopHeartbeat();

    if (!this.isLockHeld) return;

    try {
      // Verify we own the lock before deleting
      const existing = await this.readLockFile();
      if (existing && existing.pid === process.pid && existing.hostname === os.hostname()) {
        await fs.unlink(this.getLockPath());
        console.error(`🔓 [WORKTREE-LOCK] Released lock`);
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`⚠️  [WORKTREE-LOCK] Failed to release lock:`, error);
      }
    } finally {
      this.isLockHeld = false;
    }
  }

  /**
   * Execute operation with lock held
   *
   * Automatically acquires and releases lock, handles errors gracefully.
   */
  async withLock<T>(
    operation: string,
    fn: () => Promise<T>,
    timeout?: number
  ): Promise<T> {
    await this.acquireLock(operation, timeout);
    try {
      return await fn();
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Read worktrees config (with optional lock)
   *
   * @param withLock - Acquire lock before reading (default: false for read-only)
   */
  async readWorktreesConfig(withLock = false): Promise<WorktreesConfig> {
    const read = async (): Promise<WorktreesConfig> => {
      try {
        const configPath = this.getConfigPath();
        const content = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(content);
        return config.worktrees || { worktrees: {} };
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          return { worktrees: {} };
        }

        // Try backup file
        try {
          const backupPath = this.getConfigPath() + '.bak';
          const content = await fs.readFile(backupPath, 'utf-8');
          const config = JSON.parse(content);
          console.error(`⚠️  [WORKTREE-LOCK] Recovered from backup file`);
          return config.worktrees || { worktrees: {} };
        } catch {
          console.error(`❌ [WORKTREE-LOCK] Failed to read config:`, error);
          return { worktrees: {} };
        }
      }
    };

    if (withLock) {
      return this.withLock('readWorktreesConfig', read);
    }
    return read();
  }

  /**
   * Write worktrees config atomically
   *
   * Uses tmp file → rename pattern for atomic writes.
   * Creates backup before writing.
   * Requires lock to be held.
   */
  async writeWorktreesConfig(worktreesConfig: WorktreesConfig): Promise<void> {
    if (!this.isLockHeld) {
      throw new Error('Cannot write config without holding lock');
    }

    const configPath = this.getConfigPath();
    const tmpPath = configPath + '.tmp';
    const backupPath = configPath + '.bak';

    try {
      // Read full config
      let fullConfig: any = {};
      try {
        const content = await fs.readFile(configPath, 'utf-8');
        fullConfig = JSON.parse(content);
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          console.error(`⚠️  [WORKTREE-LOCK] Error reading config for update:`, error);
        }
      }

      // Create backup of current config
      try {
        await fs.copyFile(configPath, backupPath);
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          console.error(`⚠️  [WORKTREE-LOCK] Failed to create backup:`, error);
        }
      }

      // Update worktrees section
      fullConfig.worktrees = worktreesConfig;

      // Write to tmp file
      await fs.writeFile(tmpPath, JSON.stringify(fullConfig, null, 2), { mode: 0o600 });

      // Atomic rename
      await fs.rename(tmpPath, configPath);

      console.error(`💾 [WORKTREE-LOCK] Config written atomically`);
    } catch (error) {
      // Cleanup tmp file if it exists
      try {
        await fs.unlink(tmpPath);
      } catch {}
      throw error;
    }
  }

  /**
   * Update a single worktree entry
   *
   * Convenience method that reads, updates, and writes atomically.
   */
  async updateWorktreeEntry(
    scriptId: string,
    updates: Partial<WorktreeEntry>
  ): Promise<void> {
    await this.withLock('updateWorktreeEntry', async () => {
      const config = await this.readWorktreesConfig();

      if (!config.worktrees[scriptId]) {
        throw new Error(`Worktree ${scriptId} not found`);
      }

      config.worktrees[scriptId] = {
        ...config.worktrees[scriptId],
        ...updates
      };

      await this.writeWorktreesConfig(config);
    });
  }

  /**
   * Add a new worktree entry
   */
  async addWorktreeEntry(entry: WorktreeEntry): Promise<void> {
    await this.withLock('addWorktreeEntry', async () => {
      const config = await this.readWorktreesConfig();
      config.worktrees[entry.scriptId] = entry;
      await this.writeWorktreesConfig(config);
    });
  }

  /**
   * Remove a worktree entry
   */
  async removeWorktreeEntry(scriptId: string): Promise<void> {
    await this.withLock('removeWorktreeEntry', async () => {
      const config = await this.readWorktreesConfig();
      delete config.worktrees[scriptId];
      await this.writeWorktreesConfig(config);
    });
  }

  /**
   * Get a worktree entry by scriptId
   */
  async getWorktreeEntry(scriptId: string): Promise<WorktreeEntry | null> {
    const config = await this.readWorktreesConfig();
    return config.worktrees[scriptId] || null;
  }

  /**
   * Find worktrees by parent scriptId
   */
  async findByParent(parentScriptId: string): Promise<WorktreeEntry[]> {
    const config = await this.readWorktreesConfig();
    return Object.values(config.worktrees).filter(
      wt => wt.parentScriptId === parentScriptId
    );
  }

  /**
   * Find worktrees by state
   */
  async findByState(state: string | string[]): Promise<WorktreeEntry[]> {
    const states = Array.isArray(state) ? state : [state];
    const config = await this.readWorktreesConfig();
    return Object.values(config.worktrees).filter(
      wt => states.includes(wt.state)
    );
  }

  /**
   * Cleanup stale locks on startup
   */
  async cleanupStaleLocks(): Promise<void> {
    try {
      const existing = await this.readLockFile();
      if (existing && this.isLockStale(existing)) {
        console.error(`🧹 [WORKTREE-LOCK] Removing stale lock from PID ${existing.pid}`);
        await fs.unlink(this.getLockPath());
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`⚠️  [WORKTREE-LOCK] Failed to cleanup stale locks:`, error);
      }
    }
  }

  /**
   * Get lock status (for debugging)
   */
  async getLockStatus(): Promise<{ locked: boolean; info?: LockFileContent }> {
    const info = await this.readLockFile();
    return {
      locked: info !== null && !this.isLockStale(info),
      info: info || undefined
    };
  }
}
