/**
 * Content Analyzer Utility
 *
 * Shared utility for analyzing GAS file content to detect common issues and patterns.
 * Used by WriteTool, EditTool, and AiderTool to provide runtime hints to LLMs.
 *
 * @module contentAnalyzer
 */

import { isManifestFile } from './fileHelpers.js';
import { type ModuleOptions } from './moduleWrapper.js';
export type { ModuleOptions };

/**
 * Analysis result containing warnings (critical issues) and hints (suggestions)
 */
export interface AnalysisResult {
  warnings: string[];
  hints: string[];
}

/**
 * Determine file type from filename and content
 *
 * Priority: manifest check → filename extension → content patterns → default SERVER_JS
 *
 * @param filename - The filename (with or without extension)
 * @param content - The file content
 * @returns 'JSON' | 'HTML' | 'SERVER_JS'
 */
export function determineFileType(filename: string, content: string): string {
  if (isManifestFile(filename)) {
    return 'JSON';
  }

  // Check filename extension first (strongest signal)
  const lowerFilename = filename.toLowerCase();
  if (lowerFilename.endsWith('.html') || lowerFilename.endsWith('.htm')) {
    return 'HTML';
  }
  if (lowerFilename.endsWith('.json')) {
    return 'JSON';
  }

  const trimmed = content.trim();
  const trimmedLower = trimmed.toLowerCase();

  // Expanded HTML detection patterns
  if (trimmedLower.startsWith('<!doctype') ||
      trimmedLower.startsWith('<html') ||
      trimmedLower.startsWith('<?xml') ||
      /^<style[\s>]/i.test(trimmed) ||
      /^<head[\s>]/i.test(trimmed) ||
      /^<body[\s>]/i.test(trimmed) ||
      /^\s*<\?!?=/.test(trimmed)) {  // GAS scriptlets
    return 'HTML';
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return 'JSON';
  }

  return 'SERVER_JS';
}

/**
 * Result from content/fileType mismatch detection
 */
export interface FileTypeMismatch {
  mismatch: boolean;
  detectedType: string;
  message: string;
}

/**
 * Detect if content type doesn't match declared fileType
 *
 * CONSERVATIVE APPROACH: Only blocks when we're highly confident
 * content is HTML but user declared SERVER_JS. This prevents
 * the dangerous case of CommonJS wrappers being applied to HTML.
 *
 * Also blocks appsscript filename with SERVER_JS (must be JSON - it's the manifest).
 *
 * NOTE: We do NOT block general JSON content with SERVER_JS because:
 * - Per GAS API docs, JSON type is ONLY for the manifest (appsscript.json)
 * - JSON content in SERVER_JS files is valid (e.g., config objects in JS modules)
 *
 * @param content - The file content to analyze
 * @param declaredFileType - User-provided fileType (SERVER_JS, HTML, JSON)
 * @param filename - Filename for context (e.g., 'appsscript' is always JSON)
 * @returns Mismatch info if dangerous mismatch detected, null if OK
 */
