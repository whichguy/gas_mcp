/**
 * Local Mirror Utility
 *
 * Provides centralized logic for all MCP tools to automatically mirror files
 * to the local filesystem with auto-commit to appropriate git repositories.
 *
 * Core principles:
 * - Every write operation mirrors to ~/gas-repos/project-{scriptId}/{path}
 * - Auto-detects which git repo to use (nested or root)
 * - Auto-commits changes with descriptive messages
 * - Handles repo initialization if needed
 */

import { access, mkdir, writeFile, readFile, appendFile, stat, constants } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import { unwrapModuleContent } from './moduleWrapper.js';

const execAsync = promisify(exec);

/**
 * Result of mirroring a file locally
 */
export interface MirrorResult {
  success: boolean;
  localPath: string;
  repoPath: string | null;
  committed: boolean;
  commitHash?: string;
  error?: string;
}

/**
 * Options for mirroring a file
 */
export interface MirrorOptions {
  scriptId: string;
  gasPath: string;          // Path in GAS (e.g., 'frontend/App')
  content: string;          // File content (unwrapped if CommonJS)
  fileType?: 'SERVER_JS' | 'HTML' | 'JSON';
  changeReason?: string;    // Custom commit message
}

/**
 * Expand tilde (~) in paths
 */
function expandPath(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * Check if a directory exists
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert GAS path to local filesystem path
 *
 * Examples:
 * - 'frontend/App' → 'frontend/App.js' (SERVER_JS)
 * - 'frontend/index' → 'frontend/index.html' (HTML)
 * - '.gitignore' → '.gitignore' (special files)
 */
function gasPathToLocalPath(gasPath: string, fileType?: string): string {
  // Special files keep their names
  if (gasPath.startsWith('.') || gasPath === 'README') {
    return gasPath;
  }

  // Add extension based on file type
  switch (fileType) {
    case 'SERVER_JS':
      return gasPath + '.js';
    case 'HTML':
      return gasPath + '.html';
    case 'JSON':
      return gasPath + '.json';
    default:
      return gasPath + '.js';  // Default to .js
  }
}

/**
 * Find the appropriate git repository for a file
 *
 * Walks up from the file path looking for .git directory.
 * Returns the repo path or null if no repo found.
 *
 * Algorithm:
 * 1. Start at file's directory
 * 2. Check if .git exists
 * 3. If yes, return this repo path
 * 4. If no, go up one level
 * 5. Repeat until root or repo found
 *
 * Example:
 * File: ~/gas-repos/project-abc123/frontend/components/App.js
 * Check: ~/gas-repos/project-abc123/frontend/components/.git (no)
 * Check: ~/gas-repos/project-abc123/frontend/.git (FOUND!)
 * Return: ~/gas-repos/project-abc123/frontend
 */
export async function findGitRepoForFile(
  scriptId: string,
  gasPath: string
): Promise<string | null> {
  const localBase = expandPath(`~/gas-repos/project-${scriptId}`);
  const localPath = gasPathToLocalPath(gasPath);
  const fullPath = path.join(localBase, localPath);

  // Start from file's directory
  let currentDir = path.dirname(fullPath);
  const rootDir = path.parse(currentDir).root;

  while (currentDir !== rootDir) {
    const gitDir = path.join(currentDir, '.git');

    if (await directoryExists(gitDir)) {
      return currentDir;
    }

    // Move up one level
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;  // Reached root
    }
    currentDir = parentDir;

    // Stop if we've gone above the gas-repos directory
    if (!currentDir.includes('gas-repos')) {
      break;
    }
  }

  return null;
}

/**
 * Initialize a git repository if it doesn't exist
 *
 * Creates:
 * - .git directory
 * - Initial commit with .gitkeep
 * - main branch
 */
async function ensureGitRepo(repoPath: string): Promise<void> {
  const gitDir = path.join(repoPath, '.git');

  if (await directoryExists(gitDir)) {
    return;  // Repo already exists
  }

  console.error(`[LOCAL-MIRROR] Initializing git repo at: ${repoPath}`);

  try {
    // Initialize repo
    await execAsync('git init', { cwd: repoPath });

    // Set default branch to main
    await execAsync('git checkout -b main', { cwd: repoPath });

    // Create initial commit so HEAD exists
    const gitkeepPath = path.join(repoPath, '.gitkeep');
    await writeFile(gitkeepPath, '', 'utf8');
    await execAsync('git add .gitkeep', { cwd: repoPath });
    await execAsync('git commit -m "Initial commit"', { cwd: repoPath });

    console.error(`[LOCAL-MIRROR] ✅ Git repo initialized with initial commit`);
  } catch (error: any) {
    console.error(`[LOCAL-MIRROR] ❌ Failed to initialize git repo:`, error.message);
    throw error;
  }
}

/**
 * Add a nested repo directory to parent's .gitignore
 *
 * Prevents parent repo from seeing nested repo files as untracked.
 */
async function addNestedRepoToGitignore(
  parentRepoPath: string,
  nestedDirName: string
): Promise<void> {
  const gitignorePath = path.join(parentRepoPath, '.gitignore');
  const ignorePattern = `${nestedDirName}/`;

  try {
    // Read existing .gitignore
    let existing = '';
    try {
      existing = await readFile(gitignorePath, 'utf8');
    } catch {
      // File doesn't exist yet
    }

    // Check if pattern already exists
    const lines = existing.split('\n');
    if (lines.includes(ignorePattern) || lines.includes(ignorePattern.slice(0, -1))) {
      return;  // Already ignored
    }

    // Append pattern
    await appendFile(gitignorePath, `${ignorePattern}\n`);
    console.error(`[LOCAL-MIRROR] 📝 Added ${ignorePattern} to parent .gitignore`);
  } catch (error: any) {
    console.error(`[LOCAL-MIRROR] ⚠️  Failed to update .gitignore:`, error.message);
    // Non-fatal - continue
  }
}

