// ExecApiTool: structured function-call API — delegates to ExecTool for execution
import { BaseTool } from '../base.js';
import { ValidationError } from '../../errors/mcpErrors.js';
import { SessionAuthManager } from '../../auth/sessionManager.js';
import { SchemaFragments } from '../../utils/schemaFragments.js';
import { buildFunctionCall } from '../../utils/parameterSerializer.js';
import { ExecTool } from './ExecTool.js';

/**
 * Execute functions in Google Apps Script projects - delegates to exec with function call syntax
 *
 * This tool provides a function-centric API that transforms function calls into JavaScript statements
 * and delegates to the exec tool for actual execution. This provides:
 * - Unified execution path (everything uses exec's web app infrastructure)
 * - No need for separate API executable deployment
 * - Access to all exec features (logFilter, logTail, timeouts, environment selection)
 * - Simpler architecture with single execution implementation
 */
export class ExecApiTool extends BaseTool {
  public name = 'exec_api';
  public description = '[EXEC:API] Call a named function with parameters via Apps Script API — structured alternative to exec. WHEN: calling exported functions with typed arguments. AVOID: use exec for ad-hoc JavaScript; exec_api for calling known module functions with structured args. Example: exec_api({scriptId, functionName: "processData", parameters: [1, 2]})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      success: { type: 'boolean', description: 'Whether execution succeeded' },
      result: { description: 'Function return value' },
      logger_output: { type: 'string', description: 'Captured Logger.log() output' },
      execution_type: { type: 'string', description: 'How the function was executed' }
    }
  };

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      environment: {
        type: 'string',
        enum: ['dev', 'staging', 'prod'],
        description: 'Execution environment (default: dev). dev=HEAD (latest), staging=snapshot, prod=stable.',
        default: 'dev'
      },
      ...SchemaFragments.moduleName,
      functionName: {
        type: 'string',
        description: 'Name of the function to execute'
      },
      parameters: {
        type: 'array',
        description: 'Array of parameters to pass to the function. Supports primitives (string, number, boolean), arrays, and plain objects. (optional)',
        default: []
      },
      autoRedeploy: {
        type: 'boolean',
        description: 'Auto-deploy setup. true (default)=create as needed, false=use existing. Set false for speed on pre-configured projects.',
        default: true
      },
      executionTimeout: {
        type: 'number',
        description: 'Max execution timeout in seconds (default: 780=13min, max: 3600=1hr). Increase for long-running ops.',
        default: 780,
        minimum: 780,
        maximum: 3600
      },
      responseTimeout: {
        type: 'number',
        description: 'Max response timeout in seconds (default: 780=13min, max: 3600=1hr). Increase for large payloads.',
        default: 780,
        minimum: 780,
        maximum: 3600
      },
      logFilter: {
        type: 'string',
        description: 'Optional regex to filter logger_output lines (ripgrep-style). Only matching lines included. Unspecified=all output.',
        examples: [
          'ERROR|WARN',
          '^\\[.*\\]',
          'TODO|FIXME',
          'result.*:',
        ]
      },
      logTail: {
        type: 'number',
        description: 'Optional: Return last N lines of logger_output. Useful for overwhelming logs. Applied after logFilter.',
        minimum: 1,
        maximum: 10000,
        examples: [10, 50, 100]
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'functionName']
  };

  public annotations = {
    title: 'Execute API',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  };

  private execTool: ExecTool;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.execTool = new ExecTool(sessionAuthManager);
  }

  async execute(params: any): Promise<any> {
    // Validate inputs
    const scriptId = this.validate.scriptId(params.scriptId, 'function execution');
    const moduleName = params.moduleName ? this.validate.string(params.moduleName, 'module name') : undefined;
    const functionName = this.validate.functionName(params.functionName, 'function execution');
    const parameters = params.parameters || [];

    // Validate parameters is an array
    if (!Array.isArray(parameters)) {
      throw new ValidationError('parameters', parameters, 'array of function parameters');
    }

    // Build JavaScript statement from function call
    const js_statement = buildFunctionCall(functionName, parameters, moduleName);

    // Compact logging
    console.error(`[EXEC_API] ${scriptId.substring(0, 12)}... ${moduleName ? moduleName + '.' : ''}${functionName}(${parameters.map(p => JSON.stringify(p).substring(0, 30)).join(', ')}) → ${js_statement.substring(0, 50)}...`);

    // Delegate to exec with transformed parameters
    const execParams = {
      scriptId,
      js_statement,
      environment: params.environment || 'dev',
      autoRedeploy: params.autoRedeploy !== false,
      executionTimeout: params.executionTimeout,
      responseTimeout: params.responseTimeout,
      logFilter: params.logFilter,
      logTail: params.logTail,
      accessToken: params.accessToken
    };

    return await this.execTool.execute(execParams);
  }
}
