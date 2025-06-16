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
    console.log(`🔧 Ensuring manifest configured for ${entryPointType} deployment...`);
    
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
      console.log('⚠️  No manifest file found, creating new appsscript file...');
      manifest = {};
    } else {
      console.log(`📁 Found existing manifest: ${manifestFile.name}`);
      try {
        manifest = JSON.parse(manifestFile.source);
        console.log('📁 Parsed existing manifest successfully');
      } catch (parseError) {
        console.warn('⚠️  Failed to parse existing manifest, starting fresh...');
        manifest = {};
      }
      
      // If we found appsscript.json but we're going to save as appsscript, 
      // we should clean up the duplicate later
      if (manifestFile.name === 'appsscript.json') {
        console.log('🔧 Will use standard "appsscript" filename to prevent duplicates');
      }
    }
    
    // Always ensure base properties are set
    manifest.timeZone = manifest.timeZone || 'America/Los_Angeles';
    manifest.dependencies = manifest.dependencies || {};
    manifest.exceptionLogging = manifest.exceptionLogging || 'STACKDRIVER';
    manifest.runtimeVersion = manifest.runtimeVersion || 'V8';
    
    let needsUpdate = false;
    
    if (entryPointType === 'WEB_APP') {
      console.log('🌐 Configuring manifest for WEB_APP deployment only...');
      
      // Force web app configuration
      if (!manifest.webapp || manifest.webapp.access !== accessLevel) {
        manifest.webapp = {
          access: accessLevel,
          executeAs: 'USER_ACCESSING'
        };
        needsUpdate = true;
        console.log(`📝 Set webapp configuration: access=${accessLevel}, executeAs=USER_ACCESSING`);
      }
      
      // CRITICAL: Remove executionApi to prevent library deployment confusion
      if (manifest.executionApi) {
        delete manifest.executionApi;
        needsUpdate = true;
        console.log('🗑️  Removed executionApi configuration to force web app deployment');
      }
      
      // Remove library configuration if present
      if (manifest.library) {
        delete manifest.library;
        needsUpdate = true;
        console.log('🗑️  Removed library configuration to force web app deployment');
      }
      
    } else if (entryPointType === 'EXECUTION_API') {
      console.log('⚙️ Configuring manifest for EXECUTION_API deployment...');
      
      // Ensure executionApi entry point exists for API Executable deployments
      if (!manifest.executionApi || manifest.executionApi.access !== accessLevel) {
        manifest.executionApi = {
          access: accessLevel
        };
        needsUpdate = true;
        console.log(`📝 Set executionApi configuration: access=${accessLevel}`);
      }
    }
    
    // Update manifest if needed
    if (needsUpdate) {
      const manifestContent = JSON.stringify(manifest, null, 2);
      
      try {
        // Always use 'appsscript' filename to prevent .json.json double extensions
        console.log(`🔧 Updating manifest file: ${manifestFileName}`);
        await gasClient.updateFile(scriptId, manifestFileName, manifestContent, undefined, accessToken);
        console.log(`✅ Updated manifest (${manifestFileName}) with proper entry points for ${entryPointType}`);
        console.log(`📄 Final manifest:`, manifestContent);
      } catch (updateError: any) {
        console.error(`❌ Failed to update manifest: ${updateError.message}`);
        // Don't try alternatives to prevent creating duplicate manifest files
        console.log('⚠️  Manifest update failed, but deployment can still proceed');
      }
    } else {
      console.log(`✅ Manifest already has proper ${entryPointType} configuration`);
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
      console.log(`🚀 Executing function: ${functionName} in script: ${scriptId}`);
      console.log(`📋 Parameters: ${JSON.stringify(parameters)}`);
      console.log(`🔧 Dev mode: ${devMode}`);

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

      console.log(`✅ Function executed successfully`);
      console.log(`📤 Result:`, result.result);

      return {
        status: 'success',
        scriptId,
        functionName,
        parameters,
        result: result.result,
        executedAt: new Date().toISOString(),
        sessionId: this.sessionAuthManager?.getSessionId(),
        devMode,
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
  public description = 'Core dynamic JavaScript/Apps Script execution handler. ⚠️ CLEAN EXECUTION ONLY - Executes JavaScript code dynamically via Function constructor. Supports function calls, expressions, and complete statements. Uses HEAD deployment for testing with automatic content updates.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID. Tool will use or create HEAD deployment with /dev URL for testing latest content.'
      },
      js_statement: {
        type: 'string',
        description: 'JavaScript statement to execute dynamically (e.g., "Math.PI * 2", "myFunction(1, 2, 3)", "function foo() { return \'bar\'; } foo()", "[1,2,3].map(x => x * 2)")'
      },
      devMode: {
        type: 'boolean',
        description: 'Run in development mode (default: true)',
        default: true
      },
      autoRedeploy: {
        type: 'boolean',
        description: 'Enable automatic HEAD deployment setup: ensures HEAD deployment exists with /dev URL for testing. Content updates are automatic without redeployment. Set to false to use existing deployments only. (default: true)',
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
    
    // Use new validation utilities
    const scriptId = this.validate.scriptId(params.scriptId, 'dynamic JS execution');
    const js_statement = this.validate.string(params.js_statement, 'JavaScript statement');
    const devMode = params.devMode !== false; // Default to true
    let autoRedeploy = params.autoRedeploy !== false; // Default to true

    // Validate js_statement is not empty
    if (!js_statement || js_statement.trim().length === 0) {
      throw new ValidationError('js_statement', js_statement, 'non-empty JavaScript statement');
    }

    // 🚀 SMART PERFORMANCE OPTIMIZATION:
    // Try fast path first (existing deployment), fallback to full deployment if needed
    console.log(`🎯 SMART EXECUTION: Trying fast path first, fallback to deployment if needed`);
    
    try {
      // STEP 1: Try fast execution first (unless explicitly disabled)
      if (autoRedeploy !== false) {
        console.log(`⚡ FAST PATH: Attempting execution with existing deployment...`);
        
        const fastResult = await this.executeWithDeployment(
          scriptId, js_statement, accessToken, devMode, false // autoRedeploy=false
        );
        
        console.log(`✅ FAST PATH SUCCESS: Execution completed without redeployment`);
        return fastResult;
      }
    } catch (fastError: any) {
      // Check if error indicates missing/broken deployment
      const shouldRetryWithDeployment = this.shouldRetryWithDeployment(fastError);
      
      if (shouldRetryWithDeployment) {
        console.log(`🔄 FAST PATH FAILED: ${fastError.message}`);
        console.log(`🚀 FALLBACK: Retrying with full deployment...`);
        
        // STEP 2: Retry with full deployment
        try {
          const deployResult = await this.executeWithDeployment(
            scriptId, js_statement, accessToken, devMode, true // autoRedeploy=true
          );
          
          console.log(`✅ FALLBACK SUCCESS: Execution completed after deployment`);
          return deployResult;
        } catch (deployError: any) {
          console.error(`❌ BOTH PATHS FAILED: Fast path and deployment both failed`);
          throw deployError; // Throw the deployment error as it's more informative
        }
      } else {
        // Error is not deployment-related, throw original error
        console.error(`❌ FAST PATH FAILED: Non-deployment error, not retrying`);
        throw fastError;
      }
    }

    // This should never be reached due to the logic above, but just in case
    return await this.executeWithDeployment(scriptId, js_statement, accessToken, devMode, autoRedeploy);
  }

  /**
   * Check if an error indicates we should retry with full deployment
   */
  private shouldRetryWithDeployment(error: any): boolean {
    // Check for HTTP status codes that indicate missing deployment/doGet
    const statusCode = error.statusCode || error.data?.statusCode || error.response?.status;
    
    // 404 = doGet function not found or deployment doesn't exist
    // 403 = Permission issues that might be resolved with fresh deployment
    // 500 = Internal server error, possibly due to broken deployment
    if ([404, 403, 500].includes(statusCode)) {
      console.log(`🔍 HTTP ${statusCode} detected - likely deployment issue`);
      return true;
    }
    
    // Check for specific error messages indicating deployment issues
    const errorMessage = error.message?.toLowerCase() || '';
    const deploymentIndicators = [
      'html error page',
      'doget function not found',
      'deployment not found',
      'no web app deployment found',
      'function not deployed',
      'authentication issues or deployment problems'
    ];
    
    const hasDeploymentIndicator = deploymentIndicators.some(indicator => 
      errorMessage.includes(indicator)
    );
    
    if (hasDeploymentIndicator) {
      console.log(`🔍 Error message indicates deployment issue: ${error.message}`);
      return true;
    }
    
    // Check if error has deployment-related troubleshooting info
    if (error.setupInstructions && Array.isArray(error.setupInstructions)) {
      const hasDeploymentInstructions = error.setupInstructions.some((instruction: string) =>
        instruction.toLowerCase().includes('deploy') || 
        instruction.toLowerCase().includes('doget')
      );
      
      if (hasDeploymentInstructions) {
        console.log(`🔍 Error has deployment-related instructions - retrying with deployment`);
        return true;
      }
    }
    
    console.log(`🔍 Error does not indicate deployment issue - not retrying`);
    return false;
  }

  /**
   * Execute with specified deployment strategy
   */
  private async executeWithDeployment(
    scriptId: string, 
    js_statement: string, 
    accessToken: string, 
    devMode: boolean, 
    autoRedeploy: boolean
  ): Promise<any> {
    try {
      console.log(`🌐 Executing JavaScript statement via doGet() proxy in script: ${scriptId}`);
      console.log(`📋 JS Statement: ${js_statement}`);
      console.log(`🔧 Using Function() constructor for dynamic execution`);
      console.log(`🔧 Auto-redeploy: ${autoRedeploy} (default: true)`);
      console.log(`🔧 Deploy as Web App: always (web-app-only implementation)`);
      console.log(`🚀 Runtime: V8 (supports GS, TS, HTML, ES6)`);

      // Variables to store deployment info
      let immediateDeployment: any = null;
      
      // Check if we need to redeploy
      if (autoRedeploy) {
        console.log(`🚀 Auto-redeployment enabled, setting up web app infrastructure...`);
        
        // 🔧 CRITICAL FIX: Add execution shim before deployment
          console.log(`🔧 Checking for execution shim (__mcp_gas_run)...`);
          
          // Check if shim already exists
          let shimExists = false;
          try {
            const existingFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
            shimExists = existingFiles.some((file: GASFile) => file.name === '__mcp_gas_run') || false;
            console.log(`📁 Shim exists: ${shimExists}`);
          } catch (checkError: any) {
            console.log(`⚠️ Could not check existing files, will add shim: ${checkError.message}`);
          }
          
          // Add execution shim if not present
          if (!shimExists) {
            console.log(`🔧 Adding execution shim (__mcp_gas_run) for dynamic code execution...`);
            
            const shimCode = GASCodeGenerator.generateCode({
              type: 'head_deployment',
              timezone: 'America/Los_Angeles',
              includeTestFunctions: true,
              mcpVersion: '1.0.0'
            });
            
            // Find the shim file in generated files
            const shimFile = shimCode.files.find(file => file.name === '__mcp_gas_run');
            if (!shimFile || !shimFile.source) {
              throw new Error('Failed to generate execution shim code');
            }
            
            // Add the shim file to the project using updateFile method
            await this.gasClient.updateFile(
              scriptId, 
              '__mcp_gas_run', 
              shimFile.source, 
              0, // Position 0 to load first
              accessToken
            );
            
            console.log(`✅ Added execution shim (__mcp_gas_run) - ${shimFile.source.split('\n').length} lines`);
          } else {
            console.log(`✅ Execution shim already exists, proceeding with deployment...`);
          }

          // Ensure manifest has proper entry point configuration for Web App deployment
          console.log(`🔧 Updating manifest for WEB_APP deployment...`);
          await ensureManifestEntryPoints(this.gasClient, scriptId, 'WEB_APP', 'MYSELF', accessToken);
          
          // REDUCED: Wait for manifest update to be processed (reduced from 2s to 500ms)
          console.log(`⏳ Brief wait for manifest update processing...`);
          await new Promise(resolve => setTimeout(resolve, 500));

          // STEP 3: Ensure HEAD deployment exists (creates stable /dev URL for testing)
          console.log(`🎯 Ensuring HEAD deployment exists for testing...`);
          console.log(`📋 Testing Mode: Using HEAD deployment (/dev URL) for latest content`);
          
          const deploymentOptions = {
            entryPointType: 'WEB_APP' as const,
            webAppConfig: {
              access: 'MYSELF' as const,
              executeAs: 'USER_ACCESSING' as const
            }
          };

          const headResult = await this.gasClient.ensureHeadDeployment(
            scriptId,
            `HEAD deployment for testing - serves latest content`,
            deploymentOptions,
            accessToken
          );
          
          const deployment = headResult.deployment;
          console.log(`✅ ${headResult.wasCreated ? 'Created' : 'Using existing'} HEAD deployment: ${deployment.deploymentId}`);
          console.log(`🌐 HEAD Web App URL: ${headResult.webAppUrl}`);
          console.log(`🔄 Content updates: Automatic (no redeployment needed)`);
          console.log(`📝 URL type: ${headResult.webAppUrl?.includes('/dev') ? '/dev (testing endpoint)' : '/exec (versioned)'}`);
          
          // Get the Google web app URL and convert to gas_run format
          const googleWebAppUrl = headResult.webAppUrl;
          const gasRunUrl = await this.gasClient.constructGasRunUrl(scriptId, accessToken);
          
          console.log(`🌐 Google Web App URL: ${googleWebAppUrl}`);
          console.log(`🔧 Gas_run URL (using scriptId format): ${gasRunUrl}`);
          
          // Store the deployment info for immediate use
          immediateDeployment = {
            deploymentId: deployment.deploymentId,
            webAppUrl: gasRunUrl!,
            versionNumber: deployment.versionNumber, // null for HEAD
            updateTime: deployment.updateTime
          };


      }

      // Execute via web app URL with bearer token authentication
      console.log(`🌐 Executing via web app URL with bearer token...`);
      
      let webAppUrl = null;
      let webAppDeployment: any = null;
      
      // If we just created a deployment, use it immediately
      if (autoRedeploy && immediateDeployment) {
        console.log(`🚀 Using immediately created deployment: ${immediateDeployment.deploymentId}`);
        webAppUrl = immediateDeployment.webAppUrl;
        webAppDeployment = immediateDeployment;
        console.log(`✅ Using Web App URL from immediate deployment: ${webAppUrl}`);
            } else {
        // Get existing deployment and find web app URL
        console.log(`🔍 Looking up existing deployments to get web app URL`);
        
        try {
          const deployments = await this.gasClient.listDeployments(scriptId, accessToken);
          const foundDeployment = deployments.find(d => 
            d.entryPoints?.some(ep => ep.entryPointType === 'WEB_APP')
          );
          
          if (foundDeployment) {
            // Find the web app entry point and get its URL
            const webAppEntry = foundDeployment.entryPoints?.find(ep => ep.entryPointType === 'WEB_APP');
            const googleWebAppUrl = (webAppEntry as any)?.webApp?.url;
            
            if (googleWebAppUrl) {
              // Replace /exec with /dev in Google's URL
              webAppUrl = await this.gasClient.constructGasRunUrl(scriptId, accessToken);
              console.log(`✅ Using existing deployment: ${foundDeployment.deploymentId}`);
              console.log(`🌐 Google Web App URL: ${googleWebAppUrl}`);
              console.log(`🔧 Gas_run URL (replaced /exec with /dev): ${webAppUrl}`);
              console.log(`📝 URL type: /dev (gas_run format)`);
              
              webAppDeployment = {
                deploymentId: foundDeployment.deploymentId,
                webAppUrl: webAppUrl,
                versionNumber: foundDeployment.versionNumber,
                updateTime: foundDeployment.updateTime
              };
            } else {
              throw new Error('Web app deployment found but no URL available');
            }
          } else {
            throw new Error('No web app deployment found');
          }
        } catch (deploymentError: any) {
          console.log(`⚠️ Failed to find existing deployment: ${deploymentError.message}`);
          console.log(`🚀 Enabling auto-redeploy to create deployment...`);
          
          // Fall back to auto-redeploy if no existing deployment found
          autoRedeploy = true;
          // Continue to auto-redeploy logic at top of function
          throw new Error('No deployment found - auto-redeploy required');
        }
      }
      
      if (!webAppUrl) {
        throw new Error(`No functional web app deployment found. Auto-deployment may have failed.

This usually indicates:
1. Deployment creation succeeded but entry points weren't properly configured
2. Missing web app entry point in deployment response from GET API
3. Manifest file missing webapp configuration
4. All deployments lack proper web app configuration
5. API entry points may not be populated yet (try again in a few seconds)

Try running with autoRedeploy=true to create a fresh deployment.`);
      }
      
      // Build query parameters for execution
      const queryParams = new URLSearchParams();
      
      // Use the js_statement directly as it's already a complete JavaScript statement
      queryParams.set('func', js_statement);
      
      const executionUrl = `${webAppUrl}?${queryParams.toString()}`;
      console.log(`🌐 Execution URL: ${executionUrl}`);
      
      // Make HTTP request to web app with bearer token for authentication
      console.log(`🔐 Using bearer token for authenticated web app access`);
      console.log(`🔄 Following redirects automatically (redirect: 'follow')`);
      
      const response = await fetch(executionUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'MCP-Gas-Client/1.0',
          'Accept': 'application/json, text/plain, */*'
        },
        redirect: 'follow', // Explicitly follow redirects
        credentials: 'include', // Include credentials in redirected requests
        mode: 'cors' // Enable CORS for cross-domain redirects
      });
      
      const responseText = await response.text();
      console.log(`📥 Response status: ${response.status} ${response.statusText}`);
      console.log(`📥 Response URL: ${response.url}`);
      console.log(`📥 Response redirected: ${response.redirected}`);
      console.log(`📥 Response headers:`, {
        'content-type': response.headers.get('content-type'),
        'location': response.headers.get('location'),
        'set-cookie': response.headers.get('set-cookie')
      });
      console.log(`📥 Response text (first 500 chars): ${responseText.substring(0, 500)}`);
      
      let result;
      try {
        result = { result: JSON.parse(responseText) };
      } catch (parseError) {
        // If not JSON, treat as HTML error page
        if (responseText.includes('DOCTYPE html') || responseText.includes('<html')) {
          throw new Error(`Web app returned HTML error page instead of JSON. This usually indicates authentication issues or deployment problems.`);
        }
        result = { result: responseText };
      }

      // Check if the response indicates an error
      if (!response.ok) {
        console.error(`❌ Web app execution failed with status ${response.status}`);
        
              // Return JSON error response with URL information
      return {
        status: 'error',
        scriptId,
        js_statement,
        proxyFunction: 'doGet',
        error: {
          type: 'WebAppError',
          message: `HTTP ${response.status}: ${response.statusText}`,
          responseText: responseText
        },
        executedAt: new Date().toISOString(),
        proxyPattern: 'doGet() → Function() constructor execution',
        autoRedeploy: autoRedeploy,
        runtime: 'V8',
        urlInfo: {
          webAppUrl: webAppUrl,
          executionUrl: executionUrl,
          redirected: response.redirected,
          finalUrl: response.url
        }
      };
      }

      console.log(`✅ Web app execution successful`);
      console.log(`📤 Raw result:`, result.result);

      // Handle the structured JSON response from web app
      let dehydratedResult = result.result;
      
      // Check for new structured response format {type: "data"|"exception", payload: ...}
      if (dehydratedResult && typeof dehydratedResult === 'object' && dehydratedResult.type) {
        console.log(`📦 Processing structured response with type: ${dehydratedResult.type}`);
        
        if (dehydratedResult.type === 'data') {
          console.log(`✅ Function executed successfully, returning data payload`);
          return {
            status: 'success',
            scriptId,
            js_statement,
            proxyFunction: 'doGet',
            result: dehydratedResult.payload,
            webAppDeployment: {
              webAppUrl,
              executionUrl,
              entryPointType: 'WEB_APP',
              wasCreated: autoRedeploy
            },
            executedAt: new Date().toISOString(),
            sessionId: this.sessionAuthManager?.getSessionId(),
            devMode,
            autoRedeploy: autoRedeploy,
            proxyInfo: {
              proxyPattern: 'doGet() → Function() constructor execution',
              targetStatement: js_statement,
              proxyFunction: 'doGet',
              description: 'Structured JSON payload with type data/exception',
              resultFormat: 'JSON with type-based payload handling',
              runtime: 'V8',
              supportedLanguages: ['GS', 'TS', 'HTML', 'ES6']
            }
          };
          
        } else if (dehydratedResult.type === 'exception') {
          console.log(`❌ Function execution failed, throwing dehydrated exception`);
          
          // Create a proper error object from the exception payload
          const exceptionPayload = dehydratedResult.payload;
          const error = new Error(exceptionPayload.error.message);
          error.name = exceptionPayload.error.name || 'FunctionExecutionError';
          error.stack = exceptionPayload.error.stack || '';
          
          // Add additional error properties
          (error as any).js_statement = js_statement;
          (error as any).timestamp = exceptionPayload.timestamp;
          (error as any).errorType = exceptionPayload.error.type;
          (error as any).proxyPattern = exceptionPayload.proxyPattern;
          
          // Throw the dehydrated exception
          throw error;
        }
      }
      
      // Handle legacy response format for backward compatibility
      if (dehydratedResult && typeof dehydratedResult === 'object' && 
          'success' in dehydratedResult && 'proxyPattern' in dehydratedResult) {
        console.log(`📦 Using legacy structured proxy response`);
      } else {
        // Wrap raw result in our standard format
        dehydratedResult = {
          js_statement: js_statement,
          result: dehydratedResult,
          timestamp: new Date().toISOString(),
          proxyPattern: 'doGet() → Function() constructor execution',
          runtime: 'V8',
          version: '1.0.0'
        };
      }

      return {
        status: 'success',
        scriptId,
        js_statement,
        proxyFunction: 'doGet',
        result: dehydratedResult,
        webAppDeployment: {
          webAppUrl,
          executionUrl,
          entryPointType: 'WEB_APP',
          wasCreated: autoRedeploy
        },
        executedAt: new Date().toISOString(),
        sessionId: this.sessionAuthManager?.getSessionId(),
        devMode,
        autoRedeploy: autoRedeploy,
        proxyInfo: {
          proxyPattern: 'doGet() → Function() constructor execution',
          targetStatement: js_statement,
          proxyFunction: 'doGet',
          description: 'JSON-serializable web app pattern with Function() constructor execution',
          resultFormat: 'JSON with structured payload handling',
          runtime: 'V8',
          supportedLanguages: ['GS', 'TS', 'HTML', 'ES6']
        }
      };

    } catch (error: any) {
      console.error(`❌ doGet() proxy execution error:`, error);
      
      // Extract HTTP status code from various error sources
      const statusCode = error.data?.statusCode || 
                         error.response?.status || 
                         error.statusCode ||
                         error.code || 
                         500;
      
      // Log detailed error information for debugging
      console.error(`📊 Error details:`, {
        name: error.name,
        message: error.message,
        statusCode,
        errorData: error.data,
        responseStatus: error.response?.status,
        errorCode: error.code
      });
      
      let helpMessage = `HTTP ${statusCode}: ${error.message || 'Unknown error occurred during doGet() proxy execution'}`;
      let setupInstructions: string[] = [];

      if (statusCode === 404) {
        helpMessage = `doGet() function not found - auto-deployment may have failed or deployment does not include latest files with doGet() proxy`;
        setupInstructions = [
          '🚨 AUTO-DEPLOYMENT ISSUE:',
          '   Auto-deployment may have failed to create or deploy the Web App properly',
          '',
          '📋 TROUBLESHOOTING STEPS:',
          '1. Verify project exists: gas_ls(path="your-project")',
          '2. Add doGet() proxy: gas_proxy_setup(scriptId="your-project")',
          '3. Check deployments: gas_deploy_list(scriptId="your-project")',
          '4. Retry with autoRedeploy enabled: gas_run(scriptId="your-project", js_statement="yourFunction()", autoRedeploy=true)',
          '',
          '💡 ALTERNATIVE - MANUAL DEPLOYMENT:',
          '   • Visit https://script.google.com',
          '   • Open your project',
          '   • Ensure doGet() function is present',
          '   • Deploy → New deployment → Web app',
          '   • Set Execute as: Me, Who has access: Anyone',
          '   • Deploy and note the deployment URL',
          '',
          '🚀 RUNTIME SUPPORT: GS, TS, HTML, ES6 with V8 runtime',
          '⚡ AUTO-DEPLOY: Enabled by default for seamless execution'
        ];
      } else if (statusCode === 403) {
        helpMessage = 'Permission denied - Cloud Platform project mismatch or insufficient scopes';
        setupInstructions = [
          '1. Ensure your Google Cloud Project is linked to the Apps Script project',
          '2. Check that you have sufficient OAuth scopes',
          '3. Re-authenticate with updated scopes if needed',
          '4. Verify the script project is deployed for API use'
        ];
      }

      // Return JSON error response
      return {
        status: 'error',
        scriptId,
        js_statement,
        proxyFunction: 'doGet',
        error: {
          type: 'GASApiError',
          message: error.message,
          statusCode,
          helpMessage,
          setupInstructions
        },
        troubleshooting: {
          autoDeploymentFeatures: [
            '🚀 AUTO-DEPLOY: gas_run() automatically deploys as Web App by default',
            '🔄 AUTO-VERSION: Creates new version with latest code changes',
            '⚡ SEAMLESS: No manual deployment needed - just call gas_run()',
            '🛠️ PROXY-SETUP: Automatically handles doGet() proxy function setup'
          ],
          runtimeSupport: [
            '📝 Google Apps Script (.gs files)',
            '🔷 JavaScript (.gs files) - Native Google Apps Script support',
            '🌐 HTML files for web app UI',
            '⚡ ES6+ JavaScript with V8 runtime',
            '🔧 Modern JavaScript features and syntax'
          ],
          doGetRequirements: [
            'Script must have a doGet() function (use gas_proxy_setup to add)',
            'doGet() must handle dynamic function routing with globalThis',
            'All target functions must be accessible from globalThis',
            'Responses should be JSON-serializable'
          ],
          autoDeploymentWorkflow: [
            '1. gas_run(scriptId="project", js_statement="targetFunction()") - that\'s it!',
            '   Auto-deployment is enabled by default',
            '2. Optional: gas_proxy_setup(scriptId="project") if doGet() missing',
            '3. The tool automatically:',
            '   • Creates new version with latest code',
            '   • Deploys as Web App',
            '   • Executes your function',
            '   • Returns structured JSON response'
          ],
          proxyPattern: 'doGet() → __gas_run(js_statement) with JSON responses',
          jsonHandling: 'Returns success/error objects that can be dehydrated/rehydrated'
        },
        executedAt: new Date().toISOString(),
        sessionId: this.sessionAuthManager?.getSessionId(),
        autoRedeploy: autoRedeploy,
        runtime: 'V8'
      };
    }
  }
} 