import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { spawn } from 'child_process';
import { LocalFileManager } from './localFileManager.js';
import { clearGASMetadata } from './gasMetadataCache.js';

/**
 * Result of hook validation and commit operation
 */
export interface HookValidationResult {
  success: boolean;
  contentAfterHooks?: string;
  hookModified?: boolean;
  commitHash?: string;
  error?: string;
  previousContent?: string | null;
}

/**
 * Write file locally, run git commit with hooks, and validate
 * This implements local-first validation before remote sync
 *
 * @param content - Original content to write
 * @param filePath - Full local file path
 * @param filename - File name for commit message
 * @param projectName - Project name for git operations
 * @param workingDir - Working directory
 * @param changeReason - Optional custom commit message. If omitted, defaults to "Update {filename}" or "Add {filename}"
 * @returns HookValidationResult with success status and final content
 */
export async function writeLocalAndValidateWithHooks(
  content: string,
  filePath: string,
  filename: string,
  projectName: string,
  workingDir?: string,
  changeReason?: string
): Promise<HookValidationResult> {
  let previousContent: string | null = null;

  try {
    // Step 1: Save previous version for potential rollback
    try {
      previousContent = await readFile(filePath, 'utf-8');
      console.error(`💾 [HOOK_VALIDATION] Saved previous content for rollback: ${filename}`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.error(`📄 [HOOK_VALIDATION] New file (no previous content): ${filename}`);
      } else {
        console.error(`⚠️  [HOOK_VALIDATION] Could not read previous content: ${error.message}`);
      }
    }

    // Step 2: Write new content to disk
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
    console.error(`✍️  [HOOK_VALIDATION] Wrote content to local file: ${filename}`);

    // Step 3: Attempt git commit (hooks execute here)
    console.error(`🔧 [HOOK_VALIDATION] Running git commit with hooks: ${filename}`);

    // Use custom changeReason or default message
    const commitMessage = changeReason || (previousContent !== null
      ? `Update ${filename}`
      : `Add ${filename}`);

    const gitResult = await LocalFileManager.autoCommitChanges(
      projectName,
      [filename],
      commitMessage,
      workingDir
    );

    // Step 4: Check if commit succeeded (hooks passed)
    if (!gitResult.committed) {
      // HOOKS FAILED OR NO CHANGES - Revert
      console.error(`❌ [HOOK_VALIDATION] Git commit failed: ${gitResult.message}`);

      await revertLocalFile(filePath, previousContent, filename);

      return {
        success: false,
        error: gitResult.message,
        previousContent
      };
    }

    console.error(`✅ [HOOK_VALIDATION] Git commit succeeded: ${gitResult.commitHash}`);

    // Step 5: Read final content (after hooks may have modified it)
    const contentAfterHooks = await readFile(filePath, 'utf-8');
    const hookModified = contentAfterHooks !== content;

    if (hookModified) {
      console.error(`🔧 [HOOK_VALIDATION] Hooks modified ${filename} (${content.length} → ${contentAfterHooks.length} bytes)`);
    }

    return {
      success: true,
      contentAfterHooks,
      hookModified,
      commitHash: gitResult.commitHash,
      previousContent
    };

  } catch (error: any) {
    // Catastrophic failure during validation
    console.error(`💥 [HOOK_VALIDATION] Unexpected error: ${error.message}`);

    // Attempt best-effort rollback
    await revertLocalFile(filePath, previousContent, filename).catch((revertError: any) => {
      console.error(`⚠️  [HOOK_VALIDATION] Rollback also failed: ${revertError.message}`);
    });

    return {
      success: false,
      error: `Hook validation failed: ${error.message}`,
      previousContent
    };
  }
}

/**
 * Revert local file to previous state or delete if it was new
 *
 * @param filePath - Full local file path
 * @param previousContent - Previous file content, or null if new file
 * @param filename - File name for logging
 */
async function revertLocalFile(
  filePath: string,
  previousContent: string | null,
  filename: string
): Promise<void> {
  try {
    if (previousContent !== null) {
      // Restore previous version
      await writeFile(filePath, previousContent, 'utf-8');
      console.error(`↩️  [HOOK_VALIDATION] Reverted to previous content: ${filename}`);
    } else {
      // Delete new file
      await unlink(filePath);
      // Clear xattr cache to prevent stale hash detection if file is recreated
      await clearGASMetadata(filePath).catch(() => {});
      console.error(`🗑️  [HOOK_VALIDATION] Removed new file: ${filename}`);
    }
  } catch (error: any) {
    console.error(`⚠️  [HOOK_VALIDATION] Revert failed: ${error.message}`);
    throw error;
  }
}

