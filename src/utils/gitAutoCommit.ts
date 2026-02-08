/**
 * gitAutoCommit - Feature branch management and auto-commit utilities
 *
 * Provides functions for:
 * - Auto-creating feature branches (only when needed)
 * - Branch detection and validation
 * - Feature workflow support
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { log } from './logger.js';
import { execGitCommand } from './gitCommands.js';

const execAsync = promisify(exec);

/**
 * Result of ensuring feature branch exists
 */
export interface FeatureBranchResult {
  branch: string;
  created: boolean;
}

/**
 * Get current git branch name
 *
 * @param projectPath - Path to git repository
 * @returns Current branch name, or null if not in a git repo or detached HEAD
 */
export async function getCurrentBranch(projectPath: string): Promise<string | null> {
  try {
    const result = await execAsync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectPath
    });

    const branch = result.stdout.trim();

    // Check for detached HEAD state
    if (branch === 'HEAD') {
      log.debug('[GIT-AUTO-COMMIT] In detached HEAD state');
      return null;
    }

    return branch || null;
  } catch (error) {
    // Not in a git repository or git command failed
    log.debug('[GIT-AUTO-COMMIT] Could not determine current branch:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Check if branch name matches feature branch pattern
 *
 * Feature branches start with 'llm-feature-' prefix.
 * Examples:
 * - llm-feature-user-auth ✓
 * - llm-feature-auto-20250121143022 ✓
 * - main ✗
 * - develop ✗
 * - feature/user-auth ✗
 *
 * @param branchName - Branch name to check
 * @returns true if branch is a feature branch
 */
export function isFeatureBranch(branchName: string): boolean {
  return branchName.startsWith('llm-feature-');
}

/**
 * Generate auto-generated feature branch name with timestamp
 *
 * Format: llm-feature-auto-YYYYMMDDHHmmss
 * Example: llm-feature-auto-20250121143022
 *
 * @returns Auto-generated branch name
 */
function generateAutoBranchName(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\..+$/, '')  // Remove milliseconds and Z
    .slice(0, 14);  // YYYYMMDDHHmmss (14 chars)

  return `llm-feature-auto-${timestamp}`;
}

/**
 * Ensure feature branch exists before committing
 *
 * Auto-creates feature branch ONLY if:
 * - Not already on a feature branch
 * - Git repository exists and is accessible
 *
 * If already on a feature branch (e.g., llm-feature-user-auth), uses that branch.
 * If on non-feature branch (e.g., main), creates new auto-generated branch.
 *
 * Branch naming:
 * - Auto-created: llm-feature-auto-{timestamp}
 * - Explicit (via git_feature start): llm-feature-{featureName}
 *
 * @param projectPath - Path to git repository root
 * @returns Branch name and whether it was created
 * @throws Error if git operations fail
 *
 * @example
 * // Already on feature branch - reuse it
 * const result = await ensureFeatureBranch('/path/to/repo');
 * // { branch: 'llm-feature-user-auth', created: false }
 *
 * @example
 * // On main branch - create auto branch
 * const result = await ensureFeatureBranch('/path/to/repo');
 * // { branch: 'llm-feature-auto-20250121143022', created: true }
 */
export async function ensureFeatureBranch(projectPath: string): Promise<FeatureBranchResult> {
  try {
    // Get current branch
    const currentBranch = await getCurrentBranch(projectPath);

    if (!currentBranch) {
      throw new Error('Could not determine current git branch - not in a git repository or in detached HEAD state');
    }

    // Already on feature branch - use it
    if (isFeatureBranch(currentBranch)) {
      log.info(`[GIT-AUTO-COMMIT] Using existing feature branch: ${currentBranch}`);
      return {
        branch: currentBranch,
        created: false
      };
    }

    // Not on feature branch - create new auto-generated branch
    const newBranchName = generateAutoBranchName();

    log.info(`[GIT-AUTO-COMMIT] Creating new feature branch: ${newBranchName}`);

    // SECURITY: Use spawn with array args to prevent shell injection
    await execGitCommand(['checkout', '-b', newBranchName], projectPath);

    log.info(`[GIT-AUTO-COMMIT] ✓ Feature branch created: ${newBranchName}`);

    return {
      branch: newBranchName,
      created: true
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('[GIT-AUTO-COMMIT] Error ensuring feature branch:', errorMsg);
    throw new Error(`Failed to ensure feature branch: ${errorMsg}`);
  }
}

/**
 * Check if there are uncommitted changes in the repository
 *
 * @param projectPath - Path to git repository root
 * @returns true if there are uncommitted changes
 * @throws Error if git command fails
 */
export async function hasUncommittedChanges(projectPath: string): Promise<boolean> {
  try {
    const result = await execAsync('git status --porcelain', {
      cwd: projectPath
    });

    return !!result.stdout.trim();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('[GIT-AUTO-COMMIT] Error checking git status:', errorMsg);
    throw new Error(`Failed to check git status: ${errorMsg}`);
  }
}

/**
 * Get list of all branches in repository
 *
 * @param projectPath - Path to git repository root
 * @returns Array of branch names
 * @throws Error if git command fails
 */
export async function getAllBranches(projectPath: string): Promise<string[]> {
  try {
    const result = await execAsync('git branch', {
      cwd: projectPath
    });

    return result.stdout
      .split('\n')
      .map(line => line.trim().replace(/^\*\s+/, ''))  // Remove * marker from current branch
      .filter(Boolean);  // Remove empty lines
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('[GIT-AUTO-COMMIT] Error listing branches:', errorMsg);
    throw new Error(`Failed to list branches: ${errorMsg}`);
  }
}

/**
 * Get list of feature branches only
 *
 * @param projectPath - Path to git repository root
 * @returns Array of feature branch names
 */
export async function getFeatureBranches(projectPath: string): Promise<string[]> {
  const allBranches = await getAllBranches(projectPath);
  return allBranches.filter(isFeatureBranch);
}
