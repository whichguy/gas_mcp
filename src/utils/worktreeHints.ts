/**
 * Context-aware hint generators for worktree operations
 *
 * Provides LLM-friendly guidance for next steps and troubleshooting
 * based on operation results and state.
 */

import type { WorktreeState } from '../types/worktreeTypes.js';

export interface WorktreeHints {
  context?: string;
  nextSteps?: string[];
  suggestions?: string[];
  warning?: string;
  workflow?: string[];
}

export type WorktreeOperation = 'add' | 'claim' | 'release' | 'merge' | 'remove' | 'list' | 'status' | 'sync' | 'batch-add' | 'cleanup';

/**
 * Generate hints based on worktree operation results
 */
export function generateWorktreeHints(
  operation: WorktreeOperation,
  result: any,
  context?: { parentScriptId?: string; worktreeScriptId?: string; state?: WorktreeState }
): WorktreeHints {
  const hints: WorktreeHints = {};
  const scriptId = context?.worktreeScriptId || result?.worktree?.scriptId;
  const parentId = context?.parentScriptId || result?.worktree?.parentScriptId;

  switch (operation) {
    case 'add': {
      const localPath = result?.worktree?.localPath;
      hints.context = 'Created isolated worktree with separate GAS project';
      if (result?.worktree?.state === 'CLAIMED') {
        hints.context += ' (claimed for exclusive use)';
      }
      if (localPath) {
        hints.context += `\nLocal git folder: ${localPath}`;
      }
      hints.nextSteps = [
        `Develop using: write/edit tools with scriptId: "${scriptId}"`,
        `When complete: worktree({operation:"merge", worktreeScriptId:"${scriptId}"})`
      ];
      hints.workflow = [
        '1. Develop in worktree (changes isolated from parent)',
        '2. Test changes in worktree GAS project',
        '3. Merge to parent when ready (squash commit)'
      ];
      break;
    }

    case 'claim': {
      const claimLocalPath = result?.worktree?.localPath;
      if (result?.created) {
        hints.context = 'Created and claimed new worktree (no READY worktrees available)';
      } else {
        hints.context = 'Claimed existing READY worktree';
      }
      if (claimLocalPath) {
        hints.context += `\nLocal git folder: ${claimLocalPath}`;
      }
      hints.nextSteps = [
        `Develop using scriptId: "${scriptId}"`,
        `Release when pausing: worktree({operation:"release", worktreeScriptId:"${scriptId}"})`,
        `Merge when complete: worktree({operation:"merge", worktreeScriptId:"${scriptId}"})`
      ];
      break;
    }

    case 'release':
      hints.context = 'Worktree returned to READY state (available for other agents)';
      hints.nextSteps = [
        `Re-claim later: worktree({operation:"claim", parentScriptId:"${parentId}"})`,
        `Or merge if complete: worktree({operation:"merge", worktreeScriptId:"${scriptId}"})`
      ];
      if (result?.warnings?.length > 0) {
        hints.warning = result.warnings.join('; ');
      }
      break;

    case 'merge':
      if (result?.preview) {
        // Dry run preview
        hints.context = 'Preview of merge (no changes made)';
        if (result.preview.conflicts?.length > 0) {
          hints.warning = `${result.preview.conflicts.length} conflict(s) detected: ${result.preview.conflicts.join(', ')}`;
          hints.suggestions = [
            'Resolve conflicts in worktree before merging',
            'Use sync operation to pull parent changes first'
          ];
        } else {
          hints.nextSteps = [
            `Execute merge: worktree({operation:"merge", worktreeScriptId:"${scriptId}"})`
          ];
        }
      } else {
        // Actual merge
        hints.context = `Merged ${result?.filesChanged || 0} files to parent via squash commit`;
        const mergeNextSteps: string[] = [];
        if (!result?.pushedToRemote) {
          hints.warning = 'Changes merged locally but NOT pushed to remote';
          mergeNextSteps.push('Push to remote manually or use git_feature');
        }
        if (result?.worktreeState === 'MERGED') {
          mergeNextSteps.push(
            `Cleanup: worktree({operation:"remove", worktreeScriptId:"${scriptId}"})`
          );
        }
        if (mergeNextSteps.length > 0) {
          hints.nextSteps = mergeNextSteps;
        }
      }
      break;

    case 'remove':
      hints.context = 'Worktree deleted (GAS project trashed, git branch removed)';
      if (result?.warnings?.length > 0) {
        hints.warning = result.warnings.join('; ');
      }
      break;

    case 'list':
      const worktrees = result?.worktrees || [];
      const ready = worktrees.filter((w: any) => w.state === 'READY').length;
      const claimed = worktrees.filter((w: any) => w.state === 'CLAIMED').length;
      const orphans = worktrees.filter((w: any) => w.isOrphan).length;

      hints.context = `Found ${worktrees.length} worktree(s): ${ready} READY, ${claimed} CLAIMED`;

      if (orphans > 0) {
        hints.warning = `${orphans} potentially orphaned worktree(s) detected`;
        hints.suggestions = [
          `Run cleanup: worktree({operation:"cleanup", parentScriptId:"${parentId}", dryRun:true})`
        ];
      }

      if (ready > 0) {
        hints.nextSteps = [
          `Claim available: worktree({operation:"claim", parentScriptId:"${parentId}"})`
        ];
      } else if (worktrees.length === 0) {
        hints.nextSteps = [
          `Create worktree: worktree({operation:"add", parentScriptId:"${parentId}", branchName:"feature-name"})`
        ];
      }
      break;

    case 'status': {
      const statusLocalPath = result?.localPath || result?.worktree?.localPath;
      const divergence = result?.divergence;
      if (divergence) {
        const changes = [
          divergence.filesOnlyInWorktree?.length || 0,
          divergence.filesModifiedInWorktree?.length || 0,
          divergence.filesOnlyInParent?.length || 0,
          divergence.filesModifiedInParent?.length || 0
        ].reduce((a, b) => a + b, 0);

        hints.context = `${changes} file difference(s) from parent`;

        if (divergence.conflicts?.length > 0) {
          hints.warning = `${divergence.conflicts.length} conflict(s): ${divergence.conflicts.join(', ')}`;
          hints.suggestions = [
            'Resolve conflicts before merging',
            'Conflicts occur when both worktree and parent modified same file'
          ];
        }

        if (result?.mergeable) {
          hints.nextSteps = [
            `Safe to merge: worktree({operation:"merge", worktreeScriptId:"${scriptId}"})`
          ];
        }
      }

      if (result?.gitStatus) {
        const gs = result.gitStatus;
        if (gs.uncommittedChanges > 0) {
          hints.warning = (hints.warning ? hints.warning + '; ' : '') +
            `${gs.uncommittedChanges} uncommitted local changes`;
        }
      }

      if (statusLocalPath) {
        hints.context = (hints.context || 'Worktree status') + `\nLocal git folder: ${statusLocalPath}`;
      }
      break;
    }

    case 'sync':
      hints.context = `Synced ${result?.synced?.length || 0} file(s) from parent`;

      if (result?.conflicts?.length > 0) {
        hints.warning = `${result.conflicts.length} conflict(s) not synced: ${result.conflicts.join(', ')}`;
        hints.suggestions = [
          'Manually resolve conflicts in worktree',
          'Conflicting files were not overwritten'
        ];
      }

      if (result?.skipped?.length > 0) {
        hints.context += `, skipped ${result.skipped.length} (deleted in parent)`;
      }
      break;

    case 'batch-add': {
      hints.context = `Created ${result?.created || 0} of ${result?.total || 0} worktrees`;

      // Show parent directory pattern from first worktree
      const firstWorktree = result?.worktrees?.[0];
      if (firstWorktree?.localPath) {
        // Extract parent directory (remove trailing branch folder)
        const parentDir = firstWorktree.localPath.replace(/\/[^/]+\/?$/, '/');
        hints.context += `\nWorktrees created in: ${parentDir}`;
      }

      if (result?.failedCount > 0) {
        hints.warning = `${result.failedCount} worktree(s) failed to create`;
        hints.suggestions = [
          'Check failed array for error details',
          'Use cleanup operation to remove failed entries'
        ];
      }

      if (result?.worktrees?.length > 0) {
        hints.nextSteps = [
          `Claim worktree: worktree({operation:"claim", parentScriptId:"${parentId}"})`
        ];
        hints.workflow = [
          '1. Each agent calls claim to get exclusive worktree',
          '2. Develop in claimed worktree',
          '3. Merge when complete, worktree returns to pool or is deleted'
        ];
      }
      break;
    }

    case 'cleanup':
      if (result?.cleaned !== undefined) {
        // Actual cleanup
        hints.context = `Removed ${result.cleaned} orphaned worktree(s)`;
        if (result?.kept > 0) {
          hints.warning = `${result.kept} worktree(s) could not be removed`;
        }
      } else if (result?.orphans) {
        // Dry run preview
        hints.context = `Found ${result.orphans.length} candidate(s) for cleanup`;
        if (result.orphans.length > 0) {
          hints.nextSteps = [
            `Execute cleanup: worktree({operation:"cleanup", parentScriptId:"${parentId}"})`
          ];
        }
      }
      break;
  }

  return hints;
}

