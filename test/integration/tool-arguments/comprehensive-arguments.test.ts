import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { MCPGasTestHelper, GasTestContext } from '../../helpers/mcpGasTestHelpers.js';
import { ArgumentTestHelper } from './helpers/argument-test-helper.js';

/**
 * Comprehensive MCP Tool Argument Validation
 *
 * This test suite validates argument handling for ALL MCP Gas Server tools
 * using a SINGLE shared project to maximize performance.
 *
 * Coverage:
 * - Git tools (5 tools)
 * - Deployment tools (8 tools)
 * - Project context tools (4 tools)
 * - Version tools (2 tools)
 * - Process tools (2 tools)
 * - Log tools (2 tools)
 * - Trigger tools (3 tools)
 * - Local sync tools (3 tools)
 * - Advanced tools (context, summary, deps, tree)
 *
 * Performance: ~5 minutes (vs 20+ minutes with per-test projects)
 */
describe('MCP Tools: Comprehensive Argument Validation', function() {
  this.timeout(300000); // 5 minutes for full suite

  let context: GasTestContext;
  let sharedProjectId: string;

  before(async function() {
    this.timeout(60000); // 1 minute for setup

    // Create test context
    context = await MCPGasTestHelper.createTestContext({
      testName: 'comprehensive-args',
      requireAuth: true
    });

    if (!context.authenticated) {
      this.skip();
    }

    // Create ONE shared project for ALL tests
    console.log('Creating shared test project...');
    const result = await context.client.callAndParse('project_create', {
      title: `TEST_Comprehensive_${context.testId}_${Date.now()}`,
      localName: `test-comprehensive-${context.testId}-${Date.now()}`
    });
    sharedProjectId = result.scriptId;
    context.projectIds.push(sharedProjectId);

    // Upload test files for various tools
    await context.client.callAndParse('write', {
      scriptId: sharedProjectId,
      path: 'main',
      content: `
        function doGet() {
          return HtmlService.createHtmlOutput('Test');
        }
        function testFunc() { return "test"; }
      `
    });

    await context.client.callAndParse('write', {
      scriptId: sharedProjectId,
      path: 'utils',
      content: `
        function formatDate(date) { return date.toISOString(); }
        // TODO: Add timezone support
      `
    });

    console.log(`Shared project created: ${sharedProjectId}`);
  });

  after(async function() {
    await context.cleanup();
  });

  // ===== GIT SYNC TOOLS =====
  describe('Git Sync Tools', function() {
    describe('gas_git_init', function() {
      it('should accept minimal required arguments', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'git_init',
          {
            scriptId: sharedProjectId,
            repository: 'https://github.com/test/repo.git'
          },
          'minimal git_init arguments'
        );

        expect(result).to.have.property('success');
      });

      it('should reject missing scriptId', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'git_init',
          {
            repository: 'https://github.com/test/repo.git'
          },
          /scriptId|required/i,
          'scriptId is required'
        );
      });

      it('should reject missing repository', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'git_init',
          {
            scriptId: sharedProjectId
          },
          /repository|required/i,
          'repository is required'
        );
      });

      it('should reject invalid repository URL', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'git_init',
          {
            scriptId: sharedProjectId,
            repository: 'not-a-url'
          },
          /repository|url|invalid/i,
          'invalid repository URL'
        );
      });
    });

    describe('gas_git_status', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'git_status',
          { scriptId: sharedProjectId },
          'minimal git_status arguments'
        );

        expect(result).to.have.property('associated');
      });

      it('should reject missing scriptId', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'git_status',
          {},
          /scriptId|required/i,
          'scriptId is required'
        );
      });
    });

    describe('gas_git_set_sync_folder', function() {
      it('should accept valid sync folder path', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'git_set_sync_folder',
          {
            scriptId: sharedProjectId,
            syncFolder: '/tmp/test-sync'
          },
          'set sync folder'
        );

        expect(result).to.have.property('success');
      });

      it('should reject missing syncFolder', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'git_set_sync_folder',
          {
            scriptId: sharedProjectId
          },
          /syncFolder|required/i,
          'syncFolder is required'
        );
      });
    });

    describe('gas_git_get_sync_folder', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'git_get_sync_folder',
          { scriptId: sharedProjectId },
          'get sync folder'
        );

        expect(result).to.have.property('syncFolder');
      });
    });
  });

  // ===== DEPLOYMENT TOOLS =====
  describe('Deployment Tools', function() {
    describe('gas_deploy_create', function() {
      it('should accept minimal required arguments', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'deploy_create',
          {
            scriptId: sharedProjectId,
            versionNumber: 1,
            description: 'Test deployment'
          },
          'minimal deploy_create arguments'
        );

        expect(result).to.have.property('deploymentId');
      });

      it('should reject missing scriptId', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'deploy_create',
          {
            versionNumber: 1,
            description: 'Test'
          },
          /scriptId|required/i,
          'scriptId is required'
        );
      });

      it('should reject invalid versionNumber type', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'deploy_create',
          {
            scriptId: sharedProjectId,
            versionNumber: 'one',
            description: 'Test'
          },
          /versionNumber|number|type/i,
          'versionNumber must be number'
        );
      });
    });

    describe('gas_version_create', function() {
      it('should accept minimal required arguments', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'version_create',
          {
            scriptId: sharedProjectId,
            description: 'Test version'
          },
          'minimal version_create arguments'
        );

        expect(result).to.have.property('versionNumber');
      });

      it('should reject missing description', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'version_create',
          {
            scriptId: sharedProjectId
          },
          /description|required/i,
          'description is required'
        );
      });
    });

    describe('gas_deploy_list', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'deploy_list',
          { scriptId: sharedProjectId },
          'list deployments'
        );

        expect(result).to.have.property('deployments');
      });
    });

    describe('gas_deploy_get_details', function() {
      it('should accept scriptId and deploymentId', async function() {
        // First create a deployment
        const deploy = await context.client.callAndParse('deploy_create', {
          scriptId: sharedProjectId,
          versionNumber: 1,
          description: 'Test for details'
        });

        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'deploy_get_details',
          {
            scriptId: sharedProjectId,
            deploymentId: deploy.deploymentId
          },
          'get deployment details'
        );

        expect(result).to.have.property('deploymentId');
      });

      it('should reject missing deploymentId', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'deploy_get_details',
          {
            scriptId: sharedProjectId
          },
          /deploymentId|required/i,
          'deploymentId is required'
        );
      });
    });
  });

  // ===== PROJECT CONTEXT TOOLS =====
  describe('Project Context Tools', function() {
    describe('gas_project_set', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'project_set',
          { scriptId: sharedProjectId },
          'set current project'
        );

        expect(result).to.have.property('success');
      });

      it('should accept with autoPull flag', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'project_set',
          {
            scriptId: sharedProjectId,
            autoPull: false
          },
          'set project with autoPull=false'
        );

        expect(result).to.have.property('success');
      });

      it('should reject invalid autoPull type', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'project_set',
          {
            scriptId: sharedProjectId,
            autoPull: 'yes'
          },
          /autoPull|boolean|type/i,
          'autoPull must be boolean'
        );
      });
    });

    describe('gas_project_list', function() {
      it('should accept no arguments', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'project_list',
          {},
          'list all projects'
        );

        expect(result).to.have.property('projects');
      });
    });

    describe('gas_project_add', function() {
      it('should accept scriptId and name', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'project_add',
          {
            scriptId: sharedProjectId,
            name: 'test-project'
          },
          'add project to config'
        );

        expect(result).to.have.property('success');
      });

      it('should reject missing name', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'project_add',
          {
            scriptId: sharedProjectId
          },
          /name|required/i,
          'name is required'
        );
      });
    });
  });

  // ===== VERSION TOOLS =====
  describe('Version Tools', function() {
    describe('gas_version_list', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'version_list',
          { scriptId: sharedProjectId },
          'list versions'
        );

        expect(result).to.have.property('versions');
      });

      it('should accept with pageSize parameter', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'version_list',
          {
            scriptId: sharedProjectId,
            pageSize: 10
          },
          'list versions with pageSize'
        );

        expect(result).to.have.property('versions');
      });

      it('should reject invalid pageSize type', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'version_list',
          {
            scriptId: sharedProjectId,
            pageSize: 'ten'
          },
          /pageSize|number|type/i,
          'pageSize must be number'
        );
      });
    });

    describe('gas_version_get', function() {
      it('should accept scriptId and versionNumber', async function() {
        // Create a version first
        const version = await context.client.callAndParse('version_create', {
          scriptId: sharedProjectId,
          description: 'Test version for get'
        });

        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'version_get',
          {
            scriptId: sharedProjectId,
            versionNumber: version.versionNumber
          },
          'get version details'
        );

        expect(result).to.have.property('versionNumber');
      });

      it('should reject missing versionNumber', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'version_get',
          {
            scriptId: sharedProjectId
          },
          /versionNumber|required/i,
          'versionNumber is required'
        );
      });
    });
  });

  // ===== PROCESS TOOLS =====
  describe('Process Tools', function() {
    describe('gas_process_list', function() {
      it('should accept no arguments', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'process_list',
          {},
          'list user processes'
        );

        expect(result).to.have.property('processes');
      });

      it('should accept with pageSize parameter', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'process_list',
          { pageSize: 5 },
          'list processes with pageSize'
        );

        expect(result).to.have.property('processes');
      });

      it('should reject invalid pageSize type', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'process_list',
          { pageSize: 'five' },
          /pageSize|number|type/i,
          'pageSize must be number'
        );
      });
    });

    describe('gas_process_list_script', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'process_list_script',
          { scriptId: sharedProjectId },
          'list script processes'
        );

        expect(result).to.have.property('processes');
      });

      it('should accept with status filter', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'process_list_script',
          {
            scriptId: sharedProjectId,
            status: 'COMPLETED'
          },
          'list processes with status filter'
        );

        expect(result).to.have.property('processes');
      });

      it('should reject invalid status enum', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'process_list_script',
          {
            scriptId: sharedProjectId,
            status: 'INVALID_STATUS'
          },
          /status|invalid|enum/i,
          'invalid status value'
        );
      });
    });
  });

  // ===== LOG TOOLS =====
  describe('Log Tools', function() {
    describe('gas_logs_list', function() {
      it('should accept no arguments', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'logs_list',
          {},
          'list execution logs'
        );

        expect(result).to.have.property('logs');
      });

      it('should accept with filter parameter', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'logs_list',
          {
            filter: 'severity=ERROR'
          },
          'list logs with filter'
        );

        expect(result).to.have.property('logs');
      });

      it('should accept with pageSize parameter', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'logs_list',
          {
            pageSize: 10
          },
          'list logs with pageSize'
        );

        expect(result).to.have.property('logs');
      });
    });

    describe('gas_logs_get', function() {
      it('should accept processId only', async function() {
        // Note: This might fail if no processes exist, but tests parameter validation
        try {
          const result = await context.client.callAndParse('logs_get', {
            processId: 'test-process-id-123'
          });
          expect(result).to.exist;
        } catch (error: any) {
          // Should fail with "not found" not "required parameter"
          expect(error.message).to.not.match(/required|parameter/i);
        }
      });

      it('should reject missing processId', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'logs_get',
          {},
          /processId|required/i,
          'processId is required'
        );
      });
    });
  });

  // ===== TRIGGER TOOLS =====
  describe('Trigger Tools', function() {
    describe('gas_trigger_list', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'trigger_list',
          { scriptId: sharedProjectId },
          'list triggers'
        );

        expect(result).to.have.property('triggers');
      });
    });

    describe('gas_trigger_create', function() {
      it('should accept time-based trigger arguments', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'trigger_create',
          {
            scriptId: sharedProjectId,
            functionName: 'testFunc',
            eventType: 'CLOCK',
            timeBased: {
              type: 'HOURLY'
            }
          },
          'create time-based trigger'
        );

        expect(result).to.have.property('triggerId');
      });

      it('should reject missing functionName', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'trigger_create',
          {
            scriptId: sharedProjectId,
            eventType: 'CLOCK'
          },
          /functionName|required/i,
          'functionName is required'
        );
      });

      it('should reject invalid eventType enum', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'trigger_create',
          {
            scriptId: sharedProjectId,
            functionName: 'testFunc',
            eventType: 'INVALID_EVENT'
          },
          /eventType|invalid|enum/i,
          'invalid eventType value'
        );
      });
    });

    describe('gas_trigger_delete', function() {
      it('should accept scriptId and triggerId', async function() {
        // Create a trigger first
        const trigger = await context.client.callAndParse('trigger_create', {
          scriptId: sharedProjectId,
          functionName: 'testFunc',
          eventType: 'CLOCK',
          timeBased: { type: 'HOURLY' }
        });

        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'trigger_delete',
          {
            scriptId: sharedProjectId,
            triggerId: trigger.triggerId
          },
          'delete trigger'
        );

        expect(result).to.have.property('success');
      });

      it('should reject missing triggerId', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'trigger_delete',
          {
            scriptId: sharedProjectId
          },
          /triggerId|required/i,
          'triggerId is required'
        );
      });
    });
  });

  // ===== LOCAL SYNC TOOLS =====
  describe('Local Sync Tools', function() {
    describe('gas_pull', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'pull',
          { scriptId: sharedProjectId },
          'pull files to local'
        );

        expect(result).to.have.property('filesPulled');
      });

      it('should accept with force flag', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'pull',
          {
            scriptId: sharedProjectId,
            force: true
          },
          'pull with force=true'
        );

        expect(result).to.have.property('filesPulled');
      });

      it('should reject invalid force type', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'pull',
          {
            scriptId: sharedProjectId,
            force: 'yes'
          },
          /force|boolean|type/i,
          'force must be boolean'
        );
      });
    });

    describe('gas_push', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'push',
          { scriptId: sharedProjectId },
          'push files to remote'
        );

        expect(result).to.have.property('filesPushed');
      });

      it('should accept with dryRun flag', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'push',
          {
            scriptId: sharedProjectId,
            dryRun: true
          },
          'push with dryRun=true'
        );

        expect(result).to.have.property('filesPushed');
      });
    });

    describe('gas_status', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'status',
          { scriptId: sharedProjectId },
          'check sync status'
        );

        expect(result).to.have.property('status');
      });
    });
  });

  // ===== ADVANCED ANALYSIS TOOLS =====
  describe('Advanced Analysis Tools', function() {
    describe('gas_context', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'context',
          { scriptId: sharedProjectId },
          'get project context'
        );

        expect(result).to.have.property('context');
      });

      it('should accept with query parameter', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'context',
          {
            scriptId: sharedProjectId,
            query: 'function'
          },
          'get context with query'
        );

        expect(result).to.have.property('context');
      });
    });

    describe('gas_summary', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'summary',
          { scriptId: sharedProjectId },
          'get project summary'
        );

        expect(result).to.have.property('summary');
      });

      it('should accept with mode parameter', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'summary',
          {
            scriptId: sharedProjectId,
            mode: 'detailed'
          },
          'get summary with mode'
        );

        expect(result).to.have.property('summary');
      });
    });

    describe('gas_deps', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'deps',
          { scriptId: sharedProjectId },
          'analyze dependencies'
        );

        expect(result).to.have.property('dependencies');
      });
    });

    describe('gas_tree', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'tree',
          { scriptId: sharedProjectId },
          'show project tree'
        );

        expect(result).to.have.property('tree');
      });

      it('should accept with maxDepth parameter', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'tree',
          {
            scriptId: sharedProjectId,
            maxDepth: 3
          },
          'show tree with maxDepth'
        );

        expect(result).to.have.property('tree');
      });

      it('should reject invalid maxDepth type', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'tree',
          {
            scriptId: sharedProjectId,
            maxDepth: 'three'
          },
          /maxDepth|number|type/i,
          'maxDepth must be number'
        );
      });
    });
  });

  // ===== PROJECT INFO TOOLS =====
  describe('Project Info Tools', function() {
    describe('gas_info', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'info',
          { scriptId: sharedProjectId },
          'get project info'
        );

        expect(result).to.have.property('title');
      });
    });

    describe('gas_project_metrics', function() {
      it('should accept scriptId only', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'project_metrics',
          { scriptId: sharedProjectId },
          'get project metrics'
        );

        expect(result).to.have.property('metrics');
      });
    });

    describe('gas_reorder', function() {
      it('should accept scriptId and fileIds', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'reorder',
          {
            scriptId: sharedProjectId,
            fileIds: ['main', 'utils']
          },
          'reorder files'
        );

        expect(result).to.have.property('success');
      });

      it('should reject missing fileIds', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'reorder',
          {
            scriptId: sharedProjectId
          },
          /fileIds|required/i,
          'fileIds is required'
        );
      });

      it('should reject invalid fileIds type', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'reorder',
          {
            scriptId: sharedProjectId,
            fileIds: 'not-an-array'
          },
          /fileIds|array|type/i,
          'fileIds must be array'
        );
      });
    });
  });
});
