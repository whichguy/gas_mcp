/**
 * MCP Gas Run System - Dynamic JavaScript Execution for Google Apps Script
 * 
 * SECURITY: Designed for HEAD deployments, allows redirect handling (/dev → /exec)
 * USAGE: Send JavaScript code via GET params or POST body for execution
 * VERSION: 1.3.1
 * 
 * Examples:
 * GET:  ?func=Math.max(10,20,30)
 * POST: {"func": "new Date().getTime()"}
 * POST: const x = 5; const y = 10; x * y;
 */

/**
 * GET endpoint - executes JavaScript from URL parameters
 * 
 * @param {Object} e - Event object from Google Apps Script
 * @param {Object} e.parameter - URL parameters
 * @returns {TextOutput} JSON response with execution result or error
 * 
 * @example
 * ?func=Math.max(10,20,30)
 * ?func=new Date().getTime()
 * ?func=Session.getActiveUser().getEmail()
 * ?func=JSON.stringify({hello: "world"})
 * ?func=nonExistentFunction()  // Will throw exception
 * 
 * Success Response:
 *   {"function_called":"Math.max(10,20,30)","result":30,"success":true,"execution_time_ms":1.234}
 * 
 * Error Response:
 *   {"error":true,"context":"execution","function_called":"badCode()","message":"ReferenceError: badCode is not defined"}
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
    return errorResponse(error, 'doGet');
  }
}

/**
 * POST endpoint - executes JavaScript from POST body
 * 
 * @param {Object} e - Event object from Google Apps Script
 * @param {Object} e.postData - POST data object
 * @param {string} e.postData.contents - Raw POST body content
 * @returns {TextOutput} JSON response with execution result or error
 * 
 * @example
 * JSON Examples:
 *   {"func": "Math.PI * 2"}                           → result: 6.283185307179586
 *   {"func": "new Date().toISOString()"}              → result: "2025-06-15T10:30:45.123Z"
 *   {"func": "DriveApp.getRootFolder().getName()"}    → result: "My Drive"
 * 
 * Raw JavaScript Examples (returns result of last expression):
 *   const x = 5; const y = 10; x * y;                 → result: 50
 *   function greet(name) { return `Hello ${name}!`; } greet("World");  → result: "Hello World!"
 *   (() => { const arr = [1,2,3]; return arr.reduce((a,b) => a+b); })()  → result: 6
 *   (() => { throw new Error("Custom error"); })()   → Will throw exception
 * 
 * Success Response:
 *   {"function_called":"const x = 5; x * 2","result":10,"success":true,"execution_time_ms":0.891}
 * 
 * Error Response:
 *   {"error":true,"context":"execution","function_called":"badCode","message":"Error: Custom error"}
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
    return errorResponse(error, 'doPost');
  }
}

/**
 * Security check - validates execution context
 * 
 * Only allows /dev URLs (HEAD deployments) for dynamic execution
 * Fetch logic will handle any redirects automatically
 * 
 * @throws {Error} If not a /dev URL (HEAD deployment)
 * 
 * @example
 * // HEAD deployment (allowed):     https://script.google.com/macros/s/ABC123/dev
 * // Domain-specific (allowed):     https://script.google.com/a/macros/domain.com/s/ABC123/dev
 * // Versioned deployment (blocked): https://script.google.com/macros/s/ABC123/exec
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
 * 
 * @param {Object} params - URL parameters object
 * @param {string} [params.func] - JavaScript code to execute
 * @returns {string} JavaScript code or empty string if not found
 * 
 * @example
 * extractGetParams({func: "Math.max(1,2,3)"}) // returns "Math.max(1,2,3)"
 * extractGetParams({other: "value"}) // returns ""
 */
function extractGetParams(params = {}) {
  return params.func || '';
}

