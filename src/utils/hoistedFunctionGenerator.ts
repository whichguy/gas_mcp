/**
 * Hoisted Function Generator - Auto-generates google.script.run bridge functions
 *
 * Parses @hoisted JSDoc annotations and generates top-level bridge functions
 * that delegate to CommonJS module functions using ES6 rest/spread pattern.
 *
 * CRITICAL: google.script.run requires top-level functions. These bridges
 * make module functions accessible to client-side code.
 */

export interface HoistedFunction {
  name: string;
  params: string[];
  jsdoc: string;
  fullJsdoc: string;
  lineNumber: number;
  returnType?: string;
}

/**
 * Extract functions marked with @hoisted from user code
 * Parses JSDoc comments and function declarations
 *
 * @param content - Clean user code (unwrapped, no CommonJS wrappers)
 * @param moduleName - Module name for error messages
 * @returns Array of hoisted function metadata
 */
export function extractHoistedFunctions(content: string, moduleName: string): HoistedFunction[] {
  if (!content) {
    return [];
  }

  const functions: HoistedFunction[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Look for @hoisted annotation in JSDoc
    if (line.trim().includes('@hoisted')) {
      // Found @hoisted - now find the associated function
      // Scan backwards to find the start of the JSDoc comment
      let jsdocStart = i;
      while (jsdocStart > 0 && !lines[jsdocStart].trim().startsWith('/**')) {
        jsdocStart--;
      }

      // Scan forward to find the function declaration
      let funcLine = i + 1;
      while (funcLine < lines.length && !lines[funcLine].trim().match(/^(async\s+)?function\s+\w+/)) {
        funcLine++;
      }

      if (funcLine >= lines.length) {
        console.error(`⚠️ [HOISTED] Found @hoisted at line ${i + 1} but no function declaration follows`);
        continue;
      }

      // Parse the function declaration
      const funcDecl = lines[funcLine].trim();
      const funcMatch = funcDecl.match(/^(async\s+)?function\s+(\w+)\s*\((.*?)\)/);

      if (!funcMatch) {
        console.error(`⚠️ [HOISTED] Could not parse function declaration: ${funcDecl}`);
        continue;
      }

      const [, async, funcName, paramsStr] = funcMatch;
      const params = paramsStr
        .split(',')
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => {
          // Handle rest parameters (...args)
          if (p.startsWith('...')) {
            return p;
          }
          // Extract just the parameter name (remove default values, types)
          const paramName = p.split('=')[0].split(':')[0].trim();
          return paramName;
        });

      // Extract the full JSDoc comment
      const jsdocLines = [];
      for (let j = jsdocStart; j <= i; j++) {
        jsdocLines.push(lines[j]);
      }
      // Continue to closing */ if not found yet
      let j = i + 1;
      while (j < funcLine && !lines[j].trim().includes('*/')) {
        jsdocLines.push(lines[j]);
        j++;
      }
      if (j < funcLine && lines[j].trim().includes('*/')) {
        jsdocLines.push(lines[j]);
      }

      const fullJsdoc = jsdocLines.join('\n');

      // Extract minimal JSDoc for display
      const jsdocContent = fullJsdoc
        .replace(/\/\*\*/, '')
        .replace(/\*\//, '')
        .split('\n')
        .map(l => l.replace(/^\s*\*\s?/, ''))
        .filter(l => l.trim().length > 0 && !l.trim().startsWith('@'))
        .join(' ')
        .trim();

      // Extract return type from @returns or @return
      const returnMatch = fullJsdoc.match(/@returns?\s+\{([^}]+)\}/);
      const returnType = returnMatch ? returnMatch[1] : undefined;

      functions.push({
        name: funcName,
        params,
        jsdoc: jsdocContent,
        fullJsdoc,
        lineNumber: funcLine + 1,
        returnType
      });

      console.error(`✅ [HOISTED] Found @hoisted function: ${funcName} (${params.length} params) at line ${funcLine + 1}`);
    }
  }

  return functions;
}

/**
 * Generate comprehensive pattern documentation header
 * Explains the hoisted function pattern and google.script.run requirements
 */
