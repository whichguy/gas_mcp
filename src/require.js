/**
 * Google Apps Script CommonJS Module System (require.js)
 *
 * This file provides a CommonJS-like module system for Google Apps Script,
 * enabling the use of require() to import modules and manage dependencies.
 *
 * Key Features:
 * - Module registration and LAZY LOADING
 * - Circular dependency detection and handling
 * - Filename-based module naming for consistent require() calls
 * - Support for both explicit and automatic module naming
 * - GLOBAL EXPORTS for custom functions
 * - EVENT HANDLER SYSTEM for GAS triggers
 * - Global require() function (no parameter needed in _main)
 *
 * Usage:
 * 1. Each module should define a _main function with the signature:
 *    function _main(module, exports, log) { ... }
 *    Note: log is automatically provided - either Logger.log or no-op based on config
 *
 * 2. At the end of each module file, call: __defineModule__(_main);
 * 3. Use require('FileName') to import modules by their filename
 *
 * CRITICAL: The _main function is called ONLY when the module is first required,
 * not when __defineModule__ is called. This enables lazy loading and proper
 * dependency resolution.
 *
 * IMPORTANT: The explicit module name parameter in __defineModule__ is RESERVED
 * for the CommonJS system module only. All user modules MUST use auto-detection
 * by calling __defineModule__(_main) without an explicit name parameter.
 *
 * Example (NEW 3-parameter signature with log):
 * ```javascript
 * function _main(module, exports, log) {
 *   // log is automatically provided - either Logger.log or no-op
 *   log('[INIT] Module initializing...');
 *   
 *   const helper = require('Helper');
 *
 *   function myFunction() {
 *     log('[CALL] myFunction called');
 *     return "Hello from module";
 *   }
 *   
 *   log('[READY] Module ready');
 *   return { myFunction };
 * }
 *
 * __defineModule__(_main);
 * ```
 *
 * BACKWARD COMPATIBILITY:
 * Old 2-parameter signature still works:
 * ```javascript
 * function _main(module, exports) { ... }
 * ```
 *
 * GLOBAL EXPORTS FEATURE (__global__ property):
 *
 * Modules can expose functions to the global namespace for use in Google Sheets formulas
 * by setting the __global__ property on module.exports:
 *
 * Example:
 * ```javascript
 * function _main(module, exports, log) {
 *   function MY_CUSTOM_FUNCTION(arg1, arg2) {
 *     log('[CUSTOM] Function called with:', arg1, arg2);
 *     const helper = require('Helper');
 *     return helper.process(arg1, arg2);
 *   }
 *
 *   module.exports = {
 *     MY_CUSTOM_FUNCTION: MY_CUSTOM_FUNCTION
 *   };
 *
 *   // Expose to global namespace for use in Sheets formulas
 *   // NOTE: __global__ must be an OBJECT (key-value), not an array
 *   module.exports.__global__ = { MY_CUSTOM_FUNCTION: MY_CUSTOM_FUNCTION };
 * }
 * __defineModule__(_main);
 * ```
 *
 * This makes MY_CUSTOM_FUNCTION available as =MY_CUSTOM_FUNCTION() in spreadsheet cells
 * while maintaining all CommonJS module benefits for internal organization.
 *
 * EVENT HANDLER SYSTEM (__events__ property):
 *
 * Modules can register event handlers using the __events__ property:
 *
 * Example:
 * ```javascript
 * function _main(module, exports, log) {
 *   function handleOpen(e) {
 *     log('[EVENT] onOpen triggered');
 *     const ui = SpreadsheetApp.getUi();
 *     ui.createMenu('My Menu').addItem('Action', 'doAction').addToUi();
 *   }
 *
 *   function handleGet(e) {
 *     log('[EVENT] doGet triggered');
 *     return ContentService.createTextOutput('Hello World');
 *   }
 *
 *   module.exports = {
 *     handleOpen: handleOpen,
 *     handleGet: handleGet
 *   };
 *
 *   // Register event handlers
 *   module.exports.__events__ = {
 *     onOpen: 'handleOpen',
 *     doGet: 'handleGet'
 *   };
 * }
 * __defineModule__(_main);
 * ```
 *
 * Supported events: onOpen, onEdit, onSelectionChange, onInstall, onFormSubmit, doGet, doPost
 *
 * Multiple modules can register for the same event - ALL handlers execute independently.
 * Errors in one handler do not prevent others from executing (robust error isolation).
 *
 * EVENT HANDLER CONVENTION (IMPORTANT):
 *
 * For doGet/doPost handlers that return responses, each handler should:
 * 1. Check if the event is relevant using metadata (params, headers, path)
 * 2. Return null/undefined if the request is not applicable to that handler
 * 3. Return a proper response ONLY if the handler processes the event
 *
 * This prevents:
 * - Request body reading conflicts (check params first, read body only if applicable)
 * - Response conflicts (first applicable handler wins)
 * - Unnecessary processing
 *
 * Example of convention-based doGet handler:
 * ```javascript
 * function doGetHandler(e) {
 *   // Check if this handler should process this request
 *   // Use params, headers, or path - don't read body yet
 *   if (!e.parameter?.myParam) {
 *     return null; // Not my request, skip to next handler
 *   }
 *
 *   // Only process if this handler is applicable
 *   try {
 *     const data = processMyRequest(e);
 *     return ContentService.createTextOutput(JSON.stringify(data))
 *       .setMimeType(ContentService.MimeType.JSON);
 *   } catch (error) {
 *     return ContentService.createTextOutput(
 *       JSON.stringify({ error: error.message })
 *     ).setMimeType(ContentService.MimeType.JSON);
 *   }
 * }
 * ```
 *
 * The dispatcher uses the first non-null response from handlers.
 */

