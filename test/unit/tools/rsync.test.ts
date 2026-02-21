/**
 * Unit tests for rsync modules
 *
 * Tests core functionality of:
 * - SyncManifest: File tracking and bootstrap detection
 * - SyncDiff: Diff computation between source/dest
 * - SyncExecutor: Deletion safety validation
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import * as sinon from 'sinon';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { spawnSync } from 'child_process';

// Import modules under test
import { SyncManifest, SyncManifestData } from '../../../src/tools/rsync/SyncManifest.js';
import { SyncDiff, DiffFileInfo, SyncDiffResult } from '../../../src/tools/rsync/SyncDiff.js';
import { SyncExecutor } from '../../../src/tools/rsync/SyncExecutor.js';
import { computeGitSha1 } from '../../../src/utils/hashUtils.js';

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
    describe('computeGitSha1 (from hashUtils)', () => {
      it('should compute Git-compatible SHA-1 hash', () => {
        // Git SHA-1 format: sha1("blob " + size + "\0" + content)
        const content = 'Hello, World!';
        const sha1 = computeGitSha1(content);

        // Verify it's a valid SHA-1 hex string (40 chars)
        expect(sha1).to.match(/^[a-f0-9]{40}$/);

        // Same content should produce same hash
        const sha1Again = computeGitSha1(content);
        expect(sha1Again).to.equal(sha1);

        // Different content should produce different hash
        const sha1Different = computeGitSha1('Different content');
        expect(sha1Different).to.not.equal(sha1);
      });

      it('should handle empty content', () => {
        const sha1 = computeGitSha1('');
        expect(sha1).to.match(/^[a-f0-9]{40}$/);
      });

      it('should handle unicode content', () => {
        const sha1 = computeGitSha1('こんにちは世界 🌍');
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

    describe('formatSummary', () => {
      it('should format no changes', () => {
        const diff: SyncDiffResult = {
          add: [],
          update: [],
          delete: [],
          totalOperations: 0,
          hasChanges: false,
          hasDestructiveChanges: false,
        };

        expect(SyncDiff.formatSummary(diff)).to.equal('No changes detected');
      });

      it('should format mixed changes', () => {
        const diff: SyncDiffResult = {
          add: [{ filename: 'a.gs', action: 'add' }],
          update: [{ filename: 'b.gs', action: 'update' }],
          delete: [{ filename: 'c.gs', action: 'delete' }],
          totalOperations: 3,
          hasChanges: true,
          hasDestructiveChanges: true,
        };

        const summary = SyncDiff.formatSummary(diff);
        expect(summary).to.include('+1');
        expect(summary).to.include('~1');
        expect(summary).to.include('-1');
        expect(summary).to.include('3 total');
      });
    });
  });

  // ============================================================
  // SyncExecutor.executePull — contentAnalysis integration
  // ============================================================
  describe('SyncExecutor contentAnalysis', () => {
    /**
     * Helper: build a minimal SyncDiffResult for pull tests
     */
    function initGitRepo(dir: string): boolean {
      const steps: Array<[string, string[]]> = [
        ['git', ['-C', dir, 'init']],
        ['git', ['-C', dir, 'config', 'user.email', 'test@test.com']],
        ['git', ['-C', dir, 'config', 'user.name', 'Test']],
        ['git', ['-C', dir, 'commit', '--allow-empty', '-m', 'init']],
      ];
      for (const [cmd, args] of steps) {
        const r = spawnSync(cmd, args, { stdio: 'ignore' });
        if (r.error || r.status !== 0) return false;
      }
      return true;
    }

    function makePullOps(ops: { add?: Array<{ filename: string; content: string; fileType?: string }>; update?: Array<{ filename: string; content: string; fileType?: string }> }): SyncDiffResult {
      const add = (ops.add || []).map(o => ({ filename: o.filename, content: o.content, fileType: o.fileType || 'SERVER_JS', action: 'add' as const }));
      const update = (ops.update || []).map(o => ({ filename: o.filename, content: o.content, fileType: o.fileType || 'SERVER_JS', action: 'update' as const }));
      return {
        add,
        update,
        delete: [],
        totalOperations: add.length + update.length,
        hasChanges: add.length + update.length > 0,
        hasDestructiveChanges: false,
      };
    }

    it('should populate contentAnalysis when pulled file uses PropertiesService', async () => {
      // Set up a temp git repo so executor can commit
      const gitDir = path.join(tempDir, '.git');
      await fs.mkdir(gitDir, { recursive: true });
      // Init git repo
      if (!initGitRepo(tempDir)) return; // git not available — skip this test

      const executor = new SyncExecutor();
      const ops = makePullOps({
        add: [{
          filename: 'utils',
          content: 'function getConfig() { return PropertiesService.getScriptProperties().getProperty("KEY"); }'
        }]
      });

      const result = await executor.apply({
        direction: 'pull',
        scriptId: 'test-script-id-12345678901234',
        operations: ops,
        localPath: tempDir,
        isBootstrap: true,
        accessToken: 'ya29.fake-token',
      });

      expect(result.success).to.be.true;
      expect(result.contentAnalysis).to.be.an('array').with.length.at.least(1);
      const entry = result.contentAnalysis!.find(e => e.file === 'utils');
      expect(entry).to.exist;
      expect(entry!.warnings).to.be.an('array');
      expect(entry!.hints.some(h => h.includes('gas-properties/ConfigManager'))).to.be.true;
    });

    it('should NOT include contentAnalysis when pulled files are clean', async () => {
      if (!initGitRepo(tempDir)) return; // git not available

      const executor = new SyncExecutor();
      const ops = makePullOps({
        add: [{
          filename: 'clean',
          content: 'function add(a, b) { return a + b; }'
        }]
      });

      const result = await executor.apply({
        direction: 'pull',
        scriptId: 'test-script-id-12345678901234',
        operations: ops,
        localPath: tempDir,
        isBootstrap: true,
        accessToken: 'ya29.fake-token',
      });

      expect(result.success).to.be.true;
      // No hints → contentAnalysis should be absent
      expect(result.contentAnalysis).to.be.undefined;
    });
  });
});
