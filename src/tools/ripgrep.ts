/**
 * ripgrep and raw_ripgrep - Advanced search with ripgrep-inspired features
 * 
 * ripgrep: High-performance search in clean user code (CommonJS unwrapped)
 * raw_ripgrep: High-performance search in raw content (including CommonJS wrappers)
 * 
 * Features inspired by ripgrep: multiple patterns, context control, smart case,
 * advanced regex, replacement suggestions, and performance statistics.
 * 
 * Adapted for Google Apps Script's flat file structure with pseudo-directory filtering.
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { parsePath, isWildcardPattern, matchesPattern, resolveHybridScriptId, fileNameMatches } from '../api/pathParser.js';
import { ValidationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { GuidanceFragments } from '../utils/guidanceFragments.js';
import { sortRipgrepResults } from '../utils/ripgrepUtils.js';
import { generateSearchHints, generateRipgrepHints, mergeHints, SearchHints } from '../utils/searchHints.js';
import { generateSearchHints as generateResponseSearchHints } from '../utils/responseHints.js';

// Enhanced error types for ripgrep operations
export class RipgrepError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'RipgrepError';
  }
}

export class PatternCompilationError extends RipgrepError {
  constructor(pattern: string, originalError: Error) {
    super(
      `Failed to compile pattern: ${pattern}`,
      'PATTERN_COMPILATION_ERROR',
      { pattern, originalError: originalError.message }
    );
  }
}

export class FileProcessingError extends RipgrepError {
  constructor(fileName: string, originalError: Error) {
    super(
      `Failed to process file: ${fileName}`,
      'FILE_PROCESSING_ERROR', 
      { fileName, originalError: originalError.message }
    );
  }
}
import { 
  GrepSearchEngine, 
  GrepSearchOptions, 
  GASFile,
  detectPathMode,
  matchesPathPattern,
  validatePathPattern 
} from '../utils/grepEngine.js';
import { 
  translatePathForOperation,
  gasNameToVirtual
} from '../utils/virtualFileTranslation.js';

// Enhanced interfaces for ripgrep functionality
export interface RipgrepSearchOptions extends GrepSearchOptions {
  // Enhanced pattern options
  patterns: string[];              // Multiple patterns (OR logic)
  fixedStrings: boolean;          // Literal string search
  smartCase: boolean;             // Auto case detection
  multiline: boolean;             // Cross-line patterns

  // Advanced matching
  wholeWord: boolean;             // Word boundaries
  invertMatch: boolean;           // Invert results
  onlyMatching: boolean;          // Match portions only

  // Enhanced context control
  contextBefore?: number;         // Before context lines (-B)
  contextAfter?: number;          // After context lines (-A)

  // Replace functionality
  replace?: string;               // Replacement pattern

  // GAS file system options
  pseudoDepth?: number;           // Max "depth" by counting "/"
  path?: string;                  // Path pattern to search

  // Output control
  context?: number;               // Context lines (same as contextAfter/Before)
  filesWithMatches?: boolean;     // Only return file names
  maxCount?: number;             // Max matches per file

  // Performance options
  showStats: boolean;             // Show search statistics
  count?: boolean;                // Only show count of matches

  // New features
  ignoreCase?: boolean;           // Case-insensitive search (overrides smartCase)
  sort?: 'none' | 'path' | 'modified';  // Result sorting
}

// Normalized options with all defaults resolved
export interface NormalizedRipgrepOptions extends Required<Omit<RipgrepSearchOptions, 'replace' | 'contextBefore' | 'contextAfter' | 'context' | 'pseudoDepth' | 'ignoreCase' | 'sort'>> {
  // Optional fields that may remain undefined
  replace?: string;
  ignoreCase?: boolean;
  sort?: 'none' | 'path' | 'modified';
  contextBefore: number;
  contextAfter: number;
  context: number;
  pseudoDepth?: number;
}

export interface RipgrepMatch {
  lineNumber: number;
  line: string;
  patternIndex: number;          // Which pattern matched
  patternUsed: string;           // The actual pattern that matched
  
  // Match details
  matchStart: number;
  matchEnd: number;
  matchText: string;             // Only matched portion
  fullLine: string;              // Complete line
  
  // Enhanced context
  contextBefore?: string[];      // Before context lines
  contextAfter?: string[];       // After context lines
  
  // Replacement
  replacementSuggestion?: string; // Generated replacement
  
  // Advanced matching info
  multilineMatch: boolean;        // Spans multiple lines
  wordBoundary: boolean;          // Matches word boundaries
}

export interface RipgrepFileResult {
  fileName: string;               // GAS filename
  virtualName?: string;           // Translated dotfile name
  fileType: string;               // SERVER_JS, HTML, JSON
  pseudoPath: string;             // Extracted prefix path
  pseudoDepth: number;            // Simulated depth
  totalMatches: number;
  matches: RipgrepMatch[];
  bytesSearched?: number;         // Number of bytes searched
  patterns?: string[];            // Patterns used for search
  searchTime?: number;            // Time spent searching this file
}

export interface RipgrepResult {
  // Search metadata
  searchPatterns: string[];
  searchMode: 'regex' | 'literal' | 'mixed';
  smartCaseUsed: boolean;
  multilineEnabled: boolean;
  
  // Results
  totalMatches: number;
  totalFiles: number;
  filesSearched: number;
  matches: RipgrepFileResult[];
  
  // Statistics
  stats?: {
    searchTimeMs: number;
    patternsCompiled: number;
    bytesSearched: number;
    avgMatchTimeMs: number;
    memoryUsageKB: number;
  };
  
  // Content processing info
  contentType: 'user-code' | 'raw-content';
  commonjsProcessed: boolean;
  
  // Performance metrics
  truncated: boolean;
  skippedFiles: string[];
  
  // Formatted output
  formattedOutput?: string;
}

export interface CompiledPattern {
  original: string;
  regex: RegExp;
  isLiteral: boolean;
  isMultiline: boolean;
  caseSensitive: boolean;
  wordBoundary: boolean;
  index: number;
}

/**
 * Enhanced search engine with ripgrep-inspired features
 * Extends the existing GrepSearchEngine with advanced capabilities
 */
export class RipgrepSearchEngine extends GrepSearchEngine {
  
