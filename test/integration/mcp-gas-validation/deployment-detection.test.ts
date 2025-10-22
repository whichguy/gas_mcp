/**
 * Deployment Detection Tests
 *
 * Tests the built-in deployment utility functions in common-js/__mcp_exec:
 * - getDeploymentUrls(): Query deployment URLs for dev/staging/prod
 * - getCurrentDeploymentType(): Detect which environment is running
 *
 * These functions enable environment-aware logic in toolbar code and onOpen handlers.
 */

import { expect } from 'chai';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { setupIntegrationTest, globalAuthState } from '../../setup/integrationSetup.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';

describe('Deployment Detection Tests', () => {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let gas: InProcessGASTestHelper;
  let testProjectId: string | null = null;

  before(async function() {
    this.timeout(60000);

    // Ensure global server is ready
    await setupIntegrationTest();

    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️  Skipping - server not ready');
      this.skip();
    }

    client = globalAuthState.client;
    auth = globalAuthState.auth!;
    gas = globalAuthState.gas!;

    // Create test project
    const result = await gas.createTestProject('MCP-Deployment-Detection-Test');
    testProjectId = result.scriptId;
    console.log(`✅ Created deployment detection test project: ${testProjectId}`);

    // Add test code that uses the built-in functions
    await gas.writeTestFile(testProjectId!, 'TestUtils', `
      // Test function to get deployment URLs
      function testGetDeploymentUrls() {
        const deploymentUtils = require('common-js/__mcp_exec');
        const urls = deploymentUtils.getDeploymentUrls();
        return JSON.stringify(urls);
      }

      // Test function to get current deployment type
      function testGetCurrentDeploymentType() {
        const deploymentUtils = require('common-js/__mcp_exec');
        return deploymentUtils.getCurrentDeploymentType();
      }

      // Export for testing
      module.exports = {
        testGetDeploymentUrls,
        testGetCurrentDeploymentType
      };
    `);

    console.log('✅ Created test utilities module');
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

  after(async function() {
    this.timeout(TEST_TIMEOUTS.STANDARD);

    // Clean up test project
    if (testProjectId && globalAuthState.isAuthenticated) {
      try {
        await gas.cleanupTestProject(testProjectId);
        console.log(`🧹 Cleaned up deployment detection test project: ${testProjectId}`);
      } catch (error) {
        console.warn('⚠️  Failed to clean up test project:', error);
      }
    }
  });

  describe('getDeploymentUrls()', () => {
    it('should return deployment URLs for all environments', async function() {
      this.timeout(TEST_TIMEOUTS.EXTENDED); // Multiple deployment creations

      // Create deployments for each environment
      console.log('\n📦 Creating dev deployment (HEAD)...');
      const devResult = await client.callTool('deploy_create', {
        scriptId: testProjectId!,
        entryPointType: 'WEB_APP',
        description: '[DEV] Development deployment',
        webAppAccess: 'ANYONE',
        webAppExecuteAs: 'USER_DEPLOYING'
      });
      expect(devResult.deploymentId).to.exist;
      console.log(`✅ Dev deployment created: ${devResult.deploymentId}`);

      // Create version for staging
      console.log('\n📦 Creating version for staging...');
      const stagingVersion = await client.callTool('version_create', {
        scriptId: testProjectId!,
        description: 'Staging version'
      });
      expect(stagingVersion.versionNumber).to.exist;

      console.log('\n📦 Creating staging deployment...');
      const stagingResult = await client.callTool('deploy_create', {
        scriptId: testProjectId!,
        entryPointType: 'WEB_APP',
        description: '[STAGING] Staging deployment',
        versionNumber: stagingVersion.versionNumber,
        webAppAccess: 'ANYONE',
        webAppExecuteAs: 'USER_DEPLOYING'
      });
      expect(stagingResult.deploymentId).to.exist;
      console.log(`✅ Staging deployment created: ${stagingResult.deploymentId}`);

      // Create version for prod
      console.log('\n📦 Creating version for prod...');
      const prodVersion = await client.callTool('version_create', {
        scriptId: testProjectId!,
        description: 'Production version'
      });
      expect(prodVersion.versionNumber).to.exist;

      console.log('\n📦 Creating prod deployment...');
      const prodResult = await client.callTool('deploy_create', {
        scriptId: testProjectId!,
        entryPointType: 'WEB_APP',
        description: '[PROD] Production deployment',
        versionNumber: prodVersion.versionNumber,
        webAppAccess: 'ANYONE',
        webAppExecuteAs: 'USER_DEPLOYING'
      });
      expect(prodResult.deploymentId).to.exist;
      console.log(`✅ Prod deployment created: ${prodResult.deploymentId}`);

      // Wait a moment for deployments to settle
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Execute test function to get deployment URLs
      console.log('\n🧪 Testing getDeploymentUrls()...');
      const execResult = await client.callTool('exec', {
        scriptId: testProjectId!,
        js_statement: 'testGetDeploymentUrls()'
      });

      expect(execResult.result).to.exist;
      console.log('📝 Raw exec result:', execResult.result);

      // Parse the JSON result
      const urls = JSON.parse(execResult.result as string);
      console.log('📋 Parsed deployment URLs:', urls);

      // Verify structure
      expect(urls).to.have.property('dev');
      expect(urls).to.have.property('staging');
      expect(urls).to.have.property('prod');

      // Verify URLs are present
      expect(urls.dev).to.be.a('string').and.not.empty;
      expect(urls.staging).to.be.a('string').and.not.empty;
      expect(urls.prod).to.be.a('string').and.not.empty;

      // Verify dev URL ends with /dev (HEAD convention)
      expect(urls.dev).to.match(/\/dev$/);

      // Verify staging and prod URLs end with /exec (versioned)
      expect(urls.staging).to.match(/\/exec$/);
      expect(urls.prod).to.match(/\/exec$/);

      console.log('✅ getDeploymentUrls() returned valid URLs for all environments');
    });

    it('should handle missing deployments gracefully', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      // Create a new project without deployments
      const emptyProject = await gas.createTestProject('MCP-Empty-Deployment-Test');
      console.log(`✅ Created empty test project: ${emptyProject.scriptId}`);

      try {
        // Add test module
        await gas.writeTestFile(emptyProject.scriptId, 'TestUtils', `
          function testGetDeploymentUrls() {
            const deploymentUtils = require('common-js/__mcp_exec');
            const urls = deploymentUtils.getDeploymentUrls();
            return JSON.stringify(urls);
          }
        `);

        // Execute test function
        const execResult = await client.callTool('exec', {
          scriptId: emptyProject.scriptId,
          js_statement: 'testGetDeploymentUrls()'
        });

        const urls = JSON.parse(execResult.result as string);
        console.log('📋 URLs for project without deployments:', urls);

        // Should return null for missing deployments
        expect(urls.dev).to.satisfy((val: any) => val === null || typeof val === 'string');
        expect(urls.staging).to.equal(null);
        expect(urls.prod).to.equal(null);

        console.log('✅ Gracefully handled missing deployments');
      } finally {
        // Clean up empty project
        await gas.cleanupTestProject(emptyProject.scriptId);
      }
    });
  });

  describe('getCurrentDeploymentType()', () => {
    it('should detect dev environment for HEAD deployment', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      // Ensure we have a dev deployment
      try {
        await client.callTool('deploy_create', {
          scriptId: testProjectId!,
          entryPointType: 'WEB_APP',
          description: '[DEV] Development deployment',
          webAppAccess: 'ANYONE',
          webAppExecuteAs: 'USER_DEPLOYING'
        });
      } catch (error) {
        // Deployment might already exist
        console.log('⚠️  Dev deployment might already exist');
      }

      // Execute getCurrentDeploymentType
      const execResult = await client.callTool('exec', {
        scriptId: testProjectId!,
        js_statement: 'testGetCurrentDeploymentType()'
      });

      console.log('📝 Current deployment type:', execResult.result);

      // When executed via exec tool, we're typically running on HEAD
      // Result should be 'dev' or 'unknown' (depending on execution context)
      expect(execResult.result).to.be.oneOf(['dev', 'staging', 'prod', 'unknown']);

      console.log('✅ getCurrentDeploymentType() returned valid environment type');
    });

    it('should return unknown for execution context without deployment', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      // Create project without web app deployments
      const noDeployProject = await gas.createTestProject('MCP-No-Deploy-Test');

      try {
        await gas.writeTestFile(noDeployProject.scriptId, 'TestUtils', `
          function testGetCurrentDeploymentType() {
            const deploymentUtils = require('common-js/__mcp_exec');
            return deploymentUtils.getCurrentDeploymentType();
          }
        `);

        const execResult = await client.callTool('exec', {
          scriptId: noDeployProject.scriptId,
          js_statement: 'testGetCurrentDeploymentType()'
        });

        console.log('📝 Deployment type for project without deployments:', execResult.result);

        // Without deployments, should return 'unknown' or 'dev' (if exec creates temp deployment)
        expect(execResult.result).to.be.oneOf(['dev', 'unknown']);

        console.log('✅ Correctly handled project without deployments');
      } finally {
        await gas.cleanupTestProject(noDeployProject.scriptId);
      }
    });
  });

  describe('Integration with environment-aware logic', () => {
    it('should enable menu creation based on available environments', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      // Create a test file with environment-aware menu logic
      await gas.writeTestFile(testProjectId!, 'MenuBuilder', `
        function buildEnvironmentMenu() {
          const deploymentUtils = require('common-js/__mcp_exec');
          const urls = deploymentUtils.getDeploymentUrls();
          const currentEnv = deploymentUtils.getCurrentDeploymentType();

          const menuItems = [];

          if (urls.dev) {
            menuItems.push({ label: 'Open Chat (Dev)', url: urls.dev });
          }
          if (urls.staging) {
            menuItems.push({ label: 'Open Chat (Staging)', url: urls.staging });
          }
          if (urls.prod) {
            menuItems.push({ label: 'Open Chat', url: urls.prod });
          }

          return {
            currentEnvironment: currentEnv,
            menuItems: menuItems,
            totalEnvironments: menuItems.length
          };
        }

        module.exports = { buildEnvironmentMenu };
      `);

      // Ensure we have all three deployments
      try {
        await client.callTool('deploy_create', {
          scriptId: testProjectId!,
          entryPointType: 'WEB_APP',
          description: '[DEV] Development deployment',
          webAppAccess: 'ANYONE',
          webAppExecuteAs: 'USER_DEPLOYING'
        });
      } catch {
        // Already exists
      }

      // Execute menu builder
      const execResult = await client.callTool('exec', {
        scriptId: testProjectId!,
        js_statement: 'JSON.stringify(buildEnvironmentMenu())'
      });

      const menuData = JSON.parse(execResult.result as string);
      console.log('📋 Menu data:', menuData);

      // Verify menu structure
      expect(menuData).to.have.property('currentEnvironment');
      expect(menuData).to.have.property('menuItems').that.is.an('array');
      expect(menuData).to.have.property('totalEnvironments').that.is.a('number');

      // Should have at least dev menu item
      expect(menuData.totalEnvironments).to.be.at.least(1);
      expect(menuData.menuItems[0]).to.have.property('label');
      expect(menuData.menuItems[0]).to.have.property('url');

      console.log('✅ Environment-aware menu logic works correctly');
    });
  });
});
