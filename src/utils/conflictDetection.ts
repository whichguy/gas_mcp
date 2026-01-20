/**
 * @fileoverview Shared conflict detection utility for hash-based optimistic locking
 *
 * USAGE: All file operations (write, rm, mv, cp) should use checkForConflict()
 * to detect concurrent modifications before applying changes.
 *
 * HASH: Computed on WRAPPED content (full file as stored in GAS)
 * This ensures hash matches `git hash-object <file>` on local synced files
 */

import { ConflictError, type ConflictDetails } from '../errors/mcpErrors.js';
import { computeGitSha1, hashesEqual } from './hashUtils.js';
import { log } from './logger.js';

/**
 * Parameters for conflict checking
 */
export interface ConflictCheckParams {
  /** GAS project ID */
  scriptId: string;
  /** File being operated on */
  filename: string;
  /** Type of operation for error reporting */
  operation: ConflictDetails['operation'];
  /** Current remote file content (wrapped) */
  currentRemoteContent: string;
  /** Expected hash from previous read (optional) */
  expectedHash?: string;
  /** Source of expected hash: 'param' if explicitly provided, 'xattr' if from cache */
  hashSource?: 'param' | 'xattr';
  /** Force bypass conflict detection */
  force?: boolean;
}

/**
 * Result of conflict check
 */
export interface ConflictCheckResult {
  /** Whether the operation should proceed */
  shouldProceed: boolean;
  /** Current remote file hash (always computed) */
  currentRemoteHash: string;
  /** Conflict details if shouldProceed is false */
  conflict?: ConflictDetails;
}

/**
 * Check for concurrent modifications using hash comparison
 *
 * @param params - Conflict check parameters
 * @returns Result indicating whether to proceed or conflict details
 *
 * @example
 * ```typescript
 * const result = checkForConflict({
 *   scriptId: '1abc...',
 *   filename: 'utils',
 *   operation: 'write',
 *   currentRemoteContent: existingFile.source,
 *   expectedHash: params.expectedHash,
 *   hashSource: 'param',
 *   force: params.force
 * });
 *
 * if (!result.shouldProceed) {
 *   throw new ConflictError(result.conflict!);
 * }
 * ```
 */
export function checkForConflict(params: ConflictCheckParams): ConflictCheckResult {
  const {
    scriptId,
    filename,
    operation,
    currentRemoteContent,
    expectedHash,
    hashSource = 'param',
    force = false
  } = params;

  // Compute current remote hash on WRAPPED content
  const currentRemoteHash = computeGitSha1(currentRemoteContent);

  // Force bypass - log and proceed
  if (force && expectedHash) {
    log.warn(
      `[${operation.toUpperCase()}] force=true: bypassing conflict detection for ${filename} ` +
      `(remote hash: ${currentRemoteHash.slice(0, 8)}...)`
    );
    return { shouldProceed: true, currentRemoteHash };
  }

  // No expected hash - nothing to check
  if (!expectedHash) {
    return { shouldProceed: true, currentRemoteHash };
  }

  // Hash match - proceed
  if (hashesEqual(expectedHash, currentRemoteHash)) {
    return { shouldProceed: true, currentRemoteHash };
  }

  // Hash mismatch - build conflict details
  const contentSize = currentRemoteContent.length;

  // Use 'info' format consistently since we don't have expected content
  const diffContent = `File was modified externally since your last read.
  Expected hash: ${expectedHash.slice(0, 8)}...
  Current hash:  ${currentRemoteHash.slice(0, 8)}...
  Size:          ${contentSize} bytes

To resolve: Use cat() to fetch current content, then re-apply your changes.
Or use force:true to overwrite (destructive).`;

  const conflict: ConflictDetails = {
    scriptId,
    filename,
    operation,
    expectedHash,
    currentHash: currentRemoteHash,
    hashSource,
    changeDetails: {
      sizeChange: `${contentSize} bytes`
    },
    diff: {
      format: 'info',
      content: diffContent,
      truncated: false
    }
  };

  return {
    shouldProceed: false,
    currentRemoteHash,
    conflict
  };
}

/**
 * Convenience function that throws ConflictError if conflict detected
 *
 * @param params - Conflict check parameters
 * @returns Current remote hash if no conflict
 * @throws ConflictError if hash mismatch detected
 */
export function checkForConflictOrThrow(params: ConflictCheckParams): string {
  const result = checkForConflict(params);

  if (!result.shouldProceed && result.conflict) {
    throw new ConflictError(result.conflict);
  }

  return result.currentRemoteHash;
}