  /**
   * Normalize ripgrep options with all defaults resolved
   */
  normalizeRipgrepOptions(options: RipgrepSearchOptions): NormalizedRipgrepOptions {
    return {
      // Set all defaults in one place
      patterns: options.patterns || [options.pattern || ''],
      fixedStrings: options.fixedStrings ?? false,
      smartCase: options.smartCase ?? false,
      multiline: options.multiline ?? false,
      wholeWord: options.wholeWord ?? false,
      invertMatch: options.invertMatch ?? false,
      onlyMatching: options.onlyMatching ?? false,
      contextBefore: options.contextBefore ?? options.context ?? 0,
      contextAfter: options.contextAfter ?? options.context ?? 0,
      context: options.context ?? 0,
      replace: options.replace,
      pseudoDepth: options.pseudoDepth,
      path: options.path ?? '',
      filesWithMatches: options.filesWithMatches ?? false,
      maxCount: options.maxCount ?? 50,
      showStats: options.showStats ?? false,
      count: options.count ?? false,
      
      // From base GrepSearchOptions  
      caseSensitive: options.caseSensitive ?? false,
      excludeFiles: options.excludeFiles ?? [],
      includeFileTypes: options.includeFileTypes ?? [],
      maxFilesSearched: options.maxFilesSearched ?? 100,
      maxResults: options.maxResults ?? 50,
      searchMode: options.searchMode ?? 'auto',
      pathMode: options.pathMode ?? 'auto',
      contextLines: options.contextLines ?? 0,
      showLineNumbers: options.showLineNumbers ?? true,
      showFileHeaders: options.showFileHeaders ?? true,
      compact: options.compact ?? false,
      
      // Additional properties that might be needed
      pattern: options.pattern || options.patterns?.[0] || ''
    };
  }
  
  /**
   * Compile multiple patterns with advanced options
   */
  compileRipgrepPatterns(patterns: string[], options: RipgrepSearchOptions): CompiledPattern[] {
    const compiled: CompiledPattern[] = [];
    
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      let processedPattern = pattern;
      let flags = 'g';
      
      // Smart case detection
      if (options.smartCase) {
        const hasUpperCase = /[A-Z]/.test(pattern);
        if (!hasUpperCase && !options.caseSensitive) {
          flags += 'i';
        } else if (!hasUpperCase && options.caseSensitive) {
          // Keep case sensitive
        } else {
          // Has uppercase, stay case sensitive
        }
      } else if (!options.caseSensitive) {
        flags += 'i';
      }
      
      // Multiline support
      if (options.multiline) {
        flags += 'ms';  // multiline and dotall
      }
      
      // Fixed strings (literal)
      if (options.fixedStrings) {
        processedPattern = this.escapeRegex(pattern);
      }
      
      // Word boundaries
      if (options.wholeWord) {
        processedPattern = `\\b(?:${processedPattern})\\b`;
      }
      
      try {
        const regex = new RegExp(processedPattern, flags);
        compiled.push({
          original: pattern,
          regex,
          isLiteral: options.fixedStrings,
          isMultiline: options.multiline,
          caseSensitive: options.caseSensitive || (options.smartCase && /[A-Z]/.test(pattern)),
          wordBoundary: options.wholeWord,
          index: i
        });
      } catch (error) {
        throw new PatternCompilationError(pattern, error instanceof Error ? error : new Error('Unknown error'));
      }
    }
    
