import { getAttribute, setAttribute, removeAttribute, listAttributes } from 'fs-xattr';

/**
 * Extended attribute names for GAS metadata
 */
const XATTR_UPDATE_TIME = 'user.gas.updateTime';
const XATTR_FILE_TYPE = 'user.gas.fileType';

/**
 * GAS metadata structure
 */
export interface GASMetadata {
  updateTime: string;  // ISO8601 timestamp from GAS API
  fileType: string;    // SERVER_JS, HTML, JSON
}

/**
 * Cache GAS metadata in file extended attributes
 * Stores updateTime and fileType for fast sync detection
 */
export async function cacheGASMetadata(
  localPath: string,
  updateTime: string,
  fileType: string
): Promise<void> {
  try {
    await setAttribute(localPath, XATTR_UPDATE_TIME, Buffer.from(updateTime, 'utf-8'));
    await setAttribute(localPath, XATTR_FILE_TYPE, Buffer.from(fileType, 'utf-8'));
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

    return { updateTime, fileType };
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
