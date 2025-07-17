/**
 * 0_shim.js template for Google Apps Script projects
 * This file contains the module system that gets automatically added to new GAS projects.
 * 
 * CRITICAL: This implements LAZY LOADING where _main is called only when require() is first invoked,
 * not when __defineModule__ is called.
 */

export const SHIM_TEMPLATE = `/**
 * Google Apps Script Module System (0_shim.js)
 * 
 * This file provides a CommonJS-like module system for Google Apps Script,
 * enabling the use of require() to import modules and manage dependencies.
 * 
 * Key Features:
 * - Module registration and LAZY LOADING
 * - Circular dependency detection and handling
 * - Automatic module name detection from stack traces
 * - Support for both explicit and automatic module naming
 * 
 * Usage:
 * 1. Each module should define a _main function with the signature:
 *    function _main(module = globalThis.__getCurrentModule(), exports = module.exports, require = globalThis.require)
 * 2. At the end of each module file, call: __defineModule__(_main);
 * 3. Use require('ModuleName') to import modules
 * 
 * CRITICAL: The _main function is called ONLY when the module is first required,
 * not when __defineModule__ is called (lazy loading).
 */

(function() {
  'use strict';
  
  // Initialize global module system if not already present
  if (!globalThis.__modules) {
    globalThis.__modules = {};
    globalThis.__moduleRegistry = {}; // Stores module functions for lazy loading
    globalThis.__requireStack = [];
    globalThis.__currentModule = null;
  }

  /**
   * Detects the module name from the current stack trace
   * @returns {string} The detected module name
   */
  function __detectModuleName__() {
    try {
      throw new Error();
    } catch (e) {
      const stack = e.stack;
      const lines = stack.split('\\n');
      
      // Look for the line that contains the module file reference
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Match Google Apps Script file patterns
        if (line.includes('.gs:') || line.includes('Code.gs:')) {
          // Extract module name from various stack trace formats
          const matches = line.match(/at\\s+([^\\s]+)\\s*\\(.*?([^/\\\\]+)\\.gs:/);
          if (matches && matches[2]) {
            return matches[2];
          }
          
          // Alternative format matching
          const altMatches = line.match(/([^/\\\\]+)\\.gs:/);
          if (altMatches && altMatches[1]) {
            return altMatches[1];
          }
        }
      }
      
      // Fallback: generate a unique module name
      return 'Module_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
  }

  /**
   * Gets the current module being processed
   * @returns {Object} The current module object
   */
  function __getCurrentModule__() {
    return globalThis.__currentModule;
  }

  /**
   * LAZY LOADING: Registers a module function but does NOT execute _main immediately
   * @param {Function} moduleFunction - The _main function to register
   * @param {string} explicitName - Optional explicit module name (used for 0_shim)
   */
  function __defineModule__(moduleFunction, explicitName) {
    let moduleName;
    
    if (explicitName) {
      // Use explicit name (only for 0_shim)
      moduleName = explicitName;
    } else {
      // Auto-detect module name from stack trace
      moduleName = __detectModuleName__();
    }
    
    // Store the module function for lazy loading - do NOT execute it yet
    globalThis.__moduleRegistry[moduleName] = moduleFunction;
    
    // Only create the module object structure, but don't populate exports yet
    if (!globalThis.__modules[moduleName]) {
      globalThis.__modules[moduleName] = { exports: {} };
    }
    
    console.log('📦 Module registered (lazy): ' + moduleName);
  }

  /**
   * LAZY LOADING: Loads a module by executing its _main function only when first required
   * @param {string} moduleName - The name of the module to load
   * @returns {Object} The module's exports
   */
  function __loadModule__(moduleName) {
    // Check if module function is registered
    if (!globalThis.__moduleRegistry[moduleName]) {
      throw new Error('Module not found: ' + moduleName + '. Available modules: ' + Object.keys(globalThis.__moduleRegistry).join(', '));
    }
    
    // Check if module is already loaded (exports populated)
    const module = globalThis.__modules[moduleName];
    if (module && Object.keys(module.exports).length > 0) {
      console.log('📦 Module already loaded (cached): ' + moduleName);
      return module.exports;
    }
    
    // Check for circular dependencies
    if (globalThis.__requireStack.includes(moduleName)) {
      console.warn('⚠️  Circular dependency detected: ' + globalThis.__requireStack.join(' -> ') + ' -> ' + moduleName);
      return module.exports; // Return partial exports for circular dependencies
    }
    
    console.log('📦 Loading module (executing _main): ' + moduleName);
    
    // Add to require stack for circular dependency detection
    globalThis.__requireStack.push(moduleName);
    
    // Set current module context
    const previousModule = globalThis.__currentModule;
    globalThis.__currentModule = module;
    
    try {
      // Execute the module function (_main) to populate exports
      const moduleFunction = globalThis.__moduleRegistry[moduleName];
      moduleFunction(module, module.exports, globalThis.require);
      
      console.log('✅ Module loaded successfully: ' + moduleName);
      return module.exports;
    } catch (error) {
      console.error('❌ Error loading module ' + moduleName + ':', error);
      throw error;
    } finally {
      // Clean up: remove from require stack and restore previous module
      globalThis.__requireStack.pop();
      globalThis.__currentModule = previousModule;
    }
  }

  /**
   * Requires a module (CommonJS-like require function)
   * @param {string} moduleName - The name of the module to require
   * @returns {Object} The module's exports
   */
  function require(moduleName) {
    if (!moduleName) {
      throw new Error('Module name is required');
    }
    
    // Normalize module name (remove file extensions)
    moduleName = moduleName.replace(/\\.(js|gs)$/, '');
    
    console.log('🔍 Requiring module: ' + moduleName);
    
    // Load the module (this will execute _main if not already loaded)
    return __loadModule__(moduleName);
  }

  /**
   * Lists all available modules
   * @returns {Array} Array of module names
   */
  function __listModules__() {
    return Object.keys(globalThis.__moduleRegistry);
  }

  /**
   * Gets detailed information about the module system
   * @returns {Object} Module system information
   */
  function __getModuleInfo__() {
    return {
      registered: Object.keys(globalThis.__moduleRegistry),
      loaded: Object.keys(globalThis.__modules).filter(name => 
        globalThis.__modules[name] && Object.keys(globalThis.__modules[name].exports).length > 0
      ),
      requireStack: globalThis.__requireStack.slice(),
      currentModule: globalThis.__currentModule ? 'Set' : 'None'
    };
  }

  /**
   * Clears the module cache (for testing/debugging)
   */
  function __clearModuleCache__() {
    globalThis.__modules = {};
    globalThis.__moduleRegistry = {};
    globalThis.__requireStack = [];
    globalThis.__currentModule = null;
    console.log('🧹 Module cache cleared');
  }

  // Export functions to global scope
  globalThis.__defineModule__ = __defineModule__;
  globalThis.__getCurrentModule__ = __getCurrentModule__;
  globalThis.__loadModule__ = __loadModule__;
  globalThis.__listModules__ = __listModules__;
  globalThis.__getModuleInfo__ = __getModuleInfo__;
  globalThis.__clearModuleCache__ = __clearModuleCache__;
  globalThis.require = require;

  // Register the shim itself as a module
  function _main(module, exports, require) {
    // Export utility functions
    exports.defineModule = __defineModule__;
    exports.getCurrentModule = __getCurrentModule__;
    exports.loadModule = __loadModule__;
    exports.listModules = __listModules__;
    exports.getModuleInfo = __getModuleInfo__;
    exports.clearModuleCache = __clearModuleCache__;
    exports.require = require;
    
    // Export system information
    exports.version = '1.0.0';
    exports.description = 'Google Apps Script Module System';
    
    console.log('🚀 Module system initialized (0_shim)');
  }

  // Register the shim module itself (this is the only module that gets loaded immediately)
  __defineModule__(_main, '0_shim');
  // Load the shim module immediately since it's the bootstrap module
  __loadModule__('0_shim');

})();

/**
 * Documentation for creating new user functions:
 * 
 * To create a new module in Google Apps Script:
 * 
 * 1. Create a new .gs file with your module name
 * 2. Define your _main function with the proper signature:
 * 
 *    function _main(
 *      module = globalThis.__getCurrentModule(),
 *      exports = module.exports,
 *      require = globalThis.require
 *    ) {
 *      // Your module code here
 *      
 *      function myFunction() {
 *        return "Hello from my module!";
 *      }
 *      
 *      function anotherFunction(param) {
 *        return "Received: " + param;
 *      }
 *      
 *      // Export functions
 *      exports.myFunction = myFunction;
 *      exports.anotherFunction = anotherFunction;
 *    }
 * 
 * 3. At the end of your file, register the module:
 *    __defineModule__(_main);
 * 
 * 4. Use the module in other files:
 *    const myModule = require('YourModuleName');
 *    myModule.myFunction(); // "Hello from my module!"
 * 
 * The _main function will only be called the first time the module is required,
 * not when __defineModule__ is called. Subsequent require() calls will return
 * the cached exports without re-executing _main.
 */
`; 