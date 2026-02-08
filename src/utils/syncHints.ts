/**
 * @fileoverview Sync hints utility for generating dynamic recovery commands
 *
 * Provides actionable hints when sync state may have drifted, with fully-formed
 * commands containing actual scriptId and file paths.
 */

/**
 * Sync hint suggestion with executable command
 */
export interface SyncSuggestion {
  /** Action type for categorization */
  action: 'rsync_pull' | 'cat_refresh';
  /** Fully-formed command with actual scriptId and path */
  command: string;
  /** Human-readable reason for this suggestion */
  reason: string;
}

/**
 * Sync hints for tool responses
 */
export interface SyncHints {
  /** Overall sync status */
  status: 'in_sync' | 'partial' | 'unknown';
  /** Whether local xattr cache was updated */
  localCacheUpdated: boolean;
  /** Whether remote GAS was updated */
  remotePushed: boolean;
  /** Recovery suggestions if sync is partial */
  suggestions: SyncSuggestion[];
}

/**
 * Parameters for generating sync hints
 */
export interface GenerateSyncHintsParams {
  /** GAS project script ID */
  scriptId: string;
  /** Operation that was performed */
  operation: 'write' | 'mv' | 'rm' | 'cp' | 'project_create';
  /** Files affected by the operation */
  affectedFiles: string[];
  /** Whether local xattr cache was updated */
  localCacheUpdated: boolean;
  /** Whether remote GAS was updated */
  remotePushed: boolean;
}

/**
 * Generate dynamic sync hints with actual scriptId and paths
 *
 * @param params - Parameters for hint generation
 * @returns SyncHints with executable recovery commands
 *
 * @example
 * // Single file not cached locally
 * generateSyncHints({
 *   scriptId: '1Y72rig...',
 *   operation: 'write',
 *   affectedFiles: ['config.gs'],
 *   localCacheUpdated: false,
 *   remotePushed: true
 * });
 * // Returns: { suggestions: [{ command: 'cat({scriptId: "1Y72rig...", path: "config.gs"})' }] }
 *
 * @example
 * // Multiple files after project_create
 * generateSyncHints({
 *   scriptId: 'NEW_ID',
 *   operation: 'project_create',
 *   affectedFiles: ['appsscript.json', 'require.gs', 'exec.gs'],
 *   localCacheUpdated: false,
 *   remotePushed: true
 * });
 * // Returns: { suggestions: [{ command: 'rsync({operation: "plan", scriptId: "NEW_ID", direction: "pull"})' }] }
 */
export function generateSyncHints(params: GenerateSyncHintsParams): SyncHints {
  const { scriptId, affectedFiles, localCacheUpdated, remotePushed } = params;

  // Determine overall status
  let status: SyncHints['status'];
  if (localCacheUpdated && remotePushed) {
    status = 'in_sync';
  } else if (!localCacheUpdated && !remotePushed) {
    status = 'unknown';
  } else {
    status = 'partial';
  }

  const hints: SyncHints = {
    status,
    localCacheUpdated,
    remotePushed,
    suggestions: []
  };

  // If local cache not updated, suggest cat or rsync
  if (!localCacheUpdated && affectedFiles.length > 0) {
    if (affectedFiles.length === 1) {
      // Single file - recommend cat for efficiency
      // Use JSON.stringify for safe escaping of scriptId and path
      hints.suggestions.push({
        action: 'cat_refresh',
        command: `cat({scriptId: ${JSON.stringify(scriptId)}, path: ${JSON.stringify(affectedFiles[0])}})`,
        reason: 'Refresh local cache for this file'
      });
    } else {
      // Multiple files - recommend rsync for batch sync
      hints.suggestions.push({
        action: 'rsync_pull',
        command: `rsync({operation: "plan", scriptId: ${JSON.stringify(scriptId)}, direction: "pull"})`,
        reason: `Sync ${affectedFiles.length} files to local cache`
      });
    }
  }

  // If remote not pushed (rare - would indicate a failure), suggest checking
  // Avoid duplicate rsync suggestion if already added above
  if (!remotePushed && affectedFiles.length > 0) {
    const hasRsyncSuggestion = hints.suggestions.some(s => s.action === 'rsync_pull');
    if (!hasRsyncSuggestion) {
      hints.suggestions.push({
        action: 'rsync_pull',
        command: `rsync({operation: "plan", scriptId: ${JSON.stringify(scriptId)}, direction: "pull"})`,
        reason: 'Verify remote state after partial operation'
      });
    }
  }

  return hints;
}

/**
 * Create sync hints for a successful in-sync operation
 * Convenience function for when both local and remote are updated
 */
export function createInSyncHints(): SyncHints {
  return {
    status: 'in_sync',
    localCacheUpdated: true,
    remotePushed: true,
    suggestions: []
  };
}
