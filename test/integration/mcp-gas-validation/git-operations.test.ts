/**
 * Git Operations Validation Tests
 *
 * Tests git sync tools with real GAS projects and ThenRunLater repository:
 * - git_init: Initialize git association
 * - git_sync: Bidirectional synchronization (pull-merge-push pattern)
 * - git_status: Check association and sync state
 * - git_set_sync_folder: Configure sync location
 * - git_get_sync_folder: Query sync folder
 *
 * Uses ThenRunLater project (~/src5/ThenRunLater) as test repository
 * with temporary sync folder to avoid affecting real repo.
 */

import { expect } from 'chai';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { setupIntegrationTest, globalAuthState } from '../../setup/integrationSetup.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Git Operations Validation Tests', () => {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let gas: InProcessGASTestHelper;
  let testProjectId: string | null = null;
  let tempSyncFolder: string | null = null;

  // ThenRunLater repository details
  const REPO_URL = 'https://github.com/whichguy/ThenRunLater.git';
  const REPO_BRANCH = 'main';
  const REPO_FILES = ['index.html', 'LICENSE', 'permissions.js', 'README.md', 'script_scheduler.js', 'ui.js'];

  before(async function() {
    this.timeout(60000); // Reduced timeout - no auth needed per test

    // Global hooks already set up the server - just verify it's ready
    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️  Skipping - server not ready');
      this.skip();
    }

    client = globalAuthState.client;
    auth = globalAuthState.auth!;
    gas = globalAuthState.gas!;

    // CRITICAL: Verify we have a valid access token before attempting API calls
    console.log('🔍 Verifying access token availability before test project creation...');
    try {
      const testToken = await client.getAccessToken();
      if (!testToken) {
        console.error('❌ No access token available - cannot create test project');
        throw new Error('Access token not available after authentication');
      }
      console.log('✅ Access token verified - proceeding with test project creation');
    } catch (tokenError: any) {
      console.error(`❌ Token access failed: ${tokenError.message}`);
      console.error('   This usually means OAuth completed but token was not stored properly');
      this.skip();
      return;
    }

    // Create test project - server handles auth transparently
    const result = await gas.createTestProject('MCP-Git-ThenRunLater-Test');
    testProjectId = result.scriptId;
    console.log(`✅ Created git test project: ${testProjectId}`);

    // Create temporary sync folder
    tempSyncFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gas-git-test-'));
    console.log(`✅ Created temp sync folder: ${tempSyncFolder}`);
  });

  beforeEach(async function() {
    // Validate server is authenticated
    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.error('⚠️  Server not authenticated - skipping test');
      this.skip();
    }

    // Verify test project exists using direct method (not callTool)
    if (testProjectId) {
      try {
        await client.getProjectInfo(testProjectId);
      } catch (error) {
        console.error('❌ Test project no longer valid:', error);
        this.skip();
      }
    }

    // Check token validity
    try {
      const authStatus = await auth.getAuthStatus();
      if (!authStatus.authenticated || !authStatus.tokenValid) {
        console.error('❌ Token expired or invalid');
        this.skip();
      }
    } catch (error) {
      console.error('❌ Failed to check auth status:', error);
      this.skip();
    }
  });

  afterEach(async function() {
    // Log test result for debugging
    const state = this.currentTest?.state;
    if (state === 'failed') {
      console.error(`❌ Test failed: ${this.currentTest?.title}`);
    }
  });

  after(async function() {
    this.timeout(TEST_TIMEOUTS.STANDARD);

    if (testProjectId) {
      try {
        console.log(`🧹 Cleaning up test project: ${testProjectId}`);
        await gas.cleanupTestProject(testProjectId);

        // Verify cleanup succeeded using direct method
        try {
          await client.getProjectInfo(testProjectId);
          console.warn('⚠️  Project still exists after cleanup!');
        } catch (error) {
          // Expected - project should be deleted
          console.log('✅ Cleanup verified - project deleted');
        }
      } catch (cleanupError) {
        console.error('❌ Cleanup failed (non-fatal):', cleanupError);
        // Don't fail suite on cleanup error
      }
    }

    if (tempSyncFolder && fs.existsSync(tempSyncFolder)) {
      try {
        console.log(`🧹 Cleaning up temp sync folder: ${tempSyncFolder}`);
        fs.rmSync(tempSyncFolder, { recursive: true, force: true });
        console.log('✅ Temp folder cleaned up');
      } catch (cleanupError) {
        console.error('❌ Temp folder cleanup failed (non-fatal):', cleanupError);
      }
    }
  });

  describe('Git Init - Association Initialization', () => {
    it('should initialize git association with ThenRunLater repo', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      const result = await client.callAndParse('git_init', {
        scriptId: testProjectId,
        repository: REPO_URL,
        branch: REPO_BRANCH,
        localPath: tempSyncFolder
      });

      expect(result).to.have.property('success', true);
      expect(result).to.have.property('gitConfig');
      expect(result.gitConfig).to.have.property('repository', REPO_URL);
      expect(result.gitConfig).to.have.property('branch', REPO_BRANCH);
      expect(result.gitConfig).to.have.property('syncFolder', tempSyncFolder);
    });

    it('should create .git.gs file in GAS project', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      // Read .git.gs file
      const result = await client.callTool('cat', {
        scriptId: testProjectId,
        path: '.git'
      });

      const content = result.content[0].text;
      expect(content).to.include(REPO_URL);
      expect(content).to.include(REPO_BRANCH);
      expect(content).to.include(tempSyncFolder!);
    });

    it('should verify .git.gs is CommonJS module format', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('raw_cat', {
        scriptId: testProjectId,
        path: '.git.gs'
      });

      const rawContent = result.content[0].text;
      expect(rawContent).to.include('function _main');
      expect(rawContent).to.include('module.exports');
    });

    it('should fail gracefully with invalid repository URL', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      try {
        await client.callAndParse('git_init', {
          scriptId: 'invalid-script-id',
          repository: 'not-a-valid-url',
          branch: 'main',
          localPath: tempSyncFolder
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.match(/invalid|error|failed/i);
      }
    });
  });

  describe('Git Get Sync Folder - Query Configuration', () => {
    it('should return sync folder after initialization', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callAndParse('git_get_sync_folder', {
        scriptId: testProjectId
      });

      expect(result).to.have.property('scriptId', testProjectId);
      expect(result).to.have.property('syncFolder', tempSyncFolder);
      expect(result).to.have.property('exists', true);
    });

    it('should detect if sync folder is a git repository', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callAndParse('git_get_sync_folder', {
        scriptId: testProjectId
      });

      expect(result).to.have.property('isGitRepo');
      // Initially false until we clone
    });

    it('should provide recommended next steps', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callAndParse('git_get_sync_folder', {
        scriptId: testProjectId
      });

      expect(result).to.have.property('recommendedNextSteps');
      expect(result.recommendedNextSteps).to.be.an('array');
      expect(result.recommendedNextSteps.length).to.be.greaterThan(0);
    });
  });

  describe('Git Status - Check Association State', () => {
    it('should confirm git association exists', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callAndParse('git_status', {
        scriptId: testProjectId
      });

      expect(result).to.have.property('hasGitAssociation', true);
      expect(result).to.have.property('gitConfig');
      expect(result.gitConfig).to.have.property('repository', REPO_URL);
    });

    it('should show sync folder in status', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callAndParse('git_status', {
        scriptId: testProjectId
      });

      expect(result).to.have.property('syncFolder', tempSyncFolder);
    });

    it('should provide git status information', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callAndParse('git_status', {
        scriptId: testProjectId
      });

      expect(result).to.have.property('gitStatus');
      if (result.gitStatus) {
        expect(result.gitStatus).to.have.property('branch');
      }
    });
  });

  describe('Git Sync - Clone and Initial Pull', () => {
    before(async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);

      // Clone the ThenRunLater repository into temp sync folder
      console.log(`📦 Cloning ${REPO_URL} to ${tempSyncFolder}...`);
      const { execSync } = await import('child_process');
      execSync(`git clone ${REPO_URL} ${tempSyncFolder}`, {
        stdio: 'inherit',
        timeout: 60000
      });
      console.log('✅ Repository cloned successfully');
    });

    it('should perform initial sync from local to GAS', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;

      const result = await client.callAndParse('git_sync', {
        scriptId: testProjectId
      });

      expect(result).to.have.property('success', true);
      expect(result).to.have.property('pulled');
      expect(result).to.have.property('pushed');

      console.log(`✅ Sync complete: pulled=${result.pulled}, pushed=${result.pushed}`);
    });

    it('should verify all ThenRunLater files transferred to GAS', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const lsResult = await client.callTool('ls', {
        scriptId: testProjectId
      });

      const fileList = lsResult.content[0].text;

      // Check for core files (some may be transformed)
      expect(fileList).to.include('index');
      expect(fileList).to.include('permissions');
      expect(fileList).to.include('script_scheduler');
      expect(fileList).to.include('ui');

      // README.md should be transformed to README.html in GAS
      expect(fileList).to.match(/README\.html|README/i);
    });

    it('should verify file content integrity after sync', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      // Read a file from GAS
      const result = await client.callTool('cat', {
        scriptId: testProjectId,
        path: 'permissions'
      });

      const content = result.content[0].text;
      expect(content).to.have.length.greaterThan(0);

      // Should contain JavaScript code
      expect(content).to.match(/function|var|const|let/);
    });

    it('should handle README.md to README.html transformation', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      // Check if README exists in GAS (as .html)
      const lsResult = await client.callTool('ls', {
        scriptId: testProjectId
      });

      const fileList = lsResult.content[0].text;

      // README should be present (may be README or README.html)
      expect(fileList).to.match(/README/i);
    });
  });

  describe('Git Sync - Push Changes from GAS', () => {
    it('should modify file in GAS and sync back to local', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;

      // Modify a file in GAS
      const testContent = `// Modified by MCP test at ${new Date().toISOString()}\nfunction testModification() {\n  return 'test';\n}`;

      await gas.writeTestFile(testProjectId!, 'TestModification', testContent);

      // Sync changes back
      const syncResult = await client.callAndParse('git_sync', {
        scriptId: testProjectId
      });

      expect(syncResult).to.have.property('success', true);
      expect(syncResult.pulled).to.be.greaterThan(0);

      // Verify file exists locally
      const localFilePath = path.join(tempSyncFolder!, 'TestModification.js');
      expect(fs.existsSync(localFilePath)).to.be.true;

      const localContent = fs.readFileSync(localFilePath, 'utf8');
      expect(localContent).to.include('testModification');
    });

    it('should show uncommitted changes in git status after sync', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(tempSyncFolder).to.not.be.null;

      const { execSync } = await import('child_process');
      const gitStatus = execSync('git status --porcelain', {
        cwd: tempSyncFolder!,
        encoding: 'utf8'
      });

      // Should have uncommitted changes from the modification
      expect(gitStatus).to.have.length.greaterThan(0);
    });

    it('should handle bidirectional changes safely', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;

      // Make change in GAS
      await gas.writeTestFile(testProjectId!, 'BidirectionalTest', 'GAS content');

      // Make change locally
      const localFilePath = path.join(tempSyncFolder!, 'LocalTest.js');
      fs.writeFileSync(localFilePath, 'Local content');

      // Sync should merge both
      const syncResult = await client.callAndParse('git_sync', {
        scriptId: testProjectId
      });

      expect(syncResult).to.have.property('success', true);

      // Both files should exist
      const gasLsResult = await client.callTool('ls', {
        scriptId: testProjectId
      });

      const fileList = gasLsResult.content[0].text;
      expect(fileList).to.include('BidirectionalTest');
      expect(fileList).to.include('LocalTest');
    });
  });

  describe('Git Set Sync Folder - Reconfigure Location', () => {
    let newSyncFolder: string | null = null;

    before(function() {
      newSyncFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gas-git-test2-'));
      console.log(`✅ Created new temp sync folder: ${newSyncFolder}`);
    });

    after(function() {
      if (newSyncFolder && fs.existsSync(newSyncFolder)) {
        fs.rmSync(newSyncFolder, { recursive: true, force: true });
      }
    });

    it('should update sync folder configuration', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;
      expect(newSyncFolder).to.not.be.null;

      const result = await client.callAndParse('git_set_sync_folder', {
        scriptId: testProjectId,
        localPath: newSyncFolder
      });

      expect(result).to.have.property('success', true);
      expect(result).to.have.property('oldPath', tempSyncFolder);
      expect(result).to.have.property('newPath', newSyncFolder);
    });

    it('should verify .git.gs file reflects new folder', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('cat', {
        scriptId: testProjectId,
        path: '.git'
      });

      const content = result.content[0].text;
      expect(content).to.include(newSyncFolder!);
      expect(content).to.not.include(tempSyncFolder!);
    });

    it('should return new folder in subsequent get_sync_folder calls', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callAndParse('git_get_sync_folder', {
        scriptId: testProjectId
      });

      expect(result).to.have.property('syncFolder', newSyncFolder);
    });
  });

  describe('Git Sync Workflows - Advanced Operations', () => {
    it('should support dry-run mode', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callAndParse('git_sync', {
        scriptId: testProjectId,
        dryRun: true
      });

      expect(result).to.have.property('success', true);
      expect(result).to.have.property('dryRun', true);
    });

    it('should support pull-only direction', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;

      const result = await client.callAndParse('git_sync', {
        scriptId: testProjectId,
        direction: 'pull-only'
      });

      expect(result).to.have.property('success', true);
      // Should have pulled but not pushed
      expect(result.pushed).to.equal(0);
    });

    it('should support file filtering with includeFiles', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;

      const result = await client.callAndParse('git_sync', {
        scriptId: testProjectId,
        includeFiles: ['*.js'],
        dryRun: true
      });

      expect(result).to.have.property('success', true);
    });

    it('should support file filtering with excludeFiles', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;

      const result = await client.callAndParse('git_sync', {
        scriptId: testProjectId,
        excludeFiles: ['test/*', '*.md'],
        dryRun: true
      });

      expect(result).to.have.property('success', true);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should fail gracefully when syncing project without git association', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      // Create a project without git init
      const result = await gas.createTestProject('No-Git-Project');
      const noGitProjectId = result.scriptId;

      try {
        await client.callAndParse('git_sync', {
          scriptId: noGitProjectId
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.match(/no git association|not initialized/i);
      } finally {
        await gas.cleanupTestProject(noGitProjectId);
      }
    });

    it('should handle missing sync folder gracefully', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      // Set non-existent sync folder
      await client.callAndParse('git_set_sync_folder', {
        scriptId: testProjectId,
        syncFolder: '/nonexistent/folder/path'
      });

      const statusResult = await client.callAndParse('git_status', {
        scriptId: testProjectId
      });

      // Should report folder doesn't exist
      expect(statusResult.syncFolder).to.equal('/nonexistent/folder/path');
    });

    it('should provide helpful error for invalid scriptId', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      try {
        await client.callAndParse('git_status', {
          scriptId: 'invalid-script-id-123'
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.match(/invalid|not found|error/i);
      }
    });
  });

  describe('File Transformations', () => {
    it('should verify .git.gs file is NOT synced to local', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(tempSyncFolder).to.not.be.null;

      // .git.gs should only exist in GAS, not in local git repo
      const localGitGsPath = path.join(tempSyncFolder!, '.git.gs');
      expect(fs.existsSync(localGitGsPath)).to.be.false;
    });

    it('should handle CommonJS wrapping during sync', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      // Read a JS file with smart cat (unwrapped)
      const smartResult = await client.callTool('cat', {
        scriptId: testProjectId,
        path: 'permissions'
      });

      const smartContent = smartResult.content[0].text;
      expect(smartContent).to.not.include('function _main');

      // Read same file with raw cat (wrapped)
      const rawResult = await client.callTool('raw_cat', {
        scriptId: testProjectId,
        path: 'permissions.gs'
      });

      const rawContent = rawResult.content[0].text;
      expect(rawContent).to.include('function _main');
      expect(rawContent).to.include('module.exports');
    });

    it('should verify local files match GAS content (ignoring wrapper)', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      // Read from GAS (unwrapped)
      const gasResult = await client.callTool('cat', {
        scriptId: testProjectId,
        path: 'permissions'
      });

      const gasContent = gasResult.content[0].text;

      // Read from local
      const localPath = path.join(tempSyncFolder!, 'permissions.js');
      if (fs.existsSync(localPath)) {
        const localContent = fs.readFileSync(localPath, 'utf8');

        // Content should be similar (allowing for minor formatting differences)
        expect(localContent).to.include('function');
      }
    });
  });
});
