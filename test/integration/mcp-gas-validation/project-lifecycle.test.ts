/**
 * Project Lifecycle Validation Tests
 *
 * Tests project management operations with real GAS projects:
 * - Project creation and initialization
 * - Project information retrieval
 * - Project listing and discovery
 * - Project deletion and cleanup
 */

import { expect } from 'chai';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';

describe('Project Lifecycle Validation Tests', () => {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let gas: InProcessGASTestHelper;
  let testProjectId: string | null = null;

  before(async function() {
    this.timeout(TEST_TIMEOUTS.STANDARD);
    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️  Skipping integration tests - not authenticated');
      this.skip();
    }
    client = globalAuthState.client;
    auth = globalAuthState.auth!;  // Reuse global auth with sessionId
    gas = globalAuthState.gas!;
  });

  after(async function() {
    this.timeout(TEST_TIMEOUTS.STANDARD);
    if (testProjectId) {
      console.log(`🧹 Cleaning up test project: ${testProjectId}`);
      await gas.cleanupTestProject(testProjectId);
    }
  });

  describe('Authentication Validation', () => {
    it('should verify auth status before tests', async function() {
      this.timeout(TEST_TIMEOUTS.QUICK);
      const isAuth = await auth.isAuthenticated();
      expect(isAuth).to.be.true;
    });

    it('should confirm session persistence', async function() {
      this.timeout(TEST_TIMEOUTS.QUICK);
      const status = await auth.getAuthStatus();
      expect(status).to.have.property('authenticated', true);
    });
  });

  describe('Project Creation', () => {
    it('should create empty test project', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      const result = await gas.createTestProject('MCP-Lifecycle-Test');

      expect(result).to.have.property('scriptId');
      expect(result.scriptId).to.be.a('string');
      expect(result.scriptId).to.have.lengthOf(44);

      testProjectId = result.scriptId;
      console.log(`✅ Created test project: ${testProjectId}`);
    });

    it('should verify project exists via ls', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('ls', {
        scriptId: testProjectId
      });

      expect(result.content[0].text).to.include(testProjectId!);
      expect(result.content[0].text).to.include('MCP-Lifecycle-Test');
    });

    it('should list projects and find our test project', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await gas.listProjects();

      // Result should be a list of projects
      expect(result).to.be.a('string');
      expect(result).to.include(testProjectId!);
    });
  });

  describe('Project Information', () => {
    it('should validate project info completeness', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('ls', {
        scriptId: testProjectId
      });

      const info = result.content[0].text;

      // Should include key project information
      expect(info).to.include(testProjectId!);
      expect(info).to.include('MCP-Lifecycle-Test');
      expect(info).to.match(/file|script|project/i);
    });
  });
});
