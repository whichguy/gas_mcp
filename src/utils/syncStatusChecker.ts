/**
 * @fileoverview Sync Status Checker - detects local/remote file drift
 *
 * USED BY: LsTool (checkSync:true) | ExecTool (pre-flight check) | SyncDriftError
 * STATUSES: in_sync | local_stale | remote_only | local_only
 * OPTIONS: excludeSystemFiles (skip common-js/*) | includeContent (for diffs) | maxContentFiles (limit 5)
 *
 * Compares xattr-cached hashes (local) against Git SHA-1 hashes (remote).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getCachedContentHash, updateCachedContentHash } from './gasMetadataCache.js';
import { computeGitSha1 } from './hashUtils.js';
// Note: moduleWrapper imports removed - local files are stored WRAPPED, no re-wrapping needed
import { FileFilter } from './fileFilter.js';

/**
 * Sync status for a single file
 */
export type SyncStatus = 'in_sync' | 'local_stale' | 'remote_only' | 'local_only';

/**
 * Information about a file's sync status
 */
export interface FileSyncStatus {
  filename: string;
  syncStatus: SyncStatus;
  localHash?: string;
  remoteHash?: string;
  sizeDiff?: string;
  /** Remote content for diff generation (only populated when drift detected) */
  remoteContent?: string;
  /** Local content for diff generation (only populated when drift detected) */
  localContent?: string;
}

/**
 * Summary of sync status across all files
 */
export interface SyncSummary {
  total: number;
  inSync: number;
  stale: number;
  localOnly: number;
  remoteOnly: number;
}

/**
 * Drift details for SyncDriftError
 */
export interface DriftDetails {
  staleLocal: FileSyncStatus[];
  missingLocal: FileSyncStatus[];
}

/**
 * Options for sync status checking
 */
export interface SyncCheckOptions {
  /** Exclude system files like common-js/*, __mcp_exec* */
  excludeSystemFiles?: boolean;
  /** Patterns to exclude (glob-style) */
  excludePatterns?: string[];
  /** Include content for diff generation (increases memory usage) */
  includeContent?: boolean;
  /** Max files to include content for (default: 5) */
  maxContentFiles?: number;
}

// Note: File filtering is now handled by the centralized FileFilter utility
// See fileFilter.ts for SYSTEM_FILE_PREFIXES, DEFAULT_EXCLUDE_PATTERNS, etc.

/**
 * Get the local filename with appropriate extension
 */
function getLocalFileName(gasFileName: string, fileType: string): string {
  // If the name already has an extension, use it
  if (gasFileName.includes('.')) {
    return gasFileName;
  }

  // Add extension based on file type
  // MUST match SyncExecutor.gasFilenameToLocalPath() for consistency
  switch (fileType?.toUpperCase()) {
    case 'HTML':
      return `${gasFileName}.html`;
    case 'JSON':
      return `${gasFileName}.json`;
    case 'SERVER_JS':
    default:
      return `${gasFileName}.gs`;  // Use .gs for GAS files (matches GAS native extension)
  }
}

/**
 * Check sync status for a list of remote files against local cache
 *
 * @param scriptId - GAS project script ID
 * @param remoteFiles - Array of file objects from GAS API
 * @param options - Options for filtering
 * @returns Detailed sync status for each file and summary
 */
