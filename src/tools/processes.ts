import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';

/**
 * List information about processes made by or on behalf of a user
 */
export class ProcessListTool extends BaseTool {
  public name = 'process_list';
  public description = 'List information about processes made by or on behalf of a user, such as process type and current status. Monitor script execution history and performance.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      pageSize: {
        type: 'number',
        description: 'Maximum number of processes to return (default: 50). Use larger values for comprehensive data, smaller for quick checks.',
        minimum: 1,
        default: 50,
        examples: [10, 25, 50],
        llmHints: {
          typical: 'Use default 50 for most cases',
          performance: 'Smaller values (10-20) for faster responses',
          monitoring: 'Use 50 for comprehensive process monitoring'
        }
      },
      pageToken: {
        type: 'string',
        description: 'Token for pagination (optional). Include token from previous response to get next page.',
        llmHints: {
          workflow: 'Get this from previous process_list response.nextPageToken',
          iteration: 'Keep calling with pageToken until nextPageToken is null'
        }
      },
      userProcessFilter: {
        type: 'object',
        description: 'Filter criteria for user processes (optional). Filter by scripts, functions, time ranges, or process characteristics.',
        properties: {
          scriptId: {
            type: 'string',
            description: 'Optional field used to limit returned processes to those originating from projects with a specific script ID.',
            pattern: '^[a-zA-Z0-9_-]{44}$'
          },
          deploymentId: {
            type: 'string',
            description: 'Optional field used to limit returned processes to those originating from projects with a specific deployment ID.'
          },
          projectName: {
            type: 'string',
            description: 'Optional field used to limit returned processes to those originating from projects with project names containing a specific string.'
          },
          functionName: {
            type: 'string',
            description: 'Optional field used to limit returned processes to those originating from a script function with the given function name.'
          },
          startTime: {
            type: 'string',
            description: 'Optional field used to limit returned processes to those that were started on or after the given timestamp. RFC3339 UTC "Zulu" format.',
            examples: ['2024-01-15T00:00:00Z', '2024-01-15T08:30:00Z'],
            llmHints: {
              format: 'RFC3339 UTC: YYYY-MM-DDTHH:MM:SSZ',
              tip: 'Use new Date().toISOString() to generate current timestamp'
            }
          },
          endTime: {
            type: 'string',
            description: 'Optional field used to limit returned processes to those that completed on or before the given timestamp. RFC3339 UTC "Zulu" format.',
            examples: ['2024-01-15T23:59:59Z', '2024-01-16T17:00:00Z'],
            llmHints: {
              format: 'RFC3339 UTC: YYYY-MM-DDTHH:MM:SSZ',
              timeRange: 'Combine with startTime for specific time windows'
            }
          },
          types: {
            type: 'array',
            description: 'Optional field used to limit returned processes to those having one of the specified process types.',
            items: {
              type: 'string',
              enum: ['PROCESS_TYPE_UNSPECIFIED', 'ADD_ON', 'EXECUTION_API', 'TIME_DRIVEN', 'TRIGGER', 'WEBAPP', 'EDITOR', 'SIMPLE_TRIGGER', 'MENU', 'BATCH_TASK']
            }
          },
          statuses: {
            type: 'array',
            description: 'Optional field used to limit returned processes to those having one of the specified process statuses.',
            items: {
              type: 'string',
              enum: ['PROCESS_STATUS_UNSPECIFIED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELED', 'FAILED', 'TIMED_OUT', 'UNKNOWN', 'DELAYED']
            }
          },
          userAccessLevels: {
            type: 'array',
            description: 'Optional field used to limit returned processes to those having one of the specified user access levels.',
            items: {
              type: 'string',
              enum: ['USER_ACCESS_LEVEL_UNSPECIFIED', 'NONE', 'READ', 'WRITE', 'OWNER']
            }
          }
        },
        llmHints: {
          filtering: 'Use scriptId to see processes for specific project',
          timeRange: 'Use startTime/endTime for historical analysis with RFC3339 timestamps',
          debugging: 'Use functionName to trace specific function executions',
          processTypes: 'Use types array to filter by execution method (WEBAPP, EXECUTION_API, etc.)',
          monitoring: 'Use statuses array to find failed, running, or completed processes',
          permissions: 'Use userAccessLevels to filter by user permission level'
        }
      },
      ...SchemaFragments.accessToken
    },
    required: [],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Monitor script execution history | Debug specific script or function executions',
      filtering: 'userProcessFilter: scriptId, functionName, statuses, types, timeRange'
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const pageSize = params.pageSize ? this.validate.number(params.pageSize, 'pageSize', 'process listing', 1, 50) : 50;
    const pageToken = params.pageToken ? this.validate.string(params.pageToken, 'pageToken', 'process listing') : undefined;
    const userProcessFilter = params.userProcessFilter || undefined;

    return await this.handleApiCall(
      () => this.gasClient.listProcesses(pageSize, pageToken, userProcessFilter, accessToken),
      'list user processes',
      { pageSize, pageToken, userProcessFilter }
    );
  }
}

 