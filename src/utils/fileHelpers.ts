import { stat, utimes } from 'fs/promises';
import { GASFile } from '../api/gasClient.js';
import { cacheGASMetadata } from './gasMetadataCache.js';

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
 * Check sync using cached metadata first (fast path), then mtime (fallback)
 * Returns true if file is in sync with remote
 *
 * This provides a performance optimization by checking xattr cache before
 * doing the more expensive mtime comparison
 */
export async function isFileInSyncWithCache(
  localPath: string,
  remoteUpdateTime: string
): Promise<boolean> {
  // Try cached metadata first (fast path - no filesystem stat needed)
  const { getCachedGASMetadata } = await import('./gasMetadataCache.js');
  const cachedMeta = await getCachedGASMetadata(localPath);

  if (cachedMeta && cachedMeta.updateTime === remoteUpdateTime) {
    return true; // Fast path: cached metadata matches exactly
  }

  // Fallback to mtime check (slower but still reliable)
  return await isFileInSync(localPath, remoteUpdateTime);
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
 * Find remote file metadata by name
 */
export function findRemoteFile(files: GASFile[], filename: string): GASFile | undefined {
  return files.find(f => f.name === filename);
}

/**
 * Check sync status and throw error if out of sync
 * Used by write operations to prevent writing when local/remote differ
 *
 * Sync Rules:
 * 1. File doesn't exist in GAS → Allow (new file creation)
 * 2. File exists in GAS but not locally → Error (must cat first to download)
 * 3. File exists in both + dates match → Allow (in sync)
 * 4. File exists in both + dates mismatch → Error (must cat first to sync)
 */
export async function checkSyncOrThrow(
  localPath: string,
  filename: string,
  remoteFiles: GASFile[]
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
    const inSync = await isFileInSyncWithCache(localPath, updateTime);

    if (!inSync) {
      // Rule 4: Dates mismatch - must sync first
      throw new Error(
        `File out of sync: ${filename}\n` +
        `Local and remote versions differ. Run cat to sync before writing.\n` +
        `Remote updateTime: ${updateTime}`
      );
    }

    // Rule 3: Dates match - allow write
    return;

  } catch (error: any) {
    // Check if it's a file-not-found error
    if (error.code === 'ENOENT') {
      // Rule 2: File exists in GAS but not locally
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
