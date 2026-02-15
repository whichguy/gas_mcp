/**
 * @fileoverview Token-Efficient Fuzzy Editing - Levenshtein similarity matching
 *
 * SAVINGS: ~95% token reduction vs write | handles whitespace/formatting variations
 * FLOW: fetch → unwrap → fuzzyMatch → apply edits → rewrap → hashCheck → write
 * KEY: edits=[{searchText, replaceText, similarityThreshold?}] | threshold=0.8 default (0.9 strict, 0.7 permissive)
 * VS EDIT: edit=exact match | aider=fuzzy match (for reformatted code, CRLF/LF, copied text)
 * NO AUTO-COMMIT: Must call git_feature({operation:'commit'}) after edits
 */
import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ValidationError, FileOperationError, ConflictError, type ConflictDetails } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { parsePath, resolveHybridScriptId, fileNameMatches } from '../api/pathParser.js';
import { unwrapModuleContent, wrapModuleContent, shouldWrapContent } from '../utils/moduleWrapper.js';
import { translatePathForOperation } from '../utils/virtualFileTranslation.js';
import { FuzzyMatcher, type EditOperation } from '../utils/fuzzyMatcher.js';
import { DiffGenerator } from '../utils/diffGenerator.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { GuidanceFragments } from '../utils/guidanceFragments.js';
import { GitOperationManager } from '../core/git/GitOperationManager.js';
import { GitPathResolver } from '../core/git/GitPathResolver.js';
import { SyncStrategyFactory } from '../core/git/SyncStrategyFactory.js';
import { AiderOperationStrategy } from '../core/git/operations/AiderOperationStrategy.js';
import { analyzeContent } from '../utils/contentAnalyzer.js';
import { getGitBreadcrumbEditHint, type GitBreadcrumbEditHint } from '../utils/gitBreadcrumbHints.js';
import { computeGitSha1, hashesEqual } from '../utils/hashUtils.js';
import type { CompactGitHint } from '../utils/gitStatus.js';

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
  /** Git SHA-1 hash (40 hex chars) from previous cat. If differs from remote, aider fails with ConflictError. */
  expectedHash?: string;
  /** Force aider even if local and remote are out of sync (bypasses hash check). */
  force?: boolean;
}

interface AiderResult {
  success: boolean;
  editsApplied: number;
  diff?: string;
  filePath: string;
  /** Git SHA-1 hash of the WRAPPED content (full file as stored in GAS). Use for expectedHash on subsequent edits. */
  hash?: string;
  matches?: Array<{
    searchText: string;
    foundText: string;
    similarity: number;
    applied: boolean;
  }>;
  git?: CompactGitHint;
  warnings?: string[];
  hints?: string[];
  gitBreadcrumbHint?: GitBreadcrumbEditHint;
}

/**
 * Token-efficient file editing with fuzzy string matching
 *
 * Like EditTool but uses fuzzy matching to find similar (but not exact) text.
 * Useful when text has formatting variations, whitespace differences, or minor changes.
 */
