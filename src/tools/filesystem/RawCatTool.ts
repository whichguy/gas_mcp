import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath } from '../../api/pathParser.js';
import { ValidationError, FileOperationError } from '../../errors/mcpErrors.js';
import { setFileMtimeToRemote } from '../../utils/fileHelpers.js';
import { join, dirname } from 'path';
import { mkdir, writeFile } from 'fs/promises';

/**
 * Read raw file contents with full CommonJS wrappers
 *
 * ⚠️ ADVANCED TOOL - Use cat for normal development
 * Shows complete file including _main() wrapper and system code
 */
export class RawCatTool extends BaseFileSystemTool {
  public name = 'raw_cat';
  public description = 'Read raw file contents with full CommonJS wrappers and system code. Shows complete file including _main() function and module infrastructure. Use cat for clean user code.';

  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Full path to file: scriptId/path/to/filename_WITHOUT_EXTENSION (supports virtual paths, extensions auto-detected). REQUIRED: Must include explicit scriptId prefix (e.g., "abc123def.../filename") - current project context is not used.'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['path']
  };

  async execute(params: any): Promise<any> {
    const path = this.validate.filePath(params.path, 'file reading');
    const parsedPath = parsePath(path);

    if (!parsedPath.isFile) {
      throw new ValidationError('path', path, 'file path (must include filename)');
    }

    const accessToken = await this.getAuthToken(params);

    const files = await this.gasClient.getProjectContent(parsedPath.scriptId, accessToken);
    const file = files.find((f: any) => f.name === parsedPath.filename);

    if (!file) {
      throw new FileOperationError('read', path, 'file not found');
    }

    // Optionally sync to local cache with remote mtime
    try {
      const { LocalFileManager } = await import('../../utils/localFileManager.js');
      const localRoot = await LocalFileManager.getProjectDirectory(parsedPath.scriptId);

      if (localRoot && file.updateTime && parsedPath.filename) {
        const fileExtension = LocalFileManager.getFileExtensionFromName(parsedPath.filename);
        const localPath = join(localRoot, parsedPath.filename + fileExtension);
        await mkdir(dirname(localPath), { recursive: true });
        await writeFile(localPath, file.source || '', 'utf-8');
        await setFileMtimeToRemote(localPath, file.updateTime, file.type);
      }
    } catch (syncError) {
      // Don't fail if local sync fails
    }

    return {
      path,
      scriptId: parsedPath.scriptId,
      filename: parsedPath.filename,
      type: file.type,
      content: file.source || '',
      size: (file.source || '').length,
      updateTime: file.updateTime
    };
  }
}
