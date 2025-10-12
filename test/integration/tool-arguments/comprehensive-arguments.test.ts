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
 * - Git tools (2 tools: local_sync, config)
 * - Project management (1 tool: project_list)
 * - Process tools (2 tools)
 * - Log tools (1 tool: log with list/get operations)
 * - Trigger tools (1 tool: trigger with list/create/delete operations)
 * - Advanced tools (context, summary, deps, tree)
 * - Project info tools (reorder only, info removed)
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
  // NOTE: git_init tool was removed - users must manually create .git/config.gs breadcrumbs
  describe('Git Sync Tools', function() {
    describe('config - sync_folder get', function() {
      it('should accept scriptId only for get action', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'config',
          {
            action: 'get',
            type: 'sync_folder',
            scriptId: sharedProjectId
          },
          'get sync folder config'
        );

        expect(result).to.have.property('syncFolder');
      });
    });

    describe('config - sync_folder set', function() {
      it('should accept valid sync folder path for set action', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'config',
          {
            action: 'set',
            type: 'sync_folder',
            scriptId: sharedProjectId,
            value: '/tmp/test-sync'
          },
          'set sync folder config'
        );

        expect(result).to.have.property('success');
      });

      it('should reject missing value for set action', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'config',
          {
            action: 'set',
            type: 'sync_folder',
            scriptId: sharedProjectId
          },
          /value|required/i,
          'value is required for set action'
        );
      });

      it('should reject missing action parameter', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'config',
          {
            type: 'sync_folder',
            scriptId: sharedProjectId
          },
          /action|required/i,
          'action is required'
        );
      });
    });
  });

  // ===== PROJECT CONTEXT TOOLS =====
  // REMOVED: project_set, project_add, project_metrics (unused state management)
  describe('Project Context Tools', function() {
    describe('project_list', function() {
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
  });

  // ===== PROCESS TOOLS =====
  describe('Process Tools', function() {
    describe('process_list', function() {
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

    describe('process_list_script', function() {
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
  // Consolidated to single 'log' tool with 'operation' parameter
  describe('Log Tools', function() {
    describe('log (list operation)', function() {
      it('should accept scriptId with list operation', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'log',
          {
            operation: 'list',
            scriptId: sharedProjectId
          },
          'list execution logs'
        );

        expect(result).to.have.property('processes');
      });

      it('should accept with statusFilter parameter', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'log',
          {
            operation: 'list',
            scriptId: sharedProjectId,
            statusFilter: 'ALL'
          },
          'list logs with status filter'
        );

        expect(result).to.have.property('processes');
      });

      it('should accept with pageSize parameter', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'log',
          {
            operation: 'list',
            scriptId: sharedProjectId,
            pageSize: 10
          },
          'list logs with pageSize'
        );

        expect(result).to.have.property('processes');
      });
    });

    describe('log (get operation)', function() {
      it('should accept scriptId and processId', async function() {
        // Note: This might fail if no processes exist, but tests parameter validation
        try {
          const result = await context.client.callAndParse('log', {
            operation: 'get',
            scriptId: sharedProjectId,
            processId: 'test-process-id-123'
          });
          expect(result).to.exist;
        } catch (error: any) {
          // Should fail with "not found" not "required parameter"
          expect(error.message).to.not.match(/operation.*required|scriptId.*required/i);
        }
      });

      it('should reject missing processId', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'log',
          {
            operation: 'get',
            scriptId: sharedProjectId
          },
          /processId|required/i,
          'processId is required for get operation'
        );
      });
    });
  });

  // ===== TRIGGER TOOLS =====
  // Consolidated to single 'trigger' tool with 'operation' parameter
  describe('Trigger Tools', function() {
    describe('trigger (list operation)', function() {
      it('should accept scriptId with list operation', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'trigger',
          {
            operation: 'list',
            scriptId: sharedProjectId
          },
          'list triggers'
        );

        expect(result).to.have.property('triggers');
      });
    });

    describe('trigger (create operation)', function() {
      it('should accept time-based trigger arguments', async function() {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'trigger',
          {
            operation: 'create',
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
          'trigger',
          {
            operation: 'create',
            scriptId: sharedProjectId,
            eventType: 'CLOCK'
          },
          /functionName|required/i,
          'functionName is required for create operation'
        );
      });

      it('should reject invalid eventType enum', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'trigger',
          {
            operation: 'create',
            scriptId: sharedProjectId,
            functionName: 'testFunc',
            eventType: 'INVALID_EVENT'
          },
          /eventType|invalid|enum/i,
          'invalid eventType value'
        );
      });
    });

    describe('trigger (delete operation)', function() {
      it('should accept scriptId and triggerId', async function() {
        // Create a trigger first
        const trigger = await context.client.callAndParse('trigger', {
          operation: 'create',
          scriptId: sharedProjectId,
          functionName: 'testFunc',
          eventType: 'CLOCK',
          timeBased: { type: 'HOURLY' }
        });

        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'trigger',
          {
            operation: 'delete',
            scriptId: sharedProjectId,
            triggerId: trigger.triggerId
          },
          'delete trigger'
        );

        expect(result).to.have.property('status');
      });

      it('should reject missing triggerId', async function() {
        await ArgumentTestHelper.expectError(
          context.client,
          'trigger',
          {
            operation: 'delete',
            scriptId: sharedProjectId
          },
          /triggerId|required/i,
          'triggerId is required for delete operation'
        );
      });
    });
  });

  // ===== LOCAL SYNC TOOLS =====
  // REMOVED: pull, push, status tools (redundant with cat/write auto-sync)
  // cat/write already provide local caching via LocalFileManager.copyRemoteToLocal()

  // ===== ADVANCED ANALYSIS TOOLS =====
  describe('Advanced Analysis Tools', function() {
    describe('context', function() {
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

    describe('summary', function() {
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

    describe('deps', function() {
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

    describe('tree', function() {
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
  // REMOVED: gas_info, gas_mkdir, gas_project_metrics
  describe('Project Info Tools', function() {
    describe('reorder', function() {
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
