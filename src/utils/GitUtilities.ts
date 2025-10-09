/**
 * GitUtilities - Shared utilities for Git-related operations
 *
 * Provides common functionality used across Git tools:
 * - CommonJS module unwrapping
 * - Git path validation and parsing
 * - Format detection
 */

/**
 * Unwrap CommonJS module wrapper to extract raw content
 *
 * Removes the _main() function wrapper and __defineModule__ call
 * to reveal the original user code.
 *
 * @param source - The CommonJS-wrapped content
 * @returns The unwrapped content or original if not wrapped
 */
export function unwrapCommonJSModule(source: string): string {
  // Check if this is a wrapped module
  if (!source.includes('function _main(') || !source.includes('__defineModule__(_main)')) {
    return source;
  }

  // Extract content between function declaration and closing brace
  // Handles both with and without semicolon after __defineModule__(_main)
  const match = source.match(/function _main\([^)]*\)\s*{([\s\S]*?)}\s*\n?\s*__defineModule__\(_main\);?/);
  return match ? match[1].trim() : source;
}

/**
 * Check if a filename represents a file inside a .git/ folder
 *
 * Validates that:
 * 1. Path contains '.git/' (not just 'git/')
 * 2. There's actual content after '.git/'
 * 3. Not just '.git/' or '.git//'
 *
 * @param filename - The filename to check (e.g., 'project/.git/config', '.git/HEAD')
 * @returns true if it's a valid git config file path
 */
export function isGitConfigFile(filename: string): boolean {
  // Must contain '.git/' (not just 'git/')
  if (!filename.includes('.git/')) {
    return filename.startsWith('.git/');
  }

  // Ensure there's actual content after '.git/'
  const gitIndex = filename.lastIndexOf('.git/');
  const afterGit = filename.substring(gitIndex + 5); // 5 = '.git/'.length

  // Must have a filename after .git/ (not just '.git/' or '.git//')
  return afterGit.length > 0 && !afterGit.startsWith('/');
}

/**
 * Extract the git file path relative to .git/ folder
 *
 * Examples:
 * - '.git/config' → 'config'
 * - 'project/.git/info/exclude' → 'info/exclude'
 * - 'libs/shared/.git/HEAD' → 'HEAD'
 *
 * @param filename - The full filename (may have .gs extension)
 * @returns The path relative to .git/ folder, or null if not a git file
 */
export function getGitRelativePath(filename: string): string | null {
  if (!isGitConfigFile(filename)) {
    return null;
  }

  // Remove .gs extension if present
  const path = filename.replace(/\.gs$/, '');

  // Find the last occurrence of '.git/'
  const gitIndex = path.lastIndexOf('.git/');

  if (gitIndex === -1) {
    return null;
  }

  // Return everything after '.git/'
  return path.substring(gitIndex + 5);
}

/**
 * Get the project prefix (everything before .git/)
 *
 * Examples:
 * - '.git/config' → '' (root level)
 * - 'project/.git/config' → 'project'
 * - 'libs/shared/.git/HEAD' → 'libs/shared'
 *
 * @param filename - The full filename
 * @returns The project prefix, '' for root, or null if not a git file
 */
export function getProjectPrefix(filename: string): string | null {
  if (!isGitConfigFile(filename)) {
    return null;
  }

  const gitIndex = filename.indexOf('.git/');

  if (gitIndex === 0) {
    // Root level .git/
    return '';
  }

  if (gitIndex > 0) {
    // Nested .git/ - return path before it (remove trailing slash)
    return filename.substring(0, gitIndex).replace(/\/$/, '');
  }

  return null;
}

/**
 * Build a full git file path from project prefix and git-relative path
 *
 * Examples:
 * - ('', 'config') → '.git/config'
 * - ('project', 'config') → 'project/.git/config'
 * - ('libs/shared', 'info/exclude') → 'libs/shared/.git/info/exclude'
 *
 * @param projectPath - The project prefix ('' for root)
 * @param gitRelativePath - The path relative to .git/ folder
 * @returns The full path to the git file
 */
export function buildGitFilePath(projectPath: string, gitRelativePath: string): string {
  if (!projectPath) {
    return `.git/${gitRelativePath}`;
  }
  return `${projectPath}/.git/${gitRelativePath}`;
}

/**
 * Validate that a path represents a valid git file
 * Throws an error if the path is invalid
 *
 * @param fullPath - The full path to validate
 * @throws Error if path doesn't contain .git/
 */
export function validateGitFilePath(fullPath: string): void {
  if (!fullPath.includes('.git/')) {
    throw new Error(`Invalid git file path: ${fullPath} - must be inside .git/ folder`);
  }
}

/**
 * Detect git file format based on git-relative path
 *
 * Supported formats:
 * - 'ini': config files
 * - 'gitignore': .gitignore-style files (exclude, attributes)
 * - 'ref': reference files (HEAD, refs/*)
 * - 'json': JSON files
 * - 'script': Executable scripts (hooks/*)
 * - 'text': Plain text files
 *
 * @param gitRelativePath - Path relative to .git/ (e.g., 'config', 'info/exclude')
 * @returns The detected format
 */
export function detectGitFileFormat(gitRelativePath: string): 'ini' | 'gitignore' | 'attributes' | 'ref' | 'json' | 'script' | 'text' {
  // Config files use INI format
  if (gitRelativePath === 'config' || gitRelativePath.endsWith('/config')) {
    return 'ini';
  }

  // Exclude files use gitignore format
  if (gitRelativePath.includes('exclude')) {
    return 'gitignore';
  }

  // Attributes files
  if (gitRelativePath.includes('attributes')) {
    return 'attributes';
  }

  // Reference files (HEAD, refs/*)
  if (gitRelativePath === 'HEAD' || gitRelativePath.startsWith('refs/')) {
    return 'ref';
  }

  // JSON files
  if (gitRelativePath.endsWith('.json')) {
    return 'json';
  }

  // Hook scripts
  if (gitRelativePath.startsWith('hooks/')) {
    return 'script';
  }

  // Default to plain text
  return 'text';
}
