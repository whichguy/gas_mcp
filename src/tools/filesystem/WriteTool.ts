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
  public description = 'Write file contents to Google Apps Script project. Automatically wraps user code with CommonJS module system (require, module, exports). Opportunistically uses git hook validation when available (atomic with full rollback), otherwise falls back to remote-first workflow.';

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
      whenToUse: 'Use for normal file writing with explicit scriptId parameter. Automatically uses atomic hook validation when git is available, otherwise falls back to remote-first workflow.',
      workflow: 'Use with explicit scriptId: write({scriptId: "abc123...", path: "filename", content: "..."}). Git hook validation is automatic - no flags needed.',
      alternatives: 'Use raw_write when you need single-destination writes or advanced file positioning',
      scriptTypeCompatibility: {
        standalone: '✅ Full Support - Works identically',
        containerBound: '✅ Full Support - Works identically',
        notes: 'File writing works universally for both script types. Automatically wraps user code with CommonJS module system.'
      },
      limitations: {
        fileTypes: 'Only writes SERVER_JS (.gs), HTML (.html), and JSON (appsscript.json manifest only) files',
        moduleWrapping: 'Automatically wraps user code with CommonJS _main() for SERVER_JS - use raw_write for files that need exact content',
        gitHookDependency: 'Git hook validation only works if .git/ directory exists - otherwise falls back to remote-first workflow',
        preservationOverhead: 'Omitting moduleOptions triggers ~200-500ms API call to preserve existing loadNow setting'
      },
      gitIntegration: 'When git repository exists: (1) Writes locally and runs git commit with hooks, (2) If hooks pass, syncs to remote, (3) If remote fails, reverts git commit. Without git: writes to remote first, then syncs locally.',
      commonJsIntegration: 'All SERVER_JS files are automatically integrated with the CommonJS module system (see CommonJS.js). This provides: (1) require() function for importing other modules, (2) module object for module metadata and exports, (3) exports object as shorthand for module.exports. Users write plain JavaScript - the module wrapper is transparent.',
      moduleAccess: 'Code can use require("ModuleName") to import other user modules, module.exports = {...} to export functionality, and exports.func = ... as shorthand. The CommonJS system handles all module loading, caching, and dependency resolution.',
      wrapperHandling: 'Any accidentally included _main() or __defineModule__ calls are automatically cleaned and replaced with proper CommonJS structure. Never manually add module wrappers.',
      systemFiles: 'System files (CommonJS, __mcp_gas_run, appsscript) are never wrapped and provide the underlying infrastructure.',
      examples: [
        'Write JS module: write({scriptId: "1abc2def...", path: "utils", content: "function helper() {...}"})',
        'Write with exports: write({scriptId: "1abc2def...", path: "api/client", content: "module.exports = {...}"})',
        'Write HTML: write({scriptId: "1abc2def...", path: "sidebar", content: "<html>...", fileType: "HTML"})',
        'Write config: write({scriptId: "1abc2def...", path: "appsscript", content: "{...}", fileType: "JSON"})',
        'Local only: write({scriptId: "1abc2def...", path: "test", content: "...", localOnly: true})',
        'Web app handler: write({scriptId: "1abc2def...", path: "WebApp", content: "function doGet(e) { return HtmlService.createHtmlOutput(\'Hello\'); }", moduleOptions: {loadNow: true}})',
        'Trigger function: write({scriptId: "1abc2def...", path: "Triggers", content: "function onOpen() { SpreadsheetApp.getUi().createMenu(\'Menu\').addToUi(); }", moduleOptions: {loadNow: true}})',
        'Utility module: write({scriptId: "1abc2def...", path: "Utils", content: "function formatDate(date) { return Utilities.formatDate(date, \'GMT\', \'yyyy-MM-dd\'); }", moduleOptions: {loadNow: false}})',
        'Preserve existing: write({scriptId: "1abc2def...", path: "existing", content: "..."}) // Omit moduleOptions to preserve current loadNow and hoistedFunctions',
        'Add hoisted function: write({scriptId: "1abc2def...", path: "SheetFuncs", content: "function ask(p,r){...}", moduleOptions: {hoistedFunctions: [{name: "ASK_CLAUDE", params: ["prompt","range"]}]}})',
        'Remove hoisted functions: write({scriptId: "1abc2def...", path: "SheetFuncs", content: "...", moduleOptions: {hoistedFunctions: []}}) // Empty array removes all bridges'
      ],
      hoistedFunctionLifecycle: {
        preservation: 'When moduleOptions is omitted, existing hoistedFunctions are preserved along with loadNow setting',
        replacement: 'When moduleOptions.hoistedFunctions is provided with functions, replaces existing hoisted functions',
        removal: 'When moduleOptions.hoistedFunctions is empty array [], removes all hoisted function bridges',
        noCruft: 'Old hoisted functions are automatically cleaned up when replaced or removed - no orphaned bridges remain'
      }
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

    // CommonJS integration - process content for module system
    let processedContent = originalContent;
    let commonJsProcessing: any = {};
    let preservationDebug: any = null;
    const fileType = params.fileType || this.determineFileType(filename, originalContent);

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
        systemNote: 'require(), module, and exports are provided by the CommonJS module system (see CommonJS.js)',
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
        if (syncError.message && syncError.message.includes('out of sync')) {
          throw syncError;
        }
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
            await setFileMtimeToRemote(filePath, results.remoteFile.updateTime);
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

    // Return token-efficient results
    return {
      success: true,
      path: `${scriptId}/${filename}`,
      size: content.length
    };
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
            await setFileMtimeToRemote(filePath, updatedFile.updateTime);
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

    return {
      success: true,
      path: `${scriptId}/${filename}`,
      size: finalContent.length
    };
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