export function generateHoistedDocumentation(): string {
  return `/**
 * ========================================================================
 * HOISTED FUNCTIONS - google.script.run COMPATIBILITY PATTERN
 * ========================================================================
 *
 * CRITICAL REQUIREMENT:
 * Google Apps Script's google.script.run can ONLY call top-level functions.
 * Functions inside CommonJS modules are NOT accessible to google.script.run.
 *
 * SOLUTION - HOISTED BRIDGE PATTERN:
 * These top-level "hoisted" functions act as bridges that delegate to the
 * actual module functions. They MUST be declared at the global scope.
 *
 * IMPLEMENTATION RULES:
 * 1. ✅ USE: ES6 rest parameters (...args) and spread operator
 * 2. ❌ NEVER USE: .apply(), .bind(), or .call() - breaks google.script.run serialization
 * 3. ✅ PATTERN: function hoisted(...args) { return require('module').func(...args); }
 * 4. ⚠️ CRITICAL: Hoisted functions MUST be declared BEFORE __defineModule__ call
 * 5. 📝 SOURCE: Each hoisted function corresponds to a module function marked with @hoisted
 *
 * WHY ES6 REST/SPREAD INSTEAD OF .apply()?
 * - google.script.run serializes return values for client-server communication
 * - Functions using .apply()/.bind()/.call() return undefined after serialization
 * - ES6 rest/spread pattern preserves return values correctly
 * - Verified working in GAS V8 runtime
 *
 * AUTOMATION:
 * These functions are AUTO-GENERATED from @hoisted annotations in module code.
 * DO NOT modify manually - edit the module function and regenerate.
 *
 * SOURCE MODULES:
 * Module functions marked with @hoisted JSDoc tag will automatically generate
 * corresponding hoisted bridge functions following this exact pattern.
 * ========================================================================
 */`;
}

/**
 * Generate a single hoisted bridge function
 * Creates ES6 rest/spread delegation to module function
 *
 * @param func - Function metadata from @hoisted annotation
 * @param moduleName - CommonJS module name (e.g., "tools/Utils")
 * @returns Generated function code
 */
export function generateHoistedBridge(func: HoistedFunction, moduleName: string): string {
  const { name, params, jsdoc, lineNumber, returnType } = func;

  // Build JSDoc comment for the hoisted function
  const jsdocLines = [
    '/**',
    ` * AUTO-GENERATED from @hoisted annotation`,
    ` * Source: ${name} (module line ~${lineNumber})`,
    ` * Do NOT modify manually - edit module function instead`,
    ` *`,
    ` * ${jsdoc}`
  ];

  // Add param documentation
  if (params.length > 0) {
    params.forEach(param => {
      if (param.startsWith('...')) {
        jsdocLines.push(` * @param {...*} ${param.slice(3)} - Variable arguments`);
      } else {
        jsdocLines.push(` * @param {*} ${param} - Parameter from module function`);
      }
    });
  }

  // Add return documentation
  if (returnType) {
    jsdocLines.push(` * @returns {${returnType}} Result from module function`);
  } else {
    jsdocLines.push(` * @returns {*} Result from module function`);
  }

  jsdocLines.push(' */');

  const jsdocComment = jsdocLines.join('\n');

  // Generate function with ES6 rest/spread pattern
  // CRITICAL: Use ...args pattern, never .apply()/.bind()/.call()
  const functionCode = `function ${name}(...args) {
  return require('${moduleName}').${name}(...args);
}`;

  return `${jsdocComment}\n${functionCode}`;
}

/**
 * Append hoisted functions section to wrapped module content
 * Inserts between the _main closing brace and __defineModule__ call
 *
 * @param wrappedContent - Content already wrapped with _main(module, exports, log)
 * @param functions - Array of hoisted functions to generate
 * @param moduleName - CommonJS module name
 * @returns Content with hoisted section appended
 */
export function appendHoistedSection(
  wrappedContent: string,
  functions: HoistedFunction[],
  moduleName: string
): string {
  if (functions.length === 0) {
    return wrappedContent;
  }

  // Find the __defineModule__ call at the end
  const defineModuleMatch = wrappedContent.match(/__defineModule__\([^)]+\);?\s*$/);

  if (!defineModuleMatch) {
    console.error('⚠️ [HOISTED] Could not find __defineModule__ call, cannot append hoisted functions');
    return wrappedContent;
  }

  const defineModuleCall = defineModuleMatch[0];
  const contentBeforeDefine = wrappedContent.slice(0, wrappedContent.lastIndexOf(defineModuleCall));

  // Generate hoisted section
  const documentation = generateHoistedDocumentation();
  const bridges = functions.map(func => generateHoistedBridge(func, moduleName));

  const hoistedSection = [
    '',
    documentation,
    '',
    ...bridges,
    ''
  ].join('\n');

  // Reconstruct: content + hoisted section + __defineModule__
  const result = `${contentBeforeDefine}${hoistedSection}\n${defineModuleCall}`;

  console.error(`✅ [HOISTED] Generated ${functions.length} hoisted bridge function(s) for ${moduleName}`);

  return result;
}

/**
 * Main entry point - process content for @hoisted annotations
 * Call this after wrapModuleContent() to add hoisted functions
 *
 * @param wrappedContent - Content wrapped with CommonJS module system
 * @param originalContent - Original user code (before wrapping) to parse for @hoisted
 * @param moduleName - CommonJS module name
 * @returns Content with hoisted functions appended if any @hoisted found
 */
export function processHoistedAnnotations(
  wrappedContent: string,
  originalContent: string,
  moduleName: string
): string {
  // Extract hoisted functions from original user code
  const hoistedFunctions = extractHoistedFunctions(originalContent, moduleName);

  if (hoistedFunctions.length === 0) {
    return wrappedContent;
  }

  // Append hoisted section
  return appendHoistedSection(wrappedContent, hoistedFunctions, moduleName);
}
