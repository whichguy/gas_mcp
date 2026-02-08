/**
 * MoveOperationStrategy - File move/rename strategy
 *
 * Implements FileOperationStrategy for moving/renaming files.
 * Supports both same-project and cross-project moves.
 *
 * Workflow:
 * 1. Read source file from remote GAS
 * 2. Create file at destination
 * 3. Delete file from source
 * 4. Return both source and destination for git tracking
 *
 * Rollback:
 * - Delete destination file
 * - Restore source file
 */

import { GASClient } from '../../../api/gasClient.js';
import { ValidationError, FileOperationError } from '../../../errors/mcpErrors.js';
import { resolveHybridScriptId, fileNameMatches } from '../../../api/pathParser.js';
import { shouldWrapContent, unwrapModuleContent, wrapModuleContent, getModuleName, type ModuleOptions } from '../../../utils/moduleWrapper.js';
import type { FileOperationStrategy, OperationType } from './FileOperationStrategy.js';

interface MoveStrategyParams {
  scriptId: string;
  from: string;
  to: string;
  accessToken?: string;
  gasClient: GASClient;
}

interface MoveResult {
  status: 'moved';
  from: string;
  to: string;
  fromProjectId: string;
  toProjectId: string;
  isCrossProject: boolean;
  wrappedContent: string;  // For hash computation in tool
}

/**
 * Move operation strategy for file move/rename (two-phase)
 */
export class MoveOperationStrategy implements FileOperationStrategy<MoveResult> {
  private params: MoveStrategyParams;
  private sourceFile: any = null;
  private fromProjectId: string | null = null;
  private toProjectId: string | null = null;
  private fromFilename: string | null = null;
  private toFilename: string | null = null;
  private isCrossProject: boolean = false;
  private existingOptions: ModuleOptions | null = null;
  private unwrappedContent: string | null = null;

  constructor(params: MoveStrategyParams) {
    this.params = params;
  }

  /**
   * PHASE 1: Compute changes without side effects
   *
   * Reads source file, prepares for move/rename.
   * Does NOT write to remote (no side effects).
   */
  async computeChanges(): Promise<Map<string, string>> {
    // Resolve script IDs using hybrid approach (supports cross-project moves)
    const fromResolution = resolveHybridScriptId(this.params.scriptId, this.params.from, 'move operation (from)');
    const toResolution = resolveHybridScriptId(this.params.scriptId, this.params.to, 'move operation (to)');

    this.fromProjectId = fromResolution.scriptId;
    this.toProjectId = toResolution.scriptId;
    this.fromFilename = fromResolution.cleanPath;
    this.toFilename = toResolution.cleanPath;
    this.isCrossProject = this.fromProjectId !== this.toProjectId;

    // Validate that we have actual filenames
    if (!this.fromFilename || !this.toFilename) {
      throw new ValidationError('path', 'from/to', 'valid filenames (cannot be empty)');
    }

    // Get source file content
    const sourceFiles = await this.params.gasClient.getProjectContent(
      this.fromProjectId,
      this.params.accessToken
    );
    this.sourceFile = sourceFiles.find((f: any) => fileNameMatches(f.name, this.fromFilename!));

    if (!this.sourceFile) {
      throw new FileOperationError('move', this.params.from, 'source file not found');
    }

    // COMMONJS PROCESSING: Unwrap source content and preserve options
    let processedContent = this.sourceFile.source || '';
    const fileType = this.sourceFile.type || 'SERVER_JS';

    if (shouldWrapContent(fileType, this.fromFilename)) {
      // Unwrap CommonJS from source (like cat does) and preserve options
      const { unwrappedContent, existingOptions } = unwrapModuleContent(processedContent);
      if (unwrappedContent !== processedContent) {
        processedContent = unwrappedContent;
      }
      // Store existing options for preservation during re-wrap
      this.existingOptions = existingOptions;
    }

    this.unwrappedContent = processedContent;

    // Return map with two entries:
    // 1. Source file: empty string signals deletion
    // 2. Destination file: unwrapped content (will be re-wrapped in applyChanges)
    const result = new Map<string, string>();
    result.set(this.fromFilename, ''); // Empty = delete
    result.set(this.toFilename, processedContent);
    return result;
  }

  /**
   * PHASE 2: Apply validated changes to remote
   *
   * Receives hook-validated content and applies move operation.
   * Creates destination file, deletes source file.
   */
  async applyChanges(validatedContent: Map<string, string>): Promise<MoveResult> {
    if (!this.fromProjectId || !this.toProjectId || !this.fromFilename || !this.toFilename || !this.sourceFile) {
      throw new Error('computeChanges() must be called before applyChanges()');
    }

    // Get validated content for destination file
    const destContent = validatedContent.get(this.toFilename);
    if (destContent === undefined) {
      throw new Error(`No validated content found for ${this.toFilename}`);
    }

    const fileType = this.sourceFile.type || 'SERVER_JS';

    // Wrap CommonJS if needed before writing to remote, preserving existing options
    let finalContent = destContent;
    if (shouldWrapContent(fileType, this.toFilename)) {
      const moduleName = getModuleName(this.toFilename);
      finalContent = wrapModuleContent(destContent, moduleName, this.existingOptions);
    }

    // Create file at destination with validated content and original type
    await this.params.gasClient.updateFile(
      this.toProjectId,
      this.toFilename,
      finalContent,
      undefined,
      this.params.accessToken,
      fileType as 'SERVER_JS' | 'HTML' | 'JSON'
    );

    // Delete file from source
    await this.params.gasClient.deleteFile(
      this.fromProjectId,
      this.fromFilename,
      this.params.accessToken
    );

    return {
      status: 'moved',
      from: this.params.from,
      to: this.params.to,
      fromProjectId: this.fromProjectId,
      toProjectId: this.toProjectId,
      isCrossProject: this.isCrossProject,
      wrappedContent: finalContent  // For hash computation in tool
    };
  }

  /**
   * Rollback move operation by restoring source and deleting destination
   */
  async rollback(): Promise<void> {
    if (!this.fromProjectId || !this.toProjectId || !this.fromFilename || !this.toFilename || !this.sourceFile) {
      // Nothing to rollback
      return;
    }

    try {
      // Delete destination file (if it was created)
      await this.params.gasClient.deleteFile(
        this.toProjectId,
        this.toFilename,
        this.params.accessToken
      );
    } catch (error: any) {
      // Destination may not exist if operation failed early
    }

    try {
      // Restore source file with original content (already wrapped)
      // Note: sourceFile.source contains the original wrapped content
      await this.params.gasClient.updateFile(
        this.fromProjectId,
        this.fromFilename,
        this.sourceFile.source || '',
        undefined,
        this.params.accessToken,
        this.sourceFile.type as 'SERVER_JS' | 'HTML' | 'JSON'
      );
    } catch (error: any) {
      // Log but don't throw - best effort rollback
    }
  }

  /**
   * Get list of affected files (source and destination)
   */
  getAffectedFiles(): string[] {
    const files: string[] = [];

    if (this.fromFilename) {
      files.push(this.fromFilename);
    }

    if (this.toFilename && this.toFilename !== this.fromFilename) {
      files.push(this.toFilename);
    }

    return files;
  }

  /**
   * Get operation type
   */
  getType(): OperationType {
    return 'move';
  }

  /**
   * Get operation description
   */
  getDescription(): string {
    if (this.isCrossProject) {
      return `Move ${this.params.from} to ${this.params.to} (cross-project)`;
    }
    return `Move ${this.params.from} to ${this.params.to}`;
  }
}
