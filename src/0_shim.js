/**
 * Module System and Function Registry
 * 
 * This module provides a CommonJS-like module system for Google Apps Script
 * with automatic name detection and function registration capabilities.
 * 
 * Key Features:
 * - CommonJS-style require() function
 * - Automatic module name detection from stack traces
 * - Function registry for cross-module function calls
 * - Circular dependency detection
 * - Module initialization control
 * 
 * Usage Pattern:
 * ```javascript
 * function _main(module, exports, require) {
 *   // Your module code here
 *   exports.myFunction = function() {
 *     return "Hello from module";
 *   };
 * }
 * 
 * // For 0_shim only: use explicit naming
 * __defineModule__(_main, '0_shim');
 * 
 * // For all other modules: use automatic detection
 * __defineModule__(_main);
 * ```
 */

// Initialize global module system
if (!globalThis.__modules) {
  globalThis.__modules = {};
}

if (!globalThis.__requireStack) {
  globalThis.__requireStack = [];
}

if (!globalThis.__FUNCTION_REGISTRY) {
  globalThis.__FUNCTION_REGISTRY = {};
}

/**
 * Get the current module context (fallback for legacy code)
 * @returns {Object} Module object with exports
 */
function __getCurrentModule() {
  let moduleName = 'unknown';
  try {
    const error = new Error();
    const stack = error.stack || '';
    const stackLines = stack.split('\n');
    
    // Look for (ModuleName:line:col) pattern in stack trace
    for (let line of stackLines) {
      const match = line.match(/\(([^/:]+):\d+:\d+\)/);
      if (match) {
        const detectedName = match[1];
        // Skip internal system names
        if (!detectedName.startsWith('__') && detectedName !== 'anonymous' && detectedName !== 'eval') {
          moduleName = detectedName;
          break;
        }
      }
    }
    
    // If we couldn't find it with improved logic, try the old .gs: pattern
    if (moduleName === 'unknown') {
      for (let line of stackLines) {
        if (line.includes('.gs:')) {
          const match = line.match(/([^/\\]+)\.gs:/);
          if (match) {
            moduleName = match[1];
            break;
          }
        }
      }
    }
    
    // If still unknown, try to extract from function names in the stack
    if (moduleName === 'unknown') {
      for (let line of stackLines) {
        // Look for function names that might indicate module context
        if (line.includes('_main')) {
          // Extract potential module name from context
          const contextMatch = line.match(/at\s+(\w+)\._main/);
          if (contextMatch) {
            moduleName = contextMatch[1];
            break;
          }
        }
      }
    }
  } catch (e) {
    // Fallback to generated name
    moduleName = `module_${Object.keys(globalThis.__modules).length + 1}`;
  }
  
  return globalThis.__modules && globalThis.__modules[moduleName] 
         ? globalThis.__modules[moduleName] 
         : { exports: {} };
}

// Make the helper function globally available
globalThis.__getCurrentModule = __getCurrentModule;

/**
 * Register a function in the global registry
 * @param {string} name - Function name
 * @param {Function} func - Function to register
 * @param {string} modulePath - Path/identifier of the module containing the function
 */
function registerFunction(name, func, modulePath = 'unknown') {
  if (typeof func === 'function') {
    globalThis.__FUNCTION_REGISTRY[name] = {
      func: func,
      module: modulePath,
      registeredAt: new Date().toISOString()
    };
    console.log(`📝 Registered function '${name}' from module '${modulePath}'`);
  }
}

/**
 * Get a registered function by name
 * @param {string} name - Function name
 * @returns {Function|null} The registered function or null if not found
 */
function getRegisteredFunction(name) {
  const entry = globalThis.__FUNCTION_REGISTRY[name];
  return entry ? entry.func : null;
}

/**
 * Get all registered functions
 * @returns {Object} Object containing all registered functions
 */
function getAllRegisteredFunctions() {
  return Object.fromEntries(
    Object.entries(globalThis.__FUNCTION_REGISTRY).map(([name, entry]) => [name, entry.func])
  );
}

/**
 * Clear the function registry
 */
function clearFunctionRegistry() {
  globalThis.__FUNCTION_REGISTRY = {};
}

/**
 * Register current global functions (DISABLED to prevent built-in function pollution)
 * This function is intentionally disabled to prevent registering built-in JavaScript functions
 */
