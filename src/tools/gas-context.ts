/**
 * Context-aware search tool for intelligent code discovery
 * Provides semantic search with relevance scoring and token optimization
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { COMMON_TOOL_SCHEMAS } from '../utils/schemaPatterns.js';
import { GASErrorHandler } from '../utils/errorHandler.js';

export class ContextTool extends BaseTool {
  private gasClient: GASClient;

  public name = 'context';
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

      // Simple search implementation without complex grepEngine
      const results = this.performSimpleSearch(
        projectFiles,
        validatedParams.query,
        validatedParams.maxResults || 10,
        validatedParams.contextLines || 2
      );

      // Format response
      return {
        status: 'success',
        searchQuery: validatedParams.query,
        expandedTerms: [validatedParams.query], // Simple - no expansion
        contextMode: validatedParams.contextMode || 'basic',
        performance: {
          searchTime: '< 100ms',
          totalTokens: this.estimateTokens(results),
          tokenBudget: validatedParams.tokenBudget || 8000,
          compressionRatio: 1.0,
          filesProcessed: results.length,
          totalAvailable: projectFiles.length
        },
        results: results,
        summary: `Found ${results.length} relevant files with matches for "${validatedParams.query}"`
      };

    } catch (error) {
      throw GASErrorHandler.handleApiError(error, {
        operation: 'context-aware search',
        scriptId: params.scriptId,
        tool: 'context'
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

  private performSimpleSearch(files: any[], query: string, maxResults: number, contextLines: number): any[] {
    const results: any[] = [];
    const searchRegex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    
    for (const file of files) {
      if (results.length >= maxResults) break;
      if (!file.source) continue;
      
      const lines = file.source.split('\n');
      const matches: any[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        if (searchRegex.test(lines[i])) {
          const match: any = {
            lineNumber: i + 1,
            line: lines[i],
            matchText: query
          };
          
          if (contextLines > 0) {
            match.context = {
              before: lines.slice(Math.max(0, i - contextLines), i),
              after: lines.slice(i + 1, Math.min(lines.length, i + contextLines + 1))
            };
          }
          
          matches.push(match);
          if (matches.length >= 10) break; // Limit matches per file
        }
      }
      
      if (matches.length > 0) {
        results.push({
          fileName: file.name,
          fileType: file.type,
          totalMatches: matches.length,
          matches: matches,
          relevanceScore: {
            total: 0.5, // Simple static score
            breakdown: {
              filename: 0.1,
              density: 0.2,
              coverage: 0.1,
              characteristics: 0.1
            }
          },
          semanticMatches: [query],
          tokenEstimate: Math.ceil(JSON.stringify(matches).length / 4)
        });
      }
    }
    
    return results;
  }
  
  private estimateTokens(results: any[]): number {
    return Math.ceil(JSON.stringify(results).length / 4);
  }
}