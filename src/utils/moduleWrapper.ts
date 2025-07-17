/**
 * Module wrapper utilities for automatic _main() wrapping and unwrapping
 * Used by gas_write and gas_cat to make the module system transparent
 * 
 * IMPORTANT: This utility ensures __defineModule__(_main) is called WITHOUT explicit module names
 * to use auto-detection. Explicit names are RESERVED for CommonJS system module only.
 */

/**
 * Wraps user content with _main() function and __defineModule__ call
 * @param content - The user's JavaScript code
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
    // Empty module
}

__defineModule__(_main);`;
    }
    
    // Check if content already has _main function
    const hasMainFunction = /_main\s*\(/.test(trimmedContent);
    
    if (hasMainFunction) {
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
    
    // Wrap content with _main function
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
 * Extracts module name from file path
 * @param filePath - The file path (e.g., "projectId/utils/helpers")
 * @returns The module name (e.g., "helpers")
 */
export function getModuleName(filePath: string): string {
    const parts = filePath.split('/');
    return parts[parts.length - 1];
} 