import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ValidationError, FileOperationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { parsePath, resolveHybridScriptId } from '../api/pathParser.js';
import { unwrapModuleContent, wrapModuleContent, shouldWrapContent } from '../utils/moduleWrapper.js';
import { translatePathForOperation } from '../utils/virtualFileTranslation.js';

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
 * Provides ~83% token savings vs gas_write by having LLM output only changed text
 * instead of entire file content. Uses client-side orchestration of cat + write.
 */
export class EditTool extends BaseTool {
  public name = 'edit';
  public description = 'Token-efficient file editing using exact string matching. LLM outputs only changed text (~40 tokens) instead of entire file (~4500 tokens), providing 83% token savings. Supports multi-edit operations, dry-run preview, and automatic CommonJS processing.';

  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID (44 characters)',
        pattern: '^[a-zA-Z0-9_-]{44}$',
        minLength: 44,
        maxLength: 44
      },
      path: {
        type: 'string',
        description: 'File path (filename only, or scriptId/filename if scriptId parameter is empty)',
        minLength: 1,
        examples: [
          'utils.gs',
          'models/User.gs',
          'abc123def456.../helpers.gs'
        ]
      },
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
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying them. Returns git-style diff.',
        default: false
      },
      fuzzyWhitespace: {
        type: 'boolean',
        description: 'Tolerate whitespace differences (normalize spaces/tabs). Useful for code copied from formatted output.',
        default: false
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$'
      }
    },
    required: ['scriptId', 'path', 'edits'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Use for token-efficient file edits. LLM outputs only changed text (~40 tokens) instead of entire file (~4500 tokens).',
      tokenSavings: 'Saves 95%+ output tokens vs gas_write. For 4,567-token file with 25-token change: gas_write outputs 4,567 tokens ($0.068), gas_edit outputs ~10 tokens ($0.00015).',
      examples: [
        'Single edit: edit({scriptId: "...", path: "utils", edits: [{oldText: "const DEBUG = false", newText: "const DEBUG = true"}]})',
        'Multi-edit: edit({scriptId: "...", path: "config", edits: [{oldText: "port: 3000", newText: "port: 8080"}, {oldText: "host: localhost", newText: "host: 0.0.0.0"}]})',
        'Dry-run: edit({scriptId: "...", path: "main", edits: [...], dryRun: true})',
        'Handle duplicates: edit({scriptId: "...", path: "test", edits: [{oldText: "assert(true)", newText: "expect(true)", index: 1}]})'
      ],
      vsGasWrite: 'gas_write requires entire file content (4,567 tokens), gas_edit requires only changed text (40 tokens)',
      vsGasSed: 'gas_sed requires regex patterns, gas_edit uses exact strings (more reliable for LLMs)',
      vsGasAider: 'gas_edit uses exact matching (simple, fast), gas_aider uses fuzzy matching (handles variations)',
      commonJsIntegration: 'Automatically unwraps CommonJS for editing, re-wraps when writing. Edit clean user code, system handles module infrastructure.',
      scriptTypeCompatibility: {
        standalone: '✅ Full Support',
        containerBound: '✅ Full Support',
        notes: 'Token-efficient editing works universally for both script types.'
      }
    },
    llmHints: {
      preferOver: {
        gas_write: 'When making small changes to existing files - edit saves 95%+ tokens by only outputting changed text',
        gas_sed: 'When you need exact string matching instead of regex patterns - more reliable and easier for LLMs',
        gas_cat_then_write: 'Never read entire file then write it back - use edit for token efficiency'
      },
      idealUseCases: [
        'Changing configuration values (debug flags, ports, URLs)',
        'Updating function names or variable names',
        'Modifying import/require statements',
        'Fixing typos or small bugs',
        'Multi-line edits in same file (up to 20 operations)'
      ],
      avoidWhen: [
        'Creating new files (use gas_write instead)',
        'Refactoring entire file structure (use gas_write instead)',
        'Pattern-based replacements across many files (use gas_sed instead)',
        'Need fuzzy matching for similar but not identical text (use gas_aider instead)'
      ],
      responseOptimization: 'Response is minimal by default (~10 tokens). Use dryRun: true to see full diff before applying changes.',
      tokenEconomics: 'Output tokens cost 5x input ($15/M vs $3/M for Claude Sonnet 4.5). Minimize response size for maximum cost savings.'
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
