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
          executeAs: 'USER_DEPLOYING'
        };
        needsUpdate = true;
        console.log(`📝 Set webapp configuration: access=${accessLevel}, executeAs=USER_DEPLOYING`);
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
 * - This tool AUTOMATICALLY creates __mcp_gas_run.gs shim code if missing
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
 * - Execution shim (__mcp_gas_run.gs) will be auto-added if missing
 * - Returns JSON responses that can be properly dehydrated/rehydrated
 * - Must have script.scriptapp OAuth scope
 */
export class GASRunTool extends BaseTool {
  public name = 'gas_run';
  public description = 'Execute any JavaScript/Apps Script statement or function call directly with automatic deployment management. Creates fresh web app deployment by default to ensure latest code. Creates shim code (__mcp_gas_run.gs) automatically if missing. Supports dynamic code execution via Function constructor.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID. Tool will create fresh web app deployment by default to ensure latest code is deployed and executed.'
      },
      functionName: {
        type: 'string',
        description: 'Name of the function to execute via doGet() proxy (must be accessible via globalThis)'
      },
      parameters: {
        type: 'array',
        items: {
          type: 'object'
        },
        description: 'Array of parameters to pass to the target function (optional)',
        default: []
      },
      devMode: {
        type: 'boolean',
        description: 'Run in development mode (default: true)',
        default: true
      },
      autoRedeploy: {
        type: 'boolean',
        description: 'Enable automatic fresh deployment: creates NEW VERSION + NEW WEB APP DEPLOYMENT before each execution to ensure latest code. Set to false to use existing deployment only. (default: true)',
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

  /**
   * Get the standard doGet() proxy function code using consolidated code generator
   * **Replaces hardcoded proxy function with generated code**
   */
  public static getProxyFunctionCode(): string {
    // Use consolidated code generator for web app proxy
    const proxyCodeResult = GASCodeGenerator.generateCode({
      type: 'web_app_proxy',
      responseFormat: 'structured',
      mcpVersion: '1.0.0'
    });

    // Return the first (and only) file's source code
    return proxyCodeResult.files[0].source || '';
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    // Use new validation utilities
    const scriptId = this.validate.scriptId(params.scriptId, 'doGet proxy execution');
    const functionName = this.validate.functionName(params.functionName, 'doGet proxy execution');
    const parameters = params.parameters || [];
    const devMode = params.devMode !== false; // Default to true
    const autoRedeploy = params.autoRedeploy !== false; // Default to true (changed)


    // Validate parameters is an array
    if (!Array.isArray(parameters)) {
      throw new ValidationError('parameters', parameters, 'array of function parameters');
    }

    try {
      console.log(`🌐 Executing function via doGet() proxy: ${functionName} in script: ${scriptId}`);
      console.log(`📋 Target function: ${functionName}`);
      console.log(`📋 Parameters: ${JSON.stringify(parameters)}`);
      console.log(`🔧 Using doGet() → globalThis[${functionName}](...args) pattern`);
      console.log(`🔧 Auto-redeploy: ${autoRedeploy} (default: true)`);
      console.log(`🔧 Deploy as Web App: always (web-app-only implementation)`);
      console.log(`🚀 Runtime: V8 (supports GS, TS, HTML, ES6)`);

      // Variables to store deployment info
      let immediateDeployment: any = null;
      
      // Check if we need to redeploy
      if (autoRedeploy) {
        console.log(`🚀 Auto-redeployment enabled, setting up web app infrastructure...`);
        
        // 🔧 CRITICAL FIX: Add execution shim before deployment
          console.log(`🔧 Checking for execution shim (__mcp_gas_run.gs)...`);
          
          // Check if shim already exists
          let shimExists = false;
          try {
            const existingFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
            shimExists = existingFiles.some((file: GASFile) => file.name === '__mcp_gas_run.gs') || false;
            console.log(`📁 Shim exists: ${shimExists}`);
          } catch (checkError: any) {
            console.log(`⚠️ Could not check existing files, will add shim: ${checkError.message}`);
          }
          
          // Add execution shim if not present
          if (!shimExists) {
            console.log(`🔧 Adding execution shim (__mcp_gas_run.gs) for dynamic code execution...`);
            
            const shimCode = GASCodeGenerator.generateCode({
              type: 'head_deployment',
              timezone: 'America/Los_Angeles',
              includeTestFunctions: true,
              mcpVersion: '1.0.0'
            });
            
            // Find the shim file in generated files
            const shimFile = shimCode.files.find(file => file.name === '__mcp_gas_run.gs');
            if (!shimFile || !shimFile.source) {
              throw new Error('Failed to generate execution shim code');
            }
            
            // Add the shim file to the project using updateFile method
            await this.gasClient.updateFile(
              scriptId, 
              '__mcp_gas_run.gs', 
              shimFile.source, 
              0, // Position 0 to load first
              accessToken
            );
            
            console.log(`✅ Added execution shim (__mcp_gas_run.gs) - ${shimFile.source.split('\n').length} lines`);
            
            // Wait a moment for the file to be processed
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            console.log(`✅ Execution shim already exists, proceeding with deployment...`);
          }

          // Ensure manifest has proper entry point configuration for Web App deployment
          console.log(`🔧 Updating manifest for WEB_APP deployment...`);
          await ensureManifestEntryPoints(this.gasClient, scriptId, 'WEB_APP', 'MYSELF', accessToken);
          
          // Wait for manifest update to be processed by Google Apps Script
          console.log(`⏳ Waiting for manifest update to be processed...`);
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Create new version (now includes shim if it was missing)
          const versionResult = await this.gasClient.createVersion(
            scriptId, 
            `Auto-redeploy for ${functionName} execution at ${new Date().toISOString()}`, 
            accessToken
          );
          console.log(`✅ Created version: ${versionResult.versionNumber}`);

          // Create web app deployment (always WEB_APP for this implementation)
          const deploymentOptions = {
            entryPointType: 'WEB_APP' as const,
            webAppConfig: {
              access: 'MYSELF' as const,
              executeAs: 'USER_DEPLOYING' as const
            }
          };

          // Create new web app deployment
          const deploymentResult = await this.gasClient.createDeployment(
            scriptId,
            `Web App deployment for ${functionName} - ${new Date().toISOString()}`,
            deploymentOptions,
            versionResult.versionNumber,
            accessToken
          );
          
          console.log(`✅ Created Web App deployment: ${deploymentResult.deploymentId}`);
          
          // Store deployment info for immediate use (avoid re-searching)
          let immediateWebAppUrl = deploymentResult.webAppUrl;
          
          // If webAppUrl is not in the response, construct it manually
          if (!immediateWebAppUrl) {
            immediateWebAppUrl = `https://script.google.com/macros/s/${deploymentResult.deploymentId}/exec`;
            console.log(`🔧 Constructed Web App URL from deployment ID: ${immediateWebAppUrl}`);
          } else {
            console.log(`🌐 Got Web App URL from deployment response: ${immediateWebAppUrl}`);
          }
          
          // Store the deployment info for immediate use
          immediateDeployment = {
            deploymentId: deploymentResult.deploymentId,
            webAppUrl: immediateWebAppUrl,
            versionNumber: deploymentResult.versionNumber,
            updateTime: deploymentResult.updateTime
          };


      }

      // Execute via web app URL with bearer token authentication
      console.log(`🌐 Executing via web app URL with bearer token...`);
      
      let webAppUrl = null;
      let webAppDeployment = null;
      
      // If we just created a deployment, use it immediately
      if (autoRedeploy && immediateDeployment) {
        console.log(`🚀 Using immediately created deployment: ${immediateDeployment.deploymentId}`);
        webAppUrl = immediateDeployment.webAppUrl;
        webAppDeployment = immediateDeployment;
        console.log(`✅ Using Web App URL from immediate deployment: ${webAppUrl}`);
      } else {
        // STEP 1: List all deployments 
        console.log(`🔍 Step 1: Listing existing deployments...`);
        const deploymentsList = await this.gasClient.listDeployments(scriptId, accessToken);
        console.log(`📋 Found ${deploymentsList.length} deployments`);
        
        // Sort deployments by update time (most recent first)
        const sortedDeployments = deploymentsList.sort((a, b) => 
          new Date(b.updateTime || 0).getTime() - new Date(a.updateTime || 0).getTime()
        );
        
        if (deploymentsList.length > 0) {
          
          // STEP 2: Get detailed information for each deployment to check for web app URLs
          console.log(`🔍 Step 2: Getting detailed information for each deployment...`);
          
          for (const basicDeployment of sortedDeployments) {
            console.log(`🔍 Checking deployment ${basicDeployment.deploymentId} (${basicDeployment.updateTime})`);
            
            try {
              // Get detailed deployment info with complete entry points
              const detailedDeployment = await this.gasClient.getDeployment(
                scriptId, 
                basicDeployment.deploymentId, 
                accessToken
              );
              
              console.log(`📦 Deployment ${basicDeployment.deploymentId} entry points:`, 
                         detailedDeployment.entryPoints?.length || 0);
              
              // Check if this is a functional web app deployment with a URL
              if (detailedDeployment.entryPoints && Array.isArray(detailedDeployment.entryPoints)) {
                const webAppEntry = detailedDeployment.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
                
                if (webAppEntry?.webApp?.url) {
                  webAppUrl = webAppEntry.webApp.url;
                  webAppDeployment = detailedDeployment;
                  console.log(`✅ Found functional Web App deployment with URL: ${webAppUrl}`);
                  console.log(`🔑 Access: ${webAppEntry.webApp.entryPointConfig?.access || 'Unknown'}, Execute as: ${webAppEntry.webApp.entryPointConfig?.executeAs || 'Unknown'}`);
                  break; // Found a working web app, use it
                } else if (webAppEntry) {
                  console.log(`⚠️  Web App entry point found but missing URL in deployment ${basicDeployment.deploymentId}`);
                } else {
                  console.log(`📝 Deployment ${basicDeployment.deploymentId} has no Web App entry point`);
                }
              } else {
                console.log(`📝 Deployment ${basicDeployment.deploymentId} has no entry points configured`);
              }
            } catch (deploymentError: any) {
              console.log(`⚠️  Failed to get details for deployment ${basicDeployment.deploymentId}: ${deploymentError.message}`);
            }
          }
        }
        
        // STEP 3: If no functional web app deployment found, create one
        if (!webAppUrl) {
          console.log(`🚀 Step 3: No functional web app deployment found, creating new one...`);
          
          // STEP 3a: Update the appsscript.json manifest to ensure web app entry points
          console.log(`🔧 Step 3a: Updating appsscript.json manifest for Web App deployment...`);
          await ensureManifestEntryPoints(this.gasClient, scriptId, 'WEB_APP', 'MYSELF', accessToken);
          
          // Wait for manifest update to be processed
          console.log(`⏳ Waiting for manifest update to be processed...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // STEP 3b: Create new version with updated manifest
          console.log(`🔧 Step 3b: Creating new version with web app manifest...`);
          const versionResult = await this.gasClient.createVersion(
            scriptId, 
            `Web App deployment for ${functionName} execution at ${new Date().toISOString()}`, 
            accessToken
          );
          console.log(`✅ Created version: ${versionResult.versionNumber}`);
          
          // STEP 3c: Create web app deployment with explicit entry point configuration
          console.log(`🔧 Step 3c: Creating Web App deployment with entry points...`);
          const deploymentOptions = {
            entryPointType: 'WEB_APP' as const,
            webAppConfig: {
              access: 'MYSELF' as const,
              executeAs: 'USER_DEPLOYING' as const
            },
            accessLevel: 'MYSELF' as const
          };
          
          const deploymentResult = await this.gasClient.createDeployment(
            scriptId,
            `Web App deployment for ${functionName} - ${new Date().toISOString()}`,
            deploymentOptions,
            versionResult.versionNumber,
            accessToken
          );
          
          console.log(`✅ Created Web App deployment: ${deploymentResult.deploymentId}`);
          console.log(`📦 Entry points configured:`, deploymentResult.entryPoints?.length || 0);
          
          // Get the web app URL from the deployment response
          webAppUrl = deploymentResult.webAppUrl;
          
          // If webAppUrl is not in the response, construct it manually and verify with get details
          if (!webAppUrl) {
            console.log(`🔧 Web App URL not in deployment response, constructing and verifying...`);
            const constructedUrl = `https://script.google.com/macros/s/${deploymentResult.deploymentId}/exec`;
            
            // Verify the deployment by getting its details
            try {
              const verifyDeployment = await this.gasClient.getDeployment(
                scriptId, 
                deploymentResult.deploymentId, 
                accessToken
              );
              
              const webAppEntry = verifyDeployment.entryPoints?.find((ep: any) => ep.entryPointType === 'WEB_APP');
              if (webAppEntry?.webApp?.url) {
                webAppUrl = webAppEntry.webApp.url;
                console.log(`✅ Verified Web App URL from deployment details: ${webAppUrl}`);
              } else {
                webAppUrl = constructedUrl;
                console.log(`🔧 Using constructed Web App URL: ${webAppUrl}`);
              }
            } catch (verifyError: any) {
              webAppUrl = constructedUrl;
              console.log(`⚠️  Failed to verify deployment, using constructed URL: ${webAppUrl}`);
            }
          } else {
            console.log(`🌐 Got Web App URL from deployment response: ${webAppUrl}`);
          }
          
          // Store the deployment info
          webAppDeployment = deploymentResult;
          immediateDeployment = {
            deploymentId: deploymentResult.deploymentId,
            webAppUrl: webAppUrl,
            versionNumber: deploymentResult.versionNumber,
            updateTime: deploymentResult.updateTime
          };
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
      
      // Handle complete statements directly
      let statement: string;
      if (functionName.includes('(') || functionName.includes('.') || functionName === 'Math.PI') {
        // Already a complete statement/expression like "fib(7)", "Math.PI", "new Date()"
        statement = functionName;
      } else {
        // Function name only, add parameters to create complete statement
        statement = `${functionName}(${parameters.map(p => JSON.stringify(p)).join(', ')})`;
      }
      
      queryParams.set('function_plus_args', statement);
      
      const executionUrl = `${webAppUrl}?${queryParams.toString()}`;
      console.log(`🌐 Execution URL: ${executionUrl}`);
      
      // Make HTTP request to web app with bearer token for authentication
      console.log(`🔐 Using bearer token for authenticated web app access`);
      
      const response = await fetch(executionUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      const responseText = await response.text();
      console.log(`📥 Response status: ${response.status}`);
      console.log(`📥 Response text: ${responseText}`);
      
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
        
        // Return JSON error response
        return {
          status: 'error',
          scriptId,
          functionName,
          proxyFunction: 'doGet',
          parameters,
          error: {
            type: 'WebAppError',
            message: `HTTP ${response.status}: ${response.statusText}`,
            responseText: responseText
          },
          executedAt: new Date().toISOString(),
          proxyPattern: 'doGet() → globalThis[functionName](...args)',
          autoRedeploy: autoRedeploy,
          runtime: 'V8'
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
            functionName,
            proxyFunction: 'doGet',
            parameters,
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
              proxyPattern: 'doGet() → globalThis[functionName](...args)',
              targetFunction: functionName,
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
          (error as any).functionName = exceptionPayload.functionName;
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
          functionName: functionName,
          result: dehydratedResult,
          timestamp: new Date().toISOString(),
          proxyPattern: 'doGet() → globalThis[functionName](...args)',
          runtime: 'V8',
          version: '1.0.0'
        };
      }

      return {
        status: 'success',
        scriptId,
        functionName,
        proxyFunction: 'doGet',
        parameters,
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
          proxyPattern: 'doGet() → globalThis[functionName](...args)',
          targetFunction: functionName,
          proxyFunction: 'doGet',
          description: 'JSON-serializable web app pattern with globalThis routing',
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
          '4. Retry with autoRedeploy enabled: gas_run(scriptId="your-project", functionName="yourFunction", autoRedeploy=true)',
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
        functionName,
        proxyFunction: 'doGet',
        parameters,
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
            '1. gas_run(scriptId="project", functionName="targetFunction") - that\'s it!',
            '   Auto-deployment is enabled by default',
            '2. Optional: gas_proxy_setup(scriptId="project") if doGet() missing',
            '3. The tool automatically:',
            '   • Creates new version with latest code',
            '   • Deploys as Web App',
            '   • Executes your function',
            '   • Returns structured JSON response'
          ],
          proxyPattern: 'doGet() → globalThis[functionName](...args) with JSON responses',
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