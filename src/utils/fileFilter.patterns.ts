/**
 * Centralized file filter patterns for mcp_gas
 *
 * Single source of truth for all file exclusion decisions across:
 * - syncStatusChecker.ts
 * - moduleWrapper.ts
 * - SyncPlanner.ts / SyncExecutor.ts
 * - SyncDiff.ts
 * - grepEngine.ts
 */

/**
 * System file prefixes managed by mcp_gas infrastructure
 * These are auto-generated CommonJS infrastructure files
 */
export const SYSTEM_FILE_PREFIXES = [
  'common-js/',
  '__mcp_exec',
  'appsscript'  // Manifest is infrastructure, excluded from sync checks
] as const;

/**
 * Default patterns to exclude from sync operations
 * Glob-style patterns for backwards compatibility
 */
export const DEFAULT_EXCLUDE_PATTERNS = [
  'common-js/*',
  '__mcp_exec*',
  '.claspignore*'
] as const;

/**
 * GAS-compatible file extensions for local filesystem
 * - .js → SERVER_JS (preferred)
 * - .gs → SERVER_JS (legacy)
 * - .html → HTML
 */
export const GAS_EXTENSIONS = ['.js', '.gs', '.html'] as const;

/**
 * Files that are always excluded from sync (never sent to GAS)
 */
export const EXCLUDED_FILES = [
  '.clasp.json',          // clasp CLI config (contains scriptId)
  '.claspignore',         // clasp ignore patterns
  '.rsync-manifest.json', // Internal rsync tracking
  '.gitignore',           // Git ignore patterns
] as const;

/**
 * Directories that are always excluded from sync
 */
export const EXCLUDED_DIRS = ['.git', 'node_modules', '.idea', '.vscode'] as const;

/**
 * Special system files that should not be wrapped with CommonJS
 */
export const SPECIAL_SYSTEM_FILES = [
  'appsscript',
  'common-js/require',
  'common-js/__mcp_exec'
] as const;

/**
 * Filter presets for common use cases
 */
export const FILTER_PRESETS = {
  /**
   * Sync operations (rsync plan/execute)
   * - Exclude system files (common-js/*, __mcp_exec*)
   * - Exclude git breadcrumbs (.git/*)
   * - Exclude local config files (.clasp.json, etc.)
   * - Exclude dev directories (node_modules, .idea, etc.)
   */
  sync: {
    excludeSystemFiles: true,
    excludeGitBreadcrumbs: true,
    excludeLocalConfig: true,
    excludeDevDirs: true,
    respectGitignore: true,
    respectClaspignore: true,
  },

  /**
   * File operations (cat, write, edit)
   * - Don't auto-exclude (user may want to read/write system files)
   * - Let the operation decide what to filter
   */
  fileOps: {
    excludeSystemFiles: false,
    excludeGitBreadcrumbs: false,
    excludeLocalConfig: false,
    excludeDevDirs: false,
  },

  /**
   * Diff operations (SyncDiff)
   * - Exclude system files
   * - Exclude git breadcrumbs
   * - Exclude local config
   */
  diff: {
    excludeSystemFiles: true,
    excludeGitBreadcrumbs: true,
    excludeLocalConfig: true,
    excludeDevDirs: false,
  },

  /**
   * Sync status checking (checkSyncStatus)
   * - Exclude system files by default
   * - Exclude git breadcrumbs (fixes false positive drift detection)
   * - Can be overridden with options
   */
  syncStatus: {
    excludeSystemFiles: true,
    excludeGitBreadcrumbs: true,
    excludeLocalConfig: false,
    excludeDevDirs: false,
  },
} as const;

export type FilterPresetName = keyof typeof FILTER_PRESETS;
