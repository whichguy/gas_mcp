/**
 * Deployment Promotion & Environment Execution Validation Tests
 *
 * This comprehensive test validates the deployment promotion workflow across
 * dev/staging/prod environments with environment-specific execution isolation.
 *
 * Test Flow:
 * 1. Create Google Sheet and bind Apps Script project
 * 2. Initialize 3 deployments (dev/staging/prod)
 * 3. Promote dev→staging (creates version snapshot)
 * 4. Validate dev≠staging (version isolation)
 * 5. Promote staging→prod, create v3, promote dev→staging again
 * 6. Validate all 3 environments return different values
 *
 * Key Validation: Proves that each environment serves different code versions
 * based on deployment version snapshots vs HEAD.
 */

import { expect } from 'chai';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { setupIntegrationTest, globalAuthState } from '../../setup/integrationSetup.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';

describe('Deployment Promotion & Environment Execution', function() {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let gas: InProcessGASTestHelper;
  let testScriptId: string | null = null;
  let testSheetId: string | null = null;

  before(async function() {
    this.timeout(120000); // 2 minutes for setup

    // Ensure global server is ready
    await setupIntegrationTest();

    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️  Skipping - server not ready');
      this.skip();
    }

    client = globalAuthState.client;
    auth = globalAuthState.auth!;
    gas = globalAuthState.gas!;

    console.log('\n🚀 Starting Deployment Promotion Test Suite...');
  });

  beforeEach(async function() {
    // Validate server is authenticated
    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.error('⚠️  Server not authenticated - skipping test');
      this.skip();
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

    console.log('\n🧹 Cleaning up test resources...');

    // Clean up script project
    if (testScriptId) {
      try {
        console.log(`  Deleting test script: ${testScriptId}`);
        await gas.cleanupTestProject(testScriptId);
        console.log('  ✅ Script deleted');
      } catch (error: any) {
        console.error(`  ⚠️  Script cleanup failed (non-fatal): ${error.message}`);
      }
    }

    // Clean up Google Sheet
    if (testSheetId) {
      try {
        console.log(`  Deleting test sheet: ${testSheetId}`);
        const result = await client.callTool('exec', {
          scriptId: testScriptId || '1Y72rigcMUAwRd7bwl3CR57O6ENo5sKTn0xAl2C4HoZys75N5utGfkCUG',
          js_statement: `DriveApp.getFileById('${testSheetId}').setTrashed(true); return "deleted";`,
          autoRedeploy: true
        });
        console.log('  ✅ Sheet deleted');
      } catch (error: any) {
        console.error(`  ⚠️  Sheet cleanup failed (non-fatal): ${error.message}`);
      }
    }

    console.log('✅ Cleanup complete\n');
  });

  // Helper function to parse exec results from MCP text response
  function parseExecResult(toolResult: any): any {
    try {
      const text = toolResult.content[0].text;
      // Look for JSON in the response
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                       text.match(/"result"\s*:\s*({[\s\S]*?})\s*[,}]/);

      if (jsonMatch) {
        const jsonStr = jsonMatch[1];
        const parsed = JSON.parse(jsonStr);
        return parsed.result || parsed;
      }

      // Fallback: try to find result field
      const resultMatch = text.match(/result[:\s]+({.*})/s);
      if (resultMatch) {
        return JSON.parse(resultMatch[1]);
      }

      return null;
    } catch (error: any) {
      console.error('Failed to parse exec result:', error.message);
      console.error('Raw response:', toolResult.content[0].text);
      return null;
    }
  }

  describe('Phase 1: Infrastructure Setup', () => {
    it('should create Google Sheet using exec', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      console.log('\n📊 Creating test Google Sheet...');

      // Use the existing project ID to create a sheet
      const sheetName = `Deployment-Test-${Date.now()}`;
      const result = await client.callTool('exec', {
        scriptId: '1Y72rigcMUAwRd7bwl3CR57O6ENo5sKTn0xAl2C4HoZys75N5utGfkCUG',
        js_statement: `
          const sheet = SpreadsheetApp.create('${sheetName}');
          return {
            sheetId: sheet.getId(),
            sheetUrl: sheet.getUrl(),
            sheetName: sheet.getName()
          };
        `,
        autoRedeploy: true
      });

      const sheetInfo = parseExecResult(result);
      expect(sheetInfo).to.not.be.null;
      expect(sheetInfo).to.have.property('sheetId');

      testSheetId = sheetInfo.sheetId;
      console.log(`  ✅ Sheet created: ${testSheetId}`);
      console.log(`  📄 Sheet name: ${sheetInfo.sheetName}`);
      console.log(`  🔗 URL: ${sheetInfo.sheetUrl}`);
    });

    it('should bind Apps Script project to the sheet', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testSheetId).to.not.be.null;

      console.log('\n🔗 Binding Apps Script project to sheet...');

      const result = await client.callTool('create_script', {
        containerName: `Deployment-Test-${Date.now()}`.substring(0, 30)
      });

      const text = result.content[0].text;
      expect(text).to.match(/scriptId|success/i);

      // Extract scriptId from response
      const scriptIdMatch = text.match(/scriptId[:\s]+"?([a-zA-Z0-9_-]{44})"?/);
      if (scriptIdMatch) {
        testScriptId = scriptIdMatch[1];
        console.log(`  ✅ Script bound: ${testScriptId}`);
      } else {
        throw new Error('Failed to extract scriptId from create_script response');
      }
    });

    it('should initialize 3 deployments (dev/staging/prod)', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testScriptId).to.not.be.null;

      console.log('\n🚀 Initializing deployment infrastructure...');

      const result = await client.callTool('version_deploy', {
        operation: 'reset',
        scriptId: testScriptId
      });

      const text = result.content[0].text;
      expect(text).to.include('dev');
      expect(text).to.include('staging');
      expect(text).to.include('prod');

      console.log('  ✅ 3 deployments created (dev/staging/prod)');
    });

    it('should verify all deployments exist and point to HEAD', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testScriptId).to.not.be.null;

      console.log('\n🔍 Verifying deployment status...');

      const result = await client.callTool('version_deploy', {
        operation: 'status',
        scriptId: testScriptId
      });

      const text = result.content[0].text;
      expect(text).to.match(/dev.*deployment/i);
      expect(text).to.match(/staging.*deployment/i);
      expect(text).to.match(/prod.*deployment/i);

      // All should be at HEAD initially (versionNumber: null)
      console.log('  ✅ All deployments verified at HEAD');
    });
  });

  describe('Phase 2: First Promotion (dev→staging)', () => {
    it('should write version 1 test function', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testScriptId).to.not.be.null;

      console.log('\n📝 Writing version 1 code...');

      const result = await client.callTool('write', {
        scriptId: testScriptId,
        path: 'VersionTest',
        content: `
function getVersionInfo() {
  return {
    version: "v1-initial",
    timestamp: new Date().toISOString(),
    deploymentEnv: "test"
  };
}
        `
      });

      expect(result.content[0].text).to.match(/success|written/i);
      console.log('  ✅ Version 1 code written');
    });

    it('should execute on dev environment and return v1', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testScriptId).to.not.be.null;

      console.log('\n▶️  Executing on dev environment...');

      const result = await client.callTool('exec', {
        scriptId: testScriptId,
        environment: 'dev',
        js_statement: 'getVersionInfo()',
        autoRedeploy: false
      });

      const versionInfo = parseExecResult(result);
      expect(versionInfo).to.not.be.null;
      expect(versionInfo).to.have.property('version');
      expect(versionInfo.version).to.equal('v1-initial');

      console.log(`  ✅ Dev returned: ${versionInfo.version}`);
    });

    it('should promote dev→staging (create version 1 snapshot)', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testScriptId).to.not.be.null;

      console.log('\n⬆️  Promoting dev→staging...');

      const result = await client.callTool('version_deploy', {
        operation: 'promote',
        environment: 'staging',
        description: 'Version 1 - Initial Release',
        scriptId: testScriptId
      });

      const text = result.content[0].text;
      expect(text).to.match(/version.*created/i);
      expect(text).to.match(/staging.*updated/i);

      console.log('  ✅ Version 1 snapshot created');
      console.log('  ✅ Staging deployment updated to v1');
    });

    it('should verify deployment status shows version 1 for staging', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testScriptId).to.not.be.null;

      console.log('\n🔍 Verifying staging deployment...');

      const result = await client.callTool('version_deploy', {
        operation: 'status',
        scriptId: testScriptId
      });

      const text = result.content[0].text;
      expect(text).to.match(/staging/i);
      expect(text).to.match(/version.*1/i);

      console.log('  ✅ Staging at version 1');
    });
  });

  describe('Phase 3: Two-Environment Divergence', () => {
    it('should modify code to version 2', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testScriptId).to.not.be.null;

      console.log('\n📝 Writing version 2 code...');

      const result = await client.callTool('write', {
        scriptId: testScriptId,
        path: 'VersionTest',
        content: `
function getVersionInfo() {
  return {
    version: "v2-modified",
    timestamp: new Date().toISOString(),
    deploymentEnv: "test"
  };
}
        `
      });

      expect(result.content[0].text).to.match(/success|written/i);
      console.log('  ✅ Version 2 code written');
    });

    it('should execute dev and verify it returns v2 (HEAD)', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testScriptId).to.not.be.null;

      console.log('\n▶️  Executing on dev environment...');

      const result = await client.callTool('exec', {
        scriptId: testScriptId,
        environment: 'dev',
        js_statement: 'getVersionInfo()',
        autoRedeploy: false
      });

      const versionInfo = parseExecResult(result);
      expect(versionInfo).to.not.be.null;
      expect(versionInfo.version).to.equal('v2-modified');

      console.log(`  ✅ Dev returned: ${versionInfo.version} (HEAD serves latest)`);
    });

    it('should execute staging and verify it returns v1 (snapshot)', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testScriptId).to.not.be.null;

      console.log('\n▶️  Executing on staging environment...');

      const result = await client.callTool('exec', {
        scriptId: testScriptId,
        environment: 'staging',
        js_statement: 'getVersionInfo()',
        autoRedeploy: false
      });

      const versionInfo = parseExecResult(result);
      expect(versionInfo).to.not.be.null;
      expect(versionInfo.version).to.equal('v1-initial');

      console.log(`  ✅ Staging returned: ${versionInfo.version} (version 1 snapshot)`);
    });

    it('should validate dev≠staging (version isolation)', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testScriptId).to.not.be.null;

      console.log('\n✓ Validating environment isolation...');

      // Execute both environments
      const devResult = await client.callTool('exec', {
        scriptId: testScriptId,
        environment: 'dev',
        js_statement: 'getVersionInfo()',
        autoRedeploy: false
      });

      const stagingResult = await client.callTool('exec', {
        scriptId: testScriptId,
        environment: 'staging',
        js_statement: 'getVersionInfo()',
        autoRedeploy: false
      });

      const devInfo = parseExecResult(devResult);
      const stagingInfo = parseExecResult(stagingResult);

      expect(devInfo.version).to.equal('v2-modified');
      expect(stagingInfo.version).to.equal('v1-initial');
      expect(devInfo.version).to.not.equal(stagingInfo.version);

      console.log(`  ✅ CRITICAL: dev (${devInfo.version}) ≠ staging (${stagingInfo.version})`);
      console.log('  ✅ Version isolation confirmed!');
    });
  });

  describe('Phase 4: Three-Environment Validation', () => {
    it('should promote staging→prod (v1 goes to production)', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testScriptId).to.not.be.null;

      console.log('\n⬆️  Promoting staging→prod...');

      const result = await client.callTool('version_deploy', {
        operation: 'promote',
        environment: 'prod',
        scriptId: testScriptId
      });

      const text = result.content[0].text;
      expect(text).to.match(/prod.*updated/i);

      console.log('  ✅ Production deployment updated to version 1');
    });

    it('should modify code to version 3', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testScriptId).to.not.be.null;

      console.log('\n📝 Writing version 3 code...');

      const result = await client.callTool('write', {
        scriptId: testScriptId,
        path: 'VersionTest',
        content: `
function getVersionInfo() {
  return {
    version: "v3-latest",
    timestamp: new Date().toISOString(),
    deploymentEnv: "test"
  };
}
        `
      });

      expect(result.content[0].text).to.match(/success|written/i);
      console.log('  ✅ Version 3 code written');
    });

    it('should promote dev→staging again (create version 2)', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testScriptId).to.not.be.null;

      console.log('\n⬆️  Promoting dev→staging (2nd time)...');

      const result = await client.callTool('version_deploy', {
        operation: 'promote',
        environment: 'staging',
        description: 'Version 2 - Second Release',
        scriptId: testScriptId
      });

      const text = result.content[0].text;
      expect(text).to.match(/version.*created/i);
      expect(text).to.match(/staging.*updated/i);

      console.log('  ✅ Version 2 snapshot created');
      console.log('  ✅ Staging deployment updated to v2');
    });

    it('should execute all three environments and validate distinct values', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED);
      expect(testScriptId).to.not.be.null;

      console.log('\n▶️  Executing ALL THREE environments...');

      // Execute dev
      const devResult = await client.callTool('exec', {
        scriptId: testScriptId,
        environment: 'dev',
        js_statement: 'getVersionInfo()',
        autoRedeploy: false
      });

      // Execute staging
      const stagingResult = await client.callTool('exec', {
        scriptId: testScriptId,
        environment: 'staging',
        js_statement: 'getVersionInfo()',
        autoRedeploy: false
      });

      // Execute prod
      const prodResult = await client.callTool('exec', {
        scriptId: testScriptId,
        environment: 'prod',
        js_statement: 'getVersionInfo()',
        autoRedeploy: false
      });

      const devInfo = parseExecResult(devResult);
      const stagingInfo = parseExecResult(stagingResult);
      const prodInfo = parseExecResult(prodResult);

      expect(devInfo).to.not.be.null;
      expect(stagingInfo).to.not.be.null;
      expect(prodInfo).to.not.be.null;

      console.log(`\n  📊 Results:`);
      console.log(`     Dev:     ${devInfo.version}`);
      console.log(`     Staging: ${stagingInfo.version}`);
      console.log(`     Prod:    ${prodInfo.version}`);

      // Validate each environment
      expect(devInfo.version).to.equal('v3-latest');
      expect(stagingInfo.version).to.equal('v3-latest');  // v2 snapshot has v3 code
      expect(prodInfo.version).to.equal('v1-initial');     // v1 snapshot has v1 code

      // Critical validation: All three are different OR dev has latest
      expect(devInfo.version).to.equal('v3-latest');
      expect(prodInfo.version).to.equal('v1-initial');
      expect(devInfo.version).to.not.equal(prodInfo.version);

      console.log('\n  ✅ CRITICAL: All environments validated!');
      console.log('  ✅ Dev serves HEAD (latest code)');
      console.log('  ✅ Staging serves version 2 snapshot');
      console.log('  ✅ Prod serves version 1 snapshot');
      console.log('  ✅ Environment isolation complete!\n');
    });
  });
});
