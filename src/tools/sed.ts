/**
 * @fileoverview sed-style Regex Find/Replace across multiple files
 *
 * FLOW: ripgrep(find matches) → cat(read) → regex replace → write(save) per file
 * KEY: pattern + replacement | $1,$2 for capture groups | dryRun=true for preview
 * MULTI-FILE: Processes all matching files | per-file hash validation prevents cascading conflicts
 * VS EDIT: sed=regex patterns across files | edit=exact strings single file
 * NO AUTO-COMMIT: Must call git_feature({operation:'commit'}) after sed
 * RAW MODE: raw:true → operates on raw content including CommonJS wrappers (former raw_sed)
 */

import { BaseTool } from './base.js';
import type { SessionAuthManager } from '../auth/sessionManager.js';
import { GASErrorHandler } from '../utils/errorHandler.js';
import { RipgrepTool } from './ripgrep.js';
import { CatTool } from './filesystem/index.js';
import { WriteTool } from './filesystem/index.js';
import { RegexProcessor } from '../utils/regexProcessor.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { GuidanceFragments } from '../utils/guidanceFragments.js';
import { getGitBreadcrumbEditHint, type GitBreadcrumbEditHint } from '../utils/gitBreadcrumbHints.js';
import type { CompactGitHint } from '../utils/gitStatus.js';
import { mcpLogger } from '../utils/mcpLogger.js';

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
  git?: CompactGitHint;
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
  public description = '[FILE:SED] sed-style find/replace with regex support and capture groups ($1, $2) on clean user code. WHEN: bulk text replacements across a file using regex patterns. AVOID: use edit for simple string replacement; use ripgrep to preview matches first. Example: sed({scriptId, path: "Utils.gs", pattern: "s/oldFunc/newFunc/g"}). GIT: use git_feature(start) before features, git_feature(commit) after changes.';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      filesProcessed: { type: 'number', description: 'Number of files processed' },
      totalReplacements: { type: 'number', description: 'Total replacements made across all files' },
      files: { type: 'array', description: 'Per-file results (path, replacements, success, error)' },
      gitBreadcrumbHints: { type: 'array', description: 'Git breadcrumb hints for .git/* files' },
      git: { type: 'object', description: 'Compact git hint (branch, uncommitted count, action)' }
    }
  };

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
      raw: {
        type: 'boolean',
        description: 'When true, operates on raw file content including CommonJS _main() wrappers without unwrapping/rewrapping. Use for modifying module infrastructure. Former raw_sed behavior.',
        default: false
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'pattern', 'replacement'],
    additionalProperties: false,
    llmGuidance: {
      toolSelection: GuidanceFragments.searchToolHints,
      errorResolutions: GuidanceFragments.errorResolutions,
      antiPatterns: 'exact string->edit (reliable) | complex regex->dryRun:true first | single file->edit (efficient)'
    }
  };

  public annotations = {
    title: 'Find and Replace',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
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
        accessToken: params.accessToken,
        raw: params.raw || false
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

      // Track git hint from last successful write
      let lastGitHint: CompactGitHint | undefined;

      for (const matchFile of searchResult.matches) {
        try {
          // Read file content (raw mode reads with wrappers; normal mode unwraps)
          const catResult = await this.catTool.execute({
            scriptId,
            path: matchFile.fileName,
            accessToken: params.accessToken,
            raw: params.raw || false
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
              accessToken: params.accessToken,
              raw: params.raw || false,
              // When raw: true, pass fileType from the cat result (required by raw write path)
              ...(params.raw ? { fileType: (catResult.fileType || 'SERVER_JS').toUpperCase() } : {})
            }) as any;  // WriteTool returns extended result with git info
            // Capture git hint from last successful write
            if (writeResult.git) {
              lastGitHint = writeResult.git;
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

      // Propagate git workflow hint from last successful write
      if (lastGitHint) {
        result.git = lastGitHint;
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
        mcpLogger.warning('sed', { message: `Invalid regex pattern: ${pattern}`, details: error instanceof Error ? error.message : String(error) });
      }
    }

    return { newContent, replacementCount: totalReplacementCount };
  }
}