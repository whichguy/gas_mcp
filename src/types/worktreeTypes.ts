/**
 * @fileoverview Worktree system types for parallel GAS development
 *
 * USAGE: Enable multiple Claude Code agents to work concurrently on isolated
 * GAS projects while sharing git history through real git worktrees.
 *
 * KEY DESIGN:
 * - Each worktree = separate GAS project (own scriptId) + git worktree branch
 * - State machine tracks lifecycle: CREATING → READY → CLAIMED → MERGED
 * - File locking prevents concurrent config corruption
 */

/**
 * Worktree lifecycle states
 */
export type WorktreeState =
  | 'CREATING'           // Worktree creation in progress
  | 'READY'              // Available for use, not claimed
  | 'CLAIMED'            // In use by an agent
  | 'MERGING'            // Being merged back to parent
  | 'MERGED'             // Successfully merged
  | 'FAILED'             // Creation failed, needs cleanup
  | 'REMOVED'            // Deleted (entry kept for audit)
  | 'REMOVING'           // Removal in progress
  | 'ORPHAN_GAS_DELETED' // GAS project deleted externally
  | 'ORPHAN_LOCAL_DELETED'; // Local folder deleted externally

/**
 * Container types for GAS projects
 */
export type ContainerType = 'SHEETS' | 'DOCS' | 'FORMS' | 'SLIDES' | 'STANDALONE';

/**
 * Configuration lock for concurrency control
 */
export interface WorktreeLock {
  /** Process ID or agent ID holding the lock */
  holder: string;
  /** Hostname of machine holding lock (for multi-machine detection) */
  hostname: string;
  /** ISO timestamp when lock was acquired */
  acquiredAt: string;
  /** What operation holds the lock */
  operation: string;
  /** ISO timestamp when lock auto-expires */
  expiresAt: string;
}

/**
 * Worktree entry stored in gas-config.json
 */
export interface WorktreeEntry {
  /** Script ID of the worktree GAS project */
  scriptId: string;
  /** Script ID of the parent GAS project */
  parentScriptId: string;
  /** Container ID (Sheet/Doc ID) if container-bound */
  containerId?: string;
  /** Parent container ID if container-bound */
  parentContainerId?: string;
  /** Type of container */
  containerType: ContainerType;
  /** Git branch name (llm-feature-{name}-{uuid8}) */
  branch: string;
  /** Local git worktree path */
  localPath: string;
  /** Current lifecycle state */
  state: WorktreeState;
  /** Agent ID that claimed this worktree */
  claimedBy?: string;
  /** ISO timestamp when claimed */
  claimedAt?: string;
  /** ISO timestamp when MERGING started (for timeout recovery) */
  mergingStartedAt?: string;
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp when last synced from parent */
  lastSyncedAt?: string;
  /** ISO timestamp when removed */
  removedAt?: string;
  /** Whether git push to remote is pending */
  pendingRemotePush?: boolean;
  /** File hashes at worktree creation (for conflict detection) */
  baseHashes?: Record<string, string>;
  /** ISO timestamp when baseHashes were last updated */
  baseHashesUpdatedAt?: string;
  /** Error message if state is FAILED */
  error?: string;
  /** Error code for categorization */
  errorCode?: string;
  /** Batch ID if created via batch-add */
  batchId?: string;
}

/**
 * Worktrees section in gas-config.json
 */
export interface WorktreesConfig {
  /** Worktree entries keyed by scriptId */
  worktrees: Record<string, WorktreeEntry>;
  /** Configuration lock */
  lock?: WorktreeLock;
}

// ============================================================================
// Operation Input Types
// ============================================================================

/**
 * Base input for all worktree operations
 */
export interface WorktreeOperationBase {
  operation: string;
}

/**
 * Input for 'add' operation
 */
export interface WorktreeAddInput extends WorktreeOperationBase {
  operation: 'add';
  /** Parent project script ID */
  parentScriptId: string;
  /** User-friendly branch name (UUID appended automatically) */
  branchName: string;
  /** Claim worktree immediately for calling agent (default: true) */
  claimImmediately?: boolean;
  /** Agent ID for tracking (auto-generated if not provided) */
  agentId?: string;
}

/**
 * Input for 'claim' operation
 */
