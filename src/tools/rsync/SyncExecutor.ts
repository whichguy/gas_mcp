/**
 * SyncExecutor - Applies sync operations (pull or push)
 *
 * Receives a computed diff and applies the changes:
 * - Pull: Write files to local, git add/commit
 * - Push: Wrap with CommonJS, update GAS via API
 * - Update manifest after successful sync
 *
 * Key responsibilities:
 * - Deletion confirmation enforcement
 * - Atomic execution with rollback support
 * - Manifest update after sync
 *
 * Stateless: Receives diff directly from caller. No PlanStore, no drift detection.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { log } from '../../utils/logger.js';
import { SyncManifest } from './SyncManifest.js';
import { SyncDiffResult } from './SyncDiff.js';
import { GASClient, GASFile } from '../../api/gasClient.js';
import { isManifestFile } from '../../utils/fileHelpers.js';
import {
  shouldWrapContent,
  unwrapModuleContent,
  wrapModuleContent,
  getModuleName
} from '../../utils/moduleWrapper.js';
import { computeGitSha1 } from '../../utils/hashUtils.js';
import { updateCachedContentHash, clearGASMetadata, cacheGASMetadata } from '../../utils/gasMetadataCache.js';
import { analyzeContent } from '../../utils/contentAnalyzer.js';

/**
 * Error codes for execution phase
 */
export type SyncExecuteErrorCode =
  | 'DELETION_REQUIRES_CONFIRMATION'
  | 'BOOTSTRAP_NO_DELETE'
  | 'EXECUTION_ERROR'
  | 'GIT_ERROR'
  | 'API_ERROR';

/**
 * Error thrown during execution phase
 */
export class SyncExecuteError extends Error {
  constructor(
    public readonly code: SyncExecuteErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SyncExecuteError';
  }
}

/**
 * Options for applying sync operations
 */
export interface ApplyOptions {
  direction: 'pull' | 'push';
  scriptId: string;
  operations: SyncDiffResult;
  localPath: string;
  isBootstrap: boolean;
  accessToken: string;
  confirmDeletions?: boolean;
  /** Pre-fetched GAS files from diff computation to avoid redundant API calls */
  prefetchedGasFiles?: GASFile[];
}

/**
 * Result of successful sync execution
 */
export interface SyncResult {
  success: true;
  direction: 'pull' | 'push';
  filesAdded: number;
  filesUpdated: number;
  filesDeleted: number;
  commitSha?: string;
  recoveryInfo: {
    method: string;
    command: string;
  };
  contentAnalysis?: { file: string; warnings: string[]; hints: string[] }[];
}

/**
 * SyncExecutor class for applying sync operations
 */
export class SyncExecutor {
  private gasClient: GASClient;

  constructor(gasClient?: GASClient) {
    this.gasClient = gasClient || new GASClient();
  }

