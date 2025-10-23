/**
 * CopyOperationStrategy - File copy strategy
 *
 * Implements FileOperationStrategy for copying files.
 * Supports CommonJS processing (unwrap source, rewrap destination).
 *
 * Workflow:
 * 1. Read source file from remote GAS
 * 2. Unwrap CommonJS from source (if SERVER_JS)
 * 3. Rewrap with destination module name (if SERVER_JS)
 * 4. Create file at destination
 * 5. Return destination file for git tracking
 *
 * Rollback:
 * - Delete destination file
 */

import { GASClient } from '../../../api/gasClient.js';
import { ValidationError, FileOperationError } from '../../../errors/mcpErrors.js';
import { resolveHybridScriptId } from '../../../api/pathParser.js';
import { translatePathForOperation } from '../../../utils/virtualFileTranslation.js';
import { shouldWrapContent, unwrapModuleContent, wrapModuleContent, getModuleName } from '../../../utils/moduleWrapper.js';
import type { FileOperationStrategy, OperationType } from './FileOperationStrategy.js';

interface CopyStrategyParams {
  scriptId: string;
  from: string;
  to: string;
  accessToken?: string;
  gasClient: GASClient;
}

interface CopyResult {
  status: 'copied';
  from: string;
  to: string;
  fromProjectId: string;
  toProjectId: string;
  isCrossProject: boolean;
}

/**
 * Copy operation strategy for file copying with CommonJS processing (two-phase)
 */
export class CopyOperationStrategy implements FileOperationStrategy<CopyResult> {
  private params: CopyStrategyParams;
  private processedContent: string | null = null;
  private fromProjectId: string | null = null;
  private toProjectId: string | null = null;
  private fromFilename: string | null = null;
  private toFilename: string | null = null;
  private fileType: 'SERVER_JS' | 'HTML' | 'JSON' | null = null;
  private isCrossProject: boolean = false;

  constructor(params: CopyStrategyParams) {
    this.params = params;
  }

  /**
   * PHASE 1: Compute changes without side effects
   *
   * Reads source file, unwraps CommonJS, prepares destination content.
   * Does NOT write to remote (no side effects).
   */
  async computeChanges(): Promise<Map<string, string>> {
    // Apply virtual file translation for user-provided paths
    const translatedFrom = translatePathForOperation(this.params.from, true);
    const translatedTo = translatePathForOperation(this.params.to, true);

    // Resolve script IDs using hybrid approach (supports cross-project copies)
    const fromResolution = resolveHybridScriptId(this.params.scriptId, translatedFrom, 'copy operation (from)');
    const toResolution = resolveHybridScriptId(this.params.scriptId, translatedTo, 'copy operation (to)');

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
    const sourceFile = sourceFiles.find((f: any) => f.name === this.fromFilename);

    if (!sourceFile) {
      throw new FileOperationError('copy', this.params.from, 'source file not found');
    }

    this.fileType = sourceFile.type || 'SERVER_JS';

    // COMMONJS PROCESSING: Unwrap source content (like cat)
    let processedContent = sourceFile.source || '';

    if (shouldWrapContent(this.fileType, this.fromFilename)) {
      // Unwrap CommonJS from source (like cat does)
      const { unwrappedContent } = unwrapModuleContent(processedContent);
      if (unwrappedContent !== processedContent) {
        processedContent = unwrappedContent;
      }
    }

    this.processedContent = processedContent;

    // Return unwrapped content (GitOperationManager will handle wrapping after hooks)
    const result = new Map<string, string>();
    result.set(this.toFilename, processedContent);
    return result;
  }

  /**
   * PHASE 2: Apply validated changes to remote
   *
   * Receives hook-validated content and writes to destination.
   * Wraps with CommonJS if needed.
   */
  async applyChanges(validatedContent: Map<string, string>): Promise<CopyResult> {
    if (!this.fromProjectId || !this.toProjectId || !this.fromFilename || !this.toFilename || !this.fileType) {
      throw new Error('computeChanges() must be called before applyChanges()');
    }

    // Get validated content for destination file
    const content = validatedContent.get(this.toFilename);
    if (content === undefined) {
      throw new Error(`No validated content found for ${this.toFilename}`);
    }

    // Wrap CommonJS if needed before writing to remote
    let finalContent = content;
    if (shouldWrapContent(this.fileType, this.toFilename)) {
      const moduleName = getModuleName(this.toFilename);
      finalContent = wrapModuleContent(content, moduleName, undefined);
    }

    // Create copy in destination with validated content
    await this.params.gasClient.updateFile(
      this.toProjectId,
      this.toFilename,
      finalContent,
      undefined,
      this.params.accessToken,
      this.fileType as 'SERVER_JS' | 'HTML' | 'JSON'
    );

    return {
      status: 'copied',
      from: this.params.from,
      to: this.params.to,
      fromProjectId: this.fromProjectId,
      toProjectId: this.toProjectId,
      isCrossProject: this.isCrossProject
    };
  }

  /**
   * Rollback copy operation by deleting destination file
   */
  async rollback(): Promise<void> {
    if (!this.toProjectId || !this.toFilename) {
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
      // Log but don't throw - best effort rollback
    }
  }

  /**
   * Get list of affected files (destination only)
   */
  getAffectedFiles(): string[] {
    if (!this.toFilename) {
      return [];
    }
    return [this.toFilename];
  }

  /**
   * Get operation type
   */
  getType(): OperationType {
    return 'copy';
  }

  /**
   * Get operation description
   */
  getDescription(): string {
    if (this.isCrossProject) {
      return `Copy ${this.params.from} to ${this.params.to} (cross-project)`;
    }
    return `Copy ${this.params.from} to ${this.params.to}`;
  }
}
