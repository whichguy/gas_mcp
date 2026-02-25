/**
 * find - Find files matching patterns in GAS projects
 *
 * find: Shows user-friendly virtual file names (e.g., .gitignore instead of .gitignore.gs)
 * find({raw:true}): Shows actual GAS file names (e.g., .gitignore.gs)
 *
 * Mimics the shell find command for familiar file discovery patterns
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { parsePath, isWildcardPattern, matchesPattern, resolveHybridScriptId, getBaseName, fileNameMatches } from '../api/pathParser.js';
import { ValidationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import {
  translatePathForOperation,
  gasNameToVirtual,
  translateFilesForDisplay
} from '../utils/virtualFileTranslation.js';
import { generateFindHints } from '../utils/searchHints.js';

interface FindOptions {
  name?: string;        // Pattern to match file names (supports wildcards and regex)
  type?: string;        // File type filter (SERVER_JS, HTML, JSON)
  path?: string;        // Directory path pattern
  maxdepth?: number;    // Maximum depth to search
  size?: string;        // Size filter (e.g., +100k, -1M)
  newer?: string;       // Find files newer than this file
  older?: string;       // Find files older than this file
  print?: boolean;      // Print file names (default true)
  print0?: boolean;     // Print with null separator
  ls?: boolean;         // Long listing format
  prune?: boolean;      // Don't descend into directories
}

/**
 * find - Find files with virtual name translation (RECOMMENDED)
 * Shows user-friendly names like .gitignore, .git instead of .gitignore.gs, .git.gs
 * Use raw:true to see actual GAS filenames
 */
