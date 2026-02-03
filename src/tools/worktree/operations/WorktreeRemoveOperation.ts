/**
 * WorktreeRemoveOperation - Deletes a worktree and cleans up resources
 *
 * Steps:
 * 1. Get worktree entry, validate it exists
 * 2. Warn if not merged (unless force)
 * 3. Transition to REMOVING state
 * 4. git worktree remove
 * 5. git branch -D (delete branch)
 * 6. Trash GAS project via Drive API
 * 7. Transition to REMOVED or delete entry
 */

import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { GASClient } from '../../../api/gasClient.js';
import { WorktreeLockManager } from '../WorktreeLockManager.js';
import { WorktreeStateManager } from '../WorktreeStateManager.js';
import type {
  WorktreeRemoveInput,
  WorktreeRemoveResult,
  WorktreeError,
  WorktreeEntry
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
 * Get parent git repo path from worktree path
 */
function getParentGitPath(parentScriptId: string): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
  return path.join(homeDir, 'gas-repos', `project-${parentScriptId}`);
}

/**
 * WorktreeRemoveOperation class
 */
export class WorktreeRemoveOperation {
  private gasClient: GASClient;
  private lockManager: WorktreeLockManager;
  private stateManager: WorktreeStateManager;

  constructor(gasClient: GASClient) {
    this.gasClient = gasClient;
    this.lockManager = WorktreeLockManager.getInstance();
    this.stateManager = WorktreeStateManager.getInstance();
  }

  /**
   * Execute the remove operation
   */
  async execute(
    params: WorktreeRemoveInput,
    accessToken: string
  ): Promise<WorktreeRemoveResult | WorktreeError> {
    const { worktreeScriptId, keepForDiagnostics = false, force = false } = params;

    console.error(`🔧 [WORKTREE-REMOVE] Starting remove operation for ${worktreeScriptId}`);

    // Initialize API client for Drive operations
    await this.gasClient.initializeClient(accessToken);

    return this.lockManager.withLock('worktree:remove', async () => {
      // Step 1: Get worktree entry
      const entry = await this.stateManager.getEntry(worktreeScriptId);
      if (!entry) {
        return {
          success: false,
          error: 'WORKTREE_NOT_FOUND',
          message: `Worktree ${worktreeScriptId} not found`
        };
      }

      // Step 2: Check if merged (unless force)
      const warnings: string[] = [];
      if (!force && entry.state !== 'MERGED' && entry.state !== 'FAILED') {
        if (entry.state === 'CLAIMED' || entry.state === 'READY') {
          warnings.push(`Worktree was in state ${entry.state} and may have unmerged changes`);
        }
      }

      // Step 3: Transition to REMOVING state
      try {
        await this.stateManager.transitionState(worktreeScriptId, 'REMOVING');
      } catch (error: any) {
        // If already in terminal state, continue with cleanup
        if (entry.state === 'REMOVED') {
          return {
            success: false,
            error: 'INVALID_STATE_TRANSITION',
            message: 'Worktree already removed'
          };
        }
        // Allow removal from any non-terminal state
      }

      const result: WorktreeRemoveResult = {
        removed: true,
        branchDeleted: false,
        localDeleted: false,
        gasDeleted: false,
        projectDeleted: false,
        keptForDiagnostics: keepForDiagnostics,
        warnings: warnings.length > 0 ? warnings : undefined
      };

      const parentGitPath = getParentGitPath(entry.parentScriptId);

      // Step 4: Remove git worktree
      if (await directoryExists(entry.localPath)) {
        try {
          await execGitCommand(['worktree', 'remove', '--force', entry.localPath], parentGitPath);
          result.localDeleted = true;
          console.error(`✅ [WORKTREE-REMOVE] Removed git worktree`);
        } catch (error: any) {
          warnings.push(`Failed to remove git worktree: ${error.message}`);
          console.error(`⚠️  [WORKTREE-REMOVE] Failed to remove git worktree:`, error);

          // Try manual deletion as fallback
          try {
            await fs.rm(entry.localPath, { recursive: true, force: true });
            result.localDeleted = true;
            console.error(`✅ [WORKTREE-REMOVE] Manually deleted worktree directory`);
          } catch (rmError) {
            console.error(`⚠️  [WORKTREE-REMOVE] Failed to manually delete:`, rmError);
          }
        }
      } else {
        console.error(`ℹ️  [WORKTREE-REMOVE] Worktree directory already removed`);
        result.localDeleted = true; // Already gone
      }

      // Step 5: Delete git branch
      try {
        await execGitCommand(['branch', '-D', entry.branch], parentGitPath);
        result.branchDeleted = true;
        console.error(`✅ [WORKTREE-REMOVE] Deleted branch ${entry.branch}`);
      } catch (error: any) {
        // Branch may already be deleted or not exist
        if (error.message.includes('not found')) {
          result.branchDeleted = true;
          console.error(`ℹ️  [WORKTREE-REMOVE] Branch already deleted`);
        } else {
          warnings.push(`Failed to delete branch: ${error.message}`);
          console.error(`⚠️  [WORKTREE-REMOVE] Failed to delete branch:`, error);
        }
      }

      // Step 6: Trash GAS project
      try {
        const driveApi = this.gasClient.getDriveApi();
        await driveApi.files.update({
          fileId: worktreeScriptId,
          requestBody: { trashed: true }
        });
        result.gasDeleted = true;
        result.projectDeleted = true;
        console.error(`✅ [WORKTREE-REMOVE] Trashed GAS project`);
      } catch (error: any) {
        // GAS project may already be deleted
        if (error.code === 404 || error.message?.includes('not found')) {
          result.gasDeleted = true;
          result.projectDeleted = true;
          console.error(`ℹ️  [WORKTREE-REMOVE] GAS project already deleted`);
        } else {
          warnings.push(`Failed to trash GAS project: ${error.message}`);
          console.error(`⚠️  [WORKTREE-REMOVE] Failed to trash GAS project:`, error);
        }
      }

      // Also trash container if container-bound
      if (entry.containerId) {
        try {
          const driveApi = this.gasClient.getDriveApi();
          await driveApi.files.update({
            fileId: entry.containerId,
            requestBody: { trashed: true }
          });
          console.error(`✅ [WORKTREE-REMOVE] Trashed container ${entry.containerId}`);
        } catch (error: any) {
          if (error.code !== 404) {
            warnings.push(`Failed to trash container: ${error.message}`);
          }
        }
      }

      // Step 7: Update entry state or remove from config
      if (keepForDiagnostics) {
        await this.stateManager.transitionState(worktreeScriptId, 'REMOVED');
        console.error(`✅ [WORKTREE-REMOVE] Marked as REMOVED (kept for diagnostics)`);
      } else {
        await this.lockManager.removeWorktreeEntry(worktreeScriptId);
        console.error(`✅ [WORKTREE-REMOVE] Removed entry from config`);
      }

      result.warnings = warnings.length > 0 ? warnings : undefined;

      console.error(`✅ [WORKTREE-REMOVE] Successfully removed worktree ${worktreeScriptId}`);
      return result;
    });
  }
}
