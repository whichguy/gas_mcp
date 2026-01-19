/**
 * DeleteOperationStrategy - File deletion strategy
 *
 * Implements FileOperationStrategy for deleting files.
 * Supports local cache cleanup.
 *
 * Workflow:
 * 1. Get file content (for rollback backup)
 * 2. Delete file from remote GAS
 * 3. Return deleted file for git tracking
 *
 * Rollback:
 * - Restore file from backup
 */

import { GASClient } from '../../../api/gasClient.js';
import { ValidationError, FileOperationError } from '../../../errors/mcpErrors.js';
import { parsePath, resolveHybridScriptId, fileNameMatches } from '../../../api/pathParser.js';
import type { FileOperationStrategy, OperationType } from './FileOperationStrategy.js';

interface DeleteStrategyParams {
  scriptId: string;
  path: string;
  accessToken?: string;
  gasClient: GASClient;
}

interface DeleteResult {
  success: boolean;
  path: string;
  remoteDeleted: boolean;
}

/**
 * Delete operation strategy for file deletion (two-phase)
 */
export class DeleteOperationStrategy implements FileOperationStrategy<DeleteResult> {
  private params: DeleteStrategyParams;
  private deletedFile: any = null;
  private scriptId: string | null = null;
  private filename: string | null = null;

  constructor(params: DeleteStrategyParams) {
    this.params = params;
  }

  /**
   * PHASE 1: Compute changes without side effects
   *
   * Reads file to be deleted (for backup/rollback).
   * Does NOT delete from remote (no side effects).
   */
  async computeChanges(): Promise<Map<string, string>> {
    const hybridResolution = resolveHybridScriptId(this.params.scriptId, this.params.path);
    const fullPath = `${hybridResolution.scriptId}/${hybridResolution.cleanPath}`;

    const parsedPath = parsePath(fullPath);

    if (!parsedPath.isFile || !parsedPath.filename) {
      throw new ValidationError('path', this.params.path, 'file path (must include filename)');
    }

    this.scriptId = parsedPath.scriptId;
    this.filename = parsedPath.filename;

    // Get file content first (for rollback backup)
    const allFiles = await this.params.gasClient.getProjectContent(
      this.scriptId,
      this.params.accessToken
    );
    this.deletedFile = allFiles.find((f: any) => fileNameMatches(f.name, this.filename!));

    if (!this.deletedFile) {
      throw new FileOperationError('delete', this.params.path, 'file not found');
    }

    // Return empty string to signal deletion
    const result = new Map<string, string>();
    result.set(this.filename, ''); // Empty = delete
    return result;
  }

  /**
   * PHASE 2: Apply validated changes to remote
   *
   * Deletes file from remote GAS.
   */
  async applyChanges(validatedContent: Map<string, string>): Promise<DeleteResult> {
    if (!this.scriptId || !this.filename) {
      throw new Error('computeChanges() must be called before applyChanges()');
    }

    // Delete file from remote
    await this.params.gasClient.deleteFile(
      this.scriptId,
      this.filename,
      this.params.accessToken
    );

    return {
      success: true,
      path: this.params.path,
      remoteDeleted: true
    };
  }

  /**
   * Rollback delete operation by restoring file
   */
  async rollback(): Promise<void> {
    if (!this.scriptId || !this.filename || !this.deletedFile) {
      // Nothing to rollback
      return;
    }

    try {
      // Restore deleted file
      await this.params.gasClient.updateFile(
        this.scriptId,
        this.filename,
        this.deletedFile.source || '',
        undefined,
        this.params.accessToken,
        this.deletedFile.type as 'SERVER_JS' | 'HTML' | 'JSON'
      );
    } catch (error: any) {
      // Log but don't throw - best effort rollback
    }
  }

  /**
   * Get list of affected files (deleted file)
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
    return 'delete';
  }

  /**
   * Get operation description
   */
  getDescription(): string {
    return `Delete ${this.params.path}`;
  }
}
