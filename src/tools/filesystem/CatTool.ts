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
import { setFileMtimeToRemote, isFileInSyncWithCacheByHash } from '../../utils/fileHelpers.js';
import { getCachedGASMetadata, cacheGASMetadata, updateCachedContentHash, getCachedContentHash, clearGASMetadata } from '../../utils/gasMetadataCache.js';
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
  public description = '[FILE:READ] Read file content with automatic CommonJS unwrapping — returns clean user code. WHEN: reading any file to view or prepare for editing. AVOID: use raw_cat to see full CommonJS _main() wrappers; use edit for modifications. Example: cat({scriptId, path: "Utils.gs"})';

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
      accessToken: {
        ...ACCESS_TOKEN_SCHEMA
      }
    },
    required: ['scriptId', 'path'],
    additionalProperties: false,
    llmGuidance: {
      localFileSupport: 'toLocal:"~/backup/utils.js" → creates parent dirs, returns savedTo',
      efficientAlternatives: 'ripgrep|grep→search; edit→small changes; aider→fuzzy; sed→pattern. Use cat for full understanding|major refactor.',
      limitations: 'SERVER_JS|HTML|JSON only; auto-unwraps _main()→raw_cat for wrappers; preferLocal:false forces remote',
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

    // Hoist remoteFiles to avoid duplicate API calls between fast and slow paths
    // If fast path fetches remote files, slow path can reuse them
    let remoteFilesFromFastPath: any[] | undefined;

    // Track previous hash for content-change signaling to LLM
    let previousCachedHash: string | null = null;

    // Hash-based sync optimization: Compare cached hash with remote hash
    // Still requires API call for hash, but avoids re-processing if content unchanged
    if (preferLocal) {
      const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
      const fullFilename = filename + fileExtension;
      const projectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
      const localFilePath = join(projectPath, fullFilename);

      // Get cached hash from xattr (fast - no file read needed)
      const cachedHash = await getCachedContentHash(localFilePath);
      const cachedMeta = await getCachedGASMetadata(localFilePath);

      // Capture for content-change signaling (available to slow path fallthrough)
      previousCachedHash = cachedHash;

      if (cachedHash && cachedMeta) {
        // We have a cached hash - fetch remote to compare hashes
        // This API call is necessary for reliable sync detection (never trust mtime)
        try {
          remoteFilesFromFastPath = await this.gasClient.getProjectContent(scriptId, accessToken);
          const remoteFiles = remoteFilesFromFastPath;
          const remoteFile = remoteFiles.find((f: any) => fileNameMatches(f.name, filename));

          if (remoteFile) {
            // Compute remote hash on WRAPPED content (full file as stored in GAS)
            const remoteHash = computeGitSha1(remoteFile.source || '');

            if (cachedHash === remoteHash) {
              // Hash match! Safe to use local cached content - avoids re-processing
              try {
                const localContent = await LocalFileManager.readFileFromProject(projectName, filename, workingDir);

                if (localContent) {
                  // Verify local file content hash still matches cached hash
                  const verifyHash = computeGitSha1(localContent);
                  if (verifyHash !== cachedHash) {
                    // Local file changed without cache update - fall through to slow path
                    console.error(`⚠️ [SYNC] Local file hash mismatch (cached: ${cachedHash.slice(0, 8)}..., actual: ${verifyHash.slice(0, 8)}...)`);
                    // Continue to slow path for proper sync
                  } else {
                    // All hashes match - return local content (optimized path)
                    let result: any = {
                      path: fullPath,
                      scriptId: scriptId,
                      filename,
                      content: localContent,
                      source: 'local',
                      fileType: cachedMeta.fileType,
                      fileExtension,
                      syncStatus: { inSync: true, differences: [], message: 'In sync (hash verified)' },
                      gitRepository: {
                        initialized: gitStatus.gitInitialized,
                        path: gitStatus.repoPath,
                        isNewRepo: gitStatus.isNewRepo
                      }
                    };

                    // CommonJS integration - unwrap for editing
                    let finalContent = result.content;
                    let commonJsInfo: any = null;

                    let existingModuleOptions: ModuleOptions | null = null;

                    if (shouldWrapContent(result.fileType || 'SERVER_JS', filename)) {
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

                    // Analyze content for warnings and hints (catches issues missed at write time)
                    const contentAnalysis = analyzeContent(filename, finalContent, existingModuleOptions ?? undefined);

                    result.content = finalContent;
                    result.commonJsInfo = commonJsInfo;
                    result.hash = cachedHash;  // Use verified cached hash
                    result.contentChange = {
                      changed: false,
                      previousHash: cachedHash,
                      currentHash: cachedHash,
                      source: 'fast_path_cache'
                    };

                    // Populate moduleOptions (fixes bug: was always undefined in generateReadHints)
                    if (existingModuleOptions) {
                      result.moduleOptions = existingModuleOptions;
                    }

                    // Surface content analysis warnings and hints
                    if (contentAnalysis.warnings.length > 0) {
                      result.warnings = contentAnalysis.warnings;
                    }
                    if (contentAnalysis.hints.length > 0) {
                      result.analysisHints = contentAnalysis.hints;
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

                    // Add response hints (moduleOptions now populated above)
                    const fastPathHints = generateReadHints(filename, result.moduleOptions);
                    result.hints = fastPathHints;

                    // Add git workflow hint
                    if (gitStatus.repoPath) {
                      try {
                        const { buildReadHint } = await import('../../utils/gitStatus.js');
                        result.git = await buildReadHint(gitStatus.repoPath);
                      } catch { /* non-fatal */ }
                    }

                    // Optimized path success - return with hash-verified local content
                    console.error(`✅ [SYNC] Using cached local content (hash: ${cachedHash.slice(0, 8)}...)`);
                    return result;
                  }
                }
              } catch (localError: any) {
                // Fall through to slow path
                console.error(`⚠️ [SYNC] Failed to read local file, falling through to slow path: ${localError.message}`);
              }
            } else {
              // Hash mismatch - remote changed, need to update local
              console.error(`📥 [SYNC] Remote hash differs (local: ${cachedHash.slice(0, 8)}..., remote: ${remoteHash.slice(0, 8)}...)`);
            }
          }
        } catch (apiError: any) {
          // API call failed - fall through to slow path
          console.error(`⚠️ [SYNC] API call failed in fast path, falling through: ${apiError.message}`);
        }
      }
    }

    // Slow path: Need API call for sync verification
    // Reuse remoteFiles from fast path if available (avoids duplicate API call)
    let syncStatus: any = null;
    let remoteFiles: any[] = remoteFilesFromFastPath || [];

    try {
      // Only fetch if not already fetched in fast path
      if (!remoteFilesFromFastPath) {
        remoteFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
      }
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
        // Clear xattr cache to prevent stale hash detection if file is recreated
        await clearGASMetadata(localFilePath).catch(() => {});
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

    // Now sync local file using hash comparison (never trust mtime)
    const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
    const fullFilename = filename + fileExtension;
    const projectPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
    const localFilePath = join(projectPath, fullFilename);

    // Compute remote hash on WRAPPED content (full file as stored in GAS)
    const remoteContent = remoteFile.source || remoteFile.content || '';
    const remoteHash = computeGitSha1(remoteContent);

    // Check sync using hash comparison (with diagnostics for content-change signaling)
    const syncCheck = await isFileInSyncWithCacheByHash(localFilePath, remoteHash);
    const inSync = syncCheck.inSync;

    // Always prefer the mtime-validated hash from sync check over raw xattr cache
    if (syncCheck.diagnosis.localHash) {
      previousCachedHash = syncCheck.diagnosis.localHash;
    }

    if (!inSync) {
      await mkdir(dirname(localFilePath), { recursive: true });
      await writeFile(localFilePath, remoteContent, 'utf-8');
      // Still set mtime for user convenience (file explorer sorting, etc.) but NOT for sync detection
      await setFileMtimeToRemote(localFilePath, updateTime, remoteFile.type);
      // Update the content hash cache
      await updateCachedContentHash(localFilePath, remoteHash);
      console.error(`📥 [SYNC] Updated local cache for ${filename} (hash: ${remoteHash.slice(0, 8)}...)`);
    } else {
      console.error(`✅ [SYNC] Local file already in sync with remote (hash: ${remoteHash.slice(0, 8)}...)`);
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

    let existingModuleOptions: ModuleOptions | null = null;

    if (shouldWrapContent(result.fileType || 'SERVER_JS', filename)) {
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

    // Analyze content for warnings and hints (catches issues missed at write time)
    const contentAnalysis = analyzeContent(filename, finalContent, existingModuleOptions ?? undefined);

    result.content = finalContent;
    result.commonJsInfo = commonJsInfo;

    // Populate moduleOptions (fixes bug: was always undefined in generateReadHints)
    if (existingModuleOptions) {
      result.moduleOptions = existingModuleOptions;
    }

    // Surface content analysis warnings and hints
    if (contentAnalysis.warnings.length > 0) {
      result.warnings = contentAnalysis.warnings;
    }
    if (contentAnalysis.hints.length > 0) {
      result.analysisHints = contentAnalysis.hints;
    }

    // Compute hash on WRAPPED content (full file as stored in GAS)
    // This ensures hash matches `git hash-object <file>` on local synced files
    const contentHash = computeGitSha1(rawContent);
    result.hash = contentHash;

    // Content-change signaling: tell the LLM if file differs from last cached read
    const contentChanged = previousCachedHash !== null && previousCachedHash !== contentHash;
    result.contentChange = {
      changed: contentChanged,
      previousHash: previousCachedHash,
      currentHash: contentHash,
      source: previousCachedHash === null ? 'first_read' : 'slow_path_sync'
    };

    // Cache the hash in xattr for future reads (reuse localFilePath from line 338)
    await updateCachedContentHash(localFilePath, contentHash);

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

    // Add response hints
    const hints = generateReadHints(filename, result.moduleOptions);
    result.hints = hints;

    // Add git workflow hint
    if (gitStatus.repoPath) {
      try {
        const { buildReadHint } = await import('../../utils/gitStatus.js');
        result.git = await buildReadHint(gitStatus.repoPath);
      } catch { /* non-fatal */ }
    }

    return result;
  }
}
