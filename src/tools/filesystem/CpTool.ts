import { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
import { resolveHybridScriptId } from '../../api/pathParser.js';
import { ValidationError, FileOperationError } from '../../errors/mcpErrors.js';
import { translatePathForOperation } from '../../utils/virtualFileTranslation.js';
import { shouldWrapContent, unwrapModuleContent, wrapModuleContent, getModuleName } from '../../utils/moduleWrapper.js';
import { SCRIPT_ID_SCHEMA, ACCESS_TOKEN_SCHEMA } from './shared/schemas.js';
import type { CopyParams, CopyResult } from './shared/types.js';

/**
 * Copy files in Google Apps Script project with CommonJS processing
 *
 * ✅ RECOMMENDED - Unwraps source module, rewraps for destination
 * Like Unix cp but handles module system
 */
export class CpTool extends BaseFileSystemTool {
  public name = 'cp';
  public description = 'Copy files in Google Apps Script project with CommonJS processing. Unwraps source module, rewraps for destination. Like Unix cp but handles module system.';

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
          'utils-copy.gs',
          'backup/utils.gs',
          '1xyz9abc.../utils.gs'
        ]
      },
      accessToken: {
        ...ACCESS_TOKEN_SCHEMA
      }
    },
    required: ['scriptId', 'from', 'to'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Use to copy files with proper CommonJS module handling',
      workflow: 'Copy within project: cp({scriptId: "...", from: "utils", to: "utils-backup"}),',
      commonJsProcessing: 'Unwraps source module wrapper, applies new wrapper for destination with correct module name',
      examples: [
        'Copy within project: cp({scriptId: "1abc2def...", from: "utils", to: "utils-backup"})',
        'Cross-project copy: cp({scriptId: "1abc2def...", from: "utils", to: "1xyz9abc.../utils"})',
        'Copy to subfolder: cp({scriptId: "1abc2def...", from: "main", to: "archive/main-v1"})',
        'Copy with rename: cp({scriptId: "1abc2def...", from: "Calculator", to: "CalcBackup"})'
      ],
      vsRawCp: 'Use raw_cp for bulk operations that need exact file preservation without CommonJS processing'
    }
  };

  async execute(params: CopyParams): Promise<CopyResult> {
    // SECURITY: Validate parameters BEFORE authentication
    const accessToken = await this.getAuthToken(params);

    // Apply virtual file translation for user-provided paths
    const translatedFrom = translatePathForOperation(params.from, true);
    const translatedTo = translatePathForOperation(params.to, true);

    // Resolve script IDs using hybrid approach (supports cross-project copies)
    const fromResolution = resolveHybridScriptId(params.scriptId, translatedFrom, 'copy operation (from)');
    const toResolution = resolveHybridScriptId(params.scriptId, translatedTo, 'copy operation (to)');

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
      throw new FileOperationError('copy', params.from, 'source file not found');
    }

    // COMMONJS PROCESSING: Unwrap source content (like cat)
    let processedContent = sourceFile.source || '';
    const fileType = sourceFile.type || 'SERVER_JS';

    if (shouldWrapContent(fileType, fromFilename)) {
      // Unwrap CommonJS from source (like cat does)
      const { unwrappedContent } = unwrapModuleContent(processedContent);
      if (unwrappedContent !== processedContent) {
        processedContent = unwrappedContent;
      }

      // Re-wrap for destination without options (user can set options manually with write)
      const moduleName = getModuleName(toFilename);
      processedContent = wrapModuleContent(processedContent, moduleName, undefined);
    }

    // Create copy in destination with processed content
    const updatedFiles = await this.gasClient.updateFile(
      toProjectId,
      toFilename,
      processedContent,
      undefined,
      accessToken,
      fileType as 'SERVER_JS' | 'HTML' | 'JSON'
    );

    return {
      status: 'copied',
      from: params.from,
      to: params.to,
      fromProjectId,
      toProjectId,
      isCrossProject: fromProjectId !== toProjectId,
      commonJsProcessed: shouldWrapContent(fileType, fromFilename),
      size: processedContent.length,
      totalFiles: updatedFiles.length,
      message: fromProjectId === toProjectId
        ? `Copied ${fromFilename} to ${toFilename} with CommonJS processing within project ${fromProjectId.substring(0, 8)}...`
        : `Copied ${fromFilename} from project ${fromProjectId.substring(0, 8)}... to ${toFilename} in project ${toProjectId.substring(0, 8)}... with CommonJS processing`
    };
  }
}
