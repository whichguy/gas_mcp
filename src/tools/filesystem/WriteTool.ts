import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath, matchesDirectory, getDirectory, getBaseName, joinPath, isWildcardPattern, matchesPattern, resolveHybridScriptId } from '../../api/pathParser.js';
import { ValidationError, FileOperationError } from '../../errors/mcpErrors.js';
import { unwrapModuleContent, shouldWrapContent, wrapModuleContent, getModuleName, analyzeCommonJsUsage, detectAndCleanContent, extractDefineModuleOptionsWithDebug } from '../../utils/moduleWrapper.js';
import { translatePathForOperation } from '../../utils/virtualFileTranslation.js';
import { setFileMtimeToRemote, checkSyncOrThrow } from '../../utils/fileHelpers.js';
import { shouldAutoSync } from '../../utils/syncDecisions.js';
import { validateAndParseFilePath } from '../../utils/filePathProcessor.js';
import { writeLocalAndValidateWithHooks, revertGitCommit } from '../../utils/hookIntegration.js';
import { join, dirname } from 'path';
import { mkdir } from 'fs/promises';
import { SCRIPT_ID_SCHEMA, PATH_SCHEMA, WORKING_DIR_SCHEMA, ACCESS_TOKEN_SCHEMA, FILE_TYPE_SCHEMA, MODULE_OPTIONS_SCHEMA, CONTENT_SCHEMA } from './shared/schemas.js';
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
      }
    },
    required: ['scriptId', 'path', 'content'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Normal file write with auto CommonJS wrapping. Use edit/aider for small changes (95%+ token savings).',
      alternatives: 'edit: exact text match, aider: fuzzy match, raw_write: no CommonJS processing',
      commonJs: 'Auto-wraps SERVER_JS with require(), module, exports. Never manually add _main() or __defineModule__.',
      moduleOptions: 'loadNow: true=eager startup, false=lazy on require(). hoistedFunctions: [{name,params}] for Sheets autocomplete.',
      gitHooks: '.git exists → local write+hooks → remote sync (atomic rollback on failure). No git → remote-first.',
      examples: ['Basic: {path:"utils",content:"function add(a,b){return a+b}"}', 'Module: {path:"calc",content:"module.exports={add,multiply}"}', 'WebApp: {path:"doGet",content:"...",moduleOptions:{loadNow:true}}']
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
        const hasCommonJS = existingFiles.some((f: any) => f.name === 'common-js/require');

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
        resolvedOptions = {
          loadNow: params.moduleOptions!.loadNow,
          hoistedFunctions
        };
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

    // Opportunistic git detection - choose workflow based on git availability
    const gitStatus = await LocalFileManager.ensureProjectGitRepo(projectName, workingDir);

    if (gitStatus.gitInitialized && !remoteOnly) {
      // Git available → use atomic hook validation workflow
      return await this.executeWithHookValidation(
        params,
        scriptId,
        filename,
        content,
        projectName,
        workingDir,
        localOnly,
        remoteOnly,
        commonJsProcessing
      );
    }

    // No git or remoteOnly → use legacy remote-first workflow
    const accessToken = await this.getAuthToken(params);

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

    // Read current local content for comparison
    let previousLocalContent: string | null = null;
    try {
      previousLocalContent = await LocalFileManager.readFileFromProject(projectName, filename, workingDir);
    } catch (error: any) {
      // No existing local file
    }

    // Remote-first workflow: Push to remote FIRST
    let results: any = {};

    if (!localOnly) {
      // Mtime-based write-protection check
      try {
        const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
        const fullFilename = filename + fileExtension;
        const projectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
        const localFilePath = join(projectPath, fullFilename);

        const remoteFilesWithMeta = await this.gasClient.getProjectMetadata(scriptId, accessToken);
        await checkSyncOrThrow(localFilePath, filename, remoteFilesWithMeta);
      } catch (syncError: any) {
        // Re-throw sync errors (from checkSyncOrThrow)
        if (syncError.message &&
            (syncError.message.includes('out of sync') ||
             syncError.message.includes('exists in GAS but not locally'))) {
          throw syncError;
        }
        // Ignore other errors (e.g., network issues during metadata fetch)
      }

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

        results.remoteFile = {
          scriptId,
          filename,
          type: fileType,
          size: content.length,
          updated: true,
          updateTime: updatedFile?.updateTime
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

        // Set mtime to match remote updateTime
        if (results.remoteFile?.updateTime) {
          try {
            await setFileMtimeToRemote(filePath, results.remoteFile.updateTime, results.remoteFile.type);
          } catch (mtimeError) {
            // Non-fatal error
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

    // Check for git association hints
    let gitHints: any = undefined;
    try {
      const allFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
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
    }

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

    // Add git hints if available
    if (gitHints) {
      result.git = gitHints;
    }

    return result;
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
    commonJsProcessing: any
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

    // PHASE 0: Verify sync with remote (before local write)
    if (!localOnly) {
      const accessToken = await this.getAuthToken(params);
      const remoteFiles = await this.gasClient.getProjectMetadata(scriptId, accessToken);
      await checkSyncOrThrow(filePath, filename, remoteFiles);
    }

    // PHASE 1: Local validation with hooks
    const hookResult = await writeLocalAndValidateWithHooks(
      content,
      filePath,
      filename,
      projectName,
      workingDir
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

        // Set mtime to match remote
        if (updatedFile?.updateTime) {
          try {
            await setFileMtimeToRemote(filePath, updatedFile.updateTime, fileType);
          } catch (mtimeError) {
            // Non-fatal error
          }
        }

        results.remoteFile = {
          scriptId,
          filename,
          type: fileType,
          size: finalContent.length,
          updated: true,
          updateTime: updatedFile?.updateTime
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

    // Check for git association hints
    let gitHints: any = undefined;
    try {
      const allFiles = await this.gasClient.getProjectContent(scriptId, await this.getAuthToken(params));
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
    }

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

    // Add git hints if available
    if (gitHints) {
      result.git = gitHints;
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
}
