/**
 * Virtual File Translation System for Git-GAS Integration
 * 
 * Provides transparent translation between Git dotfiles and GAS-compatible names
 * Example: .git ↔ .git.gs, .gitignore ↔ .gitignore.gs
 */

/**
 * Map of virtual dotfile names to their GAS storage names (without extension)
 * NOTE: With the new convention, virtual names match GAS names (just add .gs)
 */
export const VIRTUAL_FILE_MAP: Record<string, string> = {
  '.gitmodules': '.gitmodules',
  '.gitignore': '.gitignore',
  '.env': '.env',
  '.github': '.github',
  '.vscode': '.vscode',
  '.eslintrc': '.eslintrc',
  '.prettierrc': '.prettierrc',
  '.babelrc': '.babelrc',
  '.dockerignore': '.dockerignore',
  '.editorconfig': '.editorconfig',
  '.npmignore': '.npmignore',
  '.nvmrc': '.nvmrc',
  '.prettierignore': '.prettierignore',
  '.gitattributes': '.gitattributes',
  '.gitkeep': '.gitkeep',
  '.env.local': '.env.local',
  '.env.production': '.env.production',
  '.env.development': '.env.development',
  '.env.test': '.env.test'
};

/**
 * Map of Git directory files to their GAS storage names (without extension)
 * These files are now stored with .git/ prefix directly (no translation needed)
 */
export const GIT_FILE_MAP: Record<string, string> = {
  '.git/config': '.git/config',
  '.git/HEAD': '.git/HEAD',
  '.git/description': '.git/description',
  '.git/index': '.git/index',
  '.git/packed-refs': '.git/packed-refs',
  '.git/FETCH_HEAD': '.git/FETCH_HEAD',
  '.git/ORIG_HEAD': '.git/ORIG_HEAD',
  '.git/MERGE_HEAD': '.git/MERGE_HEAD',
  '.git/refs/heads/main': '.git/refs/heads/main',
  '.git/refs/remotes/origin/main': '.git/refs/remotes/origin/main'
};

/**
 * Reverse map for quick lookup (GAS name to virtual name)
 */
export const REVERSE_VIRTUAL_MAP: Record<string, string> = Object.entries(VIRTUAL_FILE_MAP)
  .reduce((acc, [virtual, gas]) => {
    acc[gas] = virtual;
    return acc;
  }, {} as Record<string, string>);

/**
 * Check if a filename is a virtual dotfile that needs translation
 * @param filename The filename to check
 * @returns true if it's a virtual dotfile
 */
export function isVirtualDotfile(filename: string): boolean {
  // Remove path if present
  const baseName = filename.split('/').pop() || filename;
  // Check if it's in our virtual file mapping (not just any dotfile)
  return baseName in VIRTUAL_FILE_MAP;
}

/**
 * Check if a GAS filename is a translated virtual file (dotfile with .gs extension)
 * @param filename The GAS filename to check
 * @returns true if it's a translated virtual file
 */
export function isTranslatedVirtualFile(filename: string): boolean {
  // Remove path and get base name
  const baseName = filename.split('/').pop() || filename;
  // Check if it's a dotfile with .gs extension
  return baseName.startsWith('.') && baseName.endsWith('.gs');
}

/**
 * Convert a virtual dotfile name to GAS-compatible name
 * @param virtualName The virtual name (e.g., ".gitignore")
 * @returns The GAS-compatible name (e.g., ".gitignore.gs")
 */
export function virtualToGASName(virtualName: string): string {
  // Extract path and filename
  const parts = virtualName.split('/');
  const fileName = parts.pop() || virtualName;
  const path = parts.join('/');
  
  // With the new convention, just add .gs extension for dotfiles
  if (fileName.startsWith('.')) {
    const gasName = fileName + '.gs';
    return path ? `${path}/${gasName}` : gasName;
  }
  
  // Not a virtual file, return as-is
  return virtualName;
}

/**
 * Convert a GAS filename back to virtual dotfile name
 * @param gasName The GAS filename (e.g., ".gitignore.gs")
 * @returns The virtual name (e.g., ".gitignore")
 */
export function gasNameToVirtual(gasName: string): string {
  // Extract path and filename
  const parts = gasName.split('/');
  const fileName = parts.pop() || gasName;
  const path = parts.join('/');
  
  // Remove .gs extension
  const nameWithoutExt = fileName.replace(/\.gs$/, '');
  
  // With new convention, dotfiles are stored with their actual names
  // Just remove the .gs extension for dotfiles
  if (nameWithoutExt.startsWith('.')) {
    return path ? `${path}/${nameWithoutExt}` : nameWithoutExt;
  }
  
  // For regular files, also just remove extension
  return path ? `${path}/${nameWithoutExt}` : nameWithoutExt;
}

