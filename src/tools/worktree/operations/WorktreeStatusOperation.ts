/**
 * WorktreeStatusOperation - Get detailed worktree status with divergence info
 *
 * Steps:
 * 1. Get worktree entry
 * 2. Get parent project info
 * 3. Calculate file divergence using baseHashes
 * 4. Get git status (uncommitted, ahead/behind)
 * 5. Determine if mergeable
 */

import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { GASClient, GASFile } from '../../../api/gasClient.js';
import { WorktreeLockManager } from '../WorktreeLockManager.js';
import { WorktreeStateManager } from '../WorktreeStateManager.js';
import { computeGitSha1 } from '../../../utils/hashUtils.js';
import {
  normalizeFileName,
  type WorktreeStatusInput,
  type WorktreeStatusResult,
  type WorktreeError,
  type WorktreeDivergence,
  type WorktreeGitStatus,
  type WorktreeInfo
} from '../../../types/worktreeTypes.js';

/**
 * Execute git command safely using spawn with array arguments
 */
function execGitCommand(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    git.stdout.on('data', (data) => { stdout += data.toString(); });
    git.stderr.on('data', (data) => { stderr += data.toString(); });

    git.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Git command failed with exit code ${code}`));
      }
    });

    git.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Check if directory exists
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Get parent git path
 */
function getParentGitPath(parentScriptId: string): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
  return path.join(homeDir, 'gas-repos', `project-${parentScriptId}`);
}

/**
 * WorktreeStatusOperation class
 */
export class WorktreeStatusOperation {
  private gasClient: GASClient;
  private lockManager: WorktreeLockManager;
  private stateManager: WorktreeStateManager;

  constructor(gasClient: GASClient) {
    this.gasClient = gasClient;
    this.lockManager = WorktreeLockManager.getInstance();
    this.stateManager = WorktreeStateManager.getInstance();
  }

  /**
   * Execute the status operation
   */
  async execute(
    params: WorktreeStatusInput,
    accessToken: string
  ): Promise<WorktreeStatusResult | WorktreeError> {
    const { worktreeScriptId } = params;

    console.error(`🔧 [WORKTREE-STATUS] Getting status for ${worktreeScriptId}`);

    // Initialize API client
    await this.gasClient.initializeClient(accessToken);

    // Step 1: Get worktree entry
    const entry = await this.stateManager.getEntry(worktreeScriptId);
    if (!entry) {
      return {
        success: false,
        error: 'WORKTREE_NOT_FOUND',
        message: `Worktree ${worktreeScriptId} not found`
      };
    }

    // Step 2: Get parent project info
    let parentName: string | undefined;
    try {
      const parentProject = await this.gasClient.getProject(entry.parentScriptId, accessToken);
      parentName = parentProject.title;
    } catch (error) {
      console.error(`⚠️  [WORKTREE-STATUS] Failed to get parent project info`);
    }

    // Step 3: Calculate file divergence
    const divergence = await this.calculateDivergence(entry, accessToken);

    // Step 4: Get git status
    const gitStatus = await this.getGitStatus(entry);

    // Step 5: Determine if mergeable
    const mergeable = divergence.conflicts.length === 0;

    // Build worktree info
    const worktreeInfo: WorktreeInfo = {
      scriptId: entry.scriptId,
      parentScriptId: entry.parentScriptId,
      branch: entry.branch,
      localPath: entry.localPath,
      state: entry.state,
      containerId: entry.containerId,
      containerType: entry.containerType,
      claimedBy: entry.claimedBy,
      claimedAt: entry.claimedAt,
      createdAt: entry.createdAt
    };

    return {
      worktree: worktreeInfo,
      parent: {
        scriptId: entry.parentScriptId,
        name: parentName
      },
      divergence,
      mergeable,
      gitStatus
    };
  }

  /**
   * Calculate file divergence between worktree and parent
   */
  private async calculateDivergence(
    entry: { scriptId: string; parentScriptId: string; localPath: string; baseHashes?: Record<string, string> },
    accessToken: string
  ): Promise<WorktreeDivergence> {
    const divergence: WorktreeDivergence = {
      filesOnlyInWorktree: [],
      filesOnlyInParent: [],
      filesModifiedInWorktree: [],
      filesModifiedInParent: [],
      conflicts: []
    };

    try {
      // Get current files from worktree GAS
      const worktreeFiles = await this.gasClient.getProjectContent(entry.scriptId, accessToken);
      const worktreeFileMap = new Map<string, string>();
      for (const file of worktreeFiles) {
        const name = normalizeFileName(file.name, file.type);
        worktreeFileMap.set(name, computeGitSha1(file.source || ''));
      }

      // Get current files from parent GAS
      const parentFiles = await this.gasClient.getProjectContent(entry.parentScriptId, accessToken);
      const parentFileMap = new Map<string, string>();
      for (const file of parentFiles) {
        const name = normalizeFileName(file.name, file.type);
        parentFileMap.set(name, computeGitSha1(file.source || ''));
      }

      // Get base hashes (state at worktree creation)
      const baseHashes = entry.baseHashes || {};

      // All file names
      const allFiles = new Set([...worktreeFileMap.keys(), ...parentFileMap.keys()]);

      for (const fileName of allFiles) {
        const worktreeHash = worktreeFileMap.get(fileName);
        const parentHash = parentFileMap.get(fileName);
        const baseHash = baseHashes[fileName];

        // File only in worktree
        if (worktreeHash && !parentHash) {
          if (!baseHash) {
            // New file added in worktree
            divergence.filesOnlyInWorktree.push(fileName);
          } else {
            // File was deleted in parent after worktree creation
            divergence.filesOnlyInParent.push(fileName);
          }
          continue;
        }

        // File only in parent
        if (!worktreeHash && parentHash) {
          if (!baseHash) {
            // New file added in parent
            divergence.filesOnlyInParent.push(fileName);
          } else {
            // File was deleted in worktree after creation
            divergence.filesOnlyInWorktree.push(fileName);
          }
          continue;
        }

        // File exists in both - check for modifications
        if (worktreeHash && parentHash) {
          const worktreeModified = baseHash && worktreeHash !== baseHash;
          const parentModified = baseHash && parentHash !== baseHash;

          if (worktreeModified && parentModified) {
            // Both modified - potential conflict
            if (worktreeHash !== parentHash) {
              divergence.conflicts.push(fileName);
            }
            // Same change in both - no conflict
          } else if (worktreeModified) {
            divergence.filesModifiedInWorktree.push(fileName);
          } else if (parentModified) {
            divergence.filesModifiedInParent.push(fileName);
          }
        }
      }
    } catch (error: any) {
      console.error(`⚠️  [WORKTREE-STATUS] Failed to calculate divergence:`, error);
    }

    return divergence;
  }

  /**
   * Get git status for the worktree
   */
  private async getGitStatus(
    entry: { localPath: string; branch: string; parentScriptId: string }
  ): Promise<WorktreeGitStatus> {
    const status: WorktreeGitStatus = {
      uncommittedChanges: 0,
      aheadOfMain: 0,
      behindMain: 0
    };

    const localPath = entry.localPath;
    const parentGitPath = getParentGitPath(entry.parentScriptId);

    if (!await directoryExists(localPath)) {
      return status;
    }

    try {
      // Count uncommitted changes
      const statusOutput = await execGitCommand(['status', '--porcelain'], localPath);
      status.uncommittedChanges = statusOutput.split('\n').filter(line => line.trim()).length;

      // Get ahead/behind count relative to main in parent repo
      try {
        // First, fetch to update tracking
        await execGitCommand(['fetch', '--quiet'], parentGitPath);

        // Get default branch name
        let defaultBranch = 'main';
        try {
          const symbolicRef = await execGitCommand(
            ['symbolic-ref', 'refs/remotes/origin/HEAD'],
            parentGitPath
          );
          defaultBranch = symbolicRef.trim().replace('refs/remotes/origin/', '');
        } catch {
          // Try to detect main vs master
          try {
            await execGitCommand(['rev-parse', '--verify', 'main'], parentGitPath);
            defaultBranch = 'main';
          } catch {
            defaultBranch = 'master';
          }
        }

        // Get ahead/behind relative to default branch
        const revList = await execGitCommand(
          ['rev-list', '--left-right', '--count', `${defaultBranch}...${entry.branch}`],
          parentGitPath
        );
        const [behind, ahead] = revList.trim().split(/\s+/).map(n => parseInt(n, 10) || 0);
        status.aheadOfMain = ahead;
        status.behindMain = behind;
      } catch (error) {
        // Ahead/behind calculation failed - leave as 0
        console.error(`⚠️  [WORKTREE-STATUS] Failed to calculate ahead/behind:`, error);
      }
    } catch (error: any) {
      console.error(`⚠️  [WORKTREE-STATUS] Failed to get git status:`, error);
    }

    return status;
  }
}
