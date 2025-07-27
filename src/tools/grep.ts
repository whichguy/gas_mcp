/**
 * gas_grep and gas_raw_grep - Search file contents with pattern matching
 * 
 * gas_grep: Search clean user code (unwrapped from CommonJS wrappers)
 * gas_raw_grep: Search raw file content (including CommonJS wrappers and system code)
 * 
 * Server-side grep to minimize token usage while providing powerful search capabilities
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { parsePath, isWildcardPattern, matchesPattern } from '../api/pathParser.js';
import { ValidationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { 
  GrepSearchEngine, 
  GrepSearchOptions, 
  GASFile,
  detectPathMode,
  matchesPathPattern,
  validatePathPattern 
} from '../utils/grepEngine.js';

/**
 * gas_grep - Search clean user code (unwrapped from CommonJS)
 * Shows search results from the actual code developers write and edit
 */
export class GasGrepTool extends BaseTool {
  public name = 'gas_grep';
  public description = '🔍 RECOMMENDED: Search clean user code with automatic CommonJS unwrapping - shows search results from the actual code developers write and edit';
  
  public inputSchema = {
    type: 'object',
    llmGuidance: {
      alternatives: 'Use gas_raw_grep when you need explicit project ID control or want to search system-generated content',
      commonJsIntegration: 'All SERVER_JS files are automatically integrated with the CommonJS module system (see CommonJS.js). When searching files, the outer _main() wrapper is removed to show clean user code searches. The code still has access to require(), module, and exports when executed - these are provided by the CommonJS system.',
      editingWorkflow: 'Search results show unwrapped code for easy reading. The same unwrapped content is what gas_cat shows for editing.',
      moduleAccess: 'Your search will find require("ModuleName") calls, module.exports = {...} assignments, and exports.func = ... usage in clean user code without system wrapper noise.',
      whenToUse: 'Use for normal code searches. Automatically handles CommonJS unwrapping for cleaner results.',
      workflow: 'Searches through the clean user code that developers actually write and edit',
      contentComparison: 'gas_grep searches the same content that gas_cat shows (unwrapped user code), while gas_raw_grep searches the same content that gas_raw_cat shows (full file including CommonJS wrappers)'
    },
    properties: {
      pattern: {
        type: 'string',
        description: 'Search pattern (supports regex and literal text). Searches clean user code (same content as gas_cat shows). Examples: "function\\\\s+(\\\\w+)" finds user functions, "require(" finds user dependencies',
        minLength: 1,
        examples: [
          'require\\\\(',                    // Find user require calls (no wrapper noise)
          'function\\\\s+(\\\\w+)',          // Find user function definitions (skips _main wrapper)
          'exports\\.[a-zA-Z_$]',           // Find user exports assignments
          'module\\.exports\\s*=',          // Find user module.exports
          'TODO:|FIXME:',                   // Find user todo items
          'console\\\\.log',                // Find user console.log statements
          'Logger\\\\.log',                 // Find user Logger.log statements
          'api[_-]?key',                    // Find potential API keys in user code
          '^\\\\s*const\\\\s+\\\\w+',      // Find user const declarations
          'class\\\\s+(\\\\w+)',           // Find user class definitions
        ]
      },
      path: {
        type: 'string',
        description: 'Project or file path with wildcard/regex support. Searches clean user code in matching files (same content processing as gas_cat). Examples: "projectId" (entire project), "projectId/utils/*" (wildcard), "projectId/.*Controller.*" (regex)',
        default: '',
        examples: [
          'projectId',                      // Search entire project (user code only)
          'projectId/ai_tools/*',          // Wildcard: ai_tools directory (user code only)  
          'projectId/*Connector*',         // Wildcard: files containing Connector (user code only)
          'projectId/.*Controller.*',      // Regex: files containing Controller (user code only)
          'projectId/(utils|helpers)/.*',  // Regex: utils OR helpers directories (user code only)
          'projectId/.*\\.(test|spec)$',  // Regex: test files ending in .test or .spec (user code only)
          'projectId/test/*/*.test'        // Wildcard: test files in subdirectories (user code only)
        ]
      },
      pathMode: {
        type: 'string',
        enum: ['wildcard', 'regex', 'auto'],
        default: 'auto',
        description: 'Path pattern interpretation: wildcard (*, ?), regex (full regex), auto (detect automatically)'
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific file list to search (alternative to path parameter)',
        examples: [
          ['projectId/utils/helpers', 'projectId/models/User'],
          ['projectId/ai_tools/BaseConnector', 'projectId/ai_tools/ClaudeConnector']
        ]
      },
      searchMode: {
        type: 'string',
        enum: ['regex', 'literal', 'auto'],
        default: 'auto',
        description: 'Pattern interpretation mode: regex (treat as regex), literal (escape special chars), auto (detect automatically)'
      },
      caseSensitive: {
        type: 'boolean',
        default: false,
        description: 'Enable case-sensitive matching'
      },
      wholeWord: {
        type: 'boolean',
        default: false,
        description: 'Match whole words only (adds word boundaries \\\\b)'
      },
      maxResults: {
        type: 'number',
        default: 50,
        minimum: 1,
        maximum: 200,
        description: 'Maximum total matches to return (prevents token overflow)'
      },
      maxFilesSearched: {
        type: 'number',
        default: 100,
        minimum: 1,
        maximum: 500,
        description: 'Maximum files to search (performance control)'
      },
      contextLines: {
        type: 'number',
        default: 2,
        minimum: 0,
        maximum: 10,
        description: 'Number of lines before/after each match for context'
      },
      showLineNumbers: {
        type: 'boolean',
        default: true,
        description: 'Include line numbers in results'
      },
      showFileHeaders: {
        type: 'boolean',
        default: true,
        description: 'Group results by file with headers'
      },
      compact: {
        type: 'boolean',
        default: false,
        description: 'Use compact output format (filename:line:content)'
      },
      excludeFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files to exclude from search (supports wildcards)',
        examples: [
          ['*/test/*', '*/CommonJS'],
          ['projectId/dist/*', 'projectId/node_modules/*']
        ]
      },
      includeFileTypes: {
        type: 'array',
        items: { 
          type: 'string',
          enum: ['SERVER_JS', 'HTML', 'JSON']
        },
        description: 'Filter by file types (SERVER_JS, HTML, JSON)',
        examples: [
          ['SERVER_JS'],                    // JavaScript files only
          ['SERVER_JS', 'HTML'],           // JavaScript and HTML files
          ['JSON']                         // JSON files only
        ]
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['pattern']
  };

  private gasClient: GASClient;
  private grepEngine: GrepSearchEngine;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
    this.grepEngine = new GrepSearchEngine();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    // Validate required parameters
    if (!params.pattern) {
      throw new ValidationError('pattern', params.pattern, 'non-empty search pattern');
    }

    // Build search options
    const searchOptions: GrepSearchOptions = {
      pattern: params.pattern,
      searchMode: params.searchMode || 'auto',
      pathMode: params.pathMode || 'auto',
      caseSensitive: params.caseSensitive || false,
      wholeWord: params.wholeWord || false,
      maxResults: Math.min(params.maxResults || 50, 200),
      maxFilesSearched: Math.min(params.maxFilesSearched || 100, 500),
      contextLines: Math.min(params.contextLines || 2, 10),
      showLineNumbers: params.showLineNumbers !== false,
      showFileHeaders: params.showFileHeaders !== false,
      compact: params.compact || false,
      excludeFiles: params.excludeFiles || [],
      includeFileTypes: params.includeFileTypes || []
    };

    // Validate path pattern if provided
    if (params.path) {
      const pathValidation = validatePathPattern(params.path, searchOptions.pathMode!);
      if (!pathValidation.valid) {
        throw new ValidationError('path', params.path, `valid path pattern: ${pathValidation.error}`);
      }
    }

    // Determine target files and unwrap CommonJS content
    const files = await this.getTargetFilesWithUnwrapping(params, accessToken);
    
    if (files.length === 0) {
      return {
        searchPattern: params.pattern,
        searchMode: searchOptions.searchMode,
        caseSensitive: searchOptions.caseSensitive,
        totalMatches: 0,
        totalFiles: 0,
        filesSearched: 0,
        truncated: false,
        matches: [],
        searchTime: 0,
        tokenEstimate: 0,
        message: 'No files found matching the specified criteria',
        contentType: 'user-code (CommonJS unwrapped)'
      };
    }

    // Execute search
    const results = await this.grepEngine.searchFiles(files, searchOptions, this.extractProjectId(params));

    // Add metadata about content processing
    (results as any).contentType = 'user-code (CommonJS unwrapped)';
    (results as any).note = 'Search performed on clean user code. Use gas_raw_grep to search full file content including CommonJS wrappers.';

    // Add formatted output for different display modes
    if (searchOptions.compact) {
      (results as any).formattedOutput = this.grepEngine.formatCompactResults(results);
    } else {
      (results as any).formattedOutput = this.grepEngine.formatDetailedResults(results);
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
        const unwrapped = unwrapModuleContent(processedContent);
        if (unwrapped !== processedContent) {
          processedContent = unwrapped;
          console.error(`📖 [GAS_GREP] Unwrapped CommonJS structure from ${file.name} for clean code search`);
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
   * Get target files based on path/files parameters (raw content)
   */
  private async getTargetFiles(params: any, accessToken?: string): Promise<GASFile[]> {
    // If specific files provided, get those
    if (params.files && Array.isArray(params.files) && params.files.length > 0) {
      return await this.getSpecificFiles(params.files, accessToken);
    }

    // Use path parameter (with wildcard/regex support)
    const path = params.path || '';
    const pathMode = params.pathMode || 'auto';
    const parsedPath = parsePath(path);

    if (!parsedPath.projectId) {
      throw new ValidationError('path', path, 'valid project path (projectId or projectId/path)');
    }

    // Get all files from project
    const allFiles = await this.gasClient.getProjectContent(parsedPath.projectId, accessToken);

    // Convert to GASFile format
    const gasFiles: GASFile[] = allFiles.map((file: any) => ({
      name: file.name,
      type: file.type || 'SERVER_JS',
      source: file.source || '',
      size: (file.source || '').length
    }));

    // Apply path filtering with enhanced regex/wildcard support
    if (parsedPath.directory || parsedPath.filename) {
      const filterPattern = parsedPath.directory || parsedPath.filename || '';
      
      // Use new regex/wildcard path matching
      return gasFiles.filter(file => 
        matchesPathPattern(file.name, filterPattern, pathMode, parsedPath.projectId)
      );
    } else if (parsedPath.isWildcard || pathMode === 'regex') {
      // Handle wildcard/regex patterns in the full path
      const fullPattern = path.substring(parsedPath.projectId!.length + 1); // Remove "projectId/"
      
      return gasFiles.filter(file => 
        matchesPathPattern(file.name, fullPattern, pathMode, parsedPath.projectId)
      );
    }

    return gasFiles;
  }

  /**
   * Get specific files by name
   */
  private async getSpecificFiles(fileNames: string[], accessToken?: string): Promise<GASFile[]> {
    const files: GASFile[] = [];

    for (const fileName of fileNames) {
      try {
        const parsedPath = parsePath(fileName);
        if (!parsedPath.projectId) continue;

        const projectFiles = await this.gasClient.getProjectContent(parsedPath.projectId, accessToken);
        const targetFile = projectFiles.find((f: any) => f.name === (parsedPath.filename || parsedPath.directory));
        
        if (targetFile) {
          files.push({
            name: targetFile.name,
            type: targetFile.type || 'SERVER_JS',
            source: targetFile.source || '',
            size: (targetFile.source || '').length
          });
        }
      } catch (error) {
        // Skip invalid file references
        console.error(`Failed to load file ${fileName}:`, error);
      }
    }

    return files;
  }

  /**
   * Extract project ID from parameters
   */
  private extractProjectId(params: any): string | undefined {
    if (params.files && params.files.length > 0) {
      const parsedPath = parsePath(params.files[0]);
      return parsedPath.projectId || undefined;
    }

    if (params.path) {
      const parsedPath = parsePath(params.path);
      return parsedPath.projectId || undefined;
    }

    return undefined;
  }
}

/**
 * gas_raw_grep - Search raw file content (including CommonJS wrappers)
 * Shows search results from the complete file content including system-generated code
 */
export class GasRawGrepTool extends BaseTool {
  public name = 'gas_raw_grep';
  public description = '🔧 ADVANCED: Search file contents with explicit project ID control and full content including CommonJS wrappers';
  
  public inputSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Search pattern (supports regex and literal text). Searches complete file content (same content as gas_raw_cat shows) including CommonJS wrappers. Examples: "_main\\\\s*\\\\(" finds CommonJS wrappers, "__defineModule__" finds system calls',
        minLength: 1,
        examples: [
          'require\\\\(',                    // Find require calls (in user code + system context)
          'function\\\\s+(\\\\w+)',          // Find ALL function definitions (user + _main wrappers)
          '_main\\\\s*\\\\(',                // Find CommonJS _main wrappers (only in raw content)
          '__defineModule__',               // Find module system calls (only in raw content)
          'globalThis\\.__getCurrentModule', // Find module system internals (only in raw content)
          'module\\s*=\\s*globalThis',      // Find CommonJS parameter setup (only in raw content)
          'exports\\s*=\\s*module\\.exports', // Find CommonJS parameter setup (only in raw content)
          'TODO:|FIXME:',                   // Find todo items (user code + any in wrappers)
          'console\\\\.log',                // Find console.log statements (user + system)
          'Logger\\\\.log',                 // Find Logger.log statements (user + system)
        ]
      },
      path: {
        type: 'string',
        description: 'Project or file path with wildcard/regex support. Searches complete file content in matching files (same content processing as gas_raw_cat) including CommonJS wrappers and system code.',
        default: '',
        examples: [
          'projectId',                      // Search entire project (full file content including wrappers)
          'projectId/ai_tools/*',          // Wildcard: ai_tools directory (full content including wrappers)
          'projectId/*Connector*',         // Wildcard: files containing Connector (full content including wrappers)
          'projectId/.*Controller.*',      // Regex: files containing Controller (full content including wrappers)
          'projectId/(utils|helpers)/.*',  // Regex: utils OR helpers directories (full content including wrappers)
          'projectId/.*\\.(test|spec)$',  // Regex: test files ending in .test or .spec (full content including wrappers)
          'projectId/test/*/*.test'        // Wildcard: test files in subdirectories (full content including wrappers)
        ]
      },
      pathMode: {
        type: 'string',
        enum: ['wildcard', 'regex', 'auto'],
        default: 'auto',
        description: 'Path pattern interpretation: wildcard (*, ?), regex (full regex), auto (detect automatically)'
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific file list to search (alternative to path parameter)',
        examples: [
          ['projectId/utils/helpers', 'projectId/models/User'],
          ['projectId/ai_tools/BaseConnector', 'projectId/ai_tools/ClaudeConnector']
        ]
      },
      searchMode: {
        type: 'string',
        enum: ['regex', 'literal', 'auto'],
        default: 'auto',
        description: 'Pattern interpretation mode: regex (treat as regex), literal (escape special chars), auto (detect automatically)'
      },
      caseSensitive: {
        type: 'boolean',
        default: false,
        description: 'Enable case-sensitive matching'
      },
      wholeWord: {
        type: 'boolean',
        default: false,
        description: 'Match whole words only (adds word boundaries \\\\b)'
      },
      maxResults: {
        type: 'number',
        default: 50,
        minimum: 1,
        maximum: 200,
        description: 'Maximum total matches to return (prevents token overflow)'
      },
      maxFilesSearched: {
        type: 'number',
        default: 100,
        minimum: 1,
        maximum: 500,
        description: 'Maximum files to search (performance control)'
      },
      contextLines: {
        type: 'number',
        default: 2,
        minimum: 0,
        maximum: 10,
        description: 'Number of lines before/after each match for context'
      },
      showLineNumbers: {
        type: 'boolean',
        default: true,
        description: 'Include line numbers in results'
      },
      showFileHeaders: {
        type: 'boolean',
        default: true,
        description: 'Group results by file with headers'
      },
      compact: {
        type: 'boolean',
        default: false,
        description: 'Use compact output format (filename:line:content)'
      },
      excludeFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files to exclude from search (supports wildcards)',
        examples: [
          ['*/test/*', '*/CommonJS'],
          ['projectId/dist/*', 'projectId/node_modules/*']
        ]
      },
      includeFileTypes: {
        type: 'array',
        items: { 
          type: 'string',
          enum: ['SERVER_JS', 'HTML', 'JSON']
        },
        description: 'Filter by file types (SERVER_JS, HTML, JSON)',
        examples: [
          ['SERVER_JS'],                    // JavaScript files only
          ['SERVER_JS', 'HTML'],           // JavaScript and HTML files
          ['JSON']                         // JSON files only
        ]
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['pattern']
  };

  private gasClient: GASClient;
  private grepEngine: GrepSearchEngine;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
    this.grepEngine = new GrepSearchEngine();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    // Validate required parameters
    if (!params.pattern) {
      throw new ValidationError('pattern', params.pattern, 'non-empty search pattern');
    }

    // Build search options
    const searchOptions: GrepSearchOptions = {
      pattern: params.pattern,
      searchMode: params.searchMode || 'auto',
      pathMode: params.pathMode || 'auto',
      caseSensitive: params.caseSensitive || false,
      wholeWord: params.wholeWord || false,
      maxResults: Math.min(params.maxResults || 50, 200),
      maxFilesSearched: Math.min(params.maxFilesSearched || 100, 500),
      contextLines: Math.min(params.contextLines || 2, 10),
      showLineNumbers: params.showLineNumbers !== false,
      showFileHeaders: params.showFileHeaders !== false,
      compact: params.compact || false,
      excludeFiles: params.excludeFiles || [],
      includeFileTypes: params.includeFileTypes || []
    };

    // Validate path pattern if provided
    if (params.path) {
      const pathValidation = validatePathPattern(params.path, searchOptions.pathMode!);
      if (!pathValidation.valid) {
        throw new ValidationError('path', params.path, `valid path pattern: ${pathValidation.error}`);
      }
    }

    // Determine target files (raw content)
    const files = await this.getTargetFiles(params, accessToken);
    
    if (files.length === 0) {
      return {
        searchPattern: params.pattern,
        searchMode: searchOptions.searchMode,
        caseSensitive: searchOptions.caseSensitive,
        totalMatches: 0,
        totalFiles: 0,
        filesSearched: 0,
        truncated: false,
        matches: [],
        searchTime: 0,
        tokenEstimate: 0,
        message: 'No files found matching the specified criteria',
        contentType: 'raw-content (includes CommonJS wrappers)'
      };
    }

    // Execute search
    const results = await this.grepEngine.searchFiles(files, searchOptions, this.extractProjectId(params));

    // Add metadata about content processing
    (results as any).contentType = 'raw-content (includes CommonJS wrappers)';
    (results as any).note = 'Search performed on complete file content including CommonJS wrappers and system code. Use gas_grep to search only user code.';

    // Add formatted output for different display modes
    if (searchOptions.compact) {
      (results as any).formattedOutput = this.grepEngine.formatCompactResults(results);
    } else {
      (results as any).formattedOutput = this.grepEngine.formatDetailedResults(results);
    }

    return results;
  }

