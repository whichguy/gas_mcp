import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { spawn } from 'child_process';

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
      console.error(`🗑️  [HOOK_VALIDATION] Removed new file: ${filename}`);
    }
  } catch (error: any) {
    console.error(`⚠️  [HOOK_VALIDATION] Revert failed: ${error.message}`);
    throw error;
  }
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
    // Use git rev-parse to resolve hooks dir — .git is a file in worktrees, not a directory
    const hooksPathResult = await runGitCommand(['rev-parse', '--git-path', 'hooks/pre-commit'], gitRoot);
    const preCommitPath = hooksPathResult.success && hooksPathResult.output?.trim()
      ? (hooksPathResult.output.trim().startsWith('/') ? hooksPathResult.output.trim() : `${gitRoot}/${hooksPathResult.output.trim()}`)
      : `${gitRoot}/.git/hooks/pre-commit`;
    const { access } = await import('fs/promises');
    const { constants } = await import('fs');

    try {
      await access(preCommitPath, constants.X_OK);
      console.error(`🔧 [HOOK_ONLY] Running pre-commit hook...`);

      const hookResult = await runHook(preCommitPath, gitRoot);

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
export async function unstageFile(filename: string, cwd: string): Promise<{ success: boolean; error?: string }> {
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