export async function checkSyncStatus(
  scriptId: string,
  remoteFiles: Array<{
    name: string;
    source?: string;
    type?: string;
  }>,
  options: SyncCheckOptions = {}
): Promise<{
  files: FileSyncStatus[];
  summary: SyncSummary;
  drift: DriftDetails;
}> {
  // Create file filter with syncStatus preset + user options
  const filter = FileFilter.forSyncStatus({
    excludeSystemFiles: options.excludeSystemFiles !== false,  // Default true
    excludePatterns: options.excludePatterns,
  });
  const includeContent = options.includeContent === true;
  const maxContentFiles = options.maxContentFiles ?? 5;

  // Get local sync folder path
  const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
  const syncFolder = path.join(homeDir, 'gas-repos', `project-${scriptId}`);

  // Track content inclusion count
  let contentFilesIncluded = 0;

  const files: FileSyncStatus[] = [];
  const summary: SyncSummary = {
    total: 0,
    inSync: 0,
    stale: 0,
    localOnly: 0,
    remoteOnly: 0
  };
  const drift: DriftDetails = {
    staleLocal: [],
    missingLocal: []
  };

  for (const remoteFile of remoteFiles) {
    const filename = remoteFile.name;

    // Use centralized filter (handles system files, git breadcrumbs, exclude patterns)
    if (filter.shouldSkip(filename)) {
      continue;
    }

    // Compute remote hash on WRAPPED content (full file as stored in GAS)
    // This matches `git hash-object <file>` on local synced files
    const remoteHash = computeGitSha1(remoteFile.source || '');

    // Get local file path
    const localFileName = getLocalFileName(filename, remoteFile.type || 'SERVER_JS');
    const localFilePath = path.join(syncFolder, localFileName);

    let localHash: string | null = null;
    let localFileExists = false;

    try {
      await fs.access(localFilePath);
      localFileExists = true;
      // Try to get cached hash from xattr
      localHash = await getCachedContentHash(localFilePath);
    } catch {
      // Local file doesn't exist
    }

    let syncStatus: SyncStatus;
    let sizeDiff: string | undefined;

    if (!localFileExists) {
      syncStatus = 'remote_only';
      summary.remoteOnly++;
      const fileStatus: FileSyncStatus = {
        filename,
        syncStatus,
        remoteHash
      };
      // Include remote content for new files (helps LLM understand what's missing)
      if (includeContent && contentFilesIncluded < maxContentFiles) {
        fileStatus.remoteContent = remoteFile.source || '';
        contentFilesIncluded++;
      }
      drift.missingLocal.push(fileStatus);
    } else if (!localHash) {
      // Local file exists but no cached hash
      // Compare actual content to determine sync status (auto-populate hash if matching)
      //
      // Local files are stored WRAPPED (full CommonJS content), same as remote.
      // Hash the local content directly - no re-wrapping needed.
      try {
        const localContent = await fs.readFile(localFilePath, 'utf-8');

        // Local file is already wrapped - hash directly
        const computedLocalHash = computeGitSha1(localContent);

        if (computedLocalHash === remoteHash) {
          // Content matches! Auto-populate the hash cache and mark as in_sync
          syncStatus = 'in_sync';
          summary.inSync++;
          localHash = computedLocalHash;

          // Write hash to xattr for future checks (best-effort, non-blocking)
          // Store the WRAPPED hash since that's what we compare against
          updateCachedContentHash(localFilePath, computedLocalHash).catch(() => {
            // Ignore xattr write failures - non-critical
          });
        } else {
          // Content differs - genuinely stale
          syncStatus = 'local_stale';
          summary.stale++;
          localHash = computedLocalHash;
          const fileStatus: FileSyncStatus = {
            filename,
            syncStatus,
            localHash,
            remoteHash
          };
          if (includeContent && contentFilesIncluded < maxContentFiles) {
            fileStatus.remoteContent = remoteFile.source || '';
            fileStatus.localContent = localContent;
            contentFilesIncluded++;
          }
          drift.staleLocal.push(fileStatus);
        }
      } catch {
        // Failed to read local file - treat as stale for safety
        syncStatus = 'local_stale';
        summary.stale++;
        drift.staleLocal.push({
          filename,
          syncStatus,
          remoteHash
        });
      }
    } else if (localHash === remoteHash) {
      syncStatus = 'in_sync';
      summary.inSync++;
    } else {
      syncStatus = 'local_stale';
      summary.stale++;
      const fileStatus: FileSyncStatus = {
        filename,
        syncStatus,
        localHash,
        remoteHash
      };
      // Include content for diff (both local and remote)
      if (includeContent && contentFilesIncluded < maxContentFiles) {
        fileStatus.remoteContent = remoteFile.source || '';
        try {
          fileStatus.localContent = await fs.readFile(localFilePath, 'utf-8');
        } catch {
          // Failed to read local, include remote only
        }
        contentFilesIncluded++;
      }
      drift.staleLocal.push(fileStatus);
    }

    files.push({
      filename,
      syncStatus,
      localHash: localHash || undefined,
      remoteHash,
      sizeDiff
    });

    summary.total++;
  }

  return { files, summary, drift };
}

/**
 * Quick check if any drift exists (without full details)
 *
 * @param scriptId - GAS project script ID
 * @param remoteFiles - Array of file objects from GAS API
 * @param options - Options for filtering
 * @returns true if drift detected, false if all in sync
 */
export async function hasDrift(
  scriptId: string,
  remoteFiles: Array<{
    name: string;
    source?: string;
    type?: string;
  }>,
  options: SyncCheckOptions = {}
): Promise<boolean> {
  const { summary } = await checkSyncStatus(scriptId, remoteFiles, options);
  return summary.stale > 0 || summary.remoteOnly > 0;
}