/**
 * Revert a git commit (used when remote sync fails after local commit)
 * Uses git revert to create a new commit that undoes changes
 *
 * @param projectPath - Full path to project directory
 * @param commitHash - Commit hash to revert
 * @param filename - File name for logging
 * @returns Success/failure result
 */
export async function revertGitCommit(
  projectPath: string,
  commitHash: string,
  filename: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    console.error(`↩️  [HOOK_ROLLBACK] Reverting commit ${commitHash} for ${filename}`);

    const gitRevert = spawn('git', ['revert', '--no-edit', commitHash], {
      cwd: projectPath,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    gitRevert.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    gitRevert.on('close', (code) => {
      if (code === 0) {
        console.error(`✅ [HOOK_ROLLBACK] Successfully reverted commit ${commitHash}`);
        resolve({ success: true });
      } else {
        console.error(`❌ [HOOK_ROLLBACK] Failed to revert commit: ${stderr}`);
        resolve({
          success: false,
          error: `Git revert failed: ${stderr}`
        });
      }
    });
  });
}

/**
 * Result of hook-only validation (no commit)
 */
export interface HookOnlyValidationResult {
  success: boolean;
  contentAfterHooks?: string;
  hookModified?: boolean;
  error?: string;
  previousContent?: string | null;
}

/**
 * Write file locally and run pre-commit hooks WITHOUT committing
 *
 * This implements local hook validation for the no-auto-commit workflow:
 * 1. Save previous content for rollback
 * 2. Write new content to disk
 * 3. Stage file with git add
 * 4. Run pre-commit hook directly (if exists)
 * 5. Read back hook-modified content
 * 6. Leave changes staged (no commit)
 *
 * IMPORTANT: This function requires the filename to include the file extension
 * (e.g., "file.html", not "file") because it performs git operations that
 * reference files on disk. The extension must match what LocalFileManager
 * writes to the filesystem.
 *
 * @param content - Original content to write
 * @param filePath - Full local file path (with extension, e.g., "/path/to/file.html")
 * @param filename - Relative file path within git repo (WITH extension, e.g., "sheets-sidebar/html/SidebarAppInit.html")
 * @param gitRoot - Git repository root path
 * @returns HookOnlyValidationResult with success status and final content
 *
 * @example
 * // Correct usage (with extension):
 * const filename = "sheets-sidebar/html/include/SidebarAppInit";
 * const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
 * const fullFilename = filename + fileExtension;  // "...SidebarAppInit.html"
 * await writeLocalAndValidateHooksOnly(content, filePath, fullFilename, gitRoot);
 *
 * @example
 * // Incorrect usage (without extension) - will cause git add to fail:
 * await writeLocalAndValidateHooksOnly(content, filePath, "file", gitRoot);
 */
