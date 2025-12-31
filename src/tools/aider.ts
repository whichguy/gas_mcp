import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ValidationError, FileOperationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { parsePath, resolveHybridScriptId } from '../api/pathParser.js';
import { unwrapModuleContent, wrapModuleContent, shouldWrapContent } from '../utils/moduleWrapper.js';
import { translatePathForOperation } from '../utils/virtualFileTranslation.js';
import { FuzzyMatcher, type EditOperation } from '../utils/fuzzyMatcher.js';
import { DiffGenerator } from '../utils/diffGenerator.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { GitOperationManager } from '../core/git/GitOperationManager.js';
import { GitPathResolver } from '../core/git/GitPathResolver.js';
import { SyncStrategyFactory } from '../core/git/SyncStrategyFactory.js';
import { AiderOperationStrategy } from '../core/git/operations/AiderOperationStrategy.js';

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
  changeReason?: string;
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
 * Token-efficient file editing with fuzzy string matching
 *
 * Like EditTool but uses fuzzy matching to find similar (but not exact) text.
 * Useful when text has formatting variations, whitespace differences, or minor changes.
 */
export class AiderTool extends BaseTool {
  public name = 'aider';
  public description = 'Token-efficient file editing using fuzzy string matching. Finds and replaces similar (not exact) text, handling formatting variations and minor differences. Provides 95%+ token savings vs write.';

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      ...SchemaFragments.path,
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
      changeReason: {
        type: 'string',
        description: 'Optional commit message for git integration. If omitted, defaults to "Refactor {filename}". Git repo is created automatically if it doesn\'t exist.',
        examples: ['Fix fuzzy matching logic', 'Update formatting', 'Refactor whitespace handling']
      },
      ...SchemaFragments.workingDir,
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'path', 'edits'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Fuzzy matching for formatting variations, whitespace differences, or uncertain exact text. Use edit for exact text, sed for regex patterns.',
      toolChoice: 'edit: exact known text | aider: formatting variations | sed: regex patterns | write: new files',
      threshold: '0.8 default, 0.9 strict (minor diffs), 0.7 permissive (moderate diffs)',
      workflow: 'dryRun first to verify matches, then apply. Returns ~10 tokens (95%+ savings vs write).',
      examples: ['Whitespace: edits:[{searchText:"function   test()",replaceText:"function testNew()"}]', 'Lower threshold: similarityThreshold:0.7', 'Multi-edit: edits:[{...},{...}]'],
      errorRecovery: {
        'no match found': 'Lower threshold (0.7) OR add more context OR use ripgrep to find actual text',
        'wrong match': 'Raise threshold (0.9) OR include more unique context in searchText',
        'sync conflict': 'local_sync first OR retry with force flag'
      },
      antiPatterns: ['❌ aider for exact known text → use edit (faster)', '❌ searchText >1000 chars → use grep to locate, then edit', '❌ threshold too low (0.5) → false positives likely']
    },

    llmHints: {
      useCases: 'reformatted code, whitespace/indent variations, copied text with formatting changes, CRLF/LF inconsistencies',
      avoid: 'exact text known (use edit), regex needed (use sed), new files (use write)',
      troubleshoot: 'no match→lower threshold or add context | wrong match→raise threshold or add context'
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
      throw new FileOperationError('aider', params.path, error.message);
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
        'aider',
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

    // Always use GitOperationManager for proper workflow:
    // 1. Compute changes
    // 2. Validate with hooks
    // 3. Write to remote
    // Git repo will be created automatically if it doesn't exist
    const operation = new AiderOperationStrategy({
      scriptId,
      path: params.path,
      edits: params.edits,
      accessToken,
      gasClient: this.gasClient
    });

    const pathResolver = new GitPathResolver();
    const syncFactory = new SyncStrategyFactory();
    const gitManager = new GitOperationManager(pathResolver, syncFactory, this.gasClient);

    // Use provided changeReason or generate default
    const defaultMessage = `Refactor ${filename}`;

    const gitResult = await gitManager.executeWithGit(operation, {
      scriptId,
      files: [filename],
      changeReason: params.changeReason || defaultMessage,
      accessToken
    });

    // Check if on feature branch to add workflow hint
    const { isFeatureBranch } = await import('../utils/gitAutoCommit.js');
    const onFeatureBranch = gitResult.git?.branch ? isFeatureBranch(gitResult.git.branch) : false;

    // Return minimal response for token efficiency
    return {
      success: true,
      editsApplied,
      filePath: params.path,
      // Add workflow completion hint when on feature branch
      ...(onFeatureBranch ? {
        nextAction: {
          hint: `File edited. When complete: git_feature({ operation: 'finish', scriptId, pushToRemote: true })`,
          required: false
        }
      } : {})
    };
  }

}
