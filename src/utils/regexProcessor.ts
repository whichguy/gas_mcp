/**
 * RegexProcessor - Centralized regex pattern handling for search tools
 *
 * Eliminates duplication across GrepTool, RawGrepTool, SedTool, RawSedTool,
 * RipgrepTool, and RawRipgrepTool.
 *
 * Features:
 * - Automatic pattern detection (regex vs literal)
 * - Case-insensitive matching support
 * - Word boundary wrapping
 * - Literal string escaping
 */

export type SearchMode = 'auto' | 'regex' | 'literal';

export interface RegexOptions {
  /**
   * Pattern interpretation mode
   * - auto: Detect regex metacharacters automatically
   * - regex: Treat as regular expression
   * - literal: Escape all special characters
   */
  searchMode?: SearchMode;

  /**
   * Case-insensitive matching
   */
  caseSensitive?: boolean;

  /**
   * Match whole words only (adds \b boundaries)
   */
  wholeWord?: boolean;

  /**
   * Fixed strings mode (alias for searchMode: 'literal')
   */
  fixedStrings?: boolean;
}

export class RegexProcessor {
  /**
   * Check if a string contains regex metacharacters
   */
  private static hasRegexMetachars(pattern: string): boolean {
    return /[.*+?^${}()|[\]\\]/.test(pattern);
  }

  /**
   * Escape special regex characters for literal matching
   */
  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Build a RegExp from pattern and options
   *
   * @param pattern - Search pattern (regex or literal string)
   * @param options - Configuration options
   * @returns Compiled RegExp object
   */
  static buildRegex(pattern: string, options: RegexOptions = {}): RegExp {
    const {
      searchMode = 'auto',
      caseSensitive = false,
      wholeWord = false,
      fixedStrings = false
    } = options;

    // Determine effective search mode
    let effectiveMode = searchMode;
    if (fixedStrings) {
      effectiveMode = 'literal';
    } else if (searchMode === 'auto') {
      effectiveMode = this.hasRegexMetachars(pattern) ? 'regex' : 'literal';
    }

    // Process pattern based on mode
    let processedPattern = pattern;
    if (effectiveMode === 'literal') {
      processedPattern = this.escapeRegex(pattern);
    }

    // Add word boundaries if requested
    if (wholeWord) {
      processedPattern = `\\b${processedPattern}\\b`;
    }

    // Build flags
    const flags = caseSensitive ? 'g' : 'gi';

    return new RegExp(processedPattern, flags);
  }

  /**
   * Test if a pattern matches a string
   *
   * @param pattern - Search pattern
   * @param text - Text to search
   * @param options - Configuration options
   * @returns True if pattern matches
   */
  static test(pattern: string, text: string, options: RegexOptions = {}): boolean {
    const regex = this.buildRegex(pattern, options);
    return regex.test(text);
  }

  /**
   * Find all matches of a pattern in text
   *
   * @param pattern - Search pattern
   * @param text - Text to search
   * @param options - Configuration options
   * @returns Array of match results with line/column info
   */
  static findMatches(
    pattern: string,
    text: string,
    options: RegexOptions = {}
  ): Array<{ match: string; index: number; line: number; column: number }> {
    const regex = this.buildRegex(pattern, options);
    const lines = text.split('\n');
    const matches: Array<{ match: string; index: number; line: number; column: number }> = [];

    let globalIndex = 0;
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      let match: RegExpExecArray | null;

      // Reset regex for each line
      regex.lastIndex = 0;

      while ((match = regex.exec(line)) !== null) {
        matches.push({
          match: match[0],
          index: globalIndex + match.index,
          line: lineNum + 1, // 1-based line numbers
          column: match.index + 1 // 1-based column numbers
        });

        // Prevent infinite loops on zero-length matches
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }

      globalIndex += line.length + 1; // +1 for newline
    }

    return matches;
  }

  /**
   * Replace all matches of a pattern in text
   *
   * @param pattern - Search pattern
   * @param replacement - Replacement string (supports $1, $2 capture groups)
   * @param text - Text to search and replace
   * @param options - Configuration options
   * @returns Modified text with replacements applied
   */
  static replace(
    pattern: string,
    replacement: string,
    text: string,
    options: RegexOptions = {}
  ): { text: string; count: number } {
    const regex = this.buildRegex(pattern, options);
    let count = 0;

    const modifiedText = text.replace(regex, (...args) => {
      count++;

      // args = [fullMatch, captureGroup1, captureGroup2, ..., offset, fullString, groups]
      const fullMatch = args[0];
      const offset = args[args.length - 2];
      const captureGroups = args.slice(1, args.length - 2);

      // Replace $1, $2, etc. with actual capture groups
      let result = replacement;
      captureGroups.forEach((group, index) => {
        const groupNum = index + 1;
        result = result.replace(new RegExp(`\\$${groupNum}`, 'g'), group || '');
      });

      // Also support $& for full match
      result = result.replace(/\$&/g, fullMatch);

      return result;
    });

    return { text: modifiedText, count };
  }

  /**
   * Count matches of a pattern in text
   *
   * @param pattern - Search pattern
   * @param text - Text to search
   * @param options - Configuration options
   * @returns Number of matches found
   */
  static countMatches(pattern: string, text: string, options: RegexOptions = {}): number {
    const matches = this.findMatches(pattern, text, options);
    return matches.length;
  }
}
