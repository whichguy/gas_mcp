import { getAttribute, setAttribute, removeAttribute, listAttributes } from 'fs-xattr';

/**
 * Extended attribute names for GAS metadata
 */
const XATTR_UPDATE_TIME = 'user.gas.updateTime';
const XATTR_FILE_TYPE = 'user.gas.fileType';
const XATTR_CONTENT_HASH = 'user.gas.contentHash';

/**
 * GAS metadata structure
 */
export interface GASMetadata {
  updateTime: string;  // ISO8601 timestamp from GAS API
  fileType: string;    // SERVER_JS, HTML, JSON
  contentHash?: string; // Git SHA-1 hash (40 hex chars) of WRAPPED content (full file as stored in GAS)
}

/**
 * Cache GAS metadata in file extended attributes
 * Stores updateTime, fileType, and contentHash for fast sync detection
 *
 * CRITICAL: contentHash must be computed on WRAPPED content (full file as stored in GAS).
 * This ensures hash matches `git hash-object <file>` on local synced files.
 */
export async function cacheGASMetadata(
  localPath: string,
  updateTime: string,
  fileType: string,
  contentHash?: string
): Promise<void> {
  try {
    await setAttribute(localPath, XATTR_UPDATE_TIME, Buffer.from(updateTime, 'utf-8'));
    await setAttribute(localPath, XATTR_FILE_TYPE, Buffer.from(fileType, 'utf-8'));
    if (contentHash) {
      await setAttribute(localPath, XATTR_CONTENT_HASH, Buffer.from(contentHash, 'utf-8'));
    }
  } catch (error: any) {
    // Non-fatal: xattr not supported on filesystem or permissions issue
    // Gracefully degrade - file will still work, just slower
    console.debug(`Failed to cache GAS metadata for ${localPath}: ${error.message}`);
  }
}

/**
 * Retrieve cached GAS metadata from file extended attributes
 * Returns null if metadata not found or corrupted
 */
export async function getCachedGASMetadata(localPath: string): Promise<GASMetadata | null> {
  try {
    const updateTimeBuffer = await getAttribute(localPath, XATTR_UPDATE_TIME);
    const fileTypeBuffer = await getAttribute(localPath, XATTR_FILE_TYPE);

    const updateTime = updateTimeBuffer.toString('utf-8');
    const fileType = fileTypeBuffer.toString('utf-8');

    // Validate data
    if (!updateTime || !fileType) {
      return null;
    }

    // Try to get contentHash (optional - may not exist on older cached files)
    let contentHash: string | undefined;
    try {
      const contentHashBuffer = await getAttribute(localPath, XATTR_CONTENT_HASH);
      contentHash = contentHashBuffer.toString('utf-8');
    } catch {
      // contentHash not present - this is OK for backwards compatibility
    }

    return { updateTime, fileType, contentHash };
  } catch (error: any) {
    // Attribute not found or read error - return null to trigger API call
    return null;
  }
}

/**
 * Remove cached GAS metadata from file extended attributes
 */
export async function clearGASMetadata(localPath: string): Promise<void> {
  try {
    await removeAttribute(localPath, XATTR_UPDATE_TIME);
    await removeAttribute(localPath, XATTR_FILE_TYPE);
    await removeAttribute(localPath, XATTR_CONTENT_HASH);
  } catch (error: any) {
    // Ignore errors - attribute may not exist
  }
}

/**
 * Check if file has cached GAS metadata
 */
export async function hasCachedMetadata(localPath: string): Promise<boolean> {
  try {
    const attrs = await listAttributes(localPath);
    return attrs.includes(XATTR_UPDATE_TIME) && attrs.includes(XATTR_FILE_TYPE);
  } catch (error: any) {
    return false;
  }
}

/**
 * Get just the cached content hash from file extended attributes
 * Returns null if not found
 */
export async function getCachedContentHash(localPath: string): Promise<string | null> {
  try {
    const contentHashBuffer = await getAttribute(localPath, XATTR_CONTENT_HASH);
    const hash = contentHashBuffer.toString('utf-8');
    // Validate it looks like a Git SHA-1 hash (40 hex chars)
    if (hash && /^[a-f0-9]{40}$/i.test(hash)) {
      return hash;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Update just the content hash in file extended attributes
 * Use this after successful writes to update the cached hash
 *
 * CRITICAL: contentHash must be computed on WRAPPED content (full file as stored in GAS)
 */
export async function updateCachedContentHash(
  localPath: string,
  contentHash: string
): Promise<void> {
  try {
    await setAttribute(localPath, XATTR_CONTENT_HASH, Buffer.from(contentHash, 'utf-8'));
  } catch (error: any) {
    // Non-fatal: xattr not supported on filesystem
    console.debug(`Failed to update content hash for ${localPath}: ${error.message}`);
  }
}
