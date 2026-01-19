/**
 * SyncExecutor - Executes sync plans created by SyncPlanner
 *
 * Applies the sync operations defined in a plan:
 * - Validates plan exists and hasn't expired
 * - Verifies deletion confirmation if required
 * - Detects drift since plan creation
 * - Executes operations (PULL or PUSH)
 * - Updates manifest after successful sync
 *
 * Key responsibilities:
 * - Plan validation (expiry, existence)
 * - Deletion confirmation enforcement
 * - Drift detection before execution
 * - Atomic execution with rollback support
 * - Manifest update after sync
 */

import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import ignore, { Ignore } from 'ignore';
import { log } from '../../utils/logger.js';
import { SyncManifest } from './SyncManifest.js';
import { SyncDiff, DiffFileInfo } from './SyncDiff.js';
import { PlanStore, SyncPlan } from './PlanStore.js';
import { GASClient, GASFile } from '../../api/gasClient.js';
import { isManifestFile } from '../../utils/fileHelpers.js';
import {
  shouldWrapContent,
  unwrapModuleContent,
  wrapModuleContent,
  getModuleName
} from '../../utils/moduleWrapper.js';
import { computeGitSha1 } from '../../utils/hashUtils.js';
import { updateCachedContentHash } from '../../utils/gasMetadataCache.js';
import {
  FileFilter,
  EXCLUDED_DIRS,
} from '../../utils/fileFilter.js';

// Note: GAS file filtering constants have been moved to centralized fileFilter.ts
// Use FileFilter methods for consistent filtering behavior

/**
 * Error codes for execution phase
 */
export type SyncExecuteErrorCode =
  | 'PLAN_NOT_FOUND'
  | 'PLAN_EXPIRED'
  | 'DELETION_REQUIRES_CONFIRMATION'
  | 'BOOTSTRAP_NO_DELETE'
  | 'STATE_DRIFT'
  | 'LOCK_TIMEOUT'
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
 * Options for executing a sync plan
 */
export interface ExecuteOptions {
  planId: string;
  scriptId: string;
  confirmDeletions?: boolean;
  accessToken: string;
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
}

/**
 * SyncExecutor class for executing sync plans
 */
export class SyncExecutor {
  private gasClient: GASClient;
  private planStore: PlanStore;

  constructor(gasClient?: GASClient) {
    this.gasClient = gasClient || new GASClient();
    this.planStore = PlanStore.getInstance();
  }

