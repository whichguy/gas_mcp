/**
 * SyncPlanner - Creates sync plans for rsync operations
 *
 * Orchestrates the planning phase of sync operations:
 * - Validates preconditions (breadcrumb, git status, lock)
 * - Fetches current state from both GAS and local
 * - Computes diff using SyncDiff
 * - Creates and stores plan in PlanStore
 *
 * Key responsibilities:
 * - Breadcrumb verification (required for sync)
 * - Git working directory status check
 * - Bootstrap detection via SyncManifest
 * - Diff computation with SyncDiff
 * - Plan creation and storage
 */

import { promises as fs } from 'fs';
import path from 'path';
import ignore, { Ignore } from 'ignore';
import { log } from '../../utils/logger.js';
import { LockManager } from '../../utils/lockManager.js';
import { GitPathResolver } from '../../core/git/GitPathResolver.js';
import { SyncManifest, ManifestLoadResult } from './SyncManifest.js';
import { SyncDiff, DiffFileInfo } from './SyncDiff.js';
import { PlanStore, SyncPlan } from './PlanStore.js';
import { getUncommittedStatus, getCurrentBranchName } from '../../utils/gitStatus.js';
import { GASClient, GASFile } from '../../api/gasClient.js';
import {
  shouldWrapContent,
  unwrapModuleContent,
  wrapModuleContent,
  getModuleName
} from '../../utils/moduleWrapper.js';

// ============================================================================
// GAS File Filtering Constants
// ============================================================================

/**
 * GAS-compatible file extensions (local filesystem)
 * - .js → SERVER_JS (preferred)
 * - .gs → SERVER_JS (legacy)
 * - .html → HTML
 */
const GAS_EXTENSIONS = ['.js', '.gs', '.html'];

/**
 * Files that are always excluded from sync (never sent to GAS)
 */
const EXCLUDED_FILES = [
  '.clasp.json',          // clasp CLI config (contains scriptId)
  '.rsync-manifest.json', // Internal rsync tracking
  '.gitignore',           // Git ignore patterns
];

/**
 * Directories that are always excluded from sync
 */
const EXCLUDED_DIRS = ['.git', 'node_modules', '.idea', '.vscode'];

/**
 * Check if a file is GAS-compatible based on extension
 *
 * Only these file types can be synced to GAS:
 * - .js/.gs → SERVER_JS
 * - .html → HTML
 * - appsscript.json → JSON (manifest only)
 */
function isGasCompatible(filename: string): boolean {
  // appsscript.json is the only JSON file we sync (manifest)
  if (filename === 'appsscript.json') {
    return true;
  }

  // Other JSON files are NOT synced (package.json, tsconfig.json, etc.)
  if (filename.endsWith('.json')) {
    return false;
  }

  // Check for GAS-compatible extensions
  return GAS_EXTENSIONS.some(ext => filename.endsWith(ext));
}

/**
 * Error codes for planning phase
 */
export type SyncPlanErrorCode =
  | 'BREADCRUMB_MISSING'
  | 'LOCK_TIMEOUT'
  | 'UNCOMMITTED_CHANGES'
  | 'GIT_NOT_FOUND'
  | 'API_ERROR'
  | 'LOCAL_READ_ERROR';

/**
 * Error thrown during planning phase
 */
export class SyncPlanError extends Error {
  constructor(
    public readonly code: SyncPlanErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SyncPlanError';
  }
}

/**
 * Options for creating a sync plan
 */
export interface PlanOptions {
  scriptId: string;
  direction: 'pull' | 'push';
  projectPath?: string;          // For polyrepo support
  accessToken: string;
  force?: boolean;               // Skip uncommitted changes check
  excludePatterns?: string[];    // Files to exclude from sync
}

/**
 * Result of the planning operation
 */
export interface PlanResult {
  success: true;
  plan: SyncPlan;
  summary: {
    direction: 'pull' | 'push';
    additions: number;
    updates: number;
    deletions: number;
    isBootstrap: boolean;
    totalOperations: number;
  };
  warnings: string[];
  nextStep: string;
}

/**
 * SyncPlanner class for creating sync plans
 */
export class SyncPlanner {
  private lockManager: LockManager;
  private gasClient: GASClient;
  private planStore: PlanStore;
  private pathResolver: GitPathResolver;

  constructor(gasClient?: GASClient) {
    this.lockManager = LockManager.getInstance();
    this.gasClient = gasClient || new GASClient();
    this.planStore = PlanStore.getInstance();
    this.pathResolver = new GitPathResolver();
  }

