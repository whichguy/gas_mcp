/**
 * Google Apps Script CommonJS Module System (CommonJS.js)
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
 * - Optional debug logging (set globalThis.DEBUG_COMMONJS = true to enable)
 *
 * Usage:
 * 1. Each module should define a _main function with the signature:
 *    function _main(module, exports) { ... }
 *    Note: require() is globally available - no parameter needed!
 *
 * 2. At the end of each module file, call: __defineModule__(_main);
 * 3. Use require('FileName') to import modules by their filename
 *
 * Debug Mode:
 * - By default, all logging is disabled for production performance
 * - To enable verbose module system logging, set: globalThis.DEBUG_COMMONJS = true
 * - This can be done in any module or in the Apps Script execution environment
 * - Example: In your main script, add at the top: globalThis.DEBUG_COMMONJS = true;
 *
 * CRITICAL: The _main function is called ONLY when the module is first required,
 * not when __defineModule__ is called. This enables lazy loading and proper
 * dependency resolution.
 *
 * IMPORTANT: The explicit module name parameter in __defineModule__ is RESERVED
 * for the CommonJS system module only. All user modules MUST use auto-detection
 * by calling __defineModule__(_main) without an explicit name parameter.
 *
 * Example (NEW 2-parameter signature):
 * ```javascript
 * function _main(module, exports) {
 *   // require() is globally available
 *   const helper = require('Helper');
 *
 *   function myFunction() {
 *     return "Hello from module";
 *   }
 *
 *   return { myFunction };
 * }
 *
 * __defineModule__(_main);
 * ```
 *
 * BACKWARD COMPATIBILITY:
 * Old 3-parameter signature still works:
 * ```javascript
 * function _main(module, exports, require) { ... }
 * ```
 *
 * GLOBAL EXPORTS FEATURE (__global__ property):
 *
 * Modules can expose functions to the global namespace for use in Google Sheets formulas
 * by setting the __global__ property on module.exports:
 *
 * Example:
 * ```javascript
 * function _main(module, exports) {
 *   function MY_CUSTOM_FUNCTION(arg1, arg2) {
 *     const helper = require('Helper');  // require() is global
 *     return helper.process(arg1, arg2);
 *   }
 *
 *   module.exports = {
 *     MY_CUSTOM_FUNCTION: MY_CUSTOM_FUNCTION
 *   };
 *
 *   // Expose to global namespace for use in Sheets formulas
 *   module.exports.__global__ = ['MY_CUSTOM_FUNCTION'];
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
 * function _main(module, exports) {
 *   function handleOpen(e) {
 *     const ui = SpreadsheetApp.getUi();
 *     ui.createMenu('My Menu').addItem('Action', 'doAction').addToUi();
 *   }
 *
 *   function handleGet(e) {
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

// ========== GLOBAL DEBUG FLAG ==========

/**
 * Global debug flag for CommonJS logging
 * Set to true to enable verbose module system logging
 * Default: false (production mode with minimal logging)
 */
globalThis.DEBUG_COMMONJS = globalThis.DEBUG_COMMONJS ?? false;

/**
 * Conditional logger - only logs when DEBUG_COMMONJS is enabled
 * @param {...any} args - Arguments to log
 */
