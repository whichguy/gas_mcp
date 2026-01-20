/**
 * Template Loader Utility
 *
 * Centralizes template file loading from src/ directory.
 * Handles both development (src/) and production (dist/) paths.
 *
 * Replaces duplicate template loading patterns in deployments.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Lazily computed source directory path
let _srcDir: string | null = null;

/**
 * Resolve the src/ directory path.
 * Works from both src/ (development) and dist/ (compiled) contexts.
 */
function resolveSrcDir(): string {
  if (_srcDir !== null) {
    return _srcDir;
  }

  // Get the directory of this file
  const currentDir = path.dirname(new URL(import.meta.url).pathname);

  // Determine if we're running from compiled code (dist/) or source code (src/)
  if (currentDir.includes('/dist/')) {
    // Running from compiled code: dist/src/utils -> go up to project root, then to src
    const projectRoot = currentDir.replace(/\/dist\/.*$/, '');
    _srcDir = path.join(projectRoot, 'src');
  } else {
    // Running from source code: src/utils -> go up to src
    _srcDir = path.join(currentDir, '..');
  }

  return _srcDir;
}

/**
 * Load a template file from the src/ directory.
 *
 * @param filename - Filename relative to src/ (e.g., '__mcp_exec.js', 'appsscript.json')
 * @returns File content as string
 * @throws Error if file cannot be read
 */
export function loadTemplate(filename: string): string {
  try {
    const srcDir = resolveSrcDir();
    const templatePath = path.join(srcDir, filename);
    return fs.readFileSync(templatePath, 'utf8');
  } catch (error) {
    console.error(`Error reading template ${filename}:`, error);
    throw new Error(`Failed to read template ${filename}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Load and parse a JSON template file from the src/ directory.
 *
 * @param filename - JSON filename relative to src/ (e.g., 'appsscript.json')
 * @returns Parsed JSON object
 * @throws Error if file cannot be read or parsed
 */
export function loadJsonTemplate<T = any>(filename: string): T {
  try {
    const content = loadTemplate(filename);
    return JSON.parse(content) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse JSON template ${filename}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get the resolved src/ directory path.
 * Useful for debugging or path construction.
 */
export function getSrcDir(): string {
  return resolveSrcDir();
}
