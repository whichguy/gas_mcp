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
 * - GLOBAL EXPORTS for custom functions (NEW)
 * - EVENT HANDLER SYSTEM for GAS triggers (NEW)
 *
 * Usage:
 * 1. Each module should define a _main function with the signature:
 *    function _main(module = globalThis.__getCurrentModule(), exports = module.exports, require = globalThis.require)
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
 * Example:
 * ```javascript
 * function _main(module = globalThis.__getCurrentModule(), exports = module.exports, require = globalThis.require) {
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
 * GLOBAL EXPORTS FEATURE (__global__ property):
 *
 * Modules can expose functions to the global namespace for use in Google Sheets formulas
 * by setting the __global__ property on module.exports:
 *
 * Example:
 * ```javascript
 * function _main(module, exports, require) {
 *   function MY_CUSTOM_FUNCTION(arg1, arg2) {
 *     return "result";
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
 * function _main(module, exports, require) {
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

(function() {
  'use strict';

  // Module storage
  const modules = {};
  const moduleFactories = {};
  const loadingModules = new Set();

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

    Logger.log(`🔍 Searching for ${eventName} handlers...`);
    Logger.log(`   Loaded modules: ${Object.keys(modules).join(', ')}`);

    Object.keys(modules).forEach(moduleName => {
      const module = modules[moduleName];
      Logger.log(`   Checking module: ${moduleName}`);

      if (module.exports) {
        Logger.log(`     - has exports: ✓`);

        if (module.exports.__events__) {
          Logger.log(`     - has __events__: ✓`);
          Logger.log(`     - events: ${JSON.stringify(Object.keys(module.exports.__events__))}`);

          if (module.exports.__events__[eventName]) {
            const handlerName = module.exports.__events__[eventName];
            Logger.log(`     - has ${eventName} handler: ${handlerName}`);

            const handlerFunction = module.exports[handlerName];

            if (typeof handlerFunction === 'function') {
              Logger.log(`     - handler is function: ✓`);
              handlers.push({
                module: moduleName,
                handler: handlerFunction
              });
            } else {
              Logger.log(`     - handler is NOT function: ${typeof handlerFunction}`);
            }
          } else {
            Logger.log(`     - no ${eventName} handler in __events__`);
          }
        } else {
          Logger.log(`     - no __events__ property`);
        }
      } else {
        Logger.log(`     - no exports`);
      }
    });

    Logger.log(`   Found ${handlers.length} handler(s) for ${eventName}`);
    return handlers;
  }

  /**
   * doGet dispatcher - Web app GET requests
   * Returns last non-null response from handlers
   */
  globalThis.doGet = function(e) {
    const handlers = __findEventHandlers__('doGet');

    if (handlers.length === 0) {
      Logger.log('⚠️ No doGet handlers found in loaded modules');
      return ContentService.createTextOutput('No doGet handlers registered')
        .setMimeType(ContentService.MimeType.TEXT);
    }

    Logger.log(`🚀 Dispatching doGet to ${handlers.length} handler(s)`);

    let lastResponse = null;
    let successCount = 0;
    let errorCount = 0;

    handlers.forEach(function(handlerInfo) {
      try {
        Logger.log(`  → Calling ${handlerInfo.module}.doGet`);
        const response = handlerInfo.handler(e);
        if (response) {
          lastResponse = response;
          successCount++;
        }
      } catch (error) {
        errorCount++;
        Logger.log(`  ❌ Error in ${handlerInfo.module}.doGet: ${error.message}`);
        Logger.log(`     Stack: ${error.stack}`);
      }
    });

    Logger.log(`✅ doGet dispatch complete: ${successCount} succeeded, ${errorCount} failed`);

    if (errorCount > 0 && successCount === 0 && !lastResponse) {
      Logger.log('❌ All doGet handlers failed, returning error response');
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
  globalThis.doPost = function(e) {
    const handlers = __findEventHandlers__('doPost');

    if (handlers.length === 0) {
      Logger.log('⚠️ No doPost handlers found in loaded modules');
      return ContentService.createTextOutput('No doPost handlers registered')
        .setMimeType(ContentService.MimeType.TEXT);
    }

    Logger.log(`🚀 Dispatching doPost to ${handlers.length} handler(s)`);

    let lastResponse = null;
    let successCount = 0;
    let errorCount = 0;

    handlers.forEach(function(handlerInfo) {
      try {
        Logger.log(`  → Calling ${handlerInfo.module}.doPost`);
        const response = handlerInfo.handler(e);
        if (response) {
          lastResponse = response;
          successCount++;
        }
      } catch (error) {
        errorCount++;
        Logger.log(`  ❌ Error in ${handlerInfo.module}.doPost: ${error.message}`);
        Logger.log(`     Stack: ${error.stack}`);
      }
    });

    Logger.log(`✅ doPost dispatch complete: ${successCount} succeeded, ${errorCount} failed`);

    if (errorCount > 0 && successCount === 0 && !lastResponse) {
      Logger.log('❌ All doPost handlers failed, returning error response');
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
  globalThis.onOpen = function(e) {
    const handlers = __findEventHandlers__('onOpen');

    if (handlers.length === 0) {
      Logger.log('⚠️ No onOpen handlers found in loaded modules');
      return;
    }

    Logger.log(`🚀 Dispatching onOpen to ${handlers.length} handler(s)`);

    let successCount = 0;
    let errorCount = 0;

    handlers.forEach(function(handlerInfo) {
      try {
        Logger.log(`  → Calling ${handlerInfo.module}.onOpen`);
        handlerInfo.handler(e);
        successCount++;
      } catch (error) {
        errorCount++;
        Logger.log(`  ❌ Error in ${handlerInfo.module}.onOpen: ${error.message}`);
        Logger.log(`     Stack: ${error.stack}`);
      }
    });

    Logger.log(`✅ onOpen dispatch complete: ${successCount} succeeded, ${errorCount} failed`);
  };

  /**
   * onEdit dispatcher - Edit trigger
   * Executes all handlers, never throws exceptions
   */
  globalThis.onEdit = function(e) {
    const handlers = __findEventHandlers__('onEdit');

    if (handlers.length === 0) {
      Logger.log('⚠️ No onEdit handlers found in loaded modules');
      return;
    }

    Logger.log(`🚀 Dispatching onEdit to ${handlers.length} handler(s)`);

    let successCount = 0;
    let errorCount = 0;

    handlers.forEach(function(handlerInfo) {
      try {
        Logger.log(`  → Calling ${handlerInfo.module}.onEdit`);
        handlerInfo.handler(e);
        successCount++;
      } catch (error) {
        errorCount++;
        Logger.log(`  ❌ Error in ${handlerInfo.module}.onEdit: ${error.message}`);
        Logger.log(`     Stack: ${error.stack}`);
      }
    });

    Logger.log(`✅ onEdit dispatch complete: ${successCount} succeeded, ${errorCount} failed`);
  };

  /**
   * onSelectionChange dispatcher - Selection change trigger
   * Executes all handlers, never throws exceptions
   */
  globalThis.onSelectionChange = function(e) {
    const handlers = __findEventHandlers__('onSelectionChange');

    if (handlers.length === 0) {
      return; // Silent - this event fires frequently
    }

    Logger.log(`🚀 Dispatching onSelectionChange to ${handlers.length} handler(s)`);

    let successCount = 0;
    let errorCount = 0;

    handlers.forEach(function(handlerInfo) {
      try {
        handlerInfo.handler(e);
        successCount++;
      } catch (error) {
        errorCount++;
        Logger.log(`  ❌ Error in ${handlerInfo.module}.onSelectionChange: ${error.message}`);
      }
    });

    Logger.log(`✅ onSelectionChange dispatch complete: ${successCount} succeeded, ${errorCount} failed`);
  };

  /**
   * onInstall dispatcher - Add-on install trigger
   * Executes all handlers, never throws exceptions
   */
  globalThis.onInstall = function(e) {
    const handlers = __findEventHandlers__('onInstall');

    if (handlers.length === 0) {
      Logger.log('⚠️ No onInstall handlers found in loaded modules');
      return;
    }

    Logger.log(`🚀 Dispatching onInstall to ${handlers.length} handler(s)`);

    let successCount = 0;
    let errorCount = 0;

    handlers.forEach(function(handlerInfo) {
      try {
        Logger.log(`  → Calling ${handlerInfo.module}.onInstall`);
        handlerInfo.handler(e);
        successCount++;
      } catch (error) {
        errorCount++;
        Logger.log(`  ❌ Error in ${handlerInfo.module}.onInstall: ${error.message}`);
        Logger.log(`     Stack: ${error.stack}`);
      }
    });

    Logger.log(`✅ onInstall dispatch complete: ${successCount} succeeded, ${errorCount} failed`);
  };

  /**
   * onFormSubmit dispatcher - Form submit trigger
   * Executes all handlers, never throws exceptions
   */
  globalThis.onFormSubmit = function(e) {
    const handlers = __findEventHandlers__('onFormSubmit');

    if (handlers.length === 0) {
      Logger.log('⚠️ No onFormSubmit handlers found in loaded modules');
      return;
    }

    Logger.log(`🚀 Dispatching onFormSubmit to ${handlers.length} handler(s)`);

    let successCount = 0;
    let errorCount = 0;

    handlers.forEach(function(handlerInfo) {
      try {
        Logger.log(`  → Calling ${handlerInfo.module}.onFormSubmit`);
        handlerInfo.handler(e);
        successCount++;
      } catch (error) {
        errorCount++;
        Logger.log(`  ❌ Error in ${handlerInfo.module}.onFormSubmit: ${error.message}`);
        Logger.log(`     Stack: ${error.stack}`);
      }
    });

    Logger.log(`✅ onFormSubmit dispatch complete: ${successCount} succeeded, ${errorCount} failed`);
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
      Logger.log('🔍 Detecting module name...');

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
              (fullPath === '__mcp_gas_run' || !fullPath.startsWith('__')) &&
              fullPath !== 'CommonJS') {
            Logger.log(`✅ Module detected: "${fullPath}"`);
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
              (fullPath === '__mcp_gas_run' || !fullPath.startsWith('__')) &&
              fullPath !== 'CommonJS') {
            Logger.log(`✅ Module detected: "${fullPath}"`);
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
              fileName !== 'CommonJS') {
            Logger.log(`✅ Module detected: "${fileName}"`);
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
              fileName !== 'CommonJS') {
            Logger.log(`✅ Module detected: "${fileName}"`);
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
              fileName !== 'CommonJS') {
            Logger.log(`✅ Module detected: "${fileName}"`);
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
              fileName !== 'CommonJS') {
            Logger.log(`✅ Module detected: "${fileName}"`);
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
              fileName !== 'CommonJS') {
            Logger.log(`✅ Module detected: "${fileName}"`);
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
              fileName !== 'CommonJS') {
            Logger.log(`✅ Module detected: "${fileName}"`);
            return fileName;
          }
        }
      }

      Logger.log('⚠️ Module name detection failed');

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
   * Registers a module with the system
   * @param {Function} moduleFactory - The _main function that creates the module
   * @param {string} [explicitName] - RESERVED for CommonJS system module only
   * @param {Object} [options] - Optional configuration
   * @param {boolean} [options.loadNow=false] - If true, immediately execute module via require()
   */
  function __defineModule__(moduleFactory, explicitName, options) {
    // Parse options parameter
    const opts = typeof options === 'object' && options !== null ? options : {};

    // CRITICAL: explicitName is RESERVED for the CommonJS system module only
    // All user modules MUST use auto-detection
    Logger.log(`📝 __defineModule__ called with explicitName: ${explicitName || 'auto-detect'}, loadNow: ${opts.loadNow || false}`);

    const moduleName = explicitName || __detectModuleName__();

    Logger.log(`   Resolved module name: ${moduleName}`);

    if (moduleFactories[moduleName]) {
      console.warn(`Module ${moduleName} already registered, skipping duplicate registration`);
      return;
    }

    // ALWAYS store the factory for lazy loading via require()
    moduleFactories[moduleName] = moduleFactory;
    Logger.log(`   Factory stored for: ${moduleName}`);

    // If loadNow=true, immediately execute module via require()
    if (opts.loadNow) {
      Logger.log(`⚡ Load-now enabled for ${moduleName}, executing immediately...`);
      try {
        require(moduleName);
        Logger.log(`✅ Module ${moduleName} loaded immediately via require()`);
        return; // Module is now cached and processed by require()
      } catch (error) {
        Logger.log(`❌ Error loading module ${moduleName} immediately: ${error.message}`);
        throw error; // Re-throw to prevent silent failures
      }
    }

    // Module registered without execution - will execute on first require()
    Logger.log(`📦 Module registered: ${moduleName}`);
  }

  /**
   * Loads a module on demand
   * NOTE: This is where __global__ and __events__ properties are processed
   * @param {string} moduleName - The name or path of the module to load
   * @returns {Object} The module exports
   */
  function require(moduleName) {
    // Normalize the module name
    function normalize(name) {
      // Remove leading './' or '../'
      name = name.replace(/^\.\/?/, '');
      name = name.replace(/^\.\.\/?/, '');
      // Remove trailing .js
      if (name.endsWith('.js')) name = name.slice(0, -3);
      return name;
    }
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
      Logger.log(`🔄 Loading module: ${found}`);
      // Call the factory function
      const result = moduleFactories[found](module, module.exports, require);
      // If factory returns something, use it as exports
      if (result !== undefined) {
        module.exports = result;
      }
      // Restore previous module
      globalThis.__currentModule = previousModule;
      Logger.log(`✅ Module loaded: ${found}`);

      // Process __global__ exports if present (key-value map)
      if (module.exports.__global__ && typeof module.exports.__global__ === 'object' && !Array.isArray(module.exports.__global__)) {
        Logger.log(`🌍 Module ${found} declares global exports`);

        // Expose each key-value pair to global namespace
        Object.keys(module.exports.__global__).forEach(key => {
          const value = module.exports.__global__[key];
          globalThis[key] = value;
          Logger.log(`  ✅ Exposed ${key} to global namespace (${typeof value})`);
        });
      }

      // Process __events__ if present
      if (module.exports.__events__ && typeof module.exports.__events__ === 'object') {
        Logger.log(`📅 Module ${found} declares event handlers`);

        // Validate event handlers exist
        Object.keys(module.exports.__events__).forEach(eventName => {
          const handlerName = module.exports.__events__[eventName];
          const handlerFunction = module.exports[handlerName];

          if (typeof handlerFunction === 'function') {
            Logger.log(`  ✅ Event handler ${eventName} → ${handlerName}`);
          } else {
            Logger.log(`  ⚠️ Warning: ${handlerName} is not a function, ${eventName} handler will be skipped`);
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

  // Expose functions globally
  globalThis.__defineModule__ = __defineModule__;
  globalThis.require = require;
  globalThis.__getCurrentModule__ = __getCurrentModule__;

  // Register the shim module itself
  __defineModule__(function(_main) {
    return {
      getModuleInfo: getModuleInfo,
      getModules: getModules,
      require: require,
      __defineModule__: __defineModule__,
      __getCurrentModule__: __getCurrentModule__
    };
      }, 'CommonJS');

  Logger.log('🚀 Module system initialized');
})();