export class AiderTool extends BaseTool {
  public name = 'aider';
  public description = '[FILE:AIDER] AI-assisted file editing with fuzzy string matching — tolerates whitespace and minor differences in old_string. WHEN: edit fails due to whitespace/formatting mismatches, or when exact string match is difficult. AVOID: use edit first (faster, deterministic); use write for full replacement. Example: aider({scriptId, path: "Utils.gs", old_string: "function add(a, b)", new_string: "function add(a, b, c)"}). GIT: use git_feature(start) before features, git_feature(commit) after changes.';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      success: { type: 'boolean', description: 'Whether the operation succeeded' },
      editsApplied: { type: 'number', description: 'Number of edits applied' },
      diff: { type: 'string', description: 'Unified diff of changes (dry-run only)' },
      filePath: { type: 'string', description: 'File path that was edited' },
      hash: { type: 'string', description: 'Git SHA-1 hash of wrapped content after edit' },
      matches: { type: 'array', description: 'Match details per edit (searchText, similarity, applied)' },
      git: { type: 'object', description: 'Compact git hint (branch, uncommitted count, action)' },
      warnings: { type: 'array', description: 'Content analysis warnings' },
      hints: { type: 'array', description: 'Content analysis hints' },
      gitBreadcrumbHint: { type: 'object', description: 'Git breadcrumb hint for .git/* files' }
    }
  };

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
      expectedHash: {
        type: 'string',
        description: 'Git SHA-1 hash (40 hex chars) from previous cat. If differs from remote, aider fails with ConflictError. Pass the hash from cat response to detect concurrent modifications.',
        pattern: '^[a-f0-9]{40}$',
        examples: ['a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2']
      },
      force: {
        type: 'boolean',
        description: '⚠️ Force aider even if local and remote are out of sync. Use only when intentionally discarding external changes.',
        default: false
      },
      ...SchemaFragments.workingDir,
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'path', 'edits'],
    additionalProperties: false,
    llmGuidance: {
      workflowSelection: GuidanceFragments.localFirstWorkflow,
      gitIntegration: GuidanceFragments.gitIntegration,
      errorRecovery: GuidanceFragments.errorRecovery,
      errorResolutions: GuidanceFragments.errorResolutions,
      threshold: '0.8 default; 0.9 strict (minor diffs); 0.7 permissive (moderate diffs). dryRun first to verify.',
      antiPatterns: 'exact text known->use edit | searchText>1000->grep then edit | threshold<0.5->false positives | no auto-commit->git_feature commit'
    },

    llmHints: {
      useCases: 'reformatted code, whitespace/indent variations, copied text with formatting changes, CRLF/LF inconsistencies',
      avoid: 'exact text known (use edit), regex needed (use sed), new files (use write)',
      troubleshoot: 'no match→lower threshold or add context | wrong match→raise threshold or add context'
    }
  };

  public annotations = {
    title: 'Fuzzy Edit (Smart)',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
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
    const fileContent = allFiles.find((f: any) => fileNameMatches(f.name, filename));

    if (!fileContent) {
      throw new ValidationError('filename', filename, 'existing file in the project');
    }

    // Unwrap CommonJS if needed, capturing existing module options for analysis
    let content = fileContent.source || '';
    let existingOptions: { loadNow?: boolean | null; hoistedFunctions?: any[] } | null | undefined;
    if (fileContent.type === 'SERVER_JS') {
      const result = unwrapModuleContent(content);
      if (result && result.unwrappedContent) {
        content = result.unwrappedContent;
        existingOptions = result.existingOptions;
      }
    }

    // === HASH-BASED CONFLICT DETECTION ===
    // Compute hash at READ time on WRAPPED content (full file as stored in GAS)
    // This ensures hash matches `git hash-object <file>` on local synced files
    const readHash = computeGitSha1(fileContent.source || '');

    // Check for conflicts if expectedHash provided and not forcing
    if (params.expectedHash && !params.force) {
      if (!hashesEqual(params.expectedHash, readHash)) {
        // Generate info about the hash mismatch
        const diffContent = `File content has changed since your last read.
Expected hash: ${params.expectedHash}
Current hash:  ${readHash}

Current file content (first 2000 chars):
${content.substring(0, 2000)}${content.length > 2000 ? '...' : ''}`;

        const conflict: ConflictDetails = {
          scriptId,
          filename,
          operation: 'aider',
          expectedHash: params.expectedHash,
          currentHash: readHash,
          hashSource: 'param',
          diff: {
            format: 'info',
            content: diffContent,
            truncated: content.length > 2000
          }
          // Note: hints are auto-generated by ConflictError constructor
        };

        throw new ConflictError(conflict);
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

    // Analyze the modified content for common issues and patterns
    // Pass existingOptions so loadNow check works for files with event handlers
    const analysis = analyzeContent(filename, modifiedContent, existingOptions ?? undefined);

    // Check if any changes were made
    if (modifiedContent === originalContent) {
      return {
        success: true,
        editsApplied: 0,
        filePath: params.path,
        hash: readHash,  // File unchanged, return current hash
        matches: params.dryRun ? matches : undefined,
        ...(analysis.warnings.length > 0 ? { warnings: analysis.warnings } : {}),
        ...(analysis.hints.length > 0 ? { hints: analysis.hints } : {})
      };
    }

    // Dry-run mode: return matches without writing
    if (params.dryRun) {
      const diff = this.diffGenerator.generateDiff(originalContent, modifiedContent, params.path);
      // Compute hash of what would be written on WRAPPED content (full file as stored in GAS)
      // Re-wrap the modified content to get the correct hash
      let previewWrapped = modifiedContent;
      if (fileContent.type === 'SERVER_JS' && shouldWrapContent(fileContent.type, filename)) {
        // Convert null to undefined for type compatibility
        const options = existingOptions ? {
          loadNow: existingOptions.loadNow ?? undefined,
          hoistedFunctions: existingOptions.hoistedFunctions
        } : undefined;
        previewWrapped = wrapModuleContent(modifiedContent, filename.replace(/\.\w+$/, ''), options);
      }
      const previewHash = computeGitSha1(previewWrapped);
      return {
        success: true,
        editsApplied,
        diff,
        filePath: params.path,
        hash: previewHash,  // Hash of WRAPPED content that would be written (dry-run preview)
        matches,
        ...(analysis.warnings.length > 0 ? { warnings: analysis.warnings } : {}),
        ...(analysis.hints.length > 0 ? { hints: analysis.hints } : {})
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

    // Get hash from strategy's wrapped content (GitOperationManager handles local overwrite + xattr)
    const wrappedMap = gitResult.result.wrappedContent;
    const wrappedStr = wrappedMap?.get(filename);
    const editedHash = wrappedStr ? computeGitSha1(wrappedStr) : readHash;

    // Return response with compact git hints for LLM guidance
    const result: AiderResult = {
      success: true,
      editsApplied,
      filePath: params.path,
      hash: editedHash,  // Git SHA-1 of WRAPPED content. Use for expectedHash on subsequent edits.
      // Compact git hint from GitOperationManager
      git: gitResult.git?.hint,
      // Include content analysis warnings and hints
      ...(analysis.warnings.length > 0 ? { warnings: analysis.warnings } : {}),
      ...(analysis.hints.length > 0 ? { hints: analysis.hints } : {})
    };

    // Add git breadcrumb hint for .git/* files
    const gitBreadcrumbHint = getGitBreadcrumbEditHint(filename);
    if (gitBreadcrumbHint) {
      result.gitBreadcrumbHint = gitBreadcrumbHint;
    }

    return result;
  }

}
