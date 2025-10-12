import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ValidationError, GASApiError, AuthenticationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { CodeGenerator } from '../utils/codeGeneration.js';
import { GASFile } from '../api/gasClient.js';
import { ProjectResolver, ProjectParam } from '../utils/projectResolver.js';
import { getSuccessHtmlTemplate, getErrorHtmlTemplate } from './deployments.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import open from 'open';

// Import extracted utilities
import {
  estimateTokenCount,
  filterLoggerOutput,
  protectResponseSize
} from './execution/utilities/response-protection.js';
import { ensureManifestEntryPoints } from './execution/utilities/manifest-config.js';
import { setupInfrastructure } from './execution/infrastructure/setup-manager.js';
import { performDomainAuth } from './execution/auth/domain-auth.js';

/**
 * Execute functions in Google Apps Script projects via API executable
 * 
 * Requirements:
 * - Script project must be deployed for API use
 * - Must have script.scriptapp OAuth scope (or function-specific scopes)
 * - Cloud Platform project must match between calling app and script
 */
export class ExecApiTool extends BaseTool {
  public name = 'exec_api';
  public description = 'Execute a function in a Google Apps Script project via API executable. CRITICAL: Functions must be deployed as API executable before execution. Use version_create → deploy_create → exec_api_exec workflow for new/modified functions.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      functionName: {
        type: 'string',
        description: 'Name of the function to execute'
      },
      parameters: {
        type: 'array',
        items: {
          type: 'object'
        },
        description: 'Array of parameters to pass to the function. Must be primitive types (string, number, boolean, array, object). Cannot be Apps Script-specific objects. (optional)',
        default: []
      },
      devMode: {
        type: 'boolean',
        description: 'Run in development mode (default: true)',
        default: true
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'functionName']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  /**
   * Try to get auth token without throwing errors (optimistic approach)
   */
  private async tryGetAuthToken(): Promise<string | null> {
    try {
      return await this.getAuthToken({});
    } catch (error: any) {
      // Return null if authentication fails, so we can try without auth first
      return null;
    }
  }

  async execute(params: any): Promise<any> {
    // Optimistic approach: validate inputs first, then try without authentication
    const scriptId = this.validate.scriptId(params.scriptId, 'API function execution');
    const functionName = this.validate.functionName(params.functionName, 'API function execution');
    const parameters = params.parameters || [];
    const devMode = params.devMode !== false; // Default to true

    // Validate parameters is an array
    if (!Array.isArray(parameters)) {
      throw new ValidationError('parameters', parameters, 'array of function parameters');
    }

    // Try operation first with provided access token (if any) or session auth
    let accessToken: string | null = null;
    
    try {
      // First try: Use provided token or attempt to get from session (optimistic)
      accessToken = params.accessToken || await this.tryGetAuthToken();
      
      if (!accessToken) {
        throw new AuthenticationError(
          `Authentication required for exec_api_exec operation. Use auth(mode="start") to authenticate and retry.`
        );
      }
      console.error(`Executing function: ${functionName} in script: ${scriptId}`);
      console.error(`📋 Parameters: ${JSON.stringify(parameters)}`);
      console.error(`Dev mode: ${devMode}`);

      const result = await this.gasClient.executeFunction(scriptId, functionName, parameters, accessToken);

      if (result.error) {
        console.error(`Function execution failed:`, result.error);
        
        return {
          status: 'error',
          scriptId,
          functionName,
          parameters,
          error: {
            type: result.error.type,
            message: result.error.message,
            stackTrace: result.error.scriptStackTraceElements || []
          },
          executedAt: new Date().toISOString()
        };
      }

      console.error(`Function executed successfully`);
      console.error(`📤 Result:`, result.result);

      return {
        status: 'success',
        scriptId,
        functionName,
        parameters,
        result: result.result,
        executedAt: new Date().toISOString(),
        sessionId: this.sessionAuthManager?.getSessionId(),
        apiInfo: {
          apiVersion: 'v1',
          executionTime: 'See Apps Script quotas for maximum execution time',
          resultType: typeof result.result
        }
      };

    } catch (error: any) {
      console.error(`💥 Execution error:`, error);
      
      // Check for authentication errors (401/403)
      const authStatusCode = error.statusCode || error.response?.status || error.data?.statusCode;
      
      if (authStatusCode === 401 || authStatusCode === 403) {
        // Include detailed HTTP response information in the error
        const httpDetails = {
          statusCode: authStatusCode,
          statusText: error.response?.statusText || (authStatusCode === 401 ? 'Unauthorized' : 'Forbidden'),
          url: error.response?.url || 'Unknown URL',
          headers: error.response?.headers ? Object.fromEntries(error.response.headers.entries()) : {},
          responseBody: error.response?.text || error.message
        };

        const authError = new AuthenticationError(
          `Authentication required for exec_api_exec operation (HTTP ${authStatusCode}). Use auth(mode="start") to authenticate and retry.`
        );
        
        // Add HTTP response details to error data
        authError.data = {
          ...authError.data,
          statusCode: authStatusCode,
          operation: 'exec_api_exec',
          scriptId,
          httpResponse: httpDetails,
          instructions: [
            'Use auth with mode="start" to begin authentication',
            'Complete the OAuth flow in your browser',
            'Then retry your exec_api_exec request'
          ],
          command: 'auth({"mode": "start"})',
          statusCheck: 'auth({"mode": "status"})'
        };
        
        throw authError;
      }
      
      // Log detailed error information for debugging
      console.error(`Error details:`, {
        name: error.name,
        message: error.message,
        errorData: error.data,
        responseStatus: error.response?.status,
        errorCode: error.code,
        isGASApiError: error instanceof GASApiError
      });
      
      // Handle specific Google Apps Script API errors with detailed guidance
      if (error instanceof GASApiError) {
        const statusCode = (error.data as any)?.statusCode;
        let helpMessage = '';
        let setupInstructions: string[] = [];

        // Provide specific guidance based on error codes from API documentation
        if (statusCode === 404) {
          helpMessage = 'Function not found - likely not deployed as API executable or function name incorrect';
          setupInstructions = [
            'REQUIRED: Deploy your functions before execution',
            '1. Create version: version_create(scriptId="your-project", description="Latest changes")',
            '2. Deploy API: deploy_create(scriptId="your-project", description="API deployment")',
            '3. Then retry: exec_api_exec(scriptId="your-project", functionName="yourFunction")',
            '',
            'Alternative: Manual deployment via Google Apps Script editor:',
            '• Open https://script.google.com → your project',
            '• Click "Deploy" → "New deployment"',
            '• Choose type "API executable"',
            '• Deploy and use deployment ID as scriptId'
          ];
        } else if (statusCode === 403) {
          helpMessage = 'Permission denied - Cloud Platform project mismatch or insufficient scopes';
          setupInstructions = [
            '1. Ensure your Google Cloud Project is linked to the Apps Script project',
            '2. Check that you have sufficient OAuth scopes:',
            '   - https://www.googleapis.com/auth/script.scriptapp (required)',
            '   - Additional scopes based on script functionality',
            '3. Re-authenticate with updated scopes: auth(mode="logout") then auth(mode="start")',
            '4. Verify the script project is deployed for API use'
          ];
        } else if (statusCode === 401) {
          helpMessage = 'Authentication required or token expired';
          setupInstructions = [
            '1. Re-authenticate: auth(mode="logout") then auth(mode="start")',
            '2. Ensure you have the required OAuth scopes for script execution'
          ];
        }

        return {
          status: 'error',
          scriptId,
          functionName,
          parameters,
          error: {
            type: 'GASApiError',
            message: error.message,
            statusCode,
            helpMessage,
            setupInstructions
          },
          troubleshooting: {
            deploymentWorkflow: [
              '1. write(path="project/file.gs", content="function myFunc() {...}")',
              '2. version_create(scriptId="project", description="Added myFunc")',
              '3. deploy_create(scriptId="project", description="API deployment")',
              '4. exec_api_exec(scriptId="project", functionName="myFunc")'
            ],
            apiRequirements: [
              'Functions must be deployed as API executable before execution',
              'New/modified functions require redeployment',
              'Calling application must share same Cloud Platform project',
              'Requires script.scriptapp OAuth scope or function-specific scopes'
            ],
            deploymentGuide: 'https://developers.google.com/apps-script/api/how-tos/execute',
            mcpDocumentation: 'See docs/FUNCTION_EXECUTION_DEPLOYMENT.md for complete workflow',
            scopesGuide: 'Open script Overview page → scroll to "Project OAuth Scopes"'
          },
          executedAt: new Date().toISOString(),
          sessionId: this.sessionAuthManager?.getSessionId()
        };
      }

      // Handle other types of errors and extract HTTP status codes
      const statusCode = error.data?.statusCode || 
                         error.response?.status || 
                         error.statusCode ||
                         error.code || 
                         500;

      console.error(`Non-GASApiError execution error - HTTP ${statusCode}:`, error.message);

      // Return structured error response for any error type
      return {
        status: 'error',
        scriptId,
        functionName,
        parameters,
        error: {
          type: error.name || 'ExecutionError',
          message: error.message,
          statusCode,
          helpMessage: `HTTP ${statusCode}: ${error.message || 'Unknown execution error'}`,
          setupInstructions: [
            'Unexpected error occurred during function execution',
            'Check console logs for detailed error information',
            'Verify function exists and is deployed correctly',
            'Ensure proper authentication and OAuth scopes'
          ]
        },
        troubleshooting: {
          deploymentWorkflow: [
            '1. write(path="project/file.gs", content="function myFunc() {...}")',
            '2. version_create(scriptId="project", description="Added myFunc")',
            '3. deploy_create(scriptId="project", description="API deployment")',
            '4. exec_api_exec(scriptId="project", functionName="myFunc")'
          ],
          apiRequirements: [
            'Functions must be deployed as API executable before execution',
            'New/modified functions require redeployment',
            'Calling application must share same Cloud Platform project',
            'Requires script.scriptapp OAuth scope or function-specific scopes'
          ]
        },
        executedAt: new Date().toISOString(),
        sessionId: this.sessionAuthManager?.getSessionId()
      };
    }
  }
}

