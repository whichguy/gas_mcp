import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { spawn } from 'child_process';
import { LocalFileManager } from './localFileManager.js';

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
 * @returns HookValidationResult with success status and final content
 */
export async function writeLocalAndValidateWithHooks(
  content: string,
  filePath: string,
  filename: string,
  projectName: string,
  workingDir?: string
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

    const commitMessage = previousContent !== null
      ? `Update ${filename}`
      : `Add ${filename}`;

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
