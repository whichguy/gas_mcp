/**
 * @fileoverview Token-Efficient File Editing - exact string replacement
 *
 * SAVINGS: ~95% token reduction vs write (40 tokens vs 4500 for typical edit)
 * FLOW: fetch → unwrap → apply edits → rewrap → hashCheck → write
 * KEY: edits=[{oldText, newText, index?}] | dryRun=true for preview | expectedHash for conflict detection
 * CONFLICT: force=true bypasses | ConflictError includes diff + hints
 * NO AUTO-COMMIT: Must call git_feature({operation:'commit'}) after edits
 */
import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ValidationError, FileOperationError, ConflictError, type ConflictDetails } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { parsePath, resolveHybridScriptId, fileNameMatches } from '../api/pathParser.js';
import { unwrapModuleContent, wrapModuleContent, shouldWrapContent } from '../utils/moduleWrapper.js';
import { translatePathForOperation } from '../utils/virtualFileTranslation.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { GuidanceFragments } from '../utils/guidanceFragments.js';
import { GitOperationManager } from '../core/git/GitOperationManager.js';
import { GitPathResolver } from '../core/git/GitPathResolver.js';
import { SyncStrategyFactory } from '../core/git/SyncStrategyFactory.js';
import { EditOperationStrategy } from '../core/git/operations/EditOperationStrategy.js';
import { analyzeContent, determineFileType } from '../utils/contentAnalyzer.js';
import { getGitBreadcrumbEditHint, type GitBreadcrumbEditHint } from '../utils/gitBreadcrumbHints.js';
import { computeGitSha1, hashesEqual } from '../utils/hashUtils.js';
import type { CompactGitHint } from '../utils/gitStatus.js';
import { buildWriteWorkflowHints } from '../utils/writeHints.js';

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
  changeReason?: string;
  workingDir?: string;
  accessToken?: string;
  /** Git SHA-1 hash (40 hex chars) from previous cat. If differs from remote, edit fails with ConflictError. */
  expectedHash?: string;
  /** Force edit even if local and remote are out of sync (bypasses hash check). */
  force?: boolean;
}

interface EditResult {
  success: boolean;
  editsApplied: number;
  diff?: string;
  filePath: string;
  /** Git SHA-1 hash of the edited content (WRAPPED, full file as stored in GAS). Use for expectedHash on subsequent edits. */
  hash?: string;
  tokenSavings?: {
    vsFullFile: number;
    outputTokensUsed: number;
    outputTokensSaved: number;
  };
  git?: CompactGitHint;
  warnings?: string[];
  hints?: string[];
  gitBreadcrumbHint?: GitBreadcrumbEditHint;
}

/**
 * Token-efficient file editing with exact string matching
 *
 * Provides ~83% token savings vs write by having LLM output only changed text
 * instead of entire file content. Uses client-side orchestration of cat + write.
 */
