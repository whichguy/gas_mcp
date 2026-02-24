/**
 * Unit tests for TestProjectManager
 *
 * Tests non-trivial logic with mocked dependencies:
 * - Singleton behavior
 * - initialize() env var resolution path
 * - Infrastructure file filtering in resetToBaseline()
 * - getScriptId() / isReady() state behavior
 *
 * Note: fs/promises is an ES Module and cannot be stubbed with sinon.
 * File-path resolution is tested via the env var path (no fs I/O).
 * resetToBaseline() is tested with a mock client that controls the gasClient.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { stub, restore } from 'sinon';

import { TestProjectManager, INFRASTRUCTURE_FILES } from '../../helpers/testProjectManager.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGasMock(runResult: any = { status: 'success', result: 2 }) {
  return {
    runFunction: stub().resolves(runResult),
    createTestProject: stub().resolves({ scriptId: 'new-project-id-123' }),
  } as any;
}

function makeClientMock(files: any[] = []) {
  return {
    getAccessToken: stub().resolves('fake-token'),
    gasClient: {
      getProjectContent: stub().resolves(files),
      updateProjectContent: stub().resolves({}),
    },
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TestProjectManager', () => {
  beforeEach(() => {
    // Reset singleton between tests by clearing the private instance
    (TestProjectManager as any).instance = undefined;
    delete process.env.MCP_TEST_SCRIPT_ID;
  });

  afterEach(() => {
    restore();
    delete process.env.MCP_TEST_SCRIPT_ID;
  });

  // ── Singleton ──────────────────────────────────────────────────────────────

  describe('getInstance()', () => {
    it('should return the same instance on repeated calls', () => {
      const a = TestProjectManager.getInstance();
      const b = TestProjectManager.getInstance();
      expect(a).to.equal(b);
    });

    it('should return a new instance after reset', () => {
      const a = TestProjectManager.getInstance();
      (TestProjectManager as any).instance = undefined;
      const b = TestProjectManager.getInstance();
      expect(a).to.not.equal(b);
    });
  });

  // ── initialize() via env var ───────────────────────────────────────────────

  describe('initialize() — env var path', () => {
    it('should use MCP_TEST_SCRIPT_ID env var when set', async () => {
      process.env.MCP_TEST_SCRIPT_ID = 'env-project-id-abc123';
      const mgr = TestProjectManager.getInstance();
      const gas = makeGasMock();
      const client = makeClientMock();

      const scriptId = await mgr.initialize(gas, client);

      expect(scriptId).to.equal('env-project-id-abc123');
      expect(mgr.getScriptId()).to.equal('env-project-id-abc123');
      expect(mgr.isReady()).to.be.true;
      // Should not create a project or run health check
      expect(gas.createTestProject.called).to.be.false;
      expect(gas.runFunction.called).to.be.false;
    });

    it('should not call createTestProject when env var is set', async () => {
      process.env.MCP_TEST_SCRIPT_ID = 'env-project-only';
      const mgr = TestProjectManager.getInstance();
      const gas = makeGasMock();
      const client = makeClientMock();

      await mgr.initialize(gas, client);

      expect(gas.createTestProject.callCount).to.equal(0);
    });
  });

  // ── getScriptId() / isReady() ─────────────────────────────────────────────

  describe('getScriptId() and isReady()', () => {
    it('should throw when not initialized', () => {
      const mgr = TestProjectManager.getInstance();
      expect(() => mgr.getScriptId()).to.throw('not initialized');
    });

    it('should return false for isReady() when not initialized', () => {
      const mgr = TestProjectManager.getInstance();
      expect(mgr.isReady()).to.be.false;
    });

    it('should be ready after env var initialization', async () => {
      process.env.MCP_TEST_SCRIPT_ID = 'ready-test-id';
      const mgr = TestProjectManager.getInstance();
      const gas = makeGasMock();
      const client = makeClientMock();

      expect(mgr.isReady()).to.be.false;
      await mgr.initialize(gas, client);
      expect(mgr.isReady()).to.be.true;
    });
  });

  // ── resetToBaseline() ─────────────────────────────────────────────────────

  describe('resetToBaseline()', () => {
    it('should throw if not initialized', async () => {
      const mgr = TestProjectManager.getInstance();
      const client = makeClientMock();

      try {
        await mgr.resetToBaseline(client);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('not initialized');
      }
    });

    it('should keep only infrastructure files', async () => {
      process.env.MCP_TEST_SCRIPT_ID = 'my-script-id-123';
      const mgr = TestProjectManager.getInstance();
      const gas = makeGasMock();

      const infraFile = { name: 'common-js/require', type: 'SERVER_JS', source: '// require' };
      const testFile1 = { name: 'MyTestModule', type: 'SERVER_JS', source: '// test' };
      const testFile2 = { name: 'SearchTarget1', type: 'SERVER_JS', source: '// search' };
      const allFiles = [infraFile, testFile1, testFile2];

      const client = makeClientMock(allFiles);
      await mgr.initialize(gas, client);

      // Reset globalAuthState.gas stub for the properties reset call
      const originalGas = (await import('../../setup/globalAuth.js')).globalAuthState.gas;

      await mgr.resetToBaseline(client);

      const updateCall = client.gasClient.updateProjectContent;
      expect(updateCall.called).to.be.true;
      const keptFiles: any[] = updateCall.firstCall.args[1];
      expect(keptFiles).to.deep.equal([infraFile]);
      expect(keptFiles.find((f: any) => f.name === 'MyTestModule')).to.be.undefined;
      expect(keptFiles.find((f: any) => f.name === 'SearchTarget1')).to.be.undefined;
    });

    it('should pass correct scriptId to updateProjectContent', async () => {
      process.env.MCP_TEST_SCRIPT_ID = 'specific-script-id';
      const mgr = TestProjectManager.getInstance();
      const gas = makeGasMock();

      const client = makeClientMock([
        { name: 'common-js/require', type: 'SERVER_JS', source: '' },
      ]);
      await mgr.initialize(gas, client);
      await mgr.resetToBaseline(client);

      const updateCall = client.gasClient.updateProjectContent;
      expect(updateCall.firstCall.args[0]).to.equal('specific-script-id');
    });
  });

  // ── INFRASTRUCTURE_FILES constant ─────────────────────────────────────────

  describe('INFRASTRUCTURE_FILES', () => {
    it('should contain all expected baseline files', () => {
      expect(INFRASTRUCTURE_FILES.has('appsscript')).to.be.true;
      expect(INFRASTRUCTURE_FILES.has('common-js/require')).to.be.true;
      expect(INFRASTRUCTURE_FILES.has('common-js/__mcp_exec')).to.be.true;
      expect(INFRASTRUCTURE_FILES.has('common-js/__mcp_exec_success')).to.be.true;
      expect(INFRASTRUCTURE_FILES.has('common-js/__mcp_exec_error')).to.be.true;
      expect(INFRASTRUCTURE_FILES.has('common-js/ConfigManager')).to.be.true;
    });

    it('should have exactly 6 infrastructure files', () => {
      expect(INFRASTRUCTURE_FILES.size).to.equal(6);
    });

    it('should not contain test file names', () => {
      expect(INFRASTRUCTURE_FILES.has('MyTestModule')).to.be.false;
      expect(INFRASTRUCTURE_FILES.has('SearchTarget1')).to.be.false;
      expect(INFRASTRUCTURE_FILES.has('Main')).to.be.false;
    });
  });
});
