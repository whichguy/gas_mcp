/**
 * SimpleSyncStrategy - Local commit + push to remote
 *
 * Used when no .git/config.gs breadcrumb exists.
 * This is the default mode for most operations.
 *
 * Workflow:
 * 1. pullFromRemote() - No-op (write operations don't pull first)
 * 2. Operation executes
 * 3. Local commit created
 * 4. pushToRemote() - Files already pushed by operation, ensure local cache updated
 *
 * This matches the current WriteTool behavior.
 */

import { mcpLogger } from '../../../utils/mcpLogger.js';
import { LocalFileManager } from '../../../utils/localFileManager.js';
import type { SyncStrategy } from './SyncStrategy.js';
import type { GASClient } from '../../../api/gasClient.js';

export class SimpleSyncStrategy implements SyncStrategy {
  constructor(private gasClient: GASClient) {}

  /**
   * No-op for simple mode
   * Write operations don't pull before pushing in simple mode
   */
  async pullFromRemote(
    scriptId: string,
    localPath: string,
    projectPath?: string,
    accessToken?: string
  ): Promise<void> {
    mcpLogger.debug('git', `[SIMPLE-SYNC] pullFromRemote: no-op (simple mode doesn't pull)`);
    // No-op: Simple mode doesn't pull before operations
  }

  /**
   * Ensure local cache is updated after operation
   * Files have already been pushed to remote by the operation strategy
   */
  async pushToRemote(
    scriptId: string,
    localPath: string,
    files: string[],
    projectPath?: string,
    accessToken?: string
  ): Promise<void> {
    mcpLogger.debug('git', `[SIMPLE-SYNC] pushToRemote: ensuring local cache updated`);

    // In simple mode, the operation strategy already pushed to remote
    // We just need to ensure local cache is consistent

    try {
      // Get fresh remote files to update local cache
      const remoteFiles = await this.gasClient.getProjectContent(scriptId, accessToken);

      // Update local cache for the affected files
      const projectName = scriptId;
      const workingDir = LocalFileManager.getResolvedWorkingDirectory();

      // Convert GASFile format to expected format for copyRemoteToLocal
      const filteredFiles = remoteFiles
        .filter((f: any) => files.includes(f.name))
        .map((f: any) => ({
          name: f.name,
          content: f.source || '',
          type: f.type
        }));

      await LocalFileManager.copyRemoteToLocal(
        projectName,
        filteredFiles,
        workingDir
      );

      mcpLogger.debug('git', `[SIMPLE-SYNC] Local cache updated for ${files.length} files`);

    } catch (error: any) {
      mcpLogger.warning('git', `[SIMPLE-SYNC] Failed to update local cache: ${error.message}`);
      // Non-fatal: local cache update is optional
    }
  }

  getName(): string {
    return 'simple';
  }
}