    return compiled;
  }
  
  /**
   * Escape special regex characters for literal search
   */
  private escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  /**
   * Detect smart case from pattern
   */
  detectSmartCase(pattern: string): boolean {
    return /[A-Z]/.test(pattern);
  }
  
  /**
   * Filter files by pseudo-directory path patterns
   */
  filterByPseudoPath(files: GASFile[], pathPattern: string, maxDepth?: number): GASFile[] {
    if (!pathPattern && maxDepth === undefined) {
      return files;
    }
    
    return files.filter(file => {
      // Check pseudo-depth if specified
      if (maxDepth !== undefined) {
        const depth = this.calculatePseudoDepth(file.name);
        if (depth > maxDepth) {
          return false;
        }
      }
      
      // Check path pattern if specified
      if (pathPattern) {
        return matchesPathPattern(file.name, pathPattern, 'auto', '');
      }
      
      return true;
    });
  }
  
  /**
   * Calculate pseudo-directory depth by counting "/" separators
   */
  calculatePseudoDepth(filename: string): number {
    return (filename.match(/\//g) || []).length;
  }
  
  /**
   * Extract pseudo-directory path from filename
   */
  extractPseudoPath(filename: string): string {
    const lastSlash = filename.lastIndexOf('/');
    return lastSlash >= 0 ? filename.substring(0, lastSlash) : '';
  }
  
  /**
   * Search files with multiple patterns and advanced options
   */
  async searchWithRipgrepPatterns(
    files: GASFile[], 
    patterns: CompiledPattern[], 
    options: RipgrepSearchOptions,
    scriptId?: string
  ): Promise<RipgrepResult> {
    const startTime = Date.now();
    const results: RipgrepFileResult[] = [];
    let totalMatches = 0;
    let bytesSearched = 0;
    let skippedFiles: string[] = [];
    
    // Filter files by pseudo-path and depth
    const filteredFiles = this.filterByPseudoPath(files, options.path || '', options.pseudoDepth);
    
    // Apply other filters
    const finalFiles = this.filterFiles(filteredFiles, {
      excludeFiles: options.excludeFiles,
      includeFileTypes: options.includeFileTypes
    });
    
    if (finalFiles.length === 0) {
      return this.createEmptyRipgrepResult(patterns.map(p => p.original), options, startTime);
    }
    
    // Search each file
    for (const file of finalFiles.slice(0, options.maxFilesSearched || 100)) {
      try {
        const fileResult = await this.searchFileWithPatterns(file, patterns, options);
        if (fileResult.matches.length > 0 || !options.filesWithMatches) {
          results.push(fileResult);
          totalMatches += fileResult.totalMatches;
        }
        bytesSearched += file.size || file.source?.length || 0;
        
        // Check if we've hit max results
        if (totalMatches >= (options.maxResults || 50)) {
          break;
        }
      } catch (error) {
        skippedFiles.push(file.name);
        const fileError = new FileProcessingError(file.name, error instanceof Error ? error : new Error('Unknown error'));
        console.error(`Failed to search file ${file.name}:`, fileError.message);
        // Continue processing other files rather than failing the entire search
      }
    }
    
    const searchTime = Date.now() - startTime;
    
    // Create result
    const result: RipgrepResult = {
      searchPatterns: patterns.map(p => p.original),
      searchMode: this.determineSearchMode(patterns),
      smartCaseUsed: options.smartCase,
      multilineEnabled: options.multiline,
      totalMatches,
      totalFiles: results.length,
      filesSearched: finalFiles.length,
      matches: results,
      contentType: 'user-code', // Will be overridden by raw version
      commonjsProcessed: true,   // Will be overridden by raw version
      truncated: totalMatches >= (options.maxResults || 50),
      skippedFiles,
      stats: options.showStats ? {
        searchTimeMs: searchTime,
        patternsCompiled: patterns.length,
        bytesSearched,
        avgMatchTimeMs: results.length > 0 ? searchTime / results.length : 0,
        memoryUsageKB: Math.round(process.memoryUsage().heapUsed / 1024)
      } : undefined
    };
    
    return result;
  }
  
  /**
   * Search a single file with multiple patterns
   */
  private async searchFileWithPatterns(
    file: GASFile, 
    patterns: CompiledPattern[], 
    options: RipgrepSearchOptions
  ): Promise<RipgrepFileResult> {
    if (!file.source) {
      return {
        fileName: file.name,
        fileType: file.type,
        pseudoPath: this.extractPseudoPath(file.name),
        pseudoDepth: this.calculatePseudoDepth(file.name),
        totalMatches: 0,
        matches: [],
        bytesSearched: 0,
        patterns: patterns.map(p => p.original),
        searchTime: 0
      };
    }
    
    const matches: RipgrepMatch[] = [];
    const lines = file.source.split('\n');
    let matchCount = 0;
    
    // Search each line (or handle multiline)
    if (options.multiline) {
      // For multiline, search the entire content
      const allMatches = this.searchMultilineContent(file.source, patterns, options);
      matches.push(...allMatches);
      matchCount = allMatches.length;
    } else {
      // Line-by-line search with improved early termination
      const maxCount = options.maxCount || Number.MAX_SAFE_INTEGER;
      
      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        
        for (const pattern of patterns) {
          const remainingMatches = maxCount - matchCount;
          if (remainingMatches <= 0) {
            break;
          }
          
          const lineMatches = this.searchLineWithPattern(line, lineNum + 1, pattern, options, lines, remainingMatches);
          matches.push(...lineMatches);
          matchCount += lineMatches.length;
          
          // Early termination if we've hit maxCount
          if (matchCount >= maxCount) {
            break;
          }
        }
        
        // Early termination at line level
        if (matchCount >= maxCount) {
          break;
        }
      }
    }
    
    // Apply invert match if specified
    const finalMatches = options.invertMatch ? this.invertMatches(lines, matches) : matches;
    
    return {
      fileName: file.name,
      virtualName: gasNameToVirtual(file.name),
      fileType: file.type || 'SERVER_JS',
      pseudoPath: this.extractPseudoPath(file.name),
      pseudoDepth: this.calculatePseudoDepth(file.name),
      totalMatches: finalMatches.length,
      matches: finalMatches
    };
  }
  
  /**
   * Search multiline content with compiled patterns
   */
  private searchMultilineContent(content: string, patterns: CompiledPattern[], options: RipgrepSearchOptions): RipgrepMatch[] {
    const matches: RipgrepMatch[] = [];
    const lines = content.split('\n');
    const maxCount = options.maxCount || Number.MAX_SAFE_INTEGER;
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.regex.exec(content)) !== null) {
        // Early termination for multiline search
        if (matches.length >= maxCount) {
          pattern.regex.lastIndex = 0;
          break;
        }
        
        // Find which line this match starts on
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
        
        const ripgrepMatch: RipgrepMatch = {
          lineNumber,
          line: this.getLineFromContent(content, match.index),
          patternIndex: pattern.index,
          patternUsed: pattern.original,
          matchStart: match.index - beforeMatch.lastIndexOf('\n') - 1,
          matchEnd: match.index - beforeMatch.lastIndexOf('\n') - 1 + match[0].length,
          matchText: options.onlyMatching ? match[0] : match[0],
          fullLine: this.getLineFromContent(content, match.index),
          multilineMatch: match[0].includes('\n'),
          wordBoundary: pattern.wordBoundary,
          replacementSuggestion: options.replace ? this.generateReplacement(match[0], options.replace) : undefined
        };
        
        // Add context if requested
        if (options.contextBefore || options.contextAfter || options.context) {
          this.addContextToMatch(ripgrepMatch, lines, options);
        }
        
        matches.push(ripgrepMatch);
        
        // Prevent infinite loop for zero-width matches
        if (match[0].length === 0) {
          pattern.regex.lastIndex++;
        }
      }
      
      // Reset regex lastIndex for next use
      pattern.regex.lastIndex = 0;
      
      // Early termination at pattern level
      if (matches.length >= maxCount) {
        break;
      }
    }
    
    return matches;
  }
  
  /**
   * Search a single line with a compiled pattern
   */
  private searchLineWithPattern(
    line: string, 
    lineNumber: number, 
    pattern: CompiledPattern, 
    options: RipgrepSearchOptions,
    allLines: string[],
    remainingMatches?: number
  ): RipgrepMatch[] {
    const matches: RipgrepMatch[] = [];
    let match;
    
    while ((match = pattern.regex.exec(line)) !== null) {
      const ripgrepMatch: RipgrepMatch = {
        lineNumber,
        line: line,
        patternIndex: pattern.index,
        patternUsed: pattern.original,
        matchStart: match.index,
        matchEnd: match.index + match[0].length,
        matchText: options.onlyMatching ? match[0] : match[0],
        fullLine: line,
        multilineMatch: false,
        wordBoundary: pattern.wordBoundary,
        replacementSuggestion: options.replace ? this.generateReplacement(match[0], options.replace) : undefined
      };
      
      // Add context if requested
      if (options.contextBefore || options.contextAfter || options.context) {
        this.addContextToMatch(ripgrepMatch, allLines, options);
      }
      
      matches.push(ripgrepMatch);
      
      // Early termination for maxCount
      if (remainingMatches !== undefined && matches.length >= remainingMatches) {
        pattern.regex.lastIndex = 0; // Reset regex state before breaking
        break;
      }
      
      // Prevent infinite loop for zero-width matches
      if (match[0].length === 0) {
        pattern.regex.lastIndex++;
      }
    }
    
    // Reset regex lastIndex for next use
    pattern.regex.lastIndex = 0;
    
    return matches;
  }
  
  /**
   * Add context lines to a match
   */
  private addContextToMatch(match: RipgrepMatch, allLines: string[], options: RipgrepSearchOptions): void {
    const beforeLines = options.contextBefore || options.context || 0;
    const afterLines = options.contextAfter || options.context || 0;
    
    if (beforeLines > 0) {
      const startLine = Math.max(0, match.lineNumber - 1 - beforeLines);
      const endLine = match.lineNumber - 1;
      match.contextBefore = allLines.slice(startLine, endLine);
    }
    
    if (afterLines > 0) {
      const startLine = match.lineNumber;
      const endLine = Math.min(allLines.length, match.lineNumber + afterLines);
      match.contextAfter = allLines.slice(startLine, endLine);
    }
  }
  
  /**
   * Generate replacement suggestion
   */
  private generateReplacement(matchText: string, replacement: string): string {
    return replacement.replace(/\$&/g, matchText);
  }
  
  /**
   * Get line from content at specific position
   */
  private getLineFromContent(content: string, position: number): string {
    const beforeMatch = content.substring(0, position);
    const afterMatch = content.substring(position);
    const lineStart = beforeMatch.lastIndexOf('\n') + 1;
    const lineEnd = afterMatch.indexOf('\n');
    const actualLineEnd = lineEnd === -1 ? content.length : position + lineEnd;
    
    return content.substring(lineStart, actualLineEnd);
  }
  
  /**
   * Invert matches - return lines that don't match
   */
  private invertMatches(allLines: string[], matches: RipgrepMatch[]): RipgrepMatch[] {
    const matchedLines = new Set(matches.map(m => m.lineNumber));
    const invertedMatches: RipgrepMatch[] = [];
    
    for (let i = 0; i < allLines.length; i++) {
      const lineNumber = i + 1;
      if (!matchedLines.has(lineNumber)) {
        invertedMatches.push({
          lineNumber,
          line: allLines[i],
          patternIndex: -1, // Special marker for inverted
          patternUsed: 'INVERTED',
          matchStart: 0,
          matchEnd: allLines[i].length,
          matchText: allLines[i],
          fullLine: allLines[i],
          multilineMatch: false,
          wordBoundary: false
        });
      }
    }
    
    return invertedMatches;
  }
  
  /**
   * Determine overall search mode from patterns
   */
  private determineSearchMode(patterns: CompiledPattern[]): 'regex' | 'literal' | 'mixed' {
    const hasLiteral = patterns.some(p => p.isLiteral);
    const hasRegex = patterns.some(p => !p.isLiteral);
    
    if (hasLiteral && hasRegex) return 'mixed';
    if (hasLiteral) return 'literal';
    return 'regex';
  }
  
  /**
   * Create empty result structure
   */
  private createEmptyRipgrepResult(patterns: string[], options: RipgrepSearchOptions, startTime: number): RipgrepResult {
    return {
      searchPatterns: patterns,
      searchMode: 'regex',
      smartCaseUsed: options.smartCase,
      multilineEnabled: options.multiline,
      totalMatches: 0,
      totalFiles: 0,
      filesSearched: 0,
      matches: [],
      contentType: 'user-code',
      commonjsProcessed: true,
      truncated: false,
      skippedFiles: [],
      stats: options.showStats ? {
        searchTimeMs: Date.now() - startTime,
        patternsCompiled: patterns.length,
        bytesSearched: 0,
        avgMatchTimeMs: 0,
        memoryUsageKB: Math.round(process.memoryUsage().heapUsed / 1024)
      } : undefined
    };
  }
  
  /**
   * Format ripgrep results for display
   */
  formatRipgrepResults(result: RipgrepResult, compact: boolean = false): string {
    if (compact) {
      return this.formatCompactRipgrepResults(result);
    } else {
      return this.formatDetailedRipgrepResults(result);
    }
  }
  
  /**
   * Format compact ripgrep results
   */
  private formatCompactRipgrepResults(result: RipgrepResult): string {
    const lines: string[] = [];
    
    for (const fileResult of result.matches) {
      for (const match of fileResult.matches) {
        lines.push(`${fileResult.fileName}:${match.lineNumber}:${match.line}`);
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Format detailed ripgrep results
   */
  private formatDetailedRipgrepResults(result: RipgrepResult): string {
    const lines: string[] = [];
    
    // Header
    lines.push(`Ripgrep Search Results`);
    lines.push(`Patterns: ${result.searchPatterns.join(', ')}`);
    lines.push(`Mode: ${result.searchMode}${result.smartCaseUsed ? ' (smart case)' : ''}`);
    lines.push(`Files searched: ${result.filesSearched}, Matches: ${result.totalMatches}`);
    
    if (result.stats) {
      lines.push(`Search time: ${result.stats.searchTimeMs}ms, Memory: ${result.stats.memoryUsageKB}KB`);
    }
    
    lines.push('');
    
    // Results by file
    for (const fileResult of result.matches) {
      lines.push(`${fileResult.fileName} (${fileResult.totalMatches} matches)`);
      if (fileResult.pseudoPath) {
        lines.push(`  Pseudo-path: ${fileResult.pseudoPath}/ (depth: ${fileResult.pseudoDepth})`);
      }
      
      for (const match of fileResult.matches) {
        // Context before
        if (match.contextBefore) {
          for (let i = 0; i < match.contextBefore.length; i++) {
            const contextLineNum = match.lineNumber - match.contextBefore.length + i;
            lines.push(`${contextLineNum.toString().padStart(4, ' ')}-  ${match.contextBefore[i]}`);
          }
        }
        
        // Match line
        const matchLine = `${match.lineNumber.toString().padStart(4, ' ')}:  ${match.line}`;
        lines.push(matchLine);
        
        // Show replacement suggestion if available
        if (match.replacementSuggestion) {
          lines.push(`      → ${match.replacementSuggestion}`);
        }
        
        // Context after
        if (match.contextAfter) {
          for (let i = 0; i < match.contextAfter.length; i++) {
            const contextLineNum = match.lineNumber + 1 + i;
            lines.push(`${contextLineNum.toString().padStart(4, ' ')}-  ${match.contextAfter[i]}`);
          }
        }
        
        lines.push('');
      }
    }
    
    return lines.join('\n');
  }
}

/**
 * ripgrep - High-performance search with ripgrep-inspired features (RECOMMENDED)
 * Searches clean user code with CommonJS unwrapping and virtual file names
 */
export class RipgrepTool extends BaseTool {
  public name = 'ripgrep';
  public description = '[SEARCH:ADVANCED] High-performance search with ripgrep-inspired features — multi-pattern, context lines, regex, file type filtering, and match limiting. PREFERRED search tool for complex queries. WHEN: searching with regex, needing context around matches, or filtering by file type. AVOID: use grep for simple single-pattern search. Example: ripgrep({scriptId, patterns: ["import", "require"], contextLines: 2})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      searchPatterns: { type: 'array', description: 'Pattern(s) searched (string array)' },
      searchMode: { type: 'string', description: 'Search mode used: regex, literal, or mixed' },
      smartCaseUsed: { type: 'boolean', description: 'Whether smart case detection was active' },
      multilineEnabled: { type: 'boolean', description: 'Whether multiline matching was enabled' },
      totalMatches: { type: 'number', description: 'Total matches found' },
      totalFiles: { type: 'number', description: 'Files with matches' },
      filesSearched: { type: 'number', description: 'Total files searched' },
      matches: { type: 'array', description: 'Array of file results with line matches' },
      contentType: { type: 'string', description: 'Content type: user-code (unwrapped) or raw-content' },
      commonjsProcessed: { type: 'boolean', description: 'Whether CommonJS wrappers were unwrapped' },
      truncated: { type: 'boolean', description: 'Whether results were truncated' },
      skippedFiles: { type: 'array', description: 'Files that could not be searched (errors)' },
      stats: { type: 'object', description: 'Search performance statistics (when showStats: true)' },
      formattedOutput: { type: 'string', description: 'Pre-formatted text output of results' }
    }
  };

  public inputSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Search pattern (regex or literal). Supports advanced regex, multiline, Unicode. Use smartCase for auto case handling.',
        minLength: 1,
        examples: ['function\\\\s+(\\\\w+)', 'TODO|FIXME']
      },
      ...SchemaFragments.scriptId,
      patterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional patterns (OR logic). Multi-pattern search like ripgrep.',
        examples: [['TODO', 'FIXME']]
      },
      path: {
        type: 'string',
        description: 'Filename prefix pattern. GAS uses prefixes like "utils/helper" to simulate directories.',
        default: '',
        examples: ['utils/*', '*Controller*']
      },
      pseudoDepth: {
        type: 'number',
        description: 'Max "depth" by counting "/" in filenames. Simulates directory depth filtering.',
        minimum: 0,
        maximum: 10,
        examples: [1]
      },
      fixedStrings: {
        type: 'boolean',
        default: false,
        description: 'Treat patterns as literal strings instead of regex (like ripgrep -F)'
      },
      smartCase: {
        type: 'boolean',
        default: false,
        description: 'Smart case: uppercase in pattern=case-sensitive, else case-insensitive (ripgrep -S)'
      },
      multiline: {
        type: 'boolean',
        default: false,
        description: 'Enable multiline pattern matching across line boundaries (like ripgrep -U)'
      },
      contextBefore: {
        type: 'number',
        minimum: 0,
        maximum: 10,
        description: 'Lines before match (ripgrep -B)'
      },
      contextAfter: {
        type: 'number',
        minimum: 0,
        maximum: 10,
        description: 'Lines after match (ripgrep -A)'
      },
      context: {
        type: 'number',
        minimum: 0,
        maximum: 10,
        description: 'Lines before+after match (ripgrep -C)'
      },
      wholeWord: {
        type: 'boolean',
        default: false,
        description: 'Match whole words only using word boundaries (like ripgrep -w)'
      },
      invertMatch: {
        type: 'boolean',
        default: false,
        description: 'Invert matching - show lines that do NOT match the pattern (like ripgrep -v)'
      },
      onlyMatching: {
        type: 'boolean',
        default: false,
        description: 'Show only the matched text portions, not entire lines (like ripgrep -o)'
      },
      replace: {
        type: 'string',
        description: 'Replacement suggestions (ripgrep -r). Non-destructive.'
      },
      maxCount: {
        type: 'number',
        default: 50,
        minimum: 1,
        maximum: 1000,
        description: 'Maximum matches to return per file (like ripgrep -m)'
      },
      maxFiles: {
        type: 'number',
        default: 100,
        minimum: 1,
        maximum: 500,
        description: 'Maximum files to search for performance control'
      },
      count: {
        type: 'boolean',
        default: false,
        description: 'Show only count of matches per file, not the matches themselves (like ripgrep -c)'
      },
      filesWithMatches: {
        type: 'boolean',
        default: false,
        description: 'Show only filenames that contain matches, not the matches themselves (like ripgrep -l)'
      },
      showStats: {
        type: 'boolean',
        default: false,
        description: 'Include detailed search performance statistics (like ripgrep --stats)'
      },
      caseSensitive: {
        type: 'boolean',
        default: false,
        description: 'Force case-sensitive search (overrides smartCase)'
      },
      showLineNumbers: {
        type: 'boolean',
        default: true,
        description: 'Include line numbers in results'
      },
      compact: {
        type: 'boolean',
        default: false,
        description: 'Use compact output format (filename:line:content)'
      },
      excludeFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filename patterns to exclude from search (supports wildcards)',
        examples: [['*/test/*', '*Test*']]
      },
      includeFileTypes: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['SERVER_JS', 'HTML', 'JSON']
        },
        description: 'Filter by GAS file types',
        examples: [['SERVER_JS']]
      },
      ignoreCase: {
        type: 'boolean',
        default: false,
        description: 'Case-insensitive search (like ripgrep -i). Overrides smartCase when true.'
      },
      sort: {
        type: 'string',
        enum: ['none', 'path', 'modified'],
        default: 'none',
        description: 'Sort results: "path" (alphabetical by file path), "modified" (by modification time), "none" (API order)'
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'pattern'],
    llmGuidance: {
      toolSelection: GuidanceFragments.toolSelectionGuide.searchContent,
      features: 'smartCase | multiline | replace (non-destructive) | sort | multi-pattern',
      antiPatterns: ['ripgrep to read full file -> use cat', 'complex replace -> use sed', 'search without context -> add context:2']
    }
  };

  public annotations = {
    title: 'Ripgrep Search',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
  };

  private gasClient: GASClient;
  private ripgrepEngine: RipgrepSearchEngine;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
    this.ripgrepEngine = new RipgrepSearchEngine();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    // Validate required parameters
    if (!params.pattern) {
      throw new ValidationError('pattern', params.pattern, 'non-empty search pattern');
    }

    // Build patterns array (main pattern + additional patterns)
    const allPatterns = [params.pattern];
    if (params.patterns && Array.isArray(params.patterns)) {
      allPatterns.push(...params.patterns);
    }

    // Apply virtual file translation for path if provided
    const translatedPath = params.path ? translatePathForOperation(params.path, true) : params.path;

    // Handle ignoreCase: overrides smartCase and caseSensitive when true
    const caseSensitive = params.ignoreCase ? false : (params.caseSensitive || false);

    // Build base ripgrep search options for normalization
    const baseOptions: RipgrepSearchOptions = {
      patterns: allPatterns,
      pattern: params.pattern, // Keep for compatibility
      searchMode: params.fixedStrings ? 'literal' : 'auto',
      pathMode: 'auto',
      fixedStrings: params.fixedStrings || false,
      smartCase: params.ignoreCase ? false : (params.smartCase || false),  // ignoreCase overrides smartCase
      multiline: params.multiline || false,
      caseSensitive: caseSensitive,
      wholeWord: params.wholeWord || false,
      invertMatch: params.invertMatch || false,
      onlyMatching: params.onlyMatching || false,
      maxResults: Math.min(params.maxCount || 50, 1000),
      maxFilesSearched: Math.min(params.maxFiles || 100, 500),
      contextLines: params.context || 0,
      contextBefore: params.contextBefore,
      contextAfter: params.contextAfter,
      showLineNumbers: params.showLineNumbers !== false,
      showFileHeaders: true,
      compact: params.compact || false,
      excludeFiles: params.excludeFiles || [],
      includeFileTypes: params.includeFileTypes || [],
      path: translatedPath,
      pseudoDepth: params.pseudoDepth,
      replace: params.replace,
      showStats: params.showStats || false,
      count: params.count || false,
      filesWithMatches: params.filesWithMatches || false,
      maxCount: params.maxCount || 50,
      ignoreCase: params.ignoreCase,
      sort: params.sort || 'none'
    };

    // Normalize all options with centralized defaults
    const searchOptions = this.ripgrepEngine.normalizeRipgrepOptions(baseOptions);

    // Determine target files and unwrap CommonJS content
    const files = await this.getTargetFilesWithUnwrapping(params, accessToken);
    
    if (files.length === 0) {
      return this.createEmptyResult(allPatterns, searchOptions);
    }

    // Compile patterns
    const compiledPatterns = this.ripgrepEngine.compileRipgrepPatterns(allPatterns, searchOptions);

    // Execute ripgrep search
    let results = await this.ripgrepEngine.searchWithRipgrepPatterns(files, compiledPatterns, searchOptions, this.extractScriptId(params));

    // Translate file names back to virtual names in results
    if (results.matches && Array.isArray(results.matches)) {
      results.matches.forEach((fileResult: any) => {
        const virtualName = gasNameToVirtual(fileResult.fileName);
        if (virtualName !== fileResult.fileName) {
          fileResult.virtualName = virtualName;
          fileResult.actualName = fileResult.fileName;
          fileResult.fileName = virtualName;  // Show virtual name as primary
        }
      });
    }

    // Sort results if requested
    if (params.sort && params.sort !== 'none' && results.matches && Array.isArray(results.matches)) {
      results.matches = sortRipgrepResults(results.matches, params.sort, files);
    }

    // Add metadata about content processing
    results.contentType = 'user-code';
    results.commonjsProcessed = true;

    // Add formatted output
    results.formattedOutput = this.ripgrepEngine.formatRipgrepResults(results, searchOptions.compact);

    // Generate context-aware hints based on results
    const baseHints = generateSearchHints(
      results.totalMatches,
      results.filesSearched,
      params.pattern,
      results.truncated,
      results.stats?.searchTimeMs
    );
    const ripgrepHints = generateRipgrepHints(
      results.totalMatches,
      allPatterns,
      searchOptions.multiline,
      searchOptions.smartCase,
      !!params.replace
    );
    const hints = mergeHints(baseHints, ripgrepHints);
    if (Object.keys(hints).length > 0) {
      (results as any).hints = hints;
    }

    // Generate response-level hints for LLM guidance
    const responseHints = generateResponseSearchHints(results.totalMatches, results.truncated);
    if (Object.keys(responseHints).length > 0) {
      (results as any).responseHints = responseHints;
    }

    return results;
  }

  /**
   * Get target files and unwrap CommonJS content for clean code search
   */
  private async getTargetFilesWithUnwrapping(params: any, accessToken?: string): Promise<GASFile[]> {
    // Get raw files first
    const rawFiles = await this.getTargetFiles(params, accessToken);
    
    // Import unwrapping utilities
    const { unwrapModuleContent, shouldWrapContent } = await import('../utils/moduleWrapper.js');
    
    // Unwrap CommonJS content for each file
    const unwrappedFiles: GASFile[] = [];
    
    for (const file of rawFiles) {
      let processedContent = file.source || '';

      // Only unwrap SERVER_JS files that should have wrappers
      if (file.type === 'SERVER_JS' && shouldWrapContent(file.type, file.name)) {
        const { unwrappedContent } = unwrapModuleContent(processedContent);
        if (unwrappedContent !== processedContent) {
          processedContent = unwrappedContent;
          console.error(`📖 [GAS_RIPGREP] Unwrapped CommonJS structure from ${file.name} for clean code search`);
        }
      }
      
      unwrappedFiles.push({
        ...file,
        source: processedContent,
        size: processedContent.length
      });
    }
    
    return unwrappedFiles;
  }

  /**
   * Get target files for search (shared pattern)
   */
  private async getTargetFiles(params: any, accessToken?: string): Promise<GASFile[]> {
    // Apply virtual file translation for path
    const translatedPath = params.path ? translatePathForOperation(params.path, true) : params.path;

    // Use hybrid script ID resolution with translated path
    const hybridResolution = resolveHybridScriptId(params.scriptId, translatedPath || '');
    const scriptId = hybridResolution.scriptId;
    const searchPath = hybridResolution.cleanPath;

    // Get all files from project
    const allFiles = await this.gasClient.getProjectContent(scriptId, accessToken);

    // Convert to GASFile format
    const gasFiles: GASFile[] = allFiles.map((file: any) => ({
      name: file.name,
      type: file.type || 'SERVER_JS',
      source: file.source || '',
      size: (file.source || '').length
    }));

    return gasFiles;
  }

  /**
   * Extract script ID from parameters
   */
  private extractScriptId(params: any): string | undefined {
    return params.scriptId;
  }

  /**
   * Create empty result structure
   */
  private createEmptyResult(patterns: string[], options: RipgrepSearchOptions): RipgrepResult {
    return {
      searchPatterns: patterns,
      searchMode: options.fixedStrings ? 'literal' : 'regex',
      smartCaseUsed: options.smartCase,
      multilineEnabled: options.multiline,
      totalMatches: 0,
      totalFiles: 0,
      filesSearched: 0,
      matches: [],
      contentType: 'user-code',
      commonjsProcessed: true,
      truncated: false,
      skippedFiles: [],
      stats: options.showStats ? {
        searchTimeMs: 0,
        patternsCompiled: patterns.length,
        bytesSearched: 0,
        avgMatchTimeMs: 0,
        memoryUsageKB: Math.round(process.memoryUsage().heapUsed / 1024)
      } : undefined
    };
  }
}

