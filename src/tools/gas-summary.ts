/**
 * Content summarization tool for intelligent code analysis
 * Provides rule-based content summarization with multiple modes and token optimization
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ContentSummarizer, SummaryOptions } from '../utils/contentSummarizer.js';
import { COMMON_TOOL_SCHEMAS, CONTENT_MODE_SCHEMA } from '../utils/schemaPatterns.js';
import { GASErrorHandler } from '../utils/errorHandler.js';

export class GasSummaryTool extends BaseTool {
  private gasClient: GASClient;

  public name = 'gas_summary';
  public description = 'Intelligent content summarization with multiple analysis modes. Efficiently summarizes code files using rule-based analysis for signatures, exports, structure, or full content with token optimization.';

  constructor(authManager?: any) {
    super(authManager);
    this.gasClient = new GASClient();
  }

  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID',
        pattern: '^[a-zA-Z0-9_-]{25,60}$',
        minLength: 25,
        maxLength: 60
      },
      path: {
        type: 'string',
        description: 'Optional path pattern to filter files. Supports wildcards (* and ?) for pattern matching.',
        examples: ['', '*.js', 'utils/*', '*test*', 'api/*.gs'],
        default: ''
      },
      contentMode: CONTENT_MODE_SCHEMA,
      tokenBudget: {
        type: 'number',
        description: 'Maximum tokens for response content (default: 8000). LLM USE: Adjust based on context window size.',
        minimum: 1000,
        maximum: 50000,
        default: 8000
      },
      maxFiles: {
        type: 'number',
        description: 'Maximum number of files to process (default: 20)',
        minimum: 1,
        maximum: 100,
        default: 20
      },
      includeMetadata: {
        type: 'boolean',
        description: 'Include detailed metadata (functions, exports, imports, classes)',
        default: true
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
        description: 'File patterns to exclude from summarization (supports wildcards)',
        examples: [['*/test/*', '*/mock*'], ['*Backup*', '*Old*']]
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$'
      }
    },
    required: ['scriptId'],
    additionalProperties: false
  };

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

      // Filter files based on criteria
      let filteredFiles = projectFiles;
      
      // Filter by path pattern if specified
      if (validatedParams.path) {
        filteredFiles = filteredFiles.filter(file => 
          this.matchesPathPattern(file.name, validatedParams.path)
        );
      }

      // Filter by file types
      if (validatedParams.includeFileTypes && validatedParams.includeFileTypes.length > 0) {
        filteredFiles = filteredFiles.filter(file => 
          validatedParams.includeFileTypes.includes(file.type)
        );
      }

      // Exclude files
      if (validatedParams.excludeFiles && validatedParams.excludeFiles.length > 0) {
        filteredFiles = filteredFiles.filter(file => {
          return !validatedParams.excludeFiles.some((excludePattern: string) => {
            return this.matchesPathPattern(file.name, excludePattern);
          });
        });
      }

      // Limit number of files
      const maxFiles = validatedParams.maxFiles || 20;
      if (filteredFiles.length > maxFiles) {
        filteredFiles = filteredFiles.slice(0, maxFiles);
      }

      // Prepare summary options
      const summaryOptions: SummaryOptions = {
        mode: validatedParams.contentMode || 'summary',
        tokenBudget: Math.floor((validatedParams.tokenBudget || 8000) / filteredFiles.length),
        includeMetadata: validatedParams.includeMetadata !== false
      };

      // Perform batch summarization
      const summaries = ContentSummarizer.batchSummarize(
        filteredFiles,
        summaryOptions,
        validatedParams.tokenBudget
      );

      // Format and return results
      return this.formatSummaryResults(
        summaries,
        {
          originalFileCount: projectFiles.length,
          filteredFileCount: filteredFiles.length,
          summaryMode: validatedParams.contentMode || 'summary',
          tokenBudget: validatedParams.tokenBudget || 8000,
          totalTokensUsed: Array.from(summaries.values()).reduce((sum, s) => sum + s.tokenEstimate, 0)
        }
      );

    } catch (error) {
      throw GASErrorHandler.handleApiError(error, {
        operation: 'content summarization',
        scriptId: params.scriptId,
        tool: 'gas_summary'
      });
    }
  }

  private validateParams(params: any) {
    const scriptId = this.validate.scriptId(params.scriptId, 'content summarization');
    
    return {
      scriptId,
      path: params.path || '',
      contentMode: params.contentMode || 'summary',
      tokenBudget: Math.min(Math.max(params.tokenBudget || 8000, 1000), 50000),
      maxFiles: Math.min(Math.max(params.maxFiles || 20, 1), 100),
      includeMetadata: params.includeMetadata !== false,
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

  private formatSummaryResults(
    summaries: Map<string, any>,
    metadata: {
      originalFileCount: number;
      filteredFileCount: number;
      summaryMode: string;
      tokenBudget: number;
      totalTokensUsed: number;
    }
  ) {
    const response: any = {
      status: 'success',
      summaryMode: metadata.summaryMode,
      performance: {
        filesProcessed: summaries.size,
        totalAvailable: metadata.originalFileCount,
        filteredFiles: metadata.filteredFileCount,
        tokenBudget: metadata.tokenBudget,
        tokensUsed: metadata.totalTokensUsed,
        compressionRatio: metadata.tokenBudget > 0 ? 
          Math.round((metadata.totalTokensUsed / metadata.tokenBudget) * 100) / 100 : 1
      },
      summaries: []
    };

    // Convert summaries to array format
    for (const [fileName, summary] of summaries.entries()) {
      const formattedSummary: any = {
        fileName: fileName,
        originalSize: summary.originalSize,
        summarySize: summary.summarySize,
        tokenEstimate: summary.tokenEstimate,
        compressionRatio: Math.round(summary.compressionRatio * 100) / 100,
        content: summary.content
      };

      // Include metadata if available
      if (summary.metadata) {
        formattedSummary.metadata = {
          totalLines: summary.metadata.totalLines,
          codeLines: summary.metadata.codeLines,
          commentLines: summary.metadata.commentLines,
          functions: summary.metadata.functions || [],
          exports: summary.metadata.exports || [],
          imports: summary.metadata.imports || [],
          classes: summary.metadata.classes || []
        };
      }

      response.summaries.push(formattedSummary);
    }

    // Sort by relevance (larger files first, then alphabetically)
    response.summaries.sort((a: any, b: any) => {
      if (a.originalSize !== b.originalSize) {
        return b.originalSize - a.originalSize;
      }
      return a.fileName.localeCompare(b.fileName);
    });

    // Add summary statistics
    if (response.summaries.length === 0) {
      response.message = 'No files matched the specified criteria';
      response.suggestions = [
        'Check path patterns and file type filters',
        'Verify file exclusion patterns',
        'Try broader search criteria'
      ];
    } else {
      const avgCompression = response.summaries.reduce((sum: number, s: any) => sum + s.compressionRatio, 0) / response.summaries.length;
      response.summary = {
        message: `Successfully summarized ${response.summaries.length} files`,
        averageCompression: Math.round(avgCompression * 100) / 100,
        totalOriginalChars: response.summaries.reduce((sum: number, s: any) => sum + s.originalSize, 0),
        totalSummaryChars: response.summaries.reduce((sum: number, s: any) => sum + s.summarySize, 0)
      };
    }

    return response;
  }
}