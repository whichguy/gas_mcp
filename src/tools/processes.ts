import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { SessionAuthManager } from '../auth/sessionManager.js';

/**
 * List information about processes made by or on behalf of a user
 */
export class GASProcessListTool extends BaseTool {
  public name = 'gas_process_list';
  public description = 'List information about processes made by or on behalf of a user, such as process type and current status. LLM USE: Monitor script execution history and performance.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      pageSize: {
        type: 'number',
        description: 'Maximum number of processes to return (default: 50). LLM RECOMMENDATION: Use larger values for comprehensive data, smaller values for quick checks.',
        minimum: 1,
        default: 50,
        llmHints: {
          typical: 'Use default 50 for most cases',
          performance: 'Smaller values (10-20) for faster responses',
          monitoring: 'Use 50 for comprehensive process monitoring'
        }
      },
      pageToken: {
        type: 'string',
        description: 'Token for pagination (optional). LLM USE: Include token from previous response to get next page of results.',
        llmHints: {
          workflow: 'Get this from previous gas_process_list response.nextPageToken',
          iteration: 'Keep calling with pageToken until nextPageToken is null'
        }
      },
      userProcessFilter: {
        type: 'object',
        description: 'Filter criteria for user processes (optional). LLM USE: Filter by specific scripts, functions, time ranges, or process characteristics according to Google Apps Script API specification.',
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
            description: 'Optional field used to limit returned processes to those that were started on or after the given timestamp. RFC3339 UTC "Zulu" format (e.g., "2014-10-02T15:01:23Z").'
          },
          endTime: {
            type: 'string',
            description: 'Optional field used to limit returned processes to those that completed on or before the given timestamp. RFC3339 UTC "Zulu" format (e.g., "2014-10-02T15:01:23Z").'
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
    required: [],
    additionalProperties: false,
    llmWorkflowGuide: {
      prerequisites: [
        '1. Authentication: gas_auth({mode: "status"}) → gas_auth({mode: "start"}) if needed'
      ],
      useCases: {
        monitoring: 'gas_process_list({pageSize: 50}) - Monitor all recent executions',
        debugging: 'gas_process_list({userProcessFilter: {scriptId: "..."}}) - Debug specific script',
        analysis: 'gas_process_list({userProcessFilter: {functionName: "myFunction"}}) - Analyze function performance'
      },
      errorHandling: {
        'AuthenticationError': 'Run gas_auth({mode: "start"}) to authenticate first',
        'PermissionError': 'Check Google Cloud Console permissions for Apps Script API'
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

/**
 * List information about a script's executed processes
 */
export class GASProcessListScriptTool extends BaseTool {
  public name = 'gas_process_list_script';
  public description = 'List information about a script\'s executed processes, such as process type and current status. LLM USE: Debug and monitor specific script performance.';
  
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
      pageSize: {
        type: 'number',
        description: 'Maximum number of processes to return (default: 50). LLM RECOMMENDATION: Use larger values for comprehensive analysis.',
        minimum: 1,
        default: 50,
        llmHints: {
          debugging: 'Use 50 to see all recent executions for debugging',
          monitoring: 'Use smaller values (10-20) for periodic checks'
        }
      },
      pageToken: {
        type: 'string',
        description: 'Token for pagination (optional). LLM USE: Include token from previous response to get next page.',
        llmHints: {
          workflow: 'Get this from previous gas_process_list_script response.nextPageToken'
        }
      },
      scriptProcessFilter: {
        type: 'object',
        description: 'Filter criteria for script processes (optional). LLM USE: Filter by specific functions, time ranges, or process characteristics according to Google Apps Script API specification for listScriptProcesses.',
        properties: {
          deploymentId: {
            type: 'string',
            description: 'Optional field used to limit returned processes to those originating from projects with a specific deployment ID.'
          },
          functionName: {
            type: 'string',
            description: 'Optional field used to limit returned processes to those originating from a script function with the given function name.'
          },
          startTime: {
            type: 'string',
            description: 'Optional field used to limit returned processes to those that were started on or after the given timestamp. RFC3339 UTC "Zulu" format (e.g., "2014-10-02T15:01:23Z").'
          },
          endTime: {
            type: 'string',
            description: 'Optional field used to limit returned processes to those that completed on or before the given timestamp. RFC3339 UTC "Zulu" format (e.g., "2014-10-02T15:01:23Z").'
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
          performance: 'Use functionName to analyze specific function performance',
          timeRange: 'Use startTime/endTime for historical performance analysis with RFC3339 timestamps',
          deployment: 'Use deploymentId to compare deployment performance',
          processTypes: 'Use types array to filter by execution method (WEBAPP, EXECUTION_API, etc.)',
          monitoring: 'Use statuses array to find failed, running, or completed processes',
          permissions: 'Use userAccessLevels to filter by user permission level'
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
        '2. Have valid scriptId from gas_project_create or gas_ls'
      ],
      useCases: {
        debugging: 'gas_process_list_script({scriptId: "...", scriptProcessFilter: {functionName: "myFunction"}}) - Debug specific function',
        monitoring: 'gas_process_list_script({scriptId: "..."}) - Monitor all script executions',
        performance: 'gas_process_list_script({scriptId: "...", scriptProcessFilter: {startTime: "2024-01-01T00:00:00Z"}}) - Performance analysis'
      },
      errorHandling: {
        'AuthenticationError': 'Run gas_auth({mode: "start"}) to authenticate first',
        'ScriptNotFound': 'Verify scriptId is correct and accessible',
        'PermissionError': 'Check Google Cloud Console permissions for Apps Script API'
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
    
    const scriptId = this.validate.scriptId(params.scriptId, 'script process listing');
    const pageSize = params.pageSize ? this.validate.number(params.pageSize, 'pageSize', 'script process listing', 1, 50) : 50;
    const pageToken = params.pageToken ? this.validate.string(params.pageToken, 'pageToken', 'script process listing') : undefined;
    const scriptProcessFilter = params.scriptProcessFilter || undefined;

    return await this.handleApiCall(
      () => this.gasClient.listScriptProcesses(scriptId, pageSize, pageToken, scriptProcessFilter, accessToken),
      'list script processes',
      { scriptId, pageSize, pageToken, scriptProcessFilter }
    );
  }
} 