import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath, matchesDirectory, getDirectory, getBaseName, joinPath, isWildcardPattern, matchesPattern, resolveHybridScriptId } from '../../api/pathParser.js';
import { ValidationError, FileOperationError } from '../../errors/mcpErrors.js';
import { unwrapModuleContent, shouldWrapContent, wrapModuleContent, getModuleName, analyzeCommonJsUsage, detectAndCleanContent, extractDefineModuleOptionsWithDebug } from '../../utils/moduleWrapper.js';
import { translatePathForOperation } from '../../utils/virtualFileTranslation.js';
import { setFileMtimeToRemote, checkSyncOrThrow } from '../../utils/fileHelpers.js';
import { processHoistedAnnotations } from '../../utils/hoistedFunctionGenerator.js';
import { shouldAutoSync } from '../../utils/syncDecisions.js';
import { validateAndParseFilePath } from '../../utils/filePathProcessor.js';
import { writeLocalAndValidateWithHooks, revertGitCommit } from '../../utils/hookIntegration.js';
import { detectLocalGit, checkBreadcrumbExists, buildRecommendation, type GitHints, type GitDetection } from '../../utils/localGitDetection.js';
import { log } from '../../utils/logger.js';
import { join, dirname } from 'path';
import { mkdir, stat } from 'fs/promises';
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
  public description = 'Write file contents to Google Apps Script project. Automatically wraps user code with CommonJS module system (require, module, exports). Supports .git hooks for validation: writes locally first, runs hooks, then syncs validated content to remote (atomic with full rollback on failure). Falls back to remote-first workflow when git not available.';

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
        ...CONTENT_SCHEMA
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
    required: ['scriptId', 'path', 'content'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Normal file write with auto CommonJS wrapping. Use edit/aider for small changes (95%+ token savings).',
      alternatives: 'edit: exact text match, aider: fuzzy match, raw_write: no CommonJS processing',
      commonJs: 'Auto-wraps SERVER_JS with require(), module, exports. Never manually add _main() or __defineModule__.',
      moduleOptions: {
        loadNow: 'true=eager startup, false=lazy on require()',
        eventHandlerPattern: 'If code contains module.exports.__events__, MUST include moduleOptions: { loadNow: true }',
        troubleshooting: 'Log "[WARN] No X handlers found" means missing loadNow: true',
        hoistedFunctions: '[{name,params,jsdoc}] for Sheets autocomplete'
      },
      gitHooks: '.git exists → local write+hooks → remote sync (atomic rollback on failure). No git → remote-first.',
      force: '⚠️ DANGEROUS: Skips sync validation. Use only when intentionally discarding remote changes.',
      examples: [
        'Basic: {path:"utils",content:"function add(a,b){return a+b}"}',
        'Module: {path:"calc",content:"module.exports={add,multiply}"}',
        'Event: {path:"Menu",content:"module.exports.__events__={onOpen:\\"onOpen\\"}",moduleOptions:{loadNow:true}}',
        'Force: {path:"Code",content:"...",force:true}  // ⚠️ Overwrites remote even if out of sync'
      ]
    }
  };

  async execute(params: WriteParams): Promise<WriteResult> {
    const { LocalFileManager } = await import('../../utils/localFileManager.js');
    const workingDir = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    const localOnly = params.localOnly || false;
    const remoteOnly = params.remoteOnly || false;

    if (localOnly && remoteOnly) {
      throw new ValidationError('localOnly/remoteOnly', 'both true', 'only one can be true');
    }

    const { scriptId, filename, projectName, fullPath } = validateAndParseFilePath(
      params,
      this.validate.filePath.bind(this.validate),
      'file writing'
    );
    const originalContent = params.content;

    // Auto-initialize CommonJS infrastructure if needed
    const fileType = params.fileType || this.determineFileType(filename, originalContent);
    if (!localOnly && shouldWrapContent(fileType, filename)) {
      try {
        const accessToken = await this.getAuthToken(params);
        const existingFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
        const hasCommonJS = existingFiles.some((f: any) => f.name === 'common-js/require.gs');

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
    } else {
      commonJsProcessing = {
        wrapperApplied: false,
        reason: `${fileType} files don't use the CommonJS module system`
      };
    }

    const content = processedContent;

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

    if (!localOnly) {
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
        const fileType = existingFile?.type || this.determineFileType(filename, content);

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

        results.remoteFile = {
          scriptId,
          filename,
          type: fileType,
          size: content.length,
          updated: true,
          updateTime: authoritativeUpdateTime,
          originalLocalMtime: originalLocalMtime?.toISOString()
        };

      } catch (remoteError: any) {
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

    // Auto-commit to git (only after remote success)
    let gitCommitResult: any = null;

    if (!remoteOnly && gitStatus.gitInitialized) {
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
          console.error(`⏰ [SYNC] Set mtime after git write: ${authoritativeUpdateTime}`);
        } else {
          console.error(`⚠️ [SYNC] No remote updateTime available, leaving mtime as NOW`);
        }

        gitCommitResult = await LocalFileManager.autoCommitChanges(
          projectName,
          [filename],
          commitMessage,
          workingDir
        );
      } catch (commitError: any) {
        gitCommitResult = {
          committed: false,
          message: `Git commit failed: ${commitError.message}`
        };
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

    // Return token-efficient results with local and git hints
    const result: any = {
      success: true,
      path: `${scriptId}/${filename}`,
      size: content.length
    };

    // Add local file info if available
    if (results.localFile && results.localFile.path) {
      result.local = {
        path: results.localFile.path,
        exists: true
      };
    }

    // Add git hints if available (merge with detection results)
    if (gitHints || gitDetection) {
      result.git = {
        ...(gitHints || {}),
        ...(gitDetection || {})
      };
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
   * Execute write with atomic hook validation workflow
   * PHASE 1: Write local, run hooks, read post-hook content
   * PHASE 2: Push to remote
   * PHASE 3: If remote fails, revert git commit
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

    // PHASE 0: Ensure feature branch before committing
    const { ensureFeatureBranch } = await import('../../utils/gitAutoCommit.js');
    const branchResult = await ensureFeatureBranch(projectPath);

    log.info(
      `[WRITE] Feature branch: ${branchResult.branch}${branchResult.created ? ' (auto-created)' : ' (existing)'}`
    );

    // PHASE 1: Local validation with hooks
    const hookResult = await writeLocalAndValidateWithHooks(
      content,
      filePath,
      filename,
      projectName,
      workingDir,
      changeReason  // Pass custom commit message
    );

    if (!hookResult.success) {
      throw new Error(`Git hooks validation failed: ${hookResult.error}`);
    }

    const finalContent = hookResult.contentAfterHooks || content;

    // PHASE 2: Remote synchronization
    let results: any = {
      hookValidation: {
        success: true,
        hookModified: hookResult.hookModified,
        commitHash: hookResult.commitHash
      }
    };

    if (!localOnly) {
      try {
        const accessToken = await this.getAuthToken(params);

        const currentFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
        const existingFile = currentFiles.find((f: any) => f.name === filename);
        const fileType = existingFile?.type || this.determineFileType(filename, finalContent);

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

        results.remoteFile = {
          scriptId,
          filename,
          type: fileType,
          size: finalContent.length,
          updated: true,
          updateTime: authoritativeUpdateTime
        };

      } catch (remoteError: any) {
        // PHASE 3: Remote failed - revert git commit
        const revertResult = await revertGitCommit(
          projectPath,
          hookResult.commitHash!,
          filename
        );

        if (revertResult.success) {
          throw new Error(`Remote write failed after local validation - all changes reverted: ${remoteError.message}`);
        } else {
          throw new Error(
            `CRITICAL: Remote write failed AND commit revert failed.\n\n` +
            `Manual recovery required:\n` +
            `1. Navigate to: ${projectPath}\n` +
            `2. Check git status: git status\n` +
            `3. If conflicts exist: git revert --abort\n` +
            `4. To undo commit: git reset --hard HEAD~1 (WARNING: loses commit ${hookResult.commitHash})\n\n` +
            `Original error: ${remoteError.message}\n` +
            `Revert error: ${revertResult.error || 'unknown'}`
          );
        }
      }
    }

    // Check for git association hints AND detect local git (single API call)
    const accessToken = await this.getAuthToken(params);
    const { gitHints, gitDetection } = await this.detectGitInfoAndBreadcrumb(scriptId, accessToken);

    // Build result with local and git hints
    const result: any = {
      success: true,
      path: `${scriptId}/${filename}`,
      size: finalContent.length
    };

    // Add local file info
    result.local = {
      path: filePath,
      exists: true
    };

    // Add git hints if available (merge with detection results and branch info)
    if (gitHints || gitDetection || branchResult) {
      result.git = {
        ...(gitHints || {}),
        ...(gitDetection || {}),
        ...(branchResult ? {
          branch: branchResult.branch,
          branchCreated: branchResult.created,
          commitMessage: changeReason || (hookResult.previousContent !== null
            ? `Update ${filename}`
            : `Add ${filename}`)
        } : {})
      };
    }

    return result;
  }

  /**
   * Determine file type from filename and content
   */
  private determineFileType(filename: string, content: string): string {
    if (filename.toLowerCase() === 'appsscript') {
      return 'JSON';
    }

    const trimmed = content.trim();
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html>')) {
      return 'HTML';
    } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return 'JSON';
    } else {
      return 'SERVER_JS';
    }
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
