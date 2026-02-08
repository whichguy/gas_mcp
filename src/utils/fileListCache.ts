/**
 * @fileoverview Resource Path Utilities for Server-Side Hash Computation
 *
 * Converts GAS file metadata to resource paths for ScriptApp.getResource().
 */

/**
 * Convert GAS file metadata to resource path for ScriptApp.getResource()
 *
 * ScriptApp.getResource() requires full path WITH extension:
 * - SERVER_JS files: name + '.gs'
 * - HTML files: name + '.html'
 * - JSON files: name (already has .json)
 *
 * @param name - GAS file name
 * @param type - File type (SERVER_JS, HTML, JSON), optional - defaults to SERVER_JS
 * @returns Resource path with extension
 */
export function toResourcePath(name: string, type?: string): string {
  // If name already has extension, return as-is (e.g., appsscript.json)
  if (name.includes('.')) {
    return name;
  }

  // Add extension based on type
  switch (type?.toUpperCase()) {
    case 'SERVER_JS':
      return `${name}.gs`;
    case 'HTML':
      return `${name}.html`;
    case 'JSON':
      return name;  // JSON files usually already have .json
    default:
      return `${name}.gs`;  // Default to .gs
  }
}