export function detectContentFileTypeMismatch(
  content: string,
  declaredFileType: string,
  filename: string
): FileTypeMismatch | null {
  // Only check if user declares SERVER_JS - that's the only dangerous case
  // (wrapping HTML with CommonJS breaks the file)
  if (declaredFileType !== 'SERVER_JS') {
    return null;
  }

  // DEFENSIVE: Filename extension is authoritative - block obvious mistakes
  const lowerFilename = filename.toLowerCase();
  if (lowerFilename.endsWith('.html') || lowerFilename.endsWith('.htm')) {
    return {
      mismatch: true,
      detectedType: 'HTML',
      message: 'File has .html extension but fileType is SERVER_JS. ' +
               'HTML files cannot have CommonJS wrappers. ' +
               'Use raw_write() for HTML files or omit fileType for auto-detection.'
    };
  }

  // Special case: appsscript.json is always JSON (it's the manifest)
  if (isManifestFile(filename)) {
    return {
      mismatch: true,
      detectedType: 'JSON',
      message: 'appsscript.json is the manifest file and must be JSON type. ' +
               'Use fileType: "JSON" or omit fileType for auto-detection.'
    };
  }

  const trimmedLower = content.trim().toLowerCase();

  // Check for unambiguous HTML patterns (conservative)
  if (trimmedLower.startsWith('<!doctype') ||
      trimmedLower.startsWith('<html') ||
      trimmedLower.startsWith('<?xml')) {
    return {
      mismatch: true,
      detectedType: 'HTML',
      message: 'Content appears to be HTML but fileType is SERVER_JS. ' +
               'HTML files cannot have CommonJS wrappers (would break the HTML). ' +
               'Use fileType: "HTML" or omit fileType for auto-detection.'
    };
  }

  // Check for additional HTML patterns (CSS, inline scripts, GAS scriptlets)
  // All patterns anchored with ^ to avoid false positives on .gs files with HTML in strings
  if (/^<style[\s>]/i.test(content) ||
      /^<script[\s>]/i.test(content) ||
      /^<head[\s>]/i.test(content) ||
      /^<body[\s>]/i.test(content) ||
      /^\s*<\?!?=/.test(content)) {  // GAS scriptlets
    return {
      mismatch: true,
      detectedType: 'HTML',
      message: 'Content contains HTML patterns but fileType is SERVER_JS. ' +
               'Use raw_write() for HTML files or omit fileType for auto-detection.'
    };
  }

  return null;
}

/**
 * Strip JavaScript comments from content to prevent false positives in pattern detection
 * Removes both single-line (//) and multi-line comments
 *
 * @param content - The JavaScript content to strip comments from
 * @returns Content with comments removed
 */
