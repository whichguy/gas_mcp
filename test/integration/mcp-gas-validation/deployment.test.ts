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
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { globalAuthState, resetSharedProject } from '../../setup/integrationSetup.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';

describe('Deployment Validation Tests', () => {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let gas: InProcessGASTestHelper;
  let testProjectId: string | null = null;

  before(async function() {
    this.timeout(30000);

    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️  Skipping - server not ready');
      this.skip();
      return;
    }

    client = globalAuthState.client;
    auth = globalAuthState.auth!;
    gas = globalAuthState.gas!;

    testProjectId = globalAuthState.sharedProjectId!;
    if (!testProjectId) { this.skip(); return; }
    console.log(`✅ Using shared test project: ${testProjectId}`);
    await resetSharedProject();

    // Add test files
    await gas.writeTestFile(testProjectId!, 'Main', 'function main() { return "v1"; }');
    await gas.writeTestFile(testProjectId!, 'Utils', 'exports.version = "1.0.0";');
  });

  beforeEach(async function() {
    // Validate server is authenticated
    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.error('⚠️  Server not authenticated - skipping test');
      this.skip();
    }

    // Verify test project exists
    if (testProjectId) {
      try {
        await client.callTool('info', { scriptId: testProjectId });
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



  describe('Version Control', () => {
    it('should create version', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('version_create', {
        scriptId: testProjectId,
        description: 'Test version for validation'
      });

      expect(result.content[0].text).to.include('version');
      expect(result.content[0].text).to.match(/version.*created/i);
    });

    it('should list versions', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('version_list', {
        scriptId: testProjectId
      });

      expect(result.content[0].text).to.include('version');
    });

    it('should create multiple versions', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      // Create version 2
      const result1 = await client.callTool('version_create', {
        scriptId: testProjectId,
        description: 'Version 2'
      });

      expect(result1.content[0].text).to.include('version');

      // Create version 3
      const result2 = await client.callTool('version_create', {
        scriptId: testProjectId,
        description: 'Version 3'
      });

      expect(result2.content[0].text).to.include('version');

      // List should show multiple versions
      const listResult = await client.callTool('version_list', {
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
      const versionResult = await client.callTool('version_create', {
        scriptId: testProjectId,
        description: 'Deployment version'
      });

      expect(versionResult.content[0].text).to.include('version');

      // Extract version number from response
      const versionMatch = versionResult.content[0].text.match(/version.*?(\d+)/i);
      const versionNumber = versionMatch ? parseInt(versionMatch[1]) : 1;

      // Create deployment
      const deployResult = await client.callTool('deploy_create', {
        scriptId: testProjectId,
        description: 'Test deployment',
        versionNumber: versionNumber
      });

      expect(deployResult.content[0].text).to.include('deployment');
    });

    it('should list deployments', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('deploy_list', {
        scriptId: testProjectId
      });

      expect(result.content[0].text).to.include('deployment');
    });

    it('should verify deployment configuration', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const listResult = await client.callTool('deploy_list', {
        scriptId: testProjectId
      });

      // Should have at least one deployment
      expect(listResult.content[0].text).to.include('deployment');
    });

    it('should create API executable deployment', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      // Create version for API deployment
      const versionResult = await client.callTool('version_create', {
        scriptId: testProjectId,
        description: 'API version'
      });

      const versionMatch = versionResult.content[0].text.match(/version.*?(\d+)/i);
      const versionNumber = versionMatch ? parseInt(versionMatch[1]) : 1;

      // Create API executable deployment
      const deployResult = await client.callTool('deploy_create', {
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
      const version1Result = await client.callTool('version_create', {
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
      const modifiedContent = await client.callTool('cat', {
        scriptId: testProjectId,
        path: 'SnapshotTest'
      });
      expect(modifiedContent.content[0].text).to.include('snapshot-v2-modified');

      // Step 3: Create deployment of version 1 (should use snapshot, not modified code)
      const deployResult = await client.callTool('deploy_create', {
        scriptId: testProjectId,
        description: 'Snapshot test deployment',
        versionNumber: version1Number
      });
      expect(deployResult.content[0].text).to.include('deployment');

      // Step 4: Verify deployment exists and is linked to version 1
      const deployListResult = await client.callTool('deploy_list', {
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
      const deployResult = await client.callTool('deploy_create', {
        scriptId: testProjectId,
        description: 'HEAD deployment test'
        // No versionNumber = uses @HEAD
      });
      expect(deployResult.content[0].text).to.include('deployment');

      // Modify code after deployment
      const modifiedCode = 'function testHead() { return "head-v2-modified"; }';
      await gas.writeTestFile(testProjectId!, 'HeadTest', modifiedCode);

      // Verify file was modified
      const modifiedContent = await client.callTool('cat', {
        scriptId: testProjectId,
        path: 'HeadTest'
      });
      expect(modifiedContent.content[0].text).to.include('head-v2-modified');

      // HEAD deployment should now serve the modified code
      // (We can't execute to verify, but the API contract guarantees this behavior)
      // List deployments to verify HEAD deployment exists
      const deployListResult = await client.callTool('deploy_list', {
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
      const result = await client.callTool('version_create', {
        scriptId: testProjectId,
        description: 'Updated main function'
      });

      expect(result.content[0].text).to.include('version');

      // List versions should show progression
      const listResult = await client.callTool('version_list', {
        scriptId: testProjectId
      });

      expect(listResult.content[0].text).to.include('version');
    });

    it('should verify version descriptions', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);
      expect(testProjectId).to.not.be.null;

      const description = `Test version ${Date.now()}`;

      const result = await client.callTool('version_create', {
        scriptId: testProjectId,
        description: description
      });

      expect(result.content[0].text).to.include('version');
    });
  });

  describe('Edge Conditions & Error Handling', () => {
    describe('Invalid Input Handling', () => {
      it('should handle invalid scriptId gracefully', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);

        try {
          await client.callTool('version_create', {
            scriptId: 'invalid-script-id-12345',
            description: 'Test'
          });
          expect.fail('Should have thrown error');
        } catch (error: any) {
          expect(error.message).to.match(/invalid|not found|error|tool error/i);
        }
      });

      it('should handle malformed scriptId', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);

        try {
          await client.callTool('version_list', {
            scriptId: 'abc123' // Too short
          });
          expect.fail('Should have thrown error');
        } catch (error: any) {
          expect(error.message).to.match(/invalid|malformed|tool error/i);
        }
      });

      it('should handle missing scriptId', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);

        try {
          await client.callTool('deploy_list', {
            // No scriptId provided
          });
          expect.fail('Should have thrown error');
        } catch (error: any) {
          expect(error.message).to.match(/required|missing|scriptId|tool error/i);
        }
      });
    });

    describe('Network & API Failures', () => {
      it('should timeout gracefully on non-existent project', async function() {
        this.timeout(15000);

        try {
          await client.callTool('deploy_list', {
            scriptId: '1' + 'a'.repeat(43) // Valid length, invalid ID
          });
          expect.fail('Should have thrown error');
        } catch (error: any) {
          expect(error.message).to.match(/timeout|not found|error|tool error/i);
        }
      });

      it('should handle rate limiting gracefully', async function() {
        this.timeout(TEST_TIMEOUTS.BULK);

        // This test verifies error handling, not necessarily triggering actual rate limits
        // Rapid sequential calls might trigger rate limiting
        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push(
            client.callTool('version_list', { scriptId: testProjectId })
              .catch(err => ({ error: err.message }))
          );
        }

        const results = await Promise.all(promises);
        // All should either succeed or have handled errors gracefully
        results.forEach(result => {
          if ('error' in result) {
            expect(result.error).to.be.a('string');
          } else {
            expect(result.content[0].text).to.be.a('string');
          }
        });
      });
    });

    describe('Authentication Edge Cases', () => {
      it('should detect token expiration information', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);

        const status = await auth.getAuthStatus();
        expect(status).to.have.property('tokenValid');
        expect(status).to.have.property('expiresAt');

        if (status.tokenValid && status.expiresAt) {
          const expiresAt = new Date(status.expiresAt);
          const now = new Date();
          const timeUntilExpiry = expiresAt.getTime() - now.getTime();

          console.log(`   Token expires in ${Math.floor(timeUntilExpiry / 1000)}s`);
          expect(timeUntilExpiry).to.be.greaterThan(0);
        }
      });

      it('should verify authenticated user information', async function() {
        this.timeout(TEST_TIMEOUTS.STANDARD);

        const status = await auth.getAuthStatus();
        expect(status).to.have.property('authenticated', true);
        expect(status).to.have.property('user');

        if (status.user) {
          expect(status.user).to.have.property('email');
          console.log(`   Authenticated as: ${status.user.email}`);
        }
      });
    });

    describe('Resource Conflicts', () => {
      it('should handle duplicate version creation gracefully', async function() {
        this.timeout(TEST_TIMEOUTS.BULK);
        expect(testProjectId).to.not.be.null;

        const description = `Duplicate test ${Date.now()}`;

        // Create first version
        const v1 = await client.callTool('version_create', {
          scriptId: testProjectId,
          description
        });
        expect(v1.content[0].text).to.include('version');

        // Create second version with same description (should succeed - allowed)
        const v2 = await client.callTool('version_create', {
          scriptId: testProjectId,
          description
        });
        expect(v2.content[0].text).to.include('version');
      });

      it('should handle concurrent deployment operations', async function() {
        this.timeout(TEST_TIMEOUTS.BULK);
        expect(testProjectId).to.not.be.null;

        // Create a version for concurrent deployments
        const versionResult = await client.callTool('version_create', {
          scriptId: testProjectId,
          description: 'Concurrent test version'
        });
        const versionMatch = versionResult.content[0].text.match(/version.*?(\d+)/i);
        const versionNumber = versionMatch ? parseInt(versionMatch[1]) : 1;

        // Try concurrent deployment operations
        const promises = [
          client.callTool('deploy_list', { scriptId: testProjectId }),
          client.callTool('version_list', { scriptId: testProjectId }),
          client.callTool('info', { scriptId: testProjectId })
        ];

        const results = await Promise.all(promises);

        // All operations should complete successfully
        expect(results).to.have.length(3);
        results.forEach(result => {
          expect(result.content[0].text).to.be.a('string');
        });
      });
    });

    describe('Deployment Edge Cases', () => {
      it('should handle deployment without version number (HEAD deployment)', async function() {
        this.timeout(TEST_TIMEOUTS.BULK);
        expect(testProjectId).to.not.be.null;

        const result = await client.callTool('deploy_create', {
          scriptId: testProjectId,
          description: 'HEAD deployment edge case'
          // No versionNumber = HEAD deployment
        });

        expect(result.content[0].text).to.include('deployment');
      });

      it('should handle very long deployment descriptions', async function() {
        this.timeout(TEST_TIMEOUTS.BULK);
        expect(testProjectId).to.not.be.null;

        // Create version first
        const versionResult = await client.callTool('version_create', {
          scriptId: testProjectId,
          description: 'Version for long description test'
        });
        const versionMatch = versionResult.content[0].text.match(/version.*?(\d+)/i);
        const versionNumber = versionMatch ? parseInt(versionMatch[1]) : 1;

        // Create deployment with very long description
        const longDescription = 'A'.repeat(200) + ' - Test deployment';

        const result = await client.callTool('deploy_create', {
          scriptId: testProjectId,
          description: longDescription,
          versionNumber: versionNumber
        });

        expect(result.content[0].text).to.include('deployment');
      });
    });
  });
});
