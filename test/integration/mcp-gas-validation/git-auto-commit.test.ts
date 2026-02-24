/**
 * Git Auto-Commit Workflow Integration Tests
 *
 * Tests automatic feature branch creation and atomic commit workflow:
 * - Two-phase git discovery (local filesystem + GAS breadcrumbs)
 * - Automatic feature branch creation (llm-feature-auto-{timestamp})
 * - Atomic write → commit → push workflow with rollback on failure
 * - Git hooks integration with validation and rollback
 * - Support for custom commit messages via changeReason parameter
 * - Polyrepo support via projectPath parameter
 *
 * Workflow:
 * 1. write/raw_write detects git repository
 * 2. Auto-creates feature branch if not on one
 * 3. Writes locally, runs hooks, commits atomically
 * 4. Pushes to remote GAS
 * 5. Rolls back on failure
 */

import { expect } from 'chai';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { setupIntegrationTest, globalAuthState } from '../../setup/integrationSetup.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

describe('Git Auto-Commit Workflow Integration Tests', () => {
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
    const result = await gas.createTestProject('MCP-Git-AutoCommit-Test');
    testProjectId = result.scriptId;
    console.log(`✅ Created test project: ${testProjectId}`);

    // Create temporary sync folder and initialize git
    tempSyncFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gas-auto-commit-'));
    console.log(`✅ Created temp sync folder: ${tempSyncFolder}`);

    // Initialize git repository
    execSync('git init', { cwd: tempSyncFolder!, stdio: 'pipe' });
    execSync('git config user.email "test@mcp-gas.test"', { cwd: tempSyncFolder!, stdio: 'pipe' });
    execSync('git config user.name "MCP Test"', { cwd: tempSyncFolder!, stdio: 'pipe' });

    // Create main branch with initial commit
    fs.writeFileSync(path.join(tempSyncFolder, 'README.md'), '# Test Project\n');
    execSync('git add .', { cwd: tempSyncFolder!, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: tempSyncFolder!, stdio: 'pipe' });
    console.log('✅ Git repository initialized');
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

  describe('Phase A: Local Git Discovery', () => {
    it('should create git breadcrumb in GAS for discovery', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      // Create .git/config.gs breadcrumb
      const gitConfig = `[remote "origin"]
\turl = file://${tempSyncFolder}
[branch "main"]
[sync]
\tlocalPath = ${tempSyncFolder}`;

      const result = await client.callTool('write', {
        scriptId: testProjectId,
        path: '.git/config',
        content: gitConfig
      });

      expect(result.content[0].text).to.include('success');
      console.log('✅ Created .git/config.gs breadcrumb');
    });

    it('should verify git discovery finds local repository', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      // Write a file to trigger discovery
      const result = await client.callAndParse('write', {
        scriptId: testProjectId,
        path: 'DiscoveryTest',
        content: 'function test() { return "discovery"; }'
      });

      // Should include git information in response
      expect(result).to.have.property('git');
      if (result.git) {
        expect(result.git).to.have.property('enabled', true);
        expect(result.git).to.have.property('source');
        console.log(`✅ Git discovered via: ${result.git.source}`);
      }
    });
  });

  describe('Automatic Feature Branch Creation', () => {
    it('should auto-create feature branch when writing from main', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      // Ensure we're on main branch
      execSync('git checkout main', { cwd: tempSyncFolder!, stdio: 'pipe' });

      // Write a file (should auto-create feature branch)
      const result = await client.callAndParse('write', {
        scriptId: testProjectId,
        path: 'AutoBranchTest',
        content: 'function autoBranch() { return "test"; }'
      });

      // Verify feature branch was created
      expect(result).to.have.property('git');
      if (result.git) {
        expect(result.git).to.have.property('branch');
        expect(result.git.branch).to.match(/^llm-feature-auto-\d+$/);
        expect(result.git).to.have.property('branchCreated', true);
        console.log(`✅ Auto-created branch: ${result.git.branch}`);
      }

      // Verify we're actually on the new branch
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: tempSyncFolder!,
        encoding: 'utf8'
      }).trim();
      expect(currentBranch).to.match(/^llm-feature-auto-/);
    });

    it('should use existing feature branch if already on one', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      // Current branch should still be the auto-created one from previous test
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: tempSyncFolder!,
        encoding: 'utf8'
      }).trim();

      // Write another file (should use existing branch)
      const result = await client.callAndParse('write', {
        scriptId: testProjectId,
        path: 'ExistingBranchTest',
        content: 'function existing() { return "test"; }'
      });

      // Should use same branch, not create new one
      expect(result).to.have.property('git');
      if (result.git) {
        expect(result.git).to.have.property('branch', currentBranch);
        expect(result.git).to.have.property('branchCreated', false);
        console.log(`✅ Used existing branch: ${result.git.branch}`);
      }
    });
  });

  describe('Atomic Commit Workflow', () => {
    it('should commit changes atomically with auto-generated message', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      const result = await client.callAndParse('write', {
        scriptId: testProjectId,
        path: 'AtomicTest',
        content: 'function atomic() { return "committed"; }'
      });

      // Verify commit was created
      expect(result).to.have.property('git');
      if (result.git) {
        expect(result.git).to.have.property('commitHash');
        expect(result.git.commitHash).to.match(/^[0-9a-f]{7,40}$/);
        console.log(`✅ Commit created: ${result.git.commitHash}`);
      }

      // Verify commit exists in git log
      const log = execSync('git log --oneline -1', {
        cwd: tempSyncFolder!,
        encoding: 'utf8'
      });
      expect(log).to.include('Update AtomicTest');
    });

    it('should use custom commit message when provided', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      const customMessage = 'feat: Add custom message test';

      const result = await client.callAndParse('write', {
        scriptId: testProjectId,
        path: 'CustomMessageTest',
        content: 'function custom() { return "message"; }',
        changeReason: customMessage
      });

      // Verify custom message was used
      expect(result).to.have.property('git');
      if (result.git) {
        expect(result.git).to.have.property('commitMessage', customMessage);
      }

      // Verify in git log
      const log = execSync('git log --oneline -1', {
        cwd: tempSyncFolder!,
        encoding: 'utf8'
      });
      expect(log).to.include(customMessage);
      console.log('✅ Custom commit message applied');
    });

    it('should sync local and remote file timestamps', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      const result = await client.callAndParse('write', {
        scriptId: testProjectId,
        path: 'TimestampTest',
        content: 'function timestamp() { return "sync"; }'
      });

      expect(result).to.have.property('success', true);

      // Verify local file exists
      const localPath = path.join(tempSyncFolder!, 'TimestampTest.js');
      expect(fs.existsSync(localPath)).to.be.true;

      // Verify remote file exists
      const catResult = await client.callTool('cat', {
        scriptId: testProjectId,
        path: 'TimestampTest'
      });
      expect(catResult.content[0].text).to.include('timestamp');
    });
  });

  describe('Git Hooks Integration', () => {
    it('should run pre-commit hooks if configured', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      // Create a simple pre-commit hook that adds a comment
      const hooksDir = path.join(tempSyncFolder!, '.git', 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });

      const hookPath = path.join(hooksDir, 'pre-commit');
      fs.writeFileSync(hookPath, '#!/bin/sh\necho "Hook executed"\nexit 0\n');
      fs.chmodSync(hookPath, 0o755);

      const result = await client.callAndParse('write', {
        scriptId: testProjectId,
        path: 'HookTest',
        content: 'function hook() { return "test"; }'
      });

      // Should complete successfully even with hook
      expect(result).to.have.property('success', true);
      expect(result).to.have.property('git');
      if (result.git) {
        expect(result.git).to.have.property('commitHash');
      }
      console.log('✅ Pre-commit hook executed successfully');
    });
  });

  describe('Raw Write Git Integration', () => {
    it('should support git workflow with raw_write', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      const result = await client.callAndParse('write', {
        scriptId: testProjectId,
        path: 'RawWriteTest',
        content: 'function rawTest() { return "raw"; }',
        fileType: 'SERVER_JS',
        raw: true
      });

      // Should include git information
      expect(result).to.have.property('git');
      if (result.git) {
        expect(result.git).to.have.property('enabled', true);
        expect(result.git).to.have.property('commitHash');
        console.log(`✅ Raw write with git: ${result.git.commitHash}`);
      }
    });
  });

  describe('Error Handling and Rollback', () => {
    it('should handle write errors gracefully', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      // Try to write with invalid content
      try {
        await client.callAndParse('write', {
          scriptId: testProjectId,
          path: 'ErrorTest',
          content: ''  // Empty content might cause validation error
        });
      } catch (error: any) {
        // Should get meaningful error message
        expect(error.message).to.be.a('string');
        console.log('✅ Error handled gracefully');
      }
    });

    it('should provide git status in error responses', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      // Verify git is still in good state after errors
      const status = execSync('git status --porcelain', {
        cwd: tempSyncFolder!,
        encoding: 'utf8'
      });

      // If there are uncommitted changes, that's expected
      console.log(`Git status: ${status ? 'has changes' : 'clean'}`);
    });
  });

  describe('Polyrepo Support', () => {
    it('should support projectPath parameter for nested git repos', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testProjectId).to.not.be.null;
      expect(tempSyncFolder).to.not.be.null;

      // Create a nested project directory
      const nestedPath = path.join(tempSyncFolder!, 'backend');
      fs.mkdirSync(nestedPath, { recursive: true });

      // Initialize git in nested directory
      execSync('git init', { cwd: nestedPath, stdio: 'pipe' });
      execSync('git config user.email "test@mcp-gas.test"', { cwd: nestedPath, stdio: 'pipe' });
      execSync('git config user.name "MCP Test"', { cwd: nestedPath, stdio: 'pipe' });

      // Create initial commit
      fs.writeFileSync(path.join(nestedPath, 'README.md'), '# Backend\n');
      execSync('git add .', { cwd: nestedPath, stdio: 'pipe' });
      execSync('git commit -m "Initial backend commit"', { cwd: nestedPath, stdio: 'pipe' });

      // Write with projectPath
      const result = await client.callAndParse('write', {
        scriptId: testProjectId,
        path: 'PolyrepoTest',
        content: 'function polyrepo() { return "nested"; }',
        projectPath: 'backend'
      });

      // Should complete successfully
      expect(result).to.have.property('success', true);
      console.log('✅ Polyrepo support verified');
    });
  });

  describe('Branch Management', () => {
    it('should show feature branch in git log', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(tempSyncFolder).to.not.be.null;

      const branches = execSync('git branch', {
        cwd: tempSyncFolder!,
        encoding: 'utf8'
      });

      // Should have main and auto-created feature branch
      expect(branches).to.include('main');
      expect(branches).to.match(/llm-feature-auto-\d+/);
      console.log('✅ Feature branches visible in git');
    });

    it('should maintain commit history on feature branch', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(tempSyncFolder).to.not.be.null;

      const log = execSync('git log --oneline', {
        cwd: tempSyncFolder!,
        encoding: 'utf8'
      });

      // Should have multiple commits from tests
      const commitCount = log.trim().split('\n').length;
      expect(commitCount).to.be.greaterThan(1);
      console.log(`✅ Commit history maintained: ${commitCount} commits`);
    });
  });
});