/**
 * Auto-commit file changes to git
 *
 * Handles:
 * - Uncommitted changes (creates WIP commit first)
 * - Staging the file
 * - Creating commit with descriptive message
 * - Returning commit hash
 */
async function autoCommitFile({
  repoPath,
  filePath,
  changeReason
}: {
  repoPath: string;
  filePath: string;
  changeReason: string;
}): Promise<{ committed: boolean; commitHash?: string }> {
  try {
    // Check for uncommitted changes
    const statusResult = await execAsync('git status --porcelain', { cwd: repoPath });
    const hasUncommitted = statusResult.stdout.trim().length > 0;

    if (hasUncommitted) {
      // Create WIP commit for existing changes
      try {
        await execAsync('git add -A', { cwd: repoPath });
        await execAsync('git commit -m "WIP: Save before auto-mirror"', { cwd: repoPath });
        console.error(`[LOCAL-MIRROR] 💾 Saved uncommitted changes as WIP`);
      } catch (commitError) {
        // Might fail if nothing to commit after staging
      }
    }

    // Stage our file
    const relativePath = path.relative(repoPath, filePath);
    await execAsync(`git add "${relativePath}"`, { cwd: repoPath });

    // Commit
    const commitMessage = changeReason || `Update ${path.basename(filePath)}`;
    await execAsync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { cwd: repoPath });

    // Get commit hash
    const hashResult = await execAsync('git rev-parse HEAD', { cwd: repoPath });
    const commitHash = hashResult.stdout.trim();

    console.error(`[LOCAL-MIRROR] ✅ Committed: ${commitHash.slice(0, 7)} - ${commitMessage}`);

    return { committed: true, commitHash };
  } catch (error: any) {
    console.error(`[LOCAL-MIRROR] ❌ Failed to commit:`, error.message);
    return { committed: false };
  }
}

/**
 * Mirror a file from GAS to local filesystem with auto-commit
 *
 * This is the main entry point used by all MCP tools.
 *
 * Process:
 * 1. Determine local file path
 * 2. Create directory structure
 * 3. Write file content
 * 4. Find appropriate git repo (or create at root)
 * 5. Auto-commit changes
 * 6. Handle nested repo .gitignore pollution
 */
export async function mirrorFileLocally(options: MirrorOptions): Promise<MirrorResult> {
  const {
    scriptId,
    gasPath,
    content,
    fileType = 'SERVER_JS',
    changeReason
  } = options;

  try {
    // Construct local path
    const localBase = expandPath(`~/gas-repos/project-${scriptId}`);
    const localPath = gasPathToLocalPath(gasPath, fileType);
    const fullPath = path.join(localBase, localPath);

    console.error(`[LOCAL-MIRROR] Mirroring: ${gasPath} → ${fullPath}`);

    // Create directory structure
    const fileDir = path.dirname(fullPath);
    await mkdir(fileDir, { recursive: true });

    // Write file content
    await writeFile(fullPath, content, 'utf8');
    console.error(`[LOCAL-MIRROR] 📄 File written: ${localPath}`);

    // Find git repo (walk up from file)
    let repoPath = await findGitRepoForFile(scriptId, gasPath);

    // If no repo found, create at root
    if (!repoPath) {
      repoPath = localBase;
      console.error(`[LOCAL-MIRROR] No git repo found, using root: ${repoPath}`);

      // Ensure root repo exists
      await mkdir(repoPath, { recursive: true });
      await ensureGitRepo(repoPath);
    }

    // Handle nested repo .gitignore pollution
    // If file is in a nested repo, add to parent's .gitignore
    if (repoPath !== localBase) {
      const parentRepoPath = path.dirname(repoPath);
      const parentGitDir = path.join(parentRepoPath, '.git');

      if (await directoryExists(parentGitDir)) {
        const nestedDirName = path.basename(repoPath);
        await addNestedRepoToGitignore(parentRepoPath, nestedDirName);
      }
    }

    // Auto-commit
    const commitResult = await autoCommitFile({
      repoPath,
      filePath: fullPath,
      changeReason: changeReason || `Update ${gasPath}`
    });

    return {
      success: true,
      localPath: fullPath,
      repoPath,
      committed: commitResult.committed,
      commitHash: commitResult.commitHash
    };

  } catch (error: any) {
    console.error(`[LOCAL-MIRROR] ❌ Mirror failed:`, error.message);
    return {
      success: false,
      localPath: '',
      repoPath: null,
      committed: false,
      error: error.message
    };
  }
}

/**
 * Mirror multiple files in batch
 *
 * Used by local_sync and bulk operations.
 * More efficient than calling mirrorFileLocally multiple times.
 */
export async function mirrorFilesLocally(
  scriptId: string,
  files: Array<{ gasPath: string; content: string; fileType?: string }>
): Promise<MirrorResult[]> {
  const results: MirrorResult[] = [];

  for (const file of files) {
    const result = await mirrorFileLocally({
      scriptId,
      gasPath: file.gasPath,
      content: file.content,
      fileType: file.fileType as any
    });
    results.push(result);
  }

  return results;
}
