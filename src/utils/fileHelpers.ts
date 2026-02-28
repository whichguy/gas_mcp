import { stat } from 'fs/promises';
import { GASFile } from '../api/gasClient.js';
import { fileNameMatches } from '../api/pathParser.js';

// ============================================================================
// Utility functions
// ============================================================================

/**
 * Format time difference in human-readable format
 */
export function formatTimeDifference(diffMs: number): string {
  const absDiff = Math.abs(diffMs);

  if (absDiff < 1000) {
    return `${diffMs}ms`;
  }

  const seconds = diffMs / 1000;
  if (Math.abs(seconds) < 60) {
    return `${seconds.toFixed(2)}s`;
  }

  const minutes = seconds / 60;
  if (Math.abs(minutes) < 60) {
    return `${minutes.toFixed(2)}m`;
  }

  const hours = minutes / 60;
  if (Math.abs(hours) < 24) {
    return `${hours.toFixed(2)}h`;
  }

  const days = hours / 24;
  return `${days.toFixed(2)}d`;
}

/**
 * Get local file modification time
 */
export async function getFileMtime(localPath: string): Promise<Date | null> {
  try {
    const stats = await stat(localPath);
    return stats.mtime;
  } catch (error) {
    return null;
  }
}

/**
 * Find remote file metadata by name (extension-agnostic)
 */
export function findRemoteFile(files: GASFile[], filename: string): GASFile | undefined {
  return files.find(f => fileNameMatches(f.name, filename));
}

/**
 * Check if a filename is the appsscript.json manifest file
 * Handles various naming conventions: appsscript, appsscript.json, APPSSCRIPT
 */
export function isManifestFile(filename: string): boolean {
  const normalized = filename.toLowerCase();
  return normalized === 'appsscript' || normalized === 'appsscript.json';
}

/**
 * Find the appsscript.json manifest file in a list of GAS files
 * Handles extension-agnostic matching
 */
export function findManifestFile(files: GASFile[]): GASFile | undefined {
  return files.find(f => isManifestFile(f.name));
}
