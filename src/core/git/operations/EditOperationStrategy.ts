/**
 * EditOperationStrategy - Token-efficient file editing strategy
 *
 * Implements FileOperationStrategy for exact string matching edits.
 * Supports multi-edit operations with atomic rollback.
 *
 * Workflow:
 * 1. Read file from remote GAS
 * 2. Unwrap CommonJS (if SERVER_JS)
 * 3. Apply edits sequentially
 * 4. Wrap CommonJS (if SERVER_JS)
 * 5. Update remote GAS
 * 6. Return modified content for git commit
 *
 * Rollback:
 * - Restore original content to remote GAS
 */

import { GASClient } from '../../../api/gasClient.js';
import { ValidationError, FileOperationError } from '../../../errors/mcpErrors.js';
import { parsePath, resolveHybridScriptId, fileNameMatches } from '../../../api/pathParser.js';
import { unwrapModuleContent, wrapModuleContent, shouldWrapContent, type ModuleOptions } from '../../../utils/moduleWrapper.js';
import { translatePathForOperation } from '../../../utils/virtualFileTranslation.js';
import type { FileOperationStrategy, OperationType } from './FileOperationStrategy.js';

interface EditOperation {
  oldText: string;
  newText: string;
  index?: number; // Which occurrence to replace if multiple matches (0-based)
}

interface EditStrategyParams {
  scriptId: string;
  path: string;
  edits: EditOperation[];
  fuzzyWhitespace?: boolean;
  accessToken?: string;
  gasClient: GASClient;
}

interface EditResult {
  success: boolean;
  editsApplied: number;
  filePath: string;
}

/**
 * Edit operation strategy for token-efficient file editing (two-phase)
 */
export class EditOperationStrategy implements FileOperationStrategy<EditResult> {
  private params: EditStrategyParams;
  private originalContent: string | null = null;
  private modifiedContent: string | null = null;
  private filename: string | null = null;
  private scriptId: string | null = null;
  private fileType: 'SERVER_JS' | 'HTML' | 'JSON' | null = null;
  private editsApplied: number = 0;
  private existingOptions: ModuleOptions | null = null;

  constructor(params: EditStrategyParams) {
    this.params = params;
  }

  /**
   * PHASE 1: Compute changes without side effects
   *
   * Reads file from remote, applies edits, returns modified content.
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
    this.editsApplied = 0;

    // Apply edits sequentially
    for (const [idx, edit] of this.params.edits.entries()) {
      const { oldText, newText, index } = edit;

      // Normalize whitespace if requested
      const searchText = this.params.fuzzyWhitespace
        ? this.normalizeWhitespace(oldText)
        : oldText;
      const contentToSearch = this.params.fuzzyWhitespace
        ? this.normalizeWhitespace(content)
        : content;

      // Find all occurrences
      const occurrences = this.findAllOccurrences(contentToSearch, searchText);

      if (occurrences.length === 0) {
        throw new FileOperationError(
          `edit (${idx + 1})`,
          this.params.path,
          `Text not found: "${oldText.substring(0, 50)}${oldText.length > 50 ? '...' : ''}"`
        );
      }

      // Handle multiple matches
      if (occurrences.length > 1 && index === undefined) {
        throw new FileOperationError(
          `edit (${idx + 1})`,
          this.params.path,
          `Found ${occurrences.length} occurrences of text. Specify 'index' parameter to choose which one (0-based).`
        );
      }

      const targetIndex = index !== undefined ? index : 0;
      if (targetIndex >= occurrences.length) {
        throw new FileOperationError(
          `edit (${idx + 1})`,
          this.params.path,
          `Index ${targetIndex} out of range (found ${occurrences.length} occurrences)`
        );
      }

      // Apply replacement
      const position = occurrences[targetIndex];
      content = content.substring(0, position) +
                newText +
                content.substring(position + oldText.length);

      this.editsApplied++;
    }

    this.modifiedContent = content;

    // Return unwrapped content (GitOperationManager will handle hooks)
    // Note: We return UNWRAPPED content so hooks see clean user code
    const result = new Map<string, string>();
    result.set(this.filename, content);
    return result;
  }

  /**
   * PHASE 2: Apply validated changes to remote
   *
   * Receives hook-validated content and writes to remote GAS.
   * Content may have been modified by pre-commit hooks (auto-formatted, etc).
   */
  async applyChanges(validatedContent: Map<string, string>): Promise<EditResult> {
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
   * Rollback edit operation by restoring original content
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
   * Get list of affected files (single file for edit)
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
    return 'edit';
  }

  /**
   * Get operation description
   */
  getDescription(): string {
    const editCount = this.params.edits.length;
    return `Edit ${this.params.path}: ${editCount} edit${editCount > 1 ? 's' : ''} applied`;
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
}
