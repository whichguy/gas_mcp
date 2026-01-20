/**
 * SyncDiff - Computes differences between GAS and local file states
 *
 * Determines which files need to be added, updated, or deleted during sync.
 * Uses Git-compatible SHA-1 hashes for efficient change detection.
 *
 * Key responsibilities:
 * - Compare source and destination file sets
 * - Detect adds, updates, and deletes
 * - Handle bootstrap mode (no deletes on first sync)
 * - Use manifest for deletion tracking
 */

import { log } from '../../utils/logger.js';
import { SyncManifest, SyncManifestData } from './SyncManifest.js';
import { FileFilter, FileFilterOptions } from '../../utils/fileFilter.js';

/**
 * File information for diff computation
 *
 * For CommonJS integration:
 * - `content`: The content used for comparison (unwrapped for SERVER_JS files)
 * - `sha1`: Hash of the comparison content
 * - `originalContent`: (Optional) The original wrapped content for operations
 *
 * When computing diffs:
 * - GAS files: content = unwrapped, originalContent = wrapped (for PULL)
 * - Local files: content = as-is (already unwrapped), no originalContent needed
 */
export interface DiffFileInfo {
  filename: string;
  content: string;           // Content for comparison (unwrapped)
  sha1: string;              // Hash of comparison content
  lastModified?: string;
  size?: number;
  originalContent?: string;  // Original content for operations (wrapped for GAS files)
  fileType?: string;         // GAS file type (SERVER_JS, HTML, JSON) for extension mapping
}

/**
 * Single file operation in the sync plan
 */
export interface SyncFileOperation {
  filename: string;
  action: 'add' | 'update' | 'delete';
  sourceHash?: string;     // Hash at source
  destHash?: string;       // Hash at destination
  size?: number;
  content?: string;        // Content for add/update operations
  fileType?: string;       // GAS file type (SERVER_JS, HTML, JSON) for extension mapping
}

/**
 * Complete diff result with categorized operations
 */
export interface SyncDiffResult {
  add: SyncFileOperation[];
  update: SyncFileOperation[];
  delete: SyncFileOperation[];

  // Summary stats
  totalOperations: number;
  hasChanges: boolean;
  hasDestructiveChanges: boolean;  // True if any deletes
}

/**
 * Options for diff computation
 */
export interface DiffOptions {
  isBootstrap: boolean;           // True on first sync - no deletes allowed
  manifest?: SyncManifestData;    // Previous sync manifest for delete detection
  direction: 'pull' | 'push';     // Sync direction
}

/**
 * SyncDiff class for computing file differences
 */
