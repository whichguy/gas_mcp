/**
 * AiderOperationStrategy - Fuzzy file editing strategy
 *
 * Implements FileOperationStrategy for fuzzy string matching edits.
 * Supports multi-edit operations with atomic rollback.
 *
 * Workflow:
 * 1. Read file from remote GAS
 * 2. Unwrap CommonJS (if SERVER_JS)
 * 3. Find fuzzy matches for all edits
 * 4. Apply edits in reverse position order
 * 5. Wrap CommonJS (if SERVER_JS)
 * 6. Update remote GAS
 * 7. Return modified content for git commit
 *
 * Rollback:
 * - Restore original content to remote GAS
 */

import { GASClient } from '../../../api/gasClient.js';
import { ValidationError, FileOperationError } from '../../../errors/mcpErrors.js';
import { parsePath, resolveHybridScriptId, fileNameMatches } from '../../../api/pathParser.js';
import { unwrapModuleContent, wrapModuleContent, shouldWrapContent, type ModuleOptions } from '../../../utils/moduleWrapper.js';
import { translatePathForOperation } from '../../../utils/virtualFileTranslation.js';
import { FuzzyMatcher, type EditOperation } from '../../../utils/fuzzyMatcher.js';
import type { FileOperationStrategy, OperationType } from './FileOperationStrategy.js';

interface AiderOperation {
  searchText: string;
  replaceText: string;
  similarityThreshold?: number; // 0.0 to 1.0, default 0.8
}

interface AiderStrategyParams {
  scriptId: string;
  path: string;
  edits: AiderOperation[];
  accessToken?: string;
  gasClient: GASClient;
}

interface AiderResult {
  success: boolean;
  editsApplied: number;
  filePath: string;
}

/**
 * Aider operation strategy for fuzzy file editing
 */
export class AiderOperationStrategy implements FileOperationStrategy<AiderResult> {
  private params: AiderStrategyParams;
  private originalContent: string | null = null;
  private modifiedContent: string | null = null;
  private filename: string | null = null;
  private scriptId: string | null = null;
  private fileType: 'SERVER_JS' | 'HTML' | 'JSON' | null = null;
  private editsApplied: number = 0;
  private existingOptions: ModuleOptions | null = null;
  private fuzzyMatcher: FuzzyMatcher;

  constructor(params: AiderStrategyParams) {
    this.params = params;
    this.fuzzyMatcher = new FuzzyMatcher();
  }

