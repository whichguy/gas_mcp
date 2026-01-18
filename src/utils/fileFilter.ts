/**
 * Centralized FileFilter utility for mcp_gas
 *
 * Single source of truth for all file exclusion decisions.
 * Consolidates scattered filter logic from 8+ locations:
 * - syncStatusChecker.ts
 * - moduleWrapper.ts
 * - SyncPlanner.ts / SyncExecutor.ts
 * - SyncDiff.ts
 * - grepEngine.ts
 *
 * Key feature: isGitBreadcrumb() handles both root and poly-repo paths:
 * - .git/config (root)
 * - libs/auth/.git/config (poly-repo)
 *
 * IMPORTANT: .git/ files are intentionally different between GAS and local:
 * - GAS: Wrapped CommonJS breadcrumb with [sync] localPath
 * - Local: Actual git config used by git commands
 * Comparing them would always show "drift" - they're meant to coexist.
 */

import { promises as fs } from 'fs';
import path from 'path';
import ignore, { Ignore } from 'ignore';
import {
  SYSTEM_FILE_PREFIXES,
  DEFAULT_EXCLUDE_PATTERNS,
  GAS_EXTENSIONS,
  EXCLUDED_FILES,
  EXCLUDED_DIRS,
  SPECIAL_SYSTEM_FILES,
  FILTER_PRESETS,
  FilterPresetName,
} from './fileFilter.patterns.js';

/**
 * Result of filtering a single file
 */
export interface FilterResult {
  /** Whether the file should be skipped/excluded */
  skip: boolean;
  /** Reason for skipping (if skip=true) */
  reason?: FilterReason;
  /** Category of exclusion */
  category?: 'system' | 'git' | 'config' | 'devDir' | 'pattern' | 'gitignore';
}

/**
 * Reasons why a file may be filtered
 */
export type FilterReason =
  | 'system_file'
  | 'git_breadcrumb'
  | 'local_config'
  | 'dev_directory'
  | 'exclude_pattern'
  | 'gitignore'
  | 'claspignore'
  | 'not_gas_compatible';

/**
 * Options for FileFilter configuration
 */
export interface FileFilterOptions {
  /** Exclude common-js/*, __mcp_exec* system files */
  excludeSystemFiles?: boolean;
  /** Exclude .git/* including poly-repo paths like libs/auth/.git/config */
  excludeGitBreadcrumbs?: boolean;
  /** Exclude .clasp.json, .claspignore, etc. */
  excludeLocalConfig?: boolean;
  /** Exclude node_modules, .idea, .vscode directories */
  excludeDevDirs?: boolean;

  /** Custom glob patterns to exclude */
  excludePatterns?: string[];
  /** Override patterns to include (takes precedence over excludes) */
  includePatterns?: string[];

  /** Respect .gitignore patterns (true or path to file) */
  respectGitignore?: boolean | string;
  /** Respect .claspignore patterns (true or path to file) */
  respectClaspignore?: boolean | string;
}

/**
 * FileFilter class for centralized file exclusion logic
 *
 * Usage:
 * ```typescript
 * // Using preset
 * const filter = FileFilter.fromPreset('sync');
 *
 * // Using options
 * const filter = new FileFilter({
 *   excludeSystemFiles: true,
 *   excludeGitBreadcrumbs: true,
 *   excludePatterns: ['test/*']
 * });
 *
 * // Check single file
 * if (filter.shouldSkip('common-js/require')) {
 *   continue; // Skip this file
 * }
 *
 * // Filter array
 * const filtered = filter.filterFiles(files, f => f.name);
 * ```
 */
export class FileFilter {
  private options: Required<FileFilterOptions>;
  private ignoreInstance: Ignore | null = null;
  private ignoreLoaded = false;

  constructor(options: FileFilterOptions = {}) {
    this.options = {
      excludeSystemFiles: options.excludeSystemFiles ?? false,
      excludeGitBreadcrumbs: options.excludeGitBreadcrumbs ?? false,
      excludeLocalConfig: options.excludeLocalConfig ?? false,
      excludeDevDirs: options.excludeDevDirs ?? false,
      excludePatterns: options.excludePatterns ?? [],
      includePatterns: options.includePatterns ?? [],
      respectGitignore: options.respectGitignore ?? false,
      respectClaspignore: options.respectClaspignore ?? false,
    };
  }

  // ============================================================================
  // Factory Methods
  // ============================================================================

  /**
   * Create FileFilter from a preset configuration
   */
  static fromPreset(name: FilterPresetName): FileFilter {
    return new FileFilter(FILTER_PRESETS[name]);
  }

  /**
   * Create FileFilter for sync operations with optional overrides
   */
  static forSync(overrides?: Partial<FileFilterOptions>): FileFilter {
    return new FileFilter({
      ...FILTER_PRESETS.sync,
      ...overrides,
    });
  }

  /**
   * Create FileFilter for sync status checking with optional overrides
   */
  static forSyncStatus(overrides?: Partial<FileFilterOptions>): FileFilter {
    return new FileFilter({
      ...FILTER_PRESETS.syncStatus,
      ...overrides,
    });
  }

