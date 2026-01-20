import { stat, utimes, readFile } from 'fs/promises';
import { GASFile } from '../api/gasClient.js';
import { cacheGASMetadata, getCachedContentHash } from './gasMetadataCache.js';
import { fileNameMatches } from '../api/pathParser.js';
import { computeGitSha1 } from './hashUtils.js';

/**
 * Set file modification time to match remote updateTime
 *
 * NOTE: This is INFORMATIONAL ONLY - sync detection now uses hash comparison.
 * Mtime is still set for user convenience (file explorer sorting, etc.)
 * but is NOT used for sync decisions.
 *
 * Also caches GAS metadata (updateTime, fileType) in extended attributes.
 */
export async function setFileMtimeToRemote(
  localPath: string,
  remoteUpdateTime: string,
  fileType?: string
): Promise<void> {
  const remoteTime = new Date(remoteUpdateTime);

  // Set both atime and mtime to remote timestamp (informational only)
  await utimes(localPath, remoteTime, remoteTime);

  // Cache GAS metadata in extended attributes
  if (fileType) {
    await cacheGASMetadata(localPath, remoteUpdateTime, fileType);
  }
}

/**
 * Check if local file is in sync with remote based on hash comparison
 *
 * @param localPath - Path to local file
 * @param remoteWrappedHash - Git SHA-1 hash of WRAPPED remote content (full file as stored in GAS)
 * @returns true if hashes match (file is in sync)
 */
export async function isFileInSyncByHash(
  localPath: string,
  remoteWrappedHash: string
): Promise<boolean> {
  try {
    // Fast path: check cached hash from xattr
    const cachedHash = await getCachedContentHash(localPath);
    if (cachedHash && cachedHash === remoteWrappedHash) {
      return true;
    }

    // Slow path: compute local hash from file content
    const content = await readFile(localPath, 'utf-8');
    const localHash = computeGitSha1(content);
    return localHash === remoteWrappedHash;
  } catch (error) {
    // File doesn't exist locally = out of sync
    return false;
  }
}

/**
 * Diagnostic information from hash-based sync check
 */
export interface SyncCheckResultByHash {
  inSync: boolean;
  diagnosis: {
    localHash: string | null;
    remoteHash: string;
    cacheExists: boolean;
    cachedHash?: string;
    cacheMatched: boolean;
    syncMethod: 'cache-exact' | 'computed-match' | 'hash-mismatch' | 'no-local-file';
    reason: string;
  };
}

/**
 * Check sync status using cached hash first (fast path), then computed hash (fallback)
 * Returns detailed diagnostic information about sync status
 *
 * Uses hash comparison (not mtime) for reliable sync detection.
 *
 * @param localPath - Path to local file
 * @param remoteWrappedHash - Git SHA-1 hash of WRAPPED remote content
 * @returns SyncCheckResultByHash with detailed diagnostics
 */
export async function isFileInSyncWithCacheByHash(
  localPath: string,
  remoteWrappedHash: string
): Promise<SyncCheckResultByHash> {
  // Try cached hash first (fast path - no file read needed)
  const cachedHash = await getCachedContentHash(localPath);

  if (cachedHash && cachedHash === remoteWrappedHash) {
    // Fast path: cached hash matches exactly
    return {
      inSync: true,
      diagnosis: {
        localHash: cachedHash,
        remoteHash: remoteWrappedHash,
        cacheExists: true,
        cachedHash,
        cacheMatched: true,
        syncMethod: 'cache-exact',
        reason: 'Cached hash matches remote hash exactly'
      }
    };
  }

  // Slow path: compute local hash from file content
  try {
    const content = await readFile(localPath, 'utf-8');
    const computedLocalHash = computeGitSha1(content);
    const inSync = computedLocalHash === remoteWrappedHash;

    return {
      inSync,
      diagnosis: {
        localHash: computedLocalHash,
        remoteHash: remoteWrappedHash,
        cacheExists: !!cachedHash,
        cachedHash: cachedHash || undefined,
        cacheMatched: false,
        syncMethod: inSync ? 'computed-match' : 'hash-mismatch',
        reason: inSync
          ? 'Computed local hash matches remote hash'
          : cachedHash
            ? `Hash mismatch: cached=${cachedHash.slice(0, 8)}..., computed=${computedLocalHash.slice(0, 8)}..., remote=${remoteWrappedHash.slice(0, 8)}...`
            : `Hash mismatch: local=${computedLocalHash.slice(0, 8)}..., remote=${remoteWrappedHash.slice(0, 8)}...`
      }
    };
  } catch (error: any) {
    // File doesn't exist locally
    if (error.code === 'ENOENT') {
      return {
        inSync: false,
        diagnosis: {
          localHash: null,
          remoteHash: remoteWrappedHash,
          cacheExists: !!cachedHash,
          cachedHash: cachedHash || undefined,
          cacheMatched: false,
          syncMethod: 'no-local-file',
          reason: 'Local file does not exist'
        }
      };
    }
    throw error;
  }
}

// ============================================================================
// Utility functions
// ============================================================================

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
 * Check sync status using hash comparison and throw error if out of sync
 * Used by write operations to prevent writing when local/remote differ
 *
 * Sync Rules:
 * 1. File doesn't exist in GAS → Allow (new file creation)
 * 2. File exists in GAS but not locally → Allow if allowNewLocalFile=true (intentional write)
 * 3. File exists in both + hashes match → Allow (in sync)
 * 4. File exists in both + hashes differ → Error (must cat first to sync)
 *
 * @param localPath - Path to local file
 * @param filename - Filename for error messages
 * @param remoteFiles - Array of remote files from GAS API
 * @param allowNewLocalFile - If true, allow writing to files that don't exist locally
 */
export async function checkSyncOrThrowByHash(
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

  // Compute remote hash on WRAPPED content (full file as stored in GAS)
  const remoteHash = computeGitSha1(remoteFile.source || '');

  // Check sync status using hash comparison
  try {
    const syncResult = await isFileInSyncWithCacheByHash(localPath, remoteHash);

    if (!syncResult.inSync) {
      // Rule 4: Hashes differ - must sync first (strict enforcement)
      const diag = syncResult.diagnosis;

      throw new Error(
        `File out of sync: ${filename}\n` +
        `\n` +
        `SYNC STATUS (Hash-based):\n` +
        `  Local file:  ${localPath}\n` +
        `  Local hash:  ${diag.localHash || 'N/A'}\n` +
        `  Remote hash: ${diag.remoteHash}\n` +
        `\n` +
        `CACHE DIAGNOSTICS:\n` +
        `  xattr cached: ${diag.cacheExists ? 'Yes' : 'No'}\n` +
        `${diag.cacheExists ? `  Cached hash:  ${diag.cachedHash}\n` : ''}` +
        `  Sync method:  ${diag.syncMethod}\n` +
        `\n` +
        `DIAGNOSIS:\n` +
        `  ${diag.reason}\n` +
        `\n` +
        `ACTION REQUIRED:\n` +
        `  Run 'cat' to download latest remote version and update local cache`
      );
    }

    // Rule 3: Hashes match - allow write
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
        `Remote hash: ${remoteHash}`
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

