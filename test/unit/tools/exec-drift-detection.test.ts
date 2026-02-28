/**
 * Unit tests for exec() drift detection bugs
 *
 * Bug 1: Extension mismatch causes false remote_only (false negative)
 *   SERVER_JS files stored locally as .js (not .gs) were classified as remote_only,
 *   making exec() silently proceed with stale code. Fixed by probing the alternate
 *   extension (.gs <=> .js) before falling through to remote_only.
 *
 * Bug 2: Auth failure silently bypasses drift check (false negative)
 *   When tryGetAuthToken() returns null, the entire drift check was skipped with
 *   only a console.error -- the MCP response gave no indication drift was unchecked.
 *   Fixed by surfacing syncWarning in the exec() response.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { createSandbox, SinonSandbox } from 'sinon';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { checkSyncStatus } from '../../../src/utils/syncStatusChecker.js';
import { LocalFileManager } from '../../../src/utils/localFileManager.js';
import { ExecTool } from '../../../src/tools/execution/ExecTool.js';
import { SessionAuthManager } from '../../../src/auth/sessionManager.js';

const TEST_SCRIPT_ID = 'test-script-drift-detect-001';

describe('exec() drift detection', () => {
  let sandbox: SinonSandbox;

  beforeEach(() => {
    sandbox = createSandbox();
    process.env.MCP_TEST_MODE = 'true';
  });

  afterEach(() => {
    sandbox.restore();
    delete process.env.MCP_TEST_MODE;
  });

  // -- Bug 1: Extension fallback for SERVER_JS files --

  describe('Bug 1 -- SERVER_JS extension fallback (.js <=> .gs)', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp('/tmp/exec-drift-test-');
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('classifies a .js local file with different content as local_stale (not remote_only)', async () => {
      const remoteSource = 'function remote() { return "remote"; }';
      const localSource = 'function local() { return "local"; }';

      await writeFile(join(tmpDir, 'Utils.js'), localSource, 'utf-8');
      sandbox.stub(LocalFileManager, 'resolveProjectPath').returns(tmpDir);

      const { summary } = await checkSyncStatus(TEST_SCRIPT_ID, [
        { name: 'Utils', source: remoteSource, type: 'SERVER_JS' }
      ]);

      expect(summary.stale, 'stale count should be 1 -- not silently ignored').to.equal(1);
      expect(summary.remoteOnly, 'remoteOnly count should be 0 -- file was found via .js fallback').to.equal(0);
    });

    it('classifies a .js local file with identical content as in_sync', async () => {
      const source = 'function hello() { return "hello"; }';

      await writeFile(join(tmpDir, 'Utils.js'), source, 'utf-8');
      sandbox.stub(LocalFileManager, 'resolveProjectPath').returns(tmpDir);

      const { summary } = await checkSyncStatus(TEST_SCRIPT_ID, [
        { name: 'Utils', source, type: 'SERVER_JS' }
      ]);

      expect(summary.inSync, 'inSync count should be 1').to.equal(1);
      expect(summary.stale, 'stale count should be 0').to.equal(0);
      expect(summary.remoteOnly, 'remoteOnly count should be 0').to.equal(0);
    });

    it('falls through to remote_only when neither .gs nor .js exists locally', async () => {
      sandbox.stub(LocalFileManager, 'resolveProjectPath').returns(tmpDir);

      const { summary } = await checkSyncStatus(TEST_SCRIPT_ID, [
        { name: 'Utils', source: 'function remote() {}', type: 'SERVER_JS' }
      ]);

      expect(summary.remoteOnly, 'remoteOnly count should be 1 -- no local file exists').to.equal(1);
      expect(summary.stale, 'stale count should be 0').to.equal(0);
    });

    it('still detects a .gs local file as stale (primary extension path unaffected)', async () => {
      const remoteSource = 'function remote() {}';
      const localSource = 'function local() {}';

      await writeFile(join(tmpDir, 'Utils.gs'), localSource, 'utf-8');
      sandbox.stub(LocalFileManager, 'resolveProjectPath').returns(tmpDir);

      const { summary } = await checkSyncStatus(TEST_SCRIPT_ID, [
        { name: 'Utils', source: remoteSource, type: 'SERVER_JS' }
      ]);

      expect(summary.stale, 'stale count should be 1 -- .gs primary path still works').to.equal(1);
      expect(summary.remoteOnly, 'remoteOnly count should be 0').to.equal(0);
    });
  });

  // -- Bug 2: syncWarning when drift check bypassed due to no auth token --

  describe('Bug 2 -- syncWarning when drift check skipped (no auth token)', () => {
    it('includes syncWarning in exec() response when tryGetAuthToken returns null', async () => {
      const authManager = new SessionAuthManager();
      const tool = new ExecTool(authManager);

      sandbox.stub(tool as any, 'tryGetAuthToken').resolves(null);

      sandbox.stub(tool as any, 'executeOptimistic').resolves({
        status: 'success',
        result: 4,
        logger_output: '',
        executedAt: new Date().toISOString(),
        environment: 'dev',
        versionNumber: null,
        ide_url_hint: ''
      });

      const result = await tool.execute({
        scriptId: TEST_SCRIPT_ID,
        js_statement: '2 + 2',
        skipSyncCheck: false,
        autoRedeploy: false
      });

      expect(result, 'result should exist').to.exist;
      expect(result.syncWarning, 'syncWarning must be present when drift check was skipped').to.be.a('string');
      expect(result.syncWarning).to.include('no auth token');
    });

    it('does not include syncWarning when auth token is available and drift check runs', async () => {
      const authManager = new SessionAuthManager();
      const tool = new ExecTool(authManager);

      sandbox.stub(tool as any, 'tryGetAuthToken').resolves('fake-token-for-test');

      // Return HTML templates to prevent background deploy side effects
      sandbox.stub((tool as any).gasClient, 'getProjectContent').resolves([
        { name: 'common-js/__mcp_exec_success', source: '<html/>', type: 'HTML' },
        { name: 'common-js/__mcp_exec_error', source: '<html/>', type: 'HTML' }
      ]);

      sandbox.stub(tool as any, 'executeOptimistic').resolves({
        status: 'success',
        result: 4,
        logger_output: '',
        executedAt: new Date().toISOString(),
        environment: 'dev',
        versionNumber: null,
        ide_url_hint: ''
      });

      const result = await tool.execute({
        scriptId: TEST_SCRIPT_ID,
        js_statement: '2 + 2',
        skipSyncCheck: false,
        autoRedeploy: false
      });

      expect(result, 'result should exist').to.exist;
      expect(result.syncWarning, 'syncWarning must be absent when drift check ran').to.be.undefined;
    });
  });
});
