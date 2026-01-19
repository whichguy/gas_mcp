/**
 * Ripgrep Utility Functions
 *
 * Shared utilities for ripgrep and raw_ripgrep tools.
 * Extracted to avoid code duplication between RipgrepTool and RawRipgrepTool.
 */

import { fileNameMatches } from '../api/pathParser.js';

/**
 * GAS file type for sorting operations
 */
interface GASFileForSort {
  name: string;
  lastModified?: number;
}

/**
 * Sort search results by specified criteria
 *
 * @param matches - Array of match results to sort (must have fileName property)
 * @param sortBy - Sort order: 'path' for alphabetical, 'modified' for newest first
 * @param files - Original GAS files array for accessing metadata
 * @returns Sorted copy of matches array
 */
export function sortRipgrepResults<T extends { fileName: string }>(
  matches: T[],
  sortBy: 'path' | 'modified',
  files: GASFileForSort[]
): T[] {
  return [...matches].sort((a, b) => {
    if (sortBy === 'path') {
      // Sort alphabetically by file name
      return a.fileName.localeCompare(b.fileName);
    } else if (sortBy === 'modified') {
      // Sort by modification time (newest first)
      // Note: GAS files don't have lastModified in standard API response
      // This is a placeholder for future enhancement
      const aFile = files.find(f => fileNameMatches(f.name, a.fileName));
      const bFile = files.find(f => fileNameMatches(f.name, b.fileName));
      const aTime = (aFile as any)?.lastModified || 0;
      const bTime = (bFile as any)?.lastModified || 0;
      return bTime - aTime;
    }
    return 0;
  });
}

/**
 * Trim leading and trailing whitespace from result lines
 *
 * @param matches - Array of match results to process (must have optional lines property)
 * @returns Processed matches with trimmed line content
 */
export function trimRipgrepResultLines<T>(matches: T[]): T[] {
  return matches.map(fileResult => {
    const result = fileResult as any;
    if (result.lines && Array.isArray(result.lines)) {
      return {
        ...result,
        lines: result.lines.map((line: any) => {
          if (typeof line === 'string') {
            return line.trim();
          } else if (line && typeof line.content === 'string') {
            return {
              ...line,
              content: line.content.trim()
            };
          }
          return line;
        })
      } as T;
    }
    return fileResult;
  });
}
