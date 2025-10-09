import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath, resolveHybridScriptId } from '../../api/pathParser.js';
import { ValidationError } from '../../errors/mcpErrors.js';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { SCRIPT_ID_SCHEMA, PATH_SCHEMA, ACCESS_TOKEN_SCHEMA } from './shared/schemas.js';
import type { RemoveParams, RemoveResult } from './shared/types.js';

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

    const updatedFiles = await this.gasClient.deleteFile(parsedPath.scriptId, parsedPath.filename!, accessToken);

    // Remove from local cache if it exists
    let localDeleted = false;
    try {
      const { LocalFileManager } = await import('../../utils/localFileManager.js');
      const localRoot = await LocalFileManager.getProjectDirectory(parsedPath.scriptId);

      if (localRoot && parsedPath.filename) {
        const fileExtension = LocalFileManager.getFileExtensionFromName(parsedPath.filename);
        const localPath = join(localRoot, parsedPath.filename + fileExtension);

        try {
          await unlink(localPath);
          localDeleted = true;
        } catch (unlinkError: any) {
          if (unlinkError.code !== 'ENOENT') {
            // File doesn't exist locally
          }
        }
      }
    } catch (cacheError) {
      // Local cache cleanup failed (non-fatal)
    }

    return {
      success: true,
      path,
      localDeleted,
      remoteDeleted: true
    };
  }
}
