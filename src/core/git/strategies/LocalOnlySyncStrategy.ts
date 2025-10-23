/**
 * LocalOnlySyncStrategy - No remote sync
 *
 * Used for local-only operations (testing, offline development).
 * Creates local commits but doesn't push to GAS.
 *
 * Workflow:
 * 1. pullFromRemote() - No-op
 * 2. Operation executes
 * 3. Local commit created
 * 4. pushToRemote() - No-op
 */

import { log } from '../../../utils/logger.js';
import type { SyncStrategy } from './SyncStrategy.js';
import type { GASClient } from '../../../api/gasClient.js';

export class LocalOnlySyncStrategy implements SyncStrategy {
  constructor(private gasClient: GASClient) {}

  /**
   * No-op for local-only mode
   */
  async pullFromRemote(
    scriptId: string,
    localPath: string,
    projectPath?: string,
    accessToken?: string
  ): Promise<void> {
    log.debug(`[LOCAL-ONLY-SYNC] pullFromRemote: no-op (local-only mode)`);
    // No-op: Local-only mode doesn't interact with remote
  }

  /**
   * No-op for local-only mode
   */
  async pushToRemote(
    scriptId: string,
    localPath: string,
    files: string[],
    projectPath?: string,
    accessToken?: string
  ): Promise<void> {
    log.debug(`[LOCAL-ONLY-SYNC] pushToRemote: no-op (local-only mode)`);
    // No-op: Local-only mode doesn't push to remote
  }

  getName(): string {
    return 'local-only';
  }
}
