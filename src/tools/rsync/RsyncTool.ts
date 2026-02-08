/**
 * RsyncTool - Unidirectional sync between GAS projects and local git repositories
 *
 * Two-phase workflow:
 * 1. plan: Compute diff, create plan with 5-minute TTL
 * 2. execute: Validate plan, apply changes, update manifest
 *
 * Additional operations:
 * - status: Get current plan status
 * - cancel: Cancel a pending plan
 *
 * Key features:
 * - Atomic single-call design (no per-file rate limiting)
 * - Bootstrap detection with manifest creation
 * - Deletion safety with confirmation tokens
 * - Git-based recovery (reset to pre-sync commit)
 */

import { BaseTool } from '../base.js';
import { SessionAuthManager } from '../../auth/sessionManager.js';
import { log } from '../../utils/logger.js';
import { GASClient } from '../../api/gasClient.js';
import { SyncPlanner, SyncPlanError, PlanResult } from './SyncPlanner.js';
import { SyncExecutor, SyncExecuteError, SyncResult } from './SyncExecutor.js';
import { PlanStore, PlanValidation } from './PlanStore.js';
import { SyncDiff } from './SyncDiff.js';

/**
 * Input schema for rsync tool
 */
interface RsyncInput {
  operation: 'plan' | 'execute' | 'status' | 'cancel';
  scriptId: string;

  // For 'plan' operation
  direction?: 'pull' | 'push';
  force?: boolean;
  excludePatterns?: string[];
  projectPath?: string;

  // For 'execute' operation
  planId?: string;
  confirmDeletions?: boolean;

  // Auth
  accessToken?: string;
}

/**
 * Response types for different operations
 */
interface RsyncPlanResponse {
  success: true;
  operation: 'plan';
  plan: {
    planId: string;
    expiresAt: string;
    direction: 'pull' | 'push';
    scriptId: string;
    isBootstrap: boolean;
  };
  summary: {
    direction: 'pull' | 'push';
    additions: number;
    updates: number;
    deletions: number;
    isBootstrap: boolean;
    totalOperations: number;
  };
  warnings: string[];
  nextStep: string;
}

interface RsyncExecuteResponse {
  success: true;
  operation: 'execute';
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
}

interface RsyncStatusResponse {
  success: true;
  operation: 'status';
  plan: {
    planId: string;
    valid: boolean;
    expiresAt?: string;
    remainingTtlMs?: number;
    direction?: 'pull' | 'push';
    summary?: string;
  } | null;
  activePlans: number;
}

interface RsyncCancelResponse {
  success: true;
  operation: 'cancel';
  cancelled: boolean;
  planId: string;
  message: string;
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
  | RsyncPlanResponse
  | RsyncExecuteResponse
  | RsyncStatusResponse
  | RsyncCancelResponse
  | RsyncErrorResponse;

/**
 * RsyncTool implementation
 */
export class RsyncTool extends BaseTool {
  public name = 'mcp__gas__rsync';

  public description = `[GIT] Unidirectional sync between GAS projects and local git repositories.

Two-phase workflow for safe, auditable sync:
1. plan: Compute diff and create plan (5-minute TTL)
2. execute: Validate and apply plan

Operations:
- plan: Create sync plan (requires direction: pull or push)
- execute: Execute a plan (requires planId, optionally confirmDeletions)
- status: Check plan status
- cancel: Cancel pending plan

Batch workflow: For multiple file changes, edit files locally at ~/gas-repos/project-{scriptId}/ then plan+execute to push all changes in 2 API calls.`;

