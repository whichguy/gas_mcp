/**
 * GitOperationManager - Central orchestrator for ALL git operations
 *
 * Eliminates code duplication across tools by providing a unified workflow:
 * 1. Path resolution (considers .git/config.gs breadcrumbs)
 * 2. Feature branch management
 * 3. Pre-operation sync (if bidirectional mode)
 * 4. Operation execution
 * 5. Local commit with hook validation
 * 6. Post-operation sync (push to remote)
 * 7. Atomic rollback on failure
 *
 * This class is used by all write operations:
 * - EditTool, AiderTool, WriteTool
 * - MvTool, CpTool, RmTool
 * - CatTool (for sync variant)
 */

import { log } from '../../utils/logger.js';
import { FileFilter } from '../../utils/fileFilter.js';
import { ensureFeatureBranch } from '../../utils/gitAutoCommit.js';
import { clearGASMetadata, updateCachedContentHash } from '../../utils/gasMetadataCache.js';
import { computeGitSha1 } from '../../utils/hashUtils.js';
import { SessionWorktreeManager } from '../../utils/sessionWorktree.js';
import { buildCompactGitHint, type CompactGitHint } from '../../utils/gitStatus.js';
// Note: writeLocalAndValidateWithHooks no longer used - GitOperationManager stages only, doesn't commit
// import { writeLocalAndValidateWithHooks } from '../../utils/hookIntegration.js';
import type { GASClient } from '../../api/gasClient.js';
import type { GitPathResolver } from './GitPathResolver.js';
import type { SyncStrategyFactory } from './SyncStrategyFactory.js';
import type { FileOperationStrategy, OperationType } from './operations/FileOperationStrategy.js';

/**
 * Options for git operation execution
 */
export interface GitOperationOptions {
  scriptId: string;
  files: string[];
  changeReason?: string;
  mode?: 'auto' | 'simple' | 'local-only';
  projectPath?: string;
  accessToken?: string;
}

/**
 * Result of git operation execution
 *
 * IMPORTANT: Write operations do NOT auto-commit. The git.hint
 * field provides compact signals for LLMs to use git_feature({operation:'commit'}).
 */
export interface GitOperationResult<T> {
  success: boolean;
  result: T;
  git: {
    detected: true;
    branch: string;
    branchCreated: boolean;
    staged: boolean;
    stagedFiles: string[];
    localPath: string;
    syncMode: 'simple' | 'bidirectional' | 'local-only';
    filesAffected: string[];
    /** Compact git hint for LLM context-refresh (~40 tokens vs ~200 verbose) */
    hint: CompactGitHint;
  };
}

/**
 * Central orchestrator for git operations
 * Used by all tools to ensure consistent git workflow
 */
export class GitOperationManager {
  constructor(
    private pathResolver: GitPathResolver,
    private syncFactory: SyncStrategyFactory,
    private gasClient: GASClient
  ) {}

