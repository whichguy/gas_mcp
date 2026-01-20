/**
 * gitDiscovery - Two-phase git repository discovery for GAS projects
 *
 * Phase A: Scan local filesystem (project + parents) for .git directory/file
 * Phase B: If not found, scan GAS project for .git/* breadcrumbs and pull them down
 */

import { access, stat, mkdir, writeFile, constants } from 'fs/promises';
import * as path from 'path';
import { join, dirname } from 'path';
import type { GASClient } from '../api/gasClient.js';
import { log } from '../utils/logger.js';
import { expandTilde } from './pathExpansion.js';
import { validateScriptId } from './localGitDetection.js';

/**
 * Result of git discovery process
 */
export interface GitDiscoveryResult {
  gitExists: boolean;
  gitPath?: string;  // Absolute path to .git directory/file
  source: 'local-project' | 'local-parent' | 'gas-breadcrumbs' | 'none';
  breadcrumbsPulled?: string[];  // Files pulled from GAS (.git/config, etc.)
  message?: string;
}

/**
 * Phase A: Scan local filesystem for .git directory/file
 *
 * Walks up from startPath to root looking for .git.
 * Returns immediately when .git is found.
 *
 * @param startPath - Starting directory path (typically project root)
 * @returns Discovery result with 'local-project' or 'local-parent' source
 */
