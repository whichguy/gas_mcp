/**
 * RsyncTool - Stateless unidirectional sync between GAS projects and local git repositories
 *
 * Single-call workflow:
 * - pull: GAS → Local (dryrun to preview)
 * - push: Local → GAS (dryrun to preview)
 *
 * Key features:
 * - Stateless: No plan storage, no TTL, no drift detection
 * - Hash-based diff computed at runtime (SyncDiff)
 * - Deletion safety with confirmDeletions flag
 * - Bootstrap detection with manifest creation
 * - Git-based recovery (reset to pre-sync commit)
 */

import { BaseTool } from '../base.js';
import { GuidanceFragments } from '../../utils/guidanceFragments.js';
import { SessionAuthManager } from '../../auth/sessionManager.js';
import { GASClient } from '../../api/gasClient.js';
import { SyncPlanner, SyncPlanError, DiffResult } from './SyncPlanner.js';
import { SyncExecutor, SyncExecuteError } from './SyncExecutor.js';
import { getCurrentBranchName } from '../../utils/gitStatus.js';
import { mcpLogger } from '../../utils/mcpLogger.js';

/**
 * Input schema for rsync tool
 */
interface RsyncInput {
  operation: 'pull' | 'push';
  scriptId: string;
  dryrun?: boolean;
  confirmDeletions?: boolean;
  force?: boolean;
  excludePatterns?: string[];
  projectPath?: string;
  accessToken?: string;
}

/**
 * Response types
 */
interface RsyncDryrunResponse {
  success: true;
  operation: 'pull' | 'push';
  dryrun: true;
  summary: {
    direction: 'pull' | 'push';
    additions: number;
    updates: number;
    deletions: number;
    isBootstrap: boolean;
    totalOperations: number;
  };
  files: {
    add: Array<{ filename: string; size?: number }>;
    update: Array<{ filename: string; sourceHash: string; destHash: string }>;
    delete: Array<{ filename: string }>;
  };
  warnings: string[];
  nextStep: string;
  workflowContext?: string;
}

interface RsyncGitHint {
  branch: string;
  isFeatureBranch: boolean;
  workflowHint: {
    action: 'push' | 'finish';
    command: string;
    reason: string;
  };
}

interface RsyncExecuteResponse {
  success: true;
  operation: 'pull' | 'push';
  dryrun: false;
  result: {
    direction: 'pull' | 'push';
    filesAdded: number;
    filesUpdated: number;
    filesDeleted: number;
    commitSha?: string;
  };
  recoveryInfo: {
    method: string;
    command: string;
  };
  git?: RsyncGitHint;
  warnings?: string[];
  contentAnalysis?: { file: string; warnings: string[]; hints: string[] }[];  // per-file analyzer output (pull only)
}

interface RsyncNoChangesResponse {
  success: true;
  operation: 'pull' | 'push';
  dryrun: false;
  result: {
    direction: 'pull' | 'push';
    filesAdded: 0;
    filesUpdated: 0;
    filesDeleted: 0;
  };
  message: string;
  warnings?: string[];
}

interface RsyncErrorResponse {
  success: false;
  operation: string;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

type RsyncResponse =
  | RsyncDryrunResponse
  | RsyncExecuteResponse
  | RsyncNoChangesResponse
  | RsyncErrorResponse;

/**
 * RsyncTool implementation
 */
export class RsyncTool extends BaseTool {
  public name = 'rsync';