/**
 * Apply virtual file translation to a list of files for display
 * Used by gas_ls to show user-friendly names
 * @param files Array of file objects from GAS
 * @param applyTranslation Whether to apply translation (true for gas_ls, false for gas_raw_ls)
 * @returns Files with displayName property added
 */
export function translateFilesForDisplay(files: any[], applyTranslation: boolean = true): any[] {
  if (!applyTranslation) {
    return files;
  }
  
  return files.map(file => {
    const displayName = gasNameToVirtual(file.name);
    return {
      ...file,
      displayName: displayName !== file.name ? displayName : undefined,
      virtualFile: displayName !== file.name
    };
  });
}

/**
 * Translate a path for reading (user provides virtual name, we need GAS name)
 * Used by gas_cat, gas_write when user provides a path
 * @param userPath The path provided by user (might be virtual)
 * @param applyTranslation Whether to apply translation
 * @returns The actual GAS path to use
 */
export function translatePathForOperation(userPath: string, applyTranslation: boolean = true): string {
  if (!applyTranslation) {
    return userPath;
  }
  
  // Check if it's a virtual dotfile path
  const fileName = userPath.split('/').pop() || userPath;
  if (isVirtualDotfile(fileName)) {
    return virtualToGASName(userPath);
  }
  
  return userPath;
}

/**
 * Wrap content as CommonJS module for Git config files
 * @param content The content to wrap
 * @param fileName The filename
 * @returns Wrapped content
 */
export function wrapGitConfigAsModule(content: any, fileName: string): string {
  // Check if it's a Git config file or virtual dotfile
  const baseName = fileName.split('/').pop() || fileName;
  const nameWithoutExt = baseName.replace(/\.(gs|js)$/, '');
  
  // Handle Git directory files (stored with .git/ prefix) and virtual dotfiles
  if (fileName.startsWith('.git/') || 
      nameWithoutExt === '.gitmodules' || nameWithoutExt === '.gitignore' || 
      nameWithoutExt.startsWith('.env')) {
    // Wrap as CommonJS module
    if (typeof content === 'string') {
      try {
        // Try to parse as JSON
        const parsed = JSON.parse(content);
        return `module.exports = ${JSON.stringify(parsed, null, 2)};`;
      } catch {
        // If not JSON, wrap as string or array based on content
        if (fileName.includes('gitignore') || fileName.includes('env')) {
          // For .gitignore and .env files, wrap as array of lines
          const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
          return `module.exports = ${JSON.stringify(lines, null, 2)};`;
        } else {
          // For other Git files (config, HEAD, etc), wrap as string
          return `module.exports = ${JSON.stringify(content, null, 2)};`;
        }
      }
    } else {
      // Already an object
      return `module.exports = ${JSON.stringify(content, null, 2)};`;
    }
  }
  
  // Not a Git config file, return as-is
  return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
}

/**
 * Unwrap CommonJS module for Git config files
 * @param content The wrapped content
 * @returns Unwrapped content
 */
export function unwrapGitConfigModule(content: string): any {
  // Check if it starts with module.exports
  if (content.trim().startsWith('module.exports')) {
    try {
      // Extract the content after module.exports =
      const match = content.match(/module\.exports\s*=\s*([\s\S]*);?\s*$/);
      if (match && match[1]) {
        // Try to parse as JSON
        return JSON.parse(match[1]);
      }
    } catch {
      // If parsing fails, return original
    }
  }
  return content;
}

/**
 * Check if a path is a Git directory file that needs special handling
 * @param filePath The file path to check (e.g., '.git/config')
 * @returns true if it's a Git directory file
 */
export function isGitDirectoryFile(filePath: string): boolean {
  return filePath.startsWith('.git/') && filePath in GIT_FILE_MAP;
}

/**
 * Convert a Git directory file path to GAS name
 * @param gitPath The Git file path (e.g., '.git/config')
 * @returns The GAS name (e.g., '.git/config')
 */
export function gitPathToGASName(gitPath: string): string {
  if (gitPath in GIT_FILE_MAP) {
    return GIT_FILE_MAP[gitPath];
  }
  // For .git files, keep them as-is (no translation needed)
  if (gitPath.startsWith('.git/')) {
    return gitPath;
  }
  return gitPath;
}

/**
 * Convert a GAS Git file name back to Git directory path
 * @param gasName The GAS name (e.g., '.git/config')
 * @returns The Git directory path (e.g., '.git/config')
 */
export function gasNameToGitPath(gasName: string): string {
  // Find the reverse mapping
  for (const [gitPath, gasPath] of Object.entries(GIT_FILE_MAP)) {
    if (gasPath === gasName) {
      return gitPath;
    }
  }
  // For .git files, keep them as-is (no translation needed)
  if (gasName.startsWith('.git/')) {
    return gasName;
  }
  return gasName;
}