  /**
   * Universal git workflow for any file operation
   *
   * This method handles the complete git lifecycle:
   * - Path resolution
   * - Branch management
   * - Sync strategies (simple vs bidirectional)
   * - Commit creation
   * - Hook validation
   * - Atomic rollback on failure
   *
   * @example
   * const manager = new GitOperationManager(resolver, factory, client);
   * await manager.executeWithGit(
   *   new EditOperationStrategy(params),
   *   { scriptId, files: ['test.gs'], changeReason: 'Fix bug' }
   * );
   */
  async executeWithGit<T>(
    operation: FileOperationStrategy<T>,
    options: GitOperationOptions
  ): Promise<GitOperationResult<T>> {

    log.info(`[GIT-MANAGER] Starting git operation: ${operation.getType()}`);

    // PHASE 0: Setup & Path Resolution
    let localPath = await this.pathResolver.resolve(
      options.scriptId,
      options.projectPath,
      options.accessToken
    );

    log.info(`[GIT-MANAGER] Resolved local path: ${localPath}`);

    const hasBreadcrumb = await this.pathResolver.hasBreadcrumb(
      options.scriptId,
      options.projectPath,
      options.accessToken
    );

    // Determine sync mode
    // Note: Bidirectional mode removed - users should call rsync explicitly
    let syncMode: 'simple' | 'local-only';
    if (options.mode === 'local-only') {
      syncMode = 'local-only';
    } else {
      syncMode = 'simple';
    }

    log.info(`[GIT-MANAGER] Sync mode: ${syncMode} (breadcrumb: ${hasBreadcrumb})`);

    const syncStrategy = await this.syncFactory.create(syncMode, this.gasClient);

    // PHASE 1: Git Preparation - Ensure git repo exists and feature branch
    log.info(`[GIT-MANAGER] Ensuring git repository...`);
    const { LocalFileManager } = await import('../../utils/localFileManager.js');
    const gitStatus = await LocalFileManager.ensureProjectGitRepo(options.scriptId, localPath);

    if (gitStatus.gitInitialized) {
      log.debug(`[GIT-MANAGER] Git repository ready (new: ${gitStatus.isNewRepo})`);
    } else {
      throw new Error('Failed to initialize git repository');
    }

    // Session worktree: redirect local path to isolated worktree
    // Session worktrees have their own branch (session/{id}) - do NOT call ensureFeatureBranch
    // which would switch away from the session branch to llm-feature-auto-*
    let branchResult: { branch: string; created: boolean };

    if (options.accessToken) {
      const worktreeManager = new SessionWorktreeManager();
      localPath = await worktreeManager.ensureWorktree(
        options.scriptId,
        this.gasClient,
        options.accessToken
      );
      log.info(`[GIT-MANAGER] Using session worktree: ${localPath}`);

      // Get current branch name from the worktree (should be session/{id})
      const { getCurrentBranchName } = await import('../../utils/gitStatus.js');
      const currentBranch = await getCurrentBranchName(localPath);
      branchResult = { branch: currentBranch || `session/${worktreeManager['sessionId']}`, created: false };
      log.info(`[GIT-MANAGER] Session worktree branch: ${branchResult.branch}`);
    } else {
      log.info(`[GIT-MANAGER] Ensuring feature branch...`);
      branchResult = await ensureFeatureBranch(localPath);
      log.info(`[GIT-MANAGER] Branch: ${branchResult.branch} (created: ${branchResult.created})`);
    }

    // PHASE 2: Pre-Operation Sync (skipped - no bidirectional mode)
    // Note: Bidirectional sync removed. Users should call rsync before write operations.

    // PHASE 3: Compute Changes (read from remote, apply logic, NO writes)
    let operationResult: T;
    let stagedFiles: string[] = [];
    let affectedFiles: string[] = [];

    try {
      log.info(`[GIT-MANAGER] Computing changes: ${operation.getType()}`);

      // PHASE 3A: Compute changes (reads remote, applies logic, returns Map<filename, content>)
      const computedChanges = await operation.computeChanges();
      affectedFiles = operation.getAffectedFiles();

      log.info(`[GIT-MANAGER] Changes computed. Affected files: ${affectedFiles.join(', ')}`);

      // PHASE 4: Local Validation with Hooks (skip if local-only mode)
      let validatedContent = computedChanges; // Default: use computed as-is

      if (syncMode !== 'local-only') {
        const commitMessage = options.changeReason ||
          this.generateSmartCommitMessage(operation, affectedFiles);

        log.info(`[GIT-MANAGER] Validating with hooks: ${commitMessage}`);

        // Import file system utilities
        const { writeFile, mkdir, unlink, readFile } = await import('fs/promises');
        const { dirname, join } = await import('path');

        // STEP 1: Write ALL files to local disk (including deletions)
        log.debug(`[GIT-MANAGER] Writing ${computedChanges.size} file(s) to local disk`);

        const { LocalFileManager } = await import('../../utils/localFileManager.js');

        for (const [filename, content] of computedChanges.entries()) {
          // GAS .git/* are sync breadcrumbs — skip to avoid EEXIST (worktree) or overwriting real git config (repo)
          if (FileFilter.isGitBreadcrumbPath(filename)) {
            log.warn(`[GIT-MANAGER] Skipping git breadcrumb: ${filename}`);
            continue;
          }

          // Add file extension for local filesystem
          const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
          const fullFilename = filename + fileExtension;
          const filePath = join(localPath, fullFilename);

          if (content === '') {
            // File deletion: unlink local file
            try {
              await unlink(filePath);
              log.debug(`[GIT-MANAGER] Deleted local file: ${fullFilename}`);

              // Clear xattr cache to prevent stale hash detection if file is recreated
              await clearGASMetadata(filePath).catch(() => {
                // Non-fatal: xattr may not be supported or file already gone
              });
            } catch (error: any) {
              if (error.code !== 'ENOENT') {
                log.warn(`[GIT-MANAGER] Failed to delete ${fullFilename}: ${error.message}`);
              }
            }
          } else {
            // File creation/update: write content
            await mkdir(dirname(filePath), { recursive: true });
            await writeFile(filePath, content, 'utf-8');
            log.debug(`[GIT-MANAGER] Wrote local file: ${fullFilename}`);
          }
        }

        // STEP 2: Stage files (NO AUTO-COMMIT - aligns with Claude Code philosophy)
        // "NEVER commit changes unless the user explicitly asks you to."
        log.info(`[GIT-MANAGER] Staging ${affectedFiles.length} file(s) - NOT committing`);

        // Convert GAS filenames to local filenames with extensions for git
        const affectedFilesWithExtensions = affectedFiles.map(filename => {
          const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
          return filename + fileExtension;
        });

        const stageResult = await this.stageFiles(
          localPath,
          affectedFilesWithExtensions,
          operation.getType()
        );

        if (!stageResult.staged) {
          // Handle legitimate "remote-only delete" scenario:
          // File exists in GAS but was never synced to local git.
          // This produces "No changes to stage" because file was never tracked.
          const isRemoteOnlyDelete =
            operation.getType() === 'delete' &&
            stageResult.message === 'No changes to stage';

          if (isRemoteOnlyDelete) {
            // Verify ALL files are truly remote-only (don't exist locally)
            // to avoid masking real git errors (corruption, permissions, etc.)
            const { access } = await import('fs/promises');
            const filesExistingLocally: string[] = [];

            for (const filename of affectedFilesWithExtensions) {
              const filePath = join(localPath, filename);
              try {
                await access(filePath);
                filesExistingLocally.push(filename);
              } catch (error: any) {
                if (error.code !== 'ENOENT') {
                  // Permission error or other I/O error - not safe to proceed
                  throw new Error(
                    `Cannot verify file existence for "${filename}": ${error.message}`
                  );
                }
                // ENOENT - file doesn't exist locally (expected for remote-only)
              }
            }

            if (filesExistingLocally.length > 0) {
              // At least one file exists but git says no changes - real error
              throw new Error(
                `Git stage failed: ${stageResult.message} ` +
                `(files exist locally but git detected no changes: ${filesExistingLocally.join(', ')} - possible git issue)`
              );
            }

            // Valid remote-only scenario - proceed without local staging
            log.info(
              `[GIT-MANAGER] Delete operation: ${affectedFilesWithExtensions.length} file(s) not tracked in local git, ` +
              `proceeding with remote deletion only (no local staging needed)`
            );

          } else {
            // All other "no stage" cases are errors
            throw new Error(`Git stage failed: ${stageResult.message}`);
          }
        }

        stagedFiles = stageResult.stagedFiles;
        log.info(`[GIT-MANAGER] Staged ${stagedFiles.length} file(s) - NOT committed`);

        // STEP 3: Read back ALL hook-validated files
        log.debug(`[GIT-MANAGER] Reading back hook-validated content`);

        validatedContent = new Map<string, string>();

        for (const [filename, originalContent] of computedChanges.entries()) {
          // Add file extension for local filesystem
          const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
          const fullFilename = filename + fileExtension;
          const filePath = join(localPath, fullFilename);

          if (originalContent === '') {
            // Deleted file: keep as empty string
            validatedContent.set(filename, '');
            log.debug(`[GIT-MANAGER] Deletion confirmed: ${filename}`);
          } else {
            // Read back hook-validated content
            try {
              const hookValidatedContent = await readFile(filePath, 'utf-8');
              validatedContent.set(filename, hookValidatedContent);

              if (hookValidatedContent !== originalContent) {
                log.info(`[GIT-MANAGER] Hooks modified ${filename} (${originalContent.length} → ${hookValidatedContent.length} bytes)`);
              }
            } catch (error: any) {
              // If file doesn't exist after hooks, hooks may have deleted it
              if (error.code === 'ENOENT') {
                log.warn(`[GIT-MANAGER] File ${filename} not found after hooks - may have been deleted by hooks`);
                validatedContent.set(filename, '');
              } else {
                throw new Error(`Failed to read ${filename} after hooks: ${error.message}`);
              }
            }
          }
        }

        log.info(`[GIT-MANAGER] Validation complete. Staged: ${stagedFiles.length} file(s)`);
      }

      // PHASE 5: Apply validated changes to remote
      log.info(`[GIT-MANAGER] Applying validated changes to remote...`);

      operationResult = await operation.applyChanges(validatedContent);

      log.info(`[GIT-MANAGER] Remote write complete`);

      // Overwrite local files with WRAPPED content from strategy.
      // Strategies return wrappedContent (the content written to GAS remote).
      // Local files must match remote to prevent false sync drift detection.
      const wrappedContent = (operationResult as any)?.wrappedContent as Map<string, string> | undefined;
      if (wrappedContent && wrappedContent.size > 0 && syncMode !== 'local-only') {
        const { writeFile: writeFileAsync } = await import('fs/promises');
        const { join } = await import('path');
        const { LocalFileManager } = await import('../../utils/localFileManager.js');

        const wrappedFilesWithExt: string[] = [];
        for (const [filename, content] of wrappedContent) {
          const ext = LocalFileManager.getFileExtensionFromName(filename);
          const fullFilename = filename + ext;
          const filePath = join(localPath, fullFilename);
          await writeFileAsync(filePath, content, 'utf-8');
          const hash = computeGitSha1(content);
          await updateCachedContentHash(filePath, hash);
          wrappedFilesWithExt.push(fullFilename);
          log.debug(`[GIT-MANAGER] Overwrote local with wrapped content: ${fullFilename} (hash: ${hash.slice(0, 8)}...)`);
        }

        // Re-stage so git index matches working tree (WRAPPED content).
        // Step 2 staged UNWRAPPED content; this updates the index to WRAPPED.
        // Uses targeted `git add --` (not `git add .`) to avoid staging unrelated files.
        // Non-fatal: remote and local are consistent; only git index would be stale.
        try {
          const { spawn } = await import('child_process');
          await new Promise<void>((resolve, reject) => {
            const git = spawn('git', ['add', '--', ...wrappedFilesWithExt], {
              cwd: localPath,
              stdio: ['ignore', 'pipe', 'pipe']
            });
            git.on('close', (code) => code === 0 ? resolve() : reject(new Error(`git add exit code ${code}`)));
            git.on('error', reject);
          });
          log.debug(`[GIT-MANAGER] Re-staged ${wrappedContent.size} file(s) with wrapped content`);
        } catch (restageErr: any) {
          log.warn(`[GIT-MANAGER] Re-stage failed (non-fatal): ${restageErr.message}`);
        }
      }

      // SUCCESS
      log.info(`[GIT-MANAGER] Git operation completed successfully`);

      // Get uncommitted status for compact git hints
      const { getUncommittedStatus } = await import('../../utils/gitStatus.js');
      const uncommitted = await getUncommittedStatus(localPath);

      return {
        success: true,
        result: operationResult,
        git: {
          detected: true,
          branch: branchResult.branch,
          branchCreated: branchResult.created,
          staged: stagedFiles.length > 0,
          stagedFiles,
          localPath,
          syncMode,
          filesAffected: affectedFiles,
          hint: buildCompactGitHint(branchResult.branch, uncommitted)
        }
      };

    } catch (error: any) {
      // PHASE 6: Atomic Rollback
      log.error(`[GIT-MANAGER] Operation failed: ${error.message}`);

      // Unstage any staged files (no commits to revert since we don't auto-commit)
      if (stagedFiles.length > 0) {
        log.info(`[GIT-MANAGER] Unstaging ${stagedFiles.length} file(s)...`);

        try {
          const { spawn } = await import('child_process');

          // Check if repo has commits (empty repo can't use reset HEAD)
          const hasCommits = await new Promise<boolean>((resolve) => {
            const check = spawn('git', ['rev-parse', '--verify', 'HEAD'], { cwd: localPath });
            check.on('close', (code) => resolve(code === 0));
            check.on('error', () => resolve(false));
          });

          if (hasCommits) {
            // Normal unstage with reset HEAD
            await new Promise<void>((resolve, reject) => {
              const git = spawn('git', ['reset', 'HEAD', ...stagedFiles], {
                cwd: localPath,
                stdio: ['ignore', 'pipe', 'pipe']
              });
              git.on('close', (code) => code === 0 ? resolve() : reject(new Error(`git reset failed with exit code ${code}`)));
              git.on('error', reject);
            });
          } else {
            // Empty repo - use rm --cached
            await new Promise<void>((resolve, reject) => {
              const git = spawn('git', ['rm', '--cached', ...stagedFiles], {
                cwd: localPath,
                stdio: ['ignore', 'pipe', 'pipe']
              });
              git.on('close', (code) => code === 0 ? resolve() : reject(new Error(`git rm --cached failed with exit code ${code}`)));
              git.on('error', reject);
            });
          }

          log.info(`[GIT-MANAGER] Unstaging successful`);
        } catch (unstageError: any) {
          log.warn(`[GIT-MANAGER] Unstaging failed: ${unstageError.message}`);
        }
      }

      // Rollback the file operation itself
      try {
        log.info(`[GIT-MANAGER] Rolling back file operation...`);
        await operation.rollback();
        log.info(`[GIT-MANAGER] File operation rollback complete`);
      } catch (rollbackError: any) {
        log.error(`[GIT-MANAGER] File operation rollback failed: ${rollbackError.message}`);
      }

      throw new Error(
        `Git operation failed and was rolled back: ${error.message}`
      );
    }
  }

