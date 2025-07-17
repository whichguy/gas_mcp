/**
 * 0_shim.js template for Google Apps Script projects
 * This file contains the module system and function registry code
 * that gets automatically added to new GAS projects.
 */

export const SHIM_TEMPLATE = `/**
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
 * \`\`\`javascript
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
 * \`\`\`
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
    const stack = new Error().stack;
    if (stack) {
      const lines = stack.split('\\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('at _main')) {
          const match = line.match(/at _main \\(([^:]+):/);
          if (match) {
            moduleName = match[1].split('/').pop() || 'unknown';
            break;
          }
        }
      }
    }
  } catch (e) {
    // Fallback to unknown
  }
  
  if (!globalThis.__modules[moduleName]) {
    globalThis.__modules[moduleName] = { exports: {} };
  }
  
  return globalThis.__modules[moduleName];
}

// Make getCurrentModule available globally
globalThis.__getCurrentModule = __getCurrentModule;

/**
 * CommonJS-style require function
 * @param {string} moduleName - Name of the module to require
 * @returns {Object} Module exports
 */
function require(moduleName) {
  // Check for circular dependencies
  if (globalThis.__requireStack.includes(moduleName)) {
    throw new Error(\`Circular dependency detected: \${globalThis.__requireStack.join(' -> ')} -> \${moduleName}\`);
  }
  
  // Check if module is already loaded
  if (globalThis.__modules[moduleName]) {
    return globalThis.__modules[moduleName].exports;
  }
  
  // Module not found
  throw new Error(\`Module not found: \${moduleName}\`);
}

// Make require available globally
globalThis.require = require;

/**
 * Define a module in the global module system
 * @param {Function} moduleFunction - The _main function of the module
 * @param {string} [explicitName] - Optional explicit module name (only for 0_shim)
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
  
  // Create module object
  const module = { exports: {} };
  globalThis.__modules[moduleName] = module;
  
  // Add to require stack for circular dependency detection
  globalThis.__requireStack.push(moduleName);
  
  try {
    // Execute the module function
    moduleFunction(module, module.exports, require);
  } finally {
    // Remove from require stack
    globalThis.__requireStack.pop();
  }
  
  return module.exports;
}

// Make defineModule available globally
globalThis.__defineModule__ = __defineModule__;

/**
 * Function Registry System
 * Allows registration and retrieval of functions across modules
 */

/**
 * Register a function in the global registry
 * @param {string} name - Function name
 * @param {Function} func - Function to register
 * @param {string} [moduleName] - Module name (auto-detected if not provided)
 */
function registerFunction(name, func, moduleName) {
  if (!moduleName) {
    moduleName = __detectModuleName__();
  }
  
  const fullName = \`\${moduleName}.\${name}\`;
  globalThis.__FUNCTION_REGISTRY[fullName] = func;
  
  console.log(\`📝 Registered function: \${fullName}\`);
}

/**
 * Get a registered function
 * @param {string} name - Function name (can be "module.function" or just "function")
 * @returns {Function|null} The registered function or null if not found
 */
function getRegisteredFunction(name) {
  // Try direct lookup first
  if (globalThis.__FUNCTION_REGISTRY[name]) {
    return globalThis.__FUNCTION_REGISTRY[name];
  }
  
  // Try to find by function name across all modules
  for (const fullName in globalThis.__FUNCTION_REGISTRY) {
    if (fullName.endsWith(\`.\${name}\`)) {
      return globalThis.__FUNCTION_REGISTRY[fullName];
    }
  }
  
  return null;
}

/**
 * Get all registered functions
 * @returns {Object} Object with all registered functions
 */
function getAllRegisteredFunctions() {
  return { ...globalThis.__FUNCTION_REGISTRY };
}

/**
 * Clear the function registry
 */
function clearFunctionRegistry() {
  globalThis.__FUNCTION_REGISTRY = {};
  console.log("🧹 Function registry cleared");
}

/**
 * Register all current global functions
 */
function registerCurrentGlobalFunctions() {
  const moduleName = __detectModuleName__();
  let count = 0;
  
  for (const name in globalThis) {
    if (typeof globalThis[name] === 'function' && !name.startsWith('__') && name !== 'require') {
      registerFunction(name, globalThis[name], moduleName);
      count++;
    }
  }
  
  console.log(\`📋 Registered \${count} global functions from \${moduleName}\`);
}

/**
 * List all registered functions
 * @returns {string[]} Array of function names
 */
function listRegisteredFunctions() {
  return Object.keys(globalThis.__FUNCTION_REGISTRY);
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
    throw new Error(\`Function not found: \${name}\`);
  }
  
  return func(...args);
}

/**
 * Register all exported functions from a module
 * @param {string} moduleName - Module name
 */
function registerModuleFunctions(moduleName) {
  const module = globalThis.__modules[moduleName];
  if (!module) {
    throw new Error(\`Module not found: \${moduleName}\`);
  }
  
  let count = 0;
  for (const name in module.exports) {
    if (typeof module.exports[name] === 'function') {
      registerFunction(name, module.exports[name], moduleName);
      count++;
    }
  }
  
  console.log(\`📦 Registered \${count} functions from module \${moduleName}\`);
}

/**
 * Detect the current module name from stack trace
 * @returns {string} Module name
 */
function __detectModuleName__() {
  try {
    const stack = new Error().stack;
    if (stack) {
      const lines = stack.split('\\n');
      
      // Look for the calling module in the stack
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Skip internal functions
        if (line.includes('__defineModule__') || 
            line.includes('__detectModuleName__') ||
            line.includes('registerFunction') ||
            line.includes('at _main')) {
          continue;
        }
        
        // Look for file references
        const match = line.match(/at \\w+ \\(([^:]+):/);
        if (match) {
          const fileName = match[1].split('/').pop();
          if (fileName && fileName !== 'unknown') {
            return fileName.replace(/\\.gs$/, '');
          }
        }
      }
    }
  } catch (e) {
    // Fallback
  }
  
  return \`module_\${Object.keys(globalThis.__modules).length + 1}\`;
}

/**
 * Debug version of module name detection
 * @returns {Object} Debug information about module detection
 */
function __detectModuleNameDebug__() {
  const debug = {
    stack: null,
    lines: [],
    matches: [],
    finalName: null,
    detectionMethod: 'unknown'
  };
  
  try {
    const stack = new Error().stack;
    debug.stack = stack;
    
    if (stack) {
      const lines = stack.split('\\n');
      debug.lines = lines;
      
      // Look for the calling module in the stack
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Skip internal functions
        if (line.includes('__defineModule__') || 
            line.includes('__detectModuleName__') ||
            line.includes('registerFunction') ||
            line.includes('at _main')) {
          continue;
        }
        
        // Look for file references
        const match = line.match(/at \\w+ \\(([^:]+):/);
        if (match) {
          debug.matches.push({
            line: line,
            match: match[1],
            fileName: match[1].split('/').pop()
          });
          
          const fileName = match[1].split('/').pop();
          if (fileName && fileName !== 'unknown') {
            debug.finalName = fileName.replace(/\\.gs$/, '');
            debug.detectionMethod = 'stack_trace';
            return debug;
          }
        }
      }
    }
    
    // Final fallback: generate unique name
    debug.finalName = \`module_\${Object.keys(globalThis.__modules).length + 1}\`;
    debug.detectionMethod = 'generated';
    
  } catch (e) {
    debug.error = e.message;
    debug.finalName = \`module_\${Object.keys(globalThis.__modules).length + 1}\`;
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
`; 