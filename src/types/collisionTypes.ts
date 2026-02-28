/**
 * @fileoverview Collision detection types for hash-based optimistic locking
 *
 * USAGE: Return CollisionInfo in write/exec responses to inform LLM about stale files
 * without throwing errors. Allows LLM to make informed decisions about proceeding.
 *
 * KEY DESIGN: Hash comparison uses WRAPPED content, diff display uses UNWRAPPED content
 * - Hash matches `git hash-object <file>` for sync detection
 * - Diff shows what LLM actually sees (clean user code)
 */

/**
 * Information about a stale file detected during operations
 */
export interface StaleFile {
  /** File name (GAS format, no extension) */
  file: string;
  /** Hash expected based on previous cat (from local git cache) */
  expectedHash: string;
  /** Actual hash of current remote content (null if deleted) */
  actualHash: string | null;
  /** What happened to the file since last read */
  action: 'modified' | 'deleted' | 'created_externally';
  /** Unified diff for single file operations (unwrapped content for LLM readability) */
  diff?: string;
}

/**
 * Collision information returned in write/exec responses
 *
 * When hasCollisions is true, LLM should:
 * 1. Review staleFiles to understand what changed
 * 2. Follow recommendation (typically cat to refresh)
 * 3. Re-apply changes if needed
 *
 * Note: This is informational, not an error. The operation may still succeed.
 */
export interface CollisionInfo {
  /** Whether any collisions were detected */
  hasCollisions: boolean;
  /** List of stale files with details */
  staleFiles: StaleFile[];
  /** Human-readable recommendation for resolving collisions */
  recommendation: string;
  /** Diff content (format varies by operation type) */
  diff?: {
    /** 'unified' for single file ops, 'summary' for multi-file ops */
    format: 'unified' | 'summary';
    /** The actual diff content */
    content: string;
  };
}

/**
 * Build a CollisionInfo object for a single file collision
 *
 * @param file - Filename that has collision
 * @param expectedHash - Hash from previous cat
 * @param actualHash - Current remote hash
 * @param action - Type of change detected
 * @param diff - Optional unified diff content
 * @returns CollisionInfo object ready for response
 */
export function buildSingleFileCollision(
  file: string,
  expectedHash: string,
  actualHash: string | null,
  action: StaleFile['action'],
  diff?: string
): CollisionInfo {
  const staleFile: StaleFile = {
    file,
    expectedHash,
    actualHash,
    action,
  };

  if (diff) {
    staleFile.diff = diff;
  }

  return {
    hasCollisions: true,
    staleFiles: [staleFile],
    recommendation: `Use cat to refresh ${file}`,
    ...(diff && {
      diff: {
        format: 'unified',
        content: diff,
      },
    }),
  };
}

/**
 * Build a CollisionInfo object for multiple stale files
 *
 * @param staleFiles - Array of stale file info
 * @returns CollisionInfo object with folder diff summary
 */
export function buildMultiFileCollision(staleFiles: StaleFile[]): CollisionInfo {
  // Generate folder-style summary
  const lines = ['Files changed since last read:', ''];
  for (const file of staleFiles) {
    const icon =
      file.action === 'deleted'
        ? '[-]'
        : file.action === 'created_externally'
          ? '[+]'
          : '[M]';
    lines.push(`${icon} ${file.file}`);
  }

  const fileList = staleFiles.map((f) => f.file).join(', ');

  return {
    hasCollisions: true,
    staleFiles,
    recommendation: `Use cat to refresh: ${fileList}`,
    diff: {
      format: 'summary',
      content: lines.join('\n'),
    },
  };
}

/**
 * Empty collision info (no collisions detected)
 */
export const NO_COLLISIONS: CollisionInfo = {
  hasCollisions: false,
  staleFiles: [],
  recommendation: '',
};
