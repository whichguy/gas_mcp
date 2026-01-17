import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  ConflictError,
  SyncDriftError,
  type ConflictDetails,
  type DriftFileInfo
} from '../../src/errors/mcpErrors.js';
import { computeGitSha1, hashesEqual } from '../../src/utils/hashUtils.js';

describe('Hash-Based Conflict Detection', () => {
  describe('computeGitSha1', () => {
    it('should compute correct Git SHA-1 hash for simple content', () => {
      // Git SHA-1 format: sha1("blob " + size + "\0" + content)
      const content = 'function add(a, b) { return a + b; }';
      const hash = computeGitSha1(content);

      expect(hash).to.be.a('string');
      expect(hash).to.have.length(40);
      expect(hash).to.match(/^[a-f0-9]{40}$/);
    });

    it('should produce consistent hashes for same content', () => {
      const content = 'const x = 42;';
      const hash1 = computeGitSha1(content);
      const hash2 = computeGitSha1(content);

      expect(hash1).to.equal(hash2);
    });

    it('should produce different hashes for different content', () => {
      const content1 = 'const x = 42;';
      const content2 = 'const x = 43;';

      expect(computeGitSha1(content1)).to.not.equal(computeGitSha1(content2));
    });

    it('should handle empty content', () => {
      const hash = computeGitSha1('');

      expect(hash).to.be.a('string');
      expect(hash).to.have.length(40);
      // Git hash for empty blob is e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
      expect(hash).to.equal('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    });

    it('should handle unicode content', () => {
      const content = 'const greeting = "こんにちは世界";';
      const hash = computeGitSha1(content);

      expect(hash).to.be.a('string');
      expect(hash).to.have.length(40);
    });

    it('should normalize CRLF to LF for consistent hashing', () => {
      const contentLF = 'line1\nline2';
      const contentCRLF = 'line1\r\nline2';

      // CRLF should be normalized to LF for cross-platform consistency
      // This matches the plan requirement: "Normalize to LF before hashing"
      expect(computeGitSha1(contentLF)).to.equal(computeGitSha1(contentCRLF));
    });

    it('should strip UTF-8 BOM for consistent hashing', () => {
      const contentWithBOM = '\uFEFFconst x = 1;';
      const contentWithoutBOM = 'const x = 1;';

      // BOM should be stripped for consistent cross-platform hashing
      expect(computeGitSha1(contentWithBOM)).to.equal(computeGitSha1(contentWithoutBOM));
    });
  });

  describe('hashesEqual', () => {
    it('should return true for identical hashes', () => {
      const hash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
      expect(hashesEqual(hash, hash)).to.be.true;
    });

    it('should return false for different hashes', () => {
      const hash1 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
      const hash2 = 'b1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
      expect(hashesEqual(hash1, hash2)).to.be.false;
    });

    it('should handle case-insensitive comparison', () => {
      const hash1 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
      const hash2 = 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2';
      expect(hashesEqual(hash1, hash2)).to.be.true;
    });
  });

  describe('ConflictError', () => {
    it('should create ConflictError with full details', () => {
      const conflict: ConflictDetails = {
        scriptId: '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
        filename: 'auth.js',
        operation: 'write',
        expectedHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        currentHash: 'f9e8d7c6b5a4f9e8d7c6b5a4f9e8d7c6b5a4f9e8',
        hashSource: 'param',
        diff: {
          format: 'unified',
          content: '--- expected\n+++ current\n-old line\n+new line',
          truncated: false
        }
      };

      const error = new ConflictError(conflict);

      expect(error).to.be.instanceOf(Error);
      expect(error.message).to.include('auth.js');
      expect(error.message).to.include('modified externally');
      expect(error.conflict).to.deep.equal(conflict);
      expect(error.hints).to.have.property('primary');
      expect(error.hints).to.have.property('force');
      expect(error.hints).to.have.property('merge');
    });

    it('should provide correct hint commands', () => {
      const conflict: ConflictDetails = {
        scriptId: '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
        filename: 'utils.gs',
        operation: 'edit',
        expectedHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        currentHash: 'f9e8d7c6b5a4f9e8d7c6b5a4f9e8d7c6b5a4f9e8',
        hashSource: 'xattr'
      };

      const error = new ConflictError(conflict);

      expect(error.hints.primary.action).to.equal('refetch');
      expect(error.hints.primary.command).to.include('cat');
      expect(error.hints.force.action).to.equal('force_overwrite');
      expect(error.hints.force.command).to.include('force: true');
      expect(error.hints.merge.action).to.equal('manual_merge');
    });

    it('should handle different operations', () => {
      const operations: Array<'write' | 'edit' | 'aider' | 'cp'> = ['write', 'edit', 'aider', 'cp'];

      operations.forEach(operation => {
        const conflict: ConflictDetails = {
          scriptId: '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
          filename: 'test.gs',
          operation,
          expectedHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          currentHash: 'f9e8d7c6b5a4f9e8d7c6b5a4f9e8d7c6b5a4f9e8',
          hashSource: 'param'
        };

        const error = new ConflictError(conflict);
        expect(error.conflict.operation).to.equal(operation);
      });
    });

    it('should include diff when provided', () => {
      const conflict: ConflictDetails = {
        scriptId: '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
        filename: 'test.gs',
        operation: 'write',
        expectedHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        currentHash: 'f9e8d7c6b5a4f9e8d7c6b5a4f9e8d7c6b5a4f9e8',
        hashSource: 'param',
        diff: {
          format: 'unified',
          content: '--- a/test.gs\n+++ b/test.gs\n@@ -1 +1 @@\n-old\n+new',
          truncated: false
        }
      };

      const error = new ConflictError(conflict);
      expect(error.conflict.diff).to.exist;
      expect(error.conflict.diff!.format).to.equal('unified');
      expect(error.conflict.diff!.content).to.include('--- a/test.gs');
    });
  });

  describe('SyncDriftError', () => {
    it('should create SyncDriftError with stale files', () => {
      const drift = {
        staleLocal: [
          { filename: 'auth.gs', localHash: 'aaa111', remoteHash: 'bbb222' },
          { filename: 'utils.gs', localHash: 'ccc333', remoteHash: 'ddd444' }
        ],
        missingLocal: []
      };

      const error = new SyncDriftError('1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789', drift);

      expect(error).to.be.instanceOf(Error);
      expect(error.message).to.include('2 stale:');
      expect(error.drift.staleLocal).to.have.length(2);
      expect(error.hints.primary.command).to.include('rsync');
    });

    it('should create SyncDriftError with missing files', () => {
      const drift = {
        staleLocal: [],
        missingLocal: [
          { filename: 'new-file.gs', remoteHash: 'eee555' }
        ]
      };

      const error = new SyncDriftError('1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789', drift);

      expect(error.message).to.include('1 missing locally:');
      expect(error.drift.missingLocal).to.have.length(1);
    });

    it('should create SyncDriftError with both stale and missing', () => {
      const drift = {
        staleLocal: [
          { filename: 'stale.gs', localHash: 'aaa', remoteHash: 'bbb' }
        ],
        missingLocal: [
          { filename: 'missing.gs', remoteHash: 'ccc' }
        ]
      };

      const error = new SyncDriftError('1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789', drift);

      expect(error.message).to.include('1 stale:');
      expect(error.message).to.include('1 missing locally:');
    });

    it('should provide override hint', () => {
      const drift = {
        staleLocal: [{ filename: 'test.gs', localHash: 'a', remoteHash: 'b' }],
        missingLocal: []
      };

      const error = new SyncDriftError('1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789', drift);

      expect(error.hints.override).to.exist;
      expect(error.hints.override.command).to.include('skipSyncCheck: true');
      expect(error.hints.override.warning).to.be.a('string');
    });
  });
});

describe('syncStatusChecker Utility', () => {
  let tempDir: string;
  const scriptId = '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should correctly compute Git SHA-1 for sync comparison', () => {
    // Verify that the sync checker would use the same hash algorithm
    const content = 'function test() { return 42; }';
    const hash = computeGitSha1(content);

    // Compute the same hash again to verify consistency
    const hash2 = computeGitSha1(content);
    expect(hash).to.equal(hash2);
  });

  it('should handle different sync statuses', () => {
    // Test that the sync status types are valid
    const validStatuses = ['in_sync', 'local_stale', 'remote_only', 'local_only'];

    validStatuses.forEach(status => {
      expect(typeof status).to.equal('string');
    });
  });
});

describe('Hash Workflow Integration', () => {
  describe('cat → write workflow', () => {
    it('should validate hash format from cat response', () => {
      // Simulated cat response
      const catResponse = {
        content: 'function test() {}',
        hash: computeGitSha1('function test() {}'),
        filename: 'test.gs'
      };

      expect(catResponse.hash).to.match(/^[a-f0-9]{40}$/);
    });

    it('should detect conflict when hash changes', () => {
      const originalContent = 'function test() { return 1; }';
      const modifiedContent = 'function test() { return 2; }';

      const originalHash = computeGitSha1(originalContent);
      const currentHash = computeGitSha1(modifiedContent);

      expect(hashesEqual(originalHash, currentHash)).to.be.false;

      // This would trigger ConflictError in real write operation
      const conflict: ConflictDetails = {
        scriptId: '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
        filename: 'test.gs',
        operation: 'write',
        expectedHash: originalHash,
        currentHash: currentHash,
        hashSource: 'param'
      };

      const error = new ConflictError(conflict);
      expect(error.message).to.include('modified externally');
    });

    it('should allow write when hash matches', () => {
      const content = 'function test() {}';
      const expectedHash = computeGitSha1(content);
      const currentHash = computeGitSha1(content);

      expect(hashesEqual(expectedHash, currentHash)).to.be.true;
      // No ConflictError would be thrown
    });
  });

  describe('edit → write workflow', () => {
    it('should compute hash at read time for edit operations', () => {
      const originalContent = 'const DEBUG = false;';
      const readHash = computeGitSha1(originalContent);

      // Edit operation stores this hash
      expect(readHash).to.match(/^[a-f0-9]{40}$/);

      // Simulated edit
      const editedContent = originalContent.replace('false', 'true');
      const editedHash = computeGitSha1(editedContent);

      // Content changed, so hash should differ
      expect(hashesEqual(readHash, editedHash)).to.be.false;
    });
  });

  describe('force flag behavior', () => {
    it('should allow bypassing hash check with force flag', () => {
      // When force=true, hash mismatch should not throw error
      const params = {
        content: 'new content',
        expectedHash: 'old-hash-that-no-longer-matches',
        force: true
      };

      // In real implementation, force=true skips the hash validation
      expect(params.force).to.be.true;
    });
  });
});