export interface WorktreeClaimInput extends WorktreeOperationBase {
  operation: 'claim';
  /** Parent project script ID */
  parentScriptId: string;
  /** Agent ID for tracking */
  agentId?: string;
  /** Create new worktree if none available (default: true) */
  createIfNone?: boolean;
  /** Branch name (required if createIfNone and creating new) */
  branchName?: string;
  /** Verify GAS/local exist before claiming (default: true) */
  validateHealth?: boolean;
}

/**
 * Input for 'release' operation
 */
export interface WorktreeReleaseInput extends WorktreeOperationBase {
  operation: 'release';
  /** Worktree script ID */
  worktreeScriptId: string;
  /** Skip uncommitted changes check */
  force?: boolean;
}

/**
 * Input for 'list' operation
 */
export interface WorktreeListInput extends WorktreeOperationBase {
  operation: 'list';
  /** Filter by parent script ID */
  parentScriptId?: string;
  /** Filter by states */
  state?: WorktreeState[];
  /** Include potentially orphaned worktrees */
  includeOrphans?: boolean;
}

/**
 * Input for 'status' operation
 */
export interface WorktreeStatusInput extends WorktreeOperationBase {
  operation: 'status';
  /** Worktree script ID */
  worktreeScriptId: string;
}

/**
 * Input for 'sync' operation
 */
export interface WorktreeSyncInput extends WorktreeOperationBase {
  operation: 'sync';
  /** Worktree script ID */
  worktreeScriptId: string;
  /** Preview only, don't apply changes */
  dryRun?: boolean;
  /** Update baseHashes from current parent state */
  refreshBaseHashes?: boolean;
}

/**
 * Input for 'merge' operation
 */
export interface WorktreeMergeInput extends WorktreeOperationBase {
  operation: 'merge';
  /** Worktree script ID */
  worktreeScriptId: string;
  /** Delete worktree after merge (default: false) */
  deleteAfterMerge?: boolean;
  /** Preview only, don't apply changes */
  dryRun?: boolean;
  /** Push to git remote after merge (default: true) */
  pushToRemote?: boolean;
}

/**
 * Input for 'remove' operation
 */
export interface WorktreeRemoveInput extends WorktreeOperationBase {
  operation: 'remove';
  /** Worktree script ID */
  worktreeScriptId: string;
  /** Keep entry for diagnostics (default: false) */
  keepForDiagnostics?: boolean;
  /** Allow remove without merge warning */
  force?: boolean;
}

/**
 * Input for 'batch-add' operation
 */
export interface WorktreeBatchAddInput extends WorktreeOperationBase {
  operation: 'batch-add';
  /** Parent project script ID */
  parentScriptId: string;
  /** Number of worktrees to create (1-10) */
  count: number;
  /** Branch name prefix */
  branchPrefix: string;
  /** Claim all worktrees immediately (default: true) */
  claimAll?: boolean;
  /** Stop on first failure (default: false) */
  stopOnFirstFailure?: boolean;
  /** Agent ID for tracking */
  agentId?: string;
}

/**
 * Input for 'cleanup' operation
 */
export interface WorktreeCleanupInput extends WorktreeOperationBase {
  operation: 'cleanup';
  /** Filter by parent script ID */
  parentScriptId?: string;
  /** Hours since claimedAt to consider stale (default: 24) */
  maxAge?: number;
  /** Preview only, don't delete */
  dryRun?: boolean;
  /** Check if GAS projects still exist */
  includeOrphanedGas?: boolean;
  /** Check if local folders still exist */
  includeOrphanedLocal?: boolean;
}

/**
 * Union type for all worktree operation inputs
 */
export type WorktreeInput =
  | WorktreeAddInput
  | WorktreeClaimInput
  | WorktreeReleaseInput
  | WorktreeListInput
  | WorktreeStatusInput
  | WorktreeSyncInput
  | WorktreeMergeInput
  | WorktreeRemoveInput
  | WorktreeBatchAddInput
  | WorktreeCleanupInput;

// ============================================================================
// Operation Result Types
// ============================================================================

/**
 * Basic worktree info returned in results
 */
export interface WorktreeInfo {
  scriptId: string;
  parentScriptId: string;
  branch: string;
  localPath: string;
  state: WorktreeState;
  containerId?: string;
  containerType: ContainerType;
  claimedBy?: string;
  claimedAt?: string;
  createdAt?: string;
}