/**
 * Extract JavaScript code from POST data (JSON or raw)
 * 
 * @param {string} postData - Raw POST body content
 * @returns {string} JavaScript code or empty string if not found
 * 
 * @example
 * // JSON format
 * extractPostData('{"func": "Math.PI"}') // returns "Math.PI"
 * 
 * // Raw JavaScript - returns result of last expression
 * extractPostData('const x = 5; x * 2;') // returns "const x = 5; x * 2;" → evaluates to 10
 * extractPostData('function add(a,b) { return a+b; } add(3,4);') // returns the code → evaluates to 7
 * 
 * // Empty/invalid
 * extractPostData('') // returns ""
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
 * @param {string} code - The JavaScript code snippet.
 * @returns {Function} A new function that executes the code.
 */
function createFunction(code) {
  const trimmedCode = code.trim();
  if (trimmedCode === '') return new Function('');

  // Regex to test for a standalone 'return' keyword at the start.
  const isReturnStatement = /^return($|[s;])/.test(trimmedCode);
  
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

  const finalPartIsReturn = /^return($|[s;])/.test(finalPart);

  const functionBody = (finalPart === '' || finalPartIsReturn)
    ? trimmedCode
    : `${declarations} return ${finalPart}`;

  return new Function(functionBody);
}

/**
 * Core execution engine - runs JavaScript code dynamically
 * PERFORMANCE OPTIMIZED for repeated calls and simple expressions
 * 
 * @param {string} js_statement - JavaScript code to execute
 * @returns {TextOutput} JSON response with result and execution time
 */
function __gas_run(js_statement) {
  const startTime = Date.now();
  
  // 🚀 PERFORMANCE OPTIMIZATION: Skip logging for simple expressions
  const isSimpleExpression = /^[a-zA-Z0-9_.$s*/()+-]+$/.test(js_statement) && 
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
    if (isSimpleExpression && /^[ds*/.()+-]+$/.test(js_statement)) {
      const result = eval(js_statement);
      const duration = Date.now() - startTime;
      
      return jsonResponse({
        function_called: js_statement,
        result: result,
        success: true,
        execution_time_ms: duration,
        execution_type: 'fast_eval'
      });
    }
    
    // Standard function construction for complex expressions
    const fn = createFunction(js_statement);
    const result = fn();
    const duration = Date.now() - startTime;
    
    return jsonResponse({
      function_called: js_statement,
      result: result,
      success: true,
      execution_time_ms: duration,
      execution_type: 'function_constructor'
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[GAS_RUN ERROR] ${js_statement}: ${error.toString()}`);
    return errorResponse(error, 'execution', js_statement);
  }
}

/**
 * Standardized JSON response helper
 * 
 * @param {Object} data - Data object to serialize as JSON
 * @returns {TextOutput} Google Apps Script TextOutput with JSON MIME type
 * 
 * @example
 * jsonResponse({success: true, result: 42})
 * // Returns TextOutput with: {"success":true,"result":42}
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Standardized error response
 * 
 * @param {Error} error - Error object to format
 * @param {string} context - Context where error occurred (e.g., 'doGet', 'execution')
 * @param {string} [code='unknown'] - JavaScript code that caused the error
 * @returns {TextOutput} JSON error response
 * 
 * @example
 * errorResponse(new Error("Test error"), "execution", "badCode()")
 * // Returns: {"error":true,"context":"execution","function_called":"badCode()","message":"Error: Test error"}
 */
function errorResponse(error, context, code = 'unknown') {
  console.error(`Error in ${context}:`, error.toString());
  
  const currentUrl = ScriptApp.getService().getUrl();
  
  return jsonResponse({
    error: true,
    context: context,
    function_called: code,
    message: error.toString(),
    accessed_url: currentUrl,
    url_type: currentUrl.endsWith('/dev') ? 'HEAD deployment (testing)' : currentUrl.endsWith('/exec') ? 'Deployment (may be redirected from /dev)' : 'Unknown deployment type',
    debug_info: {
      timestamp: new Date().toISOString(),
      deployment_mode: currentUrl.endsWith('/dev') ? 'development' : currentUrl.endsWith('/exec') ? 'redirected' : 'unknown'
    }
  });
}
