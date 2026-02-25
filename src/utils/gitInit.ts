/**
 * gitInit - Shared git initialization utility
 *
 * Handles git repository initialization with smart config detection:
 * - Auto-initializes .git directory if missing
 * - Detects and uses global git config when available
 * - Falls back to sensible defaults if no global config
 */

import { access, constants } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mcpLogger } from './mcpLogger.js';

const execAsync = promisify(exec);

/**
 * Result of git initialization
 */
export interface GitInitResult {
  initialized: boolean;    // True if git repo exists (was already init or just initialized)
  isNew: boolean;          // True if .git was just created
  configSource: 'global' | 'defaults' | 'existing';  // Where git config came from
  repoPath: string;        // Absolute path to git repository
}

/**
 * Check if global git config is set
 *
 * @returns {name?: string, email?: string} - Global config values if set
 */
async function getGlobalGitConfig(): Promise<{name?: string; email?: string}> {
  try {
    const nameResult = await execAsync('git config --global user.name');
    const emailResult = await execAsync('git config --global user.email');

    return {
      name: nameResult.stdout.trim() || undefined,
      email: emailResult.stdout.trim() || undefined
    };
  } catch {
    // No global config set
    return {};
  }
}

/**
 * Set local git config with defaults
 *
 * @param repoPath - Path to git repository
 */
async function setDefaultGitConfig(repoPath: string): Promise<void> {
  try {
    await execAsync('git config user.name "MCP Gas"', { cwd: repoPath });
    await execAsync('git config user.email "mcp@gas.local"', { cwd: repoPath });
    mcpLogger.info('git', '[GIT-INIT] Set default git config (user.name="MCP Gas", user.email="mcp@gas.local")');
  } catch (error) {
    mcpLogger.warning('git', { message: '[GIT-INIT] Failed to set default git config', details: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Ensure git repository is initialized at given path
 *
 * Strategy:
 * 1. Check if .git already exists → return early
 * 2. Run git init to create .git directory
 * 3. Check for global git config
 * 4. If no global config, set local defaults
 *
 * @param repoPath - Absolute path where git repo should exist
 * @returns GitInitResult with initialization details
 *
 * @example
 * const result = await ensureGitInitialized('/Users/user/gas-repos/project-abc123');
 * if (result.isNew) {
 *   console.log(`Created new git repo, using ${result.configSource} config`);
 * }
 */
export async function ensureGitInitialized(repoPath: string): Promise<GitInitResult> {
  try {
    // Check if .git directory already exists
    const gitPath = join(repoPath, '.git');
    const gitExists = await access(gitPath, constants.F_OK).then(() => true).catch(() => false);

    if (gitExists) {
      mcpLogger.debug('git', `[GIT-INIT] Git repository already exists at ${repoPath}`);
      return {
        initialized: true,
        isNew: false,
        configSource: 'existing',
        repoPath
      };
    }

    // Initialize git repository
    mcpLogger.info('git', `[GIT-INIT] Initializing git repository at ${repoPath}`);

    try {
      await execAsync('git init', { cwd: repoPath });
      mcpLogger.info('git', `[GIT-INIT] ✓ Git repository initialized`);
    } catch (error) {
      mcpLogger.error('git', { message: '[GIT-INIT] Failed to run git init', details: error instanceof Error ? error.message : String(error) });
      throw new Error(`Git initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Check for global git config
    const globalConfig = await getGlobalGitConfig();

    let configSource: 'global' | 'defaults';

    if (globalConfig.name && globalConfig.email) {
      // Global config exists - git will use it automatically
      mcpLogger.info('git', `[GIT-INIT] Using global git config (name="${globalConfig.name}", email="${globalConfig.email}")`);
      configSource = 'global';
    } else {
      // No global config - set local defaults
      mcpLogger.info('git', '[GIT-INIT] No global git config found, setting local defaults');
      await setDefaultGitConfig(repoPath);
      configSource = 'defaults';
    }

    return {
      initialized: true,
      isNew: true,
      configSource,
      repoPath
    };

  } catch (error) {
    mcpLogger.error('git', { message: '[GIT-INIT] Unexpected error during git initialization', details: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