/**
 * Result for 'add' operation
 */
export interface WorktreeAddResult {
  success: true;
  worktree: WorktreeInfo;
}

/**
 * Result for 'claim' operation
 */
export interface WorktreeClaimResult {
  success: true;
  worktree: WorktreeInfo;
  /** True if a new worktree was created */
  created: boolean;
}

/**
 * Result for 'release' operation
 */
export interface WorktreeReleaseResult {
  success: true;
  state: 'READY';
  warnings?: string[];
}

/**
 * Worktree list item with orphan detection
 */
export interface WorktreeListItem extends WorktreeInfo {
  /** True if claimed for longer than threshold */
  isOrphan: boolean;
}

/**
 * Result for 'list' operation
 */
export interface WorktreeListResult {
  worktrees: WorktreeListItem[];
}

/**
 * File divergence information
 */
export interface WorktreeDivergence {
  filesOnlyInWorktree: string[];
  filesOnlyInParent: string[];
  filesModifiedInWorktree: string[];
  filesModifiedInParent: string[];
  /** Files modified in BOTH */
  conflicts: string[];
}

/**
 * Git status information
 */
export interface WorktreeGitStatus {
  uncommittedChanges: number;
  aheadOfMain: number;
  behindMain: number;
}

/**
 * Result for 'status' operation
 */
export interface WorktreeStatusResult {
  worktree: WorktreeInfo;
  parent: { scriptId: string; name?: string };
  divergence: WorktreeDivergence;
  mergeable: boolean;
  gitStatus: WorktreeGitStatus;
}

/**
 * Result for 'sync' operation
 */
export interface WorktreeSyncResult {
  synced: string[];
  conflicts: string[];
  skipped: string[];
  baseHashesAge?: number;
  warnings?: string[];
}

/**
 * Merge preview result
 */
export interface WorktreeMergePreview {
  preview: {
    filesToAdd: string[];
    filesToModify: string[];
    filesToDelete: string[];
    conflicts: string[];
    mergeable: boolean;
  };
}

/**
 * Merge actual result
 */
export interface WorktreeMergeResult {
  merged: true;
  commitSha: string;
  filesChanged: number;
  pushedToRemote: boolean;
  worktreeState: 'MERGED' | 'READY';
  warnings?: string[];
}

/**
 * Cleanup tracking for partial artifacts
 */
export interface WorktreeCleanupRecord {
  gasProjectTrashed: boolean;
  containerTrashed: boolean;
  branchDeleted: boolean;
  localFolderDeleted: boolean;
}

/**
 * Result for 'remove' operation
 */
export interface WorktreeRemoveResult {
  removed: true;
  branchDeleted: boolean;
  localDeleted: boolean;
  gasDeleted: boolean;
  projectDeleted: boolean;
  keptForDiagnostics: boolean;
  warnings?: string[];
}

/**
 * Failed worktree in batch-add
 */
export interface WorktreeBatchFailure {
  branchName: string;
  error: string;
  errorCode: string;
  state: 'FAILED';
  cleanup: WorktreeCleanupRecord;
}

/**
 * Result for 'batch-add' operation
 */
export interface WorktreeBatchAddResult {
  /** True only if ALL succeeded */
  success: boolean;
  /** Successfully created worktrees */
  worktrees: WorktreeInfo[];
  /** Failed to create */
  failed: WorktreeBatchFailure[];
  created: number;
  failedCount: number;
  message: string;
}

/**
 * Orphan types for cleanup
 */
export type OrphanType = 'STALE_CLAIM' | 'GAS_DELETED' | 'LOCAL_DELETED' | 'FAILED';

/**
 * Orphan info for cleanup
 */
export interface OrphanInfo {
  scriptId: string;
  orphanType: OrphanType;
  claimedAt?: string;
  age?: string;
  reason: string;
}

/**
 * Cleanup summary
 */
export interface CleanupSummary {
  staleClaimsFound: number;
  gasDeletedFound: number;
  localDeletedFound: number;
  failedFound: number;
}

/**
 * Result for 'cleanup' operation
 */
