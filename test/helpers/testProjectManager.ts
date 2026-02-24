/**
 * TestProjectManager
 *
 * Manages a single, reusable GAS test project that persists across test runs.
 * Eliminates ~25 project creations per run (~125-300s overhead).
 *
 * Storage: test/.test-project-id file (gitignored)
 * Fallback: MCP_TEST_SCRIPT_ID env var
 *
 * Infrastructure baseline (files preserved during resetToBaseline):
 * - appsscript (manifest)
 * - common-js/require (CommonJS module system)
 * - common-js/__mcp_exec (execution shim)
 * - common-js/__mcp_exec_success (HTML)
 * - common-js/__mcp_exec_error (HTML)
 * - common-js/ConfigManager (hierarchical config)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { InProcessGASTestHelper, InProcessTestClient } from './inProcessClient.js';
import { globalAuthState } from '../setup/globalAuth.js';

const PROJECT_ID_FILE = path.join(process.cwd(), 'test', '.test-project-id');
const SCRIPT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

/** Infrastructure file names preserved during resetToBaseline */
const INFRASTRUCTURE_FILES = new Set([
  'appsscript',
  'common-js/require',
  'common-js/__mcp_exec',
  'common-js/__mcp_exec_success',
  'common-js/__mcp_exec_error',
  'common-js/ConfigManager',
]);

export class TestProjectManager {
  private static instance: TestProjectManager;
  private scriptId: string | null = null;
  private ready = false;

  private constructor() {}

  static getInstance(): TestProjectManager {
    if (!TestProjectManager.instance) {
      TestProjectManager.instance = new TestProjectManager();
    }
    return TestProjectManager.instance;
  }

  /**
   * Initialize the shared test project. Returns the scriptId.
   *
   * Resolution order:
   * 1. MCP_TEST_SCRIPT_ID env var
   * 2. test/.test-project-id file
   * 3. Create new project, store ID
   */
  async initialize(gas: InProcessGASTestHelper, client: InProcessTestClient): Promise<string> {
    // 1. Check env var
    const envScriptId = process.env.MCP_TEST_SCRIPT_ID;
    if (envScriptId) {
      console.log(`✅ TestProjectManager: Using MCP_TEST_SCRIPT_ID: ${envScriptId}`);
      this.scriptId = envScriptId;
      this.ready = true;
      return envScriptId;
    }

    // 2. Check file
    const fileScriptId = await this._readIdFile();
    if (fileScriptId) {
      console.log(`🔍 TestProjectManager: Found stored project ID: ${fileScriptId}`);
      const healthy = await this.verifyHealth(gas);
      if (healthy) {
        console.log(`✅ TestProjectManager: Project is healthy, reusing: ${fileScriptId}`);
        this.ready = true;
        return fileScriptId;
      }
      console.warn(`⚠️  TestProjectManager: Project ${fileScriptId} failed health check — creating new project`);
      await this._clearIdFile();
      this.scriptId = null;
    }

    // 3. Create new project
    return await this._createAndStore(gas);
  }

  /**
   * Verify the test project is reachable and executes code correctly.
   */
  async verifyHealth(gas: InProcessGASTestHelper): Promise<boolean> {
    if (!this.scriptId) return false;
    try {
      const result = await gas.runFunction(this.scriptId, '1+1', true);
      return result?.status === 'success';
    } catch {
      return false;
    }
  }

