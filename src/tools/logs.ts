import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { ValidationError } from '../errors/mcpErrors.js';

/**
 * Unified logs management tool for browsing execution logs
 * Supports list and get operations
 */
export class LogTool extends BaseTool {
  public name = 'log';
  public description = 'Browse execution logs with Cloud Logging integration. Supports operations: list (browse logs), get (detailed log for process). ⚠️ LIMITATION: Only works for standalone scripts with standard GCP projects - container-bound scripts (attached to Sheets/Docs/Forms) are NOT supported. For container-bound scripts or real-time logging, use gas_run which automatically captures Logger.log() output.';

  public inputSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['list', 'get'],
        description: 'Log operation: list (browse execution logs), get (get detailed log for specific process)'
      },
      ...SchemaFragments.scriptId,
      // List operation parameters
      functionName: {
        type: 'string',
        description: 'Filter by specific function name (list operation). PERFORMANCE: Triggers optimized Cloud Logging-first query (2-3x faster).',
        llmHints: {
          optimization: 'Providing this parameter significantly improves query performance',
          usage: 'Use when debugging specific function executions'
        }
      },
      minutes: {
        type: 'number',
        description: 'Number of minutes to look back from now (default: 15, list operation). Ignored if timeRange is provided.',
        default: 15,
        minimum: 1,
        maximum: 10080,
        llmHints: {
          default: '15 minutes is the standard default',
          recent: 'Use 5-10 minutes for very recent executions',
          historical: 'Use 60-1440 minutes for broader historical analysis'
        }
      },
      timeRange: {
        type: 'object',
        description: 'Explicit time range in RFC3339 format (list operation). Overrides minutes parameter.',
        properties: {
          start: {
            type: 'string',
            description: 'Start time in RFC3339 UTC "Zulu" format (e.g., "2024-01-01T00:00:00Z")'
          },
          end: {
            type: 'string',
            description: 'End time in RFC3339 UTC "Zulu" format (e.g., "2024-01-01T23:59:59Z")'
          }
        }
      },
      statusFilter: {
        type: 'string',
        description: 'Filter by process status (default: ALL, list operation)',
        enum: ['COMPLETED', 'FAILED', 'TIMED_OUT', 'ALL'],
        default: 'ALL',
        llmHints: {
          debugging: 'Use FAILED to quickly find errors',
          monitoring: 'Use ALL for comprehensive view',
          performance: 'Use COMPLETED for successful execution analysis'
        }
      },
      pageSize: {
        type: 'number',
        description: 'Maximum number of processes to return (default: 50)',
        minimum: 1,
        maximum: 200,
        default: 50
      },
      pageToken: {
        type: 'string',
        description: 'Token for pagination (optional). Get from previous response.nextPageToken'
      },
      // Get operation parameters
      processId: {
        type: 'string',
        description: 'Process ID from logs_list or process_list response (required for get operation)',
        llmHints: {
          source: 'Get this from logs_list or process_list response',
          format: 'Long alphanumeric process identifier'
        }
      },
      includeMetadata: {
        type: 'boolean',
        description: 'Include process metadata (function name, status, duration, etc.) for get operation. Default: true',
        default: true,
        llmHints: {
          complete: 'Use true for complete execution context',
          logsOnly: 'Use false for just log messages'
        }
      },
      ...SchemaFragments.accessToken
    },
    required: ['operation', 'scriptId'],
    additionalProperties: false,
    llmWorkflowGuide: {
      prerequisites: ['1.auth→start if needed', '2.scriptId from project_create|ls', '3.standalone+GCP only (NOT container-bound)'],
      limitations: {containerBound: 'Container-bound (Sheets/Docs/Forms)→Cloud Logging API rejects', solution: 'gas_run→auto-captures Logger.log() in logger_output', historicalOnly: 'historical logs only→gas_run for realtime'},
      alternatives: {containerBoundLogging: {tool: 'gas_run', usage: 'gas_run({scriptId,js_statement:"Logger.log(\'debug\');yourCode()"})', benefit: 'auto-captures ALL Logger.log()', why: 'universal standalone+container-bound'}, realtimeLogging: {tool: 'gas_run', usage: 'wrap with Logger.log() for debug', benefit: 'immediate feedback (no Cloud Logging delay)'}},
      nextSteps: ['SUCCESS→logs_get({scriptId,processId})→detailed logs', 'FAILURE (container-bound)→gas_run realtime', 'analysis→process_list for trends'],
      useCases: {
        list: {
          recentErrors: 'log({operation:"list",scriptId:"...",functionName:"myFunc",minutes:15,statusFilter:"FAILED"})',
          debugging: 'log({operation:"list",scriptId:"...",functionName:"processData",minutes:30})',
          monitoring: 'log({operation:"list",scriptId:"...",minutes:60,statusFilter:"ALL"})',
          historical: 'log({operation:"list",scriptId:"...",timeRange:{start:"2024-01-01T00:00:00Z",end:"2024-01-01T23:59:59Z"}})',
          containerBoundAlternative: 'container-bound→gas_run({scriptId:"...",js_statement:"Logger.log(\'debug\');yourFunction()"})'
        },
        get: {
          debugging: 'log({operation:"get",scriptId:"...",processId:"..."})',
          analysis: 'log({operation:"get",scriptId:"...",processId:"...",includeMetadata:true})',
          logsOnly: 'log({operation:"get",scriptId:"...",processId:"...",includeMetadata:false})',
          containerBoundAlternative: 'container-bound→gas_run({scriptId:"...",js_statement:"Logger.log(\'debug\');yourFunction()"})'
        }
      },
      performance: {fast: 'functionName→Cloud Logging-first (optimized)', fallback: 'no functionName→Process API first (slower,comprehensive)'}
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const { operation } = params;

    // Route to appropriate operation
    switch (operation) {
      case 'list':
        return this.listLogs(params);
      case 'get':
        return this.getLog(params);
      default:
        throw new ValidationError('operation', operation, 'one of: list, get');
    }
  }

  private async listLogs(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);

    const scriptId = this.validate.scriptId(params.scriptId, 'logs listing');
    const functionName = params.functionName ? this.validate.string(params.functionName, 'functionName', 'logs listing') : undefined;
    const minutes = params.minutes ? this.validate.number(params.minutes, 'minutes', 'logs listing', 1, 10080) : 15;
    const statusFilter = params.statusFilter || 'ALL';
    const pageSize = params.pageSize ? this.validate.number(params.pageSize, 'pageSize', 'logs listing', 1, 200) : 50;
    const pageToken = params.pageToken ? this.validate.string(params.pageToken, 'pageToken', 'logs listing') : undefined;

    // Calculate time range
    let startTime: string;
    let endTime: string;

    if (params.timeRange) {
      startTime = params.timeRange.start || new Date(Date.now() - minutes * 60 * 1000).toISOString();
      endTime = params.timeRange.end || new Date().toISOString();
    } else {
      startTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();
      endTime = new Date().toISOString();
    }

    return await this.handleApiCall(
      () => this.gasClient.listLogsWithCloudLogging(
        scriptId,
        {
          functionName,
          startTime,
          endTime,
          statusFilter,
          pageSize,
          pageToken
        },
        accessToken
      ),
      'list execution logs',
      { scriptId, functionName, startTime, endTime, statusFilter, pageSize, operation: 'list' }
    );
  }

  private async getLog(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);

    const scriptId = this.validate.scriptId(params.scriptId, 'logs retrieval');
    const processId = this.validate.string(params.processId, 'processId', 'logs retrieval');
    const includeMetadata = params.includeMetadata !== false;

    return await this.handleApiCall(
      () => this.gasClient.getProcessLogs(scriptId, processId, includeMetadata, accessToken),
      'get process logs',
      { scriptId, processId, includeMetadata, operation: 'get' }
    );
  }
}
