import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { ValidationError } from '../errors/mcpErrors.js';

/**
 * Unified executions management tool for browsing execution history
 * Supports list and get operations
 *
 * Note: This tool provides execution metadata only. For detailed Logger.log()
 * output, use the exec() tool which captures logs directly.
 */
export class ExecutionsTool extends BaseTool {
  public name = 'executions';
  public description = 'Browse execution history and metadata. Operations: list (recent executions), get (process details). ⚠️ LIMITATION: Detailed logs require exec() which captures Logger.log() directly. This tool provides execution metadata only.';

  public inputSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['list', 'get'],
        description: 'Operation: list (browse execution history), get (get process metadata)'
      },
      ...SchemaFragments.scriptId,

      // List operation parameters
      functionName: {
        type: 'string',
        description: 'Filter by function name (list operation). PERFORMANCE: Optimized query path.',
        llmHints: {
          optimization: 'Providing functionName improves query performance',
          usage: 'Use when debugging specific function executions',
          examples: ['onEdit', 'doGet', 'processData']
        }
      },

      minutes: {
        type: 'number',
        description: 'Minutes to look back (default: 10). Typical debugging window is 7-8 min.',
        default: 10,
        minimum: 1,
        maximum: 10080,
        llmHints: {
          debugging: 'Use 5-10 minutes for recent issues (most common use case)',
          triggers: 'Use 60+ minutes for scheduled trigger analysis',
          historical: 'Use 1440 (24h) for day-over-day comparison',
          progressive: 'If no results, widen: 10 → 60 → 240 → 1440'
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
        enum: ['COMPLETED', 'FAILED', 'TIMED_OUT', 'RUNNING', 'ALL'],
        default: 'ALL',
        description: 'Filter by process status (default: ALL)',
        llmHints: {
          debugging: 'Use FAILED to quickly find errors (most common for debugging)',
          monitoring: 'Use ALL for comprehensive view',
          performance: 'Use COMPLETED for successful execution analysis'
        }
      },

      pageSize: {
        type: 'number',
        description: 'Max processes to return (default: 10). Keep small to avoid context overflow.',
        minimum: 1,
        maximum: 50,
        default: 10,
        llmHints: {
          contextSafe: 'Default 10 prevents token overflow (~400 tokens total)',
          pagination: 'Use with pageToken to iterate through larger result sets'
        }
      },

      pageToken: {
        type: 'string',
        description: 'Token for pagination. Get from previous response.pagination.nextPageToken.',
        llmHints: {
          workflow: 'Call with pageToken until hasMore is false',
          warning: 'Results may become stale across pages if new executions occur'
        }
      },

      // Get operation parameters
      processId: {
        type: 'string',
        description: 'Process ID (required for get operation). Get from list response.',
        llmHints: {
          source: 'Get from executions list: processes[].processId',
          usage: 'Use get operation to see process metadata for specific execution'
        }
      },

      includeMetadata: {
        type: 'boolean',
        description: 'Include process metadata for get operation. Default: true',
        default: true
      },

      ...SchemaFragments.accessToken
    },
    required: ['operation', 'scriptId'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Debug recent failures | Monitor execution history | Find slow executions',
      limitation: '⚠️ This provides metadata only. For detailed Logger.log() output, use exec() tool instead.',
      workflow: 'Step 1: list recent executions (default 10 min) → Step 2: Check recommendations for failures → Step 3: Use exec() for detailed logs if needed',
      typicalFlow: 'executions({operation:"list", scriptId, minutes:10}) → check statusCounts → follow recommendations',
      performance: 'functionName filter improves query performance 2-3x',
      examples: [
        'Recent failures: operation: "list", statusFilter: "FAILED", minutes: 10',
        'All executions: operation: "list", minutes: 10',
        'Specific function: operation: "list", functionName: "doGet", minutes: 60'
      ]
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
        return this.listExecutions(params);
      case 'get':
        return this.getExecution(params);
      default:
        throw new ValidationError('operation', operation, 'one of: list, get');
    }
  }

  private async listExecutions(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);

    const scriptId = this.validate.scriptId(params.scriptId, 'executions listing');
    const functionName = params.functionName ? this.validate.string(params.functionName, 'functionName', 'executions listing') : undefined;
    const minutes = params.minutes ? this.validate.number(params.minutes, 'minutes', 'executions listing', 1, 10080) : 10;
    const statusFilter = params.statusFilter || 'ALL';
    const pageSize = params.pageSize ? this.validate.number(params.pageSize, 'pageSize', 'executions listing', 1, 50) : 10;
    const pageToken = params.pageToken ? this.validate.string(params.pageToken, 'pageToken', 'executions listing') : undefined;

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
          pageToken,
          minutes  // Pass minutes for recommendation logic
        },
        accessToken
      ),
      'list executions',
      { scriptId, functionName, startTime, endTime, statusFilter, pageSize, operation: 'list' }
    );
  }

  private async getExecution(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);

    const scriptId = this.validate.scriptId(params.scriptId, 'execution retrieval');
    const processId = this.validate.string(params.processId, 'processId', 'execution retrieval');
    const includeMetadata = params.includeMetadata !== false;

    return await this.handleApiCall(
      () => this.gasClient.getProcessLogs(scriptId, processId, includeMetadata, accessToken),
      'get execution details',
      { scriptId, processId, includeMetadata, operation: 'get' }
    );
  }
}