export async function writeLocalAndValidateHooksOnly(
  content: string,
  filePath: string,
  filename: string,
  gitRoot: string
): Promise<HookOnlyValidationResult> {
  let previousContent: string | null = null;

  try {
    // Step 1: Save previous version for potential rollback
    try {
      previousContent = await readFile(filePath, 'utf-8');
      console.error(`💾 [HOOK_ONLY] Saved previous content for rollback: ${filename}`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.error(`📄 [HOOK_ONLY] New file (no previous content): ${filename}`);
      } else {
        console.error(`⚠️  [HOOK_ONLY] Could not read previous content: ${error.message}`);
      }
    }

    // Step 2: Write new content to disk
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
    console.error(`✍️  [HOOK_ONLY] Wrote content to local file: ${filename}`);

    // Step 3: Stage file with git add
    const addResult = await runGitCommand(['add', filename], gitRoot);
    if (!addResult.success) {
      console.error(`❌ [HOOK_ONLY] git add failed: ${addResult.error}`);
      await revertLocalFile(filePath, previousContent, filename);
      return {
        success: false,
        error: `git add failed: ${addResult.error}`,
        previousContent
      };
    }
    console.error(`📦 [HOOK_ONLY] Staged file: ${filename}`);

    // Step 4: Run pre-commit hook directly (if exists)
    const preCommitPath = `${gitRoot}/.git/hooks/pre-commit`;
    const { access } = await import('fs/promises');
    const { constants } = await import('fs');

    let hookRan = false;
    try {
      await access(preCommitPath, constants.X_OK);
      console.error(`🔧 [HOOK_ONLY] Running pre-commit hook...`);

      const hookResult = await runHook(preCommitPath, gitRoot);
      hookRan = true;

      if (!hookResult.success) {
        console.error(`❌ [HOOK_ONLY] Pre-commit hook failed: ${hookResult.error}`);

        // Unstage and revert (handles empty repos)
        await unstageFile(filename, gitRoot);
        await revertLocalFile(filePath, previousContent, filename);

        return {
          success: false,
          error: `Pre-commit hook failed: ${hookResult.error}`,
          previousContent
        };
      }
      console.error(`✅ [HOOK_ONLY] Pre-commit hook passed`);
    } catch (error: any) {
      // No pre-commit hook or not executable - that's OK
      if (error.code !== 'ENOENT' && error.code !== 'EACCES') {
        console.error(`⚠️  [HOOK_ONLY] Hook check error: ${error.message}`);
      }
    }

    // Step 5: Read final content (after hooks may have modified it)
    const contentAfterHooks = await readFile(filePath, 'utf-8');
    const hookModified = contentAfterHooks !== content;

    if (hookModified) {
      console.error(`🔧 [HOOK_ONLY] Hooks modified ${filename} (${content.length} → ${contentAfterHooks.length} bytes)`);

      // Re-stage modified content
      await runGitCommand(['add', filename], gitRoot);
    }

    // Step 6: Leave changes staged (no commit)
    // Changes are ready for user to commit via git_feature

    return {
      success: true,
      contentAfterHooks,
      hookModified,
      previousContent
    };

  } catch (error: any) {
    console.error(`💥 [HOOK_ONLY] Unexpected error: ${error.message}`);

    await revertLocalFile(filePath, previousContent, filename).catch((revertError: any) => {
      console.error(`⚠️  [HOOK_ONLY] Rollback also failed: ${revertError.message}`);
    });

    return {
      success: false,
      error: `Hook validation failed: ${error.message}`,
      previousContent
    };
  }
}

/**
 * Run a git command safely using spawn
 */
async function runGitCommand(args: string[], cwd: string): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const git = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    git.stdout?.on('data', (data) => { stdout += data.toString(); });
    git.stderr?.on('data', (data) => { stderr += data.toString(); });

    git.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout });
      } else {
        resolve({ success: false, error: stderr || `Exit code ${code}` });
      }
    });

    git.on('error', (err) => {
      resolve({ success: false, error: `Failed to spawn git: ${err.message}` });
    });
  });
}

/**
 * Unstage a file, handling empty repos (no commits yet)
 */
async function unstageFile(filename: string, cwd: string): Promise<{ success: boolean; error?: string }> {
  // Check if repo has any commits
  const hasCommits = await runGitCommand(['rev-parse', '--verify', 'HEAD'], cwd);

  if (hasCommits.success) {
    // Normal case: unstage with reset HEAD
    return runGitCommand(['reset', 'HEAD', filename], cwd);
  } else {
    // Empty repo: use rm --cached instead
    return runGitCommand(['rm', '--cached', filename], cwd);
  }
}

/**
 * Run a hook script
 */
async function runHook(hookPath: string, cwd: string): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const hook = spawn(hookPath, [], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_DIR: `${cwd}/.git` }
    });

    let stdout = '';
    let stderr = '';

    hook.stdout?.on('data', (data) => { stdout += data.toString(); });
    hook.stderr?.on('data', (data) => { stderr += data.toString(); });

    hook.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout });
      } else {
        resolve({ success: false, error: stderr || stdout || `Hook exit code ${code}` });
      }
    });

    hook.on('error', (err) => {
      resolve({ success: false, error: `Failed to run hook: ${err.message}` });
    });
  });
}

/**
 * Simplified write without hook validation (legacy behavior)
 * Just writes file and commits, no validation or rollback
 *
 * @param content - Content to write
 * @param filePath - Full local file path
 * @param filename - File name for commit message
 * @param projectName - Project name for git operations
 * @param workingDir - Working directory
 * @returns Simple success/failure result
 */
export async function writeLocalWithoutHooks(
  content: string,
  filePath: string,
  filename: string,
  projectName: string,
  workingDir?: string
): Promise<{ success: boolean; commitHash?: string; error?: string }> {
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');

    const commitMessage = `Update ${filename}`;
    const gitResult = await LocalFileManager.autoCommitChanges(
      projectName,
      [filename],
      commitMessage,
      workingDir
    );

    return {
      success: true,
      commitHash: gitResult.commitHash
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}
