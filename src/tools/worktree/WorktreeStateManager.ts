/**
 * WorktreeStateManager - State machine for worktree lifecycle
 *
 * Manages worktree state transitions with validation, persistence,
 * orphan detection, and stuck state recovery.
 *
 * State Machine:
 * CREATING → READY → CLAIMED → MERGING → MERGED
 *    ↓         ↓        ↓         ↓
 *  FAILED   REMOVING  REMOVING   CLAIMED (rollback on failure)
 *              ↓         ↓
 *           REMOVED   REMOVED
 *
 * Orphan states (detected externally):
 * - ORPHAN_GAS_DELETED: GAS project was deleted in Google Drive
 * - ORPHAN_LOCAL_DELETED: Local git worktree folder was deleted
 */

import { WorktreeLockManager } from './WorktreeLockManager.js';
import {
  WorktreeState,
  WorktreeEntry,
  WorktreesConfig,
  isValidTransition,
  isOrphanState,
  isTerminalState,
  hoursSince,
  daysSince
} from '../../types/worktreeTypes.js';

// Threshold for stale CLAIMED state (24 hours)
const STALE_CLAIM_HOURS = 24;

// Threshold for stuck MERGING state (30 minutes)
const STUCK_MERGING_MINUTES = 30;

// Threshold for stale baseHashes warning (7 days)
const STALE_BASEHASHES_DAYS = 7;

/**
 * State transition error
 */
export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly scriptId: string,
    public readonly fromState: WorktreeState,
    public readonly toState: WorktreeState
  ) {
    super(`Invalid state transition for ${scriptId}: ${fromState} → ${toState}`);
    this.name = 'InvalidStateTransitionError';
  }
}

/**
 * Worktree not found error
 */
export class WorktreeNotFoundError extends Error {
  constructor(public readonly scriptId: string) {
    super(`Worktree not found: ${scriptId}`);
    this.name = 'WorktreeNotFoundError';
  }
}

/**
 * WorktreeStateManager class
 *
 * Manages state transitions and lifecycle for worktrees
 */
export class WorktreeStateManager {
  private static instance: WorktreeStateManager;
  private lockManager: WorktreeLockManager;

  private constructor() {
    this.lockManager = WorktreeLockManager.getInstance();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): WorktreeStateManager {
    if (!WorktreeStateManager.instance) {
      WorktreeStateManager.instance = new WorktreeStateManager();
    }
    return WorktreeStateManager.instance;
  }

  /**
   * Transition worktree to a new state
   *
   * Validates the transition is allowed, then updates the entry.
   *
   * @param scriptId - Worktree script ID
   * @param newState - Target state
   * @param additionalUpdates - Optional additional fields to update
   */
  async transitionState(
    scriptId: string,
    newState: WorktreeState,
    additionalUpdates?: Partial<WorktreeEntry>
  ): Promise<WorktreeEntry> {
    return this.lockManager.withLock(`transitionState:${newState}`, async () => {
      const config = await this.lockManager.readWorktreesConfig();
      const entry = config.worktrees[scriptId];

      if (!entry) {
        throw new WorktreeNotFoundError(scriptId);
      }

      // Validate transition
      if (!isValidTransition(entry.state, newState)) {
        throw new InvalidStateTransitionError(scriptId, entry.state, newState);
      }

      // Apply state-specific updates
      const updates: Partial<WorktreeEntry> = {
        state: newState,
        ...additionalUpdates
      };

      // Track state-specific timestamps
      switch (newState) {
        case 'CLAIMED':
          if (!entry.claimedAt) {
            updates.claimedAt = new Date().toISOString();
          }
          break;

        case 'MERGING':
          updates.mergingStartedAt = new Date().toISOString();
          break;

        case 'MERGED':
        case 'READY':
          // Clear MERGING state tracking when transitioning out
          if (entry.state === 'MERGING' || entry.state === 'CLAIMED') {
            updates.mergingStartedAt = undefined;
          }
          if (newState === 'READY') {
            updates.claimedBy = undefined;
            updates.claimedAt = undefined;
          }
          break;

        case 'REMOVED':
          updates.removedAt = new Date().toISOString();
          break;
      }

      // Update entry
      config.worktrees[scriptId] = {
        ...entry,
        ...updates
      };

      await this.lockManager.writeWorktreesConfig(config);

      console.error(`📊 [STATE] ${scriptId}: ${entry.state} → ${newState}`);

      return config.worktrees[scriptId];
    });
  }

  /**
   * Claim a worktree
   *
   * Transitions READY → CLAIMED and sets claimedBy/claimedAt.
   */
  async claim(scriptId: string, agentId: string): Promise<WorktreeEntry> {
    return this.transitionState(scriptId, 'CLAIMED', {
      claimedBy: agentId,
      claimedAt: new Date().toISOString()
    });
  }

