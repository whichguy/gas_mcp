/**
 * grep - Search file contents with pattern matching
 *
 * grep: Search clean user code (unwrapped from CommonJS wrappers)
 * Use raw: true parameter to search raw file content including CommonJS wrappers
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { parsePath, isWildcardPattern, matchesPattern, resolveHybridScriptId, fileNameMatches } from '../api/pathParser.js';
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
import { SchemaFragments } from '../utils/schemaFragments.js';
import { GuidanceFragments } from '../utils/guidanceFragments.js';
import { generateSearchHints, SearchHints } from '../utils/searchHints.js';
import { generateSearchHints as generateResponseSearchHints } from '../utils/responseHints.js';

/**
 * grep - Search clean user code (unwrapped from CommonJS)
 * Shows search results from the actual code developers write and edit
 * Use raw: true to search raw file content including CommonJS wrappers
 */
export class GrepTool extends BaseTool {
  public name = 'grep';
  public description = '[SEARCH] Simple single-pattern content search across project files — returns matching lines with context. WHEN: searching for a specific string or simple pattern. AVOID: use ripgrep for multi-pattern, advanced regex, or context control. Example: grep({scriptId, pattern: "processData"})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      searchPattern: { type: 'string', description: 'Pattern that was searched' },
      totalMatches: { type: 'number', description: 'Total number of matches found' },
      totalFiles: { type: 'number', description: 'Number of files with matches' },
      filesSearched: { type: 'number', description: 'Total files searched' },
      truncated: { type: 'boolean', description: 'Whether results were truncated' },
      matches: { type: 'array', description: 'Array of {file, matches: [{line, content, context}]}' }
    }
  };

  public inputSchema = {
    type: 'object',
    llmGuidance: {
      toolSelection: GuidanceFragments.searchToolHints,
      limitations: '200 result max, 500 file max | PREFER ripgrep for multi-pattern+smart case',
      antiPatterns: GuidanceFragments.searchAntiPatterns
    },
    properties: {
      pattern: {
        type: 'string',
        description: 'Search pattern (regex/literal). Searches clean user code (same as cat). "function\\\\s+(\\\\w+)" finds functions.',
        minLength: 1,
        examples: ['function\\\\s+(\\\\w+)', 'TODO:|FIXME:']
      },
      ...SchemaFragments.scriptId,
      path: {
        type: 'string',
        description: 'File/path pattern (wildcard/regex). ""=project, "utils/*"=wildcard, ".*Controller.*"=regex. Clean user code (cat content).',
        default: '',
        examples: ['ai_tools/*', '.*Controller.*']
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
        examples: [['scriptId/utils/helpers', 'scriptId/models/User']]
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
        examples: [['*/test/*', 'scriptId/dist/*']]
      },
      includeFileTypes: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['SERVER_JS', 'HTML', 'JSON']
        },
        description: 'Filter by file types (SERVER_JS, HTML, JSON)',
        examples: [['SERVER_JS']]
      },
      raw: {
        type: 'boolean',
        description: 'When true, operates on raw file content including CommonJS _main() wrappers without unwrapping. Use for searching module infrastructure. Former raw_grep behavior.',
        default: false
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'pattern']
  };

  public annotations = {
    title: 'Search Content',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
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

    // Determine target files - raw mode uses direct API calls without unwrapping
    const files = params.raw
      ? await this.getTargetFilesViaAPI(params, accessToken)
      : await this.getTargetFilesWithUnwrapping(params, accessToken);
    
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
        contentType: params.raw ? 'raw-content (includes CommonJS wrappers)' : 'user-code (CommonJS unwrapped)'
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
    if (params.raw) {
      (results as any).contentType = 'raw-content (includes CommonJS wrappers)';
      (results as any).dataSource = 'direct-api-call';
      (results as any).note = 'Search performed on complete file content including CommonJS wrappers. Use raw: false (default) to search only user code.';
    } else {
      (results as any).contentType = 'user-code (CommonJS unwrapped)';
      (results as any).note = 'Search performed on clean user code. Use raw: true to search full file content including CommonJS wrappers.';
    }

    // Add formatted output for different display modes
    if (searchOptions.compact) {
      (results as any).formattedOutput = this.grepEngine.formatCompactResults(results);
    } else {
      (results as any).formattedOutput = this.grepEngine.formatDetailedResults(results);
    }

    // Generate context-aware hints based on results
    const hints = generateSearchHints(
      results.totalMatches,
      results.filesSearched,
      params.pattern,
      results.truncated,
      results.searchTime
    );
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
   * Get target files for search (used by non-raw mode with CommonJS unwrapping)
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
        const targetFile = projectFiles.find((f: any) => fileNameMatches(f.name, parsedPath.filename || parsedPath.directory || ''));
        
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
   * Get target files via direct API calls (raw mode - no unwrapping)
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

    const allFiles = await this.gasClient.getProjectContent(scriptId, accessToken);

    const gasFiles: GASFile[] = allFiles.map((file: any) => ({
      name: file.name,
      type: file.type || 'SERVER_JS',
      source: file.source || '',
      size: (file.source || '').length
    }));

    if (searchPath && searchPath.trim() !== '') {
      const pathMode = params.pathMode || 'auto';
      return gasFiles.filter(file =>
        matchesPathPattern(file.name, searchPath, pathMode, scriptId)
      );
    }

    return gasFiles;
  }

  /**
   * Get specific files by name via direct API calls only (raw mode)
   */
  private async getSpecificFilesViaAPI(fileNames: string[], accessToken: string): Promise<GASFile[]> {
    const files: GASFile[] = [];

    for (const fileName of fileNames) {
      try {
        const parsedPath = parsePath(fileName);
        if (!parsedPath.scriptId) continue;

        const projectFiles = await this.gasClient.getProjectContent(parsedPath.scriptId, accessToken);
        const targetFile = projectFiles.find((f: any) => fileNameMatches(f.name, parsedPath.filename || parsedPath.directory || ''));

        if (targetFile) {
          files.push({
            name: targetFile.name,
            type: targetFile.type || 'SERVER_JS',
            source: targetFile.source || '',
            size: (targetFile.source || '').length
          });
        }
      } catch (error) {
        console.error(`Failed to load file via API ${fileName}:`, error);
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

