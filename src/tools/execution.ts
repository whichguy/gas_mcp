import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ValidationError, GASApiError, AuthenticationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { CodeGenerator } from '../utils/codeGeneration.js';
import { GASFile } from '../api/gasClient.js';
import { ProjectResolver, ProjectParam } from '../utils/projectResolver.js';
import open from 'open';

/**
 * Simple token counting utility for MCP response size protection
 * Estimates tokens using approximate character-to-token ratio
 */
function estimateTokenCount(text: string): number {
  // Rough estimation: 1 token ≈ 4 characters (conservative)
  // This accounts for JSON structure, whitespace, and encoding overhead
  return Math.ceil(text.length / 3.5);
}

/**
 * Protects MCP responses from exceeding token limits by truncating logger_output
 * @param response The response object to protect
 * @param maxTokens Maximum allowed tokens (default: 22000, leaving room for structure)
 * @returns Protected response with truncated logger_output if needed
 */
function protectResponseSize(response: any, maxTokens: number = 22000): any {
  // Convert response to JSON to get accurate size estimate
  const responseJson = JSON.stringify(response);
  const estimatedTokens = estimateTokenCount(responseJson);
  
  if (estimatedTokens <= maxTokens) {
    // Response is within limits, return as-is
    return response;
  }
  
  console.error(`⚠️ [RESPONSE SIZE PROTECTION] Response size: ${estimatedTokens} tokens > ${maxTokens} limit - truncating logger_output`);
  
  // Calculate how much we need to reduce
  const excessTokens = estimatedTokens - maxTokens;
  const loggerOutput = response.logger_output || '';
  
  if (!loggerOutput) {
    // No logger output to truncate, but response is still too large
    console.error(`❌ [RESPONSE SIZE PROTECTION] Response too large but no logger_output to truncate!`);
    return {
      ...response,
      result: '[TRUNCATED: Response too large for MCP protocol]',
      logger_output: `⚠️ RESPONSE SIZE ERROR: Response (${estimatedTokens} tokens) exceeded MCP limit (${maxTokens}) but had no logger_output to truncate.`
    };
  }
  
  // Calculate target logger_output size (conservatively remove extra tokens)
  const excessChars = Math.ceil(excessTokens * 4); // Conservative character removal
  const targetLoggerSize = Math.max(0, loggerOutput.length - excessChars - 500); // Extra buffer
  
  if (targetLoggerSize <= 0) {
    // Logger output needs to be completely removed
    return {
      ...response,
      logger_output: `⚠️ LOGGER TRUNCATED: Full logger output (${loggerOutput.length} chars) removed due to MCP token limit. Original response: ${estimatedTokens} tokens > ${maxTokens} limit.`
    };
  }
  
  // Truncate logger output and add informative message
  const truncatedLogger = loggerOutput.substring(0, targetLoggerSize);
  const truncationMessage = `\n\n⚠️ LOGGER TRUNCATED: Output truncated from ${loggerOutput.length} to ${targetLoggerSize} chars (removed ${loggerOutput.length - targetLoggerSize} chars) due to MCP token limit. Original response: ${estimatedTokens} tokens > ${maxTokens} limit.`;
  
  const protectedResponse = {
    ...response,
    logger_output: truncatedLogger + truncationMessage
  };
  
  // Verify the protected response is within limits
  const protectedJson = JSON.stringify(protectedResponse);
  const protectedTokens = estimateTokenCount(protectedJson);
  
  console.error(`✅ [RESPONSE SIZE PROTECTION] Protected response: ${protectedTokens} tokens (was ${estimatedTokens})`);
  
  return protectedResponse;
}

/**
 * Execute JavaScript in Google Apps Script with current project support (RECOMMENDED)
 * 
 * ✅ RECOMMENDED - Use for normal code execution
 * Automatically uses current project when set, otherwise requires explicit script ID
 */
export class GASRunTool extends BaseTool {
  public name = 'gas_run';
  public description = '🚀 RECOMMENDED: Execute JavaScript using current project context or explicit script ID';
  