// ========== DEBUG LOGGING (must be defined before global functions) ==========
const debugLog = (() => {
  try {
    // CRITICAL: Cannot use require() here as it creates circular dependency
    // debugLog is used by require() itself, so it must be available before any modules load
    // Default to disabled logging to prevent errors during initialization
    return () => {};
  } catch (e) {
    return () => {};
  }
})();

// ========== GLOBAL FUNCTIONS (before IIFE) ==========

/**
 * Global require() function - loads modules on demand
 * Accesses module registries via globalThis
 *
 * @param {string} moduleName - The name or path of the module to load
 * @returns {Object} The module exports
 */
function require(moduleName) {
  // Access registries exposed by IIFE
  const modules = globalThis.__modules__;
  const moduleFactories = globalThis.__moduleFactories__;
  const loadingModules = globalThis.__loadingModules__;

  // Normalize the module name
  function normalize(name) {
    // Remove leading './' or '../'
    name = name.replace(/^\.\/?/, '');
    name = name.replace(/^\.\.\/?/, '');
    // Remove trailing .js or .gs (GAS native extension)
    if (name.endsWith('.js')) name = name.slice(0, -3);
    if (name.endsWith('.gs')) name = name.slice(0, -3);
    return name;
  }

  const candidates = [];
  // 1. As given
  candidates.push(moduleName);
  // 2. Normalized (strip ./, ../, .js, .gs)
  const norm = normalize(moduleName);
  if (norm !== moduleName) candidates.push(norm);
  // 3. Add .js and .gs if not present (GAS files may register with either extension)
  if (!norm.endsWith('.js') && !norm.endsWith('.gs')) {
    candidates.push(`${norm}.gs`);  // Try .gs first (native GAS extension)
    candidates.push(`${norm}.js`);  // Fallback to .js
  }
  // 4. Remove directory if present (try just the basename)
  const base = norm.split('/').pop();
  if (base && base !== norm) {
    candidates.push(base);
    if (!base.endsWith('.js') && !base.endsWith('.gs')) {
      candidates.push(`${base}.gs`);
      candidates.push(`${base}.js`);
    }
  }

  // Try all candidates in order
  let found = null;
  for (const candidate of candidates) {
    if (modules[candidate]) return modules[candidate].exports;
    if (moduleFactories[candidate]) {
      found = candidate;
      break;
    }
  }

  if (!found) {
    throw new Error(`Module not found: ${moduleName}. Tried: ${candidates.join(', ')}. Available modules: ${Object.keys(moduleFactories).join(', ')}`);
  }

  // Detect circular dependencies
  if (loadingModules.has(found)) {
    throw new Error(`Circular dependency detected: ${found}`);
  }

  // Mark as loading
  loadingModules.add(found);
  try {
    // Create module object
    const module = { exports: {} };
    modules[found] = module;

    // Set current module for the factory
    const previousModule = globalThis.__currentModule;
    globalThis.__currentModule = module;
    debugLog(`[LOAD] Loading module: ${found}`);

    // Get per-module log function from ConfigManager
    // Note: This requires accessing the IIFE-scoped getModuleLogFunction
    // We'll expose it via globalThis for the global require() to access
    const moduleLog = globalThis.__getModuleLogFunction ? globalThis.__getModuleLogFunction(found) : (() => {});

    // Call factory with log parameter
    const factory = moduleFactories[found];
    let result;

    if (factory.length === 3) {
      // NEW STYLE: 3 parameters (module, exports, log)
      result = factory(module, module.exports, moduleLog);
    } else if (factory.length === 2) {
      // LEGACY: 2 parameters (module, exports)
      result = factory(module, module.exports);
    } else if (factory.length === 0) {
      // DEFAULT PARAMS: function.length === 0 when first params have defaults
      // Call with all 3 parameters, JavaScript will use passed args over defaults
      result = factory(module, module.exports, moduleLog);
    } else {
      // UNKNOWN: Call with all parameters for safety
      result = factory(module, module.exports, moduleLog);
    }

    // If factory returns something, use it as exports
    if (result !== undefined) {
      module.exports = result;
    }

    // Restore previous module
    globalThis.__currentModule = previousModule;
    debugLog(`[OK] Module loaded: ${found}`);

    // Process __global__ exports if present (key-value map)
    if (module.exports.__global__ && typeof module.exports.__global__ === 'object' && !Array.isArray(module.exports.__global__)) {
      debugLog(`[GLOBAL] Module ${found} declares global exports`);

      // Expose each key-value pair to global namespace
      Object.keys(module.exports.__global__).forEach(key => {
        const value = module.exports.__global__[key];
        globalThis[key] = value;
        debugLog(`  [OK] Exposed ${key} to global namespace (${typeof value})`);
      });
    }

    // Process __events__ if present
    if (module.exports.__events__ && typeof module.exports.__events__ === 'object') {
      debugLog(`[EVENTS] Module ${found} declares event handlers`);

      // Validate event handlers exist
      Object.keys(module.exports.__events__).forEach(eventName => {
        const handlerName = module.exports.__events__[eventName];
        const handlerFunction = module.exports[handlerName];

        if (typeof handlerFunction === 'function') {
          debugLog(`  [OK] Event handler ${eventName} → ${handlerName}`);
        } else {
          Logger.log(`  [WARN] Warning: ${handlerName} is not a function, ${eventName} handler will be skipped`);
        }
      });
    }

    return module.exports;
  } finally {
    // Remove from loading set
    loadingModules.delete(found);
  }
}

