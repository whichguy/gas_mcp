import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ValidationError, FileOperationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { parsePath, resolveHybridScriptId } from '../api/pathParser.js';
import { unwrapModuleContent, wrapModuleContent, shouldWrapContent } from '../utils/moduleWrapper.js';
import { translatePathForOperation } from '../utils/virtualFileTranslation.js';

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
 * Token-efficient file editing with fuzzy string matching
 *
 * Like EditTool but uses fuzzy matching to find similar (but not exact) text.
 * Useful when text has formatting variations, whitespace differences, or minor changes.
 */
export class AiderTool extends BaseTool {
  public name = 'aider';
  public description = 'Token-efficient file editing using fuzzy string matching. Finds and replaces similar (not exact) text, handling formatting variations and minor differences. Provides 95%+ token savings vs gas_write.';

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
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying them. Returns matches found and similarity scores.',
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
      whenToUse: 'Use when text might have formatting variations, whitespace differences, or you\'re uncertain of exact content. Fuzzy matching finds similar text even when not character-exact, making it ideal for editing code that may have been reformatted or copied from formatted output.',

      howToUse: [
        '1. Identify the approximate text you want to change (doesn\'t need to be exact)',
        '2. Choose similarity threshold: 0.9+ (strict), 0.8 (default), 0.7 (permissive)',
        '3. Use dryRun: true first to preview matches and verify correct text is found',
        '4. Apply edits - tool will find best fuzzy match and replace it',
        '5. Check response for editsApplied count to confirm success'
      ],