  public description = '[SYNC] Stateless bidirectional sync between local git repo and remote GAS — pull or push with optional dryrun preview. WHEN: syncing local changes to GAS or pulling remote changes. AVOID: write/edit already push to GAS automatically. Example: rsync({scriptId, direction: "pull"}) or rsync({scriptId, direction: "push", dryrun: true})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      success: { type: 'boolean', description: 'Whether the operation succeeded' },
      operation: { type: 'string', description: 'Sync direction: pull or push' },
      dryrun: { type: 'boolean', description: 'Whether this was a preview (no changes applied)' },
      // dryrun response fields
      summary: { type: 'object', description: 'Change summary (dryrun): {direction, additions, updates, deletions, isBootstrap, totalOperations}' },
      files: { type: 'object', description: 'Affected files (dryrun): {add: [{filename, size}], update: [{filename, sourceHash, destHash}], delete: [{filename}]}' },
      nextStep: { type: 'string', description: 'Suggested next command (dryrun)' },
      workflowContext: { type: 'string', description: 'Workflow context hint (dryrun)' },
      // execute response fields
      result: { type: 'object', description: 'Sync result (execute): {direction, filesAdded, filesUpdated, filesDeleted, commitSha}' },
      recoveryInfo: { type: 'object', description: 'Recovery info (execute): {method, command}' },
      git: { type: 'object', description: 'Git workflow hint (execute): {branch, isFeatureBranch, workflowHint: {action, command, reason}}' },
      // no-changes response
      message: { type: 'string', description: 'Status message when already in sync' },
      // error response fields
      error: { type: 'object', description: 'Error details (on failure): {code, message, details}' },
      // common
      warnings: { type: 'array', description: 'Warning messages' },
      contentAnalysis: { type: 'array', description: 'Per-file content analysis (pull only): [{file: string, warnings: string[], hints: string[]}]' }
    }
  };

  public inputSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      operation: {
        type: 'string',
        enum: ['pull', 'push'],
        description: 'Sync direction: pull (GAS→local) or push (local→GAS)'
      },
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID',
        pattern: '^[a-zA-Z0-9_-]{25,60}$',
        minLength: 25,
        maxLength: 60,
        examples: ['1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789']
      },
      dryrun: {
        type: 'boolean',
        default: false,
        description: 'Preview only — compute and return diff without applying changes'
      },
      confirmDeletions: {
        type: 'boolean',
        default: false,
        description: 'Confirm file deletions. Required if sync would delete files.'
      },
      force: {
        type: 'boolean',
        default: false,
        description: 'Skip uncommitted changes check. Deletions still require confirmation.'
      },
      excludePatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'File patterns to exclude from sync (e.g., ["test/*", "backup/"])'
      },
      projectPath: {
        type: 'string',
        default: '',
        description: 'Path to nested git project within GAS (for polyrepo support)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$'
      }
    },
    required: ['operation', 'scriptId'],
    llmGuidance: {
      ...GuidanceFragments.buildRsyncGuidance({
        workflow: 'pull/push with optional dryrun:true to preview. Single call, no planId.',
        bootstrap: 'First sync creates manifest. No deletions on bootstrap.',
        recovery: 'On failure: git reset --hard {pre-sync-sha}',
      }),
      postSync: 'After rsync, check response git.workflowHint for next action (commit/push/finish).',
      examples: 'Batch: edit ~/gas-repos/project-{scriptId}/ locally → rsync push | Preview: dryrun:true | Deletes: confirmDeletions:true'
    }
  };

  public annotations = {
    title: 'Sync Files',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  };

  private gasClient: GASClient;
  private planner: SyncPlanner;
  private executor: SyncExecutor;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
    this.planner = new SyncPlanner(this.gasClient);
    this.executor = new SyncExecutor(this.gasClient);
  }

  /**
   * Execute rsync operation
   */
  async execute(params: RsyncInput): Promise<RsyncResponse> {
    // Strip progress callback before validation (injected by mcpServer.ts for long ops)
    const sendProgress = (params as any)._sendProgress as
      ((progress: number, total: number, message: string) => Promise<void>) | undefined;
    delete (params as any)._sendProgress;

    const { operation, scriptId } = params;

    mcpLogger.info('rsync', { event: 'sync_start', operation, scriptId, dryrun: !!params.dryrun, message: `[RSYNC] ${operation} operation for ${scriptId}${params.dryrun ? ' (dryrun)' : ''}` });

    // Validate scriptId
    this.validate.scriptId(scriptId, 'rsync operation');

    // Validate operation
    if (operation !== 'pull' && operation !== 'push') {
      return this.errorResponse(operation, 'INVALID_OPERATION', `Unknown operation: ${operation}. Use 'pull' or 'push'.`);
    }

    // Get auth token
    const accessToken = await this.getAuthToken(params);

    try {
      // Step 1: Compute diff (read-only)
      if (operation === 'push') await sendProgress?.(1, 3, 'Computing diff...');
      const diffResult = await this.planner.computeDiff({
        scriptId,
        direction: operation,
        accessToken,
        force: params.force,
        excludePatterns: params.excludePatterns,
        projectPath: params.projectPath,
      });

      // Step 2: Dryrun — return diff without applying
      if (params.dryrun) {
        return this.buildDryrunResponse(operation, scriptId, diffResult);
      }

      // Step 3: No changes — return early
      if (!diffResult.operations.hasChanges) {
        const noChangeResponse: RsyncNoChangesResponse = {
          success: true,
          operation,
          dryrun: false,
          result: {
            direction: operation,
            filesAdded: 0,
            filesUpdated: 0,
            filesDeleted: 0,
          },
          message: 'Already in sync. No changes detected.',
        };
        if (diffResult.warnings.length > 0) {
          noChangeResponse.warnings = diffResult.warnings;
        }
        return noChangeResponse;
      }

      // Step 4: Check deletion safety
      if (diffResult.operations.delete.length > 0 && !params.confirmDeletions) {
        return this.errorResponse(operation, 'DELETION_REQUIRES_CONFIRMATION',
          `Sync will delete ${diffResult.operations.delete.length} file(s). Pass confirmDeletions: true to proceed.`,
          {
            deletionCount: diffResult.operations.delete.length,
            files: diffResult.operations.delete.map(f => f.filename),
            nextStep: `rsync({operation: '${operation}', scriptId: '${scriptId}', confirmDeletions: true})`
          }
        );
      }

      // Step 5: Apply changes (pass pre-fetched GAS files to avoid redundant API calls)
      const totalFiles = diffResult.operations.add.length + diffResult.operations.update.length + diffResult.operations.delete.length;
      if (operation === 'push') await sendProgress?.(2, 3, `Pushing ${totalFiles} file${totalFiles !== 1 ? 's' : ''}...`);
      const result = await this.executor.apply({
        direction: operation,
        scriptId,
        operations: diffResult.operations,
        localPath: diffResult.localPath,
        isBootstrap: diffResult.isBootstrap,
        accessToken,
        confirmDeletions: params.confirmDeletions,
        prefetchedGasFiles: diffResult.gasFiles,
      });

      // Step 6: Build git workflow hint
      if (operation === 'push') await sendProgress?.(3, 3, 'Finalizing sync...');
      const gitHint = await this.buildPostSyncGitHint(scriptId, diffResult.localPath, operation);

      const response: RsyncExecuteResponse = {
        success: true,
        operation,
        dryrun: false,
        result: {
          direction: result.direction,
          filesAdded: result.filesAdded,
          filesUpdated: result.filesUpdated,
          filesDeleted: result.filesDeleted,
          commitSha: result.commitSha,
        },
        recoveryInfo: result.recoveryInfo,
      };

      if (diffResult.warnings.length > 0) {
        response.warnings = diffResult.warnings;
      }

      if (gitHint) {
        response.git = gitHint;
      }

      if (result.contentAnalysis && result.contentAnalysis.length > 0) {
        response.contentAnalysis = result.contentAnalysis;
      }

      mcpLogger.info('rsync', {
        event: 'sync_complete',
        operation,
        scriptId,
        filesChanged: result.filesAdded + result.filesUpdated + result.filesDeleted,
      });

      return response;

    } catch (error) {
      mcpLogger.error('rsync', { event: 'sync_error', operation, scriptId, error: error instanceof Error ? error.message : String(error) });
      return this.handleError(operation, error);
    }
  }

  /**
   * Build dryrun response from diff result
   */
  private buildDryrunResponse(
    operation: 'pull' | 'push',
    scriptId: string,
    diffResult: DiffResult
  ): RsyncDryrunResponse {
    const ops = diffResult.operations;

    // Log operation details
    if (ops.hasChanges) {
      if (ops.add.length > 0) {
        mcpLogger.info('rsync', `[RSYNC] Files to add: ${ops.add.map(f => f.filename).join(', ')}`);
      }
      if (ops.update.length > 0) {
        mcpLogger.info('rsync', `[RSYNC] Files to update: ${ops.update.map(f => f.filename).join(', ')}`);
      }
      if (ops.delete.length > 0) {
        mcpLogger.info('rsync', `[RSYNC] Files to delete: ${ops.delete.map(f => f.filename).join(', ')}`);
      }
    }

    // Build next step instruction
    let nextStep: string;
    if (!ops.hasChanges) {
      nextStep = 'No changes to sync. Files are already in sync.';
    } else {
      nextStep = `rsync({operation: '${operation}', scriptId: '${scriptId}'`;
      if (ops.delete.length > 0 && !diffResult.isBootstrap) {
        nextStep += `, confirmDeletions: true`;
      }
      nextStep += `})`;
    }

    // Build workflow context hint (lightweight — no git calls for dryrun)
    const workflowContext = operation === 'pull'
      ? `After pull: use git_feature({operation:'push', scriptId:'${scriptId}'}) to backup to remote`
      : `After push: changes will be live in GAS`;

    return {
      success: true,
      operation,
      dryrun: true,
      summary: {
        direction: operation,
        additions: ops.add.length,
        updates: ops.update.length,
        deletions: ops.delete.length,
        isBootstrap: diffResult.isBootstrap,
        totalOperations: ops.totalOperations,
      },
      files: {
        add: ops.add.map(f => ({ filename: f.filename, size: f.size })),
        update: ops.update.map(f => ({
          filename: f.filename,
          sourceHash: f.sourceHash || '',
          destHash: f.destHash || '',
        })),
        delete: ops.delete.map(f => ({ filename: f.filename })),
      },
      warnings: diffResult.warnings,
      nextStep,
      workflowContext,
    };
  }

  /**
   * Build git workflow hint after successful sync
   */
  private async buildPostSyncGitHint(
    scriptId: string,
    localPath: string,
    direction: 'pull' | 'push'
  ): Promise<RsyncGitHint | null> {
    try {
      const branch = await getCurrentBranchName(localPath);
      if (branch === 'unknown') return null;

      const isFeatureBranch = branch.startsWith('llm-feature-');

      let action: 'push' | 'finish';
      let command: string;
      let reason: string;

      if (isFeatureBranch && direction === 'push') {
        action = 'finish';
        command = `git_feature({operation:'finish', scriptId:'${scriptId}', pushToRemote:true})`;
        reason = `On feature branch '${branch}'. When feature work is complete, finish and merge to main.`;
      } else if (isFeatureBranch && direction === 'pull') {
        action = 'push';
        command = `git_feature({operation:'push', scriptId:'${scriptId}'})`;
        reason = `Pulled latest to feature branch '${branch}'. Push to remote for backup.`;
      } else {
        // On main/master
        action = 'push';
        command = `git_feature({operation:'push', scriptId:'${scriptId}'})`;
        reason = direction === 'pull'
          ? 'Pulled latest changes. Push to remote to keep backup in sync.'
          : 'Pushed to GAS. Push git history to remote for backup.';
      }

      return { branch, isFeatureBranch, workflowHint: { action, command, reason } };
    } catch (error) {
      mcpLogger.warning('rsync', { message: '[RSYNC] Failed to build git hint', details: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /**
   * Create error response
   */
  private errorResponse(
    operation: string,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ): RsyncErrorResponse {
    mcpLogger.error('rsync', `[RSYNC] ${operation} error: ${code} - ${message}`);

    return {
      success: false,
      operation,
      error: {
        code,
        message,
        ...(details && { details })
      }
    };
  }

  /**
   * Handle unexpected errors
   */
  private handleError(operation: string, error: unknown): RsyncErrorResponse {
    if (error instanceof SyncPlanError) {
      return this.errorResponse(operation, error.code, error.message, error.details);
    }

    if (error instanceof SyncExecuteError) {
      return this.errorResponse(operation, error.code, error.message, error.details);
    }

    const message = error instanceof Error ? error.message : String(error);
    mcpLogger.error('rsync', { message: `[RSYNC] Unexpected error in ${operation}`, details: error });

    return this.errorResponse(operation, 'INTERNAL_ERROR', message);
  }
}

/**
 * Export factory for tool registration
 */
export function createRsyncTool(sessionAuthManager?: SessionAuthManager): RsyncTool {
  return new RsyncTool(sessionAuthManager);
}