  /**
   * Apply sync operations
   *
   * @param options - Apply options with diff and context
   * @returns SyncResult with execution details
   * @throws SyncExecuteError on failure
   */
  async apply(options: ApplyOptions): Promise<SyncResult> {
    const { direction, scriptId, operations, localPath, isBootstrap, accessToken, confirmDeletions = false, prefetchedGasFiles } = options;

    log.info(`[EXECUTOR] Applying ${direction} sync: +${operations.add.length} ~${operations.update.length} -${operations.delete.length}`);

    // Validate deletion confirmation
    if (operations.delete.length > 0) {
      if (isBootstrap) {
        throw new SyncExecuteError(
          'BOOTSTRAP_NO_DELETE',
          'First sync cannot delete files. Complete the bootstrap sync first, then manually delete if needed.',
          { deletionCount: operations.delete.length }
        );
      }

      if (!confirmDeletions) {
        throw new SyncExecuteError(
          'DELETION_REQUIRES_CONFIRMATION',
          `Sync will delete ${operations.delete.length} file(s). Pass confirmDeletions: true to proceed.`,
          {
            deletionCount: operations.delete.length,
            files: operations.delete.map(f => f.filename)
          }
        );
      }
    }

    let preCommitSha: string | undefined;

    try {
      // Create git checkpoint (for PULL operations)
      if (direction === 'pull') {
        preCommitSha = await this.getGitCommit(localPath);
      }

      // Execute based on direction
      let postPushFiles: GASFile[] | undefined;
      let pullContentAnalysis: { file: string; warnings: string[]; hints: string[] }[] | undefined;
      if (direction === 'pull') {
        pullContentAnalysis = await this.executePull(operations, localPath);
      } else {
        postPushFiles = await this.executePush(operations, scriptId, accessToken, prefetchedGasFiles);
      }

      // Update manifest (reuse post-push files to avoid redundant fetch)
      await this.updateManifest(scriptId, direction, localPath, accessToken, postPushFiles);

      // Get new commit SHA (for PULL)
      const newCommitSha = direction === 'pull'
        ? await this.getGitCommit(localPath)
        : undefined;

      // Build and return result
      const result: SyncResult = {
        success: true,
        direction,
        filesAdded: operations.add.length,
        filesUpdated: operations.update.length,
        filesDeleted: operations.delete.length,
        commitSha: newCommitSha,
        recoveryInfo: direction === 'pull'
          ? {
              method: 'git reset',
              command: `git -C ${localPath} reset --hard ${preCommitSha || 'HEAD~1'}`
            }
          : {
              method: 'git reset + push',
              command: `git -C ${localPath} reset --hard HEAD~1 && rsync({operation: 'push', scriptId: '${scriptId}'})`
            }
      };

      // Attach content analysis hints (pull only — non-empty entries)
      if (pullContentAnalysis && pullContentAnalysis.length > 0) {
        result.contentAnalysis = pullContentAnalysis;
      }

      log.info(`[EXECUTOR] Sync complete: +${result.filesAdded} ~${result.filesUpdated} -${result.filesDeleted}`);

      return result;

    } catch (error) {
      // Re-throw SyncExecuteError as-is
      if (error instanceof SyncExecuteError) {
        throw error;
      }

      // Wrap other errors
      log.error(`[EXECUTOR] Unexpected error:`, error);
      throw new SyncExecuteError(
        'EXECUTION_ERROR',
        `Failed to execute sync: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Execute PULL operation (GAS → Local)
   *
   * IMPORTANT: When pulling from GAS, SERVER_JS files contain CommonJS wrappers
   * (_main function, __defineModule__ call). We store WRAPPED content locally
   * so file hashes match remote hashes for accurate sync detection.
   *
   * CRITICAL: After writing, we cache the WRAPPED content hash in xattr so that
   * sync status checks (which compare local hash vs remote WRAPPED hash) work correctly.
   *
   * @returns Per-file content analysis hints (non-empty entries only)
   */
  private async executePull(
    operations: SyncDiffResult,
    localPath: string
  ): Promise<{ file: string; warnings: string[]; hints: string[] }[]> {
    log.info(`[EXECUTOR] Executing PULL: ${operations.totalOperations} operations`);

    // Write files directly to repo root (not src/ subdirectory)
    const targetDir = localPath;
    const analysisMap = new Map<string, { warnings: string[]; hints: string[] }>();

    // Process ADD operations
    for (const op of operations.add) {
      const contentToWrite = op.content || '';
      const filePath = path.join(targetDir, this.gasFilenameToLocalPath(op.filename, op.fileType));
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contentToWrite, 'utf-8');

      // Cache GAS metadata (updateTime, fileType) for CatTool fast path
      const fileType = op.fileType || 'SERVER_JS';
      await cacheGASMetadata(filePath, new Date().toISOString(), fileType).catch(() => {});

      // Cache the content hash for sync status comparison
      const contentHash = computeGitSha1(contentToWrite);
      await updateCachedContentHash(filePath, contentHash).catch(() => {});

      // Analyze content for LLM hints
      const analysis = analyzeContent(op.filename, contentToWrite);
      if (analysis.warnings.length > 0 || analysis.hints.length > 0) {
        analysisMap.set(op.filename, { warnings: analysis.warnings, hints: analysis.hints });
      }

      log.debug(`[EXECUTOR] Added: ${op.filename} (type: ${fileType})`);
    }

    // Process UPDATE operations
    for (const op of operations.update) {
      const contentToWrite = op.content || '';
      const filePath = path.join(targetDir, this.gasFilenameToLocalPath(op.filename, op.fileType));
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contentToWrite, 'utf-8');

      const fileType = op.fileType || 'SERVER_JS';
      await cacheGASMetadata(filePath, new Date().toISOString(), fileType).catch(() => {});

      const contentHash = computeGitSha1(contentToWrite);
      await updateCachedContentHash(filePath, contentHash).catch(() => {});

      // Analyze content for LLM hints
      const analysis = analyzeContent(op.filename, contentToWrite);
      if (analysis.warnings.length > 0 || analysis.hints.length > 0) {
        analysisMap.set(op.filename, { warnings: analysis.warnings, hints: analysis.hints });
      }

      log.debug(`[EXECUTOR] Updated: ${op.filename} (type: ${fileType})`);
    }

    // Process DELETE operations
    for (const op of operations.delete) {
      const filePath = path.join(targetDir, this.gasFilenameToLocalPath(op.filename, op.fileType));
      try {
        await fs.unlink(filePath);
        log.debug(`[EXECUTOR] Deleted: ${op.filename} (type: ${op.fileType || 'SERVER_JS'})`);

        await clearGASMetadata(filePath).catch(() => {});
      } catch (error: unknown) {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
        // File already doesn't exist - that's fine
      }
    }

    // Git add and commit
    await this.gitAddAndCommit(
      localPath,
      `rsync pull from GAS at ${new Date().toISOString()}`
    );

    // Return accumulated analysis (non-empty only)
    return Array.from(analysisMap.entries()).map(([file, analysis]) => ({
      file,
      warnings: analysis.warnings,
      hints: analysis.hints
    }));
  }

  /**
   * Execute PUSH operation (Local → GAS)
   *
   * IMPORTANT: When pushing to GAS, local SERVER_JS files contain clean user code.
   * We must WRAP these with CommonJS (_main function, __defineModule__ call)
   * before pushing to GAS.
   */
  private async executePush(operations: SyncDiffResult, scriptId: string, accessToken: string, prefetchedGasFiles?: GASFile[]): Promise<GASFile[]> {
    log.info(`[EXECUTOR] Executing PUSH: ${operations.totalOperations} operations`);

    // Use pre-fetched files from diff computation or fetch fresh
    const currentGasFiles = prefetchedGasFiles || await this.gasClient.getProjectContent(scriptId, accessToken);

    // Build complete file list by applying operations (with CommonJS wrapping)
    const newFiles = this.buildCompleteFileList(currentGasFiles, operations);

    // Single atomic API call to update all files - returns post-push state
    const updatedFiles = await this.gasClient.updateProjectContent(scriptId, newFiles, accessToken);

    log.debug(`[EXECUTOR] Pushed ${newFiles.length} files to GAS`);
    return updatedFiles;
  }

  /**
   * Build complete file list by applying operations to current state
   *
   * For SERVER_JS files being added/updated, we wrap them with CommonJS.
   * We also preserve existing moduleOptions (loadNow, hoistedFunctions) from
   * the current GAS version when updating files.
   */
  private buildCompleteFileList(
    currentFiles: GASFile[],
    operations: SyncDiffResult
  ): GASFile[] {
    // Build a map of current files for quick lookup (for preserving moduleOptions)
    const currentFileMap = new Map<string, GASFile>();
    for (const file of currentFiles) {
      currentFileMap.set(file.name, file);
    }

    // Start with current files, excluding those to be deleted or updated
    const deleteNames = new Set(operations.delete.map(op => op.filename));
    const updateNames = new Set(operations.update.map(op => op.filename));

    const result: GASFile[] = currentFiles.filter(
      file => !deleteNames.has(file.name) && !updateNames.has(file.name)
    );

    // Add new files (wrapped with CommonJS for SERVER_JS)
    for (const op of operations.add) {
      const fileType = this.inferFileType(op.filename);
      const wrappedContent = this.wrapForGas(op.filename, op.content || '', null);

      result.push({
        name: op.filename,
        type: fileType,
        source: wrappedContent
      });
    }

    // Add updated files (wrapped with CommonJS for SERVER_JS, preserving existing options)
    for (const op of operations.update) {
      const fileType = this.inferFileType(op.filename);
      const existingFile = currentFileMap.get(op.filename);

      // Preserve existing moduleOptions from the current GAS version
      const wrappedContent = this.wrapForGas(
        op.filename,
        op.content || '',
        existingFile?.source || null
      );

      result.push({
        name: op.filename,
        type: fileType,
        source: wrappedContent
      });
    }

    return result;
  }

  /**
   * Wrap local content with CommonJS wrapper for GAS
   *
   * When pushing to GAS, SERVER_JS files need _main() wrappers.
   * We add these so GAS can execute the code with CommonJS support.
   * HTML and JSON files are passed through unchanged.
   *
   * @param filename - The filename being wrapped
   * @param content - The local (clean) content
   * @param existingGasContent - Existing GAS content to preserve moduleOptions from (or null)
   */
  private wrapForGas(filename: string, content: string, existingGasContent: string | null): string {
    const fileType = this.inferFileType(filename);

    // Only wrap SERVER_JS files that should have CommonJS wrappers
    if (!shouldWrapContent(fileType, filename)) {
      return content;
    }

    // Extract existing moduleOptions from GAS content (to preserve loadNow, hoistedFunctions)
    let existingOptions = null;
    if (existingGasContent) {
      const { existingOptions: opts } = unwrapModuleContent(existingGasContent);
      existingOptions = opts;
    }

    // Get the module name from the filename
    const moduleName = getModuleName(filename);

    // Wrap with CommonJS
    const wrappedContent = wrapModuleContent(content, moduleName, existingOptions);
    log.debug(`[EXECUTOR] Wrapped CommonJS for: ${filename}${existingOptions ? ' (preserved options)' : ''}`);
    return wrappedContent;
  }

  /**
   * Infer GAS file type from filename
   */
  private inferFileType(filename: string): 'SERVER_JS' | 'HTML' | 'JSON' {
    if (filename.endsWith('.html') || filename.includes('.html')) {
      return 'HTML';
    }
    if (isManifestFile(filename)) {
      return 'JSON';
    }
    return 'SERVER_JS';
  }

  /**
   * Convert GAS filename to local path
   *
   * Uses GAS file type (not content detection) for extension mapping.
   * This ensures consistency with syncStatusChecker which also uses file type.
   *
   * @param filename - GAS filename (without extension for SERVER_JS/HTML)
   * @param fileType - GAS file type (SERVER_JS, HTML, JSON)
   */
  private gasFilenameToLocalPath(filename: string, fileType?: string): string {
    // JSON files (manifest)
    if (isManifestFile(filename) || filename.endsWith('.json')) {
      return filename.endsWith('.json') ? filename : filename + '.json';
    }

    // Already has extension - preserve it
    if (filename.endsWith('.html') || filename.endsWith('.js') || filename.endsWith('.gs')) {
      return filename;
    }

    // Use file type for extension mapping
    switch (fileType?.toUpperCase()) {
      case 'HTML':
        return filename + '.html';
      case 'JSON':
        return filename + '.json';
      case 'SERVER_JS':
      default:
        return filename + '.gs';  // Use .gs for GAS files (matches GAS native extension)
    }
  }

  /**
   * Get current git commit SHA
   */
  private async getGitCommit(localPath: string): Promise<string | undefined> {
    try {
      const result = await this.execGitCommand(['rev-parse', 'HEAD'], localPath);
      return result.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Git add all and commit
   */
  private async gitAddAndCommit(localPath: string, message: string): Promise<void> {
    try {
      // Stage all changes
      await this.execGitCommand(['add', '-A'], localPath);

      // Check if there are changes to commit
      const status = await this.execGitCommand(['status', '--porcelain'], localPath);
      if (!status.trim()) {
        log.debug(`[EXECUTOR] No changes to commit`);
        return;
      }

      // Commit
      await this.execGitCommand(['commit', '-m', message], localPath);
      log.debug(`[EXECUTOR] Committed changes: ${message}`);

    } catch (error) {
      throw new SyncExecuteError(
        'GIT_ERROR',
        `Git operation failed: ${error instanceof Error ? error.message : String(error)}`,
        { localPath }
      );
    }
  }

  /**
   * Execute git command safely using spawn
   */
  private execGitCommand(args: string[], cwd: string): Promise<string> {
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
   * Update manifest after successful sync
   */
  private async updateManifest(
    scriptId: string,
    direction: 'pull' | 'push',
    localPath: string,
    accessToken: string,
    postPushFiles?: GASFile[]
  ): Promise<void> {
    const manifest = new SyncManifest(localPath);

    // Get final state of synced files
    let files: Array<{ filename: string; content: string; lastModified: string }>;

    if (direction === 'pull') {
      // Read files from local after pull
      const localFiles = await this.scanLocalFilesForManifest(localPath);
      files = localFiles;
    } else {
      // Use post-push files from executePush() result, or fetch if not available
      const gasFiles = postPushFiles || await this.gasClient.getProjectContent(scriptId, accessToken);
      files = gasFiles
        .filter(f => f.source !== undefined)
        .map(f => ({
          filename: f.name,
          content: f.source as string,
          lastModified: f.updateTime || new Date().toISOString()
        }));
    }

    // Get current git commit
    const commitSha = await this.getGitCommit(localPath);

    // Create updated manifest
    const manifestData = SyncManifest.createFromFiles(
      scriptId,
      direction,
      files,
      commitSha
    );

    // Save manifest
    await manifest.save(manifestData);

    log.info(`[EXECUTOR] Updated manifest with ${files.length} files`);
  }

  /**
   * Scan local files for manifest update (simplified - no ignore patterns needed)
   */
  private async scanLocalFilesForManifest(
    localPath: string
  ): Promise<Array<{ filename: string; content: string; lastModified: string }>> {
    const files: Array<{ filename: string; content: string; lastModified: string }> = [];

    const scan = async (dir: string, relPath: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const entryRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          // Skip .git and node_modules
          if (entry.name === '.git' || entry.name === 'node_modules') continue;
          await scan(path.join(dir, entry.name), entryRelPath);
        } else if (entry.isFile()) {
          // Only include GAS-compatible files
          const ext = path.extname(entry.name).toLowerCase();
          if (!['.gs', '.js', '.html', '.json'].includes(ext)) continue;
          if (entry.name === '.clasp.json' || entry.name === '.claspignore') continue;

          const filePath = path.join(dir, entry.name);
          const content = await fs.readFile(filePath, 'utf-8');
          const stat = await fs.stat(filePath);

          files.push({
            filename: entryRelPath.replace(/\\/g, '/'),
            content,
            lastModified: stat.mtime.toISOString()
          });
        }
      }
    };

    await scan(localPath, '');
    return files;
  }
}
