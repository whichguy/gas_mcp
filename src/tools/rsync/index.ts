/**
 * rsync module exports
 *
 * Unidirectional sync between GAS projects and local git repositories.
 */

// Core tool
export { RsyncTool, createRsyncTool } from './RsyncTool.js';

// Planning and execution
export { SyncPlanner, SyncPlanError } from './SyncPlanner.js';
export type { PlanOptions, PlanResult, SyncPlanErrorCode } from './SyncPlanner.js';

export { SyncExecutor, SyncExecuteError } from './SyncExecutor.js';
export type { ExecuteOptions, SyncResult, SyncExecuteErrorCode } from './SyncExecutor.js';

// Data structures
export { PlanStore } from './PlanStore.js';
export type { SyncPlan, PlanValidation, PlanStoreConfig } from './PlanStore.js';

export { SyncDiff } from './SyncDiff.js';
export type { DiffFileInfo, SyncFileOperation, SyncDiffResult, DiffOptions } from './SyncDiff.js';

export { SyncManifest } from './SyncManifest.js';
export type { SyncManifestData, SyncManifestFile, ManifestLoadResult } from './SyncManifest.js';