/**
 * Execute functions via doGet() proxy pattern with JSON response handling and automatic deployment
 * 
 * AUTOMATIC DEPLOYMENT BEHAVIOR:
 * - AUTOMATICALLY CREATES fresh web app deployment by default when autoRedeploy=true
 * - Creates new version with latest code changes before deployment
 * - Creates new web app deployment for each execution to ensure latest code
 * - autoRedeploy=true (default): Always creates NEW VERSION + NEW DEPLOYMENT
 * - autoRedeploy=false: Uses existing deployment only (requires manual deployment)
 * 
 *  AUTOMATIC SHIM CODE CREATION:
 * - This tool AUTOMATICALLY creates __mcp_exec shim code if missing
 * - Provides dynamic code execution via Function constructor
 * - Enables execution of any JavaScript expression (e.g., fib(13), Math.PI * 2)
 * - Shim is added before deployment for zero-setup dynamic execution
 * 
 * WEB APP DEPLOYMENT BY DEFAULT:
 * - Creates web app deployments by default for doGet() proxy pattern
 * - Web app deployments support HTTP-based function execution
 * - Uses 'MYSELF' access level for secure authenticated execution
 * - Automatically configures proper entry points and access controls
 * 
 * FUNCTION EXECUTION PATTERN:
 * - This tool calls doGet() which handles dynamic JavaScript execution
 * - The target function/expression is executed via Function constructor
 * - Supports both function calls and JavaScript expressions
 * - Returns structured JSON responses with execution results
 * 
 * This tool provides zero-setup dynamic JavaScript execution with automatic infrastructure setup.
 * Perfect for web app scenarios with proper JSON serialization and fresh deployment guarantee.
 * 
 * Note: This is the primary exec implementation that creates fresh deployments. An alternative
 * implementation (GASHeadDeployTool) exists that checks for existing web app deployments first
 * and uses the most recent version, creating new ones only if none exist.
 * 
 * Requirements:
 * - Script project will be auto-deployed as Web App by default
 * - Execution shim (__mcp_exec) will be auto-added if missing
 * - Returns JSON responses that can be properly dehydrated/rehydrated
 * - Must have script.scriptapp OAuth scope
 */
