import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ValidationError, GASApiError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { GASCodeGenerator } from '../utils/codeGeneration.js';
import { GASFile } from '../api/gasClient.js';

/**
 * Helper function to ensure manifest has proper entry point configuration
 * (Shared from deployments.ts - we need to create a utility module for this)
 */
async function ensureManifestEntryPoints(
  gasClient: GASClient, 
  scriptId: string, 
  entryPointType: 'WEB_APP' | 'EXECUTION_API', 
  accessLevel: 'MYSELF' | 'DOMAIN' | 'ANYONE' | 'ANYONE_ANONYMOUS',
  accessToken?: string
): Promise<void> {
  try {
    console.error(`🔧 Ensuring manifest configured for ${entryPointType} deployment...`);
    
    // Get current project content
    const files = await gasClient.getProjectContent(scriptId, accessToken);
    
    // Find manifest file (prefer 'appsscript' over 'appsscript.json' to avoid duplicates)
    let manifestFile = files.find(f => f.name === 'appsscript');
    if (!manifestFile) {
      manifestFile = files.find(f => f.name === 'appsscript.json');
    }
    
    let manifest: any;
    let manifestFileName = 'appsscript'; // Always use 'appsscript' to prevent .json.json issues
    
    if (!manifestFile || !manifestFile.source) {
      console.error('⚠️  No manifest file found, creating new appsscript file...');
      manifest = {};
    } else {
      console.error(`📁 Found existing manifest: ${manifestFile.name}`);
      try {
        manifest = JSON.parse(manifestFile.source);
        console.error('📁 Parsed existing manifest successfully');
      } catch (parseError) {
        console.warn('⚠️  Failed to parse existing manifest, starting fresh...');
        manifest = {};
      }
      
      // If we found appsscript.json but we're going to save as appsscript, 
      // we should clean up the duplicate later
      if (manifestFile.name === 'appsscript.json') {
        console.error('🔧 Will use standard "appsscript" filename to prevent duplicates');
      }
    }
    
    // Always ensure base properties are set
    manifest.timeZone = manifest.timeZone || 'America/Los_Angeles';
    manifest.dependencies = manifest.dependencies || {};
    manifest.exceptionLogging = manifest.exceptionLogging || 'STACKDRIVER';
    manifest.runtimeVersion = manifest.runtimeVersion || 'V8';
    
    let needsUpdate = false;
    
    if (entryPointType === 'WEB_APP') {
      console.error('🌐 Configuring manifest for WEB_APP deployment only...');
      
      // Force web app configuration
      if (!manifest.webapp || manifest.webapp.access !== accessLevel) {
        manifest.webapp = {
          access: accessLevel,
          executeAs: 'USER_ACCESSING'
        };
        needsUpdate = true;
        console.error(`📝 Set webapp configuration: access=${accessLevel}, executeAs=USER_ACCESSING`);
      }
      
      // CRITICAL: Remove executionApi to prevent library deployment confusion
      if (manifest.executionApi) {
        delete manifest.executionApi;
        needsUpdate = true;
        console.error('🗑️  Removed executionApi configuration to force web app deployment');
      }
      
      // Remove library configuration if present
      if (manifest.library) {
        delete manifest.library;
        needsUpdate = true;
        console.error('🗑️  Removed library configuration to force web app deployment');
      }
      
    } else if (entryPointType === 'EXECUTION_API') {
      console.error('⚙️ Configuring manifest for EXECUTION_API deployment...');
      
      // Ensure executionApi entry point exists for API Executable deployments
      if (!manifest.executionApi || manifest.executionApi.access !== accessLevel) {
        manifest.executionApi = {
          access: accessLevel
        };
        needsUpdate = true;
        console.error(`📝 Set executionApi configuration: access=${accessLevel}`);
      }
    }
    
    // Update manifest if needed
    if (needsUpdate) {
      const manifestContent = JSON.stringify(manifest, null, 2);
      
      try {
        // Always use 'appsscript' filename to prevent .json.json double extensions
        console.error(`🔧 Updating manifest file: ${manifestFileName}`);
        await gasClient.updateFile(scriptId, manifestFileName, manifestContent, undefined, accessToken);
        console.error(`✅ Updated manifest (${manifestFileName}) with proper entry points for ${entryPointType}`);
        console.error(`📄 Final manifest:`, manifestContent);
      } catch (updateError: any) {
        console.error(`❌ Failed to update manifest: ${updateError.message}`);
        // Don't try alternatives to prevent creating duplicate manifest files
        console.error('⚠️  Manifest update failed, but deployment can still proceed');
      }
    } else {
      console.error(`✅ Manifest already has proper ${entryPointType} configuration`);
    }
    
  } catch (error: any) {
    console.error('❌ Failed to update manifest entry points:', error.message);
    // Don't throw error as deployment can still proceed, but log it as error
  }
}

