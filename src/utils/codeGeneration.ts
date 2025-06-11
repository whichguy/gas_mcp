/**
 * Consolidated code generation utilities for Google Apps Script
 * Replaces duplicate functions from gasClient.ts and execution.ts
 * 
 * This utility consolidates:
 * - GASClient.generateMcpGasRunClass() (87 lines) -> System with built-in execution
 * - GASRunTool.getProxyFunctionCode() (140 lines) -> Web app proxy
 * 
 * Architecture: Self-contained system with dynamic execution
 * - __mcp_gas_run.gs: System shim ONLY - never modified after creation
 * - User code: Separate .gs files (e.g., Code.gs, UserFunctions.gs)
 * - Dynamic code execution via Function constructor
 */

import { GASFile } from '../api/gasClient.js';

export interface ProxyCodeOptions {
  type: 'head_deployment' | 'web_app_proxy' | 'execution_api';
  userCode?: string;
  timezone?: string;
  includeTestFunctions?: boolean;
  mcpVersion?: string;
  responseFormat?: 'structured' | 'legacy';
}

export interface CodeGenerationResult {
  files: GASFile[];
  totalLines: number;
  description: string;
}

/**
 * Consolidated Google Apps Script Code Generator
 * 
 * **System Architecture:**
 * - `__mcp_gas_run.gs` - System with built-in dynamic execution
 * - Built-in `__gas_run` function for runtime code execution
 * - Dynamic function execution via Function constructor
 * 
 * **Replaces these duplicate functions:**
 * - `GASClient.generateMcpGasRunClass()` - System generation
 * - `GASRunTool.getProxyFunctionCode()` - Proxy function generation
 * 
 * **Benefits of dynamic execution architecture:**
 * - Built-in function execution without external dependencies
 * - Runtime code execution via Function constructor
 * - Self-contained system with dynamic capabilities
 * - Easier deployment and maintenance
 * - No separation between system and user code needed
 */
export class GASCodeGenerator {
  
  /**
   * Generate complete Google Apps Script code based on options
   * 
   * **Unified API** that replaces multiple specialized functions:
   * - HEAD deployment: Generates system with built-in dynamic execution + manifest
   * - Web App proxy: Generates doGet() proxy with dynamic routing
   * - Execution API: Generates API executable code
   * 
   * @param options - Configuration for code generation type and features
   * @returns Generated files with metadata
   */
  static generateCode(options: ProxyCodeOptions): CodeGenerationResult {
    const {
      type,
      userCode = '',
      timezone = 'America/Los_Angeles',
      includeTestFunctions = true,
      mcpVersion = '1.0.0',
      responseFormat = 'structured'
    } = options;

    switch (type) {
      case 'head_deployment':
        return this.generateHeadDeployment(userCode, timezone, includeTestFunctions, mcpVersion);
      
      case 'web_app_proxy':
        return this.generateWebAppProxy(responseFormat, mcpVersion);
      
      case 'execution_api':
        return this.generateExecutionApi(mcpVersion);
      
      default:
        throw new Error(`Unknown code generation type: ${type}`);
    }
  }

  /**
   * Generate HEAD deployment files (replaces GASClient methods)
   * 
   * **Features:**
   * - `generateMcpClassFile()` - System with built-in dynamic execution
   * - Built-in __gas_run function for runtime code execution
   * 
   * **Improvements:**
   * - Self-contained dynamic execution system
   * - Runtime code execution via Function constructor
   * - No external user function dependencies
   */
  private static generateHeadDeployment(
    userCode: string, 
    timezone: string, 
    includeTestFunctions: boolean,
    mcpVersion: string
  ): CodeGenerationResult {
    
    const files: GASFile[] = [
      // Manifest file with proper entry point configuration for both Web App and API Executable
      {
        name: 'appsscript',
        type: 'JSON',
        source: JSON.stringify({
          timeZone: timezone,
          dependencies: {},
          webapp: {
            access: "MYSELF",
            executeAs: "USER_DEPLOYING"
          },
          executionApi: {
            access: "MYSELF"
          },
          exceptionLogging: "STACKDRIVER",
          runtimeVersion: "V8"
        }, null, 2)
      },
      
      // Well-known MCP class file (loaded first) - SYSTEM SHIM ONLY
      {
        name: '__mcp_gas_run.gs',
        type: 'SERVER_JS',
        source: this.generateMcpClassFile(timezone, mcpVersion)
      }
      
      // User functions expected to be in separate .gs files (e.g., Code.gs or custom files)
      // This maintains clean separation between system infrastructure and user code
    ];

    const totalLines = files.reduce((sum, file) => sum + (file.source?.split('\n').length || 0), 0);

    return {
      files,
      totalLines,
      description: `HEAD deployment with ${files.length} files (${totalLines} total lines) - system with built-in dynamic execution`
    };
  }