  public inputSchema = {
    type: 'object',
    properties: {
      js_statement: {
        type: 'string',
        description: 'JavaScript statement to execute directly in Google Apps Script. COMPREHENSIVE EXECUTION CAPABILITIES: (1) Run arbitrary JavaScript expressions and statements of unlimited length, (2) Execute existing functions from your project files using require("ModuleName").functionName() pattern, (3) Access ALL Google Apps Script services (DriveApp, SpreadsheetApp, GmailApp, etc.), (4) All Logger.log() output is automatically captured and returned. COMMONJS INTEGRATION: Use require("Utils").myFunction() to call functions from other project files - the CommonJS system resolves all dependencies automatically.',
        minLength: 1,
        examples: [
          // Basic JavaScript and Math
          'Math.PI * 2',
          'new Date().toISOString()',
          '[1,2,3,4,5].reduce((sum, n) => sum + n, 0)',
          'JSON.stringify({message: "Hello", timestamp: new Date()})',
          
          // Google Apps Script Services - Drive
          'DriveApp.getRootFolder().getName()',
          'DriveApp.getFiles().next().getName()',
          'DriveApp.createFile("test.txt", "Hello World").getId()',
          'DriveApp.getFilesByName("MyFile").hasNext()',
          
          // Google Apps Script Services - Spreadsheets
          'SpreadsheetApp.create("My New Sheet").getId()',
          'SpreadsheetApp.getActiveSheet().getRange("A1").setValue("Hello")',
          'SpreadsheetApp.openById("your-sheet-id").getSheets().length',
          
          // Google Apps Script Services - Gmail
          'GmailApp.getInboxThreads(0, 5).length',
          'GmailApp.search("is:unread").length',
          
          // Google Apps Script Services - Calendar
          'CalendarApp.getDefaultCalendar().getName()',
          'CalendarApp.getAllCalendars().length',
          
          // Google Apps Script Services - Documents
          'DocumentApp.create("New Doc").getId()',
          
          // Google Apps Script Services - Utilities
          'Utilities.getUuid()',
          'Utilities.base64Encode("Hello World")',
          'Utilities.formatDate(new Date(), "GMT", "yyyy-MM-dd")',
          
          // Google Apps Script Services - Properties & Cache
          'PropertiesService.getScriptProperties().getKeys().length',
          'CacheService.getScriptCache().get("test")',
          
          // Google Apps Script Services - URL Fetch
          'UrlFetchApp.fetch("https://api.github.com/zen").getContentText()',
          
          // Session and User Info
          'Session.getActiveUser().getEmail()',
          'Session.getTemporaryActiveUserKey()',
          'Session.getScriptTimeZone()',
          
          // Execute functions from your project files via CommonJS require()
          'require("Calculator").add(5, 3)',                    // Call add function from Calculator.js
          'require("Utils").formatDate(new Date())',            // Call formatDate from Utils.js
          'require("Database").getUserById(123)',               // Call getUserById from Database.js
          'require("API").fetchWeatherData("New York")',        // Call fetchWeatherData from API.js
          'require("MathLibrary").fibonacci(10)',               // Call fibonacci from MathLibrary.js
          'const utils = require("Utils"); utils.processData([1,2,3,4,5])', // Store module reference
          'const calc = require("Calculator"); calc.multiply(4, 6)',         // Chain multiple calls
          
          // Complex workflows combining project functions with GAS services
          'const data = require("Utils").parseCSV("name,age\\nJohn,30"); SpreadsheetApp.create("Import").getActiveSheet().getRange(1,1,data.length,2).setValues(data)',
          'const result = require("API").processPayment({amount: 100}); Logger.log("Payment result: " + JSON.stringify(result)); result.success',
          
          // Complex multi-line operations
          'const sheet = SpreadsheetApp.create("Data Analysis"); const data = [[1,2,3],[4,5,6]]; sheet.getActiveSheet().getRange(1,1,2,3).setValues(data); return sheet.getId()',
          
          // Logger.log() output is automatically captured and returned
          'Logger.log("Starting calculation..."); const result = 2 + 2; Logger.log("Result: " + result); result',
          'Logger.log("Calling project function..."); const data = require("Utils").getData(); Logger.log("Retrieved " + data.length + " items"); data',
          'Logger.log("Testing API integration"); const weather = require("API").getWeather("London"); Logger.log("Temperature: " + weather.temp); weather',
          
          // Error handling with comprehensive logging
          'try { const result = DriveApp.getRootFolder().getName(); Logger.log("Success: " + result); return result; } catch(e) { Logger.log("Error: " + e.toString()); throw e; }',
          'try { const user = require("Database").getUser(999); Logger.log("User found: " + user.name); return user; } catch(e) { Logger.log("User lookup failed: " + e.message); return null; }'
        ]
      },
      project: {
        oneOf: [
          {
            type: 'string',
            description: 'Local project name OR direct script ID (44 chars). If not provided, uses current project.'
          },
          {
            type: 'object',
            properties: {
              dev: { type: 'boolean', description: 'Use development environment' },
              staging: { type: 'boolean', description: 'Use staging environment' }, 
              prod: { type: 'boolean', description: 'Use production environment' },
              production: { type: 'boolean', description: 'Use production environment' }
            },
            description: 'Environment shortcut from local configuration'
          }
        ],
        description: 'Project to execute in (defaults to current project if set)'
      },
      autoRedeploy: {
        type: 'boolean',
        description: 'Enable automatic deployment infrastructure setup. FLEXIBLE OPTIONS: true (default) = auto-create deployments as needed, false = use existing deployments only, "force" = always create new deployment. Set to false for faster execution on pre-configured projects.',
        default: true
      },
      executionTimeout: {
        type: 'number',
        description: 'Maximum execution timeout in seconds (default: 780 = 13 minutes). Set higher for long-running operations. Maximum: 3600 seconds (1 hour).',
        default: 780,
        minimum: 780,
        maximum: 3600
      },
      responseTimeout: {
        type: 'number', 
        description: 'Maximum response reading timeout in seconds (default: 780 = 13 minutes). Set higher for large response payloads.',
        default: 780,
        minimum: 780,
        maximum: 3600
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['js_statement'],
    llmGuidance: {
      whenToUse: 'Use for normal JavaScript execution. Automatically uses current project context.',
      workflow: 'Set project with gas_project_set, then execute: gas_run({js_statement: "Math.sqrt(16)"}) for inline code or gas_run({js_statement: "require(\\"Calculator\\").add(5, 3)"}) for functions from files.',
      alternatives: 'Use gas_raw_run only when you need explicit script ID control',
      executionCapabilities: {
        arbitraryCode: 'Execute any JavaScript expressions, calculations, data processing of unlimited complexity',
        projectFunctions: 'CALL YOUR PROJECT FUNCTIONS: Use require("Utils").myFunction() to execute functions from any file in your project',
        commonJsIntegration: 'FULL MODULE SYSTEM: All dependencies resolved automatically, access to require(), module, exports throughout execution',
        gasServices: 'ALL Google Apps Script services: DriveApp, SpreadsheetApp, GmailApp, CalendarApp, DocumentApp, and 20+ other services',
        loggerCapture: 'ALL Logger.log() output automatically captured and returned - use for debugging, progress tracking, result logging'
      },
      executionPatterns: {
        inlineCode: 'Direct execution: Math.PI * 2, new Date(), Session.getActiveUser().getEmail()',
        builtinServices: 'Google Apps Script services: SpreadsheetApp.create(), DriveApp.getFiles()',
        projectFunctions: 'Your project functions: require("Utils").formatDate(), require("Database").getUser(123)',
        combinedWorkflows: 'Complex workflows: const data = require("API").getData(); SpreadsheetApp.create("Report").getActiveSheet().getRange(1,1,data.length,3).setValues(data)'
      }
    },
    responseSchema: {
      type: 'object',
      description: 'Response from gas_run execution with result and logger output',
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
          description: 'All accumulated logger output from console.log(), Logger.log(), and other logging during execution. Includes module loading messages, debug output, and any previous logging in the session.'
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
          description: 'Error details (only present when status is "error")',
          properties: {
            type: { type: 'string', description: 'Error type/category' },
            message: { type: 'string', description: 'Human-readable error message' },
            originalError: { type: 'string', description: 'Original error message if available' }
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

  async execute(params: any): Promise<any> {
    const { LocalFileManager } = await import('../utils/localFileManager.js');
    const workingDir = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    const js_statement = this.validate.string(params.js_statement, 'js_statement', 'JavaScript execution');
    const autoRedeploy = params.autoRedeploy !== false;
    const executionTimeout = Math.min(Math.max(params.executionTimeout || 780, 780), 3600); // 13m-1h range
    const responseTimeout = Math.min(Math.max(params.responseTimeout || 780, 780), 3600); // 13m-1h range
    
    // Get auth token first for project resolution
    const accessToken = await this.getAuthToken(params);
    
    // Resolve script ID
    let scriptId: string;
    
    try {
      scriptId = await ProjectResolver.resolveProjectId(params.project, workingDir, accessToken);
    } catch (error: any) {
      if (!params.project) {
        throw new ValidationError('project', 'undefined', 'project parameter or current project (use gas_project_set)');
      }
      throw error;
    }
    
    // Create a raw tool instance to execute the actual logic
    const rawTool = new GASRawRunTool(this.sessionAuthManager);
    
    return await rawTool.execute({
      scriptId,
      js_statement,
      autoRedeploy,
      executionTimeout,
      responseTimeout,
      accessToken
    });
  }
}

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
          `Authentication required for gas_run_api_exec operation. Use gas_auth(mode="start") to authenticate and retry.`
        );
      }
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
          `Authentication required for gas_run_api_exec operation (HTTP ${authStatusCode}). Use gas_auth(mode="start") to authenticate and retry.`
        );
        
        // Add HTTP response details to error data
        authError.data = {
          ...authError.data,
          statusCode: authStatusCode,
          operation: 'gas_run_api_exec',
          scriptId,
          httpResponse: httpDetails,
          instructions: [
            'Use gas_auth with mode="start" to begin authentication',
            'Complete the OAuth flow in your browser',
            'Then retry your gas_run_api_exec request'
          ],
          command: 'gas_auth({"mode": "start"})',
          statusCheck: 'gas_auth({"mode": "status"})'
        };
        
        throw authError;
      }
      
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
export class GASRawRunTool extends BaseTool {
  public name = 'gas_raw_run';
  public description = '🔧 ADVANCED: Execute JavaScript with explicit script ID. Use gas_run for normal workflow.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
                  description: 'Google Apps Script project ID. LLM REQUIREMENT: Must be a valid 44-character Google Drive file ID for an Apps Script project. Get this from gas_project_create or gas_ls tools.',
        pattern: '^[a-zA-Z0-9_-]{44}$',
        minLength: 44,
        maxLength: 44,
        llmHints: {
          obtain: 'Use gas_project_create to create new project, or gas_ls to list existing projects',
          format: 'Long alphanumeric string, looks like: 1jK_ujSHRCsEeBizi6xycuj_0y5qDqvMzLJHBE9HLUiM5JmSyzF4Ga_kM',
          validation: 'Tool will validate this is a real, accessible project ID'
        }
      },
      js_statement: {
        type: 'string',
        description: 'JavaScript statement to execute directly in Google Apps Script. COMPREHENSIVE EXECUTION CAPABILITIES: (1) Run arbitrary JavaScript expressions and statements of unlimited length, (2) Execute existing functions from your project files using require("ModuleName").functionName() pattern, (3) Access ALL Google Apps Script services (DriveApp, SpreadsheetApp, GmailApp, etc.), (4) All Logger.log() output is automatically captured and returned. COMMONJS INTEGRATION: Use require("Utils").myFunction() to call functions from other project files - the CommonJS system resolves all dependencies automatically.',
        minLength: 1,
        examples: [
          // Basic JavaScript and Math
          'Math.PI * 2',
          'new Date().toISOString()',
          '[1,2,3,4,5].reduce((sum, n) => sum + n, 0)',
          'JSON.stringify({message: "Hello", timestamp: new Date()})',
          
          // Google Apps Script Services - Drive
          'DriveApp.getRootFolder().getName()',
          'DriveApp.getFiles().next().getName()',
          'DriveApp.createFile("test.txt", "Hello World").getId()',
          'DriveApp.getFilesByName("MyFile").hasNext()',
          
          // Google Apps Script Services - Spreadsheets
          'SpreadsheetApp.create("My New Sheet").getId()',
          'SpreadsheetApp.getActiveSheet().getRange("A1").setValue("Hello")',
          'SpreadsheetApp.openById("your-sheet-id").getSheets().length',
          
          // Google Apps Script Services - Gmail
          'GmailApp.getInboxThreads(0, 5).length',
          'GmailApp.search("is:unread").length',
          
          // Google Apps Script Services - Calendar
          'CalendarApp.getDefaultCalendar().getName()',
          'CalendarApp.getAllCalendars().length',
          
          // Google Apps Script Services - Documents
          'DocumentApp.create("New Doc").getId()',
          
          // Google Apps Script Services - Utilities
          'Utilities.getUuid()',
          'Utilities.base64Encode("Hello World")',
          'Utilities.formatDate(new Date(), "GMT", "yyyy-MM-dd")',
          
          // Google Apps Script Services - Properties & Cache
          'PropertiesService.getScriptProperties().getKeys().length',
          'CacheService.getScriptCache().get("test")',
          
          // Google Apps Script Services - URL Fetch
          'UrlFetchApp.fetch("https://api.github.com/zen").getContentText()',
          
          // Session and User Info
          'Session.getActiveUser().getEmail()',
          'Session.getTemporaryActiveUserKey()',
          'Session.getScriptTimeZone()',
          
          // Execute functions from your project files via CommonJS require()
          'require("Calculator").add(5, 3)',                    // Call add function from Calculator.js
          'require("Utils").formatDate(new Date())',            // Call formatDate from Utils.js
          'require("Database").getUserById(123)',               // Call getUserById from Database.js
          'require("API").fetchWeatherData("New York")',        // Call fetchWeatherData from API.js
          'require("MathLibrary").fibonacci(10)',               // Call fibonacci from MathLibrary.js
          'const utils = require("Utils"); utils.processData([1,2,3,4,5])', // Store module reference
          'const calc = require("Calculator"); calc.multiply(4, 6)',         // Chain multiple calls
          
          // Complex workflows combining project functions with GAS services
          'const data = require("Utils").parseCSV("name,age\\nJohn,30"); SpreadsheetApp.create("Import").getActiveSheet().getRange(1,1,data.length,2).setValues(data)',
          'const result = require("API").processPayment({amount: 100}); Logger.log("Payment result: " + JSON.stringify(result)); result.success',
          
          // Complex multi-line operations
          'const sheet = SpreadsheetApp.create("Data Analysis"); const data = [[1,2,3],[4,5,6]]; sheet.getActiveSheet().getRange(1,1,2,3).setValues(data); return sheet.getId()',
          
          // Logger.log() output is automatically captured and returned
          'Logger.log("Starting calculation..."); const result = 2 + 2; Logger.log("Result: " + result); result',
          'Logger.log("Calling project function..."); const data = require("Utils").getData(); Logger.log("Retrieved " + data.length + " items"); data',
          'Logger.log("Testing API integration"); const weather = require("API").getWeather("London"); Logger.log("Temperature: " + weather.temp); weather',
          
          // Error handling with comprehensive logging
          'try { const result = DriveApp.getRootFolder().getName(); Logger.log("Success: " + result); return result; } catch(e) { Logger.log("Error: " + e.toString()); throw e; }',
          'try { const user = require("Database").getUser(999); Logger.log("User found: " + user.name); return user; } catch(e) { Logger.log("User lookup failed: " + e.message); return null; }'
        ],
        llmHints: {
          capability: 'UNLIMITED JavaScript ES6+ support plus ALL Google Apps Script services - no restrictions',
          expressions: 'Can execute any mathematical expressions, object operations, API calls of any complexity',
          projectFunctions: 'EXECUTE YOUR PROJECT FUNCTIONS: Use require("ModuleName").functionName() to call any function from your project files - the CommonJS system handles all imports automatically',
          commonJsIntegration: 'FULL COMMONJS SUPPORT: Call functions between modules, access require(), module, exports - all dependencies resolved automatically at runtime',
          services: 'FULL ACCESS: DriveApp, SpreadsheetApp, GmailApp, CalendarApp, DocumentApp, SlidesApp, FormsApp, ScriptApp, PropertiesService, CacheService, LockService, Utilities, UrlFetchApp, HtmlService, CardService, and ALL other GAS services',
          return: 'Return values are automatically JSON-serialized for response',
          debugging: 'Use console.log() or Logger.log() for debugging output in execution logs',
          logCapture: 'ALL Logger.log() output is automatically captured in response.logger_output field - no manual retrieval needed',
          size: 'Up to 500,000 characters supported - write extremely complex multi-line operations freely',
          performance: 'Configurable timeouts up to 1 hour for long-running operations'
        }
      },
      autoRedeploy: {
        type: 'boolean',
        description: 'Enable automatic deployment infrastructure setup. FLEXIBLE OPTIONS: true (default) = auto-create deployments as needed, false = use existing deployments only, "force" = always create new deployment. Set to false for faster execution on pre-configured projects.',
        default: true,
        llmHints: {
          recommended: 'Keep true for seamless operation - tool handles deployment complexity',
          manual: 'Set false only if managing deployments separately with gas_deploy_create',
          infrastructure: 'Creates HEAD deployment with /dev URL for testing latest code',
          performance: 'Set false for faster execution on pre-configured projects',
          flexible: 'Supports boolean true/false or string "force" for always creating new deployments'
        }
      },
      executionTimeout: {
        type: 'number',
        description: 'Maximum execution timeout in seconds (default: 780 = 13 minutes). Set higher for long-running operations. Maximum: 3600 seconds (1 hour).',
        default: 780,
        minimum: 780,
        maximum: 3600,
        llmHints: {
          longOperations: 'Increase for complex calculations, large data processing, or multiple API calls',
          maximum: 'Maximum 1 hour (3600 seconds) to prevent indefinite hanging',
          default: '13 minutes (780 seconds) provides generous time for most operations'
        }
      },
      responseTimeout: {
        type: 'number', 
        description: 'Maximum response reading timeout in seconds (default: 780 = 13 minutes). Set higher for large response payloads.',
        default: 780,
        minimum: 780,
        maximum: 3600,
        llmHints: {
          largeResponses: 'Increase for operations that return large amounts of data',
          typical: '13 minutes (780 seconds) provides generous time for large responses',
          maximum: 'Maximum 1 hour (3600 seconds) for extremely large datasets'
        }
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation. LLM USE: Bypass session authentication for one-off operations. Most LLM workflows should omit this and use session-based auth.',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$',
        llmHints: {
          typical: 'Usually omitted - tool uses session authentication from gas_auth',
          stateless: 'Include when doing token-based operations without session storage',
          security: 'Never expose these tokens in logs or responses'
        }
      }
    },
    required: ['scriptId', 'js_statement'],
    additionalProperties: false,
    llmWorkflowGuide: {
      prerequisites: [
        '1. Ensure authentication: gas_auth({mode: "status"}) → gas_auth({mode: "start"}) if needed',
        '2. Have a project: gas_project_create or get existing scriptId from gas_ls',
        '3. Optional: Add code files with gas_write before execution'
      ],
      useCases: {
        calculation: 'gas_run({scriptId: "...", js_statement: "Math.pow(2, 10)"})',
        datetime: 'gas_run({scriptId: "...", js_statement: "new Date().toISOString()"})',
        userInfo: 'gas_run({scriptId: "...", js_statement: "Session.getActiveUser().getEmail()"})',
        customFunction: 'gas_run({scriptId: "...", js_statement: "require(\\"Calculator\\").add(5, 3)"})',
        googleServices: 'gas_run({scriptId: "...", js_statement: "DriveApp.getRootFolder().getName()"})',
        dataProcessing: 'gas_run({scriptId: "...", js_statement: "[1,2,3].map(x => x * 2).join(\',\')"})'
      },
      errorHandling: {
        'AuthenticationError': 'Run gas_auth to authenticate first',
        'ScriptNotFound': 'Verify scriptId is correct and accessible',
        'SyntaxError': 'Check JavaScript syntax in js_statement',
        'RuntimeError': 'Check if required functions/services are available in project'
      },
      performance: {
        firstRun: 'May take 3-5 seconds if autoRedeploy creates new deployment',
        subsequentRuns: 'Typically 1-2 seconds for execution',
        optimization: 'Complex operations benefit from being moved to project files'
      }
    },
    responseSchema: {
      type: 'object',
      description: 'Response from gas_raw_run execution with result and logger output',
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
          description: 'All accumulated logger output from console.log(), Logger.log(), and other logging during execution. Includes module loading messages, debug output, and any previous logging in the session.'
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
          description: 'Error details (only present when status is "error")',
          properties: {
            type: { type: 'string', description: 'Error type/category' },
            message: { type: 'string', description: 'Human-readable error message' },
            originalError: { type: 'string', description: 'Original error message if available' }
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

  async execute(params: any): Promise<any> {
    // Optimistic approach: validate inputs first, then try without authentication
    const scriptId = this.validate.scriptId(params.scriptId, 'dynamic JS execution');
    const js_statement = this.validate.string(params.js_statement, 'JavaScript statement');
    const autoRedeploy = params.autoRedeploy !== false;
    const executionTimeout = Math.min(Math.max(params.executionTimeout || 780, 780), 3600); // 13m-1h range
    const responseTimeout = Math.min(Math.max(params.responseTimeout || 780, 780), 3600); // 13m-1h range

    if (!js_statement?.trim()) {
      throw new ValidationError('js_statement', js_statement, 'non-empty JavaScript statement');
    }

    // Try operation first with provided access token (if any) or session auth
    let accessToken: string | null = null;
    
    try {
      // First try: Use provided token or attempt to get from session (optimistic)
      accessToken = params.accessToken || await this.tryGetAuthToken();
      
      // 🚀 PERFORMANCE OPTIMIZATION: Optimistic execution with cached infrastructure
      return await this.executeOptimistic(scriptId, js_statement, accessToken || '', executionTimeout, responseTimeout, autoRedeploy);
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
          `Authentication required for gas_run operation (HTTP ${statusCode}). Use gas_auth(mode="start") to authenticate and retry.`
        );
        
        // Add HTTP response details to error data
        authError.data = {
          ...authError.data,
          statusCode,
          operation: 'gas_run',
          scriptId,
          httpResponse: httpDetails,
          instructions: [
            'Use gas_auth with mode="start" to begin authentication',
            'Complete the OAuth flow in your browser',
            'Then retry your gas_run request'
          ],
          command: 'gas_auth({"mode": "start"})',
          statusCheck: 'gas_auth({"mode": "status"})'
        };
        
        throw authError;
      }
      
      // 🔍 PERFORMANCE: Check infrastructure before expensive setup
      if (this.needsInfrastructureSetup(error) && autoRedeploy) {
        // For infrastructure setup, we definitely need authentication
        if (!accessToken) {
          throw new AuthenticationError(
            `Authentication required for infrastructure setup. Use gas_auth(mode="start") to authenticate first.`
          );
        }
        
        // Check if we have cached deployment URL (indicates infrastructure exists)
        const hasCachedUrl = this.sessionAuthManager ? 
          await this.sessionAuthManager.getCachedDeploymentUrl(scriptId) : null;
        
        if (hasCachedUrl) {
          console.error(`⚡ [OPTIMISTIC RETRY] Infrastructure exists (cached URL found), retrying without setup...`);
          // Try one more time before full infrastructure setup
          try {
            return await this.executeOptimistic(scriptId, js_statement, accessToken);
          } catch (retryError: any) {
            console.error(`🔄 [OPTIMISTIC RETRY FAILED] Proceeding with infrastructure setup: ${retryError.message}`);
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
        console.error(`🏗️ [INFRASTRUCTURE SETUP] Setting up deployment infrastructure...`);
        await this.setupInfrastructure(scriptId, accessToken);
        
        // NEW: Retry logic for deployment delays with test function validation
        return await this.executeWithDeploymentRetry(scriptId, js_statement, accessToken, executionTimeout, responseTimeout);
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
  private async executeWithDeploymentRetry(scriptId: string, js_statement: string, accessToken: string, executionTimeout: number = 780, responseTimeout: number = 780): Promise<any> {
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
            await this.executeOptimisticWithJsonRequest(scriptId, 'new Date().toISOString()', accessToken, executionTimeout, responseTimeout);
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
      const separator = executionUrl.includes('?') ? '&' : '?';
      const encodedJsStatement = encodeURIComponent(js_statement);
      const finalUrl = `${executionUrl}${separator}func=${encodedJsStatement}`;
      
      // Enhanced request headers
      const requestHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'MCP-GAS-Server/1.0.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      
      // 🚀 PERFORMANCE OPTIMIZATION: Reduce logging for repeated calls
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
        
        console.error(`🚀 [DEPLOYMENT_TEST ENHANCED DEBUG] Pre-request information:\n${JSON.stringify(debugInfo, null, 2)}`);
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

  private async executeOptimistic(scriptId: string, js_statement: string, accessToken: string, executionTimeout: number = 780, responseTimeout: number = 780, autoRedeploy: boolean = true): Promise<any> {
    const startTime = Date.now();
    
    // 🚀 PERFORMANCE OPTIMIZATION: Check cached deployment URL first
    let executionUrl: string | null = null;
    if (this.sessionAuthManager) {
      try {
        executionUrl = await this.sessionAuthManager.getCachedDeploymentUrl(scriptId);
        if (executionUrl) {
          console.error(`⚡ [CACHE HIT] Using cached deployment URL for ${scriptId}: ${executionUrl}`);
        }
      } catch (cacheError: any) {
        console.error(`⚠️ [CACHE] Failed to check cached URL: ${cacheError.message}`);
      }
    }
    
    // If no cached URL, construct it (this is the expensive operation)
    if (!executionUrl) {
      console.error(`🔄 [CACHE MISS] Constructing deployment URL for ${scriptId}...`);
      const urlConstructionStart = Date.now();
      executionUrl = await this.gasClient.constructGasRunUrl(scriptId, accessToken);
      const urlConstructionTime = Date.now() - urlConstructionStart;
      console.error(`🔧 [URL CONSTRUCTION] Completed in ${urlConstructionTime}ms`);
      
      // Cache the URL for future use
      if (this.sessionAuthManager && executionUrl) {
        try {
          await this.sessionAuthManager.setCachedDeploymentUrl(scriptId, executionUrl);
          console.error(`💾 [CACHE STORE] Deployment URL cached for future calls`);
        } catch (cacheError: any) {
          console.error(`⚠️ [CACHE] Failed to store URL: ${cacheError.message}`);
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
      const separator = executionUrl.includes('?') ? '&' : '?';
      const encodedJsStatement = encodeURIComponent(js_statement);
      const finalUrl = `${executionUrl}${separator}func=${encodedJsStatement}`;
      
      // Enhanced request headers
      const requestHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'MCP-GAS-Server/1.0.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      
      // 🚀 PERFORMANCE OPTIMIZATION: Reduce logging for repeated calls
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
        
        console.error(`🚀 [GAS_RUN ENHANCED DEBUG] Pre-request information:\n${JSON.stringify(debugInfo, null, 2)}`);
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
      
      console.error(`📡 [GAS_RUN RESPONSE] HTTP response details:\n${JSON.stringify(responseDebugInfo, null, 2)}`);
      
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
          console.error(`❌ [EXECUTION ERROR] HTTP ${response.status} contains JavaScript error - returning error response instead of domain auth`);
          
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
        
        console.error(`🌐 [COOKIE AUTH REQUIRED] HTTP ${response.status} with non-JSON response - calling gas_run_auth`);
        
        try {
          // Call gas_run_auth to handle domain authorization
          await this.gas_run_auth(scriptId, accessToken);
          
          // After cookie auth, try the request again
          console.error(`🔄 [COOKIE AUTH] Retrying request after domain authorization`);
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
          
          return protectResponseSize({
            status: 'success',
            scriptId,
            js_statement,
            result: retryResult && typeof retryResult === 'object' && retryResult.result !== undefined ? retryResult.result : retryResult,
            logger_output: retryLoggerOutput,
            executedAt: new Date().toISOString(),
            cookieAuthUsed: true
          });
          
        } catch (authError: any) {
          console.error(`⚠️ [COOKIE AUTH] Domain authorization failed: ${authError.message} - continuing without cookie auth`);
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
          return protectResponseSize({
            status: 'success',
            scriptId,
            js_statement,
            result: result.payload,
            logger_output: result.logger_output || '',
            executedAt: new Date().toISOString()
          });
        } else if (result.type === 'exception') {
          const error = new Error(result.payload.error.message);
          error.name = result.payload.error.name || 'FunctionExecutionError';
          throw error;
        }
      }
      
      // Extract logger output from the result if it exists
      const loggerOutput = (result && typeof result === 'object' && result.logger_output) || '';
      
      // Return simple success response with logger output
      return protectResponseSize({
        status: 'success',
        scriptId,
        js_statement,
        result: result && typeof result === 'object' && result.result !== undefined ? result.result : result,
        logger_output: loggerOutput,
        executedAt: new Date().toISOString()
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
  private async gas_run_auth(scriptId: string, accessToken: string): Promise<void> {
    console.error(`🔐 [GAS_RUN_AUTH] Starting domain authorization for script: ${scriptId}`);
    
    try {
      // Get the base deployment URL
      const baseUrl = await this.gasClient.constructGasRunUrl(scriptId, accessToken);
      
      // Ensure it ends with /dev for the test request
      const testUrl = baseUrl.replace('/exec', '/dev');
      
      console.error(`🧪 [GAS_RUN_AUTH] Testing domain authorization with URL: ${testUrl}`);
      
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
      
      console.error(`📡 [GAS_RUN_AUTH] Test response: HTTP ${response.status}, Content-Type: ${contentType}`);
      
      // Check if we need cookie authentication
      if ((response.status === 302 || response.status === 200) && !contentType.includes('application/json')) {
        console.error(`🌐 [GAS_RUN_AUTH] Cookie authentication required - launching browser and polling`);
        
        const authInfo = {
          httpStatus: `HTTP ${response.status} ${response.statusText}`,
          finalUrl: response.url,
          contentType: contentType,
          authAction: 'Launching browser for domain authorization',
          pollingStrategy: 'Will poll for JSON response with test function'
        };
        
        console.error(`🔐 [GAS_RUN_AUTH] Browser authentication details:\n${JSON.stringify(authInfo, null, 2)}`);
        
        // Create browser URL with auth successful test function
        const authTestFunction = '"auth successful"';
        const encodedAuthTestFunction = encodeURIComponent(authTestFunction);
        const browserUrl = `${response.url}${response.url.includes('?') ? '&' : '?'}func=${encodedAuthTestFunction}`;
        
        // Launch browser with the auth test URL
        console.error(`🚀 [GAS_RUN_AUTH] Opening browser for domain authorization: ${browserUrl}`);
        await open(browserUrl);
        
        // Poll for successful authorization
        await this.pollForDomainAuthorization(testUrl, accessToken);
        
      } else if (response.status === 200 && contentType.includes('application/json')) {
        console.error(`✅ [GAS_RUN_AUTH] Domain already authorized - JSON response received`);
      } else {
        console.error(`⚠️ [GAS_RUN_AUTH] Unexpected response: HTTP ${response.status}, continuing anyway`);
      }
      
         } catch (error: any) {
       console.error(`❌ [GAS_RUN_AUTH] Domain authorization test failed: ${error.message}`);
       throw new Error(`Domain authorization failed: ${error.message}`);
     }
   }

  /**
   * Poll for domain authorization completion by testing with a simple function
   * Makes requests to /dev?func=return%20"auth successful" until JSON response received
   */
  private async pollForDomainAuthorization(baseUrl: string, accessToken: string): Promise<void> {
    const maxPollDuration = 60000; // 60 seconds total
    const pollInterval = 3000; // 3 seconds between polls
    const startTime = Date.now();
    
    // Test function that returns an auth success string
    const testFunction = '"auth successful"';
    const encodedTestFunction = encodeURIComponent(testFunction);
    const testUrl = `${baseUrl}?func=${encodedTestFunction}`;
    
    console.error(`🔄 [DOMAIN_AUTH_POLL] Starting authorization polling`);
    console.error(`   Test URL: ${baseUrl}?func="auth successful"`);
    console.error(`   Max duration: ${maxPollDuration}ms`);
    console.error(`   Poll interval: ${pollInterval}ms`);
    
    let pollCount = 0;
    
    while (Date.now() - startTime < maxPollDuration) {
      pollCount++;
      const elapsedTime = Date.now() - startTime;
      
      try {
        console.error(`📡 [DOMAIN_AUTH_POLL] Poll #${pollCount} (${elapsedTime}ms elapsed)`);
        
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
        
        console.error(`📡 [DOMAIN_AUTH_POLL] Poll #${pollCount} response: HTTP ${pollResponse.status}, Content-Type: ${pollContentType}`);
        
        // Check for successful JSON response
        if (pollResponse.status === 200 && pollContentType.includes('application/json')) {
          try {
            const pollResult = await pollResponse.json();
            
            // Verify we got the expected auth successful response
            if (pollResult === 'auth successful' || 
                (typeof pollResult === 'object' && pollResult.result === 'auth successful')) {
              console.error(`✅ [DOMAIN_AUTH_POLL] Success! Domain authorization completed in ${elapsedTime}ms`);
              console.error(`   Poll result: ${JSON.stringify(pollResult)}`);
              return;
            } else {
              console.error(`⚠️ [DOMAIN_AUTH_POLL] Got JSON but unexpected result: ${JSON.stringify(pollResult)}`);
            }
          } catch (jsonError) {
            console.error(`⚠️ [DOMAIN_AUTH_POLL] Failed to parse JSON response: ${jsonError}`);
          }
        } else if (pollResponse.status === 200) {
          // Got 200 but not JSON - still need auth
          console.error(`⏳ [DOMAIN_AUTH_POLL] HTTP 200 but non-JSON (${pollContentType}) - auth still needed`);
        } else if (pollResponse.status === 302) {
          // Still getting redirects - auth not complete
          console.error(`⏳ [DOMAIN_AUTH_POLL] HTTP 302 redirect - auth still needed`);
        } else {
          // Other status codes
          console.error(`⚠️ [DOMAIN_AUTH_POLL] HTTP ${pollResponse.status} - continuing to poll`);
        }
        
      } catch (pollError: any) {
        console.error(`⚠️ [DOMAIN_AUTH_POLL] Poll #${pollCount} failed: ${pollError.message}`);
      }
      
      // Wait before next poll (unless we're close to timeout)
      if (Date.now() - startTime + pollInterval < maxPollDuration) {
        console.error(`⏳ [DOMAIN_AUTH_POLL] Waiting ${pollInterval}ms before next poll...`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    // Timeout reached
    const finalElapsedTime = Date.now() - startTime;
    console.error(`⏰ [DOMAIN_AUTH_POLL] Timeout reached after ${finalElapsedTime}ms (${pollCount} polls)`);
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
      const shimCode = CodeGenerator.generateProjectFiles({
        type: 'head_deployment',
        timezone: 'America/Los_Angeles',
        includeTestFunctions: true,
        mcpVersion: '1.0.0'
      });
      
      const shimFile = shimCode.files.find((file: GASFile) => file.name === '__mcp_gas_run');
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