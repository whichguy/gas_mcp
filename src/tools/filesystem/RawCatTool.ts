import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath, fileNameMatches } from '../../api/pathParser.js';
import { ValidationError, FileOperationError } from '../../errors/mcpErrors.js';
import { setFileMtimeToRemote } from '../../utils/fileHelpers.js';
import { getGitBreadcrumbHint } from '../../utils/gitBreadcrumbHints.js';
import { computeGitSha1 } from '../../utils/hashUtils.js';
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
  public description = '[FILE:RAW:READ] Read file with full CommonJS wrappers visible — shows _main() function and module infrastructure. WHEN: debugging module system issues, inspecting loadNow/hoistedFunctions, or viewing exact GAS source. AVOID: use cat for clean user code. Example: raw_cat({scriptId, path: "Utils.gs"})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Full path including scriptId' },
      scriptId: { type: 'string', description: 'GAS project ID' },
      filename: { type: 'string', description: 'File name without scriptId prefix' },
      type: { type: 'string', description: 'GAS file type (SERVER_JS, HTML, JSON)' },
      content: { type: 'string', description: 'Raw file content including CommonJS wrappers' },
      size: { type: 'number', description: 'Content size in bytes' },
      updateTime: { type: 'string', description: 'Remote file update timestamp' },
      hash: { type: 'string', description: 'Git SHA-1 hash of raw content' },
      hashNote: { type: 'string', description: 'Explanation of hash computation' },
      git: { type: 'object', description: 'Git workflow hint for LLM guidance' }
    }
  };

  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Full path to file: scriptId/path/to/filename_WITHOUT_EXTENSION (supports virtual paths, extensions auto-detected). REQUIRED: Must include explicit scriptId prefix (e.g., "abc123def.../filename") - current project context is not used.',
        examples: ['abc123.../common-js/require', 'abc123.../__mcp_exec', 'abc123.../Code']
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['path'],
    additionalProperties: false,
    llmGuidance: {
      vsCat: 'cat=99% of time (clean code). raw_cat=debugging wrappers, system files (common-js/require, __mcp_exec), hash comparison (raw_cat hash matches git hash-object)',
      troubleshooting: 'cat hash != raw_cat hash→CommonJS wrapper difference | module not loading→check loadNow in moduleOptions'
    }
  };

  public annotations = {
    title: 'Read File (Raw)',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
  };

  async execute(params: any): Promise<any> {
    const path = this.validate.filePath(params.path, 'file reading');
    const parsedPath = parsePath(path);

    if (!parsedPath.isFile) {
      throw new ValidationError('path', path, 'file path (must include filename)');
    }

    const accessToken = await this.getAuthToken(params);

    const files = await this.gasClient.getProjectContent(parsedPath.scriptId, accessToken);
    const file = files.find((f: any) => fileNameMatches(f.name, parsedPath.filename!));

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

    const content = file.source || '';

    // Compute hash on WRAPPED content (full file as stored in GAS)
    // Both CatTool and RawCatTool hash WRAPPED content for consistency
    // This ensures hash matches `git hash-object <file>` on local synced files
    const rawHash = computeGitSha1(content);

    const result: any = {
      path,
      scriptId: parsedPath.scriptId,
      filename: parsedPath.filename,
      type: file.type,
      content,
      size: content.length,
      updateTime: file.updateTime,
      hash: rawHash,  // Hash of RAW content (with wrappers)
      hashNote: 'Hash computed on raw content including CommonJS wrappers. For unwrapped content hash, use cat tool.'
    };

    // Add git breadcrumb hint for .git/* files
    const gitHint = getGitBreadcrumbHint(parsedPath.filename || '');
    if (gitHint) {
      result.gitBreadcrumbHint = gitHint;
    }

    // Add git workflow hint
    try {
      const { LocalFileManager } = await import('../../utils/localFileManager.js');
      const repoPath = await LocalFileManager.getProjectDirectory(parsedPath.scriptId);
      if (repoPath) {
        const { buildReadHint } = await import('../../utils/gitStatus.js');
        result.git = await buildReadHint(repoPath);
      }
    } catch { /* non-fatal */ }

    return result;
  }
}
