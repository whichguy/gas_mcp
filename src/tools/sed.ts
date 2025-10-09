/**
 * @fileoverview sed-inspired find/replace tools for Google Apps Script projects
 * 
 * Implements gas_sed and gas_raw_sed tools that provide powerful find/replace operations
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
 * gas_sed({
 *   scriptId: "1abc2def...",
 *   pattern: "oldFunction",
 *   replacement: "newFunction"
 * })
 * 
 * @example
 * Regex with capture groups:
 * gas_sed({
 *   scriptId: "1abc2def...",
 *   pattern: "function\\s+(\\w+)\\s*\\(",
 *   replacement: "async function $1(",
 *   path: "*.js"
 * })
 * 
 * @example
 * Multiple patterns:
 * gas_sed({
 *   scriptId: "1abc2def...",
 *   patterns: ["console\\.log", "Logger\\.log"],
 *   replacement: "debug.log"
 * })
 */
export class SedTool extends BaseTool {
  public name = 'sed';
  public description = '🔧 RECOMMENDED: sed-style find/replace operations with automatic CommonJS processing. Supports regex patterns with capture groups ($1, $2), multi-pattern operations, and file filtering. Processes clean user code (same content as gas_cat shows).';

  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        description: 'Google Apps Script project ID',
        type: 'string',
        pattern: '^[a-zA-Z0-9_-]{25,60}$',
        examples: ['1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789']
      },
      pattern: {
        description: 'Primary regex pattern to search for. Supports capture groups with $1, $2 syntax in replacement.',
        type: 'string',
        minLength: 1,
        examples: [
          'function\\\\s+(\\\\w+)',
          'console\\\\.log\\\\([^)]*\\\\)',
          '\\\\b(var|let)\\\\s+(\\\\w+)',
          'require\\\\(["\']([^"\']+)["\']\\\\)'
        ]
      },
      patterns: {
        description: 'Multiple search patterns (OR logic with main pattern). All patterns use same replacement.',
        type: 'array',
        items: { type: 'string' },
        examples: [
          ['console\\.log', 'Logger\\.log'],
          ['function\\\\s+(\\\\w+)', 'const\\\\s+(\\\\w+)\\\\s*=']
        ]
      },
      replacement: {
        description: 'Replacement string. Use $1, $2, etc. for capture groups from regex patterns.',
        type: 'string',
        examples: [
          'async function $1',
          'debug.log($1)',
          'const $2',
          'require("$1")'
        ]
      },
      path: {
        description: 'File pattern to filter operations (supports wildcards). Empty processes all files.',
        type: 'string',
        default: '',
        examples: ['*.js', 'utils/*', '*Controller*', 'test/*.spec']
      },
      includeFileTypes: {
        description: 'Filter by GAS file types',
        type: 'array',
        items: {
          type: 'string',
          enum: ['SERVER_JS', 'HTML', 'JSON']
        },
        examples: [['SERVER_JS'], ['SERVER_JS', 'HTML']]
      },
      excludeFiles: {
        description: 'File patterns to exclude from processing',
        type: 'array',
        items: { type: 'string' },
        examples: [['*/test/*', '*/CommonJS'], ['*Test*', '*Spec*']]
      },
      global: {
        description: 'Replace all occurrences in each file (default: true)',
        type: 'boolean',
        default: true
      },
      caseSensitive: {
        description: 'Case-sensitive pattern matching (default: false)',
        type: 'boolean',
        default: false
      },
      dryRun: {
        description: 'Preview changes without applying them',
        type: 'boolean',
        default: false
      },
      maxFiles: {
        description: 'Maximum files to process (performance control)',
        type: 'number',
        default: 50,
        minimum: 1,
        maximum: 200
      },
      accessToken: {
        description: 'Access token for stateless operation (optional)',
        type: 'string',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$'
      }
    },
    required: ['scriptId', 'pattern', 'replacement'],
    additionalProperties: false
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
            await this.writeTool.execute({
              scriptId,
              path: matchFile.fileName,
              content: newContent,
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

      return result;

    } catch (error) {
      throw GASErrorHandler.handleApiError(error, {
        operation: 'sed find/replace operation',
        scriptId: params.scriptId,
        tool: 'gas_sed'
      });
    }
  }

  /**
   * Perform find/replace operations on content
   */
  private performReplacements(
    content: string,
    patterns: string[],
    replacement: string,
    options: { global: boolean; caseSensitive: boolean }
  ): { newContent: string; replacementCount: number } {
    let newContent = content;
    let replacementCount = 0;

    for (const pattern of patterns) {
      try {
        // Build regex flags
        const flags = options.global ? 'g' : '';
        const caseFlags = options.caseSensitive ? '' : 'i';
        const regex = new RegExp(pattern, flags + caseFlags);

        // Count matches before replacement
        const matches = newContent.match(new RegExp(pattern, 'g' + caseFlags));
        const matchCount = matches ? matches.length : 0;

        // Perform replacement
        newContent = newContent.replace(regex, replacement);
        replacementCount += matchCount;

      } catch (error) {
        // Skip invalid regex patterns
        console.warn(`Invalid regex pattern: ${pattern}`, error);
      }
    }

    return { newContent, replacementCount };
  }
}

