/**
 * @fileoverview sed-style Regex Find/Replace across multiple files
 *
 * FLOW: ripgrep(find matches) → cat(read) → regex replace → write(save) per file
 * KEY: pattern + replacement | $1,$2 for capture groups | dryRun=true for preview
 * MULTI-FILE: Processes all matching files | per-file hash validation prevents cascading conflicts
 * VS EDIT: sed=regex patterns across files | edit=exact strings single file
 * NO AUTO-COMMIT: Must call git_feature({operation:'commit'}) after sed
 */

import { BaseTool } from './base.js';
import type { SessionAuthManager } from '../auth/sessionManager.js';
import { GASErrorHandler } from '../utils/errorHandler.js';
import { RipgrepTool, RawRipgrepTool } from './ripgrep.js';
import { CatTool, RawCatTool } from './filesystem/index.js';
import { WriteTool, RawWriteTool } from './filesystem/index.js';
import { RegexProcessor } from '../utils/regexProcessor.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { GuidanceFragments } from '../utils/guidanceFragments.js';
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
  public description = '[FILE:SED] sed-style find/replace with regex support and capture groups ($1, $2) on clean user code. WHEN: bulk text replacements across a file using regex patterns. AVOID: use edit for simple string replacement; use ripgrep to preview matches first. Example: sed({scriptId, path: "Utils.gs", pattern: "s/oldFunc/newFunc/g"})';

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
      force: {
        type: 'boolean',
        description: '⚠️ Force replacements even if files were modified externally. Use only when intentionally overwriting concurrent changes.',
        default: false
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'pattern', 'replacement'],
    additionalProperties: false,
    llmGuidance: {
      unixLike: 'sed s/old/new/g (replace) | GAS | CommonJS wrap/unwrap',
      toolSelection: GuidanceFragments.searchToolHints,
      errorResolutions: GuidanceFragments.errorResolutions,
      whenToUse: 'Regex find/replace across files. Use capture groups ($1, $2) for complex transformations.',
      examples: ['sed({scriptId,pattern:"oldFunc",replacement:"newFunc"})', 'sed({scriptId,pattern:"console\\\\.log",replacement:"Logger.log",path:"*.gs"})'],
      nextSteps: ['exec->test changes', 'ripgrep->verify replacements', 'git_feature finish->commit'],
      antiPatterns: ['sed for exact string -> use edit (more reliable)', 'complex regex without dryRun -> test with dryRun:true first', 'sed single file -> edit is more efficient']
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
          // Read file content (catTool now returns hash for conflict detection)
          const catResult = await this.catTool.execute({
            scriptId,
            path: matchFile.fileName,
            accessToken: params.accessToken
          }) as any;  // catResult includes hash

          // Capture file hash at read time for conflict detection
          const fileHash = catResult.hash;

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
          // HASH-BASED CONFLICT DETECTION: Pass hash from cat to write
          // If file was modified externally between cat and write, ConflictError is thrown
          if (!params.dryRun && replacementCount > 0) {
            const writeResult = await this.writeTool.execute({
              scriptId,
              path: matchFile.fileName,
              content: newContent,
              // Pass hash for conflict detection (catches concurrent modifications)
              expectedHash: fileHash,
              force: params.force === true,  // Allow override if user explicitly requests
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
  public description = '[FILE:RAW:SED] sed-style find/replace on raw content including CommonJS wrappers. WHEN: modifying _main() wrapper code or module infrastructure with regex patterns. AVOID: use sed for normal user code. Example: raw_sed({scriptId, path: "Utils.gs", pattern: "s/loadNow: false/loadNow: true/g"})';

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
      force: {
        type: 'boolean',
        description: '⚠️ Force replacements even if files were modified externally. Use only when intentionally overwriting concurrent changes.',
        default: false
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
          // Read raw file content (catTool now returns hash for conflict detection)
          const catResult = await this.catTool.execute({
            path: `${scriptId}/${matchFile.fileName}`,
            accessToken: params.accessToken
          }) as any;  // catResult includes hash

          // Capture file hash at read time for conflict detection
          const fileHash = catResult.hash;

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
          // HASH-BASED CONFLICT DETECTION: Pass hash from cat to write
          // If file was modified externally between cat and write, ConflictError is thrown
          if (!params.dryRun && replacementCount > 0) {
            await this.writeTool.execute({
              path: `${scriptId}/${matchFile.fileName}`,
              content: newContent,
              fileType: 'SERVER_JS', // Default for raw operations
              // Pass hash for conflict detection (catches concurrent modifications)
              expectedHash: fileHash,
              force: params.force === true,  // Allow override if user explicitly requests
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