/**
 * Generate hints for worktree errors
 */
export function generateWorktreeErrorHints(
  _operation: WorktreeOperation,
  errorCode: string
): WorktreeHints {
  const hints: WorktreeHints = {};

  // Common error patterns
  if (errorCode === 'WORKTREE_NOT_FOUND') {
    hints.context = 'Worktree does not exist or was already removed';
    hints.suggestions = [
      'Use list operation to see available worktrees',
      'worktree({operation:"list", parentScriptId:"..."})'
    ];
  }

  if (errorCode === 'PARENT_NOT_FOUND') {
    hints.context = 'Parent GAS project not accessible';
    hints.suggestions = [
      'Verify scriptId is correct',
      'Check auth with: auth({operation:"status"})'
    ];
  }

  if (errorCode === 'INVALID_STATE_TRANSITION') {
    hints.context = 'Operation not allowed in current worktree state';
    hints.suggestions = [
      'Use status operation to check current state',
      'Worktrees follow state machine: CREATING→READY→CLAIMED→MERGING→MERGED'
    ];
  }

  if (errorCode === 'UNCOMMITTED_CHANGES') {
    hints.context = 'Worktree has uncommitted local git changes';
    hints.suggestions = [
      'Commit changes before releasing',
      'Or use force:true to release anyway (changes preserved in git)'
    ];
  }

  if (errorCode === 'MERGE_CONFLICT') {
    hints.context = 'Git merge failed due to conflicts';
    hints.suggestions = [
      'Use status operation to identify conflicting files',
      'Resolve conflicts manually, then retry merge',
      'Consider using sync operation first to pull parent changes'
    ];
  }

  if (errorCode === 'NO_AVAILABLE_WORKTREES') {
    hints.context = 'No READY worktrees available to claim';
    hints.suggestions = [
      'Create new worktree: worktree({operation:"add", ...})',
      'Or wait for another agent to release a worktree',
      'Run cleanup if worktrees are orphaned'
    ];
  }

  if (errorCode === 'LOCK_TIMEOUT') {
    hints.context = 'Another worktree operation is in progress';
    hints.suggestions = [
      'Wait and retry operation',
      'Check for stuck operations (MERGING state >30min)'
    ];
  }

  if (errorCode === 'SYNC_FAILED') {
    hints.context = 'Failed to push synced files to GAS';
    hints.suggestions = [
      'Check GAS quota and permissions',
      'Retry operation',
      'Use cat/write tools for manual sync'
    ];
  }

  if (errorCode === 'CONTAINER_COPY_FAILED') {
    hints.context = 'Failed to copy container-bound project';
    hints.suggestions = [
      'Verify parent has bound script (not just a Sheet)',
      'Check Drive permissions for copying',
      'Try creating standalone worktree instead'
    ];
  }

  if (errorCode === 'BRANCH_NAME_REQUIRED') {
    hints.context = 'Branch name is required for this operation';
    hints.suggestions = [
      'Provide branchName parameter (e.g., "feature-auth")',
      'Branch names are sanitized: lowercase, alphanumeric + hyphens'
    ];
  }

  if (errorCode === 'BRANCH_EXISTS') {
    hints.context = 'A git branch with this name already exists';
    hints.suggestions = [
      'Choose a different branch name',
      'Or use cleanup to remove abandoned worktrees first'
    ];
  }

  if (errorCode === 'API_ERROR') {
    hints.context = 'Google Apps Script API request failed';
    hints.suggestions = [
      'Check auth status: auth({operation:"status"})',
      'Verify scriptId is correct and accessible',
      'Retry the operation'
    ];
  }

  if (errorCode === 'GIT_ERROR') {
    hints.context = 'Git command failed during worktree operation';
    hints.suggestions = [
      'Check local git repository state',
      'Verify git is installed and accessible',
      'Check for pending merge/rebase in progress'
    ];
  }

  if (errorCode === 'DRIVE_QUOTA') {
    hints.context = 'Google Drive quota or rate limit exceeded';
    hints.suggestions = [
      'Wait a few minutes before retrying',
      'Check Drive storage quota in Google account',
      'Consider cleaning up unused worktree projects'
    ];
  }

  if (errorCode === 'REMOTE_PUSH_PENDING') {
    hints.context = 'Previous merge completed but git push to remote failed';
    hints.suggestions = [
      'Push manually: git push origin main',
      'Or resolve remote conflicts first',
      'Check remote repository access'
    ];
  }

  if (errorCode === 'GAS_PROJECT_DELETED') {
    hints.context = 'The GAS project for this worktree was deleted externally';
    hints.suggestions = [
      'Run cleanup to remove orphaned worktree entry',
      'worktree({operation:"cleanup", parentScriptId:"..."})'
    ];
  }

  if (errorCode === 'PARENT_DELETED') {
    hints.context = 'The parent GAS project no longer exists';
    hints.suggestions = [
      'All worktrees for this parent are now orphaned',
      'Run cleanup to remove orphaned entries'
    ];
  }

  if (errorCode === 'LOCAL_DELETED') {
    hints.context = 'The local git worktree folder was deleted';
    hints.suggestions = [
      'Run cleanup to remove orphaned worktree entry',
      'Or recreate worktree with add operation'
    ];
  }

  if (errorCode === 'RSYNC_PUSH_FAILED') {
    hints.context = 'Failed to sync local changes to GAS project';
    hints.suggestions = [
      'Check GAS project still exists and is accessible',
      'Verify OAuth permissions include script editing',
      'Retry the operation'
    ];
  }

  return hints;
}