function registerCurrentGlobalFunctions() {
  // DISABLED: This function was causing registration of 74+ built-in JavaScript functions
  // Instead, use explicit registration via exports in _main() functions
  console.log("[FUNCTION REGISTRY] Auto-registration disabled to prevent built-in function pollution");
}

/**
 * List all registered functions with metadata
 * @returns {Array} Array of function metadata objects
 */
function listRegisteredFunctions() {
  return Object.entries(globalThis.__FUNCTION_REGISTRY).map(([name, entry]) => ({
    name: name,
    module: entry.module,
    registeredAt: entry.registeredAt
  }));
}

/**
 * Execute a registered function by name
 * @param {string} name - Function name
 * @param {...any} args - Arguments to pass to the function
 * @returns {any} Function result
 */
function executeRegisteredFunction(name, ...args) {
  const func = getRegisteredFunction(name);
  if (!func) {
    throw new Error(`Function '${name}' not found in registry`);
  }
  return func(...args);
}

/**
 * Register all exported functions from a module
 * @param {Object} moduleExports - Module exports object
 * @param {string} modulePath - Module path/name
 */
function registerModuleFunctions(moduleExports, modulePath) {
  if (!moduleExports || typeof moduleExports !== 'object') return;
  
  Object.entries(moduleExports).forEach(([name, func]) => {
    if (typeof func === 'function') {
      registerFunction(name, func, modulePath);
    }
  });
}

/**
 * Require function for module loading
 * @param {string} moduleName - Name of the module to require
 * @returns {Object} Module exports
 */
function require(moduleName) {
  // Check for circular dependencies
  if (globalThis.__requireStack.includes(moduleName)) {
    throw new Error(`Circular dependency detected: ${globalThis.__requireStack.join(' -> ')} -> ${moduleName}`);
  }
  
  // Check if module is already loaded
  if (globalThis.__modules[moduleName]) {
    return globalThis.__modules[moduleName].exports;
  }
  
  throw new Error(`Module '${moduleName}' not found. Available modules: ${Object.keys(globalThis.__modules).join(', ')}`);
}

/**
 * Define a module with explicit name or automatic detection
 * @param {Function} mainFunction - The _main function that defines the module
 * @param {string} [explicitName] - Optional explicit module name
 */
function __defineModule__(mainFunction, explicitName) {
  if (typeof mainFunction !== 'function') {
    throw new Error('__defineModule__ requires a function parameter');
  }
  
  let moduleName = explicitName || 'unknown';
  
  // If no explicit name provided, try to detect from call stack
  if (!explicitName) {
    // Use enhanced detection (automatically excludes infrastructure files)
    moduleName = __detectModuleName__();
  }
  
  // Create module object
  const module = { exports: {} };
  
  // Register module
  globalThis.__modules[moduleName] = module;
  
  // Add to require stack
  globalThis.__requireStack.push(moduleName);
  
  try {
    // Execute the main function
    mainFunction(module, module.exports, require);
    
    // Register all exported functions
    registerModuleFunctions(module.exports, moduleName);
    
    console.log(`📦 Module '${moduleName}' loaded with ${Object.keys(module.exports).length} exports`);
    
  } finally {
    // Remove from require stack
    globalThis.__requireStack.pop();
  }
  
  return module.exports;
}

// Make require globally available
globalThis.require = require;

/**
 * Enhanced module name detection using excluded file names
 * @returns {string} Detected module name
 */
function __detectModuleName__() {
  // File names that should be excluded from module name detection
  const excludedFileNames = [
    '0_shim',           // Infrastructure shim
    '__mcp_gas_run',    // MCP execution runtime
    'anonymous',        // Anonymous functions
    'eval',             // Eval contexts
    'appsscript'        // Apps Script manifest
  ];
  
  try {
    const error = new Error();
    const stack = error.stack || '';
    const stackLines = stack.split('\n');
    
    // Look for (ModuleName:line:col) pattern in stack trace
    for (let line of stackLines) {
      const match = line.match(/\(([^/:]+):\d+:\d+\)/);
      if (match) {
        const detectedName = match[1];
        
        // Skip internal system names and excluded file names
        if (!detectedName.startsWith('__') && 
            !excludedFileNames.includes(detectedName) &&
            !detectedName.startsWith('eval at')) {
          
          return detectedName;
        }
      }
    }
    
    // Fallback: try .gs: pattern
    for (let line of stackLines) {
      if (line.includes('.gs:')) {
        const match = line.match(/([^/\\]+)\.gs:/);
        if (match) {
          const detectedName = match[1];
          if (!excludedFileNames.includes(detectedName)) {
            return detectedName;
          }
        }
      }
    }
    
    // Final fallback: generate unique name
    return `module_${Object.keys(globalThis.__modules).length + 1}`;
    
  } catch (e) {
    return `module_${Object.keys(globalThis.__modules).length + 1}`;
  }
}

