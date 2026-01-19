/**
 * @fileoverview GAS File Write Tool with CommonJS wrapping and conflict detection
 *
 * FLOW: content → wrap(CommonJS) → hashCheck → remote write → local sync → git status
 * KEY: force=true bypasses conflict | expectedHash for optimistic locking | moduleOptions for loadNow/hoisting
 * HASH: Computed on WRAPPED content | returns hash for subsequent edits
 * NO AUTO-COMMIT: Must call git_feature({operation:'commit'}) after writes
 */
import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath, matchesDirectory, getDirectory, getBaseName, joinPath, isWildcardPattern, matchesPattern, resolveHybridScriptId, fileNameMatches } from '../../api/pathParser.js';
import { ValidationError, FileOperationError, ConflictError, type ConflictDetails } from '../../errors/mcpErrors.js';
import { computeGitSha1, isValidGitSha1, hashesEqual } from '../../utils/hashUtils.js';
import { getCachedContentHash, updateCachedContentHash } from '../../utils/gasMetadataCache.js';
import { unwrapModuleContent, shouldWrapContent, wrapModuleContent, getModuleName, analyzeCommonJsUsage, detectAndCleanContent, extractDefineModuleOptionsWithDebug } from '../../utils/moduleWrapper.js';
import { translatePathForOperation } from '../../utils/virtualFileTranslation.js';
import { GitFormatTranslator } from '../../utils/GitFormatTranslator.js';
import { setFileMtimeToRemote, checkSyncOrThrow } from '../../utils/fileHelpers.js';
import { processHoistedAnnotations } from '../../utils/hoistedFunctionGenerator.js';
import { shouldAutoSync } from '../../utils/syncDecisions.js';
import { validateAndParseFilePath } from '../../utils/filePathProcessor.js';
import { writeLocalAndValidateHooksOnly } from '../../utils/hookIntegration.js';
import { getUncommittedStatus, buildGitHint } from '../../utils/gitStatus.js';
import { detectLocalGit, checkBreadcrumbExists, buildRecommendation, type GitHints, type GitDetection } from '../../utils/localGitDetection.js';
import { log } from '../../utils/logger.js';
import { getGitBreadcrumbWriteHint } from '../../utils/gitBreadcrumbHints.js';
import { analyzeContent, analyzeHtmlContent, analyzeCommonJsContent, analyzeManifestContent, determineFileType as determineFileTypeUtil } from '../../utils/contentAnalyzer.js';
import { join, dirname } from 'path';
import { mkdir, stat, readFile } from 'fs/promises';
import { expandAndValidateLocalPath } from '../../utils/pathExpansion.js';
import { SCRIPT_ID_SCHEMA, PATH_SCHEMA, WORKING_DIR_SCHEMA, ACCESS_TOKEN_SCHEMA, FILE_TYPE_SCHEMA, MODULE_OPTIONS_SCHEMA, CONTENT_SCHEMA, FORCE_SCHEMA } from './shared/schemas.js';
import type { WriteParams, WriteResult } from './shared/types.js';

/**
 * Write file contents with automatic CommonJS processing and git hook validation
 *
 * ✅ RECOMMENDED - Use for normal development workflow
 * Automatically wraps user code with CommonJS, validates with git hooks (if available)
 */