  /**
   * Release a worktree
   *
   * Transitions CLAIMED → READY and clears claimedBy/claimedAt.
   */
  async release(scriptId: string): Promise<WorktreeEntry> {
    return this.transitionState(scriptId, 'READY', {
      claimedBy: undefined,
      claimedAt: undefined
    });
  }

  /**
   * Start merging a worktree
   *
   * Transitions CLAIMED → MERGING.
   */
  async startMerge(scriptId: string): Promise<WorktreeEntry> {
    return this.transitionState(scriptId, 'MERGING');
  }

  /**
   * Complete merge successfully
   *
   * Transitions MERGING → MERGED.
   */
  async completeMerge(scriptId: string, commitSha: string): Promise<WorktreeEntry> {
    return this.transitionState(scriptId, 'MERGED', {
      mergingStartedAt: undefined
    });
  }

  /**
   * Rollback merge (on failure)
   *
   * Transitions MERGING → CLAIMED.
   */
  async rollbackMerge(scriptId: string, error?: string): Promise<WorktreeEntry> {
    return this.transitionState(scriptId, 'CLAIMED', {
      mergingStartedAt: undefined,
      error
    });
  }

  /**
   * Mark worktree as failed
   *
   * Transitions CREATING → FAILED.
   */
  async markFailed(scriptId: string, error: string, errorCode?: string): Promise<WorktreeEntry> {
    return this.transitionState(scriptId, 'FAILED', {
      error,
      errorCode
    });
  }

  /**
   * Mark worktree as orphaned (GAS deleted)
   */
  async markOrphanGasDeleted(scriptId: string): Promise<WorktreeEntry> {
    return this.lockManager.withLock('markOrphanGasDeleted', async () => {
      const config = await this.lockManager.readWorktreesConfig();
      const entry = config.worktrees[scriptId];

      if (!entry) {
        throw new WorktreeNotFoundError(scriptId);
      }

      // Orphan states can be reached from any non-terminal state
      if (isTerminalState(entry.state)) {
        console.error(`⚠️  [STATE] ${scriptId} is already in terminal state ${entry.state}`);
        return entry;
      }

      config.worktrees[scriptId] = {
        ...entry,
        state: 'ORPHAN_GAS_DELETED',
        error: 'GAS project was deleted externally'
      };

      await this.lockManager.writeWorktreesConfig(config);

      console.error(`📊 [STATE] ${scriptId}: ${entry.state} → ORPHAN_GAS_DELETED`);

      return config.worktrees[scriptId];
    });
  }

  /**
   * Mark worktree as orphaned (local deleted)
   */
  async markOrphanLocalDeleted(scriptId: string): Promise<WorktreeEntry> {
    return this.lockManager.withLock('markOrphanLocalDeleted', async () => {
      const config = await this.lockManager.readWorktreesConfig();
      const entry = config.worktrees[scriptId];

      if (!entry) {
        throw new WorktreeNotFoundError(scriptId);
      }

      if (isTerminalState(entry.state)) {
        console.error(`⚠️  [STATE] ${scriptId} is already in terminal state ${entry.state}`);
        return entry;
      }

      config.worktrees[scriptId] = {
        ...entry,
        state: 'ORPHAN_LOCAL_DELETED',
        error: 'Local git worktree folder was deleted'
      };

      await this.lockManager.writeWorktreesConfig(config);

      console.error(`📊 [STATE] ${scriptId}: ${entry.state} → ORPHAN_LOCAL_DELETED`);

      return config.worktrees[scriptId];
    });
  }

  /**
   * Check for and recover stuck MERGING state
   *
   * If a worktree has been in MERGING state for more than 30 minutes,
   * it's likely a crashed operation. Recover by rolling back to CLAIMED.
   *
   * @param parentScriptId - Parent script ID to check
   * @returns Recovered worktree entry or null
   */
  async recoverStuckMerge(parentScriptId: string): Promise<WorktreeEntry | null> {
    const config = await this.lockManager.readWorktreesConfig();

    for (const entry of Object.values(config.worktrees)) {
      if (entry.parentScriptId !== parentScriptId) continue;
      if (entry.state !== 'MERGING') continue;

      const mergingStartedAt = entry.mergingStartedAt;
      if (!mergingStartedAt) continue;

      const minutesSinceStart = (Date.now() - new Date(mergingStartedAt).getTime()) / (1000 * 60);

      if (minutesSinceStart > STUCK_MERGING_MINUTES) {
        console.error(`🔄 [STATE] Recovering stuck merge for ${entry.scriptId} (started ${Math.round(minutesSinceStart)} min ago)`);

        return this.rollbackMerge(
          entry.scriptId,
          `Recovered from stuck MERGING state after ${Math.round(minutesSinceStart)} minutes`
        );
      }
    }

    return null;
  }