  /**
   * Get target files based on path/files parameters
   */
  private async getTargetFiles(params: any, accessToken?: string): Promise<GASFile[]> {
    // If specific files provided, get those
    if (params.files && Array.isArray(params.files) && params.files.length > 0) {
      return await this.getSpecificFiles(params.files, accessToken);
    }

    // Use path parameter (with wildcard/regex support)
    const path = params.path || '';
    const pathMode = params.pathMode || 'auto';
    const parsedPath = parsePath(path);

    if (!parsedPath.projectId) {
      throw new ValidationError('path', path, 'valid project path (projectId or projectId/path)');
    }

    // Get all files from project
    const allFiles = await this.gasClient.getProjectContent(parsedPath.projectId, accessToken);

    // Convert to GASFile format
    const gasFiles: GASFile[] = allFiles.map((file: any) => ({
      name: file.name,
      type: file.type || 'SERVER_JS',
      source: file.source || '',
      size: (file.source || '').length
    }));

    // Apply path filtering with enhanced regex/wildcard support
    if (parsedPath.directory || parsedPath.filename) {
      const filterPattern = parsedPath.directory || parsedPath.filename || '';
      
      // Use new regex/wildcard path matching
      return gasFiles.filter(file => 
        matchesPathPattern(file.name, filterPattern, pathMode, parsedPath.projectId)
      );
    } else if (parsedPath.isWildcard || pathMode === 'regex') {
      // Handle wildcard/regex patterns in the full path
      const fullPattern = path.substring(parsedPath.projectId!.length + 1); // Remove "projectId/"
      
      return gasFiles.filter(file => 
        matchesPathPattern(file.name, fullPattern, pathMode, parsedPath.projectId)
      );
    }

    return gasFiles;
  }

  /**
   * Get specific files by name
   */
  private async getSpecificFiles(fileNames: string[], accessToken?: string): Promise<GASFile[]> {
    const files: GASFile[] = [];

    for (const fileName of fileNames) {
      try {
        const parsedPath = parsePath(fileName);
        if (!parsedPath.projectId) continue;

        const projectFiles = await this.gasClient.getProjectContent(parsedPath.projectId, accessToken);
        const targetFile = projectFiles.find((f: any) => f.name === (parsedPath.filename || parsedPath.directory));
        
        if (targetFile) {
          files.push({
            name: targetFile.name,
            type: targetFile.type || 'SERVER_JS',
            source: targetFile.source || '',
            size: (targetFile.source || '').length
          });
        }
      } catch (error) {
        // Skip invalid file references
        console.error(`Failed to load file ${fileName}:`, error);
      }
    }

    return files;
  }

  /**
   * Extract project ID from parameters
   */
  private extractProjectId(params: any): string | undefined {
    if (params.files && params.files.length > 0) {
      const parsedPath = parsePath(params.files[0]);
      return parsedPath.projectId || undefined;
    }

    if (params.path) {
      const parsedPath = parsePath(params.path);
      return parsedPath.projectId || undefined;
    }

    return undefined;
  }
} 