  /**
   * Reset project to infrastructure-only state.
   *
   * Deletes all non-infrastructure files and clears script properties.
   * If the project is missing (404), clears the stored ID and throws so the
   * caller can re-initialize.
   */
  async resetToBaseline(client: InProcessTestClient): Promise<void> {
    if (!this.scriptId) throw new Error('TestProjectManager: not initialized');

    const accessToken = await client.getAccessToken();
    const gasClient = client.gasClient;

    let allFiles: any[];
    try {
      allFiles = await gasClient.getProjectContent(this.scriptId, accessToken);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (/404|not.?found/i.test(msg)) {
        const lostId = this.scriptId;
        console.warn('⚠️  TestProjectManager: Project not found — clearing stored ID');
        await this._clearIdFile();
        this.scriptId = null;
        this.ready = false;
        throw new Error(`TestProjectManager: project ${lostId} not found (404) — re-initialize`);
      }
      throw err;
    }

    // Keep only infrastructure files
    const infraFiles = allFiles.filter(f => INFRASTRUCTURE_FILES.has(f.name));

    if (infraFiles.length === 0) {
      console.warn('⚠️  TestProjectManager: No infrastructure files found — project may need re-creation');
    }

    console.log(`🔄 TestProjectManager: Resetting to baseline (keeping ${infraFiles.length} infra files, removing ${allFiles.length - infraFiles.length} test files)`);
    await gasClient.updateProjectContent(this.scriptId, infraFiles, accessToken);

    // Clear script properties
    try {
      const gas = globalAuthState.gas;
      if (gas) {
        await gas.runFunction(
          this.scriptId,
          "PropertiesService.getScriptProperties().deleteAllProperties()",
          true
        );
      }
    } catch (err) {
      console.warn('⚠️  TestProjectManager: Failed to clear script properties:', err);
    }

    console.log(`✅ TestProjectManager: Reset complete for ${this.scriptId}`);
  }

  getScriptId(): string {
    if (!this.scriptId) throw new Error('TestProjectManager: not initialized — call initialize() first');
    return this.scriptId;
  }

  isReady(): boolean {
    return this.ready && !!this.scriptId;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _readIdFile(): Promise<string | null> {
    try {
      const raw = (await fs.readFile(PROJECT_ID_FILE, 'utf8')).trim();
      if (SCRIPT_ID_REGEX.test(raw)) {
        this.scriptId = raw;
        return raw;
      }
      console.warn(`⚠️  TestProjectManager: Stored ID "${raw}" failed format validation`);
      return null;
    } catch {
      return null;
    }
  }

  private async _writeIdFile(scriptId: string): Promise<void> {
    await fs.mkdir(path.dirname(PROJECT_ID_FILE), { recursive: true });
    await fs.writeFile(PROJECT_ID_FILE, scriptId, 'utf8');
  }

  private async _clearIdFile(): Promise<void> {
    try {
      await fs.unlink(PROJECT_ID_FILE);
    } catch {
      // File may not exist
    }
  }

  private async _createAndStore(gas: InProcessGASTestHelper): Promise<string> {
    console.log('🚀 TestProjectManager: Creating new shared test project...');
    const project = await gas.createTestProject('MCP-Shared-Test');
    const scriptId: string = project.scriptId;

    // Probe with retries — newly created deployments need propagation time
    const probeDelays = [5000, 8000, 12000];
    let probeSuccess = false;
    for (let i = 0; i < probeDelays.length; i++) {
      console.log(`⏳ TestProjectManager: Waiting ${probeDelays[i] / 1000}s for deployment propagation (attempt ${i + 1}/${probeDelays.length})...`);
      await new Promise(r => setTimeout(r, probeDelays[i]));
      try {
        const probe = await gas.runFunction(scriptId, '1+1', true);
        if (probe?.status === 'success') {
          probeSuccess = true;
          break;
        }
      } catch (err: any) {
        console.warn(`⚠️  TestProjectManager: Probe attempt ${i + 1} failed: ${err.message}`);
      }
    }

    if (!probeSuccess) {
      throw new Error('TestProjectManager: New project failed health probe after 3 attempts');
    }

    this.scriptId = scriptId;
    this.ready = true;
    await this._writeIdFile(scriptId);
    console.log(`✅ TestProjectManager: Created and stored project: ${scriptId}`);
    return scriptId;
  }
}

/** Infrastructure file names — exported for testing */
export { INFRASTRUCTURE_FILES };
