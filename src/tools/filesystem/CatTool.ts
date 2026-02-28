/**
 * @fileoverview GAS File Read Tool with CommonJS unwrapping
 *
 * FLOW: remote/local fetch → unwrap(CommonJS) → return clean content + hash
 * HASH: Computed on WRAPPED content (before unwrap) for expectedHash compatibility
 * CONTENT: Returns UNWRAPPED user code for editing
 * FAST PATH: local cache (~5ms) vs remote API (~800ms) when preferLocal=true
 */
import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath, matchesDirectory, getDirectory, getBaseName, joinPath, isWildcardPattern, matchesPattern, resolveHybridScriptId, fileNameMatches } from '../../api/pathParser.js';
import { ValidationError, FileOperationError } from '../../errors/mcpErrors.js';
import { unwrapModuleContent, shouldWrapContent, type ModuleOptions } from '../../utils/moduleWrapper.js';
import { analyzeContent } from '../../utils/contentAnalyzer.js';
import { translatePathForOperation } from '../../utils/virtualFileTranslation.js';
import { computeGitSha1 } from '../../utils/hashUtils.js';
import { join, dirname } from 'path';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { expandAndValidateLocalPath } from '../../utils/pathExpansion.js';
import { shouldAutoSync } from '../../utils/syncDecisions.js';
import { validateAndParseFilePath } from '../../utils/filePathProcessor.js';
import { SCRIPT_ID_SCHEMA, PATH_SCHEMA, WORKING_DIR_SCHEMA, ACCESS_TOKEN_SCHEMA, PREFER_LOCAL_SCHEMA } from './shared/schemas.js';
import { getGitBreadcrumbHint } from '../../utils/gitBreadcrumbHints.js';
import { generateReadHints } from '../../utils/responseHints.js';
import type { CatParams, FileResult } from './shared/types.js';

/**
 * Read file contents with smart local/remote fallback (RECOMMENDED)
 *
 * ✅ RECOMMENDED - Use for normal development workflow
 * Automatically reads from local ./src/ if current project is set, otherwise reads from remote
 */
