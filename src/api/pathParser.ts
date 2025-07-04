import { ValidationError } from '../errors/mcpErrors.js';

/**
 * Parsed path information for GAS operations
 */
export interface ParsedPath {
  projectId: string;
  filename?: string;
  directory?: string;
  isProject: boolean;
  isFile: boolean;
  isDirectory: boolean;
}

/**
 * File type mapping for Google Apps Script
 */
export const FILE_TYPE_MAP: Record<string, string> = {
  '.gs': 'SERVER_JS',
  '.ts': 'SERVER_JS',
  '.html': 'HTML',
  '.json': 'JSON'
};

/**
 * REMOVED: No longer manipulating filenames or adding extensions
 * Files are used exactly as provided by the user
 */

/**
 * Get file type from extension - simplified, no manipulation
 */
export function getFileType(filename: string): string {
  // Special handling for Google Apps Script manifest files
  const baseName = getBaseName(filename);
  if (baseName === 'appsscript') {
    return 'JSON';
  }
  
  // If no extension, default to SERVER_JS
  if (!filename.includes('.')) {
    return 'SERVER_JS';
  }
  
  const ext = filename.substring(filename.lastIndexOf('.'));
  const type = FILE_TYPE_MAP[ext.toLowerCase()];
  if (!type) {
    return 'SERVER_JS'; // Default to SERVER_JS instead of throwing error
  }
  return type;
}

/**
 * Parse a path in the format: "" | "projectId" | "projectId/path/to/file[.ext]"
 * Files can have extensions or not - extensions will be inferred from context
 */
export function parsePath(path: string): ParsedPath {
  // Empty path = list all projects
  if (!path || path === '') {
    return {
      projectId: '',
      isProject: false,
      isFile: false,
      isDirectory: true
    };
  }

  const parts = path.split('/').filter(part => part.length > 0);
  const projectId = parts[0];

  // Validate project ID format (GAS project IDs are typically base64-like)
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(projectId)) {
    throw new ValidationError('projectId', projectId, 'valid GAS project ID (alphanumeric, _, -, min 10 chars)');
  }

  // Just project ID = list files in project
  if (parts.length === 1) {
    return {
      projectId,
      isProject: true,
      isFile: false,
      isDirectory: false
    };
  }

  // Multiple parts = could be file or directory
  const lastPart = parts[parts.length - 1];
  const filename = parts.slice(1).join('/');
  const directory = parts.length > 2 ? parts.slice(1, -1).join('/') : undefined;
  
  // Validate filename length (GAS has file size limits)
  if (filename.length > 100) {
    throw new ValidationError('filename', filename, 'filename under 100 characters');
  }

  // Determine if this looks like a file or directory
  // Consider it a file if:
  // 1. It has a known extension (.gs, .ts, .html, .json)
  // 2. It has any extension (contains a dot)
  // 3. It looks like a code file (starts with uppercase or contains camelCase)
  // 4. It's a special Google Apps Script file (appsscript manifest or Code)
  // 5. The last part is a valid Google Apps Script filename (alphanumeric, underscores, hyphens)
  // 6. In GAS, filenames with "/" are valid and represent logical directory structure
  const hasKnownExtension = /\.(gs|ts|html|json)$/i.test(lastPart);
  const hasAnyExtension = lastPart.includes('.');
  const looksLikeCodeFile = /^[A-Z]/.test(lastPart) || /[a-z][A-Z]/.test(lastPart);
  const isSpecialGASFile = lastPart === 'appsscript' || lastPart === 'Code';
  const isValidGASFilename = /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(lastPart);
  
  // ✅ FIXED: Accept files with directory prefixes - GAS supports "/" in filenames
  const isFile = hasKnownExtension || hasAnyExtension || looksLikeCodeFile || isSpecialGASFile || isValidGASFilename;

  if (isFile) {
    return {
      projectId,
      filename,
      directory,
      isProject: false,
      isFile: true,
      isDirectory: false
    };
  } else {
    // Treat as directory
    return {
      projectId,
      directory: filename,
      isProject: false,
      isFile: false,
      isDirectory: true
    };
  }
}

/**
 * Extract directory from a file path
 */
export function getDirectory(filename: string): string | undefined {
  const lastSlash = filename.lastIndexOf('/');
  return lastSlash > 0 ? filename.substring(0, lastSlash) : undefined;
}

/**
 * Get just the filename without directory
 */
export function getBaseName(filename: string): string {
  const lastSlash = filename.lastIndexOf('/');
  return lastSlash >= 0 ? filename.substring(lastSlash + 1) : filename;
}

/**
 * Join path components safely
 */
export function joinPath(projectId: string, ...parts: string[]): string {
  const filteredParts = parts.filter(part => part && part.length > 0);
  return [projectId, ...filteredParts].join('/');
}

/**
 * Check if a filename matches a directory filter
 */
export function matchesDirectory(filename: string, directory: string): boolean {
  if (!directory) return true;
  const normalizedDir = directory.endsWith('/') ? directory : directory + '/';
  return filename.startsWith(normalizedDir);
}

/**
 * Sort files for GAS execution order (dependencies first)
 */
export function sortFilesForExecution<T extends { name: string; order?: number }>(files: T[]): T[] {
  return files.sort((a, b) => {
    const aHasOrder = a.order !== undefined;
    const bHasOrder = b.order !== undefined;

    if (aHasOrder && !bHasOrder) return -1;
    if (!aHasOrder && bHasOrder) return 1;
    if (aHasOrder && bHasOrder) {
      return a.order! - b.order!;
    }

    // Libraries and utilities first (common prefixes)
    const aIsLib = /^(lib|util|common|shared)/i.test(a.name);
    const bIsLib = /^(lib|util|common|shared)/i.test(b.name);
    
    if (aIsLib && !bIsLib) return -1;
    if (!aIsLib && bIsLib) return 1;
    
    // Dependencies by directory depth (shallower first)
    const aDepth = (a.name.match(/\//g) || []).length;
    const bDepth = (b.name.match(/\//g) || []).length;
    
    if (aDepth !== bDepth) return aDepth - bDepth;
    
    // Alphabetical as fallback
    return a.name.localeCompare(b.name);
  });
} 