export interface WorktreeCleanupResult {
  orphans: OrphanInfo[];
  cleaned: number;
  kept: number;
  errors?: string[];
  summary: CleanupSummary;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Worktree error codes
 */
export type WorktreeErrorCode =
  | 'LOCK_TIMEOUT'
  | 'WORKTREE_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'INVALID_STATE_TRANSITION'
  | 'MERGE_CONFLICT'
  | 'MERGE_IN_PROGRESS'
  | 'CONTAINER_COPY_FAILED'
  | 'BRANCH_EXISTS'
  | 'BRANCH_NAME_REQUIRED'
  | 'UNCOMMITTED_CHANGES'
  | 'GAS_PROJECT_DELETED'
  | 'PARENT_DELETED'
  | 'LOCAL_DELETED'
  | 'RSYNC_PUSH_FAILED'
  | 'REMOTE_PUSH_PENDING'
  | 'NO_AVAILABLE_WORKTREES'
  | 'SYNC_FAILED'
  | 'UNEXPECTED_ERROR'
  | 'SKIPPED'
  | 'DRIVE_QUOTA'
  | 'API_ERROR'
  | 'GIT_ERROR';

/**
 * Worktree error result
 */
export interface WorktreeError {
  success: false;
  error: WorktreeErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS: Record<WorktreeState, WorktreeState[]> = {
  CREATING: ['READY', 'FAILED', 'ORPHAN_GAS_DELETED', 'ORPHAN_LOCAL_DELETED'],
  READY: ['CLAIMED', 'REMOVING', 'REMOVED'],
  CLAIMED: ['READY', 'MERGING', 'REMOVING'],
  MERGING: ['MERGED', 'CLAIMED'], // Can rollback to CLAIMED on failure
  MERGED: ['REMOVING', 'REMOVED'],
  FAILED: ['REMOVING', 'REMOVED'],
  REMOVING: ['REMOVED'],
  REMOVED: [],
  ORPHAN_GAS_DELETED: ['REMOVING', 'REMOVED'],
  ORPHAN_LOCAL_DELETED: ['REMOVING', 'REMOVED'],
};

/**
 * Check if a state transition is valid
 */
export function isValidTransition(from: WorktreeState, to: WorktreeState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Sanitize branch name for git
 */
export function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

/**
 * Generate full branch name with UUID suffix
 */
export function generateBranchName(userFriendlyName: string): string {
  const sanitized = sanitizeBranchName(userFriendlyName);
  const uuid8 = crypto.randomUUID().substring(0, 8);
  return `llm-feature-${sanitized}-${uuid8}`;
}

/**
 * Check if a state indicates the worktree is orphaned
 */
export function isOrphanState(state: WorktreeState): boolean {
  return state === 'ORPHAN_GAS_DELETED' || state === 'ORPHAN_LOCAL_DELETED';
}

/**
 * Check if a state indicates the worktree is terminal (cannot be reused)
 */
export function isTerminalState(state: WorktreeState): boolean {
  return state === 'MERGED' || state === 'REMOVED' || state === 'FAILED' || isOrphanState(state);
}

/**
 * Normalize GAS file name with extension based on type
 */
export function normalizeFileName(name: string, type: string): string {
  const ext = type === 'HTML' ? '.html' : type === 'JSON' ? '.json' : '.gs';
  if (name.endsWith(ext)) return name;
  if (name === 'appsscript') return 'appsscript.json';
  return `${name}${ext}`;
}

/**
 * Calculate hours since a timestamp
 */
export function hoursSince(isoTimestamp: string): number {
  const then = new Date(isoTimestamp).getTime();
  const now = Date.now();
  return (now - then) / (1000 * 60 * 60);
}

/**
 * Calculate days since a timestamp
 */
export function daysSince(isoTimestamp: string): number {
  return hoursSince(isoTimestamp) / 24;
}

/**
 * Format duration as human readable string
 */
export function formatDuration(hours: number): string {
  if (hours < 1) {
    return `${Math.round(hours * 60)} minutes`;
  } else if (hours < 24) {
    return `${Math.round(hours)} hours`;
  } else {
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''}`;
  }
}

/**
 * Empty worktrees config
 */
export const EMPTY_WORKTREES_CONFIG: WorktreesConfig = {
  worktrees: {},
};
