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
  public description = '[LOGS:EXECUTIONS] View Apps Script execution history — list recent executions or get detailed execution info. WHEN: checking execution status, timing, or error details. AVOID: use cloud_logs for detailed debug output; use process_list for currently-running processes. Example: executions({scriptId, operation: "list"})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      operation: { type: 'string', description: 'Operation performed (list or get)' },
      processes: { type: 'array', description: 'Execution entries with status, timing, function' },
      totalReturned: { type: 'number', description: 'Number of executions returned' },
      statusCounts: { type: 'object', description: 'Count per status (COMPLETED, FAILED, etc.)' },
      hasMore: { type: 'boolean', description: 'Whether more pages available' },
      nextPageToken: { type: 'string', description: 'Token for next page' },
      processId: { type: 'string', description: 'Process ID (get operation)' },
      metadata: { type: 'object', description: 'Process metadata (get operation)' }
    }
  };

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
        description: 'Filter by function name (list). Improves query performance 2-3x.'
      },

      minutes: {
        type: 'number',
        description: 'Minutes to look back (default: 10). Use 5-10 for recent issues, 60+ for triggers, 1440 for 24h. If no results, widen: 10→60→240→1440.',
        default: 10,
        minimum: 1,
        maximum: 10080
      },

      timeRange: {
        type: 'object',
        description: 'Explicit RFC3339 time range (overrides minutes).',
        properties: {
          start: { type: 'string', description: 'Start time RFC3339 UTC (e.g., "2024-01-01T00:00:00Z")' },
          end: { type: 'string', description: 'End time RFC3339 UTC (e.g., "2024-01-01T23:59:59Z")' }
        }
      },

      statusFilter: {
        type: 'string',
        enum: ['COMPLETED', 'FAILED', 'TIMED_OUT', 'RUNNING', 'ALL'],
        default: 'ALL',
        description: 'Filter by status. Use FAILED for debugging, ALL for monitoring.'
      },

      pageSize: {
        type: 'number',
        description: 'Max processes to return (default: 10, max: 50). Default prevents token overflow.',
        minimum: 1,
        maximum: 50,
        default: 10
      },

      pageToken: {
        type: 'string',
        description: 'Pagination token from previous response. Call until hasMore is false.'
      },

      // Get operation parameters
      processId: {
        type: 'string',
        description: 'Process ID (required for get). Get from list response processes[].processId.'
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
      limitation: 'Metadata only — use exec() for Logger.log() output.',
      workflow: 'list (default 10 min) → check statusCounts → use exec() for detailed logs if needed',
      examples: 'Failures: statusFilter:"FAILED" | Function: functionName:"doGet", minutes:60'
    }
  };

  public annotations = {
    title: 'Execution Logs',
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