  /**
   * Create FileFilter for diff operations
   */
  static forDiff(overrides?: Partial<FileFilterOptions>): FileFilter {
    return new FileFilter({
      ...FILTER_PRESETS.diff,
      ...overrides,
    });
  }

  // ============================================================================
  // Main Filter Methods
  // ============================================================================

  /**
   * Check if a file should be skipped (excluded from processing)
   *
   * @param filename - Filename or path to check
   * @returns true if file should be skipped
   */
  shouldSkip(filename: string): boolean {
    return this.filter(filename).skip;
  }

  /**
   * Check if a file should be included (not excluded)
   *
   * @param filename - Filename or path to check
   * @returns true if file should be included
   */
  shouldInclude(filename: string): boolean {
    return !this.shouldSkip(filename);
  }

  /**
   * Get detailed filter result for a file
   *
   * @param filename - Filename or path to check
   * @returns FilterResult with skip status and reason
   */
  filter(filename: string): FilterResult {
    // Check include patterns first (override exclusions)
    if (this.matchesIncludePattern(filename)) {
      return { skip: false };
    }

    // Check git breadcrumbs (highest priority exclusion)
    if (this.options.excludeGitBreadcrumbs && this.isGitBreadcrumb(filename)) {
      return { skip: true, reason: 'git_breadcrumb', category: 'git' };
    }

    // Check system files
    if (this.options.excludeSystemFiles && this.isSystemFile(filename)) {
      return { skip: true, reason: 'system_file', category: 'system' };
    }

    // Check local config files
    if (this.options.excludeLocalConfig && this.isLocalConfig(filename)) {
      return { skip: true, reason: 'local_config', category: 'config' };
    }

    // Check dev directories
    if (this.options.excludeDevDirs && this.isInDevDir(filename)) {
      return { skip: true, reason: 'dev_directory', category: 'devDir' };
    }

    // Check custom exclude patterns
    if (this.matchesExcludePattern(filename)) {
      return { skip: true, reason: 'exclude_pattern', category: 'pattern' };
    }

    // Check gitignore/claspignore (only if loaded)
    if (this.ignoreLoaded && this.ignoreInstance?.ignores(filename)) {
      return { skip: true, reason: 'gitignore', category: 'gitignore' };
    }

    return { skip: false };
  }

  /**
   * Filter an array of items using a filename extractor function
   *
   * @param items - Array of items to filter
   * @param getFilename - Function to extract filename from item (defaults to identity)
   * @returns Filtered array of items
   */
  filterFiles<T>(items: T[], getFilename?: (item: T) => string): T[] {
    const extractFilename = getFilename || ((item: T) => String(item));
    return items.filter(item => this.shouldInclude(extractFilename(item)));
  }

  // ============================================================================
  // Category Checks
  // ============================================================================

  /**
   * Check if filename is a system/infrastructure file
   * (common-js/*, __mcp_exec*)
   */
  isSystemFile(filename: string): boolean {
    return SYSTEM_FILE_PREFIXES.some(prefix => filename.startsWith(prefix));
  }

  /**
   * Check if filename is a git breadcrumb file
   * Handles both root and poly-repo paths:
   * - .git/ (root git directory)
   * - .git (standalone)
   * - libs/auth/.git/config (poly-repo nested)
   * - a/b/c/.git/info/exclude (deep nested)
   */
  isGitBreadcrumb(filename: string): boolean {
    // Root: .git/ or .git (exact match for directory name)
    if (filename.startsWith('.git/') || filename === '.git') {
      return true;
    }

    // Poly-repo: */.../.git/* pattern
    // Match paths like libs/auth/.git/config or a/b/c/.git/info
    if (filename.includes('/.git/') || filename.endsWith('/.git')) {
      return true;
    }

    return false;
  }

  /**
   * Check if filename is a local config file
   * (.clasp.json, .claspignore, etc.)
   */
  isLocalConfig(filename: string): boolean {
    const basename = path.basename(filename);
    return (EXCLUDED_FILES as readonly string[]).includes(basename);
  }

  /**
   * Check if filename is in an excluded dev directory
   * (node_modules, .git, .idea, .vscode)
   */
  isInDevDir(filename: string): boolean {
    const parts = filename.split('/');
    return parts.some(part => EXCLUDED_DIRS.includes(part as any));
  }

  // ============================================================================
  // Special Checks
  // ============================================================================

  /**
   * Check if content should be wrapped with CommonJS
   * Used by moduleWrapper.ts
   *
   * @param fileType - GAS file type (SERVER_JS, HTML, JSON)
   * @param filename - Filename to check (using forward slashes, as in GAS filenames)
   * @returns true if content should be wrapped
   */
  shouldWrapContent(fileType: string, filename: string): boolean {
    // Only wrap SERVER_JS files
    if (fileType !== 'SERVER_JS') {
      return false;
    }

    // Don't wrap git directory files (breadcrumbs)
    if (this.isGitBreadcrumb(filename)) {
      return false;
    }

    // Don't wrap special system files
    // For paths with directories (e.g., 'common-js/require'), use full path minus extension
    // For simple filenames (e.g., 'appsscript'), just remove extension
    const fileIdentifier = filename.includes('/')
      ? filename.split('.')[0]  // 'common-js/require.min' -> 'common-js/require'
      : filename.split('.')[0]; // 'appsscript.json' -> 'appsscript'

    return !(SPECIAL_SYSTEM_FILES as readonly string[]).includes(fileIdentifier);
  }

