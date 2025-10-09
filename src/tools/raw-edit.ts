import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ValidationError, FileOperationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { parsePath } from '../api/pathParser.js';
import { SchemaFragments } from '../utils/schemaFragments.js';

interface RawEditOperation {
  oldText: string;
  newText: string;
  index?: number;
}

interface RawEditParams {
  path: string; // Full path with scriptId prefix
  edits: RawEditOperation[];
  dryRun?: boolean;
  fuzzyWhitespace?: boolean;
  accessToken?: string;
}

interface RawEditResult {
  success: boolean;
  editsApplied: number;
  diff?: string;
  filePath: string;
  tokenSavings?: {
    vsFullFile: number;
    outputTokensUsed: number;
    outputTokensSaved: number;
  };
}

/**
 * Token-efficient file editing with exact string matching on raw content
 *
 * Like EditTool but operates on raw file content including CommonJS wrappers.
 * Use for editing system files or when you need to modify module infrastructure.
 */
export class RawEditTool extends BaseTool {
  public name = 'raw_edit';
  public description = 'Token-efficient file editing using exact string matching on raw file content (includes CommonJS wrappers). Use for editing system files or module infrastructure. Provides 83% token savings vs gas_raw_write.';

  public inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Full path to file: scriptId/filename (WITHOUT extension). REQUIRED: Must include explicit scriptId prefix (e.g., "abc123def.../filename") - current project context is not used.',
        pattern: '^[a-zA-Z0-9_-]{20,60}/[a-zA-Z0-9_.//-]+$',
        minLength: 25,
        examples: [
          'abc123def456.../CommonJS',
          'abc123def456.../utils/helpers'
        ]
      },
      edits: {
        type: 'array',
        description: 'Array of edit operations to apply sequentially on raw content (includes CommonJS wrappers)',
        items: {
          type: 'object',
          properties: {
            oldText: {
              type: 'string',
              description: 'Exact text to find and replace in raw content. Must match character-for-character including CommonJS wrappers.',
              minLength: 1
            },
            newText: {
              type: 'string',
              description: 'Replacement text'
            },
            index: {
              type: 'number',
              description: 'Which occurrence to replace if oldText appears multiple times (0-based)',
              minimum: 0
            }
          },
          required: ['oldText', 'newText'],
          additionalProperties: false
        },
        minItems: 1,
        maxItems: 20
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying them. Returns git-style diff.',
        default: false
      },
      fuzzyWhitespace: {
        type: 'boolean',
        description: 'Tolerate whitespace differences (normalize spaces/tabs)',
        default: false
      },
      ...SchemaFragments.accessToken
    },
    required: ['path', 'edits'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Use for editing raw file content including CommonJS wrappers. For user code editing, prefer gas_edit.',
      contentDifference: 'gas_raw_edit operates on complete file content including _main() wrappers and __defineModule__ calls. gas_edit operates on clean user code.',
      tokenSavings: 'Saves 95%+ output tokens vs gas_raw_write. Minimal response by default (~10 tokens vs thousands).',
      examples: [
        'Edit CommonJS wrapper: raw_edit({path: "abc123.../CommonJS", edits: [{oldText: "function _main(", newText: "function _mainWrapper("}]})',
        'Edit system file: raw_edit({path: "abc123.../__mcp_gas_run", edits: [...]})'
      ],
      vsGasEdit: 'gas_edit unwraps CommonJS for editing, gas_raw_edit preserves exact content',
      scriptTypeCompatibility: {
        standalone: '✅ Full Support',
        containerBound: '✅ Full Support',
        notes: 'Raw editing works universally for both script types.'
      }
    },
    llmHints: {
      preferOver: {
        gas_raw_write: 'When making small changes to system files - raw_edit saves 95%+ tokens by only outputting changed text',
        gas_edit: 'When you need to modify CommonJS wrappers or system infrastructure - gas_edit unwraps content'
      },
      idealUseCases: [
        'Editing CommonJS system files (CommonJS.js)',
        'Modifying execution infrastructure (__mcp_gas_run.js)',
        'Updating module wrappers (_main functions)',
        'Fixing system-level bugs in infrastructure code',
        'Patching auto-generated code that needs exact content preservation'
      ],
      avoidWhen: [
        'Editing user code (use gas_edit instead - it unwraps CommonJS automatically)',
        'Creating new system files (use gas_raw_write instead)',
        'Refactoring entire system architecture (use gas_raw_write instead)',
        'Normal application development (use gas_edit for user code)'
      ],
      responseOptimization: 'Response is minimal by default (~10 tokens). Use dryRun: true to see full diff before applying changes.',
      tokenEconomics: 'Output tokens cost 5x input ($15/M vs $3/M for Claude Sonnet 4.5). Minimize response size for maximum cost savings.',
      systemFileWarning: 'Only use for system files. For user code, use gas_edit which handles CommonJS automatically.'
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: RawEditParams): Promise<RawEditResult> {
    // Validate inputs
    if (!params.edits || params.edits.length === 0) {
      throw new ValidationError('edits', params.edits, 'at least one edit operation required');
    }

    if (params.edits.length > 20) {
      throw new ValidationError('edits', params.edits, 'maximum 20 edit operations per call');
    }

    // Parse path to extract scriptId and filename
    const parsedPath = parsePath(params.path);
    if (!parsedPath.isFile || !parsedPath.filename) {
      throw new ValidationError('path', params.path, 'file path must include a filename');
    }

    const scriptId = parsedPath.scriptId;
    const filename = parsedPath.filename;

    // Get authentication token
    const accessToken = await this.getAuthToken(params);

    // Read current file content from remote (raw content)
    const allFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
    const fileContent = allFiles.find((f: any) => f.name === filename);

    if (!fileContent) {
      throw new ValidationError('filename', filename, 'existing file in the project');
    }
    let content: string = fileContent.source || '';
    const originalContent = content;
    let editsApplied = 0;

    // Apply edits sequentially
    for (const [idx, edit] of params.edits.entries()) {
      const { oldText, newText, index } = edit;

      // Normalize whitespace if requested
      const searchText = params.fuzzyWhitespace
        ? this.normalizeWhitespace(oldText)
        : oldText;
      const contentToSearch = params.fuzzyWhitespace
        ? this.normalizeWhitespace(content)
        : content;

      // Find all occurrences
      const occurrences = this.findAllOccurrences(contentToSearch, searchText);

      if (occurrences.length === 0) {
        throw new FileOperationError(
          `raw_edit (${idx + 1})`,
          params.path,
          `Text not found: "${oldText.substring(0, 50)}${oldText.length > 50 ? '...' : ''}"`
        );
      }

      // Handle multiple matches
      if (occurrences.length > 1 && index === undefined) {
        throw new FileOperationError(
          `raw_edit (${idx + 1})`,
          params.path,
          `Found ${occurrences.length} occurrences of text. Specify 'index' parameter to choose which one (0-based).`
        );
      }

      const targetIndex = index !== undefined ? index : 0;
      if (targetIndex >= occurrences.length) {
        throw new FileOperationError(
          `raw_edit (${idx + 1})`,
          params.path,
          `Index ${targetIndex} out of range (found ${occurrences.length} occurrences)`
        );
      }

      // Apply replacement
      const position = occurrences[targetIndex];
      content = content.substring(0, position) +
                newText +
                content.substring(position + oldText.length);

      editsApplied++;
    }

    // Check if any changes were made
    if (content === originalContent) {
      return {
        success: true,
        editsApplied: 0,
        filePath: params.path,
        diff: 'No changes (edits already applied)'
      };
    }

    // Dry-run mode: return diff without writing
    if (params.dryRun) {
      const diff = this.generateDiff(originalContent, content, params.path);
      return {
        success: true,
        editsApplied,
        diff,
        filePath: params.path
      };
    }

    // Write modified content back to remote
    await this.gasClient.updateFile(scriptId, filename, content, undefined, accessToken, fileContent.type as 'SERVER_JS' | 'HTML' | 'JSON');

    // Return minimal response for token efficiency
    return {
      success: true,
      editsApplied,
      filePath: params.path
    };
  }

  /**
   * Find all occurrences of search text in content
   */
  private findAllOccurrences(content: string, searchText: string): number[] {
    const positions: number[] = [];
    let pos = 0;

    while ((pos = content.indexOf(searchText, pos)) !== -1) {
      positions.push(pos);
      pos += searchText.length;
    }

    return positions;
  }

  /**
   * Normalize whitespace for fuzzy matching
   */
  private normalizeWhitespace(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, '  ')
      .replace(/[ \t]+/g, ' ');
  }

  /**
   * Detect file type from content
   */
  private detectFileType(content: string): 'SERVER_JS' | 'HTML' | 'JSON' {
    if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
      return 'JSON';
    }
    if (content.includes('<html') || content.includes('<!DOCTYPE')) {
      return 'HTML';
    }
    return 'SERVER_JS';
  }

  /**
   * Generate git-style unified diff
   */
  private generateDiff(original: string, modified: string, path: string): string {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');

    const diff: string[] = [];
    diff.push(`--- a/${path}`);
    diff.push(`+++ b/${path}`);

    let i = 0;
    let j = 0;

    while (i < originalLines.length || j < modifiedLines.length) {
      if (i < originalLines.length && j < modifiedLines.length) {
        if (originalLines[i] === modifiedLines[j]) {
          diff.push(` ${originalLines[i]}`);
          i++;
          j++;
        } else {
          diff.push(`-${originalLines[i]}`);
          diff.push(`+${modifiedLines[j]}`);
          i++;
          j++;
        }
      } else if (i < originalLines.length) {
        diff.push(`-${originalLines[i]}`);
        i++;
      } else {
        diff.push(`+${modifiedLines[j]}`);
        j++;
      }
    }

    return diff.join('\n');
  }
}
