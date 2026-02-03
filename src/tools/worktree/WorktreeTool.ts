/**
 * WorktreeTool - MCP tool for parallel GAS development using git worktrees
 *
 * Enables multiple Claude Code agents to work concurrently on isolated
 * GAS projects while sharing git history through real git worktrees.
 *
 * Operations:
 * - add: Create new worktree with GAS project + git branch
 * - claim: Claim an available worktree for exclusive use
 * - release: Return worktree to READY state
 * - list: List all worktrees filtered by parent/state
 * - status: Get detailed worktree status with divergence info
 * - sync: Pull parent changes to worktree
 * - merge: Merge worktree changes back to parent
 * - remove: Delete worktree and cleanup resources
 * - batch-add: Create multiple worktrees in parallel
 * - cleanup: Remove orphaned and stale worktrees
 */

import { promises as fs } from 'fs';
import { BaseFileSystemTool } from '../filesystem/shared/BaseFileSystemTool.js';
import { SessionAuthManager } from '../../auth/sessionManager.js';
import { WorktreeLockManager } from './WorktreeLockManager.js';
import { WorktreeStateManager, WorktreeNotFoundError, InvalidStateTransitionError } from './WorktreeStateManager.js';
import { WorktreeAddOperation, WorktreeRemoveOperation, WorktreeStatusOperation } from './operations/index.js';
import { McpGasConfigManager } from '../../config/mcpGasConfig.js';
import { computeGitSha1 } from '../../utils/hashUtils.js';
import {
  normalizeFileName,
  type WorktreeInput,
  type WorktreeAddInput,
  type WorktreeClaimInput,
  type WorktreeReleaseInput,
  type WorktreeListInput,
  type WorktreeStatusInput,
  type WorktreeSyncInput,
  type WorktreeMergeInput,
  type WorktreeRemoveInput,
  type WorktreeBatchAddInput,
  type WorktreeCleanupInput,
  type WorktreeAddResult,
  type WorktreeClaimResult,
  type WorktreeReleaseResult,
  type WorktreeListResult,
  type WorktreeStatusResult,
  type WorktreeSyncResult,
  type WorktreeMergeResult,
  type WorktreeMergePreview,
  type WorktreeRemoveResult,
  type WorktreeBatchAddResult,
  type WorktreeCleanupResult,
  type WorktreeError,
  type WorktreeErrorCode
} from '../../types/worktreeTypes.js';

/**
 * WorktreeTool class
 *
 * MCP tool for managing parallel development worktrees
 */
export class WorktreeTool extends BaseFileSystemTool {
  public name = 'mcp__gas__worktree';
  public description = `Parallel GAS development with isolated worktrees sharing git history.

Operations:
add     → Create worktree: scriptId + git branch (claimImmediately=true default)
claim   → Get READY worktree or create new (createIfNone=true default)
release → Return CLAIMED→READY (checks uncommitted unless force)
merge   → Squash merge to parent + push to GAS (pushToRemote=true default)
remove  → Delete: git worktree + branch + trash GAS project
list    → Filter by parentScriptId, state[]
status  → Divergence info: filesOnlyIn*, filesModifiedIn*, conflicts
sync    → Pull parent changes using baseHashes for conflict detection
batch-add → Create N worktrees (1-10) with concurrency limit 3
cleanup → Remove orphans: stale claims (>24h), deleted GAS/local, FAILED

States: CREATING→READY→CLAIMED→MERGING→MERGED | FAILED | ORPHAN_*

Typical workflows:
1. Single agent: add(parent,branch)→develop→merge(wt)
2. Pool: batch-add(parent,3,prefix)→claim(parent,agent)→develop→merge→claim next
3. Cleanup: cleanup(parent,dryRun:true)→review→cleanup(parent)`;

