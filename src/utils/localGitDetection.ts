/**
 * localGitDetection - Utilities for detecting local git repositories and GAS breadcrumbs
 *
 * Provides functionality for write operations to discover local git setups
 * and recommend sync configuration when appropriate.
 */

import { access, stat, constants } from 'fs/promises';
import * as path from 'path';
import { fileNameMatches } from '../api/pathParser.js';

/**
 * Recommendation object for establishing sync
 */
export interface SyncRecommendation {
  action: 'rsync';
  reason: string;
  command: string;
  details: {
    localGitPath: string;
    breadcrumbMissing: boolean;
  };
}

/**
 * Git hints from .git.gs files in GAS project
 */
export interface GitHints {
  associated: boolean;
  syncFolder: string;
}

/**
 * Git detection result with breadcrumb status
 */
export interface GitDetection {
  localGitDetected: boolean;
  breadcrumbExists?: boolean;
  recommendation?: SyncRecommendation;
}

/**
 * Expand tilde (~) in paths to actual home directory
 *
 * @throws Error if HOME/USERPROFILE environment variables are not set
 */
export function expandPath(filepath: string): string {
  if (filepath.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (!home) {
      throw new Error('Cannot expand ~ - HOME/USERPROFILE environment variable not set');
    }
    return path.join(home, filepath.slice(2));
  }
  return filepath;
}

/**
 * Validate scriptId format for filesystem safety
 *
 * @throws Error if scriptId contains invalid characters or wrong length
 */
export function validateScriptId(scriptId: string): void {
  // Must be 25-60 alphanumeric characters, hyphens, or underscores
  if (!/^[a-zA-Z0-9_-]{25,60}$/.test(scriptId)) {
    throw new Error(`Invalid scriptId format for filesystem operations: ${scriptId}`);
  }
}

/**
 * Detect local git repository by walking up from sync folder
 *
 * Walks up the directory tree from ~/gas-repos/project-{scriptId}/
 * looking for a .git directory or file (for submodules).
 *
 * Returns the first .git path found, or null if:
 * - Sync folder doesn't exist
 * - No .git found in hierarchy
 * - Permission errors encountered
 *
 * @param scriptId - GAS project ID
 * @returns Path to .git if found, null otherwise
 */
export async function detectLocalGit(scriptId: string): Promise<string | null> {
  try {
    // Validate scriptId for filesystem safety
    validateScriptId(scriptId);

    // Construct sync folder path
    const syncFolder = expandPath(`~/gas-repos/project-${scriptId}/`);

    // Check if sync folder exists (async)
    try {
      await access(syncFolder, constants.F_OK);
    } catch {
      // Sync folder doesn't exist yet - no git to detect
      return null;
    }

    // Walk up from sync folder looking for .git
    let currentPath = syncFolder;
    const root = path.parse(currentPath).root;

    while (currentPath !== root) {
      const gitPath = path.join(currentPath, '.git');

      try {
        // Check if .git exists (async)
        await access(gitPath, constants.F_OK);
        const stats = await stat(gitPath);

        // .git can be a directory (normal repo) or file (submodule)
        if (stats.isDirectory() || stats.isFile()) {
          return gitPath;
        }
      } catch (error) {
        // Permission denied or doesn't exist - skip this level
        // Continue walking up
      }

      // Move up one directory level
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        // Reached root (safety check)
        break;
      }
      currentPath = parentPath;
    }

    // No .git found in hierarchy
    return null;

  } catch (error) {
    // Unexpected error in detection logic
    // Log warning but don't fail
    console.error(`[GIT-DETECTION] Error detecting local git for ${scriptId}:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Check if .git/config breadcrumb exists in GAS project files
 *
 * Checks the provided files array for the breadcrumb file.
 * This is designed to work with files already fetched by the calling tool.
 *
 * Note: GAS stores .git/config without .gs extension (type: SERVER_JS provides the extension info)
 *
 * @param files - Array of GAS files from getProjectContent()
 * @returns true if breadcrumb exists, false otherwise
 */
export function checkBreadcrumbExists(
  files: Array<{ name: string; [key: string]: any }>
): boolean {
  // Check if .git/config exists in the file list
  // Uses fileNameMatches to handle both with and without .gs extension
  return files.some(file => fileNameMatches(file.name, '.git/config'));
}

/**
 * Build recommendation object for establishing sync
 *
 * Creates a structured recommendation with:
 * - Action to take (rsync)
 * - Human-readable reason
 * - Exact command to execute
 * - Additional details
 *
 * @param scriptId - GAS project ID
 * @param gitPath - Path to local .git directory/file
 * @returns Recommendation object
 */
export function buildRecommendation(
  scriptId: string,
  gitPath: string
): SyncRecommendation {
  return {
    action: 'rsync',
    reason: 'Local git repository detected but no .git/config breadcrumb found in GAS',
    command: `rsync({operation: 'plan', scriptId: "${scriptId}", direction: 'pull'})`,
    details: {
      localGitPath: gitPath,
      breadcrumbMissing: true
    }
  };
}

/**
 * Integration helper for two-phase git discovery
 *
 * Combines new discoverGit() with existing breadcrumb checking for backward compatibility.
 * Provides complete git detection results including:
 * - Git existence and location (via two-phase discovery)
 * - Breadcrumb status (if git exists)
 * - Recommendation for sync setup (if needed)
 *
 * @param scriptId - GAS project ID
 * @param projectPath - Optional nested path within project (for polyrepo)
 * @param gasClient - GAS API client
 * @param accessToken - OAuth access token
 * @returns Complete git detection with breadcrumb status and recommendations
 */
export async function detectGitWithDiscovery(
  scriptId: string,
  projectPath: string,
  gasClient: any,
  accessToken: string
): Promise<{
  gitDetection: any;  // GitDiscoveryResult from gitDiscovery.ts
  breadcrumbExists?: boolean;
  recommendation?: SyncRecommendation;
}> {
  // Dynamic import to avoid circular dependency
  const { discoverGit } = await import('./gitDiscovery.js');

  // Phase 1 & 2: Use new two-phase discovery
  const gitDetection = await discoverGit(scriptId, projectPath, gasClient, accessToken);

  // If no git found, return early
  if (!gitDetection.gitExists) {
    return {
      gitDetection,
      breadcrumbExists: undefined
    };
  }

  // Git exists - check for breadcrumbs in GAS
  let breadcrumbExists: boolean | undefined = undefined;
  let files: any[] = [];

  try {
    files = await gasClient.getProjectContent(scriptId, accessToken);
    breadcrumbExists = checkBreadcrumbExists(files);
  } catch (error) {
    // If we can't fetch files, breadcrumb status is unknown
    console.error('[GIT-DETECTION] Could not fetch files for breadcrumb check:', error);
  }

  // Build recommendation if breadcrumb is missing (not unknown)
  let recommendation: SyncRecommendation | undefined = undefined;

  if (breadcrumbExists === false && gitDetection.gitPath) {
    recommendation = buildRecommendation(scriptId, gitDetection.gitPath);
  }

  return {
    gitDetection,
    breadcrumbExists,
    recommendation
  };
}
