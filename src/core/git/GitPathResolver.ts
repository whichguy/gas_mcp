/**
 * GitPathResolver - Resolves local git repository paths
 *
 * Ensures ALL tools (write/edit/aider/rsync) use the SAME local path
 * by checking for .git/config breadcrumbs in GAS projects.
 *
 * Resolution Strategy:
 * 1. Check for .git/config breadcrumb in GAS
 * 2. Use configured localPath from breadcrumb if exists
 * 3. Fall back to LocalFileManager default path
 *
 * This ensures consistency between:
 * - write/edit operations (create local commits)
 * - rsync operations (pull/push)
 */

import { log } from '../../utils/logger.js';
import { LocalFileManager } from '../../utils/localFileManager.js';
import { GitProjectManager } from '../../utils/GitProjectManager.js';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Git breadcrumb configuration from .git/config
 */
export interface GitBreadcrumbConfig {
  remote?: {
    origin?: {
      url: string;
    };
  };
  branch?: {
    [branchName: string]: any;
  };
  sync?: {
    localPath?: string;
    lastSync?: string;
  };
}

/**
 * Resolves local git repository paths with breadcrumb awareness
 */
export class GitPathResolver {
  private gitProjectManager: GitProjectManager;

  constructor() {
    this.gitProjectManager = new GitProjectManager();
  }

  /**
   * Resolve local git repository path for a GAS project
   *
   * Resolution order:
   * 1. .git/config breadcrumb localPath (if exists)
   * 2. LocalFileManager default path
   *
   * @param scriptId - GAS project ID
   * @param projectPath - Optional nested project path (for polyrepo)
   * @param accessToken - Optional access token for GAS API
   * @returns Absolute local file system path
   *
   * @example
   * // With breadcrumb: ~/my-custom-repos/project-123
   * const path = await resolver.resolve('abc123...');
   *
   * // Without breadcrumb: ~/gas-repos/project-abc123
   * const path = await resolver.resolve('abc123...');
   *
   * // With projectPath: ~/gas-repos/project-abc123/backend
   * const path = await resolver.resolve('abc123...', 'backend');
   */
  async resolve(scriptId: string, projectPath?: string, accessToken?: string): Promise<string> {
    log.debug(`[PATH-RESOLVER] Resolving path for ${scriptId}${projectPath ? `/${projectPath}` : ''}`);

    try {
      // Check for .git/config breadcrumb
      const breadcrumb = await this.getBreadcrumb(scriptId, projectPath, accessToken);

      if (breadcrumb?.sync?.localPath) {
        const configuredPath = this.expandPath(breadcrumb.sync.localPath);
        const resolvedPath = projectPath
          ? join(configuredPath, projectPath)
          : configuredPath;

        log.info(`[PATH-RESOLVER] Using breadcrumb path: ${resolvedPath}`);
        return resolvedPath;
      }

      log.debug(`[PATH-RESOLVER] No breadcrumb found, using LocalFileManager default`);

    } catch (error: any) {
      log.debug(`[PATH-RESOLVER] Error checking breadcrumb: ${error.message}`);
    }

    // Fall back to LocalFileManager default
    const workingDir = LocalFileManager.getResolvedWorkingDirectory();
    const projectName = scriptId;
    const defaultPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);

    const resolvedPath = projectPath
      ? join(defaultPath, projectPath)
      : defaultPath;

    log.info(`[PATH-RESOLVER] Using default path: ${resolvedPath}`);
    return resolvedPath;
  }

  /**
   * Check if .git/config breadcrumb exists in GAS project
   *
   * @param scriptId - GAS project ID
   * @param projectPath - Optional nested project path
   * @param accessToken - Optional access token for GAS API
   * @returns true if breadcrumb exists
   */
  async hasBreadcrumb(scriptId: string, projectPath?: string, accessToken?: string): Promise<boolean> {
    try {
      const breadcrumb = await this.getBreadcrumb(scriptId, projectPath, accessToken);
      return breadcrumb !== null;
    } catch {
      return false;
    }
  }

  /**
   * Get breadcrumb configuration from GAS project
   *
   * @param scriptId - GAS project ID
   * @param projectPath - Optional nested project path
   * @param accessToken - Optional access token
   * @returns Breadcrumb config or null if not found
   */
  async getBreadcrumb(
    scriptId: string,
    projectPath?: string,
    accessToken?: string
  ): Promise<GitBreadcrumbConfig | null> {
    try {
      // If no access token provided, return null (can't fetch from remote)
      if (!accessToken) {
        log.debug(`[PATH-RESOLVER] No access token, skipping breadcrumb fetch`);
        return null;
      }

      const config = await this.gitProjectManager.getProjectConfig(
        scriptId,
        accessToken,
        projectPath ?? ''
      );

      return config as GitBreadcrumbConfig | null;

    } catch (error: any) {
      log.debug(`[PATH-RESOLVER] Could not fetch breadcrumb: ${error.message}`);
      return null;
    }
  }

  /**
   * Expand ~ in file paths to home directory
   *
   * @param path - Path potentially starting with ~
   * @returns Expanded absolute path
   *
   * @example
   * expandPath('~/repos/project') // /Users/username/repos/project
   * expandPath('/absolute/path')  // /absolute/path
   */
  private expandPath(path: string): string {
    if (path.startsWith('~/') || path === '~') {
      return join(homedir(), path.slice(2));
    }
    return path;
  }

  /**
   * Get configured local path from breadcrumb (if exists)
   *
   * @param scriptId - GAS project ID
   * @param projectPath - Optional nested project path
   * @param accessToken - Optional access token
   * @returns Configured path or null
   */
  async getConfiguredPath(
    scriptId: string,
    projectPath?: string,
    accessToken?: string
  ): Promise<string | null> {
    const breadcrumb = await this.getBreadcrumb(scriptId, projectPath, accessToken);

    if (breadcrumb?.sync?.localPath) {
      return this.expandPath(breadcrumb.sync.localPath);
    }

    return null;
  }

  /**
   * Check if path is explicitly configured via breadcrumb
   *
   * @param scriptId - GAS project ID
   * @param projectPath - Optional nested project path
   * @param accessToken - Optional access token for GAS API
   * @returns true if path is configured (not using default)
   */
  async isPathConfigured(scriptId: string, projectPath?: string, accessToken?: string): Promise<boolean> {
    const configuredPath = await this.getConfiguredPath(scriptId, projectPath, accessToken);
    return configuredPath !== null;
  }
}
