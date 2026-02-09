/**
 * SessionIdentity - Unique session identification for MCP server instances
 *
 * Each MCP server process gets a unique session ID based on PID + startup time.
 * Used to isolate git worktrees per session, preventing staging/branch conflicts
 * when multiple Claude Code sessions work on the same GAS project.
 *
 * Session metadata stored at: ~/.auth/mcp-gas/sessions/{id}.json
 * Heartbeat: 60s interval, stale after 30min without heartbeat
 * Security: 0o600 files, 0o700 directories (matches LockManager pattern)
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { log } from './logger.js';

const SESSION_DIR = path.join(os.homedir(), '.auth', 'mcp-gas', 'sessions');
const HEARTBEAT_INTERVAL = 60 * 1000; // 60 seconds
const STALE_THRESHOLD = 30 * 60 * 1000; // 30 minutes

export interface SessionMetadata {
  id: string;
  pid: number;
  startupTime: number;
  hostname: string;
  lastHeartbeat: string;
}

export interface CleanupResult {
  session: string;
  action: 'cleaned' | 'preserved-with-warning';
  path?: string;
}

export class SessionIdentity {
  private static instance: SessionIdentity | null = null;

  readonly id: string;
  readonly pid: number;
  readonly startupTime: number;
  readonly metadataPath: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    this.pid = process.pid;
    this.startupTime = Date.now();
    this.id = `${this.pid}-${this.startupTime}`;
    this.metadataPath = path.join(SESSION_DIR, `${this.id}.json`);
  }

  /**
   * Initialize session identity (call once from index.ts)
   */
  static initialize(): SessionIdentity {
    if (SessionIdentity.instance) {
      return SessionIdentity.instance;
    }
    SessionIdentity.instance = new SessionIdentity();
    log.info(`[SESSION] Initialized session: ${SessionIdentity.instance.id}`);
    return SessionIdentity.instance;
  }

  /**
   * Get singleton instance (must call initialize() first)
   */
  static get(): SessionIdentity {
    if (!SessionIdentity.instance) {
      // Auto-initialize if not yet initialized (defensive)
      return SessionIdentity.initialize();
    }
    return SessionIdentity.instance;
  }

  /**
   * Start heartbeat to keep session metadata fresh
   */
  async startHeartbeat(): Promise<void> {
    await this.ensureSessionDir();
    await this.writeMetadata();

    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.writeMetadata();
      } catch (err) {
        log.warn(`[SESSION] Heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, HEARTBEAT_INTERVAL);

    // Don't prevent process exit
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }

    log.info(`[SESSION] Heartbeat started (${HEARTBEAT_INTERVAL / 1000}s interval)`);
  }

  /**
   * Clean up session worktrees, metadata, and stop heartbeat.
   * Worktrees with unmerged commits are preserved with warnings.
   * Metadata is only deleted after worktrees are cleaned.
   */
  async shutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Clean up worktrees BEFORE removing metadata (metadata helps stale cleanup find orphans)
    try {
      const { SessionWorktreeManager } = await import('./sessionWorktree.js');
      const worktreeManager = new SessionWorktreeManager(this.id);
      const worktrees = await worktreeManager.listAllWorktrees();

      for (const wt of worktrees) {
        const hasCommits = await SessionWorktreeManager.hasUnmergedCommits(
          wt.worktreePath,
          wt.mainRepoPath,
          `session/${this.id}`
        );

        if (hasCommits) {
          console.error(`⚠️  [SESSION] Session has unmerged work, preserving worktree`);
          console.error(`   Worktree: ${wt.worktreePath}`);
          console.error(`   To merge: git -C ${wt.mainRepoPath} merge --squash session/${this.id}`);
          console.error(`   To discard: git worktree remove ${wt.worktreePath}`);
          // Don't delete metadata so stale cleanup can find this later
          continue;
        }

        try {
          await worktreeManager.removeWorktreeByPath(wt.worktreePath, wt.mainRepoPath, this.id);
          log.info(`[SESSION] Removed session worktree: ${wt.worktreePath}`);
        } catch (err) {
          log.warn(`[SESSION] Could not remove worktree ${wt.worktreePath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      log.warn(`[SESSION] Could not clean up worktrees: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      await fs.unlink(this.metadataPath);
      log.info(`[SESSION] Session metadata cleaned up: ${this.id}`);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        log.warn(`[SESSION] Could not remove session metadata: ${err.message}`);
      }
    }
  }

  /**
   * Check if a process is alive using signal 0 probe
   */
  static isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      if (err.code === 'ESRCH') return false;
      if (err.code === 'EPERM') return true; // exists but no permission
      return true; // conservative: assume alive on unknown errors
    }
  }

  /**
   * Find stale sessions based on 3-tuple detection:
   * - Same hostname: PID not running
   * - Different hostname: no heartbeat for 30min
   */
  static async findStaleSessions(): Promise<SessionMetadata[]> {
    const stale: SessionMetadata[] = [];

    try {
      await fs.mkdir(SESSION_DIR, { recursive: true, mode: 0o700 });
      const files = await fs.readdir(SESSION_DIR);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const content = await fs.readFile(path.join(SESSION_DIR, file), 'utf-8');
          const metadata: SessionMetadata = JSON.parse(content);

          if (metadata.hostname === os.hostname()) {
            // Same host: check if PID is alive
            if (!SessionIdentity.isProcessAlive(metadata.pid)) {
              stale.push(metadata);
            }
          } else {
            // Different host: check heartbeat age
            const lastBeat = new Date(metadata.lastHeartbeat).getTime();
            if (Date.now() - lastBeat > STALE_THRESHOLD) {
              stale.push(metadata);
            }
          }
        } catch {
          // Skip unparseable files
        }
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        log.warn(`[SESSION] Error scanning sessions: ${err.message}`);
      }
    }

    return stale;
  }

  /**
   * Clean up stale sessions. Preserves worktrees with unmerged commits (warns only).
   */
  static async cleanupStaleSessions(): Promise<CleanupResult[]> {
    const staleSessions = await SessionIdentity.findStaleSessions();
    const results: CleanupResult[] = [];

    if (staleSessions.length === 0) return results;

    log.info(`[SESSION] Found ${staleSessions.length} stale session(s)`);

    // Lazy import to avoid circular dependency
    const { SessionWorktreeManager } = await import('./sessionWorktree.js');

    for (const session of staleSessions) {
      const worktreeManager = new SessionWorktreeManager(session.id);
      const worktrees = await worktreeManager.listAllWorktrees();
      let hasPreserved = false;
      let preservedPath: string | undefined;

      for (const wt of worktrees) {
        const hasCommits = await SessionWorktreeManager.hasUnmergedCommits(
          wt.worktreePath,
          wt.mainRepoPath,
          `session/${session.id}`
        );

        if (hasCommits) {
          console.error(`⚠️  [SESSION] Stale session ${session.id} has unmerged work`);
          console.error(`   Worktree preserved at: ${wt.worktreePath}`);
          console.error(`   To merge: git -C ${wt.mainRepoPath} merge --squash session/${session.id}`);
          console.error(`   To discard: git worktree remove ${wt.worktreePath}`);
          hasPreserved = true;
          preservedPath = wt.worktreePath;
          continue;
        }

        // No unmerged work — safe to remove
        try {
          await worktreeManager.removeWorktreeByPath(wt.worktreePath, wt.mainRepoPath, session.id);
          log.info(`[SESSION] Removed stale worktree: ${wt.worktreePath}`);
        } catch (err) {
          log.warn(`[SESSION] Failed to remove worktree ${wt.worktreePath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (!hasPreserved) {
        // Safe to remove session metadata
        try {
          await fs.unlink(path.join(SESSION_DIR, `${session.id}.json`));
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            log.warn(`[SESSION] Could not remove session file: ${err.message}`);
          }
        }
        results.push({ session: session.id, action: 'cleaned' });
      } else {
        results.push({ session: session.id, action: 'preserved-with-warning', path: preservedPath });
      }
    }

    return results;
  }

  // --- Private helpers ---

  private async ensureSessionDir(): Promise<void> {
    await fs.mkdir(SESSION_DIR, { recursive: true, mode: 0o700 });
  }

  private async writeMetadata(): Promise<void> {
    const metadata: SessionMetadata = {
      id: this.id,
      pid: this.pid,
      startupTime: this.startupTime,
      hostname: os.hostname(),
      lastHeartbeat: new Date().toISOString(),
    };
    await fs.writeFile(this.metadataPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
  }
}
