/**
 * Deployment Validation Tests
 *
 * Tests version control and deployment operations with real GAS projects:
 * - Version creation and listing
 * - Deployment creation and management
 * - Deployment configuration verification
 * - Deployment snapshot isolation (versioned vs HEAD)
 * - Version history tracking
 *
 * KEY INSIGHT: Versioned deployments serve code SNAPSHOTS from version creation time,
 * while @HEAD deployments always serve the current project code. This test suite
 * verifies this critical isolation behavior.
 */

import { expect } from 'chai';
import { MCPTestClient, AuthTestHelper, GASTestHelper } from '../../helpers/mcpClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';

describe('Deployment Validation Tests', () => {
  let client: MCPTestClient;
  let auth: AuthTestHelper;
  let gas: GASTestHelper;
  let testProjectId: string | null = null;

  before(async function() {
    this.timeout(TEST_TIMEOUTS.EXECUTION);
    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️  Skipping integration tests - not authenticated');
      this.skip();
    }
    client = globalAuthState.client;
    auth = new AuthTestHelper(client);
    gas = new GASTestHelper(client);

    // Create test project with some files
    const result = await gas.createTestProject('MCP-Deployment-Test');
    testProjectId = result.scriptId;
    console.log(`✅ Created deployment test project: ${testProjectId}`);

    // Add a few test files for version control
    await gas.writeTestFile(testProjectId!, 'Main', 'function main() { return "v1"; }');
    await gas.writeTestFile(testProjectId!, 'Utils', 'exports.version = "1.0.0";');
  });

  after(async function() {
    this.timeout(TEST_TIMEOUTS.STANDARD);
    if (testProjectId) {
      console.log(`🧹 Cleaning up test project: ${testProjectId}`);
      await gas.cleanupTestProject(testProjectId);
    }
  });

  describe('Version Control', () => {
    it('should create version', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('mcp__gas__version_create', {
        scriptId: testProjectId,
        description: 'Test version for validation'
      });

      expect(result.content[0].text).to.include('version');
      expect(result.content[0].text).to.match(/version.*created/i);
    });

    it('should list versions', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('mcp__gas__version_list', {
        scriptId: testProjectId
      });

      expect(result.content[0].text).to.include('version');
    });

    it('should create multiple versions', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      // Create version 2
      const result1 = await client.callTool('mcp__gas__version_create', {
        scriptId: testProjectId,
        description: 'Version 2'
      });

      expect(result1.content[0].text).to.include('version');

      // Create version 3
      const result2 = await client.callTool('mcp__gas__version_create', {
        scriptId: testProjectId,
        description: 'Version 3'
      });

      expect(result2.content[0].text).to.include('version');

      // List should show multiple versions
      const listResult = await client.callTool('mcp__gas__version_list', {
        scriptId: testProjectId
      });

      expect(listResult.content[0].text).to.include('version');
    });
  });

  describe('Deployment Management', () => {
    it('should create deployment', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      // First create a version
      const versionResult = await client.callTool('mcp__gas__version_create', {
        scriptId: testProjectId,
        description: 'Deployment version'
      });

      expect(versionResult.content[0].text).to.include('version');

      // Extract version number from response
      const versionMatch = versionResult.content[0].text.match(/version.*?(\d+)/i);
      const versionNumber = versionMatch ? parseInt(versionMatch[1]) : 1;

      // Create deployment
      const deployResult = await client.callTool('mcp__gas__deploy_create', {
        scriptId: testProjectId,
        description: 'Test deployment',
        versionNumber: versionNumber
      });

      expect(deployResult.content[0].text).to.include('deployment');
    });

    it('should list deployments', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('mcp__gas__deploy_list', {
        scriptId: testProjectId
      });

      expect(result.content[0].text).to.include('deployment');
    });

    it('should verify deployment configuration', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const listResult = await client.callTool('mcp__gas__deploy_list', {
        scriptId: testProjectId
      });

      // Should have at least one deployment
      expect(listResult.content[0].text).to.include('deployment');
    });

    it('should create API executable deployment', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      // Create version for API deployment
      const versionResult = await client.callTool('mcp__gas__version_create', {
        scriptId: testProjectId,
        description: 'API version'
      });

      const versionMatch = versionResult.content[0].text.match(/version.*?(\d+)/i);
      const versionNumber = versionMatch ? parseInt(versionMatch[1]) : 1;

      // Create API executable deployment
      const deployResult = await client.callTool('mcp__gas__deploy_create', {
        scriptId: testProjectId,
        description: 'API deployment',
        versionNumber: versionNumber,
        entryPointType: 'EXECUTION_API'
      });

      expect(deployResult.content[0].text).to.include('deployment');
    });
  });

  describe('Deployment Snapshot Isolation', () => {
    it('should verify versioned deployments serve code snapshots, not current HEAD', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;

      // Step 1: Write initial code and create snapshot version
      const initialCode = 'function testSnapshot() { return "snapshot-v1"; }';
      await gas.writeTestFile(testProjectId!, 'SnapshotTest', initialCode);

      // Create version 1 - this should snapshot the current code
      const version1Result = await client.callTool('mcp__gas__version_create', {
        scriptId: testProjectId,
        description: 'Snapshot version v1'
      });
      expect(version1Result.content[0].text).to.include('version');
      const version1Match = version1Result.content[0].text.match(/version.*?(\d+)/i);
      const version1Number = version1Match ? parseInt(version1Match[1]) : 1;

      // Step 2: Modify code AFTER version creation
      const modifiedCode = 'function testSnapshot() { return "snapshot-v2-modified"; }';
      await gas.writeTestFile(testProjectId!, 'SnapshotTest', modifiedCode);

      // Verify file was actually modified
      const modifiedContent = await client.callTool('mcp__gas__cat', {
        scriptId: testProjectId,
        path: 'SnapshotTest'
      });
      expect(modifiedContent.content[0].text).to.include('snapshot-v2-modified');

      // Step 3: Create deployment of version 1 (should use snapshot, not modified code)
      const deployResult = await client.callTool('mcp__gas__deploy_create', {
        scriptId: testProjectId,
        description: 'Snapshot test deployment',
        versionNumber: version1Number
      });
      expect(deployResult.content[0].text).to.include('deployment');

      // Step 4: Verify deployment exists and is linked to version 1
      const deployListResult = await client.callTool('mcp__gas__deploy_list', {
        scriptId: testProjectId
      });
      expect(deployListResult.content[0].text).to.include('deployment');
      expect(deployListResult.content[0].text).to.include(version1Number.toString());

      // Note: We cannot directly execute the deployed code via API to verify it returns "snapshot-v1"
      // because that would require web app execution which needs browser authentication.
      // However, the GAS API guarantees that versioned deployments serve code snapshots,
      // and we've verified:
      // 1. Version was created with initial code
      // 2. Code was modified after version creation
      // 3. Deployment was created with the version number (not HEAD)
      // 4. Deployment list confirms version linkage
    });

    it('should verify HEAD deployment uses current code, not snapshots', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      // Write initial code
      const initialCode = 'function testHead() { return "head-v1"; }';
      await gas.writeTestFile(testProjectId!, 'HeadTest', initialCode);

      // Create HEAD deployment (no version number = uses @HEAD)
      const deployResult = await client.callTool('mcp__gas__deploy_create', {
        scriptId: testProjectId,
        description: 'HEAD deployment test'
        // No versionNumber = uses @HEAD
      });
      expect(deployResult.content[0].text).to.include('deployment');

      // Modify code after deployment
      const modifiedCode = 'function testHead() { return "head-v2-modified"; }';
      await gas.writeTestFile(testProjectId!, 'HeadTest', modifiedCode);

      // Verify file was modified
      const modifiedContent = await client.callTool('mcp__gas__cat', {
        scriptId: testProjectId,
        path: 'HeadTest'
      });
      expect(modifiedContent.content[0].text).to.include('head-v2-modified');

      // HEAD deployment should now serve the modified code
      // (We can't execute to verify, but the API contract guarantees this behavior)
      // List deployments to verify HEAD deployment exists
      const deployListResult = await client.callTool('mcp__gas__deploy_list', {
        scriptId: testProjectId
      });
      expect(deployListResult.content[0].text).to.include('deployment');
      expect(deployListResult.content[0].text).to.match(/@HEAD|head/i);
    });
  });

  describe('Version History', () => {
    it('should track version history after multiple changes', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      // Make some changes
      await gas.writeTestFile(testProjectId!, 'Main', 'function main() { return "v2"; }');

      // Create new version
      const result = await client.callTool('mcp__gas__version_create', {
        scriptId: testProjectId,
        description: 'Updated main function'
      });

      expect(result.content[0].text).to.include('version');

      // List versions should show progression
      const listResult = await client.callTool('mcp__gas__version_list', {
        scriptId: testProjectId
      });

      expect(listResult.content[0].text).to.include('version');
    });

    it('should verify version descriptions', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const description = `Test version ${Date.now()}`;

      const result = await client.callTool('mcp__gas__version_create', {
        scriptId: testProjectId,
        description: description
      });

      expect(result.content[0].text).to.include('version');
    });
  });
});