  /**
   * Stage specific files in a git repository at the given path.
   *
   * Uses `cwd: localPath` directly, which works for both main repos
   * (~/gas-repos/project-{id}/) and session worktrees (~/.mcp-gas/worktrees/{id}/{session}/).
   * This replaces LocalFileManager.stageChangesOnly() which hardcodes ~/gas-repos/.
   */
  private async stageFiles(
    localPath: string,
    files: string[],
    operationType: OperationType
  ): Promise<{ staged: boolean; stagedFiles: string[]; message: string }> {
    const { spawn } = await import('child_process');

    // Stage specific files (targeted, not `git add .`)
    await new Promise<void>((resolve, reject) => {
      const git = spawn('git', ['add', '--', ...files], {
        cwd: localPath,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stderr = '';
      git.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
      git.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Git add failed: ${stderr}`)));
      git.on('error', reject);
    });

    // Check what was actually staged
    const stagedFiles = await new Promise<string[]>((resolve) => {
      const git = spawn('git', ['diff', '--cached', '--name-only'], {
        cwd: localPath,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      git.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      git.on('close', () => {
        resolve(stdout.trim().split('\n').filter(f => f.length > 0));
      });
    });

    if (stagedFiles.length === 0) {
      return { staged: false, stagedFiles: [], message: 'No changes to stage' };
    }

    return {
      staged: true,
      stagedFiles,
      message: `Staged ${stagedFiles.length} file(s)`
    };
  }

  /**
   * Generate smart commit message based on operation type
   *
   * Provides sensible defaults if user doesn't provide custom message:
   * - edit: "Update {file}"
   * - aider: "Refactor {file}"
   * - move: "Move {from} to {to}"
   * - copy: "Copy {from} to {to}"
   * - delete: "Delete {file}"
   * - sync: "Sync {file} from remote"
   */
  private generateSmartCommitMessage(
    operation: FileOperationStrategy,
    files: string[]
  ): string {
    const type = operation.getType();
    const primaryFile = files[0];

    switch (type) {
      case 'edit':
        return `Update ${primaryFile}`;
      case 'aider':
        return `Refactor ${primaryFile}`;
      case 'write':
        return `Update ${primaryFile}`;
      case 'move':
        return files.length >= 2
          ? `Move ${files[0]} to ${files[1]}`
          : `Move ${primaryFile}`;
      case 'copy':
        return files.length >= 2
          ? `Copy ${files[0]} to ${files[1]}`
          : `Copy ${primaryFile}`;
      case 'delete':
        return `Delete ${primaryFile}`;
      case 'sync':
        return `Sync ${primaryFile} from remote`;
      default:
        return `Modify ${primaryFile}`;
    }
  }
}