async function scanLocalFilesystem(startPath: string): Promise<GitDiscoveryResult> {
  try {
    // Check if start path exists
    try {
      await access(startPath, constants.F_OK);
    } catch {
      // Start path doesn't exist - no git to discover
      log.debug(`[GIT-DISCOVERY] Start path does not exist: ${startPath}`);
      return {
        gitExists: false,
        source: 'none',
        message: 'Project path does not exist yet'
      };
    }

    // Walk up from start path looking for .git
    let currentPath = startPath;
    const root = path.parse(currentPath).root;
    let isFirstCheck = true;

    while (currentPath !== root) {
      const gitPath = path.join(currentPath, '.git');

      try {
        await access(gitPath, constants.F_OK);
        const stats = await stat(gitPath);

        // .git can be a directory (normal repo) or file (submodule)
        if (stats.isDirectory() || stats.isFile()) {
          const source = isFirstCheck ? 'local-project' : 'local-parent';
          log.info(`[GIT-DISCOVERY] Found .git at ${gitPath} (${source})`);

          return {
            gitExists: true,
            gitPath,
            source,
            message: `Git repository found at ${currentPath}`
          };
        }
      } catch {
        // .git doesn't exist at this level - continue walking up
      }

      // Move up one directory level
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        // Reached root (safety check)
        break;
      }
      currentPath = parentPath;
      isFirstCheck = false;
    }

    // No .git found in hierarchy
    log.debug('[GIT-DISCOVERY] No local .git found in filesystem hierarchy');
    return {
      gitExists: false,
      source: 'none',
      message: 'No local git repository found'
    };

  } catch (error) {
    log.error('[GIT-DISCOVERY] Error scanning local filesystem:', error instanceof Error ? error.message : String(error));
    return {
      gitExists: false,
      source: 'none',
      message: `Error scanning filesystem: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Phase B: Scan GAS project for .git/* breadcrumb files and pull them down
 *
 * Looks for files matching pattern: .git/*, .git.gs/*, or standalone .gitignore
 * If found, pulls them down to local project directory and initializes git repo.
 *
 * @param scriptId - GAS project ID
 * @param localProjectPath - Local project directory path
 * @param gasClient - GAS API client
 * @param accessToken - OAuth access token
 * @returns Discovery result with 'gas-breadcrumbs' source if found
 */
async function scanAndPullGASBreadcrumbs(
  scriptId: string,
  localProjectPath: string,
  gasClient: GASClient,
  accessToken: string
): Promise<GitDiscoveryResult> {
  try {
    log.debug(`[GIT-DISCOVERY] Scanning GAS project for .git/* breadcrumbs`);

    // Fetch all files from GAS project
    const files = await gasClient.getProjectContent(scriptId, accessToken);

    // Look for .git/* breadcrumb files
    // Patterns to match: .git/config, .git/HEAD, .gitignore
    const breadcrumbFiles = files.filter((file: any) => {
      const name = file.name;
      return (
        name.startsWith('.git/') ||
        name.startsWith('.git.gs/') ||
        name === '.gitignore' ||
        name === '.gitignore.gs'
      );
    });

    if (breadcrumbFiles.length === 0) {
      log.debug('[GIT-DISCOVERY] No .git breadcrumbs found in GAS project');
      return {
        gitExists: false,
        source: 'none',
        message: 'No git breadcrumbs found in GAS project'
      };
    }

    log.info(`[GIT-DISCOVERY] Found ${breadcrumbFiles.length} git breadcrumb files in GAS`);

    // Ensure local project directory exists
    await mkdir(localProjectPath, { recursive: true });

    // Pull down breadcrumb files
    const pulledFiles: string[] = [];

    for (const file of breadcrumbFiles) {
      try {
        // Convert GAS filename to local filename
        // .git/config.gs → .git/config
        // .git.gs/config.gs → .git/config
        let localFilename = file.name;

        // Remove .gs/.html suffixes from git files
        if (localFilename.endsWith('.gs')) {
          localFilename = localFilename.slice(0, -3);
        } else if (localFilename.endsWith('.html')) {
          localFilename = localFilename.slice(0, -5);
        }

        // Handle .git.gs/ → .git/ conversion
        if (localFilename.startsWith('.git.gs/')) {
          localFilename = localFilename.replace('.git.gs/', '.git/');
        }

        const localFilePath = join(localProjectPath, localFilename);

        // Ensure parent directory exists
        await mkdir(dirname(localFilePath), { recursive: true });

        // Write file content
        const content = file.source || '';
        await writeFile(localFilePath, content, 'utf-8');

        pulledFiles.push(localFilename);
        log.debug(`[GIT-DISCOVERY] Pulled ${file.name} → ${localFilename}`);
      } catch (error) {
        log.error(`[GIT-DISCOVERY] Error pulling ${file.name}:`, error instanceof Error ? error.message : String(error));
      }
    }

    // Check if .git directory now exists
    const gitPath = join(localProjectPath, '.git');
    try {
      await access(gitPath, constants.F_OK);

      log.info(`[GIT-DISCOVERY] Successfully initialized git from ${pulledFiles.length} breadcrumbs`);

      return {
        gitExists: true,
        gitPath,
        source: 'gas-breadcrumbs',
        breadcrumbsPulled: pulledFiles,
        message: `Pulled ${pulledFiles.length} git files from GAS project`
      };
    } catch {
      // .git directory doesn't exist yet - may need manual git init
      log.warn('[GIT-DISCOVERY] Pulled breadcrumbs but .git directory not found - may need manual git init');

      return {
        gitExists: false,
        source: 'none',
        breadcrumbsPulled: pulledFiles,
        message: `Pulled ${pulledFiles.length} git files but .git not initialized - run 'git init' manually`
      };
    }

  } catch (error) {
    log.error('[GIT-DISCOVERY] Error scanning GAS breadcrumbs:', error instanceof Error ? error.message : String(error));
    return {
      gitExists: false,
      source: 'none',
      message: `Error scanning GAS: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Two-phase git discovery for GAS projects
 *
 * Phase A: Scans local filesystem (project + parents) for .git directory/file
 * Phase B: If not found, scans GAS project for .git/* breadcrumbs and pulls them down
 *
 * @param scriptId - GAS project ID
 * @param projectPath - Optional nested path within project (for polyrepo support)
 * @param gasClient - GAS API client
 * @param accessToken - OAuth access token
 * @returns Discovery result indicating if git exists and where it was found
 *
 * @example
 * // Discover git for root project
 * const result = await discoverGit('1Y72rigc...', '', gasClient, token);
 * if (result.gitExists) {
 *   console.log(`Git found at ${result.gitPath} (${result.source})`);
 * }
 *
 * @example
 * // Discover git for nested project (polyrepo)
 * const result = await discoverGit('1Y72rigc...', 'backend', gasClient, token);
 * // Searches: ~/gas-repos/project-1Y72rigc.../backend/.git
 */
export async function discoverGit(
  scriptId: string,
  projectPath: string = '',
  gasClient: GASClient,
  accessToken: string
): Promise<GitDiscoveryResult> {
  try {
    // Validate scriptId for filesystem safety
    validateScriptId(scriptId);

    // Resolve starting path: ~/gas-repos/project-{scriptId}/{projectPath}
    const baseProjectPath = expandTilde(`~/gas-repos/project-${scriptId}`);
    const startPath = projectPath ? join(baseProjectPath, projectPath) : baseProjectPath;

    log.debug(`[GIT-DISCOVERY] Starting two-phase discovery for ${scriptId} at ${startPath}`);

    // Phase A: Scan local filesystem
    log.debug('[GIT-DISCOVERY] Phase A: Scanning local filesystem...');
    const localResult = await scanLocalFilesystem(startPath);

    if (localResult.gitExists) {
      log.info(`[GIT-DISCOVERY] ✓ Phase A complete: ${localResult.source}`);
      return localResult;
    }

    // Phase B: Scan GAS for breadcrumbs
    log.debug('[GIT-DISCOVERY] Phase A: No local git found');
    log.debug('[GIT-DISCOVERY] Phase B: Scanning GAS for breadcrumbs...');

    const gasResult = await scanAndPullGASBreadcrumbs(
      scriptId,
      startPath,
      gasClient,
      accessToken
    );

    if (gasResult.gitExists) {
      log.info(`[GIT-DISCOVERY] ✓ Phase B complete: ${gasResult.source}`);
    } else {
      log.debug('[GIT-DISCOVERY] Phase B: No breadcrumbs found');
    }

    return gasResult;

  } catch (error) {
    log.error('[GIT-DISCOVERY] Unexpected error during discovery:', error instanceof Error ? error.message : String(error));
    return {
      gitExists: false,
      source: 'none',
      message: `Discovery failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