  /**
   * Generate Web App proxy code (replaces GASRunTool.getProxyFunctionCode)
   * 
   * **Improvements over original:**
   * - Configurable response format (structured vs legacy)
   * - Better error handling consistency
   * - More comprehensive parameter extraction
   * - Enhanced logging and debugging
   */
  private static generateWebAppProxy(responseFormat: string, mcpVersion: string): CodeGenerationResult {
    const proxyCode = `
/**
 * MCP Web App Proxy Function - Consolidated Implementation
 * 
 * Replaces: GASRunTool.getProxyFunctionCode()
 * Pattern: doGet() → globalThis[functionName](...args)
 * Response Format: ${responseFormat} JSON with type-based payload handling
 * Runtime: V8 (supports JavaScript .gs files, HTML, ES6+)
 * Version: ${mcpVersion}
 */
function doGet(e) {
  try {
    console.log('MCP doGet() proxy called:', JSON.stringify(e));
    
    // Enhanced parameter extraction with multiple input format support
    let params = this.extractParameters(e, arguments);
    const { functionName, args } = params;
    
    if (!functionName) {
      throw new Error('functionName parameter is required for proxy routing');
    }
    
    console.log(\`Routing to function: \${functionName} with args:\`, JSON.stringify(args));
    
    // Dynamic function execution with comprehensive error handling
    if (typeof globalThis[functionName] === 'function') {
      const startTime = new Date();
      const result = globalThis[functionName](...(args || []));
      const endTime = new Date();
      
      // Generate ${responseFormat} response format
      return this.formatSuccessResponse(functionName, result, startTime, endTime, '${mcpVersion}');
      
    } else {
      throw new Error(\`Function '\${functionName}' not found or not callable on globalThis\`);
    }
    
  } catch (error) {
    console.error('MCP doGet() proxy error:', error.toString());
    return this.formatErrorResponse(error, arguments[0], '${mcpVersion}');
  }
}

/**
 * Enhanced parameter extraction supporting multiple input formats
 */
function extractParameters(e, args) {
  // URL parameters (web app style)
  if (e && e.parameter) {
    let params = e.parameter;
    if (typeof params.functionName === 'string' && params.args) {
      try {
        params.args = JSON.parse(params.args);
      } catch (parseError) {
        // Keep args as string if not valid JSON
      }
    }
    return params;
  }
  
  // MCP direct call style
  if (e && typeof e === 'object' && e.functionName) {
    return e;
  }
  
  // Function call arguments
  if (args.length > 0 && typeof args[0] === 'object') {
    return args[0];
  }
  
  throw new Error('No valid parameters provided to doGet()');
}

/**
 * Format successful execution response
 */
function formatSuccessResponse(functionName, result, startTime, endTime, version) {
  const response = {
    type: 'data',
    payload: {
      functionName: functionName,
      result: result,
      timestamp: new Date().toISOString(),
      executionTime: endTime.getTime() - startTime.getTime(),
      proxyPattern: 'doGet() → globalThis[functionName](...args)',
      runtime: 'V8',
      supportedLanguages: ['JavaScript (.gs)', 'HTML', 'ES6+'],
      version: version
    }
  };
  
  console.log('MCP execution successful:', JSON.stringify(response));
  return response;
}

/**
 * Format error response with comprehensive error information
 */
function formatErrorResponse(error, originalParams, version) {
  const errorResponse = {
    type: 'exception',
    payload: {
      functionName: (originalParams && originalParams.functionName) || 'unknown',
      error: {
        message: error.toString(),
        name: error.name || 'Error',
        stack: error.stack || '',
        type: error.constructor.name || 'ProxyError'
      },
      timestamp: new Date().toISOString(),
      proxyPattern: 'doGet() → globalThis[functionName](...args)',
      runtime: 'V8',
      version: version
    }
  };
  
  console.log('MCP execution failed:', JSON.stringify(errorResponse));
  return errorResponse;
}

/**
 * POST request handler - delegates to doGet for consistency
 */
function doPost(e) {
  return doGet(e);
}

/**
 * Alternative entry point for direct proxy calls
 */
function _mcpProxy(proxyData) {
  return doGet(proxyData);
}
`;

    const files: GASFile[] = [{
      name: 'proxy_handler.gs',
      type: 'SERVER_JS',
      source: proxyCode
    }];

    return {
      files,
      totalLines: proxyCode.split('\n').length,
      description: `Web App proxy with ${responseFormat} response format and enhanced error handling`
    };
  }

