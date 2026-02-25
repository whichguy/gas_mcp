/**
 * SyncPlanner - Computes sync diffs for rsync operations
 *
 * Orchestrates the diff computation phase:
 * - Validates preconditions (breadcrumb, git status)
 * - Fetches current state from both GAS and local
 * - Computes diff using SyncDiff
 * - Returns diff result directly (no storage)
 *
 * Key responsibilities:
 * - Breadcrumb verification (required for sync)
 * - Git working directory status check
 * - Bootstrap detection via SyncManifest
 * - Diff computation with SyncDiff
 *
 * Read-only: Does not modify GAS or local files.
 */

import { promises as fs } from 'fs';
import path from 'path';
import ignore, { Ignore } from 'ignore';
import { mcpLogger } from '../../utils/mcpLogger.js';
import { GitPathResolver } from '../../core/git/GitPathResolver.js';
import { SyncManifest, ManifestLoadResult } from './SyncManifest.js';
import { computeGitSha1 } from '../../utils/hashUtils.js';
import { SyncDiff, DiffFileInfo, SyncDiffResult } from './SyncDiff.js';
import { FileFilter, EXCLUDED_DIRS } from '../../utils/fileFilter.js';
import { fileNameMatches } from '../../api/pathParser.js';
import { getUncommittedStatus, getCurrentBranchName } from '../../utils/gitStatus.js';
import { GASClient, GASFile } from '../../api/gasClient.js';
import {
  shouldWrapContent,
  unwrapModuleContent,
  validateCommonJsIntegrity,
} from '../../utils/moduleWrapper.js';
import { getValidatedContentHash } from '../../utils/gasMetadataCache.js';

/**
 * Error codes for planning phase
 */
export type SyncPlanErrorCode =
  | 'BREADCRUMB_MISSING'
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
 * Options for computing a sync diff
 */
export interface DiffOptions {
  scriptId: string;
  direction: 'pull' | 'push';
  projectPath?: string;          // For polyrepo support
  accessToken: string;
  force?: boolean;               // Skip uncommitted changes check
  excludePatterns?: string[];    // Files to exclude from sync
}

/**
 * Result of the diff computation
 */
export interface DiffResult {
  operations: SyncDiffResult;
  localPath: string;
  isBootstrap: boolean;
  warnings: string[];
  sourceFileCount: number;
  destFileCount: number;
  /** Pre-fetched GAS files from diff computation, reusable by executor */
  gasFiles?: GASFile[];
}

/**
 * SyncPlanner class for computing sync diffs
 */
export class SyncPlanner {
  private gasClient: GASClient;
  private pathResolver: GitPathResolver;

  constructor(gasClient?: GASClient) {
    this.gasClient = gasClient || new GASClient();
    this.pathResolver = new GitPathResolver();
  }