  /**
   * Execute a sync plan
   *
   * @param options - Execution options
   * @returns SyncResult with execution details
   * @throws SyncExecuteError on failure
   */
  async execute(options: ExecuteOptions): Promise<SyncResult> {
    const { planId, confirmDeletions = false, accessToken } = options;

    log.info(`[EXECUTOR] Executing plan ${planId}`);

    // Step 1: Load and validate plan
    const validation = this.planStore.get(planId);

    if (!validation.valid) {
      if (validation.reason === 'PLAN_NOT_FOUND') {
        throw new SyncExecuteError(
          'PLAN_NOT_FOUND',
          `Plan ${planId} not found. It may have expired or been cancelled.`,
          { planId }
        );
      }
      if (validation.reason === 'PLAN_EXPIRED') {
        throw new SyncExecuteError(
          'PLAN_EXPIRED',
          'Plan expired after 5 minutes. Re-run rsync plan to create a fresh plan.',
          { planId }
        );
      }
      throw new SyncExecuteError(
        'PLAN_NOT_FOUND',
        `Plan validation failed: ${validation.reason}`,
        { planId, reason: validation.reason }
      );
    }

    const plan = validation.plan!;

    // Step 2: Validate deletion confirmation
    if (plan.operations.delete.length > 0) {
      if (plan.isBootstrap) {
        throw new SyncExecuteError(
          'BOOTSTRAP_NO_DELETE',
          'First sync cannot delete files. Complete the bootstrap sync first, then manually delete if needed.',
          { deletionCount: plan.operations.delete.length }
        );
      }

      if (!confirmDeletions) {
        throw new SyncExecuteError(
          'DELETION_REQUIRES_CONFIRMATION',
          `Plan will delete ${plan.operations.delete.length} file(s). Pass confirmDeletions: true to proceed.`,
          {
            deletionCount: plan.operations.delete.length,
            files: plan.operations.delete.map(f => f.filename)
          }
        );
      }
    }

    let preCommitSha: string | undefined;

    try {
      // Step 3: Verify no drift since plan was created
      // Note: No explicit lock here - gasClient.updateProjectContent() handles write locking
      await this.verifyNoDrift(plan, accessToken);

      // Step 4: Create git checkpoint (for PULL operations)
      if (plan.direction === 'pull') {
        preCommitSha = await this.getGitCommit(plan.localPath);
      }

      // Step 5: Execute based on direction
      if (plan.direction === 'pull') {
        await this.executePull(plan);
      } else {
        await this.executePush(plan, accessToken);
      }

      // Step 6: Update manifest
      const newManifest = await this.updateManifest(plan, accessToken);

      // Step 7: Get new commit SHA (for PULL)
      const newCommitSha = plan.direction === 'pull'
        ? await this.getGitCommit(plan.localPath)
        : undefined;

      // Step 8: Delete the plan
      this.planStore.delete(planId);

      // Step 9: Build and return result
      const result: SyncResult = {
        success: true,
        direction: plan.direction,
        filesAdded: plan.operations.add.length,
        filesUpdated: plan.operations.update.length,
        filesDeleted: plan.operations.delete.length,
        commitSha: newCommitSha,
        recoveryInfo: plan.direction === 'pull'
          ? {
              method: 'git reset',
              command: `git -C ${plan.localPath} reset --hard ${preCommitSha || 'HEAD~1'}`
            }
          : {
              method: 'git reset + push',
              command: `git -C ${plan.localPath} reset --hard HEAD~1 && rsync({operation: 'plan', scriptId: '${plan.scriptId}', direction: 'push'})`
            }
      };

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
   * Verify no state drift since plan was created
   *
   * Uses unwrapped content for comparison to match planning phase behavior.
   */
  private async verifyNoDrift(plan: SyncPlan, accessToken: string): Promise<void> {
    log.debug(`[EXECUTOR] Verifying no drift since plan creation`);

    // Re-fetch current state from both sides
    const currentGasFiles = await this.gasClient.getProjectContent(plan.scriptId, accessToken);
    const currentLocalFiles = await this.scanLocalFiles(plan.localPath);

    // Convert GAS files to DiffFileInfo with UNWRAPPED content for comparison
    const gasDiffFiles = this.convertGasFilesToDiff(currentGasFiles);

    // Detect drift using unwrapped content
    const sourceFiles = plan.direction === 'pull' ? gasDiffFiles : currentLocalFiles;
    const destFiles = plan.direction === 'pull' ? currentLocalFiles : gasDiffFiles;

    const driftResult = SyncDiff.detectDrift(plan.operations, sourceFiles, destFiles);

    if (driftResult.hasDrift) {
      throw new SyncExecuteError(
        'STATE_DRIFT',
        `Files changed since plan was created. Re-run rsync plan to get a fresh diff.`,
        {
          driftDetails: driftResult.driftDetails,
          driftCount: driftResult.driftDetails.length
        }
      );
    }

    log.debug(`[EXECUTOR] No drift detected, safe to proceed`);
  }

  /**
   * Convert GAS files to DiffFileInfo format with unwrapped content for comparison
   *
   * Matches the behavior in SyncPlanner.convertGasFilesToDiff()
   */
  private convertGasFilesToDiff(gasFiles: GASFile[]): DiffFileInfo[] {
    return gasFiles
      .filter(f => f.source !== undefined)
      .map(f => {
        const source = f.source as string;
        const fileType = f.type || 'SERVER_JS';

        // Unwrap CommonJS for SERVER_JS files for accurate comparison
        let contentForComparison = source;
        if (shouldWrapContent(fileType, f.name)) {
          const { unwrappedContent } = unwrapModuleContent(source);
          contentForComparison = unwrappedContent;
        }

        return {
          filename: f.name,
          content: contentForComparison,  // Unwrapped for comparison
          sha1: SyncManifest.computeGitSha1(contentForComparison),
          lastModified: f.updateTime,
          size: contentForComparison.length,
          originalContent: source  // Keep wrapped for operations
        };
      });
  }

  /**
   * Load ignore patterns from .gitignore and .claspignore
   * Both files use the same syntax (gitignore format)
   */
  private async loadIgnorePatterns(repoRoot: string): Promise<Ignore | null> {
    const ig = ignore();
    let hasPatterns = false;

    // Load .gitignore
    try {
      const content = await fs.readFile(path.join(repoRoot, '.gitignore'), 'utf-8');
      ig.add(content);
      hasPatterns = true;
    } catch {
      // No .gitignore - continue
    }

    // Load .claspignore (clasp CLI compatibility)
    try {
      const content = await fs.readFile(path.join(repoRoot, '.claspignore'), 'utf-8');
      ig.add(content);
      hasPatterns = true;
    } catch {
      // No .claspignore - continue
    }

    return hasPatterns ? ig : null;
  }

  /**
   * Scan local files for drift detection
   *
   * Only includes GAS-compatible files, respects .gitignore.
   */
  private async scanLocalFiles(localPath: string): Promise<DiffFileInfo[]> {
    const files: DiffFileInfo[] = [];

    try {
      await fs.access(localPath);
    } catch {
      // Directory doesn't exist - return empty
      return [];
    }

    const ig = await this.loadIgnorePatterns(localPath);
    // Create filter once for all file checks (performance optimization)
    const filter = new FileFilter();
    await this.scanDirectory(localPath, '', files, ig, filter);
    return files;
  }

  /**
   * Recursively scan a directory for GAS-compatible files
   */
  private async scanDirectory(
    baseDir: string,
    relativePath: string,
    files: DiffFileInfo[],
    ig: Ignore | null,
    filter: FileFilter
  ): Promise<void> {
    const dirPath = relativePath ? path.join(baseDir, relativePath) : baseDir;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryRelPath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;

      if (entry.isDirectory()) {
        // Skip excluded directories (using centralized constants)
        if ((EXCLUDED_DIRS as readonly string[]).includes(entry.name)) {
          continue;
        }
        // Skip directories matching .gitignore
        if (ig?.ignores(entryRelPath + '/')) {
          continue;
        }
        await this.scanDirectory(baseDir, entryRelPath, files, ig, filter);

      } else if (entry.isFile()) {
        // Skip non-GAS files (extension whitelist)
        if (!filter.isGasCompatible(entry.name)) {
          continue;
        }
        // Skip local config files (.clasp.json, .claspignore, etc.)
        if (filter.isLocalConfig(entry.name)) {
          continue;
        }
        // Skip files matching .gitignore
        if (ig?.ignores(entryRelPath)) {
          continue;
        }

        const filePath = path.join(dirPath, entry.name);
        const content = await fs.readFile(filePath, 'utf-8');
        const stat = await fs.stat(filePath);

        // Convert path to GAS-style filename
        const filename = this.localPathToGasFilename(entryRelPath);

        files.push({
          filename,
          content,
          sha1: SyncManifest.computeGitSha1(content),
          lastModified: stat.mtime.toISOString(),
          size: stat.size
        });
      }
    }
  }

  /**
   * Convert local path to GAS filename
   *
   * GAS now stores files WITH extensions in the name, so preserve them.
   * Only convert backslashes to forward slashes for path consistency.
   */
  private localPathToGasFilename(localPath: string): string {
    // GAS stores files WITH extensions, so preserve the extension
    // Only convert Windows backslashes to forward slashes
    return localPath.replace(/\\/g, '/');
  }

  /**
   * Execute PULL operation (GAS → Local)
   *
   * IMPORTANT: When pulling from GAS, SERVER_JS files contain CommonJS wrappers
   * (_main function, __defineModule__ call). We must UNWRAP these before writing
   * to local so developers see clean code.
   *
   * CRITICAL: After writing, we cache the WRAPPED content hash in xattr so that
   * sync status checks (which compare local hash vs remote WRAPPED hash) work correctly.
   */
  private async executePull(plan: SyncPlan): Promise<void> {
    log.info(`[EXECUTOR] Executing PULL: ${plan.operations.totalOperations} operations`);

    // Write files directly to repo root (not src/ subdirectory)
    const targetDir = plan.localPath;

    // Process ADD operations
    for (const op of plan.operations.add) {
      // Unwrap CommonJS for SERVER_JS files
      const contentToWrite = this.unwrapForLocal(op.filename, op.content || '');
      // Use fileType (not content) for extension mapping - matches syncStatusChecker behavior
      const filePath = path.join(targetDir, this.gasFilenameToLocalPath(op.filename, op.fileType));
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contentToWrite, 'utf-8');

      // Cache the WRAPPED content hash for sync status comparison
      // The remote hash is computed on WRAPPED content, so we cache that same hash
      const wrappedHash = computeGitSha1(op.content || '');
      await updateCachedContentHash(filePath, wrappedHash).catch(() => {
        // Non-fatal: xattr not supported - sync check will fall back to content comparison
      });

      log.debug(`[EXECUTOR] Added: ${op.filename} (type: ${op.fileType || 'SERVER_JS'})`);
    }

    // Process UPDATE operations
    for (const op of plan.operations.update) {
      // Unwrap CommonJS for SERVER_JS files
      const contentToWrite = this.unwrapForLocal(op.filename, op.content || '');
      // Use fileType (not content) for extension mapping - matches syncStatusChecker behavior
      const filePath = path.join(targetDir, this.gasFilenameToLocalPath(op.filename, op.fileType));
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contentToWrite, 'utf-8');

      // Cache the WRAPPED content hash for sync status comparison
      const wrappedHash = computeGitSha1(op.content || '');
      await updateCachedContentHash(filePath, wrappedHash).catch(() => {
        // Non-fatal: xattr not supported - sync check will fall back to content comparison
      });

      log.debug(`[EXECUTOR] Updated: ${op.filename} (type: ${op.fileType || 'SERVER_JS'})`);
    }