export class WriteTool extends BaseFileSystemTool {
  public name = 'write';
  public description = 'Write file to GAS (NO git auto-commit). After writes, call git_feature({operation:"commit"}) to save changes. Automatically wraps user code with CommonJS module system. Writes locally and syncs to remote GAS.';

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
        type: 'string',
        description: 'Git SHA-1 hash (40 hex chars) from previous cat. If provided and differs from current remote, write fails with ConflictError. Use force:true to bypass.',
        pattern: '^[a-f0-9]{40}$',
        examples: ['a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2']
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
      }
    },
    required: ['scriptId', 'path'],  // content OR fromLocal must be provided
    additionalProperties: false,
    llmGuidance: {
      // LOCAL FILE TRANSFER - Prefer fromLocal over inline content
      localFileSupport: {
        fromLocal: 'Read content from local file: write({scriptId, path:"app.js", fromLocal:"~/src/app.js"})',
        useCase: 'Upload generated code, import existing files, bulk migration from local projects',
        validation: 'Either content or fromLocal required (not both). Supports ~ expansion.',
        recommendation: 'PREFER fromLocal over inline content when: (1) content exists locally, (2) content is large (>100 lines), (3) content was just generated. Saves tokens + enables local editing.'
      },
      // GIT INTEGRATION - CRITICAL for LLM behavior
      gitIntegration: {
        CRITICAL: 'This tool does NOT auto-commit to git',
        behavior: 'File writes push to GAS but do NOT commit locally',
        workflowSignal: 'Response includes git.taskCompletionBlocked=true when uncommitted',
        taskCompletionRule: 'Task is NOT complete while git.uncommittedChanges.count > 0',
        requiredAction: 'git_feature({operation:"commit", scriptId, message:"..."})'
      },

      whenToUse: 'Normal file write with auto CommonJS wrapping. Use edit/aider for small changes (95%+ token savings).',
      alternatives: 'edit: exact text match, aider: fuzzy match, raw_write: no CommonJS processing',
      commonJs: 'Auto-wraps SERVER_JS with require(), module, exports. Never manually add _main() or __defineModule__.',
      moduleOptions: {
        loadNow: 'true=eager startup, false=lazy on require()',
        eventHandlerPattern: 'If code contains module.exports.__events__, MUST include moduleOptions: { loadNow: true }',
        troubleshooting: 'Log "[WARN] No X handlers found" means missing loadNow: true',
        hoistedFunctions: '[{name,params,jsdoc}] for Sheets autocomplete'
      },
      force: '⚠️ DANGEROUS: Skips sync validation. Use only when intentionally discarding remote changes.',
      examples: [
        'Basic: {path:"utils",content:"function add(a,b){return a+b}"}',
        'Module: {path:"calc",content:"module.exports={add,multiply}"}',
        'Event: {path:"Menu",content:"module.exports.__events__={onOpen:\\"onOpen\\"}",moduleOptions:{loadNow:true}}',
        'Force: {path:"Code",content:"...",force:true}  // ⚠️ Overwrites remote even if out of sync'
      ],
      errorRecovery: {
        'sync conflict': 'rsync first OR force:true (⚠️ overwrites remote)',
        'auth expired': 'auth({mode:"status"}) → auth({mode:"start"}) if needed',
        'file locked': 'Wait 30s (auto-unlock) OR check concurrent writes'
      },
      antiPatterns: [
        '❌ write for small edits → use edit/aider (95% token savings)',
        '❌ manual _main() wrapper → let write auto-wrap',
        '❌ __events__ without loadNow:true → handlers won\'t register',
        '❌ assuming auto-commit happened → MUST call git_feature commit'
      ]
    }
  };

  async execute(params: WriteParams): Promise<WriteResult> {
    const { LocalFileManager } = await import('../../utils/localFileManager.js');
    const workingDir = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    const localOnly = params.localOnly || false;
    let remoteOnly = params.remoteOnly || false;

    if (localOnly && remoteOnly) {
      throw new ValidationError('localOnly/remoteOnly', 'both true', 'only one can be true');
    }

    const { scriptId, filename, projectName, fullPath } = validateAndParseFilePath(
      params,
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
        log.info(`[WRITE] Reading content from local file: ${localPath} (${originalContent.length} chars)`);
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

    if (!localOnly && shouldWrapContent(fileType, filename)) {
      try {
        const accessToken = await this.getAuthToken(params);
        const existingFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
        const hasCommonJS = existingFiles.some((f: any) => fileNameMatches(f.name, 'common-js/require'));

        if (!hasCommonJS) {
          console.error(`🔧 [AUTO-INIT] CommonJS not found in project ${scriptId}, initializing...`);
          const { ProjectInitTool } = await import('../deployments.js');
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
          const existingFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
          const existingFile = existingFiles.find((f: any) => f.name === filename);

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
          const existingFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
          const existingFile = existingFiles.find((f: any) => f.name === filename);

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
      log.info(`[WRITE] .git/ breadcrumb file detected: ${filename} - forcing remote-only (GAS breadcrumbs should not be written to local .git/ directory)`);
    }

    // Two-phase git discovery with projectPath support
    const projectPath = params.projectPath || '';
    const accessToken = await this.getAuthToken(params);

    // Discover git (Phase A: local filesystem, Phase B: GAS breadcrumbs)
    const { discoverGit } = await import('../../utils/gitDiscovery.js');
    const gitDiscovery = await discoverGit(scriptId, projectPath, this.gasClient, accessToken);

    if (gitDiscovery.gitExists && !remoteOnly) {
      // Git discovered → use enhanced atomic workflow with feature branches
      log.info(`[WRITE] Git discovered: ${gitDiscovery.source} at ${gitDiscovery.gitPath}`);

      if (gitDiscovery.breadcrumbsPulled && gitDiscovery.breadcrumbsPulled.length > 0) {
        log.info(`[WRITE] Pulled ${gitDiscovery.breadcrumbsPulled.length} git breadcrumbs from GAS`);
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
        params.changeReason  // Pass custom commit message
      );
    }

    log.info('[WRITE] No git discovered, using remote-first workflow');

    // Check if git repo exists locally (even if not discovered by new discovery mechanism)
    const gitStatus = await LocalFileManager.ensureProjectGitRepo(projectName, workingDir);

    // Verify sync status with remote
    let syncStatus: any = null;
    let remoteFiles: any[] = [];

    // Skip local sync operations when remoteOnly is true (e.g., .git/ breadcrumb files)
    if (!localOnly && !remoteOnly) {
      try {
        remoteFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
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

    if (!localOnly) {
      try {
        const currentFiles = await this.gasClient.getProjectContent(scriptId, accessToken);

        const existingFile = currentFiles.find((f: any) => f.name === filename);
        const fileType = existingFile?.type || determineFileTypeUtil(filename, content);

        // === HASH-BASED CONFLICT DETECTION ===
        // Check for concurrent modifications before writing
        if (existingFile && !params.force) {
          // Compute current remote hash on WRAPPED content (full file as stored in GAS)
          // This ensures hash matches `git hash-object <file>` on local synced files
          const currentRemoteHash = computeGitSha1(existingFile.source || '');

          // Determine expected hash (priority: param > xattr cache)
          let expectedHash: string | undefined = params.expectedHash;
          let hashSource: 'param' | 'xattr' | 'computed' = 'param';

          if (!expectedHash) {
            // Try to get cached hash from xattr
            try {
              const { LocalFileManager } = await import('../../utils/localFileManager.js');
              const localRoot = await LocalFileManager.getProjectDirectory(projectName, workingDir);
              if (localRoot) {
                const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
                const localFilePath = join(localRoot, filename + fileExtension);
                expectedHash = await getCachedContentHash(localFilePath) || undefined;
                if (expectedHash) {
                  hashSource = 'xattr';
                }
              }
            } catch {
              // xattr cache not available - continue without
            }
          }

          // Validate hash if we have one
          if (expectedHash && !hashesEqual(expectedHash, currentRemoteHash)) {
            // Generate unified diff for the conflict
            const { createTwoFilesPatch } = await import('diff');
            const { unwrappedContent: expectedUnwrapped } = unwrapModuleContent(existingFile.source || '');

            // For diff, we need original content (what user expected) vs current remote
            // Since we don't have the original, we show remote content changed
            // Unwrap for diff display only (hash is computed on wrapped content)
            const { unwrappedContent: remoteUnwrappedForDiff } = unwrapModuleContent(existingFile.source || '');
            const diffContent = createTwoFilesPatch(
              `${filename} (expected)`,
              `${filename} (current remote)`,
              '', // We don't have expected content, so show as empty diff note
              remoteUnwrappedForDiff,
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
                sizeChange: `${remoteUnwrappedForDiff.length} bytes (unwrapped)`
              },
              diff: {
                format: 'unified',
                content: diffContent.length > 5000
                  ? diffContent.slice(0, 5000) + '\n... (truncated)'
                  : diffContent,
                linesAdded,
                linesRemoved,
                truncated: diffContent.length > 5000,
                truncatedMessage: diffContent.length > 5000
                  ? `Diff truncated (showing first 5000 of ${diffContent.length} chars)`
                  : undefined
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

        if (existingFile) {
          updatedFiles = currentFiles.map((f: any) =>
            f.name === filename ? newFile : f
          );
        } else {
          updatedFiles = [...currentFiles, newFile];
        }

        const remoteResult = await this.gasClient.updateProjectContent(scriptId, updatedFiles, accessToken);
        const updatedFile = remoteResult.find((f: any) => f.name === filename);

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
      const isNewFile = previousLocalContent === null;
      const contentChanged = previousLocalContent !== content;

      if (isNewFile) {
        commitMessage = `Add ${filename}`;
      } else if (contentChanged) {
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

    if (!remoteOnly && gitStatus.gitInitialized) {
      try {
        const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
        const fullFilename = filename + fileExtension;
        projectPathForGit = await LocalFileManager.getProjectDirectory(projectName, workingDir);
        const path = await import('path');
        const filePath = path.join(projectPathForGit, fullFilename);

        await mkdir(dirname(filePath), { recursive: true });
        await import('fs').then(fs => fs.promises.writeFile(filePath, content, 'utf-8'));

        // ✅ IMMEDIATELY set mtime to match remote (close race window)
        const authoritativeUpdateTime = results.remoteFile?.updateTime;
        if (authoritativeUpdateTime) {
          await setFileMtimeToRemote(filePath, authoritativeUpdateTime, fileType);
          console.error(`⏰ [SYNC] Set mtime after git write: ${authoritativeUpdateTime}`);
        } else {
          console.error(`⚠️ [SYNC] No remote updateTime available, leaving mtime as NOW`);
        }

        // Stage the file (NO COMMIT - LLM must call git_feature)
        const { spawn } = await import('child_process');
        await new Promise<void>((resolve, reject) => {
          const git = spawn('git', ['add', fullFilename], { cwd: projectPathForGit! });
          git.on('close', (code) => code === 0 ? resolve() : reject(new Error(`git add failed with code ${code}`)));
          git.on('error', reject);
        });
        console.error(`📦 [GIT] Staged ${fullFilename} (NOT committed - call git_feature to commit)`);
      } catch (stageError: any) {
        console.error(`⚠️ [GIT] Could not stage file: ${stageError.message}`);
        // Continue anyway - file is written, just not staged
      }
    }

    // Write local file (final step)
    if (!remoteOnly) {
      try {
        const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
        const fullFilename = filename + fileExtension;
        const projectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
        const path = await import('path');
        const filePath = path.join(projectPath, fullFilename);

        await mkdir(dirname(filePath), { recursive: true });
        await import('fs').then(fs => fs.promises.writeFile(filePath, content, 'utf-8'));

        // ✅ IMMEDIATELY set mtime to match remote (close race window)
        const authoritativeUpdateTime = results.remoteFile?.updateTime;
        if (authoritativeUpdateTime) {
          await setFileMtimeToRemote(filePath, authoritativeUpdateTime, fileType);
          console.error(`⏰ [SYNC] Set mtime after final write: ${authoritativeUpdateTime}`);
        } else {
          console.error(`⚠️ [SYNC] No remote updateTime available, leaving mtime as NOW`);
        }

        // Update xattr cache with new hash for future conflict detection
        if (results.hash) {
          try {
            await updateCachedContentHash(filePath, results.hash);
            console.error(`🔒 [HASH] Updated xattr cache with hash: ${results.hash.slice(0, 8)}...`);
          } catch (cacheError) {
            // Non-fatal: xattr not supported on filesystem
            console.error(`⚠️ [HASH] Could not cache hash: ${cacheError}`);
          }
        }

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

    // Check for git association hints AND detect local git (single API call)
    const { gitHints, gitDetection } = await this.detectGitInfoAndBreadcrumb(scriptId, accessToken);

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
          'Tip: Use log() (3rd param in _main) for debugging. Enable with: setModuleLogging("' + filename + '", true)'
        );
      }
    } else if (detectedFileType === 'JSON' && filename.toLowerCase() === 'appsscript') {
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

    // Add content-specific warnings and hints (before other metadata)
    if (contentAnalysis) {
      if (contentAnalysis.warnings.length > 0) {
        result.warnings = contentAnalysis.warnings;
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

    // Add git hints if available (merge with detection results + uncommitted status)
    if (gitHints || gitDetection || projectPathForGit) {
      // Build uncommitted status if we have a git path
      let uncommittedHints: any = {};
      if (projectPathForGit) {
        try {
          const uncommittedStatus = await getUncommittedStatus(projectPathForGit);
          const gitHint = await buildGitHint(scriptId, projectPathForGit, uncommittedStatus, filename);
          uncommittedHints = {
            branch: gitHint.branch,
            uncommittedChanges: gitHint.uncommittedChanges,
            recommendation: gitHint.recommendation,
            taskCompletionBlocked: gitHint.taskCompletionBlocked
          };
        } catch (hintError) {
          // Continue without hints if we can't get them
          console.error(`⚠️ [GIT] Could not build uncommitted hints: ${hintError}`);
        }
      }

      result.git = {
        ...(gitHints || {}),
        ...(gitDetection || {}),
        ...uncommittedHints
      };

      // Add workflow completion hint with rsync suggestion
      result.nextAction = {
        hint: `File written. Commit when ready: git_feature({ operation: 'commit', scriptId, message: '...' })`,
        required: uncommittedHints.taskCompletionBlocked || false,
        rsync: `local_sync({ scriptId: "${scriptId}", operation: "plan", direction: "pull" })`
      };
    }

    // Add git breadcrumb hint for .git/* files
    const gitBreadcrumbHint = getGitBreadcrumbWriteHint(filename);
    if (gitBreadcrumbHint) {
      result.gitBreadcrumbHint = gitBreadcrumbHint;
    }

    return result;
  }

  /**
   * Detect git info and breadcrumb in a single API call
   * Checks for git association hints (.git.gs files) and local git detection
   *
   * @param scriptId - GAS project ID
   * @param accessToken - Auth token for API calls
   * @returns Object containing gitHints and gitDetection
   */
  private async detectGitInfoAndBreadcrumb(
    scriptId: string,
    accessToken: string
  ): Promise<{ gitHints?: GitHints; gitDetection?: GitDetection }> {
    let gitHints: GitHints | undefined = undefined;
    let gitDetection: GitDetection | undefined = undefined;
    let allFiles: any[] = [];

    try {
      // Single API call for both git hints and breadcrumb detection
      allFiles = await this.gasClient.getProjectContent(scriptId, accessToken);

      // Check for git association hints
      const gitConfigFiles = allFiles.filter((f: any) =>
        f.name === '.git.gs' || f.name.endsWith('/.git.gs')
      );

      if (gitConfigFiles.length > 0) {
        // Parse git configuration to provide hints
        const hints: any[] = [];

        for (const gitFile of gitConfigFiles) {
          try {
            const config = JSON.parse(gitFile.source || '{}');
            const projectPath = gitFile.name === '.git.gs' ? '' : gitFile.name.replace('/.git.gs', '');
            const localPath = config.local?.path || `~/gas-repos/project-${scriptId}`;

            hints.push(localPath);
          } catch (parseError) {
            // Skip invalid git config files
          }
        }

        if (hints.length > 0) {
          gitHints = {
            associated: true,
            syncFolder: hints[0]  // Primary sync folder
          };
        }
      }
    } catch (gitCheckError) {
      // Git hints are optional - continue without them
      console.error('[GIT-DETECTION] Could not fetch files for git hints:', gitCheckError);
    }

    // Detect local git and check for breadcrumb (reuse allFiles)
    try {
      const gitPath = await detectLocalGit(scriptId);
      const breadcrumbExists = allFiles.length > 0 ? checkBreadcrumbExists(allFiles) : null;

      if (gitPath) {
        gitDetection = {
          localGitDetected: true,
          breadcrumbExists: breadcrumbExists ?? undefined  // null becomes undefined for cleaner response
        };

        // Add recommendation ONLY if we KNOW breadcrumb is missing (not unknown)
        if (breadcrumbExists === false) {
          gitDetection.recommendation = buildRecommendation(scriptId, gitPath);
        }
      } else {
        gitDetection = {
          localGitDetected: false
        };
      }
    } catch (detectionError: any) {
      // Git detection is optional - log but don't fail write
      console.error('[GIT-DETECTION] Error during detection:', detectionError?.message ?? String(detectionError));
      gitDetection = {
        localGitDetected: false
      };
    }

    return { gitHints, gitDetection };
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
    changeReason?: string
  ): Promise<any> {
    const { LocalFileManager } = await import('../../utils/localFileManager.js');

    const gitStatus = await LocalFileManager.ensureProjectGitRepo(projectName, workingDir);

    if (!gitStatus.gitInitialized) {
      throw new Error('Git repository required for hook validation workflow');
    }

    const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
    const fullFilename = filename + fileExtension;
    const projectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
    const filePath = join(projectPath, fullFilename);

    // PHASE 0: Check current branch (no auto-creation of feature branches)
    const { getCurrentBranchName } = await import('../../utils/gitStatus.js');
    const currentBranch = await getCurrentBranchName(projectPath);

    log.info(`[WRITE] Current branch: ${currentBranch}`);

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

    // PHASE 2: Remote synchronization
    let results: any = {
      hookValidation: {
        success: true,
        hookModified: hookResult.hookModified
        // No commitHash - we don't auto-commit
      }
    };

    if (!localOnly) {
      try {
        const accessToken = await this.getAuthToken(params);

        const currentFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
        const existingFile = currentFiles.find((f: any) => f.name === filename);
        const fileType = existingFile?.type || determineFileTypeUtil(filename, finalContent);

        // === HASH-BASED CONFLICT DETECTION (Git Path) ===
        if (existingFile && !params.force) {
          // Compute current remote hash on WRAPPED content (full file as stored in GAS)
          // This ensures hash matches `git hash-object <file>` on local synced files
          const currentRemoteHash = computeGitSha1(existingFile.source || '');

          // Determine expected hash (priority: param > xattr cache)
          let expectedHash: string | undefined = params.expectedHash;
          let hashSource: 'param' | 'xattr' | 'computed' = 'param';

          if (!expectedHash) {
            // Try to get cached hash from xattr
            try {
              expectedHash = await getCachedContentHash(filePath) || undefined;
              if (expectedHash) {
                hashSource = 'xattr';
              }
            } catch {
              // xattr cache not available - continue without
            }
          }

          // Validate hash if we have one
          if (expectedHash && !hashesEqual(expectedHash, currentRemoteHash)) {
            // Generate unified diff for the conflict
            // Unwrap for diff display only (hash is computed on wrapped content)
            const { createTwoFilesPatch } = await import('diff');
            const { unwrappedContent: remoteUnwrappedForDiff } = unwrapModuleContent(existingFile.source || '');

            const diffContent = createTwoFilesPatch(
              `${filename} (expected)`,
              `${filename} (current remote)`,
              '',
              remoteUnwrappedForDiff,
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
                sizeChange: `${remoteUnwrappedForDiff.length} bytes (unwrapped)`
              },
              diff: {
                format: 'unified',
                content: diffContent.length > 5000
                  ? diffContent.slice(0, 5000) + '\n... (truncated)'
                  : diffContent,
                linesAdded,
                linesRemoved,
                truncated: diffContent.length > 5000,
                truncatedMessage: diffContent.length > 5000
                  ? `Diff truncated (showing first 5000 of ${diffContent.length} chars)`
                  : undefined
              }
            };

            throw new ConflictError(conflict);
          }
        }
        // === END HASH-BASED CONFLICT DETECTION ===

        const newFile = {
          name: filename,
          type: fileType as any,
          source: finalContent
        };

        const updatedFiles = existingFile
          ? currentFiles.map((f: any) => f.name === filename ? newFile : f)
          : [...currentFiles, newFile];

        const remoteResult = await this.gasClient.updateProjectContent(scriptId, updatedFiles, accessToken);
        const updatedFile = remoteResult.find((f: any) => f.name === filename);

        // ✅ Fetch authoritative remote updateTime (with fallback to metadata)
        const authoritativeUpdateTime = await this.fetchRemoteUpdateTime(
          scriptId,
          filename,
          updatedFile,
          accessToken
        );

        // ✅ Verify local file matches what we sent to remote
        const { readFile: fsReadFile } = await import('fs/promises');
        const currentLocalContent = await fsReadFile(filePath, 'utf-8');

        if (currentLocalContent !== finalContent) {
          console.error(`⚠️ [SYNC] Local file changed after hooks - re-writing with remote content`);
          console.error(`   Expected: ${finalContent.length} bytes`);
          console.error(`   Found: ${currentLocalContent.length} bytes`);

          // Re-write with the content that's on the server
          const { writeFile: fsWriteFile } = await import('fs/promises');
          await fsWriteFile(filePath, finalContent, 'utf-8');
        }

        // ✅ Now set mtime to match remote (local file verified to match)
        if (authoritativeUpdateTime) {
          await setFileMtimeToRemote(filePath, authoritativeUpdateTime, fileType);
          console.error(`⏰ [SYNC] Set mtime after verifying local matches remote: ${authoritativeUpdateTime}`);
        } else {
          console.error(`⚠️ [SYNC] No remote updateTime available, leaving mtime as NOW`);
        }

        // Compute hash of written content on WRAPPED content (full file as stored in GAS)
        // This ensures hash matches `git hash-object <file>` on local synced files
        const writtenHash = computeGitSha1(finalContent);

        // Update xattr cache with new hash for future conflict detection
        try {
          await updateCachedContentHash(filePath, writtenHash);
          console.error(`🔒 [HASH] Updated xattr cache with hash: ${writtenHash.slice(0, 8)}...`);
        } catch (cacheError) {
          // Non-fatal: xattr not supported on filesystem
          console.error(`⚠️ [HASH] Could not cache hash: ${cacheError}`);
        }

        results.remoteFile = {
          scriptId,
          filename,
          type: fileType,
          size: finalContent.length,
          updated: true,
          updateTime: authoritativeUpdateTime
        };

        // Store written hash for response
        results.hash = writtenHash;

      } catch (remoteError: any) {
        // PHASE 3: Remote failed - unstage changes (simple cleanup, no commit to revert)
        log.error(`[WRITE] Remote write failed for ${filename} in project ${scriptId}, unstaging local changes: ${remoteError.message}`);

        try {
          const { spawn } = await import('child_process');

          // Check if repo has any commits (empty repo can't use reset HEAD)
          const hasCommits = await new Promise<boolean>((resolve) => {
            const check = spawn('git', ['rev-parse', '--verify', 'HEAD'], { cwd: projectPath });
            check.on('close', (code) => resolve(code === 0));
            check.on('error', () => resolve(false));
          });

          if (hasCommits) {
            // Normal case: unstage with reset HEAD
            await new Promise<void>((resolve, reject) => {
              const git = spawn('git', ['reset', 'HEAD', fullFilename], { cwd: projectPath });
              git.on('close', (code) => {
                if (code === 0) {
                  resolve();
                } else {
                  reject(new Error(`git reset failed with exit code ${code}`));
                }
              });
              git.on('error', reject);
            });
          } else {
            // Empty repo: use rm --cached instead
            await new Promise<void>((resolve, reject) => {
              const git = spawn('git', ['rm', '--cached', fullFilename], { cwd: projectPath });
              git.on('close', (code) => {
                if (code === 0) {
                  resolve();
                } else {
                  reject(new Error(`git rm --cached failed with exit code ${code}`));
                }
              });
              git.on('error', reject);
            });
          }
          log.info(`[WRITE] Unstaged ${fullFilename} after remote failure`);
        } catch (unstageError) {
          // Best effort - unstaging is not critical but log the actual error
          log.warn(`[WRITE] Could not unstage ${fullFilename}: ${unstageError}`);
        }

        // Re-throw ConflictError as-is (don't wrap it)
        if (remoteError instanceof ConflictError) {
          throw remoteError;
        }
        throw new Error(`Remote write failed for ${filename} in project ${scriptId} - local changes unstaged: ${remoteError.message}`);
      }
    }

    // Check for git association hints AND detect local git (single API call)
    const accessToken = await this.getAuthToken(params);
    const { gitHints, gitDetection } = await this.detectGitInfoAndBreadcrumb(scriptId, accessToken);

    // Build git uncommitted status for hints
    const uncommittedStatus = await getUncommittedStatus(projectPath);
    const gitHint = await buildGitHint(scriptId, projectPath, uncommittedStatus, filename);

    // Analyze content for warnings and hints based on file type
    let contentAnalysis: { warnings: string[]; hints: string[] } | undefined;
    const detectedFileType = determineFileTypeUtil(filename, finalContent);
    if (detectedFileType === 'HTML') {
      contentAnalysis = analyzeHtmlContent(finalContent);
    } else if (detectedFileType === 'SERVER_JS') {
      contentAnalysis = analyzeCommonJsContent(finalContent, params.moduleOptions, filename);
    } else if (detectedFileType === 'JSON' && filename.toLowerCase() === 'appsscript') {
      contentAnalysis = analyzeManifestContent(finalContent);
    }

    // Build result with local and git hints
    const result: any = {
      success: true,
      path: `${scriptId}/${filename}`,
      size: finalContent.length,
      hash: results.hash  // Git SHA-1 of written content (WRAPPED) for future conflict detection
    };

    // Add content-specific warnings and hints (before other metadata)
    if (contentAnalysis) {
      if (contentAnalysis.warnings.length > 0) {
        result.warnings = contentAnalysis.warnings;
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

    // Add comprehensive git hints (merge detection, branch info, and uncommitted status)
    result.git = {
      ...(gitHints || {}),
      ...(gitDetection || {}),
      // Branch info (no branchCreated - we don't auto-create branches)
      branch: currentBranch,
      // Uncommitted status and hints
      uncommittedChanges: gitHint.uncommittedChanges,
      recommendation: gitHint.recommendation,
      taskCompletionBlocked: gitHint.taskCompletionBlocked
    };

    // Add workflow completion hint with rsync suggestion
    result.nextAction = {
      hint: `File written. Commit when ready: git_feature({ operation: 'commit', scriptId, message: '...' })`,
      required: gitHint.taskCompletionBlocked || false,
      rsync: `local_sync({ scriptId: "${scriptId}", operation: "plan", direction: "pull" })`
    };

    // Add git breadcrumb hint for .git/* files
    const gitBreadcrumbHint = getGitBreadcrumbWriteHint(filename);
    if (gitBreadcrumbHint) {
      result.gitBreadcrumbHint = gitBreadcrumbHint;
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
   * NOTE: Callers should pass fresh metadata from getProjectMetadata() to ensure
   * atomic consistency with subsequent checkSyncOrThrow() calls
   */
  private async pullRemoteFileIfNeeded(
    projectName: string,
    filename: string,
    remoteFiles: any[],
    workingDir: string
  ): Promise<boolean> {
    const { LocalFileManager } = await import('../../utils/localFileManager.js');

    // Check if file exists in remote
    const remoteFile = remoteFiles.find((f: any) => f.name === filename);
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

    // Set mtime to match remote for proper sync tracking
    const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
    const fullFilename = filename + fileExtension;
    const projectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
    const localFilePath = join(projectPath, fullFilename);

    if (remoteFile.updateTime) {
      await setFileMtimeToRemote(localFilePath, remoteFile.updateTime, remoteFile.type);
    }

    console.error(`✅ [AUTO-PULL] Successfully pulled ${filename} to local cache`);
    return true;
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
      const fileMetadata = metadata.find((f: any) => f.name === filename);

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