  public inputSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      operation: {
        type: 'string',
        enum: ['plan', 'execute', 'status', 'cancel'],
        description: 'Sync operation: plan (create diff), execute (apply plan), status (check plan), cancel (abort plan)'
      },
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID',
        pattern: '^[a-zA-Z0-9_-]{25,60}$',
        minLength: 25,
        maxLength: 60,
        examples: ['1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789']
      },
      direction: {
        type: 'string',
        enum: ['pull', 'push'],
        description: 'Sync direction: pull (GAS→local) or push (local→GAS). Required for plan operation.'
      },
      force: {
        type: 'boolean',
        default: false,
        description: 'Skip uncommitted changes check (plan operation). Deletions still require confirmation.'
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
      planId: {
        type: 'string',
        description: 'Plan UUID from plan operation. Required for execute/status/cancel.'
      },
      confirmDeletions: {
        type: 'boolean',
        default: false,
        description: 'Confirm file deletions (execute operation). Required if plan has deletions.'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$'
      }
    },
    required: ['operation', 'scriptId'],
    llmGuidance: {
      workflow: 'plan → review diff → execute (with confirmDeletions if deletions)',
      twoPhase: 'Plan has 5-min TTL. Review output before executing.',
      bootstrap: 'First sync creates manifest. No deletions allowed on bootstrap.',
      recovery: 'On failure: git reset --hard {pre-sync-sha}',
      examples: [
        'rsync({operation: "plan", scriptId: "...", direction: "pull"})',
        'rsync({operation: "execute", scriptId: "...", planId: "...", confirmDeletions: true})',
        'rsync({operation: "status", scriptId: "...", planId: "..."})',
        'rsync({operation: "cancel", scriptId: "...", planId: "..."})'
      ]
    }
  };

  private gasClient: GASClient;
  private planner: SyncPlanner;
  private executor: SyncExecutor;
  private planStore: PlanStore;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
    this.planner = new SyncPlanner(this.gasClient);
    this.executor = new SyncExecutor(this.gasClient);
    this.planStore = PlanStore.getInstance();
  }

  /**
   * Execute rsync operation
   */
  async execute(params: RsyncInput): Promise<RsyncResponse> {
    const { operation, scriptId } = params;

    log.info(`[RSYNC] ${operation} operation for ${scriptId}`);

    // Validate scriptId
    this.validate.scriptId(scriptId, 'rsync operation');

    // Get auth token
    const accessToken = await this.getAuthToken(params);

    try {
      switch (operation) {
        case 'plan':
          return await this.handlePlan(params, accessToken);

        case 'execute':
          return await this.handleExecute(params, accessToken);

        case 'status':
          return await this.handleStatus(params);

        case 'cancel':
          return await this.handleCancel(params);

        default:
          return this.errorResponse(operation, 'INVALID_OPERATION', `Unknown operation: ${operation}`);
      }
    } catch (error) {
      return this.handleError(operation, error);
    }
  }

  /**
   * Handle plan operation
   */
  private async handlePlan(params: RsyncInput, accessToken: string): Promise<RsyncResponse> {
    const { scriptId, direction, force, excludePatterns, projectPath } = params;

    // Validate direction
    if (!direction) {
      return this.errorResponse('plan', 'MISSING_DIRECTION', 'direction is required for plan operation');
    }

    if (direction !== 'pull' && direction !== 'push') {
      return this.errorResponse('plan', 'INVALID_DIRECTION', 'direction must be "pull" or "push"');
    }

    try {
      const result: PlanResult = await this.planner.createPlan({
        scriptId,
        direction,
        projectPath,
        accessToken,
        force,
        excludePatterns
      });

      const response: RsyncPlanResponse = {
        success: true,
        operation: 'plan',
        plan: {
          planId: result.plan.planId,
          expiresAt: result.plan.expiresAt,
          direction: result.plan.direction,
          scriptId: result.plan.scriptId,
          isBootstrap: result.plan.isBootstrap
        },
        summary: result.summary,
        warnings: result.warnings,
        nextStep: result.nextStep
      };

      // Add file details if there are changes
      if (result.plan.operations.hasChanges) {
        this.logOperationDetails(result);
      }

      return response;

    } catch (error) {
      if (error instanceof SyncPlanError) {
        return this.errorResponse('plan', error.code, error.message, error.details);
      }
      throw error;
    }
  }

  /**
   * Handle execute operation
   */
  private async handleExecute(params: RsyncInput, accessToken: string): Promise<RsyncResponse> {
    const { scriptId, planId, confirmDeletions } = params;

    // Validate planId
    if (!planId) {
      return this.errorResponse('execute', 'MISSING_PLAN_ID', 'planId is required for execute operation');
    }

    try {
      const result: SyncResult = await this.executor.execute({
        planId,
        scriptId,
        accessToken,
        confirmDeletions
      });

      const response: RsyncExecuteResponse = {
        success: true,
        operation: 'execute',
        result: {
          direction: result.direction,
          filesAdded: result.filesAdded,
          filesUpdated: result.filesUpdated,
          filesDeleted: result.filesDeleted,
          commitSha: result.commitSha
        },
        recoveryInfo: result.recoveryInfo
      };

      return response;

    } catch (error) {
      if (error instanceof SyncExecuteError) {
        return this.errorResponse('execute', error.code, error.message, error.details);
      }
      throw error;
    }
  }

  /**
   * Handle status operation
   */
  private async handleStatus(params: RsyncInput): Promise<RsyncResponse> {
    const { planId } = params;

    if (!planId) {
      // Return general status (number of active plans)
      const activePlans = this.planStore.getCount();
      const planIds = this.planStore.listPlanIds();

      return {
        success: true,
        operation: 'status',
        plan: null,
        activePlans,
        ...(planIds.length > 0 && { planIds })
      } as RsyncStatusResponse;
    }

    // Get specific plan status
    const validation: PlanValidation = this.planStore.get(planId);

    if (!validation.valid) {
      return {
        success: true,
        operation: 'status',
        plan: {
          planId,
          valid: false
        },
        activePlans: this.planStore.getCount()
      };
    }

    const plan = validation.plan!;
    const remainingTtlMs = this.planStore.getRemainingTtl(planId);

    return {
      success: true,
      operation: 'status',
      plan: {
        planId,
        valid: true,
        expiresAt: plan.expiresAt,
        remainingTtlMs,
        direction: plan.direction,
        summary: PlanStore.formatPlanSummary(plan)
      },
      activePlans: this.planStore.getCount()
    };
  }

  /**
   * Handle cancel operation
   */
  private async handleCancel(params: RsyncInput): Promise<RsyncResponse> {
    const { planId } = params;

    if (!planId) {
      return this.errorResponse('cancel', 'MISSING_PLAN_ID', 'planId is required for cancel operation');
    }

    const deleted = this.planStore.delete(planId);

    return {
      success: true,
      operation: 'cancel',
      cancelled: deleted,
      planId,
      message: deleted
        ? 'Plan cancelled successfully'
        : 'Plan not found (may have expired or already been executed)'
    };
  }

  /**
   * Log operation details for debugging
   */
  private logOperationDetails(result: PlanResult): void {
    const ops = result.plan.operations;

    if (ops.add.length > 0) {
      log.info(`[RSYNC] Files to add: ${ops.add.map(f => f.filename).join(', ')}`);
    }
    if (ops.update.length > 0) {
      log.info(`[RSYNC] Files to update: ${ops.update.map(f => f.filename).join(', ')}`);
    }
    if (ops.delete.length > 0) {
      log.info(`[RSYNC] Files to delete: ${ops.delete.map(f => f.filename).join(', ')}`);
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
    log.error(`[RSYNC] ${operation} error: ${code} - ${message}`);

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
    log.error(`[RSYNC] Unexpected error in ${operation}:`, error);

    return this.errorResponse(operation, 'INTERNAL_ERROR', message);
  }
}

/**
 * Export factory for tool registration
 */
export function createRsyncTool(sessionAuthManager?: SessionAuthManager): RsyncTool {
  return new RsyncTool(sessionAuthManager);
}
