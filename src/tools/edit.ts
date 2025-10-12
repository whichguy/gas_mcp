import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ValidationError, FileOperationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { parsePath, resolveHybridScriptId } from '../api/pathParser.js';
import { unwrapModuleContent, wrapModuleContent, shouldWrapContent } from '../utils/moduleWrapper.js';
import { translatePathForOperation } from '../utils/virtualFileTranslation.js';
import { SchemaFragments } from '../utils/schemaFragments.js';

interface EditOperation {
  oldText: string;
  newText: string;
  index?: number; // Which occurrence to replace if multiple matches (0-based)
}

interface EditParams {
  scriptId: string;
  path: string;
  edits: EditOperation[];
  dryRun?: boolean;
  fuzzyWhitespace?: boolean;
  workingDir?: string;
  accessToken?: string;
}

interface EditResult {
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
 * Token-efficient file editing with exact string matching
 *
 * Provides ~83% token savings vs write by having LLM output only changed text
 * instead of entire file content. Uses client-side orchestration of cat + write.
 */
export class EditTool extends BaseTool {
  public name = 'edit';
  public description = 'Token-efficient file editing using exact string matching. LLM outputs only changed text (~40 tokens) instead of entire file (~4500 tokens), providing 83% token savings. Supports multi-edit operations, dry-run preview, and automatic CommonJS processing.';

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId44,
      ...SchemaFragments.path,
      edits: {
        type: 'array',
        description: 'Array of edit operations to apply sequentially. Each edit specifies exact old text and new text.',
        items: {
          type: 'object',
          properties: {
            oldText: {
              type: 'string',
              description: 'Exact text to find and replace. Must match character-for-character.',
              minLength: 1
            },
            newText: {
              type: 'string',
              description: 'Replacement text'
            },
            index: {
              type: 'number',
              description: 'Which occurrence to replace if oldText appears multiple times (0-based). If omitted and multiple matches found, operation fails.',
              minimum: 0
            }
          },
          required: ['oldText', 'newText'],
          additionalProperties: false
        },
        minItems: 1,
        maxItems: 20
      },
      ...SchemaFragments.dryRun,
      fuzzyWhitespace: {
        type: 'boolean',
        description: 'Tolerate whitespace differences (normalize spaces/tabs). Useful for code copied from formatted output.',
        default: false
      },
      ...SchemaFragments.workingDir,
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'path', 'edits'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Token-efficient: LLM outputs only changed text (~40tok) vs full file (~4.5k tok)',
      tokenSavings: '95%+ vs write (4.5k file+25tok change: write=4.5k | edit=~10tok)',
      examples: ['Single: edits:[{oldText:"const DEBUG=false",newText:"const DEBUG=true"}]', 'Multi: edits:[{oldText:"port:3000",newText:"port:8080"},{oldText:"host:localhost",newText:"host:0.0.0.0"}]', 'Dry-run: dryRun:true', 'Duplicates: edits:[{oldText:"assert(true)",newText:"expect(true)",index:1}]'],
      vsGasWrite: 'write: full file (4.5k tok) | edit: changed text (40 tok)',
      vsGasSed: 'sed: regex patterns | edit: exact strings (more reliable)',
      vsGasAider: 'edit: exact (simple,fast) | aider: fuzzy (handles variations)',
      commonJsIntegration: 'Auto: unwrap→edit→rewrap | clean code→system handles infra',
      scriptTypeCompatibility: {standalone: 'Full Support', containerBound: 'Full Support', notes: 'Universal token-efficient editing'}
    },
    llmHints: {
      preferOver: 'write (95% save) | sed (exact vs regex) | cat+write (never)',
      idealFor: 'Config|renames|typos|small bugs (max 20 ops)',
      avoid: 'New files→write | refactor→write | multi-file→sed | fuzzy→aider',
      response: '~10tok default | dryRun→diff'
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: EditParams): Promise<EditResult> {
    // Validate inputs
    if (!params.edits || params.edits.length === 0) {
      throw new ValidationError('edits', params.edits, 'at least one edit operation required');
    }

    if (params.edits.length > 20) {
      throw new ValidationError('edits', params.edits, 'maximum 20 edit operations per call');
    }

    // Translate path and resolve hybrid script ID
    const translatedPath = translatePathForOperation(params.path, true);
    const hybridResolution = resolveHybridScriptId(params.scriptId, translatedPath);
    const fullPath = `${hybridResolution.scriptId}/${hybridResolution.cleanPath}`;

    // Validate path
    const parsedPath = parsePath(fullPath);
    if (!parsedPath.isFile || !parsedPath.filename) {
      throw new ValidationError('path', params.path, 'file path must include a filename');
    }

    const scriptId = parsedPath.scriptId;
    const filename = parsedPath.filename;

    // Get authentication token
    const accessToken = await this.getAuthToken(params);

    // Read current file content from remote
    const allFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
    const fileContent = allFiles.find((f: any) => f.name === filename);

    if (!fileContent) {
      throw new ValidationError('filename', filename, 'existing file in the project');
    }

    // Unwrap CommonJS if needed
    let content = fileContent.source || '';
    if (fileContent.type === 'SERVER_JS') {
      const result = unwrapModuleContent(content);
      if (result && result.unwrappedContent) {
        content = result.unwrappedContent;
      }
    }
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
          `edit (${idx + 1})`,
          params.path,
          `Text not found: "${oldText.substring(0, 50)}${oldText.length > 50 ? '...' : ''}"`
        );
      }

      // Handle multiple matches
      if (occurrences.length > 1 && index === undefined) {
        throw new FileOperationError(
          `edit (${idx + 1})`,
          params.path,
          `Found ${occurrences.length} occurrences of text. Specify 'index' parameter to choose which one (0-based).`
        );
      }

      const targetIndex = index !== undefined ? index : 0;
      if (targetIndex >= occurrences.length) {
        throw new FileOperationError(
          `edit (${idx + 1})`,
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

    // Wrap CommonJS if needed before writing
    let finalContent = content;
    if (fileContent.type === 'SERVER_JS' && shouldWrapContent(fileContent.type, filename)) {
      finalContent = wrapModuleContent(content, filename);
    }

    // Write modified content back to remote
    await this.gasClient.updateFile(scriptId, filename, finalContent, undefined, accessToken, fileContent.type as 'SERVER_JS' | 'HTML' | 'JSON');

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
      .replace(/\r\n/g, '\n')  // Normalize line endings
      .replace(/\t/g, '  ')    // Tabs to spaces
      .replace(/[ \t]+/g, ' '); // Multiple spaces to single
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

    // Simple line-by-line diff (could be enhanced with proper diff algorithm)
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
