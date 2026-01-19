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
import { unwrapModuleContent, shouldWrapContent } from '../../utils/moduleWrapper.js';
import { translatePathForOperation } from '../../utils/virtualFileTranslation.js';
import { setFileMtimeToRemote, isFileInSync } from '../../utils/fileHelpers.js';
import { getCachedGASMetadata, cacheGASMetadata, updateCachedContentHash } from '../../utils/gasMetadataCache.js';
import { computeGitSha1 } from '../../utils/hashUtils.js';
import { join, dirname } from 'path';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { expandAndValidateLocalPath } from '../../utils/pathExpansion.js';
import { shouldAutoSync } from '../../utils/syncDecisions.js';
import { validateAndParseFilePath } from '../../utils/filePathProcessor.js';
import { SCRIPT_ID_SCHEMA, PATH_SCHEMA, WORKING_DIR_SCHEMA, ACCESS_TOKEN_SCHEMA, PREFER_LOCAL_SCHEMA } from './shared/schemas.js';
import { getGitBreadcrumbHint } from '../../utils/gitBreadcrumbHints.js';
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
      toLocal: {
        type: 'string',
        description: 'Write content to this local file. Creates parent dirs. Supports ~ expansion (e.g., ~/backup/file.js).',
        examples: ['~/backup/utils.js', '/tmp/download.js', '~/gas-repos/backup/Code.js']
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
      // LOCAL FILE EXPORT - Write content to local file
      localFileSupport: {
        toLocal: 'Save to local file: cat({scriptId, path:"utils.js", toLocal:"~/backup/utils.js"})',
        useCase: 'Backup, export for external tools, local editing, migration',
        behavior: 'Creates parent directories. Returns savedTo in response.'
      },
      unixLike: 'cat (read file) | GAS | CommonJS unwrap | prefers local cache',
      whenToUse: 'normal file read (auto local/remote)',
      workflow: 'cat({scriptId:"abc123...",path:"utils.gs"})',
      alternatives: 'raw_cat→explicit project ID control',
      efficientAlternatives: {searching: 'ripgrep|grep→faster than full file read', editing: 'edit→token-efficient small | aider→fuzzy match | sed→pattern replace', whenToUseCat: 'complete file content for understanding|major refactor'},
      scriptTypeCompatibility: {standalone: '✅ Full Support', containerBound: '✅ Full Support', notes: 'Universal→auto-unwraps CommonJS for clean edit'},
      limitations: {fileTypes: 'SERVER_JS (.gs)|HTML (.html)|JSON (appsscript.json only)', moduleWrapping: 'auto-unwraps _main()→raw_cat for complete+wrappers', localCacheDependency: 'prefers ./src/→preferLocal:false force remote'},
      pathRequirement: 'scriptId param+filename OR embed scriptId in path',
      commonJsIntegration: 'SERVER_JS auto-integrated (require.js)→_main() wrapper removed→clean code for edit (require()/module/exports available at exec)',
      moduleAccess: 'require("ModuleName")|module.exports={...}|exports.func=... (CommonJS handles loading+caching+deps)',
      editingWorkflow: 'unwrapped for edit→auto-rewrapped on write',
      examples: ['module: cat({scriptId:"1abc2def...",path:"Utils.gs"})', 'embedded: cat({scriptId:"",path:"1abc2def.../Calculator.gs"})', 'HTML: cat({scriptId:"1abc2def...",path:"sidebar.html"})', 'manifest: cat({scriptId:"1abc2def...",path:"appsscript.json"})'],
      antiPatterns: ['❌ cat→edit→cat→edit (wasteful) → use single edit with multiple ops', '❌ cat large file to search → use ripgrep instead', '❌ cat then regex parse → use grep/ripgrep with pattern']
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

    // Fast path optimization: Check if we can use local cache without API call
    if (preferLocal) {
      const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
      const fullFilename = filename + fileExtension;
      const projectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
      const localFilePath = join(projectPath, fullFilename);

      const cachedMeta = await getCachedGASMetadata(localFilePath);

      if (cachedMeta) {
        const inSync = await isFileInSync(localFilePath, cachedMeta.updateTime);

        if (inSync) {
          // Fast path: Return local content without API call
          try {
            const localContent = await LocalFileManager.readFileFromProject(projectName, filename, workingDir);

            if (localContent) {
              // Format result directly (skip expensive API call)
              let result: any = {
                path: fullPath,
                scriptId: scriptId,
                filename,
                content: localContent,
                source: 'local',
                fileType: cachedMeta.fileType,
                fileExtension,
                syncStatus: { inSync: true, differences: [], message: 'In sync (cached metadata)' },
                gitRepository: {
                  initialized: gitStatus.gitInitialized,
                  path: gitStatus.repoPath,
                  isNewRepo: gitStatus.isNewRepo
                }
              };

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

              // Compute hash on WRAPPED content (full file as stored in GAS)
              // This ensures hash matches `git hash-object <file>` on local synced files
              const contentHash = computeGitSha1(localContent);
              result.hash = contentHash;

              // Update cached hash if different from stored (or not stored)
              if (cachedMeta.contentHash !== contentHash) {
                await updateCachedContentHash(localFilePath, contentHash);
              }

              // Add git breadcrumb hint for .git/* files
              const gitHint = getGitBreadcrumbHint(filename);
              if (gitHint) {
                result.gitBreadcrumbHint = gitHint;
              }

              // Save to local file if requested
              if (params.toLocal) {
                const localPath = expandAndValidateLocalPath(params.toLocal);
                await mkdir(dirname(localPath), { recursive: true });
                await writeFile(localPath, result.content, 'utf-8');
                result.savedTo = localPath;
              }

              // Fast path success - return immediately without API call
              return result;
            }
          } catch (localError: any) {
            // Fall through to slow path with API call
          }
        }
      }
    }

    // Slow path: Need API call for sync verification
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

    // Always sync local file to match remote (regardless of preferLocal)
    // This ensures local cache stays up-to-date for write operations

    // Fetch updateTime - try from content API first, fall back to metadata API
    let updateTime = remoteFile.updateTime;

    if (!updateTime) {
      console.error(`⚠️ [SYNC] No updateTime from getProjectContent, fetching from metadata API...`);
      try {
        const metadata = await this.gasClient.getProjectMetadata(scriptId, accessToken);
        const fileMetadata = metadata.find((f: any) => fileNameMatches(f.name, filename));

        if (fileMetadata?.updateTime) {
          updateTime = fileMetadata.updateTime;
          console.error(`✅ [SYNC] Got updateTime from metadata: ${updateTime}`);
        } else {
          console.error(`❌ [SYNC] No updateTime in metadata either - using current time as fallback`);
          updateTime = new Date().toISOString();
        }
      } catch (metadataError: any) {
        console.error(`❌ [SYNC] Failed to fetch metadata: ${metadataError.message}`);
        updateTime = new Date().toISOString();
      }
    }

    // Now sync local file with the updateTime we have
    const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
    const fullFilename = filename + fileExtension;
    const projectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
    const localFilePath = join(projectPath, fullFilename);

    const inSync = await isFileInSync(localFilePath, updateTime);

    if (!inSync) {
      const content = remoteFile.source || remoteFile.content || '';
      await mkdir(dirname(localFilePath), { recursive: true });
      await writeFile(localFilePath, content, 'utf-8');
      await setFileMtimeToRemote(localFilePath, updateTime, remoteFile.type);
      console.error(`📥 [SYNC] Updated local cache for ${filename} (mtime: ${updateTime})`);
    } else {
      console.error(`✅ [SYNC] Local file already in sync with remote (mtime: ${updateTime})`);
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
    // Store raw content BEFORE unwrapping for hash computation
    const rawContent = result.content;
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

    // Compute hash on WRAPPED content (full file as stored in GAS)
    // This ensures hash matches `git hash-object <file>` on local synced files
    const contentHash = computeGitSha1(rawContent);
    result.hash = contentHash;

    // Cache the hash in xattr for future reads
    const fileExtensionForCache = LocalFileManager.getFileExtensionFromName(filename);
    const fullFilenameForCache = filename + fileExtensionForCache;
    const projectPathForCache = await LocalFileManager.getProjectDirectory(projectName, workingDir);
    const localFilePathForCache = join(projectPathForCache, fullFilenameForCache);
    await updateCachedContentHash(localFilePathForCache, contentHash);

    // Add git breadcrumb hint for .git/* files
    const gitHint = getGitBreadcrumbHint(filename);
    if (gitHint) {
      result.gitBreadcrumbHint = gitHint;
    }

    // Save to local file if requested
    if (params.toLocal) {
      const localPath = expandAndValidateLocalPath(params.toLocal);
      await mkdir(dirname(localPath), { recursive: true });
      await writeFile(localPath, result.content, 'utf-8');
      result.savedTo = localPath;
    }

    return result;
  }
}
