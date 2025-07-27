/**
 * Module wrapper utilities for automatic _main() wrapping and unwrapping
 * Used by gas_write and gas_cat to make the CommonJS module system transparent
 * 
 * IMPORTANT: This utility ensures __defineModule__(_main) is called WITHOUT explicit module names
 * to use auto-detection. Explicit names are RESERVED for CommonJS system module only.
 * 
 * COMMONJS INTEGRATION: All SERVER_JS files automatically get access to:
 * - require() function for importing other user modules
 * - module object for module metadata and exports management  
 * - exports object as shorthand for module.exports
 * See CommonJS.js for the underlying implementation details.
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
    const unwrapped = unwrapModuleContent(trimmedContent);
    if (unwrapped !== trimmedContent) {
      cleanedContent = unwrapped;
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
 * Wraps user content with _main() function and __defineModule__ call
 * Provides automatic access to require(), module, and exports via CommonJS system
 * @param content - The user's JavaScript code (should be pre-cleaned)
 * @param moduleName - The name of the module (derived from filename) - used for documentation only
 * @returns Wrapped content with _main() function and __defineModule__(_main) call (no explicit name)
 */
export function wrapModuleContent(content: string, moduleName: string): string {
    // Trim any leading/trailing whitespace
    const trimmedContent = content.trim();
    
    // If content is empty, create minimal module function
    if (!trimmedContent) {
        return `function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
    // Empty module - CommonJS provides require(), module, exports automatically
}

__defineModule__(_main);`;
    }
    
    // Check if content already has _main function (should not happen after cleaning)
    const hasMainFunction = /_main\s*\(/.test(trimmedContent);
    
    if (hasMainFunction) {
        console.error(`⚠️ [COMMONJS] Warning: _main function still present after cleaning - applying minimal processing`);
        // Content already has _main function, just ensure it has __defineModule__ call
        if (!trimmedContent.includes('__defineModule__')) {
            return `${trimmedContent}\n\n__defineModule__(_main);`;
        }
        // If it already has __defineModule__ with explicit name, remove the name parameter
        if (trimmedContent.includes('__defineModule__(_main,')) {
            return trimmedContent.replace(/__defineModule__\(_main,\s*'[^']*'\)/, '__defineModule__(_main)');
        }
        return trimmedContent;
    }
    
    // Wrap content with _main function that provides CommonJS integration
    return `function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
${trimmedContent.split('\n').map(line => line ? `  ${line}` : '').join('\n')}
}

__defineModule__(_main);`;
}

/**
 * Unwraps module content, extracting only the inner code from _main() function
 * @param content - The wrapped module content
 * @returns The inner user code without module wrapper
 */
export function unwrapModuleContent(content: string): string {
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
        return content;
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
        return content;
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
        return content;
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
    return unindentedLines.join('\n').trim();
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
    const specialFiles = ['appsscript', 'CommonJS', '__mcp_gas_run'];
    const baseFileName = fileName.split('/').pop()?.split('.')[0] || '';
    
    return !specialFiles.includes(baseFileName);
}

/**
 * Extracts module name from file path, preserving directory structure
 * @param filePath - The file path (e.g., "projectId/utils/helpers" or "utils/helpers")
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