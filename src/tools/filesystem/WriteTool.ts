/**
 * @fileoverview GAS File Write Tool with CommonJS wrapping and conflict detection
 *
 * FLOW: content → wrap(CommonJS) → hashCheck → remote write → local sync → git status
 * KEY: force=true bypasses conflict | expectedHash for optimistic locking | moduleOptions for loadNow/hoisting
 * HASH: Computed on WRAPPED content | returns hash for subsequent edits
 * NO AUTO-COMMIT: Must call git_feature({operation:'commit'}) after writes
 *
 * Git path delegates remote write to WriteOperationStrategy (two-phase: compute → apply).
 * Non-git path retains inline remote write for backward compatibility.
 */
import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath, matchesDirectory, getDirectory, getBaseName, joinPath, isWildcardPattern, matchesPattern, resolveHybridScriptId, fileNameMatches } from '../../api/pathParser.js';
import { ValidationError, FileOperationError, ConflictError, type ConflictDetails } from '../../errors/mcpErrors.js';
import { computeGitSha1, isValidGitSha1, hashesEqual } from '../../utils/hashUtils.js';
import { unwrapModuleContent, shouldWrapContent, wrapModuleContent, getModuleName, analyzeCommonJsUsage, detectAndCleanContent, extractDefineModuleOptionsWithDebug, validateCommonJsIntegrity } from '../../utils/moduleWrapper.js';
import { translatePathForOperation } from '../../utils/virtualFileTranslation.js';
import { GitFormatTranslator } from '../../utils/GitFormatTranslator.js';
import { isManifestFile } from '../../utils/fileHelpers.js';
import { processHoistedAnnotations } from '../../utils/hoistedFunctionGenerator.js';
import { shouldAutoSync } from '../../utils/syncDecisions.js';
import { validateAndParseFilePath } from '../../utils/filePathProcessor.js';
import { writeLocalAndValidateHooksOnly } from '../../utils/hookIntegration.js';
import { getUncommittedStatus, buildCompactGitHint, buildHtmlTemplateHint } from '../../utils/gitStatus.js';
import { detectLocalGit, checkBreadcrumbExists, buildRecommendation, type GitDetection } from '../../utils/gitDiscovery.js';
import { buildWriteWorkflowHints } from '../../utils/writeHints.js';
// Note: localGitDetection imports removed - CompactGitHint replaces verbose git detection in responses
import { SessionWorktreeManager } from '../../utils/sessionWorktree.js';
import { mcpLogger } from '../../utils/mcpLogger.js';
import { getGitBreadcrumbWriteHint } from '../../utils/gitBreadcrumbHints.js';
import { analyzeContent, analyzeHtmlContent, analyzeCommonJsContent, analyzeManifestContent, determineFileType as determineFileTypeUtil } from '../../utils/contentAnalyzer.js';
import { generateFileDiff, getDiffStats } from '../../utils/diffGenerator.js';
import { join, dirname } from 'path';
import { mkdir, stat, readFile, writeFile } from 'fs/promises';
import { expandAndValidateLocalPath } from '../../utils/pathExpansion.js';
import { SCRIPT_ID_SCHEMA, PATH_SCHEMA, WORKING_DIR_SCHEMA, ACCESS_TOKEN_SCHEMA, FILE_TYPE_SCHEMA, MODULE_OPTIONS_SCHEMA, CONTENT_SCHEMA, FORCE_SCHEMA, EXPECTED_HASH_SCHEMA } from './shared/schemas.js';
import { GuidanceFragments } from '../../utils/guidanceFragments.js';
import type { WriteParams, WriteResult } from './shared/types.js';
import { WriteOperationStrategy } from '../../core/git/operations/WriteOperationStrategy.js';

/**
 * Parameters for raw write mode (write({..., raw: true})).
 * Mirrors former RawWriteTool parameter structure with scriptId + path separate.
 */
interface RawWriteParams {
  scriptId: string;
  path: string;
  content: string;
  fileType: 'SERVER_JS' | 'HTML' | 'JSON';
  accessToken?: string;
  expectedHash?: string;
  force?: boolean;
  position?: number;
  skipSyncCheck?: boolean;
  projectPath?: string;
  changeReason?: string;
}

/**
 * Write file contents with automatic CommonJS processing and git hook validation
 *
 * ✅ RECOMMENDED - Use for normal development workflow
 * Automatically wraps user code with CommonJS, validates with git hooks (if available)
 */
export class WriteTool extends BaseFileSystemTool {
  static readonly VALID_RAW_FILE_TYPES: readonly string[] = ['SERVER_JS', 'HTML', 'JSON'];

