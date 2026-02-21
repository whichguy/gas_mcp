/**
 * gitStatus - Utilities for checking git uncommitted status and building hints
 *
 * Used by write tools to provide structured git hints to LLMs
 * after auto-commit removal.
 */

import { spawn } from 'child_process';
import { log } from './logger.js';

/**
 * Information about uncommitted changes in a git repository
 */
export interface UncommittedInfo {
  count: number;
  files: string[];
  hasMore: boolean;
}

/**
 * Git hint structure returned by write tools
 */
export interface GitHint {
  detected: true;
  repoPath: string;
  branch: string;
  uncommittedChanges: UncommittedInfo & { thisFile: boolean };
  recommendation: {
    urgency: 'CRITICAL' | 'HIGH' | 'NORMAL';
    action: 'commit';
    command: string;
    reason: string;
  };
  taskCompletionBlocked: boolean;
}

/**
 * Git not detected result
 */
export interface GitNotDetected {
  detected: false;
}

/**
 * Execute a git command safely using spawn (no shell injection)
 *
 * @param args - Git command arguments
 * @param cwd - Working directory
 * @returns stdout from git command
 */
async function execGitCommand(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    git.stdout.on('data', (data) => { stdout += data.toString(); });
    git.stderr.on('data', (data) => { stderr += data.toString(); });

    git.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Git command failed with exit code ${code}`));
      }
    });

    git.on('error', (err) => {
      reject(new Error(`Failed to spawn git: ${err.message}`));
    });
  });
}

/**
 * Get uncommitted status from a git repository
 *
 * @param repoPath - Path to git repository root
 * @returns Information about uncommitted files
 */
export async function getUncommittedStatus(repoPath: string): Promise<UncommittedInfo> {
  try {
    const status = await execGitCommand(['status', '--porcelain'], repoPath);
    const lines = status.trim().split('\n').filter(Boolean);

    return {
      count: lines.length,
      files: lines.slice(0, 10).map(line => line.substring(3).trim()),
      hasMore: lines.length > 10
    };
  } catch (error) {
    log.warn(`[GIT-STATUS] Failed to get status for ${repoPath}:`, error instanceof Error ? error.message : String(error));
    return {
      count: 0,
      files: [],
      hasMore: false
    };
  }
}

/**
 * Get current branch name
 *
 * @param repoPath - Path to git repository root
 * @returns Branch name, 'HEAD' for detached HEAD, or 'unknown' on error
 */
export async function getCurrentBranchName(repoPath: string): Promise<string> {
  try {
    const branch = await execGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
    const trimmed = branch.trim();
    // rev-parse returns 'HEAD' when in detached HEAD state
    return trimmed || 'unknown';
  } catch (error) {
    log.warn(`[GIT-STATUS] Failed to get branch for ${repoPath}:`, error instanceof Error ? error.message : String(error));
    return 'unknown';
  }
}

/**
 * Check if currently in detached HEAD state
 *
 * @param repoPath - Path to git repository root
 * @returns true if in detached HEAD state
 */
export async function isDetachedHead(repoPath: string): Promise<boolean> {
  const branch = await getCurrentBranchName(repoPath);
  return branch === 'HEAD';
}

/**
 * Build a git hint structure for write tool responses
 *
 * @param scriptId - GAS script ID
 * @param repoPath - Path to git repository
 * @param uncommitted - Uncommitted status info
 * @param currentFile - The file that was just written (for thisFile check)
 * @returns Structured git hint for LLM consumption
 */
export async function buildGitHint(
  scriptId: string,
  repoPath: string,
  uncommitted: UncommittedInfo,
  currentFile?: string
): Promise<GitHint> {
  const branch = await getCurrentBranchName(repoPath);
  const detachedHead = branch === 'HEAD';

  // Check if current file is in uncommitted list
  const thisFile = currentFile
    ? uncommitted.files.some(f => f.includes(currentFile) || currentFile.includes(f))
    : true; // If no current file specified, assume it's uncommitted

  // Detached HEAD is always CRITICAL - commits will be orphaned
  if (detachedHead) {
    return {
      detected: true,
      repoPath,
      branch: 'HEAD (detached)',
      uncommittedChanges: {
        count: uncommitted.count,
        files: uncommitted.files,
        hasMore: uncommitted.hasMore,
        thisFile
      },
      recommendation: {
        urgency: 'CRITICAL',
        action: 'commit',
        command: `git_feature({operation:'start', scriptId:'${scriptId}', featureName:'recovery'})`,
        reason: 'DETACHED HEAD - create a branch first or commits will be orphaned!'
      },
      taskCompletionBlocked: true  // Always blocked in detached HEAD
    };
  }

  // Determine urgency based on uncommitted count
  const urgency: 'CRITICAL' | 'HIGH' | 'NORMAL' =
    uncommitted.count >= 5 ? 'CRITICAL' :
    uncommitted.count >= 3 ? 'HIGH' : 'NORMAL';

  // Build reason message based on urgency
  const reason = urgency === 'CRITICAL'
    ? `${uncommitted.count} files uncommitted - significant work at risk`
    : urgency === 'HIGH'
    ? `${uncommitted.count} files uncommitted - consider committing soon`
    : 'Changes not yet saved to git history';

  return {
    detected: true,
    repoPath,
    branch,
    uncommittedChanges: {
      count: uncommitted.count,
      files: uncommitted.files,
      hasMore: uncommitted.hasMore,
      thisFile
    },
    recommendation: {
      urgency,
      action: 'commit',
      command: `git_feature({operation:'commit', scriptId:'${scriptId}', message:'...'})`,
      reason
    },
    taskCompletionBlocked: uncommitted.count > 0
  };
}

/**
 * Compact git hint for token-efficient tool responses.
 * Replaces verbose GitHint (~200+ tokens) with ~40-60 tokens
 * while preserving all context-refresh value for LLMs.
 */
export interface CompactGitHint {
  branch: string;
  uncommitted: number;
  files?: string[];                    // only when count > 0, max 10
  blocked: boolean;
  urgency?: 'CRITICAL' | 'HIGH';      // omit for NORMAL
  action?: 'start' | 'commit' | 'finish'; // LLM-efficient alias for next-best-action
  workflow?: string[];                 // step-by-step guidance when blocked
}

/**
 * Build a compact git hint for tool responses.
 * ~85% token reduction vs verbose GitHint while preserving
 * all context-refresh value (branch, uncommitted count, files, action).
 *
 * @param branch - Current branch name
 * @param uncommitted - Uncommitted status info
 * @returns Compact hint structure
 */
export function buildCompactGitHint(
  branch: string,
  uncommitted: UncommittedInfo
): CompactGitHint {
  const urgency = uncommitted.count >= 5 ? 'CRITICAL' as const :
                  uncommitted.count >= 3 ? 'HIGH' as const : undefined;
  const onFeatureBranch = branch.startsWith('llm-feature-');
  return {
    branch,
    uncommitted: uncommitted.count,
    ...(uncommitted.count > 0 ? { files: uncommitted.files } : {}),
    blocked: uncommitted.count > 0,
    ...(urgency ? { urgency } : {}),
    ...(uncommitted.count > 0 ? { action: onFeatureBranch ? 'finish' as const : 'commit' as const } : {})
  };
}

/**
 * Build a lightweight git hint for read-only tool responses.
 * Returns action: 'start' when on main/master with 0 uncommitted changes,
 * signaling the LLM to create a feature branch before editing.
 * Delegates to buildCompactGitHint for commit/finish hints when changes exist.
 *
 * @param repoPath - Path to git repository root
 * @returns Compact hint structure (2 git spawns, ~10-20ms)
 */
export async function buildReadHint(repoPath: string): Promise<CompactGitHint> {
  const [branch, uncommitted] = await Promise.all([
    getCurrentBranchName(repoPath),
    getUncommittedStatus(repoPath)
  ]);

  // If there are uncommitted changes, use the standard write-tool hint logic
  if (uncommitted.count > 0) {
    return buildCompactGitHint(branch, uncommitted);
  }

  // On main/master with nothing uncommitted → suggest starting a feature branch
  const isMainBranch = branch === 'main' || branch === 'master';
  return {
    branch,
    uncommitted: 0,
    blocked: false,
    ...(isMainBranch ? { action: 'start' as const } : {})
  };
}

/**
 * Check if any GAS repos have uncommitted changes (for startup check)
 *
 * @returns Array of projects with uncommitted changes
 */
export async function checkAllReposForUncommitted(): Promise<Array<{
  scriptId: string;
  count: number;
  files: string[];
}>> {
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  const gasReposDir = path.join(os.homedir(), 'gas-repos');

  // Check if gas-repos directory exists
  if (!fs.existsSync(gasReposDir)) {
    return [];
  }

  const projects = fs.readdirSync(gasReposDir)
    .filter(d => d.startsWith('project-'));

  const uncommittedProjects: Array<{
    scriptId: string;
    count: number;
    files: string[];
  }> = [];

  for (const project of projects) {
    const projectPath = path.join(gasReposDir, project);
    const gitDir = path.join(projectPath, '.git');

    // Skip if no git directory
    if (!fs.existsSync(gitDir)) continue;

    const uncommitted = await getUncommittedStatus(projectPath);

    if (uncommitted.count > 0) {
      uncommittedProjects.push({
        scriptId: project.replace('project-', ''),
        count: uncommitted.count,
        files: uncommitted.files
      });
    }
  }

  return uncommittedProjects;
}