/**
 * Execute functions in Google Apps Script projects via API executable
 * 
 * Requirements:
 * - Script project must be deployed for API use
 * - Must have script.scriptapp OAuth scope (or function-specific scopes)
 * - Cloud Platform project must match between calling app and script
 */
export class GASRunApiExecTool extends BaseTool {
  public name = 'gas_run_api_exec';
  public description = 'Execute a function in a Google Apps Script project via API executable. ⚠️ CRITICAL: Functions must be deployed as API executable before execution. Use gas_version_create → gas_deploy_create → gas_run_api_exec workflow for new/modified functions.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID. ⚠️ MUST be deployed as API executable first! Use gas_version_create + gas_deploy_create before gas_run_api_exec. Can also use deployment ID directly.'
      },
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
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['scriptId', 'functionName']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    // Use new validation utilities
    const scriptId = this.validate.scriptId(params.scriptId, 'API function execution');
    const functionName = this.validate.functionName(params.functionName, 'API function execution');
    const parameters = params.parameters || [];
    const devMode = params.devMode !== false; // Default to true

    // Validate parameters is an array
    if (!Array.isArray(parameters)) {
      throw new ValidationError('parameters', parameters, 'array of function parameters');
    }

    try {
      console.error(`🚀 Executing function: ${functionName} in script: ${scriptId}`);
      console.error(`📋 Parameters: ${JSON.stringify(parameters)}`);
      console.error(`🔧 Dev mode: ${devMode}`);

      const result = await this.gasClient.executeFunction(scriptId, functionName, parameters, accessToken);

      if (result.error) {
        console.error(`❌ Function execution failed:`, result.error);
        
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

      console.error(`✅ Function executed successfully`);
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
      
      // Log detailed error information for debugging
      console.error(`📊 Error details:`, {
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
            '⚠️ REQUIRED: Deploy your functions before execution',
            '1. Create version: gas_version_create(scriptId="your-project", description="Latest changes")',
            '2. Deploy API: gas_deploy_create(scriptId="your-project", description="API deployment")',
            '3. Then retry: gas_run_api_exec(scriptId="your-project", functionName="yourFunction")',
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
            '3. Re-authenticate with updated scopes: gas_auth(mode="logout") then gas_auth(mode="start")',
            '4. Verify the script project is deployed for API use'
          ];
        } else if (statusCode === 401) {
          helpMessage = 'Authentication required or token expired';
          setupInstructions = [
            '1. Re-authenticate: gas_auth(mode="logout") then gas_auth(mode="start")',
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
              '1. gas_write(path="project/file.gs", content="function myFunc() {...}")',
              '2. gas_version_create(scriptId="project", description="Added myFunc")',
              '3. gas_deploy_create(scriptId="project", description="API deployment")',
              '4. gas_run_api_exec(scriptId="project", functionName="myFunc")'
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

      console.error(`❌ Non-GASApiError execution error - HTTP ${statusCode}:`, error.message);

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
            '1. gas_write(path="project/file.gs", content="function myFunc() {...}")',
            '2. gas_version_create(scriptId="project", description="Added myFunc")',
            '3. gas_deploy_create(scriptId="project", description="API deployment")',
            '4. gas_run_api_exec(scriptId="project", functionName="myFunc")'
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
 * ⚠️  AUTOMATIC DEPLOYMENT BEHAVIOR:
 * - AUTOMATICALLY CREATES fresh web app deployment by default when autoRedeploy=true
 * - Creates new version with latest code changes before deployment
 * - Creates new web app deployment for each execution to ensure latest code
 * - autoRedeploy=true (default): Always creates NEW VERSION + NEW DEPLOYMENT
 * - autoRedeploy=false: Uses existing deployment only (requires manual deployment)
 * 
 * ✅  AUTOMATIC SHIM CODE CREATION:
 * - This tool AUTOMATICALLY creates __mcp_gas_run shim code if missing
 * - Provides dynamic code execution via Function constructor
 * - Enables execution of any JavaScript expression (e.g., fib(13), Math.PI * 2)
 * - Shim is added before deployment for zero-setup dynamic execution
 * 
 * ⚠️  WEB APP DEPLOYMENT BY DEFAULT:
 * - Creates web app deployments by default for doGet() proxy pattern
 * - Web app deployments support HTTP-based function execution
 * - Uses 'MYSELF' access level for secure authenticated execution
 * - Automatically configures proper entry points and access controls
 * 
 * ⚠️  FUNCTION EXECUTION PATTERN:
 * - This tool calls doGet() which handles dynamic JavaScript execution
 * - The target function/expression is executed via Function constructor
 * - Supports both function calls and JavaScript expressions
 * - Returns structured JSON responses with execution results
 * 
 * This tool provides zero-setup dynamic JavaScript execution with automatic infrastructure setup.
 * Perfect for web app scenarios with proper JSON serialization and fresh deployment guarantee.
 * 
 * Note: This is the primary gas_run implementation that creates fresh deployments. An alternative
 * implementation (GASHeadDeployTool) exists that checks for existing web app deployments first
 * and uses the most recent version, creating new ones only if none exist.
 * 
 * Requirements:
 * - Script project will be auto-deployed as Web App by default
 * - Execution shim (__mcp_gas_run) will be auto-added if missing
 * - Returns JSON responses that can be properly dehydrated/rehydrated
 * - Must have script.scriptapp OAuth scope
 */
export class GASRunTool extends BaseTool {
  public name = 'gas_run';
  public description = 'Execute JavaScript code dynamically in Google Apps Script projects';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID'
      },
      js_statement: {
        type: 'string',
        description: 'JavaScript statement to execute (e.g., "Math.PI * 2", "myFunction(1, 2, 3)")'
      },
      autoRedeploy: {
        type: 'boolean',
        description: 'Enable automatic infrastructure setup (default: true)',
        default: true
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['scriptId', 'js_statement']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    const scriptId = this.validate.scriptId(params.scriptId, 'dynamic JS execution');
    const js_statement = this.validate.string(params.js_statement, 'JavaScript statement');
    const autoRedeploy = params.autoRedeploy !== false;

    if (!js_statement?.trim()) {
      throw new ValidationError('js_statement', js_statement, 'non-empty JavaScript statement');
    }

    try {
      // Simple optimistic execution - just try the basic fetch
      return await this.executeOptimistic(scriptId, js_statement, accessToken);
    } catch (error: any) {
      if (this.needsInfrastructureSetup(error) && autoRedeploy) {
        // Set up infrastructure and retry
        await this.setupInfrastructure(scriptId, accessToken);
        
        // NEW: Retry logic for deployment delays with test function validation
        return await this.executeWithDeploymentRetry(scriptId, js_statement, accessToken);
      }
      if (!autoRedeploy) {
        throw new Error(`Execution failed and autoRedeploy is disabled. ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Execute with retry logic for deployment delays
   * Tests with a simple function first, then retries the actual function
   */
  private async executeWithDeploymentRetry(scriptId: string, js_statement: string, accessToken: string): Promise<any> {
    const maxRetryDuration = 60000; // 60 seconds total
    const retryInterval = 2000; // 2 seconds between retries
    const startTime = Date.now();
    
    console.error(`🔄 [DEPLOYMENT RETRY] Starting retry logic for potential deployment delay`);
    console.error(`   Script ID: ${scriptId}`);
    console.error(`   Max retry duration: ${maxRetryDuration}ms`);
    console.error(`   Retry interval: ${retryInterval}ms`);
    
    while (Date.now() - startTime < maxRetryDuration) {
      try {
        // First try the actual function
        return await this.executeOptimistic(scriptId, js_statement, accessToken);
      } catch (error: any) {
        const statusCode = error.statusCode || error.response?.status;
        
        // Only retry for HTTP 500 errors (deployment not ready)
        if (statusCode === 500) {
          const elapsedTime = Date.now() - startTime;
          console.error(`⚠️  [DEPLOYMENT RETRY] HTTP ${statusCode} error, testing deployment readiness`);
          console.error(`   Elapsed time: ${elapsedTime}ms`);
          console.error(`   Error: ${error.message}`);
          
          // Test if deployment is ready with a simple function that requests JSON
          try {
            console.error(`🧪 [DEPLOYMENT TEST] Testing deployment with doGet function - requesting JSON response`);
            await this.executeOptimisticWithJsonRequest(scriptId, 'new Date().toISOString()', accessToken);
            console.error(`✅ [DEPLOYMENT TEST] Test function succeeded with HTTP 200, deployment is ready`);
            
            // Deployment is ready, try the actual function one more time
            try {
              return await this.executeOptimistic(scriptId, js_statement, accessToken);
            } catch (actualError: any) {
              console.error(`❌ [DEPLOYMENT RETRY] Actual function still failed after test succeeded`);
              console.error(`   Error: ${actualError.message}`);
              throw actualError;
            }
          } catch (testError: any) {
            const testStatusCode = testError.statusCode || testError.response?.status;
            console.error(`🧪 [DEPLOYMENT TEST] Test function result: HTTP ${testStatusCode} - ${testError.message}`);
            
            // If we got HTTP 200, consider it successful and retry original function
            if (testStatusCode === 200) {
              console.error(`✅ [DEPLOYMENT TEST] HTTP 200 received, deployment is ready - retrying original function`);
              try {
                return await this.executeOptimistic(scriptId, js_statement, accessToken);
              } catch (actualError: any) {
                console.error(`❌ [DEPLOYMENT RETRY] Original function failed even after HTTP 200 test: ${actualError.message}`);
                throw actualError;
              }
            } else if (testStatusCode === 500) {
              // Still not ready, wait and retry
              if (Date.now() - startTime + retryInterval < maxRetryDuration) {
                console.error(`⏳ [DEPLOYMENT RETRY] HTTP ${testStatusCode} - deployment not ready, waiting ${retryInterval}ms before retry`);
                await new Promise(resolve => setTimeout(resolve, retryInterval));
                continue;
              } else {
                console.error(`⏰ [DEPLOYMENT RETRY] Timeout reached, deployment still returning HTTP ${testStatusCode}`);
                throw new Error(`Deployment timeout: Google Apps Script project not ready after ${maxRetryDuration}ms. Last error: ${error.message}`);
              }
            } else {
              // Different error, stop retrying
              console.error(`❌ [DEPLOYMENT TEST] Test function failed with HTTP ${testStatusCode} error: ${testError.message}`);
              throw testError;
            }
          }
        } else {
          // Not a 500 error, don't retry
          console.error(`❌ [DEPLOYMENT RETRY] HTTP ${statusCode} error - not retrying: ${error.message}`);
          throw error;
        }
      }
    }
    
    // Should not reach here, but just in case
    throw new Error(`Deployment timeout: Maximum retry duration of ${maxRetryDuration}ms exceeded`);
  }

  // Special version for deployment testing that explicitly requests JSON
  private async executeOptimisticWithJsonRequest(scriptId: string, js_statement: string, accessToken: string): Promise<any> {
    const executionUrl = await this.gasClient.constructGasRunUrl(scriptId, accessToken);
    const startTime = Date.now();
    
    // HANGING FIX: Add timeout protection to prevent indefinite hangs
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 30000); // 30-second timeout

    try {
      // ADD FUNCTION PARAMETER: Add the js_statement as a func parameter
      // IMPORTANT: Don't use URLSearchParams.set() as it URL-encodes the parameter
      // Google Apps Script expects raw JavaScript code, not URL-encoded
      const separator = executionUrl.includes('?') ? '&' : '?';
      const finalUrl = `${executionUrl}${separator}func=${js_statement}`;
      
      // Convert /exec to /dev if needed for testing
      const testUrl = finalUrl.replace('/exec', '/dev');
      
      // Enhanced request headers for deployment testing
      const requestHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'MCP-GAS-Server/1.0.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      
      // ENHANCED DEBUG LOG - Show URL conversion and headers before request
      const debugInfo = {
        timestamp: new Date().toISOString(),
        operation: 'DEPLOYMENT_TEST',
        scriptId: scriptId,
        jsStatement: js_statement,
        baseUrl: executionUrl,
        originalUrl: finalUrl,
        testUrl: testUrl,
        urlConversion: finalUrl !== testUrl ? '/exec → /dev' : 'no conversion needed',
        requestHeaders: {
          ...requestHeaders,
          'Authorization': `Bearer ${accessToken.substring(0, 10)}...***`
        },
        redirectPolicy: 'follow (automatic)',
        timeout: '30 seconds',
        requestStart: new Date().toISOString()
      };
      
      console.error(`🧪 [DEPLOYMENT_TEST ENHANCED DEBUG] Pre-request information:\n${JSON.stringify(debugInfo, null, 2)}`);
      
      // AUTOMATIC REDIRECT: Use native browser redirect handling with JSON Accept header
      const response = await fetch(testUrl, {
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
        redirectsFollowed: response.url !== testUrl ? 'YES' : 'NO',
        responseTime: new Date().toISOString()
      };
      
      console.error(`📡 [DEPLOYMENT_TEST RESPONSE] HTTP response details:\n${JSON.stringify(responseDebugInfo, null, 2)}`);
      
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
        
        console.error(`❌ [DEPLOYMENT_TEST ERROR] HTTP ${response.status} error details:\n${JSON.stringify(errorDebugInfo, null, 2)}`);
        
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
        (error as any).config = {
          url: testUrl,
          method: 'GET'
        };
        throw error;
      }
      
      // If we reach here, we got HTTP 200 - deployment is ready
      clearTimeout(timeoutId);
      console.error(`✅ [DEPLOYMENT_TEST SUCCESS] HTTP ${response.status} - Deployment is ready`);
      
      return {
        status: 'deployment_ready',
        httpStatus: response.status,
        message: 'Deployment test successful'
      };
      
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        const timeoutError = new Error('Deployment test timeout after 30 seconds');
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

  private async executeOptimistic(scriptId: string, js_statement: string, accessToken: string): Promise<any> {
    const executionUrl = await this.gasClient.constructGasRunUrl(scriptId, accessToken);
    const startTime = Date.now();
    
    // HANGING FIX: Add timeout protection to prevent indefinite hangs
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 30000); // 30-second timeout

    try {
      // ADD FUNCTION PARAMETER: Add the js_statement as a func parameter
      // IMPORTANT: Don't use URLSearchParams.set() as it URL-encodes the parameter
      // Google Apps Script expects raw JavaScript code, not URL-encoded
      const separator = executionUrl.includes('?') ? '&' : '?';
      const finalUrl = `${executionUrl}${separator}func=${js_statement}`;
      
      // Enhanced request headers
      const requestHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'MCP-GAS-Server/1.0.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      
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
      
      console.error(`🚀 [GAS_RUN ENHANCED DEBUG] Pre-request information:\n${JSON.stringify(debugInfo, null, 2)}`);
      
      // AUTOMATIC REDIRECT: Use native browser redirect handling
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
      
      console.error(`📡 [GAS_RUN RESPONSE] HTTP response details:\n${JSON.stringify(responseDebugInfo, null, 2)}`);
      
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
        
        console.error(`❌ [GAS_RUN ERROR] HTTP ${response.status} error details:\n${JSON.stringify(errorDebugInfo, null, 2)}`);
        
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
                reject(new Error('Response body reading timeout after 15 seconds'));
              }, 15000);
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
                reject(new Error('Response body reading timeout after 15 seconds'));
              }, 15000);
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
          
          console.error(`🌐 [GAS_RUN HTML ERROR] HTTP ${response.status} - Web app returned HTML instead of JSON:\n${JSON.stringify(htmlErrorDebugInfo, null, 2)}`);
          
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
      
      console.error(`✅ [GAS_RUN SUCCESS] HTTP ${response.status} success details:\n${JSON.stringify(successDebugInfo, null, 2)}`);
      
      // Handle structured response format {type: "data"|"exception", payload: ...}
      if (result && typeof result === 'object' && result.type) {
        if (result.type === 'data') {
          return {
            status: 'success',
            scriptId,
            js_statement,
            result: result.payload,
            executedAt: new Date().toISOString()
          };
        } else if (result.type === 'exception') {
          const error = new Error(result.payload.error.message);
          error.name = result.payload.error.name || 'FunctionExecutionError';
          throw error;
        }
      }
      
      // Return simple success response
      return {
        status: 'success',
        scriptId,
        js_statement,
        result,
        executedAt: new Date().toISOString()
      };
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
        const timeoutError = new Error(`Request timeout: Google Apps Script did not respond within 30 seconds`);
        (timeoutError as any).statusCode = 408;
        throw timeoutError;
      }
      
      // Handle response reading timeout
      if (error.message?.includes('Response body reading timeout')) {
        const timeoutError = new Error(`Response reading timeout: Google Apps Script response body took longer than 15 seconds to read`);
        (timeoutError as any).statusCode = 408;
        throw timeoutError;
      }
      
      // Re-throw other errors
      throw error;
    }
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
    
    // Check if shim exists
    let shimExists = false;
    try {
      console.error('Checking if execution shim exists...');
      const existingFiles = await withTimeout(
        this.gasClient.getProjectContent(scriptId, accessToken),
        15000, // 15-second timeout
        'Get project content'
      );
      shimExists = existingFiles.some((file: GASFile) => file.name === '__mcp_gas_run');
      console.error(`Shim exists: ${shimExists}`);
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
      const shimCode = GASCodeGenerator.generateCode({
        type: 'head_deployment',
        timezone: 'America/Los_Angeles',
        includeTestFunctions: true,
        mcpVersion: '1.0.0'
      });
      
      const shimFile = shimCode.files.find(file => file.name === '__mcp_gas_run');
      if (!shimFile?.source) {
        throw new Error('Failed to generate execution shim code');
      }
      
      try {
        await withTimeout(
          this.gasClient.updateFile(scriptId, '__mcp_gas_run', shimFile.source, 0, accessToken),
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