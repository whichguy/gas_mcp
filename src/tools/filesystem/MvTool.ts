import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { resolveHybridScriptId } from '../../api/pathParser.js';
import { ValidationError, FileOperationError } from '../../errors/mcpErrors.js';
import { SCRIPT_ID_SCHEMA, ACCESS_TOKEN_SCHEMA } from './shared/schemas.js';
import type { MoveParams, MoveResult } from './shared/types.js';
import { GitOperationManager } from '../../core/git/GitOperationManager.js';
import { GitPathResolver } from '../../core/git/GitPathResolver.js';
import { SyncStrategyFactory } from '../../core/git/SyncStrategyFactory.js';
import { MoveOperationStrategy } from '../../core/git/operations/MoveOperationStrategy.js';

/**
 * Move or rename files in Google Apps Script project
 *
 * ✅ RECOMMENDED - Supports cross-project moves and CommonJS module name updates
 * Like Unix mv but handles GAS module system
 */
export class MvTool extends BaseFileSystemTool {
  public name = 'mv';
  public description = 'Move or rename files in Google Apps Script project. Supports cross-project moves and CommonJS module name updates. Like Unix mv but handles GAS module system.';

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
      accessToken: {
        ...ACCESS_TOKEN_SCHEMA
      }
    },
    required: ['scriptId', 'from', 'to']
  };

  async execute(params: MoveParams): Promise<MoveResult> {
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

    const result = await gitManager.executeWithGit(operation, {
      scriptId: fromProjectId,  // Use source project for git operations
      files: [fromFilename, toFilename],
      changeReason: params.changeReason || defaultMessage,
      accessToken
    });

    // Add message field required by tool's MoveResult type
    const moveResult = result.result;
    const isCrossProject = fromProjectId !== toProjectId;

    return {
      ...moveResult,
      message: isCrossProject
        ? `Moved ${fromFilename} from project ${fromProjectId.substring(0, 8)}... to ${toFilename} in project ${toProjectId.substring(0, 8)}...`
        : `Moved ${fromFilename} to ${toFilename} within project ${fromProjectId.substring(0, 8)}...`
    };
  }
}