      whenNotToUse: [
        '❌ When exact text is known → Use gas_edit instead (faster, more precise)',
        '❌ For regex pattern matching → Use gas_sed for pattern-based replacements',
        '❌ For new file creation → Use gas_write to create files from scratch',
        '❌ When multiple occurrences need different replacements → Use gas_edit with index parameter',
        '❌ For system file editing → Use gas_raw_aider for files with CommonJS wrappers'
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
          scenario: 'Basic fuzzy edit with whitespace variations',
          code: 'gas_aider({scriptId: "...", path: "utils", edits: [{searchText: "function   test()", replaceText: "function testNew()"}]})'
        },
        {
          scenario: 'Permissive threshold for significant formatting differences',
          code: 'gas_aider({scriptId: "...", path: "config", edits: [{searchText: "debug=false", replaceText: "debug=true", similarityThreshold: 0.7}]})'
        },
        {
          scenario: 'Preview matches before applying (recommended)',
          code: 'gas_aider({scriptId: "...", path: "main", edits: [{searchText: "const oldVar", replaceText: "const newVar"}], dryRun: true})'
        },
        {
          scenario: 'Multiple fuzzy edits in sequence',
          code: 'gas_aider({scriptId: "...", path: "api", edits: [{searchText: "port:3000", replaceText: "port:8080"}, {searchText: "host:localhost", replaceText: "host:0.0.0.0"}]})'
        }
      ],

      comparisonToOtherTools: {
        vsGasEdit: '✅ Use aider when: Text has formatting variations, whitespace differences, uncertain of exact content\n❌ Use gas_edit when: Exact text is known for faster, more precise matching',

        vsGasWrite: '✅ Use aider when: Making small changes to existing files (95%+ token savings - only outputs ~10 tokens)\n❌ Use gas_write when: Creating new files or major refactoring (outputs entire file ~4,500+ tokens)',

        vsGasSed: '✅ Use aider when: Need flexible text matching without regex complexity, single-file edits\n❌ Use gas_sed when: Need regex patterns, multi-file replacements, pattern-based operations'
      },

      commonJsIntegration: 'Automatically unwraps CommonJS module wrappers for editing, re-wraps when writing. You edit clean user code - the system handles module infrastructure transparently.',

      scriptTypeCompatibility: {
        standalone: '✅ Full Support - Works identically',
        containerBound: '✅ Full Support - Works identically',
        notes: 'Fuzzy editing works universally for both script types with automatic CommonJS processing.'
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

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
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
    const matches: Array<{
      searchText: string;
      foundText: string;
      similarity: number;
      applied: boolean;
    }> = [];

    // Apply fuzzy edits sequentially
    for (const [idx, edit] of params.edits.entries()) {
      const { searchText, replaceText, similarityThreshold = 0.8 } = edit;

      // Find best fuzzy match
      const match = this.findFuzzyMatch(content, searchText, similarityThreshold);

      if (!match) {
        matches.push({
          searchText,
          foundText: '',
          similarity: 0,
          applied: false
        });

        if (!params.dryRun) {
          throw new FileOperationError(
            `aider (${idx + 1})`,
            params.path,
            `No match found above ${(similarityThreshold * 100).toFixed(0)}% similarity for: "${searchText.substring(0, 50)}${searchText.length > 50 ? '...' : ''}"`
          );
        }
        continue;
      }

      matches.push({
        searchText,
        foundText: match.text,
        similarity: match.similarity,
        applied: true
      });

      // Apply replacement
      content = content.substring(0, match.position) +
                replaceText +
                content.substring(match.position + match.text.length);

      editsApplied++;
    }

    // Check if any changes were made
    if (content === originalContent) {
      return {
        success: true,
        editsApplied: 0,
        filePath: params.path,
        matches: params.dryRun ? matches : undefined
      };
    }

    // Dry-run mode: return matches without writing
    if (params.dryRun) {
      const diff = this.generateDiff(originalContent, content, params.path);
      return {
        success: true,
        editsApplied,
        diff,
        filePath: params.path,
        matches
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
   * Find best fuzzy match for search text in content
   * Returns position, matched text, and similarity score
   */
  private findFuzzyMatch(content: string, searchText: string, threshold: number): {
    position: number;
    text: string;
    similarity: number;
  } | null {
    const searchLength = searchText.length;
    const contentLength = content.length;

    // Sliding window to find best match
    let bestMatch: { position: number; text: string; similarity: number } | null = null;

    // Try different window sizes (±20% of search text length)
    const minWindowSize = Math.max(1, Math.floor(searchLength * 0.8));
    const maxWindowSize = Math.ceil(searchLength * 1.2);

    for (let windowSize = minWindowSize; windowSize <= maxWindowSize; windowSize++) {
      for (let i = 0; i <= contentLength - windowSize; i++) {
        const candidateText = content.substring(i, i + windowSize);
        const similarity = this.calculateSimilarity(searchText, candidateText);

        if (similarity >= threshold && (!bestMatch || similarity > bestMatch.similarity)) {
          bestMatch = {
            position: i,
            text: candidateText,
            similarity
          };
        }
      }
    }

    return bestMatch;
  }

  /**
   * Calculate similarity between two strings using Levenshtein distance
   * Returns value between 0.0 (completely different) and 1.0 (identical)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    // Normalize whitespace for comparison
    const normalized1 = this.normalizeForComparison(str1);
    const normalized2 = this.normalizeForComparison(str2);

    const distance = this.levenshteinDistance(normalized1, normalized2);
    const maxLength = Math.max(normalized1.length, normalized2.length);

    if (maxLength === 0) return 1.0;

    return 1.0 - (distance / maxLength);
  }

  /**
   * Normalize text for similarity comparison
   * Reduces whitespace variations while preserving structure
   */
  private normalizeForComparison(text: string): string {
    return text
      .replace(/\r\n/g, '\n')      // Normalize line endings
      .replace(/\t/g, '  ')         // Tabs to spaces
      .replace(/[ ]+/g, ' ')        // Multiple spaces to single
      .replace(/\n[ ]+/g, '\n')     // Remove leading spaces on lines
      .trim();
  }

  /**
   * Calculate Levenshtein distance between two strings
   * Optimized implementation with single array
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;

    // Create array for dynamic programming
    const distances = new Array(len2 + 1);

    // Initialize first row
    for (let j = 0; j <= len2; j++) {
      distances[j] = j;
    }

    // Calculate distances
    for (let i = 1; i <= len1; i++) {
      let prev = distances[0];
      distances[0] = i;

      for (let j = 1; j <= len2; j++) {
        const temp = distances[j];

        if (str1[i - 1] === str2[j - 1]) {
          distances[j] = prev;
        } else {
          distances[j] = Math.min(
            prev + 1,           // substitution
            distances[j] + 1,   // deletion
            distances[j - 1] + 1 // insertion
          );
        }

        prev = temp;
      }
    }

    return distances[len2];
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
