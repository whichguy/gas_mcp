/**
 * SyncStrategyFactory - Creates sync strategy instances
 *
 * Factory pattern for creating appropriate sync strategies based on mode.
 */

import { SimpleSyncStrategy } from './strategies/SimpleSyncStrategy.js';
import { LocalOnlySyncStrategy } from './strategies/LocalOnlySyncStrategy.js';
import type { SyncStrategy } from './strategies/SyncStrategy.js';
import type { GASClient } from '../../api/gasClient.js';

/**
 * Factory for creating sync strategies
 *
 * Note: BidirectionalSyncStrategy was removed due to complexity and risk.
 * Users should call local_sync explicitly for bidirectional workflows.
 */
export class SyncStrategyFactory {
  /**
   * Create sync strategy based on mode
   *
   * @param mode - Sync mode (simple or local-only)
   * @param gasClient - GAS client for API calls
   * @returns Sync strategy instance
   */
  async create(
    mode: 'simple' | 'local-only',
    gasClient: GASClient
  ): Promise<SyncStrategy> {
    switch (mode) {
      case 'simple':
        return new SimpleSyncStrategy(gasClient);

      case 'local-only':
        return new LocalOnlySyncStrategy(gasClient);

      default:
        throw new Error(`Unknown sync mode: ${mode}`);
    }
  }
}
