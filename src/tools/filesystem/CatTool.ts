import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath, matchesDirectory, getDirectory, getBaseName, joinPath, isWildcardPattern, matchesPattern, resolveHybridScriptId } from '../../api/pathParser.js';
import { ValidationError, FileOperationError } from '../../errors/mcpErrors.js';
import { unwrapModuleContent, shouldWrapContent } from '../../utils/moduleWrapper.js';
import { translatePathForOperation } from '../../utils/virtualFileTranslation.js';
import { setFileMtimeToRemote, isFileInSync } from '../../utils/fileHelpers.js';
import { join, dirname } from 'path';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { shouldAutoSync } from '../../utils/syncDecisions.js';
import { validateAndParseFilePath } from '../../utils/filePathProcessor.js';
import { SCRIPT_ID_SCHEMA, PATH_SCHEMA, WORKING_DIR_SCHEMA, ACCESS_TOKEN_SCHEMA, PREFER_LOCAL_SCHEMA } from './shared/schemas.js';
import type { CatParams, FileResult } from './shared/types.js';

/**
 * Read file contents with smart local/remote fallback (RECOMMENDED)
 *
 * ✅ RECOMMENDED - Use for normal development workflow
 * Automatically reads from local ./src/ if current project is set, otherwise reads from remote
 */
