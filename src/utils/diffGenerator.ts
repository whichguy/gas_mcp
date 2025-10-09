/**
 * Git-style unified diff generator
 *
 * Generates readable diffs for displaying file changes.
 * Used by AiderTool and RawAiderTool for dry-run previews.
 */

export class DiffGenerator {
  /**
   * Generate git-style unified diff
   *
   * NOTE: This is a simplified implementation that assumes line-by-line changes.
   * For production use, consider using a proper diff library like 'diff' npm package
   * which implements the Myers algorithm for better diff quality.
   *
   * @param original - Original content
   * @param modified - Modified content
   * @param path - File path for diff header
   * @returns Unified diff string
   */
  generateDiff(original: string, modified: string, path: string): string {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');

    const diff: string[] = [];
    diff.push(`--- a/${path}`);
    diff.push(`+++ b/${path}`);

    // Simple line-by-line comparison
    // TODO: Replace with Myers diff algorithm for better results
    let i = 0;
    let j = 0;

    while (i < originalLines.length || j < modifiedLines.length) {
      if (i < originalLines.length && j < modifiedLines.length) {
        if (originalLines[i] === modifiedLines[j]) {
          // Lines match - show context
          diff.push(` ${originalLines[i]}`);
          i++;
          j++;
        } else {
          // Lines differ - show both
          diff.push(`-${originalLines[i]}`);
          diff.push(`+${modifiedLines[j]}`);
          i++;
          j++;
        }
      } else if (i < originalLines.length) {
        // Only original lines remain - deletions
        diff.push(`-${originalLines[i]}`);
        i++;
      } else {
        // Only modified lines remain - additions
        diff.push(`+${modifiedLines[j]}`);
        j++;
      }
    }

    return diff.join('\n');
  }

  /**
   * Generate compact summary of changes
   *
   * @param original - Original content
   * @param modified - Modified content
   * @returns Summary string with line counts
   */
  generateSummary(original: string, modified: string): string {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');

    let additions = 0;
    let deletions = 0;
    let changes = 0;

    const minLength = Math.min(originalLines.length, modifiedLines.length);

    // Count changes in overlapping lines
    for (let i = 0; i < minLength; i++) {
      if (originalLines[i] !== modifiedLines[i]) {
        changes++;
      }
    }

    // Count additions (modified has more lines)
    if (modifiedLines.length > originalLines.length) {
      additions = modifiedLines.length - originalLines.length;
    }

    // Count deletions (original has more lines)
    if (originalLines.length > modifiedLines.length) {
      deletions = originalLines.length - modifiedLines.length;
    }

    const parts: string[] = [];
    if (changes > 0) parts.push(`${changes} changed`);
    if (additions > 0) parts.push(`${additions} added`);
    if (deletions > 0) parts.push(`${deletions} deleted`);

    return parts.length > 0 ? parts.join(', ') : 'no changes';
  }
}