  public inputSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['add', 'claim', 'release', 'list', 'status', 'sync', 'merge', 'remove', 'batch-add', 'cleanup'],
        description: 'Worktree operation to perform'
      },

      // Common parameters
      parentScriptId: {
        type: 'string',
        description: 'Parent project script ID (required for: add, claim, list, batch-add, cleanup)'
      },
      worktreeScriptId: {
        type: 'string',
        description: 'Worktree script ID (required for: release, status, sync, merge, remove)'
      },
      agentId: {
        type: 'string',
        description: 'Agent ID for tracking (auto-generated if not provided)'
      },

      // add operation
      branchName: {
        type: 'string',
        description: 'User-friendly branch name (UUID appended automatically). Required for add.'
      },
      claimImmediately: {
        type: 'boolean',
        default: true,
        description: 'Claim worktree immediately for calling agent (add operation)'
      },

      // claim operation
      createIfNone: {
        type: 'boolean',
        default: true,
        description: 'Create new worktree if none available (claim operation)'
      },
      validateHealth: {
        type: 'boolean',
        default: true,
        description: 'Verify GAS/local exist before claiming (claim operation)'
      },

      // release operation
      force: {
        type: 'boolean',
        default: false,
        description: 'Skip uncommitted changes check (release) or allow remove without merge warning (remove)'
      },

      // list operation
      state: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['CREATING', 'READY', 'CLAIMED', 'MERGING', 'MERGED', 'FAILED', 'REMOVED', 'REMOVING', 'ORPHAN_GAS_DELETED', 'ORPHAN_LOCAL_DELETED']
        },
        description: 'Filter by states (list operation)'
      },
      includeOrphans: {
        type: 'boolean',
        default: false,
        description: 'Include potentially orphaned worktrees (list operation)'
      },

      // sync operation
      dryRun: {
        type: 'boolean',
        default: false,
        description: 'Preview only, do not apply changes (sync, merge, cleanup operations)'
      },
      refreshBaseHashes: {
        type: 'boolean',
        default: false,
        description: 'Update baseHashes from current parent state (sync operation)'
      },

      // merge operation
      deleteAfterMerge: {
        type: 'boolean',
        default: false,
        description: 'Delete worktree after merge (merge operation)'
      },
      pushToRemote: {
        type: 'boolean',
        default: true,
        description: 'Push to git remote after merge (merge operation)'
      },

      // remove operation
      keepForDiagnostics: {
        type: 'boolean',
        default: false,
        description: 'Keep entry for diagnostics (remove operation)'
      },

      // batch-add operation
      count: {
        type: 'number',
        minimum: 1,
        maximum: 10,
        description: 'Number of worktrees to create (1-10) for batch-add operation'
      },
      branchPrefix: {
        type: 'string',
        description: 'Branch name prefix for batch-add operation'
      },
      claimAll: {
        type: 'boolean',
        default: true,
        description: 'Claim all worktrees immediately (batch-add operation)'
      },
      stopOnFirstFailure: {
        type: 'boolean',
        default: false,
        description: 'Stop on first failure (batch-add operation)'
      },

      // cleanup operation
      maxAge: {
        type: 'number',
        default: 24,
        description: 'Hours since claimedAt to consider stale (cleanup operation)'
      },
      includeOrphanedGas: {
        type: 'boolean',
        default: false,
        description: 'Check if GAS projects still exist (cleanup operation)'
      },
      includeOrphanedLocal: {
        type: 'boolean',
        default: false,
        description: 'Check if local folders still exist (cleanup operation)'
      }
    },
    required: ['operation']
  };

  private lockManager: WorktreeLockManager;
  private stateManager: WorktreeStateManager;
  private addOperation: WorktreeAddOperation;
  private removeOperation: WorktreeRemoveOperation;
  private statusOperation: WorktreeStatusOperation;
  private initialized = false;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.lockManager = WorktreeLockManager.getInstance();
    this.stateManager = WorktreeStateManager.getInstance();
    this.addOperation = new WorktreeAddOperation(this.gasClient);
    this.removeOperation = new WorktreeRemoveOperation(this.gasClient);
    this.statusOperation = new WorktreeStatusOperation(this.gasClient);
  }

  /**
   * Initialize managers if not already done
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    const workingDir = await McpGasConfigManager.getWorkingDir();
    const configPath = `${workingDir}/gas-config.json`;

    await this.lockManager.initialize(configPath);
    await this.lockManager.cleanupStaleLocks();

    this.initialized = true;
    console.error(`🔧 [WORKTREE] Tool initialized with config: ${configPath}`);
  }

  /**
   * Execute worktree operation
   */
  async execute(params: WorktreeInput): Promise<
    | WorktreeAddResult
    | WorktreeClaimResult
    | WorktreeReleaseResult
    | WorktreeListResult
    | WorktreeStatusResult
    | WorktreeSyncResult
    | WorktreeMergeResult
    | WorktreeMergePreview
    | WorktreeRemoveResult
    | WorktreeBatchAddResult
    | WorktreeCleanupResult
    | WorktreeError
  > {
    try {
      await this.ensureInitialized();

      switch (params.operation) {
        case 'add':
          return await this.executeAdd(params as WorktreeAddInput);

        case 'claim':
          return await this.executeClaim(params as WorktreeClaimInput);

        case 'release':
          return await this.executeRelease(params as WorktreeReleaseInput);

        case 'list':
          return await this.executeList(params as WorktreeListInput);

        case 'status':
          return await this.executeStatus(params as WorktreeStatusInput);

        case 'sync':
          return await this.executeSync(params as WorktreeSyncInput);

        case 'merge':
          return await this.executeMerge(params as WorktreeMergeInput);

        case 'remove':
          return await this.executeRemove(params as WorktreeRemoveInput);

        case 'batch-add':
          return await this.executeBatchAdd(params as WorktreeBatchAddInput);

        case 'cleanup':
          return await this.executeCleanup(params as WorktreeCleanupInput);

        default:
          return this.createError(
            'UNEXPECTED_ERROR',
            `Unknown operation: ${(params as any).operation}`
          );
      }
    } catch (error: any) {
      return this.handleError(error);
    }
  }

  // ============================================================================
  // Operation Implementations (Stubs - to be implemented in Phase 2/3)
  // ============================================================================

  /**
   * Add operation: Create new worktree with GAS project + git branch
   */
  private async executeAdd(params: WorktreeAddInput): Promise<WorktreeAddResult | WorktreeError> {
    // Validate required parameters
    if (!params.parentScriptId) {
      return this.createError('PARENT_NOT_FOUND', 'parentScriptId is required for add operation');
    }
    if (!params.branchName) {
      return this.createError('BRANCH_NAME_REQUIRED', 'branchName is required for add operation');
    }

    // Get access token for GAS API calls
    const accessToken = await this.getAuthToken(params);

    // Execute the add operation
    return this.addOperation.execute(params, accessToken);
  }

  // Maximum orphan recovery attempts before giving up
  private static readonly MAX_ORPHAN_RECOVERY_ATTEMPTS = 10;

  /**
   * Claim operation: Claim an available worktree for exclusive use
   */
  private async executeClaim(params: WorktreeClaimInput, orphanRecoveryAttempts = 0): Promise<WorktreeClaimResult | WorktreeError> {
    if (!params.parentScriptId) {
      return this.createError('PARENT_NOT_FOUND', 'parentScriptId is required for claim operation');
    }

    const { parentScriptId, agentId, createIfNone = true, branchName, validateHealth = true } = params;
    const claimAgentId = agentId || `agent-${Date.now()}`;

    // Find available READY worktree
    const available = await this.stateManager.findAvailable(parentScriptId);

    if (available) {
      // Validate health if requested
      if (validateHealth) {
        const accessToken = await this.getAuthToken(params);
        try {
          await this.gasClient.getProject(available.scriptId, accessToken);
        } catch (error) {
          // GAS project deleted - mark as orphan and try to find another
          await this.stateManager.markOrphanGasDeleted(available.scriptId);

          // Check recursion limit to prevent infinite loop
          if (orphanRecoveryAttempts >= WorktreeTool.MAX_ORPHAN_RECOVERY_ATTEMPTS) {
            return this.createError(
              'NO_AVAILABLE_WORKTREES',
              `All ${orphanRecoveryAttempts} available worktrees are orphaned. Run cleanup operation.`
            );
          }

          // Recursively try to find another (with incremented counter)
          return this.executeClaim(params, orphanRecoveryAttempts + 1);
        }
      }

      // Claim the worktree
      const entry = await this.stateManager.claim(available.scriptId, claimAgentId);

      return {
        success: true,
        worktree: {
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
        },
        created: false
      };
    }

    // No available worktree - create one if allowed
    if (!createIfNone) {
      return this.createError('NO_AVAILABLE_WORKTREES', 'No available worktrees and createIfNone is false');
    }

    if (!branchName) {
      return this.createError('BRANCH_NAME_REQUIRED', 'branchName is required when creating new worktree');
    }

    // Create new worktree via add operation
    const addResult = await this.executeAdd({
      operation: 'add',
      parentScriptId,
      branchName,
      claimImmediately: true,
      agentId: claimAgentId
    });

    if ('error' in addResult) {
      return addResult;
    }

    return {
      success: true,
      worktree: addResult.worktree,
      created: true
    };
  }

  /**
   * Release operation: Return worktree to READY state
   */
  private async executeRelease(params: WorktreeReleaseInput): Promise<WorktreeReleaseResult | WorktreeError> {
    if (!params.worktreeScriptId) {
      return this.createError('WORKTREE_NOT_FOUND', 'worktreeScriptId is required for release operation');
    }

    const { worktreeScriptId, force = false } = params;
    const warnings: string[] = [];

    // Get worktree entry
    const entry = await this.stateManager.getEntry(worktreeScriptId);
    if (!entry) {
      return this.createError('WORKTREE_NOT_FOUND', `Worktree ${worktreeScriptId} not found`);
    }

    // Verify it's in CLAIMED state
    if (entry.state !== 'CLAIMED') {
      return this.createError('INVALID_STATE_TRANSITION', `Cannot release worktree in state ${entry.state}`);
    }

    // Check for uncommitted changes unless force
    if (!force) {
      try {
        const statusOutput = await this.execGitCommand(['status', '--porcelain'], entry.localPath);
        const uncommittedCount = statusOutput.split('\n').filter(line => line.trim()).length;
        if (uncommittedCount > 0) {
          return this.createError(
            'UNCOMMITTED_CHANGES',
            `Worktree has ${uncommittedCount} uncommitted changes. Use force=true to release anyway.`
          );
        }
      } catch (error: any) {
        warnings.push(`Could not check git status: ${error.message}`);
      }
    } else {
      warnings.push('Released with force flag - uncommitted changes may exist');
    }

    // Release the worktree
    await this.stateManager.release(worktreeScriptId);

    return {
      success: true,
      state: 'READY',
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Execute git command safely (helper for inline operations)
   */
  private execGitCommand(args: string[], cwd: string): Promise<string> {
    const { spawn } = require('child_process');
    return new Promise((resolve, reject) => {
      const git = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      git.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      git.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      git.on('close', (code: number) => {
        code === 0 ? resolve(stdout) : reject(new Error(stderr || `Exit code ${code}`));
      });
      git.on('error', reject);
    });
  }

  /**
   * List operation: List all worktrees filtered by parent/state
   */
  private async executeList(params: WorktreeListInput): Promise<WorktreeListResult | WorktreeError> {
    // TODO: Implement in Phase 2
    // 1. Read config (no lock needed for read-only)
    // 2. Filter by parentScriptId if provided
    // 3. Filter by states if provided
    // 4. Add orphan detection if includeOrphans
    // 5. Return list with WorktreeListItem format

    const config = await this.lockManager.readWorktreesConfig();
    const worktrees = Object.values(config.worktrees);

    // Basic filtering
    let filtered = worktrees;

    if (params.parentScriptId) {
      filtered = filtered.filter(wt => wt.parentScriptId === params.parentScriptId);
    }

    if (params.state && params.state.length > 0) {
      filtered = filtered.filter(wt => params.state!.includes(wt.state));
    }

    // Map to list items with orphan detection
    const items = filtered.map(wt => ({
      scriptId: wt.scriptId,
      parentScriptId: wt.parentScriptId,
      branch: wt.branch,
      localPath: wt.localPath,
      state: wt.state,
      containerId: wt.containerId,
      containerType: wt.containerType,
      claimedBy: wt.claimedBy,
      claimedAt: wt.claimedAt,
      createdAt: wt.createdAt,
      isOrphan: this.isOrphanCandidate(wt)
    }));

    return { worktrees: items };
  }

  /**
   * Status operation: Get detailed worktree status with divergence info
   */
  private async executeStatus(params: WorktreeStatusInput): Promise<WorktreeStatusResult | WorktreeError> {
    if (!params.worktreeScriptId) {
      return this.createError('WORKTREE_NOT_FOUND', 'worktreeScriptId is required for status operation');
    }

    // Get access token for GAS API calls
    const accessToken = await this.getAuthToken(params);

    // Execute the status operation
    return this.statusOperation.execute(params, accessToken);
  }

  /**
   * Sync operation: Pull parent changes to worktree
   */
  private async executeSync(params: WorktreeSyncInput): Promise<WorktreeSyncResult | WorktreeError> {
    if (!params.worktreeScriptId) {
      return this.createError('WORKTREE_NOT_FOUND', 'worktreeScriptId is required for sync operation');
    }

    const { worktreeScriptId, dryRun = false, refreshBaseHashes = false } = params;

    // Get worktree entry
    const entry = await this.stateManager.getEntry(worktreeScriptId);
    if (!entry) {
      return this.createError('WORKTREE_NOT_FOUND', `Worktree ${worktreeScriptId} not found`);
    }

    // Get access token
    const accessToken = await this.getAuthToken(params);

    // Get current files from parent and worktree
    const parentFiles = await this.gasClient.getProjectContent(entry.parentScriptId, accessToken);
    const worktreeFiles = await this.gasClient.getProjectContent(worktreeScriptId, accessToken);

    // Build file maps with hashes (computeGitSha1 imported at module level)

    const parentFileMap = new Map<string, { source: string; hash: string }>();
    for (const file of parentFiles) {
      const name = normalizeFileName(file.name, file.type);
      parentFileMap.set(name, {
        source: file.source || '',
        hash: computeGitSha1(file.source || '')
      });
    }

    const worktreeFileMap = new Map<string, { source: string; hash: string }>();
    for (const file of worktreeFiles) {
      const name = normalizeFileName(file.name, file.type);
      worktreeFileMap.set(name, {
        source: file.source || '',
        hash: computeGitSha1(file.source || '')
      });
    }

    const baseHashes = entry.baseHashes || {};

    // Categorize changes
    const synced: string[] = [];
    const conflicts: string[] = [];
    const skipped: string[] = [];
    const allFiles = new Set([...parentFileMap.keys(), ...worktreeFileMap.keys()]);

    // Files to update in worktree
    const filesToUpdate: Array<{ name: string; source: string }> = [];

    for (const fileName of allFiles) {
      const parent = parentFileMap.get(fileName);
      const worktree = worktreeFileMap.get(fileName);
      const baseHash = baseHashes[fileName];

      // New file in parent - add to worktree if worktree doesn't have it
      if (parent && !worktree && !baseHash) {
        filesToUpdate.push({ name: fileName, source: parent.source });
        synced.push(fileName);
        continue;
      }

      // File deleted in parent - skip (worktree keeps its version)
      if (!parent && worktree && baseHash) {
        skipped.push(fileName);
        continue;
      }

      // Both have file - check for modifications
      if (parent && worktree) {
        const worktreeModified = baseHash && worktree.hash !== baseHash;
        const parentModified = baseHash && parent.hash !== baseHash;

        if (parentModified && !worktreeModified) {
          // Only parent changed - safe to sync
          filesToUpdate.push({ name: fileName, source: parent.source });
          synced.push(fileName);
        } else if (parentModified && worktreeModified) {
          // Both changed - conflict
          if (parent.hash !== worktree.hash) {
            conflicts.push(fileName);
          }
          // Same change in both - no action needed
        }
        // Only worktree changed or no changes - skip
      }
    }

    // Return preview if dry run
    if (dryRun) {
      return {
        synced,
        conflicts,
        skipped
      };
    }

    // Apply changes to worktree GAS
    if (filesToUpdate.length > 0) {
      // Merge with existing worktree files
      const updatedFiles = [...worktreeFiles];
      for (const update of filesToUpdate) {
        const existing = updatedFiles.find(f => normalizeFileName(f.name, f.type) === update.name);
        if (existing) {
          existing.source = update.source;
        } else {
          // Add new file (need to determine type from extension)
          const ext = update.name.split('.').pop()?.toLowerCase();
          const type = ext === 'html' ? 'HTML' : ext === 'json' ? 'JSON' : 'SERVER_JS';
          const name = update.name.replace(/\.(gs|html|json)$/, '');
          updatedFiles.push({ name, type, source: update.source } as any);
        }
      }

      try {
        await this.gasClient.updateProjectContent(worktreeScriptId, updatedFiles, accessToken);
      } catch (error: any) {
        return this.createError('SYNC_FAILED', `Failed to push synced files to GAS: ${error.message}`);
      }
    }

    // Update baseHashes if requested
    if (refreshBaseHashes) {
      const newBaseHashes: Record<string, string> = {};
      for (const [name, data] of parentFileMap) {
        newBaseHashes[name] = data.hash;
      }
      await this.stateManager.updateBaseHashes(worktreeScriptId, newBaseHashes);
    }

    // Update lastSyncedAt
    await this.stateManager.updateLastSynced(worktreeScriptId);

    return {
      synced,
      conflicts,
      skipped
    };
  }

  /**
   * Merge operation: Merge worktree changes back to parent
   */
  private async executeMerge(params: WorktreeMergeInput): Promise<WorktreeMergeResult | WorktreeMergePreview | WorktreeError> {
    if (!params.worktreeScriptId) {
      return this.createError('WORKTREE_NOT_FOUND', 'worktreeScriptId is required for merge operation');
    }

    const { worktreeScriptId, deleteAfterMerge = false, dryRun = false, pushToRemote = true } = params;
    const warnings: string[] = [];

    // Get worktree entry
    const entry = await this.stateManager.getEntry(worktreeScriptId);
    if (!entry) {
      return this.createError('WORKTREE_NOT_FOUND', `Worktree ${worktreeScriptId} not found`);
    }

    // Check for stuck MERGING state and recover
    const recovered = await this.stateManager.recoverStuckMerge(entry.parentScriptId);
    if (recovered && recovered.scriptId === worktreeScriptId) {
      warnings.push('Recovered from stuck MERGING state');
    }

    // Verify state allows merge
    if (entry.state !== 'CLAIMED' && entry.state !== 'READY') {
      return this.createError('INVALID_STATE_TRANSITION', `Cannot merge worktree in state ${entry.state}`);
    }

    const parentGitPath = this.getParentGitPath(entry.parentScriptId);

    // If dry run, return preview
    if (dryRun) {
      const statusResult = await this.executeStatus({ operation: 'status', worktreeScriptId });
      if ('error' in statusResult) {
        return statusResult;
      }

      return {
        preview: {
          filesToAdd: statusResult.divergence.filesOnlyInWorktree,
          filesToModify: statusResult.divergence.filesModifiedInWorktree,
          filesToDelete: [],
          conflicts: statusResult.divergence.conflicts,
          mergeable: statusResult.mergeable
        }
      };
    }

    // Get access token
    const accessToken = await this.getAuthToken(params);

    // Transition to MERGING
    await this.stateManager.startMerge(worktreeScriptId);

    // Track whether we've created a commit (for proper rollback)
    let commitCreated = false;

    try {
      // Get default branch
      const defaultBranch = await this.getDefaultBranch(parentGitPath);

      // Commit any uncommitted changes in worktree
      try {
        const status = await this.execGitCommand(['status', '--porcelain'], entry.localPath);
        if (status.trim()) {
          await this.execGitCommand(['add', '-A'], entry.localPath);
          await this.execGitCommand(['commit', '-m', 'Auto-commit before merge'], entry.localPath);
        }
      } catch {
        // No changes to commit - continue
      }

      // Checkout main branch in parent repo
      await this.execGitCommand(['checkout', defaultBranch], parentGitPath);

      // Squash merge the worktree branch
      await this.execGitCommand(['merge', '--squash', entry.branch], parentGitPath);

      // Create squash commit
      const featureDesc = entry.branch.replace('llm-feature-', '').replace(/-[a-f0-9]{8}$/, '');
      const commitMessage = `Feature: ${featureDesc}`;
      await this.execGitCommand(['commit', '-m', commitMessage], parentGitPath);
      commitCreated = true;

      // Get commit SHA
      const commitSha = (await this.execGitCommand(['rev-parse', 'HEAD'], parentGitPath)).trim();

      // Push worktree files to parent GAS
      const worktreeFiles = await this.gasClient.getProjectContent(worktreeScriptId, accessToken);
      await this.gasClient.updateProjectContent(entry.parentScriptId, worktreeFiles, accessToken);

      // Push to remote if requested
      let pushedToRemote = false;
      if (pushToRemote) {
        try {
          await this.execGitCommand(['push', 'origin', defaultBranch], parentGitPath);
          pushedToRemote = true;
        } catch (error: any) {
          warnings.push(`Failed to push to remote: ${error.message}`);
        }
      }

      // Transition to MERGED
      await this.stateManager.completeMerge(worktreeScriptId, commitSha);

      // Delete worktree if requested
      const finalState: 'MERGED' | 'READY' = 'MERGED';
      if (deleteAfterMerge) {
        const removeResult = await this.executeRemove({
          operation: 'remove',
          worktreeScriptId,
          force: true
        });
        if ('error' in removeResult) {
          warnings.push(`Failed to delete worktree: ${removeResult.message}`);
        }
      }

      return {
        merged: true,
        commitSha,
        filesChanged: worktreeFiles.length,
        pushedToRemote,
        worktreeState: finalState,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    } catch (error: any) {
      // Rollback on failure
      await this.stateManager.rollbackMerge(worktreeScriptId, error.message);

      try {
        // If commit was created, we need to undo it with HEAD~1
        // Otherwise just reset staged changes with HEAD
        const resetTarget = commitCreated ? 'HEAD~1' : 'HEAD';
        await this.execGitCommand(['reset', '--hard', resetTarget], parentGitPath);
      } catch {
        warnings.push('Failed to reset parent repo after merge failure');
      }

      return this.createError('MERGE_CONFLICT', `Merge failed: ${error.message}`);
    }
  }

  /**
   * Get default branch name (main or master)
   */
  private async getDefaultBranch(gitPath: string): Promise<string> {
    try {
      const symbolicRef = await this.execGitCommand(['symbolic-ref', 'refs/remotes/origin/HEAD'], gitPath);
      return symbolicRef.trim().replace('refs/remotes/origin/', '');
    } catch {
      try {
        await this.execGitCommand(['rev-parse', '--verify', 'main'], gitPath);
        return 'main';
      } catch {
        return 'master';
      }
    }
  }

  /**
   * Get parent git path helper
   */
  private getParentGitPath(parentScriptId: string): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
    const path = require('path');
    return path.join(homeDir, 'gas-repos', `project-${parentScriptId}`);
  }

  /**
   * Remove operation: Delete worktree and cleanup resources
   */
  private async executeRemove(params: WorktreeRemoveInput): Promise<WorktreeRemoveResult | WorktreeError> {
    if (!params.worktreeScriptId) {
      return this.createError('WORKTREE_NOT_FOUND', 'worktreeScriptId is required for remove operation');
    }

    // Get access token for GAS API calls
    const accessToken = await this.getAuthToken(params);

    // Execute the remove operation
    return this.removeOperation.execute(params, accessToken);
  }

  /**
   * Batch-add operation: Create multiple worktrees in parallel
   */
  private async executeBatchAdd(params: WorktreeBatchAddInput): Promise<WorktreeBatchAddResult | WorktreeError> {
    if (!params.parentScriptId) {
      return this.createError('PARENT_NOT_FOUND', 'parentScriptId is required for batch-add operation');
    }
    if (!params.count || params.count < 1 || params.count > 10) {
      return this.createError('UNEXPECTED_ERROR', 'count must be between 1 and 10 for batch-add operation');
    }
    if (!params.branchPrefix) {
      return this.createError('BRANCH_NAME_REQUIRED', 'branchPrefix is required for batch-add operation');
    }

    const { parentScriptId, count, branchPrefix, claimAll = true, stopOnFirstFailure = false, agentId } = params;
    const CONCURRENCY_LIMIT = 3;

    // Generate unique branch names
    const branchNames: string[] = [];
    for (let i = 0; i < count; i++) {
      branchNames.push(`${branchPrefix}-${i + 1}`);
    }

    const worktrees: WorktreeBatchAddResult['worktrees'] = [];
    const failed: WorktreeBatchAddResult['failed'] = [];

    // Process in batches with concurrency limit
    for (let i = 0; i < branchNames.length; i += CONCURRENCY_LIMIT) {
      const batch = branchNames.slice(i, i + CONCURRENCY_LIMIT);

      const results = await Promise.all(
        batch.map(async (branchName) => {
          try {
            const result = await this.executeAdd({
              operation: 'add',
              parentScriptId,
              branchName,
              claimImmediately: claimAll,
              agentId
            });

            if ('error' in result) {
              return { branchName, error: result };
            }

            return { branchName, result };
          } catch (error: any) {
            return { branchName, error: this.createError('UNEXPECTED_ERROR', error.message) };
          }
        })
      );

      // Process results
      for (const { branchName, result, error } of results) {
        if (error) {
          failed.push({
            branchName,
            error: error.message,
            errorCode: error.error,
            state: 'FAILED',
            cleanup: {
              gasProjectTrashed: false,
              containerTrashed: false,
              branchDeleted: false,
              localFolderDeleted: false
            }
          });

          if (stopOnFirstFailure) {
            return {
              success: false,
              worktrees,
              failed,
              created: worktrees.length,
              failedCount: failed.length,
              message: `Stopped after failure creating branch ${branchName}`
            };
          }
        } else if (result) {
          worktrees.push(result.worktree);
        }
      }
    }

    return {
      success: failed.length === 0,
      worktrees,
      failed,
      created: worktrees.length,
      failedCount: failed.length,
      message: failed.length === 0
        ? `Successfully created ${worktrees.length} worktrees`
        : `Created ${worktrees.length}, failed ${failed.length}`
    };
  }

  /**
   * Cleanup operation: Remove orphaned and stale worktrees
   */
  private async executeCleanup(params: WorktreeCleanupInput): Promise<WorktreeCleanupResult | WorktreeError> {
    const {
      parentScriptId,
      maxAge = 24,
      includeOrphanedGas = false,
      includeOrphanedLocal = false,
      dryRun = false
    } = params;

    const config = await this.lockManager.readWorktreesConfig();
    const worktrees = Object.values(config.worktrees);

    // Filter by parent if specified
    const filtered = parentScriptId
      ? worktrees.filter(wt => wt.parentScriptId === parentScriptId)
      : worktrees;

    type OrphanType = 'STALE_CLAIM' | 'GAS_DELETED' | 'LOCAL_DELETED' | 'FAILED';
    const orphans: Array<{
      scriptId: string;
      orphanType: OrphanType;
      claimedAt?: string;
      age?: string;
      reason: string;
    }> = [];

    const summary = {
      staleClaimsFound: 0,
      gasDeletedFound: 0,
      localDeletedFound: 0,
      failedFound: 0
    };

    // Get auth token once outside loop (only if needed for GAS validation)
    let accessToken: string | undefined;
    if (includeOrphanedGas) {
      accessToken = await this.getAuthToken(params);
    }

    for (const wt of filtered) {
      // 1. Find FAILED state entries
      if (wt.state === 'FAILED') {
        orphans.push({
          scriptId: wt.scriptId,
          orphanType: 'FAILED',
          reason: 'FAILED state'
        });
        summary.failedFound++;
        continue;
      }

      // 2. Find stale claims (>maxAge hours)
      if (wt.state === 'CLAIMED' && wt.claimedAt) {
        const hoursSinceClaim = (Date.now() - new Date(wt.claimedAt).getTime()) / (1000 * 60 * 60);
        if (hoursSinceClaim > maxAge) {
          orphans.push({
            scriptId: wt.scriptId,
            orphanType: 'STALE_CLAIM',
            claimedAt: wt.claimedAt,
            age: `${Math.floor(hoursSinceClaim)}h`,
            reason: `Stale claim (${Math.floor(hoursSinceClaim)}h old)`
          });
          summary.staleClaimsFound++;
          continue;
        }
      }

      // 3. Find GAS-deleted orphans if requested
      if (includeOrphanedGas && wt.state !== 'REMOVED' && accessToken) {
        try {
          await this.gasClient.getProject(wt.scriptId, accessToken);
        } catch {
          orphans.push({
            scriptId: wt.scriptId,
            orphanType: 'GAS_DELETED',
            reason: 'GAS project deleted'
          });
          summary.gasDeletedFound++;
          continue;
        }
      }

      // 4. Find local-deleted orphans if requested
      if (includeOrphanedLocal && wt.localPath) {
        try {
          await fs.access(wt.localPath);
        } catch {
          orphans.push({
            scriptId: wt.scriptId,
            orphanType: 'LOCAL_DELETED',
            reason: 'Local directory missing'
          });
          summary.localDeletedFound++;
          continue;
        }
      }

      // Already orphan-marked states
      if (wt.state === 'ORPHAN_GAS_DELETED') {
        orphans.push({
          scriptId: wt.scriptId,
          orphanType: 'GAS_DELETED',
          reason: `Marked as ${wt.state}`
        });
        summary.gasDeletedFound++;
      } else if (wt.state === 'ORPHAN_LOCAL_DELETED') {
        orphans.push({
          scriptId: wt.scriptId,
          orphanType: 'LOCAL_DELETED',
          reason: `Marked as ${wt.state}`
        });
        summary.localDeletedFound++;
      }
    }

    // If dry run, return preview only
    if (dryRun) {
      return {
        orphans,
        cleaned: 0,
        kept: orphans.length,
        summary
      };
    }

    // Actually remove
    let cleaned = 0;
    const errors: string[] = [];

    for (const orphan of orphans) {
      try {
        const result = await this.executeRemove({
          operation: 'remove',
          worktreeScriptId: orphan.scriptId,
          force: true
        });

        if ('error' in result) {
          errors.push(`Failed to remove ${orphan.scriptId}: ${result.message}`);
        } else {
          cleaned++;
        }
      } catch (error: any) {
        errors.push(`Failed to remove ${orphan.scriptId}: ${error.message}`);
      }
    }

    return {
      orphans,
      cleaned,
      kept: orphans.length - cleaned,
      errors: errors.length > 0 ? errors : undefined,
      summary
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  // Threshold for stale CLAIMED state (matches WorktreeStateManager)
  private static readonly STALE_CLAIM_HOURS = 24;

  /**
   * Check if a worktree entry might be orphaned
   */
  private isOrphanCandidate(entry: { state: string; claimedAt?: string }): boolean {
    if (entry.state !== 'CLAIMED') return false;
    if (!entry.claimedAt) return false;

    const hoursSinceClaim = (Date.now() - new Date(entry.claimedAt).getTime()) / (1000 * 60 * 60);
    return hoursSinceClaim > WorktreeTool.STALE_CLAIM_HOURS;
  }

  /**
   * Create a standardized error response
   */
  private createError(code: WorktreeErrorCode, message: string, details?: Record<string, unknown>): WorktreeError {
    return {
      success: false,
      error: code,
      message,
      details
    };
  }

  /**
   * Handle caught errors and convert to WorktreeError
   */
  private handleError(error: any): WorktreeError {
    if (error instanceof WorktreeNotFoundError) {
      return this.createError('WORKTREE_NOT_FOUND', error.message, { scriptId: error.scriptId });
    }

    if (error instanceof InvalidStateTransitionError) {
      return this.createError('INVALID_STATE_TRANSITION', error.message, {
        scriptId: error.scriptId,
        fromState: error.fromState,
        toState: error.toState
      });
    }

    // Check for lock timeout
    if (error.name === 'WorktreeLockTimeoutError') {
      return this.createError('LOCK_TIMEOUT', error.message, {
        timeout: error.timeout,
        operation: error.operation
      });
    }

    // Generic error
    return this.createError('UNEXPECTED_ERROR', error.message || 'An unexpected error occurred');
  }
}
