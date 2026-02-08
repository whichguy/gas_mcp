import { getAttribute, setAttribute, removeAttribute, listAttributes } from 'fs-xattr';
import { promises as fs } from 'fs';
import { computeGitSha1 } from './hashUtils.js';

/**
 * Extended attribute names for GAS metadata
 */
const XATTR_UPDATE_TIME = 'user.gas.updateTime';
const XATTR_FILE_TYPE = 'user.gas.fileType';
const XATTR_CONTENT_HASH = 'user.gas.contentHash';
const XATTR_HASH_MTIME = 'user.gas.hashMtime';  // mtime when hash was computed

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
  // Remove each attribute independently - don't let one failure stop the others
  const attrs = [XATTR_UPDATE_TIME, XATTR_FILE_TYPE, XATTR_CONTENT_HASH, XATTR_HASH_MTIME];
  for (const attr of attrs) {
    try {
      await removeAttribute(localPath, attr);
    } catch {
      // Ignore errors - attribute may not exist
    }
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
 *
 * NOTE: This returns the raw cached hash WITHOUT mtime validation.
 * For most use cases, prefer getValidatedContentHash() which validates
 * that the file hasn't been modified since the hash was computed.
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
 * Result from getValidatedContentHash()
 */
export interface ValidatedHashResult {
  hash: string;
  source: 'cache' | 'computed';
}

/**
 * Get cached hash with mtime-based validation.
 * Recomputes if cache is stale (mtime changed) or missing.
 *
 * This function detects when files are modified outside MCP tools (e.g., via editor,
 * git checkout) by comparing the current file mtime against the mtime stored when
 * the hash was cached.
 *
 * MCP tools set file mtime to remote updateTime (not current time), so:
 * - After MCP write: file.mtime = remote updateTime, xattr.hashMtime = same → cache valid
 * - After user edit: file.mtime = NOW, xattr.hashMtime = old → cache invalid → recompute
 *
 * @param localPath - Path to the local file
 * @returns { hash, source } or null if file doesn't exist
 */
export async function getValidatedContentHash(
  localPath: string
): Promise<ValidatedHashResult | null> {
  try {
    const stat = await fs.stat(localPath);
    const currentMtime = stat.mtimeMs;

    // Try to get cached values
    let cachedHash: string | null = null;
    let cachedMtime: number | null = null;

    try {
      const hashBuffer = await getAttribute(localPath, XATTR_CONTENT_HASH);
      const hashStr = hashBuffer.toString('utf-8');
      if (/^[a-f0-9]{40}$/i.test(hashStr)) {
        cachedHash = hashStr;
      }
    } catch { /* missing */ }

    try {
      const mtimeBuffer = await getAttribute(localPath, XATTR_HASH_MTIME);
      cachedMtime = parseFloat(mtimeBuffer.toString('utf-8'));
      if (isNaN(cachedMtime)) cachedMtime = null;
    } catch { /* missing */ }

    // CASE 4: Cache valid - mtime matches (within 1ms tolerance for float comparison)
    if (cachedHash && cachedMtime !== null && Math.abs(cachedMtime - currentMtime) < 1) {
      return { hash: cachedHash, source: 'cache' };
    }

    // CASES 1,2,3: Need to recompute (hash missing, mtime missing, or mtime differs)
    const content = await fs.readFile(localPath, 'utf-8');
    const computedHash = computeGitSha1(content);

    // Update cache with new hash + current mtime
    await updateCachedContentHash(localPath, computedHash);

    return { hash: computedHash, source: 'computed' };

  } catch (error: any) {
    if (error.code === 'ENOENT') return null;  // File doesn't exist
    throw error;
  }
}

/**
 * Update just the content hash in file extended attributes
 * Use this after successful writes to update the cached hash
 *
 * CRITICAL: contentHash must be computed on WRAPPED content (full file as stored in GAS)
 *
 * IMPORTANT: Call this AFTER file write and AFTER setFileMtimeToRemote() completes,
 * so the stored mtime reflects the final file state.
 */
export async function updateCachedContentHash(
  localPath: string,
  contentHash: string
): Promise<void> {
  try {
    // Read current file mtime (should be remote updateTime after MCP write)
    const stat = await fs.stat(localPath);
    const mtime = stat.mtimeMs;

    await setAttribute(localPath, XATTR_CONTENT_HASH, Buffer.from(contentHash, 'utf-8'));
    await setAttribute(localPath, XATTR_HASH_MTIME, Buffer.from(mtime.toString(), 'utf-8'));
  } catch (error: any) {
    // Non-fatal: xattr not supported on filesystem
    console.debug(`Failed to update content hash for ${localPath}: ${error.message}`);
  }
}