/**
 * Global __defineModule__() function - registers modules
 * Accesses module factories via globalThis
 *
 * @param {Function} moduleFactory - The _main function that creates the module
 * @param {boolean} [loadNow=false] - If true, immediately execute module via require()
 * @param {Object} [options] - Optional configuration
 * @param {string} [options.explicitName] - Explicit module name (RESERVED for CommonJS system module only)
 */
function __defineModule__(moduleFactory, loadNow, options) {
  // Access registries exposed by IIFE
  const moduleFactories = globalThis.__moduleFactories__;

  // Parse parameters
  // Support both new format __defineModule__(_main, true) and old format __defineModule__(_main, null, { loadNow: true })
  const opts = typeof options === 'object' && options !== null ? options : {};
  const shouldLoadNow = typeof loadNow === 'boolean' ? loadNow : (typeof opts.loadNow === 'boolean' ? opts.loadNow : false);

  // Get module name: explicit from options or auto-detect
  const explicitName = opts.explicitName;
  debugLog(`[DEFINE] __defineModule__ called with loadNow: ${shouldLoadNow}, explicitName: ${explicitName || 'auto-detect'}`);

  const moduleName = explicitName || globalThis.__detectModuleName__();

  debugLog(`   Resolved module name: ${moduleName}`);

  if (moduleFactories[moduleName]) {
    console.warn(`Module ${moduleName} already registered, skipping duplicate registration`);
    return;
  }

  // ALWAYS store the factory for lazy loading via require()
  moduleFactories[moduleName] = moduleFactory;
  debugLog(`   Factory stored for: ${moduleName}`);

  // Modules with __global__ exports MUST explicitly use loadNow=true parameter
  // No auto-detection performed - this prevents cache pollution during temporary factory execution

  // If loadNow=true, immediately execute module via require()
  if (shouldLoadNow) {
    try {
      require(moduleName);
      return; // Module is now cached and processed by require()
    } catch (error) {
      throw error; // Re-throw to prevent silent failures
    }
  }

  // Module registered without execution - will execute on first require()
}

// ========== IIFE FOR INTERNAL INFRASTRUCTURE ==========

