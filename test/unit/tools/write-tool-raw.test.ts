/**
 * Unit tests for WriteTool.executeRaw() — fromLocal parameter support
 *
 * Verifies that raw write mode (write({..., raw: true})) correctly handles
 * the `fromLocal` parameter:
 * - Reads content from a local file path instead of inline `content`
 * - Rejects simultaneous `content` + `fromLocal` (mutual exclusion)
 * - Surfaces FileOperationError when the local file does not exist
 * - `fromLocal` is present in the RawWriteParams interface (schema-level)
 *
 * These tests exercise the path BEFORE any GAS API call or auth token
 * retrieval, so no network mocking is required.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { WriteTool } from '../../../src/tools/filesystem/WriteTool.js';
import { SessionAuthManager } from '../../../src/auth/sessionManager.js';
import { ValidationError, FileOperationError } from '../../../src/errors/mcpErrors.js';

const TEST_SCRIPT_ID = '1Y72rigcMUAwRd7bwl3CR57O6ENo5sKTn0xAl2C4HoZys75N5utGfkCUG';

describe('WriteTool - executeRaw() fromLocal support', () => {
  let writeTool: WriteTool;
  let authManager: SessionAuthManager;
  let tmpDir: string;

  beforeEach(async () => {
    authManager = new SessionAuthManager();
    writeTool = new WriteTool(authManager);
    // Use /tmp directly — os.tmpdir() on macOS returns /var/folders/... which
    // is in pathExpansion.ts's blocked-paths list. /tmp is not blocked.
    tmpDir = await mkdtemp('/tmp/write-tool-raw-test-');
  });

  afterEach(async () => {
    // Clean up temp directory created by this test
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('RawWriteParams interface — fromLocal declaration', () => {
    it('should expose fromLocal in the tool inputSchema', () => {
      // fromLocal is declared in the smart-mode inputSchema and carried
      // through to executeRaw() via the RawWriteParams interface.
      // This validates the schema-level declaration is not missing.
      const schema = writeTool.inputSchema as any;
      expect(schema.properties.fromLocal, 'fromLocal must be declared in inputSchema').to.exist;
      expect(schema.properties.fromLocal.type).to.equal('string');
    });
  });

  describe('Mutual exclusion: content + fromLocal', () => {
    it('should throw ValidationError when both content and fromLocal are provided', async () => {
      const localFilePath = join(tmpDir, 'test-file.gs');
      await writeFile(localFilePath, 'function hello() {}', 'utf-8');

      let thrownError: any;
      try {
        await writeTool.execute({
          scriptId: TEST_SCRIPT_ID,
          path: 'TestUtil',
          content: 'function inline() {}',
          fromLocal: localFilePath,
          fileType: 'SERVER_JS',
          raw: true,
        } as any);
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError, 'should have thrown').to.exist;
      expect(thrownError).to.be.instanceOf(ValidationError);
      expect(thrownError.message).to.include('fromLocal');
    });
  });

  describe('File not found: fromLocal points to non-existent file', () => {
    it('should throw FileOperationError when fromLocal file does not exist', async () => {
      // Use /tmp directly (not tmpDir) to avoid the blocked-path validation error
      // from expandAndValidateLocalPath. /tmp is unblocked; we just use a path
      // that provably won't exist so readFile throws ENOENT → FileOperationError.
      const nonExistentPath = '/tmp/mcp-gas-test-nonexistent-' + Date.now() + '.gs';

      let thrownError: any;
      try {
        await writeTool.execute({
          scriptId: TEST_SCRIPT_ID,
          path: 'TestUtil',
          fromLocal: nonExistentPath,
          fileType: 'SERVER_JS',
          raw: true,
        } as any);
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError, 'should have thrown').to.exist;
      expect(thrownError).to.be.instanceOf(FileOperationError);
      expect(thrownError.message).to.include('fromLocal');
      expect(thrownError.message).to.include('Failed to read local file');
    });
  });

  describe('Successful content resolution from local file', () => {
    it('should read file content before proceeding to auth/upload', async () => {
      const localFilePath = join(tmpDir, 'test-module.gs');
      const expectedContent = 'function add(a, b) { return a + b; }';
      await writeFile(localFilePath, expectedContent, 'utf-8');

      // Stub getAuthToken to throw a sentinel error AFTER content has been
      // resolved. If fromLocal resolution itself failed, we'd get a
      // FileOperationError (not our sentinel). The sentinel proves the
      // content-read step completed successfully.
      const sentinelMessage = '__SENTINEL_AFTER_CONTENT_RESOLVED__';
      (writeTool as any).getAuthToken = async () => {
        throw new Error(sentinelMessage);
      };

      let thrownError: any;
      try {
        await writeTool.execute({
          scriptId: TEST_SCRIPT_ID,
          path: 'TestUtil',
          fromLocal: localFilePath,
          fileType: 'SERVER_JS',
          raw: true,
        } as any);
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError, 'should have thrown at auth step').to.exist;

      // Must NOT be a FileOperationError about fromLocal — that would mean
      // file reading failed, not that we got past it.
      expect(
        thrownError instanceof FileOperationError,
        `got FileOperationError unexpectedly: ${thrownError?.message}`
      ).to.be.false;

      // Should be our sentinel error, proving the content-read step passed.
      expect(thrownError.message).to.equal(sentinelMessage);
    });
  });

  describe('Missing content and fromLocal', () => {
    it('should throw ValidationError when neither content nor fromLocal is provided', async () => {
      let thrownError: any;
      try {
        await writeTool.execute({
          scriptId: TEST_SCRIPT_ID,
          path: 'TestUtil',
          fileType: 'SERVER_JS',
          raw: true,
          // No content, no fromLocal
        } as any);
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError, 'should have thrown').to.exist;
      expect(thrownError).to.be.instanceOf(ValidationError);
      expect(thrownError.message).to.include('content');
    });
  });
});