  /**
   * PHASE 1: Compute changes without side effects
   *
   * Reads file from remote, applies fuzzy edits, returns modified content.
   * Does NOT write to remote (no side effects).
   */
  async computeChanges(): Promise<Map<string, string>> {
    // Validate inputs
    if (!this.params.edits || this.params.edits.length === 0) {
      throw new ValidationError('edits', this.params.edits, 'at least one edit operation required');
    }

    if (this.params.edits.length > 20) {
      throw new ValidationError('edits', this.params.edits, 'maximum 20 edit operations per call');
    }

    // Validate searchText length for performance
    for (let i = 0; i < this.params.edits.length; i++) {
      const edit = this.params.edits[i];
      if (edit.searchText.length > 1000) {
        throw new ValidationError(
          `edits[${i}].searchText`,
          edit.searchText.substring(0, 50) + '...',
          'searchText maximum 1,000 characters. For larger patterns, use grep or ripgrep instead.'
        );
      }
    }

    // Translate path and resolve hybrid script ID
    const translatedPath = translatePathForOperation(this.params.path, true);
    const hybridResolution = resolveHybridScriptId(this.params.scriptId, translatedPath);
    const fullPath = `${hybridResolution.scriptId}/${hybridResolution.cleanPath}`;

    // Validate path
    const parsedPath = parsePath(fullPath);
    if (!parsedPath.isFile || !parsedPath.filename) {
      throw new ValidationError('path', this.params.path, 'file path must include a filename');
    }

    this.scriptId = parsedPath.scriptId;
    this.filename = parsedPath.filename;

    // Read current file content from remote
    const allFiles = await this.params.gasClient.getProjectContent(
      this.scriptId,
      this.params.accessToken
    );
    const fileContent = allFiles.find((f: any) => fileNameMatches(f.name, this.filename!));

    if (!fileContent) {
      throw new ValidationError('filename', this.filename, 'existing file in the project');
    }

    this.fileType = fileContent.type as 'SERVER_JS' | 'HTML' | 'JSON';

    // Unwrap CommonJS if needed and preserve existing options
    let content = fileContent.source || '';
    if (this.fileType === 'SERVER_JS') {
      const { unwrappedContent, existingOptions } = unwrapModuleContent(content);
      if (unwrappedContent) {
        content = unwrappedContent;
      }
      // Store existing options for preservation during re-wrap
      this.existingOptions = existingOptions;
    }

    this.originalContent = content;

    // Convert params to EditOperation format
    const editOperations: EditOperation[] = this.params.edits.map(edit => ({
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
      throw new FileOperationError('aider', this.params.path, error.message);
    }

    // Check if any edits failed to find matches
    const failedEdits = editsWithMatches.filter(edit => edit.match === undefined);
    if (failedEdits.length > 0) {
      const firstFailed = failedEdits[0];
      const threshold = firstFailed.similarityThreshold ?? 0.8;
      throw new FileOperationError(
        'aider',
        this.params.path,
        `No match found above ${(threshold * 100).toFixed(0)}% similarity for: "${firstFailed.searchText.substring(0, 50)}${firstFailed.searchText.length > 50 ? '...' : ''}"`
      );
    }

    // Apply edits in reverse position order (prevents position invalidation)
    const { content: modifiedContent, editsApplied } = this.fuzzyMatcher.applyEdits(content, editsWithMatches);

    this.modifiedContent = modifiedContent;
    this.editsApplied = editsApplied;

    // Return unwrapped content (GitOperationManager will handle hooks)
    const result = new Map<string, string>();
    result.set(this.filename, modifiedContent);
    return result;
  }

  /**
   * PHASE 2: Apply validated changes to remote
   *
   * Receives hook-validated content and writes to remote GAS.
   * Content may have been modified by pre-commit hooks (auto-formatted, etc).
   */
  async applyChanges(validatedContent: Map<string, string>): Promise<AiderResult> {
    if (!this.filename || !this.scriptId || !this.fileType) {
      throw new Error('computeChanges() must be called before applyChanges()');
    }

    // Get validated content for this file
    const content = validatedContent.get(this.filename);
    if (content === undefined) {
      throw new Error(`No validated content found for ${this.filename}`);
    }

    // Wrap CommonJS if needed before writing to remote, preserving existing options
    let finalContent = content;
    if (this.fileType === 'SERVER_JS' && shouldWrapContent(this.fileType, this.filename)) {
      finalContent = wrapModuleContent(content, this.filename, this.existingOptions);
    }

    // Write validated content to remote
    await this.params.gasClient.updateFile(
      this.scriptId,
      this.filename,
      finalContent,
      undefined,
      this.params.accessToken,
      this.fileType
    );

    // Return minimal response for token efficiency
    return {
      success: true,
      editsApplied: this.editsApplied,
      filePath: this.params.path
    };
  }

  /**
   * Rollback aider operation by restoring original content
   *
   * TODO: Readonly operations like aider should never trigger rollback if they
   * never performed a write operation. Currently rollback() is called even
   * during computeChanges() phase when no remote writes occurred.
   */
  async rollback(): Promise<void> {
    if (!this.scriptId || !this.filename || !this.originalContent || !this.fileType) {
      // Nothing to rollback
      return;
    }

    // Wrap original content if needed, preserving existing options
    let finalContent = this.originalContent;
    if (this.fileType === 'SERVER_JS' && shouldWrapContent(this.fileType, this.filename)) {
      finalContent = wrapModuleContent(this.originalContent, this.filename, this.existingOptions);
    }

    // Restore original content to remote
    await this.params.gasClient.updateFile(
      this.scriptId,
      this.filename,
      finalContent,
      undefined,
      this.params.accessToken,
      this.fileType
    );
  }

  /**
   * Get list of affected files (single file for aider)
   */
  getAffectedFiles(): string[] {
    if (!this.filename) {
      return [];
    }
    return [this.filename];
  }

  /**
   * Get operation type
   */
  getType(): OperationType {
    return 'aider';
  }

  /**
   * Get operation description
   */
  getDescription(): string {
    const editCount = this.params.edits.length;
    return `Aider ${this.params.path}: ${editCount} fuzzy edit${editCount > 1 ? 's' : ''} applied`;
  }
}
