import { stat, utimes } from 'fs/promises';
import { GASFile } from '../api/gasClient.js';

/**
 * Set file modification time to match remote updateTime
 * This marks the file as synced with the remote GAS project
 */
export async function setFileMtimeToRemote(localPath: string, remoteUpdateTime: string): Promise<void> {
  const remoteTime = new Date(remoteUpdateTime);

  // Set both atime and mtime to remote timestamp
  await utimes(localPath, remoteTime, remoteTime);
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
 */
export async function checkSyncOrThrow(
  localPath: string,
  filename: string,
  remoteFiles: GASFile[]
): Promise<void> {
  const remoteFile = findRemoteFile(remoteFiles, filename);

  if (!remoteFile) {
    throw new Error(`Remote file ${filename} not found`);
  }

  // Handle missing updateTime field with fallback (don't mutate remoteFile)
  let updateTime = remoteFile.updateTime;
  if (!updateTime) {
    console.warn(`⚠️  No updateTime for ${filename}, using current time as fallback`);
    updateTime = new Date().toISOString();
  }

  const inSync = await isFileInSync(localPath, updateTime);

  if (!inSync) {
    throw new Error(
      `File out of sync: ${filename}\n` +
      `Local and remote versions differ. Run cat/raw_cat to sync before writing.\n` +
      `Remote updateTime: ${remoteFile.updateTime}`
    );
  }
}
