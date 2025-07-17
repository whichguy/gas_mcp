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
 */

(function() {
  'use strict';

  /**
   * Detects the module name from the current stack trace
   * Enhanced to work with Google Apps Script's stack trace format
   * @returns {string} The detected module name
   * @throws {Error} If unable to detect module name from stack trace
   */
  function __detectModuleName__() {
    try {
      throw new Error();
    } catch (e) {
      const stack = e.stack;
      const lines = stack.split('\n');
      
      Logger.log('🔍 DEBUG: Starting module name detection');
      Logger.log('🔍 DEBUG: Full stack trace:', stack);
      Logger.log('🔍 DEBUG: Stack lines:', lines);
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        Logger.log(`🔍 DEBUG: Processing line ${i}: "${line}"`);
        
        if (!line || line.includes('__detectModuleName__') || line.includes('__defineModule__')) {
          Logger.log(`🔍 DEBUG: Skipping line ${i} (empty or contains detection functions)`);
          continue;
        }
        
        // Try pattern: (FileName:line:column)
        let match = line.match(/\(([^/:()]+):\d+:\d+\)/);
        Logger.log(`🔍 DEBUG: Pattern 1 "(FileName:line:column)" match:`, match);
        if (match) {
          const fileName = match[1];
          Logger.log(`🔍 DEBUG: Pattern 1 extracted fileName: "${fileName}"`);
          if (fileName && 
              fileName !== 'eval' && 
              fileName !== 'anonymous' &&
              !fileName.startsWith('__')) {
            Logger.log(`🔍 DEBUG: Pattern 1 SUCCESS - returning: "${fileName}"`);
            return fileName;
          }
        }
        
        // Try pattern: at functionName (FileName:line:column)
        match = line.match(/at\s+[^(]*\(([^/:()]+):\d+:\d+\)/);
        Logger.log(`🔍 DEBUG: Pattern 2 "at functionName (FileName:line:column)" match:`, match);
        if (match) {
          const fileName = match[1];
          Logger.log(`🔍 DEBUG: Pattern 2 extracted fileName: "${fileName}"`);
          if (fileName && 
              fileName !== 'eval' && 
              fileName !== 'anonymous' &&
              !fileName.startsWith('__')) {
            Logger.log(`🔍 DEBUG: Pattern 2 SUCCESS - returning: "${fileName}"`);
            return fileName;
          }
        }
        
        // Try pattern: FileName.gs:line
        match = line.match(/([^/\s]+)\.gs:\d+/);
        Logger.log(`🔍 DEBUG: Pattern 3 "FileName.gs:line" match:`, match);
        if (match) {
          const fileName = match[1];
          Logger.log(`🔍 DEBUG: Pattern 3 extracted fileName: "${fileName}"`);
          if (fileName && 
              fileName !== 'eval' && 
              fileName !== 'anonymous' &&
              !fileName.startsWith('__')) {
            Logger.log(`🔍 DEBUG: Pattern 3 SUCCESS - returning: "${fileName}"`);
            return fileName;
          }
        }
        
        // Try pattern: at FileName.functionName
        match = line.match(/at\s+([^.\s]+)\./);
        Logger.log(`🔍 DEBUG: Pattern 4 "at FileName.functionName" match:`, match);
        if (match) {
          const fileName = match[1];
          Logger.log(`🔍 DEBUG: Pattern 4 extracted fileName: "${fileName}"`);
          if (fileName && 
              fileName !== 'eval' && 
              fileName !== 'anonymous' &&
              !fileName.startsWith('__')) {
            Logger.log(`🔍 DEBUG: Pattern 4 SUCCESS - returning: "${fileName}"`);
            return fileName;
          }
        }
        
        // Try pattern: at FileName:line:column (Google Apps Script format) - FIXED ESCAPING
        match = line.match(/at\s+([^/\s:]+):\d+:\d+/);
        Logger.log(`🔍 DEBUG: Pattern 5 "at FileName:line:column" match:`, match);
        if (match) {
          const fileName = match[1];
          Logger.log(`🔍 DEBUG: Pattern 5 extracted fileName: "${fileName}"`);
          if (fileName && 
              fileName !== 'eval' && 
              fileName !== 'anonymous' &&
              !fileName.startsWith('__')) {
            Logger.log(`🔍 DEBUG: Pattern 5 SUCCESS - returning: "${fileName}"`);
            return fileName;
          }
        }
        
        // Try pattern: FileName:line:column (without "at" prefix)
        match = line.match(/^\s*([^/\s:()]+):\d+:\d+/);
        Logger.log(`🔍 DEBUG: Pattern 6 "FileName:line:column" match:`, match);
        if (match) {
          const fileName = match[1];
          Logger.log(`🔍 DEBUG: Pattern 6 extracted fileName: "${fileName}"`);
          if (fileName && 
              fileName !== 'eval' && 
              fileName !== 'anonymous' &&
              !fileName.startsWith('__')) {
            Logger.log(`🔍 DEBUG: Pattern 6 SUCCESS - returning: "${fileName}"`);
            return fileName;
          }
        }
        
        Logger.log(`🔍 DEBUG: No patterns matched for line ${i}`);
      }
      
      Logger.log('🔍 DEBUG: No module name found in any stack trace line');
      
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

  // Module storage
  const modules = {};
  const moduleFactories = {};
  const loadingModules = new Set();

  /**
   * Registers a module with the system
   * @param {Function} moduleFactory - The _main function that creates the module
   * @param {string} [explicitName] - RESERVED for CommonJS system module only
   */
  function __defineModule__(moduleFactory, explicitName) {
    // CRITICAL: explicitName is RESERVED for the CommonJS system module only
    // All user modules MUST use auto-detection
    const moduleName = explicitName || __detectModuleName__();
    
    if (moduleFactories[moduleName]) {
      console.warn(`Module ${moduleName} already registered, skipping duplicate registration`);
      return;
    }
    
    moduleFactories[moduleName] = moduleFactory;
    Logger.log(`📦 Module registered: ${moduleName}`);
  }

  /**
   * Loads a module on demand
   * @param {string} moduleName - The name of the module to load
   * @returns {Object} The module exports
   */
  function require(moduleName) {
    // Return cached module if already loaded
    if (modules[moduleName]) {
      return modules[moduleName].exports;
    }
    
    // Check if module factory exists
    if (!moduleFactories[moduleName]) {
      throw new Error(`Module not found: ${moduleName}. Available modules: ${Object.keys(moduleFactories).join(', ')}`);
    }
    
    // Detect circular dependencies
    if (loadingModules.has(moduleName)) {
      throw new Error(`Circular dependency detected: ${moduleName}`);
    }
    
    // Mark as loading
    loadingModules.add(moduleName);
    
    try {
      // Create module object
      const module = { exports: {} };
      modules[moduleName] = module;
      
      // Set current module for the factory
      const previousModule = globalThis.__currentModule;
      globalThis.__currentModule = module;
      
      Logger.log(`🔄 Loading module: ${moduleName}`);
      
      // Call the factory function
      const result = moduleFactories[moduleName](module, module.exports, require);
      
      // If factory returns something, use it as exports
      if (result !== undefined) {
        module.exports = result;
      }
      
      // Restore previous module
      globalThis.__currentModule = previousModule;
      
      Logger.log(`✅ Module loaded: ${moduleName}`);
      return module.exports;
      
    } finally {
      // Remove from loading set
      loadingModules.delete(moduleName);
    }
  }

  /**
   * Gets the current module being loaded
   * @returns {Object} The current module object
   */
  function __getCurrentModule__() {
    return globalThis.__currentModule || { exports: {} };
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