/**
 * @fileoverview sed-inspired find/replace tools for Google Apps Script projects
 * 
 * Implements sed and raw_sed tools that provide powerful find/replace operations
 * using regular expressions with capture groups. Leverages existing ripgrep infrastructure
 * for maximum code reuse and efficiency.
 * 
 * Key Features:
 * - Regex-based find/replace with capture group support ($1, $2, etc.)
 * - Multi-pattern operations with OR logic
 * - File filtering by type and patterns
 * - In-place modifications without backup complexity
 * - Seamless integration with existing GAS APIs
 * - Smart vs Raw variants for CommonJS handling
 * 
 * @author MCP Gas Server
 */

import { BaseTool } from './base.js';
import type { SessionAuthManager } from '../auth/sessionManager.js';
import { GASErrorHandler } from '../utils/errorHandler.js';
import { RipgrepTool, RawRipgrepTool } from './ripgrep.js';
import { CatTool, RawCatTool } from './filesystem/index.js';
import { WriteTool, RawWriteTool } from './filesystem/index.js';
import { RegexProcessor } from '../utils/regexProcessor.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { getGitBreadcrumbEditHint, type GitBreadcrumbEditHint } from '../utils/gitBreadcrumbHints.js';

/**
 * Interface for sed operation results
 */
interface SedResult {
  filesProcessed: number;
  totalReplacements: number;
  files: Array<{
    path: string;
    replacements: number;
    success: boolean;
    error?: string;
  }>;
  nextAction?: {
    hint: string;
    required: boolean;
    rsync?: string;
  };
  gitBreadcrumbHints?: GitBreadcrumbEditHint[];
}

/**
 * Interface for replacement operations
 */
interface ReplacementOperation {
  pattern: string;
  replacement: string;
  global?: boolean;
  caseSensitive?: boolean;
}

/**
 * Smart sed tool that processes CommonJS wrappers automatically
 * 
 * @example
 * Basic find/replace:
 * sed({
 *   scriptId: "1abc2def...",
 *   pattern: "oldFunction",
 *   replacement: "newFunction"
 * })
 * 
 * @example
 * Regex with capture groups:
 * sed({
 *   scriptId: "1abc2def...",
 *   pattern: "function\\s+(\\w+)\\s*\\(",
 *   replacement: "async function $1(",
 *   path: "*.js"
 * })
 * 
 * @example
 * Multiple patterns:
 * sed({
 *   scriptId: "1abc2def...",
 *   patterns: ["console\\.log", "Logger\\.log"],
 *   replacement: "debug.log"
 * })
 */