/**
 * raw_ripgrep - High-performance search with ripgrep-inspired features (ADVANCED)
 * Searches complete file content including CommonJS wrappers and system code
 */
export class RawRipgrepTool extends BaseTool {
  public name = 'raw_ripgrep';
  public description = '[SEARCH:RAW:ADVANCED] High-performance search on raw content including CommonJS wrappers — multi-pattern, context, regex. WHEN: searching for module system patterns, _main() wrappers, or loadNow settings. AVOID: use ripgrep for normal code search. Example: raw_ripgrep({scriptId, patterns: ["loadNow", "__events__"]})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      matches: { type: 'array', description: 'Array of match results with file, line, content, and context' },
      matchCount: { type: 'number', description: 'Total matches across all files' },
      filesSearched: { type: 'number', description: 'Number of files searched' },
      filesMatched: { type: 'number', description: 'Number of files containing matches' },
      stats: { type: 'object', description: 'Search statistics (patterns matched, timing)' },
      truncated: { type: 'boolean', description: 'Whether results hit maxCount limit' }
    }
  };

  public inputSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Search pattern (regex or literal) on raw content+CommonJS wrappers+system code. "_main\\\\s*\\\\(" finds wrappers.',
        minLength: 1,
        examples: ['_main\\\\s*\\\\(', '__defineModule__']
      },
      ...SchemaFragments.scriptId,
      patterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional search patterns (OR logic with main pattern) for searching raw content with system code.',
        examples: [['_main', '__defineModule__']]
      },
      path: {
        type: 'string',
        description: 'Filename prefix pattern for pseudo-directory filtering. Always retrieves content via direct API calls, never uses local cached files.',
        default: '',
        examples: ['utils/*', '.*Controller.*']
      },
      pseudoDepth: {
        type: 'number',
        description: 'Maximum "directory depth" by counting "/" separators in filenames for raw content search.',
        minimum: 0,
        maximum: 10
      },
      fixedStrings: {
        type: 'boolean',
        default: false,
        description: 'Treat patterns as literal strings instead of regex'
      },
      smartCase: {
        type: 'boolean',
        default: false,
        description: 'Smart case matching for raw content search'
      },
      multiline: {
        type: 'boolean',
        default: false,
        description: 'Enable multiline pattern matching across CommonJS wrapper boundaries'
      },
      contextBefore: {
        type: 'number',
        minimum: 0,
        maximum: 10,
        description: 'Lines to show before each match in raw content'
      },
      contextAfter: {
        type: 'number',
        minimum: 0,
        maximum: 10,
        description: 'Lines to show after each match in raw content'
      },
      context: {
        type: 'number',
        minimum: 0,
        maximum: 10,
        description: 'Lines to show before and after each match in raw content'
      },
      wholeWord: {
        type: 'boolean',
        default: false,
        description: 'Match whole words only in raw content'
      },
      invertMatch: {
        type: 'boolean',
        default: false,
        description: 'Show lines that do NOT match the pattern in raw content'
      },
      onlyMatching: {
        type: 'boolean',
        default: false,
        description: 'Show only matched text portions from raw content'
      },
      replace: {
        type: 'string',
        description: 'Generate replacement suggestions for raw content (non-destructive)'
      },
      maxCount: {
        type: 'number',
        default: 50,
        minimum: 1,
        maximum: 1000,
        description: 'Maximum matches per file in raw content'
      },
      maxFiles: {
        type: 'number',
        default: 100,
        minimum: 1,
        maximum: 500,
        description: 'Maximum files to search'
      },
      count: {
        type: 'boolean',
        default: false,
        description: 'Show only match counts per file'
      },
      filesWithMatches: {
        type: 'boolean',
        default: false,
        description: 'Show only filenames with matches'
      },
      showStats: {
        type: 'boolean',
        default: false,
        description: 'Include search performance statistics'
      },
      caseSensitive: {
        type: 'boolean',
        default: false,
        description: 'Force case-sensitive search'
      },
      showLineNumbers: {
        type: 'boolean',
        default: true,
        description: 'Include line numbers in results'
      },
      compact: {
        type: 'boolean',
        default: false,
        description: 'Use compact output format'
      },
      excludeFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files to exclude from raw content search',
        examples: [['*/test/*', '*Temp*']]
      },
      includeFileTypes: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['SERVER_JS', 'HTML', 'JSON']
        },
        description: 'Filter by file types for raw content search'
      },
      ignoreCase: {
        type: 'boolean',
        default: false,
        description: 'Case-insensitive search (like ripgrep -i). Overrides smartCase when true.'
      },
      sort: {
        type: 'string',
        enum: ['none', 'path', 'modified'],
        default: 'none',
        description: 'Sort results: "path" (alphabetical by file path), "modified" (by modification time), "none" (API order)'
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'pattern'],
    llmGuidance: {
      vsRipgrep: 'raw_ripgrep: complete file with wrappers | ripgrep: clean user code only'
    }
  };

  public annotations = {
    title: 'Ripgrep Search (Raw)',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
  };

  private gasClient: GASClient;
  private ripgrepEngine: RipgrepSearchEngine;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
    this.ripgrepEngine = new RipgrepSearchEngine();
  }

  async execute(params: any): Promise<any> {
    // Validate required parameters
    if (!params.pattern) {
      throw new ValidationError('pattern', params.pattern, 'non-empty search pattern');
    }

    // Build patterns array (main pattern + additional patterns)
    const allPatterns = [params.pattern];
    if (params.patterns && Array.isArray(params.patterns)) {
      allPatterns.push(...params.patterns);
    }

    // Handle ignoreCase: overrides smartCase and caseSensitive when true
    const caseSensitive = params.ignoreCase ? false : (params.caseSensitive || false);

    // Build base ripgrep search options for normalization (no path translation for raw version)
    const baseOptions: RipgrepSearchOptions = {
      patterns: allPatterns,
      pattern: params.pattern,
      searchMode: params.fixedStrings ? 'literal' : 'auto',
      pathMode: 'auto',
      fixedStrings: params.fixedStrings || false,
      smartCase: params.ignoreCase ? false : (params.smartCase || false),  // ignoreCase overrides smartCase
      multiline: params.multiline || false,
      caseSensitive: caseSensitive,
      wholeWord: params.wholeWord || false,
      invertMatch: params.invertMatch || false,
      onlyMatching: params.onlyMatching || false,
      maxResults: Math.min(params.maxCount || 50, 1000),
      maxFilesSearched: Math.min(params.maxFiles || 100, 500),
      contextLines: params.context || 0,
      contextBefore: params.contextBefore,
      contextAfter: params.contextAfter,
      showLineNumbers: params.showLineNumbers !== false,
      showFileHeaders: true,
      compact: params.compact || false,
      excludeFiles: params.excludeFiles || [],
      includeFileTypes: params.includeFileTypes || [],
      path: params.path,
      pseudoDepth: params.pseudoDepth,
      replace: params.replace,
      showStats: params.showStats || false,
      count: params.count || false,
      filesWithMatches: params.filesWithMatches || false,
      maxCount: params.maxCount || 50,
      ignoreCase: params.ignoreCase,
      sort: params.sort || 'none'
    };

    // Normalize all options with centralized defaults
    const searchOptions = this.ripgrepEngine.normalizeRipgrepOptions(baseOptions);

    // ⚠️ CRITICAL: Always authenticate before making API calls
    const accessToken = await this.getAuthToken(params);

    // 🔧 ADVANCED: Get target files via direct API calls only (never uses local files)
    const files = await this.getTargetFilesViaAPI(params, accessToken);

    if (files.length === 0) {
      return this.createEmptyRawResult(allPatterns, searchOptions);
    }

    // Compile patterns
    const compiledPatterns = this.ripgrepEngine.compileRipgrepPatterns(allPatterns, searchOptions);

    // Execute ripgrep search on raw content
    let results = await this.ripgrepEngine.searchWithRipgrepPatterns(files, compiledPatterns, searchOptions, this.extractScriptId(params));

    // Sort results if requested
    if (params.sort && params.sort !== 'none' && results.matches && Array.isArray(results.matches)) {
      results.matches = sortRipgrepResults(results.matches, params.sort, files);
    }

    // Add metadata about raw content processing and data source
    results.contentType = 'raw-content';
    results.commonjsProcessed = false;

    // Add formatted output
    results.formattedOutput = this.ripgrepEngine.formatRipgrepResults(results, searchOptions.compact);

    // Generate context-aware hints based on results
    const baseHints = generateSearchHints(
      results.totalMatches,
      results.filesSearched,
      params.pattern,
      results.truncated,
      results.stats?.searchTimeMs
    );
    const ripgrepHints = generateRipgrepHints(
      results.totalMatches,
      allPatterns,
      searchOptions.multiline,
      searchOptions.smartCase,
      !!params.replace
    );
    const hints = mergeHints(baseHints, ripgrepHints);
    if (Object.keys(hints).length > 0) {
      (results as any).hints = hints;
    }

    return results;
  }

  /**
   * Get target files via direct API calls (raw version)
   */
  private async getTargetFilesViaAPI(params: any, accessToken: string): Promise<GASFile[]> {
    // Use hybrid script ID resolution
    const hybridResolution = resolveHybridScriptId(params.scriptId, params.path || '');
    const scriptId = hybridResolution.scriptId;
    const searchPath = hybridResolution.cleanPath;

    // 🔧 DIRECT API CALL: Get all files from project (never uses local cache)
    console.error(`🔧 [GAS_RAW_RIPGREP] Making direct API call to retrieve raw project content: ${scriptId}`);
    const allFiles = await this.gasClient.getProjectContent(scriptId, accessToken);

    // Convert to GASFile format (raw content)
    const gasFiles: GASFile[] = allFiles.map((file: any) => ({
      name: file.name,
      type: file.type || 'SERVER_JS',
      source: file.source || '',
      size: (file.source || '').length
    }));

    return gasFiles;
  }

  /**
   * Extract script ID from parameters
   */
  private extractScriptId(params: any): string | undefined {
    return params.scriptId;
  }

  /**
   * Create empty result structure for raw search
   */
  private createEmptyRawResult(patterns: string[], options: RipgrepSearchOptions): RipgrepResult {
    return {
      searchPatterns: patterns,
      searchMode: options.fixedStrings ? 'literal' : 'regex',
      smartCaseUsed: options.smartCase,
      multilineEnabled: options.multiline,
      totalMatches: 0,
      totalFiles: 0,
      filesSearched: 0,
      matches: [],
      contentType: 'raw-content',
      commonjsProcessed: false,
      truncated: false,
      skippedFiles: [],
      stats: options.showStats ? {
        searchTimeMs: 0,
        patternsCompiled: patterns.length,
        bytesSearched: 0,
        avgMatchTimeMs: 0,
        memoryUsageKB: Math.round(process.memoryUsage().heapUsed / 1024)
      } : undefined
    };
  }
}