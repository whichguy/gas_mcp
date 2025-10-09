import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { MCPGasTestHelper, GasTestContext } from '../../helpers/mcpGasTestHelpers.js';
import { ArgumentTestHelper } from './helpers/argument-test-helper.js';

describe('MCP Tool: Search Tools - Argument Validation', function() {
  let context: GasTestContext;
  let testProjectId: string | null = null;

  before(async function() {
    context = await MCPGasTestHelper.createTestContext({
      testName: 'search-args',
      requireAuth: true
    });

    if (!context.authenticated) {
      this.skip();
    }
  });

  beforeEach(async function() {
    // Create fresh test project with searchable content
    const result = await context.client.callAndParse('project_create', {
      title: `TEST_Search_${context.testId}_${Date.now()}`,
      localName: `test-search-${context.testId}-${Date.now()}`
    });
    testProjectId = result.scriptId;
    context.projectIds.push(testProjectId!);

    // Upload files with searchable content
    await context.client.callAndParse('write', {
      scriptId: testProjectId!,
      path: 'utils',
      content: `
        function formatDate(date) { return date.toISOString(); }
        function parseDate(str) { return new Date(str); }
        // TODO: Add timezone support
      `
    });

    await context.client.callAndParse('write', {
      scriptId: testProjectId!,
      path: 'api',
      content: `
        function fetchData() { return "data"; }
        function saveData(data) { console.log(data); }
        // FIXME: Handle errors
      `
    });
  });

  afterEach(async function() {
    // Cleanup handled by context
  });

  after(async function() {
    await context.cleanup();
  });

  describe('gas_grep: Valid Arguments', function() {
    it('should accept minimal required arguments', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'grep',
        {
          scriptId: testProjectId!,
          pattern: 'function'
        },
        'minimal grep arguments'
      );

      expect(result).to.have.property('matches');
    });

    it('should accept with caseSensitive flag', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'grep',
        {
          scriptId: testProjectId!,
          pattern: 'TODO',
          caseSensitive: true
        },
        'grep with caseSensitive'
      );

      expect(result).to.have.property('matches');
    });

    it('should accept with contextLines', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'grep',
        {
          scriptId: testProjectId!,
          pattern: 'function',
          contextLines: 2
        },
        'grep with contextLines'
      );

      expect(result).to.have.property('matches');
    });

    it('should accept with compact output', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'grep',
        {
          scriptId: testProjectId!,
          pattern: 'data',
          compact: true
        },
        'grep with compact=true'
      );

      expect(result).to.have.property('matches');
    });

    it('should accept with path filter', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'grep',
        {
          scriptId: testProjectId!,
          pattern: 'function',
          path: 'utils'
        },
        'grep with path filter'
      );

      expect(result).to.have.property('matches');
    });

    it('should accept with includeFileTypes', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'grep',
        {
          scriptId: testProjectId!,
          pattern: 'function',
          includeFileTypes: ['SERVER_JS']
        },
        'grep with includeFileTypes'
      );

      expect(result).to.have.property('matches');
    });

    it('should accept regex patterns', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'grep',
        {
          scriptId: testProjectId!,
          pattern: 'function\\s+\\w+'
        },
        'grep with regex pattern'
      );

      expect(result).to.have.property('matches');
    });
  });

  describe('gas_grep: Invalid Arguments', function() {
    it('should reject missing scriptId', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'grep',
        { pattern: 'test' },
        /scriptId|required/i,
        'scriptId is required'
      );
    });

    it('should reject missing pattern', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'grep',
        { scriptId: testProjectId! },
        /pattern|required/i,
        'pattern is required'
      );
    });

    it('should reject empty pattern', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'grep',
        {
          scriptId: testProjectId!,
          pattern: ''
        },
        /pattern|empty|required/i,
        'empty pattern'
      );
    });

    it('should reject invalid caseSensitive type', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'grep',
        {
          scriptId: testProjectId!,
          pattern: 'test',
          caseSensitive: 'yes' // Should be boolean
        },
        /caseSensitive|boolean|type/i,
        'caseSensitive must be boolean'
      );
    });

    it('should reject contextLines above maximum', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'grep',
        {
          scriptId: testProjectId!,
          pattern: 'test',
          contextLines: 20 // Maximum is 10
        },
        /contextLines|maximum|10/i,
        'contextLines above maximum'
      );
    });

    it('should reject negative contextLines', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'grep',
        {
          scriptId: testProjectId!,
          pattern: 'test',
          contextLines: -1
        },
        /contextLines|minimum|0/i,
        'negative contextLines'
      );
    });
  });

  describe('gas_ripgrep: Valid Arguments', function() {
    it('should accept minimal arguments', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'ripgrep',
        {
          scriptId: testProjectId!,
          pattern: 'function'
        },
        'minimal ripgrep arguments'
      );

      expect(result).to.have.property('matches');
    });

    it('should accept with multiple patterns', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'ripgrep',
        {
          scriptId: testProjectId!,
          pattern: 'TODO',
          patterns: ['FIXME', 'HACK']
        },
        'ripgrep with multiple patterns'
      );

      expect(result).to.have.property('matches');
    });

    it('should accept with smartCase', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'ripgrep',
        {
          scriptId: testProjectId!,
          pattern: 'function',
          smartCase: true
        },
        'ripgrep with smartCase'
      );

      expect(result).to.have.property('matches');
    });

    it('should accept with ignoreCase', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'ripgrep',
        {
          scriptId: testProjectId!,
          pattern: 'FUNCTION',
          ignoreCase: true
        },
        'ripgrep with ignoreCase'
      );

      expect(result).to.have.property('matches');
    });

    it('should accept with context options', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'ripgrep',
        {
          scriptId: testProjectId!,
          pattern: 'function',
          contextBefore: 1,
          contextAfter: 1
        },
        'ripgrep with context options'
      );

      expect(result).to.have.property('matches');
    });

    it('should accept with sort option', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'ripgrep',
        {
          scriptId: testProjectId!,
          pattern: 'function',
          sort: 'path'
        },
        'ripgrep with sort=path'
      );

      expect(result).to.have.property('matches');
    });

    it('should accept with trim option', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'ripgrep',
        {
          scriptId: testProjectId!,
          pattern: 'function',
          trim: true
        },
        'ripgrep with trim=true'
      );

      expect(result).to.have.property('matches');
    });
  });

  describe('gas_ripgrep: Invalid Arguments', function() {
    it('should reject invalid sort value', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'ripgrep',
        {
          scriptId: testProjectId!,
          pattern: 'test',
          sort: 'invalid'
        },
        /sort|invalid|enum/i,
        'invalid sort value'
      );
    });

    it('should reject invalid smartCase type', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'ripgrep',
        {
          scriptId: testProjectId!,
          pattern: 'test',
          smartCase: 'yes' // Should be boolean
        },
        /smartCase|boolean|type/i,
        'smartCase must be boolean'
      );
    });
  });

  describe('gas_find: Valid Arguments', function() {
    it('should accept scriptId only', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'find',
        { scriptId: testProjectId! },
        'find with scriptId only'
      );

      expect(result).to.have.property('files');
    });

    it('should accept with name pattern', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'find',
        {
          scriptId: testProjectId!,
          name: '*.js'
        },
        'find with name pattern'
      );

      expect(result).to.have.property('files');
    });

    it('should accept with type filter', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'find',
        {
          scriptId: testProjectId!,
          type: 'SERVER_JS'
        },
        'find with type filter'
      );

      expect(result).to.have.property('files');
    });

    it('should accept with maxdepth', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'find',
        {
          scriptId: testProjectId!,
          maxdepth: 2
        },
        'find with maxdepth'
      );

      expect(result).to.have.property('files');
    });

    it('should accept with ls flag', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'find',
        {
          scriptId: testProjectId!,
          ls: true
        },
        'find with ls=true'
      );

      expect(result).to.have.property('files');
    });
  });

  describe('gas_find: Invalid Arguments', function() {
    it('should reject missing scriptId', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'find',
        {},
        /scriptId|required/i,
        'scriptId is required'
      );
    });

    it('should reject invalid type enum', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'find',
        {
          scriptId: testProjectId!,
          type: 'INVALID_TYPE'
        },
        /type|invalid|enum/i,
        'invalid type value'
      );
    });

    it('should reject maxdepth above maximum', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'find',
        {
          scriptId: testProjectId!,
          maxdepth: 20 // Maximum is 10
        },
        /maxdepth|maximum|10/i,
        'maxdepth above maximum'
      );
    });

    it('should reject negative maxdepth', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'find',
        {
          scriptId: testProjectId!,
          maxdepth: -1
        },
        /maxdepth|minimum|0/i,
        'negative maxdepth'
      );
    });
  });

  describe('gas_sed: Valid Arguments', function() {
    it('should accept minimal required arguments', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'sed',
        {
          scriptId: testProjectId!,
          pattern: 'console\\.log',
          replacement: 'Logger.log'
        },
        'minimal sed arguments'
      );

      expect(result).to.have.property('filesModified');
    });

    it('should accept with global flag', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'sed',
        {
          scriptId: testProjectId!,
          pattern: 'data',
          replacement: 'information',
          global: true
        },
        'sed with global=true'
      );

      expect(result).to.have.property('filesModified');
    });

    it('should accept with dryRun', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'sed',
        {
          scriptId: testProjectId!,
          pattern: 'function',
          replacement: 'method',
          dryRun: true
        },
        'sed with dryRun=true'
      );

      expect(result).to.have.property('filesModified');
    });

    it('should accept with caseSensitive', async function() {
      const result = await ArgumentTestHelper.expectSuccess(
        context.client,
        'sed',
        {
          scriptId: testProjectId!,
          pattern: 'TODO',
          replacement: 'DONE',
          caseSensitive: true
        },
        'sed with caseSensitive'
      );

      expect(result).to.have.property('filesModified');
    });
  });

  describe('gas_sed: Invalid Arguments', function() {
    it('should reject missing scriptId', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'sed',
        {
          pattern: 'test',
          replacement: 'replace'
        },
        /scriptId|required/i,
        'scriptId is required'
      );
    });

    it('should reject missing pattern', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'sed',
        {
          scriptId: testProjectId!,
          replacement: 'replace'
        },
        /pattern|required/i,
        'pattern is required'
      );
    });

    it('should reject missing replacement', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'sed',
        {
          scriptId: testProjectId!,
          pattern: 'test'
        },
        /replacement|required/i,
        'replacement is required'
      );
    });

    it('should reject invalid global type', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'sed',
        {
          scriptId: testProjectId!,
          pattern: 'test',
          replacement: 'replace',
          global: 'yes' // Should be boolean
        },
        /global|boolean|type/i,
        'global must be boolean'
      );
    });

    it('should reject invalid dryRun type', async function() {
      await ArgumentTestHelper.expectError(
        context.client,
        'sed',
        {
          scriptId: testProjectId!,
          pattern: 'test',
          replacement: 'replace',
          dryRun: 1 // Should be boolean
        },
        /dryRun|boolean|type/i,
        'dryRun must be boolean'
      );
    });
  });
});