/**
 * Debug version that returns detailed analysis
 * @returns {Object} Debug information about name detection
 */
function __detectModuleNameDebug__() {
  // File names that should be excluded from module name detection
  const excludedFileNames = [
    '0_shim',           // Infrastructure shim
    '__mcp_gas_run',    // MCP execution runtime
    'anonymous',        // Anonymous functions
    'eval',             // Eval contexts
    'appsscript'        // Apps Script manifest
  ];
  
  const debug = {
    excludedFileNames: excludedFileNames,
    stackLines: [],
    patternMatches: [],
    excludedMatches: [],
    finalName: 'unknown',
    detectionMethod: 'none'
  };
  
  try {
    const error = new Error();
    const stack = error.stack || '';
    const stackLines = stack.split('\n');
    debug.stackLines = stackLines;
    
    // Look for (ModuleName:line:col) pattern in stack trace
    for (let line of stackLines) {
      const match = line.match(/\(([^/:]+):\d+:\d+\)/);
      if (match) {
        const detectedName = match[1];
        debug.patternMatches.push({ line, detectedName });
        
        // Skip internal system names and excluded file names
        if (!detectedName.startsWith('__') && 
            !excludedFileNames.includes(detectedName) &&
            !detectedName.startsWith('eval at')) {
          
          debug.finalName = detectedName;
          debug.detectionMethod = 'parentheses_pattern';
          return debug;
        } else {
          debug.excludedMatches.push({ 
            detectedName, 
            reason: detectedName.startsWith('__') ? 'starts_with_underscore' :
                   excludedFileNames.includes(detectedName) ? 'excluded_filename' :
                   'eval_context'
          });
        }
      }
    }
    
    // Fallback: try .gs: pattern
    for (let line of stackLines) {
      if (line.includes('.gs:')) {
        const match = line.match(/([^/\\]+)\.gs:/);
        if (match) {
          const detectedName = match[1];
          if (!excludedFileNames.includes(detectedName)) {
            debug.finalName = detectedName;
            debug.detectionMethod = 'gs_pattern';
            return debug;
          } else {
            debug.excludedMatches.push({ 
              detectedName, 
              reason: 'excluded_filename'
            });
          }
        }
      }
    }
    
    // Final fallback: generate unique name
    debug.finalName = `module_${Object.keys(globalThis.__modules).length + 1}`;
    debug.detectionMethod = 'generated';
    
  } catch (e) {
    debug.error = e.message;
    debug.finalName = `module_${Object.keys(globalThis.__modules).length + 1}`;
    debug.detectionMethod = 'error_fallback';
  }
  
  return debug;
}

// Export detection functions from 0_shim
globalThis.__detectModuleName__ = __detectModuleName__;
globalThis.__detectModuleNameDebug__ = __detectModuleNameDebug__;

// 📚 See documentation above for proper _main() patterns
function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  // Export all registry and module functions
  exports.registerFunction = registerFunction;
  exports.getRegisteredFunction = getRegisteredFunction;
  exports.getAllRegisteredFunctions = getAllRegisteredFunctions;
  exports.clearFunctionRegistry = clearFunctionRegistry;
  exports.registerCurrentGlobalFunctions = registerCurrentGlobalFunctions;
  exports.listRegisteredFunctions = listRegisteredFunctions;
  exports.executeRegisteredFunction = executeRegisteredFunction;
  exports.registerModuleFunctions = registerModuleFunctions;
  
  // Export enhanced detection functions
  exports.__detectModuleName__ = __detectModuleName__;
  exports.__detectModuleNameDebug__ = __detectModuleNameDebug__;
  
  console.log("🔧 Module system and function registry initialized");
}

// Initialize the shim module with explicit name (ONLY 0_shim uses explicit naming)
__defineModule__(_main, '0_shim');