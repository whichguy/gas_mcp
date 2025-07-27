import { ValidationError } from '../errors/mcpErrors.js';

/**
 * Parsed path information for GAS operations
 */
export interface ParsedPath {
  scriptId: string;
  filename?: string;
  directory?: string;
  pattern?: string;        // NEW: wildcard pattern if detected
  isProject: boolean;
  isFile: boolean;
  isDirectory: boolean;
  isWildcard: boolean;     // NEW: true if contains wildcards
  wildcardType: 'none' | 'simple' | 'complex';  // NEW: wildcard complexity
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
 * Regex cache for wildcard patterns (performance optimization)
 */
const regexCache = new Map<string, RegExp>();

/**
 * Check if a pattern contains wildcard characters
 */
export function isWildcardPattern(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?');
}

/**
 * Convert wildcard pattern to JavaScript RegExp
 * Supports: * (any chars), ? (single char), literal characters
 */
export function wildcardToRegex(pattern: string): RegExp {
  // Escape special regex characters except * and ?
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
    .replace(/\*/g, '.*')                   // * becomes .*
    .replace(/\?/g, '.');                   // ? becomes .
  
  return new RegExp(`^${escaped}$`, 'i');  // Case-insensitive, full match
}

/**
 * Get cached regex for pattern (performance optimization)
 */
export function getCachedRegex(pattern: string): RegExp {
  if (!regexCache.has(pattern)) {
    regexCache.set(pattern, wildcardToRegex(pattern));
  }
  return regexCache.get(pattern)!;
}

/**
 * Validate wildcard patterns for safety
 */
export function validateWildcardPattern(pattern: string): { valid: boolean; error?: string } {
  try {
    // Test regex compilation
    wildcardToRegex(pattern);
    
    // Check for potentially expensive patterns
    const wildcardCount = (pattern.match(/[*?]/g) || []).length;
    if (wildcardCount > 10) {
      return { valid: false, error: 'Too many wildcards (max 10)' };
    }
    
    // Check for invalid consecutive wildcards
    if (/\*+\*/.test(pattern)) {
      return { valid: false, error: 'Invalid pattern: consecutive wildcards' };
    }
    
    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Invalid wildcard pattern: ${error}` };
  }
}

/**
 * Determine wildcard pattern complexity
 */
export function getPatternComplexity(pattern: string): 'simple' | 'medium' | 'complex' {
  if (!isWildcardPattern(pattern)) return 'simple';
  
  const wildcardCount = (pattern.match(/[*?]/g) || []).length;
  const hasDirectoryWildcards = /[*?].*\/|\/.*[*?]/.test(pattern);
  
  if (wildcardCount === 1 && !hasDirectoryWildcards) return 'simple';
  if (wildcardCount <= 3 && !hasDirectoryWildcards) return 'medium';
  return 'complex';
}

/**
 * Enhanced directory/pattern matching with wildcard support
 */
export function matchesPattern(filename: string, pattern: string): boolean {
  if (!pattern) return true;
  
  // If no wildcards, use simple prefix matching (faster)
  if (!isWildcardPattern(pattern)) {
    const normalizedPattern = pattern.endsWith('/') ? pattern : pattern + '/';
    return filename.startsWith(normalizedPattern);
  }
  
  // Validate pattern before using
  const validation = validateWildcardPattern(pattern);
  if (!validation.valid) {
    console.error(`Invalid wildcard pattern "${pattern}": ${validation.error}`);
    return false;
  }
  
  // Wildcard pattern matching
  const regex = getCachedRegex(pattern);
  return regex.test(filename);
}

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
 * Parse a path in the format: "" | "scriptId" | "scriptId/path/to/file[.ext]"
 * Files can have extensions or not - extensions will be inferred from context
 * Now supports wildcard patterns with * and ? characters
 */
export function parsePath(path: string): ParsedPath {
  // Empty path = list all projects
  if (!path || path === '') {
    return {
      scriptId: '',
      isProject: false,
      isFile: false,
      isDirectory: true,
      isWildcard: false,
      wildcardType: 'none'
    };
  }

  const parts = path.split('/').filter(part => part.length > 0);
  const scriptId = parts[0];

  // Validate script ID format (GAS script IDs are typically base64-like)
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(scriptId)) {
    throw new ValidationError('scriptId', scriptId, 'valid GAS script ID (alphanumeric, _, -, min 10 chars)');
  }

  // Check for wildcard patterns in the entire path
  const hasWildcards = isWildcardPattern(path);
  
  if (hasWildcards) {
    // Extract pattern (everything after scriptId)
    const pattern = parts.slice(1).join('/');
    const wildcardComplexity = getPatternComplexity(pattern);
    
    // Validate wildcard pattern
    const validation = validateWildcardPattern(pattern);
    if (!validation.valid) {
      throw new ValidationError('pattern', pattern, validation.error || 'invalid wildcard pattern');
    }
    
    return {
      scriptId,
      pattern,
      isProject: false,
      isFile: false,
      isDirectory: false,
      isWildcard: true,
      wildcardType: wildcardComplexity === 'simple' ? 'simple' : 'complex'
    };
  }

  // Just script ID = list files in project
  if (parts.length === 1) {
    return {
      scriptId,
      isProject: true,
      isFile: false,
      isDirectory: false,
      isWildcard: false,
      wildcardType: 'none'
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
  const isValidGASFilename = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(lastPart);
  
  // ✅ FIXED: Accept files with directory prefixes - GAS supports "/" in filenames
  const isFile = hasKnownExtension || hasAnyExtension || looksLikeCodeFile || isSpecialGASFile || isValidGASFilename;

  if (isFile) {
    return {
      scriptId,
      filename,
      directory,
      isProject: false,
      isFile: true,
      isDirectory: false,
      isWildcard: false,
      wildcardType: 'none'
    };
  } else {
    // Treat as directory
    return {
      scriptId,
      directory: filename,
      isProject: false,
      isFile: false,
      isDirectory: true,
      isWildcard: false,
      wildcardType: 'none'
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
export function joinPath(scriptId: string, ...parts: string[]): string {
  const filteredParts = parts.filter(part => part && part.length > 0);
  return [scriptId, ...filteredParts].join('/');
}

/**
 * Check if a filename matches a directory filter (backward compatibility)
 * Now supports wildcard patterns via matchesPattern
 */
export function matchesDirectory(filename: string, directory: string): boolean {
  return matchesPattern(filename, directory);
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

/**
 * Hybrid script ID resolution for tools that support both scriptId parameter and path-embedded script IDs
 */
export interface HybridPathResolution {
  scriptId: string;
  cleanPath: string;  // Path without embedded script ID
  wasEmbedded: boolean;  // True if script ID came from path, false if from parameter
}

/**
 * Resolve script ID from either scriptId parameter or path-embedded script ID
 * 
 * @param scriptId - The scriptId parameter (can be empty string to force path extraction)
 * @param path - The path that may contain embedded script ID
 * @param operation - Operation name for error messages
 * @returns Resolved script ID and clean path
 * 
 * Resolution logic:
 * 1. If scriptId provided and path has no embedded script ID → use scriptId
 * 2. If scriptId provided and path has embedded script ID → use embedded (override)
 * 3. If scriptId empty and path has embedded script ID → use embedded
 * 4. If scriptId empty and path has no embedded script ID → throw error
 */
export function resolveHybridProjectId(
  scriptId: string | undefined, 
  path: string, 
  operation: string = 'operation'
): HybridPathResolution {
  const parsedPath = parsePath(path);
  
  // Case 1 & 2: scriptId provided
  if (scriptId && scriptId.trim()) {
    // Validate scriptId format
    if (!/^[a-zA-Z0-9_-]{44}$/.test(scriptId)) {
      throw new ValidationError('scriptId', scriptId, '44-character Google Apps Script project ID');
    }
    
    if (parsedPath.scriptId) {
      // Case 2: scriptId provided but path has embedded script ID → use embedded (override)
      return {
        scriptId: parsedPath.scriptId,
        cleanPath: parsedPath.filename || parsedPath.directory || parsedPath.pattern || '',
        wasEmbedded: true
      };
    } else {
      // Case 1: scriptId provided and path has no embedded script ID → use scriptId
      return {
        scriptId: scriptId,
        cleanPath: path,
        wasEmbedded: false
      };
    }
  }
  
  // Case 3: scriptId empty, check if path has embedded script ID
  if (parsedPath.scriptId) {
    return {
      scriptId: parsedPath.scriptId,
      cleanPath: parsedPath.filename || parsedPath.directory || parsedPath.pattern || '',
      wasEmbedded: true
    };
  }
  
  // Case 4: Both scriptId empty and no embedded script ID → error
  throw new ValidationError(
    'scriptId', 
    'missing', 
    `Either provide scriptId parameter or embed script ID in path (e.g., "scriptId/filename") for ${operation}`
  );
}