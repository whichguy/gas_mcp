/**
 * @fileoverview Git-Compatible Hash Utilities
 *
 * FORMAT: sha1("blob " + size + "\0" + content) - matches `git hash-object`
 * USED BY: cat | write | ls | edit | conflict detection | sync check
 * HASH ON: WRAPPED content (full file with CommonJS), NOT unwrapped user code
 * NORMALIZATION: CRLF→LF | UTF-8 BOM stripped | consistent across all tools
 */
import { createHash } from 'crypto';

/**
 * Compute Git-compatible SHA-1 checksum for content
 *
 * Uses Git's blob format: sha1("blob " + <size> + "\0" + <content>)
 * This matches the output of `git hash-object <file>`
 *
 * IMPORTANT: For GAS files, content should be the FULL file as stored in GAS
 * (including CommonJS wrappers), NOT unwrapped user code.
 *
 * @param content - Content as string (normalized to LF line endings, UTF-8 BOM stripped)
 * @returns Git-compatible SHA-1 hash as 40-character hex string
 */
export function computeGitSha1(content: string): string {
  // Normalize content for consistent hashing:
  // 1. Normalize line endings to LF (Unix style)
  // 2. Strip UTF-8 BOM if present
  const normalizedContent = normalizeForHashing(content);

  const size = Buffer.byteLength(normalizedContent, 'utf8');
  const header = `blob ${size}\0`;
  return createHash('sha1')
    .update(header)
    .update(normalizedContent, 'utf8')
    .digest('hex');
}

/**
 * Compute SHA-256 hash for content
 *
 * @param content - Content as string
 * @returns SHA-256 hash as 64-character hex string
 */
export function computeSha256(content: string): string {
  const normalizedContent = normalizeForHashing(content);
  return createHash('sha256')
    .update(normalizedContent, 'utf8')
    .digest('hex');
}

/**
 * Compute MD5 hash for content (legacy compatibility)
 *
 * @param content - Content as string
 * @returns MD5 hash as 32-character hex string
 */
export function computeMd5(content: string): string {
  const normalizedContent = normalizeForHashing(content);
  return createHash('md5')
    .update(normalizedContent, 'utf8')
    .digest('hex');
}

/**
 * Normalize content for consistent hashing across platforms
 *
 * - Normalizes CRLF to LF (consistent with Git)
 * - Strips UTF-8 BOM if present
 * - Does NOT modify trailing newlines (document behavior)
 */
export function normalizeForHashing(content: string): string {
  // Strip UTF-8 BOM if present (0xEF 0xBB 0xBF = \uFEFF)
  let normalized = content.startsWith('\uFEFF') ? content.slice(1) : content;

  // Normalize CRLF to LF (Windows -> Unix line endings)
  normalized = normalized.replace(/\r\n/g, '\n');

  return normalized;
}

/**
 * Validate that a string looks like a valid Git SHA-1 hash
 *
 * @param hash - String to validate
 * @returns true if hash is 40 lowercase hex characters
 */
export function isValidGitSha1(hash: string): boolean {
  return /^[a-f0-9]{40}$/.test(hash);
}

/**
 * Compare two hashes for equality (case-insensitive)
 *
 * @param hash1 - First hash
 * @param hash2 - Second hash
 * @returns true if hashes are equal
 */
export function hashesEqual(hash1: string, hash2: string): boolean {
  return hash1.toLowerCase() === hash2.toLowerCase();
}
