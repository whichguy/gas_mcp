/**
 * PlanStore - Server-side storage for sync plans with TTL
 *
 * Stores sync plans in memory with automatic expiration.
 * Plans are validated server-side to prevent tampering with timestamps.
 *
 * Key responsibilities:
 * - Store plans with unique IDs
 * - Validate plan existence and expiration
 * - Generate secure deletion tokens (HMAC-SHA256)
 * - Auto-cleanup expired plans
 */

import crypto from 'crypto';
import { log } from '../../utils/logger.js';
import { SyncDiffResult } from './SyncDiff.js';

/**
 * Stored sync plan structure
 */
export interface SyncPlan {
  planId: string;                 // UUID
  createdAt: string;              // Server-side ISO-8601 timestamp
  expiresAt: string;              // createdAt + TTL

  direction: 'pull' | 'push';
  scriptId: string;

  // What will happen
  operations: SyncDiffResult;

  // Deletion safety
  deletionToken?: string;         // HMAC-SHA256 if deletions present

  // Bootstrap handling
  isBootstrap: boolean;
  bootstrapBehavior?: 'create_from_source' | 'error';

  // Additional metadata
  localPath: string;              // Local git repo path
  sourceFileCount: number;        // Number of files at source
  destFileCount: number;          // Number of files at destination
}

/**
 * Plan validation result
 */
export interface PlanValidation {
  valid: boolean;
  reason?: string;
  plan?: SyncPlan;
}

/**
 * Configuration for PlanStore
 */
export interface PlanStoreConfig {
  ttlMs: number;              // Plan TTL in milliseconds (default: 5 minutes)
  cleanupIntervalMs: number;  // Cleanup interval (default: 1 minute)
  sessionSecret?: string;     // Secret for HMAC tokens (generated if not provided)
}

const DEFAULT_CONFIG: PlanStoreConfig = {
  ttlMs: 5 * 60 * 1000,           // 5 minutes
  cleanupIntervalMs: 60 * 1000,   // 1 minute
};

/**
 * PlanStore singleton for managing sync plans
 */
export class PlanStore {
  private static instance: PlanStore;

  private plans: Map<string, SyncPlan> = new Map();
  private config: PlanStoreConfig;
  private sessionSecret: string;
  private cleanupTimer: NodeJS.Timeout | null = null;

  private constructor(config: Partial<PlanStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Generate session secret if not provided
    this.sessionSecret = config.sessionSecret || crypto.randomBytes(32).toString('hex');

    // Start cleanup timer
    this.startCleanupTimer();

    log.debug('[PLAN-STORE] Initialized with TTL:', this.config.ttlMs, 'ms');
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<PlanStoreConfig>): PlanStore {
    if (!PlanStore.instance) {
      PlanStore.instance = new PlanStore(config);
    }
    return PlanStore.instance;
  }

  /**
   * Reset the singleton (for testing)
   */
  static resetInstance(): void {
    if (PlanStore.instance) {
      PlanStore.instance.shutdown();
      // TypeScript safety - explicit null assignment
      (PlanStore as any).instance = null;
    }
  }

  /**
   * Create and store a new sync plan
   *
   * @param options - Plan creation options
   * @returns Created SyncPlan with planId and timestamps
   */
  create(options: {
    direction: 'pull' | 'push';
    scriptId: string;
    operations: SyncDiffResult;
    isBootstrap: boolean;
    localPath: string;
    sourceFileCount: number;
    destFileCount: number;
  }): SyncPlan {
    const now = new Date();
    const planId = crypto.randomUUID();

    const plan: SyncPlan = {
      planId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.config.ttlMs).toISOString(),
      direction: options.direction,
      scriptId: options.scriptId,
      operations: options.operations,
      isBootstrap: options.isBootstrap,
      bootstrapBehavior: options.isBootstrap ? 'create_from_source' : undefined,
      localPath: options.localPath,
      sourceFileCount: options.sourceFileCount,
      destFileCount: options.destFileCount,
    };

    // Generate deletion token if deletions present
    if (options.operations.delete.length > 0 && !options.isBootstrap) {
      plan.deletionToken = this.generateDeletionToken(plan);
    }

    this.plans.set(planId, plan);

    log.info(`[PLAN-STORE] Created plan ${planId} for ${options.scriptId} (expires: ${plan.expiresAt})`);

