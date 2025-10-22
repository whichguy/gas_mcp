/**
 * Manual test: Complete polyrepo git auto-init workflow
 * Tests: breadcrumb → feature start → write → feature finish
 *
 * Run with: npx mocha test/manual-polyrepo-workflow.test.ts --timeout 120000
 */

import { InProcessTestClient, InProcessGASTestHelper } from './helpers/inProcessClient.js';
import { expect } from 'chai';
import * as path from 'path';
import * as os from 'os';

describe('Manual: Complete Polyrepo Git Auto-Init Workflow', () => {
  let client: InProcessTestClient;
  let gas: InProcessGASTestHelper;

  // Use the project we just created
  const scriptId = '1RBpxvUsPopFKtOur3yDQdeOgavD5h7_e37Z__t86gg23B6Xc1XrKwv_E';
  const projectPath = 'backend'; // Polyrepo subfolder

  before(async function() {
    this.timeout(60000);

    console.log('\n🚀 Initializing MCP Gas client...');
    client = await InProcessTestClient.create();

    const authStatus = await client.getAuthStatus();
    if (!authStatus.authenticated) {
      console.log('❌ Not authenticated');
      this.skip();
      return;
    }

    console.log('✅ Authenticated as:', authStatus.user?.email);
    gas = new InProcessGASTestHelper(client);
  });

  it('Step 1: Create git breadcrumb for backend polyrepo', async function() {
    this.timeout(30000);

    console.log('\n📋 STEP 1: Creating git breadcrumb for backend polyrepo');
    console.log('   Script ID:', scriptId);
    console.log('   Polyrepo path:', projectPath);

    // Determine sync folder path
    const homeDir = os.homedir();
    const syncFolder = path.join(homeDir, 'gas-repos', `project-${scriptId}`, projectPath);

    console.log('   Sync folder:', syncFolder);

    // Create git breadcrumb - use RAW git config format
    // WriteTool will handle wrapping for GAS storage automatically
    const gitConfig = `[sync]
\tlocalPath = ${syncFolder}`;

    // Write .git/config breadcrumb (let WriteTool handle git file formatting)
    const mcpResult = await client.callTool('write', {
      scriptId: scriptId,
      path: '.git/config',
      content: gitConfig,
      projectPath: projectPath
    });

    // Parse MCP response format
    const result = client.parseToolResult(mcpResult);

    console.log('✅ Git breadcrumb created');
    console.log('   Path: .git/config');
    console.log('   Sync folder:', syncFolder);

    expect(result).to.have.property('success', true);
  });

  it('Step 2: Start feature branch (triggers git auto-init)', async function() {
    this.timeout(60000);

    console.log('\n🌿 STEP 2: Starting feature branch (will auto-init git)');
    console.log('   Feature name: test-polyrepo');
    console.log('   Project path:', projectPath);

    // Use git_feature tool to start branch
    const mcpResult = await client.callTool('git_feature', {
      operation: 'start',
      scriptId: scriptId,
      featureName: 'test-polyrepo',
      projectPath: projectPath
    });

    // Parse MCP response format
    const result = client.parseToolResult(mcpResult);

    console.log('\n✅ Feature branch created');
    console.log('   Result:', JSON.stringify(result, null, 2));

    expect(result).to.have.property('status', 'success');
    expect(result).to.have.property('branch', 'llm-feature-test-polyrepo');
  });

  it('Step 3: Write test file to backend polyrepo (with auto-commit)', async function() {
    this.timeout(60000);

    console.log('\n📝 STEP 3: Writing test file to backend polyrepo');

    const testContent = `function testPolyrepo() {
  Logger.log('Testing polyrepo git auto-init workflow');
  return 'success';
}

function validateSetup() {
  const result = testPolyrepo();
  if (result === 'success') {
    Logger.log('✅ Polyrepo setup validated');
    return true;
  }
  return false;
}`;

    // Write file with custom commit message
    const mcpResult = await client.callTool('write', {
      scriptId: scriptId,
      path: 'TestModule',
      content: testContent,
      projectPath: projectPath,
      changeReason: 'feat: Add test polyrepo module'
    });

    // Parse MCP response format
    const result = client.parseToolResult(mcpResult);

    console.log('\n✅ Test file written');
    console.log('   Path: backend/TestModule');
    console.log('   Auto-commit:', result.git?.commitMessage || 'N/A');

    expect(result).to.have.property('success', true);
  });

  it('Step 4: Finish feature branch (squash merge)', async function() {
    this.timeout(60000);

    console.log('\n🔀 STEP 4: Finishing feature branch (squash merge)');

    // Use git_feature tool to finish branch
    const mcpResult = await client.callTool('git_feature', {
      operation: 'finish',
      scriptId: scriptId,
      projectPath: projectPath,
      deleteAfterMerge: true
    });

    // Parse MCP response format
    const result = client.parseToolResult(mcpResult);

    console.log('\n✅ Feature branch finished');
    console.log('   Result:', JSON.stringify(result, null, 2));

    expect(result).to.have.property('status', 'success');
  });

  it('Step 5: Verify complete workflow', async function() {
    this.timeout(30000);

    console.log('\n🔍 STEP 5: Verifying complete workflow');

    // List branches to confirm deletion
    const branchMcpResult = await client.callTool('git_feature', {
      operation: 'list',
      scriptId: scriptId,
      projectPath: projectPath
    });

    // Parse MCP response format
    const branchResult = client.parseToolResult(branchMcpResult);

    console.log('   Remaining branches:', branchResult.branches || []);

    // Read the file to confirm it exists
    const fileContent = await gas.readFile(scriptId, 'backend/TestModule');

    console.log('✅ File verified in GAS project');
    console.log('   Content length:', fileContent.length, 'characters');

    // List project files
    const files = await gas.listFiles(scriptId);
    console.log('   Total files in project:', files.length);

    expect(fileContent).to.include('testPolyrepo');
    expect(fileContent).to.include('validateSetup');

    console.log('\n🎉 COMPLETE WORKFLOW VERIFIED!');
    console.log('=====================================');
    console.log('✅ Git breadcrumb created');
    console.log('✅ Git auto-initialized in backend polyrepo');
    console.log('✅ Feature branch created');
    console.log('✅ File written with auto-commit');
    console.log('✅ Feature branch squash-merged');
    console.log('✅ File verified in GAS project');
    console.log('=====================================\n');
  });
});
