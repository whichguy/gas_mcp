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
import { log } from '../../utils/logger.js';
import { LockManager } from '../../utils/lockManager.js';
import { SyncManifest } from './SyncManifest.js';
import { SyncDiff, DiffFileInfo } from './SyncDiff.js';
import { PlanStore, SyncPlan } from './PlanStore.js';
import { GASClient, GASFile } from '../../api/gasClient.js';

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
  private lockManager: LockManager;
  private gasClient: GASClient;
  private planStore: PlanStore;

  constructor(gasClient?: GASClient) {
    this.lockManager = LockManager.getInstance();
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
      // Step 3: Acquire lock for execution
      await this.acquireLock(plan.scriptId);

      try {
        // Step 4: Verify no drift since plan was created
        await this.verifyNoDrift(plan, accessToken);

        // Step 5: Create git checkpoint (for PULL operations)
        if (plan.direction === 'pull') {
          preCommitSha = await this.getGitCommit(plan.localPath);
        }

        // Step 6: Execute based on direction
        if (plan.direction === 'pull') {
          await this.executePull(plan);
        } else {
          await this.executePush(plan, accessToken);
        }

        // Step 7: Update manifest
        const newManifest = await this.updateManifest(plan, accessToken);

        // Step 8: Get new commit SHA (for PULL)
        const newCommitSha = plan.direction === 'pull'
          ? await this.getGitCommit(plan.localPath)
          : undefined;

        // Step 9: Delete the plan
        this.planStore.delete(planId);

        // Step 10: Build and return result
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

      } finally {
        // Always release lock
        await this.releaseLock(plan.scriptId);
      }

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
   * Acquire lock for sync execution
   */
  private async acquireLock(scriptId: string): Promise<void> {
    try {
      await this.lockManager.acquireLock(scriptId, 'rsync-execute', 60000);
    } catch (error: any) {
      if (error.name === 'LockTimeoutError') {
        throw new SyncExecuteError(
          'LOCK_TIMEOUT',
          'Another sync operation is in progress. Wait for it to complete.',
          { scriptId, lockInfo: error.lockInfo }
        );
      }
      throw error;
    }
  }

  /**
   * Release lock
   */
  private async releaseLock(scriptId: string): Promise<void> {
    await this.lockManager.releaseLock(scriptId);
  }

  /**
   * Verify no state drift since plan was created
   */
  private async verifyNoDrift(plan: SyncPlan, accessToken: string): Promise<void> {
    log.debug(`[EXECUTOR] Verifying no drift since plan creation`);

    // Re-fetch current state from both sides
    const currentGasFiles = await this.gasClient.getProjectContent(plan.scriptId, accessToken);
    const currentLocalFiles = await this.scanLocalFiles(plan.localPath);

    // Convert to DiffFileInfo format (filter out files without source)
    const gasDiffFiles = SyncDiff.fromGasFiles(
      currentGasFiles
        .filter(f => f.source !== undefined)
        .map(f => ({
          name: f.name,
          source: f.source as string,
          updateTime: f.updateTime
        }))
    );

    // Detect drift
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
   * Scan local files for drift detection
   */
  private async scanLocalFiles(localPath: string): Promise<DiffFileInfo[]> {
    const srcDir = path.join(localPath, 'src');
    const files: DiffFileInfo[] = [];

    try {
      await fs.access(srcDir);
    } catch {
      // No src directory - return empty
      return [];
    }

    await this.scanDirectory(srcDir, '', files);
    return files;
  }

  /**
   * Recursively scan a directory
   */
  private async scanDirectory(
    baseDir: string,
    relativePath: string,
    files: DiffFileInfo[]
  ): Promise<void> {
    const dirPath = relativePath ? path.join(baseDir, relativePath) : baseDir;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryRelPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        await this.scanDirectory(baseDir, entryRelPath, files);
      } else if (entry.isFile()) {
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
   */
  private localPathToGasFilename(localPath: string): string {
    let filename = localPath.replace(/\\.gs$/, '');
    filename = filename.replace(/\\\\/g, '/');
    return filename;
  }

  /**
   * Execute PULL operation (GAS → Local)
   */
  private async executePull(plan: SyncPlan): Promise<void> {
    log.info(`[EXECUTOR] Executing PULL: ${plan.operations.totalOperations} operations`);

    const srcDir = path.join(plan.localPath, 'src');

    // Ensure src directory exists
    await fs.mkdir(srcDir, { recursive: true });

    // Process ADD operations
    for (const op of plan.operations.add) {
      const filePath = path.join(srcDir, this.gasFilenameToLocalPath(op.filename));
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, op.content || '', 'utf-8');
      log.debug(`[EXECUTOR] Added: ${op.filename}`);
    }

    // Process UPDATE operations
    for (const op of plan.operations.update) {
      const filePath = path.join(srcDir, this.gasFilenameToLocalPath(op.filename));
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, op.content || '', 'utf-8');
      log.debug(`[EXECUTOR] Updated: ${op.filename}`);
    }

    // Process DELETE operations
    for (const op of plan.operations.delete) {
      const filePath = path.join(srcDir, this.gasFilenameToLocalPath(op.filename));
      try {
        await fs.unlink(filePath);
        log.debug(`[EXECUTOR] Deleted: ${op.filename}`);
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
   * Execute PUSH operation (Local → GAS)
   */
  private async executePush(plan: SyncPlan, accessToken: string): Promise<void> {
    log.info(`[EXECUTOR] Executing PUSH: ${plan.operations.totalOperations} operations`);

    // Get current GAS files
    const currentGasFiles = await this.gasClient.getProjectContent(plan.scriptId, accessToken);

    // Build complete file list by applying operations
    const newFiles = this.buildCompleteFileList(currentGasFiles, plan.operations);

    // Single atomic API call to update all files
    await this.gasClient.updateProjectContent(plan.scriptId, newFiles, accessToken);

    log.debug(`[EXECUTOR] Pushed ${newFiles.length} files to GAS`);
  }

  /**
   * Build complete file list by applying operations to current state
   */
  private buildCompleteFileList(
    currentFiles: GASFile[],
    operations: SyncPlan['operations']
  ): GASFile[] {
    // Start with current files, excluding those to be deleted or updated
    const deleteNames = new Set(operations.delete.map(op => op.filename));
    const updateNames = new Set(operations.update.map(op => op.filename));

    const result: GASFile[] = currentFiles.filter(
      file => !deleteNames.has(file.name) && !updateNames.has(file.name)
    );

    // Add new files
    for (const op of operations.add) {
      result.push({
        name: op.filename,
        type: this.inferFileType(op.filename),
        source: op.content || ''
      });
    }

    // Add updated files
    for (const op of operations.update) {
      result.push({
        name: op.filename,
        type: this.inferFileType(op.filename),
        source: op.content || ''
      });
    }

    return result;
  }

  /**
   * Infer GAS file type from filename
   */
  private inferFileType(filename: string): 'SERVER_JS' | 'HTML' | 'JSON' {
    if (filename.endsWith('.html') || filename.includes('.html')) {
      return 'HTML';
    }
    if (filename === 'appsscript' || filename === 'appsscript.json') {
      return 'JSON';
    }
    return 'SERVER_JS';
  }

  /**
   * Convert GAS filename to local path
   */
  private gasFilenameToLocalPath(filename: string): string {
    // Add .gs extension if not HTML or JSON
    if (!filename.endsWith('.html') && filename !== 'appsscript.json') {
      return filename + '.gs';
    }
    return filename;
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
