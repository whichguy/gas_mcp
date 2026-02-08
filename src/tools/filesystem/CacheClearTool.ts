import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath } from '../../api/pathParser.js';
import { ValidationError } from '../../errors/mcpErrors.js';
import { clearGASMetadata, hasCachedMetadata } from '../../utils/gasMetadataCache.js';
import { LocalFileManager } from '../../utils/localFileManager.js';
import { join } from 'path';

/**
 * Clear cached metadata from local files
 *
 * Removes extended attributes containing GAS metadata (updateTime, fileType)
 * from local cache files. Useful for debugging, troubleshooting, and forcing
 * fresh API calls to verify sync status.
 */
export class CacheClearTool extends BaseFileSystemTool {
  public name = 'mcp__gas__cache_clear';
  public description = '[FILE] Clear cached GAS metadata from local files. Removes extended attributes containing updateTime and fileType, forcing subsequent operations to use API calls for fresh data. Useful for debugging and troubleshooting sync issues.';

  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to file or directory: scriptId/path/to/file (for single file) or scriptId (for entire project). Extensions are automatically added. Clears cached metadata without affecting file content.',
        pattern: '^[a-zA-Z0-9_-]{25,60}(/[a-zA-Z0-9_.//-]*)?$',
        minLength: 25,
        examples: [
          'abc123def456.../fibonacci',
          'abc123def456.../utils/helpers',
          'abc123def456...',  // Clear entire project
        ],
        llmHints: {
          format: 'scriptId/filename (no extension) or scriptId for entire project',
          extensions: 'Tool automatically handles .gs, .html, .json extensions',
          scope: 'Single file: clears one file | Project (scriptId only): clears all files',
          behavior: 'Only clears cached metadata (xattr), does not modify file content',
          useCase: 'Debug sync issues, force fresh API calls, verify cache behavior'
        }
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['path'],
    llmGuidance: {
      whenToUse: 'Debug sync issues | Force fresh API call to verify metadata | Test cache behavior',
      effect: 'Clears xattr metadata only (not file content) | Next operation re-caches via API'
    }
  };

  async execute(params: any): Promise<any> {
    const path = this.validate.filePath(params.path, 'cache clearing');
    const parsedPath = parsePath(path);

    // Determine if this is a file or project-wide operation
    const isProjectWide = !parsedPath.isFile;

    if (isProjectWide) {
      // Clear cache for entire project
      return await this.clearProjectCache(parsedPath.scriptId, path);
    } else {
      // Clear cache for single file
      return await this.clearFileCache(parsedPath, path);
    }
  }

  private async clearFileCache(parsedPath: any, fullPath: string): Promise<any> {
    const projectName = parsedPath.scriptId;
    const filename = parsedPath.filename!;

    // Resolve local file path
    const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
    const fullFilename = filename + fileExtension;
    const projectPath = await LocalFileManager.getProjectDirectory(projectName);

    if (!projectPath) {
      throw new ValidationError('path', fullPath, 'project not found in local cache');
    }

    const localFilePath = join(projectPath, fullFilename);

    // Check if metadata exists
    const hadMetadata = await hasCachedMetadata(localFilePath);

    // Clear metadata
    await clearGASMetadata(localFilePath);

    return {
      status: 'success',
      path: fullPath,
      scriptId: projectName,
      filename,
      hadMetadata,
      cleared: hadMetadata,
      message: hadMetadata
        ? 'Cached metadata cleared successfully. Next operation will use API call.'
        : 'No cached metadata found (file may not exist or metadata was already cleared).'
    };
  }

  private async clearProjectCache(scriptId: string, fullPath: string): Promise<any> {
    const projectPath = await LocalFileManager.getProjectDirectory(scriptId);

    if (!projectPath) {
      throw new ValidationError('path', fullPath, 'project not found in local cache');
    }

    // Get all files in project
    const { readdir, stat } = await import('fs/promises');
    const files = await readdir(projectPath);

    const results: Array<{filename: string, hadMetadata: boolean, cleared: boolean}> = [];
    let totalCleared = 0;

    for (const file of files) {
      const filePath = join(projectPath, file);
      const fileStat = await stat(filePath);

      // Only process regular files, skip directories
      if (!fileStat.isFile()) {
        continue;
      }

      // Check and clear metadata
      const hadMetadata = await hasCachedMetadata(filePath);

      if (hadMetadata) {
        await clearGASMetadata(filePath);
        totalCleared++;
      }

      results.push({
        filename: file,
        hadMetadata,
        cleared: hadMetadata
      });
    }

    return {
      status: 'success',
      path: fullPath,
      scriptId,
      scope: 'project',
      totalFiles: results.length,
      totalCleared,
      files: results,
      message: totalCleared > 0
        ? `Cleared cached metadata from ${totalCleared} file(s). Next operations will use API calls.`
        : 'No cached metadata found in any files.'
    };
  }
}