export class EditTool extends BaseTool {
  public name = 'edit';
  public description = '[FILE:EDIT] Token-efficient partial file update via exact string matching — 83% fewer tokens than write for small changes. WHEN: modifying specific sections of a file (functions, imports, config). AVOID: use write for full file replacement; use aider for fuzzy matching when exact string is hard to specify. Example: edit({scriptId, path: "Utils.gs", old_string: "return a+b", new_string: "return a + b"}). GIT: use git_feature(start) before features, git_feature(commit) after changes.';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      success: { type: 'boolean', description: 'Whether edit succeeded' },
      editsApplied: { type: 'number', description: 'Number of edits applied' },
      filePath: { type: 'string', description: 'Edited file path' },
      hash: { type: 'string', description: 'Git-SHA1 hash after edit' },
      diff: { type: 'string', description: 'Unified diff of changes' },
      git: { type: 'object', description: 'Git status hints (branch, uncommitted count, blocked state)' }
    }
  };

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
      changeReason: {
        type: 'string',
        description: 'Optional commit message for git integration. If omitted, defaults to "Update {filename}". Git repo is created automatically if it doesn\'t exist.',
        examples: ['Fix typo in validation', 'Update configuration', 'Refactor error handling']
      },
      expectedHash: {
        type: 'string',
        description: 'Git SHA-1 hash (40 hex chars) from previous cat. If differs from remote, edit fails with ConflictError. Pass the hash from cat response to detect concurrent modifications.',
        pattern: '^[a-f0-9]{40}$',
        examples: ['a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2']
      },
      force: {
        type: 'boolean',
        description: '⚠️ Force edit even if local and remote are out of sync. Use only when intentionally discarding external changes.',
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
      tokenEfficiency: GuidanceFragments.editTokenEfficiency,
      errorResolutions: GuidanceFragments.errorResolutions,
      commonJsIntegration: 'Auto: unwrap->edit->rewrap (clean code, system handles infra)',
      examples: 'Multi: edits:[{oldText:"port:3000",newText:"port:8080"},{...}] | Duplicates: index:1 for 2nd match',
      antiPatterns: GuidanceFragments.editAntiPatterns
    },
    llmHints: {
      preferOver: 'write (95% save) | sed (exact vs regex) | cat+write (never)',
      idealFor: 'Config|renames|typos|small bugs (max 20 ops)',
      avoid: 'New files→write | refactor→write | multi-file→sed | fuzzy→aider',
      response: '~10tok default | dryRun→diff'
    }
  };

  public annotations = {
    title: 'Edit File (Smart)',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
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
    let filename = parsedPath.filename;

    // Get authentication token
    const accessToken = await this.getAuthToken(params);

    // Read current file content from remote
    const allFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
    const fileContent = allFiles.find((f: any) => fileNameMatches(f.name, filename));

    if (!fileContent) {
      throw new ValidationError('filename', filename, 'existing file in the project');
    }
    filename = fileContent.name; // Normalize to canonical GAS name (matches wrappedContent key)

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
        // We don't have the "expected content" directly, but we can indicate the hash mismatch
        const diffContent = `File content has changed since your last read.
Expected hash: ${params.expectedHash}
Current hash:  ${readHash}

Current file content (first 2000 chars):
${content.substring(0, 2000)}${content.length > 2000 ? '...' : ''}`;

        const conflict: ConflictDetails = {
          scriptId,
          filename,
          operation: 'edit',
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

    // Analyze the modified content for common issues and patterns
    // Pass existingOptions so loadNow check works for files with event handlers
    const analysis = analyzeContent(filename, content, existingOptions ?? undefined);

    // Check if any changes were made
    if (content === originalContent) {
      return {
        success: true,
        editsApplied: 0,
        filePath: params.path,
        hash: readHash,  // File unchanged, return current hash
        diff: 'No changes (edits already applied)',
        ...(analysis.warnings.length > 0 ? { warnings: analysis.warnings } : {}),
        ...(analysis.hints.length > 0 ? { hints: analysis.hints } : {})
      };
    }

    // Dry-run mode: return diff without writing
    if (params.dryRun) {
      const diff = this.generateDiff(originalContent, content, params.path);
      // Compute hash of what would be written on WRAPPED content (full file as stored in GAS)
      // Re-wrap the edited content to get the correct hash
      let previewWrapped = content;
      if (fileContent.type === 'SERVER_JS' && shouldWrapContent(fileContent.type, filename)) {
        // Convert null to undefined for type compatibility
        const options = existingOptions ? {
          loadNow: existingOptions.loadNow ?? undefined,
          hoistedFunctions: existingOptions.hoistedFunctions
        } : undefined;
        previewWrapped = wrapModuleContent(content, filename.replace(/\.\w+$/, ''), options);
      }
      const previewHash = computeGitSha1(previewWrapped);
      return {
        success: true,
        editsApplied,
        diff,
        filePath: params.path,
        hash: previewHash,  // Hash of WRAPPED content that would be written (dry-run preview)
        ...(analysis.warnings.length > 0 ? { warnings: analysis.warnings } : {}),
        ...(analysis.hints.length > 0 ? { hints: analysis.hints } : {})
      };
    }

    // Always use GitOperationManager for proper workflow:
    // 1. Compute changes
    // 2. Validate with hooks
    // 3. Write to remote
    // Git repo will be created automatically if it doesn't exist
    const operation = new EditOperationStrategy({
      scriptId,
      path: params.path,
      edits: params.edits,
      fuzzyWhitespace: params.fuzzyWhitespace,
      accessToken,
      gasClient: this.gasClient
    });

    const pathResolver = new GitPathResolver();
    const syncFactory = new SyncStrategyFactory();
    const gitManager = new GitOperationManager(pathResolver, syncFactory, this.gasClient);

    // Use provided changeReason or generate default
    const defaultMessage = `Update ${filename}`;

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

    // Merge tool-level analysis with strategy-level analysis (strategy runs on hook-validated written content)
    const strategyWarnings = gitResult.result.warnings ?? [];
    const strategyHints = gitResult.result.hints ?? [];
    const allWarnings = [...new Set([...analysis.warnings, ...strategyWarnings])];
    const allHints = [...new Set([...analysis.hints, ...strategyHints])];

    // Return response with compact git hints for LLM guidance
    const result: EditResult = {
      success: true,
      editsApplied,
      filePath: params.path,
      hash: editedHash,  // Git SHA-1 of WRAPPED content. Use for expectedHash on subsequent edits.
      // Compact git hint from GitOperationManager, with workflow steps when blocked
      git: gitResult.git?.hint
        ? {
            ...gitResult.git.hint,
            ...(gitResult.git.hint.blocked
              ? { workflow: buildWriteWorkflowHints(gitResult.git.hint, scriptId) }
              : {}),
          }
        : undefined,
      // Include content analysis warnings and hints (merged from tool + strategy)
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
      ...(allHints.length > 0 ? { hints: allHints } : {})
    };

    // Add git breadcrumb hint for .git/* files
    const gitBreadcrumbHint = getGitBreadcrumbEditHint(filename);
    if (gitBreadcrumbHint) {
      result.gitBreadcrumbHint = gitBreadcrumbHint;
    }

    return result;
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
