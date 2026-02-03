/**
 * Worktree module exports
 *
 * This module provides parallel development capabilities for GAS projects,
 * enabling multiple Claude Code agents to work concurrently on isolated
 * workspaces with shared git history.
 */

export { WorktreeTool } from './WorktreeTool.js';
export { WorktreeLockManager, WorktreeLockTimeoutError } from './WorktreeLockManager.js';
export {
  WorktreeStateManager,
  WorktreeNotFoundError,
  InvalidStateTransitionError
} from './WorktreeStateManager.js';

// Re-export types for convenience
export type {
  WorktreeState,
  WorktreeEntry,
  WorktreesConfig,
  WorktreeLock,
  ContainerType,
  WorktreeInput,
  WorktreeAddInput,
  WorktreeClaimInput,
  WorktreeReleaseInput,
  WorktreeListInput,
  WorktreeStatusInput,
  WorktreeSyncInput,
  WorktreeMergeInput,
  WorktreeRemoveInput,
  WorktreeBatchAddInput,
  WorktreeCleanupInput,
  WorktreeInfo,
  WorktreeAddResult,
  WorktreeClaimResult,
  WorktreeReleaseResult,
  WorktreeListResult,
  WorktreeListItem,
  WorktreeStatusResult,
  WorktreeSyncResult,
  WorktreeMergeResult,
  WorktreeMergePreview,
  WorktreeRemoveResult,
  WorktreeBatchAddResult,
  WorktreeCleanupResult,
  WorktreeError,
  WorktreeErrorCode
} from '../../types/worktreeTypes.js';
