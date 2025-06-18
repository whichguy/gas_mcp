import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { parsePath } from '../api/pathParser.js';
import { ValidationError, FileOperationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';

/**
 * Create logical file organization in Google Apps Script project
 * Note: Google Apps Script has no real folders - this creates filename prefixes for organization
 */
export class GASMkdirTool extends BaseTool {
  public name = 'gas_mkdir';
  public description = 'Create logical file organization in a Google Apps Script project using filename prefixes (no real folders exist in GAS)';
  
  public inputSchema = {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Google Apps Script project ID'
      },
      directoryPath: {
        type: 'string',
        description: 'Logical prefix to use for organization (e.g., "utils", "lib/helpers") - becomes part of filename'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['projectId', 'directoryPath']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const projectId = this.validate.scriptId(params.projectId, 'project operation');
    const directoryPath = this.validate.string(params.directoryPath, 'directoryPath', 'project operation');

    // Validate directory path format
    if (directoryPath.includes('..') || directoryPath.startsWith('/')) {
      throw new ValidationError('directoryPath', directoryPath, 'valid relative path prefix');
    }

    // Create placeholder file to establish logical organization
    // Note: This creates a filename with the prefix, not an actual folder
    const placeholderFile = `${directoryPath}/.gitkeep`;
    const placeholderContent = `# Placeholder file for logical organization: ${directoryPath}\n# Note: Google Apps Script has no real folders - this is just a filename with prefix "${directoryPath}/"`;

    const updatedFiles = await this.gasClient.updateFile(projectId, placeholderFile, placeholderContent, undefined, accessToken);

    return {
      status: 'created',
      directoryPath,
      projectId,
      placeholderFile,
      totalFiles: updatedFiles.length,
      message: `Created logical organization prefix: ${directoryPath} (no real folder created - this is a filename prefix)`
    };
  }
}

/**
 * Get project information and structure overview
 */
export class GASInfoTool extends BaseTool {
  public name = 'gas_info';
  public description = 'Get detailed information about a Google Apps Script project';
  
  public inputSchema = {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Google Apps Script project ID'
      },
      includeContent: {
        type: 'boolean',
        default: false,
        description: 'Include file content in the output (warning: can be large)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['projectId']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const projectId = this.validate.scriptId(params.projectId, 'project operation');
    const includeContent = this.validate.boolean(params.includeContent || false, 'includeContent', 'project operation');

    // Get project metadata and files
    const files = await this.gasClient.getProjectContent(projectId, accessToken);
    
    // Analyze project structure
    const filesByType = files.reduce((acc: any, file: any) => {
      const type = file.type || 'unknown';
      if (!acc[type]) acc[type] = 0;
      acc[type]++;
      return acc;
    }, {});

    // Calculate total size
    const totalSize = files.reduce((sum: number, file: any) => 
      sum + (file.source?.length || 0), 0);

    // Group files by logical prefix (no real folders exist in GAS)
    const prefixGroups = files.reduce((acc: any, file: any) => {
      const parts = file.name.split('/');
      if (parts.length > 1) {
        const prefix = parts.slice(0, -1).join('/');
        if (!acc[prefix]) acc[prefix] = [];
        acc[prefix].push(file.name);
      } else {
        if (!acc['root']) acc['root'] = [];
        acc['root'].push(file.name);
      }
      return acc;
    }, {});

    const result: any = {
      projectId,
      totalFiles: files.length,
      totalSize,
      filesByType,
      prefixGroups,
      structure: Object.keys(prefixGroups).sort()
    };

    if (includeContent) {
      result.files = files.map((file: any) => ({
        name: file.name,
        type: file.type,
        size: file.source?.length || 0,
        content: file.source || ''
      }));
    } else {
      result.files = files.map((file: any) => ({
        name: file.name,
        type: file.type,
        size: file.source?.length || 0
      }));
    }

    return result;
  }
}

/**
 * Reorder files in a Google Apps Script project
 */
export class GASReorderTool extends BaseTool {
  public name = 'gas_reorder';
  public description = 'Change the execution order of files in a Google Apps Script project';
  
  public inputSchema = {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Google Apps Script project ID'
      },
      fileName: {
        type: 'string',
        description: 'Name of the file to reorder'
      },
      newPosition: {
        type: 'number',
        description: 'New position in the execution order (0-based)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['projectId', 'fileName', 'newPosition']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const projectId = this.validate.scriptId(params.projectId, 'project operation');
    const fileName = this.validate.string(params.fileName, 'fileName', 'project operation');
    const newPosition = this.validate.number(params.newPosition, 'newPosition', 'project operation', 0);

    // Get current files
    const files = await this.gasClient.getProjectContent(projectId, accessToken);
    
    // Find the target file
    const targetFile = files.find((f: any) => f.name === fileName);
    if (!targetFile) {
      throw new FileOperationError('reorder', fileName, 'file not found');
    }

    // Validate new position
    if (newPosition >= files.length) {
      throw new ValidationError('newPosition', newPosition, `position between 0 and ${files.length - 1}`);
    }

    // Create new file order
    const reorderedFiles = [...files];
    const currentIndex = reorderedFiles.findIndex((f: any) => f.name === fileName);
    
    // Remove file from current position
    const [movedFile] = reorderedFiles.splice(currentIndex, 1);
    
    // Insert at new position
    reorderedFiles.splice(newPosition, 0, movedFile);

    // Update the project with new file order
    await this.gasClient.updateProjectContent(projectId, reorderedFiles, accessToken);

    return {
      status: 'reordered',
      projectId,
      fileName,
      oldPosition: currentIndex,
      newPosition,
      totalFiles: files.length,
      message: `Moved ${fileName} from position ${currentIndex} to ${newPosition}`
    };
  }
}

/**
 * Get metrics data for scripts, such as number of executions and active users
 */
export class GASProjectMetricsTool extends BaseTool {
  public name = 'gas_project_metrics';
  public description = 'Get metrics data for scripts, such as number of executions and active users. LLM USE: Analyze script performance and usage patterns.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
                  description: 'Google Apps Script project ID. LLM REQUIREMENT: Must be a valid 44-character Google Drive file ID for an Apps Script project.',
        pattern: '^[a-zA-Z0-9_-]{44}$',
        minLength: 44,
        maxLength: 44,
        llmHints: {
          obtain: 'Use gas_project_create to create new project, or gas_ls to list existing projects',
          format: '44-character Google Drive file ID, looks like: 1jK_ujSHRCsEeBizi6xycuj_0y5qDqvMzLJHBE9HLUiM5Jm'
        }
      },
      metricsFilter: {
        type: 'object',
        description: 'Optional field containing filters to apply to the request. This limits the scope of the metrics returned to those specified in the filter.',
        properties: {
          deploymentId: {
            type: 'string',
            description: 'Optional field indicating a specific deployment to retrieve metrics from.'
          }
        },
        llmHints: {
          deployment: 'Use deploymentId to analyze specific deployment performance',
          overall: 'Omit filter to get overall project metrics across all deployments'
        }
      },
      metricsGranularity: {
        type: 'string',
        enum: ['UNSPECIFIED_GRANULARITY', 'WEEKLY', 'DAILY'],
        description: 'Required field indicating what granularity of metrics are returned (default: WEEKLY). LLM RECOMMENDATION: Use DAILY for detailed analysis, WEEKLY for trends.',
        default: 'WEEKLY',
        llmHints: {
          trends: 'Use WEEKLY for long-term trend analysis',
          detailed: 'Use DAILY for detailed performance analysis over 7 days',
          performance: 'WEEKLY provides better performance for large datasets',
          unspecified: 'UNSPECIFIED_GRANULARITY is default but returns no metrics'
        }
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional). LLM TYPICAL: Omit - tool uses session authentication.',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$',
        llmHints: {
          typical: 'Usually omitted - tool uses session authentication from gas_auth',
          stateless: 'Include when doing token-based operations without session storage'
        }
      }
    },
    required: ['scriptId'],
    additionalProperties: false,
    llmWorkflowGuide: {
      prerequisites: [
        '1. Authentication: gas_auth({mode: "status"}) → gas_auth({mode: "start"}) if needed',
        '2. Have valid scriptId from gas_project_create or gas_ls',
        '3. Project must have had some execution history'
      ],
      useCases: {
        performance: 'gas_project_metrics({scriptId: "...", metricsGranularity: "DAILY"}) - Detailed performance analysis',
        trends: 'gas_project_metrics({scriptId: "...", metricsGranularity: "WEEKLY"}) - Long-term usage trends',
        deployment: 'gas_project_metrics({scriptId: "...", metricsFilter: {deploymentId: "..."}}) - Specific deployment metrics'
      },
      errorHandling: {
        'AuthenticationError': 'Run gas_auth({mode: "start"}) to authenticate first',
        'ScriptNotFound': 'Verify scriptId is correct and accessible',
        'NoMetricsData': 'Project may not have sufficient execution history for metrics'
      },
      returnValue: {
        activeUsers: 'Array of MetricsValue objects showing number of active users over time periods',
        totalExecutions: 'Array of MetricsValue objects showing total execution counts over time periods',
        failedExecutions: 'Array of MetricsValue objects showing failed execution counts over time periods',
        metricsGranularity: 'The granularity level used for the metrics (WEEKLY or DAILY)',
        scriptId: 'The script ID these metrics apply to'
      }
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const scriptId = this.validate.scriptId(params.scriptId, 'project metrics');
    const metricsFilter = params.metricsFilter || undefined;
    const metricsGranularity = params.metricsGranularity ? 
      this.validate.enum(params.metricsGranularity, 'metricsGranularity', ['UNSPECIFIED_GRANULARITY', 'WEEKLY', 'DAILY'], 'project metrics') : 
      'WEEKLY';

    return await this.handleApiCall(
      () => this.gasClient.getProjectMetrics(scriptId, metricsGranularity, metricsFilter, accessToken),
      'get project metrics',
      { scriptId, metricsGranularity, metricsFilter }
    );
  }
} 