function debugLog(...args) {
  if (globalThis.DEBUG_COMMONJS) {
    Logger.log(...args);
  }
}

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
  const normalize = (name) => {
    name = name.replace(/^\.\/?/, '');
    name = name.replace(/^\.\.\/?/, '');
    if (name.endsWith('.js')) name = name.slice(0, -3);
    return name;
  };

  const candidates = [];
  // 1. As given
  candidates.push(moduleName);
  // 2. Normalized (strip ./, ../, .js)
  const norm = normalize(moduleName);
  if (norm !== moduleName) candidates.push(norm);
  // 3. Add .js if not present
  if (!norm.endsWith('.js')) candidates.push(norm + '.js');
  // 4. Remove directory if present (try just the basename)
  const base = norm.split('/').pop();
  if (base && base !== norm) {
    candidates.push(base);
    if (!base.endsWith('.js')) candidates.push(base + '.js');
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
    debugLog(`🔄 Loading module: ${found}`);

    // BACKWARD COMPATIBILITY: Call factory with appropriate signature
    const factory = moduleFactories[found];
    let result;

    if (factory.length === 3) {
      // OLD STYLE: 3 parameters (module, exports, require)
      debugLog(`⚠️  Module ${found} uses deprecated 3-parameter signature - consider migrating to 2-parameter`);
      result = factory(module, module.exports, require);
    } else {
      // NEW STYLE: 2 parameters (module, exports)
      result = factory(module, module.exports);
    }

    // If factory returns something, use it as exports
    if (result !== undefined) {
      module.exports = result;
    }

    // Restore previous module
    globalThis.__currentModule = previousModule;
    debugLog(`✅ Module loaded: ${found}`);

    // Process __global__ exports if present (key-value map)
    if (module.exports?.__global__ && typeof module.exports.__global__ === 'object' && !Array.isArray(module.exports.__global__)) {
      debugLog(`🌍 Module ${found} declares global exports`);

      for (const [key, value] of Object.entries(module.exports.__global__)) {
        globalThis[key] = value;
        debugLog(`  ✅ Exposed ${key} to global namespace (${typeof value})`);
      }
    }

    // Process __events__ if present
    if (module.exports.__events__ && typeof module.exports.__events__ === 'object') {
      debugLog(`📅 Module ${found} declares event handlers`);

      for (const [eventName, handlerName] of Object.entries(module.exports.__events__)) {
        const handlerFunction = module.exports[handlerName];

        if (typeof handlerFunction === 'function') {
          debugLog(`  ✅ Event handler ${eventName} → ${handlerName}`);
        } else {
          debugLog(`  ⚠️ Warning: ${handlerName} is not a function, ${eventName} handler will be skipped`);
        }
      }
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
 * @param {string} [explicitName] - RESERVED for CommonJS system module only
 * @param {Object} [options] - Optional configuration
 * @param {boolean} [options.loadNow=false] - If true, immediately execute module via require()
 */
function __defineModule__(moduleFactory, explicitName, options = {}) {
  // Access registries exposed by IIFE
  const moduleFactories = globalThis.__moduleFactories__;

  // CRITICAL: explicitName is RESERVED for the CommonJS system module only
  // All user modules MUST use auto-detection
  debugLog(`📝 __defineModule__ called with explicitName: ${explicitName || 'auto-detect'}, loadNow: ${options.loadNow || false}`);

  const moduleName = explicitName || globalThis.__detectModuleName__();

  debugLog(`   Resolved module name: ${moduleName}`);

  if (moduleFactories[moduleName]) {
    console.warn(`Module ${moduleName} already registered, skipping duplicate registration`);
    return;
  }

  // ALWAYS store the factory for lazy loading via require()
  moduleFactories[moduleName] = moduleFactory;
  debugLog(`   Factory stored for: ${moduleName}`);

  // If loadNow=true, immediately execute module via require()
  if (options.loadNow) {
    debugLog(`⚡ Load-now enabled for ${moduleName}, executing immediately...`);
    try {
      require(moduleName);
      debugLog(`✅ Module ${moduleName} loaded immediately via require()`);
      return; // Module is now cached and processed by require()
    } catch (error) {
      debugLog(`❌ Error loading module ${moduleName} immediately: ${error.message}`);
      throw error; // Re-throw to prevent silent failures
    }
  }

  // Module registered without execution - will execute on first require()
  debugLog(`📦 Module registered: ${moduleName}`);
}

// ========== IIFE FOR INTERNAL INFRASTRUCTURE ==========

(function() {
  'use strict';

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
  const __findEventHandlers__ = (eventName) => {
    const handlers = [];

    debugLog(`🔍 Searching for ${eventName} handlers...`);
    debugLog(`   Loaded modules: ${Object.keys(modules).join(', ')}`);

    for (const [moduleName, module] of Object.entries(modules)) {
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
    }

    debugLog(`   Found ${handlers.length} handler(s) for ${eventName}`);
    return handlers;
  };

  /**
   * doGet dispatcher - Web app GET requests
   * Returns last non-null response from handlers
   */
  globalThis.__doGet_dispatcher = (e) => {
    const handlers = __findEventHandlers__('doGet');

    if (handlers.length === 0) {
      debugLog('⚠️ No doGet handlers found in loaded modules');
      return ContentService.createTextOutput('No doGet handlers registered')
        .setMimeType(ContentService.MimeType.TEXT);
    }

    debugLog(`🚀 Dispatching doGet to ${handlers.length} handler(s)`);

    let lastResponse = null;
    let successCount = 0;
    let errorCount = 0;

    for (const handlerInfo of handlers) {
      try {
        debugLog(`  → Calling ${handlerInfo.module}.doGet`);
        const response = handlerInfo.handler(e);
        if (response) {
          lastResponse = response;
          successCount++;
        }
      } catch (error) {
        errorCount++;
        debugLog(`  ❌ Error in ${handlerInfo.module}.doGet: ${error.message}`);
        debugLog(`     Stack: ${error.stack}`);
      }
    }

    debugLog(`✅ doGet dispatch complete: ${successCount} succeeded, ${errorCount} failed`);

    if (errorCount > 0 && successCount === 0 && !lastResponse) {
      debugLog('❌ All doGet handlers failed, returning error response');
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
  globalThis.__doPost_dispatcher = (e) => {
    const handlers = __findEventHandlers__('doPost');

    if (handlers.length === 0) {
      debugLog('⚠️ No doPost handlers found in loaded modules');
      return ContentService.createTextOutput('No doPost handlers registered')
        .setMimeType(ContentService.MimeType.TEXT);
    }

    debugLog(`🚀 Dispatching doPost to ${handlers.length} handler(s)`);

    let lastResponse = null;
    let successCount = 0;
    let errorCount = 0;

    for (const handlerInfo of handlers) {
      try {
        debugLog(`  → Calling ${handlerInfo.module}.doPost`);
        const response = handlerInfo.handler(e);
        if (response) {
          lastResponse = response;
          successCount++;
        }
      } catch (error) {
        errorCount++;
        debugLog(`  ❌ Error in ${handlerInfo.module}.doPost: ${error.message}`);
        debugLog(`     Stack: ${error.stack}`);
      }
    }

    debugLog(`✅ doPost dispatch complete: ${successCount} succeeded, ${errorCount} failed`);

    if (errorCount > 0 && successCount === 0 && !lastResponse) {
      debugLog('❌ All doPost handlers failed, returning error response');
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
  globalThis.__onOpen_dispatcher = (e) => {
    const handlers = __findEventHandlers__('onOpen');

    if (handlers.length === 0) {
      debugLog('⚠️ No onOpen handlers found in loaded modules');
      return;
    }

    debugLog(`🚀 Dispatching onOpen to ${handlers.length} handler(s)`);

    let successCount = 0;
    let errorCount = 0;

    for (const handlerInfo of handlers) {
      try {
        debugLog(`  → Calling ${handlerInfo.module}.onOpen`);
        handlerInfo.handler(e);
        successCount++;
      } catch (error) {
        errorCount++;
        debugLog(`  ❌ Error in ${handlerInfo.module}.onOpen: ${error.message}`);
        debugLog(`     Stack: ${error.stack}`);
      }
    }

    debugLog(`✅ onOpen dispatch complete: ${successCount} succeeded, ${errorCount} failed`);
  };

  /**
   * onEdit dispatcher - Edit trigger
   * Executes all handlers, never throws exceptions
   */
  globalThis.__onEdit_dispatcher = (e) => {
    const handlers = __findEventHandlers__('onEdit');

    if (handlers.length === 0) {
      debugLog('⚠️ No onEdit handlers found in loaded modules');
      return;
    }

    debugLog(`🚀 Dispatching onEdit to ${handlers.length} handler(s)`);

    let successCount = 0;
    let errorCount = 0;

    for (const handlerInfo of handlers) {
      try {
        debugLog(`  → Calling ${handlerInfo.module}.onEdit`);
        handlerInfo.handler(e);
        successCount++;
      } catch (error) {
        errorCount++;
        debugLog(`  ❌ Error in ${handlerInfo.module}.onEdit: ${error.message}`);
        debugLog(`     Stack: ${error.stack}`);
      }
    }

    debugLog(`✅ onEdit dispatch complete: ${successCount} succeeded, ${errorCount} failed`);
  };

  /**
   * onSelectionChange dispatcher - Selection change trigger
   * Executes all handlers, never throws exceptions
   */
  globalThis.__onSelectionChange_dispatcher = (e) => {
    const handlers = __findEventHandlers__('onSelectionChange');

    if (handlers.length === 0) {
      return; // Silent - this event fires frequently
    }

    debugLog(`🚀 Dispatching onSelectionChange to ${handlers.length} handler(s)`);

    let successCount = 0;
    let errorCount = 0;

    for (const handlerInfo of handlers) {
      try {
        handlerInfo.handler(e);
        successCount++;
      } catch (error) {
        errorCount++;
        debugLog(`  ❌ Error in ${handlerInfo.module}.onSelectionChange: ${error.message}`);
      }
    }

    debugLog(`✅ onSelectionChange dispatch complete: ${successCount} succeeded, ${errorCount} failed`);
  };

  /**
   * onInstall dispatcher - Add-on install trigger
   * Executes all handlers, never throws exceptions
   */
  globalThis.__onInstall_dispatcher = (e) => {
    const handlers = __findEventHandlers__('onInstall');

    if (handlers.length === 0) {
      debugLog('⚠️ No onInstall handlers found in loaded modules');
      return;
    }

    debugLog(`🚀 Dispatching onInstall to ${handlers.length} handler(s)`);

    let successCount = 0;
    let errorCount = 0;

    for (const handlerInfo of handlers) {
      try {
        debugLog(`  → Calling ${handlerInfo.module}.onInstall`);
        handlerInfo.handler(e);
        successCount++;
      } catch (error) {
        errorCount++;
        debugLog(`  ❌ Error in ${handlerInfo.module}.onInstall: ${error.message}`);
        debugLog(`     Stack: ${error.stack}`);
      }
    }

    debugLog(`✅ onInstall dispatch complete: ${successCount} succeeded, ${errorCount} failed`);
  };

  /**
   * onFormSubmit dispatcher - Form submit trigger
   * Executes all handlers, never throws exceptions
   */
  globalThis.__onFormSubmit_dispatcher = (e) => {
    const handlers = __findEventHandlers__('onFormSubmit');

    if (handlers.length === 0) {
      debugLog('⚠️ No onFormSubmit handlers found in loaded modules');
      return;
    }

    debugLog(`🚀 Dispatching onFormSubmit to ${handlers.length} handler(s)`);

    let successCount = 0;
    let errorCount = 0;

    for (const handlerInfo of handlers) {
      try {
        debugLog(`  → Calling ${handlerInfo.module}.onFormSubmit`);
        handlerInfo.handler(e);
        successCount++;
      } catch (error) {
        errorCount++;
        debugLog(`  ❌ Error in ${handlerInfo.module}.onFormSubmit: ${error.message}`);
        debugLog(`     Stack: ${error.stack}`);
      }
    }

    debugLog(`✅ onFormSubmit dispatch complete: ${successCount} succeeded, ${errorCount} failed`);
  };

  /**
   * Detects the module name from the current stack trace
   * Enhanced to work with Google Apps Script's stack trace format and preserve directory structure
   * @returns {string} The detected module name with full path (e.g., "ai_tools/BaseConnector")
   * @throws {Error} If unable to detect module name from stack trace
   */
  const __detectModuleName__ = () => {
    try {
      throw new Error();
    } catch (e) {
      const stack = e.stack;
      const lines = stack.split('\n');

      // Reduced debug logging for better performance
      debugLog('🔍 Detecting module name...');

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (!trimmedLine || trimmedLine.includes('__detectModuleName__') || trimmedLine.includes('__defineModule__')) {
          continue;
        }

        // ENHANCED: Pattern for Google Apps Script virtual paths: "at path/filename:line:column"
        // This preserves the full directory structure (e.g., "ai_tools/BaseConnector")
        let match = trimmedLine.match(/at\s+([^/\s:]+\/)?([^/\s:]+(?:\/[^/\s:]+)*):\d+:\d+/);
        if (match) {
          // If we have a path prefix, combine it with the filename part
          const pathPrefix = match[1] ? match[1].replace(/\/$/, '') : ''; // Remove trailing slash
          const filePart = match[2];
          const fullPath = pathPrefix ? `${pathPrefix}/${filePart}` : filePart;

          if (fullPath &&
              fullPath !== 'eval' &&
              fullPath !== 'anonymous' &&
              (fullPath === '__mcp_gas_run' || !fullPath.startsWith('__')) &&
              fullPath !== 'CommonJS') {
            debugLog(`✅ Module detected: "${fullPath}"`);
            return fullPath;
          }
        }

        // Alternative pattern: "at full/path/filename:line:column" (single capture group)
        match = trimmedLine.match(/at\s+([^/\s:]+(?:\/[^/\s:]+)+):\d+:\d+/);
        if (match) {
          const fullPath = match[1];
          if (fullPath &&
              fullPath !== 'eval' &&
              fullPath !== 'anonymous' &&
              (fullPath === '__mcp_gas_run' || !fullPath.startsWith('__')) &&
              fullPath !== 'CommonJS') {
            debugLog(`✅ Module detected: "${fullPath}"`);
            return fullPath;
          }
        }

        // Try pattern: (FileName:line:column) - for simple files without directories
        match = trimmedLine.match(/\(([^/:()]+):\d+:\d+\)/);
        if (match) {
          const fileName = match[1];
          if (fileName &&
              fileName !== 'eval' &&
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'CommonJS') {
            debugLog(`✅ Module detected: "${fileName}"`);
            return fileName;
          }
        }

        // Try pattern: at functionName (FileName:line:column) - for simple files
        match = trimmedLine.match(/at\s+[^(]*\(([^/:()]+):\d+:\d+\)/);
        if (match) {
          const fileName = match[1];
          if (fileName &&
              fileName !== 'eval' &&
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'CommonJS') {
            debugLog(`✅ Module detected: "${fileName}"`);
            return fileName;
          }
        }

        // Try pattern: FileName.gs:line - for simple files
        match = trimmedLine.match(/([^/\s]+)\.gs:\d+/);
        if (match) {
          const fileName = match[1];
          if (fileName &&
              fileName !== 'eval' &&
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'CommonJS') {
            debugLog(`✅ Module detected: "${fileName}"`);
            return fileName;
          }
        }

        // Try pattern: at FileName.functionName - for simple files
        match = trimmedLine.match(/at\s+([^.\s]+)\./);
        if (match) {
          const fileName = match[1];
          if (fileName &&
              fileName !== 'eval' &&
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'CommonJS') {
            debugLog(`✅ Module detected: "${fileName}"`);
            return fileName;
          }
        }

        // Try pattern: at FileName:line:column (Google Apps Script format) - for simple files
        match = trimmedLine.match(/at\s+([^/\s:]+):\d+:\d+/);
        if (match) {
          const fileName = match[1];
          if (fileName &&
              fileName !== 'eval' &&
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'CommonJS') {
            debugLog(`✅ Module detected: "${fileName}"`);
            return fileName;
          }
        }

        // Try pattern: FileName:line:column (without "at" prefix) - for simple files
        match = trimmedLine.match(/^\s*([^/\s:()]+):\d+:\d+/);
        if (match) {
          const fileName = match[1];
          if (fileName &&
              fileName !== 'eval' &&
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'CommonJS') {
            debugLog(`✅ Module detected: "${fileName}"`);
            return fileName;
          }
        }
      }

      debugLog('⚠️ Module name detection failed');

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
  };

  /**
   * Creates a new module object
   * @param {string} moduleName - The name of the module
   * @returns {Object} A new module object with exports property
   */
  const __createModule__ = (moduleName) => {
    if (!modules[moduleName]) {
      modules[moduleName] = { exports: {} };
    }
    return modules[moduleName];
  };

  /**
   * Gets the current module object (for use in _main functions)
   * Enhanced to preserve directory structure
   * @returns {Object} - The current module object
   */
  const __getCurrentModule__ = () => {
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
              (fullPath === '__mcp_gas_run' || !fullPath.startsWith('__')) &&
              fullPath !== 'CommonJS') {
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
              (fullPath === '__mcp_gas_run' || !fullPath.startsWith('__')) &&
              fullPath !== 'CommonJS') {
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
              fileName !== 'CommonJS') {
            return modules[fileName] || __createModule__(fileName);
          }
        }
      }
    }

    // Fallback to a default module
    return __createModule__('unknown');
  };

  /**
   * Debug function to get module information
   * @returns {Object} Module registry information
   */
  const getModuleInfo = () => ({
    registered: Object.keys(moduleFactories),
    loaded: Object.keys(modules),
    loading: [...loadingModules]
  });

  /**
   * Debug function to get all modules
   * @returns {Object} All module objects
   */
  const getModules = () => modules;

  // Expose internal helper functions that are needed by global functions
  globalThis.__detectModuleName__ = __detectModuleName__;  // Used by global __defineModule__()
  globalThis.__getCurrentModule__ = __getCurrentModule__;  // Used by _main() default params

  // Register the shim module itself
  __defineModule__(function(_main) {
    return {
      getModuleInfo,
      getModules,
      require,
      __defineModule__,
      __getCurrentModule__
    };
  }, 'CommonJS');

  debugLog('🚀 Module system initialized');
})();

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
    debugLog('⚠️ CommonJS onOpen dispatcher not found');
  }
}

/**
 * @customfunction
 */
function onEdit(e) {
  if (typeof globalThis.__onEdit_dispatcher === 'function') {
    return globalThis.__onEdit_dispatcher(e);
  } else {
    debugLog('⚠️ CommonJS onEdit dispatcher not found');
  }
}

/**
 * @customfunction
 */
function onInstall(e) {
  if (typeof globalThis.__onInstall_dispatcher === 'function') {
    return globalThis.__onInstall_dispatcher(e);
  } else {
    debugLog('⚠️ CommonJS onInstall dispatcher not found');
  }
}

/**
 * @customfunction
 */
function onFormSubmit(e) {
  if (typeof globalThis.__onFormSubmit_dispatcher === 'function') {
    return globalThis.__onFormSubmit_dispatcher(e);
  } else {
    debugLog('⚠️ CommonJS onFormSubmit dispatcher not found');
  }
}

/**
 * @customfunction
 */
function onSelectionChange(e) {
  if (typeof globalThis.__onSelectionChange_dispatcher === 'function') {
    return globalThis.__onSelectionChange_dispatcher(e);
  } else {
    debugLog('⚠️ CommonJS onSelectionChange dispatcher not found');
  }
}

/**
 * @customfunction
 */
function doGet(e) {
  if (typeof globalThis.__doGet_dispatcher === 'function') {
    return globalThis.__doGet_dispatcher(e);
  } else {
    debugLog('⚠️ CommonJS doGet dispatcher not found');
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
    debugLog('⚠️ CommonJS doPost dispatcher not found');
    return HtmlService.createHtmlOutput('<h1>Error: doPost handler not configured</h1>');
  }
}
