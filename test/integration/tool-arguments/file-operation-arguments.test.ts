import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { MCPGasTestHelper, GasTestContext } from '../../helpers/mcpGasTestHelpers.js';
import { ArgumentTestHelper } from './helpers/argument-test-helper.js';

describe('MCP Tool: File Operations - Argument Validation', function() {
  let context: GasTestContext;
  let testProjectId: string | null = null;

  before(async function() {
    context = await MCPGasTestHelper.createTestContext({
      testName: 'file-ops-args',
      requireAuth: true
    });

    if (!context.authenticated) {
      this.skip();
    }
  });

  beforeEach(async function() {
    // Create fresh test project for each test
    const result = await context.client.callAndParse('project_create', {
      title: `TEST_FileOps_${context.testId}_${Date.now()}`,
      localName: `test-file-ops-${context.testId}-${Date.now()}`
    });
    testProjectId = result.scriptId;
    context.projectIds.push(testProjectId!);
  });

  afterEach(async function() {
    // Cleanup handled by context
  });

  after(async function() {
    await context.cleanup();
  });

  describe('write: Valid Arguments', function() {
    it('should accept minimal required arguments', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'write',
        {
          scriptId: testProjectId!,
          path: 'test',
          content: 'function test() { return true; }'
        },
        'minimal write arguments'
      );

      expect(result).to.have.property('success', true);
    });

    it('should accept with moduleOptions.loadNow', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'write',
        {
          scriptId: testProjectId!,
          path: 'eager-module',
          content: 'function doGet() { return "test"; }',
          moduleOptions: { loadNow: true }
        },
        'write with loadNow=true'
      );

      expect(result.success).to.be.true;
    });

    it('should accept with moduleOptions.hoistedFunctions', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'write',
        {
          scriptId: testProjectId!,
          path: 'sheet-funcs',
          content: 'function customFunc(x) { return x * 2; }',
          moduleOptions: {
            loadNow: true,
            hoistedFunctions: [
              { name: 'DOUBLE', params: ['value'] }
            ]
          }
        },
        'write with hoisted functions'
      );

      expect(result.success).to.be.true;
    });

    it('should accept different fileType values', async function() {
      const fileTypes: Array<'SERVER_JS' | 'HTML' | 'JSON'> = ['SERVER_JS', 'HTML', 'JSON'];

      for (const fileType of fileTypes) {
        const content = fileType === 'JSON' ? '{"test": true}' : 'test content';
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'write',
          {
            scriptId: testProjectId!,
            path: `test-${fileType.toLowerCase()}`,
            content,
            fileType
          },
          `write with fileType: ${fileType}`
        );

        expect(result.success).to.be.true;
      }
    });

    it('should accept empty content', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'write',
        {
          scriptId: testProjectId!,
          path: 'empty-file',
          content: ''
        },
        'write with empty content'
      );

      expect(result.success).to.be.true;
    });

    it('should accept various valid path formats', async function() {
      const validPaths = ArgumentTestHelper.getValidPaths();

      for (const path of validPaths) {
        const result = await ArgumentTestHelper.expectSuccess(
          context.client,
          'write',
          {
            scriptId: testProjectId!,
            path,
            content: 'test'
          },
          `write with path: ${path}`
        );

        expect(result.success).to.be.true;
      }
    });
  });

  describe('write: Invalid Arguments', function() {
    it('should reject missing required scriptId', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'write',
        {
          path: 'test',
          content: 'code'
        },
        /scriptId|required/i,
        'scriptId is required'
      );
    });

    it('should reject invalid scriptId formats', async function() {
      const invalidIds = ArgumentTestHelper.getInvalidScriptIds();

      for (const scriptId of invalidIds) {
        await ArgumentTestHelper.expectError(
          context.client,
          'write',
          {
            scriptId,
            path: 'test',
            content: 'code'
          },
          /scriptId|invalid|format|pattern/i,
          `invalid scriptId: ${scriptId}`
        );
      }
    });

    it('should reject path traversal attempts', async function() {
      const maliciousPaths = ArgumentTestHelper.getPathTraversalExamples();

      for (const path of maliciousPaths) {
        await ArgumentTestHelper.expectError(
          context.client,
          'write',
          {
            scriptId: testProjectId!,
            path,
            content: 'code'
          },
          /path|invalid|unsafe|traversal/i,
          `path traversal: ${path}`
        );
      }
    });

    it('should reject invalid fileType enum', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'write',
        {
          scriptId: testProjectId!,
          path: 'test',
          content: 'code',
          fileType: 'INVALID_TYPE'
        },
        /fileType|invalid|enum/i,
        'invalid fileType value'
      );
    });

    it('should reject invalid moduleOptions.loadNow type', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'write',
        {
          scriptId: testProjectId!,
          path: 'test',
          content: 'code',
          moduleOptions: { loadNow: 'yes' } // Should be boolean
        },
        /loadNow|boolean|type/i,
        'loadNow must be boolean'
      );
    });

    it('should reject missing required path', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'write',
        {
          scriptId: testProjectId!,
          content: 'code'
        },
        /path|required/i,
        'path is required'
      );
    });

    it('should reject missing required content', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'write',
        {
          scriptId: testProjectId!,
          path: 'test'
        },
        /content|required/i,
        'content is required'
      );
    });
  });

  describe('cat: Valid Arguments', function() {
    beforeEach(async function() {
      // Create a test file to read
      await context.client.callAndParse('write', {
        scriptId: testProjectId!,
        path: 'read-test',
        content: 'function readTest() { return "content"; }'
      });
    });

    it('should accept minimal required arguments', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'cat',
        {
          scriptId: testProjectId!,
          path: 'read-test'
        },
        'minimal cat arguments'
      );

      expect(result).to.have.property('content');
      expect(result.content).to.include('function readTest');
    });

    it('should accept with preferLocal flag', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'cat',
        {
          scriptId: testProjectId!,
          path: 'read-test',
          preferLocal: true
        },
        'cat with preferLocal'
      );

      expect(result).to.have.property('content');
    });

    it('should accept preferLocal: false', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'cat',
        {
          scriptId: testProjectId!,
          path: 'read-test',
          preferLocal: false
        },
        'cat with preferLocal=false'
      );

      expect(result).to.have.property('content');
    });
  });

  describe('cat: Invalid Arguments', function() {
    it('should reject missing scriptId', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'cat',
        { path: 'test' },
        /scriptId|required/i,
        'scriptId is required'
      );
    });

    it('should reject missing path', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'cat',
        { scriptId: testProjectId! },
        /path|required/i,
        'path is required'
      );
    });

    it('should reject invalid scriptId format', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'cat',
        {
          scriptId: 'invalid_id',
          path: 'test'
        },
        /scriptId|invalid|format/i,
        'invalid scriptId format'
      );
    });

    it('should reject invalid preferLocal type', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'cat',
        {
          scriptId: testProjectId!,
          path: 'test',
          preferLocal: 'yes' // Should be boolean
        },
        /preferLocal|boolean|type/i,
        'preferLocal must be boolean'
      );
    });
  });

  describe('ls: Valid Arguments', function() {
    it('should accept scriptId only', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'ls',
        { scriptId: testProjectId! },
        'ls with scriptId only'
      );

      expect(result).to.have.property('files');
      expect(result.files).to.be.an('array');
    });

    it('should accept with path pattern', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'ls',
        {
          scriptId: testProjectId!,
          path: '*'
        },
        'ls with wildcard pattern'
      );

      expect(result).to.have.property('files');
    });

    it('should accept with detailed flag', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'ls',
        {
          scriptId: testProjectId!,
          detailed: true
        },
        'ls with detailed=true'
      );

      expect(result).to.have.property('files');
    });

    it('should accept with recursive flag', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'ls',
        {
          scriptId: testProjectId!,
          recursive: true
        },
        'ls with recursive=true'
      );

      expect(result).to.have.property('files');
    });
  });

  describe('ls: Invalid Arguments', function() {
    it('should reject missing scriptId', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'ls',
        {},
        /scriptId|required/i,
        'scriptId is required'
      );
    });

    it('should reject invalid detailed type', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'ls',
        {
          scriptId: testProjectId!,
          detailed: 'yes' // Should be boolean
        },
        /detailed|boolean|type/i,
        'detailed must be boolean'
      );
    });

    it('should reject invalid recursive type', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'ls',
        {
          scriptId: testProjectId!,
          recursive: 1 // Should be boolean
        },
        /recursive|boolean|type/i,
        'recursive must be boolean'
      );
    });
  });

  describe('rm: Valid Arguments', function() {
    beforeEach(async function() {
      // Create a test file to delete
      await context.client.callAndParse('write', {
        scriptId: testProjectId!,
        path: 'delete-me',
        content: 'temporary file'
      });
    });

    it('should accept minimal required arguments', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'rm',
        {
          scriptId: testProjectId!,
          path: 'delete-me'
        },
        'minimal rm arguments'
      );

      expect(result).to.have.property('success', true);
    });
  });

  describe('rm: Invalid Arguments', function() {
    it('should reject missing scriptId', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'rm',
        { path: 'test' },
        /scriptId|required/i,
        'scriptId is required'
      );
    });

    it('should reject missing path', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'rm',
        { scriptId: testProjectId! },
        /path|required/i,
        'path is required'
      );
    });

    it('should reject invalid scriptId format', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'rm',
        {
          scriptId: 'bad_id',
          path: 'test'
        },
        /scriptId|invalid|format/i,
        'invalid scriptId format'
      );
    });
  });
});
