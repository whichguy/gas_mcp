import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { resolveHybridScriptId, fileNameMatches } from '../../api/pathParser.js';
import { ValidationError, FileOperationError, ConflictError, type ConflictDetails } from '../../errors/mcpErrors.js';
import { translatePathForOperation } from '../../utils/virtualFileTranslation.js';
// Note: moduleWrapper imports removed - CopyOperationStrategy handles wrapping internally
import { SCRIPT_ID_SCHEMA, ACCESS_TOKEN_SCHEMA } from './shared/schemas.js';
import type { CopyParams, CopyResult } from './shared/types.js';
import { GitOperationManager } from '../../core/git/GitOperationManager.js';
import { GitPathResolver } from '../../core/git/GitPathResolver.js';
import { SyncStrategyFactory } from '../../core/git/SyncStrategyFactory.js';
import { CopyOperationStrategy } from '../../core/git/operations/CopyOperationStrategy.js';
import { computeGitSha1, hashesEqual } from '../../utils/hashUtils.js';

/**
 * Copy files in Google Apps Script project with CommonJS processing
 *
 * ✅ RECOMMENDED - Unwraps source module, rewraps for destination
 * Like Unix cp but handles module system
 */
export class CpTool extends BaseFileSystemTool {
  public name = 'cp';
  public description = 'Copy files in GAS (NO git auto-commit). After copy, call git_feature({operation:"commit"}) to save. Unwraps source module, rewraps for destination. Like Unix cp.';

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
        type: 'string',
        description: 'Git SHA-1 hash (40 hex chars) of the source file from previous cat. If source file\'s hash differs, copy fails with ConflictError. Pass the hash from cat response to detect concurrent modifications to the source.',
        pattern: '^[a-f0-9]{40}$',
        examples: ['a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2']
      },
      force: {
        type: 'boolean',
        description: '⚠️ Force copy even if source file hash mismatches. Use only when intentionally copying from a modified source.',
        default: false
      },
      accessToken: {
        ...ACCESS_TOKEN_SCHEMA
      }
    },
    required: ['scriptId', 'from', 'to'],
    additionalProperties: false,
    llmGuidance: {
      // GIT INTEGRATION - CRITICAL for LLM behavior
      gitIntegration: {
        CRITICAL: 'This tool does NOT auto-commit to git',
        behavior: 'Copy pushes to GAS but does NOT commit locally',
        requiredAction: 'git_feature({operation:"commit", scriptId, message:"..."})'
      },

      unixLike: 'cp (copy) | GAS | CommonJS unwrap→rewrap',
      whenToUse: 'copy files + proper CommonJS handling',
      workflow: 'cp({scriptId:"...",from:"utils",to:"utils-backup"})',
      commonJsProcessing: 'unwraps source→rewraps dest with correct module name',
      examples: ['within: cp({scriptId:"1abc2def...",from:"utils",to:"utils-backup"})', 'cross-project: cp({scriptId:"1abc2def...",from:"utils",to:"1xyz9abc.../utils"})', 'subfolder: cp({scriptId:"1abc2def...",from:"main",to:"archive/main-v1"})', 'rename: cp({scriptId:"1abc2def...",from:"Calculator",to:"CalcBackup"})'],
      vsRawCp: 'raw_cp→bulk ops without CommonJS processing'
    }
  };

  async execute(params: CopyParams): Promise<CopyResult> {
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
    // Validate source file hasn't changed since last cat (if expectedHash provided)
    if (params.expectedHash && !params.force) {
      // Fetch source file to compute its current hash
      const sourceFiles = await this.gasClient.getProjectContent(fromProjectId, accessToken);
      const sourceFile = sourceFiles.find((f: any) => fileNameMatches(f.name, fromFilename));

      if (!sourceFile) {
        throw new FileOperationError('copy', params.from, 'source file not found');
      }

      // Compute hash on WRAPPED content (full file as stored in GAS)
      // This ensures hash matches `git hash-object <file>` on local synced files
      const currentSourceHash = computeGitSha1(sourceFile.source || '');

      if (!hashesEqual(params.expectedHash, currentSourceHash)) {
        // Source file was modified since last read
        const diffContent = `Source file hash mismatch.\nExpected: ${params.expectedHash}\nCurrent:  ${currentSourceHash}\n\nThe source file has been modified since you last read it.`;

        const conflict: ConflictDetails = {
          scriptId: fromProjectId,
          filename: fromFilename,
          operation: 'cp',
          expectedHash: params.expectedHash,
          currentHash: currentSourceHash,
          hashSource: 'param',
          diff: {
            format: 'info',
            content: diffContent,
            truncated: false
          }
        };
        throw new ConflictError(conflict);
      }
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

    // Compute destination file hash for response
    // Fetch the destination file to compute its hash on WRAPPED content
    let destHash: string | undefined;
    try {
      const destFiles = await this.gasClient.getProjectContent(toProjectId, accessToken);
      const destFile = destFiles.find((f: any) => fileNameMatches(f.name, toFilename));
      if (destFile) {
        // Compute hash on WRAPPED content (full file as stored in GAS)
        // This ensures hash matches `git hash-object <file>` on local synced files
        destHash = computeGitSha1(destFile.source || '');
      }
    } catch (hashError) {
      // Log but don't fail the copy operation if hash computation fails
      console.error(`⚠️ [HASH] Could not compute destination hash: ${hashError}`);
    }

    // Check if on feature branch to add workflow hint
    const { isFeatureBranch } = await import('../../utils/gitAutoCommit.js');
    const onFeatureBranch = gitResult.git?.branch ? isFeatureBranch(gitResult.git.branch) : false;

    // Return response with git hints for LLM guidance
    // IMPORTANT: Write operations do NOT auto-commit - include git.taskCompletionBlocked signal
    return {
      ...copyResult,
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
      // Pass through git hints from GitOperationManager
      git: gitResult.git ? {
        detected: gitResult.git.detected,
        branch: gitResult.git.branch,
        staged: gitResult.git.staged,
        uncommittedChanges: gitResult.git.uncommittedChanges,
        recommendation: gitResult.git.recommendation,
        taskCompletionBlocked: gitResult.git.taskCompletionBlocked
      } : { detected: false },
      // Add workflow completion hint when on feature branch
      ...(onFeatureBranch ? {
        nextAction: {
          hint: `File copied. When complete: git_feature({ operation: 'finish', scriptId, pushToRemote: true })`,
          required: gitResult.git?.taskCompletionBlocked || false
        }
      } : {})
    };
  }
}