export class SedTool extends BaseTool {
  public name = 'sed';
  public description = '🔧 RECOMMENDED: sed-style find/replace operations with automatic CommonJS processing. Supports regex patterns with capture groups ($1, $2), multi-pattern operations, and file filtering. Processes clean user code (same content as cat shows).';

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      pattern: {
        description: 'Regex pattern. Supports capture groups ($1, $2).',
        type: 'string',
        minLength: 1,
        examples: ['function\\\\s+(\\\\w+)', 'console\\\\.log\\\\([^)]*\\\\)']
      },
      patterns: {
        description: 'Multiple patterns (OR logic). Same replacement for all.',
        type: 'array',
        items: { type: 'string' },
        examples: [['console\\.log', 'Logger\\.log']]
      },
      replacement: {
        description: 'Replacement string. Use $1, $2 for capture groups.',
        type: 'string',
        examples: ['async function $1', 'debug.log($1)']
      },
      path: {
        description: 'File pattern (wildcards supported). Empty=all files.',
        type: 'string',
        default: '',
        examples: ['*.js', 'utils/*']
      },
      ...SchemaFragments.includeFileTypes,
      ...SchemaFragments.excludeFiles,
      global: {
        description: 'Replace all occurrences in each file (default: true)',
        type: 'boolean',
        default: true
      },
      ...SchemaFragments.caseSensitive,
      ...SchemaFragments.dryRun,
      maxFiles: {
        description: 'Maximum files to process (performance control)',
        type: 'number',
        default: 50,
        minimum: 1,
        maximum: 200
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'pattern', 'replacement'],
    additionalProperties: false,
    llmGuidance: {
      unixLike: 'sed s/old/new/g (replace) | GAS | CommonJS wrap/unwrap',
      whenToUse: 'Regex find/replace across files. Use capture groups ($1, $2) for complex transformations.',
      examples: ['sed({scriptId,pattern:"oldFunc",replacement:"newFunc"})', 'sed({scriptId,pattern:"console\\\\.log",replacement:"Logger.log",path:"*.gs"})'],
      nextSteps: ['exec→test changes', 'ripgrep→verify replacements', 'git_feature finish→commit'],
      errorRecovery: {
        'invalid regex': 'Escape special chars: . → \\\\. | ( → \\\\( | use dryRun:true to test',
        'no matches': 'ripgrep pattern first → verify exists → check caseSensitive flag',
        'partial replace': 'Check global:true (default) | verify pattern specificity'
      },
      antiPatterns: ['❌ sed for exact string → use edit (more reliable)', '❌ complex regex without dryRun → test with dryRun:true first', '❌ sed single file → edit is more efficient']
    }
  };

  private ripgrepTool: RipgrepTool;
  private catTool: CatTool;
  private writeTool: WriteTool;

  constructor(authManager: SessionAuthManager) {
    super(authManager);
    this.ripgrepTool = new RipgrepTool(authManager);
    this.catTool = new CatTool(authManager);
    this.writeTool = new WriteTool(authManager);
  }

  async execute(params: any): Promise<SedResult> {
    try {
      // Validate required parameters
      const scriptId = this.validate.scriptId(params.scriptId, 'sed find/replace operation');
      const pattern = this.validate.string(params.pattern, 'pattern', 'find/replace pattern');
      const replacement = this.validate.string(params.replacement, 'replacement', 'replacement string');

      // Build search patterns (main + additional)
      const searchPatterns = [pattern];
      if (params.patterns && Array.isArray(params.patterns)) {
        searchPatterns.push(...params.patterns);
      }

      // Configure search parameters
      const searchParams = {
        scriptId,
        pattern: searchPatterns[0], // Primary pattern
        patterns: searchPatterns.slice(1), // Additional patterns
        path: params.path || '',
        includeFileTypes: params.includeFileTypes,
        excludeFiles: params.excludeFiles,
        filesWithMatches: true, // Only get files with matches
        maxFiles: params.maxFiles || 50,
        accessToken: params.accessToken
      };

      // Find files with matches using ripgrep
      const searchResult = await this.ripgrepTool.execute(searchParams);
      
      if (!searchResult.matches || searchResult.matches.length === 0) {
        return {
          filesProcessed: 0,
          totalReplacements: 0,
          files: []
        };
      }

      // Process each file with matches
      const result: SedResult = {
        filesProcessed: 0,
        totalReplacements: 0,
        files: []
      };

      // Track branch info from first successful write
      let branchName: string | undefined;

      for (const matchFile of searchResult.matches) {
        try {
          // Read file content
          const catResult = await this.catTool.execute({
            scriptId,
            path: matchFile.fileName,
            accessToken: params.accessToken
          });

          // Perform replacements on the actual content string
          const { newContent, replacementCount } = this.performReplacements(
            catResult.content,
            searchPatterns,
            replacement,
            {
              global: params.global !== false,
              caseSensitive: params.caseSensitive === true
            }
          );

          // Apply changes if not dry run and replacements were made
          if (!params.dryRun && replacementCount > 0) {
            const writeResult = await this.writeTool.execute({
              scriptId,
              path: matchFile.fileName,
              content: newContent,
              accessToken: params.accessToken
            }) as any;  // WriteTool returns extended result with git info
            // Capture branch name from first successful write
            if (!branchName && writeResult.git?.branch) {
              branchName = writeResult.git.branch;
            }
          }

          result.files.push({
            path: matchFile.fileName,
            replacements: replacementCount,
            success: true
          });

          result.filesProcessed++;
          result.totalReplacements += replacementCount;

        } catch (error) {
          result.files.push({
            path: matchFile.fileName,
            replacements: 0,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Add workflow completion hint with rsync suggestion
      const { isFeatureBranch } = await import('../utils/gitAutoCommit.js');
      const onFeatureBranch = branchName ? isFeatureBranch(branchName) : false;
      result.nextAction = {
        hint: onFeatureBranch
          ? `Files updated. When complete: git_feature({ operation: 'finish', scriptId, pushToRemote: true })`
          : `Files updated. Commit when ready: git_feature({ operation: 'commit', scriptId, message: '...' })`,
        required: false,
        rsync: branchName ? `local_sync({ scriptId: "${scriptId}", operation: "plan", direction: "pull" })` : undefined
      };

      // Collect git breadcrumb hints for any .git/* files processed
      const gitBreadcrumbHints = result.files
        .filter(f => f.success && f.path.startsWith('.git/'))
        .map(f => getGitBreadcrumbEditHint(f.path))
        .filter(hint => hint !== null);

      if (gitBreadcrumbHints.length > 0) {
        result.gitBreadcrumbHints = gitBreadcrumbHints;
      }

      return result;

    } catch (error) {
      throw GASErrorHandler.handleApiError(error, {
        operation: 'sed find/replace operation',
        scriptId: params.scriptId,
        tool: 'sed'
      });
    }
  }

  /**
   * Perform find/replace operations on content using RegexProcessor utility
   */
  private performReplacements(
    content: string,
    patterns: string[],
    replacement: string,
    options: { global: boolean; caseSensitive: boolean }
  ): { newContent: string; replacementCount: number } {
    let newContent = content;
    let totalReplacementCount = 0;

    for (const pattern of patterns) {
      try {
        // Use RegexProcessor for consistent regex handling
        const { text, count } = RegexProcessor.replace(
          pattern,
          replacement,
          newContent,
          {
            searchMode: 'regex',
            caseSensitive: options.caseSensitive
            // Note: global flag handled by RegexProcessor internally
          }
        );

        newContent = text;
        totalReplacementCount += count;

      } catch (error) {
        // Skip invalid regex patterns
        console.warn(`Invalid regex pattern: ${pattern}`, error);
      }
    }

    return { newContent, replacementCount: totalReplacementCount };
  }
}

/**
 * Raw sed tool that preserves exact content including CommonJS wrappers
 * 
 * @example
 * Process system files:
 * raw_sed({
 *   scriptId: "1abc2def...",
 *   pattern: "_main\\\\s*\\\\(",
 *   replacement: "_mainFunction(",
 *   path: "*"
 * })
 */
export class RawSedTool extends BaseTool {
  public name = 'raw_sed';
  public description = '🔧 ADVANCED: sed-style find/replace on raw file content including CommonJS wrappers and system code. Operates on complete file content (same as raw_cat shows). Use for system-level modifications.';

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      pattern: {
        description: 'Regex pattern for raw content. Supports capture groups ($1, $2).',
        type: 'string',
        minLength: 1,
        examples: ['_main\\\\s*\\\\(', '__defineModule__\\\\s*\\\\(']
      },
      patterns: {
        description: 'Multiple patterns (OR logic) for raw content.',
        type: 'array',
        items: { type: 'string' },
        examples: [['_main', '__defineModule__']]
      },
      replacement: {
        description: 'Replacement string. Use $1, $2 for capture groups.',
        type: 'string',
        examples: ['_mainFunction(', '__defineModuleWrapper__(']
      },
      path: {
        description: 'File pattern to filter operations on raw content',
        type: 'string',
        default: '',
        examples: ['*', '*.gs']
      },
      ...SchemaFragments.includeFileTypes,
      ...SchemaFragments.excludeFiles,
      global: {
        description: 'Replace all occurrences in raw content (default: true)',
        type: 'boolean',
        default: true
      },
      ...SchemaFragments.caseSensitive,
      ...SchemaFragments.dryRun,
      maxFiles: {
        description: 'Maximum files to process in raw mode',
        type: 'number',
        default: 50,
        minimum: 1,
        maximum: 200
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'pattern', 'replacement'],
    additionalProperties: false
  };

  private ripgrepTool: RawRipgrepTool;
  private catTool: RawCatTool;
  private writeTool: RawWriteTool;

  constructor(authManager: SessionAuthManager) {
    super(authManager);
    this.ripgrepTool = new RawRipgrepTool(authManager);
    this.catTool = new RawCatTool(authManager);
    this.writeTool = new RawWriteTool(authManager);
  }

  async execute(params: any): Promise<SedResult> {
    try {
      // Validate required parameters
      const scriptId = this.validate.scriptId(params.scriptId, 'sed find/replace operation');
      const pattern = this.validate.string(params.pattern, 'pattern', 'find/replace pattern');
      const replacement = this.validate.string(params.replacement, 'replacement', 'replacement string');

      // Build search patterns (main + additional)
      const searchPatterns = [pattern];
      if (params.patterns && Array.isArray(params.patterns)) {
        searchPatterns.push(...params.patterns);
      }

      // Configure search parameters for raw content
      const searchParams = {
        scriptId,
        pattern: searchPatterns[0],
        patterns: searchPatterns.slice(1),
        path: params.path || '',
        includeFileTypes: params.includeFileTypes,
        excludeFiles: params.excludeFiles,
        filesWithMatches: true,
        maxFiles: params.maxFiles || 50,
        accessToken: params.accessToken
      };

      // Find files with matches using raw ripgrep
      const searchResult = await this.ripgrepTool.execute(searchParams);
      
      if (!searchResult.matches || searchResult.matches.length === 0) {
        return {
          filesProcessed: 0,
          totalReplacements: 0,
          files: []
        };
      }

      // Process each file with matches
      const result: SedResult = {
        filesProcessed: 0,
        totalReplacements: 0,
        files: []
      };

      for (const matchFile of searchResult.matches) {
        try {
          // Read raw file content
          const catResult = await this.catTool.execute({
            path: `${scriptId}/${matchFile.fileName}`,
            accessToken: params.accessToken
          });

          // Perform replacements on raw content
          const { newContent, replacementCount } = this.performReplacements(
            catResult.content,
            searchPatterns,
            replacement,
            {
              global: params.global !== false,
              caseSensitive: params.caseSensitive === true
            }
          );

          // Apply changes if not dry run and replacements were made
          if (!params.dryRun && replacementCount > 0) {
            await this.writeTool.execute({
              path: `${scriptId}/${matchFile.fileName}`,
              content: newContent,
              fileType: 'SERVER_JS', // Default for raw operations
              accessToken: params.accessToken
            });
          }

          result.files.push({
            path: matchFile.fileName,
            replacements: replacementCount,
            success: true
          });

          result.filesProcessed++;
          result.totalReplacements += replacementCount;

        } catch (error) {
          result.files.push({
            path: matchFile.fileName,
            replacements: 0,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Collect git breadcrumb hints for any .git/* files processed
      const gitBreadcrumbHints = result.files
        .filter(f => f.success && f.path.startsWith('.git/'))
        .map(f => getGitBreadcrumbEditHint(f.path))
        .filter(hint => hint !== null);

      if (gitBreadcrumbHints.length > 0) {
        result.gitBreadcrumbHints = gitBreadcrumbHints;
      }

      return result;

    } catch (error) {
      throw GASErrorHandler.handleApiError(error, {
        operation: 'raw sed find/replace operation',
        scriptId: params.scriptId,
        tool: 'raw_sed'
      });
    }
  }

  /**
   * Perform find/replace operations on raw content using RegexProcessor utility
   */
  private performReplacements(
    content: string,
    patterns: string[],
    replacement: string,
    options: { global: boolean; caseSensitive: boolean }
  ): { newContent: string; replacementCount: number } {
    let newContent = content;
    let totalReplacementCount = 0;

    for (const pattern of patterns) {
      try {
        // Use RegexProcessor for consistent regex handling
        const { text, count } = RegexProcessor.replace(
          pattern,
          replacement,
          newContent,
          {
            searchMode: 'regex',
            caseSensitive: options.caseSensitive
            // Note: global flag handled by RegexProcessor internally
          }
        );

        newContent = text;
        totalReplacementCount += count;

      } catch (error) {
        // Skip invalid regex patterns
        console.warn(`Invalid regex pattern: ${pattern}`, error);
      }
    }

    return { newContent, replacementCount: totalReplacementCount };
  }
}