  public name = 'write';
  public description = '[FILE:WRITE] Create or fully replace a file with automatic CommonJS wrapping. WHEN: creating new files or replacing entire file content. AVOID: use edit for partial changes (83% fewer tokens); use aider for fuzzy-match edits. Example: write({scriptId, path: "Utils.gs", content: "function add(a,b){return a+b}"}). GIT: use git_feature(start) before features, git_feature(commit) after changes.';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Written file path' },
      hash: { type: 'string', description: 'Git-SHA1 hash of written content' },
      size: { type: 'number', description: 'Content size in bytes' },
      commonJsProcessing: { type: 'object', description: 'CommonJS wrapping details (loadNow, hoistedFunctions)' },
      git: { type: 'object', description: 'Git status hints (branch, uncommitted count, blocked state)' }
    }
  };

  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        ...SCRIPT_ID_SCHEMA
      },
      path: {
        ...PATH_SCHEMA,
        description: 'File path (filename only, or scriptId/filename if scriptId parameter is empty). For writing files with automatic CommonJS integration.',
        pattern: '^([a-zA-Z0-9_-]{5,60}/[a-zA-Z0-9_.//-]+|[a-zA-Z0-9_.//-]+)$',
        examples: [
          'utils',
          'models/User',
          'abc123def456.../helpers',
          'appsscript'
        ]
      },
      content: {
        ...CONTENT_SCHEMA,
        description: 'File content to write. Required unless fromLocal is provided.'
      },
      fromLocal: {
        type: 'string',
        description: 'Read content from this local file instead of content param. Supports ~ expansion (e.g., ~/src/file.js).',
        examples: ['~/project/utils.js', '/tmp/generated-code.js', '~/gas-repos/backup/Code.js']
      },
      fileType: {
        ...FILE_TYPE_SCHEMA
      },
      localOnly: {
        type: 'boolean',
        description: 'Write only to local ./src/ directory (skip remote sync)',
        default: false
      },
      remoteOnly: {
        type: 'boolean',
        description: 'Write only to remote project (skip local sync)',
        default: false
      },
      workingDir: {
        ...WORKING_DIR_SCHEMA
      },
      accessToken: {
        ...ACCESS_TOKEN_SCHEMA
      },
      moduleOptions: {
        ...MODULE_OPTIONS_SCHEMA
      },
      force: {
        ...FORCE_SCHEMA
      },
      expectedHash: {
        ...EXPECTED_HASH_SCHEMA,
        description: 'Git SHA-1 hash (40 hex chars) from previous cat. If provided and differs from current remote, write fails with ConflictError. Use force:true to bypass.'
      },
      changeReason: {
        type: 'string',
        description: 'Optional commit message for git-enabled projects. If omitted, defaults to "Update {filename}" or "Add {filename}". Tip: Call git_feature({operation: "start"}) first for meaningful branch names.',
        examples: [
          'Add user authentication',
          'Fix validation bug in form',
          'Refactor database queries',
          'Update API endpoint'
        ]
      },
      projectPath: {
        type: 'string',
        default: '',
        description: 'Optional path to nested git project within GAS (for polyrepo support). Enables independent git repositories within a single GAS project.',
        examples: ['', 'backend', 'frontend', 'libs/shared', 'api/v2']
      },
      raw: {
        type: 'boolean',
        description: 'When true, writes file content exactly as provided — no CommonJS wrapping applied. REQUIRED when raw:true: fileType, position parameters become available. Use for writing CommonJS infrastructure files. Former raw_write behavior.',
        default: false
      },
      position: {
        type: 'number',
        description: 'File execution order position (0-based). Only used when raw: true. Controls order in Apps Script editor.',
        minimum: 0
      },
      skipSyncCheck: {
        type: 'boolean',
        description: 'Skip sync validation check. Only used when raw: true.',
        default: false
      }
    },
    required: ['scriptId', 'path'],  // content OR fromLocal must be provided
    additionalProperties: false,
    llmGuidance: {
      workflowSelection: GuidanceFragments.localFirstWorkflow,
      localFileSupport: 'fromLocal:"~/src/app.js" reads local file instead of content param. PREFER when content exists locally or >100 lines (saves tokens). Either content or fromLocal required, not both.',
      gitIntegration: GuidanceFragments.gitIntegration,
      commonJs: GuidanceFragments.commonJsProcessing,
      moduleOptions: GuidanceFragments.moduleOptions,
      errorRecovery: GuidanceFragments.errorRecovery,
      errorResolutions: GuidanceFragments.errorResolutions,
      force: GuidanceFragments.forceWarning,
      examples: 'Event handler: {path:"Menu",content:"module.exports.__events__={onOpen:\\"onOpen\\"}",moduleOptions:{loadNow:true}}',
      antiPatterns: GuidanceFragments.writeAntiPatterns
    }
  };

  public annotations = {
    title: 'Write File (Smart)',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
  };

  async execute(params: WriteParams): Promise<WriteResult> {
    if ((params as any).raw) {
      const rawFileType = (params as any).fileType;
      if (!rawFileType) {
        throw new ValidationError('fileType', undefined, 'required when raw: true');
      }
      if (!WriteTool.VALID_RAW_FILE_TYPES.includes(rawFileType)) {
        throw new ValidationError('fileType', rawFileType,
          `must be one of ${WriteTool.VALID_RAW_FILE_TYPES.join(', ')} when raw: true`);
      }
      return await this.executeRaw(params as unknown as RawWriteParams);
    }

    const { LocalFileManager } = await import('../../utils/localFileManager.js');
    const workingDir = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    const localOnly = params.localOnly || false;
    let remoteOnly = params.remoteOnly || false;

    if (localOnly && remoteOnly) {
      throw new ValidationError('localOnly/remoteOnly', 'both true', 'only one can be true');
    }

    const { scriptId, filename, projectName, fullPath } = validateAndParseFilePath(
      params as { scriptId: string; path: string },
      this.validate.filePath.bind(this.validate),
      'file writing'
    );

    // Resolve content source: either inline content or from local file
    let originalContent: string;
    let contentSource: 'inline' | 'fromLocal' = 'inline';

    if (params.fromLocal) {
      if (params.content) {
        throw new ValidationError('content/fromLocal', 'both provided', 'only one of content or fromLocal should be provided');
      }
      // Read content from local file
      const localPath = expandAndValidateLocalPath(params.fromLocal);
      try {
        originalContent = await readFile(localPath, 'utf-8');
        contentSource = 'fromLocal';
        mcpLogger.info('write', `[WRITE] Reading content from local file: ${localPath} (${originalContent.length} chars)`);
      } catch (readError: any) {
        throw new FileOperationError('fromLocal', params.fromLocal, `Failed to read local file: ${readError.message}`);
      }
    } else if (params.content !== undefined) {
      originalContent = params.content;
    } else {
      throw new ValidationError('content', undefined, 'content or fromLocal is required');
    }

    // Auto-initialize CommonJS infrastructure if needed
    const fileType = params.fileType || determineFileTypeUtil(filename, originalContent);

    // Validate content/fileType match when user explicitly provides fileType
    // This prevents accidental CommonJS wrapping of HTML files
    if (params.fileType) {
      const { detectContentFileTypeMismatch } = await import('../../utils/contentAnalyzer.js');
      const mismatch = detectContentFileTypeMismatch(originalContent, params.fileType, filename);
      if (mismatch) {
        throw new ValidationError(
          'fileType',
          params.fileType,
          `${mismatch.message} (detected: ${mismatch.detectedType})`
        );
      }
    }

    // Prefetch project content ONCE for all downstream consumers
    // (CommonJS check, module options, sync status, conflict detection)
    let prefetchedFiles: any[] | undefined;
    if (!localOnly) {
      try {
        const accessToken = await this.getAuthToken(params);
        prefetchedFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
      } catch (prefetchError: any) {
        mcpLogger.warning('write', `[WRITE] Prefetch failed, downstream operations will fetch individually: ${(prefetchError as Error).message}`);
      }
    }

    if (!localOnly && shouldWrapContent(fileType, filename)) {
      try {
        const accessToken = await this.getAuthToken(params);
        const existingFiles = prefetchedFiles || await this.gasClient.getProjectContent(scriptId, accessToken);
        const hasCommonJS = existingFiles.some((f: any) => fileNameMatches(f.name, 'common-js/require'));

        if (!hasCommonJS) {
          console.error(`🔧 [AUTO-INIT] CommonJS not found in project ${scriptId}, initializing...`);
          const { ProjectInitTool } = await import('../project-lifecycle.js');
          const initTool = new ProjectInitTool(this.sessionAuthManager);
          await initTool.execute({
            scriptId,
            includeCommonJS: true,
            includeExecutionInfrastructure: false,
            updateManifest: false,
            force: false,
            accessToken
          });
          console.error(`✅ [AUTO-INIT] CommonJS infrastructure initialized successfully`);
        }
      } catch (initError: any) {
        console.error(`⚠️ [AUTO-INIT] Failed to auto-initialize CommonJS: ${initError.message}`);
        // Continue with write operation even if initialization fails
      }
    }

    // CommonJS integration - process content for module system
    let processedContent = originalContent;
    let commonJsProcessing: any = {};
    let preservationDebug: any = null;

    if (shouldWrapContent(fileType, filename)) {
      const commonJsAnalysis = analyzeCommonJsUsage(originalContent);
      const cleaned = detectAndCleanContent(originalContent, filename);
      processedContent = cleaned.cleanedContent;

      let resolvedOptions: any = undefined;

      const hasExplicitLoadNow = params.moduleOptions &&
                                 typeof params.moduleOptions === 'object' &&
                                 'loadNow' in params.moduleOptions &&
                                 typeof params.moduleOptions.loadNow === 'boolean';

      const hoistedFunctions = params.moduleOptions?.hoistedFunctions;

      if (hasExplicitLoadNow) {
        // When loadNow is explicit but hoistedFunctions is not provided,
        // preserve existing hoistedFunctions from the current wrapper
        try {
          const accessToken = await this.getAuthToken(params);
          const existingFiles = prefetchedFiles || await this.gasClient.getProjectContent(scriptId, accessToken);
          const existingFile = existingFiles.find((f: any) => fileNameMatches(f.name, filename));

          let existingHoistedFunctions = undefined;
          if (existingFile && existingFile.source) {
            const { existingOptions } = unwrapModuleContent(existingFile.source);
            existingHoistedFunctions = existingOptions?.hoistedFunctions;
          }

          resolvedOptions = {
            loadNow: params.moduleOptions!.loadNow,
            // Use explicit hoistedFunctions if provided, otherwise preserve existing
            hoistedFunctions: hoistedFunctions !== undefined ? hoistedFunctions : existingHoistedFunctions
          };
        } catch (error: any) {
          // If we can't fetch existing file, use what was explicitly provided
          resolvedOptions = {
            loadNow: params.moduleOptions!.loadNow,
            hoistedFunctions
          };
        }
      } else {
        // Inherit from existing file
        try {
          const accessToken = await this.getAuthToken(params);
          const existingFiles = prefetchedFiles || await this.gasClient.getProjectContent(scriptId, accessToken);
          const existingFile = existingFiles.find((f: any) => fileNameMatches(f.name, filename));

          if (existingFile && existingFile.source) {
            const extractionDebug = extractDefineModuleOptionsWithDebug(existingFile.source);
            const { existingOptions } = unwrapModuleContent(existingFile.source);

            if (existingOptions) {
              resolvedOptions = {
                ...existingOptions,
                ...(hoistedFunctions !== undefined && { hoistedFunctions })
              };
            } else {
              resolvedOptions = hoistedFunctions ? { hoistedFunctions } : null;
            }

            preservationDebug = {
              foundExistingFile: !!existingFile,
              existingSourceLength: existingFile?.source?.length,
              extractedOptions: existingOptions,
              extractionDebug: extractionDebug,
              sourceTail: existingFile.source.slice(-100),
              willPreserve: !!existingOptions
            };
          } else {
            resolvedOptions = hoistedFunctions ? { hoistedFunctions } : null;
          }
        } catch (error: any) {
          resolvedOptions = hoistedFunctions ? { hoistedFunctions } : null;
        }
      }

      const moduleName = getModuleName(fullPath);
      processedContent = wrapModuleContent(processedContent, moduleName, resolvedOptions);

      // Process @hoisted annotations and generate bridge functions
      processedContent = processHoistedAnnotations(processedContent, originalContent, moduleName);

      commonJsProcessing = {
        wrapperApplied: true,
        cleanedWrappers: cleaned.hadWrappers,
        warnings: cleaned.warnings,
        commonJsFeatures: {
          requireFunction: true,
          moduleObject: true,
          exportsObject: true,
          userRequireCalls: commonJsAnalysis.requireCalls,
          userModuleExports: commonJsAnalysis.moduleExports,
          userExportsUsage: commonJsAnalysis.exportsUsage
        },
        systemNote: 'require(), module, and exports are provided by the CommonJS module system (see require.js)',
        moduleOptionsDebug: {
          paramsModuleOptions: params.moduleOptions,
          paramsModuleOptionsType: typeof params.moduleOptions,
          hasExplicitLoadNow,
          resolvedOptions,
          preservationDebug
        }
      };
    } else if (filename.startsWith('.git/') || filename.startsWith('.git')) {
      // Use GitFormatTranslator for proper CommonJS with parsed structure
      // Creates: function _main() { const RAW_CONTENT = "..."; module.exports = { raw, parsed, format }; } __defineModule__(_main);
      processedContent = GitFormatTranslator.toGAS(originalContent, filename);
      commonJsProcessing = {
        wrapperApplied: true,
        reason: 'Git config file wrapped as CommonJS with INI parser for structured access'
      };
    } else {
      commonJsProcessing = {
        wrapperApplied: false,
        reason: `${fileType} files don't use the CommonJS module system`
      };
    }

    const content = processedContent;

    // .git/ breadcrumb files are remote-only: they should only exist in GAS, not in local .git/ directory
    // Writing JavaScript-wrapped content to local .git/config would break Git commands
    // These files are used for path resolution (GitPathResolver) and are read from GAS, not local disk
    const isGitBreadcrumb = filename.startsWith('.git/') || filename === '.git';
    if (isGitBreadcrumb) {
      remoteOnly = true;
      mcpLogger.info('write', `[WRITE] .git/ breadcrumb file detected: ${filename} - forcing remote-only (GAS breadcrumbs should not be written to local .git/ directory)`);
    }

    // Two-phase git discovery with projectPath support
    const projectPath = params.projectPath || '';
    const accessToken = await this.getAuthToken(params);

    // Discover git (Phase A: local filesystem, Phase B: GAS breadcrumbs)
    const { discoverGit } = await import('../../utils/gitDiscovery.js');
    const gitDiscovery = await discoverGit(scriptId, projectPath, this.gasClient, accessToken);

    if (gitDiscovery.gitExists && !remoteOnly) {
      // Git discovered → use enhanced atomic workflow with feature branches
      mcpLogger.info('write', `[WRITE] Git discovered: ${gitDiscovery.source} at ${gitDiscovery.gitPath}`);

      if (gitDiscovery.breadcrumbsPulled && gitDiscovery.breadcrumbsPulled.length > 0) {
        mcpLogger.info('write', `[WRITE] Pulled ${gitDiscovery.breadcrumbsPulled.length} git breadcrumbs from GAS`);
      }

      // Resolve working directory with projectPath
      const resolvedWorkingDir = projectPath ? join(workingDir, projectPath) : workingDir;

      return await this.executeWithHookValidation(
        params,
        scriptId,
        filename,
        content,
        projectName,
        resolvedWorkingDir,
        localOnly,
        remoteOnly,
        commonJsProcessing,
        params.changeReason,  // Pass custom commit message
        prefetchedFiles
      );
    }

    mcpLogger.info('write', '[WRITE] No git discovered, using remote-first workflow');

    // Check if git repo exists locally (even if not discovered by new discovery mechanism)
    const gitStatus = await LocalFileManager.ensureProjectGitRepo(projectName, workingDir);

    // Verify sync status with remote
    let syncStatus: any = null;
    let remoteFiles: any[] = [];

    // Skip local sync operations when remoteOnly is true (e.g., .git/ breadcrumb files)
    if (!localOnly && !remoteOnly) {
      try {
        remoteFiles = prefetchedFiles || await this.gasClient.getProjectContent(scriptId, accessToken);
        syncStatus = await LocalFileManager.verifySyncStatus(projectName, remoteFiles, workingDir);

        const autoSyncDecision = shouldAutoSync(syncStatus, remoteFiles.length);

        if (autoSyncDecision.pull) {
          try {
            const pullResult = await LocalFileManager.copyRemoteToLocal(projectName, remoteFiles, workingDir);

            if (gitStatus.gitInitialized && pullResult.filesWritten > 0) {
              await LocalFileManager.autoCommitChanges(
                projectName,
                pullResult.filesList,
                `Initial baseline: pulled ${pullResult.filesWritten} files from remote`,
                workingDir
              );
            }

            syncStatus = await LocalFileManager.verifySyncStatus(projectName, remoteFiles, workingDir);
          } catch (pullError: any) {
            // Continue with operation even if sync fails
          }
        }
      } catch (syncError: any) {
        // Continue with operation even if sync check fails
      }
    }

    // Read current local content for comparison and capture original mtime
    let previousLocalContent: string | null = null;
    let originalLocalMtime: Date | null = null;
    try {
      previousLocalContent = await LocalFileManager.readFileFromProject(projectName, filename, workingDir);

      // ✅ Capture original local mtime before any writes
      const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
      const fullFilename = filename + fileExtension;
      const projectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
      const localFilePath = join(projectPath, fullFilename);

      const fileStats = await stat(localFilePath);
      originalLocalMtime = fileStats.mtime;
      console.error(`📅 [SYNC] Captured original local mtime: ${originalLocalMtime.toISOString()}`);
    } catch (error: any) {
      // No existing local file
      console.error(`📄 [SYNC] New file, no original mtime`);
    }

    // Remote-first workflow: Push to remote FIRST
    let results: any = {};
    let existingRemoteSource: string | null = null; // For session worktree conflict detection
    let fetchedFiles: any[] | undefined; // Reused by detectGitInfoAndBreadcrumb to avoid extra API call

    if (!localOnly) {
      try {
        const currentFiles = prefetchedFiles || await this.gasClient.getProjectContent(scriptId, accessToken);
        fetchedFiles = currentFiles;

        const existingFile = currentFiles.find((f: any) => fileNameMatches(f.name, filename));
        const fileType = existingFile?.type || determineFileTypeUtil(filename, content);
        existingRemoteSource = existingFile?.source || null;

        // === HASH-BASED CONFLICT DETECTION ===
        // Check for concurrent modifications before writing
        if (existingFile && params.force) {
          // Log when force bypasses conflict detection
          const currentRemoteHash = computeGitSha1(existingFile.source || '');
          mcpLogger.warning('write', `[WRITE] force=true: bypassing conflict detection for ${filename} (remote hash: ${currentRemoteHash.slice(0, 8)}...)`);
        }

        if (existingFile && !params.force) {
          // Compute current remote hash on WRAPPED content (full file as stored in GAS)
          // This ensures hash matches `git hash-object <file>` on local synced files
          const currentRemoteHash = computeGitSha1(existingFile.source || '');

          // Determine expected hash (priority: param > xattr cache)
          let expectedHash: string | undefined = params.expectedHash;
          let hashSource: 'param' | 'xattr' | 'computed' = 'param';
          let localFilePath: string | undefined;

          if (!expectedHash) {
            // Use local git file content as the conflict detection seed
            try {
              const { LocalFileManager } = await import('../../utils/localFileManager.js');
              const localRoot = await LocalFileManager.getProjectDirectory(projectName, workingDir);
              if (localRoot) {
                const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
                localFilePath = join(localRoot, filename + fileExtension);
                const localContent = await readFile(localFilePath, 'utf-8');
                expectedHash = computeGitSha1(localContent);
                hashSource = 'local_git' as any;
              }
            } catch {
              // Local git file not available - continue without conflict detection
            }
          }

          // Validate hash if we have one
          if (expectedHash && !hashesEqual(expectedHash, currentRemoteHash)) {
            // UNWRAP for diff display (hash comparison uses WRAPPED, diff uses UNWRAPPED)
            // This ensures the diff shows what the LLM actually sees in cat output
            const remoteWrappedContent = existingFile.source || '';
            const { unwrappedContent: remoteUnwrapped } = unwrapModuleContent(remoteWrappedContent);

            // Try to read local file to get expected content for unified diff
            let expectedUnwrapped = '';
            let diffFormat: 'unified' | 'info' = 'info';
            let diffContent = '';
            let diffStats: { linesAdded: number; linesRemoved: number } | undefined;

            // First, get local file path if we don't have it yet
            if (!localFilePath) {
              try {
                const { LocalFileManager } = await import('../../utils/localFileManager.js');
                const localRoot = await LocalFileManager.getProjectDirectory(projectName, workingDir);
                const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
                localFilePath = join(localRoot, filename + fileExtension);
              } catch {
                // Unable to determine local path
              }
            }

            if (localFilePath) {
              try {
                const localWrapped = await readFile(localFilePath, 'utf-8');
                const { unwrappedContent } = unwrapModuleContent(localWrapped);
                expectedUnwrapped = unwrappedContent;

                // Generate unified diff showing actual content changes
                diffContent = generateFileDiff(filename, expectedUnwrapped, remoteUnwrapped);
                diffStats = getDiffStats(expectedUnwrapped, remoteUnwrapped);
                diffFormat = 'unified';
              } catch {
                // Local file not available - fall back to info format
              }
            }

            // Fall back to info format if unified diff not available
            if (diffFormat === 'info') {
              const hashSourceLabel = hashSource === 'xattr' ? 'local cache' : 'previous read';
              diffContent = `File was modified externally since your last read.
  Expected hash: ${expectedHash.slice(0, 8)}... (from ${hashSourceLabel})
  Current hash:  ${currentRemoteHash.slice(0, 8)}...
  Size:          ${remoteUnwrapped.length} bytes (unwrapped)

To resolve: Use cat() to fetch current content, then re-apply your changes.
Or use force:true to overwrite (destructive).`;
            }

            const conflict: ConflictDetails = {
              scriptId,
              filename,
              operation: 'write',
              expectedHash,
              currentHash: currentRemoteHash,
              hashSource,
              changeDetails: {
                sizeChange: `${remoteUnwrapped.length} bytes (unwrapped)`
              },
              diff: {
                format: diffFormat,
                content: diffContent,
                linesAdded: diffStats?.linesAdded,
                linesRemoved: diffStats?.linesRemoved,
                truncated: diffContent.length > 10000
              }
            };

            throw new ConflictError(conflict);
          }
        }
        // === END HASH-BASED CONFLICT DETECTION ===

        const newFile = {
          name: filename,
          type: fileType as any,
          source: content
        };

        let updatedFiles: any[];

        const isNewFile = !existingFile;
        if (existingFile) {
          updatedFiles = currentFiles.map((f: any) =>
            fileNameMatches(f.name, filename) ? newFile : f
          );
        } else {
          updatedFiles = [...currentFiles, newFile];
        }

        const remoteResult = await this.gasClient.updateProjectContent(scriptId, updatedFiles, accessToken);
        const updatedFile = remoteResult.find((f: any) => fileNameMatches(f.name, filename));

        // ✅ Fetch authoritative remote updateTime (with fallback to metadata)
        const authoritativeUpdateTime = await this.fetchRemoteUpdateTime(
          scriptId,
          filename,
          updatedFile,
          accessToken
        );

        if (authoritativeUpdateTime) {
          console.error(`📊 [SYNC] Remote updateTime: ${authoritativeUpdateTime}`);
          if (originalLocalMtime) {
            console.error(`📊 [SYNC] Mtime transition: ${originalLocalMtime.toISOString()} → ${authoritativeUpdateTime}`);
          }
        } else {
          console.error(`⚠️ [SYNC] WARNING: Could not determine remote updateTime for ${filename}`);
        }

        // Compute hash of written content on WRAPPED content (full file as stored in GAS)
        // This ensures hash matches `git hash-object <file>` on local synced files
        const writtenHash = computeGitSha1(content);

        results.remoteFile = {
          scriptId,
          filename,
          type: fileType,
          size: content.length,
          updated: true,
          updateTime: authoritativeUpdateTime,
          originalLocalMtime: originalLocalMtime?.toISOString()
        };

        // Store written hash for response
        results.hash = writtenHash;

      } catch (remoteError: any) {
        // Re-throw ConflictError as-is (don't wrap it)
        if (remoteError instanceof ConflictError) {
          throw remoteError;
        }
        throw new Error(`Remote write failed - aborting local operations: ${remoteError.message}`);
      }
    }

    // Generate smart commit message (after remote success)
    let commitMessage = `Update ${filename}`;

    if (previousLocalContent !== null) {
      const contentChanged = previousLocalContent !== content;

      if (contentChanged) {
        const prevLength = previousLocalContent.length;
        const newLength = content.length;
        const sizeDiff = newLength - prevLength;

        if (Math.abs(sizeDiff) > 100) {
          commitMessage = `Update ${filename} (${sizeDiff > 0 ? '+' : ''}${sizeDiff} chars)`;
        } else {
          commitMessage = `Update ${filename}`;
        }

        try {
          const prevFunctions = (previousLocalContent.match(/function\s+(\w+)/g) || []).map((f: string) => f.replace('function ', ''));
          const newFunctions = (content.match(/function\s+(\w+)/g) || []).map((f: string) => f.replace('function ', ''));

          const addedFunctions = newFunctions.filter((f: string) => !prevFunctions.includes(f));
          const removedFunctions = prevFunctions.filter((f: string) => !newFunctions.includes(f));

          if (addedFunctions.length > 0 || removedFunctions.length > 0) {
            const changes = [];
            if (addedFunctions.length > 0) changes.push(`add ${addedFunctions.join(', ')}`);
            if (removedFunctions.length > 0) changes.push(`remove ${removedFunctions.join(', ')}`);
            commitMessage = `${changes.join(', ')} in ${filename}`;
          }
        } catch (functionAnalysisError) {
          // Fallback to simple message
        }
      }
    } else {
      commitMessage = `Add ${filename}`;
    }

    // Stage changes to git (NO AUTO-COMMIT - LLM must call git_feature to commit)
    let projectPathForGit: string | null = null;
    let conflictWarning: string | null = null;

    if (!remoteOnly && gitStatus.gitInitialized) {
      try {
        const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
        const fullFilename = filename + fileExtension;
        const pathMod = await import('path');

        // Use session worktree for isolated git staging
        const worktreeManager = new SessionWorktreeManager();
        const gitStagingPath = await worktreeManager.ensureWorktree(
          scriptId,
          this.gasClient,
          accessToken
        );
        console.error(`📂 [SESSION-WT] Using session worktree: ${gitStagingPath}`);

        // Check for external modifications (conflict detection)
        // Pass existing remote source (not new content) to compare against session base hash
        if (existingRemoteSource !== null) {
          conflictWarning = worktreeManager.checkConflict(scriptId, filename, existingRemoteSource);
          if (conflictWarning) {
            console.error(`⚠️ [CONFLICT] ${conflictWarning}`);
          }
        }

        projectPathForGit = gitStagingPath;
        const filePath = pathMod.join(gitStagingPath, fullFilename);

        await mkdir(dirname(filePath), { recursive: true });
        await import('fs').then(fs => fs.promises.writeFile(filePath, content, 'utf-8'));

        // Stage the file (NO COMMIT - LLM must call git_feature)
        const { spawn } = await import('child_process');
        await new Promise<void>((resolve, reject) => {
          const git = spawn('git', ['add', fullFilename], { cwd: gitStagingPath });
          git.on('close', (code) => code === 0 ? resolve() : reject(new Error(`git add failed with code ${code}`)));
          git.on('error', reject);
        });
        console.error(`📦 [GIT] Staged ${fullFilename} (NOT committed - call git_feature to commit)`);

        // Update base hash after successful staging
        worktreeManager.updateBaseHash(scriptId, filename, content);
      } catch (stageError: any) {
        console.error(`⚠️ [GIT] Could not stage file: ${stageError.message}`);
        // Continue anyway - file is written, just not staged
      }
    }

    // Write local file (final step) - always keep ~/gas-repos/ in sync,
    // even when session worktree handles git staging separately
    if (!remoteOnly) {
      try {
        const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
        const fullFilename = filename + fileExtension;
        const projectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
        const path = await import('path');
        const filePath = path.join(projectPath, fullFilename);

        await mkdir(dirname(filePath), { recursive: true });
        await import('fs').then(fs => fs.promises.writeFile(filePath, content, 'utf-8'));

        results.localFile = {
          path: filePath,
          size: content.length,
          updated: true
        };
      } catch (writeError: any) {
        results.localFile = {
          error: writeError.message,
          updated: false
        };
      }
    }

    // Analyze content for warnings and hints based on file type
    let contentAnalysis: { warnings: string[]; hints: string[] } | undefined;
    const detectedFileType = determineFileTypeUtil(filename, content);
    if (detectedFileType === 'HTML') {
      contentAnalysis = analyzeHtmlContent(content);
    } else if (detectedFileType === 'SERVER_JS') {
      contentAnalysis = analyzeCommonJsContent(content, params.moduleOptions, filename);

      // Add logging hint for CommonJS modules without log() calls
      const isCommonJS = shouldWrapContent(detectedFileType, filename);
      const hasLogCalls = content.includes('log(');
      if (isCommonJS && !hasLogCalls) {
        if (!contentAnalysis) {
          contentAnalysis = { warnings: [], hints: [] };
        }
        contentAnalysis.hints.push(
          `Tip: Use log() (3rd param in _main) for debugging. Enable with: setModuleLogging("${filename}", true)`
        );
      }
    } else if (detectedFileType === 'JSON' && isManifestFile(filename)) {
      // Analyze manifest for scope change hints
      contentAnalysis = analyzeManifestContent(content);
    }

    // Return token-efficient results with local and git hints
    const result: any = {
      success: true,
      path: `${scriptId}/${filename}`,
      size: content.length,
      hash: results.hash  // Git SHA-1 of written content (WRAPPED) for future conflict detection
    };

    // Add conflict detection warning from session worktree
    if (conflictWarning) {
      result.warnings = [conflictWarning];
    }

    // Add content-specific warnings and hints (before other metadata)
    if (contentAnalysis) {
      if (contentAnalysis.warnings.length > 0) {
        result.warnings = [...(result.warnings || []), ...contentAnalysis.warnings];
      }
      if (contentAnalysis.hints.length > 0) {
        result.hints = contentAnalysis.hints;
      }
    }

    // Add local file info if available
    if (results.localFile && results.localFile.path) {
      result.local = {
        path: results.localFile.path,
        exists: true
      };
    }

    // Add compact git hints if we have a git path
    if (projectPathForGit) {
      try {
        const uncommittedStatus = await getUncommittedStatus(projectPathForGit);
        const { getCurrentBranchName } = await import('../../utils/gitStatus.js');
        const branch = await getCurrentBranchName(projectPathForGit);
        result.git = buildCompactGitHint(branch, uncommittedStatus);
        if (result.git && result.git.blocked) {
          result.git = { ...result.git, workflow: buildWriteWorkflowHints(result.git, scriptId) };
        }
      } catch (hintError) {
        console.error(`⚠️ [GIT] Could not build git hints: ${hintError}`);
      }
    }

    // Add git breadcrumb hint for .git/* files
    const gitBreadcrumbHint = getGitBreadcrumbWriteHint(filename);
    if (gitBreadcrumbHint) {
      result.gitBreadcrumbHint = gitBreadcrumbHint;
    }

    // Add HTML template test hint for user HTML files
    const htmlTestHint = buildHtmlTemplateHint(filename, scriptId);
    if (htmlTestHint) {
      result.html_test = htmlTestHint;
    }

    return result;
  }

  /**
   * Execute write with hook validation workflow (NO AUTO-COMMIT)
   * PHASE 1: Write local, run hooks, read post-hook content (staged but NOT committed)
   * PHASE 2: Push to remote
   * PHASE 3: If remote fails, unstage changes (simple cleanup, no commit to revert)
   *
   * LLM must call git_feature({operation:'commit'}) to commit staged changes.
   */
  private async executeWithHookValidation(
    params: any,
    scriptId: string,
    filename: string,
    content: string,
    projectName: string,
    workingDir: string,
    localOnly: boolean,
    remoteOnly: boolean,
    commonJsProcessing: any,
    changeReason?: string,
    prefetchedFiles?: any[]
  ): Promise<any> {
    const { LocalFileManager } = await import('../../utils/localFileManager.js');

    const gitStatus = await LocalFileManager.ensureProjectGitRepo(projectName, workingDir);

    if (!gitStatus.gitInitialized) {
      throw new Error('Git repository required for hook validation workflow');
    }

    const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
    const fullFilename = filename + fileExtension;
    const mainProjectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);

    // Use session worktree for isolated git operations
    const accessToken = await this.getAuthToken(params);
    const worktreeManager = new SessionWorktreeManager();
    const projectPath = await worktreeManager.ensureWorktree(
      scriptId,
      this.gasClient,
      accessToken
    );
    mcpLogger.info('write', `[WRITE] Using session worktree: ${projectPath}`);

    const filePath = join(projectPath, fullFilename);

    // PHASE 0: Check current branch (no auto-creation of feature branches)
    const { getCurrentBranchName } = await import('../../utils/gitStatus.js');
    const currentBranch = await getCurrentBranchName(projectPath);

    mcpLogger.info('write', `[WRITE] Current branch: ${currentBranch}`);

    // PHASE 1: Local validation with hooks (NO COMMIT - just validate and stage)
    const hookResult = await writeLocalAndValidateHooksOnly(
      content,
      filePath,
      fullFilename,  // Use full filename with extension for git operations
      projectPath  // Pass git root for hook execution
    );

    if (!hookResult.success) {
      throw new Error(`Git hooks validation failed: ${hookResult.error}`);
    }

    const finalContent = hookResult.contentAfterHooks || content;

    // PHASE 2: Remote synchronization via WriteOperationStrategy
    let results: any = {
      hookValidation: {
        success: true,
        hookModified: hookResult.hookModified
        // No commitHash - we don't auto-commit
      }
    };

    if (!localOnly) {
      // Determine file type for the strategy (check existing remote file first)
      const accessTokenForStrategy = accessToken;
      const currentFiles = prefetchedFiles || await this.gasClient.getProjectContent(scriptId, accessTokenForStrategy);
      const existingFile = currentFiles.find((f: any) => fileNameMatches(f.name, filename));
      const resolvedFileType = (existingFile?.type || determineFileTypeUtil(filename, finalContent)) as 'SERVER_JS' | 'HTML' | 'JSON';

      // Session worktree conflict detection (check if remote changed since session start)
      let sessionConflictWarning: string | null = null;
      if (existingFile) {
        sessionConflictWarning = worktreeManager.checkConflict(scriptId, filename, existingFile.source || '');
        if (sessionConflictWarning) {
          console.error(`⚠️ [CONFLICT] ${sessionConflictWarning}`);
        }
      }

      // Delegate conflict detection + remote write + xattr/mtime to WriteOperationStrategy
      const writeStrategy = new WriteOperationStrategy({
        scriptId,
        filename,
        processedContent: finalContent,
        fileType: resolvedFileType,
        force: params.force,
        expectedHash: params.expectedHash,
        localFilePath: filePath,
        accessToken: accessTokenForStrategy,
        gasClient: this.gasClient,
        prefetchedFiles: currentFiles
      });

      try {
        // applyChanges: conflict detection → updateProjectContent → mtime → xattr
        const validatedMap = new Map([[filename, finalContent]]);
        const strategyResult = await writeStrategy.applyChanges(validatedMap);

        // Verify local file matches what was sent to remote
        const { readFile: fsReadFile } = await import('fs/promises');
        const currentLocalContent = await fsReadFile(filePath, 'utf-8');

        if (currentLocalContent !== finalContent) {
          console.error(`⚠️ [SYNC] Local file changed after hooks - re-writing with remote content`);
          console.error(`   Expected: ${finalContent.length} bytes`);
          console.error(`   Found: ${currentLocalContent.length} bytes`);
          const { writeFile: fsWriteFile } = await import('fs/promises');
          await fsWriteFile(filePath, finalContent, 'utf-8');
        }

        // Update session worktree base hash after successful write
        worktreeManager.updateBaseHash(scriptId, filename, finalContent);

        results.remoteFile = {
          scriptId,
          filename,
          type: resolvedFileType,
          size: strategyResult.size,
          updated: true,
          updateTime: strategyResult.updateTime
        };
        results.hash = strategyResult.hash;

        if (sessionConflictWarning) {
          results.sessionConflictWarning = sessionConflictWarning;
        }

      } catch (remoteError: any) {
        // PHASE 3: Remote failed - unstage changes (simple cleanup, no commit to revert)
        mcpLogger.error('write', `[WRITE] Remote write failed for ${filename} in project ${scriptId}, unstaging local changes: ${remoteError.message}`);

        try {
          const { spawn } = await import('child_process');

          // Check if repo has any commits (empty repo can't use reset HEAD)
          const hasCommits = await new Promise<boolean>((resolve) => {
            const check = spawn('git', ['rev-parse', '--verify', 'HEAD'], { cwd: projectPath });
            check.on('close', (code) => resolve(code === 0));
            check.on('error', () => resolve(false));
          });

          if (hasCommits) {
            await new Promise<void>((resolve, reject) => {
              const git = spawn('git', ['reset', 'HEAD', fullFilename], { cwd: projectPath });
              git.on('close', (code) => code === 0 ? resolve() : reject(new Error(`git reset failed with exit code ${code}`)));
              git.on('error', reject);
            });
          } else {
            await new Promise<void>((resolve, reject) => {
              const git = spawn('git', ['rm', '--cached', fullFilename], { cwd: projectPath });
              git.on('close', (code) => code === 0 ? resolve() : reject(new Error(`git rm --cached failed with exit code ${code}`)));
              git.on('error', reject);
            });
          }
          mcpLogger.info('write', `[WRITE] Unstaged ${fullFilename} after remote failure`);
        } catch (unstageError) {
          mcpLogger.warning('write', `[WRITE] Could not unstage ${fullFilename}: ${unstageError}`);
        }

        // Re-throw ConflictError as-is (don't wrap it)
        if (remoteError instanceof ConflictError) {
          throw remoteError;
        }
        throw new Error(`Remote write failed for ${filename} in project ${scriptId} - local changes unstaged: ${remoteError.message}`);
      }
    }

    // Build git uncommitted status for compact hints
    const uncommittedStatus = await getUncommittedStatus(projectPath);

    // Analyze content for warnings and hints based on file type
    let contentAnalysis: { warnings: string[]; hints: string[] } | undefined;
    const detectedFileType = determineFileTypeUtil(filename, finalContent);
    if (detectedFileType === 'HTML') {
      contentAnalysis = analyzeHtmlContent(finalContent);
    } else if (detectedFileType === 'SERVER_JS') {
      contentAnalysis = analyzeCommonJsContent(finalContent, params.moduleOptions, filename);
    } else if (detectedFileType === 'JSON' && isManifestFile(filename)) {
      contentAnalysis = analyzeManifestContent(finalContent);
    }

    // Build result with local and git hints
    const result: any = {
      success: true,
      path: `${scriptId}/${filename}`,
      size: finalContent.length,
      hash: results.hash  // Git SHA-1 of written content (WRAPPED) for future conflict detection
    };

    // Add session conflict warning from session worktree
    if (results.sessionConflictWarning) {
      result.warnings = [results.sessionConflictWarning];
    }

    // Add content-specific warnings and hints (before other metadata)
    if (contentAnalysis) {
      if (contentAnalysis.warnings.length > 0) {
        result.warnings = [...(result.warnings || []), ...contentAnalysis.warnings];
      }
      if (contentAnalysis.hints.length > 0) {
        result.hints = contentAnalysis.hints;
      }
    }

    // Add local file info
    result.local = {
      path: filePath,
      exists: true
    };

    // Add compact git hints
    result.git = buildCompactGitHint(currentBranch, uncommittedStatus);
    if (result.git && result.git.blocked) {
      result.git = { ...result.git, workflow: buildWriteWorkflowHints(result.git, scriptId) };
    }

    // Add git breadcrumb hint for .git/* files
    const gitBreadcrumbHint = getGitBreadcrumbWriteHint(filename);
    if (gitBreadcrumbHint) {
      result.gitBreadcrumbHint = gitBreadcrumbHint;
    }

    // Add HTML template test hint for user HTML files
    const htmlTestHint = buildHtmlTemplateHint(filename, scriptId);
    if (htmlTestHint) {
      result.html_test = htmlTestHint;
    }

    return result;
  }

  /**
   * Pull a specific remote file to local if it exists remotely but not locally
   * This prevents data loss by ensuring remote content is visible before overwriting
   *
   * @param projectName - Project name
   * @param filename - File name to pull
   * @param remoteFiles - Remote file metadata (must include name, updateTime, type, source)
   * @param workingDir - Working directory
   * @returns true if file was pulled, false if no pull was needed
   *
   * NOTE: Callers should pass fresh content from getProjectContent() to ensure
   * atomic consistency with subsequent checkSyncOrThrowByHash() calls
   */
  private async pullRemoteFileIfNeeded(
    projectName: string,
    filename: string,
    remoteFiles: any[],
    workingDir: string
  ): Promise<boolean> {
    const { LocalFileManager } = await import('../../utils/localFileManager.js');

    // Check if file exists in remote
    const remoteFile = remoteFiles.find((f: any) => fileNameMatches(f.name, filename));
    if (!remoteFile) {
      return false; // File doesn't exist remotely, nothing to pull
    }

    // Check if file exists locally
    const localContent = await LocalFileManager.readFileFromProject(projectName, filename, workingDir);
    if (localContent !== null) {
      return false; // File already exists locally, no pull needed
    }

    // File exists remotely but not locally - pull it
    console.error(`📥 [AUTO-PULL] Pulling remote file before write: ${filename}`);

    await LocalFileManager.copyRemoteToLocal(
      projectName,
      [remoteFile], // Pull only this specific file
      workingDir
    );

    console.error(`✅ [AUTO-PULL] Successfully pulled ${filename} to local cache`);
    return true;
  }

  /**
   * Execute raw write (no CommonJS wrapping). Former RawWriteTool behavior.
   * Activated when write({..., raw: true}) is called.
   */
  private async executeRaw(params: RawWriteParams): Promise<any> {
    // Use validateAndParseFilePath with separate scriptId + path (WriteTool convention)
    const { scriptId, filename, fullPath: path } = validateAndParseFilePath(
      { scriptId: params.scriptId, path: params.path },
      this.validate.filePath.bind(this.validate),
      'file writing'
    );

    const position = params.position !== undefined
      ? this.validate.number(params.position, 'position', 'file writing', 0)
      : undefined;

    // ⚠️ SPECIAL FILE VALIDATION: appsscript.json must be in root
    const parsedPath = parsePath(path);
    let gasName = filename;
    if (isManifestFile(gasName)) {
      if (parsedPath.directory && parsedPath.directory !== '') {
        throw new ValidationError(
          'path',
          path,
          'appsscript.json must be in project root (scriptId/appsscript), not in subfolders'
        );
      }
    }

    // ✅ SIMPLIFIED FILE TYPE HANDLING - fileType is REQUIRED for raw mode
    const gasFileType = params.fileType as 'SERVER_JS' | 'HTML' | 'JSON';

    // Strip extensions only if they match the declared file type
    if (gasFileType === 'SERVER_JS') {
      if (gasName.toLowerCase().endsWith('.js')) {
        gasName = gasName.slice(0, -3);
      } else if (gasName.toLowerCase().endsWith('.gs')) {
        gasName = gasName.slice(0, -3);
      }
    } else if (gasFileType === 'HTML') {
      if (gasName.toLowerCase().endsWith('.html')) {
        gasName = gasName.slice(0, -5);
      } else if (gasName.toLowerCase().endsWith('.htm')) {
        gasName = gasName.slice(0, -4);
      }
    } else if (gasFileType === 'JSON') {
      if (gasName.toLowerCase().endsWith('.json')) {
        gasName = gasName.slice(0, -5);
      }
    }

    const content: string = params.content;

    // Content integrity validation (non-blocking warnings)
    const contentWarnings = validateCommonJsIntegrity(
      gasName, content, gasFileType, 'raw-write'
    );

    // After validation passes, check authentication
    const accessToken = await this.getAuthToken(params);

    // Two-phase git discovery with projectPath support
    const projectPath = params.projectPath || '';
    const { discoverGit } = await import('../../utils/gitDiscovery.js');
    const gitDiscovery = await discoverGit(scriptId, projectPath, this.gasClient, accessToken);

    // If git discovered, use simplified atomic workflow
    if (gitDiscovery.gitExists && !params.skipSyncCheck) {
      return await this.executeRawWithGitWorkflow(
        params,
        { scriptId } as any,
        gasName,
        content,
        gasFileType,
        position,
        accessToken,
        projectPath,
        gitDiscovery,
        contentWarnings
      );
    }

    // === HASH-BASED CONFLICT DETECTION (RAW content) ===
    let writtenHash: string | undefined;

    if (!params.force) {
      const currentFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
      const existingFile = currentFiles.find((f: any) => fileNameMatches(f.name, gasName));

      if (existingFile) {
        const currentRemoteHash = computeGitSha1(existingFile.source || '');

        let expectedHash: string | undefined = params.expectedHash;
        let hashSource: 'param' | 'xattr' | 'computed' = 'param';

        if (!expectedHash) {
          // Use local git file content as the conflict detection seed
          try {
            const { LocalFileManager } = await import('../../utils/localFileManager.js');
            const localRoot = await LocalFileManager.getProjectDirectory(scriptId);
            if (localRoot) {
              const fileExtension = LocalFileManager.getFileExtensionFromName(gasName);
              const localPath = join(localRoot, gasName + fileExtension);
              const localContent = await readFile(localPath, 'utf-8');
              expectedHash = computeGitSha1(localContent);
              hashSource = 'local_git' as any;
            }
          } catch {
            // Local git file not available - continue without conflict detection
          }
        }

        if (expectedHash && !hashesEqual(expectedHash, currentRemoteHash)) {
          const { createTwoFilesPatch } = await import('diff');

          const diffContent = createTwoFilesPatch(
            `${gasName} (expected)`,
            `${gasName} (current remote)`,
            '',
            existingFile.source || '',
            'baseline from your last read',
            'modified by another session'
          );

          const linesAdded = (diffContent.match(/^\+[^+]/gm) || []).length;
          const linesRemoved = (diffContent.match(/^-[^-]/gm) || []).length;

          const conflict: ConflictDetails = {
            scriptId,
            filename: gasName,
            operation: 'write',
            expectedHash,
            currentHash: currentRemoteHash,
            hashSource,
            changeDetails: {
              sizeChange: `${(existingFile.source?.length || 0) - (existingFile.source?.length || 0)} bytes`
            },
            diff: {
              format: 'unified',
              content: diffContent.length > 20000
                ? diffContent.slice(0, 20000) + '\n... (truncated)'
                : diffContent,
              linesAdded,
              linesRemoved,
              truncated: diffContent.length > 20000,
              truncatedMessage: diffContent.length > 20000
                ? `Diff truncated (showing first 20000 of ${diffContent.length} chars)`
                : undefined
            }
          };

          throw new ConflictError(conflict);
        }
      }
    }
    // === END HASH-BASED CONFLICT DETECTION ===

    const updatedFiles = await this.gasClient.updateFile(
      scriptId,
      gasName,
      content,
      position,
      accessToken,
      gasFileType
    );

    writtenHash = computeGitSha1(content);

    // Sync to local cache with remote mtime (write-through cache)
    try {
      const { LocalFileManager } = await import('../../utils/localFileManager.js');
      const localRoot = await LocalFileManager.getProjectDirectory(scriptId);

      if (localRoot) {
        const fileExtension = LocalFileManager.getFileExtensionFromName(gasName);
        const localPath = join(localRoot, gasName + fileExtension);
        await mkdir(dirname(localPath), { recursive: true });
        await writeFile(localPath, content, 'utf-8');

      }
    } catch (syncError) {
      // Don't fail the operation if local sync fails - remote write succeeded
    }

    // Detect local git and check for breadcrumb
    let gitDetection: GitDetection | undefined = undefined;
    try {
      const gitPath = await detectLocalGit(scriptId);

      let files: any[] = [];
      try {
        files = await this.gasClient.getProjectContent(scriptId, accessToken);
      } catch (filesError) {
        console.error('[GIT-DETECTION] Could not fetch files for breadcrumb check:', filesError);
      }

      const breadcrumbExists = files.length > 0 ? checkBreadcrumbExists(files) : null;

      if (gitPath) {
        gitDetection = {
          localGitDetected: true,
          breadcrumbExists: breadcrumbExists ?? undefined
        };

        if (breadcrumbExists === false) {
          gitDetection.recommendation = buildRecommendation(scriptId, gitPath);
        }
      } else {
        gitDetection = {
          localGitDetected: false
        };
      }
    } catch (detectionError: any) {
      console.error('[GIT-DETECTION] Error during detection:', detectionError?.message ?? String(detectionError));
      gitDetection = {
        localGitDetected: false
      };
    }

    const result: any = {
      status: 'success',
      path,
      scriptId,
      filename: gasName,
      size: content.length,
      hash: writtenHash,
      hashNote: 'Hash computed on raw content (including CommonJS wrappers if present).',
      position: updatedFiles.findIndex((f: any) => fileNameMatches(f.name, gasName)),
      totalFiles: updatedFiles.length
    };

    if (contentWarnings.length > 0) {
      result.warnings = contentWarnings;
    }

    if (gitDetection) {
      result.git = gitDetection;
    }

    const gitBreadcrumbHint = getGitBreadcrumbWriteHint(gasName);
    if (gitBreadcrumbHint) {
      result.gitBreadcrumbHint = gitBreadcrumbHint;
    }

    return result;
  }

  /**
   * Execute raw write with git workflow (stage-only, no auto-commit).
   * Former RawWriteTool.executeWithGitWorkflow() behavior.
   */
  private async executeRawWithGitWorkflow(
    params: RawWriteParams,
    parsedPath: { scriptId: string },
    filename: string,
    content: string,
    gasFileType: string,
    position: number | undefined,
    accessToken: string,
    projectPath: string,
    gitDiscovery: any,
    contentWarnings: string[]
  ): Promise<any> {
    const scriptId = parsedPath.scriptId;
    const { LocalFileManager } = await import('../../utils/localFileManager.js');
    const { writeLocalAndValidateHooksOnly: writeAndValidate } = await import('../../utils/hookIntegration.js');
    const { unstageFile } = await import('../../utils/hookIntegration.js');
    const { getCurrentBranchName, getUncommittedStatus: getUncommittedStatusLocal, buildCompactGitHint: buildCompactGitHintLocal } = await import('../../utils/gitStatus.js');

    const baseProjectPath = await LocalFileManager.getProjectDirectory(scriptId);
    const projectRoot = projectPath ? join(baseProjectPath, projectPath) : baseProjectPath;
    const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
    const fullFilename = filename + fileExtension;
    const filePath = join(projectRoot, fullFilename);

    mcpLogger.info('write', `[RAW_WRITE] Git discovered: ${gitDiscovery.source} at ${gitDiscovery.gitPath}`);

    // === HASH-BASED CONFLICT DETECTION (Git Path - RAW content) ===
    if (!params.force) {
      const currentFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
      const existingFile = currentFiles.find((f: any) => fileNameMatches(f.name, filename));

      if (existingFile) {
        const currentRemoteHash = computeGitSha1(existingFile.source || '');

        let expectedHash: string | undefined = params.expectedHash;
        let hashSource: 'param' | 'xattr' | 'computed' = 'param';

        if (!expectedHash) {
          // Use local git file content as the conflict detection seed
          try {
            const localContent = await readFile(filePath, 'utf-8');
            expectedHash = computeGitSha1(localContent);
            hashSource = 'local_git' as any;
          } catch {
            // Local git file not available - continue without conflict detection
          }
        }

        if (expectedHash && !hashesEqual(expectedHash, currentRemoteHash)) {
          const { createTwoFilesPatch } = await import('diff');

          const diffContent = createTwoFilesPatch(
            `${filename} (expected)`,
            `${filename} (current remote)`,
            '',
            existingFile.source || '',
            'baseline from your last read',
            'modified by another session'
          );

          const linesAdded = (diffContent.match(/^\+[^+]/gm) || []).length;
          const linesRemoved = (diffContent.match(/^-[^-]/gm) || []).length;

          const conflict: ConflictDetails = {
            scriptId,
            filename,
            operation: 'write',
            expectedHash,
            currentHash: currentRemoteHash,
            hashSource,
            changeDetails: {
              sizeChange: `${(existingFile.source?.length || 0)} bytes`
            },
            diff: {
              format: 'unified',
              content: diffContent.length > 20000
                ? diffContent.slice(0, 20000) + '\n... (truncated)'
                : diffContent,
              linesAdded,
              linesRemoved,
              truncated: diffContent.length > 20000,
              truncatedMessage: diffContent.length > 20000
                ? `Diff truncated (showing first 20000 of ${diffContent.length} chars)`
                : undefined
            }
          };

          throw new ConflictError(conflict);
        }
      }
    }
    // === END HASH-BASED CONFLICT DETECTION ===

    const currentBranch = await getCurrentBranchName(projectRoot);
    mcpLogger.info('write', `[RAW_WRITE] Current branch: ${currentBranch}`);

    // PHASE 1: Local validation with hooks (NO COMMIT - just validate and stage)
    const hookResult = await writeAndValidate(
      content,
      filePath,
      fullFilename,
      projectRoot
    );

    if (!hookResult.success) {
      throw new Error(`Git hooks validation failed: ${hookResult.error}`);
    }

    const finalContent = hookResult.contentAfterHooks || content;

    // PHASE 2: Push to remote GAS
    try {
      const updatedFiles = await this.gasClient.updateFile(
        scriptId,
        filename,
        finalContent,
        position,
        accessToken,
        gasFileType as 'SERVER_JS' | 'HTML' | 'JSON'
      );

      const writtenHash = computeGitSha1(finalContent);

      const result: any = {
        status: 'success',
        path: params.path,
        scriptId,
        filename,
        size: finalContent.length,
        hash: writtenHash,
        hashNote: 'Hash computed on raw content including CommonJS wrappers. Use for expectedHash on subsequent write({raw:true}) calls.',
        position: updatedFiles.findIndex((f: any) => fileNameMatches(f.name, filename)),
        totalFiles: updatedFiles.length,
        git: buildCompactGitHintLocal(currentBranch, await getUncommittedStatusLocal(projectRoot))
      };

      if (contentWarnings.length > 0) {
        result.warnings = contentWarnings;
      }

      const gitBreadcrumbHint = getGitBreadcrumbWriteHint(filename);
      if (gitBreadcrumbHint) {
        result.gitBreadcrumbHint = gitBreadcrumbHint;
      }

      return result;

    } catch (remoteError: any) {
      // PHASE 3: Remote failed - unstage changes
      mcpLogger.error('write', `[RAW_WRITE] Remote write failed for ${filename}, unstaging local changes: ${remoteError.message}`);

      try {
        await unstageFile(fullFilename, projectRoot);
        mcpLogger.info('write', `[RAW_WRITE] Unstaged ${fullFilename} after remote failure`);
      } catch (unstageError) {
        mcpLogger.warning('write', `[RAW_WRITE] Could not unstage ${fullFilename}: ${unstageError}`);
      }

      throw new Error(`Remote write failed for ${filename} - local changes unstaged: ${remoteError.message}`);
    }
  }

  /**
   * Fetch remote updateTime with fallback to getProjectMetadata if not returned
   * This ensures we always have the authoritative remote timestamp after write
   *
   * @param scriptId - Project ID
   * @param filename - File name to fetch updateTime for
   * @param updatedFile - File object from updateProjectContent (may have updateTime)
   * @param accessToken - Auth token
   * @returns Remote updateTime or undefined if unavailable
   */
  private async fetchRemoteUpdateTime(
    scriptId: string,
    filename: string,
    updatedFile: any,
    accessToken?: string
  ): Promise<string | undefined> {
    // Fast path: updateTime returned by updateProjectContent
    if (updatedFile?.updateTime) {
      return updatedFile.updateTime;
    }

    // Slow path: Fetch metadata to get updateTime
    console.error(`⚠️ [SYNC] updateTime not returned by updateProjectContent, fetching metadata...`);
    try {
      const metadata = await this.gasClient.getProjectMetadata(scriptId, accessToken);
      const fileMetadata = metadata.find((f: any) => fileNameMatches(f.name, filename));

      if (fileMetadata?.updateTime) {
        console.error(`✅ [SYNC] Retrieved updateTime via metadata: ${fileMetadata.updateTime}`);
        return fileMetadata.updateTime;
      } else {
        console.error(`❌ [SYNC] Could not retrieve updateTime for ${filename}`);
        return undefined;
      }
    } catch (error: any) {
      console.error(`❌ [SYNC] Failed to fetch metadata: ${error.message}`);
      return undefined;
    }
  }
}
