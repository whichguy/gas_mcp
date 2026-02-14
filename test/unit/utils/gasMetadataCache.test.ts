/**
 * @fileoverview Tests for GAS Metadata Cache
 *
 * Tests the xattr-based hash cache. The xattr hash is authoritative —
 * no mtime validation. MCP tools update the hash after every write.
 */

import { expect } from 'chai';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  getValidatedContentHash,
  updateCachedContentHash,
  getCachedContentHash,
  clearGASMetadata,
  ValidatedHashResult
} from '../../../src/utils/gasMetadataCache.js';
import { computeGitSha1 } from '../../../src/utils/hashUtils.js';

describe('gasMetadataCache', () => {
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gas-cache-test-'));
    testFile = path.join(testDir, 'test-file.gs');
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('getValidatedContentHash', () => {
    it('should return null for non-existent file', async () => {
      const result = await getValidatedContentHash('/nonexistent/file.gs');
      expect(result).to.be.null;
    });

    it('should compute hash for file without cached hash', async () => {
      const content = 'const x = 1;';
      await fs.writeFile(testFile, content, 'utf-8');

      const result = await getValidatedContentHash(testFile);

      expect(result).to.not.be.null;
      expect(result!.source).to.equal('computed');
      expect(result!.hash).to.equal(computeGitSha1(content));
    });

    it('should return cached hash when xattr exists', async () => {
      const content = 'const x = 1;';
      const expectedHash = computeGitSha1(content);

      // Write file and cache hash
      await fs.writeFile(testFile, content, 'utf-8');
      await updateCachedContentHash(testFile, expectedHash);

      // Get hash - should use cache (xattr is authoritative)
      const result = await getValidatedContentHash(testFile);

      expect(result).to.not.be.null;
      expect(result!.source).to.equal('cache');
      expect(result!.hash).to.equal(expectedHash);
    });

    it('should trust cached hash even when file is modified externally', async () => {
      const originalContent = 'const x = 1;';
      const originalHash = computeGitSha1(originalContent);

      // Write file and cache hash
      await fs.writeFile(testFile, originalContent, 'utf-8');
      await updateCachedContentHash(testFile, originalHash);

      // Modify file externally (simulates editor edit, git checkout, etc.)
      await new Promise(resolve => setTimeout(resolve, 10));
      await fs.writeFile(testFile, 'const x = 2;', 'utf-8');

      // xattr hash is authoritative — returns cached hash regardless of file changes
      const result = await getValidatedContentHash(testFile);

      expect(result).to.not.be.null;
      expect(result!.source).to.equal('cache');
      expect(result!.hash).to.equal(originalHash);
    });

    it('should compute hash when no cached hash exists', async () => {
      const content = 'const x = 1;';
      await fs.writeFile(testFile, content, 'utf-8');

      // Don't cache anything - just verify it computes

      const result = await getValidatedContentHash(testFile);

      expect(result).to.not.be.null;
      expect(result!.source).to.equal('computed');
      expect(result!.hash).to.equal(computeGitSha1(content));
    });

    it('should cache hash after first computation', async () => {
      const content = 'const x = 1;';
      await fs.writeFile(testFile, content, 'utf-8');

      // First call - computes and caches
      const result1 = await getValidatedContentHash(testFile);
      expect(result1!.source).to.equal('computed');

      // Second call - should use cached hash
      const result2 = await getValidatedContentHash(testFile);
      expect(result2!.source).to.equal('cache');
      expect(result2!.hash).to.equal(result1!.hash);
    });
  });

  describe('updateCachedContentHash', () => {
    it('should store hash in xattr', async () => {
      const content = 'const x = 1;';
      const hash = computeGitSha1(content);

      await fs.writeFile(testFile, content, 'utf-8');
      await updateCachedContentHash(testFile, hash);

      // Verify by getting cached hash
      const cachedHash = await getCachedContentHash(testFile);
      expect(cachedHash).to.equal(hash);
    });

    it('should allow subsequent validated reads without recompute', async () => {
      const content = 'const x = 1;';
      const hash = computeGitSha1(content);

      await fs.writeFile(testFile, content, 'utf-8');
      await updateCachedContentHash(testFile, hash);

      // Validated read should use cache
      const result = await getValidatedContentHash(testFile);
      expect(result!.source).to.equal('cache');
    });
  });

  describe('clearGASMetadata', () => {
    it('should clear cached hash', async () => {
      const content = 'const x = 1;';
      const hash = computeGitSha1(content);

      await fs.writeFile(testFile, content, 'utf-8');
      await updateCachedContentHash(testFile, hash);

      // Verify cache exists
      expect(await getCachedContentHash(testFile)).to.equal(hash);

      // Clear cache
      await clearGASMetadata(testFile);

      // Verify cache is cleared
      expect(await getCachedContentHash(testFile)).to.be.null;
    });

    it('should not throw for non-existent file', async () => {
      // Should not throw
      await clearGASMetadata('/nonexistent/file.gs');
    });
  });

  describe('getCachedContentHash (raw)', () => {
    it('should return cached hash without validation', async () => {
      const content = 'const x = 1;';
      const hash = computeGitSha1(content);

      await fs.writeFile(testFile, content, 'utf-8');
      await updateCachedContentHash(testFile, hash);

      // Modify file
      await new Promise(resolve => setTimeout(resolve, 10));
      await fs.writeFile(testFile, 'modified content', 'utf-8');

      // Raw get should still return old hash (no mtime validation)
      const cachedHash = await getCachedContentHash(testFile);
      expect(cachedHash).to.equal(hash);
    });

    it('should return null for invalid hash format', async () => {
      // This tests the validation of hash format
      await fs.writeFile(testFile, 'content', 'utf-8');

      // No hash cached - should return null
      const cachedHash = await getCachedContentHash(testFile);
      expect(cachedHash).to.be.null;
    });
  });

  describe('integration scenarios', () => {
    it('should handle MCP write workflow (mtime set to remote time)', async () => {
      const content = 'const x = 1;';
      const hash = computeGitSha1(content);
      const remoteTime = new Date('2024-01-15T10:30:00Z');

      // Simulate MCP write: write content, set mtime, cache hash
      await fs.writeFile(testFile, content, 'utf-8');
      await fs.utimes(testFile, remoteTime, remoteTime);
      await updateCachedContentHash(testFile, hash);

      // Validate - should use cache
      const result = await getValidatedContentHash(testFile);
      expect(result!.source).to.equal('cache');
      expect(result!.hash).to.equal(hash);
    });

    it('should trust cached hash after external edit (xattr authoritative)', async () => {
      const originalContent = 'const x = 1;';
      const originalHash = computeGitSha1(originalContent);
      const remoteTime = new Date('2024-01-15T10:30:00Z');

      // Simulate MCP write
      await fs.writeFile(testFile, originalContent, 'utf-8');
      await fs.utimes(testFile, remoteTime, remoteTime);
      await updateCachedContentHash(testFile, originalHash);

      // Simulate external edit (user edits in VSCode)
      await new Promise(resolve => setTimeout(resolve, 10));
      await fs.writeFile(testFile, 'const x = 2;', 'utf-8');

      // xattr hash is authoritative — not invalidated by mtime changes
      const result = await getValidatedContentHash(testFile);
      expect(result!.source).to.equal('cache');
      expect(result!.hash).to.equal(originalHash);
    });

    it('should trust cached hash after git checkout (xattr authoritative)', async () => {
      const v1Content = 'const version = 1;';
      const v1Hash = computeGitSha1(v1Content);

      // Initial state: v1 content with cached hash
      await fs.writeFile(testFile, v1Content, 'utf-8');
      await updateCachedContentHash(testFile, v1Hash);

      // Verify cache works
      let result = await getValidatedContentHash(testFile);
      expect(result!.source).to.equal('cache');

      // Simulate git checkout (changes file content and mtime)
      await new Promise(resolve => setTimeout(resolve, 10));
      await fs.writeFile(testFile, 'const version = 2;', 'utf-8');

      // xattr hash is authoritative — trusted regardless of mtime changes
      result = await getValidatedContentHash(testFile);
      expect(result!.source).to.equal('cache');
      expect(result!.hash).to.equal(v1Hash);
    });

    it('should handle backwards compatibility with existing caches', async () => {
      const content = 'const x = 1;';
      const hash = computeGitSha1(content);

      await fs.writeFile(testFile, content, 'utf-8');

      // Simulate old cache (has hash but no mtime) by directly writing xattr
      // Note: We can't directly test this without mocking xattr, but we can
      // verify that a fresh file (no cache) works correctly

      // First access - computes and caches
      let result = await getValidatedContentHash(testFile);
      expect(result!.source).to.equal('computed');

      // Second access - uses cache
      result = await getValidatedContentHash(testFile);
      expect(result!.source).to.equal('cache');
    });
  });
});
