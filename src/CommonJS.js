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
        
        // ENHANCED: Pattern for Google Apps Script virtual paths: "at path/filename:line:column"
        // This preserves the full directory structure (e.g., "ai_tools/BaseConnector")
        let match = line.match(/at\s+([^/\s:]+\/)?([^/\s:]+(?:\/[^/\s:]+)*):\d+:\d+/);
        Logger.log(`🔍 DEBUG: Pattern Enhanced GAS "at [path/]filename:line:column" match:`, match);
        if (match) {
          // If we have a path prefix, combine it with the filename part
          const pathPrefix = match[1] ? match[1].replace(/\/$/, '') : ''; // Remove trailing slash
          const filePart = match[2];
          const fullPath = pathPrefix ? `${pathPrefix}/${filePart}` : filePart;
          
          Logger.log(`🔍 DEBUG: Pattern Enhanced extracted full path: "${fullPath}"`);
          if (fullPath && 
              fullPath !== 'eval' && 
              fullPath !== 'anonymous' &&
              !fullPath.startsWith('__') &&
              fullPath !== 'CommonJS') {
            Logger.log(`🔍 DEBUG: Pattern Enhanced SUCCESS - returning: "${fullPath}"`);
            return fullPath;
          }
        }
        
        // Alternative pattern: "at full/path/filename:line:column" (single capture group)
        match = line.match(/at\s+([^/\s:]+(?:\/[^/\s:]+)+):\d+:\d+/);
        Logger.log(`🔍 DEBUG: Pattern Alternative "at full/path/filename:line:column" match:`, match);
        if (match) {
          const fullPath = match[1];
          Logger.log(`🔍 DEBUG: Pattern Alternative extracted full path: "${fullPath}"`);
          if (fullPath && 
              fullPath !== 'eval' && 
              fullPath !== 'anonymous' &&
              !fullPath.startsWith('__') &&
              fullPath !== 'CommonJS') {
            Logger.log(`🔍 DEBUG: Pattern Alternative SUCCESS - returning: "${fullPath}"`);
            return fullPath;
          }
        }
        
        // Try pattern: (FileName:line:column) - for simple files without directories
        match = line.match(/\(([^/:()]+):\d+:\d+\)/);
        Logger.log(`🔍 DEBUG: Pattern 1 "(FileName:line:column)" match:`, match);
        if (match) {
          const fileName = match[1];
          Logger.log(`🔍 DEBUG: Pattern 1 extracted fileName: "${fileName}"`);
          if (fileName && 
              fileName !== 'eval' && 
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'CommonJS') {
            Logger.log(`🔍 DEBUG: Pattern 1 SUCCESS - returning: "${fileName}"`);
            return fileName;
          }
        }
        
        // Try pattern: at functionName (FileName:line:column) - for simple files
        match = line.match(/at\s+[^(]*\(([^/:()]+):\d+:\d+\)/);
        Logger.log(`🔍 DEBUG: Pattern 2 "at functionName (FileName:line:column)" match:`, match);
        if (match) {
          const fileName = match[1];
          Logger.log(`🔍 DEBUG: Pattern 2 extracted fileName: "${fileName}"`);
          if (fileName && 
              fileName !== 'eval' && 
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'CommonJS') {
            Logger.log(`🔍 DEBUG: Pattern 2 SUCCESS - returning: "${fileName}"`);
            return fileName;
          }
        }
        
        // Try pattern: FileName.gs:line - for simple files
        match = line.match(/([^/\s]+)\.gs:\d+/);
        Logger.log(`🔍 DEBUG: Pattern 3 "FileName.gs:line" match:`, match);
        if (match) {
          const fileName = match[1];
          Logger.log(`🔍 DEBUG: Pattern 3 extracted fileName: "${fileName}"`);
          if (fileName && 
              fileName !== 'eval' && 
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'CommonJS') {
            Logger.log(`🔍 DEBUG: Pattern 3 SUCCESS - returning: "${fileName}"`);
            return fileName;
          }
        }
        
        // Try pattern: at FileName.functionName - for simple files
        match = line.match(/at\s+([^.\s]+)\./);
        Logger.log(`🔍 DEBUG: Pattern 4 "at FileName.functionName" match:`, match);
        if (match) {
          const fileName = match[1];
          Logger.log(`🔍 DEBUG: Pattern 4 extracted fileName: "${fileName}"`);
          if (fileName && 
              fileName !== 'eval' && 
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'CommonJS') {
            Logger.log(`🔍 DEBUG: Pattern 4 SUCCESS - returning: "${fileName}"`);
            return fileName;
          }
        }
        
        // Try pattern: at FileName:line:column (Google Apps Script format) - for simple files
        match = line.match(/at\s+([^/\s:]+):\d+:\d+/);
        Logger.log(`🔍 DEBUG: Pattern 5 "at FileName:line:column" match:`, match);
        if (match) {
          const fileName = match[1];
          Logger.log(`🔍 DEBUG: Pattern 5 extracted fileName: "${fileName}"`);
          if (fileName && 
              fileName !== 'eval' && 
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'CommonJS') {
            Logger.log(`🔍 DEBUG: Pattern 5 SUCCESS - returning: "${fileName}"`);
            return fileName;
          }
        }
        
        // Try pattern: FileName:line:column (without "at" prefix) - for simple files
        match = line.match(/^\s*([^/\s:()]+):\d+:\d+/);
        Logger.log(`🔍 DEBUG: Pattern 6 "FileName:line:column" match:`, match);
        if (match) {
          const fileName = match[1];
          Logger.log(`🔍 DEBUG: Pattern 6 extracted fileName: "${fileName}"`);
          if (fileName && 
              fileName !== 'eval' && 
              fileName !== 'anonymous' &&
              !fileName.startsWith('__') &&
              fileName !== 'CommonJS') {
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
              !fullPath.startsWith('__') &&
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
              !fullPath.startsWith('__') &&
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