  /**
   * Compute sync diff between GAS and local
   *
   * Read-only: Only reads from GAS API and local filesystem.
   *
   * @param options - Diff computation options
   * @returns DiffResult with computed operations
   * @throws SyncPlanError on failure
   */
  async computeDiff(options: DiffOptions): Promise<DiffResult> {
    const { scriptId, direction, projectPath, accessToken, force = false, excludePatterns } = options;

    mcpLogger.info('rsync', `[PLANNER] Computing ${direction} diff for ${scriptId}${projectPath ? `/${projectPath}` : ''}`);

    const warnings: string[] = [];

    try {
      // Step 1: Check breadcrumb and resolve local path
      const localPath = await this.resolveLocalPath(scriptId, projectPath, accessToken);

      // Step 2: Check git status
      // Pull always checks — force mode only skips this check for push,
      // since pull overwrites local files and would silently destroy uncommitted work.
      if (!force || direction === 'pull') {
        await this.checkGitStatus(localPath, warnings);
      } else {
        warnings.push('Forced mode: skipped uncommitted changes check');
      }

      // Step 3: Load manifest (bootstrap detection)
      const manifestResult = await this.loadManifest(localPath);

      // Step 4: Fetch current state from both sides
      const gasFiles = await this.fetchGasFiles(scriptId, accessToken, excludePatterns);
      const { files: localFiles, skippedFiles } = await this.scanLocalFiles(localPath, excludePatterns);

      // Step 4b: Content integrity warnings

      // Warning A: Files without GAS-compatible extensions (push only)
      if (direction === 'push' && skippedFiles.length > 0) {
        const displayCount = Math.min(skippedFiles.length, 5);
        const fileList = skippedFiles.slice(0, displayCount).join(', ');
        const moreText = skippedFiles.length > displayCount
          ? ` and ${skippedFiles.length - displayCount} more`
          : '';
        warnings.push(
          `Skipped ${skippedFiles.length} file(s) without GAS-compatible extensions ` +
          `(.gs, .js, .html): ${fileList}${moreText}. ` +
          `Rename with a valid extension to include in sync.`
        );
      }

      // Warning B/C: CommonJS wrapper validation
      if (direction === 'push') {
        for (const file of localFiles) {
          const fileType = this.inferFileType(file.filename);
          const fileWarnings = validateCommonJsIntegrity(
            file.filename, file.content, fileType, 'rsync-push'
          );
          warnings.push(...fileWarnings);
        }
      } else {
        for (const gasFile of gasFiles) {
          const fileType = gasFile.type || 'SERVER_JS';
          const fileWarnings = validateCommonJsIntegrity(
            gasFile.name, gasFile.source || '', fileType, 'rsync-pull'
          );
          warnings.push(...fileWarnings);
        }
      }

      // Step 5: Compute diff
      const diffResult = this.computeDiffInternal(
        direction,
        gasFiles,
        localFiles,
        manifestResult
      );

      const result: DiffResult = {
        operations: diffResult,
        localPath,
        isBootstrap: manifestResult.isBootstrap,
        warnings,
        sourceFileCount: direction === 'pull' ? gasFiles.length : localFiles.length,
        destFileCount: direction === 'pull' ? localFiles.length : gasFiles.length,
        gasFiles,
      };

      mcpLogger.info('rsync', `[PLANNER] Diff computed: +${diffResult.add.length} ~${diffResult.update.length} -${diffResult.delete.length}`);

      return result;

    } catch (error) {
      // Re-throw SyncPlanError as-is
      if (error instanceof SyncPlanError) {
        throw error;
      }

      // Wrap other errors
      mcpLogger.error('rsync', { message: '[PLANNER] Unexpected error', details: error });
      throw new SyncPlanError(
        'API_ERROR',
        `Failed to compute sync diff: ${error instanceof Error ? error.message : String(error)}`
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

    mcpLogger.debug('rsync', `[PLANNER] Resolved local path: ${localPath}`);
    return localPath;
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

      mcpLogger.debug('rsync', `[PLANNER] Fetched ${filtered.length} files from GAS (${files.length} total)`);
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
      mcpLogger.debug('rsync', `[PLANNER] Loaded .gitignore from ${repoRoot}`);
    } catch {
      // No .gitignore - continue
    }

    // Load .claspignore (clasp CLI compatibility)
    try {
      const content = await fs.readFile(path.join(repoRoot, '.claspignore'), 'utf-8');
      ig.add(content);
      hasPatterns = true;
      mcpLogger.debug('rsync', `[PLANNER] Loaded .claspignore from ${repoRoot}`);
    } catch {
      // No .claspignore - continue
    }

    return hasPatterns ? ig : null;
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
  ): Promise<{ files: DiffFileInfo[]; skippedFiles: string[] }> {
    const files: DiffFileInfo[] = [];
    const skippedFiles: string[] = [];

    try {
      // Check if local path exists
      try {
        await fs.access(localPath);
      } catch {
        // Directory doesn't exist - return empty (bootstrap case)
        mcpLogger.debug('rsync', `[PLANNER] Local path does not exist: ${localPath} - bootstrap sync`);
        return { files: [], skippedFiles: [] };
      }

      // Load .gitignore and .claspignore if they exist
      const ig = await this.loadIgnorePatterns(localPath);

      // Create filter once for all file checks (performance optimization)
      const filter = new FileFilter();

      // Recursively scan from repo root (only GAS-compatible files)
      await this.scanDirectory(localPath, '', files, ig, filter, skippedFiles);

      // Filter out user-provided exclude patterns
      const filtered = this.filterDiffFiles(files, excludePatterns);

      mcpLogger.debug('rsync', `[PLANNER] Scanned ${filtered.length} local GAS files (${files.length} before user excludes, ${skippedFiles.length} skipped)`);
      return { files: filtered, skippedFiles };

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
    ig: Ignore | null,
    filter: FileFilter,
    skippedFiles: string[]
  ): Promise<void> {
    const dirPath = relativePath ? path.join(baseDir, relativePath) : baseDir;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Use forward slashes for consistent path handling
      const entryRelPath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;

      if (entry.isDirectory()) {
        // Skip excluded directories (hardcoded - uses centralized constants)
        if ((EXCLUDED_DIRS as readonly string[]).includes(entry.name)) {
          continue;
        }

        // Skip directories matching .gitignore patterns
        if (ig?.ignores(entryRelPath + '/')) {
          mcpLogger.debug('rsync', `[PLANNER] Skipping directory (gitignore): ${entryRelPath}`);
          continue;
        }

        await this.scanDirectory(baseDir, entryRelPath, files, ig, filter, skippedFiles);

      } else if (entry.isFile()) {
        // Skip non-GAS files (extension whitelist)
        if (!filter.isGasCompatible(entry.name)) {
          skippedFiles.push(entryRelPath);
          continue;
        }

        // Skip local config files (.clasp.json, .claspignore, etc.)
        if (filter.isLocalConfig(entry.name)) {
          continue;
        }

        // Skip files matching .gitignore patterns
        if (ig?.ignores(entryRelPath)) {
          mcpLogger.debug('rsync', `[PLANNER] Skipping file (gitignore): ${entryRelPath}`);
          continue;
        }

        const filePath = path.join(dirPath, entry.name);
        const content = await fs.readFile(filePath, 'utf-8');
        const stat = await fs.stat(filePath);

        // Convert path to GAS-style filename (remove extension, convert slashes)
        const filename = this.localPathToGasFilename(entryRelPath);

        // Use validated cached hash if available (from previous sync)
        // Local files are stored WRAPPED (with CommonJS), so file hash = wrapped hash
        // This ensures hash comparison works correctly with GAS remote files
        // getValidatedContentHash() checks mtime to detect external modifications
        let sha1: string;
        const validatedHash = await getValidatedContentHash(filePath);
        if (validatedHash) {
          sha1 = validatedHash.hash;
        } else {
          // File doesn't exist or error - compute from file content
          // File should be WRAPPED content, so direct hash is correct
          sha1 = computeGitSha1(content);
        }

        files.push({
          filename,
          content,
          sha1,
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
   * - utils.gs -> utils.gs
   * - models/User.gs -> models/User.gs
   * - Sidebar.html -> Sidebar.html
   * - appsscript.json -> appsscript.json
   *
   * CRITICAL: Must match how SyncExecutor.gasFilenameToLocalPath() adds extensions.
   * GAS now stores files WITH extensions in the name.
   */
  private localPathToGasFilename(localPath: string): string {
    // GAS stores files WITH extensions, so preserve the extension
    // Only convert Windows backslashes to forward slashes
    return localPath.replace(/\\/g, '/');
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
        if (file.name.startsWith(pattern) || fileNameMatches(file.name, pattern)) {
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
   * For diff DISPLAY, we show UNWRAPPED content (user's clean code).
   * - GAS files are unwrapped to remove CommonJS wrapper for readability
   * - Local files (also stored WRAPPED per line 508) are unwrapped for display
   *
   * Note: HASH comparison uses WRAPPED content - see lines 507-518, 633-635.
   * This ensures wrapper changes (loadNow, hoistedFunctions) trigger sync.
   */
  private computeDiffInternal(
    direction: 'pull' | 'push',
    gasFiles: GASFile[],
    localFiles: DiffFileInfo[],
    manifestResult: ManifestLoadResult
  ): SyncDiffResult {
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
   * Convert GAS files to DiffFileInfo format
   *
   * IMPORTANT: Uses WRAPPED content hashes for sync detection.
   * This ensures that ANY change to the file (including CommonJS wrapper
   * options like loadNow, hoistedFunctions, etc.) triggers a sync.
   *
   * The unwrapped content is still stored for display purposes,
   * but the sha1 hash is computed on the FULL WRAPPED content.
   */
  /**
   * Infer GAS file type from filename extension
   */
  private inferFileType(filename: string): string {
    if (filename.endsWith('.html')) return 'HTML';
    if (filename === 'appsscript.json' || filename.endsWith('.json')) return 'JSON';
    return 'SERVER_JS';
  }

  private convertGasFilesToDiff(gasFiles: GASFile[]): DiffFileInfo[] {
    return gasFiles
      .filter(f => f.source !== undefined)
      // GAS .git/config is a sync breadcrumb, not real git config.
      // Writing it locally: EEXIST in worktrees (.git is file), overwrites real config in repos (.git is dir)
      .filter(f => !FileFilter.isGitBreadcrumbPath(f.name))
      .map(f => {
        const source = f.source as string;
        const fileType = f.type || 'SERVER_JS';

        // Compute hash on WRAPPED content (full file as stored in GAS)
        // This ensures wrapper changes (loadNow, hoistedFunctions, etc.) trigger sync
        const wrappedHash = computeGitSha1(source);

        // Unwrap content for display/comparison readability
        let contentForDisplay = source;
        if (shouldWrapContent(fileType, f.name)) {
          const { unwrappedContent } = unwrapModuleContent(source);
          contentForDisplay = unwrappedContent;
        }

        return {
          filename: f.name,
          content: contentForDisplay,  // Unwrapped for display
          sha1: wrappedHash,           // WRAPPED hash for sync detection
          lastModified: f.updateTime,
          size: source.length,         // Full file size
          // Store original wrapped content for operations
          originalContent: source,
          fileType: fileType  // Pass through GAS file type for extension mapping
        };
      });
  }
}
