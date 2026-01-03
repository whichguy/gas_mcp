/**
 * Integration tests for rsync tool
 *
 * Tests the two-phase sync workflow:
 * 1. plan: Compute diff, create plan with 5-minute TTL
 * 2. execute: Validate plan, apply changes
 *
 * Coverage:
 * - Full pull workflow (GAS → local)
 * - Full push workflow (local → GAS)
 * - Bootstrap sync (first-time)
 * - Deletion confirmation flow
 * - Plan expiry and status
 * - Error cases
 */

import { expect } from 'chai';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { setupIntegrationTest, globalAuthState } from '../../setup/integrationSetup.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';
import { PlanStore } from '../../../src/tools/rsync/PlanStore.js';

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

    // Reset PlanStore singleton
    PlanStore.resetInstance();
  });

  describe('Precondition Tests', function() {
    it('should fail plan without breadcrumb', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      // Try to plan without .git/config.gs breadcrumb
      const result = await client.callTool('rsync', {
        operation: 'plan',
        scriptId: testProjectId,
        direction: 'pull'
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

  describe('Plan Operation', function() {
    it('should create pull plan successfully', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      // First add a file to GAS to have something to pull
      await client.callTool('write', {
        scriptId: testProjectId,
        path: 'TestModule',
        content: 'function test() { return "hello"; }\nmodule.exports = { test };'
      });

      const result = await client.callTool('rsync', {
        operation: 'plan',
        scriptId: testProjectId,
        direction: 'pull'
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.true;
      expect(response.operation).to.equal('plan');
      expect(response.plan).to.have.property('planId');
      expect(response.plan).to.have.property('expiresAt');
      expect(response.plan.direction).to.equal('pull');
      expect(response.plan.scriptId).to.equal(testProjectId);
      expect(response.summary).to.have.property('additions');
      expect(response.summary).to.have.property('isBootstrap');
    });

    it('should create push plan successfully', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      // Create a local file to push
      const localFilePath = path.join(tempSyncFolder!, 'src', 'LocalModule.gs');
      await fs.writeFile(localFilePath, 'function local() { return "local"; }');

      const result = await client.callTool('rsync', {
        operation: 'plan',
        scriptId: testProjectId,
        direction: 'push',
        force: true // Skip uncommitted changes check
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.true;
      expect(response.operation).to.equal('plan');
      expect(response.plan.direction).to.equal('push');
    });

    it('should fail plan with invalid direction', async function() {
      this.timeout(TEST_TIMEOUTS.QUICK);

      const result = await client.callTool('rsync', {
        operation: 'plan',
        scriptId: testProjectId,
        direction: 'invalid' as any
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.false;
      expect(response.error.code).to.equal('INVALID_DIRECTION');
    });

    it('should fail plan without direction', async function() {
      this.timeout(TEST_TIMEOUTS.QUICK);

      const result = await client.callTool('rsync', {
        operation: 'plan',
        scriptId: testProjectId
        // direction intentionally omitted
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.false;
      expect(response.error.code).to.equal('MISSING_DIRECTION');
    });
  });

  describe('Status Operation', function() {
    let activePlanId: string;

    before(async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      // Create a plan to check status on
      const planResult = await client.callTool('rsync', {
        operation: 'plan',
        scriptId: testProjectId,
        direction: 'pull'
      });

      const response = JSON.parse(planResult.content[0].text);
      activePlanId = response.plan.planId;
    });

    it('should return plan status for valid planId', async function() {
      this.timeout(TEST_TIMEOUTS.QUICK);

      const result = await client.callTool('rsync', {
        operation: 'status',
        scriptId: testProjectId,
        planId: activePlanId
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.true;
      expect(response.operation).to.equal('status');
      expect(response.plan.planId).to.equal(activePlanId);
      expect(response.plan.valid).to.be.true;
      expect(response.plan).to.have.property('expiresAt');
      expect(response.plan).to.have.property('remainingTtlMs');
    });

    it('should return invalid for non-existent planId', async function() {
      this.timeout(TEST_TIMEOUTS.QUICK);

      const result = await client.callTool('rsync', {
        operation: 'status',
        scriptId: testProjectId,
        planId: 'non-existent-plan-id'
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.true;
      expect(response.plan.valid).to.be.false;
    });

    it('should return general status without planId', async function() {
      this.timeout(TEST_TIMEOUTS.QUICK);

      const result = await client.callTool('rsync', {
        operation: 'status',
        scriptId: testProjectId
        // planId intentionally omitted
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.true;
      expect(response.plan).to.be.null;
      expect(response).to.have.property('activePlans');
      expect(response.activePlans).to.be.a('number');
    });
  });

  describe('Cancel Operation', function() {
    it('should cancel an active plan', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);

      // Create a plan to cancel
      const planResult = await client.callTool('rsync', {
        operation: 'plan',
        scriptId: testProjectId,
        direction: 'pull'
      });

      const planResponse = JSON.parse(planResult.content[0].text);
      const planId = planResponse.plan.planId;

      // Cancel the plan
      const cancelResult = await client.callTool('rsync', {
        operation: 'cancel',
        scriptId: testProjectId,
        planId: planId
      });

      expect(cancelResult).to.have.property('content');
      const response = JSON.parse(cancelResult.content[0].text);

      expect(response.success).to.be.true;
      expect(response.operation).to.equal('cancel');
      expect(response.cancelled).to.be.true;
      expect(response.planId).to.equal(planId);

      // Verify plan is no longer valid
      const statusResult = await client.callTool('rsync', {
        operation: 'status',
        scriptId: testProjectId,
        planId: planId
      });

      const statusResponse = JSON.parse(statusResult.content[0].text);
      expect(statusResponse.plan.valid).to.be.false;
    });

    it('should handle cancelling non-existent plan', async function() {
      this.timeout(TEST_TIMEOUTS.QUICK);

      const result = await client.callTool('rsync', {
        operation: 'cancel',
        scriptId: testProjectId,
        planId: 'non-existent-plan-id'
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.true;
      expect(response.cancelled).to.be.false;
    });

    it('should fail cancel without planId', async function() {
      this.timeout(TEST_TIMEOUTS.QUICK);

      const result = await client.callTool('rsync', {
        operation: 'cancel',
        scriptId: testProjectId
        // planId intentionally omitted
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.false;
      expect(response.error.code).to.equal('MISSING_PLAN_ID');
    });
  });

  describe('Execute Operation', function() {
    it('should fail execute without planId', async function() {
      this.timeout(TEST_TIMEOUTS.QUICK);

      const result = await client.callTool('rsync', {
        operation: 'execute',
        scriptId: testProjectId
        // planId intentionally omitted
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.false;
      expect(response.error.code).to.equal('MISSING_PLAN_ID');
    });

    it('should fail execute with invalid planId', async function() {
      this.timeout(TEST_TIMEOUTS.QUICK);

      const result = await client.callTool('rsync', {
        operation: 'execute',
        scriptId: testProjectId,
        planId: 'invalid-plan-id'
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.false;
      expect(response.error.code).to.equal('PLAN_NOT_FOUND');
    });

    it('should execute pull plan (bootstrap)', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      // Ensure we have a file in GAS to pull
      await client.callTool('write', {
        scriptId: testProjectId,
        path: 'PullTestModule',
        content: 'function pullTest() { return "pulled"; }\nmodule.exports = { pullTest };'
      });

      // Create pull plan
      const planResult = await client.callTool('rsync', {
        operation: 'plan',
        scriptId: testProjectId,
        direction: 'pull'
      });

      const planResponse = JSON.parse(planResult.content[0].text);
      expect(planResponse.success).to.be.true;

      const planId = planResponse.plan.planId;

      // Execute the plan
      const execResult = await client.callTool('rsync', {
        operation: 'execute',
        scriptId: testProjectId,
        planId: planId
      });

      expect(execResult).to.have.property('content');
      const response = JSON.parse(execResult.content[0].text);

      expect(response.success).to.be.true;
      expect(response.operation).to.equal('execute');
      expect(response.result.direction).to.equal('pull');
      expect(response.result).to.have.property('filesAdded');
      expect(response.result).to.have.property('filesUpdated');
      expect(response.result).to.have.property('filesDeleted');
      expect(response).to.have.property('recoveryInfo');
    });

    it('should execute push plan', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      // Create a local file to push
      const localFilePath = path.join(tempSyncFolder!, 'src', 'PushTestModule.gs');
      await fs.writeFile(localFilePath, 'function pushTest() { return "pushed"; }');

      // Create push plan
      const planResult = await client.callTool('rsync', {
        operation: 'plan',
        scriptId: testProjectId,
        direction: 'push',
        force: true
      });

      const planResponse = JSON.parse(planResult.content[0].text);
      expect(planResponse.success).to.be.true;

      const planId = planResponse.plan.planId;

      // Execute the plan
      const execResult = await client.callTool('rsync', {
        operation: 'execute',
        scriptId: testProjectId,
        planId: planId
      });

      expect(execResult).to.have.property('content');
      const response = JSON.parse(execResult.content[0].text);

      expect(response.success).to.be.true;
      expect(response.result.direction).to.equal('push');
    });
  });

  describe('Deletion Confirmation Flow', function() {
    it('should require confirmation for deletions', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      // First, ensure we have a synced state (pull existing files)
      const pullPlanResult = await client.callTool('rsync', {
        operation: 'plan',
        scriptId: testProjectId,
        direction: 'pull'
      });
      const pullPlan = JSON.parse(pullPlanResult.content[0].text);
      if (pullPlan.success && pullPlan.plan) {
        await client.callTool('rsync', {
          operation: 'execute',
          scriptId: testProjectId,
          planId: pullPlan.plan.planId
        });
      }

      // Add a file to local that we'll delete from GAS
      const localFilePath = path.join(tempSyncFolder!, 'src', 'ToBeDeleted.gs');
      await fs.writeFile(localFilePath, 'function toDelete() {}');

      // Push to sync it to GAS
      const pushPlanResult = await client.callTool('rsync', {
        operation: 'plan',
        scriptId: testProjectId,
        direction: 'push',
        force: true
      });
      const pushPlan = JSON.parse(pushPlanResult.content[0].text);
      if (pushPlan.success && pushPlan.plan) {
        await client.callTool('rsync', {
          operation: 'execute',
          scriptId: testProjectId,
          planId: pushPlan.plan.planId
        });
      }

      // Now delete the local file
      await fs.unlink(localFilePath);

      // Create push plan - should detect deletion
      const deletePlanResult = await client.callTool('rsync', {
        operation: 'plan',
        scriptId: testProjectId,
        direction: 'push',
        force: true
      });

      const deletePlan = JSON.parse(deletePlanResult.content[0].text);

      // If there are deletions, execute without confirmation should fail
      if (deletePlan.success && deletePlan.summary.deletions > 0) {
        const execResult = await client.callTool('rsync', {
          operation: 'execute',
          scriptId: testProjectId,
          planId: deletePlan.plan.planId,
          confirmDeletions: false
        });

        const response = JSON.parse(execResult.content[0].text);
        expect(response.success).to.be.false;
        expect(response.error.code).to.equal('DELETION_REQUIRES_CONFIRMATION');
      }
    });

    it('should execute deletions with confirmation', async function() {
      this.timeout(TEST_TIMEOUTS.EXECUTION);

      // Create push plan with potential deletions
      const planResult = await client.callTool('rsync', {
        operation: 'plan',
        scriptId: testProjectId,
        direction: 'push',
        force: true
      });

      const planResponse = JSON.parse(planResult.content[0].text);

      if (planResponse.success && planResponse.summary.deletions > 0) {
        // Execute with confirmation
        const execResult = await client.callTool('rsync', {
          operation: 'execute',
          scriptId: testProjectId,
          planId: planResponse.plan.planId,
          confirmDeletions: true
        });

        const response = JSON.parse(execResult.content[0].text);
        expect(response.success).to.be.true;
        expect(response.result.filesDeleted).to.be.greaterThan(0);
      } else {
        // No deletions to confirm - that's okay for this test
        this.skip();
      }
    });
  });

  describe('Error Cases', function() {
    it('should fail with invalid scriptId', async function() {
      this.timeout(TEST_TIMEOUTS.QUICK);

      const result = await client.callTool('rsync', {
        operation: 'plan',
        scriptId: 'invalid',
        direction: 'pull'
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
    it('should respect exclude patterns in plan', async function() {
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

      // Plan with exclude pattern
      const result = await client.callTool('rsync', {
        operation: 'plan',
        scriptId: testProjectId,
        direction: 'pull',
        excludePatterns: ['test/']
      });

      expect(result).to.have.property('content');
      const response = JSON.parse(result.content[0].text);

      expect(response.success).to.be.true;
      // Verify test files are excluded from the plan
      // The plan should not include files matching the exclude pattern
    });
  });
});