(function() {
  'use strict';

  // ===== MODULE LOGGING =====
  // Direct synchronous logging (no queue - Logger.log is already buffered by GAS)

  /**
   * Get log function for a specific module based on ConfigManager settings
   * Uses inclusion/exclusion logic with folder patterns support
   * @param {string} moduleName - The name of the module
   * @returns {Function} Logger.log or no-op function
   */
  function getModuleLogFunction(moduleName) {
    try {
      const ConfigManagerClass = require('common-js/ConfigManager');
      const config = new ConfigManagerClass('COMMONJS');
      const loggingMapJson = config.get('__Logging', '{}');
      const loggingMap = JSON.parse(loggingMapJson);

      let isIncluded = false;
      let isExcluded = false;

      // Check 1: Exact module name
      if (loggingMap[moduleName] === true) isIncluded = true;
      if (loggingMap[moduleName] === false) isExcluded = true;

      // Check 2: Folder patterns (e.g., 'auth/*')
      for (const key in loggingMap) {
        if (key.endsWith('/*')) {
          const folder = key.slice(0, -2); // Remove /*
          if (moduleName.startsWith(folder + '/')) {
            if (loggingMap[key] === true) isIncluded = true;
            if (loggingMap[key] === false) isExcluded = true;
          }
        }
      }

      // Check 3: Wildcard
      if (loggingMap['*'] === true) isIncluded = true;
      if (loggingMap['*'] === false) isExcluded = true;

      // Exclusion takes precedence over inclusion
      if (isExcluded) return () => {};

      if (isIncluded) {
        // Direct synchronous logging
        return (...args) => {
          try {
            Logger.log(...args);
          } catch (e) {
            // Silent fail - don't break on logging errors
          }
        };
      }

      // Default: disabled
      return () => {};
    } catch (e) {
      // If ConfigManager fails, return no-op
      return () => {};
    }
  }

  // Module storage - exposed via globalThis for require() and __defineModule__
  const modules = {};
  const moduleFactories = {};
  const loadingModules = new Set();

  // EXPOSE registries for global require() and __defineModule__
  globalThis.__modules__ = modules;
  globalThis.__moduleFactories__ = moduleFactories;
  globalThis.__loadingModules__ = loadingModules;

  // ========== GLOBAL EVENT DISPATCHERS ==========
  // These functions are called by Google Apps Script when events occur
  // They walk all loaded modules looking for __events__ property and dispatch accordingly

  /**
   * Helper: Find all modules with handlers for a specific event
   * @param {string} eventName - Event name (doGet, doPost, onOpen, etc.)
   * @returns {Array} Array of {moduleName, handlerFunction} objects
   */
  function __findEventHandlers__(eventName) {
    const handlers = [];

    debugLog(`[SEARCH] Searching for ${eventName} handlers...`);
    debugLog(`   Loaded modules: ${Object.keys(modules).join(', ')}`);

    Object.keys(modules).forEach(moduleName => {
      const module = modules[moduleName];
      debugLog(`   Checking module: ${moduleName}`);

      if (module.exports) {
        debugLog(`     - has exports: ✓`);

        if (module.exports.__events__) {
          debugLog(`     - has __events__: ✓`);
          debugLog(`     - events: ${JSON.stringify(Object.keys(module.exports.__events__))}`);

          if (module.exports.__events__[eventName]) {
            const handlerName = module.exports.__events__[eventName];
            debugLog(`     - has ${eventName} handler: ${handlerName}`);

            const handlerFunction = module.exports[handlerName];

            if (typeof handlerFunction === 'function') {
              debugLog(`     - handler is function: ✓`);
              handlers.push({
                module: moduleName,
                handler: handlerFunction
              });
            } else {
              debugLog(`     - handler is NOT function: ${typeof handlerFunction}`);
            }
          } else {
            debugLog(`     - no ${eventName} handler in __events__`);
          }
        } else {
          debugLog(`     - no __events__ property`);
        }
      } else {
        debugLog(`     - no exports`);
      }
    });

    debugLog(`   Found ${handlers.length} handler(s) for ${eventName}`);
    return handlers;
  }

  /**
   * doGet dispatcher - Web app GET requests
   * Returns last non-null response from handlers
   */
  globalThis.__doGet_dispatcher = function(e) {
    const handlers = __findEventHandlers__('doGet');

    if (handlers.length === 0) {
      debugLog('[WARN] No doGet handlers found in loaded modules');
      return ContentService.createTextOutput('No doGet handlers registered')
        .setMimeType(ContentService.MimeType.TEXT);
    }

    debugLog(`[DISPATCH] Dispatching doGet to ${handlers.length} handler(s)`);

    let lastResponse = null;
    let successCount = 0;
    let errorCount = 0;

    handlers.forEach(function(handlerInfo) {
      try {
        debugLog(`  → Calling ${handlerInfo.module}.doGet`);
        const response = handlerInfo.handler(e);
        if (response) {
          lastResponse = response;
          successCount++;
        }
      } catch (error) {
        errorCount++;
        debugLog(`  [ERROR] Error in ${handlerInfo.module}.doGet: ${error.message}`);
        debugLog(`     Stack: ${error.stack}`);
      }
    });

    debugLog(`[OK] doGet dispatch complete: ${successCount} succeeded, ${errorCount} failed`);

    if (errorCount > 0 && successCount === 0 && !lastResponse) {
      debugLog('[ERROR] All doGet handlers failed, returning error response');
      return ContentService.createTextOutput(
        JSON.stringify({
          error: true,
          message: 'All doGet handlers failed',
          totalHandlers: handlers.length,
          failedCount: errorCount
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    return lastResponse;
  };

  /**
   * doPost dispatcher - Web app POST requests
   * Returns last non-null response from handlers
   */
  globalThis.__doPost_dispatcher = function(e) {
    const handlers = __findEventHandlers__('doPost');

    if (handlers.length === 0) {
      debugLog('[WARN] No doPost handlers found in loaded modules');
      return ContentService.createTextOutput('No doPost handlers registered')
        .setMimeType(ContentService.MimeType.TEXT);
    }

    debugLog(`[DISPATCH] Dispatching doPost to ${handlers.length} handler(s)`);

    let lastResponse = null;
    let successCount = 0;
    let errorCount = 0;

    handlers.forEach(function(handlerInfo) {
      try {
        debugLog(`  → Calling ${handlerInfo.module}.doPost`);
        const response = handlerInfo.handler(e);
        if (response) {
          lastResponse = response;
          successCount++;
        }
      } catch (error) {
        errorCount++;
        debugLog(`  [ERROR] Error in ${handlerInfo.module}.doPost: ${error.message}`);
        debugLog(`     Stack: ${error.stack}`);
      }
    });

    debugLog(`[OK] doPost dispatch complete: ${successCount} succeeded, ${errorCount} failed`);

    if (errorCount > 0 && successCount === 0 && !lastResponse) {
      debugLog('[ERROR] All doPost handlers failed, returning error response');
      return ContentService.createTextOutput(
        JSON.stringify({
          error: true,
          message: 'All doPost handlers failed',
          totalHandlers: handlers.length,
          failedCount: errorCount
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    return lastResponse;
  };

  /**
   * onOpen dispatcher - Spreadsheet open trigger
   * Executes all handlers, never throws exceptions
   */
  globalThis.__onOpen_dispatcher = function(e) {
    const handlers = __findEventHandlers__('onOpen');

    if (handlers.length === 0) {
      debugLog('[WARN] No onOpen handlers found in loaded modules');
      return;
    }

    debugLog(`[DISPATCH] Dispatching onOpen to ${handlers.length} handler(s)`);

    let successCount = 0;
    let errorCount = 0;

    handlers.forEach(function(handlerInfo) {
      try {
        debugLog(`  → Calling ${handlerInfo.module}.onOpen`);
        handlerInfo.handler(e);
        successCount++;
      } catch (error) {
        errorCount++;
        debugLog(`  [ERROR] Error in ${handlerInfo.module}.onOpen: ${error.message}`);
        debugLog(`     Stack: ${error.stack}`);
      }
    });

    debugLog(`[OK] onOpen dispatch complete: ${successCount} succeeded, ${errorCount} failed`);
  };

  /**
   * onEdit dispatcher - Edit trigger
   * Executes all handlers, never throws exceptions
   */
  globalThis.__onEdit_dispatcher = function(e) {
    const handlers = __findEventHandlers__('onEdit');

    if (handlers.length === 0) {
      debugLog('[WARN] No onEdit handlers found in loaded modules');
      return;
    }

    debugLog(`[DISPATCH] Dispatching onEdit to ${handlers.length} handler(s)`);

    let successCount = 0;
    let errorCount = 0;

    handlers.forEach(function(handlerInfo) {
      try {
        debugLog(`  → Calling ${handlerInfo.module}.onEdit`);
        handlerInfo.handler(e);
        successCount++;
      } catch (error) {
        errorCount++;
        debugLog(`  [ERROR] Error in ${handlerInfo.module}.onEdit: ${error.message}`);
        debugLog(`     Stack: ${error.stack}`);
      }
    });

    debugLog(`[OK] onEdit dispatch complete: ${successCount} succeeded, ${errorCount} failed`);
  };

  /**
   * onSelectionChange dispatcher - Selection change trigger
   * Executes all handlers, never throws exceptions
   */
  globalThis.__onSelectionChange_dispatcher = function(e) {
    const handlers = __findEventHandlers__('onSelectionChange');

    if (handlers.length === 0) {
      return; // Silent - this event fires frequently
    }

    debugLog(`[DISPATCH] Dispatching onSelectionChange to ${handlers.length} handler(s)`);

    let successCount = 0;
    let errorCount = 0;

    handlers.forEach(function(handlerInfo) {
      try {
        handlerInfo.handler(e);
        successCount++;
      } catch (error) {
        errorCount++;
        debugLog(`  [ERROR] Error in ${handlerInfo.module}.onSelectionChange: ${error.message}`);
      }
    });

    debugLog(`[OK] onSelectionChange dispatch complete: ${successCount} succeeded, ${errorCount} failed`);
  };

  /**
   * onInstall dispatcher - Add-on install trigger
   * Executes all handlers, never throws exceptions
   */
  globalThis.__onInstall_dispatcher = function(e) {
    const handlers = __findEventHandlers__('onInstall');

    if (handlers.length === 0) {
      debugLog('[WARN] No onInstall handlers found in loaded modules');
      return;
    }

    debugLog(`[DISPATCH] Dispatching onInstall to ${handlers.length} handler(s)`);

    let successCount = 0;
    let errorCount = 0;

    handlers.forEach(function(handlerInfo) {
      try {
        debugLog(`  → Calling ${handlerInfo.module}.onInstall`);
        handlerInfo.handler(e);
        successCount++;
      } catch (error) {
        errorCount++;
        debugLog(`  [ERROR] Error in ${handlerInfo.module}.onInstall: ${error.message}`);
        debugLog(`     Stack: ${error.stack}`);
      }
    });

    debugLog(`[OK] onInstall dispatch complete: ${successCount} succeeded, ${errorCount} failed`);
  };

  /**
   * onFormSubmit dispatcher - Form submit trigger
   * Executes all handlers, never throws exceptions
   */
  globalThis.__onFormSubmit_dispatcher = function(e) {
    const handlers = __findEventHandlers__('onFormSubmit');

    if (handlers.length === 0) {
      debugLog('[WARN] No onFormSubmit handlers found in loaded modules');
      return;
    }

    debugLog(`[DISPATCH] Dispatching onFormSubmit to ${handlers.length} handler(s)`);

    let successCount = 0;
    let errorCount = 0;

    handlers.forEach(function(handlerInfo) {
      try {
        debugLog(`  → Calling ${handlerInfo.module}.onFormSubmit`);
        handlerInfo.handler(e);
        successCount++;
      } catch (error) {
        errorCount++;
        debugLog(`  [ERROR] Error in ${handlerInfo.module}.onFormSubmit: ${error.message}`);
        debugLog(`     Stack: ${error.stack}`);
      }
    });

    debugLog(`[OK] onFormSubmit dispatch complete: ${successCount} succeeded, ${errorCount} failed`);
  };

  /**
   * Detects the module name from the current stack trace
   * Enhanced to work with Google Apps Script's stack trace format and preserve directory structure
   * @returns {string} The detected module name with full path (e.g., "ai_tools/BaseConnector")
   * @throws {Error} If unable to detect module name from stack trace
   */
  function __detectModuleName__() {
    try {
      throw new Error();
    } catch (e) {
      const stack = e.stack;
      const lines = stack.split('\n');

      // Reduced debug logging for better performance
      debugLog('[DETECT] Detecting module name...');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!line || line.includes('__detectModuleName__') || line.includes('__defineModule__')) {
          continue;
        }

        // ENHANCED: Pattern for Google Apps Script virtual paths: "at path/filename:line:column"
        // This preserves the full directory structure (e.g., "ai_tools/BaseConnector")
        let match = line.match(/at\s+([^/\s:]+\/)?([^/\s:]+(?:\/[^/\s:]+)*):\d+:\d+/);
        if (match) {
          // If we have a path prefix, combine it with the filename part
          const pathPrefix = match[1] ? match[1].replace(/\/$/, '') : ''; // Remove trailing slash
          const filePart = match[2];
          const fullPath = pathPrefix ? `${pathPrefix}/${filePart}` : filePart;

          if (fullPath &&
              fullPath !== 'eval' &&
              fullPath !== 'anonymous' &&
              (fullPath === '__mcp_exec' || !fullPath.startsWith('__')) &&
              fullPath !== 'common-js/require') {
            debugLog(`[OK] Module detected: "${fullPath}"`);
            return fullPath;
          }
        }

        // Alternative pattern: "at full/path/filename:line:column" (single capture group)
        match = line.match(/at\s+([^/\s:]+(?:\/[^/\s:]+)+):\d+:\d+/);
        if (match) {
          const fullPath = match[1];
          if (fullPath &&
              fullPath !== 'eval' &&
              fullPath !== 'anonymous' &&
              (fullPath === '__mcp_exec' || !fullPath.startsWith('__')) &&
              fullPath !== 'common-js/require') {
            debugLog(`[OK] Module detected: "${fullPath}"`);
            return fullPath;
          }
        }

        // Try pattern: (FileName:line:column) - for simple files without directories
        match = line.match(/\(([^/:()]+):\d+:\d+\)/);
        if (match) {
          const fileName = match[1];
          if (fileName &&
              fileName !== 'eval' &&
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'common-js/require') {
            debugLog(`[OK] Module detected: "${fileName}"`);
            return fileName;
          }
        }

        // Try pattern: at functionName (FileName:line:column) - for simple files
        match = line.match(/at\s+[^(]*\(([^/:()]+):\d+:\d+\)/);
        if (match) {
          const fileName = match[1];
          if (fileName &&
              fileName !== 'eval' &&
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'common-js/require') {
            debugLog(`[OK] Module detected: "${fileName}"`);
            return fileName;
          }
        }

        // Try pattern: FileName.gs:line - for simple files
        match = line.match(/([^/\s]+)\.gs:\d+/);
        if (match) {
          const fileName = match[1];
          if (fileName &&
              fileName !== 'eval' &&
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'common-js/require') {
            debugLog(`[OK] Module detected: "${fileName}"`);
            return fileName;
          }
        }

        // Try pattern: at FileName.functionName - for simple files
        match = line.match(/at\s+([^.\s]+)\./);
        if (match) {
          const fileName = match[1];
          if (fileName &&
              fileName !== 'eval' &&
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'common-js/require') {
            debugLog(`[OK] Module detected: "${fileName}"`);
            return fileName;
          }
        }

        // Try pattern: at FileName:line:column (Google Apps Script format) - for simple files
        match = line.match(/at\s+([^/\s:]+):\d+:\d+/);
        if (match) {
          const fileName = match[1];
          if (fileName &&
              fileName !== 'eval' &&
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'common-js/require') {
            debugLog(`[OK] Module detected: "${fileName}"`);
            return fileName;
          }
        }

        // Try pattern: FileName:line:column (without "at" prefix) - for simple files
        match = line.match(/^\s*([^/\s:()]+):\d+:\d+/);
        if (match) {
          const fileName = match[1];
          if (fileName &&
              fileName !== 'eval' &&
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'common-js/require') {
            debugLog(`[OK] Module detected: "${fileName}"`);
            return fileName;
          }
        }
      }

      debugLog('[WARN] Module name detection failed');

      // If no filename found, throw an exception with detailed debug info
      const debugInfo = {
        stackTrace: stack,
        lines: lines,
        processedLines: lines.map((line, i) => ({
          index: i,
          content: line.trim(),
          skipped: !line.trim() || line.includes('__detectModuleName__') || line.includes('__defineModule__')
        }))
      };

      throw new Error('Unable to detect module name from stack trace. Debug info: ' + JSON.stringify(debugInfo, null, 2));
    }
  }

  /**
   * Creates a new module object
   * @param {string} moduleName - The name of the module
   * @returns {Object} A new module object with exports property
   */
  function __createModule__(moduleName) {
    if (!modules[moduleName]) {
      modules[moduleName] = { exports: {} };
    }
    return modules[moduleName];
  }

  /**
   * Gets the current module object (for use in _main functions)
   * Enhanced to preserve directory structure
   * @returns {Object} - The current module object
   */
  function __getCurrentModule__() {
    try {
      throw new Error();
    } catch (e) {
      const stack = e.stack;
      const lines = stack.split('\n');

      // Look for the calling module in the stack trace
      for (const line of lines) {
        // Enhanced pattern to handle virtual paths like "ai_chat/client_example"
        // Try to capture full directory structure first
        let match = line.match(/at\s+([^/\s:]+(?:\/[^/\s:]+)+):\d+:\d+/);
        if (match) {
          const fullPath = match[1];
          if (fullPath &&
              fullPath !== 'eval' &&
              fullPath !== 'anonymous' &&
              (fullPath === '__mcp_exec' || !fullPath.startsWith('__')) &&
              fullPath !== 'common-js/require') {
            return modules[fullPath] || __createModule__(fullPath);
          }
        }

        // Alternative pattern with optional path prefix and filename part
        match = line.match(/at\s+([^/\s:]+\/)?([^/\s:]+(?:\/[^/\s:]+)*):\d+:\d+/);
        if (match) {
          const pathPrefix = match[1] ? match[1].replace(/\/$/, '') : '';
          const filePart = match[2];
          const fullPath = pathPrefix ? `${pathPrefix}/${filePart}` : filePart;

          if (fullPath &&
              fullPath !== 'eval' &&
              fullPath !== 'anonymous' &&
              (fullPath === '__mcp_exec' || !fullPath.startsWith('__')) &&
              fullPath !== 'common-js/require') {
            return modules[fullPath] || __createModule__(fullPath);
          }
        }

        // Fallback to original pattern for simple files without directories
        match = line.match(/at\s+([^/\s:()]+):\d+:\d+/);
        if (match) {
          const fileName = match[1];
          if (fileName &&
              fileName !== 'eval' &&
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'common-js/require') {
            return modules[fileName] || __createModule__(fileName);
          }
        }
      }
    }

    // Fallback to a default module
    return __createModule__('unknown');
  }

  /**
   * Debug function to get module information
   * @returns {Object} Module registry information
   */
  function getModuleInfo() {
    return {
      registered: Object.keys(moduleFactories),
      loaded: Object.keys(modules),
      loading: Array.from(loadingModules)
    };
  }

  /**
   * Debug function to get all modules
   * @returns {Object} All module objects
   */
  function getModules() {
    return modules;
  }

  // Expose internal helper functions that are needed by global functions
  globalThis.__detectModuleName__ = __detectModuleName__;  // Used by global __defineModule__()
  globalThis.__getCurrentModule__ = __getCurrentModule__;  // Used by _main() default params
  globalThis.__getModuleLogFunction = getModuleLogFunction;  // Used by global require() for per-module logging

  // Register the shim module itself (loadNow=true so it's always available)
  __defineModule__(function(module, exports, log) {
    return {
      getModuleInfo: getModuleInfo,
      getModules: getModules,
      require: require,
      __defineModule__: __defineModule__,
      __getCurrentModule__: __getCurrentModule__
    };
  }, true, { explicitName: 'common-js/require' });

  debugLog('[INIT] Module system initialized');
})();

// ===== MODULE LOGGING CONTROL FUNCTIONS =====

/**
 * Set logging for module(s) with inclusion/exclusion support
 *
 * @param {string|Array<string>} pattern - Module name(s), folder pattern (e.g., 'auth/*'), or '*' for all
 * @param {boolean} enabled - true to enable logging, false to disable
 * @param {string} [scope='script'] - ConfigManager scope (userDoc, document, user, domain, script)
 * @param {boolean} [explicitDisable=false] - When disabling, use false instead of delete (even at script scope)
 * @returns {boolean} Success status
 *
 * @example
 * // Enable all modules
 * setModuleLogging('*', true);
 *
 * // Explicitly exclude one module (takes precedence over wildcard)
 * setModuleLogging('auth/NoisyModule', false, 'script', true);
 *
 * // Enable folder
 * setModuleLogging('auth/*', true);
 *
 * // Exclude specific module from folder (takes precedence)
 * setModuleLogging('auth/SessionManager', false);
 *
 * // Enable multiple specific modules
 * setModuleLogging(['api/Handler', 'auth/Client'], true);
 */
function setModuleLogging(pattern, enabled, scope, explicitDisable) {
  scope = scope || 'script';
  explicitDisable = explicitDisable || false;

  try {
    const ConfigManagerClass = require('common-js/ConfigManager');
    const config = new ConfigManagerClass('COMMONJS');

    // Read from SPECIFIC scope (not merged!)
    const loggingMapJson = config.get('__Logging', '{}');
    const loggingMap = JSON.parse(loggingMapJson);

    // Helper: enable or disable entry (scope-aware)
    function setEntry(name) {
      if (enabled) {
        loggingMap[name] = true;
      } else {
        // Use false if: explicit flag OR not at script scope
        if (explicitDisable || scope !== 'script') {
          loggingMap[name] = false;
        } else {
          // At script scope without explicit flag: delete (absence = disabled)
          delete loggingMap[name];
        }
      }
    }

    // Apply pattern(s)
    if (Array.isArray(pattern)) {
      pattern.forEach(setEntry);
    } else {
      setEntry(pattern);
    }

    // Write back to SAME scope
    config.set('__Logging', JSON.stringify(loggingMap), scope);
    return true;
  } catch (e) {
    Logger.log(`[ERROR] setModuleLogging failed: ${e.message}`);
    return false;
  }
}

/**
 * Get current logging state for module(s)
 *
 * @param {string|Array<string>} [pattern] - Module name(s) to check, or omit for all
 * @returns {Object} Map of module names to boolean (enabled/disabled) or undefined if not set
 *
 * @example
 * getModuleLogging();                    // Get all settings
 * getModuleLogging('auth/Client');        // Get one module
 * getModuleLogging(['api/Handler', 'auth/Client']);  // Get multiple
 */
function getModuleLogging(pattern) {
  try {
    const ConfigManagerClass = require('common-js/ConfigManager');
    const config = new ConfigManagerClass('COMMONJS');

    const loggingMapJson = config.get('__Logging', '{}');
    const loggingMap = JSON.parse(loggingMapJson);

    if (!pattern) {
      return loggingMap; // Return entire map
    }

    if (Array.isArray(pattern)) {
      const result = {};
      pattern.forEach(name => {
        result[name] = loggingMap[name];
      });
      return result;
    }

    return { [pattern]: loggingMap[pattern] };
  } catch (e) {
    Logger.log(`[ERROR] getModuleLogging failed: ${e.message}`);
    return {};
  }
}

/**
 * List all modules/patterns with logging explicitly enabled
 *
 * @returns {Array<string>} Array of enabled module patterns (exact names, folder patterns, or '*')
 *
 * @example
 * listLoggingEnabled();  // Returns ['*', 'auth/NoisyModule'] etc.
 */
function listLoggingEnabled() {
  try {
    const ConfigManagerClass = require('common-js/ConfigManager');
    const config = new ConfigManagerClass('COMMONJS');

    const loggingMapJson = config.get('__Logging', '{}');
    const loggingMap = JSON.parse(loggingMapJson);

    return Object.keys(loggingMap).filter(key => loggingMap[key] === true);
  } catch (e) {
    Logger.log(`[ERROR] listLoggingEnabled failed: ${e.message}`);
    return [];
  }
}

/**
 * Clear all logging configuration at specified scope
 *
 * @param {string} [scope='script'] - ConfigManager scope to clear
 * @returns {boolean} Success status
 *
 * @example
 * clearModuleLogging();           // Clear script scope
 * clearModuleLogging('user');     // Clear user scope
 */
function clearModuleLogging(scope) {
  scope = scope || 'script';

  try {
    const ConfigManagerClass = require('common-js/ConfigManager');
    const config = new ConfigManagerClass('COMMONJS');

    // Delete the entire __Logging key at this scope
    config.delete('__Logging', scope);
    return true;
  } catch (e) {
    Logger.log(`[ERROR] clearModuleLogging failed: ${e.message}`);
    return false;
  }
}

// Expose functions globally for use in GAS environment
globalThis.setModuleLogging = setModuleLogging;
globalThis.getModuleLogging = getModuleLogging;
globalThis.listLoggingEnabled = listLoggingEnabled;
globalThis.clearModuleLogging = clearModuleLogging;

// ===== HOISTED EVENT HANDLER DECLARATIONS (for GAS compile-time detection) =====
// These top-level function declarations delegate to CommonJS dispatchers
// Google Apps Script requires these as compile-time declarations, not runtime assignments

/**
 * @customfunction
 */
function onOpen(e) {
  if (typeof globalThis.__onOpen_dispatcher === 'function') {
    return globalThis.__onOpen_dispatcher(e);
  } else {
    Logger.log('[WARN] CommonJS onOpen dispatcher not found');
  }
}

/**
 * @customfunction
 */
function onEdit(e) {
  if (typeof globalThis.__onEdit_dispatcher === 'function') {
    return globalThis.__onEdit_dispatcher(e);
  } else {
    Logger.log('[WARN] CommonJS onEdit dispatcher not found');
  }
}

/**
 * @customfunction
 */
function onInstall(e) {
  if (typeof globalThis.__onInstall_dispatcher === 'function') {
    return globalThis.__onInstall_dispatcher(e);
  } else {
    Logger.log('[WARN] CommonJS onInstall dispatcher not found');
  }
}

/**
 * @customfunction
 */
function onFormSubmit(e) {
  if (typeof globalThis.__onFormSubmit_dispatcher === 'function') {
    return globalThis.__onFormSubmit_dispatcher(e);
  } else {
    Logger.log('[WARN] CommonJS onFormSubmit dispatcher not found');
  }
}

/**
 * @customfunction
 */
function onSelectionChange(e) {
  if (typeof globalThis.__onSelectionChange_dispatcher === 'function') {
    return globalThis.__onSelectionChange_dispatcher(e);
  } else {
    Logger.log('[WARN] CommonJS onSelectionChange dispatcher not found');
  }
}

/**
 * @customfunction
 */
function doGet(e) {
  if (typeof globalThis.__doGet_dispatcher === 'function') {
    return globalThis.__doGet_dispatcher(e);
  } else {
    Logger.log('[WARN] CommonJS doGet dispatcher not found');
    return HtmlService.createHtmlOutput('<h1>Error: doGet handler not configured</h1>');
  }
}

/**
 * @customfunction
 */
function doPost(e) {
  if (typeof globalThis.__doPost_dispatcher === 'function') {
    return globalThis.__doPost_dispatcher(e);
  } else {
    Logger.log('[WARN] CommonJS doPost dispatcher not found');
    return HtmlService.createHtmlOutput('<h1>Error: doPost handler not configured</h1>');
  }
}
