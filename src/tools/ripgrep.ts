/**
 * gas_ripgrep and gas_raw_ripgrep - Advanced search with ripgrep-inspired features
 * 
 * gas_ripgrep: High-performance search in clean user code (CommonJS unwrapped)
 * gas_raw_ripgrep: High-performance search in raw content (including CommonJS wrappers)
 * 
 * Features inspired by ripgrep: multiple patterns, context control, smart case,
 * advanced regex, replacement suggestions, and performance statistics.
 * 
 * Adapted for Google Apps Script's flat file structure with pseudo-directory filtering.
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { parsePath, isWildcardPattern, matchesPattern, resolveHybridScriptId } from '../api/pathParser.js';
import { ValidationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';

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
  trim?: boolean;                 // Trim whitespace from result lines
}

// Normalized options with all defaults resolved
export interface NormalizedRipgrepOptions extends Required<Omit<RipgrepSearchOptions, 'replace' | 'contextBefore' | 'contextAfter' | 'context' | 'pseudoDepth' | 'ignoreCase' | 'sort' | 'trim'>> {
  // Optional fields that may remain undefined
  replace?: string;
  ignoreCase?: boolean;
  sort?: 'none' | 'path' | 'modified';
  trim?: boolean;
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
 * gas_ripgrep - High-performance search with ripgrep-inspired features (RECOMMENDED)
 * Searches clean user code with CommonJS unwrapping and virtual file names
 */
export class RipgrepTool extends BaseTool {
  public name = 'ripgrep';
  public description = '⚡ RECOMMENDED: High-performance search with ripgrep-inspired features including multiple patterns, smart case, context control, and replacement suggestions. Searches clean user code with filename prefix filtering (GAS has no real directories - uses filename prefixes like "utils/helper").';
  
