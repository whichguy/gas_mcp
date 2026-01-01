/**
 * Git Hook Integration Tests
 *
 * Tests the hook integration with write operations to ensure:
 * - Filenames with extensions are passed to git operations
 * - Hook validation works correctly with different file types
 * - Edge cases like nested paths and virtual files are handled
 *
 * REGRESSION TEST for bug where writeLocalAndValidateHooksOnly received
 * filenames WITHOUT extensions (e.g., "sheets-sidebar/html/include/SidebarAppInit")
 * causing git add to fail because files on disk have extensions.
 */

import { expect } from 'chai';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { setupIntegrationTest, globalAuthState } from '../../setup/integrationSetup.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

describe('Git Hook Integration Tests', () => {
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
    const result = await gas.createTestProject('MCP-Git-Hook-Test');
    testProjectId = result.scriptId;
    console.log(`✅ Created test project: ${testProjectId}`);

    // Create temporary sync folder and initialize git
    tempSyncFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gas-hook-'));
    console.log(`✅ Created temp sync folder: ${tempSyncFolder}`);

    // Initialize git repository with main branch
    execSync('git init', { cwd: tempSyncFolder, stdio: 'pipe' });
    execSync('git config user.email "test@mcp-gas.test"', { cwd: tempSyncFolder, stdio: 'pipe' });
    execSync('git config user.name "MCP Test"', { cwd: tempSyncFolder, stdio: 'pipe' });

    // Create main branch with initial commit
    fs.writeFileSync(path.join(tempSyncFolder, 'README.md'), '# Hook Test Project\n');
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
    console.log('✅ Git breadcrumb created');
  });

  after(async function() {
    this.timeout(TEST_TIMEOUTS.STANDARD);

    // Clean up test project
    if (testProjectId && gas) {
      try {
        console.log(`🧹 Cleaning up test project: ${testProjectId}`);
        await gas.cleanupTestProject(testProjectId);
      } catch (error: any) {
        console.error(`⚠️  Could not cleanup test project: ${error.message}`);
      }
    }

    // Clean up temp sync folder
    if (tempSyncFolder && fs.existsSync(tempSyncFolder)) {
      try {
        console.log(`🧹 Cleaning up temp sync folder: ${tempSyncFolder}`);
        fs.rmSync(tempSyncFolder, { recursive: true, force: true });
      } catch (error: any) {
        console.error(`⚠️  Could not delete temp folder: ${error.message}`);
      }
    }
  });

  describe('Regression: Filename Extension Handling', () => {
    it('should write HTML file with nested path and stage with correct extension', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      if (!testProjectId) {
        this.skip();
        return;
      }

      console.log('📝 Testing HTML file write with nested path...');

      // Write HTML file with nested path (the original bug scenario)
      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>Test Sidebar</title>
</head>
<body>
  <h1>Test Content</h1>
  <p>This is a test of nested path HTML file write.</p>
</body>
</html>`;

      const writeResult = await client.callTool('write', {
        scriptId: testProjectId,
        path: 'sheets-sidebar/html/include/SidebarAppInit',
        content: htmlContent,
        fileType: 'HTML'
      });

      expect(writeResult.success).to.be.true;
      console.log('✅ HTML file written successfully');

      // Verify file exists on disk with .html extension
      const expectedFilePath = path.join(tempSyncFolder!, 'sheets-sidebar/html/include/SidebarAppInit.html');
      expect(fs.existsSync(expectedFilePath), 'File should exist with .html extension').to.be.true;
      console.log(`✅ File exists with extension: ${expectedFilePath}`);

      // Verify file is staged in git
      const gitStatus = execSync('git status --porcelain', { cwd: tempSyncFolder!, encoding: 'utf-8' });
      expect(gitStatus).to.include('SidebarAppInit.html');
      console.log('✅ File is staged in git with correct extension');

      // Verify content matches
      const fileContent = fs.readFileSync(expectedFilePath, 'utf-8');
      expect(fileContent).to.equal(htmlContent);
      console.log('✅ File content matches');
    });

    it('should write .gs file and stage with correct extension', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      if (!testProjectId) {
        this.skip();
        return;
      }

      console.log('📝 Testing .gs file write...');

      const jsContent = `function testFunction() {
  return "Hello from test";
}

module.exports = { testFunction };`;

      const writeResult = await client.callTool('write', {
        scriptId: testProjectId,
        path: 'utils/TestUtil',
        content: jsContent
      });

      expect(writeResult.success).to.be.true;
      console.log('✅ .gs file written successfully');

      // Verify file exists with .gs extension
      const expectedFilePath = path.join(tempSyncFolder!, 'utils/TestUtil.gs');
      expect(fs.existsSync(expectedFilePath), 'File should exist with .gs extension').to.be.true;
      console.log(`✅ File exists with extension: ${expectedFilePath}`);

      // Verify file is staged
      const gitStatus = execSync('git status --porcelain', { cwd: tempSyncFolder!, encoding: 'utf-8' });
      expect(gitStatus).to.include('TestUtil.gs');
      console.log('✅ File is staged in git with correct extension');
    });

    it('should handle appsscript.json correctly', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      if (!testProjectId) {
        this.skip();
        return;
      }

      console.log('📝 Testing appsscript.json write...');

      const manifestContent = JSON.stringify({
        timeZone: "America/New_York",
        dependencies: {},
        exceptionLogging: "STACKDRIVER",
        runtimeVersion: "V8"
      }, null, 2);

      const writeResult = await client.callTool('write', {
        scriptId: testProjectId,
        path: 'appsscript',
        content: manifestContent,
        fileType: 'JSON'
      });

      expect(writeResult.success).to.be.true;
      console.log('✅ appsscript.json written successfully');

      // Verify file exists with .json extension
      const expectedFilePath = path.join(tempSyncFolder!, 'appsscript.json');
      expect(fs.existsSync(expectedFilePath), 'File should exist as appsscript.json').to.be.true;
      console.log(`✅ File exists as appsscript.json`);

      // Verify file is staged
      const gitStatus = execSync('git status --porcelain', { cwd: tempSyncFolder!, encoding: 'utf-8' });
      expect(gitStatus).to.include('appsscript.json');
      console.log('✅ File is staged in git');
    });

    it('should handle virtual files (.gitignore) correctly', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      if (!testProjectId) {
        this.skip();
        return;
      }

      console.log('📝 Testing virtual file (.gitignore) write...');

      const gitignoreContent = `node_modules/
dist/
*.log
.env`;

      const writeResult = await client.callTool('write', {
        scriptId: testProjectId,
        path: '.gitignore',
        content: gitignoreContent
      });

      expect(writeResult.success).to.be.true;
      console.log('✅ .gitignore written successfully');

      // Verify file exists as .gitignore.gs in local sync (virtual file translation)
      const expectedFilePath = path.join(tempSyncFolder!, '.gitignore.gs');
      expect(fs.existsSync(expectedFilePath), 'File should exist as .gitignore.gs').to.be.true;
      console.log(`✅ File exists as .gitignore.gs (virtual file)`);

      // Verify file is staged
      const gitStatus = execSync('git status --porcelain', { cwd: tempSyncFolder!, encoding: 'utf-8' });
      expect(gitStatus).to.include('.gitignore.gs');
      console.log('✅ File is staged in git');
    });

    it('should handle deeply nested paths with multiple levels', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      if (!testProjectId) {
        this.skip();
        return;
      }

      console.log('📝 Testing deeply nested path...');

      const jsContent = `function deeplyNested() {
  return "Deep nesting test";
}`;

      const writeResult = await client.callTool('write', {
        scriptId: testProjectId,
        path: 'src/modules/auth/handlers/oauth/OAuthCallback',
        content: jsContent
      });

      expect(writeResult.success).to.be.true;
      console.log('✅ Deeply nested file written successfully');

      // Verify file exists with .gs extension
      const expectedFilePath = path.join(tempSyncFolder!, 'src/modules/auth/handlers/oauth/OAuthCallback.gs');
      expect(fs.existsSync(expectedFilePath), 'File should exist with .gs extension').to.be.true;
      console.log(`✅ File exists with extension at deep path`);

      // Verify file is staged
      const gitStatus = execSync('git status --porcelain', { cwd: tempSyncFolder!, encoding: 'utf-8' });
      expect(gitStatus).to.include('OAuthCallback.gs');
      console.log('✅ File is staged in git with correct extension');
    });
  });

  describe('Edge Cases', () => {
    it('should handle files with multiple dots (test.spec.js pattern)', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      if (!testProjectId) {
        this.skip();
        return;
      }

      console.log('📝 Testing file with multiple dots...');

      const jsContent = `function testMultipleDots() {
  return "Testing multiple dots";
}`;

      // File already has extension - should not add another
      const writeResult = await client.callTool('write', {
        scriptId: testProjectId,
        path: 'test/utils.test.spec',
        content: jsContent
      });

      expect(writeResult.success).to.be.true;
      console.log('✅ File with multiple dots written successfully');

      // Verify file exists (extension handling for files with existing dots)
      const possiblePaths = [
        path.join(tempSyncFolder!, 'test/utils.test.spec.gs'),
        path.join(tempSyncFolder!, 'test/utils.test.spec')
      ];

      const existingPath = possiblePaths.find(p => fs.existsSync(p));
      expect(existingPath, 'File should exist with one of the expected patterns').to.exist;
      console.log(`✅ File exists at: ${existingPath}`);
    });

    it('should handle files without extension (Code)', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      if (!testProjectId) {
        this.skip();
        return;
      }

      console.log('📝 Testing file without extension (Code)...');

      const jsContent = `function mainCode() {
  return "Main code";
}`;

      const writeResult = await client.callTool('write', {
        scriptId: testProjectId,
        path: 'Code',
        content: jsContent
      });

      expect(writeResult.success).to.be.true;
      console.log('✅ Code file written successfully');

      // Verify file exists with .gs extension (default)
      const expectedFilePath = path.join(tempSyncFolder!, 'Code.gs');
      expect(fs.existsSync(expectedFilePath), 'File should exist as Code.gs').to.be.true;
      console.log(`✅ File exists as Code.gs`);

      // Verify file is staged
      const gitStatus = execSync('git status --porcelain', { cwd: tempSyncFolder!, encoding: 'utf-8' });
      expect(gitStatus).to.include('Code.gs');
      console.log('✅ File is staged in git');
    });
  });
});