export class CatTool extends BaseFileSystemTool {
  public name = 'cat';
  public description = 'Read file contents from Google Apps Script project. Automatically unwraps CommonJS modules to show clean user code for editing. Like Unix cat but works with GAS projects and handles module processing.';

  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        ...SCRIPT_ID_SCHEMA
      },
      path: {
        ...PATH_SCHEMA,
        description: 'File path (filename only, or scriptId/filename if scriptId parameter is empty). For SERVER_JS files, CommonJS wrapper will be automatically removed to show clean user code for editing while preserving access to require(), module, and exports when executed.',
        pattern: '^([a-zA-Z0-9_-]{5,60}/[a-zA-Z0-9_.//-]+|[a-zA-Z0-9_.//-]+)$',
        examples: [
          'utils.gs',
          'models/User.gs',
          'abc123def456.../helpers.gs'
        ]
      },
      preferLocal: {
        ...PREFER_LOCAL_SCHEMA
      },
      workingDir: {
        ...WORKING_DIR_SCHEMA
      },
      accessToken: {
        ...ACCESS_TOKEN_SCHEMA
      }
    },
    required: ['scriptId', 'path'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Use for normal file reading. Automatically handles local/remote logic.',
      workflow: 'Use with explicit scriptId: cat({scriptId: "abc123...", path: "utils.gs"})',
      alternatives: 'Use raw_cat only when you need explicit project ID control',
      efficientAlternatives: {
        searching: 'Use ripgrep or grep for searching within files - much faster than reading entire files',
        editing: 'Use edit for token-efficient small changes, aider for fuzzy matching edits, or sed for pattern-based replacements',
        whenToUseCat: 'Use cat only when you need to read the complete file content for understanding or major refactoring'
      },
      scriptTypeCompatibility: {
        standalone: '✅ Full Support - Works identically',
        containerBound: '✅ Full Support - Works identically',
        notes: 'File reading works universally for both script types. Automatically unwraps CommonJS modules for clean editing.'
      },
      limitations: {
        fileTypes: 'Only reads SERVER_JS (.gs), HTML (.html), and JSON (appsscript.json manifest only) files',
        moduleWrapping: 'Automatically unwraps CommonJS _main() wrappers for editing - use raw_cat to see complete file with wrappers',
        localCacheDependency: 'Prefers local ./src/ cache when available - use preferLocal: false to force remote read'
      },
      pathRequirement: 'Provide scriptId parameter and simple filename in path, or embed scriptId in path and leave scriptId parameter empty.',
      commonJsIntegration: 'All SERVER_JS files are automatically integrated with the CommonJS module system (see CommonJS.js). When reading files, the outer _main() wrapper is removed to show clean user code for editing. The code still has access to require(), module, and exports when executed - these are provided by the CommonJS system.',
      moduleAccess: 'Your code can use require("ModuleName") to import other user modules, module.exports = {...} to export functionality, and exports.func = ... as shorthand. The CommonJS system handles all module loading, caching, and dependency resolution.',
      editingWorkflow: 'Files are unwrapped for editing convenience and will be automatically re-wrapped with CommonJS structure when saved via write.',
      examples: [
        'Read a module file: cat({scriptId: "1abc2def...", path: "Utils.gs"})',
        'Read with embedded ID: cat({scriptId: "", path: "1abc2def.../Calculator.gs"})',
        'Read HTML template: cat({scriptId: "1abc2def...", path: "sidebar.html"})',
        'Read manifest: cat({scriptId: "1abc2def...", path: "appsscript.json"})'
      ]
    }
  };

  async execute(params: CatParams): Promise<FileResult> {
    const { LocalFileManager } = await import('../../utils/localFileManager.js');
    const workingDir = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    const preferLocal = params.preferLocal !== false;

    const { scriptId, filename, projectName, fullPath } = validateAndParseFilePath(
      params,
      this.validate.filePath.bind(this.validate),
      'file reading'
    );

    // Ensure project has git repository
    const gitStatus = await LocalFileManager.ensureProjectGitRepo(projectName, workingDir);
    const accessToken = await this.getAuthToken(params);

    // Sync verification
    let syncStatus: any = null;
    let remoteFiles: any[] = [];

    try {
      remoteFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
      syncStatus = await LocalFileManager.verifySyncStatus(projectName, remoteFiles, workingDir);

      const autoSyncDecision = shouldAutoSync(syncStatus, remoteFiles.length);

      if (autoSyncDecision.pull) {
        const pullResult = await LocalFileManager.copyRemoteToLocal(projectName, remoteFiles, workingDir);

        if (gitStatus.gitInitialized && pullResult.filesWritten > 0) {
          await LocalFileManager.autoCommitChanges(
            projectName,
            pullResult.filesList,
            `Initial sync: pulled ${pullResult.filesWritten} files from remote`,
            workingDir
          );
        }

        syncStatus = await LocalFileManager.verifySyncStatus(projectName, remoteFiles, workingDir);
      }
    } catch (syncError: any) {
      // Continue with operation even if sync check fails
    }

    // mtime-based sync check
    const remoteFile = remoteFiles.find((file: any) => file.name === filename);

    if (!remoteFile) {
      const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
      const fullFilename = filename + fileExtension;
      const projectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
      const localFilePath = join(projectPath, fullFilename);

      try {
        await unlink(localFilePath);
      } catch (unlinkError) {
        // File doesn't exist locally either
      }

      throw new ValidationError('filename', filename, 'existing file in the project');
    }

    // Check if local file needs sync
    if (preferLocal && remoteFile.updateTime) {
      const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
      const fullFilename = filename + fileExtension;
      const projectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
      const localFilePath = join(projectPath, fullFilename);

      const inSync = await isFileInSync(localFilePath, remoteFile.updateTime);

      if (!inSync) {
        const content = remoteFile.source || remoteFile.content || '';
        await mkdir(dirname(localFilePath), { recursive: true });
        await writeFile(localFilePath, content, 'utf-8');
        await setFileMtimeToRemote(localFilePath, remoteFile.updateTime);
      }
    }

    let result: any;
    let source: 'local' | 'remote' = 'remote';

    if (preferLocal) {
      try {
        const localContent = await LocalFileManager.readFileFromProject(projectName, filename, workingDir);
        if (localContent) {
          result = {
            path: fullPath,
            scriptId: scriptId,
            filename,
            content: localContent,
            source: 'local',
            fileExtension: LocalFileManager.getFileExtensionFromName(filename),
            syncStatus: syncStatus ? {
              inSync: syncStatus.inSync,
              differences: syncStatus.differences,
              message: syncStatus.summary
            } : null,
            gitRepository: {
              initialized: gitStatus.gitInitialized,
              path: gitStatus.repoPath,
              isNewRepo: gitStatus.isNewRepo
            }
          };
          source = 'local';
        }
      } catch (localError: any) {
        // Fall back to remote
      }
    }

    // Read from remote if local failed or not preferred
    if (!result || source !== 'local') {
      result = {
        path: fullPath,
        scriptId: scriptId,
        filename,
        content: remoteFile.source || remoteFile.content || '',
        source: 'remote',
        fileType: remoteFile.type,
        fileExtension: LocalFileManager.getFileExtensionFromName(filename),
        syncStatus: syncStatus ? {
          inSync: syncStatus.inSync,
          differences: syncStatus.differences,
          message: syncStatus.summary
        } : null,
        gitRepository: {
          initialized: gitStatus.gitInitialized,
          path: gitStatus.repoPath,
          isNewRepo: gitStatus.isNewRepo
        }
      };
      source = 'remote';
    }

    // CommonJS integration - unwrap for editing
    let finalContent = result.content;
    let commonJsInfo: any = null;

    if (shouldWrapContent(result.fileType || 'SERVER_JS', filename)) {
      const { unwrappedContent } = unwrapModuleContent(finalContent);

      if (unwrappedContent !== finalContent) {
        finalContent = unwrappedContent;

        const { analyzeCommonJsUsage } = await import('../../utils/moduleWrapper.js');
        const featureAnalysis = analyzeCommonJsUsage(unwrappedContent);

        commonJsInfo = {
          moduleUnwrapped: true,
          originalLength: result.content.length,
          unwrappedLength: finalContent.length,
          commonJsFeatures: {
            hasRequireFunction: true,
            hasModuleObject: true,
            hasExportsObject: true,
            userRequireCalls: featureAnalysis.requireCalls,
            userModuleExports: featureAnalysis.moduleExports,
            userExportsUsage: featureAnalysis.exportsUsage
          },
          systemNote: 'When executed, this code has access to require(), module, and exports via the CommonJS system',
          editingNote: 'CommonJS wrapper removed for editing convenience - will be re-applied automatically on write'
        };
      } else {
        commonJsInfo = {
          moduleUnwrapped: false,
          reason: 'No CommonJS wrapper structure found in content'
        };
      }
    } else {
      commonJsInfo = {
        moduleUnwrapped: false,
        reason: `${result.fileType || 'unknown'} files don't use the CommonJS module system`
      };
    }

    result.content = finalContent;
    result.commonJsInfo = commonJsInfo;

    return result;
  }
}
