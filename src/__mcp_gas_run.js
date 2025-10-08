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

function _main(module, exports, require) {
  ///////// BEGIN USER CODE /////////

  /**
   * GET endpoint - executes JavaScript from URL parameters
   *
   * CONVENTION: Returns null if this is not a gas_run request,
   * allowing other doGet handlers to check the request.
   *
   * Routes on URI path: /__mcp_gas_run or parameter: _mcp_run=true
   */
  function doGetHandler(e) {
    // Check if this is a gas_run request using URI or parameter
    const isGasRunRequest = (e.parameter && e.parameter._mcp_run === 'true') ||
                           (e.pathInfo && e.pathInfo === '/__mcp_gas_run');

    if (!isGasRunRequest) {
      return null; // Not a gas_run request, let other handlers check
    }

    // NEW: Detect authorization test
    const isAuthTest = e.parameter?.func === '"auth successful"' ||
                       e.parameter?.func === 'return "auth successful"';

    // Check if client wants JSON (programmatic request) vs HTML (browser)
    const wantsJson = e.parameter?.format === 'json' ||
                      (e.parameter && !e.parameter.browser);

    // Verify we have the required func parameter
    if (!e.parameter || !e.parameter.func) {
      if (isAuthTest) {
        return htmlAuthErrorResponse({
          error: 'No JavaScript statement provided',
          context: 'doGet',
          originalError: 'Missing func parameter'
        });
      }
      return jsonResponse({
        error: true,
        message: 'Missing func parameter for gas_run',
        usage: 'Append ?_mcp_run=true&func=<javascript> to URL',
        accessed_url: ScriptApp.getService().getUrl()
      });
    }

    // This is a gas_run request, process it
    try {
      validateDevMode();
      const js_statement = extractGetParams(e.parameter);
      if (!js_statement) {
        if (isAuthTest) {
          return htmlAuthErrorResponse({
            error: 'No JavaScript code provided',
            context: 'doGet',
            originalError: 'Use ?_mcp_run=true&func=yourCode'
          });
        }
        throw new Error('No JavaScript code provided. Use ?_mcp_run=true&func=yourCode');
      }

      // NEW: Handle auth test - return HTML for browser, JSON for polling
      if (isAuthTest) {
        const result = __gas_run(js_statement);
        const resultData = JSON.parse(result.getContent());

        // If client wants JSON (programmatic polling), return JSON
        if (wantsJson) {
          return result; // Return original JSON response
        }

        // Browser request - return HTML with IDE interface
        if (resultData.success) {
          return htmlAuthSuccessResponse(resultData);
        } else {
          return htmlAuthErrorResponse({
            error: resultData.message || 'Execution failed',
            context: 'doGet',
            originalError: resultData.message,
            logger: resultData.logger_output
          });
        }
      }

      // Normal execution for non-auth requests
      const result = __gas_run(js_statement);
      return result;
    } catch (error) {
      // Capture logger output even on setup errors
      const loggerOutput = Logger.getLog();

      if (isAuthTest) {
        return htmlAuthErrorResponse({
          error: error.message,
          context: 'doGet',
          originalError: error.toString(),
          stack: error.stack,
          logger: loggerOutput
        });
      }

      return errorResponse(error, 'doGet', 'unknown', loggerOutput);
    }
  }

  /**
   * POST endpoint - executes JavaScript from POST body
   *
   * CONVENTION: Returns null if this is not a gas_run request,
   * allowing other doPost handlers to check the request.
   *
   * Routes on URI path: /__mcp_gas_run or parameter: _mcp_run=true
   */
  function doPostHandler(e) {
    // Check if this is a gas_run request using URI or parameter
    const isGasRunRequest = (e.parameter && e.parameter._mcp_run === 'true') ||
                           (e.pathInfo && e.pathInfo === '/__mcp_gas_run');

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
      return errorResponse(error, 'doPost', 'unknown', loggerOutput);
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
 * Creates a function from a JS string, returning the value of the 
 * last expression. This robust version correctly handles 'return'
 * as a whole word, distinguishing it from variable names.
 */
function createFunction(code) {
  const trimmedCode = code.trim();
  if (trimmedCode === '') return new Function('');

  // Regex to test for a standalone 'return' keyword at the start.
  const isReturnStatement = /^return($|[\s;])/.test(trimmedCode);
  
  const lastSemicolon = trimmedCode.lastIndexOf(';');

  // Case 1: No semicolon
  if (lastSemicolon === -1) {
    return new Function(
      isReturnStatement ? trimmedCode : `return ${trimmedCode}`
    );
  }

  // Case 2: Semicolon exists
  const declarations = trimmedCode.substring(0, lastSemicolon + 1);
  const finalPart = trimmedCode.substring(lastSemicolon + 1).trim();

  const finalPartIsReturn = /^return($|[\s;])/.test(finalPart);

  const functionBody = (finalPart === '' || finalPartIsReturn)
    ? trimmedCode
    : `${declarations} return ${finalPart}`;

  return new Function(functionBody);
}

/**
 * Core execution engine - runs JavaScript code dynamically
 * PERFORMANCE OPTIMIZED for repeated calls and simple expressions
 * ENHANCED with automatic logger output capture
 */
function __gas_run(js_statement) {
  const startTime = Date.now();
  
  // 🚀 PERFORMANCE OPTIMIZATION: Skip logging for simple expressions
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
    // 🚀 PERFORMANCE OPTIMIZATION: Direct eval for simple math expressions
    if (isSimpleExpression && /^[\d\s*/.()+-]+$/.test(js_statement)) {
      const result = eval(js_statement);
      const duration = Date.now() - startTime;
      
      // CRITICAL: Capture logger output after execution
      const loggerOutput = Logger.getLog();
      
      return jsonResponse({
        function_called: js_statement,
        result: result,
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
      result: result,
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
    
    return errorResponse(error, 'execution', js_statement, loggerOutput);
  }
}

/**
 * Standardized JSON response helper
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Standardized error response with logger output
 */
function errorResponse(error, context, code = 'unknown', loggerOutput = '') {
  console.error(`Error in ${context}:`, error.toString());

  const currentUrl = ScriptApp.getService().getUrl();

  return jsonResponse({
    error: true,
    context: context,
    function_called: code,
    message: error.toString(),
    logger_output: loggerOutput,
    accessed_url: currentUrl,
    url_type: currentUrl.endsWith('/dev') ? 'HEAD deployment (testing)' : currentUrl.endsWith('/exec') ? 'Deployment (may be redirected from /dev)' : 'Unknown deployment type',
    debug_info: {
      timestamp: new Date().toISOString(),
      deployment_mode: currentUrl.endsWith('/dev') ? 'development' : currentUrl.endsWith('/exec') ? 'redirected' : 'unknown'
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
    const template = HtmlService.createTemplateFromFile('__mcp_gas_run_success');
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
      '      <code>__mcp_gas_run.js</code> (✓ deployed)<br>\n' +
      '      <code>__mcp_gas_run_success.html</code> (❌ missing)<br>\n' +
      '      <code>__mcp_gas_run_error.html</code> (❌ missing)\n' +
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

  // Export handlers

function htmlAuthErrorResponse(errorData) {
  const scriptId = ScriptApp.getScriptId();
  const projectName = DriveApp.getFileById(scriptId).getName();

  try {
    // Load HTML template
    const template = HtmlService.createTemplateFromFile('__mcp_gas_run_error');
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
      '      <code>__mcp_gas_run.js</code> (✓ deployed)<br>\n' +
      '      <code>__mcp_gas_run_success.html</code> (❌ missing)<br>\n' +
      '      <code>__mcp_gas_run_error.html</code> (❌ missing)\n' +
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
    doPostHandler
  };

  // Register with event system
  module.exports.__events__ = {
    doGet: 'doGetHandler',
    doPost: 'doPostHandler'
  };

  ///////// END USER CODE /////////
}

__defineModule__(_main, null, { loadNow: true });