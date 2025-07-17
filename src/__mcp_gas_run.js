/**
 * MCP Gas Run System - Dynamic JavaScript Execution for Google Apps Script
 * 
 * SECURITY: Designed for HEAD deployments, allows redirect handling (/dev → /exec)
 * USAGE: Send JavaScript code via GET params or POST body for execution
 * VERSION: 1.3.3 - Enhanced automatic logger output capture
 * 
 * Examples:
 * GET:  ?func=Math.max(10,20,30)
 * POST: {"func": "new Date().getTime()"}
 * POST: const x = 5; const y = 10; x * y;
 */

/**
 * GET endpoint - executes JavaScript from URL parameters
 */
function doGet(e) {
  try {
    validateDevMode();
    const js_statement = extractGetParams(e.parameter);
    if (!js_statement) {
      throw new Error('No JavaScript code provided. Use ?func=yourCode');
    }
    return __gas_run(js_statement);
  } catch (error) {
    // Capture logger output even on setup errors
    const loggerOutput = Logger.getLog();
    return errorResponse(error, 'doGet', 'unknown', loggerOutput);
  }
}

/**
 * POST endpoint - executes JavaScript from POST body
 */
function doPost(e) {
  try {
    validateDevMode();
    const js_statement = extractPostData(e.postData?.contents);
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