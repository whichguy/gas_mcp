/**
 * Core grep search engine for gas_grep command
 * Handles file filtering, content searching, and result management
 */

import { parsePath, isWildcardPattern, matchesPattern } from '../api/pathParser.js';
import { 
  validateGrepPattern, 
  compileGrepPattern, 
  detectSearchMode,
  estimatePatternComplexity 
} from './patternValidator.js';

export interface GrepMatch {
  lineNumber: number;
  line: string;
  context?: {
    before: string[];
    after: string[];
  };
  matchStart: number;
  matchEnd: number;
  matchText: string;
}

export interface GrepFileResult {
  fileName: string;
  fileType: string;
  totalMatches: number;
  matches: GrepMatch[];
}

export interface GrepSearchResult {
  searchPattern: string;
  searchMode: 'regex' | 'literal' | 'auto';
  caseSensitive: boolean;
  totalMatches: number;
  totalFiles: number;
  filesSearched: number;
  truncated: boolean;
  matches: GrepFileResult[];
  searchTime: number;
  tokenEstimate: number;
  scriptId?: string;
}

export interface GrepSearchOptions {
  pattern: string;
  searchMode?: 'regex' | 'literal' | 'auto';
  pathMode?: 'wildcard' | 'regex' | 'auto';
  caseSensitive?: boolean;
  wholeWord?: boolean;
  maxResults?: number;
  maxFilesSearched?: number;
  contextLines?: number;
  showLineNumbers?: boolean;
  showFileHeaders?: boolean;
  compact?: boolean;
  excludeFiles?: string[];
  includeFileTypes?: string[];
}

export interface GASFile {
  name: string;
  type: string;
  source?: string;
  size?: number;
}

// Token estimation constants
const TOKEN_LIMITS = {
  maxResponseTokens: 20000,
  maxFileSize: 50000,
  searchTimeout: 30000,
  averageCharsPerToken: 3.5
};

/**
 * Detect path mode based on pattern content
 */
export function detectPathMode(path: string): 'wildcard' | 'regex' | 'auto' {
  // Check for regex-specific patterns
  const regexPatterns = [
    /\([^)]*\|[^)]*\)/,  // Alternation groups: (utils|helpers)
    /\\\./,              // Escaped dots: \.
    /\$$/,               // End anchors: $
    /^\^/,               // Start anchors: ^
    /\[\^/,              // Negated character classes: [^
    /\+\?/,              // Non-greedy quantifiers: +?
    /\{\d+,?\d*\}/,      // Specific quantifiers: {2,5}
    /\.\*/,              // Dot-star patterns: .*
    /\.\+/,              // Dot-plus patterns: .+
    /\\\w/,              // Escaped word chars: \w, \d, \s
    /\(\?\:/             // Non-capturing groups: (?:
  ];
  
  // Check for clear regex patterns
  if (regexPatterns.some(pattern => pattern.test(path))) {
    return 'regex';
  }
  
  // Check for wildcard patterns (but not if they look like regex)
  if (isWildcardPattern(path) && !path.includes('.')) {
    return 'wildcard';
  }
  
  return 'auto';
}

/**
 * Match filename against path pattern using specified mode
 */
export function matchesPathPattern(
  filename: string,
  pathPattern: string,
  mode: 'wildcard' | 'regex' | 'auto',
  scriptId?: string
): boolean {
  // Remove script ID prefix for consistent matching
  let targetPath = filename;
  if (scriptId && pathPattern.startsWith(scriptId + '/')) {
    pathPattern = pathPattern.substring(scriptId.length + 1);
  }
  
  // Handle different path modes
  switch (mode) {
    case 'wildcard':
      return matchesPattern(targetPath, pathPattern);
      
    case 'regex':
      try {
        const regex = new RegExp(pathPattern);
        return regex.test(targetPath);
      } catch (error) {
        console.error(`Invalid regex path pattern: ${pathPattern}`, error);
        return false;
      }
      
    case 'auto':
      const detectedMode = detectPathMode(pathPattern);
      if (detectedMode === 'regex') {
        return matchesPathPattern(filename, pathPattern, 'regex', scriptId);
      } else {
        return matchesPathPattern(filename, pathPattern, 'wildcard', scriptId);
      }
      
    default:
      return false;
  }
}

/**
 * Validate regex path pattern for safety
 */
