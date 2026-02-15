/**
 * SessionWorktreeManager - Git worktree management for session isolation
 *
 * Each MCP server session gets its own git worktree to prevent staging/branch
 * conflicts when multiple sessions work on the same GAS project.
 *
 * Worktree location: ~/.mcp-gas/worktrees/{scriptId}/{sessionId}/
 * - External to project directory (follows git cardinal rule: never nest worktrees)
 * - Matches ~/.auth/mcp-gas/ convention
 *
 * First-write sync: On first write to a project, creates worktree and pulls ALL
 * files from GAS remote. Subsequent writes go to the worktree directly.
 *
 * Conflict detection: Stores base hashes at session init. Compares before writes
 * to warn about external modifications.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { log } from './logger.js';
import { computeGitSha1 } from './hashUtils.js';
import { LocalFileManager } from './localFileManager.js';
import { SessionIdentity } from './sessionIdentity.js';
import type { GASFile } from '../api/gasTypes.js';
import type { GASClient } from '../api/gasClient.js';

const WORKTREE_BASE = path.join(os.homedir(), '.mcp-gas', 'worktrees');

export interface SessionWorktreeInfo {
  worktreePath: string;
  mainRepoPath: string;
  branch: string;
  scriptId: string;
}

export class SessionWorktreeManager {
  private sessionId: string;
  // Static: shared across all instances within same process (same session)
  private static sessionBaseHashes: Map<string, Record<string, string>> = new Map();
  // In-process lock to prevent concurrent ensureWorktree for same scriptId
  private static creationLocks: Map<string, Promise<string>> = new Map();

  constructor(sessionId?: string) {
    this.sessionId = sessionId || SessionIdentity.get().id;
  }

  /**
   * Ensure a session worktree exists for the given project.
   * Creates one on first call (lazy init on first write).
   *
   * @param scriptId - GAS project ID
   * @param gasClient - GAS client for fetching project content
   * @param accessToken - OAuth token (passed through, not cached)
   * @param prefetchedFiles - Optional: reuse files already fetched by caller
   * @returns Absolute path to session worktree
   */
  async ensureWorktree(
    scriptId: string,
    gasClient: GASClient,
    accessToken: string,
    prefetchedFiles?: GASFile[]
  ): Promise<string> {
    const worktreePath = this.getWorktreePathForScript(scriptId);

    // Fast path: already exists — return
    if (await this.worktreeExists(worktreePath)) {
      return worktreePath;
    }

    // Serialize creation per scriptId to prevent concurrent creates
    const existingLock = SessionWorktreeManager.creationLocks.get(scriptId);
    if (existingLock) {
      log.info(`[SESSION-WT] Waiting for concurrent worktree creation for ${scriptId}`);
      return existingLock;
    }

    const createPromise = this.doCreateWorktree(scriptId, gasClient, accessToken, prefetchedFiles);
    SessionWorktreeManager.creationLocks.set(scriptId, createPromise);

    try {
      return await createPromise;
    } finally {
      SessionWorktreeManager.creationLocks.delete(scriptId);
    }
  }

  /**
   * Internal: actually creates the worktree (called under lock)
   */
  private async doCreateWorktree(
    scriptId: string,
    gasClient: GASClient,
    accessToken: string,
    prefetchedFiles?: GASFile[]
  ): Promise<string> {
    const mainRepoPath = await this.getMainRepoPath(scriptId);
    const worktreePath = this.getWorktreePathForScript(scriptId);

    // Double-check after acquiring lock
    if (await this.worktreeExists(worktreePath)) {
      return worktreePath;
    }

    log.info(`[SESSION-WT] Creating session worktree for ${scriptId}`);

    // 0. Ensure worktree parent directory exists
    const worktreeBase = path.join(WORKTREE_BASE, scriptId);
    await fs.mkdir(worktreeBase, { recursive: true, mode: 0o700 });

    // 1. Ensure main repo exists and has at least one commit
    await this.ensureMainRepoReady(mainRepoPath);

    // 2. Create git worktree with session branch
    const branchName = `session/${this.sessionId}`;
    try {
      await execGitSpawn(['worktree', 'add', worktreePath, '-b', branchName], mainRepoPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('EEXIST') || msg.includes('already exists') || msg.includes('already checked out')) {
        log.warn(`[SESSION-WT] Stale worktree detected, cleaning up and retrying: ${msg}`);
        try { await fs.rm(worktreePath, { recursive: true, force: true }); } catch {}
        try { await execGitSpawn(['branch', '-D', branchName], mainRepoPath); } catch {}
        try { await execGitSpawn(['worktree', 'prune'], mainRepoPath); } catch {}
        // Retry once
        await execGitSpawn(['worktree', 'add', worktreePath, '-b', branchName], mainRepoPath);
      } else {
        throw err;
      }
    }
    log.info(`[SESSION-WT] Created worktree at ${worktreePath} (branch: ${branchName})`);

    // Steps 3-5 wrapped in try/catch: if anything fails after worktree creation,
    // roll back to prevent leaving a partially initialized worktree that passes
    // the worktreeExists() check on subsequent calls.
    try {
      // 3. Pull ALL files from GAS remote
      const files = prefetchedFiles || await gasClient.getProjectContent(scriptId, accessToken);
      files.sort((a, b) => a.name.localeCompare(b.name));

      // 4. Write files and store base hashes for conflict detection
      const baseHashes: Record<string, string> = {};

      for (const file of files) {
        const source = file.source || '';
        baseHashes[file.name] = computeGitSha1(source);

        const fileExtension = LocalFileManager.getFileExtensionFromName(file.name);
        const localName = file.name + fileExtension;
        const filePath = path.join(worktreePath, localName);

        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, source, 'utf-8');
      }

      // 5. Commit initial state
      await execGitSpawn(['add', '-A'], worktreePath);
      await execGitSpawn(['commit', '-m', 'Initial sync from GAS remote'], worktreePath);

      // Only store base hashes after successful commit (atomic with worktree)
      SessionWorktreeManager.sessionBaseHashes.set(scriptId, baseHashes);

      log.info(`[SESSION-WT] Worktree initialized with ${files.length} file(s)`);
      return worktreePath;

    } catch (err) {
      // Rollback: remove the partially initialized worktree
      log.error(`[SESSION-WT] Worktree initialization failed, rolling back: ${err instanceof Error ? err.message : String(err)}`);
      try {
        await this.removeWorktreeByPath(worktreePath, mainRepoPath, this.sessionId);
      } catch (rollbackErr) {
        log.warn(`[SESSION-WT] Rollback cleanup failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`);
      }
      throw err;
    }
  }

  /**
   * Get worktree path for a project (does NOT create it)
   * Returns null if no worktree has been initialized for this session+project.
   * Checks in-memory cache first (fast path), falls back to filesystem check.
   */
  getWorktreePath(scriptId: string): string | null {
    if (SessionWorktreeManager.sessionBaseHashes.has(scriptId)) {
      return this.getWorktreePathForScript(scriptId);
    }
    return null;
  }

  /**
   * Get worktree path even if not yet initialized (for checking existence)
   */
  getWorktreePathForScript(scriptId: string): string {
    return path.join(WORKTREE_BASE, scriptId, this.sessionId);
  }

  /**
   * Remove a worktree for this session
   */
  async removeWorktree(scriptId: string): Promise<void> {
    const mainRepoPath = await this.getMainRepoPath(scriptId);
    const worktreePath = this.getWorktreePathForScript(scriptId);

    await this.removeWorktreeByPath(worktreePath, mainRepoPath, this.sessionId);
    SessionWorktreeManager.sessionBaseHashes.delete(scriptId);
  }

  /**
   * Remove a specific worktree by path (used by stale cleanup)
   */
  async removeWorktreeByPath(worktreePath: string, mainRepoPath: string, sessionId: string): Promise<void> {
    const branchName = `session/${sessionId}`;

    try {
      await execGitSpawn(['worktree', 'remove', '--force', worktreePath], mainRepoPath);
    } catch (err) {
      // If worktree dir is already gone, just prune
      log.warn(`[SESSION-WT] worktree remove failed, trying prune: ${err instanceof Error ? err.message : String(err)}`);
      try {
        await execGitSpawn(['worktree', 'prune'], mainRepoPath);
      } catch {
        // Best effort
      }
    }

    // Delete the session branch
    try {
      await execGitSpawn(['branch', '-D', branchName], mainRepoPath);
    } catch {
      // Branch may already be deleted
    }

    // Clean up directory if still present
    try {
      await fs.rm(worktreePath, { recursive: true, force: true });
    } catch {
      // Already gone
    }

    log.info(`[SESSION-WT] Removed worktree and branch: ${branchName}`);
  }

  /**
   * List all worktrees for this session across all projects
   */
  async listAllWorktrees(): Promise<SessionWorktreeInfo[]> {
    const results: SessionWorktreeInfo[] = [];

    try {
      const scriptIds = await fs.readdir(WORKTREE_BASE);

      for (const scriptId of scriptIds) {
        const sessionDir = path.join(WORKTREE_BASE, scriptId, this.sessionId);
        const exists = await fs.access(sessionDir).then(() => true).catch(() => false);

        if (exists) {
          const mainRepoPath = await this.getMainRepoPath(scriptId);
          results.push({
            worktreePath: sessionDir,
            mainRepoPath,
            branch: `session/${this.sessionId}`,
            scriptId,
          });
        }
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        log.warn(`[SESSION-WT] Error listing worktrees: ${err.message}`);
      }
    }

    return results;
  }

  /**
   * Get base hashes for conflict detection
   */
  getBaseHashes(scriptId: string): Record<string, string> | undefined {
    return SessionWorktreeManager.sessionBaseHashes.get(scriptId);
  }

  /**
   * Check for external modifications since session start.
   * Returns warning message if conflict detected, null otherwise.
   */
  checkConflict(scriptId: string, filename: string, currentRemoteSource: string): string | null {
    const baseHashes = SessionWorktreeManager.sessionBaseHashes.get(scriptId);
    if (!baseHashes) return null;

    const baseHash = baseHashes[filename];
    if (!baseHash) return null; // New file since session start

    const currentRemoteHash = computeGitSha1(currentRemoteSource);
    if (currentRemoteHash === baseHash) return null;

    return (
      `${filename} was modified externally since session start. ` +
      `Base: ${baseHash.slice(0, 8)}, Current: ${currentRemoteHash.slice(0, 8)}. ` +
      `Your write will overwrite external changes.`
    );
  }

  /**
   * Update base hash after a successful write (so subsequent writes don't re-warn)
   */
  updateBaseHash(scriptId: string, filename: string, newSource: string): void {
    const baseHashes = SessionWorktreeManager.sessionBaseHashes.get(scriptId);
    if (baseHashes) {
      baseHashes[filename] = computeGitSha1(newSource);
    }
  }

  /**
   * Check if a worktree branch has commits not in main
   */
  static async hasUnmergedCommits(
    worktreePath: string,
    mainRepoPath: string,
    branchName: string
  ): Promise<boolean> {
    try {
      // Find the default branch
      let defaultBranch = 'main';
      try {
        await execGitSpawn(['show-ref', '--verify', '--quiet', 'refs/heads/main'], mainRepoPath);
      } catch {
        try {
          await execGitSpawn(['show-ref', '--verify', '--quiet', 'refs/heads/master'], mainRepoPath);
          defaultBranch = 'master';
        } catch {
          // Neither exists, use main as default
        }
      }

      const output = await execGitSpawn(
        ['rev-list', `${defaultBranch}..${branchName}`, '--count'],
        mainRepoPath
      );
      const count = parseInt(output.trim(), 10);
      // More than 1 commit means user made changes (1 = initial sync commit)
      return count > 1;
    } catch {
      // If we can't determine, be conservative: assume there are unmerged commits
      return true;
    }
  }

  // --- Private helpers ---

  private async getMainRepoPath(scriptId: string): Promise<string> {
    return LocalFileManager.getProjectDirectory(`project-${scriptId}`);
  }

  private async worktreeExists(worktreePath: string): Promise<boolean> {
    try {
      const gitFile = path.join(worktreePath, '.git');
      await fs.access(gitFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure the main repo exists, is initialized, and has at least one commit.
   * Git worktree requires the repo to have commits.
   */
  private async ensureMainRepoReady(mainRepoPath: string): Promise<void> {
    await fs.mkdir(mainRepoPath, { recursive: true });

    const { ensureGitInitialized } = await import('./gitInit.js');
    await ensureGitInitialized(mainRepoPath);

    // Prune stale worktree references from previous sessions
    try {
      await execGitSpawn(['worktree', 'prune'], mainRepoPath);
    } catch {
      // Non-fatal: prune may fail if no stale refs
    }

    // Check if repo has commits
    try {
      await execGitSpawn(['rev-parse', '--verify', 'HEAD'], mainRepoPath);
    } catch {
      // No commits — create an initial empty commit
      await execGitSpawn(['commit', '--allow-empty', '-m', 'Initial commit'], mainRepoPath);
      log.info(`[SESSION-WT] Created initial commit in ${mainRepoPath}`);
    }
  }
}

/**
 * Execute git command via spawn (prevents command injection)
 * Shared utility matching the pattern in GitFeatureTool.
 */
export function execGitSpawn(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    git.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    git.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    git.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Git command failed with code ${code}`));
      }
    });

    git.on('error', (error: Error) => {
      reject(error);
    });
  });
}