  /**
   * Check if a file is GAS-compatible (can be synced to GAS)
   *
   * @param filename - Filename to check
   * @returns true if file can be synced to GAS
   */
  isGasCompatible(filename: string): boolean {
    // appsscript.json is the only JSON file we sync (manifest)
    if (filename === 'appsscript.json') {
      return true;
    }

    // Other JSON files are NOT synced (package.json, tsconfig.json, etc.)
    if (filename.endsWith('.json')) {
      return false;
    }

    // Check for GAS-compatible extensions
    return GAS_EXTENSIONS.some(ext => filename.endsWith(ext));
  }

  // ============================================================================
  // Ignore File Loading
  // ============================================================================

  /**
   * Load .gitignore and/or .claspignore patterns from a directory
   *
   * @param repoRoot - Path to repository root
   */
  async loadIgnoreFiles(repoRoot: string): Promise<void> {
    this.ignoreInstance = ignore();

    // Load .gitignore
    if (this.options.respectGitignore) {
      const gitignorePath = typeof this.options.respectGitignore === 'string'
        ? this.options.respectGitignore
        : path.join(repoRoot, '.gitignore');

      try {
        const content = await fs.readFile(gitignorePath, 'utf-8');
        this.ignoreInstance.add(content);
      } catch {
        // No .gitignore - continue
      }
    }

    // Load .claspignore
    if (this.options.respectClaspignore) {
      const claspignorePath = typeof this.options.respectClaspignore === 'string'
        ? this.options.respectClaspignore
        : path.join(repoRoot, '.claspignore');

      try {
        const content = await fs.readFile(claspignorePath, 'utf-8');
        this.ignoreInstance.add(content);
      } catch {
        // No .claspignore - continue
      }
    }

    this.ignoreLoaded = true;
  }

  /**
   * Add patterns directly to the ignore instance
   *
   * @param patterns - Array of gitignore-style patterns
   */
  addIgnorePatterns(patterns: string[]): void {
    if (!this.ignoreInstance) {
      this.ignoreInstance = ignore();
    }
    this.ignoreInstance.add(patterns);
    this.ignoreLoaded = true;
  }

  // ============================================================================
  // Pattern Matching Helpers
  // ============================================================================

  /**
   * Check if filename matches any custom exclude pattern
   */
  private matchesExcludePattern(filename: string): boolean {
    const patterns = this.options.excludePatterns;
    if (!patterns || patterns.length === 0) {
      return false;
    }

    for (const pattern of patterns) {
      if (this.matchGlobPattern(filename, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if filename matches any include pattern
   */
  private matchesIncludePattern(filename: string): boolean {
    const patterns = this.options.includePatterns;
    if (!patterns || patterns.length === 0) {
      return false;
    }

    for (const pattern of patterns) {
      if (this.matchGlobPattern(filename, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Simple glob pattern matching
   * Supports: * (any chars), ? (single char)
   */
  private matchGlobPattern(filename: string, pattern: string): boolean {
    // Convert glob to regex
    const regex = new RegExp(
      '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
        .replace(/\*/g, '.*')                    // * -> .*
        .replace(/\?/g, '.')                     // ? -> .
      + '$'
    );
    return regex.test(filename);
  }

  // ============================================================================
  // Static Utilities
  // ============================================================================

  /**
   * Get the default exclude patterns for backwards compatibility
   */
  static getDefaultExcludePatterns(): readonly string[] {
    return DEFAULT_EXCLUDE_PATTERNS;
  }

  /**
   * Get system file prefixes
   */
  static getSystemFilePrefixes(): readonly string[] {
    return SYSTEM_FILE_PREFIXES;
  }

  /**
   * Check if a filename is a git breadcrumb (static version)
   * Convenience method for simple checks without instantiation
   *
   * @param filename - Path using forward slashes (Unix-style, as used in GAS filenames)
   */
  static isGitBreadcrumbPath(filename: string): boolean {
    // Inline logic to avoid creating FileFilter instance
    // Root: .git/ or .git
    if (filename.startsWith('.git/') || filename === '.git') {
      return true;
    }
    // Poly-repo: */.../.git/* pattern
    if (filename.includes('/.git/') || filename.endsWith('/.git')) {
      return true;
    }
    return false;
  }
}

// Re-export patterns for direct access
export {
  SYSTEM_FILE_PREFIXES,
  DEFAULT_EXCLUDE_PATTERNS,
  GAS_EXTENSIONS,
  EXCLUDED_FILES,
  EXCLUDED_DIRS,
  SPECIAL_SYSTEM_FILES,
  FILTER_PRESETS,
} from './fileFilter.patterns.js';

export type { FilterPresetName } from './fileFilter.patterns.js';
