// Two-phase write: compute (wrap CommonJS + module options) → apply (push remote + git stage)

/**
 * WriteOperationStrategy - Remote write strategy for the two-phase git workflow
 *
 * Implements FileOperationStrategy for writing (creating or replacing) files.
 * Receives fully-processed content from WriteTool (cleaned + wrapped) and
 * handles the remote push + post-write bookkeeping in applyChanges().
 *
 * Workflow:
 * 1. computeChanges(): package pre-processed content into Map (no remote reads)
 * 2. GitOperationManager writes locally, runs hooks, reads back validated content
 * 3. applyChanges(validatedContent): write to remote GAS, update xattr + mtime
 *
 * Rollback:
 * - Restore original remote content if applyChanges fails
 */

import { GASClient } from '../../../api/gasClient.js';
import { ConflictError, type ConflictDetails } from '../../../errors/mcpErrors.js';
import { fileNameMatches } from '../../../api/pathParser.js';
import { computeGitSha1, hashesEqual } from '../../../utils/hashUtils.js';
import { unwrapModuleContent } from '../../../utils/moduleWrapper.js';
import { generateFileDiff, getDiffStats } from '../../../utils/diffGenerator.js';
import { mcpLogger } from '../../../utils/mcpLogger.js';
import { readFile } from 'fs/promises';
import type { FileOperationStrategy, OperationType } from './FileOperationStrategy.js';

export interface WriteStrategyParams {
  scriptId: string;
  filename: string;
  /** Fully processed and wrapped content ready to write to GAS */
  processedContent: string;
  fileType: 'SERVER_JS' | 'HTML' | 'JSON';
  force?: boolean;
  expectedHash?: string;
  /** Local file path (with extension) for xattr cache and mtime updates */
  localFilePath?: string;
  accessToken?: string;
  gasClient: GASClient;
  /** Pre-fetched project files to avoid redundant API calls */
  prefetchedFiles?: any[];
}

export interface WriteStrategyResult {
  success: boolean;
  filename: string;
  hash: string;
  size: number;
  updateTime?: string;
  /** Wrapped content written to remote, for local file sync in GitOperationManager */
  wrappedContent?: Map<string, string>;
}

/**
 * Write operation strategy for file creation and replacement (two-phase)
 */
export class WriteOperationStrategy implements FileOperationStrategy<WriteStrategyResult> {
  private params: WriteStrategyParams;
  private originalRemoteSource: string | null = null;

  constructor(params: WriteStrategyParams) {
    this.params = params;
  }