  public inputSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Primary search pattern (regex or literal). Supports advanced regex features, multiline matching, and Unicode. Use with smartCase for intelligent case handling.',
        minLength: 1,
        examples: [
          'function\\\\s+(\\\\w+)',         // Function definitions
          'TODO|FIXME|HACK',               // Multiple alternatives  
          '(?m)^class\\\\s+(\\\\w+)',      // Multiline class definitions
          'require\\\\(["\']([^"\']+)',    // Module imports
          '\\\\b(async|await)\\\\b',       // Word boundaries
          '.{0,50}error.{0,50}',           // Context around errors
        ]
      },
      ...SchemaFragments.scriptId,
      patterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional search patterns (OR logic with main pattern). Enables multi-pattern search like ripgrep.',
        examples: [
          ['TODO', 'FIXME', 'HACK'],
          ['function.*test', 'describe.*spec'],
          ['error', 'exception', 'fail']
        ]
      },
      path: {
        type: 'string',
        description: 'Filename prefix pattern for pseudo-directory filtering. GAS has no real directories - filenames like "utils/helper" use prefixes to simulate directories.',
        default: '',
        examples: [
          '',                            // All files (root level and prefixed)
          'utils/*',                     // Files starting with "utils/" prefix
          'api/v1/*',                    // Files starting with "api/v1/" prefix  
          'test/*.test',                 // Test files with test/ prefix
          '*Controller*',                // Files containing "Controller" anywhere
          '.*\\.config$',                // Files ending with ".config"
        ]
      },
      pseudoDepth: {
        type: 'number',
        description: 'Maximum "directory depth" by counting "/" separators in filenames. Since GAS has no real directories, this simulates depth filtering.',
        minimum: 0,
        maximum: 10,
        examples: [
          0,   // Only root-level files (no "/" in filename)
          1,   // Files like "utils/helper" (one "/" separator)
          2,   // Files like "api/v1/client" (two "/" separators)
        ]
      },
      fixedStrings: {
        type: 'boolean',
        default: false,
        description: 'Treat patterns as literal strings instead of regex (like ripgrep -F)'
      },
      smartCase: {
        type: 'boolean',
        default: false,
        description: 'Smart case matching: if pattern has uppercase letters, search case-sensitively; otherwise case-insensitive (like ripgrep -S)'
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
        description: 'Number of lines to show before each match (like ripgrep -B)'
      },
      contextAfter: {
        type: 'number',
        minimum: 0,
        maximum: 10,
        description: 'Number of lines to show after each match (like ripgrep -A)'
      },
      context: {
        type: 'number',
        minimum: 0,
        maximum: 10,
        description: 'Number of lines to show before and after each match (like ripgrep -C)'
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
        description: 'Generate replacement suggestions using this pattern (like ripgrep -r). Non-destructive - only shows suggestions.'
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
        examples: [
          ['*/test/*', '*/CommonJS'],
          ['*Test*', '*Spec*']
        ]
      },
      includeFileTypes: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['SERVER_JS', 'HTML', 'JSON']
        },
        description: 'Filter by GAS file types',
        examples: [
          ['SERVER_JS'],                    // JavaScript files only
          ['SERVER_JS', 'HTML'],           // JavaScript and HTML files
          ['JSON']                         // JSON files only
        ]
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
      trim: {
        type: 'boolean',
        default: false,
        description: 'Remove leading and trailing whitespace from result lines'
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'pattern'],
    llmGuidance: {
      fileSystem: 'GAS has no real directories. Files like "utils/helper" and "api/client" are single filenames with pseudo-directory prefixes.',

      pathPatterns: 'Use path patterns like "utils/*" to filter by filename prefixes. The "*" matches the remaining part of the filename after the prefix.',

      whenToUse: 'Use for advanced text search with multiple patterns, context control, and pseudo-directory filtering in GAS flat file structure.',

      scriptTypeCompatibility: {
        standalone: '✅ Full Support - Works identically',
        containerBound: '✅ Full Support - Works identically',
        notes: 'Advanced search works universally for both script types with full ripgrep-inspired features.'
      },
      limitations: {
        maxCount: 'Hard limit of 1000 matches per file - use more specific patterns for files with many matches',
        maxFiles: 'Hard limit of 500 files searched - use path parameter to narrow scope',
        performance: 'Complex regex with multiline mode may be slow - profile with showStats: true if needed'
      },

      examples: [
        'Multi-pattern search: {scriptId: "abc123...", patterns: ["function.*test", "describe.*spec"], smartCase: true}',
        'Context search: {scriptId: "abc123...", pattern: "TODO", contextBefore: 2, contextAfter: 3}',
        'Replace preview: {scriptId: "abc123...", pattern: "console\\.log", replace: "Logger.log"}',
        'Utility functions: {scriptId: "abc123...", pattern: "function.*util", path: "utils/*"}',
        'API errors: {scriptId: "abc123...", patterns: ["error", "exception"], path: "api/*", context: 2}',
        'Root files only: {scriptId: "abc123...", pattern: "TODO", pseudoDepth: 0}',
        'Config files: {scriptId: "abc123...", pattern: "config", path: "*config*"}',
        'Performance stats: {scriptId: "abc123...", pattern: "slow.*operation", showStats: true}',
        'Case-insensitive search: {scriptId: "abc123...", pattern: "todo", ignoreCase: true}',
        'Sorted by path: {scriptId: "abc123...", pattern: "function", sort: "path"}',
        'Trimmed output: {scriptId: "abc123...", pattern: "class.*\\\\{", trim: true}'
      ],

      fileSystemReality: 'Remember: GAS files are flat. "utils/helper.js" appears as filename "utils/helper" in the project, not as file "helper.js" in folder "utils".',

      pathFilteringLogic: 'Path filtering works on complete filenames using prefix matching, not directory traversal.',

      performance: 'Optimized for large codebases with multiple patterns. In-memory processing with regex caching and performance statistics.',

      workflow: 'Advanced search → analyze results → generate replacements → apply manually using gas_write',

      contentComparison: 'gas_ripgrep searches the same clean user code that gas_cat shows (unwrapped from CommonJS), while gas_raw_ripgrep searches complete file content including system wrappers.'
    }
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
      sort: params.sort || 'none',
      trim: params.trim || false
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
      results.matches = this.sortResults(results.matches, params.sort, files);
    }

    // Apply trim to result lines if requested
    if (params.trim && results.matches && Array.isArray(results.matches)) {
      results.matches = this.trimResultLines(results.matches);
    }

    // Add metadata about content processing
    results.contentType = 'user-code';
    results.commonjsProcessed = true;

    // Add formatted output
    results.formattedOutput = this.ripgrepEngine.formatRipgrepResults(results, searchOptions.compact);

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
   * Sort search results by specified criteria
   */
  private sortResults(matches: any[], sortBy: 'path' | 'modified', files: GASFile[]): any[] {
    return [...matches].sort((a, b) => {
      if (sortBy === 'path') {
        // Sort alphabetically by file name
        return a.fileName.localeCompare(b.fileName);
      } else if (sortBy === 'modified') {
        // Sort by modification time (newest first)
        // Note: GAS files don't have lastModified in standard API response
        // This is a placeholder for future enhancement
        const aFile = files.find(f => f.name === a.fileName);
        const bFile = files.find(f => f.name === b.fileName);
        const aTime = (aFile as any)?.lastModified || 0;
        const bTime = (bFile as any)?.lastModified || 0;
        return bTime - aTime;
      }
      return 0;
    });
  }

  /**
   * Trim leading and trailing whitespace from result lines
   */
  private trimResultLines(matches: any[]): any[] {
    return matches.map(fileResult => {
      if (fileResult.lines && Array.isArray(fileResult.lines)) {
        return {
          ...fileResult,
          lines: fileResult.lines.map((line: any) => {
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
        };
      }
      return fileResult;
    });
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
 * gas_raw_ripgrep - High-performance search with ripgrep-inspired features (ADVANCED)
 * Searches complete file content including CommonJS wrappers and system code
 */
export class RawRipgrepTool extends BaseTool {
  public name = 'raw_ripgrep';
  public description = '⚡ ADVANCED: High-performance search with ripgrep-inspired features on raw file content including CommonJS wrappers. Multiple patterns, advanced regex, and performance stats with filename prefix filtering for pseudo-directory organization.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Primary search pattern (regex or literal). Searches complete file content including CommonJS wrappers and system code. Examples: "_main\\\\s*\\\\(" finds CommonJS wrappers, "__defineModule__" finds system calls',
        minLength: 1,
        examples: [
          'require\\\\(',                      // Find require calls in full content
          'function\\\\s+(\\\\w+)',            // Find all function definitions including wrappers
          '_main\\\\s*\\\\(',                 // Find CommonJS main wrapper functions
          '__defineModule__',                  // Find CommonJS system module definition calls
          'globalThis\\.__getCurrentModule',   // Find module system calls
          'module\\s*=\\s*globalThis',        // Find module assignments
          'exports\\s*=\\s*module\\.exports', // Find exports assignments
        ]
      },
      ...SchemaFragments.scriptId,
      patterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional search patterns (OR logic with main pattern) for searching raw content with system code.',
        examples: [
          ['_main', '__defineModule__', 'globalThis'],
          ['require\\\\(', 'module\\.exports', 'exports\\s*='],
          ['CommonJS', 'wrapper', 'shim']
        ]
      },
      path: {
        type: 'string',
        description: 'Filename prefix pattern for pseudo-directory filtering. Always retrieves content via direct API calls, never uses local cached files.',
        default: '',
        examples: [
          '',                            // Search entire project (includes CommonJS wrappers)
          'utils/*',                     // Wildcard: utils prefix (full content)
          '*Connector*',                 // Wildcard: files containing Connector (full content)
          '.*Controller.*',              // Regex: files containing Controller (full content)
          '(utils|helpers)/.*',          // Regex: utils OR helpers prefixes (full content)
          '.*\\.(test|spec)$',          // Regex: test files ending in .test or .spec (full content)
        ]
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
        examples: [
          ['*/test/*', '*/debug/*'],
          ['*Temp*', '*Backup*']
        ]
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
      trim: {
        type: 'boolean',
        default: false,
        description: 'Remove leading and trailing whitespace from result lines'
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'pattern'],
    llmGuidance: {
      whenToUse: 'Use for system analysis, debugging CommonJS wrappers, or searching complete file content including system-generated code.',

      contentDifference: 'gas_raw_ripgrep searches complete file content including CommonJS wrappers and system code, while gas_ripgrep searches only clean user code.',

      examples: [
        'Find wrapper issues: {scriptId: "abc123...", patterns: ["_main", "__defineModule__"], showStats: true}',
        'System code analysis: {scriptId: "abc123...", pattern: "globalThis\\.__", multiline: true}',
        'Wrapper debugging: {scriptId: "abc123...", pattern: "module\\s*=", context: 3}',
        'Full content search: {scriptId: "abc123...", pattern: "CommonJS", path: "*", maxFiles: 200}',
        'Case-insensitive wrapper search: {scriptId: "abc123...", pattern: "_main", ignoreCase: true}',
        'Sorted system analysis: {scriptId: "abc123...", pattern: "require", sort: "path"}',
        'Trimmed wrapper output: {scriptId: "abc123...", pattern: "function", trim: true}'
      ],
      
      dataSource: 'Always makes direct API calls to retrieve complete file content including all system wrappers and infrastructure code.',
      
      performance: 'Direct API access with no local file caching. Includes full system wrapper content in search scope.'
    }
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
      sort: params.sort || 'none',
      trim: params.trim || false
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
      results.matches = this.sortResults(results.matches, params.sort, files);
    }

    // Apply trim to result lines if requested
    if (params.trim && results.matches && Array.isArray(results.matches)) {
      results.matches = this.trimResultLines(results.matches);
    }

    // Add metadata about raw content processing and data source
    results.contentType = 'raw-content';
    results.commonjsProcessed = false;

    // Add formatted output
    results.formattedOutput = this.ripgrepEngine.formatRipgrepResults(results, searchOptions.compact);

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
   * Sort search results by specified criteria
   */
  private sortResults(matches: any[], sortBy: 'path' | 'modified', files: GASFile[]): any[] {
    return [...matches].sort((a, b) => {
      if (sortBy === 'path') {
        // Sort alphabetically by file name
        return a.fileName.localeCompare(b.fileName);
      } else if (sortBy === 'modified') {
        // Sort by modification time (newest first)
        // Note: GAS files don't have lastModified in standard API response
        // This is a placeholder for future enhancement
        const aFile = files.find(f => f.name === a.fileName);
        const bFile = files.find(f => f.name === b.fileName);
        const aTime = (aFile as any)?.lastModified || 0;
        const bTime = (bFile as any)?.lastModified || 0;
        return bTime - aTime;
      }
      return 0;
    });
  }

  /**
   * Trim leading and trailing whitespace from result lines
   */
  private trimResultLines(matches: any[]): any[] {
    return matches.map(fileResult => {
      if (fileResult.lines && Array.isArray(fileResult.lines)) {
        return {
          ...fileResult,
          lines: fileResult.lines.map((line: any) => {
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
        };
      }
      return fileResult;
    });
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