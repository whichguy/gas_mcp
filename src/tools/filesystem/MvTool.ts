import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { resolveHybridScriptId, fileNameMatches } from '../../api/pathParser.js';
import { ValidationError } from '../../errors/mcpErrors.js';
import { SCRIPT_ID_SCHEMA, ACCESS_TOKEN_SCHEMA, FORCE_SCHEMA, EXPECTED_HASH_SCHEMA } from './shared/schemas.js';
import type { MoveParams, MoveResult } from './shared/types.js';
import { GitOperationManager } from '../../core/git/GitOperationManager.js';
import { GitPathResolver } from '../../core/git/GitPathResolver.js';
import { SyncStrategyFactory } from '../../core/git/SyncStrategyFactory.js';
import { MoveOperationStrategy } from '../../core/git/operations/MoveOperationStrategy.js';
import { checkForConflictOrThrow } from '../../utils/conflictDetection.js';

/**
 * Move or rename files in Google Apps Script project
 *
 * ✅ RECOMMENDED - Supports cross-project moves and CommonJS module name updates
 * Like Unix mv but handles GAS module system
 */
export class MvTool extends BaseFileSystemTool {
  public name = 'mv';
  public description = '[FILE:MOVE] Move or rename a file within a GAS project. WHEN: renaming files or reorganizing project structure. AVOID: use cp to keep the original; use rm+write for cross-project moves. Example: mv({scriptId, from: "Old.gs", to: "New.gs"}). GIT: use git_feature(start) before features, git_feature(commit) after changes.';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      status: { type: 'string', description: 'Operation status (success)' },
      from: { type: 'string', description: 'Source file path' },
      to: { type: 'string', description: 'Destination file path' },
      fromProjectId: { type: 'string', description: 'Source project script ID' },
      toProjectId: { type: 'string', description: 'Destination project script ID' },
      isCrossProject: { type: 'boolean', description: 'Whether move was cross-project' },
      totalFiles: { type: 'number', description: 'Total files in project after move' },
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
          'renamed.gs',
          'backup/utils.gs',
          '1xyz9abc.../utils.gs'
        ]
      },
      changeReason: {
        type: 'string',
        description: 'Optional commit message for git integration. If omitted, defaults to "Move {from} to {to}". Git repo is created automatically if it doesn\'t exist.',
        examples: ['Rename utility file', 'Reorganize project structure', 'Move to backup folder']
      },
      expectedHash: {
        ...EXPECTED_HASH_SCHEMA,
        description: 'Git SHA-1 hash (40 hex chars) of source file from previous cat. If provided and differs from current remote, operation fails with ConflictError. Use force:true to bypass.'
      },
      force: {
        ...FORCE_SCHEMA,
        description: 'Bypass hash conflict detection on source file. Use when you want to move regardless of external changes.'
      },
      accessToken: {
        ...ACCESS_TOKEN_SCHEMA
      }
    },
    required: ['scriptId', 'from', 'to'],
    llmGuidance: {
      gitIntegration: 'CRITICAL: does NOT auto-commit. Must call git_feature({operation:"commit"}) after move.',
      commonJs: 'Auto-updates CommonJS module name for require() resolution',
      nextSteps: 'ripgrep→update require() calls | exec→test | git_feature commit→save'
    }
  };

  public annotations = {
    title: 'Move File',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  };

  async execute(params: MoveParams & { expectedHash?: string; force?: boolean }): Promise<MoveResult> {
    // SECURITY: Validate parameters BEFORE authentication
    const accessToken = await this.getAuthToken(params);

    // Resolve script IDs using hybrid approach (supports cross-project moves)
    const fromResolution = resolveHybridScriptId(params.scriptId, params.from, 'move operation (from)');
    const toResolution = resolveHybridScriptId(params.scriptId, params.to, 'move operation (to)');

    const fromProjectId = fromResolution.scriptId;
    const toProjectId = toResolution.scriptId;
    const fromFilename = fromResolution.cleanPath;
    const toFilename = toResolution.cleanPath;

    // Validate that we have actual filenames
    if (!fromFilename || !toFilename) {
      throw new ValidationError('path', 'from/to', 'valid filenames (cannot be empty)');
    }

    // === HASH-BASED CONFLICT DETECTION ===
    // Only fetch when expectedHash is provided (avoids unnecessary API calls when just force=true)
    if (params.expectedHash) {
      const currentFiles = await this.gasClient.getProjectContent(fromProjectId, accessToken);
      const sourceFile = currentFiles.find((f: any) => fileNameMatches(f.name, fromFilename));

      if (sourceFile) {
        checkForConflictOrThrow({
          scriptId: fromProjectId,
          filename: fromFilename,
          operation: 'mv',
          currentRemoteContent: sourceFile.source || '',
          expectedHash: params.expectedHash,
          hashSource: 'param',
          force: params.force
        });
      }
    }
    // === END HASH-BASED CONFLICT DETECTION ===

    // Always use GitOperationManager for proper workflow:
    // 1. Compute changes (source delete + dest create)
    // 2. Validate with hooks (single atomic commit for both)
    // 3. Write to remote
    // Git repo will be created automatically if it doesn't exist
    const operation = new MoveOperationStrategy({
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
    const defaultMessage = `Move ${fromFilename} to ${toFilename}`;

    const gitResult = await gitManager.executeWithGit(operation, {
      scriptId: fromProjectId,  // Use source project for git operations
      files: [fromFilename, toFilename],
      changeReason: params.changeReason || defaultMessage,
      accessToken
    });

    // Add message field required by tool's MoveResult type
    const moveResult = gitResult.result;
    const isCrossProject = fromProjectId !== toProjectId;

    // GitOperationManager handles local file overwrite + xattr cache for destination.
    // Source file deletion + cache clear also handled by GitOperationManager (empty content = delete).

    // Return response with compact git hints for LLM guidance
    // Exclude wrappedContent from response (internal use only for hash computation)
    const { wrappedContent: _unused, ...moveResultForResponse } = moveResult;
    return {
      ...moveResultForResponse,
      message: isCrossProject
        ? `Moved ${fromFilename} from project ${fromProjectId.substring(0, 8)}... to ${toFilename} in project ${toProjectId.substring(0, 8)}...`
        : `Moved ${fromFilename} to ${toFilename} within project ${fromProjectId.substring(0, 8)}...`,
      // Compact git hint from GitOperationManager
      git: gitResult.git?.hint,
    } as MoveResult;
  }
}