export class FindTool extends BaseTool {
  public name = 'find';
  public description = '[SEARCH:FILES] Find files by name pattern with shell-like glob matching — uses virtual (clean) filenames. WHEN: locating files by name pattern (e.g., "*Test*", "lib/*"). AVOID: use grep/ripgrep to search file contents; use ls for simple listing. Example: find({scriptId, pattern: "*Utils*"})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      scriptId: { type: 'string', description: 'GAS project ID' },
      matchCount: { type: 'number', description: 'Number of matching files' },
      files: { type: 'array', description: 'Matching file names or file detail objects' },
      output: { type: 'string', description: 'Null-separated output (print0 mode)' },
      hints: { type: 'object', description: 'Context-aware search hints' }
    }
  };

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      path: {
        type: 'string',
        description: 'Starting directory path (supports wildcards)',
        default: ''
      },
      name: {
        type: 'string',
        description: 'File name pattern (supports wildcards: *, ?, [abc])',
        examples: ['*.gs', 'test*']
      },
      type: {
        type: 'string',
        description: 'File type filter',
        enum: ['SERVER_JS', 'HTML', 'JSON', 'f', 'd'],
        examples: ['SERVER_JS']
      },
      maxdepth: {
        type: 'number',
        description: 'Maximum directory depth to search',
        minimum: 0,
        maximum: 10
      },
      size: {
        type: 'string',
        description: 'Size filter (+N for larger than N bytes, -N for smaller)',
        pattern: '^[+-]?\\d+[kMG]?$',
        examples: ['+100', '+10k']
      },
      newer: {
        type: 'string',
        description: 'Find files newer than this file'
      },
      older: {
        type: 'string',
        description: 'Find files older than this file'
      },
      print: {
        type: 'boolean',
        description: 'Print file names (default true)',
        default: true
      },
      print0: {
        type: 'boolean',
        description: 'Print with null separator instead of newline',
        default: false
      },
      ls: {
        type: 'boolean',
        description: 'Use long listing format with details',
        default: false
      },
      raw: {
        type: 'boolean',
        description: 'When true, shows actual GAS filenames (e.g., .gitignore.gs) instead of virtual names (e.g., .gitignore). Former raw_find behavior.',
        default: false
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId'],
    additionalProperties: false,
    llmGuidance: {
      limitations: 'GAS flat structure (no real dirs); *,?,[abc] wildcards match filenames not paths; virtual dotfile names (.gitignore not .gitignore.gs). raw:true→actual GAS names',
      antiPatterns: 'find then cat each→use ripgrep | find without pattern→use ls | find for content→use grep/ripgrep'
    }
  };

  public annotations = {
    title: 'Find Files',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);

    // Apply virtual file translation for path if provided (skip in raw mode)
    const translatedPath = (!params.raw && params.path) ? translatePathForOperation(params.path, true) : (params.path || '');

    // Use hybrid script ID resolution with translated path
    const hybridResolution = resolveHybridScriptId(params.scriptId, translatedPath);
    const scriptId = hybridResolution.scriptId;
    const searchPath = hybridResolution.cleanPath;

    // Get all files from project
    const allFiles = await this.gasClient.getProjectContent(scriptId, accessToken);

    // Apply virtual file translation for display (skip in raw mode)
    const filesToFilter = params.raw ? allFiles : translateFilesForDisplay(allFiles, true);

    // Filter files based on find options
    let matchedFiles = params.raw
      ? await this.filterFilesRaw(filesToFilter, {
          name: params.name,
          type: params.type,
          path: searchPath,
          maxdepth: params.maxdepth,
          size: params.size,
          newer: params.newer,
          older: params.older
        }, accessToken)
      : await this.filterFiles(filesToFilter, {
          name: params.name,
          type: params.type,
          path: searchPath,
          maxdepth: params.maxdepth,
          size: params.size,
          newer: params.newer,
          older: params.older
        }, allFiles, accessToken);

    // Format output based on options
    const result = this.formatOutput(matchedFiles, {
      print: params.print !== false,
      print0: params.print0 || false,
      ls: params.ls || false
    }, scriptId);

    // Generate context-aware hints based on results
    const hints = generateFindHints(
      matchedFiles.length,
      params.name,
      params.type,
      params.size
    );

    if (Object.keys(hints).length > 0) {
      result.hints = hints;
    }

    return result;
  }

  private async filterFiles(
    files: any[],
    options: FindOptions,
    originalFiles: any[],
    accessToken?: string
  ): Promise<any[]> {
    let filtered = [...files];

    // Filter by path pattern
    if (options.path) {
      filtered = filtered.filter(file => {
        const fileName = file.displayName || file.name;
        return fileName.startsWith(options.path!);
      });
    }

    // Filter by name pattern
    if (options.name) {
      filtered = filtered.filter(file => {
        const fileName = file.displayName || file.name;
        const baseName = getBaseName(fileName);

        if (isWildcardPattern(options.name!)) {
          return matchesPattern(baseName, options.name!);
        } else {
          return baseName === options.name;
        }
      });
    }

    // Filter by type
    if (options.type) {
      const typeMap: Record<string, string[]> = {
        'SERVER_JS': ['SERVER_JS', 'server_js'],
        'HTML': ['HTML', 'html'],
        'JSON': ['JSON', 'json'],
        'f': ['SERVER_JS', 'HTML', 'JSON', 'server_js', 'html', 'json'],  // Files
        'd': []  // Directories (GAS doesn't have real directories)
      };

      const allowedTypes = typeMap[options.type] || [options.type];
      if (allowedTypes.length > 0) {
        filtered = filtered.filter(file =>
          allowedTypes.includes(file.type || 'SERVER_JS')
        );
      }
    }

    // Filter by size
    if (options.size) {
      const sizeFilter = this.parseSizeFilter(options.size);
      filtered = filtered.filter(file => {
        // Find original file to get source content
        const originalFile = originalFiles.find(f => fileNameMatches(f.name, file.name));
        const size = (originalFile?.source || '').length;

        if (sizeFilter.operator === '+') {
          return size > sizeFilter.bytes;
        } else {
          return size < sizeFilter.bytes;
        }
      });
    }

    // Filter by maxdepth (directory depth)
    if (options.maxdepth !== undefined) {
      filtered = filtered.filter(file => {
        const fileName = file.displayName || file.name;
        const depth = (fileName.match(/\//g) || []).length;
        return depth <= options.maxdepth!;
      });
    }

    // TODO: Implement newer/older filters if GAS provides timestamps

    return filtered;
  }

  private async filterFilesRaw(
    files: any[],
    options: FindOptions,
    accessToken?: string
  ): Promise<any[]> {
    let filtered = [...files];

    // Filter by path pattern
    if (options.path) {
      filtered = filtered.filter(file =>
        file.name.startsWith(options.path!)
      );
    }

    // Filter by name pattern
    if (options.name) {
      filtered = filtered.filter(file => {
        const baseName = getBaseName(file.name);

        if (isWildcardPattern(options.name!)) {
          return matchesPattern(baseName, options.name!);
        } else {
          return baseName === options.name;
        }
      });
    }

    // Filter by type
    if (options.type) {
      const typeMap: Record<string, string[]> = {
        'SERVER_JS': ['SERVER_JS', 'server_js'],
        'HTML': ['HTML', 'html'],
        'JSON': ['JSON', 'json'],
        'f': ['SERVER_JS', 'HTML', 'JSON', 'server_js', 'html', 'json'],
        'd': []
      };

      const allowedTypes = typeMap[options.type] || [options.type];
      if (allowedTypes.length > 0) {
        filtered = filtered.filter(file =>
          allowedTypes.includes(file.type || 'SERVER_JS')
        );
      }
    }

    // Filter by size
    if (options.size) {
      const sizeFilter = this.parseSizeFilter(options.size);
      filtered = filtered.filter(file => {
        const size = (file.source || '').length;

        if (sizeFilter.operator === '+') {
          return size > sizeFilter.bytes;
        } else {
          return size < sizeFilter.bytes;
        }
      });
    }

    // Filter by maxdepth (directory depth)
    if (options.maxdepth !== undefined) {
      filtered = filtered.filter(file => {
        const depth = (file.name.match(/\//g) || []).length;
        return depth <= options.maxdepth!;
      });
    }

    return filtered;
  }

  private parseSizeFilter(sizeStr: string): { operator: '+' | '-', bytes: number } {
    const match = sizeStr.match(/^([+-])?(\d+)([kMG])?$/);
    if (!match) {
      throw new ValidationError('size', sizeStr, 'valid size filter (e.g., +100k, -1M)');
    }

    const operator = (match[1] || '+') as '+' | '-';
    let bytes = parseInt(match[2], 10);
    const unit = match[3];

    if (unit === 'k') bytes *= 1024;
    else if (unit === 'M') bytes *= 1024 * 1024;
    else if (unit === 'G') bytes *= 1024 * 1024 * 1024;

    return { operator, bytes };
  }

  private formatOutput(
    files: any[],
    options: { print: boolean, print0: boolean, ls: boolean },
    scriptId: string
  ): any {
    if (!options.print) {
      return {
        scriptId,
        matchCount: files.length,
        files: []
      };
    }

    if (options.ls) {
      // Long listing format with details
      return {
        scriptId,
        matchCount: files.length,
        files: files.map(file => ({
          name: file.displayName || file.name,
          type: file.type || 'SERVER_JS',
          size: file.size,
          virtualFile: file.virtualFile || false,
          ...(file.virtualFile && { actualName: file.name })
        }))
      };
    }

    // Simple name listing
    const names = files.map(f => f.displayName || f.name);

    if (options.print0) {
      return {
        scriptId,
        matchCount: files.length,
        output: names.join('\0')  // Null separator
      };
    }

    return {
      scriptId,
      matchCount: files.length,
      files: names
    };
  }
}
