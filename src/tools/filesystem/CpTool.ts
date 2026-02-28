import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { resolveHybridScriptId, fileNameMatches } from '../../api/pathParser.js';
import { ValidationError, FileOperationError } from '../../errors/mcpErrors.js';
import { translatePathForOperation } from '../../utils/virtualFileTranslation.js';
// Note: moduleWrapper imports removed - CopyOperationStrategy handles wrapping internally
import { SCRIPT_ID_SCHEMA, ACCESS_TOKEN_SCHEMA, EXPECTED_HASH_SCHEMA, FORCE_SCHEMA } from './shared/schemas.js';
import type { CopyParams, CopyResult } from './shared/types.js';
import { GitOperationManager } from '../../core/git/GitOperationManager.js';
import { GitPathResolver } from '../../core/git/GitPathResolver.js';
import { SyncStrategyFactory } from '../../core/git/SyncStrategyFactory.js';
import { CopyOperationStrategy } from '../../core/git/operations/CopyOperationStrategy.js';
import { computeGitSha1 } from '../../utils/hashUtils.js';
import { checkForConflictOrThrow } from '../../utils/conflictDetection.js';
import path from 'node:path';

interface RawCpParams {
  sourceScriptId: string;
  destinationScriptId: string;
  mergeStrategy?: 'preserve-destination' | 'overwrite-destination' | 'skip-conflicts';
  includeFiles?: string[];
  excludeFiles?: string[];
  dryRun?: boolean;
  accessToken?: string;
}

/**
 * Copy files in Google Apps Script project with CommonJS processing
 *
 * ✅ RECOMMENDED - Unwraps source module, rewraps for destination
 * Like Unix cp but handles module system
 *
 * When raw: true, performs cross-project bulk file copy with merge strategies
 * (former raw_cp behavior), preserving exact content without CommonJS processing.
 */
