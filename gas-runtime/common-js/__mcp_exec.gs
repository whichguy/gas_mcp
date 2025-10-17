function _main(module, exports, require) {
  /**
   * Centralized execution system for MCP Gas Server
   * Handles both HTTP endpoints (doGet/doPost) and direct function calls (exec_api)
   */

  /**
   * Creates a function from a JavaScript statement string
   * @param {string} js_statement - JavaScript code to execute
   * @returns {Function} Executable function
   */
  function createFunction(js_statement) {
    try {
      return new Function('return (' + js_statement + ')');
    } catch (e) {
      Logger.log('[ERROR] Failed to create function from: ' + js_statement);
      Logger.log('[ERROR] ' + e.toString());
      throw new Error('Invalid JavaScript statement: ' + e.message);
    }
  }

  /**
   * Executes JavaScript statement and returns result
   * Used by both doGet/doPost (returns ContentService) and exec_api (returns raw value)
   * @param {string} js_statement - JavaScript code to execute
   * @param {boolean} rawResult - If true, returns raw value; if false, returns ContentService
   * @returns {Object|ContentService.TextOutput} Result or ContentService response
   */
  function executeStatement(js_statement, rawResult) {
    // TODO: Add validation for js_statement parameter:
    // - Check if js_statement is a non-empty string
    // - Provide helpful error message if invalid
    // - Prevents cryptic errors from undefined/null statements

    var result;
    var error = null;
    var logOutput = [];

    // Capture Logger output
    var originalLog = Logger.log;
    Logger.log = function(msg) {
      logOutput.push(msg);
      originalLog.call(Logger, msg);
    };

    try {
      Logger.log('[EXEC] Executing: ' + js_statement);
      var fn = createFunction(js_statement);
      result = fn();
      Logger.log('[EXEC] Result type: ' + typeof result);
      Logger.log('[EXEC] Success');
    } catch (e) {
      error = {
        message: e.message,
        stack: e.stack,
        type: e.name
      };
      Logger.log('[ERROR] Execution failed: ' + e.toString());
      Logger.log('[ERROR] Stack: ' + e.stack);
    } finally {
      // Restore Logger
      Logger.log = originalLog;
    }

    if (rawResult) {
      // Return raw value for google.script.run
      if (error) {
        throw new Error(error.message);
      }
      return result;
    } else {
      // Return ContentService response for HTTP endpoints
      var response = {
        status: error ? 'error' : 'success',
        result: error ? null : result,
        error: error,
        logger_output: logOutput.join('\n'),
        js_statement: js_statement,
        executedAt: new Date().toISOString()
      };

      return ContentService.createTextOutput(JSON.stringify(response))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  /**
   * HTTP GET endpoint handler
   * Returns execution results as JSON via ContentService
   */
  function doGet(e) {
    try {
      Logger.log('[doGet] Received request');

      if (!e || !e.parameter) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          error: { message: 'No parameters provided' }
        })).setMimeType(ContentService.MimeType.JSON);
      }

      var js_statement = e.parameter.js_statement;

      if (!js_statement) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          error: { message: 'Missing js_statement parameter' }
        })).setMimeType(ContentService.MimeType.JSON);
      }

      Logger.log('[doGet] Statement: ' + js_statement);
      return executeStatement(js_statement, false);

    } catch (e) {
      Logger.log('[ERROR] doGet failed: ' + e.toString());
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        error: {
          message: e.message,
          stack: e.stack
        }
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  /**
   * HTTP POST endpoint handler
   * Returns execution results as JSON via ContentService
   */
  function doPost(e) {
    try {
      Logger.log('[doPost] Received request');

      if (!e || !e.postData) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          error: { message: 'No post data provided' }
        })).setMimeType(ContentService.MimeType.JSON);
      }

      var data = JSON.parse(e.postData.contents);
      var js_statement = data.js_statement;

      if (!js_statement) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          error: { message: 'Missing js_statement in request body' }
        })).setMimeType(ContentService.MimeType.JSON);
      }

      Logger.log('[doPost] Statement: ' + js_statement);
      return executeStatement(js_statement, false);

    } catch (e) {
      Logger.log('[ERROR] doPost failed: ' + e.toString());
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        error: {
          message: e.message,
          stack: e.stack
        }
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  /**
   * Legacy function for backward compatibility
   * Returns ContentService response
   */
  function __gas_run(js_statement) {
    Logger.log('[__gas_run] Called (legacy compatibility)');
    return executeStatement(js_statement, false);
  }

  /**
   * Health check endpoint
   */
  function healthCheck() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      commonjs: typeof require !== 'undefined'
    };
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

    // Direct execution without ContentService wrapping
    // Returns plain JavaScript value for google.script.run
    var fn = createFunction(js_statement);
    return fn();
  }

  // Export functions
  exports.doGet = doGet;
  exports.doPost = doPost;
  exports.__gas_run = __gas_run;
  exports.healthCheck = healthCheck;
  exports.exec_api = exec_api;

  // Register event handlers for automatic execution
  exports.__events__ = {
    doGet: 'doGet',
    doPost: 'doPost'
  };

  // Make functions globally accessible via google.script.run
  exports.__global__ = {
    exec_api: exec_api,
    __gas_run: __gas_run
  };
}

__defineModule__(_main, 'common-js/__mcp_exec', { loadNow: true });
