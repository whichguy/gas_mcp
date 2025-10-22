/**
 * Git Feature Workflow Integration Tests
 *
 * Tests the git_feature tool with all 5 operations:
 * - start: Create new feature branch (llm-feature-{name})
 * - finish: Squash merge to main and optionally delete branch
 * - rollback: Delete branch without merging
 * - list: Show all feature branches
 * - switch: Switch between branches
 *
 * Features tested:
 * - Dynamic main/master branch detection
 * - Branch name sanitization and validation
 * - Uncommitted changes detection
 * - Squash merge workflow
 * - Error handling and validation
 * - Polyrepo support via projectPath parameter
 */

import { expect } from 'chai';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { setupIntegrationTest, globalAuthState } from '../../setup/integrationSetup.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

describe('Git Feature Workflow Integration Tests', () => {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let gas: InProcessGASTestHelper;
  let testProjectId: string | null = null;
  let tempSyncFolder: string | null = null;

  before(async function() {
    this.timeout(60000);

    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️  Skipping - server not ready');
      this.skip();
    }

    client = globalAuthState.client;
    auth = globalAuthState.auth!;
    gas = globalAuthState.gas!;

    // Verify access token
    console.log('🔍 Verifying access token...');
    try {
      const testToken = await client.getAccessToken();
      if (!testToken) {
        console.error('❌ No access token available');
        this.skip();
        return;
      }
      console.log('✅ Access token verified');
    } catch (tokenError: any) {
      console.error(`❌ Token access failed: ${tokenError.message}`);
      this.skip();
      return;
    }

    // Create test project
    const result = await gas.createTestProject('MCP-Git-Feature-Test');
    testProjectId = result.scriptId;
    console.log(`✅ Created test project: ${testProjectId}`);

    // Create temporary sync folder and initialize git
    tempSyncFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gas-feature-'));
    console.log(`✅ Created temp sync folder: ${tempSyncFolder}`);

    // Initialize git repository with main branch
    execSync('git init', { cwd: tempSyncFolder, stdio: 'pipe' });
    execSync('git config user.email "test@mcp-gas.test"', { cwd: tempSyncFolder, stdio: 'pipe' });
    execSync('git config user.name "MCP Test"', { cwd: tempSyncFolder, stdio: 'pipe' });

    // Create main branch with initial commit
    fs.writeFileSync(path.join(tempSyncFolder, 'README.md'), '# Feature Test Project\n');
    execSync('git add .', { cwd: tempSyncFolder, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: tempSyncFolder, stdio: 'pipe' });
    execSync('git branch -M main', { cwd: tempSyncFolder, stdio: 'pipe' });
    console.log('✅ Git repository initialized with main branch');

    // Create .git/config.gs breadcrumb in GAS
    const gitConfig = `[remote "origin"]
\turl = file://${tempSyncFolder}
[branch "main"]
[sync]
\tlocalPath = ${tempSyncFolder}`;

    await client.callTool('write', {
      scriptId: testProjectId,
      path: '.git/config',
      content: gitConfig
    });
    console.log('✅ Git breadcrumb created in GAS');
  });

  beforeEach(async function() {
    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.error('⚠️  Server not authenticated - skipping test');
      this.skip();
    }

    if (testProjectId) {
      try {
        await client.getProjectInfo(testProjectId);
      } catch (error) {
        console.error('❌ Test project no longer valid:', error);
        this.skip();
      }
    }

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

    // Ensure we're on main branch and have no uncommitted changes
    if (tempSyncFolder && fs.existsSync(tempSyncFolder)) {
      try {
        execSync('git checkout main', { cwd: tempSyncFolder, stdio: 'pipe' });
        execSync('git reset --hard', { cwd: tempSyncFolder, stdio: 'pipe' });
      } catch {
        // Ignore errors - might be on detached HEAD
      }
    }
  });

  afterEach(async function() {
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
      } catch (cleanupError) {
        console.error('❌ Cleanup failed (non-fatal):', cleanupError);
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

  describe('Operation: start', () => {
    it('should create new feature branch with explicit name', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      const result = await client.callAndParse('git_feature', {
        operation: 'start',
        scriptId: testProjectId,
        featureName: 'user-auth'
      });

      expect(result).to.have.property('status', 'success');
      expect(result).to.have.property('operation', 'start');
      expect(result).to.have.property('branch', 'llm-feature-user-auth');
      expect(result).to.have.property('created', true);
      expect(result).to.have.property('previousBranch', 'main');

      // Verify branch was created
      const branches = execSync('git branch', { cwd: tempSyncFolder, encoding: 'utf8' });
      expect(branches).to.include('llm-feature-user-auth');
      console.log('✅ Feature branch created: llm-feature-user-auth');
    });

    it('should fail if already on a feature branch', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      // Should still be on llm-feature-user-auth from previous test
      try {
        await client.callAndParse('git_feature', {
          operation: 'start',
          scriptId: testProjectId,
          featureName: 'another-feature'
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Already on feature branch');
        console.log('✅ Correctly rejected start on feature branch');
      }
    });

    it('should fail if there are uncommitted changes', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      // Switch back to main
      execSync('git checkout main', { cwd: tempSyncFolder, stdio: 'pipe' });

      // Create uncommitted change
      fs.writeFileSync(path.join(tempSyncFolder, 'uncommitted.txt'), 'test');

      try {
        await client.callAndParse('git_feature', {
          operation: 'start',
          scriptId: testProjectId,
          featureName: 'will-fail'
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Uncommitted changes');
        console.log('✅ Correctly detected uncommitted changes');
      } finally {
        // Clean up
        fs.unlinkSync(path.join(tempSyncFolder, 'uncommitted.txt'));
      }
    });

    it('should validate feature name pattern', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      try {
        await client.callAndParse('git_feature', {
          operation: 'start',
          scriptId: testProjectId,
          featureName: 'invalid name with spaces'
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.match(/alphanumeric|validation/i);
        console.log('✅ Branch name validation working');
      }
    });
  });

  describe('Operation: list', () => {
    it('should list all feature branches', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callAndParse('git_feature', {
        operation: 'list',
        scriptId: testProjectId
      });

      expect(result).to.have.property('status', 'success');
      expect(result).to.have.property('operation', 'list');
      expect(result).to.have.property('branches').that.is.an('array');
      expect(result).to.have.property('total');
      expect(result).to.have.property('current');

      // Should have llm-feature-user-auth from earlier test
      expect(result.branches).to.include('llm-feature-user-auth');
      console.log(`✅ Found ${result.total} feature branch(es)`);
    });

    it('should indicate current branch', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      // Switch to feature branch
      execSync('git checkout llm-feature-user-auth', { cwd: tempSyncFolder, stdio: 'pipe' });

      const result = await client.callAndParse('git_feature', {
        operation: 'list',
        scriptId: testProjectId
      });

      expect(result.current).to.equal('llm-feature-user-auth');
      console.log(`✅ Current branch: ${result.current}`);
    });
  });

  describe('Operation: switch', () => {
    it('should switch to existing branch', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      // Ensure we're on main
      execSync('git checkout main', { cwd: tempSyncFolder, stdio: 'pipe' });

      const result = await client.callAndParse('git_feature', {
        operation: 'switch',
        scriptId: testProjectId,
        branch: 'llm-feature-user-auth'
      });

      expect(result).to.have.property('status', 'success');
      expect(result).to.have.property('operation', 'switch');
      expect(result).to.have.property('branch', 'llm-feature-user-auth');
      expect(result).to.have.property('switched', true);
      expect(result).to.have.property('isFeatureBranch', true);

      // Verify current branch
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: tempSyncFolder,
        encoding: 'utf8'
      }).trim();
      expect(currentBranch).to.equal('llm-feature-user-auth');
      console.log('✅ Switched to feature branch');
    });

    it('should fail to switch to non-existent branch', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      try {
        await client.callAndParse('git_feature', {
          operation: 'switch',
          scriptId: testProjectId,
          branch: 'non-existent-branch'
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.match(/existing branch|not found/i);
        console.log('✅ Correctly rejected non-existent branch');
      }
    });

    it('should fail to switch with uncommitted changes', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      // Create uncommitted change
      fs.writeFileSync(path.join(tempSyncFolder, 'uncommitted.txt'), 'test');

      try {
        await client.callAndParse('git_feature', {
          operation: 'switch',
          scriptId: testProjectId,
          branch: 'main'
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Uncommitted changes');
        console.log('✅ Correctly detected uncommitted changes');
      } finally {
        // Clean up
        fs.unlinkSync(path.join(tempSyncFolder, 'uncommitted.txt'));
      }
    });
  });

  describe('Operation: finish', () => {
    before(async function() {
      // Make some commits on the feature branch
      expect(tempSyncFolder).to.not.be.null;

      execSync('git checkout llm-feature-user-auth', { cwd: tempSyncFolder, stdio: 'pipe' });

      // Create and commit test files
      fs.writeFileSync(path.join(tempSyncFolder!, 'feature1.txt'), 'Feature 1');
      execSync('git add .', { cwd: tempSyncFolder, stdio: 'pipe' });
      execSync('git commit -m "Add feature 1"', { cwd: tempSyncFolder, stdio: 'pipe' });

      fs.writeFileSync(path.join(tempSyncFolder!, 'feature2.txt'), 'Feature 2');
      execSync('git add .', { cwd: tempSyncFolder, stdio: 'pipe' });
      execSync('git commit -m "Add feature 2"', { cwd: tempSyncFolder, stdio: 'pipe' });

      console.log('✅ Created test commits on feature branch');
    });

    it('should squash merge feature branch to main', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      // Should still be on llm-feature-user-auth
      const result = await client.callAndParse('git_feature', {
        operation: 'finish',
        scriptId: testProjectId
      });

      expect(result).to.have.property('status', 'success');
      expect(result).to.have.property('operation', 'finish');
      expect(result).to.have.property('branch', 'llm-feature-user-auth');
      expect(result).to.have.property('squashCommit');
      expect(result.squashCommit).to.match(/^[0-9a-f]{7,40}$/);
      expect(result).to.have.property('commitMessage').that.includes('Feature:');
      expect(result).to.have.property('deleted', true);
      expect(result).to.have.property('currentBranch', 'main');

      // Verify we're on main
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: tempSyncFolder,
        encoding: 'utf8'
      }).trim();
      expect(currentBranch).to.equal('main');

      // Verify feature files are present
      expect(fs.existsSync(path.join(tempSyncFolder!, 'feature1.txt'))).to.be.true;
      expect(fs.existsSync(path.join(tempSyncFolder!, 'feature2.txt'))).to.be.true;

      // Verify branch was deleted
      const branches = execSync('git branch', { cwd: tempSyncFolder, encoding: 'utf8' });
      expect(branches).to.not.include('llm-feature-user-auth');

      console.log(`✅ Squash merged to main: ${result.squashCommit}`);
    });

    it('should support keeping branch after merge', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      // Create another feature branch
      execSync('git checkout main', { cwd: tempSyncFolder, stdio: 'pipe' });

      const startResult = await client.callAndParse('git_feature', {
        operation: 'start',
        scriptId: testProjectId,
        featureName: 'keep-branch'
      });

      // Make a commit
      fs.writeFileSync(path.join(tempSyncFolder!, 'keep.txt'), 'Keep me');
      execSync('git add .', { cwd: tempSyncFolder, stdio: 'pipe' });
      execSync('git commit -m "Add keep file"', { cwd: tempSyncFolder, stdio: 'pipe' });

      // Finish without deleting
      const result = await client.callAndParse('git_feature', {
        operation: 'finish',
        scriptId: testProjectId,
        branch: 'llm-feature-keep-branch',
        deleteAfterMerge: false
      });

      expect(result).to.have.property('deleted', false);

      // Verify branch still exists
      const branches = execSync('git branch', { cwd: tempSyncFolder, encoding: 'utf8' });
      expect(branches).to.include('llm-feature-keep-branch');
      console.log('✅ Branch kept after merge');
    });
  });

  describe('Operation: rollback', () => {
    it('should delete feature branch without merging', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      // llm-feature-keep-branch should still exist from previous test
      execSync('git checkout main', { cwd: tempSyncFolder, stdio: 'pipe' });

      const result = await client.callAndParse('git_feature', {
        operation: 'rollback',
        scriptId: testProjectId,
        branch: 'llm-feature-keep-branch'
      });

      expect(result).to.have.property('status', 'success');
      expect(result).to.have.property('operation', 'rollback');
      expect(result).to.have.property('branch', 'llm-feature-keep-branch');
      expect(result).to.have.property('deleted', true);
      expect(result).to.have.property('uncommittedChangesLost', false);

      // Verify branch was deleted
      const branches = execSync('git branch', { cwd: tempSyncFolder, encoding: 'utf8' });
      expect(branches).to.not.include('llm-feature-keep-branch');
      console.log('✅ Branch deleted without merging');
    });

    it('should detect uncommitted changes when rolling back current branch', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      // Create a feature branch
      await client.callAndParse('git_feature', {
        operation: 'start',
        scriptId: testProjectId,
        featureName: 'will-rollback'
      });

      // Make an uncommitted change
      fs.writeFileSync(path.join(tempSyncFolder!, 'uncommitted.txt'), 'Lost changes');

      const result = await client.callAndParse('git_feature', {
        operation: 'rollback',
        scriptId: testProjectId,
        branch: 'llm-feature-will-rollback'
      });

      expect(result).to.have.property('uncommittedChangesLost', true);
      console.log('✅ Detected uncommitted changes will be lost');
    });

    it('should fail to rollback non-feature branch', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      try {
        await client.callAndParse('git_feature', {
          operation: 'rollback',
          scriptId: testProjectId,
          branch: 'main'
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.match(/feature branch|llm-feature-/i);
        console.log('✅ Correctly rejected rollback of main branch');
      }
    });
  });

  describe('Dynamic Branch Detection', () => {
    it('should work with repositories using master as default', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(tempSyncFolder).to.not.be.null;

      // Create a test folder with master branch
      const masterFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gas-master-'));

      try {
        execSync('git init', { cwd: masterFolder, stdio: 'pipe' });
        execSync('git config user.email "test@mcp-gas.test"', { cwd: masterFolder, stdio: 'pipe' });
        execSync('git config user.name "MCP Test"', { cwd: masterFolder, stdio: 'pipe' });

        fs.writeFileSync(path.join(masterFolder, 'README.md'), '# Master Test\n');
        execSync('git add .', { cwd: masterFolder, stdio: 'pipe' });
        execSync('git commit -m "Initial commit"', { cwd: masterFolder, stdio: 'pipe' });
        execSync('git branch -M master', { cwd: masterFolder, stdio: 'pipe' });

        // Create test project for master branch
        const masterProject = await gas.createTestProject('MCP-Git-Master-Test');

        try {
          // Create breadcrumb
          const gitConfig = `[remote "origin"]
\turl = file://${masterFolder}
[branch "master"]
[sync]
\tlocalPath = ${masterFolder}`;

          await client.callTool('write', {
            scriptId: masterProject.scriptId,
            path: '.git/config',
            content: gitConfig
          });

          // Create and finish feature branch
          execSync('git checkout -b llm-feature-test', { cwd: masterFolder, stdio: 'pipe' });
          fs.writeFileSync(path.join(masterFolder, 'test.txt'), 'test');
          execSync('git add .', { cwd: masterFolder, stdio: 'pipe' });
          execSync('git commit -m "Test"', { cwd: masterFolder, stdio: 'pipe' });

          // Finish should detect master as default branch
          const result = await client.callAndParse('git_feature', {
            operation: 'finish',
            scriptId: masterProject.scriptId,
            projectPath: ''  // Use empty string to indicate project root
          });

          expect(result.currentBranch).to.equal('master');
          console.log('✅ Dynamic branch detection works with master');
        } finally {
          await gas.cleanupTestProject(masterProject.scriptId);
        }
      } finally {
        fs.rmSync(masterFolder, { recursive: true, force: true });
      }
    });
  });

  describe('Error Validation', () => {
    it('should require featureName for start operation', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      try {
        await client.callAndParse('git_feature', {
          operation: 'start',
          scriptId: testProjectId
          // Missing featureName
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.match(/featureName.*required/i);
      }
    });

    it('should require branch for rollback operation', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      try {
        await client.callAndParse('git_feature', {
          operation: 'rollback',
          scriptId: testProjectId
          // Missing branch
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.match(/branch.*required/i);
      }
    });

    it('should require branch for switch operation', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      try {
        await client.callAndParse('git_feature', {
          operation: 'switch',
          scriptId: testProjectId
          // Missing branch
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.match(/branch.*required/i);
      }
    });

    it('should fail if git repository not found', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      // Create project without git setup
      const noGitProject = await gas.createTestProject('No-Git-Project');

      try {
        await client.callAndParse('git_feature', {
          operation: 'list',
          scriptId: noGitProject.scriptId
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.match(/git.*not found|initialize git/i);
      } finally {
        await gas.cleanupTestProject(noGitProject.scriptId);
      }
    });
  });
});
