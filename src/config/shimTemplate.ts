/**
 * require.js template for Google Apps Script projects
 * This file contains the module system that gets automatically added to new GAS projects.
 *
 * CRITICAL: This implements LAZY LOADING where _main is called only when require() is first invoked,
 * not when __defineModule__ is called.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Get the CommonJS template by reading from source directory
 * @returns {string} The CommonJS template content
 */
export function getShimTemplate(): string {
  try {
    // Get the directory of this file - when compiled, this will be in dist/src/config/
    const currentDir = path.dirname(new URL(import.meta.url).pathname);

    // Determine if we're running from compiled code (dist/) or source code (src/)
    let srcDir: string;
    if (currentDir.includes('/dist/')) {
      // Running from compiled code: dist/src/config -> go up to project root, then to src
      const projectRoot = currentDir.replace(/\/dist\/.*$/, '');
      srcDir = path.join(projectRoot, 'src');
    } else {
      // Running from source code: src/config -> go up to src
      srcDir = path.join(currentDir, '..');
    }

    const templatePath = path.join(srcDir, 'require.js');

    return fs.readFileSync(templatePath, 'utf8');
  } catch (error) {
    console.error('Error reading require.js template:', error);
    throw new Error(`Failed to read require.js template: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// For backward compatibility, export as SHIM_TEMPLATE
export const SHIM_TEMPLATE = getShimTemplate(); 