  /**
   * Create a sync plan
   *
   * @param options - Planning options
   * @returns PlanResult with created plan and summary
   * @throws SyncPlanError on failure
   */
  async createPlan(options: PlanOptions): Promise<PlanResult> {
    const { scriptId, direction, projectPath, accessToken, force = false, excludePatterns } = options;

    log.info(`[PLANNER] Creating ${direction} plan for ${scriptId}${projectPath ? `/${projectPath}` : ''}`);

    const warnings: string[] = [];
    let localPath: string;
    let manifestResult: ManifestLoadResult;
    let gasFiles: GASFile[];
    let localFiles: DiffFileInfo[];

    try {
      // Step 1: Check breadcrumb and resolve local path
      localPath = await this.resolveLocalPath(scriptId, projectPath, accessToken);

      // Step 2: Acquire lock
      await this.acquireLock(scriptId);

      try {
        // Step 3: Check git status (unless force)
        if (!force) {
          await this.checkGitStatus(localPath, warnings);
        } else {
          warnings.push('Forced mode: skipped uncommitted changes check');
        }

        // Step 4: Load manifest (bootstrap detection)
        manifestResult = await this.loadManifest(localPath);

        // Step 5: Fetch current state from both sides
        gasFiles = await this.fetchGasFiles(scriptId, accessToken, excludePatterns);
        localFiles = await this.scanLocalFiles(localPath, excludePatterns);

        // Step 6: Compute diff
        const diffResult = this.computeDiff(
          direction,
          gasFiles,
          localFiles,
          manifestResult
        );

        // Step 7: Create and store plan
        const plan = this.planStore.create({
          direction,
          scriptId,
          operations: diffResult,
          isBootstrap: manifestResult.isBootstrap,
          localPath,
          sourceFileCount: direction === 'pull' ? gasFiles.length : localFiles.length,
          destFileCount: direction === 'pull' ? localFiles.length : gasFiles.length
        });

        // Build result
        const result: PlanResult = {
          success: true,
          plan,
          summary: {
            direction,
            additions: diffResult.add.length,
            updates: diffResult.update.length,
            deletions: diffResult.delete.length,
            isBootstrap: manifestResult.isBootstrap,
            totalOperations: diffResult.totalOperations
          },
          warnings,
          nextStep: this.buildNextStepInstruction(plan)
        };

        log.info(`[PLANNER] Plan created: ${PlanStore.formatPlanSummary(plan)}`);

        return result;

      } finally {
        // Always release lock - wrap in try-catch to prevent masking original errors
        try {
          await this.releaseLock(scriptId);
        } catch (releaseError) {
          log.error(`[PLANNER] Failed to release lock:`, releaseError);
          // Continue - don't mask the original error
        }
      }

    } catch (error) {
      // Re-throw SyncPlanError as-is
      if (error instanceof SyncPlanError) {
        throw error;
      }

      // Wrap other errors
      log.error(`[PLANNER] Unexpected error:`, error);
      throw new SyncPlanError(
        'API_ERROR',
        `Failed to create sync plan: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Resolve local path from breadcrumb
   */
  private async resolveLocalPath(
    scriptId: string,
    projectPath: string | undefined,
    accessToken: string
  ): Promise<string> {
    const breadcrumb = await this.pathResolver.getBreadcrumb(scriptId, projectPath, accessToken);

    if (!breadcrumb?.sync?.localPath) {
      throw new SyncPlanError(
        'BREADCRUMB_MISSING',
        'No .git/config breadcrumb found in GAS project. Create one with [sync] localPath = ~/path/to/repo',
        { scriptId, projectPath }
      );
    }

    const localPath = await this.pathResolver.resolve(scriptId, projectPath, accessToken);

    // Verify local path exists
    try {
      const stat = await fs.stat(localPath);
      if (!stat.isDirectory()) {
        throw new SyncPlanError(
          'GIT_NOT_FOUND',
          `Configured sync path is not a directory: ${localPath}`,
          { localPath }
        );
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new SyncPlanError(
          'GIT_NOT_FOUND',
          `Configured sync path does not exist: ${localPath}. Create the directory first.`,
          { localPath }
        );
      }
      throw error;
    }

    // Verify it's a git repository
    const gitDir = path.join(localPath, '.git');
    try {
      await fs.access(gitDir);
    } catch {
      throw new SyncPlanError(
        'GIT_NOT_FOUND',
        `Not a git repository: ${localPath}. Run 'git init' first.`,
        { localPath }
      );
    }

    log.debug(`[PLANNER] Resolved local path: ${localPath}`);
    return localPath;
  }

  /**
   * Acquire lock for sync operation
   */
  private async acquireLock(scriptId: string): Promise<void> {
    try {
      await this.lockManager.acquireLock(scriptId, 'rsync-plan', 30000);
    } catch (error: any) {
      if (error.name === 'LockTimeoutError') {
        throw new SyncPlanError(
          'LOCK_TIMEOUT',
          'Another sync operation is in progress. Wait for it to complete or check for stuck processes.',
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
   * Check git working directory status
   */
  private async checkGitStatus(localPath: string, warnings: string[]): Promise<void> {
    const uncommitted = await getUncommittedStatus(localPath);

    if (uncommitted.count > 0) {
      const fileList = uncommitted.files.join(', ');
      throw new SyncPlanError(
        'UNCOMMITTED_CHANGES',
        `Local git has ${uncommitted.count} uncommitted change(s). Commit or stash first, or use force=true.`,
        {
          count: uncommitted.count,
          files: uncommitted.files,
          hasMore: uncommitted.hasMore,
          suggestion: 'git add -A && git commit -m "WIP" OR git stash'
        }
      );
    }

    const branch = await getCurrentBranchName(localPath);
    if (branch === 'HEAD') {
      warnings.push('Warning: Git is in detached HEAD state. Consider creating a branch.');
    }
  }

  /**
   * Load manifest for bootstrap detection
   */
  private async loadManifest(localPath: string): Promise<ManifestLoadResult> {
    const manifest = new SyncManifest(localPath);
    return manifest.load();
  }

  /**
   * Fetch files from GAS project
   */
  private async fetchGasFiles(
    scriptId: string,
    accessToken: string,
    excludePatterns?: string[]
  ): Promise<GASFile[]> {
    try {
      const files = await this.gasClient.getProjectContent(scriptId, accessToken);

      // Filter out excluded patterns
      const filtered = this.filterFiles(files, excludePatterns);

      log.debug(`[PLANNER] Fetched ${filtered.length} files from GAS (${files.length} total)`);
      return filtered;

    } catch (error) {
      throw new SyncPlanError(
        'API_ERROR',
        `Failed to fetch files from GAS: ${error instanceof Error ? error.message : String(error)}`,
        { scriptId }
      );
    }
  }

  /**
   * Load .gitignore patterns from repository root
   */
  private async loadGitignore(repoRoot: string): Promise<Ignore | null> {
    try {
      const gitignorePath = path.join(repoRoot, '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');
      log.debug(`[PLANNER] Loaded .gitignore from ${gitignorePath}`);
      return ignore().add(content);
    } catch {
      // No .gitignore file - that's fine
      return null;
    }
  }

  /**
   * Scan local files in repository root
   *
   * Only includes GAS-compatible files:
   * - .js/.gs → SERVER_JS
   * - .html → HTML
   * - appsscript.json → JSON (manifest)
   *
   * Respects .gitignore patterns if present.
   */
  private async scanLocalFiles(
    localPath: string,
    excludePatterns?: string[]
  ): Promise<DiffFileInfo[]> {
    const files: DiffFileInfo[] = [];

    try {
      // Check if local path exists
      try {
        await fs.access(localPath);
      } catch {
        // Directory doesn't exist - return empty (bootstrap case)
        log.debug(`[PLANNER] Local path does not exist: ${localPath} - bootstrap sync`);
        return [];
      }

      // Load .gitignore if it exists
      const ig = await this.loadGitignore(localPath);

      // Recursively scan from repo root (only GAS-compatible files)
      await this.scanDirectory(localPath, '', files, ig);

      // Filter out user-provided exclude patterns
      const filtered = this.filterDiffFiles(files, excludePatterns);

      log.debug(`[PLANNER] Scanned ${filtered.length} local GAS files (${files.length} before user excludes)`);
      return filtered;

    } catch (error) {
      throw new SyncPlanError(
        'LOCAL_READ_ERROR',
        `Failed to scan local files: ${error instanceof Error ? error.message : String(error)}`,
        { localPath }
      );
    }
  }

  /**
   * Recursively scan a directory for GAS-compatible files
   *
   * Applies filtering in order:
   * 1. Skip excluded directories (.git, node_modules, etc.)
   * 2. Skip .gitignore patterns (if provided)
   * 3. Skip non-GAS extensions (only .js, .gs, .html, appsscript.json)
   * 4. Skip hardcoded excluded files (.clasp.json, etc.)
   */
  private async scanDirectory(
    baseDir: string,
    relativePath: string,
    files: DiffFileInfo[],
    ig: Ignore | null
  ): Promise<void> {
    const dirPath = relativePath ? path.join(baseDir, relativePath) : baseDir;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Use forward slashes for consistent path handling
      const entryRelPath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;

      if (entry.isDirectory()) {
        // Skip excluded directories (hardcoded)
        if (EXCLUDED_DIRS.includes(entry.name)) {
          continue;
        }

        // Skip directories matching .gitignore patterns
        if (ig?.ignores(entryRelPath + '/')) {
          log.debug(`[PLANNER] Skipping directory (gitignore): ${entryRelPath}`);
          continue;
        }

        await this.scanDirectory(baseDir, entryRelPath, files, ig);

      } else if (entry.isFile()) {
        // Skip non-GAS files (extension whitelist)
        if (!isGasCompatible(entry.name)) {
          continue;
        }

        // Skip hardcoded excluded files
        if (EXCLUDED_FILES.includes(entry.name)) {
          continue;
        }

        // Skip files matching .gitignore patterns
        if (ig?.ignores(entryRelPath)) {
          log.debug(`[PLANNER] Skipping file (gitignore): ${entryRelPath}`);
          continue;
        }

        const filePath = path.join(dirPath, entry.name);
        const content = await fs.readFile(filePath, 'utf-8');
        const stat = await fs.stat(filePath);

        // Convert path to GAS-style filename (remove extension, convert slashes)
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
   * Examples:
   * - utils.js -> utils (preferred)
   * - utils.gs -> utils (legacy)
   * - models/User.js -> models/User
   * - auth/oauth.gs -> auth/oauth
   */
  private localPathToGasFilename(localPath: string): string {
    // Remove .js or .gs extension (support both for backward compat)
    let filename = localPath.replace(/\.(js|gs)$/, '');

    // Convert Windows backslashes to forward slashes
    filename = filename.replace(/\\/g, '/');

    return filename;
  }

  /**
   * Filter GASFile array by exclude patterns
   */
  private filterFiles(files: GASFile[], excludePatterns?: string[]): GASFile[] {
    if (!excludePatterns || excludePatterns.length === 0) {
      return files;
    }

    return files.filter(file => {
      for (const pattern of excludePatterns) {
        if (file.name.startsWith(pattern) || file.name === pattern) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Filter DiffFileInfo array by exclude patterns
   */
  private filterDiffFiles(files: DiffFileInfo[], excludePatterns?: string[]): DiffFileInfo[] {
    if (!excludePatterns || excludePatterns.length === 0) {
      return files;
    }

    return files.filter(file => {
      for (const pattern of excludePatterns) {
        if (file.filename.startsWith(pattern) || file.filename === pattern) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Compute diff between source and destination
   *
   * IMPORTANT: For accurate comparison, we must compare UNWRAPPED content.
   * - GAS files have CommonJS wrappers (_main, __defineModule__)
   * - Local files have clean user code
   *
   * We unwrap GAS content before comparison so SHA1 hashes match when
   * the actual user code is identical.
   */
  private computeDiff(
    direction: 'pull' | 'push',
    gasFiles: GASFile[],
    localFiles: DiffFileInfo[],
    manifestResult: ManifestLoadResult
  ): ReturnType<typeof SyncDiff.compute> {
    // Convert GAS files to DiffFileInfo with UNWRAPPED content for comparison
    // but keep original wrapped content for the operations
    const gasDiffFiles = this.convertGasFilesToDiff(gasFiles);

    // Determine source and destination based on direction
    const sourceFiles = direction === 'pull' ? gasDiffFiles : localFiles;
    const destFiles = direction === 'pull' ? localFiles : gasDiffFiles;

    return SyncDiff.compute(sourceFiles, destFiles, {
      isBootstrap: manifestResult.isBootstrap,
      manifest: manifestResult.manifest || undefined,
      direction
    });
  }

  /**
   * Convert GAS files to DiffFileInfo format with unwrapped content
   *
   * This ensures that when comparing GAS files with local files,
   * we compare the actual user code (without CommonJS wrappers).
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
          // Store original wrapped content for operations
          originalContent: source
        };
      });
  }

  /**
   * Build next step instruction for user
   */
  private buildNextStepInstruction(plan: SyncPlan): string {
    if (!plan.operations.hasChanges) {
      return 'No changes to sync. Files are already in sync.';
    }

    let instruction = `rsync({operation: 'execute', planId: '${plan.planId}'`;

    if (plan.operations.delete.length > 0 && !plan.isBootstrap) {
      instruction += `, confirmDeletions: true`;
    }

    instruction += `})`;

    return instruction;
  }
}
