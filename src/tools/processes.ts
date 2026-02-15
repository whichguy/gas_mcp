import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';

/**
 * List information about processes made by or on behalf of a user
 */
export class ProcessListTool extends BaseTool {
  public name = 'process_list';
  public description = '[PROCESS] List active Apps Script processes — shows running executions with status and duration. WHEN: checking for stuck or long-running executions. AVOID: use executions for historical execution logs; process_list for currently-running processes only. Example: process_list({scriptId})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      processes: { type: 'array', description: 'List of processes with status, duration, function name' },
      totalProcesses: { type: 'number', description: 'Total processes returned' },
      nextPageToken: { type: 'string', description: 'Token for next page of results' }
    }
  };

  public inputSchema = {
    type: 'object',
    properties: {
      pageSize: {
        type: 'number',
        description: 'Maximum number of processes to return (default: 50). Use larger values for comprehensive data, smaller for quick checks.',
        minimum: 1,
        default: 50,
        examples: [10, 25, 50]
      },
      pageToken: {
        type: 'string',
        description: 'Token for pagination from previous response.nextPageToken. Call until nextPageToken is null.'
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
            description: 'Filter by start time. RFC3339 UTC format (e.g., "2024-01-15T00:00:00Z").'
          },
          endTime: {
            type: 'string',
            description: 'Filter by end time. RFC3339 UTC format (e.g., "2024-01-15T23:59:59Z").'
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
      },
      ...SchemaFragments.accessToken
    },
    required: [],
    additionalProperties: false,
    llmGuidance: {
      filtering: 'userProcessFilter: scriptId, functionName, statuses, types, timeRange'
    }
  };

  public annotations = {
    title: 'List Processes',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
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

 