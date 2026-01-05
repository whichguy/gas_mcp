/**
 * Path Expansion Utilities
 *
 * Provides utilities for expanding and validating local file paths.
 * Used by: write (fromLocal), cat (toLocal)
 */

import { homedir } from 'os';
import { isAbsolute } from 'path';
import { ValidationError } from '../errors/mcpErrors.js';

/**
 * Expand tilde (~) to user's home directory
 *
 * @param path - Path that may start with ~/
 * @returns Expanded absolute path
 *
 * @example
 * expandTilde('~/projects/file.js') → '/Users/john/projects/file.js'
 * expandTilde('/absolute/path.js') → '/absolute/path.js'
 */
export function expandTilde(path: string): string {
  if (path.startsWith('~/')) {
    return path.replace('~', homedir());
  }
  if (path === '~') {
    return homedir();
  }
  return path;
}

/**
 * Validate that a local path is safe to read from or write to
 *
 * @param path - Path to validate (may contain ~)
 * @throws ValidationError if path is not safe
 *
 * Security checks:
 * - Must be absolute after tilde expansion
 * - Blocks sensitive system directories
 * - Prevents path traversal attacks
 */
export function validateLocalPath(path: string): void {
  const expanded = expandTilde(path);

  // Must be absolute after expansion
  if (!isAbsolute(expanded)) {
    throw new ValidationError('path', path, 'absolute path or ~/relative path');
  }

  // Block sensitive system directories
  const blockedPaths = [
    '/etc',
    '/System',
    '/var',
    '/bin',
    '/sbin',
    '/usr/bin',
    '/usr/sbin',
    '/Library/System',
    '/private/etc',
    '/private/var',
  ];

  const normalizedPath = expanded.toLowerCase();
  for (const blocked of blockedPaths) {
    if (normalizedPath === blocked.toLowerCase() || normalizedPath.startsWith(blocked.toLowerCase() + '/')) {
      throw new ValidationError('path', path, 'user-accessible path (system directories blocked)');
    }
  }

  // Prevent path traversal (should not contain .. after normalization)
  if (expanded.includes('..')) {
    throw new ValidationError('path', path, 'path without parent directory references (..)');
  }
}

/**
 * Expand and validate a local path in one call
 *
 * @param path - Path to expand and validate
 * @returns Expanded absolute path
 * @throws ValidationError if path is not safe
 */
export function expandAndValidateLocalPath(path: string): string {
  validateLocalPath(path);
  return expandTilde(path);
}
