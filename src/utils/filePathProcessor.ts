/**
 * File path processing utilities for consistent path validation across tools
 *
 * Provides standardized path translation, validation, and parsing for all
 * filesystem tools.
 */

import { parsePath, resolveHybridScriptId } from '../api/pathParser.js';
import { translatePathForOperation } from './virtualFileTranslation.js';
import { ValidationError } from '../errors/mcpErrors.js';

export interface ValidatedFilePath {
  scriptId: string;
  filename: string;
  projectName: string;
  fullPath: string;
  translatedPath: string;
}

/**
 * Validate and parse file path parameters with comprehensive error checking
 *
 * This function performs the standard sequence of operations for processing
 * file paths in MCP tools:
 * 1. Virtual file translation (dotfiles, etc.)
 * 2. Hybrid script ID resolution
 * 3. Path validation
 * 4. File path parsing
 * 5. Filename existence check
 *
 * @param params - Tool parameters containing scriptId and path
 * @param validator - Validation function from BaseTool (this.validate.filePath)
 * @param operation - Operation name for error messages (e.g., 'file reading', 'file writing')
 * @returns Validated file path components
 * @throws ValidationError if path is invalid or missing required components
 */
export function validateAndParseFilePath(
  params: { scriptId: string; path: string },
  validator: (path: string, operation: string) => string,
  operation: string
): ValidatedFilePath {
  // Early validation for required path parameter
  if (!params.path) {
    throw new ValidationError('path', params.path, 'non-empty file path');
  }

  // Apply virtual file translation for user-provided path
  const translatedPath = translatePathForOperation(params.path, true);

  // Use hybrid script ID resolution with translated path
  const hybridResolution = resolveHybridScriptId(params.scriptId, translatedPath);
  const fullPath = `${hybridResolution.scriptId}/${hybridResolution.cleanPath}`;

  // SECURITY: Validate path using provided validator
  const path = validator(fullPath, operation);
  const parsedPath = parsePath(path);

  if (!parsedPath.isFile) {
    throw new ValidationError('path', path, 'file path (must include filename)');
  }

  const scriptId = parsedPath.scriptId;
  const filename = parsedPath.filename;

  if (!filename) {
    throw new ValidationError('path', path, 'file path must include a filename');
  }

  const projectName = scriptId; // Use scriptId as project name

  return {
    scriptId,
    filename,
    projectName,
    fullPath: path,
    translatedPath
  };
}
