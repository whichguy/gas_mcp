/**
 * Module wrapper utilities for automatic _main() wrapping and unwrapping
 * Used by gas_write and gas_cat to make the CommonJS module system transparent
 *
 * IMPORTANT: This utility ensures __defineModule__(_main) is called WITHOUT explicit module names
 * to use auto-detection. Explicit names are RESERVED for CommonJS system module only.
 *
 * COMMONJS INTEGRATION: All SERVER_JS files automatically get access to:
 * - require() function (globally available - no parameter needed!)
 * - module object for module metadata and exports management
 * - exports object as shorthand for module.exports
 * See CommonJS.js for the underlying implementation details.
 *
 * MODULE SIGNATURE:
 * - NEW (2-param): function _main(module, exports) { ... }
 * - OLD (3-param): function _main(module, exports, require) { ... } (still supported for backward compat)
 *
 * The wrapping system generates the new 2-param signature.
 * The unwrapping system handles BOTH signatures transparently.
 */

/**
 * CommonJS feature analysis patterns
 */
const commonJsPatterns = {
  // CommonJS wrapper patterns to detect and remove:
  mainFunction: /function\s+_main\s*\(/,
  mainParameters: /module\s*=\s*globalThis\.__getCurrentModule\(\)/,
  defineModule: /__defineModule__\(\s*_main/,
  
  // CommonJS features to preserve and document:
  requireCalls: /require\s*\(\s*['"`][^'"`]+['"`]\s*\)/g,
  moduleExports: /module\.exports\s*=/g,
  exportsUsage: /exports\.[a-zA-Z_$][a-zA-Z0-9_$]*\s*=/g,
  
  // Patterns that indicate problematic explicit naming:
  explicitModuleName: /__defineModule__\(\s*_main\s*,\s*['"`]([^'"`]+)['"`]\s*\)/
};

/**
 * Analysis result for CommonJS feature usage in user code
 */
interface CommonJsAnalysis {
  requireCalls: string[];
  moduleExports: boolean;
  exportsUsage: string[];
  hasModuleDependencies: boolean;
  note: string;
}

/**
 * Hoisted function configuration for Google Sheets custom functions
 */
export interface HoistedFunction {
  name: string;       // Function name
  params: string[];   // Parameter names
  jsdoc?: string;     // Full JSDoc comment (optional)
  delegateTo?: string; // Optional: delegate to this instead of require('module').name()
}

/**
 * Module options that can be passed to __defineModule__
 */
export interface ModuleOptions {
  loadNow?: boolean;
  hoistedFunctions?: HoistedFunction[];  // Functions to hoist for Sheets autocomplete
}

/**
 * Extracts hoisted function definitions from wrapped content
 * Parses the bridge functions between _main() and __defineModule__
 * @param content - The wrapped module content
 * @returns Array of hoisted function definitions, or undefined if none found
 */
function extractHoistedFunctions(content: string): HoistedFunction[] | undefined {
  // Look for the hoisted functions section markers
  const startMarker = '// ===== HOISTED CUSTOM FUNCTIONS (for Google Sheets autocomplete) =====';
  const endMarker = '// ===== END HOISTED CUSTOM FUNCTIONS =====';

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    return undefined;  // No hoisted functions found
  }

  // Extract the content between markers
  const hoistedSection = content.substring(startIdx + startMarker.length, endIdx).trim();

  if (!hoistedSection) {
    return undefined;
  }

  // Parse individual function definitions
  const functions: HoistedFunction[] = [];

  // Match function definitions with optional JSDoc
  // Pattern: (optional JSDoc) function NAME(PARAMS) { ... }
  const functionPattern = /(\/\*\*[\s\S]*?\*\/\s*)?function\s+(\w+)\s*\(([^)]*)\)\s*\{[\s\S]*?\}/g;

  let match;
  while ((match = functionPattern.exec(hoistedSection)) !== null) {
    const jsdoc = match[1]?.trim();
    const name = match[2];
    const paramsStr = match[3].trim();
    const params = paramsStr ? paramsStr.split(',').map(p => p.trim()) : [];

    functions.push({
      name,
      params,
      jsdoc: jsdoc || undefined
    });
  }

  return functions.length > 0 ? functions : undefined;
}

/**
 * Debug information from extraction attempt
 */
export interface ExtractionDebug {
  contentLength: number;
  contentTail: string;
  regexMatched: boolean;
  matchedText?: string;
  optionsString?: string;
  parseError?: string;
  validationFailed?: string;
  result: ModuleOptions | null;
}

/**
 * Content cleaning result with CommonJS integration details
 */
interface CleaningResult {
  cleanedContent: string;
  hadWrappers: boolean;
  warnings: string[];
  commonJsFeatures: {
    hasRequireCalls: boolean;
    hasModuleExports: boolean;
    hasExportsUsage: boolean;
  };
}

/**
 * Analyzes user content for CommonJS feature usage
 * @param content - User provided content to analyze
 * @returns Analysis of CommonJS features used
 */
export function analyzeCommonJsUsage(content: string): CommonJsAnalysis {
  const requireCalls = content.match(commonJsPatterns.requireCalls) || [];
  const moduleExports = commonJsPatterns.moduleExports.test(content);
  const exportsUsage = content.match(commonJsPatterns.exportsUsage) || [];

  return {
    requireCalls: requireCalls.map(call => call.trim()),
    moduleExports,
    exportsUsage: exportsUsage.map(usage => usage.trim()),
    hasModuleDependencies: requireCalls.length > 0,
    note: 'These CommonJS features work because the CommonJS system provides require(), module, and exports automatically'
  };
}

/**
 * Extracts moduleOptions from existing __defineModule__ call with detailed debug info
 * Used to preserve loadNow setting when rewriting files
 *
 * @param wrappedContent - Full wrapped content with __defineModule__ call
 * @returns Debug information about extraction attempt
 */
export function extractDefineModuleOptionsWithDebug(wrappedContent: string): ExtractionDebug {
  const debug: ExtractionDebug = {
    contentLength: wrappedContent.length,
    contentTail: wrappedContent.slice(-150),
    regexMatched: false,
    result: null
  };

  try {
    // Match: __defineModule__(_main, null, { ... })
    const regex = /__defineModule__\s*\(\s*_main\s*(?:,\s*(?:null|'[^']*'|"[^"]*"))?\s*,\s*(\{[^}]*\})\s*\)/;
    const match = wrappedContent.match(regex);

    debug.regexMatched = !!match;

    if (match) {
      debug.matchedText = match[0];
      debug.optionsString = match[1];

      try {
        // Convert JavaScript object literal to valid JSON
        // Replace unquoted keys with quoted keys: loadNow -> "loadNow"
        const jsonString = match[1].replace(/(\w+):/g, '"$1":');
        const options = JSON.parse(jsonString);

        if (typeof options !== 'object' || options === null) {
          debug.validationFailed = `Parsed value is not an object: ${typeof options}`;
          return debug;
        }

        const result: ModuleOptions = {};
        if ('loadNow' in options && typeof options.loadNow === 'boolean') {
          result.loadNow = options.loadNow;
        }

        debug.result = Object.keys(result).length > 0 ? result : null;
        if (!debug.result) {
          debug.validationFailed = 'No valid loadNow boolean found in options';
        }
      } catch (parseError) {
        debug.parseError = parseError instanceof Error ? parseError.message : String(parseError);
      }
    }

    return debug;
  } catch (error) {
    debug.parseError = `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
    return debug;
  }
}

/**
 * Extracts moduleOptions from existing __defineModule__ call
 * Used to preserve loadNow setting when rewriting files
 *
 * @param wrappedContent - Full wrapped content with __defineModule__ call
 * @returns Extracted options or null if none/unparseable
 */
export function extractDefineModuleOptions(wrappedContent: string): ModuleOptions | null {
  try {
    console.error(`🔬 [extractDefineModuleOptions] Starting extraction, content length: ${wrappedContent.length}`);
    console.error(`🔬 [extractDefineModuleOptions] Content tail (last 150 chars): ${wrappedContent.slice(-150)}`);

    // Match: __defineModule__(_main, null, { ... })
    const regex = /__defineModule__\s*\(\s*_main\s*(?:,\s*(?:null|'[^']*'|"[^"]*"))?\s*,\s*(\{[^}]*\})\s*\)/;
    const match = wrappedContent.match(regex);

    console.error(`🔬 [extractDefineModuleOptions] Regex match result: ${match ? 'MATCHED' : 'NO MATCH'}`);
    if (match) {
      console.error(`🔬 [extractDefineModuleOptions] Match[0] (full): ${match[0]}`);
      console.error(`🔬 [extractDefineModuleOptions] Match[1] (options): ${match[1]}`);
    }

    if (!match) {
      console.error(`🔬 [extractDefineModuleOptions] No match found - returning null`);
      return null; // No options found
    }

    const optionsString = match[1];
    console.error(`🔬 [extractDefineModuleOptions] About to parse: ${optionsString}`);

    // Convert JavaScript object literal to valid JSON
    // Replace unquoted keys with quoted keys: loadNow -> "loadNow"
    const jsonString = optionsString.replace(/(\w+):/g, '"$1":');
    console.error(`🔬 [extractDefineModuleOptions] Converted to JSON: ${jsonString}`);

    // Try to parse as JSON
    const options = JSON.parse(jsonString);
    console.error(`🔬 [extractDefineModuleOptions] JSON.parse succeeded: ${JSON.stringify(options)}`);

    // Validate structure
    if (typeof options !== 'object' || options === null) {
      console.error(`🔬 [extractDefineModuleOptions] Invalid type or null - returning null`);
      return null;
    }

    // Extract loadNow if present
    const result: ModuleOptions = {};
    if ('loadNow' in options && typeof options.loadNow === 'boolean') {
      result.loadNow = options.loadNow;
      console.error(`🔬 [extractDefineModuleOptions] Extracted loadNow=${result.loadNow}`);
    } else {
      console.error(`🔬 [extractDefineModuleOptions] No valid loadNow found in options`);
    }

    const finalResult = Object.keys(result).length > 0 ? result : null;
    console.error(`🔬 [extractDefineModuleOptions] Final result: ${JSON.stringify(finalResult)}`);
    return finalResult;

  } catch (error) {
    console.error(`🔬 [extractDefineModuleOptions] ERROR caught: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`🔬 [extractDefineModuleOptions] Error stack: ${error instanceof Error ? error.stack : 'N/A'}`);
    return null;
  }
}

/**
 * Detects and cleans accidentally included CommonJS wrappers from user content.
 * The CommonJS system (see CommonJS.js) automatically provides require(), module, and exports
 * to all user code, so manual wrappers are redundant and can cause conflicts.
 * 
 * @param content - User provided content that may contain accidental wrappers
 * @param filename - Target filename for context
 * @returns Cleaned content ready for proper CommonJS wrapping
 */
export function detectAndCleanContent(content: string, filename: string): CleaningResult {
  const trimmedContent = content.trim();
  const warnings: string[] = [];
  let cleanedContent = trimmedContent;
  let hadWrappers = false;
  
  // Analyze CommonJS features before cleaning
  const commonJsAnalysis = analyzeCommonJsUsage(trimmedContent);
  
  // Check for explicit module name usage (problematic)
  const explicitNameMatch = trimmedContent.match(commonJsPatterns.explicitModuleName);
  if (explicitNameMatch) {
    warnings.push(`Explicit module name "${explicitNameMatch[1]}" removed - CommonJS uses auto-detection for better maintainability`);
    cleanedContent = cleanedContent.replace(commonJsPatterns.explicitModuleName, '__defineModule__(_main)');
    hadWrappers = true;
  }
  
  // Check for complete _main function wrapper
  if (commonJsPatterns.mainFunction.test(trimmedContent)) {
    console.error(`🧹 [COMMONJS] Detected existing _main() function in ${filename} - removing redundant wrapper`);

    // Try to unwrap using existing function
    const { unwrappedContent } = unwrapModuleContent(trimmedContent);
    if (unwrappedContent !== trimmedContent) {
      cleanedContent = unwrappedContent;
      hadWrappers = true;
      warnings.push('Removed duplicate _main() function - CommonJS provides this automatically with require(), module, exports access');
    } else {
      warnings.push('Detected _main() function but could not automatically unwrap - please verify structure');
    }
  }
  
  // Check for standalone __defineModule__ calls
  if (commonJsPatterns.defineModule.test(cleanedContent) && !commonJsPatterns.mainFunction.test(cleanedContent)) {
    console.error(`🧹 [COMMONJS] Detected standalone __defineModule__ call in ${filename} - removing`);
    cleanedContent = cleanedContent.replace(/__defineModule__\([^)]*\);?\s*$/m, '').trim();
    hadWrappers = true;
    warnings.push('Removed standalone __defineModule__ call - CommonJS handles module registration automatically');
  }
  
  // Check for partial wrapper patterns
  if (commonJsPatterns.mainParameters.test(trimmedContent)) {
    console.error(`🧹 [COMMONJS] Detected CommonJS parameter patterns in ${filename} - cleaning`);
    cleanedContent = cleanedContent.replace(/module\s*=\s*globalThis\.__getCurrentModule\(\).*$/gm, '').trim();
    hadWrappers = true;
    warnings.push('Removed CommonJS parameter initialization - system provides require(), module, exports automatically');
  }
  
  // Provide guidance based on content analysis
  if (commonJsAnalysis.hasModuleDependencies && !hadWrappers) {
    console.error(`🔗 [COMMONJS] Code in ${filename} uses require() - will be resolved by CommonJS system when executed`);
  }
  
  if (commonJsAnalysis.moduleExports || commonJsAnalysis.exportsUsage.length > 0) {
    console.error(`📤 [COMMONJS] Code in ${filename} exports functionality - will be available to other modules via require()`);
  }
  
  return {
    cleanedContent,
    hadWrappers,
    warnings,
    commonJsFeatures: {
      hasRequireCalls: commonJsAnalysis.requireCalls.length > 0,
      hasModuleExports: commonJsAnalysis.moduleExports,
      hasExportsUsage: commonJsAnalysis.exportsUsage.length > 0
    }
  };
}

/**
 * Generates hoisted bridge functions for Google Sheets custom function autocomplete
 * These thin wrappers delegate to the module implementation, providing parse-time
 * top-level declarations while maintaining CommonJS organization.
 *
 * IMPORTANT: Event handlers (onOpen, onEdit, etc.) should NOT be hoisted here.
 * They are handled by __gas_triggers.js which provides compile-time declarations
 * that delegate to CommonJS dispatchers (__eventName_dispatcher).
 *
 * @param hoistedFunctions - Array of functions to hoist
 * @param moduleName - Module name for require() calls
 * @returns Generated bridge functions as string, or empty string if none
 */
function generateHoistedBridges(hoistedFunctions: HoistedFunction[] | undefined, moduleName: string): string {
  if (!hoistedFunctions || hoistedFunctions.length === 0) {
    return '';
  }

  // Google Apps Script event handler names that should NOT be hoisted
  // These are handled by __gas_triggers.js with compile-time declarations
  const eventHandlerNames = new Set([
    'onOpen', 'onEdit', 'onInstall', 'onFormSubmit',
    'doGet', 'doPost', 'onSelectionChange'
  ]);

  // Filter out event handlers from hoisted functions
  const customFunctions = hoistedFunctions.filter(fn => {
    if (eventHandlerNames.has(fn.name)) {
      console.error(`⚠️ [HOISTED] Skipping event handler "${fn.name}" - these must be declared in __gas_triggers.js, not hoisted as module functions`);
      return false;
    }
    return true;
  });

  if (customFunctions.length === 0) {
    return '';
  }

  const bridges = customFunctions.map(fn => {
    const paramList = fn.params.join(', ');

    // Default JSDoc with @customfunction if not provided
    const jsdoc = fn.jsdoc || `/**
 * @customfunction
 */`;

    // Use delegateTo if provided, otherwise use require() pattern
    const delegateCall = fn.delegateTo
      ? `${fn.delegateTo}(${paramList})`
      : `require('${moduleName}').${fn.name}(${paramList})`;

    return `${jsdoc}
function ${fn.name}(${paramList}) {
  return ${delegateCall};
}`;
  }).join('\n\n');

  return `
// ===== HOISTED CUSTOM FUNCTIONS (for Google Sheets autocomplete) =====
${bridges}
// ===== END HOISTED CUSTOM FUNCTIONS =====
`;
}

/**
 * Wraps user content with _main() function and __defineModule__ call
 * Provides automatic access to require(), module, and exports via CommonJS system
 * @param content - The user's JavaScript code (should be pre-cleaned)
 * @param moduleName - The name of the module (derived from filename) - used for documentation only
 * @param options - Optional module loading options (e.g., loadNow, hoistedFunctions)
 * @returns Wrapped content with _main() function and appropriate __defineModule__ call
 */
export function wrapModuleContent(
  content: string,
  moduleName: string,
  options?: ModuleOptions | null
): string {
    // Trim any leading/trailing whitespace
    const trimmedContent = content.trim();

    // Determine __defineModule__ call format based on options
    let defineCall: string;

    if (options === null || (options && Object.keys(options).length === 0)) {
      // Explicit null or empty object → no options
      defineCall = '__defineModule__(_main);';
    } else if (options?.loadNow === true) {
      defineCall = '__defineModule__(_main, null, { loadNow: true });';
    } else if (options?.loadNow === false) {
      defineCall = '__defineModule__(_main, null, { loadNow: false });';
    } else {
      // Undefined or no loadNow → default (no options)
      defineCall = '__defineModule__(_main);';
    }

    // If content is empty, create minimal module function
    if (!trimmedContent) {
        return `function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports
) {
    // Empty module - CommonJS provides require() globally
}

${defineCall}`;
    }

    // Check if content already has _main function (should not happen after cleaning)
    const hasMainFunction = /_main\s*\(/.test(trimmedContent);

    if (hasMainFunction) {
        console.error(`⚠️ [COMMONJS] Warning: _main function still present after cleaning - applying minimal processing`);
        // Content already has _main function, just ensure it has __defineModule__ call
        if (!trimmedContent.includes('__defineModule__')) {
            return `${trimmedContent}\n\n${defineCall}`;
        }
        // Replace any existing __defineModule__ call with the new one
        return trimmedContent.replace(
          /__defineModule__\([^)]*\);?/,
          defineCall
        );
    }

    // Generate hoisted bridge functions if specified
    const hoistedBridges = generateHoistedBridges(options?.hoistedFunctions, moduleName);

    // Wrap content with _main function that provides CommonJS integration
    // NOTE: require() is globally available - no parameter needed
    return `function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports
) {
${trimmedContent.split('\n').map(line => line ? `  ${line}` : '').join('\n')}
}
${hoistedBridges}
${defineCall}`;
}

/**
 * Unwraps module content, extracting the inner code and existing options
 * @param content - The wrapped module content
 * @returns Object with unwrapped content and any existing options (including hoisted functions)
 */
export function unwrapModuleContent(content: string): {
  unwrappedContent: string;
  existingOptions: ModuleOptions | null;
} {
    // Extract options and hoisted functions before unwrapping
    const loadNowOption = extractDefineModuleOptions(content);
    const hoistedFunctions = extractHoistedFunctions(content);

    // Combine into existingOptions
    const existingOptions: ModuleOptions | null =
      (loadNowOption || hoistedFunctions)
        ? {
            ...loadNowOption,
            hoistedFunctions
          }
        : null;

    const lines = content.split('\n');

    // Find the _main function start
    let mainStartIndex = -1;
    let mainEndIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('function _main')) {
            mainStartIndex = i;
            break;
        }
    }

    if (mainStartIndex === -1) {
        // No _main function found, return original content
        return {
          unwrappedContent: content,
          existingOptions
        };
    }

    // Find the opening brace of the _main function
    let openBraceIndex = -1;
    for (let i = mainStartIndex; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(') {')) {
            openBraceIndex = i;
            break;
        }
    }

    if (openBraceIndex === -1) {
        // Couldn't find opening brace, return original content
        return {
          unwrappedContent: content,
          existingOptions
        };
    }

    // Find the matching closing brace for the _main function
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = openBraceIndex; i < lines.length; i++) {
        const line = lines[i];

        for (let j = 0; j < line.length; j++) {
            if (line[j] === '{') {
                braceCount++;
                foundOpenBrace = true;
            } else if (line[j] === '}') {
                braceCount--;
                if (foundOpenBrace && braceCount === 0) {
                    mainEndIndex = i;
                    break;
                }
            }
        }

        if (mainEndIndex !== -1) break;
    }

    if (mainEndIndex === -1) {
        // Couldn't find closing brace, return original content
        return {
          unwrappedContent: content,
          existingOptions
        };
    }

    // Extract the inner content (skip the function declaration lines and closing brace line)
    const innerLines = lines.slice(openBraceIndex + 1, mainEndIndex);

    // Remove the 2-space indentation that was added during wrapping
    const unindentedLines = innerLines.map(line => {
        if (line.startsWith('  ')) {
            return line.substring(2);
        }
        return line;
    });

    // Join and trim
    const unwrappedContent = unindentedLines.join('\n').trim();

    return {
      unwrappedContent,
      existingOptions
    };
}

/**
 * Determines if content should be wrapped based on file type and name
 * @param fileType - The file type (SERVER_JS, HTML, JSON)
 * @param fileName - The name of the file
 * @returns True if content should be wrapped
 */
export function shouldWrapContent(fileType: string, fileName: string): boolean {
    // Only wrap SERVER_JS files
    if (fileType !== 'SERVER_JS') {
        return false;
    }
    
    // Don't wrap special system files
    const specialFiles = ['appsscript', 'CommonJS', '__mcp_exec'];
    const baseFileName = fileName.split('/').pop()?.split('.')[0] || '';
    
    return !specialFiles.includes(baseFileName);
}

/**
 * Extracts module name from file path, preserving directory structure
 * @param filePath - The file path (e.g., "scriptId/utils/helpers" or "utils/helpers")
 * @returns The module name with preserved path structure (e.g., "utils/helpers")
 */
export function getModuleName(filePath: string): string {
    const parts = filePath.split('/');
    
    // If path includes a project ID (first part is typically 44+ chars), skip it
    if (parts.length > 1 && parts[0].length > 40) {
        // Return everything after project ID, preserving directory structure
        return parts.slice(1).join('/');
    }
    
    // Otherwise return the full path (no project ID detected)
    return filePath;
} 