    return plan;
  }

  /**
   * Get a plan by ID with validation
   *
   * @param planId - Plan UUID
   * @returns PlanValidation result
   */
  get(planId: string): PlanValidation {
    const plan = this.plans.get(planId);

    if (!plan) {
      return {
        valid: false,
        reason: 'PLAN_NOT_FOUND'
      };
    }

    // Check expiration (server-side timestamp)
    if (new Date() > new Date(plan.expiresAt)) {
      this.plans.delete(planId);
      return {
        valid: false,
        reason: 'PLAN_EXPIRED'
      };
    }

    return {
      valid: true,
      plan
    };
  }

  /**
   * Delete a plan
   *
   * @param planId - Plan UUID
   * @returns true if deleted, false if not found
   */
  delete(planId: string): boolean {
    const existed = this.plans.has(planId);
    this.plans.delete(planId);

    if (existed) {
      log.debug(`[PLAN-STORE] Deleted plan ${planId}`);
    }

    return existed;
  }

  /**
   * Validate deletion token for a plan
   *
   * @param plan - Sync plan
   * @param providedToken - Token provided by client
   * @returns true if token is valid
   */
  validateDeletionToken(plan: SyncPlan, providedToken?: string): boolean {
    if (!plan.deletionToken) {
      // No deletions, no token needed
      return true;
    }

    if (!providedToken) {
      return false;
    }

    // Timing-safe comparison
    try {
      return crypto.timingSafeEqual(
        Buffer.from(plan.deletionToken, 'hex'),
        Buffer.from(providedToken, 'hex')
      );
    } catch {
      return false;
    }
  }

  /**
   * Generate HMAC-SHA256 deletion token
   *
   * Token binds: files to delete, timestamp, planId, nonce
   */
  private generateDeletionToken(plan: SyncPlan): string {
    const tokenData = {
      files: plan.operations.delete.map(f => f.filename).sort(),
      timestamp: plan.createdAt,
      planId: plan.planId,
      nonce: crypto.randomBytes(16).toString('hex')
    };

    const hmac = crypto.createHmac('sha256', this.sessionSecret);
    hmac.update(JSON.stringify(tokenData));

    return hmac.digest('hex');
  }

  /**
   * Get number of stored plans (for monitoring)
   */
  getCount(): number {
    return this.plans.size;
  }

  /**
   * List all active plan IDs (for debugging)
   */
  listPlanIds(): string[] {
    return Array.from(this.plans.keys());
  }

  /**
   * Clear all plans (for testing)
   */
  clear(): void {
    this.plans.clear();
    log.debug('[PLAN-STORE] All plans cleared');
  }

  /**
   * Start automatic cleanup timer
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);

    // Allow Node.js to exit even if timer is active
    this.cleanupTimer.unref();
  }

  /**
   * Cleanup expired plans
   */
  private cleanup(): void {
    const now = new Date();
    let expiredCount = 0;

    for (const [planId, plan] of this.plans) {
      if (now > new Date(plan.expiresAt)) {
        this.plans.delete(planId);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      log.debug(`[PLAN-STORE] Cleaned up ${expiredCount} expired plan(s)`);
    }
  }

  /**
   * Shutdown the plan store (stop timers, clear plans)
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.plans.clear();
    log.debug('[PLAN-STORE] Shutdown complete');
  }

  /**
   * Get remaining TTL for a plan in milliseconds
   *
   * @param planId - Plan UUID
   * @returns Remaining TTL in ms, or -1 if plan not found/expired
   */
  getRemainingTtl(planId: string): number {
    const plan = this.plans.get(planId);
    if (!plan) {
      return -1;
    }

    const remaining = new Date(plan.expiresAt).getTime() - Date.now();
    return remaining > 0 ? remaining : -1;
  }

  /**
   * Format plan summary for display
   *
   * @param plan - Sync plan
   * @returns Human-readable summary
   */
  static formatPlanSummary(plan: SyncPlan): string {
    const ops = plan.operations;
    const parts: string[] = [
      `Direction: ${plan.direction}`,
      `Changes: +${ops.add.length} ~${ops.update.length} -${ops.delete.length}`,
      `Bootstrap: ${plan.isBootstrap ? 'yes' : 'no'}`,
    ];

    if (plan.deletionToken) {
      parts.push(`Deletions require confirmation`);
    }

    const ttl = Math.round((new Date(plan.expiresAt).getTime() - Date.now()) / 1000);
    parts.push(`Expires in: ${ttl}s`);

    return parts.join(' | ');
  }
}