export class SyncDiff {
  /**
   * Compute diff between source and destination file sets
   *
   * @param sourceFiles - Files at source (GAS for pull, local for push)
   * @param destFiles - Files at destination (local for pull, GAS for push)
   * @param options - Diff options including bootstrap flag and manifest
   * @returns SyncDiffResult with categorized operations
   */
  static compute(
    sourceFiles: DiffFileInfo[],
    destFiles: DiffFileInfo[],
    options: DiffOptions
  ): SyncDiffResult {
    const { isBootstrap, manifest, direction } = options;

    log.debug(`[DIFF] Computing diff: ${sourceFiles.length} source files, ${destFiles.length} dest files, bootstrap=${isBootstrap}`);

    const result: SyncDiffResult = {
      add: [],
      update: [],
      delete: [],
      totalOperations: 0,
      hasChanges: false,
      hasDestructiveChanges: false
    };

    // Build lookup maps by filename
    const sourceMap = new Map<string, DiffFileInfo>();
    for (const file of sourceFiles) {
      sourceMap.set(file.filename, file);
    }

    const destMap = new Map<string, DiffFileInfo>();
    for (const file of destFiles) {
      destMap.set(file.filename, file);
    }

    // Find adds and updates (files in source)
    for (const [filename, sourceFile] of sourceMap) {
      const destFile = destMap.get(filename);

      // Use originalContent for operations if available (for wrapped GAS files)
      // Otherwise use content (for local files which are already unwrapped)
      const operationContent = sourceFile.originalContent || sourceFile.content;

      if (!destFile) {
        // File exists in source but not in destination -> ADD
        result.add.push({
          filename,
          action: 'add',
          sourceHash: sourceFile.sha1,
          size: sourceFile.size,
          content: operationContent,
          fileType: sourceFile.fileType
        });

        log.debug(`[DIFF] ADD: ${filename}`);

      } else if (sourceFile.sha1 !== destFile.sha1) {
        // File exists in both but content differs -> UPDATE
        result.update.push({
          filename,
          action: 'update',
          sourceHash: sourceFile.sha1,
          destHash: destFile.sha1,
          size: sourceFile.size,
          content: operationContent,
          fileType: sourceFile.fileType
        });

        log.debug(`[DIFF] UPDATE: ${filename} (${destFile.sha1.slice(0, 8)} -> ${sourceFile.sha1.slice(0, 8)})`);
      }
      // else: files are identical, no operation needed
    }

    // Find deletes (files in destination but not in source)
    // Only if NOT bootstrap mode
    if (!isBootstrap) {
      for (const [filename, destFile] of destMap) {
        if (!sourceMap.has(filename)) {
          // File exists in destination but not in source -> DELETE
          // But only if it was previously tracked in manifest (to avoid deleting untracked files)

          if (manifest && manifest.files[filename]) {
            result.delete.push({
              filename,
              action: 'delete',
              destHash: destFile.sha1,
              fileType: destFile.fileType
            });

            log.debug(`[DIFF] DELETE: ${filename}`);
          } else if (!manifest) {
            // No manifest but not bootstrap - this shouldn't happen
            // Log warning but don't delete
            log.warn(`[DIFF] Would delete ${filename} but no manifest to verify - skipping`);
          }
        }
      }
    } else {
      // Bootstrap mode - log what would have been deleted
      const wouldDelete: string[] = [];
      for (const [filename] of destMap) {
        if (!sourceMap.has(filename)) {
          wouldDelete.push(filename);
        }
      }

      if (wouldDelete.length > 0) {
        log.info(`[DIFF] Bootstrap mode: ${wouldDelete.length} files skipped for deletion (${wouldDelete.slice(0, 3).join(', ')}${wouldDelete.length > 3 ? '...' : ''})`);
      }
    }

    // Calculate summary
    result.totalOperations = result.add.length + result.update.length + result.delete.length;
    result.hasChanges = result.totalOperations > 0;
    result.hasDestructiveChanges = result.delete.length > 0;

    log.info(`[DIFF] Result: +${result.add.length} ~${result.update.length} -${result.delete.length} (${result.totalOperations} total operations)`);

    return result;
  }

  /**
   * Convert GAS API file objects to DiffFileInfo format
   *
   * @param gasFiles - Files from GAS API (with name, source, updateTime)
   * @returns Array of DiffFileInfo
   */
  static fromGasFiles(gasFiles: Array<{ name: string; source: string; updateTime?: string }>): DiffFileInfo[] {
    return gasFiles.map(file => ({
      filename: file.name,
      content: file.source,
      sha1: SyncManifest.computeGitSha1(file.source),
      lastModified: file.updateTime,
      size: Buffer.byteLength(file.source, 'utf-8')
    }));
  }

  /**
   * Convert local file entries to DiffFileInfo format
   *
   * @param localFiles - Files from local filesystem
   * @returns Array of DiffFileInfo
   */
  static fromLocalFiles(localFiles: Array<{ filename: string; content: string; mtime?: Date }>): DiffFileInfo[] {
    return localFiles.map(file => ({
      filename: file.filename,
      content: file.content,
      sha1: SyncManifest.computeGitSha1(file.content),
      lastModified: file.mtime?.toISOString(),
      size: Buffer.byteLength(file.content, 'utf-8')
    }));
  }

