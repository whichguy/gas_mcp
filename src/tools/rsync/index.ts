/**
 * rsync module exports
 *
 * Stateless unidirectional sync between GAS projects and local git repositories.
 */

// Core tool
export { RsyncTool, createRsyncTool } from './RsyncTool.js';

// Planning (diff computation)
export { SyncPlanner, SyncPlanError } from './SyncPlanner.js';
export type { DiffOptions, DiffResult, SyncPlanErrorCode } from './SyncPlanner.js';

// Execution (apply changes)
export { SyncExecutor, SyncExecuteError } from './SyncExecutor.js';
export type { ApplyOptions, SyncResult, SyncExecuteErrorCode } from './SyncExecutor.js';

// Data structures
export { SyncDiff } from './SyncDiff.js';
export type { DiffFileInfo, SyncFileOperation, SyncDiffResult } from './SyncDiff.js';
export type { DiffOptions as SyncDiffComputeOptions } from './SyncDiff.js';

export { SyncManifest } from './SyncManifest.js';
export type { SyncManifestData, SyncManifestFile, ManifestLoadResult } from './SyncManifest.js';