  /**
   * Find stale claimed worktrees (orphan candidates)
   *
   * @param parentScriptId - Optional filter by parent
   * @param maxAgeHours - Hours threshold (default: 24)
   */
  async findStaleClaims(
    parentScriptId?: string,
    maxAgeHours: number = STALE_CLAIM_HOURS
  ): Promise<WorktreeEntry[]> {
    const config = await this.lockManager.readWorktreesConfig();
    const staleClaims: WorktreeEntry[] = [];

    for (const entry of Object.values(config.worktrees)) {
      if (parentScriptId && entry.parentScriptId !== parentScriptId) continue;
      if (entry.state !== 'CLAIMED') continue;
      if (!entry.claimedAt) continue;

      const ageHours = hoursSince(entry.claimedAt);
      if (ageHours > maxAgeHours) {
        staleClaims.push(entry);
      }
    }

    return staleClaims;
  }

  /**
   * Find worktrees with stale baseHashes
   *
   * @param parentScriptId - Parent script ID
   * @param maxAgeDays - Days threshold (default: 7)
   */
  async findStaleBaseHashes(
    parentScriptId: string,
    maxAgeDays: number = STALE_BASEHASHES_DAYS
  ): Promise<WorktreeEntry[]> {
    const config = await this.lockManager.readWorktreesConfig();
    const stale: WorktreeEntry[] = [];

    for (const entry of Object.values(config.worktrees)) {
      if (entry.parentScriptId !== parentScriptId) continue;
      if (isTerminalState(entry.state)) continue;

      const hashDate = entry.baseHashesUpdatedAt || entry.createdAt;
      if (hashDate && daysSince(hashDate) > maxAgeDays) {
        stale.push(entry);
      }
    }

    return stale;
  }

  /**
   * Check if any worktree for a parent has pending remote push
   */
  async hasPendingRemotePush(parentScriptId: string): Promise<boolean> {
    const config = await this.lockManager.readWorktreesConfig();

    for (const entry of Object.values(config.worktrees)) {
      if (entry.parentScriptId !== parentScriptId) continue;
      if (entry.pendingRemotePush) return true;
    }

    return false;
  }

  /**
   * Set pending remote push flag
   */
  async setPendingRemotePush(scriptId: string, pending: boolean): Promise<void> {
    await this.lockManager.updateWorktreeEntry(scriptId, {
      pendingRemotePush: pending
    });
  }

  /**
   * Get worktree entry
   */
  async getEntry(scriptId: string): Promise<WorktreeEntry | null> {
    return this.lockManager.getWorktreeEntry(scriptId);
  }

  /**
   * Find available (READY) worktree for parent
   */
  async findAvailable(parentScriptId: string): Promise<WorktreeEntry | null> {
    const entries = await this.lockManager.findByParent(parentScriptId);
    return entries.find(e => e.state === 'READY') || null;
  }

  /**
   * Find worktree currently in MERGING state for parent
   */
  async findMerging(parentScriptId: string): Promise<WorktreeEntry | null> {
    const entries = await this.lockManager.findByParent(parentScriptId);
    return entries.find(e => e.state === 'MERGING') || null;
  }

  /**
   * Get all worktrees for a parent
   */
  async getAllForParent(parentScriptId: string): Promise<WorktreeEntry[]> {
    return this.lockManager.findByParent(parentScriptId);
  }

  /**
   * Get all worktrees with specific states
   */
  async getAllByState(states: WorktreeState[]): Promise<WorktreeEntry[]> {
    return this.lockManager.findByState(states);
  }

  /**
   * Mark all worktrees for a parent as orphaned (parent deleted)
   */
  async markParentDeleted(parentScriptId: string): Promise<number> {
    const entries = await this.lockManager.findByParent(parentScriptId);
    let count = 0;

    for (const entry of entries) {
      if (!isTerminalState(entry.state)) {
        await this.markOrphanGasDeleted(entry.scriptId);
        count++;
      }
    }

    console.error(`📊 [STATE] Marked ${count} worktrees orphaned (parent ${parentScriptId} deleted)`);
    return count;
  }

  /**
   * Update baseHashes for a worktree
   */
  async updateBaseHashes(
    scriptId: string,
    baseHashes: Record<string, string>
  ): Promise<void> {
    await this.lockManager.updateWorktreeEntry(scriptId, {
      baseHashes,
      baseHashesUpdatedAt: new Date().toISOString()
    });
  }

  /**
   * Update lastSyncedAt timestamp
   */
  async updateLastSynced(scriptId: string): Promise<void> {
    await this.lockManager.updateWorktreeEntry(scriptId, {
      lastSyncedAt: new Date().toISOString()
    });
  }
}