export function stripJsComments(content: string): string {
  // Remove multi-line comments first (non-greedy)
  let clean = content.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove single-line comments (but preserve URLs like http://)
  clean = clean.replace(/(?<!:)\/\/.*$/gm, '');
  return clean;
}

/**
 * Analyze HTML content for common issues and patterns
 * Detects include() in comments (which still execute!) and recommends gas_client pattern
 *
 * @param content - The HTML content to analyze
 * @returns Analysis result with warnings and hints
 */
export function analyzeHtmlContent(content: string): AnalysisResult {
  const warnings: string[] = [];
  const hints: string[] = [];

  // Check for include() in comments - these STILL execute in GAS!
  // Pattern: HTML comments (<!-- -->), JS single-line (//), JS multi-line (/* */)
  const commentPatterns = [
    /<!--[\s\S]*?-->/g,           // HTML comments
    /\/\/.*$/gm,                   // JS single-line comments
    /\/\*[\s\S]*?\*\//g            // JS multi-line comments
  ];

  for (const pattern of commentPatterns) {
    const matches = content.match(pattern) || [];
    for (const comment of matches) {
      if (/\<\?!?=\s*(include|includeNested)\s*\([\s\S]*?\)\s*\?>/.test(comment)) {
        warnings.push(
          'CRITICAL: include()/includeNested() found inside a comment. ' +
          'GAS scriptlets (<?= ?>, <?!= ?>) are evaluated server-side BEFORE HTML parsing. ' +
          'Comment syntax does NOT prevent execution. Remove the scriptlet or move outside comment.'
        );
        break; // One warning is enough
      }
    }
    // If we already added a warning, no need to check other patterns
    if (warnings.length > 0) break;
  }

  // Check for google.script.run usage and recommend gas_client
  if (/google\.script\.run\b/.test(content)) {
    hints.push(
      'Consider using the Promise-based gas_client pattern instead of google.script.run. ' +
      'Benefits: async/await support, cancellation, polling, network checking. ' +
      'Usage: window.server.exec_api(null, module, func, params).then(cb).catch(err). ' +
      'See: CLAUDE.md "Client-Side HTML Pattern" section.'
    );
  }

  // Check for HTML files that look like they need server communication
  if (/<script\b/i.test(content) && !(/google\.script\.run\b/.test(content) || /window\.server\b/.test(content))) {
    // Has scripts but no server communication pattern detected
    if (/fetch\s*\(|XMLHttpRequest|axios|ajax/i.test(content)) {
      hints.push(
        'Detected fetch/XHR patterns. For GAS, use google.script.run or the gas_client pattern ' +
        '(window.server) instead of HTTP requests. GAS runs in a sandboxed environment.'
      );
    }
  }

  // Check for template literals with URLs (cause "Unexpected end of input" errors in GAS includes)
  if (/`[^`]*:\/\/[^`]*`/.test(content)) {
    warnings.push(
      'Template literal containing "://" detected. In GAS HTML includes, this causes ' +
      '"Unexpected end of input" errors. Use string concatenation: "https:" + "//example.com"'
    );
  }

  // Check for CommonJS patterns in HTML (wrong file type)
  if (/\brequire\s*\(['"]/.test(content) || /module\.exports\s*[.=]/.test(content)) {
    warnings.push(
      'CommonJS pattern (require/module.exports) detected in HTML file. ' +
      'HTML files use scriptlets (<?= ?>) not CommonJS. For server calls, use window.server.exec_api().'
    );
  }

  return { warnings, hints };
}

/**
 * Analyze CommonJS/SERVER_JS content for common issues and patterns
 * Detects missing loadNow for event handlers, missing __events__ registration, duplicate _main()
 *
 * **Analysis Performed:**
 * 1. Event handlers (doGet/doPost/onOpen/onEdit/onInstall) without loadNow: true
 * 2. Missing __events__ registration for handler functions
 * 3. Duplicate _main() functions (nested wrappers)
 * 4. __defineModule__ inside _main() (wrong placement)
 * 5. Direct globalThis assignment instead of __global__ pattern
 * 6. console.log() usage (silently discarded in GAS)
 * 7. Hardcoded API keys (security risk)
 * 8. JSON.parse without try-catch
 * 9. ConfigManager sensitive keys with wrong scope
 * 10. Direct PropertiesService usage (suggest ConfigManager)
 * 11. Logger.log() usage (bypasses module-level logging controls)
 *
 * **Limitations:**
 * - Comments are stripped before analysis (may lose context)
 * - Works best on formatted (non-minified) code
 * - May miss dynamically generated handlers
 *
 * @param content - The JavaScript content to analyze (comments will be stripped)
 * @param moduleOptions - Optional moduleOptions passed to write operation
 * @param filename - Optional filename for better system file detection
 * @returns Analysis result with warnings and hints
 */
export function analyzeCommonJsContent(
  content: string,
  moduleOptions?: ModuleOptions,
  filename?: string
): AnalysisResult {
  const warnings: string[] = [];
  const hints: string[] = [];

  // Strip comments to prevent false positives from JSDoc examples
  const cleanContent = stripJsComments(content);

  // Better system file detection using filename
  const isSystemFile = filename && (
    filename.includes('common-js/') ||
    filename === 'require.gs' ||
    filename === 'require' ||
    filename.startsWith('__mcp_exec/')
  );

  // Infrastructure file detection for PropertiesService check
  const isInfrastructureFile = filename && (
    filename.includes('require') ||
    filename.includes('ConfigManager') ||
    filename.includes('common-js/')
  );

  // Improved __events__ detection (handles all variants)
  const hasEventsExport =
    /module\.exports\.__events__/.test(cleanContent) ||     // module.exports.__events__
    /\bexports\.__events__/.test(cleanContent) ||           // exports.__events__
    /__events__\s*:/.test(cleanContent);                    // Object literal style

  // DRY approach: Detect all handlers with improved patterns (includes arrow functions, method shorthand)
  const HANDLER_NAMES = ['doGet', 'doPost', 'onOpen', 'onEdit', 'onInstall'];
  const detectedHandlers: string[] = [];

  for (const name of HANDLER_NAMES) {
    // Function declaration: function doGet(
    const funcDecl = new RegExp(`\\bfunction\\s+${name}\\s*\\(`);
    // Variable assignment: const/let/var doGet = (handles no space before =)
    const varAssign = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`);
    // ES6 method shorthand in exports: doGet( or doGet (
    const methodShort = new RegExp(`(?<!\\.)\\b${name}\\s*\\(`);

    if (funcDecl.test(cleanContent) || varAssign.test(cleanContent)) {
      detectedHandlers.push(name);
    }
  }

  const hasEventHandler = detectedHandlers.length > 0;

  // Check 1: Event handlers / __global__ without loadNow: true
  const hasGlobalExports =
    /module\.exports\.__global__\s*=/.test(cleanContent) ||
    /__global__\s*:/.test(cleanContent);

  const loadNowSet = moduleOptions?.loadNow === true;

  if ((hasEventHandler || hasEventsExport || hasGlobalExports) && !loadNowSet) {
    warnings.push(
      'CRITICAL: `__global__` or `__events__` detected without `loadNow: true`. ' +
      'Menu handlers and event dispatchers will silently fail at runtime. ' +
      'Add `loadNow: true` to your write call AND ensure this file is ' +
      'positioned LAST in the project file order.'
    );
  }

  if (loadNowSet) {
    hints.push(
      'This module uses `loadNow: true`. It must be positioned LAST in the GAS ' +
      'file order — all dependencies must parse before this module executes. ' +
      'Use `mcp__gas__reorder` to move it to the last position if not already there.'
    );
  }

  // Check 2: Event handler functions defined but not registered in __events__
  if (detectedHandlers.length > 0 && !hasEventsExport) {
    warnings.push(
      `CRITICAL: Event handler function(s) detected [${detectedHandlers.join(', ')}] but not registered ` +
      'in module.exports.__events__. These handlers will not execute. ' +
      `Add: module.exports.__events__ = { ${detectedHandlers.map(h => `${h}: '${h}'`).join(', ')} }`
    );
  }

  // Check 3: Duplicate _main() functions (nested wrappers)
  const mainMatches = cleanContent.match(/function\s+_main\s*\(/g);
  if (mainMatches && mainMatches.length > 1) {
    warnings.push(
      'CRITICAL: Multiple _main() functions detected (' + mainMatches.length + ' occurrences). ' +
      'Only the outer _main() executes; inner code never runs. ' +
      'This usually happens when code is double-wrapped. Remove the extra wrapper.'
    );
  }

  // Check 4: __defineModule__ inside _main() (common mistake)
  // Use balanced brace counting for robust detection
  const mainFunctionMatch = cleanContent.match(/function\s+_main\s*\([^)]*\)\s*\{/);
  if (mainFunctionMatch) {
    const startPos = mainFunctionMatch.index! + mainFunctionMatch[0].length;
    let braceCount = 1;
    let endPos = startPos;

    // Find matching closing brace
    for (let i = startPos; i < cleanContent.length && braceCount > 0; i++) {
      if (cleanContent[i] === '{') braceCount++;
      if (cleanContent[i] === '}') braceCount--;
      endPos = i;
    }

    const mainBody = cleanContent.substring(startPos, endPos);

    if (/__defineModule__\s*\(/.test(mainBody)) {
      warnings.push(
        'CRITICAL: __defineModule__() found inside _main() function body. ' +
        '__defineModule__ must be called at ROOT LEVEL, after the closing brace of _main(). ' +
        'Module registration will fail with current placement.'
      );
    }
  }

  // Check 5: Direct globalThis assignment instead of __global__ pattern
  if (/globalThis\.\w+\s*=/.test(cleanContent) && !isSystemFile) {
    const hasGlobalExport = /__global__\s*:/.test(cleanContent) || /module\.exports\.__global__/.test(cleanContent);
    if (!hasGlobalExport) {
      hints.push(
        'Direct globalThis assignment detected. For proper CommonJS compliance, ' +
        'use module.exports.__global__ = { funcName } instead of globalThis.funcName = ... ' +
        'This ensures globals are properly managed by the module system.'
      );
    }
  }

  // Check 6: console.log() usage (silently discarded in GAS)
  if (/\bconsole\.(log|warn|error|info|debug)\s*\(/.test(cleanContent)) {
    hints.push(
      'GAS uses Logger.log() instead of console.log(). Console output is silently discarded. ' +
      'For module logging, use the "log" parameter: _main(module, exports, log) { log("message"); }'
    );
  }

  // Check 7: Hardcoded API keys (security risk)
  // Length requirements prevent false positives from partial prefixes
  const apiKeyPatterns = [
    /sk-ant-api[a-zA-Z0-9_-]{20,}/,  // Anthropic: prefix + min 20 chars
    /sk-proj-[a-zA-Z0-9_-]{20,}/,    // OpenAI: prefix + min 20 chars
    /AIza[a-zA-Z0-9_-]{35}/,         // Google: fixed 39 chars total
  ];
  if (apiKeyPatterns.some(p => p.test(cleanContent))) {
    hints.push(
      'Hardcoded API key detected. Keys in source code are visible in git history and deployments. ' +
      'Consider: ConfigManager.setUser("API_KEY", value) for user-scoped storage.'
    );
  }

  // Check 8: JSON.parse without try-catch (leads to confusing errors)
  // Note: Simple heuristic - may miss cases with multiple statements between try { and JSON.parse
  if (/JSON\.parse\s*\(/.test(cleanContent)) {
    const hasTryCatchAroundParse = /try\s*\{[^}]*JSON\.parse/.test(cleanContent);
    if (!hasTryCatchAroundParse) {
      hints.push(
        'JSON.parse() detected without surrounding try-catch. Corrupted stored data causes ' +
        'confusing "undefined is not an object" errors. Consider defensive parsing.'
      );
    }
  }

  // Check 9: ConfigManager sensitive key in script-wide scope
  if (/config\.(set|setScript)\s*\(\s*['"]?(API_KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL)/i.test(cleanContent)) {
    hints.push(
      'Sensitive key detected with script-wide scope. Use config.setUser() instead of ' +
      'config.set()/setScript() to ensure privacy - script scope is visible to all users.'
    );
  }

  // Check 10: Direct PropertiesService usage (context-aware hint)
  // Skip infrastructure files where PropertiesService is appropriate
  if (!isInfrastructureFile && /PropertiesService\.(getScriptProperties|getUserProperties|getDocumentProperties)\s*\(\s*\)/.test(cleanContent)) {
    hints.push(
      'Direct PropertiesService usage detected. Use require(\'gas-properties/ConfigManager\') instead — ' +
      'provides hierarchical scope priority, caching, and namespace management. ' +
      'PropertiesService is only appropriate in standalone scripts without CommonJS.'
    );
  }

  // Check 11: Logger.log() usage (bypasses module-level logging controls)
  // Skip infrastructure files where Logger is used directly in the runtime
  if (!isInfrastructureFile && /\bLogger\.(log|info|warning|severe)\s*\(/.test(cleanContent)) {
    hints.push(
      'Logger.log() bypasses module-level logging controls. Use the injected "log" parameter instead: ' +
      '_main(module, exports, log) { log("message"); } — enables setModuleLogging() per-module control.'
    );
  }

  return { warnings, hints };
}

/**
 * Analyze appsscript.json manifest and provide helpful hints
 *
 * When the manifest contains oauthScopes, reminds the user that scope changes
 * may require re-authentication since MCP caches OAuth tokens.
 *
 * @param content - The JSON content of appsscript.json
 * @returns Analysis result with hints about scope changes
 */
export function analyzeManifestContent(content: string): AnalysisResult {
  const warnings: string[] = [];
  const hints: string[] = [];

  try {
    const manifest = JSON.parse(content);

    // If manifest has oauthScopes, remind about re-auth
    if (manifest.oauthScopes && manifest.oauthScopes.length > 0) {
      hints.push(
        'appsscript.json updated with oauthScopes. If scopes changed, ' +
        'run auth({mode:\'start\'}) to re-authenticate with the new scopes.'
      );
    }
  } catch {
    // JSON parse failed - skip analysis
  }

  return { warnings, hints };
}

/**
 * Analyze content based on file type
 * Convenience function that determines file type and calls appropriate analyzer
 *
 * @param filename - The filename
 * @param content - The file content
 * @param moduleOptions - Optional module options for CommonJS analysis
 * @returns Analysis result with warnings and hints
 */
export function analyzeContent(
  filename: string,
  content: string,
  moduleOptions?: ModuleOptions
): AnalysisResult {
  const fileType = determineFileType(filename, content);

  if (fileType === 'HTML') {
    return analyzeHtmlContent(content);
  } else if (fileType === 'SERVER_JS') {
    return analyzeCommonJsContent(content, moduleOptions, filename);
  }

  // JSON files - analyze manifest for scope hints
  if (fileType === 'JSON' && isManifestFile(filename)) {
    return analyzeManifestContent(content);
  }

  return { warnings: [], hints: [] };
}
