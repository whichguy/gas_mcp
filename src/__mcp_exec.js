/**
 * MCP Gas Run System - Dynamic JavaScript Execution for Google Apps Script
 *
 * SECURITY: Designed for HEAD deployments, allows redirect handling (/dev → /exec)
 * USAGE: Send JavaScript code via GET params or POST body for execution
 * VERSION: 1.4.0 - Module pattern with __events__ registration
 *
 * Examples:
 * GET:  ?func=Math.max(10,20,30)
 * POST: {"func": "new Date().getTime()"}
 * POST: const x = 5; const y = 10; x * y;
 */

function _main(module, exports, log) {
  ///////// BEGIN USER CODE /////////

  /**
   * GET endpoint - executes JavaScript from URL parameters
   *
   * CONVENTION: Returns null if this is not a gas_run request,
   * allowing other doGet handlers to check the request.
   *
   * Routes on URI path: /__mcp_exec or parameter: _mcp_run=true
   */
  function doGetHandler(e) {
    // Check response format preference (used by multiple paths)
    const wantsJson = e.parameter?.format === 'json';

    // Dedicated /__debug path - always shows debug console
    if (e.pathInfo === '/__debug') {
      return handleAuthIde(wantsJson);
    }

    // Check if this is a gas_run request using URI or parameter
    const isGasRunRequest = (e.parameter && e.parameter._mcp_run === 'true') ||
                           (e.pathInfo && e.pathInfo === '/__mcp_exec');

    if (!isGasRunRequest) {
      return null; // Not a gas_run request, let other handlers check
    }

    // Determine action (default to 'execute' for backward compatibility)
    const action = e.parameter?.action || 'execute';

    // Route based on action
    switch (action) {
      case 'auth_check':
        return handleAuthCheck(wantsJson);

      case 'auth_ide':
        return handleAuthIde(wantsJson);

      case 'execute':
      default:
        return handleExecute(e, wantsJson);
    }
  }

  /**
   * Handle lightweight auth check (for polling)
   * Returns auth status without executing user code
   */
  function handleAuthCheck(wantsJson) {
    try {
      validateDevMode();
      return jsonResponse({
        status: 'authorized',
        message: 'Auth check successful',
        deploymentUrl: ScriptApp.getService().getUrl(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return jsonResponse({
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle auth IDE interface (for browser)
   * Executes test to get execution context, then shows IDE
   */
  function handleAuthIde(wantsJson) {
    try {
      validateDevMode();

      // Execute simple test to get execution context
      const testResult = __gas_run('"auth successful"');
      const resultData = JSON.parse(testResult.getContent());

      // Return IDE interface (or JSON if explicitly requested)
      if (wantsJson) {
        return testResult; // JSON with auth status
      } else {
        // Browser gets HTML IDE interface
        if (resultData.success) {
          return htmlAuthSuccessResponse(resultData);
        } else {
          return htmlAuthErrorResponse({
            error: resultData.message || 'Execution failed',
            context: 'auth_ide',
            originalError: resultData.message,
            logger: resultData.logger_output
          });
        }
      }
    } catch (error) {
      const loggerOutput = Logger.getLog();
      if (wantsJson) {
        return jsonResponse({
          status: 'error',
          error: error.message,
          logger: loggerOutput
        });
      } else {
        return htmlAuthErrorResponse({
          error: error.message,
          context: 'auth_ide',
          originalError: error.toString(),
          stack: error.stack,
          logger: loggerOutput
        });
      }
    }
  }

  /**
   * Handle code execution (default action)
   * Executes JavaScript code from func parameter
   */
  function handleExecute(e, wantsJson) {
    // Verify func parameter exists
    if (!e.parameter || !e.parameter.func) {
      return jsonResponse({
        error: true,
        message: 'Missing func parameter for execution',
        usage: 'Use ?_mcp_run=true&func=<javascript>',
        accessed_url: ScriptApp.getService().getUrl()
      });
    }

    try {
      validateDevMode();
      const js_statement = extractGetParams(e.parameter);
      if (!js_statement) {
        throw new Error('No JavaScript code provided. Use ?_mcp_run=true&func=yourCode');
      }

      // Execute and return result
      const result = __gas_run(js_statement);
      return result;
    } catch (error) {
      const loggerOutput = Logger.getLog();
      return errorResponse(error, 'doGet', 'unknown', loggerOutput, 'doGet');
    }
  }

  /**
   * POST endpoint - executes JavaScript from POST body
   *
   * CONVENTION: Returns null if this is not a gas_run request,
   * allowing other doPost handlers to check the request.
   *
   * Routes on URI path: /__mcp_exec or parameter: _mcp_run=true
   */
  function doPostHandler(e) {
    // Check if this is a gas_run request using URI or parameter
    const isGasRunRequest = (e.parameter && e.parameter._mcp_run === 'true') ||
                           (e.pathInfo && e.pathInfo === '/__mcp_exec');

    if (!isGasRunRequest) {
      return null; // Not a gas_run request, let other handlers check
    }

    // Verify we have POST data
    if (!e.postData || !e.postData.contents) {
      return jsonResponse({
        error: true,
        message: 'Missing POST data for gas_run',
        usage: 'Send POST request with ?_mcp_run=true and JSON {"func": "code"} or raw JavaScript',
        accessed_url: ScriptApp.getService().getUrl()
      });
    }

    // This is a gas_run request, process it
    try {
      validateDevMode();
      const js_statement = extractPostData(e.postData.contents);
      if (!js_statement) {
        throw new Error('No JavaScript code provided. Send JSON {"func": "code"} or raw JavaScript');
      }
      return __gas_run(js_statement);
    } catch (error) {
      // Capture logger output even on setup errors
      const loggerOutput = Logger.getLog();
      return errorResponse(error, 'doPost', 'unknown', loggerOutput, 'doPost');
    }
  }

/**
 * Security check - validates execution context
 */
function validateDevMode() {
  const url = ScriptApp.getService().getUrl();
  
  // Strict validation: Only allow /dev URLs (HEAD deployments)
  if (!url.endsWith('/dev')) {
    throw new Error('Dynamic execution only available in dev mode (HEAD deployments ending in /dev). Current URL: ' + url);
  }
  
  console.error('[MCP_GAS_RUN] Executing on HEAD deployment (/dev URL)');
}

/**
 * Extract JavaScript code from GET parameters
 */
function extractGetParams(params = {}) {
  return params.func || '';
}

/**
 * Extract JavaScript code from POST data (JSON or raw)
 */
function extractPostData(postData) {
  if (!postData) return '';
  
  try {
    // Try JSON parsing first
    const parsed = JSON.parse(postData);
    return parsed.func || '';
  } catch (e) {
    // Fall back to raw JavaScript code
    return postData.trim();
  }
}

/**
 * Creates a function that evaluates code and returns the result.
 * Simple approach: wrap code to capture the last expression value.
 *
 * If code contains `return` statements, wraps in IIFE so `return`
 * is syntactically valid (eval parses as Script, not function body).
 */
function createFunction(code) {
  const c = code.trim();
  if (c === '') return function() { return undefined; };

  // Code with `return` needs a function body — wrap in IIFE.
  // Regex targets return at statement boundaries (after ; { } or start-of-line).
  // False positives (return inside strings/comments) are harmless — IIFE wrapping
  // doesn't change behavior for code that doesn't actually use return.
  if (/(?:^|[;\{\}])\s*return\b/m.test(c)) {
    return function() {
      return eval('(function() { ' + c + ' })()');
    };
  }

  // No return statement — eval returns last expression value
  return function() {
    return eval(c);
  };
}

/**
 * Core execution engine - runs JavaScript code dynamically
 * PERFORMANCE OPTIMIZED for repeated calls and simple expressions
 * ENHANCED with automatic logger output capture
 */
function __gas_run(js_statement) {
  const startTime = Date.now();
  
  // [PERF] PERFORMANCE OPTIMIZATION: Skip logging for simple expressions
  const isSimpleExpression = /^[a-zA-Z0-9_.$\s*/()+-]+$/.test(js_statement) && 
                            js_statement.length < 50 && 
                            !js_statement.includes('function') && 
                            !js_statement.includes('const') && 
                            !js_statement.includes('let') && 
                            !js_statement.includes('var');
  
  if (!isSimpleExpression) {
    console.error(`[GAS_RUN] Executing: ${js_statement}`);
  }

  try {
    // [PERF] PERFORMANCE OPTIMIZATION: Direct eval for simple math expressions
    if (isSimpleExpression && /^[\d\s*/.()+-]+$/.test(js_statement)) {
      const result = eval(js_statement);
      const duration = Date.now() - startTime;
      
      // CRITICAL: Capture logger output after execution
      const loggerOutput = Logger.getLog();
      
      return jsonResponse({
        function_called: js_statement,
        result: result === undefined ? null : result,  // undefined → null for JSON serialization
        success: true,
        execution_time_ms: duration,
        execution_type: 'fast_eval',
        logger_output: loggerOutput
      });
    }

    // Standard function construction for complex expressions
    const fn = createFunction(js_statement);
    const result = fn();
    const duration = Date.now() - startTime;

    // CRITICAL: Capture logger output after execution
    const loggerOutput = Logger.getLog();

    return jsonResponse({
      function_called: js_statement,
      result: result === undefined ? null : result,  // undefined → null for JSON serialization
      success: true,
      execution_time_ms: duration,
      execution_type: 'function_constructor',
      logger_output: loggerOutput
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[GAS_RUN ERROR] ${js_statement}: ${error.toString()}`);
    
    // CRITICAL: Capture logger output even on error
    const loggerOutput = Logger.getLog();
    
    return errorResponse(error, 'execution', js_statement, loggerOutput, 'function_constructor');
  }
}

/**
 * Standardized JSON response helper with CORS headers
 */
/**
 * Standardized JSON response helper
 * NOTE: ContentService does not support setHeaders() method
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Standardized error response with logger output
 * Security: Stack traces only shown in /dev mode to prevent information disclosure
 *
 * Response structure is consistent with success responses:
 * - success: boolean (always present - false for errors)
 * - execution_type: string (always present - identifies the execution path)
 * - error: boolean (true for errors, absent for success)
 *
 * @param {Error} error - The error object
 * @param {string} context - Where the error occurred (e.g., 'execution', 'doGet')
 * @param {string} code - The code that was being executed
 * @param {string} loggerOutput - Captured Logger.log() output
 * @param {string} executionType - The execution type (e.g., 'function_constructor', 'fast_eval')
 */
function errorResponse(error, context, code = 'unknown', loggerOutput = '', executionType = 'unknown') {
  console.error(`Error in ${context}:`, error.toString());

  const currentUrl = ScriptApp.getService().getUrl();
  const isDevMode = currentUrl.endsWith('/dev');

  // Safe stack extraction with length limit (8KB max)
  const MAX_STACK_LENGTH = 8192;
  let rawStack = '';
  try {
    if (error && typeof error === 'object' && typeof error.stack === 'string') {
      rawStack = error.stack;
    } else if (error && typeof error.toString === 'function') {
      rawStack = error.toString();
    } else {
      rawStack = String(error);
    }
  } catch (e) {
    rawStack = '[Error serializing stack trace]';
  }

  // Truncate long stacks and filter by environment
  let stack;
  if (isDevMode) {
    stack = rawStack.length > MAX_STACK_LENGTH
      ? rawStack.substring(0, MAX_STACK_LENGTH) + '\n... [truncated, ' + (rawStack.length - MAX_STACK_LENGTH) + ' chars hidden]'
      : rawStack;
  } else {
    stack = '[Stack trace hidden in production - use /dev deployment for debugging]';
  }

  return jsonResponse({
    success: false,           // CRITICAL: Always include success field for consistent parsing
    error: true,              // Keep for backwards compatibility
    execution_type: executionType, // CRITICAL: Always include execution_type
    context: context,
    function_called: code,
    message: error.toString(),
    stack: stack,
    logger_output: loggerOutput,
    accessed_url: currentUrl,
    url_type: currentUrl.endsWith('/dev') ? 'HEAD deployment (testing)' : currentUrl.endsWith('/exec') ? 'Deployment (may be redirected from /dev)' : 'Unknown deployment type',
    debug_info: {
      timestamp: new Date().toISOString(),
      deployment_mode: isDevMode ? 'development' : currentUrl.endsWith('/exec') ? 'redirected' : 'unknown'
    }
  });
}

/**
 * Generate HTML success page for authorization tests
 * @param {Object} executionResult - Result from __gas_run
 * @returns {ContentService.TextOutput} HTML response
 */
function htmlAuthSuccessResponse(executionResult) {
  const scriptId = ScriptApp.getScriptId();
  const projectName = DriveApp.getFileById(scriptId).getName();
  const deploymentUrl = ScriptApp.getService().getUrl();
  const userEmail = Session.getActiveUser().getEmail();
  const timezone = Session.getScriptTimeZone();

  // Gather module information
  const modules = globalThis.__getModules__ ? globalThis.__getModules__() : {};
  const moduleList = Object.keys(modules).map(function(name) {
    const mod = modules[name];
    const exports = mod.exports ? Object.keys(mod.exports) : [];
    return {
      name: name,
      exports: exports,
      loaded: mod.loaded,
      loadNow: mod.loadNow
    };
  });

  try {
    // Load HTML template
    const template = HtmlService.createTemplateFromFile('common-js/__mcp_exec_success');
    template.projectName = projectName;
    template.deploymentUrl = deploymentUrl;
    template.scriptId = scriptId;
    template.userEmail = userEmail;
    template.timezone = timezone;
    template.moduleList = moduleList;
    template.moduleCount = moduleList.length;
    template.moduleListJson = JSON.stringify(moduleList);

    return template.evaluate();
  } catch (e) {
    // Informative fallback: Clear explanation of incomplete deployment
    const html = '<!DOCTYPE html>\n' +
      '<html>\n' +
      '<head>\n' +
      '  <meta charset="UTF-8">\n' +
      '  <title>Deployment Incomplete - ' + projectName + '</title>\n' +
      '  <style>\n' +
      '    body { font-family: system-ui; max-width: 700px; margin: 50px auto; padding: 20px; }\n' +
      '    .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; border-radius: 4px; }\n' +
      '    .success { color: #198754; font-size: 18px; margin-bottom: 20px; }\n' +
      '    .error { color: #dc3545; margin: 15px 0; }\n' +
      '    .info { background: #f8f9fa; padding: 15px; border-radius: 4px; margin: 15px 0; }\n' +
      '    code { background: #e9ecef; padding: 2px 6px; border-radius: 3px; font-family: monospace; }\n' +
      '    ul { line-height: 1.8; }\n' +
      '  </style>\n' +
      '</head>\n' +
      '<body>\n' +
      '  <div class="success">✓ Authorization Successful</div>\n' +
      '  <h2>' + projectName + '</h2>\n' +
      '  \n' +
      '  <div class="warning">\n' +
      '    <h3>⚠️ Incomplete Deployment Detected</h3>\n' +
      '    <p class="error">Missing HTML template files for full authorization interface.</p>\n' +
      '    \n' +
      '    <p><strong>Current Status:</strong></p>\n' +
      '    <ul>\n' +
      '      <li>✓ Authorization successful</li>\n' +
      '      <li>✓ User: ' + userEmail + '</li>\n' +
      '      <li>✓ Timezone: ' + timezone + '</li>\n' +
      '      <li>✓ Modules loaded: ' + moduleList.length + '</li>\n' +
      '      <li>❌ HTML templates not found</li>\n' +
      '    </ul>\n' +
      '\n' +
      '    <p><strong>To enable the full IDE-style interface, deploy these files:</strong></p>\n' +
      '    <div class="info">\n' +
      '      <code>__mcp_exec.js</code> (✓ deployed)<br>\n' +
      '      <code>__mcp_exec_success.html</code> (❌ missing)<br>\n' +
      '      <code>__mcp_exec_error.html</code> (❌ missing)\n' +
      '    </div>\n' +
      '\n' +
      '    <p><strong>How to deploy:</strong></p>\n' +
      '    <ol>\n' +
      '      <li>Use MCP gas_write tool for each HTML file</li>\n' +
      '      <li>Or manually add files in Apps Script Editor</li>\n' +
      '      <li>Refresh this page after deployment</li>\n' +
      '    </ol>\n' +
      '\n' +
      '    <p style="margin-top: 20px;">\n' +
      '      <a href="https://script.google.com/d/' + scriptId + '/edit" \n' +
      '         style="display: inline-block; padding: 10px 20px; background: #0d6efd; \n' +
      '                color: white; text-decoration: none; border-radius: 4px;">\n' +
      '        Open Script Editor\n' +
      '      </a>\n' +
      '    </p>\n' +
      '  </div>\n' +
      '</body>\n' +
      '</html>';

    return HtmlService.createHtmlOutput(html);
  }
}

  /**
   * Execute function via CommonJS module system
   * This is the NEW function for client-side google.script.run calls
   * Returns raw JavaScript values (not ContentService objects)
   *
   * @param {Object} options - Reserved for future use (can be null)
   * @param {string} moduleName - CommonJS module name (e.g., "Code")
   * @param {string} functionName - Function name to call (e.g., "getConfig")
   * @param {...*} args - Variable arguments to pass to the function
   * @returns {*} Raw JavaScript value from the function
   */
  function exec_api(options, moduleName, functionName) {
    // TODO: Add validation for moduleName and functionName parameters:
    // - Check if moduleName is a non-empty string
    // - Check if functionName is a non-empty string
    // - Provide helpful error message if invalid
    // - Prevents cryptic errors from undefined/null parameters

    // Get remaining arguments after the first 3
    var args = Array.prototype.slice.call(arguments, 3);

    // Build JavaScript statement
    var paramStr = args.map(function(p) {
      return JSON.stringify(p);
    }).join(',');

    var js_statement = 'require("' + moduleName + '").' + functionName + '(' + paramStr + ')';

    Logger.log('[exec_api] Executing: ' + JSON.stringify({
      module: moduleName,
      function: functionName,
      argCount: args.length
    }));

    // Execute with logger capture for debugging
    try {
      var fn = createFunction(js_statement);
      var result = fn();
      var loggerOutput = Logger.getLog();

      return {
        success: true,
        result: result,
        logger_output: loggerOutput,
        execution_type: 'exec_api'
      };
    } catch (error) {
      var loggerOutput = Logger.getLog();
      return {
        success: false,
        error: error.toString(),
        message: error.message,
        stack: error.stack,
        logger_output: loggerOutput,
        execution_type: 'exec_api'
      };
    }
  }

  /**
   * Universal invocation for google.script.run
   * Supports both:
   * - Raw JavaScript expressions: invoke('2 + 2')
   * - Module paths: invoke('__mcp_exec.__gas_run', '2 + 2')
   * @param {string} codeOrPath - JavaScript code or Module.function path
   * @param {...*} args - Arguments (for module path mode only)
   * @returns {*} Result (auto-parses ContentService responses)
   */
  function invoke(codeOrPath, ...args) {
    try {
      // Detect if this is a module path or raw JavaScript
      // Module path: has a dot AND args provided OR looks like 'Module.function' pattern
      const hasDot = codeOrPath.indexOf('.') !== -1;
      const hasArgs = args.length > 0;
      const looksLikeModulePath = hasDot && /^[a-zA-Z_$][a-zA-Z0-9_$.]*\.[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(codeOrPath);
      
      const isModulePath = (hasDot && hasArgs) || looksLikeModulePath;
      
      // MODE 1: Module path invocation
      if (isModulePath) {
        const lastDot = codeOrPath.lastIndexOf('.');
        
        if (lastDot === -1) {
          return {
            success: false,
            error: `Invalid module path: ${codeOrPath}. Expected format: 'moduleName.functionName'`,
            example: 'invoke("__mcp_exec.__gas_run", "2 + 2")'
          };
        }
        
        const moduleName = codeOrPath.substring(0, lastDot);
        const functionName = codeOrPath.substring(lastDot + 1);
        
        const module = require(moduleName);
        const fn = module[functionName];
        
        if (typeof fn !== 'function') {
          return {
            success: false,
            error: `${functionName} is not a function in ${moduleName}`,
            available: Object.keys(module).filter(k => typeof module[k] === 'function')
          };
        }
        
        const result = fn(...args);
        const loggerOutput = Logger.getLog();

        // Auto-parse ContentService responses
        if (result && typeof result.getContent === 'function') {
          const parsed = JSON.parse(result.getContent());
          // Preserve any existing logger_output, merge if needed
          if (!parsed.logger_output) {
            parsed.logger_output = loggerOutput;
          } else if (loggerOutput) {
            parsed.logger_output = parsed.logger_output + '\n' + loggerOutput;
          }
          return parsed;
        }

        return {
          success: true,
          result: result,
          logger_output: loggerOutput,
          execution_type: 'invoke_module'
        };
      }
      
      // MODE 2: Raw JavaScript execution (default)
      // Use the __gas_run function to execute the code
      const result = __gas_run(codeOrPath);
      
      // Auto-parse ContentService responses
      if (result && typeof result.getContent === 'function') {
        return JSON.parse(result.getContent());
      }
      
      return result;
    } catch (error) {
      const loggerOutput = Logger.getLog();
      return {
        success: false,
        error: error.toString(),
        message: error.message,
        stack: error.stack,
        logger_output: loggerOutput
      };
    }
  }

  /**
   * Get deployment URLs for dev/staging/prod environments
   * Reads from ConfigManager where mcp_gas deploy tool stores URLs
   * @returns {{dev: string|null, staging: string|null, prod: string|null, error?: string}}
   */
  function getDeploymentUrls() {
    try {
      var ConfigManager = require('gas-properties/ConfigManager');
      var config = new ConfigManager('DEPLOY');

      return {
        dev: config.get('DEV_URL') || ScriptApp.getService().getUrl(),
        staging: config.get('STAGING_URL'),
        prod: config.get('PROD_URL')
      };
    } catch (error) {
      Logger.log('[getDeploymentUrls] Error reading from ConfigManager: ' + error.toString());
      return {
        dev: ScriptApp.getService().getUrl(),
        staging: null,
        prod: null,
        error: error.toString()
      };
    }
  }

  /**
   * Determine which deployment environment is currently running
   * @returns {'dev' | 'staging' | 'prod' | 'unknown'}
   */
  function getCurrentDeploymentType() {
    var currentUrl = ScriptApp.getService().getUrl();

    // Fast path: HEAD deployments end with /dev
    if (currentUrl && currentUrl.endsWith('/dev')) {
      return 'dev';
    }

    try {
      var urls = getDeploymentUrls();
      if (currentUrl === urls.dev) return 'dev';
      if (currentUrl === urls.staging) return 'staging';
      if (currentUrl === urls.prod) return 'prod';
      return 'unknown';
    } catch (error) {
      Logger.log('[getCurrentDeploymentType] Error: ' + error.toString());
      return 'unknown';
    }
  }

  /**
   * Get basic script information for debugger header
   * @returns {Object} Script metadata {scriptId, projectName}
   */
  function getScriptInfo() {
    try {
      const scriptId = ScriptApp.getScriptId();
      const projectName = DriveApp.getFileById(scriptId).getName();
      return {
        scriptId: scriptId,
        projectName: projectName
      };
    } catch (e) {
      Logger.log('[ERROR] getScriptInfo failed: ' + e.toString());
      return {
        scriptId: 'Error',
        projectName: 'Unable to load'
      };
    }
  }

  /**
   * Get recent script execution processes
   * @returns {Object} {success: boolean, processes: Array, error?: string}
   */
  function getRecentProcesses() {
    try {
      const allProcesses = Script.listScriptProcesses();

      // Filter and format recent processes (last 24 hours)
      const oneDayAgo = new Date().getTime() - (24 * 60 * 60 * 1000);
      const recentProcesses = allProcesses
        .filter(p => new Date(p.startTime).getTime() > oneDayAgo)
        .slice(0, 10)  // Limit to 10 most recent
        .map(p => ({
          functionName: p.functionName,
          startTime: p.startTime,
          status: p.status,
          duration: p.duration
        }));

      return {
        success: true,
        processes: recentProcesses
      };
    } catch (e) {
      Logger.log('[ERROR] getRecentProcesses failed: ' + e.toString());
      return {
        success: false,
        error: e.toString(),
        processes: []
      };
    }
  }

  /**
   * Get script execution logs from the past N minutes
   * @param {number} minutes - Number of minutes to look back (0 = all logs)
   * @returns {Object} {success: boolean, logs: Array, error?: string}
   */
  function getScriptLogs(minutes) {
    try {
      // Calculate time range
      const now = new Date();
      const startTime = minutes === 0
        ? new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000))  // 30 days ago for "all"
        : new Date(now.getTime() - (minutes * 60 * 1000));

      // Fetch logs using Apps Script API
      const logs = Script.getProjectLogs({
        startTime: startTime,
        endTime: now,
        pageSize: 100
      });

      // Format logs for display
      const formattedLogs = logs.map(log => ({
        timestamp: log.time,
        severity: log.severity || 'INFO',
        message: log.message || log.textPayload || '',
        functionName: log.functionName || 'N/A'
      }));

      return {
        success: true,
        logs: formattedLogs
      };
    } catch (e) {
      Logger.log('[ERROR] getScriptLogs failed: ' + e.toString());
      return {
        success: false,
        error: e.toString(),
        logs: []
      };
    }
  }

  /**
   * Compute Git-compatible SHA-1 hashes for files using ScriptApp.getResource()
   * Matches Node.js computeGitSha1() behavior exactly.
   *
   * Uses Git blob format: sha1("blob " + byteLength + "\0" + content)
   * This enables server-side hash computation without downloading file content.
   *
   * IMPORTANT: ScriptApp.getResource() requires full paths WITH extensions:
   *   - .gs files: 'folder/file.gs'
   *   - .html files: 'folder/file.html'
   *   - .json files: 'appsscript.json'
   *
   * @param {string[]} filenames - Full paths WITH extensions (e.g., 'folder/file.gs')
   * @returns {Object} Map of filename → hash (40 hex chars) or null if error
   *
   * @example
   * // Compute hashes for specific files
   * __mcp_computeFileHashes(['Code.gs', 'Utils.gs', 'appsscript.json'])
   * // Returns: { 'Code.gs': 'a1b2c3...', 'Utils.gs': 'd4e5f6...', 'appsscript.json': 'g7h8i9...' }
   */
  function __mcp_computeFileHashes(filenames) {
    const results = {};

    for (const filename of filenames) {
      try {
        let content = ScriptApp.getResource(filename).getDataAsString();

        // Normalize content to match Node.js computeGitSha1() behavior:
        // 1. Strip UTF-8 BOM (0xFEFF)
        if (content.charCodeAt(0) === 0xFEFF) {
          content = content.slice(1);
        }
        // 2. Normalize CRLF to LF (Windows → Unix line endings)
        content = content.replace(/\r\n/g, '\n');

        // Git blob format: "blob <byte_length>\0<content>"
        // CRITICAL: Use byte length, not character length
        // JavaScript string.length returns characters, but Git needs bytes
        const contentBytes = Utilities.newBlob(content).getBytes();
        const header = 'blob ' + contentBytes.length + '\0';
        const blob = header + content;

        // Compute SHA-1 hash
        const sha1Bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, blob);

        // Convert signed bytes to hex string
        // GAS returns signed bytes (-128 to 127), need to convert to unsigned
        results[filename] = sha1Bytes
          .map(function(b) {
            return ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0');
          })
          .join('');
      } catch (e) {
        // File not found or error - return null for this file
        Logger.log('[__mcp_computeFileHashes] Error for ' + filename + ': ' + e.toString());
        results[filename] = null;
      }
    }

    return results;
  }

  /**
   * Promote deployment between environments
   * @param {string} environment - 'staging' or 'prod'
   * @param {string} description - Version description (required for staging)
   * @returns {Object} {success: boolean, message: string, version?: number, error?: string}
   */
  function promoteDeployment(environment, description) {
    var scriptId = ScriptApp.getScriptId();
    var token = ScriptApp.getOAuthToken();

    try {
      Logger.log('[promoteDeployment] Promoting to: ' + environment);

      if (environment !== 'staging' && environment !== 'prod') {
        return {
          success: false,
          error: 'Invalid environment. Must be "staging" or "prod"'
        };
      }

      if (environment === 'staging') {
        // Promote dev→staging: Create version from HEAD
        if (!description || description.trim() === '') {
          return {
            success: false,
            error: 'Description is required when promoting to staging'
          };
        }

        var taggedDescription = '[STAGING] ' + description;

        // Create version from HEAD
        var versionPayload = {
          description: taggedDescription
        };

        var versionResponse = UrlFetchApp.fetch(
          'https://script.googleapis.com/v1/projects/' + scriptId + '/versions',
          {
            method: 'post',
            headers: {
              'Authorization': 'Bearer ' + token,
              'Content-Type': 'application/json'
            },
            contentType: 'application/json',
            payload: JSON.stringify(versionPayload),
            muteHttpExceptions: true
          }
        );

        if (versionResponse.getResponseCode() !== 200) {
          throw new Error('Failed to create version: ' + versionResponse.getContentText());
        }

        var version = JSON.parse(versionResponse.getContentText());
        Logger.log('[promoteDeployment] Created version: ' + version.versionNumber);

        // Find staging deployment
        var deploymentsResponse = UrlFetchApp.fetch(
          'https://script.googleapis.com/v1/projects/' + scriptId + '/deployments',
          {
            method: 'get',
            headers: {
              'Authorization': 'Bearer ' + token
            },
            muteHttpExceptions: true
          }
        );

        if (deploymentsResponse.getResponseCode() !== 200) {
          throw new Error('Failed to get deployments: ' + deploymentsResponse.getContentText());
        }

        var deploymentsData = JSON.parse(deploymentsResponse.getContentText());
        var deployments = deploymentsData.deployments || [];
        var stagingDeployment = deployments.find(function(d) {
          return (d.description || '').indexOf('[STAGING]') === 0;
        });

        if (!stagingDeployment) {
          return {
            success: false,
            error: 'Staging deployment not found. Run deploy_config({operation: "reset"}) via MCP to create deployments'
          };
        }

        // Update staging deployment to new version
        var updatePayload = {
          deploymentConfig: {
            versionNumber: version.versionNumber,
            description: '[STAGING] ' + description + ' (v' + version.versionNumber + ')'
          }
        };

        var updateResponse = UrlFetchApp.fetch(
          'https://script.googleapis.com/v1/projects/' + scriptId + '/deployments/' + stagingDeployment.deploymentId,
          {
            method: 'put',
            headers: {
              'Authorization': 'Bearer ' + token,
              'Content-Type': 'application/json'
            },
            contentType: 'application/json',
            payload: JSON.stringify(updatePayload),
            muteHttpExceptions: true
          }
        );

        if (updateResponse.getResponseCode() !== 200) {
          throw new Error('Failed to update staging deployment: ' + updateResponse.getContentText());
        }

        Logger.log('[promoteDeployment] Updated staging deployment to v' + version.versionNumber);

        return {
          success: true,
          message: 'Successfully promoted to staging',
          version: version.versionNumber,
          environment: 'staging'
        };

      } else if (environment === 'prod') {
        // Promote staging→prod: Update prod deployment to staging's version

        // Get current deployments
        var deploymentsResponse = UrlFetchApp.fetch(
          'https://script.googleapis.com/v1/projects/' + scriptId + '/deployments',
          {
            method: 'get',
            headers: {
              'Authorization': 'Bearer ' + token
            },
            muteHttpExceptions: true
          }
        );

        if (deploymentsResponse.getResponseCode() !== 200) {
          throw new Error('Failed to get deployments: ' + deploymentsResponse.getContentText());
        }

        var deploymentsData = JSON.parse(deploymentsResponse.getContentText());
        var deployments = deploymentsData.deployments || [];

        var stagingDeployment = deployments.find(function(d) {
          return (d.description || '').indexOf('[STAGING]') === 0;
        });

        var prodDeployment = deployments.find(function(d) {
          return (d.description || '').indexOf('[PROD]') === 0;
        });

        if (!stagingDeployment) {
          return {
            success: false,
            error: 'Staging deployment not found. Cannot promote to prod without staging deployment'
          };
        }

        if (!prodDeployment) {
          return {
            success: false,
            error: 'Production deployment not found. Run deploy_config({operation: "reset"}) via MCP to create deployments'
          };
        }

        var stagingVersion = stagingDeployment.deploymentConfig.versionNumber;

        if (!stagingVersion || stagingVersion === '@HEAD') {
          return {
            success: false,
            error: 'Staging is not on a versioned deployment. Promote to staging first.'
          };
        }

        // Update prod deployment to staging's version
        var updatePayload = {
          deploymentConfig: {
            versionNumber: stagingVersion,
            description: '[PROD] Promoted from staging (v' + stagingVersion + ')'
          }
        };

        var updateResponse = UrlFetchApp.fetch(
          'https://script.googleapis.com/v1/projects/' + scriptId + '/deployments/' + prodDeployment.deploymentId,
          {
            method: 'put',
            headers: {
              'Authorization': 'Bearer ' + token,
              'Content-Type': 'application/json'
            },
            contentType: 'application/json',
            payload: JSON.stringify(updatePayload),
            muteHttpExceptions: true
          }
        );

        if (updateResponse.getResponseCode() !== 200) {
          throw new Error('Failed to update production deployment: ' + updateResponse.getContentText());
        }

        Logger.log('[promoteDeployment] Updated production deployment to v' + stagingVersion);

        return {
          success: true,
          message: 'Successfully promoted to production',
          version: stagingVersion,
          environment: 'prod'
        };
      }

    } catch (error) {
      Logger.log('[ERROR] promoteDeployment failed: ' + error.toString());
      return {
        success: false,
        error: error.toString()
      };
    }
  }

  // Export handlers

function htmlAuthErrorResponse(errorData) {
  const scriptId = ScriptApp.getScriptId();
  const projectName = DriveApp.getFileById(scriptId).getName();

  try {
    // Load HTML template
    const template = HtmlService.createTemplateFromFile('common-js/__mcp_exec_error');
    template.projectName = projectName;
    template.scriptId = scriptId;
    template.errorMessage = errorData.error || 'Unknown error';
    template.errorContext = errorData.context || 'N/A';
    template.errorDetails = errorData.originalError || '';
    template.loggerOutput = errorData.logger || '';

    return template.evaluate();
  } catch (e) {
    // Informative fallback: Clear explanation of incomplete deployment + error details
    const errorMsg = errorData.error || 'Unknown error';
    const errorCtx = errorData.context || 'N/A';
    const errorDetails = errorData.originalError || '';
    const logger = errorData.logger || '';

    const html = '<!DOCTYPE html>\n' +
      '<html>\n' +
      '<head>\n' +
      '  <meta charset="UTF-8">\n' +
      '  <title>Authorization Failed - ' + projectName + '</title>\n' +
      '  <style>\n' +
      '    body { font-family: system-ui; max-width: 700px; margin: 50px auto; padding: 20px; }\n' +
      '    .error-box { background: #f8d7da; border-left: 4px solid #dc3545; padding: 20px; border-radius: 4px; margin-bottom: 20px; }\n' +
      '    .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; border-radius: 4px; }\n' +
      '    .error-title { color: #dc3545; font-size: 18px; margin-bottom: 20px; }\n' +
      '    .info { background: #f8f9fa; padding: 15px; border-radius: 4px; margin: 15px 0; }\n' +
      '    code { background: #e9ecef; padding: 2px 6px; border-radius: 3px; font-family: monospace; }\n' +
      '    pre { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 4px; overflow-x: auto; }\n' +
      '    ul { line-height: 1.8; }\n' +
      '  </style>\n' +
      '</head>\n' +
      '<body>\n' +
      '  <div class="error-title">✗ Authorization Failed</div>\n' +
      '  <h2>' + projectName + '</h2>\n' +
      '  \n' +
      '  <div class="error-box">\n' +
      '    <h3>Error Details</h3>\n' +
      '    <p><strong>Error:</strong> ' + errorMsg + '</p>\n' +
      '    <p><strong>Context:</strong> ' + errorCtx + '</p>\n' +
      (errorDetails ? '    <p><strong>Details:</strong> ' + errorDetails + '</p>\n' : '') +
      '  </div>\n' +
      (logger ? '  <details>\n' +
        '    <summary style="cursor: pointer; padding: 10px; background: #f8f9fa; border-radius: 4px;">Show Logger Output</summary>\n' +
        '    <pre>' + logger + '</pre>\n' +
        '  </details>\n' : '') +
      '  \n' +
      '  <div class="warning">\n' +
      '    <h3>⚠️ Additional Issue: Missing Template Files</h3>\n' +
      '    <p>The error page template is also missing. Deploy all required files:</p>\n' +
      '    <div class="info">\n' +
      '      <code>__mcp_exec.js</code> (✓ deployed)<br>\n' +
      '      <code>__mcp_exec_success.html</code> (❌ missing)<br>\n' +
      '      <code>__mcp_exec_error.html</code> (❌ missing)\n' +
      '    </div>\n' +
      '    <p><strong>How to deploy:</strong></p>\n' +
      '    <ol>\n' +
      '      <li>Use MCP gas_write tool for each HTML file</li>\n' +
      '      <li>Or manually add files in Apps Script Editor</li>\n' +
      '      <li>Retry authorization after deployment</li>\n' +
      '    </ol>\n' +
      '  </div>\n' +
      '\n' +
      '  <p style="margin-top: 20px;">\n' +
      '    <a href="https://script.google.com/d/' + scriptId + '/edit" \n' +
      '       style="display: inline-block; padding: 10px 20px; background: #dc3545; \n' +
      '              color: white; text-decoration: none; border-radius: 4px; margin-right: 10px;">\n' +
      '      Open Script Editor\n' +
      '    </a>\n' +
      '    <a href="javascript:location.reload()" \n' +
      '       style="display: inline-block; padding: 10px 20px; background: #6c757d; \n' +
      '              color: white; text-decoration: none; border-radius: 4px;">\n' +
      '      Retry Authorization\n' +
      '    </a>\n' +
      '  </p>\n' +
      '</body>\n' +
      '</html>';

    return HtmlService.createHtmlOutput(html);
  }
}
  module.exports = {
    doGetHandler,
    doPostHandler,
    __gas_run,
    invoke,
    exec_api,
    getDeploymentUrls,
    getCurrentDeploymentType,
    getScriptInfo,
    getRecentProcesses,
    getScriptLogs,
    promoteDeployment,
    __mcp_computeFileHashes
  };

  // Register with event system
  module.exports.__events__ = {
    doGet: 'doGetHandler',
    doPost: 'doPostHandler'
  };

  // Expose invoke and exec_api to global namespace for google.script.run
  module.exports.__global__ = {
    invoke: invoke,
    exec_api: exec_api,
    getScriptInfo: getScriptInfo,
    getRecentProcesses: getRecentProcesses,
    getScriptLogs: getScriptLogs,
    promoteDeployment: promoteDeployment,
    __mcp_computeFileHashes: __mcp_computeFileHashes
  };

  ///////// END USER CODE /////////
}

/**
 * Hoisted bridge function for google.script.run compatibility
 * Delegates to the module's invoke function
 * CRITICAL: Must be declared BEFORE __defineModule__ with loadNow: true
 * because loadNow immediately loads the module which exports invoke to global
 * @customfunction
 */
function invoke(modulePath, ...args) {
  return require('common-js/__mcp_exec').invoke(modulePath, ...args);
}

/**
 * Hoisted bridge function for google.script.run compatibility
 * Executes functions via CommonJS module system
 * CRITICAL: Must be declared BEFORE __defineModule__ with loadNow: true
 * @param {Object} options - Reserved for future use (can be null)
 * @param {string} moduleName - CommonJS module name (e.g., "Code")
 * @param {string} functionName - Function name to call (e.g., "getConfig")
 * @param {...*} args - Variable arguments to pass to the function
 * @returns {*} Raw JavaScript value from the function
 */
function exec_api(options, moduleName, functionName) {
  var args = Array.prototype.slice.call(arguments);
  return require('common-js/__mcp_exec').exec_api.apply(null, args);
}

__defineModule__(_main, true, { explicitName: 'common-js/__mcp_exec' });