  /**
   * Generate Execution API code
   */
  private static generateExecutionApi(mcpVersion: string): CodeGenerationResult {
    const apiCode = `
/**
 * MCP Execution API Implementation
 * Optimized for direct API calls via gas_run_api_exec
 * Version: ${mcpVersion}
 */

// API-optimized functions would go here
// This is a placeholder for future API-specific code generation
`;

    const files: GASFile[] = [{
      name: 'api_executable.gs',
      type: 'SERVER_JS',
      source: apiCode
    }];

    return {
      files,
      totalLines: apiCode.split('\n').length,
      description: `Execution API code optimized for direct API calls`
    };
  }

  /**
   * Generate MCP class file (replaces generateMcpGasRunClass)
   * 
   * **SYSTEM SHIM ONLY - NEVER MODIFIED AFTER CREATION**
   * - Provides web app entry points (doGet/doPost)
   * - Built-in __gas_run function for dynamic code execution
   * - System exception handler (__mcp_handleMcpException)
   * - Uses Function constructor for runtime code execution
   * - ALL USER CODE MUST BE IN SEPARATE .GS FILES
   */
  private static generateMcpClassFile(timezone: string, mcpVersion: string): string {
    return `
/**
 * MCP Gas Run System with Built-in Dynamic Execution
 * 
 * This file contains system infrastructure with built-in function execution.
 * Provides dynamic JavaScript code execution via Function constructor.
 * 
 * ⚠️  LANGUAGE SUPPORT: JavaScript only (ES6+ with V8 runtime)
 *    Google Apps Script does NOT natively support TypeScript files.
 *    Only .gs files with JavaScript are supported.
 * 
 * ⚠️  ARCHITECTURE: Clean separation of parameter parsing and execution
 *    - doGet/doPost: Web app entry points
 *    - __gas_run_get: Parse GET parameters (?func= or ?function_plus_args=)
 *    - __gas_run_post_json: Parse POST JSON data
 *    - __gas_run_post_raw: Parse raw POST content
 *    - __gas_run: Core execution engine (no parsing)
 * 
 * ⚠️  USER CODE LOCATION: All user functions must be in separate .gs files
 *    (e.g., Code.gs, UserFunctions.gs)
 * 
 * File: __mcp_gas_run.gs (System with Built-in Execution)
 * Timezone: ${timezone}
 * Version: ${mcpVersion}
 * Generated: ${new Date().toISOString()}
 */

/**
 * Web App Entry Point - GET requests
 * Routes to GET parameter parser for dynamic JavaScript execution
 */
function doGet(e) {
  try {
    console.log('MCP doGet called with parameters:', JSON.stringify(e.parameter));
    console.log('MCP doGet timestamp:', new Date().toISOString());
    
    // Route to GET parameter parser
    return __gas_run_get(e);
    
  } catch (error) {
    return __mcp_handleMcpException(error, 'doGet');
  }
}

/**
 * Web App Entry Point - POST requests
 * Routes to appropriate POST parser (JSON first, then raw) for dynamic JavaScript execution
 */
function doPost(e) {
  try {
    console.log('MCP doPost called with parameters:', JSON.stringify(e.parameter));
    console.log('MCP doPost postData length:', e.postData ? e.postData.contents.length : 0);
    console.log('MCP doPost timestamp:', new Date().toISOString());
    
    // Route to POST JSON parser (which falls back to raw parser if needed)
    return __gas_run_post_json(e);
    
  } catch (error) {
    return __mcp_handleMcpException(error, 'doPost');
  }
}

/**
 * Parse GET parameters and route to execution
 * Handles: ?function_plus_args=code() or ?func=code()
 */
function __gas_run_get(e) {
  try {
    let function_plus_args = '';
    
    if (e && e.parameter) {
      if (e.parameter.function_plus_args) {
        function_plus_args = e.parameter.function_plus_args;
      } else if (e.parameter.func) {
        function_plus_args = e.parameter.func;
      }
    }
    
    if (!function_plus_args || function_plus_args.trim() === '') {
      return __gas_run_usage();
    }
    
    return __gas_run(function_plus_args);
    
  } catch (error) {
    return __gas_run_error(error, 'GET parameter parsing');
  }
}

/**
 * Parse POST JSON data and route to execution
 * Handles: {"function_plus_args": "code()"} or {"func": "code()"}
 */
function __gas_run_post_json(e) {
  try {
    let function_plus_args = '';
    
    if (e && e.postData && e.postData.contents) {
      const postData = JSON.parse(e.postData.contents);
      if (postData.function_plus_args) {
        function_plus_args = postData.function_plus_args;
      } else if (postData.func) {
        function_plus_args = postData.func;
      }
    }
    
    if (!function_plus_args || function_plus_args.trim() === '') {
      return __gas_run_usage();
    }
    
    return __gas_run(function_plus_args);
    
  } catch (parseError) {
    // If JSON parsing fails, try raw content
    return __gas_run_post_raw(e);
  }
}

/**
 * Parse raw POST content and route to execution
 * Handles: Raw JavaScript code as POST body
 */
function __gas_run_post_raw(e) {
  try {
    let function_plus_args = '';
    
    if (e && e.postData && e.postData.contents) {
      function_plus_args = e.postData.contents.trim();
    }
    
    if (!function_plus_args) {
      return __gas_run_usage();
    }
    
    return __gas_run(function_plus_args);
    
  } catch (error) {
    return __gas_run_error(error, 'POST raw content parsing');
  }
}

/**
 * Core dynamic function execution handler
 * 
 * ⚠️  SYSTEM FUNCTION - CLEAN EXECUTION ONLY
 * ⚠️  NO PARAMETER PARSING - Receives clean function_plus_args string
 * 
 * This function executes JavaScript code dynamically via Function constructor.
 * All parameter parsing is handled by specific input method handlers.
 */
function __gas_run(function_plus_args) {
  try {
    console.log(\`Executing function_plus_args: \${function_plus_args}\`);
    
    // Create and execute the function
    const body = \`return \${function_plus_args}\`;
    const fn = new Function(body);
    const result = fn();

    // Return structured success response
    return ContentService.createTextOutput(JSON.stringify({
      function_called: function_plus_args,
      result: result,
      message: \`Successfully executed: \${function_plus_args}\`,
      timestamp: new Date().toISOString(),
      timezone: '${timezone}',
      systemFunction: true,
      mcpVersion: '${mcpVersion}'
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return __gas_run_error(error, 'code execution', function_plus_args);
  }
}

/**
 * Return usage information when no function specified
 */
function __gas_run_usage() {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'system_ready',
    message: 'MCP Gas Run system ready for dynamic JavaScript execution',
    usage: {
      get: 'Add ?function_plus_args=yourCode() or ?func=yourCode() to URL',
      post_json: 'Send JSON: {"function_plus_args": "yourCode()"}',
      post_raw: 'Send raw JavaScript code as POST body',
      examples: [
        '?function_plus_args=Math.max(10,20,30)',
        '?func=new Date().getTime()',
        '{"function_plus_args": "Math.PI * 2"}',
        'Session.getActiveUser().getEmail()',
        'add(5, 10)'
      ]
    },
    supported: {
      language: 'JavaScript (ES6+)',
      runtime: 'V8',
      services: 'All Google Apps Script services (SpreadsheetApp, DriveApp, GmailApp, etc.)'
    },
    timestamp: new Date().toISOString(),
    systemShim: '__mcp_gas_run.gs',
    userCodeLocation: 'Separate .gs files (e.g., Code.gs, UserFunctions.gs)',
    version: '${mcpVersion}'
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Centralized error response formatting
 */
function __gas_run_error(error, context, function_plus_args) {
  console.error(\`Error in \${context}: \${error.toString()}\`);
  
  return ContentService.createTextOutput(JSON.stringify({
    error: true,
    context: context,
    function_called: function_plus_args || 'unknown',
    message: error.toString(),
    stack: error.stack || 'No stack trace',
    timestamp: new Date().toISOString(),
    timezone: '${timezone}',
    systemFunction: true,
    mcpVersion: '${mcpVersion}'
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * System test function to verify MCP Gas Run deployment
 * SYSTEM FUNCTION - Tests system infrastructure and built-in functions
 */
function testMcpGasRun() {
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'mcp_gas_run_system_working',
      timestamp: new Date().toISOString(),
      timezone: '${timezone}',
      message: 'MCP Gas Run system with built-in dynamic execution ready',
      systemShim: '__mcp_gas_run.gs',
      builtInFunctions: ['__gas_run', '__gas_run_get', '__gas_run_post_json', '__gas_run_post_raw', '__mcp_test_args', '__mcp_test_exception', 'testMcpGasRun'],
      dynamicExecution: 'Available via __gas_run(function_plus_args)',
      deployment: 'HEAD',
      access: 'DOMAIN',
      executeAs: 'USER_DEPLOYING',
      type: 'system_test_response',
      mcpVersion: '${mcpVersion}',
      runtime: 'V8',
      language: 'JavaScript (ES6+)',
      generatedBy: 'GASCodeGenerator (system with built-in execution)'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * System test functions for MCP infrastructure
 * SYSTEM FUNCTIONS - No user code dependencies
 */
function __mcp_test_args(x, y, operation) {
  const operations = {
    add: (x || 0) + (y || 0),
    multiply: (x || 0) * (y || 0),
    subtract: (x || 0) - (y || 0),
    divide: (y || 1) !== 0 ? (x || 0) / (y || 1) : 'division_by_zero',
    power: Math.pow(x || 0, y || 0),
    modulo: (y || 1) !== 0 ? (x || 0) % (y || 1) : 'division_by_zero'
  };
  
  return {
    operation: operation || 'add',
    inputs: { x: x || 0, y: y || 0 },
    result: operations[operation] || operations.add,
    timestamp: new Date().toISOString(),
    timezone: '${timezone}',
    testType: 'system_argument_test',
    success: true,
    mcpVersion: '${mcpVersion}',
    runtime: 'V8',
    language: 'JavaScript (ES6+)',
    availableOperations: Object.keys(operations),
    systemFunction: true
  };
}

function __mcp_test_exception(shouldThrow) {
  if (shouldThrow === true || shouldThrow === 'true') {
    const error = new Error('System MCP test exception for error handling verification');
    error.name = 'MCPSystemTestException';
    error.testType = 'system_exception_handling';
    error.mcpVersion = '${mcpVersion}';
    throw error;
  }
  
  return {
    message: 'System exception test completed - no error thrown',
    shouldThrow: shouldThrow,
    timestamp: new Date().toISOString(),
    timezone: '${timezone}',
    testType: 'system_exception_handling',
    success: true,
    mcpVersion: '${mcpVersion}',
    runtime: 'V8',
    language: 'JavaScript (ES6+)',
    systemFunction: true
  };
}

/**
 * Centralized system exception handling utility
 * 
 * ⚠️  SYSTEM FUNCTION - STATIC IMPLEMENTATION
 * Provides consistent error response format for system-level exceptions
 */
function __mcp_handleMcpException(error, entryPoint) {
  console.error(\`MCP System \${entryPoint} error:\`, error.toString());
  console.error(\`MCP System \${entryPoint} stack:\`, error.stack || 'No stack trace');
  
  return ContentService
    .createTextOutput(JSON.stringify({
      error: true,
      type: 'system_' + entryPoint + '_exception',
      message: error.toString(),
      stack: error.stack || 'No stack trace',
      timestamp: new Date().toISOString(),
      timezone: '${timezone}',
      entryPoint: entryPoint + ' -> system_shim',
      systemShim: '__mcp_gas_run.gs',
      userCodeLocation: 'Separate .gs files (e.g., Code.gs, UserFunctions.gs)',
      mcpVersion: '${mcpVersion}',
      runtime: 'V8',
      language: 'JavaScript (ES6+)',
      generatedBy: 'GASCodeGenerator (system with built-in execution)'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
`;
  }

  // generateUserFunctionFile method removed - user functions in separate .gs files
  // This maintains clean separation between system shim and user code

  /**
   * Utility method to get available generation types
   * Helpful for documentation and validation
   */
  static getAvailableTypes(): string[] {
    return ['head_deployment', 'web_app_proxy', 'execution_api'];
  }

  /**
   * Utility method to get default options for a generation type
   * Helpful for consistent defaults across the application
   */
  static getDefaultOptions(type: ProxyCodeOptions['type']): ProxyCodeOptions {
    return {
      type,
      timezone: 'America/Los_Angeles',
      includeTestFunctions: true,
      mcpVersion: '1.0.0',
      responseFormat: 'structured'
    };
  }
} 