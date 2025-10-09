import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ValidationError, FileOperationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { parsePath, resolveHybridScriptId } from '../api/pathParser.js';
import { translatePathForOperation } from '../utils/virtualFileTranslation.js';
import { FuzzyMatcher, type EditOperation } from '../utils/fuzzyMatcher.js';
import { DiffGenerator } from '../utils/diffGenerator.js';
import { SchemaFragments } from '../utils/schemaFragments.js';

interface AiderOperation {
  searchText: string;
  replaceText: string;
  similarityThreshold?: number; // 0.0 to 1.0, default 0.8
}

interface AiderParams {
  scriptId: string;
  path: string;
  edits: AiderOperation[];
  dryRun?: boolean;
  workingDir?: string;
  accessToken?: string;
}

interface AiderResult {
  success: boolean;
  editsApplied: number;
  diff?: string;
  filePath: string;
  matches?: Array<{
    searchText: string;
    foundText: string;
    similarity: number;
    applied: boolean;
  }>;
}

/**
 * Token-efficient file editing using exact string matching on raw file content (includes CommonJS wrappers)
 *
 * Like RawEditTool but uses fuzzy matching to find similar (but not exact) text in raw content.
 * Use for editing system files or module infrastructure. Provides 95%+ token savings vs gas_raw_write.
 */
export class RawAiderTool extends BaseTool {
  public name = 'raw_aider';
  public description = 'Token-efficient file editing using fuzzy string matching on raw file content (includes CommonJS wrappers). Use for editing system files or module infrastructure. Provides 95%+ token savings vs gas_raw_write.';

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId44,
      path: {
        type: 'string',
        description: 'Full path to file: scriptId/filename (WITHOUT extension). REQUIRED: Must include explicit scriptId prefix (e.g., "abc123def.../filename") - current project context is not used.',
        minLength: 25,
        pattern: '^[a-zA-Z0-9_-]{20,60}/[a-zA-Z0-9_.//-]+$',
        examples: [
          'abc123def456.../CommonJS',
          'abc123def456.../utils/helpers'
        ]
      },
      edits: {
        type: 'array',
        description: 'Array of fuzzy edit operations. Each edit uses similarity matching to find text.',
        items: {
          type: 'object',
          properties: {
            searchText: {
              type: 'string',
              description: 'Text to search for (fuzzy matching). Will match similar text even with whitespace/formatting differences.',
              minLength: 1
            },
            replaceText: {
              type: 'string',
              description: 'Replacement text'
            },
            similarityThreshold: {
              type: 'number',
              description: 'Minimum similarity score (0.0-1.0) to match. Default: 0.8 (80% similar)',
              minimum: 0.0,
              maximum: 1.0,
              default: 0.8
            }
          },
          required: ['searchText', 'replaceText'],
          additionalProperties: false
        },
        minItems: 1,
        maxItems: 20
      },
      ...SchemaFragments.dryRun,
      ...SchemaFragments.workingDir,
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'path', 'edits'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Use when editing raw file content (including CommonJS wrappers and system files) with formatting variations. Fuzzy matching finds similar text in complete file content including _main() wrappers and __defineModule__ calls.',

      contentDifference: 'gas_raw_aider operates on complete file content including _main() wrappers and __defineModule__ calls. gas_aider operates on clean user code.',

      howToUse: [
        '1. Identify approximate text in raw content you want to change (e.g., "_main  ()" with extra spacing)',
        '2. Choose similarity threshold: 0.9+ (strict), 0.8 (default), 0.7 (permissive)',
        '3. Use dryRun: true first to preview matches in raw content',
        '4. Apply edits - tool finds best fuzzy match in raw content',
        '5. Check response for editsApplied count to confirm success'
      ],

      whenNotToUse: [
        '❌ Editing user code → Use gas_aider (unwraps CommonJS automatically)',
        '❌ When exact raw text is known → Use gas_raw_edit for better performance',
        '❌ For new system files → Use gas_raw_write instead',
        '❌ Normal application development → Use gas_aider for user code'
      ],

      bestPractices: [
        '✅ Always use dryRun: true first to verify fuzzy match finds correct text',
        '✅ Start with default threshold (0.8) and adjust if needed',
        '✅ Keep searchText specific enough to avoid false matches',
        '✅ Include surrounding context in searchText for better matching',
        '✅ Process one file at a time (single-file design)',
        '✅ Use gas_sed for multi-file pattern replacements instead'
      ],