export function validatePathPattern(pattern: string, mode: 'wildcard' | 'regex' | 'auto'): { valid: boolean; error?: string } {
  if (mode === 'regex' || (mode === 'auto' && detectPathMode(pattern) === 'regex')) {
    // Basic regex validation for paths
    try {
      new RegExp(pattern);
      
      // Check for potentially expensive patterns
      if (pattern.includes('(.*)') || pattern.includes('(.+)')) {
        return {
          valid: false,
          error: 'Potentially expensive regex pattern in path. Use more specific patterns.'
        };
      }
      
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Invalid regex pattern: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
  
  return { valid: true };
}

/**
 * Core grep search engine
 */
export class GrepSearchEngine {
  
  /**
   * Calculate pseudo-directory depth for GAS file system
   */
  protected calculatePseudoDepth(filename: string): number {
    return (filename.match(/\//g) || []).length;
  }

  /**
   * Filter files by pseudo-directory path pattern
   */
  protected filterByPseudoPath(
    files: GASFile[], 
    pathPattern: string, 
    maxDepth?: number,
    pathMode: 'wildcard' | 'regex' | 'auto' = 'auto'
  ): GASFile[] {
    if (!pathPattern) return files;
    
    return files.filter(file => {
      // Check depth limit
      if (maxDepth !== undefined && this.calculatePseudoDepth(file.name) > maxDepth) {
        return false;
      }
      
      // Match against path pattern
      return matchesPathPattern(file.name, pathPattern, pathMode);
    });
  }

  /**
   * Detect if pattern has ripgrep-specific features
   */
  protected hasRipgrepFeatures(pattern: string): boolean {
    return pattern.includes('(?') || // Non-capturing groups
           pattern.includes('\\b') || // Word boundaries
           pattern.includes('(?i)') || // Inline flags
           pattern.includes('(?m)') || // Multiline mode
           pattern.includes('(?s)') || // Dotall mode
           pattern.includes('\\p{') || // Unicode categories
           /\(\?\<\w+\>/.test(pattern); // Named groups
  }

  /**
   * Search across multiple files with pattern matching
   */
  async searchFiles(
    files: GASFile[], 
    options: GrepSearchOptions,
    scriptId?: string
  ): Promise<GrepSearchResult> {
    const startTime = Date.now();
    
    // Validate pattern
    const validation = validateGrepPattern(options.pattern);
    if (!validation.valid) {
      throw new Error(`Invalid pattern: ${validation.error}. ${validation.suggestion || ''}`);
    }

    // Detect search mode if auto
    const searchMode = options.searchMode || detectSearchMode(options.pattern);
    
    // Compile regex pattern
    const regex = compileGrepPattern(
      options.pattern,
      searchMode,
      options.caseSensitive || false,
      options.wholeWord || false
    );

    // Filter files based on options
    const filteredFiles = this.filterFiles(files, options);
    
    // Limit files searched for performance
    const maxFiles = options.maxFilesSearched || 100;
    const filesToSearch = filteredFiles.slice(0, maxFiles);
    
    // Search each file
    const fileResults: GrepFileResult[] = [];
    let totalMatches = 0;
    const maxResults = options.maxResults || 50;
    
    for (const file of filesToSearch) {
      if (totalMatches >= maxResults) break;
      
      // Skip very large files
      if (file.source && file.source.length > TOKEN_LIMITS.maxFileSize) {
        continue;
      }
      
      const fileResult = this.searchFile(file, regex, options);
      if (fileResult && fileResult.totalMatches > 0) {
        // Limit matches per file if approaching total limit
        const remainingSlots = maxResults - totalMatches;
        if (fileResult.matches.length > remainingSlots) {
          fileResult.matches = fileResult.matches.slice(0, remainingSlots);
          fileResult.totalMatches = fileResult.matches.length;
        }
        
        fileResults.push(fileResult);
        totalMatches += fileResult.totalMatches;
      }
    }

    const searchTime = Date.now() - startTime;
    const tokenEstimate = this.estimateTokens(fileResults);
    
    return {
      searchPattern: options.pattern,
      searchMode,
      caseSensitive: options.caseSensitive || false,
      totalMatches,
      totalFiles: filteredFiles.length,
      filesSearched: filesToSearch.length,
      truncated: totalMatches >= maxResults || filesToSearch.length < filteredFiles.length,
      matches: fileResults,
      searchTime,
      tokenEstimate,
      scriptId
    };
  }

  /**
   * Filter files based on search options
   */
  protected filterFiles(files: GASFile[], options: GrepSearchOptions | { excludeFiles?: string[]; includeFileTypes?: string[]; }): GASFile[] {
    let filtered = [...files];

    // Filter by file types if specified
    if (options.includeFileTypes && options.includeFileTypes.length > 0) {
      filtered = filtered.filter(file => 
        options.includeFileTypes!.includes(file.type)
      );
    }

    // Exclude files if specified
    if (options.excludeFiles && options.excludeFiles.length > 0) {
      filtered = filtered.filter(file => {
        return !options.excludeFiles!.some(excludePattern => {
          if (isWildcardPattern(excludePattern)) {
            return matchesPattern(file.name, excludePattern);
          }
          return file.name === excludePattern;
        });
      });
    }

    return filtered;
  }

  /**
   * Search within a single file
   */
  private searchFile(
    file: GASFile, 
    regex: RegExp, 
    options: GrepSearchOptions
  ): GrepFileResult | null {
    if (!file.source) return null;

    const lines = file.source.split('\n');
    const matches: GrepMatch[] = [];
    const contextLines = options.contextLines || 2;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      
      // Reset regex lastIndex for global searches
      regex.lastIndex = 0;
      
      while ((match = regex.exec(line)) !== null) {
        const grepMatch: GrepMatch = {
          lineNumber: i + 1,
          line: line,
          matchStart: match.index,
          matchEnd: match.index + match[0].length,
          matchText: match[0]
        };

        // Add context if requested
        if (contextLines > 0) {
          const beforeStart = Math.max(0, i - contextLines);
          const afterEnd = Math.min(lines.length, i + contextLines + 1);
          
          grepMatch.context = {
            before: lines.slice(beforeStart, i),
            after: lines.slice(i + 1, afterEnd)
          };
        }

        matches.push(grepMatch);
        
        // Prevent infinite loops with zero-width matches
        if (match[0].length === 0) {
          regex.lastIndex++;
        }
      }
    }

    if (matches.length === 0) return null;

    return {
      fileName: file.name,
      fileType: file.type,
      totalMatches: matches.length,
      matches
    };
  }

  /**
   * Estimate token count for results
   */
  private estimateTokens(results: GrepFileResult[]): number {
    let totalChars = 0;
    
    for (const fileResult of results) {
      // File header
      totalChars += fileResult.fileName.length + 20;
      
      for (const match of fileResult.matches) {
        // Line content
        totalChars += match.line.length;
        
        // Context lines
        if (match.context) {
          totalChars += match.context.before.join('').length;
          totalChars += match.context.after.join('').length;
        }
        
        // Metadata (line numbers, etc.)
        totalChars += 50;
      }
    }
    
    return Math.ceil(totalChars / TOKEN_LIMITS.averageCharsPerToken);
  }

  /**
   * Format results for compact output
   */
  formatCompactResults(results: GrepSearchResult): string {
    let output = '';
    
    for (const fileResult of results.matches) {
      for (const match of fileResult.matches) {
        output += `${fileResult.fileName}:${match.lineNumber}:${match.line.trim()}\n`;
      }
    }
    
    return output.trim();
  }

  /**
   * Format results for detailed output
   */
  formatDetailedResults(results: GrepSearchResult): string {
    let output = '';
    
    for (const fileResult of results.matches) {
      output += `\n📁 ${fileResult.fileName} (${fileResult.totalMatches} matches)\n`;
      output += '─'.repeat(50) + '\n';
      
      for (const match of fileResult.matches) {
        // Context before
        if (match.context?.before && match.context.before.length > 0) {
          for (let i = 0; i < match.context.before.length; i++) {
            const lineNum = match.lineNumber - match.context.before.length + i;
            output += `${String(lineNum).padStart(4, ' ')}  ${match.context.before[i]}\n`;
          }
        }
        
        // Matching line (highlighted)
        output += `${String(match.lineNumber).padStart(4, ' ')}▶ ${match.line}\n`;
        
        // Context after
        if (match.context?.after && match.context.after.length > 0) {
          for (let i = 0; i < match.context.after.length; i++) {
            const lineNum = match.lineNumber + i + 1;
            output += `${String(lineNum).padStart(4, ' ')}  ${match.context.after[i]}\n`;
          }
        }
        
        output += '\n';
      }
    }
    
    return output.trim();
  }
} 