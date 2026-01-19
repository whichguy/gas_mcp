import { stat, utimes } from 'fs/promises';
import { GASFile } from '../api/gasClient.js';
import { cacheGASMetadata } from './gasMetadataCache.js';
import { fileNameMatches } from '../api/pathParser.js';

/**
 * Set file modification time to match remote updateTime
 * This marks the file as synced with the remote GAS project
 * Also caches GAS metadata (updateTime, fileType) in extended attributes for fast sync detection
 */
export async function setFileMtimeToRemote(
  localPath: string,
  remoteUpdateTime: string,
  fileType?: string
): Promise<void> {
  const remoteTime = new Date(remoteUpdateTime);

  // Set both atime and mtime to remote timestamp
  await utimes(localPath, remoteTime, remoteTime);

  // Cache GAS metadata in extended attributes for fast sync detection
  if (fileType) {
    await cacheGASMetadata(localPath, remoteUpdateTime, fileType);
  }
}

/**
 * Check if local file is in sync with remote based on mtime
 * Returns true if local mtime matches remote updateTime
 */
export async function isFileInSync(localPath: string, remoteUpdateTime: string): Promise<boolean> {
  try {
    const stats = await stat(localPath);
    const localMtime = stats.mtime;
    const remoteTime = new Date(remoteUpdateTime);

    // Compare timestamps (allow 1 second tolerance for filesystem precision)
    const diffMs = Math.abs(localMtime.getTime() - remoteTime.getTime());
    return diffMs < 1000; // Within 1 second = synced
  } catch (error) {
    // File doesn't exist locally = out of sync
    return false;
  }
}

/**
 * Diagnostic information from sync check
 */
export interface SyncCheckResult {
  inSync: boolean;
  diagnosis: {
    localMtime: Date | null;
    remoteTime: Date;
    timeDiffMs: number;
    cacheExists: boolean;
    cachedUpdateTime?: string;
    cacheMatched: boolean;
    syncMethod: 'cache-exact' | 'cache-fallback-ok' | 'mtime-ok' | 'mtime-fail' | 'no-local-file';
    reason?: string;
  };
}

/**
 * Check sync using cached metadata first (fast path), then mtime (fallback)
 * Returns detailed diagnostic information about sync status
 *
 * This provides a performance optimization by checking xattr cache before
 * doing the more expensive mtime comparison
 */
export async function isFileInSyncWithCache(
  localPath: string,
  remoteUpdateTime: string
): Promise<SyncCheckResult> {
  const remoteTime = new Date(remoteUpdateTime);

  // Try cached metadata first (fast path - no filesystem stat needed)
  const { getCachedGASMetadata } = await import('./gasMetadataCache.js');
  const cachedMeta = await getCachedGASMetadata(localPath);

  const cacheExists = !!cachedMeta;
  const cacheMatched = cachedMeta?.updateTime === remoteUpdateTime;

  if (cachedMeta && cacheMatched) {
    // Fast path: cached metadata matches exactly
    return {
      inSync: true,
      diagnosis: {
        localMtime: null, // Not checked in fast path
        remoteTime,
        timeDiffMs: 0,
        cacheExists: true,
        cachedUpdateTime: cachedMeta.updateTime,
        cacheMatched: true,
        syncMethod: 'cache-exact',
        reason: 'xattr cache matches remote updateTime exactly'
      }
    };
  }

  // Fallback to mtime check (slower but still reliable)
  try {
    const stats = await stat(localPath);
    const localMtime = stats.mtime;
    const timeDiffMs = Math.abs(localMtime.getTime() - remoteTime.getTime());
    const inSync = timeDiffMs < 1000; // Within 1 second = synced

    if (inSync) {
      return {
        inSync: true,
        diagnosis: {
          localMtime,
          remoteTime,
          timeDiffMs,
          cacheExists,
          cachedUpdateTime: cachedMeta?.updateTime,
          cacheMatched,
          syncMethod: 'cache-fallback-ok',
          reason: cacheExists
            ? 'xattr cache outdated but filesystem mtime within 1s tolerance'
            : 'xattr cache not found but filesystem mtime within 1s tolerance'
        }
      };
    } else {
      // Out of sync
      let reason: string;
      if (cacheExists && !cacheMatched) {
        reason = 'Both xattr cache and filesystem mtime indicate file is out of sync (remote modified in GAS editor or elsewhere)';
      } else if (!cacheExists && localMtime < remoteTime) {
        reason = 'xattr cache not found and local file is older than remote (remote was modified after last sync)';
      } else if (!cacheExists && localMtime > remoteTime) {
        reason = 'xattr cache not found and local file is newer than remote (possible clock skew or local modifications not synced)';
      } else {
        reason = 'Filesystem mtime does not match remote updateTime';
      }

      return {
        inSync: false,
        diagnosis: {
          localMtime,
          remoteTime,
          timeDiffMs,
          cacheExists,
          cachedUpdateTime: cachedMeta?.updateTime,
          cacheMatched,
          syncMethod: 'mtime-fail',
          reason
        }
      };
    }
  } catch (error: any) {
    // File doesn't exist locally
    return {
      inSync: false,
      diagnosis: {
        localMtime: null,
        remoteTime,
        timeDiffMs: -1,
        cacheExists,
        cachedUpdateTime: cachedMeta?.updateTime,
        cacheMatched,
        syncMethod: 'no-local-file',
        reason: 'Local file does not exist'
      }
    };
  }
}

