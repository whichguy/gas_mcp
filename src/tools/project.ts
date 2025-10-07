import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { parsePath } from '../api/pathParser.js';
import { ValidationError, FileOperationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';

/**
 * Create logical file organization in Google Apps Script project
 * Note: Google Apps Script has no real folders - this creates filename prefixes for organization
 */
export class MkdirTool extends BaseTool {
  public name = 'mkdir';
  public description = 'Create logical file organization in a Google Apps Script project using filename prefixes (no real folders exist in GAS)';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID (44 characters)',
        pattern: '^[a-zA-Z0-9_-]{44}$',
        minLength: 44,
        maxLength: 44
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
    required: ['scriptId', 'directoryPath']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const scriptId = this.validate.scriptId(params.scriptId, 'project operation');
    const directoryPath = this.validate.string(params.directoryPath, 'directoryPath', 'project operation');

    // Validate directory path format
    if (directoryPath.includes('..') || directoryPath.startsWith('/')) {
      throw new ValidationError('directoryPath', directoryPath, 'valid relative path prefix');
    }

    // Create placeholder file to establish logical organization
    // Note: This creates a filename with the prefix, not an actual folder
    const placeholderFile = `${directoryPath}/.gitkeep`;
    const placeholderContent = `# Placeholder file for logical organization: ${directoryPath}\n# Note: Google Apps Script has no real folders - this is just a filename with prefix "${directoryPath}/"`;

    const updatedFiles = await this.gasClient.updateFile(scriptId, placeholderFile, placeholderContent, undefined, accessToken);

    return {
      status: 'created',
      directoryPath,
      scriptId,
      placeholderFile,
      totalFiles: updatedFiles.length,
      message: `Created logical organization prefix: ${directoryPath} (no real folder created - this is a filename prefix)`
    };
  }
}

/**
 * Get project information and structure overview
 */
export class InfoTool extends BaseTool {
  public name = 'info';
  public description = 'Get detailed information about a Google Apps Script project. For container-bound scripts (attached to Google Sheets, Docs, Forms, or Sites), this tool retrieves the URL for the parent container which points to the associated Sheet/Doc/Form/Site.';

  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID (44 characters)',
        pattern: '^[a-zA-Z0-9_-]{44}$',
        minLength: 44,
        maxLength: 44
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
    required: ['scriptId']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);

    const scriptId = this.validate.scriptId(params.scriptId, 'project operation');
    const includeContent = this.validate.boolean(params.includeContent || false, 'includeContent', 'project operation');

    // Get project metadata (includes parentId if container-bound)
    const projectMetadata = await this.gasClient.getProject(scriptId, accessToken);

    // Get project files
    const files = await this.gasClient.getProjectContent(scriptId, accessToken);

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
      scriptId,
      title: projectMetadata.title,
      createTime: projectMetadata.createTime,
      updateTime: projectMetadata.updateTime,
      totalFiles: files.length,
      totalSize,
      filesByType,
      prefixGroups,
      structure: Object.keys(prefixGroups).sort()
    };

    // If this is a container-bound script, fetch container metadata
    if (projectMetadata.parentId) {
      try {
        const containerInfo = await this.fetchContainerInfo(projectMetadata.parentId, accessToken);
        if (containerInfo) {
          result.container = containerInfo;
        }
      } catch (error) {
        console.error('Failed to fetch container info:', error);
        // Continue without container info rather than failing
      }
    }

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

  /**
   * Fetch container information from Google Drive API
   */
  private async fetchContainerInfo(containerId: string, accessToken: string): Promise<any> {
    const url = `https://www.googleapis.com/drive/v3/files/${containerId}?fields=id,name,mimeType,webViewLink,createdTime,modifiedTime`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch container info: ${response.status} ${response.statusText}`);
    }

    const container = await response.json();

    const containerType = container.mimeType?.includes('spreadsheet') ? 'spreadsheet' :
                         container.mimeType?.includes('document') ? 'document' :
                         container.mimeType?.includes('form') ? 'form' :
                         container.mimeType?.includes('site') ? 'site' : 'unknown';

    return {
      containerId: container.id,
      containerName: container.name,
      containerType,
      containerUrl: container.webViewLink || `https://drive.google.com/file/d/${container.id}/view`,
      createdTime: container.createdTime,
      modifiedTime: container.modifiedTime
    };
  }
}

/**
 * Reorder files in a Google Apps Script project
 */
export class ReorderTool extends BaseTool {
  public name = 'reorder';
  public description = 'Change the execution order of files in a Google Apps Script project';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID (44 characters)',
        pattern: '^[a-zA-Z0-9_-]{44}$',
        minLength: 44,
        maxLength: 44
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
    required: ['scriptId', 'fileName', 'newPosition']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const scriptId = this.validate.scriptId(params.scriptId, 'project operation');
    const fileName = this.validate.string(params.fileName, 'fileName', 'project operation');
    const newPosition = this.validate.number(params.newPosition, 'newPosition', 'project operation', 0);

    // Get current files
    const files = await this.gasClient.getProjectContent(scriptId, accessToken);
    
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

    // Enforce critical file ordering:
    // Position 0: CommonJS (always first)
    // Position 1: __mcp_gas_run (always second, right after CommonJS)
    const commonJsIndex = reorderedFiles.findIndex((f: any) => f.name === 'CommonJS');
    const mcpRunIndex = reorderedFiles.findIndex((f: any) => f.name === '__mcp_gas_run');

    // Move CommonJS to position 0 if not already there
    if (commonJsIndex !== -1 && commonJsIndex !== 0) {
      const [commonJsFile] = reorderedFiles.splice(commonJsIndex, 1);
      reorderedFiles.unshift(commonJsFile);
    }

    // Move __mcp_gas_run to position 1 if not already there (right after CommonJS)
    const updatedMcpRunIndex = reorderedFiles.findIndex((f: any) => f.name === '__mcp_gas_run');
    if (updatedMcpRunIndex !== -1 && updatedMcpRunIndex !== 1) {
      const [mcpRunFile] = reorderedFiles.splice(updatedMcpRunIndex, 1);
      reorderedFiles.splice(1, 0, mcpRunFile);
    }

    // Update the project with new file order
    await this.gasClient.updateProjectContent(scriptId, reorderedFiles, accessToken);

    return {
      status: 'reordered',
      scriptId,
      fileName,
      oldPosition: currentIndex,
      newPosition,
      totalFiles: files.length,
      message: `Moved ${fileName} from position ${currentIndex} to ${newPosition}. CommonJS enforced at position 0, __mcp_gas_run at position 1.`
    };
  }
}

/**
 * Get metrics data for scripts, such as number of executions and active users
 */
export class ProjectMetricsTool extends BaseTool {
  public name = 'project_metrics';
  public description = 'Get metrics data for scripts, such as number of executions and active users. LLM USE: Analyze script performance and usage patterns.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
                  description: 'Google Apps Script project ID. LLM REQUIREMENT: Must be a valid 44-character Google Drive file ID for an Apps Script project.',
        pattern: '^[a-zA-Z0-9_-]{25,60}$',
        minLength: 25,
        maxLength: 60,
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
        performance: 'project_metrics({scriptId: "...", metricsGranularity: "DAILY"}) - Detailed performance analysis',
        trends: 'project_metrics({scriptId: "...", metricsGranularity: "WEEKLY"}) - Long-term usage trends',
        deployment: 'project_metrics({scriptId: "...", metricsFilter: {deploymentId: "..."}}) - Specific deployment metrics'
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