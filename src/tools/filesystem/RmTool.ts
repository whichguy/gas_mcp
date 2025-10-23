import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath, resolveHybridScriptId } from '../../api/pathParser.js';
import { ValidationError } from '../../errors/mcpErrors.js';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { SCRIPT_ID_SCHEMA, PATH_SCHEMA, ACCESS_TOKEN_SCHEMA } from './shared/schemas.js';
import type { RemoveParams, RemoveResult } from './shared/types.js';
import { GitOperationManager } from '../../core/git/GitOperationManager.js';
import { GitPathResolver } from '../../core/git/GitPathResolver.js';
import { SyncStrategyFactory } from '../../core/git/SyncStrategyFactory.js';
import { DeleteOperationStrategy } from '../../core/git/operations/DeleteOperationStrategy.js';

/**
 * Remove files from Google Apps Script project
 *
 * ✅ RECOMMENDED - Safe file deletion with local cache cleanup
 * Like Unix rm but works with GAS flat file structure
 */
export class RmTool extends BaseFileSystemTool {
  public name = 'rm';
  public description = 'Remove files from Google Apps Script project. Like Unix rm but works with GAS flat file structure using filename patterns.';

  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        ...SCRIPT_ID_SCHEMA
      },
      path: {
        ...PATH_SCHEMA,
        description: 'File path (filename only, or scriptId/filename if scriptId parameter is empty). Extensions are auto-detected and should not be included.'
      },
      changeReason: {
        type: 'string',
        description: 'Optional commit message for git integration. If omitted, defaults to "Delete {filename}". Git repo is created automatically if it doesn\'t exist.',
        examples: ['Remove unused utility', 'Delete deprecated file', 'Clean up old backup']
      },
      accessToken: {
        ...ACCESS_TOKEN_SCHEMA
      }
    },
    required: ['scriptId', 'path']
  };

  async execute(params: RemoveParams): Promise<RemoveResult> {
    const hybridResolution = resolveHybridScriptId(params.scriptId, params.path);
    const fullPath = `${hybridResolution.scriptId}/${hybridResolution.cleanPath}`;

    const path = this.validate.filePath(fullPath, 'file operation');
    const parsedPath = parsePath(path);

    if (!parsedPath.isFile) {
      throw new ValidationError('path', path, 'file path (must include filename)');
    }

    const accessToken = await this.getAuthToken(params);
    const filename = parsedPath.filename!;

    // Always use GitOperationManager for proper workflow:
    // 1. Compute changes (read file for backup)
    // 2. Validate with hooks (commit deletion)
    // 3. Write to remote (delete file)
    // Git repo will be created automatically if it doesn't exist
    const operation = new DeleteOperationStrategy({
      scriptId: parsedPath.scriptId,
      path: params.path,
      accessToken,
      gasClient: this.gasClient
    });

    const pathResolver = new GitPathResolver();
    const syncFactory = new SyncStrategyFactory();
    const gitManager = new GitOperationManager(pathResolver, syncFactory, this.gasClient);

    // Use provided changeReason or generate default
    const defaultMessage = `Delete ${filename}`;

    const result = await gitManager.executeWithGit(operation, {
      scriptId: parsedPath.scriptId,
      files: [filename],
      changeReason: params.changeReason || defaultMessage,
      accessToken
    });

    return {
      success: true,
      path,
      localDeleted: true,  // GitOperationManager handles local deletion
      remoteDeleted: result.result.remoteDeleted
    };
  }
}
