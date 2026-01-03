/**
 * Unit tests for rsync modules
 *
 * Tests core functionality of:
 * - SyncManifest: File tracking and bootstrap detection
 * - SyncDiff: Diff computation between source/dest
 * - PlanStore: Plan storage with TTL
 * - SyncPlanner: Plan creation logic
 * - SyncExecutor: Plan execution logic
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import * as sinon from 'sinon';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

// Import modules under test
import { SyncManifest, SyncManifestData } from '../../../src/tools/rsync/SyncManifest.js';
import { SyncDiff, DiffFileInfo, SyncDiffResult } from '../../../src/tools/rsync/SyncDiff.js';
import { PlanStore, SyncPlan } from '../../../src/tools/rsync/PlanStore.js';

// Helper to create a valid operations object for PlanStore
function createOperations(ops: Partial<SyncDiffResult> = {}): SyncDiffResult {
  return {
    add: ops.add || [],
    update: ops.update || [],
    delete: ops.delete || [],
    hasChanges: ops.hasChanges ?? false,
    hasDestructiveChanges: ops.hasDestructiveChanges ?? false,
    totalOperations: ops.totalOperations ?? 0
  };
}

describe('rsync modules', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rsync-test-'));
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    sinon.restore();
  });

  // ============================================================
  // SyncManifest Tests
  // ============================================================
  describe('SyncManifest', () => {
    describe('computeGitSha1', () => {
      it('should compute Git-compatible SHA-1 hash', () => {
        // Git SHA-1 format: sha1("blob " + size + "\0" + content)
        const content = 'Hello, World!';
        const sha1 = SyncManifest.computeGitSha1(content);

        // Verify it's a valid SHA-1 hex string (40 chars)
        expect(sha1).to.match(/^[a-f0-9]{40}$/);

        // Same content should produce same hash
        const sha1Again = SyncManifest.computeGitSha1(content);
        expect(sha1Again).to.equal(sha1);

        // Different content should produce different hash
        const sha1Different = SyncManifest.computeGitSha1('Different content');
        expect(sha1Different).to.not.equal(sha1);
      });

      it('should handle empty content', () => {
        const sha1 = SyncManifest.computeGitSha1('');
        expect(sha1).to.match(/^[a-f0-9]{40}$/);
      });

      it('should handle unicode content', () => {
        const sha1 = SyncManifest.computeGitSha1('こんにちは世界 🌍');
        expect(sha1).to.match(/^[a-f0-9]{40}$/);
      });
    });

    describe('load', () => {
      it('should detect bootstrap when no manifest exists', async () => {
        const manifest = new SyncManifest(tempDir);
        const result = await manifest.load();

        expect(result.isBootstrap).to.be.true;
        expect(result.manifest).to.be.null;
      });

      it('should load existing manifest', async () => {
        // Create .git directory and manifest
        const gitDir = path.join(tempDir, '.git');
        await fs.mkdir(gitDir, { recursive: true });

        const manifestData: SyncManifestData = {
          version: '2.1',
          scriptId: 'test-script-id',
          lastSyncTimestamp: '2025-01-01T00:00:00Z',
          lastSyncDirection: 'pull',
          files: {
            'utils.gs': {
              sha1: 'abc123',
              lastModified: '2025-01-01T00:00:00Z',
              syncedAt: '2025-01-01T00:00:00Z'
            }
          }
        };

        await fs.writeFile(
          path.join(gitDir, 'sync-manifest.json'),
          JSON.stringify(manifestData)
        );

        const manifest = new SyncManifest(tempDir);
        const result = await manifest.load();

        expect(result.isBootstrap).to.be.false;
        expect(result.manifest).to.deep.equal(manifestData);
      });

      it('should throw on corrupted manifest', async () => {
        const gitDir = path.join(tempDir, '.git');
        await fs.mkdir(gitDir, { recursive: true });
        await fs.writeFile(
          path.join(gitDir, 'sync-manifest.json'),
          'not valid json {'
        );

        const manifest = new SyncManifest(tempDir);

        // SyncManifest.load() throws SyntaxError on corrupted JSON
        // Only returns bootstrap for ENOENT (file not found)
        try {
          await manifest.load();
          expect.fail('Should have thrown SyntaxError');
        } catch (error: any) {
          expect(error).to.be.instanceOf(SyntaxError);
        }
      });
    });

    describe('save', () => {
      it('should save manifest to .git directory', async () => {
        const gitDir = path.join(tempDir, '.git');
        await fs.mkdir(gitDir, { recursive: true });

        const manifest = new SyncManifest(tempDir);
        const data: SyncManifestData = {
          version: '2.1',
          scriptId: 'test-script-id',
          lastSyncTimestamp: '2025-01-01T00:00:00Z',
          lastSyncDirection: 'push',
          files: {}
        };

        await manifest.save(data);

        const saved = await fs.readFile(
          path.join(gitDir, 'sync-manifest.json'),
          'utf-8'
        );
        expect(JSON.parse(saved)).to.deep.equal(data);
      });

      it('should create .git directory if missing', async () => {
        const manifest = new SyncManifest(tempDir);
        const data: SyncManifestData = {
          version: '2.1',
          scriptId: 'test-script-id',
          lastSyncTimestamp: '2025-01-01T00:00:00Z',
          lastSyncDirection: 'pull',
          files: {}
        };

        await manifest.save(data);

        const gitDir = path.join(tempDir, '.git');
        const stat = await fs.stat(gitDir);
        expect(stat.isDirectory()).to.be.true;
      });
    });
  });

  // ============================================================
  // SyncDiff Tests
  // ============================================================
  describe('SyncDiff', () => {
    describe('fromGasFiles', () => {
      it('should convert GAS files to DiffFileInfo', () => {
        const gasFiles = [
          { name: 'utils', source: 'function add() {}', updateTime: '2025-01-01T00:00:00Z' },
          { name: 'main', source: 'function main() {}', updateTime: '2025-01-01T00:00:00Z' }
        ];

        const diffFiles = SyncDiff.fromGasFiles(gasFiles);

        expect(diffFiles).to.have.length(2);
        expect(diffFiles[0].filename).to.equal('utils');
        expect(diffFiles[0].content).to.equal('function add() {}');
        expect(diffFiles[0].sha1).to.match(/^[a-f0-9]{40}$/);
      });
    });

    describe('compute', () => {
      it('should detect additions (source has, dest missing)', () => {
        const source: DiffFileInfo[] = [
          { filename: 'new-file', content: 'new content', sha1: 'abc123', lastModified: '2025-01-01T00:00:00Z', size: 11 }
        ];
        const dest: DiffFileInfo[] = [];

        const result = SyncDiff.compute(source, dest, { isBootstrap: false, direction: 'pull' });

        expect(result.add).to.have.length(1);
        expect(result.add[0].filename).to.equal('new-file');
        expect(result.update).to.have.length(0);
        expect(result.delete).to.have.length(0);
      });

      it('should detect updates (content changed)', () => {
        const source: DiffFileInfo[] = [
          { filename: 'file', content: 'new content', sha1: 'new-sha1', lastModified: '2025-01-02T00:00:00Z', size: 11 }
        ];
        const dest: DiffFileInfo[] = [
          { filename: 'file', content: 'old content', sha1: 'old-sha1', lastModified: '2025-01-01T00:00:00Z', size: 11 }
        ];

        const result = SyncDiff.compute(source, dest, { isBootstrap: false, direction: 'pull' });

        expect(result.add).to.have.length(0);
        expect(result.update).to.have.length(1);
        expect(result.update[0].filename).to.equal('file');
        expect(result.delete).to.have.length(0);
      });

      it('should detect deletions (source missing, dest has, tracked in manifest)', () => {
        const source: DiffFileInfo[] = [];
        const dest: DiffFileInfo[] = [
          { filename: 'deleted', content: 'content', sha1: 'sha1', lastModified: '2025-01-01T00:00:00Z', size: 7 }
        ];

        // Deletions require manifest with the file tracked
        const manifest: SyncManifestData = {
          version: '2.1',
          scriptId: 'test-script',
          lastSyncTimestamp: '2025-01-01T00:00:00Z',
          lastSyncDirection: 'pull',
          files: {
            'deleted': {
              sha1: 'sha1',
              lastModified: '2025-01-01T00:00:00Z',
              syncedAt: '2025-01-01T00:00:00Z'
            }
          }
        };

        const result = SyncDiff.compute(source, dest, { isBootstrap: false, direction: 'pull', manifest });

        expect(result.add).to.have.length(0);
        expect(result.update).to.have.length(0);
        expect(result.delete).to.have.length(1);
        expect(result.delete[0].filename).to.equal('deleted');
      });

      it('should NOT delete files not tracked in manifest', () => {
        const source: DiffFileInfo[] = [];
        const dest: DiffFileInfo[] = [
          { filename: 'untracked', content: 'content', sha1: 'sha1', lastModified: '2025-01-01T00:00:00Z', size: 7 }
        ];

        // Empty manifest - file is not tracked
        const manifest: SyncManifestData = {
          version: '2.1',
          scriptId: 'test-script',
          lastSyncTimestamp: '2025-01-01T00:00:00Z',
          lastSyncDirection: 'pull',
          files: {}
        };

        const result = SyncDiff.compute(source, dest, { isBootstrap: false, direction: 'pull', manifest });

        // Without tracking in manifest, deletion is skipped
        expect(result.delete).to.have.length(0);
      });

      it('should NOT delete on bootstrap', () => {
        const source: DiffFileInfo[] = [];
        const dest: DiffFileInfo[] = [
          { filename: 'existing', content: 'content', sha1: 'sha1', lastModified: '2025-01-01T00:00:00Z', size: 7 }
        ];

        const result = SyncDiff.compute(source, dest, { isBootstrap: true, direction: 'pull' });

        expect(result.delete).to.have.length(0);
        expect(result.hasChanges).to.be.false;
      });

      it('should detect no changes when files are identical', () => {
        const sha1 = 'same-sha1-hash';
        const source: DiffFileInfo[] = [
          { filename: 'file', content: 'content', sha1, lastModified: '2025-01-01T00:00:00Z', size: 7 }
        ];
        const dest: DiffFileInfo[] = [
          { filename: 'file', content: 'content', sha1, lastModified: '2025-01-01T00:00:00Z', size: 7 }
        ];

        const result = SyncDiff.compute(source, dest, { isBootstrap: false, direction: 'pull' });

        expect(result.hasChanges).to.be.false;
        expect(result.totalOperations).to.equal(0);
      });

      it('should handle mixed operations', () => {
        const source: DiffFileInfo[] = [
          { filename: 'add-file', content: 'new', sha1: 'add-sha1', lastModified: '2025-01-01T00:00:00Z', size: 3 },
          { filename: 'update-file', content: 'new content', sha1: 'new-sha1', lastModified: '2025-01-02T00:00:00Z', size: 11 },
          { filename: 'same-file', content: 'unchanged', sha1: 'same-sha1', lastModified: '2025-01-01T00:00:00Z', size: 9 }
        ];
        const dest: DiffFileInfo[] = [
          { filename: 'update-file', content: 'old content', sha1: 'old-sha1', lastModified: '2025-01-01T00:00:00Z', size: 11 },
          { filename: 'same-file', content: 'unchanged', sha1: 'same-sha1', lastModified: '2025-01-01T00:00:00Z', size: 9 },
          { filename: 'delete-file', content: 'deleted', sha1: 'del-sha1', lastModified: '2025-01-01T00:00:00Z', size: 7 }
        ];

        // Manifest tracking the file that will be deleted
        const manifest: SyncManifestData = {
          version: '2.1',
          scriptId: 'test-script',
          lastSyncTimestamp: '2025-01-01T00:00:00Z',
          lastSyncDirection: 'pull',
          files: {
            'delete-file': {
              sha1: 'del-sha1',
              lastModified: '2025-01-01T00:00:00Z',
              syncedAt: '2025-01-01T00:00:00Z'
            }
          }
        };

        const result = SyncDiff.compute(source, dest, { isBootstrap: false, direction: 'pull', manifest });

        expect(result.add).to.have.length(1);
        expect(result.update).to.have.length(1);
        expect(result.delete).to.have.length(1);
        expect(result.totalOperations).to.equal(3);
        expect(result.hasChanges).to.be.true;
      });
    });
  });

  // ============================================================
  // PlanStore Tests
  // ============================================================
  describe('PlanStore', () => {
    let planStore: PlanStore;

    beforeEach(() => {
      // Get a fresh instance for each test
      planStore = PlanStore.getInstance();
      // Clear any existing plans
      planStore.clear();
    });

    afterEach(() => {
      planStore.clear();
    });

    describe('getInstance', () => {
      it('should return singleton instance', () => {
        const instance1 = PlanStore.getInstance();
        const instance2 = PlanStore.getInstance();
        expect(instance1).to.equal(instance2);
      });
    });

    describe('create', () => {
      it('should create plan with unique ID', () => {
        const plan = planStore.create({
          direction: 'pull',
          scriptId: 'test-script',
          operations: createOperations(),
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 5,
          destFileCount: 3
        });

        expect(plan.planId).to.be.a('string');
        expect(plan.planId.length).to.be.greaterThan(0);
        expect(plan.direction).to.equal('pull');
        expect(plan.scriptId).to.equal('test-script');
      });

      it('should set expiration time', () => {
        const before = Date.now();

        const plan = planStore.create({
          direction: 'push',
          scriptId: 'test-script',
          operations: createOperations(),
          isBootstrap: true,
          localPath: tempDir,
          sourceFileCount: 0,
          destFileCount: 0
        });

        const after = Date.now();
        const expiresAt = new Date(plan.expiresAt).getTime();

        // Should expire in ~5 minutes (300000ms) with some tolerance
        expect(expiresAt).to.be.greaterThan(before + 290000);
        expect(expiresAt).to.be.lessThan(after + 310000);
      });
    });

    describe('get', () => {
      it('should retrieve valid plan', () => {
        const created = planStore.create({
          direction: 'pull',
          scriptId: 'test-script',
          operations: createOperations(),
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 0,
          destFileCount: 0
        });

        const validation = planStore.get(created.planId);

        expect(validation.valid).to.be.true;
        expect(validation.plan).to.deep.equal(created);
      });

      it('should return invalid for non-existent plan', () => {
        const validation = planStore.get('non-existent-id');

        expect(validation.valid).to.be.false;
        // PlanStore uses uppercase error codes
        expect(validation.reason).to.equal('PLAN_NOT_FOUND');
      });

      it('should return invalid for expired plan', async () => {
        // Reset singleton to allow custom TTL config
        PlanStore.resetInstance();

        // Create a plan with very short TTL for testing
        const customStore = PlanStore.getInstance({ ttlMs: 50 });

        const plan = customStore.create({
          direction: 'pull',
          scriptId: 'test-script',
          operations: createOperations(),
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 0,
          destFileCount: 0
        });

        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 100));

        const validation = customStore.get(plan.planId);

        expect(validation.valid).to.be.false;
        // PlanStore uses uppercase error codes
        expect(validation.reason).to.equal('PLAN_EXPIRED');

        customStore.clear();
        // Reset again for other tests
        PlanStore.resetInstance();
      });
    });

    describe('delete', () => {
      it('should delete existing plan', () => {
        const plan = planStore.create({
          direction: 'pull',
          scriptId: 'test-script',
          operations: createOperations(),
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 0,
          destFileCount: 0
        });

        const deleted = planStore.delete(plan.planId);

        expect(deleted).to.be.true;

        const validation = planStore.get(plan.planId);
        expect(validation.valid).to.be.false;
      });

      it('should return false for non-existent plan', () => {
        const deleted = planStore.delete('non-existent');
        expect(deleted).to.be.false;
      });
    });

    describe('getCount', () => {
      it('should return correct plan count', () => {
        expect(planStore.getCount()).to.equal(0);

        planStore.create({
          direction: 'pull',
          scriptId: 'script1',
          operations: createOperations(),
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 0,
          destFileCount: 0
        });

        expect(planStore.getCount()).to.equal(1);

        planStore.create({
          direction: 'push',
          scriptId: 'script2',
          operations: createOperations(),
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 0,
          destFileCount: 0
        });

        expect(planStore.getCount()).to.equal(2);
      });
    });

    describe('formatPlanSummary', () => {
      it('should format plan summary correctly', () => {
        const plan = planStore.create({
          direction: 'pull',
          scriptId: 'test-script',
          operations: createOperations({
            add: [{ filename: 'new.gs', action: 'add' }],
            update: [{ filename: 'mod.gs', action: 'update' }],
            delete: [{ filename: 'del.gs', action: 'delete' }],
            hasChanges: true,
            hasDestructiveChanges: true,
            totalOperations: 3
          }),
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 2,
          destFileCount: 2
        });

        const summary = PlanStore.formatPlanSummary(plan);

        // Format: "Direction: pull | Changes: +1 ~1 -1 | Bootstrap: no | ..."
        expect(summary).to.include('pull');
        expect(summary).to.include('+1');  // adds
        expect(summary).to.include('~1');  // updates
        expect(summary).to.include('-1');  // deletes
      });
    });

    describe('getRemainingTtl', () => {
      it('should return remaining TTL in ms', () => {
        const plan = planStore.create({
          direction: 'pull',
          scriptId: 'test-script',
          operations: createOperations(),
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 0,
          destFileCount: 0
        });

        const ttl = planStore.getRemainingTtl(plan.planId);

        // Should be close to 5 minutes (300000ms)
        expect(ttl).to.be.greaterThan(290000);
        expect(ttl).to.be.lessThanOrEqual(300000);
      });

      it('should return -1 for non-existent plan', () => {
        const ttl = planStore.getRemainingTtl('non-existent');
        expect(ttl).to.equal(-1);
      });
    });

    describe('validateDeletionToken', () => {
      it('should return true when plan has no deletions', () => {
        const plan = planStore.create({
          direction: 'pull',
          scriptId: 'test-script',
          operations: createOperations(), // No deletions
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 0,
          destFileCount: 0
        });

        // No token needed when no deletions
        const isValid = planStore.validateDeletionToken(plan, undefined);
        expect(isValid).to.be.true;
      });

      it('should return false when deletions exist but no token provided', () => {
        const plan = planStore.create({
          direction: 'pull',
          scriptId: 'test-script',
          operations: createOperations({
            add: [],
            update: [],
            delete: [{ filename: 'to-delete.gs', action: 'delete' }],
            hasChanges: true,
            hasDestructiveChanges: true,
            totalOperations: 1
          }),
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 0,
          destFileCount: 1
        });

        const isValid = planStore.validateDeletionToken(plan, undefined);
        expect(isValid).to.be.false;
      });

      it('should return true when valid token is provided', () => {
        const plan = planStore.create({
          direction: 'pull',
          scriptId: 'test-script',
          operations: createOperations({
            add: [],
            update: [],
            delete: [{ filename: 'to-delete.gs', action: 'delete' }],
            hasChanges: true,
            hasDestructiveChanges: true,
            totalOperations: 1
          }),
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 0,
          destFileCount: 1
        });

        // Plan should have a deletionToken since it has deletions
        expect(plan.deletionToken).to.exist;

        // Valid token should be accepted
        const isValid = planStore.validateDeletionToken(plan, plan.deletionToken);
        expect(isValid).to.be.true;
      });

      it('should reject tampered token', () => {
        const plan = planStore.create({
          direction: 'pull',
          scriptId: 'test-script',
          operations: createOperations({
            add: [],
            update: [],
            delete: [{ filename: 'to-delete.gs', action: 'delete' }],
            hasChanges: true,
            hasDestructiveChanges: true,
            totalOperations: 1
          }),
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 0,
          destFileCount: 1
        });

        // Tamper with the token
        const tamperedToken = plan.deletionToken!.replace(/[0-9a-f]$/, 'X');

        const isValid = planStore.validateDeletionToken(plan, tamperedToken);
        expect(isValid).to.be.false;
      });

      it('should reject completely different token', () => {
        const plan = planStore.create({
          direction: 'pull',
          scriptId: 'test-script',
          operations: createOperations({
            add: [],
            update: [],
            delete: [{ filename: 'to-delete.gs', action: 'delete' }],
            hasChanges: true,
            hasDestructiveChanges: true,
            totalOperations: 1
          }),
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 0,
          destFileCount: 1
        });

        // Completely fabricated token
        const fakeToken = 'a'.repeat(64); // Same length as SHA256 hex

        const isValid = planStore.validateDeletionToken(plan, fakeToken);
        expect(isValid).to.be.false;
      });

      it('should reject token from different plan', () => {
        // Create first plan with deletions
        const plan1 = planStore.create({
          direction: 'pull',
          scriptId: 'test-script-1',
          operations: createOperations({
            add: [],
            update: [],
            delete: [{ filename: 'file1.gs', action: 'delete' }],
            hasChanges: true,
            hasDestructiveChanges: true,
            totalOperations: 1
          }),
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 0,
          destFileCount: 1
        });

        // Create second plan with different deletions
        const plan2 = planStore.create({
          direction: 'pull',
          scriptId: 'test-script-2',
          operations: createOperations({
            add: [],
            update: [],
            delete: [{ filename: 'file2.gs', action: 'delete' }],
            hasChanges: true,
            hasDestructiveChanges: true,
            totalOperations: 1
          }),
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 0,
          destFileCount: 1
        });

        // Try to use plan1's token for plan2
        const isValid = planStore.validateDeletionToken(plan2, plan1.deletionToken);
        expect(isValid).to.be.false;
      });

      it('should handle malformed token gracefully', () => {
        const plan = planStore.create({
          direction: 'pull',
          scriptId: 'test-script',
          operations: createOperations({
            add: [],
            update: [],
            delete: [{ filename: 'to-delete.gs', action: 'delete' }],
            hasChanges: true,
            hasDestructiveChanges: true,
            totalOperations: 1
          }),
          isBootstrap: false,
          localPath: tempDir,
          sourceFileCount: 0,
          destFileCount: 1
        });

        // Malformed tokens (not valid hex)
        const malformedTokens = [
          'not-hex-at-all',
          'ZZZZ',
          '',
          '   ',
          '🔒🔒🔒', // Emoji
          null as unknown as string, // Type coercion test
        ];

        for (const token of malformedTokens) {
          const isValid = planStore.validateDeletionToken(plan, token);
          expect(isValid).to.be.false;
        }
      });
    });
  });
});