export class CpTool extends BaseFileSystemTool {
  public name = 'cp';
  public description = '[FILE:COPY] Copy a file within a GAS project. WHEN: duplicating files or creating variants. For cross-project bulk copies with merge strategies, use cp({raw:true, sourceScriptId, destinationScriptId}). AVOID: use mv to move without keeping original. Example: cp({scriptId, from: "Utils.gs", to: "UtilsBackup.gs"}). GIT: use git_feature(start) before features, git_feature(commit) after changes.';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      status: { type: 'string', description: 'Operation status (success)' },
      from: { type: 'string', description: 'Source file path' },
      to: { type: 'string', description: 'Destination file path' },
      fromProjectId: { type: 'string', description: 'Source project script ID' },
      toProjectId: { type: 'string', description: 'Destination project script ID' },
      isCrossProject: { type: 'boolean', description: 'Whether copy was cross-project' },
      commonJsProcessed: { type: 'boolean', description: 'Whether CommonJS was unwrapped/rewrapped' },
      size: { type: 'number', description: 'File size in bytes' },
      totalFiles: { type: 'number', description: 'Total files in project after copy' },
      hash: { type: 'string', description: 'Git SHA-1 hash of destination file' },
      message: { type: 'string', description: 'Summary message' },
      git: { type: 'object', description: 'Compact git hint (branch, uncommitted count, action)' }
    }
  };

  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        ...SCRIPT_ID_SCHEMA,
        description: 'Google Apps Script project ID (44 characters) - used as default, can be overridden by embedded project IDs in paths'
      },
      from: {
        type: 'string',
        description: 'Source path: filename OR scriptId/filename (without extension). If embedded script ID provided, overrides scriptId parameter.',
        examples: [
          'utils.gs',
          'ai_tools/helper.gs',
          '1abc2def.../utils.gs'
        ]
      },
      to: {
        type: 'string',
        description: 'Destination path: filename OR scriptId/filename (without extension). If embedded script ID provided, overrides scriptId parameter.',
        examples: [
          'utils-copy.gs',
          'backup/utils.gs',
          '1xyz9abc.../utils.gs'
        ]
      },
      changeReason: {
        type: 'string',
        description: 'Optional commit message for git integration. If omitted, defaults to "Copy {from} to {to}". Git repo is created automatically if it doesn\'t exist.',
        examples: ['Create backup copy', 'Duplicate for testing', 'Copy to archive folder']
      },
      expectedHash: {
        ...EXPECTED_HASH_SCHEMA,
        description: 'Git SHA-1 hash (40 hex chars) of the source file from previous cat. If source file\'s hash differs, copy fails with ConflictError.'
      },
      force: {
        ...FORCE_SCHEMA,
        description: '⚠️ Force copy even if source file hash mismatches. Use only when intentionally copying from a modified source.'
      },
      accessToken: {
        ...ACCESS_TOKEN_SCHEMA
      },
      raw: {
        type: 'boolean',
        description: 'When true, performs cross-project bulk file copy with merge strategies, preserving exact content without CommonJS processing. Requires sourceScriptId and destinationScriptId instead of scriptId/from/to. Former raw_cp behavior.',
        default: false
      },
      sourceScriptId: {
        type: 'string',
        description: 'Source GAS project ID to copy files FROM. Only used when raw: true.',
        minLength: 20
      },
      destinationScriptId: {
        type: 'string',
        description: 'Destination GAS project ID to copy files TO. Only used when raw: true.',
        minLength: 20
      },
      mergeStrategy: {
        type: 'string',
        enum: ['preserve-destination', 'overwrite-destination', 'skip-conflicts'],
        default: 'preserve-destination',
        description: 'Conflict resolution strategy. Only used when raw: true.'
      },
      includeFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only copy specific files (by name). Only used when raw: true. If omitted, copies all files.'
      },
      excludeFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exclude specific files from copying. Only used when raw: true.'
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview what would be copied without actually copying. Only used when raw: true.',
        default: false
      }
    },
    required: ['scriptId'],
    additionalProperties: false,
    llmGuidance: {
      gitIntegration: 'CRITICAL: does NOT auto-commit. Must call git_feature({operation:"commit"}) after copy.',
      commonJs: 'Auto unwraps source→rewraps dest with correct module name. Use raw:true for bulk cross-project copies without CommonJS processing.',
      rawMode: 'raw:true → bulk cross-project copy (former raw_cp). scriptId/from/to not required in raw mode; use sourceScriptId+destinationScriptId instead.'
    }
  };

  public annotations = {
    title: 'Copy File',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
  };

  async execute(params: CopyParams): Promise<CopyResult | any> {
    if (params.raw) {
      if (!params.sourceScriptId) {
        throw new ValidationError('sourceScriptId', undefined, 'required when raw: true');
      }
      if (!params.destinationScriptId) {
        throw new ValidationError('destinationScriptId', undefined, 'required when raw: true');
      }
      return await this.executeRaw({
        sourceScriptId: params.sourceScriptId,
        destinationScriptId: params.destinationScriptId,
        mergeStrategy: params.mergeStrategy,
        includeFiles: params.includeFiles,
        excludeFiles: params.excludeFiles,
        dryRun: params.dryRun,
        accessToken: params.accessToken
      } as RawCpParams);
    }

    // SECURITY: Validate parameters BEFORE authentication
    const accessToken = await this.getAuthToken(params);

    // Apply virtual file translation for user-provided paths
    const translatedFrom = translatePathForOperation(params.from, true);
    const translatedTo = translatePathForOperation(params.to, true);

    // Resolve script IDs using hybrid approach (supports cross-project copies)
    const fromResolution = resolveHybridScriptId(params.scriptId, translatedFrom, 'copy operation (from)');
    const toResolution = resolveHybridScriptId(params.scriptId, translatedTo, 'copy operation (to)');

    const fromProjectId = fromResolution.scriptId;
    const toProjectId = toResolution.scriptId;
    const fromFilename = fromResolution.cleanPath;
    const toFilename = toResolution.cleanPath;

    // Validate that we have actual filenames
    if (!fromFilename || !toFilename) {
      throw new ValidationError('path', 'from/to', 'valid filenames (cannot be empty)');
    }

    // === HASH-BASED CONFLICT DETECTION FOR SOURCE FILE ===
    // Only fetch when expectedHash is provided (avoids unnecessary API calls)
    if (params.expectedHash) {
      const sourceFiles = await this.gasClient.getProjectContent(fromProjectId, accessToken);
      const sourceFile = sourceFiles.find((f: any) => fileNameMatches(f.name, fromFilename));

      if (!sourceFile) {
        throw new FileOperationError('copy', params.from, 'source file not found');
      }

      checkForConflictOrThrow({
        scriptId: fromProjectId,
        filename: fromFilename,
        operation: 'cp',
        currentRemoteContent: sourceFile.source || '',
        expectedHash: params.expectedHash,
        hashSource: 'param',
        force: params.force
      });
    }

    // Always use GitOperationManager for proper workflow:
    // 1. Compute changes (unwrap source, prepare dest content)
    // 2. Validate with hooks (single commit for destination)
    // 3. Write to remote
    // Git repo will be created automatically if it doesn't exist
    const operation = new CopyOperationStrategy({
      scriptId: params.scriptId,
      from: params.from,
      to: params.to,
      accessToken,
      gasClient: this.gasClient
    });

    const pathResolver = new GitPathResolver();
    const syncFactory = new SyncStrategyFactory();
    const gitManager = new GitOperationManager(pathResolver, syncFactory, this.gasClient);

    // Use provided changeReason or generate default
    const defaultMessage = `Copy ${fromFilename} to ${toFilename}`;

    const gitResult = await gitManager.executeWithGit(operation, {
      scriptId: toProjectId,  // Use destination project for git operations
      files: [toFilename],
      changeReason: params.changeReason || defaultMessage,
      accessToken
    });

    // Add additional fields required by tool's CopyResult type
    const copyResult = gitResult.result;
    const isCrossProject = fromProjectId !== toProjectId;

    // Compute destination file hash from strategy's wrapped content
    // (GitOperationManager handles local git mirror update)
    let destHash: string | undefined;
    try {
      const wrappedStr = copyResult.wrappedContent?.get(toFilename) || '';
      destHash = computeGitSha1(wrappedStr);
    } catch (hashError) {
      console.error(`⚠️ [CP] Hash computation failed: ${hashError}`);
    }

    // For cross-project copies, compare appsscript.json manifests and warn about differences
    let manifestHints: { differences: string[]; recommendation?: string } | undefined;
    if (isCrossProject) {
      try {
        // Fetch both manifests
        const sourceFiles = await this.gasClient.getProjectContent(fromProjectId, accessToken);
        const destFiles = await this.gasClient.getProjectContent(toProjectId, accessToken);

        const sourceManifest = sourceFiles.find((f: any) => f.name === 'appsscript');
        const destManifest = destFiles.find((f: any) => f.name === 'appsscript');

        if (sourceManifest && destManifest) {
          const sourceConfig = JSON.parse(sourceManifest.source || '{}');
          const destConfig = JSON.parse(destManifest.source || '{}');

          const differences: string[] = [];

          // Compare OAuth scopes
          const sourceScopes = new Set<string>(sourceConfig.oauthScopes || []);
          const destScopes = new Set<string>(destConfig.oauthScopes || []);
          const missingScopes = [...sourceScopes].filter(s => !destScopes.has(s));
          if (missingScopes.length > 0) {
            differences.push(`Missing OAuth scopes in destination: ${missingScopes.map(s => s.split('/').pop()).join(', ')}`);
          }

          // Compare advanced services (dependencies)
          const sourceDeps: any[] = sourceConfig.dependencies?.enabledAdvancedServices || [];
          const destDeps: any[] = destConfig.dependencies?.enabledAdvancedServices || [];
          const sourceDepNames = new Set<string>(sourceDeps.map(d => d.serviceId));
          const destDepNames = new Set<string>(destDeps.map(d => d.serviceId));
          const missingDeps = [...sourceDepNames].filter(d => !destDepNames.has(d));
          if (missingDeps.length > 0) {
            differences.push(`Missing advanced services in destination: ${missingDeps.join(', ')}`);
          }

          // Compare libraries (CRITICAL - code may reference Library.function())
          const sourceLibs: any[] = sourceConfig.dependencies?.libraries || [];
          const destLibs: any[] = destConfig.dependencies?.libraries || [];
          const destLibIds = new Set<string>(destLibs.map(l => l.libraryId));
          const missingLibs = sourceLibs
            .filter(l => !destLibIds.has(l.libraryId))
            .map(l => l.userSymbol || l.libraryId);
          if (missingLibs.length > 0) {
            differences.push(`Missing libraries in destination: ${missingLibs.join(', ')}`);
          }

          // Compare urlFetchWhitelist (code may fetch URLs not allowed in destination)
          const sourceWhitelist: string[] = sourceConfig.urlFetchWhitelist || [];
          const destWhitelist: string[] = destConfig.urlFetchWhitelist || [];
          if (sourceWhitelist.length > 0 && destWhitelist.length === 0) {
            differences.push(`Source has URL allowlist (${sourceWhitelist.length} URLs), destination has none`);
          } else if (sourceWhitelist.length > 0) {
            const destPrefixes = new Set<string>(destWhitelist);
            const missingUrls = sourceWhitelist.filter((url: string) => !destPrefixes.has(url));
            if (missingUrls.length > 0) {
              differences.push(`Missing URL prefixes in destination allowlist: ${missingUrls.length} URLs`);
            }
          }

          // Compare timezone
          if (sourceConfig.timeZone && destConfig.timeZone && sourceConfig.timeZone !== destConfig.timeZone) {
            differences.push(`Timezone mismatch: source=${sourceConfig.timeZone}, dest=${destConfig.timeZone}`);
          }

          // Compare runtime version
          if (sourceConfig.runtimeVersion !== destConfig.runtimeVersion) {
            differences.push(`Runtime mismatch: source=${sourceConfig.runtimeVersion || 'V8'}, dest=${destConfig.runtimeVersion || 'V8'}`);
          }

          if (differences.length > 0) {
            manifestHints = {
              differences,
              recommendation: 'Review destination project appsscript.json to ensure compatibility with copied code'
            };
            console.error(`⚠️ [CP] Cross-project manifest differences detected: ${differences.length} issues`);
          }
        }
      } catch (manifestError) {
        console.error(`⚠️ [CP] Could not compare manifests: ${manifestError}`);
      }
    }

    // Return response with compact git hints for LLM guidance
    // Exclude wrappedContent from response (internal use only for hash computation)
    const { wrappedContent: _unused, ...copyResultForResponse } = copyResult;
    return {
      ...copyResultForResponse,
      commonJsProcessed: true,  // CopyOperationStrategy always processes CommonJS
      size: 0,  // We don't track size in the strategy
      totalFiles: 0,  // We don't track this anymore
      message: isCrossProject
        ? `Copied ${fromFilename} from project ${fromProjectId.substring(0, 8)}... to ${toFilename} in project ${toProjectId.substring(0, 8)}... with CommonJS processing`
        : `Copied ${fromFilename} to ${toFilename} with CommonJS processing within project ${fromProjectId.substring(0, 8)}...`,
      // Include destination file hash for conflict detection on future operations
      ...(destHash ? {
        hash: destHash,
        hashNote: 'Hash computed on wrapped (full GAS file) content. Pass as expectedHash to future writes to detect concurrent modifications.'
      } : {}),
      // Compact git hint from GitOperationManager
      git: gitResult.git?.hint,
      // Add manifest compatibility hints for cross-project copies (dynamic, kept)
      ...(manifestHints ? { manifestHints } : {}),
    } as CopyResult;
  }

  private async executeRaw(params: RawCpParams): Promise<any> {
    const {
      sourceScriptId,
      destinationScriptId,
      mergeStrategy = 'preserve-destination',
      includeFiles = [],
      excludeFiles = [],
      dryRun = false
    } = params;

    const accessToken = await this.getAuthToken(params);

    // Get source project files
    const sourceFiles = await this.gasClient.getProjectContent(sourceScriptId, accessToken);

    // Get destination project files
    const destinationFiles = await this.gasClient.getProjectContent(destinationScriptId, accessToken);

    // Create maps for easier lookup
    const destinationFileMap = new Map(destinationFiles.map((f: any) => [f.name, f]));

    // Filter source files based on include/exclude lists
    let filesToProcess = sourceFiles.filter((file: any) => {
      const fileName = file.name;
      if (includeFiles.length > 0 && !includeFiles.includes(fileName)) return false;
      if (excludeFiles.length > 0 && excludeFiles.includes(fileName)) return false;
      return true;
    });

    const analysis = {
      newFiles: [] as string[],
      conflictFiles: [] as string[],
      identicalFiles: [] as string[],
      excludedFiles: [] as string[]
    };

    const filesToCopy: Array<{name: string; content: string; type: string; action: string}> = [];

    for (const sourceFile of filesToProcess) {
      const fileName = sourceFile.name;
      const destinationFile = destinationFileMap.get(fileName);

      if (!destinationFile) {
        analysis.newFiles.push(fileName);
        filesToCopy.push({ name: fileName, content: sourceFile.source || '', type: sourceFile.type || 'SERVER_JS', action: 'new' });
      } else if (sourceFile.source === destinationFile.source) {
        analysis.identicalFiles.push(fileName);
      } else {
        analysis.conflictFiles.push(fileName);
        switch (mergeStrategy) {
          case 'preserve-destination':
            analysis.excludedFiles.push(`${fileName} (preserved destination)`);
            break;
          case 'overwrite-destination':
            filesToCopy.push({ name: fileName, content: sourceFile.source || '', type: sourceFile.type || 'SERVER_JS', action: 'overwrite' });
            break;
          case 'skip-conflicts':
            analysis.excludedFiles.push(`${fileName} (skipped conflict)`);
            break;
        }
      }
    }

    if (dryRun) {
      return {
        dryRun: true,
        sourceScriptId,
        destinationScriptId,
        mergeStrategy,
        analysis: {
          totalSourceFiles: sourceFiles.length,
          filteredSourceFiles: filesToProcess.length,
          newFiles: analysis.newFiles.length,
          conflictFiles: analysis.conflictFiles.length,
          identicalFiles: analysis.identicalFiles.length,
          excludedFiles: analysis.excludedFiles.length,
          wouldCopy: filesToCopy.length
        },
        details: {
          newFiles: analysis.newFiles,
          conflictFiles: analysis.conflictFiles,
          identicalFiles: analysis.identicalFiles,
          excludedFiles: analysis.excludedFiles,
          filesToCopy: filesToCopy.map(f => ({ name: f.name, action: f.action }))
        },
        message: `Would copy ${filesToCopy.length} files from source to destination`
      };
    }

    const copyResults = [];
    let successCount = 0;
    let errorCount = 0;

    for (const file of filesToCopy) {
      try {
        await this.gasClient.updateFile(destinationScriptId, file.name, file.content, undefined, accessToken, file.type as 'SERVER_JS' | 'HTML' | 'JSON');
        copyResults.push({ name: file.name, action: file.action, status: 'success' });
        successCount++;

      } catch (error: any) {
        copyResults.push({ name: file.name, action: file.action, status: 'error', error: error.message });
        errorCount++;
      }
    }

    return {
      success: errorCount === 0,
      sourceScriptId,
      destinationScriptId,
      mergeStrategy,
      summary: {
        totalSourceFiles: sourceFiles.length,
        filteredSourceFiles: filesToProcess.length,
        attemptedCopy: filesToCopy.length,
        successfulCopies: successCount,
        errors: errorCount,
        newFiles: analysis.newFiles.length,
        conflictFiles: analysis.conflictFiles.length,
        identicalFiles: analysis.identicalFiles.length,
        excludedFiles: analysis.excludedFiles.length
      },
      details: {
        newFiles: analysis.newFiles,
        conflictFiles: analysis.conflictFiles,
        identicalFiles: analysis.identicalFiles,
        excludedFiles: analysis.excludedFiles
      },
      copyResults: copyResults.filter(r => r.status === 'error'),
      message: errorCount === 0
        ? `Successfully copied ${successCount} files from source to destination`
        : `Copied ${successCount} files with ${errorCount} errors. See copyResults for details.`
    };
  }
}
