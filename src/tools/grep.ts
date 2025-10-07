/**
 * grep and raw_grep - Search file contents with pattern matching
 * 
 * grep: Search clean user code (unwrapped from CommonJS wrappers)
 * raw_grep: Search raw file content (including CommonJS wrappers and system code)
 * 
 * Server-side grep to minimize token usage while providing powerful search capabilities
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { parsePath, isWildcardPattern, matchesPattern, resolveHybridScriptId } from '../api/pathParser.js';
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
import { 
  translatePathForOperation,
  gasNameToVirtual
} from '../utils/virtualFileTranslation.js';

/**
 * grep - Search clean user code (unwrapped from CommonJS)
 * Shows search results from the actual code developers write and edit
 * 
 * Currently makes direct API calls like raw_grep, but designed to potentially
 * support local file access in the future (following cat vs raw_cat pattern)
 */
export class GrepTool extends BaseTool {
  public name = 'grep';
  public description = 'Search file contents in Google Apps Script project. Like Unix grep but works with GAS projects and automatically unwraps CommonJS modules to show clean user code for editing. Powerful pattern matching with context control.';
  
  public inputSchema = {
    type: 'object',
    llmGuidance: {
      alternatives: 'Use raw_grep when you need explicit project ID control or want to search system-generated content',
      commonJsIntegration: 'All SERVER_JS files are automatically integrated with the CommonJS module system (see CommonJS.js). When searching files, the outer _main() wrapper is removed to show clean user code searches. The code still has access to require(), module, and exports when executed - these are provided by the CommonJS system.',
      editingWorkflow: 'Search results show unwrapped code for easy reading. The same unwrapped content is what cat shows for editing.',
      moduleAccess: 'Your search will find require("ModuleName") calls, module.exports = {...} assignments, and exports.func = ... usage in clean user code without system wrapper noise.',
      whenToUse: 'Use for normal code searches. Automatically handles CommonJS unwrapping for cleaner results.',
      workflow: 'Searches through the clean user code that developers actually write and edit',
      contentComparison: 'grep searches the same content that cat shows (unwrapped user code), while raw_grep searches the same content that raw_cat shows (full file including CommonJS wrappers)',
      currentBehavior: 'Currently makes direct API calls like raw_grep, but may support local file access in the future'
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
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID',
        pattern: '^[a-zA-Z0-9_-]{25,60}$',
        minLength: 25,
        maxLength: 60,
        examples: [
          '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
          '1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ'
        ]
      },
      path: {
        type: 'string',
        description: 'File or path pattern with wildcard/regex support (filename only, or scriptId/path if scriptId parameter is empty). Searches clean user code in matching files (same content processing as gas_cat). Examples: "" (entire project), "utils/*" (wildcard), ".*Controller.*" (regex).',
        default: '',
        examples: [
          '',                            // Search entire project (user code only)
          'ai_tools/*',                  // Wildcard: ai_tools directory (user code only)  
          '*Connector*',                 // Wildcard: files containing Connector (user code only)
          '.*Controller.*',              // Regex: files containing Controller (user code only)
          '(utils|helpers)/.*',          // Regex: utils OR helpers directories (user code only)
          '.*\\.(test|spec)$',          // Regex: test files ending in .test or .spec (user code only)
          'test/*/*.test'                // Wildcard: test files in subdirectories (user code only)
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
          ['scriptId/utils/helpers', 'scriptId/models/User'],
          ['scriptId/ai_tools/BaseConnector', 'scriptId/ai_tools/ClaudeConnector']
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
          ['scriptId/dist/*', 'scriptId/node_modules/*']
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
    required: ['scriptId', 'pattern']
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

    // Apply virtual file translation for path if provided
    const translatedPath = params.path ? translatePathForOperation(params.path, true) : params.path;

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
    if (translatedPath) {
      const pathValidation = validatePathPattern(translatedPath, searchOptions.pathMode!);
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
    const results = await this.grepEngine.searchFiles(files, searchOptions, this.extractScriptId(params));

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
        const { unwrappedContent } = unwrapModuleContent(processedContent);
        if (unwrappedContent !== processedContent) {
          processedContent = unwrappedContent;
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
   * Get target files for search (shared by gas_grep and gas_raw_grep patterns)
   */
  private async getTargetFiles(params: any, accessToken?: string): Promise<GASFile[]> {
    // If specific files provided, get those (apply translation to each file)
    if (params.files && Array.isArray(params.files) && params.files.length > 0) {
      const translatedFiles = params.files
        .filter((f: any) => f && typeof f === 'string')
        .map((f: string) => translatePathForOperation(f, true));
      if (translatedFiles.length > 0) {
        return await this.getSpecificFiles(translatedFiles, accessToken);
      }
    }

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

    // Apply path filtering if search path is provided
    if (searchPath && searchPath.trim() !== '') {
      const pathMode = params.pathMode || 'auto';
      
      // Use new regex/wildcard path matching
      return gasFiles.filter(file => 
        matchesPathPattern(file.name, searchPath, pathMode, scriptId)
      );
    }

    // Return all files if no path filter
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
        if (!parsedPath.scriptId) continue;

        const projectFiles = await this.gasClient.getProjectContent(parsedPath.scriptId, accessToken);
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
   * Extract script ID from parameters
   */
  private extractScriptId(params: any): string | undefined {
    // Prioritize explicit scriptId parameter
    if (params.scriptId && params.scriptId.trim()) {
      return params.scriptId;
    }

    if (params.files && params.files.length > 0) {
      const parsedPath = parsePath(params.files[0]);
      return parsedPath.scriptId || undefined;
    }

    if (params.path) {
      const parsedPath = parsePath(params.path);
      return parsedPath.scriptId || undefined;
    }

    return undefined;
  }
}

/**
 * raw_grep - Search raw file content (including CommonJS wrappers)
 * 
 * ⚠️ ADVANCED TOOL - Always makes direct API calls, never uses local files
 * This tool requires explicit project IDs and makes direct API access only
 * Use grep for normal development workflow with potential local file support
 */
export class RawGrepTool extends BaseTool {
  public name = 'raw_grep';
  public description = 'Search file contents with explicit project ID control and full content including CommonJS wrappers. Like Unix grep but operates on raw Google Apps Script file content. Always makes direct API calls.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Search pattern (supports regex and literal text). Searches complete file content (same content as raw_cat shows) including CommonJS wrappers via direct API calls only. Examples: "_main\\\\s*\\\\(" finds CommonJS wrappers, "__defineModule__" finds system calls',
        minLength: 1,
        examples: [
          'require\\\\(',                      // Find require calls in full content
          'function\\\\s+(\\\\w+)',            // Find all function definitions including wrappers
          '_main\\\\s*\\\\(',                 // Find CommonJS main wrapper functions
          '__defineModule__',                  // Find CommonJS system module definition calls
          'globalThis\\.__getCurrentModule',   // Find module system calls
          'module\\s*=\\s*globalThis',        // Find module assignments
          'exports\\s*=\\s*module\\.exports', // Find exports assignments
          'TODO:|FIXME:',                      // Find todo items in full context
          'console\\\\.log',                   // Find console.log in all content
          'Logger\\\\.log',                    // Find Logger.log in all content
        ]
      },
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID',
        pattern: '^[a-zA-Z0-9_-]{25,60}$',
        minLength: 25,
        maxLength: 60,
        examples: [
          '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
          '1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ'
        ]
      },
      path: {
        type: 'string',
        description: 'File or path pattern with wildcard/regex support (filename only, or scriptId/path if scriptId parameter is empty). Always retrieves content via direct API calls, never uses local cached files. Same content processing as raw_cat.',
        default: '',
        examples: [
          '',                            // Search entire project (includes CommonJS wrappers)
          'ai_tools/*',                  // Wildcard: ai_tools directory (full content)
          '*Connector*',                 // Wildcard: files containing Connector (full content)
          '.*Controller.*',              // Regex: files containing Controller (full content)
          '(utils|helpers)/.*',          // Regex: utils OR helpers directories (full content)
          '.*\\.(test|spec)$',          // Regex: test files ending in .test or .spec (full content)
          'test/*/*.test'                // Wildcard: test files in subdirectories (full content)
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
        description: 'Specific file list to search with explicit project IDs (alternative to path parameter). Always retrieved via direct API calls.',
        examples: [
          ['abc123def456.../utils/helpers', 'abc123def456.../models/User'],
          ['abc123def456.../ai_tools/BaseConnector', 'abc123def456.../ai_tools/ClaudeConnector']
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
          ['abc123def456.../dist/*', 'abc123def456.../node_modules/*']
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
    required: ['scriptId', 'pattern']
  };

  private gasClient: GASClient;
  private grepEngine: GrepSearchEngine;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
    this.grepEngine = new GrepSearchEngine();
  }

  async execute(params: any): Promise<any> {
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

    // ⚠️ CRITICAL: Always authenticate before making API calls
    const accessToken = await this.getAuthToken(params);

    // 🔧 ADVANCED: Get target files via direct API calls only (never uses local files)
    const files = await this.getTargetFilesViaAPI(params, accessToken);
    
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
        contentType: 'raw-content (includes CommonJS wrappers)',
        dataSource: 'direct-api-call'
      };
    }

    // Execute search
    const results = await this.grepEngine.searchFiles(files, searchOptions, this.extractScriptId(params));

    // Add metadata about content processing and data source
    (results as any).contentType = 'raw-content (includes CommonJS wrappers)';
    (results as any).dataSource = 'direct-api-call';
    (results as any).note = 'Search performed on complete file content including CommonJS wrappers and system code retrieved via direct API calls. Use gas_grep to search only user code.';

    // Add formatted output for different display modes
    if (searchOptions.compact) {
      (results as any).formattedOutput = this.grepEngine.formatCompactResults(results);
    } else {
      (results as any).formattedOutput = this.grepEngine.formatDetailedResults(results);
    }

    return results;
  }

  /**
   * Get target files via direct API calls (used by gas_raw_grep for consistency)
   */
  private async getTargetFilesViaAPI(params: any, accessToken: string): Promise<GASFile[]> {
    // If specific files provided, get those via API
    if (params.files && Array.isArray(params.files) && params.files.length > 0) {
      return await this.getSpecificFilesViaAPI(params.files, accessToken);
    }

    // Use hybrid script ID resolution
    const hybridResolution = resolveHybridScriptId(params.scriptId, params.path || '');
    const scriptId = hybridResolution.scriptId;
    const searchPath = hybridResolution.cleanPath;

    // 🔧 DIRECT API CALL: Get all files from project (never uses local cache)
    console.error(`🔧 [GAS_RAW_GREP] Making direct API call to retrieve project content: ${scriptId}`);
    const allFiles = await this.gasClient.getProjectContent(scriptId, accessToken);

    // Convert to GASFile format
    const gasFiles: GASFile[] = allFiles.map((file: any) => ({
      name: file.name,
      type: file.type || 'SERVER_JS',
      source: file.source || '',
      size: (file.source || '').length
    }));

    // Apply path filtering if search path is provided
    if (searchPath && searchPath.trim() !== '') {
      const pathMode = params.pathMode || 'auto';
      
      return gasFiles.filter(file => 
        matchesPathPattern(file.name, searchPath, pathMode, scriptId)
      );
    }

    // Return all files if no path filter
    return gasFiles;
  }

  /**
   * Get specific files by name via direct API calls only
   */
  private async getSpecificFilesViaAPI(fileNames: string[], accessToken: string): Promise<GASFile[]> {
    const files: GASFile[] = [];

    for (const fileName of fileNames) {
      try {
        const parsedPath = parsePath(fileName);
        if (!parsedPath.scriptId) {
          console.error(`⚠️ [GAS_RAW_GREP] Skipping file without explicit script ID: ${fileName}`);
          continue;
        }

        // 🔧 DIRECT API CALL: Get project files (never uses local cache)
        console.error(`🔧 [GAS_RAW_GREP] Making direct API call for file: ${fileName}`);
        const projectFiles = await this.gasClient.getProjectContent(parsedPath.scriptId, accessToken);
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
        // Skip invalid file references but log for debugging
        console.error(`⚠️ [GAS_RAW_GREP] Failed to load file via API ${fileName}:`, error);
      }
    }

    return files;
  }

  /**
   * Extract script ID from parameters
   */
  private extractScriptId(params: any): string | undefined {
    // Prioritize explicit scriptId parameter
    if (params.scriptId && params.scriptId.trim()) {
      return params.scriptId;
    }

    if (params.files && params.files.length > 0) {
      const parsedPath = parsePath(params.files[0]);
      return parsedPath.scriptId || undefined;
    }

    if (params.path) {
      const parsedPath = parsePath(params.path);
      return parsedPath.scriptId || undefined;
    }

    return undefined;
  }
} 