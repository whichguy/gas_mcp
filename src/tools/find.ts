/**
 * find and raw_find - Find files matching patterns in GAS projects
 * 
 * find: Shows user-friendly virtual file names (e.g., .gitignore instead of .gitignore.gs)
 * raw_find: Shows actual GAS file names (e.g., .gitignore.gs)
 * 
 * Mimics the shell find command for familiar file discovery patterns
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { parsePath, isWildcardPattern, matchesPattern, resolveHybridScriptId, getBaseName } from '../api/pathParser.js';
import { ValidationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { 
  translatePathForOperation,
  gasNameToVirtual,
  translateFilesForDisplay
} from '../utils/virtualFileTranslation.js';

interface FindOptions {
  name?: string;        // Pattern to match file names (supports wildcards and regex)
  type?: string;        // File type filter (SERVER_JS, HTML, JSON)
  path?: string;        // Directory path pattern
  maxdepth?: number;    // Maximum depth to search
  size?: string;        // Size filter (e.g., +100k, -1M)
  newer?: string;       // Find files newer than this file
  older?: string;       // Find files older than this file
  exec?: string;        // Command to execute on each file (not implemented)
  print?: boolean;      // Print file names (default true)
  print0?: boolean;     // Print with null separator
  ls?: boolean;         // Long listing format
  delete?: boolean;     // Delete matched files (not implemented for safety)
  prune?: boolean;      // Don't descend into directories
}

/**
 * gas_find - Find files with virtual name translation (RECOMMENDED)
 * Shows user-friendly names like .gitignore, .git instead of .gitignore.gs, .git.gs
 */
export class FindTool extends BaseTool {
  public name = 'find';
  public description = '🔍 RECOMMENDED: Find files in GAS projects using shell-like find syntax with virtual file names';
  
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
        examples: ['*.gs', 'test*', '[Tt]est.gs', '.git*']
      },
      type: {
        type: 'string',
        description: 'File type filter',
        enum: ['SERVER_JS', 'HTML', 'JSON', 'f', 'd'],
        examples: ['SERVER_JS', 'HTML', 'JSON']
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
        examples: ['+100', '-1000', '+10k', '-1M']
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
      ...SchemaFragments.accessToken
    },
    required: ['scriptId'],
    llmGuidance: {
      whenToUse: 'finding files→user-friendly virtual names',
      workflow: 'shell find: gas_find({scriptId,name:"*.test.gs"})',
      alternatives: 'gas_raw_find→actual GAS names',
      scriptTypeCompatibility: {standalone: 'Full Support', containerBound: 'Full Support', notes: 'Universal→shows virtual names'},
      limitations: {flatFileStructure: 'no real dirs→filename prefixes', wildcardSupport: '*,?,[abc]→match filenames not paths', virtualFileNames: 'dotfiles virtual (.gitignore) not GAS (.gitignore.gs)'},
      examples: ['test files: gas_find({scriptId,name:"*test*.gs"})', 'config: gas_find({scriptId,name:".git*"})', 'large: gas_find({scriptId,size:"+10k"})', 'details: gas_find({scriptId,ls:true})']
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    // Apply virtual file translation for path if provided
    const translatedPath = params.path ? translatePathForOperation(params.path, true) : '';
    
    // Use hybrid script ID resolution with translated path
    const hybridResolution = resolveHybridScriptId(params.scriptId, translatedPath);
    const scriptId = hybridResolution.scriptId;
    const searchPath = hybridResolution.cleanPath;
    
    // Get all files from project
    const allFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
    
    // Apply virtual file translation for display
    const translatedFiles = translateFilesForDisplay(allFiles, true);
    
    // Filter files based on find options
    let matchedFiles = await this.filterFiles(translatedFiles, {
      name: params.name,
      type: params.type,
      path: searchPath,
      maxdepth: params.maxdepth,
      size: params.size,
      newer: params.newer,
      older: params.older
    }, allFiles, accessToken);
    
    // Format output based on options
    return this.formatOutput(matchedFiles, {
      print: params.print !== false,
      print0: params.print0 || false,
      ls: params.ls || false
    }, scriptId);
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
        const originalFile = originalFiles.find(f => f.name === file.name);
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

/**
 * gas_raw_find - Find files showing actual GAS names (ADVANCED)
 * Shows actual GAS file names like .git.gs, .gitignore.gs
 */
export class RawFindTool extends BaseTool {
  public name = 'raw_find';
  public description = '🔧 ADVANCED: Find files in GAS projects showing actual GAS file names';
  
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
        examples: ['*.gs', 'test*', '[Tt]est.gs', '.git*']
      },
      type: {
        type: 'string',
        description: 'File type filter',
        enum: ['SERVER_JS', 'HTML', 'JSON', 'f', 'd'],
        examples: ['SERVER_JS', 'HTML', 'JSON']
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
        examples: ['+100', '-1000', '+10k', '-1M']
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
      ...SchemaFragments.accessToken
    },
    required: ['scriptId'],
    llmGuidance: {
      whenToUse: 'actual GAS file names (no translation)',
      workflow: 'shell find: gas_raw_find({scriptId,name:".git*"})',
      alternatives: 'gas_find→user-friendly virtual names',
      examples: ['dotfiles: gas_raw_find({scriptId,name:".git*"})', 'actual name: gas_raw_find({scriptId,name:".gitignore.gs"})']
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    // Use hybrid script ID resolution WITHOUT translation (raw mode)
    const hybridResolution = resolveHybridScriptId(params.scriptId, params.path || '');
    const scriptId = hybridResolution.scriptId;
    const searchPath = hybridResolution.cleanPath;
    
    // Get all files from project (raw, no translation)
    const allFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
    
    // Filter files based on find options (no translation)
    let matchedFiles = await this.filterFiles(allFiles, {
      name: params.name,
      type: params.type,
      path: searchPath,
      maxdepth: params.maxdepth,
      size: params.size,
      newer: params.newer,
      older: params.older
    }, accessToken);
    
    // Format output based on options
    return this.formatOutput(matchedFiles, {
      print: params.print !== false,
      print0: params.print0 || false,
      ls: params.ls || false
    }, scriptId);
  }
  
  private async filterFiles(
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
    
    // TODO: Implement newer/older filters if GAS provides timestamps
    
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
          name: file.name,
          type: file.type || 'SERVER_JS',
          size: (file.source || '').length
        }))
      };
    }
    
    // Simple name listing
    const names = files.map(f => f.name);
    
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