  /**
   * Filter out system/infrastructure files from diff
   *
   * Uses centralized FileFilter for consistent behavior.
   *
   * @param files - Array of file info
   * @param options - Optional FileFilterOptions overrides
   * @returns Filtered file array
   */
  static filterSystemFiles(
    files: DiffFileInfo[],
    options?: FileFilterOptions
  ): DiffFileInfo[] {
    const filter = new FileFilter({
      excludeSystemFiles: true,
      excludeGitBreadcrumbs: true,
      ...options
    });

    return files.filter(file => {
      const result = filter.filter(file.filename);
      if (result.skip) {
        log.debug(`[DIFF] Excluding file: ${file.filename} (${result.reason})`);
        return false;
      }
      return true;
    });
  }

  /**
   * Detect drift between planned operations and current state
   *
   * Used to verify no changes occurred between plan and execute phases.
   *
   * @param plannedDiff - Diff from planning phase
   * @param currentSourceFiles - Current source files
   * @param currentDestFiles - Current destination files
   * @returns Object describing any drift detected
   */
  static detectDrift(
    plannedDiff: SyncDiffResult,
    currentSourceFiles: DiffFileInfo[],
    currentDestFiles: DiffFileInfo[]
  ): { hasDrift: boolean; driftDetails: string[] } {
    const driftDetails: string[] = [];

    const currentSourceMap = new Map<string, DiffFileInfo>();
    for (const file of currentSourceFiles) {
      currentSourceMap.set(file.filename, file);
    }

    const currentDestMap = new Map<string, DiffFileInfo>();
    for (const file of currentDestFiles) {
      currentDestMap.set(file.filename, file);
    }

    // Check ADD operations - source file should still exist and have same hash
    for (const op of plannedDiff.add) {
      const currentSource = currentSourceMap.get(op.filename);
      if (!currentSource) {
        driftDetails.push(`ADD ${op.filename}: source file no longer exists`);
      } else if (currentSource.sha1 !== op.sourceHash) {
        driftDetails.push(`ADD ${op.filename}: source changed since plan (${op.sourceHash?.slice(0, 8)} -> ${currentSource.sha1.slice(0, 8)})`);
      }
    }

    // Check UPDATE operations - both source and dest should match planned hashes
    for (const op of plannedDiff.update) {
      const currentSource = currentSourceMap.get(op.filename);
      const currentDest = currentDestMap.get(op.filename);

      if (!currentSource) {
        driftDetails.push(`UPDATE ${op.filename}: source file no longer exists`);
      } else if (currentSource.sha1 !== op.sourceHash) {
        driftDetails.push(`UPDATE ${op.filename}: source changed since plan`);
      }

      if (currentDest && currentDest.sha1 !== op.destHash) {
        driftDetails.push(`UPDATE ${op.filename}: destination changed since plan`);
      }
    }

    // Check DELETE operations - dest file should still exist with same hash
    for (const op of plannedDiff.delete) {
      const currentDest = currentDestMap.get(op.filename);
      if (!currentDest) {
        driftDetails.push(`DELETE ${op.filename}: already deleted`);
      } else if (currentDest.sha1 !== op.destHash) {
        driftDetails.push(`DELETE ${op.filename}: destination changed since plan`);
      }
    }

    return {
      hasDrift: driftDetails.length > 0,
      driftDetails
    };
  }

  /**
   * Create a summary string for display
   *
   * @param diff - Diff result
   * @returns Human-readable summary
   */
  static formatSummary(diff: SyncDiffResult): string {
    if (!diff.hasChanges) {
      return 'No changes detected';
    }

    const parts: string[] = [];

    if (diff.add.length > 0) {
      parts.push(`+${diff.add.length} add`);
    }
    if (diff.update.length > 0) {
      parts.push(`~${diff.update.length} update`);
    }
    if (diff.delete.length > 0) {
      parts.push(`-${diff.delete.length} delete`);
    }

    return parts.join(', ') + ` (${diff.totalOperations} total)`;
  }
}
