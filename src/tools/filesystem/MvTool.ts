import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { resolveHybridScriptId } from '../../api/pathParser.js';
import { ValidationError, FileOperationError } from '../../errors/mcpErrors.js';
import { SCRIPT_ID_SCHEMA, ACCESS_TOKEN_SCHEMA } from './shared/schemas.js';
import type { MoveParams, MoveResult } from './shared/types.js';

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

    // Get source file content
    const sourceFiles = await this.gasClient.getProjectContent(fromProjectId, accessToken);
    const sourceFile = sourceFiles.find((f: any) => f.name === fromFilename);

    if (!sourceFile) {
      throw new FileOperationError('move', params.from, 'source file not found');
    }

    // For cross-project moves, we copy then delete. For same-project, we can rename in place.
    if (fromProjectId === toProjectId) {
      // Same project: rename/move file
      await this.gasClient.updateFile(toProjectId, toFilename, sourceFile.source || '', undefined, accessToken);
      const updatedFiles = await this.gasClient.deleteFile(fromProjectId, fromFilename, accessToken);

      return {
        status: 'moved',
        from: params.from,
        to: params.to,
        fromProjectId,
        toProjectId,
        isCrossProject: false,
        totalFiles: updatedFiles.length,
        message: `Moved ${fromFilename} to ${toFilename} within project ${fromProjectId.substring(0, 8)}...`
      };
    } else {
      // Cross-project: copy to destination, then delete from source
      await this.gasClient.updateFile(toProjectId, toFilename, sourceFile.source || '', undefined, accessToken);
      const updatedSourceFiles = await this.gasClient.deleteFile(fromProjectId, fromFilename, accessToken);

      // Get destination file count
      const destFiles = await this.gasClient.getProjectContent(toProjectId, accessToken);

      return {
        status: 'moved',
        from: params.from,
        to: params.to,
        fromProjectId,
        toProjectId,
        isCrossProject: true,
        sourceFilesRemaining: updatedSourceFiles.length,
        destFilesTotal: destFiles.length,
        message: `Moved ${fromFilename} from project ${fromProjectId.substring(0, 8)}... to ${toFilename} in project ${toProjectId.substring(0, 8)}...`
      };
    }
  }
}