  /**
   * PHASE 1: Compute changes without side effects
   *
   * Packages the pre-processed content (already cleaned + wrapped by WriteTool)
   * into a Map for GitOperationManager's hook validation workflow.
   * Does NOT read from remote or perform any writes.
   */
  async computeChanges(): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    result.set(this.params.filename, this.params.processedContent);
    return result;
  }

  /**
   * PHASE 2: Apply validated changes to remote
   *
   * Receives hook-validated content (may differ from processedContent if hooks
   * reformatted it), performs conflict detection, writes to remote GAS, and
   * updates local xattr cache + mtime.
   */
  async applyChanges(validatedContent: Map<string, string>): Promise<WriteStrategyResult> {
    const { scriptId, filename, fileType, force, expectedHash, localFilePath, accessToken, gasClient, prefetchedFiles } = this.params;

    const contentToWrite = validatedContent.get(filename);
    if (contentToWrite === undefined) {
      throw new Error(`No validated content found for ${filename}`);
    }

    // Fetch current project files (use prefetch if available)
    const currentFiles = prefetchedFiles || await gasClient.getProjectContent(scriptId, accessToken);
    const existingFile = currentFiles.find((f: any) => fileNameMatches(f.name, filename));

    // Preserve original for rollback
    this.originalRemoteSource = existingFile?.source ?? null;

    // === HASH-BASED CONFLICT DETECTION ===
    if (existingFile && force) {
      const currentRemoteHash = computeGitSha1(existingFile.source || '');
      mcpLogger.warning('git', `[WRITE-STRATEGY] force=true: bypassing conflict detection for ${filename} (remote hash: ${currentRemoteHash.slice(0, 8)}...)`);
    }

    if (existingFile && !force) {
      const currentRemoteHash = computeGitSha1(existingFile.source || '');

      let resolvedExpectedHash: string | undefined = expectedHash;
      let hashSource: 'param' | 'xattr' | 'computed' = 'param';

      if (!resolvedExpectedHash && localFilePath) {
        // Use local git file content as the conflict detection seed.
        // The local git file stores the same wrapped content written by the last PUT —
        // computing its hash is equivalent to what xattr cached previously.
        try {
          const localContent = await readFile(localFilePath, 'utf-8');
          resolvedExpectedHash = computeGitSha1(localContent);
          hashSource = 'local_git' as any;
        } catch {
          // Local git file not available — skip conflict detection
        }
      }

      if (resolvedExpectedHash && !hashesEqual(resolvedExpectedHash, currentRemoteHash)) {
        const remoteWrappedContent = existingFile.source || '';
        const { unwrappedContent: remoteUnwrapped } = unwrapModuleContent(remoteWrappedContent);

        let diffFormat: 'unified' | 'info' = 'info';
        let diffContent = '';
        let diffStats: { linesAdded: number; linesRemoved: number } | undefined;

        if (localFilePath) {
          try {
            const localWrapped = await readFile(localFilePath, 'utf-8');
            const { unwrappedContent: localUnwrapped } = unwrapModuleContent(localWrapped);
            diffContent = generateFileDiff(filename, localUnwrapped, remoteUnwrapped);
            diffStats = getDiffStats(localUnwrapped, remoteUnwrapped);
            diffFormat = 'unified';
          } catch {
            // Local file not available - fall back to info format
          }
        }

        if (diffFormat === 'info') {
          const hashSourceLabel = hashSource === 'xattr' ? 'local cache' : 'previous read';
          diffContent = `File was modified externally since your last read.
  Expected hash: ${resolvedExpectedHash.slice(0, 8)}... (from ${hashSourceLabel})
  Current hash:  ${currentRemoteHash.slice(0, 8)}...
  Size:          ${remoteUnwrapped.length} bytes (unwrapped)

To resolve: Use cat() to fetch current content, then re-apply your changes.
Or use force:true to overwrite (destructive).`;
        }

        const conflict: ConflictDetails = {
          scriptId,
          filename,
          operation: 'write',
          expectedHash: resolvedExpectedHash,
          currentHash: currentRemoteHash,
          hashSource,
          changeDetails: {
            sizeChange: `${remoteUnwrapped.length} bytes (unwrapped)`
          },
          diff: {
            format: diffFormat,
            content: diffContent,
            linesAdded: diffStats?.linesAdded,
            linesRemoved: diffStats?.linesRemoved,
            truncated: diffContent.length > 10000
          }
        };

        throw new ConflictError(conflict);
      }
    }
    // === END HASH-BASED CONFLICT DETECTION ===

    // Build updated file list for remote
    const newFile = {
      name: filename,
      type: fileType as any,
      source: contentToWrite
    };

    const updatedFiles = existingFile
      ? currentFiles.map((f: any) => fileNameMatches(f.name, filename) ? newFile : f)
      : [...currentFiles, newFile];

    // Write to remote GAS
    const remoteResult = await gasClient.updateProjectContent(scriptId, updatedFiles, accessToken);
    const updatedFile = remoteResult.find((f: any) => fileNameMatches(f.name, filename));

    // Compute hash of written content for response (used by callers for optimistic locking)
    const writtenHash = computeGitSha1(contentToWrite);

    return {
      success: true,
      filename,
      hash: writtenHash,
      size: contentToWrite.length,
      updateTime: updatedFile?.updateTime,
      wrappedContent: new Map([[filename, contentToWrite]])
    };
  }

  /**
   * Rollback write by restoring original remote content
   */
  async rollback(): Promise<void> {
    const { scriptId, filename, fileType, accessToken, gasClient, prefetchedFiles } = this.params;

    if (this.originalRemoteSource === null) {
      // New file (did not exist before) - delete it from remote.
      // Always fetch current state; prefetchedFiles predates applyChanges() and would not
      // contain the newly written file, making the filter a no-op.
      try {
        const currentFiles = await gasClient.getProjectContent(scriptId, accessToken);
        const withoutFile = currentFiles.filter((f: any) => !fileNameMatches(f.name, filename));
        await gasClient.updateProjectContent(scriptId, withoutFile, accessToken);
        mcpLogger.info('git', `[WRITE-STRATEGY] Rollback: removed new file ${filename} from remote`);
      } catch (error: any) {
        mcpLogger.warning('git', `[WRITE-STRATEGY] Rollback failed (could not remove new file): ${error.message}`);
      }
      return;
    }

    // Existing file - restore original content
    try {
      const currentFiles = await gasClient.getProjectContent(scriptId, accessToken);
      const restored = currentFiles.map((f: any) =>
        fileNameMatches(f.name, filename)
          ? { ...f, source: this.originalRemoteSource }
          : f
      );
      await gasClient.updateProjectContent(scriptId, restored, accessToken);
      mcpLogger.info('git', `[WRITE-STRATEGY] Rollback: restored original content of ${filename}`);
    } catch (error: any) {
      mcpLogger.warning('git', `[WRITE-STRATEGY] Rollback failed (could not restore original): ${error.message}`);
    }
  }

  /**
   * Get list of affected files (single file for write)
   */
  getAffectedFiles(): string[] {
    return [this.params.filename];
  }

  /**
   * Get operation type
   */
  getType(): OperationType {
    return 'write';
  }

  /**
   * Get operation description
   */
  getDescription(): string {
    return `Write ${this.params.filename} (${this.params.processedContent.length} bytes)`;
  }
}