export class ExecTool extends BaseTool {
  public name = 'exec';
  public description = 'ADVANCED: Execute JavaScript with explicit script ID. Use exec for normal workflow.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      environment: {
        type: 'string',
        enum: ['dev', 'staging', 'prod'],
        description: 'Execution environment (default: dev). dev=HEAD (latest), staging=snapshot, prod=stable.',
        default: 'dev',
        llmHints: {
          dev: 'HEAD (latest code, default)',
          staging: 'Latest snapshot version',
          prod: 'Stable production version'
        }
      },
      js_statement: {
        type: 'string',
        description: 'JavaScript to execute in GAS. Supports: ES6+ expressions, require("Module").func() for project code, all GAS services (DriveApp/SpreadsheetApp/etc), Logger.log() auto-captured. CommonJS resolves dependencies automatically.',
        minLength: 1,
        examples: ['Math.PI * 2', 'require("Utils").myFunc()', 'DriveApp.createFile("x","y").getId()'],
        llmHints: {
          capability: 'Full ES6+ JavaScript + ALL GAS services + CommonJS modules',
          projectFunctions: 'require("Module").func() calls your project code',
          logCapture: 'Logger.log() auto-captured | logFilter:"ERROR|WARN" | logTail:50',
          size: '500k chars max | 1hr timeout configurable'
        }
      },
      autoRedeploy: {
        type: 'boolean',
        description: 'Auto-deploy setup. true (default)=create as needed, false=use existing, "force"=always new. Set false for speed on pre-configured projects.',
        default: true,
        llmHints: {
          true: 'Auto-deploy (default, seamless)',
          false: 'Use existing deployment (faster)',
          force: 'Always create new deployment'
        }
      },
      executionTimeout: {
        type: 'number',
        description: 'Max execution timeout in seconds (default: 780=13min, max: 3600=1hr). Increase for long-running ops.',
        default: 780,
        minimum: 780,
        maximum: 3600,
        llmHints: {
          default: '13min (780s)',
          max: '1hr (3600s)',
          increase: 'For long-running ops'
        }
      },
      responseTimeout: {
        type: 'number', 
        description: 'Max response timeout in seconds (default: 780=13min, max: 3600=1hr). Increase for large payloads.',
        default: 780,
        minimum: 780,
        maximum: 3600,
        llmHints: {
          default: '13min (780s)',
          max: '1hr (3600s) for large data',
          increase: 'For large response payloads'
        }
      },
      ...SchemaFragments.accessToken,
      logFilter: {
        type: 'string',
        description: 'Optional regex to filter logger_output lines (ripgrep-style). Only matching lines included. Unspecified=all output.',
        examples: [
          'ERROR|WARN',           // Show only error/warning lines
          '^\\[.*\\]',             // Lines starting with brackets
          'TODO|FIXME',           // Show TODO/FIXME comments
          'result.*:',            // Lines with "result" followed by colon
        ]
      },
      logTail: {
        type: 'number',
        description: 'Optional: Return last N lines of logger_output. Useful for overwhelming logs. Applied after logFilter.',
        minimum: 1,
        maximum: 10000,
        examples: [10, 50, 100]
      }
    },
    required: ['scriptId', 'js_statement'],
    additionalProperties: false,
    llmWorkflowGuide: {
      prerequisites: ['auth if needed', 'scriptId from project_list'],
      limitations: '6min free | 30min workspace (adjust executionTimeout)',
      quickStart: ['Math.pow(2,10)', 'require("Calc").add(5,3)', 'DriveApp.getRootFolder().getName()']
    },
    responseSchema: {
      type: 'object',
      description: 'Response from raw_run execution with result and logger output',
      properties: {
        status: {
          type: 'string',
          enum: ['success', 'error'],
          description: 'Execution status indicator'
        },
        result: {
          description: 'The actual result of the JavaScript execution (any type)'
        },
        logger_output: {
          type: 'string',
          description: 'Logger output from console.log()/Logger.log(). May include filter metadata if logFilter/logTail used.'
        },
        scriptId: {
          type: 'string',
          description: 'The Google Apps Script project ID that was executed'
        },
        js_statement: {
          type: 'string',
          description: 'The JavaScript statement that was executed'
        },
        executedAt: {
          type: 'string',
          format: 'date-time',
          description: 'ISO timestamp of when the execution occurred'
        },
        error: {
          type: 'object',
          description: 'Error details (only when status="error")',
          properties: {
            type: { type: 'string', description: 'Error type' },
            message: { type: 'string', description: 'Error message' },
            originalError: { type: 'string', description: 'Original error if available' }
          }
        }
      },
      required: ['status', 'result', 'logger_output', 'scriptId', 'js_statement', 'executedAt']
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  /**
   * Try to get auth token without throwing errors (optimistic approach)
   */
  private async tryGetAuthToken(): Promise<string | null> {
    try {
      return await this.getAuthToken({});
    } catch (error: any) {
      // Return null if authentication fails, so we can try without auth first
      return null;
    }
  }

  /**
   * Environment tags for deployment identification (same as deployment.ts)
   */
  private readonly ENV_TAGS = {
    dev: '[DEV]',
    staging: '[STAGING]',
    prod: '[PROD]'
  } as const;

  /**
   * Find environment-specific deployment by description tag
   */
  private async findEnvironmentDeployment(
    scriptId: string,
    environment: 'dev' | 'staging' | 'prod',
    accessToken: string
  ): Promise<{ deploymentId: string; versionNumber: number | null; url: string | null } | null> {
    try {
      const deployments = await this.gasClient.listDeployments(scriptId, accessToken);
      const envTag = this.ENV_TAGS[environment];

      const deployment = deployments.find((d: any) => d.description?.includes(envTag));

      if (!deployment) {
        return null;
      }

      // Extract web app URL from deployment
      let url: string | null = null;
      if (deployment.entryPoints) {
        const webAppEntry = deployment.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        url = webAppEntry?.webApp?.url || null;
      }

      return {
        deploymentId: deployment.deploymentId,
        versionNumber: deployment.versionNumber || null,
        url
      };
    } catch (error: any) {
      console.error(`[ENV LOOKUP] Failed to find ${environment} deployment: ${error.message}`);
      return null;
    }
  }

  async execute(params: any): Promise<any> {
    // Optimistic approach: validate inputs first, then try without authentication
    const scriptId = this.validate.scriptId(params.scriptId, 'dynamic JS execution');
    const environment = this.validate.enum(
      params.environment || 'dev',
      'environment',
      ['dev', 'staging', 'prod'],
      'code execution'
    );
    const js_statement = this.validate.string(params.js_statement, 'JavaScript statement');
    const autoRedeploy = params.autoRedeploy !== false;
    const executionTimeout = Math.min(Math.max(params.executionTimeout || 780, 780), 3600); // 13m-1h range
    const responseTimeout = Math.min(Math.max(params.responseTimeout || 780, 780), 3600); // 13m-1h range
    const logFilter = params.logFilter; // Optional regex pattern for filtering logs
    const logTail = params.logTail; // Optional number of lines to show from end

    if (!js_statement?.trim()) {
      throw new ValidationError('js_statement', js_statement, 'non-empty JavaScript statement');
    }

    // Try operation first with provided access token (if any) or session auth
    let accessToken: string | null = null;

    try {
      // First try: Use provided token or attempt to get from session (optimistic)
      accessToken = params.accessToken || await this.tryGetAuthToken();

      // ENVIRONMENT-AWARE EXECUTION: Look up environment-specific deployment
      let envDeployment = null;
      if (accessToken) {
        console.error(`[ENV EXECUTION] Looking up ${environment} deployment for execution...`);
        envDeployment = await this.findEnvironmentDeployment(scriptId, environment, accessToken);

        if (envDeployment) {
          console.error(`[ENV EXECUTION] Found ${environment} deployment: ${envDeployment.deploymentId} (version: ${envDeployment.versionNumber || 'HEAD'})`);
        } else {
          console.error(`[ENV EXECUTION] No ${environment} deployment found, falling back to default behavior`);
        }
      }

      // PERFORMANCE OPTIMIZATION: Optimistic execution with cached infrastructure
      return await this.executeOptimistic(
        scriptId,
        js_statement,
        accessToken || '',
        executionTimeout,
        responseTimeout,
        autoRedeploy,
        logFilter,
        logTail,
        environment,
        envDeployment
      );
    } catch (error: any) {
      // Check for authentication errors (401/403)
      const statusCode = error.statusCode || error.response?.status || error.data?.statusCode;
      
      if (statusCode === 401 || statusCode === 403) {
        // Include detailed HTTP response information in the error
        const httpDetails = {
          statusCode,
          statusText: error.response?.statusText || (statusCode === 401 ? 'Unauthorized' : 'Forbidden'),
          url: error.response?.url || 'Unknown URL',
          headers: error.response?.headers ? Object.fromEntries(error.response.headers.entries()) : {},
          responseBody: error.response?.text || error.message
        };

        const authError = new AuthenticationError(
          `Authentication required for exec operation (HTTP ${statusCode}). Use auth(mode="start") to authenticate and retry.`
        );
        
        // Add HTTP response details to error data
        authError.data = {
          ...authError.data,
          statusCode,
          operation: 'exec',
          scriptId,
          httpResponse: httpDetails,
          instructions: [
            'Use auth with mode="start" to begin authentication',
            'Complete the OAuth flow in your browser',
            'Then retry your exec request'
          ],
          command: 'auth({"mode": "start"})',
          statusCheck: 'auth({"mode": "status"})'
        };
        
        throw authError;
      }
      
      // 🔍 PERFORMANCE: Check infrastructure before expensive setup
      if (this.needsInfrastructureSetup(error) && autoRedeploy) {
        // For infrastructure setup, we definitely need authentication
        if (!accessToken) {
          throw new AuthenticationError(
            `Authentication required for infrastructure setup. Use auth(mode="start") to authenticate first.`
          );
        }
        
        // Check if we have cached deployment URL (indicates infrastructure exists)
        const hasCachedUrl = this.sessionAuthManager ? 
          await this.sessionAuthManager.getCachedDeploymentUrl(scriptId) : null;
        
        if (hasCachedUrl) {
          console.error(`⚡ [OPTIMISTIC RETRY] Infrastructure exists (cached URL found), retrying without setup...`);
          // Try one more time before full infrastructure setup
          try {
            return await this.executeOptimistic(scriptId, js_statement, accessToken, executionTimeout, responseTimeout, autoRedeploy, logFilter, logTail, environment, null);
          } catch (retryError: any) {
            console.error(`[OPTIMISTIC RETRY FAILED] Proceeding with infrastructure setup: ${retryError.message}`);
          }
        }
        
        if (!autoRedeploy) {
          // Return structured error response with logger output if available
          return {
            status: 'error',
            scriptId,
            js_statement,
            error: {
              type: 'AutoRedeployDisabled',
              message: `Execution failed and autoRedeploy is disabled. ${error.message}`,
              originalError: error.message
            },
            logger_output: error.loggerOutput || '',
            executedAt: new Date().toISOString()
          };
        }
        
        // Set up infrastructure and retry
        console.error(`[INFRASTRUCTURE SETUP] Setting up deployment infrastructure...`);
        await setupInfrastructure(this.gasClient, scriptId, accessToken, this.sessionAuthManager);
        
        // NEW: Retry logic for deployment delays with test function validation
        return await this.executeWithDeploymentRetry(scriptId, js_statement, accessToken, executionTimeout, responseTimeout, logFilter, logTail, environment);
      }
      // Return structured error response with logger output if available
      return {
        status: 'error',
        scriptId,
        js_statement,
        error: {
          type: error.name || 'ExecutionError',
          message: error.message,
          statusCode: error.statusCode || 500
        },
        logger_output: error.loggerOutput || '',
        executedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Execute with retry logic for deployment delays
   * Tests with a simple function first, then retries the actual function
   */
  private async executeWithDeploymentRetry(
    scriptId: string,
    js_statement: string,
    accessToken: string,
    executionTimeout: number = 780,
    responseTimeout: number = 780,
    logFilter?: string,
    logTail?: number,
    environment: 'dev' | 'staging' | 'prod' = 'dev'
  ): Promise<any> {
    const maxRetryDuration = 60000; // 60 seconds total
    const retryInterval = 2000; // 2 seconds between retries
    const startTime = Date.now();

    console.error(`[DEPLOYMENT RETRY] Starting retry logic for potential deployment delay`);
    console.error(`   Script ID: ${scriptId}`);
    console.error(`   Max retry duration: ${maxRetryDuration}ms`);
    console.error(`   Retry interval: ${retryInterval}ms`);

    while (Date.now() - startTime < maxRetryDuration) {
      try {
        // First try the actual function
        return await this.executeOptimistic(scriptId, js_statement, accessToken, executionTimeout, responseTimeout, true, logFilter, logTail, environment, null);
      } catch (error: any) {
        const statusCode = error.statusCode || error.response?.status;
        
        // Only retry for HTTP 500 errors (deployment not ready)
        if (statusCode === 500) {
          const elapsedTime = Date.now() - startTime;
          console.error(`[DEPLOYMENT RETRY] HTTP ${statusCode} error, testing deployment readiness`);
          console.error(`   Elapsed time: ${elapsedTime}ms`);
          console.error(`   Error: ${error.message}`);
          
          // Test if deployment is ready with a simple function that requests JSON
          try {
            console.error(`[DEPLOYMENT TEST] Testing deployment with doGet function - requesting JSON response`);
            await this.executeOptimisticWithJsonRequest(scriptId, 'new Date().toISOString()', accessToken, executionTimeout, responseTimeout);
            console.error(`[DEPLOYMENT TEST] Test function succeeded with HTTP 200, deployment is ready`);
            
            // Deployment is ready, try the actual function one more time
            try {
              return await this.executeOptimistic(scriptId, js_statement, accessToken, executionTimeout, responseTimeout, true, logFilter, logTail, environment, null);
            } catch (actualError: any) {
              console.error(`[DEPLOYMENT RETRY] Actual function still failed after test succeeded`);
              console.error(`   Error: ${actualError.message}`);
              throw actualError;
            }
          } catch (testError: any) {
            const testStatusCode = testError.statusCode || testError.response?.status;
            console.error(`[DEPLOYMENT TEST] Test function result: HTTP ${testStatusCode} - ${testError.message}`);
            
            // If we got HTTP 200, consider it successful and retry original function
            if (testStatusCode === 200) {
              console.error(`[DEPLOYMENT TEST] HTTP 200 received, deployment is ready - retrying original function`);
              try {
                return await this.executeOptimistic(scriptId, js_statement, accessToken, executionTimeout, responseTimeout, true, logFilter, logTail, environment, null);
              } catch (actualError: any) {
                console.error(`[DEPLOYMENT RETRY] Original function failed even after HTTP 200 test: ${actualError.message}`);
                throw actualError;
              }
            } else if (testStatusCode === 500) {
              // Still not ready, wait and retry
              if (Date.now() - startTime + retryInterval < maxRetryDuration) {
                console.error(`[DEPLOYMENT RETRY] HTTP ${testStatusCode} - deployment not ready, waiting ${retryInterval}ms before retry`);
                await new Promise(resolve => setTimeout(resolve, retryInterval));
                continue;
              } else {
                console.error(`[DEPLOYMENT RETRY] Timeout reached, deployment still returning HTTP ${testStatusCode}`);
                throw new Error(`Deployment timeout: Google Apps Script project not ready after ${maxRetryDuration}ms. Last error: ${error.message}`);
              }
            } else {
              // Different error, stop retrying
              console.error(`[DEPLOYMENT TEST] Test function failed with HTTP ${testStatusCode} error: ${testError.message}`);
              throw testError;
            }
          }
        } else {
          // Not a 500 error, don't retry
          console.error(`[DEPLOYMENT RETRY] HTTP ${statusCode} error - not retrying: ${error.message}`);
          throw error;
        }
      }
    }
    
    // Should not reach here, but just in case
    throw new Error(`Deployment timeout: Maximum retry duration of ${maxRetryDuration}ms exceeded`);
  }

  // Special version for deployment testing that explicitly requests JSON
  private async executeOptimisticWithJsonRequest(scriptId: string, js_statement: string, accessToken: string, executionTimeout: number = 780, responseTimeout: number = 780): Promise<any> {
    const executionUrl = await this.gasClient.constructGasRunUrl(scriptId, accessToken);
    const startTime = Date.now();
    
    // CONFIGURABLE TIMEOUT: Add timeout protection with user-defined timeout  
    const abortController = new AbortController();
    const timeoutMs = executionTimeout * 1000; // Convert seconds to milliseconds
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      // ADD FUNCTION PARAMETER: Add the js_statement as a func parameter
      // IMPORTANT: Properly URL-encode the parameter to handle special characters like +, &, =, etc.
      // ADD MCP_RUN PARAMETER: Signal to __mcp_exec handler via URI-based routing
      const separator = executionUrl.includes('?') ? '&' : '?';
      const encodedJsStatement = encodeURIComponent(js_statement);
      const finalUrl = `${executionUrl}${separator}_mcp_run=true&func=${encodedJsStatement}`;
      
      // Enhanced request headers
      const requestHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'MCP-GAS-Server/1.0.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      
      // PERFORMANCE OPTIMIZATION: Reduce logging for repeated calls
      const isFromCache = executionUrl.includes('cached'); // Simple heuristic
      const shouldVerboseLog = !isFromCache || process.env.MCP_GAS_VERBOSE_LOGGING === 'true';
      
      if (shouldVerboseLog) {
        // ENHANCED DEBUG LOG - Show URL and headers before request
        const debugInfo = {
          timestamp: new Date().toISOString(),
          operation: 'DEPLOYMENT_TEST',
          scriptId: scriptId,
          jsStatement: js_statement,
          baseUrl: executionUrl,
          originalUrl: finalUrl,
          testUrl: finalUrl,
          urlConversion: finalUrl !== executionUrl ? '/exec → /dev' : 'no conversion needed',
          requestHeaders: {
            ...requestHeaders,
            'Authorization': `Bearer ${accessToken.substring(0, 10)}...***`
          },
          redirectPolicy: 'follow (automatic)',
          timeout: '30 seconds',
          requestStart: new Date().toISOString()
        };
        
        console.error(`[DEPLOYMENT_TEST ENHANCED DEBUG] Pre-request information:\n${JSON.stringify(debugInfo, null, 2)}`);
      } else {
        console.error(`⚡ [DEPLOYMENT_TEST FAST] Executing: ${js_statement} on cached deployment`);
      }
      
      // AUTOMATIC REDIRECT: Use native browser redirect handling with JSON Accept header
      const response = await fetch(finalUrl, {
        headers: requestHeaders,
        signal: abortController.signal,
        redirect: 'follow' // Automatically follow redirects
      });
      
      // Build complete headers object for logging
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      
      const fetchDuration = Date.now() - startTime;
      const contentType = response.headers.get('content-type') || 'Unknown';
      
      // Enhanced response logging with HTTP codes
      const responseDebugInfo = {
        httpStatus: `HTTP ${response.status} ${response.statusText}`,
        duration: `${fetchDuration}ms`,
        finalUrl: response.url,
        contentType: contentType,
        responseHeaders: responseHeaders,
        redirectsFollowed: response.url !== finalUrl ? 'YES' : 'NO',
        responseTime: new Date().toISOString()
      };
      
      console.error(`[DEPLOYMENT_TEST RESPONSE] HTTP response details:\n${JSON.stringify(responseDebugInfo, null, 2)}`);
      
      if (!response.ok) {
        let errorBody = '';
        try {
          errorBody = await response.text();
        } catch (bodyError) {
          errorBody = `[Failed to read error body: ${bodyError}]`;
        }
        
        // ENHANCED ERROR DEBUG with HTTP codes
        const errorDebugInfo = {
          httpStatus: `HTTP ${response.status} ${response.statusText}`,
          duration: `${fetchDuration}ms`,
          finalUrl: response.url,
          contentType: contentType,
          responseHeaders: responseHeaders,
          errorBody: errorBody || '(empty)',
          bodyLength: errorBody.length,
          errorTime: new Date().toISOString(),
          bearerTokenSent: `Bearer ${accessToken.substring(0, 10)}...*** (CONFIRMED SENT)`
        };
        
        console.error(`[DEPLOYMENT_TEST ERROR] HTTP ${response.status} error details:\n${JSON.stringify(errorDebugInfo, null, 2)}`);
        
        const error = new Error(`HTTP ${response.status}: ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
        (error as any).statusCode = response.status;
        throw error;
      }
      
      // If we reach here, we got HTTP 200 - deployment is ready
      clearTimeout(timeoutId);
      console.error(`[DEPLOYMENT_TEST SUCCESS] HTTP ${response.status} - Deployment is ready`);
      
      return {
        status: 'deployment_ready',
        httpStatus: response.status,
        message: 'Deployment test successful'
      };
      
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Deployment test timeout after ${executionTimeout} seconds`);
        (timeoutError as any).statusCode = 408;
        throw timeoutError;
      }
      throw error;
    }
  }

  private needsInfrastructureSetup(error: any): boolean {
    const statusCode = error.statusCode || error.data?.statusCode || error.response?.status;
    const isHtmlError = error.message?.includes('Web app returned HTML error page');
    return [404, 403, 500].includes(statusCode) || isHtmlError;
  }

  private async executeOptimistic(
    scriptId: string,
    js_statement: string,
    accessToken: string,
    executionTimeout: number = 780,
    responseTimeout: number = 780,
    autoRedeploy: boolean = true,
    logFilter?: string,
    logTail?: number,
    environment: 'dev' | 'staging' | 'prod' = 'dev',
    envDeployment: { deploymentId: string; versionNumber: number | null; url: string | null } | null = null
  ): Promise<any> {
    const startTime = Date.now();

    // ENVIRONMENT-AWARE URL: Use environment deployment URL if available
    let executionUrl: string | null = null;

    if (envDeployment && envDeployment.url) {
      // Use the environment-specific deployment URL directly
      executionUrl = envDeployment.url;
      console.error(`🎯 [ENV URL] Using ${environment} deployment URL: ${executionUrl} (version: ${envDeployment.versionNumber || 'HEAD'})`);
    } else {
      // PERFORMANCE OPTIMIZATION: Check cached deployment URL first
      if (this.sessionAuthManager) {
        try {
          executionUrl = await this.sessionAuthManager.getCachedDeploymentUrl(scriptId);
          if (executionUrl) {
            console.error(`⚡ [CACHE HIT] Using cached deployment URL for ${scriptId}: ${executionUrl}`);
          }
        } catch (cacheError: any) {
          console.error(`[CACHE] Failed to check cached URL: ${cacheError.message}`);
        }
      }

      // If no cached URL, construct it (this is the expensive operation)
      if (!executionUrl) {
        console.error(`[CACHE MISS] Constructing deployment URL for ${scriptId}...`);
        const urlConstructionStart = Date.now();
        executionUrl = await this.gasClient.constructGasRunUrl(scriptId, accessToken);
        const urlConstructionTime = Date.now() - urlConstructionStart;
        console.error(`[URL CONSTRUCTION] Completed in ${urlConstructionTime}ms`);

        // Cache the URL for future use
        if (this.sessionAuthManager && executionUrl) {
          try {
            await this.sessionAuthManager.setCachedDeploymentUrl(scriptId, executionUrl);
            console.error(`💾 [CACHE STORE] Deployment URL cached for future calls`);
          } catch (cacheError: any) {
            console.error(`[CACHE] Failed to store URL: ${cacheError.message}`);
          }
        }
      }
    }
    
    // CONFIGURABLE TIMEOUT: Add timeout protection with user-defined timeout
    const abortController = new AbortController();
    const timeoutMs = executionTimeout * 1000; // Convert seconds to milliseconds
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      // ADD FUNCTION PARAMETER: Add the js_statement as a func parameter
      // IMPORTANT: Properly URL-encode the parameter to handle special characters like +, &, =, etc.
      // ADD MCP_RUN PARAMETER: Signal to __mcp_exec handler via URI-based routing
      const separator = executionUrl.includes('?') ? '&' : '?';
      const encodedJsStatement = encodeURIComponent(js_statement);
      const finalUrl = `${executionUrl}${separator}_mcp_run=true&func=${encodedJsStatement}`;
      
      // Enhanced request headers
      const requestHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'MCP-GAS-Server/1.0.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      
      // PERFORMANCE OPTIMIZATION: Reduce logging for repeated calls
      const isFromCache = executionUrl.includes('cached'); // Simple heuristic
      const shouldVerboseLog = !isFromCache || process.env.MCP_GAS_VERBOSE_LOGGING === 'true';
      
      if (shouldVerboseLog) {
        // ENHANCED DEBUG LOG - Show URL and headers before request
        const debugInfo = {
          timestamp: new Date().toISOString(),
          operation: 'GAS_RUN_EXECUTION',
          scriptId: scriptId,
          jsStatement: js_statement,
          baseUrl: executionUrl,
          finalUrl: finalUrl,
          urlConversion: executionUrl.includes('/exec') ? 
            `${executionUrl} → ${finalUrl.replace('/exec', '/dev')} (if redirected)` : 
            'no conversion needed',
          requestHeaders: {
            ...requestHeaders,
            'Authorization': `Bearer ${accessToken.substring(0, 10)}...***`
          },
          redirectPolicy: 'follow (automatic)',
          timeout: '30 seconds',
          requestStart: new Date().toISOString()
        };
        
        console.error(`[GAS_RUN ENHANCED DEBUG] Pre-request information:\n${JSON.stringify(debugInfo, null, 2)}`);
      } else {
        console.error(`⚡ [GAS_RUN FAST] Executing: ${js_statement} on cached deployment`);
      }
      
      // AUTOMATIC REDIRECT HANDLING: Let fetch handle redirects automatically
      const response = await fetch(finalUrl, {
        headers: requestHeaders,
        signal: abortController.signal,
        redirect: 'follow' // Automatically follow redirects
      });
      
      // Build complete headers object for logging
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      
      const fetchDuration = Date.now() - startTime;
      const contentType = response.headers.get('content-type') || 'Unknown';
      
      // Enhanced response logging with HTTP codes and redirect detection
      const responseDebugInfo = {
        httpStatus: `HTTP ${response.status} ${response.statusText}`,
        duration: `${fetchDuration}ms`,
        finalUrl: response.url,
        redirectsFollowed: response.url !== finalUrl ? 'YES' : 'NO',
        urlConversion: response.url !== finalUrl ? 
          `${finalUrl} → ${response.url}` : 'no redirect',
        contentType: contentType,
        responseHeaders: responseHeaders,
        responseTime: new Date().toISOString()
      };
      
      console.error(`[GAS_RUN RESPONSE] HTTP response details:\n${JSON.stringify(responseDebugInfo, null, 2)}`);
      
      // Check for 302/200/500 responses with non-JSON content (requires cookie auth)
      // BUT exclude responses that contain JavaScript execution errors 
      if ((response.status === 302 || response.status === 200 || response.status === 500) && !contentType.includes('application/json')) {
        // Read response body to check if it's a domain auth page or execution error
        const responseBodyCheck = await response.clone().text();
        
        // CRITICAL: Distinguish domain auth from execution errors
        const isExecutionError = responseBodyCheck.includes('ReferenceError:') || 
                                 responseBodyCheck.includes('SyntaxError:') ||
                                 responseBodyCheck.includes('TypeError:') ||
                                 responseBodyCheck.includes('Error:') ||
                                 responseBodyCheck.includes('(line ') ||
                                 responseBodyCheck.includes('file "');
        
        if (isExecutionError) {
          console.error(`[EXECUTION ERROR] HTTP ${response.status} contains JavaScript error - returning error response instead of domain auth`);
          
          // Return execution error as structured response (don't trigger domain auth)
          return {
            status: 'error', // Correctly mark as error since execution failed
            scriptId,
            js_statement,
            error: {
              type: 'EXECUTION_ERROR',
              message: responseBodyCheck.includes('ReferenceError:') ? 
                        responseBodyCheck.split('ReferenceError:')[1].split('\n')[0].trim() :
                        responseBodyCheck.includes('SyntaxError:') ?
                        responseBodyCheck.split('SyntaxError:')[1].split('\n')[0].trim() :
                        'JavaScript execution error',
              statusCode: response.status,
              context: 'execution',
              function_called: js_statement,
              accessed_url: response.url,
              url_type: response.url.endsWith('/dev') ? 'HEAD deployment (testing)' : 'Unknown deployment type',
              debug_info: {
                timestamp: new Date().toISOString(),
                deployment_mode: 'development',
                httpStatus: response.status,
                errorSource: 'project_initialization'
              }
            },
            logger_output: '',
            executedAt: new Date().toISOString()
          };
        }
        
        console.error(`[COOKIE AUTH REQUIRED] HTTP ${response.status} with non-JSON response - calling exec_auth`);

        try {
          // Call performDomainAuth to handle domain authorization
          await performDomainAuth(this.gasClient, scriptId, accessToken);
          
          // After cookie auth, try the request again
          console.error(`[COOKIE AUTH] Retrying request after domain authorization`);
          const retryResponse = await fetch(finalUrl, {
            headers: requestHeaders,
            signal: abortController.signal,
            redirect: 'follow'
          });
          
          // Continue processing with the retry response
          const retryResponseHeaders: Record<string, string> = {};
          retryResponse.headers.forEach((value, key) => {
            retryResponseHeaders[key] = value;
          });
          
          const retryContentType = retryResponse.headers.get('content-type') || 'Unknown';
          
          if (!retryResponse.ok) {
            const errorBody = await retryResponse.text();
            const error = new Error(`HTTP ${retryResponse.status}: ${retryResponse.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
            (error as any).statusCode = retryResponse.status;
            throw error;
          }
          
          // Process the retry response body
          let retryResult: any;
          let retryResponseText = '';
          let retryIsJson = false;
          
          if (retryContentType.includes('application/json')) {
            retryResult = await retryResponse.json();
            retryIsJson = true;
          } else {
            retryResponseText = await retryResponse.text();
            try {
              retryResult = JSON.parse(retryResponseText);
              retryIsJson = true;
            } catch {
              retryResult = retryResponseText;
            }
          }
          
          // Clear timeout and return success
          clearTimeout(timeoutId);

          // Extract logger output from retry result if it exists
          const retryLoggerOutput = (retryResult && typeof retryResult === 'object' && retryResult.logger_output) || '';

          // Apply log filtering before protecting response size
          const { filteredOutput, metadata } = filterLoggerOutput(
            retryLoggerOutput,
            logFilter,
            logTail
          );

          return protectResponseSize({
            status: 'success',
            scriptId,
            js_statement,
            result: retryResult && typeof retryResult === 'object' && retryResult.result !== undefined ? retryResult.result : retryResult,
            logger_output: filteredOutput + metadata,
            executedAt: new Date().toISOString(),
            environment: environment,
            versionNumber: envDeployment?.versionNumber || null,
            cookieAuthUsed: true,
            ide_url_hint: `${executionUrl}?_mcp_run=true&action=auth_ide`
          });
          
        } catch (authError: any) {
          console.error(`[COOKIE AUTH] Domain authorization failed: ${authError.message} - continuing without cookie auth`);
          // Fall through to normal error handling
        }
      }
      
      if (!response.ok) {
        let errorBody = '';
        try {
          errorBody = await response.text();
        } catch (bodyError) {
          errorBody = `[Failed to read error body: ${bodyError}]`;
        }
        
        // Try to parse error body as JSON to extract logger output
        let loggerOutput = '';
        try {
          const errorJson = JSON.parse(errorBody);
          if (errorJson.logger_output) {
            loggerOutput = errorJson.logger_output;
          }
        } catch {
          // Not JSON, continue without logger output
        }
        
        // ENHANCED ERROR DEBUG with HTTP codes
        const errorDebugInfo = {
          httpStatus: `HTTP ${response.status} ${response.statusText}`,
          duration: `${fetchDuration}ms`,
          finalUrl: response.url,
          contentType: contentType,
          responseHeaders: responseHeaders,
          errorBody: errorBody || '(empty)',
          bodyLength: errorBody.length,
          errorTime: new Date().toISOString(),
          bearerTokenSent: `Bearer ${accessToken.substring(0, 10)}...*** (CONFIRMED SENT)`
        };
        
        console.error(`[GAS_RUN ERROR] HTTP ${response.status} error details:\n${JSON.stringify(errorDebugInfo, null, 2)}`);
        
        const error = new Error(`HTTP ${response.status}: ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
        (error as any).statusCode = response.status;
        (error as any).statusText = response.statusText;
        (error as any).response = {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          url: response.url,
          body: errorBody
        };
        (error as any).responseBody = errorBody;
        (error as any).loggerOutput = loggerOutput;
        (error as any).config = {
          url: executionUrl,
          method: 'GET'
        };
        throw error;
      }
      
      // HANGING FIX: Keep timeout active during response reading with separate timeout
      // Use Promise.race to ensure response.text() doesn't hang indefinitely
      const responseStartTime = Date.now();
      
      let result: any;
      let responseText = '';
      let isJson = false;
      try {
        if (contentType.includes('application/json')) {
          // Try to parse as JSON directly
          result = await Promise.race([
            response.json(),
            new Promise<never>((_, reject) => {
              setTimeout(() => {
                reject(new Error(`Response body reading timeout after ${responseTimeout} seconds`));
              }, responseTimeout * 1000);
            })
          ]);
          isJson = true;
          responseText = JSON.stringify(result);
        } else {
          // Fallback to text
          responseText = await Promise.race([
            response.text(),
            new Promise<never>((_, reject) => {
              setTimeout(() => {
                reject(new Error(`Response body reading timeout after ${responseTimeout} seconds`));
              }, responseTimeout * 1000);
            })
          ]);
          try {
            result = JSON.parse(responseText);
            isJson = true;
          } catch {
            isJson = false;
          }
        }
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
      
      const responseReadDuration = Date.now() - responseStartTime;
      const totalDuration = Date.now() - startTime;
      
      // Only clear timeout after complete response processing
      clearTimeout(timeoutId);
      
      // Parse response
      if (!isJson) {
        if (responseText.includes('DOCTYPE html') || responseText.includes('<html')) {
          // ENHANCED HTML ERROR DEBUG with HTTP codes
          const htmlErrorDebugInfo = {
            httpStatus: `HTTP ${response.status} ${response.statusText}`,
            finalUrl: response.url,
            contentType: contentType,
            responseHeaders: responseHeaders,
            htmlPreview: responseText.substring(0, 200) + '...',
            totalDuration: `${totalDuration}ms`,
            errorTime: new Date().toISOString(),
            bearerTokenSent: `Bearer ${accessToken.substring(0, 10)}...*** (CONFIRMED SENT)`,
            diagnosis: 'Web app returned HTML error page instead of JSON - likely deployment not ready'
          };
          
          console.error(`[GAS_RUN HTML ERROR] HTTP ${response.status} - Web app returned HTML instead of JSON:\n${JSON.stringify(htmlErrorDebugInfo, null, 2)}`);
          
          const error = new Error('Web app returned HTML error page instead of JSON');
          (error as any).statusCode = 500; // Treat as deployment not ready - triggers retry logic
          throw error;
        }
        result = responseText;
      }
      
      // ENHANCED SUCCESS DEBUG with HTTP codes
      const successDebugInfo = {
        httpStatus: `HTTP ${response.status} ${response.statusText}`,
        payloadReadDuration: `${responseReadDuration}ms`,
        totalRequestDuration: `${totalDuration}ms`,
        finalUrl: response.url,
        contentType: contentType,
        responseHeaders: responseHeaders,
        responsePayload: responseText,
        payloadLength: responseText.length,
        payloadType: isJson ? 'JSON' : 'Text',
        successTime: new Date().toISOString(),
        bearerTokenSent: `Bearer ${accessToken.substring(0, 10)}...*** (CONFIRMED SENT)`
      };
      
      console.error(`[GAS_RUN SUCCESS] HTTP ${response.status} success details:\n${JSON.stringify(successDebugInfo, null, 2)}`);
      
      // Handle structured response format {type: "data"|"exception", payload: ...}
      if (result && typeof result === 'object' && result.type) {
        if (result.type === 'data') {

          // Apply log filtering before protecting response size
          const { filteredOutput, metadata } = filterLoggerOutput(
            result.logger_output || '',
            logFilter,
            logTail
          );


          return protectResponseSize({
            status: 'success',
            scriptId,
            js_statement,
            result: result.payload,
            logger_output: filteredOutput + metadata,
            executedAt: new Date().toISOString(),
            environment: environment,
            versionNumber: envDeployment?.versionNumber || null,
            ide_url_hint: `${executionUrl}?_mcp_run=true&action=auth_ide`
          });
        } else if (result.type === 'exception') {
          const error = new Error(result.payload.error.message);
          error.name = result.payload.error.name || 'FunctionExecutionError';
          throw error;
        }
      }

      // Extract logger output from the result if it exists
      const loggerOutput = (result && typeof result === 'object' && result.logger_output) || '';

      // Apply log filtering before protecting response size
      const { filteredOutput, metadata } = filterLoggerOutput(
        loggerOutput,
        logFilter,
        logTail
      );


      // Return simple success response with logger output
      return protectResponseSize({
        status: 'success',
        scriptId,
        js_statement,
        result: result && typeof result === 'object' && result.result !== undefined ? result.result : result,
        logger_output: filteredOutput + metadata,
        executedAt: new Date().toISOString(),
        environment: environment,
        versionNumber: envDeployment?.versionNumber || null,
        ide_url_hint: `${executionUrl}?_mcp_run=true&action=auth_ide`
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      // Clear timeout on any error
      clearTimeout(timeoutId);
      
      // ENHANCED ERROR DEBUG with HTTP codes
      const catchErrorDebugInfo = {
        timestamp: new Date().toISOString(),
        scriptId: scriptId,
        jsStatement: js_statement,
        errorType: error.name || 'Unknown',
        errorMessage: error.message,
        httpStatus: error.statusCode ? `HTTP ${error.statusCode} ${error.statusText || ''}` : 'No HTTP status',
        duration: `${duration}ms`,
        bearerTokenSent: `Bearer ${accessToken.substring(0, 10)}...*** (CONFIRMED SENT)`
      };
      
      console.error(`💥 [GAS_RUN CATCH ERROR] Complete error information:\n${JSON.stringify(catchErrorDebugInfo, null, 2)}`);
      
      // Handle timeout specifically
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Request timeout: Google Apps Script did not respond within ${executionTimeout} seconds`);
        (timeoutError as any).statusCode = 408;
        (timeoutError as any).loggerOutput = error.loggerOutput || '';
        throw timeoutError;
      }
      
      // Handle response reading timeout
      if (error.message?.includes('Response body reading timeout')) {
        const timeoutError = new Error(`Response reading timeout: Google Apps Script response body took longer than ${responseTimeout} seconds to read`);
        (timeoutError as any).statusCode = 408;
        (timeoutError as any).loggerOutput = error.loggerOutput || '';
        throw timeoutError;
      }
      
      // Preserve logger output in re-thrown errors
      if (error.loggerOutput) {
        (error as any).loggerOutput = error.loggerOutput;
      }
      
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Handle domain authorization for Google Apps Script web apps
   * Makes a test request to the /dev endpoint and launches browser if cookie auth is needed
   */
  private async exec_auth(scriptId: string, accessToken: string): Promise<void> {
    console.error(`[GAS_RUN_AUTH] Starting domain authorization for script: ${scriptId}`);
    
    try {
      // Get the base deployment URL
      const baseUrl = await this.gasClient.constructGasRunUrl(scriptId, accessToken);
      
      // Ensure it ends with /dev for the test request
      const testUrl = baseUrl.replace('/exec', '/dev');
      
      console.error(`[GAS_RUN_AUTH] Testing domain authorization with URL: ${testUrl}`);
      
      // Make a test request without any func parameter
      const response = await fetch(testUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'MCP-GAS-Server/1.0.0',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        redirect: 'follow'
      });
      
      const contentType = response.headers.get('content-type') || '';
      
      console.error(`[GAS_RUN_AUTH] Test response: HTTP ${response.status}, Content-Type: ${contentType}`);
      
      // Check if we need cookie authentication
      if ((response.status === 302 || response.status === 200) && !contentType.includes('application/json')) {
        console.error(`[GAS_RUN_AUTH] Cookie authentication required - launching browser and polling`);
        
        const authInfo = {
          httpStatus: `HTTP ${response.status} ${response.statusText}`,
          finalUrl: response.url,
          contentType: contentType,
          authAction: 'Launching browser for domain authorization',
          pollingStrategy: 'Will poll for JSON response with test function'
        };
        
        console.error(`[GAS_RUN_AUTH] Browser authentication details:\n${JSON.stringify(authInfo, null, 2)}`);
        
        // Create browser URL with auth IDE action (shows IDE interface after auth)
        const browserUrl = `${response.url}${response.url.includes('?') ? '&' : '?'}_mcp_run=true&action=auth_ide`;

        // Launch browser with the auth IDE URL
        console.error(`[GAS_RUN_AUTH] Opening browser for domain authorization: ${browserUrl}`);
        await open(browserUrl);
        
        // Poll for successful authorization
        await this.pollForDomainAuthorization(testUrl, accessToken);
        
      } else if (response.status === 200 && contentType.includes('application/json')) {
        console.error(`[GAS_RUN_AUTH] Domain already authorized - JSON response received`);
      } else {
        console.error(`[GAS_RUN_AUTH] Unexpected response: HTTP ${response.status}, continuing anyway`);
      }
      
         } catch (error: any) {
       console.error(`[GAS_RUN_AUTH] Domain authorization test failed: ${error.message}`);
       throw new Error(`Domain authorization failed: ${error.message}`);
     }
   }

  /**
   * Poll for domain authorization completion using action=auth_check
   * Makes requests to /dev?action=auth_check&format=json until authorized status received
   * Browser uses action=auth_ide to show IDE interface after auth
   */
  private async pollForDomainAuthorization(baseUrl: string, accessToken: string): Promise<void> {
    const maxPollDuration = 60000; // 60 seconds total
    const pollInterval = 3000; // 3 seconds between polls
    const startTime = Date.now();
    
    // Poll with lightweight auth check action (no execution)
    const testUrl = `${baseUrl}?_mcp_run=true&action=auth_check&format=json`;
    
    console.error(`[DOMAIN_AUTH_POLL] Starting authorization polling`);
    console.error(`   Test URL: ${baseUrl}?action=auth_check&format=json`);
    console.error(`   Max duration: ${maxPollDuration}ms`);
    console.error(`   Poll interval: ${pollInterval}ms`);
    
    let pollCount = 0;
    
    while (Date.now() - startTime < maxPollDuration) {
      pollCount++;
      const elapsedTime = Date.now() - startTime;
      
      try {
        console.error(`[DOMAIN_AUTH_POLL] Poll #${pollCount} (${elapsedTime}ms elapsed)`);
        
        const pollResponse = await fetch(testUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': 'MCP-GAS-Server/1.0.0',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          redirect: 'follow'
        });
        
        const pollContentType = pollResponse.headers.get('content-type') || '';
        
        console.error(`[DOMAIN_AUTH_POLL] Poll #${pollCount} response: HTTP ${pollResponse.status}, Content-Type: ${pollContentType}`);
        
        // Check for successful JSON response
        if (pollResponse.status === 200 && pollContentType.includes('application/json')) {
          try {
            const pollResult = await pollResponse.json();
            
            // Check for authorized status from auth_check action
            if (pollResult.status === 'authorized') {
              console.error(`[DOMAIN_AUTH_POLL] Success! Domain authorization completed in ${elapsedTime}ms`);
              console.error(`   Poll result: ${JSON.stringify(pollResult)}`);
              return;
            } else {
              console.error(`[DOMAIN_AUTH_POLL] Got JSON but unexpected result: ${JSON.stringify(pollResult)}`);
            }
          } catch (jsonError) {
            console.error(`[DOMAIN_AUTH_POLL] Failed to parse JSON response: ${jsonError}`);
          }
        } else if (pollResponse.status === 200) {
          // Got 200 but not JSON - still need auth
          console.error(`[DOMAIN_AUTH_POLL] HTTP 200 but non-JSON (${pollContentType}) - auth still needed`);
        } else if (pollResponse.status === 302) {
          // Still getting redirects - auth not complete
          console.error(`[DOMAIN_AUTH_POLL] HTTP 302 redirect - auth still needed`);
        } else {
          // Other status codes
          console.error(`[DOMAIN_AUTH_POLL] HTTP ${pollResponse.status} - continuing to poll`);
        }
        
      } catch (pollError: any) {
        console.error(`[DOMAIN_AUTH_POLL] Poll #${pollCount} failed: ${pollError.message}`);
      }
      
      // Wait before next poll (unless we're close to timeout)
      if (Date.now() - startTime + pollInterval < maxPollDuration) {
        console.error(`[DOMAIN_AUTH_POLL] Waiting ${pollInterval}ms before next poll...`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    // Timeout reached
    const finalElapsedTime = Date.now() - startTime;
    console.error(`[DOMAIN_AUTH_POLL] Timeout reached after ${finalElapsedTime}ms (${pollCount} polls)`);
    throw new Error(`Domain authorization timeout: No successful JSON response after ${finalElapsedTime}ms and ${pollCount} polling attempts`);
  }

  private async setupInfrastructure(scriptId: string, accessToken: string): Promise<void> {
    // HANGING FIX: Add timeout wrapper for all Google API calls
    const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number, operationName: string): Promise<T> => {
      return Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`${operationName} timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        })
      ]);
    };
    
    // Check if shim and HTML templates exist
    let shimExists = false;
    let htmlTemplatesExist = false;
    try {
      console.error('Checking if execution shim and HTML templates exist...');
      const existingFiles = await withTimeout(
        this.gasClient.getProjectContent(scriptId, accessToken),
        15000, // 15-second timeout
        'Get project content'
      );
      shimExists = existingFiles.some((file: GASFile) => file.name === '__mcp_exec');
      const hasSuccessHtml = existingFiles.some((file: GASFile) => file.name === '__mcp_exec_success');
      const hasErrorHtml = existingFiles.some((file: GASFile) => file.name === '__mcp_exec_error');
      htmlTemplatesExist = hasSuccessHtml && hasErrorHtml;
      console.error(`Shim exists: ${shimExists}, HTML templates exist: ${htmlTemplatesExist}`);
    } catch (error: any) {
      if (error.message?.includes('timeout')) {
        console.error(`Timeout checking for shim: ${error.message}`);
        throw new Error(`Setup failed: Unable to check project files - ${error.message}`);
      }
      // Assume shim doesn't exist if we can't check
      console.warn('Could not check for existing shim, assuming it does not exist');
    }

    // Add execution shim if needed
    if (!shimExists) {
      console.error('Creating execution shim...');
      const shimCode = CodeGenerator.generateProjectFiles({
        type: 'head_deployment',
        timezone: 'America/Los_Angeles',
        includeTestFunctions: true,
        mcpVersion: '1.0.0'
      });

      const shimFile = shimCode.files.find((file: GASFile) => file.name === '__mcp_exec');
      if (!shimFile?.source) {
        throw new Error('Failed to generate execution shim code');
      }

      try {
        await withTimeout(
          this.gasClient.updateFile(scriptId, '__mcp_exec', shimFile.source, 0, accessToken),
          20000, // 20-second timeout for file upload
          'Update shim file'
        );
        console.error('Execution shim created successfully');
      } catch (error: any) {
        if (error.message?.includes('timeout')) {
          throw new Error(`Setup failed: Unable to create execution shim - ${error.message}`);
        }
        throw error;
      }
    }

    // Deploy HTML templates if missing (independent of shim existence)
    if (!htmlTemplatesExist) {
      console.error('Deploying HTML templates...');
      try {
        const successHtml = getSuccessHtmlTemplate();
        await withTimeout(
          this.gasClient.updateFile(scriptId, '__mcp_exec_success', successHtml, 0, accessToken, 'HTML'),
          20000,
          'Update success HTML template'
        );
        console.error('Success HTML template deployed');

        const errorHtml = getErrorHtmlTemplate();
        await withTimeout(
          this.gasClient.updateFile(scriptId, '__mcp_exec_error', errorHtml, 0, accessToken, 'HTML'),
          20000,
          'Update error HTML template'
        );
        console.error('Error HTML template deployed');
      } catch (error: any) {
        console.warn(`HTML template deployment failed: ${error.message} - IDE interface may not work properly`);
        // Don't fail the whole setup if HTML templates fail - they're not critical for basic execution
      }
    } else {
      console.error('HTML templates already exist, skipping deployment');
    }

    // Update manifest
    console.error('Updating manifest entry points...');
    try {
      await withTimeout(
        ensureManifestEntryPoints(this.gasClient, scriptId, 'WEB_APP', 'MYSELF', accessToken),
        10000, // 10-second timeout
        'Update manifest entry points'
      );
      console.error('Manifest updated successfully');
    } catch (error: any) {
      if (error.message?.includes('timeout')) {
        console.warn(`Manifest update timeout: ${error.message} - continuing anyway`);
      } else {
        console.warn(`Manifest update failed: ${error.message} - continuing anyway`);
      }
    }
    
    // Brief wait for processing
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Create HEAD deployment
    console.error('Creating HEAD deployment...');
    const deploymentOptions = {
      entryPointType: 'WEB_APP' as const,
      webAppConfig: {
        access: 'MYSELF' as const,
        executeAs: 'USER_ACCESSING' as const
      }
    };
    
    try {
      await withTimeout(
        this.gasClient.ensureHeadDeployment(
          scriptId,
          'HEAD deployment for testing',
          deploymentOptions,
          accessToken
        ),
        30000, // 30-second timeout for deployment
        'Create HEAD deployment'
      );
      console.error('HEAD deployment created successfully');
    } catch (error: any) {
      if (error.message?.includes('timeout')) {
        throw new Error(`Setup failed: Unable to create deployment - ${error.message}`);
      }
      throw error;
    }
    
    // Cache the deployment URL
    console.error('Constructing deployment URL...');
    try {
      const gasRunUrl = await withTimeout(
        this.gasClient.constructGasRunUrl(scriptId, accessToken),
        10000, // 10-second timeout
        'Construct gas run URL'
      );
      
      if (this.sessionAuthManager && gasRunUrl) {
        await this.sessionAuthManager.setCachedDeploymentUrl(scriptId, gasRunUrl);
        console.error('Deployment URL cached successfully');
      }
    } catch (error: any) {
      if (error.message?.includes('timeout')) {
        console.warn(`URL construction timeout: ${error.message} - continuing anyway`);
      } else {
        console.warn(`URL construction failed: ${error.message} - continuing anyway`);
      }
    }
    
    console.error('Infrastructure setup completed');
  }
} 