export class CatTool extends BaseFileSystemTool {
  public name = 'cat';
  public description = '[FILE:READ] Read file content with automatic CommonJS unwrapping — returns clean user code. WHEN: reading any file to view or prepare for editing. AVOID: use raw:true to see full CommonJS _main() wrappers; use edit for modifications. Example: cat({scriptId, path: "Utils.gs"})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      content: { type: 'string', description: 'File content (unwrapped from CommonJS)' },
      path: { type: 'string', description: 'Resolved file path' },
      type: { type: 'string', enum: ['server_js', 'html', 'json'], description: 'GAS file type' },
      moduleOptions: { type: 'object', description: 'CommonJS module options (loadNow, hoistedFunctions, etc.)' },
      size: { type: 'number', description: 'Content size in bytes' },
      warnings: { type: 'array', items: { type: 'string' }, description: 'Critical issues detected in file content (e.g., __global__ or __events__ without loadNow: true)' },
      analysisHints: { type: 'array', items: { type: 'string' }, description: 'Suggestions for improvement detected in file content (e.g., loadNow ordering, ConfigManager usage)' }
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
      toLocal: {
        type: 'string',
        description: 'Write content to this local file. Creates parent dirs. Supports ~ expansion (e.g., ~/backup/file.js).',
        examples: ['~/backup/utils.js', '/tmp/download.js', '~/gas-repos/backup/Code.js']
      },
      workingDir: {
        ...WORKING_DIR_SCHEMA
      },
      raw: {
        type: 'boolean',
        description: 'When true, returns file content including CommonJS _main() wrappers without unwrapping. Use for inspecting module infrastructure, debugging loadNow settings, or when hash must match git hash-object. Former raw_cat behavior.',
        default: false
      },
      accessToken: {
        ...ACCESS_TOKEN_SCHEMA
      }
    },
    required: ['scriptId', 'path'],
    additionalProperties: false,
    llmGuidance: {
      localFileSupport: 'toLocal:"~/backup/utils.js" → creates parent dirs, returns savedTo',
      efficientAlternatives: 'ripgrep|grep→search; edit→small changes; aider→fuzzy; sed→pattern. Use cat for full understanding|major refactor.',
      limitations: 'SERVER_JS|HTML|JSON only; auto-unwraps _main()→raw:true to see wrappers; preferLocal:false forces remote',
      antiPatterns: 'cat→edit→cat→edit (use single edit) | cat to search (use ripgrep) | cat then regex (use grep)'
    }
  };

  public annotations = {
    title: 'Read File (Smart)',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
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

    // =====================================================================
    // LOCAL GIT READ PATH (preferLocal=true, file exists in local git repo)
    // Precondition: file must exist in ~/gas-repos/project-{scriptId}/.
    // Returns instantly without any GAS API call on cache hit.
    // =====================================================================
    if (preferLocal) {
      try {
        const localContent = await LocalFileManager.readFileFromProject(projectName, filename, workingDir);
        if (localContent !== null && localContent !== undefined) {
          // Infer fileType from filename extension — avoids an API call
          const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
          const fileType = fileExtension === '.html' ? 'HTML' : fileExtension === '.json' ? 'JSON' : 'SERVER_JS';

          let result: any = {
            path: fullPath,
            scriptId,
            filename,
            content: localContent,
            source: 'local',
            fileType,
            fileExtension,
            gitRepository: {
              initialized: gitStatus.gitInitialized,
              path: gitStatus.repoPath,
              isNewRepo: gitStatus.isNewRepo
            }
          };

          // CommonJS integration - unwrap for editing (skip in raw mode)
          let finalContent = result.content;
          let commonJsInfo: any = null;
          let existingModuleOptions: ModuleOptions | null = null;

          if (!params.raw && shouldWrapContent(fileType, filename)) {
            const { unwrappedContent, existingOptions } = unwrapModuleContent(finalContent);
            existingModuleOptions = existingOptions;

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
              commonJsInfo = { moduleUnwrapped: false, reason: 'No CommonJS wrapper structure found in content' };
            }
          } else if (!params.raw) {
            commonJsInfo = { moduleUnwrapped: false, reason: `${fileType} files don't use the CommonJS module system` };
          }

          result.content = finalContent;
          if (!params.raw) {
            result.commonJsInfo = commonJsInfo;
            const contentAnalysis = analyzeContent(filename, finalContent, existingModuleOptions ?? undefined);
            if (existingModuleOptions) { result.moduleOptions = existingModuleOptions; }
            if (contentAnalysis.warnings.length > 0) { result.warnings = contentAnalysis.warnings; }
            if (contentAnalysis.hints.length > 0) { result.analysisHints = contentAnalysis.hints; }
          }

          // Hash computed on wrapped content (matches git hash-object on local file)
          result.hash = computeGitSha1(localContent);
          if (params.raw) {
            result.hashNote = 'Hash computed on raw content including CommonJS wrappers (raw mode). Matches git hash-object value.';
          }

          const gitHint = getGitBreadcrumbHint(filename);
          if (gitHint) { result.gitBreadcrumbHint = gitHint; }

          if (params.toLocal) {
            const localPath = expandAndValidateLocalPath(params.toLocal);
            await mkdir(dirname(localPath), { recursive: true });
            await writeFile(localPath, result.content, 'utf-8');
            result.savedTo = localPath;
          }

          result.hints = generateReadHints(filename, result.moduleOptions);

          if (gitStatus.repoPath) {
            try {
              const { buildReadHint } = await import('../../utils/gitStatus.js');
              result.git = await buildReadHint(gitStatus.repoPath);
            } catch { /* non-fatal */ }
          }

          return result;
        }
      } catch {
        // Cache miss: local file not readable — fall through to full GET path
      }
    }

    // =====================================================================
    // FULL GET PATH (cache miss or preferLocal=false forces remote fetch)
    // Cache miss: file absent from local git repo, or preferLocal=false.
    // Full GET fetches all project files from GAS API, then writes to local git.
    // =====================================================================
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

    const remoteFile = remoteFiles.find((file: any) => fileNameMatches(file.name, filename));

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

    // Write remote content to local git repo (makes future local reads possible)
    const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
    const fullFilename = filename + fileExtension;
    const projectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
    const localFilePath = join(projectPath, fullFilename);
    const remoteContent = remoteFile.source || remoteFile.content || '';
    await mkdir(dirname(localFilePath), { recursive: true });
    await writeFile(localFilePath, remoteContent, 'utf-8');

    let result: any;
    let source: 'local' | 'remote' = 'remote';

    if (preferLocal) {
      try {
        const localContent = await LocalFileManager.readFileFromProject(projectName, filename, workingDir);
        if (localContent) {
          result = {
            path: fullPath,
            scriptId,
            filename,
            content: localContent,
            source: 'local',
            fileExtension,
            syncStatus: syncStatus ? { inSync: syncStatus.inSync, differences: syncStatus.differences, message: syncStatus.summary } : null,
            gitRepository: { initialized: gitStatus.gitInitialized, path: gitStatus.repoPath, isNewRepo: gitStatus.isNewRepo }
          };
          source = 'local';
        }
      } catch (localError: any) {
        // Fall back to remote
      }
    }

    if (!result || source !== 'local') {
      result = {
        path: fullPath,
        scriptId,
        filename,
        content: remoteContent,
        source: 'remote',
        fileType: remoteFile.type,
        fileExtension,
        syncStatus: syncStatus ? { inSync: syncStatus.inSync, differences: syncStatus.differences, message: syncStatus.summary } : null,
        gitRepository: { initialized: gitStatus.gitInitialized, path: gitStatus.repoPath, isNewRepo: gitStatus.isNewRepo }
      };
    }

    // CommonJS integration - unwrap for editing (skip in raw mode)
    // rawContent is WRAPPED content — used for hash computation to match git hash-object
    const rawContent = result.content;
    let finalContent = result.content;
    let commonJsInfo: any = null;
    let existingModuleOptions: ModuleOptions | null = null;

    if (!params.raw && shouldWrapContent(result.fileType || 'SERVER_JS', filename)) {
      const { unwrappedContent, existingOptions } = unwrapModuleContent(finalContent);
      existingModuleOptions = existingOptions;

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
        commonJsInfo = { moduleUnwrapped: false, reason: 'No CommonJS wrapper structure found in content' };
      }
    } else if (!params.raw) {
      commonJsInfo = { moduleUnwrapped: false, reason: `${result.fileType || 'unknown'} files don't use the CommonJS module system` };
    }

    result.content = finalContent;
    if (!params.raw) {
      result.commonJsInfo = commonJsInfo;

      const contentAnalysis = analyzeContent(filename, finalContent, existingModuleOptions ?? undefined);

      if (existingModuleOptions) { result.moduleOptions = existingModuleOptions; }
      if (contentAnalysis.warnings.length > 0) { result.warnings = contentAnalysis.warnings; }
      if (contentAnalysis.hints.length > 0) { result.analysisHints = contentAnalysis.hints; }
    }

    // Hash on WRAPPED content — matches git hash-object on local synced files
    const contentHash = computeGitSha1(rawContent);
    result.hash = contentHash;

    if (params.raw) {
      result.hashNote = 'Hash computed on raw content including CommonJS wrappers (raw mode). Matches git hash-object value.';
    }

    const gitHint = getGitBreadcrumbHint(filename);
    if (gitHint) { result.gitBreadcrumbHint = gitHint; }

    if (params.toLocal) {
      const localPath = expandAndValidateLocalPath(params.toLocal);
      await mkdir(dirname(localPath), { recursive: true });
      await writeFile(localPath, result.content, 'utf-8');
      result.savedTo = localPath;
    }

    result.hints = generateReadHints(filename, result.moduleOptions);

    if (gitStatus.repoPath) {
      try {
        const { buildReadHint } = await import('../../utils/gitStatus.js');
        result.git = await buildReadHint(gitStatus.repoPath);
      } catch { /* non-fatal */ }
    }

    return result;
  }
}