      tokenSavings: 'Saves 95%+ output tokens vs gas_write. Only outputs ~10 tokens by default: { success, editsApplied, filePath }',

      examples: [
        {
          scenario: 'Edit CommonJS wrapper with spacing variations',
          code: 'gas_raw_aider({path: "abc123.../CommonJS", edits: [{searchText: "function _main(module,exports,require)", replaceText: "function _mainWrapper(module, exports, require)"}]})'
        },
        {
          scenario: 'Edit system file with permissive threshold',
          code: 'gas_raw_aider({path: "abc123.../__mcp_gas_run", edits: [{searchText: "function execute", replaceText: "function executeWithLogging", similarityThreshold: 0.7}]})'
        },
        {
          scenario: 'Preview raw content matches (recommended)',
          code: 'gas_raw_aider({path: "abc123.../CommonJS", edits: [{searchText: "__defineModule__", replaceText: "__defineModuleEnhanced__"}], dryRun: true})'
        }
      ],

      vsGasAider: 'gas_aider unwraps CommonJS for editing user code, gas_raw_aider preserves exact content including wrappers for system files',
      vsGasRawEdit: 'gas_raw_edit requires exact character match, gas_raw_aider uses fuzzy matching for variations in raw content',

      scriptTypeCompatibility: {
        standalone: '✅ Full Support - Works identically',
        containerBound: '✅ Full Support - Works identically',
        notes: 'Raw fuzzy editing works universally for both script types.'
      }
    },

    llmHints: {
      decisionTree: {
        'Exact text known?': {
          yes: '→ Use gas_edit (faster, more precise)',
          no: '→ Use gas_aider (fuzzy matching)'
        },
        'Text has formatting variations?': {
          yes: '→ Use gas_aider (handles whitespace/formatting differences)',
          no: '→ Use gas_edit (exact matching sufficient)'
        },
        'Need regex patterns?': {
          yes: '→ Use gas_sed (pattern-based replacement)',
          no: '→ Use gas_aider or gas_edit (string matching)'
        },
        'Creating new file?': {
          yes: '→ Use gas_write (file creation)',
          no: '→ Use gas_aider/gas_edit (file editing)'
        }
      },

      preferOver: {
        gas_edit: 'When text might have whitespace/formatting variations or you\'re not sure of exact content. Aider uses fuzzy matching (80% similar by default), gas_edit requires 100% exact match.',
        gas_write: 'When making small changes to existing files - aider saves 95%+ tokens by only outputting ~10 tokens (success, editsApplied, filePath) instead of entire file (~4,500 tokens)',
        gas_sed: 'When you need flexible text matching without regex complexity. Aider finds similar text using Levenshtein distance, gas_sed uses regex patterns.'
      },

      idealUseCases: [
        '✅ Editing code that may have been reformatted (whitespace/indentation changes)',
        '✅ Updating text when exact content is uncertain but approximate text is known',
        '✅ Replacing function calls that might have spacing/formatting variations',
        '✅ Modifying code copied from formatted output (pretty-printed, minified, etc.)',
        '✅ Handling text with inconsistent line endings (CRLF vs LF) or indentation (tabs vs spaces)',
        '✅ Editing user code in CommonJS modules (automatic unwrap/wrap)'
      ],

      avoidWhen: [
        '❌ Exact text is known → Use gas_edit for better performance and precision',
        '❌ Need regex pattern matching → Use gas_sed for pattern-based replacements',
        '❌ Creating new files → Use gas_write for file creation from scratch',
        '❌ Multiple occurrences need different replacements → Use gas_edit with index parameter to target specific occurrence',
        '❌ Need to edit system files with CommonJS wrappers → Use gas_raw_aider for raw content editing'
      ],

      similarityThresholdGuide: {
        '0.95-1.0': '🔒 Very strict - Only whitespace/formatting differences (e.g., "function test()" vs "function  test()")',
        '0.85-0.95': '⚖️  Strict - Minor variations (e.g., "const x = 1" vs "const x=1")',
        '0.8-0.85': '✅ Default - Typical formatting variations (e.g., different indentation, line endings)',
        '0.7-0.8': '🔓 Permissive - Moderate text differences (e.g., "getUserData()" vs "get_user_data()")',
        '0.6-0.7': '⚠️  Very permissive - Significant differences (may match unintended text)',
        'below 0.6': '❌ Too loose - High risk of false matches, not recommended'
      },

      algorithmDetails: {
        matchingMethod: 'Levenshtein distance with sliding window (±20% search text length)',
        normalization: 'Normalizes whitespace (CRLF→LF, tabs→spaces, multiple spaces→single) before comparison',
        windowSizes: 'Tries windows from 80% to 120% of search text length to handle insertions/deletions',
        similarityScore: '1.0 - (editDistance / maxLength) where 1.0 = identical, 0.0 = completely different'
      },

      responseOptimization: 'Response is minimal by default (~10 tokens: {success, editsApplied, filePath}). Use dryRun: true to see full details: matches found, similarity scores, and git-style diff.',

      tokenEconomics: 'Output tokens cost 5x input ($15/M vs $3/M for Claude Sonnet 4.5). Aider minimizes output to ~10 tokens vs gas_write\'s ~4,500 tokens = 99.8% savings on output tokens.',

      errorHandling: {
        'No match found': 'Increase similarityThreshold (e.g., from 0.8 to 0.7) or make searchText more specific with surrounding context',
        'Wrong text matched': 'Decrease similarityThreshold (e.g., from 0.8 to 0.9) or add more context to searchText to be more specific',
        'Multiple matches': 'Add surrounding context to searchText to uniquely identify the intended match'
      }
    }
  };

  private gasClient: GASClient;
  private fuzzyMatcher: FuzzyMatcher;
  private diffGenerator: DiffGenerator;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
    this.fuzzyMatcher = new FuzzyMatcher();
    this.diffGenerator = new DiffGenerator();
  }

  async execute(params: AiderParams): Promise<AiderResult> {
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

    // Read current file content from remote (RAW - no unwrapping)
    const allFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
    const fileContent = allFiles.find((f: any) => f.name === filename);

    if (!fileContent) {
      throw new ValidationError('filename', filename, 'existing file in the project');
    }

    // Use raw content (no CommonJS unwrapping)
    const content = fileContent.source || '';
    const originalContent = content;

    // Convert params to EditOperation format
    const editOperations: EditOperation[] = params.edits.map(edit => ({
      searchText: edit.searchText,
      replaceText: edit.replaceText,
      similarityThreshold: edit.similarityThreshold
    }));

    // Find all matches first (validates no overlaps)
    let editsWithMatches: EditOperation[];
    try {
      editsWithMatches = this.fuzzyMatcher.findAllMatches(content, editOperations);
    } catch (error: any) {
      // Overlap detected or other error
      throw new FileOperationError('raw_aider', params.path, error.message);
    }

    // Build matches array for response
    const matches: Array<{
      searchText: string;
      foundText: string;
      similarity: number;
      applied: boolean;
    }> = editsWithMatches.map(edit => ({
      searchText: edit.searchText,
      foundText: edit.match?.text ?? '',
      similarity: edit.match?.similarity ?? 0,
      applied: edit.match !== undefined
    }));

    // Check if any edits failed to find matches
    const failedEdits = editsWithMatches.filter(edit => edit.match === undefined);
    if (failedEdits.length > 0 && !params.dryRun) {
      const firstFailed = failedEdits[0];
      const threshold = firstFailed.similarityThreshold ?? 0.8;
      throw new FileOperationError(
        'raw_aider',
        params.path,
        `No match found above ${(threshold * 100).toFixed(0)}% similarity for: "${firstFailed.searchText.substring(0, 50)}${firstFailed.searchText.length > 50 ? '...' : ''}"`
      );
    }

    // Apply edits in reverse position order (prevents position invalidation)
    const { content: modifiedContent, editsApplied } = this.fuzzyMatcher.applyEdits(content, editsWithMatches);

    // Check if any changes were made
    if (modifiedContent === originalContent) {
      return {
        success: true,
        editsApplied: 0,
        filePath: params.path,
        matches: params.dryRun ? matches : undefined
      };
    }

    // Dry-run mode: return matches without writing
    if (params.dryRun) {
      const diff = this.diffGenerator.generateDiff(originalContent, modifiedContent, params.path);
      return {
        success: true,
        editsApplied,
        diff,
        filePath: params.path,
        matches
      };
    }

    // Write raw content back to remote (no CommonJS wrapping)
    await this.gasClient.updateFile(scriptId, filename, modifiedContent, undefined, accessToken, fileContent.type as 'SERVER_JS' | 'HTML' | 'JSON');

    // Return minimal response for token efficiency
    return {
      success: true,
      editsApplied,
      filePath: params.path
    };
  }

}
