import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { parsePath } from '../../api/pathParser.js';
import { ValidationError } from '../../errors/mcpErrors.js';
import { checkSyncOrThrow, setFileMtimeToRemote } from '../../utils/fileHelpers.js';
import { join, dirname } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { SCRIPT_ID_SCHEMA, PATH_SCHEMA, CONTENT_SCHEMA, ACCESS_TOKEN_SCHEMA, FILE_TYPE_SCHEMA } from './shared/schemas.js';

/**
 * Write raw file contents with explicit project paths
 *
 * ⚠️ ADVANCED TOOL - DANGER: Completely overwrites files without CommonJS processing or merging
 * Use write for safe CommonJS-wrapped development
 */
export class RawWriteTool extends BaseFileSystemTool {
  public name = 'raw_write';
  public description = 'Write raw file contents with explicit project paths. DANGER: Completely overwrites files without CommonJS processing or merging. Use write for safe CommonJS-wrapped development.';

  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Full path to file: scriptId/filename (WITHOUT extension). LLM CRITICAL: Extensions like .gs, .html, .json are AUTOMATICALLY added. Google Apps Script auto-detects file type from content. SPECIAL CASE: appsscript.json must be in project root (scriptId/appsscript), never in subfolders. REQUIRED: Must include explicit scriptId prefix (e.g., "abc123def.../filename") - current project context is not used.',
        pattern: '^[a-zA-Z0-9_-]{20,60}/[a-zA-Z0-9_.//-]+$',
        minLength: 25,
        examples: [
          'abc123def456.../fibonacci',
          'abc123def456.../utils/helpers',
          'abc123def456.../Code',
          'abc123def456.../models/User',
          'abc123def456.../appsscript'
        ],
        llmHints: {format: 'scriptId/filename (no extension)', extensions: 'Tool automatically adds .gs for JavaScript, .html for HTML, .json for JSON', organization: 'Use "/" in filename for logical organization (not real folders)', specialFiles: 'appsscript.json MUST be in root: scriptId/appsscript (never scriptId/subfolder/appsscript)', warning: 'This tool OVERWRITES the entire file - use write for safer merging', autoDetection: 'File type detected from content: JavaScript, HTML, JSON'}
      },
      content: {
        ...CONTENT_SCHEMA,
        description: 'File content to write. ⚠️ WARNING: This content will COMPLETELY REPLACE the existing file. LLM FLEXIBILITY: Supports JavaScript/Apps Script, HTML, JSON. Content type automatically detected for proper file extension.',
        llmHints: {javascript: 'Apps Script functions, ES6+ syntax, Google services (SpreadsheetApp, etc.)', html: 'HTML templates for web apps, can include CSS and JavaScript', json: 'Configuration files like appsscript.json for project settings', limits: 'File size limits enforced by Google Apps Script API', encoding: 'UTF-8 encoding, supports international characters', danger: 'This content will OVERWRITE the entire remote file - existing content will be lost'}
      },
      position: {
        type: 'number',
        description: 'File execution order position (0-based). LLM USE: Controls order in Apps Script editor and execution sequence. Lower numbers execute first.',
        minimum: 0,
        llmHints: {execution: 'Lower numbers execute first in Apps Script runtime', organization: 'Use for dependencies: utilities first (0), main code later (1,2,3)', optional: 'Omit to append at end of file list', reordering: 'Use reorder tool to change position later'}
      },
      fileType: {
        ...FILE_TYPE_SCHEMA,
        description: 'File type for Google Apps Script. REQUIRED: Must be explicitly specified.'
      },
      accessToken: {
        ...ACCESS_TOKEN_SCHEMA
      }
    },
    required: ['path', 'content', 'fileType'],
    additionalProperties: false,
    llmWorkflowGuide: {
      prerequisites: ['1.auth({mode:"status"})→auth({mode:"start"}) if needed', '2.project: create new|get scriptId via ls', '3.⚠️ VERIFY: You intend to COMPLETELY OVERWRITE the target file'],
      dangerWarning: {behavior: 'This tool CLOBBERS (completely overwrites) remote files without merging', consequence: 'Any existing content in the target file will be PERMANENTLY LOST', recommendation: 'Use write instead for safe merging of local and remote content', useCase: 'Only use raw_write when you explicitly intend to replace entire file contents'},
      saferAlternative: {tool: 'write', benefits: ['Intelligent merging of local and remote file content', 'Preserves existing code while adding new content', 'Safer for collaborative development', 'Same path format but with merge protection'], when: 'Use write for most file writing operations unless you specifically need to clobber files'},
      useCases: {newFile: 'Creating completely new files from scratch', replace: 'Intentionally replacing entire file contents', bulk: 'Bulk operations where clobbering is intended', config: 'Replacing configuration files like appsscript.json', avoid: '⚠️ AVOID for: Updating existing files, collaborative editing, preserving content'},
      fileTypes: {javascript: 'Content with functions → .gs file (SERVER_JS type)', html: 'Content with HTML tags → .html file (HTML type)', json: 'Content with JSON format → .json file (JSON type)'},
      bestPractices: ['⚠️ CRITICAL: Only use when you intend to completely replace file contents', 'Consider write for safer merging operations', 'Use descriptive filenames that indicate purpose', 'Organize related functions in same file', 'Put utility functions in separate files at position 0', 'Use logical "/" paths for organization: utils/helpers, models/User'],
      afterWriting: ['Use run to execute functions from this file', 'Use cat to verify file was written correctly', 'Use ls to see file in project structure', '⚠️ Verify that file clobbering was intentional']
    }
  };

  async execute(params: any): Promise<any> {
    // SECURITY: Validate path BEFORE authentication
    const path = this.validate.filePath(params.path, 'file writing');
    const position = params.position !== undefined ? this.validate.number(params.position, 'position', 'file writing', 0) : undefined;

    const parsedPath = parsePath(path);

    if (!parsedPath.isFile) {
      throw new ValidationError('path', path, 'file path (must include filename)');
    }

    // ⚠️ SPECIAL FILE VALIDATION: appsscript.json must be in root
    let filename = parsedPath.filename!;
    if (filename.toLowerCase() === 'appsscript' || filename.toLowerCase() === 'appsscript.json') {
      // Check if appsscript is being placed in subfolder (path has directory)
      if (parsedPath.directory && parsedPath.directory !== '') {
        throw new ValidationError(
          'path',
          path,
          'appsscript.json must be in project root (scriptId/appsscript), not in subfolders'
        );
      }
    }

    // ✅ SIMPLIFIED FILE TYPE HANDLING - fileType is now REQUIRED
    const gasFileType = params.fileType as 'SERVER_JS' | 'HTML' | 'JSON';

    // Strip extensions only if they match the declared file type
    let extensionStripped = false;
    if (gasFileType === 'SERVER_JS') {
      if (filename.toLowerCase().endsWith('.js')) {
        filename = filename.slice(0, -3);
        extensionStripped = true;
      } else if (filename.toLowerCase().endsWith('.gs')) {
        filename = filename.slice(0, -3);
        extensionStripped = true;
      }
    } else if (gasFileType === 'HTML') {
      if (filename.toLowerCase().endsWith('.html')) {
        filename = filename.slice(0, -5);
        extensionStripped = true;
      } else if (filename.toLowerCase().endsWith('.htm')) {
        filename = filename.slice(0, -4);
        extensionStripped = true;
      }
    } else if (gasFileType === 'JSON') {
      if (filename.toLowerCase().endsWith('.json')) {
        filename = filename.slice(0, -5);
        extensionStripped = true;
      }
    }

    // REDUCED CONTENT VALIDATION: Only basic safety checks
    const content: string = params.content;

    // Only validate critical safety issues, not syntax
    if (content.includes('<script>') && content.includes('document.write') && gasFileType !== 'HTML') {
      // Warning only - allow operation to proceed
    }

    // After validation passes, check authentication
    const accessToken = await this.getAuthToken(params);

    // ✅ NEW: Write-protection - check sync before writing
    const { LocalFileManager } = await import('../../utils/localFileManager.js');
    const localRoot = await LocalFileManager.getProjectDirectory(parsedPath.scriptId);

    if (localRoot) {
      const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
      const localPath = join(localRoot, filename + fileExtension);

      try {
        // Get remote metadata to check sync
        const remoteFiles = await this.gasClient.getProjectMetadata(parsedPath.scriptId, accessToken);
        await checkSyncOrThrow(localPath, filename, remoteFiles);
      } catch (syncError: any) {
        // Only throw if it's an actual sync conflict, not "file doesn't exist"
        if (syncError.message && syncError.message.includes('out of sync')) {
          throw syncError;
        }
        // File doesn't exist locally or remotely - that's fine for raw_write
      }
    }

    const updatedFiles = await this.gasClient.updateFile(
      parsedPath.scriptId,
      filename,
      content,
      position,
      accessToken,
      gasFileType
    );

    // ✅ NEW: Sync to local cache with remote mtime (write-through cache)
    try {
      const { LocalFileManager } = await import('../../utils/localFileManager.js');
      const localRoot = await LocalFileManager.getProjectDirectory(parsedPath.scriptId);

      if (localRoot) {
        // Write to local cache
        const fileExtension = LocalFileManager.getFileExtensionFromName(filename);
        const localPath = join(localRoot, filename + fileExtension);
        await mkdir(dirname(localPath), { recursive: true });
        await writeFile(localPath, content, 'utf-8');

        // Find remote updateTime and set local mtime to match
        const remoteFile = updatedFiles.find((f: any) => f.name === filename);
        if (remoteFile?.updateTime) {
          await setFileMtimeToRemote(localPath, remoteFile.updateTime);
        }
      }
    } catch (syncError) {
      // Don't fail the operation if local sync fails - remote write succeeded
    }

    return {
      status: 'success',
      path,
      scriptId: parsedPath.scriptId,
      filename: filename,
      size: content.length,
      position: updatedFiles.findIndex((f: any) => f.name === filename),
      totalFiles: updatedFiles.length
    };
  }
}
