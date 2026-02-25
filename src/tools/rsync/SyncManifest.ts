/**
 * SyncManifest - Manages sync state for rsync operations
 *
 * Tracks file hashes and metadata for detecting changes between GAS and local.
 * Stored at `.git/sync-manifest.json` within the local git repository.
 *
 * Key responsibilities:
 * - Persist/load manifest from filesystem
 * - Track file SHA-1 hashes for change detection
 * - Detect bootstrap state (first sync)
 * - Provide file diff information for sync planning
 */

import { promises as fs } from 'fs';
import path from 'path';
import { mcpLogger } from '../../utils/mcpLogger.js';
import { computeGitSha1 } from '../../utils/hashUtils.js';

/**
 * File entry in the sync manifest
 */
export interface SyncManifestFile {
  sha1: string;           // Git-compatible SHA-1 hash
  lastModified: string;   // ISO-8601 from GAS API
  syncedAt: string;       // ISO-8601 when we synced this file
}

/**
 * Sync manifest structure stored in .git/sync-manifest.json
 */
export interface SyncManifestData {
  version: '2.1';
  scriptId: string;
  lastSyncTimestamp: string;      // ISO-8601
  lastSyncDirection: 'pull' | 'push';
  lastSyncCommitSha?: string;     // Git commit at time of sync

  // File tracking for deletion detection
  files: {
    [filename: string]: SyncManifestFile;
  };

  // Bootstrap protection
  isBootstrap?: boolean;          // True on first sync
  bootstrapTimestamp?: string;    // ISO-8601
}

/**
 * Result of loading a manifest
 */
export interface ManifestLoadResult {
  exists: boolean;
  manifest: SyncManifestData | null;
  isBootstrap: boolean;
  path: string;
}

/**
 * SyncManifest class for managing sync state
 */
export class SyncManifest {
  private manifestPath: string;
  private data: SyncManifestData | null = null;

  constructor(localRepoPath: string) {
    this.manifestPath = path.join(localRepoPath, '.git', 'sync-manifest.json');
  }

  /**
   * Get the manifest file path
   */
  getPath(): string {
    return this.manifestPath;
  }

  /**
   * Check if manifest exists
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.manifestPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load manifest from filesystem
   *
   * @returns ManifestLoadResult with manifest data or null if not found
   */
  async load(): Promise<ManifestLoadResult> {
    try {
      const content = await fs.readFile(this.manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as SyncManifestData;

      // Validate version
      if (manifest.version !== '2.1') {
        mcpLogger.warning('rsync', `[MANIFEST] Version mismatch: expected 2.1, got ${manifest.version}`);
      }

      this.data = manifest;

      mcpLogger.debug('rsync', `[MANIFEST] Loaded manifest for ${manifest.scriptId}, ${Object.keys(manifest.files).length} files tracked`);

      return {
        exists: true,
        manifest,
        isBootstrap: false,
        path: this.manifestPath
      };

    } catch (error: any) {
      if (error.code === 'ENOENT') {
        mcpLogger.debug('rsync', `[MANIFEST] No manifest found at ${this.manifestPath} - bootstrap sync required`);
        return {
          exists: false,
          manifest: null,
          isBootstrap: true,
          path: this.manifestPath
        };
      }

      mcpLogger.error('rsync', `[MANIFEST] Failed to load manifest: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save manifest to filesystem
   *
   * @param manifest - Manifest data to save
   */
  async save(manifest: SyncManifestData): Promise<void> {
    try {
      // Ensure .git directory exists
      const gitDir = path.dirname(this.manifestPath);
      await fs.mkdir(gitDir, { recursive: true });

      // Write manifest with pretty formatting
      await fs.writeFile(
        this.manifestPath,
        JSON.stringify(manifest, null, 2),
        { mode: 0o600 }  // Owner-only read/write
      );

      this.data = manifest;

      mcpLogger.info('rsync', `[MANIFEST] Saved manifest for ${manifest.scriptId}, ${Object.keys(manifest.files).length} files tracked`);

    } catch (error: any) {
      mcpLogger.error('rsync', `[MANIFEST] Failed to save manifest: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get currently loaded manifest data
   */
  getData(): SyncManifestData | null {
    return this.data;
  }

  /**
   * Create a new manifest for bootstrap sync
   *
   * @param scriptId - GAS project ID
   * @param direction - Sync direction
   * @returns New manifest with bootstrap flag
   */
  static createBootstrap(scriptId: string, direction: 'pull' | 'push'): SyncManifestData {
    return {
      version: '2.1',
      scriptId,
      lastSyncTimestamp: new Date().toISOString(),
      lastSyncDirection: direction,
      files: {},
      isBootstrap: true,
      bootstrapTimestamp: new Date().toISOString()
    };
  }

  /**
   * Create manifest from current file state
   *
   * @param scriptId - GAS project ID
   * @param direction - Sync direction
   * @param files - Array of file info to track
   * @param commitSha - Optional git commit SHA
   * @returns New manifest populated with files
   */
  static createFromFiles(
    scriptId: string,
    direction: 'pull' | 'push',
    files: Array<{ filename: string; content: string; lastModified: string }>,
    commitSha?: string
  ): SyncManifestData {
    const manifest: SyncManifestData = {
      version: '2.1',
      scriptId,
      lastSyncTimestamp: new Date().toISOString(),
      lastSyncDirection: direction,
      lastSyncCommitSha: commitSha,
      files: {},
      isBootstrap: false
    };

    const now = new Date().toISOString();

    for (const file of files) {
      manifest.files[file.filename] = {
        sha1: computeGitSha1(file.content),
        lastModified: file.lastModified,
        syncedAt: now
      };
    }

    return manifest;
  }

  /**
   * Update manifest with new file state
   *
   * @param direction - Sync direction
   * @param files - Array of file info to track
   * @param commitSha - Optional git commit SHA
   */
  updateFiles(
    direction: 'pull' | 'push',
    files: Array<{ filename: string; content: string; lastModified: string }>,
    commitSha?: string
  ): void {
    if (!this.data) {
      throw new Error('Manifest not loaded - call load() first');
    }

    const now = new Date().toISOString();

    this.data.lastSyncTimestamp = now;
    this.data.lastSyncDirection = direction;
    this.data.lastSyncCommitSha = commitSha;
    this.data.isBootstrap = false;

    // Clear existing files and rebuild
    this.data.files = {};

    for (const file of files) {
      this.data.files[file.filename] = {
        sha1: computeGitSha1(file.content),
        lastModified: file.lastModified,
        syncedAt: now
      };
    }
  }

  /**
   * Get tracked file entry
   *
   * @param filename - File name to look up
   * @returns File entry or undefined if not tracked
   */
  getFile(filename: string): SyncManifestFile | undefined {
    return this.data?.files[filename];
  }

  /**
   * Get all tracked filenames
   */
  getTrackedFiles(): string[] {
    return Object.keys(this.data?.files || {});
  }

  /**
   * Check if a file has changed based on SHA-1
   *
   * @param filename - File name
   * @param content - Current file content
   * @returns true if file changed, false if unchanged, undefined if not tracked
   */
  hasFileChanged(filename: string, content: string): boolean | undefined {
    const tracked = this.getFile(filename);
    if (!tracked) {
      return undefined;  // Not tracked
    }

    const currentSha1 = computeGitSha1(content);
    return currentSha1 !== tracked.sha1;
  }

  /**
   * Delete manifest file
   */
  async delete(): Promise<void> {
    try {
      await fs.unlink(this.manifestPath);
      this.data = null;
      mcpLogger.info('rsync', `[MANIFEST] Deleted manifest at ${this.manifestPath}`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
