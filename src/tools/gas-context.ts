/**
 * Context-aware search tool for intelligent code discovery
 * Provides semantic search with relevance scoring and token optimization
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { GrepSearchEngine, ContextSearchOptions, ContextAwareFileResult } from '../utils/grepEngine.js';
import { COMMON_TOOL_SCHEMAS } from '../utils/schemaPatterns.js';
import { GASErrorHandler } from '../utils/errorHandler.js';

export class GasContextTool extends BaseTool {
  private gasClient: GASClient;

  public name = 'gas_context';
  public description = 'Intelligent context-aware search with semantic expansion and relevance scoring. Finds related code using natural language queries with token-efficient results.';

  constructor(authManager?: any) {
    super(authManager);
    this.gasClient = new GASClient();
  }

  public inputSchema = COMMON_TOOL_SCHEMAS.contextOperation({
    path: {
      type: 'string',
      description: 'Optional path pattern to limit search scope. Supports wildcards (* and ?) and pseudo-directory filtering.',
      examples: ['', 'utils/*', '*test*', 'api/*.js'],
      default: ''
    },
    includeFileTypes: {
      type: 'array',
      items: { 
        type: 'string',
        enum: ['SERVER_JS', 'HTML', 'JSON'] 
      },
      description: 'Filter by Google Apps Script file types (optional)',
      examples: [['SERVER_JS'], ['SERVER_JS', 'HTML']]
    },
    excludeFiles: {
      type: 'array',
      items: { type: 'string' },
      description: 'File patterns to exclude from search (supports wildcards)',
      examples: [['*/test/*', '*/mock*'], ['*Backup*', '*Old*']]
    },
    maxResults: {
      type: 'number',
      description: 'Maximum number of files to return (default: 10)',
      minimum: 1,
      maximum: 50,
      default: 10
    },
    contextLines: {
      type: 'number',
      description: 'Lines of context around matches (default: 2)',
      minimum: 0,
      maximum: 10,
      default: 2
    },
    workingDir: {
      type: 'string',
      description: 'Working directory (defaults to current directory)'
    }
  });

  async execute(params: any): Promise<any> {
    try {
      // Validate parameters
      const validatedParams = this.validateParams(params);
      
      // Get authentication
      const accessToken = await this.getAuthToken(params);
      
      // Get files from the project
      const projectFiles = await this.gasClient.getProjectContent(validatedParams.scriptId, accessToken);
      if (!projectFiles || projectFiles.length === 0) {
        throw new Error('No files found in project');
      }

      // Prepare search options
      const searchOptions: ContextSearchOptions = {
        contextMode: validatedParams.contextMode || 'enhanced',
        tokenBudget: validatedParams.tokenBudget || 8000,
        semanticExpansion: true,
        maxFilesSearched: 100,
        maxResults: validatedParams.maxResults || 10,
        contextLines: validatedParams.contextLines || 2,
        includeFileTypes: validatedParams.includeFileTypes,
        excludeFiles: validatedParams.excludeFiles,
        searchMode: 'auto',
        caseSensitive: false,
        showLineNumbers: true,
        showFileHeaders: true
      };

      // Initialize search engine and perform context-aware search
      const searchEngine = new GrepSearchEngine();
      const searchResult = await searchEngine.searchWithContext(
        projectFiles,
        validatedParams.query,
        searchOptions,
        validatedParams.scriptId
      );

      // Apply path filtering if specified
      let filteredResults = searchResult.results;
      if (validatedParams.path) {
        filteredResults = filteredResults.filter(result => 
          this.matchesPathPattern(result.fileName, validatedParams.path)
        );
      }

      // Limit results
      const maxResults = validatedParams.maxResults || 10;
      filteredResults = filteredResults.slice(0, maxResults);

      // Format response
      return this.formatContextResults(
        filteredResults,
        searchResult.expandedTerms,
        validatedParams.query,
        {
          totalTokens: searchResult.totalTokens,
          searchTime: searchResult.searchTime,
          totalFiles: projectFiles.length,
          filteredFiles: filteredResults.length,
          tokenBudget: validatedParams.tokenBudget || 8000,
          contextMode: validatedParams.contextMode || 'enhanced'
        }
      );

    } catch (error) {
      throw GASErrorHandler.handleApiError(error, {
        operation: 'context-aware search',
        scriptId: params.scriptId,
        tool: 'gas_context'
      });
    }
  }

  private validateParams(params: any) {
    const scriptId = this.validate.scriptId(params.scriptId, 'context search');
    
    // Validate query manually since there's no nonEmptyString method
    if (!params.query || typeof params.query !== 'string' || params.query.trim().length === 0) {
      throw new Error('Query parameter is required and must be a non-empty string');
    }
    const query = params.query.trim();
    
    return {
      scriptId,
      query,
      path: params.path || '',
      contentMode: params.contentMode || 'summary',
      contextMode: params.contextMode || 'enhanced', 
      tokenBudget: params.tokenBudget || 8000,
      maxResults: Math.min(params.maxResults || 10, 50),
      contextLines: Math.min(params.contextLines || 2, 10),
      includeFileTypes: params.includeFileTypes,
      excludeFiles: params.excludeFiles
    };
  }

  private matchesPathPattern(filename: string, pathPattern: string): boolean {
    if (!pathPattern) return true;
    
    // Simple wildcard matching
    const pattern = pathPattern.replace(/\*/g, '.*').replace(/\?/g, '.');
    const regex = new RegExp(`^${pattern}$`, 'i');
    return regex.test(filename);
  }

  private formatContextResults(
    results: ContextAwareFileResult[],
    expandedTerms: string[],
    originalQuery: string,
    metadata: {
      totalTokens: number;
      searchTime: number;
      totalFiles: number;
      filteredFiles: number;
      tokenBudget: number;
      contextMode: string;
    }
  ) {
    const response: any = {
      status: 'success',
      searchQuery: originalQuery,
      expandedTerms: expandedTerms,
      contextMode: metadata.contextMode,
      performance: {
        searchTime: `${metadata.searchTime}ms`,
        totalTokens: metadata.totalTokens,
        tokenBudget: metadata.tokenBudget,
        compressionRatio: metadata.tokenBudget > 0 ? 
          Math.round((metadata.totalTokens / metadata.tokenBudget) * 100) / 100 : 1,
        filesProcessed: metadata.filteredFiles,
        totalAvailable: metadata.totalFiles
      },
      results: []
    };

    // Format each file result
    for (const fileResult of results) {
      const formattedResult: any = {
        fileName: fileResult.fileName,
        fileType: fileResult.fileType,
        relevanceScore: {
          total: fileResult.relevanceScore.total,
          breakdown: {
            filename: Math.round(fileResult.relevanceScore.filename * 100) / 100,
            density: Math.round(fileResult.relevanceScore.density * 100) / 100,
            coverage: Math.round(fileResult.relevanceScore.coverage * 100) / 100,
            characteristics: Math.round(fileResult.relevanceScore.characteristics * 100) / 100
          }
        },
        semanticMatches: fileResult.semanticMatches,
        totalMatches: fileResult.totalMatches,
        tokenEstimate: fileResult.tokenEstimate,
        matches: []
      };

      // Format matches with context
      for (const match of fileResult.matches) {
        const formattedMatch: any = {
          lineNumber: match.lineNumber,
          line: match.line.trim(),
          matchText: match.matchText
        };

        // Add context if available
        if (match.context) {
          formattedMatch.context = {
            before: match.context.before.map(line => line.trim()),
            after: match.context.after.map(line => line.trim())
          };
        }

        formattedResult.matches.push(formattedMatch);
      }

      response.results.push(formattedResult);
    }

    // Add summary if no results
    if (results.length === 0) {
      response.message = `No matches found for query "${originalQuery}". Expanded search terms: ${expandedTerms.join(', ')}`;
      response.suggestions = [
        'Try broader search terms',
        'Check file type filters',
        'Verify path patterns',
        'Consider using different context mode'
      ];
    } else {
      response.summary = `Found ${results.length} relevant files with ${results.reduce((sum, r) => sum + r.totalMatches, 0)} total matches`;
    }

    return response;
  }
}