    // Process DELETE operations - use fileType for extension mapping
    for (const op of plan.operations.delete) {
      const filePath = path.join(targetDir, this.gasFilenameToLocalPath(op.filename, op.fileType));
      try {
        await fs.unlink(filePath);
        log.debug(`[EXECUTOR] Deleted: ${op.filename} (type: ${op.fileType || 'SERVER_JS'})`);
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        // File already doesn't exist - that's fine
      }
    }

    // Git add and commit
    await this.gitAddAndCommit(
      plan.localPath,
      `rsync pull from GAS at ${new Date().toISOString()}`
    );
  }

  /**
   * Unwrap CommonJS wrapper from GAS content for local storage
   *
   * When pulling from GAS, SERVER_JS files have _main() wrappers.
   * We remove these so local files contain clean user code.
   * HTML and JSON files are passed through unchanged.
   */
  private unwrapForLocal(filename: string, content: string): string {
    const fileType = this.inferFileType(filename);

    // Only unwrap SERVER_JS files that should have CommonJS wrappers
    if (!shouldWrapContent(fileType, filename)) {
      return content;
    }

    // Unwrap the CommonJS wrapper
    const { unwrappedContent } = unwrapModuleContent(content);
    log.debug(`[EXECUTOR] Unwrapped CommonJS for: ${filename}`);
    return unwrappedContent;
  }

  /**
   * Execute PUSH operation (Local → GAS)
   *
   * IMPORTANT: When pushing to GAS, local SERVER_JS files contain clean user code.
   * We must WRAP these with CommonJS (_main function, __defineModule__ call)
   * before pushing to GAS.
   */
  private async executePush(plan: SyncPlan, accessToken: string): Promise<void> {
    log.info(`[EXECUTOR] Executing PUSH: ${plan.operations.totalOperations} operations`);

    // Get current GAS files
    const currentGasFiles = await this.gasClient.getProjectContent(plan.scriptId, accessToken);

    // Build complete file list by applying operations (with CommonJS wrapping)
    const newFiles = this.buildCompleteFileList(currentGasFiles, plan.operations);

    // Single atomic API call to update all files
    await this.gasClient.updateProjectContent(plan.scriptId, newFiles, accessToken);

    log.debug(`[EXECUTOR] Pushed ${newFiles.length} files to GAS`);
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
    operations: SyncPlan['operations']
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
    plan: SyncPlan,
    accessToken: string
  ): Promise<SyncManifest> {
    const manifest = new SyncManifest(plan.localPath);

    // Get final state of synced files
    let files: Array<{ filename: string; content: string; lastModified: string }>;

    if (plan.direction === 'pull') {
      // Read files from local after pull
      const localFiles = await this.scanLocalFiles(plan.localPath);
      files = localFiles.map(f => ({
        filename: f.filename,
        content: f.content,
        lastModified: f.lastModified || new Date().toISOString()
      }));
    } else {
      // Get files from GAS after push (filter out files without source)
      const gasFiles = await this.gasClient.getProjectContent(plan.scriptId, accessToken);
      files = gasFiles
        .filter(f => f.source !== undefined)
        .map(f => ({
          filename: f.name,
          content: f.source as string,
          lastModified: f.updateTime || new Date().toISOString()
        }));
    }

    // Get current git commit
    const commitSha = await this.getGitCommit(plan.localPath);

    // Create updated manifest
    const manifestData = SyncManifest.createFromFiles(
      plan.scriptId,
      plan.direction,
      files,
      commitSha
    );

    // Save manifest
    await manifest.save(manifestData);

    log.info(`[EXECUTOR] Updated manifest with ${files.length} files`);

    return manifest;
  }
}