/**
 * Raw sed tool that preserves exact content including CommonJS wrappers
 * 
 * @example
 * Process system files:
 * gas_raw_sed({
 *   scriptId: "1abc2def...",
 *   pattern: "_main\\\\s*\\\\(",
 *   replacement: "_mainFunction(",
 *   path: "*"
 * })
 */
export class RawSedTool extends BaseTool {
  public name = 'raw_sed';
  public description = '🔧 ADVANCED: sed-style find/replace on raw file content including CommonJS wrappers and system code. Operates on complete file content (same as gas_raw_cat shows). Use for system-level modifications.';

  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        description: 'Google Apps Script project ID',
        type: 'string',
        pattern: '^[a-zA-Z0-9_-]{25,60}$',
        examples: ['1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789']
      },
      pattern: {
        description: 'Primary regex pattern to search for in raw content. Supports capture groups with $1, $2 syntax.',
        type: 'string',
        minLength: 1,
        examples: [
          '_main\\\\s*\\\\(',
          '__defineModule__\\\\s*\\\\(',
          'globalThis\\.__',
          'module\\\\s*=\\\\s*globalThis'
        ]
      },
      patterns: {
        description: 'Multiple search patterns (OR logic) for raw content processing.',
        type: 'array',
        items: { type: 'string' },
        examples: [
          ['_main', '__defineModule__'],
          ['CommonJS', 'wrapper', 'shim']
        ]
      },
      replacement: {
        description: 'Replacement string for raw content. Use $1, $2, etc. for capture groups.',
        type: 'string',
        examples: [
          '_mainFunction(',
          '__defineModuleWrapper__(',
          'globalThis.__enhanced'
        ]
      },
      path: {
        description: 'File pattern to filter operations on raw content',
        type: 'string',
        default: '',
        examples: ['*', '*.gs', 'CommonJS', '__mcp_gas_run']
      },
      includeFileTypes: {
        description: 'Filter by file types for raw content processing',
        type: 'array',
        items: {
          type: 'string',
          enum: ['SERVER_JS', 'HTML', 'JSON']
        }
      },
      excludeFiles: {
        description: 'File patterns to exclude from raw processing',
        type: 'array',
        items: { type: 'string' }
      },
      global: {
        description: 'Replace all occurrences in raw content (default: true)',
        type: 'boolean',
        default: true
      },
      caseSensitive: {
        description: 'Case-sensitive pattern matching in raw content (default: false)',
        type: 'boolean',
        default: false
      },
      dryRun: {
        description: 'Preview raw content changes without applying them',
        type: 'boolean',
        default: false
      },
      maxFiles: {
        description: 'Maximum files to process in raw mode',
        type: 'number',
        default: 50,
        minimum: 1,
        maximum: 200
      },
      accessToken: {
        description: 'Access token for stateless operation (optional)',
        type: 'string',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$'
      }
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

      return result;

    } catch (error) {
      throw GASErrorHandler.handleApiError(error, {
        operation: 'raw sed find/replace operation',
        scriptId: params.scriptId,
        tool: 'gas_raw_sed'
      });
    }
  }

  /**
   * Perform find/replace operations on raw content
   */
  private performReplacements(
    content: string,
    patterns: string[],
    replacement: string,
    options: { global: boolean; caseSensitive: boolean }
  ): { newContent: string; replacementCount: number } {
    let newContent = content;
    let replacementCount = 0;

    for (const pattern of patterns) {
      try {
        // Build regex flags
        const flags = options.global ? 'g' : '';
        const caseFlags = options.caseSensitive ? '' : 'i';
        const regex = new RegExp(pattern, flags + caseFlags);

        // Count matches before replacement
        const matches = newContent.match(new RegExp(pattern, 'g' + caseFlags));
        const matchCount = matches ? matches.length : 0;

        // Perform replacement
        newContent = newContent.replace(regex, replacement);
        replacementCount += matchCount;

      } catch (error) {
        // Skip invalid regex patterns
        console.warn(`Invalid regex pattern: ${pattern}`, error);
      }
    }

    return { newContent, replacementCount };
  }
}