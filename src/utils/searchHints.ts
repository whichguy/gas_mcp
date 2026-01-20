/**
 * Context-aware hint generators for search operations (grep/ripgrep)
 *
 * Following the sheet_sql pattern of generating hints based on actual results
 * to provide LLM-friendly guidance for next steps and troubleshooting.
 */

export interface SearchHints {
  context?: string;
  suggestions?: string[];
  warning?: string;
  nextSteps?: string[];
  performance?: string;
}

/**
 * Generate hints based on search results
 */
export function generateSearchHints(
  totalMatches: number,
  filesSearched: number,
  pattern: string,
  truncated: boolean,
  searchTimeMs?: number
): SearchHints {
  const hints: SearchHints = {};

  // No results case
  if (totalMatches === 0) {
    hints.context = 'No matches found';
    hints.suggestions = [
      'Check pattern spelling and special characters',
      'Try case-insensitive search: caseSensitive:false or ignoreCase:true',
      'Use simpler pattern: searchMode:"literal" for exact text',
      'Broaden path filter or remove it entirely',
      'For regex patterns, escape special chars: . → \\\\. and $ → \\\\$'
    ];
    hints.nextSteps = [
      'ls({scriptId}) to see all available files',
      'cat({scriptId, path:"<file>"}) to view file contents'
    ];
  }
  // Few results - might be expected or might indicate narrowness
  else if (totalMatches < 5 && filesSearched > 10) {
    hints.context = `Found ${totalMatches} match${totalMatches === 1 ? '' : 'es'} across ${filesSearched} files`;
    hints.nextSteps = [
      `cat({scriptId, path:"<matched_file>"}) to view full file context`,
      `sed/edit to modify matched content`
    ];
  }
  // Large result set
  else if (totalMatches > 50) {
    hints.warning = `Large result set (${totalMatches} matches)`;
    hints.suggestions = [
      'Add path filter: path:"specific/folder/*" to narrow scope',
      'Use more specific pattern',
      'Add file type filter: includeFileTypes:["SERVER_JS"]',
      'Use maxResults to limit output: maxResults:20'
    ];
    if (truncated) {
      hints.context = 'Results were truncated - increase maxResults to see more';
    }
  }

  // Truncation warning
  if (truncated && totalMatches <= 50) {
    hints.warning = 'Results truncated due to maxResults limit';
    hints.suggestions = hints.suggestions || [];
    hints.suggestions.push('Increase maxResults to see all matches');
  }

  // Performance hints for slow searches
  if (searchTimeMs && searchTimeMs > 2000) {
    hints.performance = `Search took ${Math.round(searchTimeMs / 1000)}s`;
    hints.suggestions = hints.suggestions || [];
    hints.suggestions.push('Reduce maxFilesSearched for faster results');
    hints.suggestions.push('Add path filter to search fewer files');
  }

  // Always add helpful next steps if we have results
  if (totalMatches > 0 && !hints.nextSteps) {
    hints.nextSteps = [
      'cat({scriptId, path:"<file>"}) to view full file',
      'sed({scriptId, path:"<file>", pattern:"...", replacement:"..."}) to replace',
      'edit({scriptId, path:"<file>", ...}) for precise edits'
    ];
  }

  return hints;
}

/**
 * Generate hints for ripgrep-specific features
 */
export function generateRipgrepHints(
  totalMatches: number,
  patternsUsed: string[],
  multilineEnabled: boolean,
  smartCaseUsed: boolean,
  replaceProvided: boolean
): SearchHints {
  const hints: SearchHints = {};

  // Multi-pattern hints
  if (patternsUsed.length > 1) {
    hints.context = `Multi-pattern search (OR logic): ${patternsUsed.join(' | ')}`;
  }

  // Feature-specific hints
  if (multilineEnabled && totalMatches === 0) {
    hints.suggestions = hints.suggestions || [];
    hints.suggestions.push('Multiline patterns use \\n for newlines - check pattern syntax');
  }

  if (smartCaseUsed) {
    hints.context = (hints.context || '') + ' | Smart case: pattern contains uppercase → case-sensitive';
  }

  if (replaceProvided && totalMatches > 0) {
    hints.nextSteps = hints.nextSteps || [];
    hints.nextSteps.unshift('Replacement suggestions shown - use sed/edit to apply changes');
  }

  return hints;
}

/**
 * Generate hints for find operations based on results
 */
export function generateFindHints(
  matchCount: number,
  namePattern?: string,
  typeFilter?: string,
  sizeFilter?: string
): SearchHints {
  const hints: SearchHints = {};

  // No results
  if (matchCount === 0) {
    hints.context = 'No files matched criteria';
    hints.suggestions = [
      'Check pattern spelling (wildcards: *, ?, [abc])',
      'Remove or broaden the name pattern',
      'Use ls({scriptId}) to see all files first'
    ];

    if (typeFilter) {
      hints.suggestions.push(`Type filter "${typeFilter}" may exclude all files`);
    }

    if (sizeFilter) {
      hints.suggestions.push(`Size filter "${sizeFilter}" may be too restrictive`);
    }

    hints.nextSteps = [
      'ls({scriptId}) to list all project files',
      'grep or ripgrep to search file contents instead'
    ];
  }
  // Very few results
  else if (matchCount < 3) {
    hints.context = `Found ${matchCount} file${matchCount === 1 ? '' : 's'}`;
    hints.nextSteps = [
      'cat({scriptId, path:"<filename>"}) to view file content',
      'grep/ripgrep to search within matched files'
    ];
  }
  // Large result set
  else if (matchCount > 50) {
    hints.warning = `Large result set (${matchCount} files)`;
    hints.suggestions = [
      'Add name pattern to narrow results: name:"*.test.gs"',
      'Add type filter: type:"SERVER_JS"',
      'Add path prefix to search specific folder'
    ];
  }

  // Pattern-specific hints
  if (namePattern && namePattern.includes('test')) {
    hints.nextSteps = hints.nextSteps || [];
    hints.nextSteps.push('Test files found - consider running tests');
  }

  return hints;
}

/**
 * Merge multiple hint objects
 */
export function mergeHints(...hintObjects: SearchHints[]): SearchHints {
  const merged: SearchHints = {};

  for (const hints of hintObjects) {
    if (hints.context) {
      merged.context = merged.context ? `${merged.context} | ${hints.context}` : hints.context;
    }
    if (hints.warning) {
      merged.warning = merged.warning ? `${merged.warning}; ${hints.warning}` : hints.warning;
    }
    if (hints.performance) {
      merged.performance = hints.performance;
    }
    if (hints.suggestions) {
      merged.suggestions = merged.suggestions || [];
      merged.suggestions.push(...hints.suggestions);
    }
    if (hints.nextSteps) {
      merged.nextSteps = merged.nextSteps || [];
      merged.nextSteps.push(...hints.nextSteps);
    }
  }

  // Deduplicate arrays
  if (merged.suggestions) {
    merged.suggestions = [...new Set(merged.suggestions)];
  }
  if (merged.nextSteps) {
    merged.nextSteps = [...new Set(merged.nextSteps)];
  }

  return merged;
}
