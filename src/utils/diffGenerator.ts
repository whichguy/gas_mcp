/**
 * Git-style unified diff generator
 *
 * Generates readable diffs for displaying file changes.
 * Used by AiderTool, RawAiderTool for dry-run previews, and collision detection.
 *
 * Uses the 'diff' npm package (Myers algorithm) for high-quality diffs.
 */

import { createTwoFilesPatch, structuredPatch } from 'diff';

export class DiffGenerator {
  /**
   * Generate git-style unified diff using Myers algorithm
   *
   * @param original - Original content
   * @param modified - Modified content
   * @param path - File path for diff header
   * @returns Unified diff string
   */
  generateDiff(original: string, modified: string, path: string): string {
    return createTwoFilesPatch(
      `a/${path}`,
      `b/${path}`,
      original,
      modified,
      'original',
      'modified'
    );
  }

  /**
   * Generate compact summary of changes using Myers diff
   *
   * @param original - Original content
   * @param modified - Modified content
   * @returns Summary string with accurate line counts
   */
  generateSummary(original: string, modified: string): string {
    const patch = structuredPatch('file', 'file', original, modified);

    let additions = 0;
    let deletions = 0;

    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) additions++;
        else if (line.startsWith('-')) deletions++;
      }
    }

    const parts: string[] = [];
    if (additions > 0) parts.push(`+${additions}`);
    if (deletions > 0) parts.push(`-${deletions}`);

    return parts.length > 0 ? parts.join(', ') : 'no changes';
  }
}

// ============================================================================
// Standalone functions for collision detection
// ============================================================================

import type { StaleFile } from '../types/collisionTypes.js';

/**
 * Generate unified diff for a single file collision
 *
 * Used when displaying what changed between expected and actual content.
 * Content should be UNWRAPPED for LLM readability (matches what LLM sees in cat).
 *
 * @param filename - File name for diff header
 * @param expectedContent - Content we expected (from previous cat)
 * @param actualContent - Current actual content (from remote)
 * @returns Unified diff string
 */
export function generateFileDiff(
  filename: string,
  expectedContent: string,
  actualContent: string
): string {
  return createTwoFilesPatch(
    `a/${filename}`,
    `b/${filename}`,
    expectedContent,
    actualContent,
    'expected (your version)',
    'actual (current remote)'
  );
}

/**
 * Generate folder-style diff summary for multiple stale files
 *
 * Used in exec staleness detection to show which files have drifted.
 *
 * @param staleFiles - Array of stale file info
 * @returns Summary string with file list and change indicators
 */
export function generateFolderDiff(staleFiles: StaleFile[]): string {
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

  return lines.join('\n');
}

/**
 * Get diff statistics (additions and deletions)
 *
 * @param original - Original content
 * @param modified - Modified content
 * @returns Object with linesAdded and linesRemoved counts
 */
export function getDiffStats(
  original: string,
  modified: string
): { linesAdded: number; linesRemoved: number } {
  const patch = structuredPatch('file', 'file', original, modified);

  let linesAdded = 0;
  let linesRemoved = 0;

  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) linesAdded++;
      else if (line.startsWith('-')) linesRemoved++;
    }
  }

  return { linesAdded, linesRemoved };
}