/**
 * Format time difference in human-readable format
 */
export function formatTimeDifference(diffMs: number): string {
  const absDiff = Math.abs(diffMs);

  if (absDiff < 1000) {
    return `${diffMs}ms`;
  }

  const seconds = diffMs / 1000;
  if (Math.abs(seconds) < 60) {
    return `${seconds.toFixed(2)}s`;
  }

  const minutes = seconds / 60;
  if (Math.abs(minutes) < 60) {
    return `${minutes.toFixed(2)}m`;
  }

  const hours = minutes / 60;
  if (Math.abs(hours) < 24) {
    return `${hours.toFixed(2)}h`;
  }

  const days = hours / 24;
  return `${days.toFixed(2)}d`;
}

/**
 * Get local file modification time
 */
export async function getFileMtime(localPath: string): Promise<Date | null> {
  try {
    const stats = await stat(localPath);
    return stats.mtime;
  } catch (error) {
    return null;
  }
}

/**
 * Find remote file metadata by name (extension-agnostic)
 */
export function findRemoteFile(files: GASFile[], filename: string): GASFile | undefined {
  return files.find(f => fileNameMatches(f.name, filename));
}

/**
 * Check if a filename is the appsscript.json manifest file
 * Handles various naming conventions: appsscript, appsscript.json, APPSSCRIPT
 */
export function isManifestFile(filename: string): boolean {
  const normalized = filename.toLowerCase();
  return normalized === 'appsscript' || normalized === 'appsscript.json';
}

/**
 * Find the appsscript.json manifest file in a list of GAS files
 * Handles extension-agnostic matching
 */
export function findManifestFile(files: GASFile[]): GASFile | undefined {
  return files.find(f => isManifestFile(f.name));
}

/**
 * Check sync status and throw error if out of sync
 * Used by write operations to prevent writing when local/remote differ
 *
 * Sync Rules:
 * 1. File doesn't exist in GAS → Allow (new file creation)
 * 2. File exists in GAS but not locally → Allow if allowNewLocalFile=true (intentional write)
 * 3. File exists in both + dates match → Allow (in sync)
 * 4. File exists in both + dates mismatch → Error (must cat first to sync)
 */
export async function checkSyncOrThrow(
  localPath: string,
  filename: string,
  remoteFiles: GASFile[],
  allowNewLocalFile: boolean = false
): Promise<void> {
  const remoteFile = findRemoteFile(remoteFiles, filename);

  // Rule 1: File doesn't exist in GAS → Allow (new file creation)
  if (!remoteFile) {
    return; // Allow write - creating new file
  }

  // File exists in GAS - verify sync with local
  let updateTime = remoteFile.updateTime;
  if (!updateTime) {
    console.warn(`⚠️  No updateTime for ${filename}, using current time as fallback`);
    updateTime = new Date().toISOString();
  }

  // Check if local file exists
  try {
    await stat(localPath);

    // Local file exists - check if dates match using cache-aware check (Rule 3 vs Rule 4)
    const syncResult = await isFileInSyncWithCache(localPath, updateTime);

    if (!syncResult.inSync) {
      // Rule 4: Dates mismatch - must sync first (strict enforcement)
      const diag = syncResult.diagnosis;
      const localMtimeStr = diag.localMtime ? diag.localMtime.toISOString() : 'N/A';
      const timeDiffFormatted = diag.timeDiffMs >= 0 ? formatTimeDifference(diag.timeDiffMs) : 'N/A';

      throw new Error(
        `File out of sync: ${filename}\n` +
        `\n` +
        `SYNC STATUS:\n` +
        `  Local file:  ${localPath}\n` +
        `  Local mtime: ${localMtimeStr}${diag.localMtime ? ` (${diag.localMtime.getTime()})` : ''}\n` +
        `  Remote time: ${updateTime} (${diag.remoteTime.getTime()})\n` +
        `  Difference:  ${diag.timeDiffMs}ms (${timeDiffFormatted})\n` +
        `\n` +
        `CACHE DIAGNOSTICS:\n` +
        `  xattr cached: ${diag.cacheExists ? 'Yes' : 'No'}\n` +
        `${diag.cacheExists ? `  Cache value:  ${diag.cachedUpdateTime}\n` : `  Cache status: Not found or not readable\n`}` +
        `${diag.cacheExists ? `  Cache match:  ${diag.cacheMatched ? 'Yes (but mtime differs)' : 'No'}\n` : ''}` +
        `  Sync method:  ${diag.syncMethod}\n` +
        `\n` +
        `DIAGNOSIS:\n` +
        `  ${diag.reason}\n` +
        `\n` +
        `ACTION REQUIRED:\n` +
        `  Run 'cat' to download latest remote version and sync timestamps\n` +
        `  Remote was last modified: ${updateTime}`
      );
    }

    // Rule 3: Dates match - allow write
    return;

  } catch (error: any) {
    // Check if it's a file-not-found error
    if (error.code === 'ENOENT') {
      // Rule 2: File exists in GAS but not locally
      if (allowNewLocalFile) {
        // Allow write - user explicitly provided content for remote file
        return;
      }

      throw new Error(
        `File exists in GAS but not locally: ${filename}\n` +
        `Run cat to download before writing.\n` +
        `Remote updateTime: ${updateTime}`
      );
    }

    // Re-throw if it's already a sync error
    if (error.message && error.message.includes('out of sync')) {
      throw error;
    }

    // Re-throw other unexpected errors
    throw error;
  }
}
