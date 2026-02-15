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
      whenToUse: 'Debug CommonJS wrapper issues | View system infrastructure code | Compare wrapped vs unwrapped content',
      catVsRawCat: {
        cat: 'Use 99% of the time - returns clean user code without _main() wrapper, hash matches unwrapped content',
        raw_cat: 'Use for debugging - returns full file including _main() wrapper, initModule(), and system code'
      },
      whenToUseRawCat: [
        'Debugging CommonJS require() resolution issues',
        'Viewing system files (common-js/require, __mcp_exec)',
        'Understanding how loadNow/hoistedFunctions affect wrapper generation',
        'Comparing local git hash with remote (raw_cat hash matches git hash-object)'
      ],
      responseFields: {
        content: 'Full file content INCLUDING _main() wrapper and module infrastructure',
        hash: 'Git SHA-1 of WRAPPED content (matches git hash-object on local synced file)',
        hashNote: 'Explains that hash is on wrapped content'
      },
      troubleshooting: {
        wrongHash: 'If cat hash != raw_cat hash, the difference is the CommonJS wrapper',
        systemFiles: 'common-js/require and __mcp_exec are system files - use raw_cat to view',
        wrapperIssues: 'Check loadNow setting in moduleOptions if module not initializing'
      }
    }
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

    return result;
  }
}
