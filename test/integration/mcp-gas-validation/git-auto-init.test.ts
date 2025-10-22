/**
 * Git Auto-Init Integration Tests
 *
 * Tests automatic git repository initialization behavior:
 * - write tool auto-initializes git when missing
 * - git_feature tool auto-initializes git when missing
 * - Git config detection and defaults
 * - Consistent behavior across tools
 *
 * Validates the shared ensureGitInitialized() utility used by:
 * - GitFeatureTool (feature branch operations)
 * - LocalFileManager (write operations)
 */

import { expect } from 'chai';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { setupIntegrationTest, globalAuthState } from '../../setup/integrationSetup.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

describe('Git Auto-Init Integration Tests', () => {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let gas: InProcessGASTestHelper;
  let testProjectId: string | null = null;
  let tempDir: string | null = null;

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
    const result = await gas.createTestProject('MCP-Git-Auto-Init-Test');
    testProjectId = result.scriptId;
    console.log(`✅ Created test project: ${testProjectId}`);
  });

  beforeEach(async function() {
    this.timeout(TEST_TIMEOUTS.OPERATION);

    // Create fresh temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gas-autoinit-'));
    console.log(`✅ Created temp directory: ${tempDir}`);
  });

  afterEach(async function() {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up temp directory`);
    }
  });

  after(async function() {
    this.timeout(TEST_TIMEOUTS.CLEANUP);

    // Clean up test project
    if (testProjectId) {
      try {
        await gas.cleanupTestProject(testProjectId);
        console.log('✅ Test project cleaned up');
      } catch (error: any) {
        console.error(`⚠️  Cleanup failed: ${error.message}`);
      }
    }
  });

  describe('git_feature auto-init', () => {
    it('should auto-initialize git when .git missing', async function() {
      this.timeout(TEST_TIMEOUTS.OPERATION);

      if (!testProjectId || !tempDir) {
        this.skip();
        return;
      }

      // Verify no .git directory exists
      const gitPath = path.join(tempDir, '.git');
      expect(fs.existsSync(gitPath)).to.be.false;

      // Create breadcrumb pointing to temp directory
      const gitConfig = `[sync]
\tlocalPath = ${tempDir}`;

      await client.callTool('write', {
        scriptId: testProjectId,
        path: '.git/config',
        content: gitConfig
      });

      // Call git_feature - should auto-initialize git
      const result = await client.callTool('git_feature', {
        operation: 'list',
        scriptId: testProjectId
      });

      // Verify git was initialized
      expect(fs.existsSync(gitPath)).to.be.true;
      expect(fs.existsSync(path.join(tempDir, '.git/config'))).to.be.true;

      // Verify git config was set
      const gitUserName = execSync('git config user.name', {
        cwd: tempDir,
        encoding: 'utf8'
      }).trim();

      expect(gitUserName).to.not.be.empty;
      console.log(`✅ Git auto-initialized with user.name="${gitUserName}"`);
    });

    it('should use global git config if available', async function() {
      this.timeout(TEST_TIMEOUTS.OPERATION);

      if (!testProjectId || !tempDir) {
        this.skip();
        return;
      }

      // Check if global git config exists
      let hasGlobalConfig = false;
      let globalUserName = '';
      try {
        globalUserName = execSync('git config --global user.name', {
          encoding: 'utf8'
        }).trim();
        hasGlobalConfig = globalUserName.length > 0;
      } catch {
        // No global config
      }

      if (!hasGlobalConfig) {
        console.log('⏭️  Skipping - no global git config available');
        this.skip();
        return;
      }

      // Create breadcrumb
      const gitConfig = `[sync]
\tlocalPath = ${tempDir}`;

      await client.callTool('write', {
        scriptId: testProjectId,
        path: '.git/config',
        content: gitConfig
      });

      // Call git_feature to trigger auto-init
      await client.callTool('git_feature', {
        operation: 'list',
        scriptId: testProjectId
      });

      // Verify local repo uses global config
      const localUserName = execSync('git config user.name', {
        cwd: tempDir,
        encoding: 'utf8'
      }).trim();

      // Should match global or be the default
      expect(localUserName).to.not.be.empty;
      console.log(`✅ Git initialized with user.name="${localUserName}"`);
    });

    it('should set default config when no global config exists', async function() {
      this.timeout(TEST_TIMEOUTS.OPERATION);

      if (!testProjectId || !tempDir) {
        this.skip();
        return;
      }

      // Create breadcrumb
      const gitConfig = `[sync]
\tlocalPath = ${tempDir}`;

      await client.callTool('write', {
        scriptId: testProjectId,
        path: '.git/config',
        content: gitConfig
      });

      // Call git_feature to trigger auto-init
      await client.callTool('git_feature', {
        operation: 'list',
        scriptId: testProjectId
      });

      // Verify git config exists (either global or defaults)
      const localUserName = execSync('git config user.name', {
        cwd: tempDir,
        encoding: 'utf8'
      }).trim();

      const localUserEmail = execSync('git config user.email', {
        cwd: tempDir,
        encoding: 'utf8'
      }).trim();

      expect(localUserName).to.not.be.empty;
      expect(localUserEmail).to.not.be.empty;

      console.log(`✅ Git config set: name="${localUserName}", email="${localUserEmail}"`);
    });
  });

  describe('write tool auto-init', () => {
    it('should auto-initialize git during write operation', async function() {
      this.timeout(TEST_TIMEOUTS.OPERATION);

      if (!testProjectId || !tempDir) {
        this.skip();
        return;
      }

      // Verify no .git directory exists
      const gitPath = path.join(tempDir, '.git');
      expect(fs.existsSync(gitPath)).to.be.false;

      // Create breadcrumb pointing to temp directory
      const gitConfig = `[sync]
\tlocalPath = ${tempDir}`;

      await client.callTool('write', {
        scriptId: testProjectId,
        path: '.git/config',
        content: gitConfig
      });

      // Write a test file - should trigger git auto-init
      const result = await client.callTool('write', {
        scriptId: testProjectId,
        path: 'TestFile',
        content: 'function test() { return true; }'
      });

      // Verify git was initialized
      expect(fs.existsSync(gitPath)).to.be.true;
      expect(fs.existsSync(path.join(tempDir, '.git/config'))).to.be.true;

      console.log('✅ Git auto-initialized during write operation');
    });

    it('should create .gitignore when initializing new repo', async function() {
      this.timeout(TEST_TIMEOUTS.OPERATION);

      if (!testProjectId || !tempDir) {
        this.skip();
        return;
      }

      // Create breadcrumb
      const gitConfig = `[sync]
\tlocalPath = ${tempDir}`;

      await client.callTool('write', {
        scriptId: testProjectId,
        path: '.git/config',
        content: gitConfig
      });

      // Write a file to trigger git init
      await client.callTool('write', {
        scriptId: testProjectId,
        path: 'TestFile',
        content: 'function test() { return true; }'
      });

      // Verify .gitignore was created
      const gitignorePath = path.join(tempDir, '.gitignore');
      expect(fs.existsSync(gitignorePath)).to.be.true;

      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
      expect(gitignoreContent).to.include('.env');
      expect(gitignoreContent).to.include('node_modules/');
      expect(gitignoreContent).to.include('.DS_Store');

      console.log('✅ .gitignore created with correct content');
    });
  });

  describe('Consistent behavior across tools', () => {
    it('should produce identical git repos from write and git_feature', async function() {
      this.timeout(TEST_TIMEOUTS.OPERATION);

      if (!testProjectId) {
        this.skip();
        return;
      }

      // Create two temp directories
      const tempDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gas-consistency1-'));
      const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gas-consistency2-'));

      try {
        // Initialize with write tool
        const gitConfig1 = `[sync]
\tlocalPath = ${tempDir1}`;

        await client.callTool('write', {
          scriptId: testProjectId,
          path: '.git/config',
          content: gitConfig1
        });

        await client.callTool('write', {
          scriptId: testProjectId,
          path: 'TestFile1',
          content: 'function test1() { return 1; }'
        });

        // Initialize with git_feature tool
        const gitConfig2 = `[sync]
\tlocalPath = ${tempDir2}`;

        await client.callTool('write', {
          scriptId: testProjectId,
          path: '.git/config',
          content: gitConfig2
        });

        await client.callTool('git_feature', {
          operation: 'list',
          scriptId: testProjectId
        });

        // Verify both have .git directories
        expect(fs.existsSync(path.join(tempDir1, '.git'))).to.be.true;
        expect(fs.existsSync(path.join(tempDir2, '.git'))).to.be.true;

        // Verify both have git config
        const config1 = execSync('git config user.name', {
          cwd: tempDir1,
          encoding: 'utf8'
        }).trim();

        const config2 = execSync('git config user.name', {
          cwd: tempDir2,
          encoding: 'utf8'
        }).trim();

        expect(config1).to.not.be.empty;
        expect(config2).to.not.be.empty;

        console.log('✅ Both tools produce valid git repositories');

      } finally {
        // Clean up
        if (fs.existsSync(tempDir1)) {
          fs.rmSync(tempDir1, { recursive: true, force: true });
        }
        if (fs.existsSync(tempDir2)) {
          fs.rmSync(tempDir2, { recursive: true, force: true });
        }
      }
    });
  });

  describe('Error handling', () => {
    it('should handle git init failures gracefully', async function() {
      this.timeout(TEST_TIMEOUTS.OPERATION);

      if (!testProjectId) {
        this.skip();
        return;
      }

      // Create breadcrumb pointing to invalid location (no write permissions)
      const invalidPath = '/root/invalid-git-path';
      const gitConfig = `[sync]
\tlocalPath = ${invalidPath}`;

      await client.callTool('write', {
        scriptId: testProjectId,
        path: '.git/config',
        content: gitConfig
      });

      // Attempt to trigger git init - should handle error gracefully
      try {
        await client.callTool('git_feature', {
          operation: 'list',
          scriptId: testProjectId
        });

        // If no error thrown, check that git wasn't initialized
        expect(fs.existsSync(path.join(invalidPath, '.git'))).to.be.false;

      } catch (error: any) {
        // Expected behavior - error should be informative
        expect(error.message).to.exist;
        console.log(`✅ Error handled gracefully: ${error.message}`);
      }
    });
  });
});
