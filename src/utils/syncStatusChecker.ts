/**
 * @fileoverview Sync Status Checker - detects local/remote file drift
 *
 * USED BY: LsTool (checkSync:true) | ExecTool (pre-flight check) | SyncDriftError
 * STATUSES: in_sync | local_stale | remote_only | local_only
 * OPTIONS: excludeSystemFiles (skip common-js/*) | includeContent (for diffs) | maxContentFiles (limit 5)
 *
 * Compares local git file content hashes against Git SHA-1 hashes (remote).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { computeGitSha1 } from './hashUtils.js';
// Note: moduleWrapper imports removed - local files are stored WRAPPED, no re-wrapping needed
import { FileFilter } from './fileFilter.js';
import { LocalFileManager } from './localFileManager.js';

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

  // Get local sync folder path — use session worktree if active (same as WriteTool),
  // fall back to ~/gas-repos/ (same as CatTool)
  let syncFolder: string;
  try {
    const { SessionWorktreeManager } = await import('./sessionWorktree.js');
    const worktreeManager = new SessionWorktreeManager();
    const worktreePath = worktreeManager.getWorktreePath(scriptId);  // in-memory Map, no I/O
    syncFolder = worktreePath || LocalFileManager.resolveProjectPath(scriptId);
  } catch {
    // sessionWorktree not available — fall back
    syncFolder = LocalFileManager.resolveProjectPath(scriptId);
  }

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
    let resolvedLocalFilePath = localFilePath;  // tracks actual path after extension fallback

    let localHash: string | null = null;
    let localFileExists = false;

    try {
      await fs.access(localFilePath);
      localFileExists = true;
      // Compute hash from local git file content (authoritative local state)
      const localContent = await fs.readFile(localFilePath, 'utf-8');
      localHash = computeGitSha1(localContent);
    } catch {
      // Local file doesn't exist — for SERVER_JS, try the alternate extension (.gs ↔ .js)
    }

    // Extension fallback: SERVER_JS files may be stored locally as either .gs or .js.
    // If the primary probe failed, retry with the alternate extension before classifying
    // as remote_only (which is non-blocking and would silently ignore the stale local file).
    if (!localFileExists && (remoteFile.type?.toUpperCase() === 'SERVER_JS' || !remoteFile.type)) {
      const currentExt = path.extname(localFileName);
      const altExt = currentExt === '.gs' ? '.js' : currentExt === '.js' ? '.gs' : null;
      if (altExt) {
        const altFileName = path.basename(localFileName, currentExt) + altExt;
        const altFilePath = path.join(syncFolder, altFileName);
        try {
          await fs.access(altFilePath);
          localFileExists = true;
          const localContent = await fs.readFile(altFilePath, 'utf-8');
          localHash = computeGitSha1(localContent);
          resolvedLocalFilePath = altFilePath;
        } catch {
          // Alternate extension also doesn't exist — genuinely remote_only
        }
      }
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
    } else if (localHash === remoteHash) {
      syncStatus = 'in_sync';
      summary.inSync++;
    } else if (!localHash) {
      // Local file exists but hash couldn't be computed (rare - file read error)
      // Treat as stale for safety
      syncStatus = 'local_stale';
      summary.stale++;
      drift.staleLocal.push({
        filename,
        syncStatus,
        remoteHash
      });
    } else {
      // Local hash differs from remote - genuinely stale
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
          fileStatus.localContent = await fs.readFile(resolvedLocalFilePath, 'utf-8');
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
