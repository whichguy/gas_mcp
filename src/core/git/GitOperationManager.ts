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
import { ensureFeatureBranch } from '../../utils/gitAutoCommit.js';
import { writeLocalAndValidateWithHooks, revertGitCommit } from '../../utils/hookIntegration.js';
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
 */
export interface GitOperationResult<T> {
  success: boolean;
  result: T;
  git: {
    branch: string;
    branchCreated: boolean;
    commit: string;
    commitMessage: string;
    localPath: string;
    syncMode: 'simple' | 'bidirectional' | 'local-only';
    filesAffected: string[];
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
    const localPath = await this.pathResolver.resolve(
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
    // Note: Bidirectional mode removed - users should call local_sync explicitly
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

    log.info(`[GIT-MANAGER] Ensuring feature branch...`);
    const branchResult = await ensureFeatureBranch(localPath);
    log.info(`[GIT-MANAGER] Branch: ${branchResult.branch} (created: ${branchResult.created})`);

    // PHASE 2: Pre-Operation Sync (skipped - no bidirectional mode)
    // Note: Bidirectional sync removed. Users should call local_sync before write operations.

    // PHASE 3: Compute Changes (read from remote, apply logic, NO writes)
    let operationResult: T;
    let commitHash: string | null = null;
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
          // Add file extension for local filesystem
          const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
          const fullFilename = filename + fileExtension;
          const filePath = join(localPath, fullFilename);

          if (content === '') {
            // File deletion: unlink local file
            try {
              await unlink(filePath);
              log.debug(`[GIT-MANAGER] Deleted local file: ${fullFilename}`);
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

        // STEP 2: Single git commit with ALL affected files
        log.info(`[GIT-MANAGER] Creating single commit for ${affectedFiles.length} file(s)`);

        // Convert GAS filenames to local filenames with extensions for git
        const affectedFilesWithExtensions = affectedFiles.map(filename => {
          const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
          return filename + fileExtension;
        });

        const gitResult = await LocalFileManager.autoCommitChanges(
          options.scriptId,
          affectedFilesWithExtensions,
          commitMessage,
          localPath
        );

        if (!gitResult.committed) {
          throw new Error(`Git commit failed: ${gitResult.message}`);
        }

        commitHash = gitResult.commitHash || null;
        log.info(`[GIT-MANAGER] Commit created: ${commitHash}`);

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

        log.info(`[GIT-MANAGER] Validation complete. Commit: ${commitHash}`);
      }

      // PHASE 5: Apply validated changes to remote
      log.info(`[GIT-MANAGER] Applying validated changes to remote...`);

      operationResult = await operation.applyChanges(validatedContent);

      log.info(`[GIT-MANAGER] Remote write complete`);

      // SUCCESS
      log.info(`[GIT-MANAGER] Git operation completed successfully`);

      return {
        success: true,
        result: operationResult,
        git: {
          branch: branchResult.branch,
          branchCreated: branchResult.created,
          commit: commitHash || 'none',
          commitMessage: options.changeReason ||
            this.generateSmartCommitMessage(operation, affectedFiles),
          localPath,
          syncMode,
          filesAffected: affectedFiles
        }
      };

    } catch (error: any) {
      // PHASE 6: Atomic Rollback
      log.error(`[GIT-MANAGER] Operation failed: ${error.message}`);

      if (commitHash) {
        log.info(`[GIT-MANAGER] Rolling back commit: ${commitHash}`);

        const revertResult = await revertGitCommit(
          localPath,
          commitHash,
          affectedFiles.join(', ')
        );

        if (!revertResult.success) {
          log.error(`[GIT-MANAGER] Rollback failed: ${revertResult.error}`);
        } else {
          log.info(`[GIT-MANAGER] Rollback successful`);
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
