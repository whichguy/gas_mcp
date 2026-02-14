/**
 * Git Breadcrumb Hints
 *
 * Generates contextual hints for .git/ breadcrumb files stored in GAS.
 * Used by: cat, write, edit, raw_cat, raw_write, raw_edit
 *
 * Helps LLMs understand:
 * - Expected INI format for .git/config
 * - Required sections for rsync ([sync] with localPath)
 * - How the workflow connects
 * - Example content
 */

/**
 * Hint structure returned for .git/ files
 */
export interface GitBreadcrumbHint {
  /** Type description for the file */
  fileType: string;
  /** Expected content format */
  format: string;
  /** Whether this file is required for rsync to work */
  requiredForRsync: boolean;
  /** Example content (for .git/config) */
  example?: string;
  /** Section descriptions (for .git/config) */
  sections?: Record<string, string>;
  /** Workflow steps showing how this file is used */
  workflow?: string[];
  /** Additional notes about storage/handling */
  note: string;
}

/**
 * Extended hint for write operations
 */
export interface GitBreadcrumbWriteHint extends GitBreadcrumbHint {
  /** Confirmation message about how content was processed */
  writeConfirmation: string;
}

/**
 * Extended hint for edit operations
 */
export interface GitBreadcrumbEditHint extends GitBreadcrumbHint {
  /** Note about how editing works with wrappers */
  editNote: string;
}

/**
 * Get hint for a .git/ breadcrumb file
 *
 * @param filename - The file path (e.g., '.git/config', '.git/HEAD')
 * @returns Hint object or null if not a .git/ file
 */
export function getGitBreadcrumbHint(filename: string): GitBreadcrumbHint | null {
  // Only provide hints for .git/ files
  if (!filename.startsWith('.git/') && filename !== '.git') {
    return null;
  }

  const isConfig = filename === '.git/config';

  return {
    fileType: 'Git breadcrumb file (GAS-stored)',
    format: isConfig ? 'INI format (standard git config)' : 'Git internal format',
    requiredForRsync: isConfig,
    example: isConfig
      ? `// Write raw INI:
[remote "origin"]
  url = https://github.com/owner/repo.git
[sync]
  localPath = ~/gas-repos/project-{scriptId}

// Auto-stored as CommonJS with parsed structure:
module.exports = {
  raw: "[remote \\"origin\\"]\\n  url = ...\\n[sync]\\n  localPath = ~/...",
  parsed: { remote: { origin: { url: "..." } }, sync: { localPath: "~/..." } },
  format: 'ini',
  gitPath: 'config'
};`
      : undefined,
    sections: isConfig
      ? {
          '[remote "origin"]': 'GitHub/remote repository URL (optional)',
          '[branch "main"]': 'Default branch name (optional)',
          '[sync]': 'REQUIRED for rsync - must contain localPath',
        }
      : undefined,
    workflow: isConfig
      ? [
          '1. write({path: ".git/config", content: "[sync]\\n  localPath = ~/..."})',
          '2. Auto-wrapped as CommonJS: { raw, parsed, format, gitPath }',
          '3. rsync reads parsed.sync.localPath from require(".git/config")',
          '4. rsync({ operation: "pull", scriptId, dryrun: true })',
        ]
      : undefined,
    note: 'Write raw INI format. Auto-wrapped as CommonJS with parsed structure for rsync access.',
  };
}

/**
 * Get hint for write operations on .git/ files
 *
 * @param filename - The file path
 * @returns Extended hint with write confirmation, or null if not a .git/ file
 */
export function getGitBreadcrumbWriteHint(filename: string): GitBreadcrumbWriteHint | null {
  const baseHint = getGitBreadcrumbHint(filename);
  if (!baseHint) {
    return null;
  }

  return {
    ...baseHint,
    writeConfirmation: 'Content wrapped as CommonJS module for GAS storage',
  };
}

/**
 * Get hint for edit operations on .git/ files
 *
 * @param filename - The file path
 * @returns Extended hint with edit note, or null if not a .git/ file
 */
export function getGitBreadcrumbEditHint(filename: string): GitBreadcrumbEditHint | null {
  const baseHint = getGitBreadcrumbHint(filename);
  if (!baseHint) {
    return null;
  }

  return {
    ...baseHint,
    editNote: 'Editing raw content (wrapper handled automatically)',
  };
}
