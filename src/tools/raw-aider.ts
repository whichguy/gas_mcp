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
 * Use for editing system files or module infrastructure. Provides 95%+ token savings vs raw_write.
 */
export class RawAiderTool extends BaseTool {
  public name = 'raw_aider';
  public description = 'Token-efficient file editing using fuzzy string matching on raw file content (includes CommonJS wrappers). Use for editing system files or module infrastructure. Provides 95%+ token savings vs raw_write.';

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
              description: 'Text to search for (fuzzy matching). Maximum 1,000 characters. For larger patterns, use grep or ripgrep. Will match similar text even with whitespace/formatting differences.',
              minLength: 1,
              maxLength: 1000
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
      whenToUse: 'Raw content (with _main+__defineModule__) + format var → fuzzy finds similar in complete file',
      contentDifference: 'raw_aider: complete (_main+__defineModule__) | aider: clean user code',
      howToUse: ['ID approx raw text (e.g. "_main  ()" extra spacing)', 'threshold: 0.9+ strict | 0.8 default | 0.7 permissive', 'dryRun first→preview raw matches', 'apply→best fuzzy in raw', 'check editsApplied count'],
      whenNotToUse: ['user code→aider (auto unwrap) | exact raw→raw_edit (faster) | new system→raw_write | app dev→aider'],
      bestPractices: ['dryRun first | default 0.8→adjust | specific searchText | context for match | single-file | multi-file→sed'],
      tokenSavings: '95%+ vs write (~10tok: {success,editsApplied,filePath})',
      examples: [{scenario: 'CommonJS wrapper spacing', code: 'path:"abc123.../CommonJS",edits:[{searchText:"function _main(module,exports,require)",replaceText:"function _mainWrapper(module, exports, require)"}]'}, {scenario: 'system permissive 0.7', code: 'path:"abc123.../__mcp_exec",edits:[{searchText:"function execute",replaceText:"function executeWithLogging",similarityThreshold:0.7}]'}, {scenario: 'preview raw (recommended)', code: 'path:"abc123.../CommonJS",edits:[{searchText:"__defineModule__",replaceText:"__defineModuleEnhanced__"}],dryRun:true'}],
      vsGasAider: 'aider: unwrap for user code | raw_aider: preserve wrappers for system',
      vsGasRawEdit: 'raw_edit: exact char match | raw_aider: fuzzy for variations',
      scriptTypeCompatibility: {standalone: 'Full Support', containerBound: 'Full Support', notes: 'Universal raw fuzzy'}
    },

    llmHints: {
      decision: 'Exact→raw_edit | format var→raw_aider | regex→sed',
      preferOver: 'raw_edit (format/uncertain) | raw_write (95% save)',
      idealFor: 'System wrappers with whitespace|_main spacing|CommonJS format',
      avoid: 'User code→aider | exact→raw_edit | new→raw_write',
      threshold: '0.9+ strict | 0.8 default | 0.7 permissive',
      warning: 'Raw content only (preserves wrappers)'
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

    // Validate searchText length for performance
    for (let i = 0; i < params.edits.length; i++) {
      const edit = params.edits[i];
      if (edit.searchText.length > 1000) {
        throw new ValidationError(
          `edits[${i}].searchText`,
          edit.searchText.substring(0, 50) + '...',
          'searchText maximum 1,000 characters. For larger patterns, use grep or ripgrep instead.'
        );
      }
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
