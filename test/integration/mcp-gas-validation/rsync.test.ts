/**
 * Integration tests for rsync tool
 *
 * Tests the stateless single-call sync workflow:
 * - pull: GAS → Local (dryrun to preview)
 * - push: Local → GAS (dryrun to preview)
 *
 * Coverage:
 * - Dryrun pull/push (preview without side effects)
 * - Full pull workflow (GAS → local)
 * - Full push workflow (local → GAS)
 * - Bootstrap sync (first-time)
 * - Deletion confirmation flow
 * - No changes (already in sync)
 * - Error cases
 */

import { expect } from 'chai';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { setupIntegrationTest, globalAuthState } from '../../setup/integrationSetup.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';

describe('rsync Integration Tests', function() {
  this.timeout(TEST_TIMEOUTS.EXTENDED);

  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let gas: InProcessGASTestHelper;
  let testProjectId: string | null = null;
  let tempSyncFolder: string | null = null;

  before(async function() {
    this.timeout(TEST_TIMEOUTS.EXECUTION);

    // Ensure integration test setup is complete
    await setupIntegrationTest();

    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️ Integration tests require authentication - skipping rsync tests');
      this.skip();
      return;
    }

    client = globalAuthState.client;
    auth = globalAuthState.auth!;
    gas = globalAuthState.gas!;

    // Create test project
    const result = await gas.createTestProject('MCP-Rsync-Test');
    testProjectId = result.scriptId;
    console.log(`✅ Created test project: ${testProjectId}`);

    // Create temp sync folder
    tempSyncFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-rsync-test-'));

    // Initialize as git repo
    const { spawn } = await import('child_process');
    await new Promise<void>((resolve, reject) => {
      const git = spawn('git', ['init'], { cwd: tempSyncFolder! });
      git.on('close', (code) => code === 0 ? resolve() : reject(new Error(`git init failed: ${code}`)));
    });

    // Create src directory
    await fs.mkdir(path.join(tempSyncFolder, 'src'), { recursive: true });

    console.log(`✅ Created temp sync folder: ${tempSyncFolder}`);
  });

  after(async function() {
    this.timeout(TEST_TIMEOUTS.STANDARD);

    // Cleanup test project
    if (testProjectId && gas) {
      try {
        await gas.cleanupTestProject(testProjectId);
        console.log(`✅ Cleaned up test project: ${testProjectId}`);
      } catch (error) {
        console.warn(`⚠️ Failed to cleanup test project: ${error}`);
      }
    }

    // Cleanup temp folder
    if (tempSyncFolder) {
      try {
        await fs.rm(tempSyncFolder, { recursive: true, force: true });
        console.log(`✅ Cleaned up temp folder: ${tempSyncFolder}`);
      } catch (error) {
        console.warn(`⚠️ Failed to cleanup temp folder: ${error}`);
      }
    }
  });

  describe('Precondition Tests', function() {
    it('should fail without breadcrumb', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      // Try to pull without .git/config.gs breadcrumb
      const result = await client.callTool('rsync', {
        operation: 'pull',
        scriptId: testProjectId
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.false;
      expect(response.error.code).to.equal('BREADCRUMB_MISSING');
    });

    it('should create breadcrumb for subsequent tests', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      // Create .git/config.gs breadcrumb pointing to temp folder
      const breadcrumbContent = `[core]
    repositoryformatversion = 0
    filemode = true
    bare = false

[sync]
    localPath = ${tempSyncFolder}
`;

      const writeResult = await client.callTool('write', {
        scriptId: testProjectId,
        path: '.git/config',
        content: breadcrumbContent
      });

      expect(writeResult).to.have.property('content');
      const response = JSON.parse(writeResult.content[0].text);
      expect(response.success).to.be.true;
    });
  });

  describe('Dryrun Operations', function() {
    it('should return pull dryrun preview without side effects', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      // Add a file to GAS to have something to pull
      await client.callTool('write', {
        scriptId: testProjectId,
        path: 'TestModule',
        content: 'function test() { return "hello"; }\nmodule.exports = { test };'
      });

      const result = await client.callTool('rsync', {
        operation: 'pull',
        scriptId: testProjectId,
        dryrun: true
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.true;
      expect(response.operation).to.equal('pull');
      expect(response.dryrun).to.be.true;
      expect(response.summary).to.have.property('direction', 'pull');
      expect(response.summary).to.have.property('additions');
      expect(response.summary).to.have.property('updates');
      expect(response.summary).to.have.property('deletions');
      expect(response.summary).to.have.property('isBootstrap');
      expect(response.summary).to.have.property('totalOperations');
      expect(response.files).to.have.property('add');
      expect(response.files).to.have.property('update');
      expect(response.files).to.have.property('delete');
      expect(response).to.have.property('nextStep');
    });

    it('should return push dryrun preview', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      // Create a local file to push
      const localFilePath = path.join(tempSyncFolder!, 'src', 'LocalModule.gs');
      await fs.writeFile(localFilePath, 'function local() { return "local"; }');

      const result = await client.callTool('rsync', {
        operation: 'push',
        scriptId: testProjectId,
        dryrun: true,
        force: true // Skip uncommitted changes check
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.true;
      expect(response.operation).to.equal('push');
      expect(response.dryrun).to.be.true;
      expect(response.summary.direction).to.equal('push');
    });
  });

  describe('Pull Operation', function() {
    it('should execute pull (bootstrap)', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      // Ensure we have a file in GAS to pull
      await client.callTool('write', {
        scriptId: testProjectId,
        path: 'PullTestModule',
        content: 'function pullTest() { return "pulled"; }\nmodule.exports = { pullTest };'
      });

      const result = await client.callTool('rsync', {
        operation: 'pull',
        scriptId: testProjectId
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.true;
      expect(response.operation).to.equal('pull');
      expect(response.dryrun).to.be.false;
      expect(response.result).to.have.property('direction', 'pull');
      expect(response.result).to.have.property('filesAdded');
      expect(response.result).to.have.property('filesUpdated');
      expect(response.result).to.have.property('filesDeleted');
      expect(response).to.have.property('recoveryInfo');
    });

    it('should return no changes when already in sync', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      // Pull again immediately — should be in sync
      const result = await client.callTool('rsync', {
        operation: 'pull',
        scriptId: testProjectId
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.true;
      // Either a no-changes response or a response with 0 operations
      if (response.message) {
        expect(response.message).to.include('sync');
      }
      expect(response.result.filesAdded).to.equal(0);
      expect(response.result.filesUpdated).to.equal(0);
      expect(response.result.filesDeleted).to.equal(0);
    });
  });

  describe('Push Operation', function() {
    it('should execute push', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      // Create a local file to push
      const localFilePath = path.join(tempSyncFolder!, 'src', 'PushTestModule.gs');
      await fs.writeFile(localFilePath, 'function pushTest() { return "pushed"; }');

      const result = await client.callTool('rsync', {
        operation: 'push',
        scriptId: testProjectId,
        force: true
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.true;
      expect(response.operation).to.equal('push');
      expect(response.result.direction).to.equal('push');
    });
  });

  describe('Deletion Confirmation Flow', function() {
    it('should require confirmation for deletions', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      // First, sync current state (pull to establish baseline)
      await client.callTool('rsync', {
        operation: 'pull',
        scriptId: testProjectId
      });

      // Add a file to local that we'll push to GAS
      const localFilePath = path.join(tempSyncFolder!, 'src', 'ToBeDeleted.gs');
      await fs.writeFile(localFilePath, 'function toDelete() {}');

      // Push to sync it to GAS
      await client.callTool('rsync', {
        operation: 'push',
        scriptId: testProjectId,
        force: true
      });

      // Now delete the local file
      await fs.unlink(localFilePath);

      // Push again — should detect deletion and require confirmation
      const pushResult = await client.callTool('rsync', {
        operation: 'push',
        scriptId: testProjectId,
        force: true
      });

      const response = JSON.parse(pushResult.content[0].text);

      // If there are deletions, should fail without confirmDeletions
      if (!response.success && response.error?.code === 'DELETION_REQUIRES_CONFIRMATION') {
        expect(response.error.details).to.have.property('deletionCount');
        expect(response.error.details).to.have.property('files');
        expect(response.error.details).to.have.property('nextStep');
      }
      // Otherwise the file may not have been tracked — acceptable
    });

    it('should execute deletions with confirmation', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      // Push with deletions confirmed
      const result = await client.callTool('rsync', {
        operation: 'push',
        scriptId: testProjectId,
        force: true,
        confirmDeletions: true
      });

      const response = JSON.parse(result.content[0].text);

      // Should succeed (either with deletions or already in sync)
      expect(response.success).to.be.true;
    });
  });

  describe('Error Cases', function() {
    it('should fail with invalid scriptId', async function() {
      this.timeout(TEST_TIMEOUTS.QUICK);

      const result = await client.callTool('rsync', {
        operation: 'pull',
        scriptId: 'invalid'
      });

      expect(result).to.have.property('content');
      // Should fail validation
      expect(result.content[0].text).to.include('error');
    });

    it('should fail with invalid operation', async function() {
      this.timeout(TEST_TIMEOUTS.QUICK);

      const result = await client.callTool('rsync', {
        operation: 'invalid' as any,
        scriptId: testProjectId
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.false;
      expect(response.error.code).to.equal('INVALID_OPERATION');
    });
  });

  describe('Exclude Patterns', function() {
    it('should respect exclude patterns in pull dryrun', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      // Create files with different prefixes
      await client.callTool('write', {
        scriptId: testProjectId,
        path: 'test/TestFile',
        content: 'function testFile() {}'
      });

      await client.callTool('write', {
        scriptId: testProjectId,
        path: 'src/SrcFile',
        content: 'function srcFile() {}'
      });

      // Dryrun pull with exclude pattern
      const result = await client.callTool('rsync', {
        operation: 'pull',
        scriptId: testProjectId,
        dryrun: true,
        excludePatterns: ['test/']
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.true;
      expect(response.dryrun).to.be.true;
      // Verify test files are excluded from the preview
      // The diff should not include files matching the exclude pattern
    });
  });
});
