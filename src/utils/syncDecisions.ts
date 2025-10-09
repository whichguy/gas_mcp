/**
 * Sync decision utilities for determining when to auto-sync files
 *
 * These pure functions encapsulate the logic for deciding when automatic
 * synchronization should be triggered between local and remote projects.
 */

export interface SyncStatus {
  inSync: boolean;
  differences: {
    onlyLocal: string[];
    onlyRemote: string[];
    contentDiffers: string[];
  };
  summary: string;
}

export interface SyncDecision {
  pull: boolean;
  reason: string;
}

/**
 * Determine if auto-sync should be triggered based on sync status.
 * Conservative logic to avoid losing local changes.
 *
 * @param syncStatus - Current sync status from verifySyncStatus()
 * @param totalRemoteFiles - Total number of files on remote
 * @returns Decision object with pull flag and reason
 */
export function shouldAutoSync(
  syncStatus: SyncStatus | null,
  totalRemoteFiles: number
): SyncDecision {
  if (!syncStatus) {
    return { pull: false, reason: 'No sync status available' };
  }

  // Check for first-time access: no local files but remote files exist
  const hasNoLocalFiles = syncStatus.differences.onlyLocal.length === 0 &&
                          syncStatus.differences.contentDiffers.length === 0;
  const hasRemoteFiles = syncStatus.differences.onlyRemote.length > 0;

  if (hasNoLocalFiles && hasRemoteFiles) {
    return { pull: true, reason: 'First-time project access (no local files)' };
  }

  // Check for major out of sync: many remote-only files
  if (syncStatus.differences.onlyRemote.length >= 3) {
    return { pull: true, reason: `Missing ${syncStatus.differences.onlyRemote.length} remote files locally` };
  }

  // Don't auto-pull if there are local changes that could be lost
  if (syncStatus.differences.onlyLocal.length > 0 || syncStatus.differences.contentDiffers.length > 0) {
    return { pull: false, reason: 'Local changes detected - manual sync required' };
  }

  return { pull: false, reason: 'Sync status acceptable' };
}
