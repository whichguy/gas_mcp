/**
 * Search Operations Validation Tests
 *
 * Tests search and text processing tools with real GAS projects:
 * - Basic search (gas_grep)
 * - Advanced search (gas_ripgrep)
 * - Text processing (gas_sed)
 * - File finding (gas_find)
 * - Fuzzy matching (gas_aider)
 */

import { expect } from 'chai';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';
import { TEST_TIMEOUTS } from './testTimeouts.js';

describe('Search Operations Validation Tests', () => {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let gas: InProcessGASTestHelper;
  let testProjectId: string | null = null;

  before(async function() {
    this.timeout(TEST_TIMEOUTS.EXECUTION);
    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️  Skipping integration tests - not authenticated');
      this.skip();
    }
    client = globalAuthState.client;
    auth = globalAuthState.auth!;  // Reuse global auth with sessionId
    gas = globalAuthState.gas!;

    // Create test project with search content
    const result = await gas.createTestProject('MCP-Search-Test');
    testProjectId = result.scriptId;
    console.log(`✅ Created search test project: ${testProjectId}`);

    // Create test files with various content
    const files = [
      {
        name: 'SearchTarget1',
        content: `
function findMe() {
  // TODO: implement this
  Logger.log("Test message");
  return 42;
}
`
      },
      {
        name: 'SearchTarget2',
        content: `
function anotherFunction() {
  // FIXME: needs optimization
  console.log("Debug output");
  return "result";
}
`
      },
      {
        name: 'SearchTarget3',
        content: `
function calculateValue(x, y) {
  const result = x * y;
  Logger.log("Calculation: " + result);
  return result;
}
`
      }
    ];

    for (const file of files) {
      await gas.writeTestFile(testProjectId!, file.name, file.content);
    }
  });

  after(async function() {
    this.timeout(TEST_TIMEOUTS.STANDARD);
    if (testProjectId) {
      console.log(`🧹 Cleaning up test project: ${testProjectId}`);
      await gas.cleanupTestProject(testProjectId);
    }
  });

  describe('Basic Search (gas_grep)', () => {
    it('should find simple pattern', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('grep', {
        scriptId: testProjectId,
        pattern: 'Logger.log'
      });

      const output = result.content[0].text;
      expect(output).to.include('SearchTarget1');
      expect(output).to.include('SearchTarget3');
    });

    it('should find regex pattern', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('grep', {
        scriptId: testProjectId,
        pattern: 'function\\s+\\w+'
      });

      const output = result.content[0].text;
      expect(output).to.include('findMe');
      expect(output).to.include('anotherFunction');
      expect(output).to.include('calculateValue');
    });

    it('should perform case-sensitive search', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('grep', {
        scriptId: testProjectId,
        pattern: 'Logger',
        caseSensitive: true
      });

      const output = result.content[0].text;
      expect(output).to.include('Logger');
      expect(output).to.not.include('logger'); // lowercase should not match
    });

    it('should search across multiple files', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('grep', {
        scriptId: testProjectId,
        pattern: 'TODO|FIXME'
      });

      const output = result.content[0].text;
      expect(output).to.include('TODO');
      expect(output).to.include('FIXME');
    });
  });

  describe('Advanced Search (gas_ripgrep)', () => {
    it('should perform multi-pattern search', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('ripgrep', {
        scriptId: testProjectId,
        pattern: 'Logger',
        patterns: ['console', 'return']
      });

      const output = result.content[0].text;
      expect(output).to.include('Logger');
      expect(output).to.include('console');
      expect(output).to.include('return');
    });

    it('should search with context lines', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('ripgrep', {
        scriptId: testProjectId,
        pattern: 'Logger.log',
        context: 2
      });

      const output = result.content[0].text;
      // Should include lines before and after the match
      expect(output).to.include('Logger.log');
      expect(output.split('\n').length).to.be.greaterThan(3);
    });

    it('should use case-insensitive search', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('ripgrep', {
        scriptId: testProjectId,
        pattern: 'LOGGER',
        ignoreCase: true
      });

      const output = result.content[0].text;
      expect(output).to.include('Logger');
    });

    it('should sort results by path', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('ripgrep', {
        scriptId: testProjectId,
        pattern: 'function',
        sort: 'path'
      });

      const output = result.content[0].text;
      expect(output).to.include('function');
      // Results should be sorted alphabetically
      const target1Idx = output.indexOf('SearchTarget1');
      const target2Idx = output.indexOf('SearchTarget2');
      const target3Idx = output.indexOf('SearchTarget3');

      if (target1Idx !== -1 && target2Idx !== -1 && target3Idx !== -1) {
        expect(target1Idx).to.be.lessThan(target2Idx);
        expect(target2Idx).to.be.lessThan(target3Idx);
      }
    });

    it('should trim whitespace in results', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('ripgrep', {
        scriptId: testProjectId,
        pattern: 'Logger.log',
        trim: true
      });

      const output = result.content[0].text;
      const lines = output.split('\n');
      // Check that leading spaces are trimmed
      const matchedLines = lines.filter((line: string) => line.includes('Logger.log'));
      matchedLines.forEach((line: string) => {
        expect(line).to.not.match(/^\s{2,}/); // Should not start with multiple spaces
      });
    });
  });

  describe('Text Processing (gas_sed)', () => {
    it('should perform simple find/replace', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('sed', {
        scriptId: testProjectId,
        pattern: 'Logger.log',
        replacement: 'console.log'
      });

      expect(result.content[0].text).to.include('success');
      expect(result.content[0].text).to.include('modified');

      // Verify replacement
      const readResult = await gas.readFile(testProjectId!, 'SearchTarget1');
      expect(readResult).to.include('console.log');
      expect(readResult).to.not.include('Logger.log');
    });

    it('should use regex replacement with capture groups', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      // Reset SearchTarget2 first
      await gas.writeTestFile(testProjectId!, 'SearchTarget2', `
function anotherFunction() {
  // FIXME: needs optimization
  console.log("Debug output");
  return "result";
}
`);

      const result = await client.callTool('sed', {
        scriptId: testProjectId,
        pattern: 'function\\s+(\\w+)',
        replacement: 'function RENAMED_$1'
      });

      expect(result.content[0].text).to.include('success');

      // Verify replacement
      const readResult = await gas.readFile(testProjectId!, 'SearchTarget2');
      expect(readResult).to.include('RENAMED_anotherFunction');
    });

    it('should perform multi-file replacement', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('sed', {
        scriptId: testProjectId,
        pattern: 'return',
        replacement: 'return // modified'
      });

      expect(result.content[0].text).to.include('success');

      // Verify in multiple files
      const file2 = await gas.readFile(testProjectId!, 'SearchTarget2');
      const file3 = await gas.readFile(testProjectId!, 'SearchTarget3');

      expect(file2).to.include('return // modified');
      expect(file3).to.include('return // modified');
    });

    it('should use dry-run mode', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('sed', {
        scriptId: testProjectId,
        pattern: 'const',
        replacement: 'var',
        dryRun: true
      });

      expect(result.content[0].text).to.include('dry');
      expect(result.content[0].text).to.include('would');

      // Verify no changes were made
      const readResult = await gas.readFile(testProjectId!, 'SearchTarget3');
      expect(readResult).to.include('const');
      expect(readResult).to.not.include('var result');
    });
  });

  describe('Find Operations (gas_find)', () => {
    it('should find files by name pattern', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('find', {
        scriptId: testProjectId,
        name: '*Target*'
      });

      const output = result.content[0].text;
      expect(output).to.include('SearchTarget1');
      expect(output).to.include('SearchTarget2');
      expect(output).to.include('SearchTarget3');
    });

    it('should find files with specific type', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('find', {
        scriptId: testProjectId,
        type: 'SERVER_JS'
      });

      const output = result.content[0].text;
      expect(output).to.include('SearchTarget');
    });

    it('should list with detailed information', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const result = await client.callTool('find', {
        scriptId: testProjectId,
        ls: true
      });

      const output = result.content[0].text;
      // Detailed output should include file sizes or other metadata
      expect(output).to.include('SearchTarget');
      expect(output.length).to.be.greaterThan(100); // Detailed output is longer
    });
  });

  describe('Fuzzy Matching (gas_aider)', () => {
    it('should create file with whitespace variations', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const contentWithSpaces = `
function   renderStateItem(container,   key,   value,   depth)   {
  const   item   =   document.createElement("div");
  item.className   =   "state-item";
  return   item;
}
`;

      const result = await gas.writeTestFile(testProjectId!, 'FuzzyTarget', contentWithSpaces);
      expect(result).to.have.property('success', true);
    });

    it('should match with whitespace variations using gas_aider', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const searchText = 'function renderStateItem(container, key, value, depth) { const item = document.createElement("div");';
      const replaceText = 'function renderStateItem(container, key, value, depth) { const element = document.createElement("div");';

      const result = await client.callTool('aider', {
        scriptId: testProjectId,
        path: 'FuzzyTarget',
        edits: [{
          searchText: searchText,
          replaceText: replaceText,
          similarityThreshold: 0.8
        }]
      });

      expect(result.content[0].text).to.include('success');
      expect(result.content[0].text).to.match(/editsApplied.*1/);

      // Verify replacement
      const readResult = await gas.readFile(testProjectId!, 'FuzzyTarget');
      expect(readResult).to.include('element');
      expect(readResult).to.not.include('const   item');
    });

    it('should validate fuzzy matching performance', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const largeContent = `
${'x'.repeat(2000)}
function   renderStateItem(container,   key,   value,   depth)   {
  const   item   =   document.createElement("div");
  item.className   =   "state-item";
}
${'y'.repeat(2000)}
`;

      await gas.writeTestFile(testProjectId!, 'LargeFuzzy', largeContent);

      const searchText = 'function renderStateItem(container, key, value, depth) {';
      const replaceText = 'function renderStateItem_V2(container, key, value, depth) {';

      const start = Date.now();

      const result = await client.callTool('aider', {
        scriptId: testProjectId,
        path: 'LargeFuzzy',
        edits: [{
          searchText: searchText,
          replaceText: replaceText,
          similarityThreshold: 0.8
        }]
      });

      const elapsed = Date.now() - start;

      expect(result.content[0].text).to.include('success');
      // Should complete quickly (< 5 seconds for API call + fuzzy matching)
      expect(elapsed).to.be.lessThan(5000);
    });

    it('should handle multiple edits with overlap detection', async function() {
      this.timeout(TEST_TIMEOUTS.STANDARD);
      expect(testProjectId).to.not.be.null;

      const content = 'AAABBBCCC';
      await gas.writeTestFile(testProjectId!, 'OverlapTest', content);

      const result = await client.callTool('aider', {
        scriptId: testProjectId,
        path: 'OverlapTest',
        edits: [
          { searchText: 'AAABBB', replaceText: 'X', similarityThreshold: 0.8 },
          { searchText: 'BBBCCC', replaceText: 'Y', similarityThreshold: 0.8 }
        ]
      });

      // Should detect overlap and report error
      expect(result.content[0].text).to.match(/overlap|conflict/i);
    });
  });

  describe('Search Performance', () => {
    it('should handle searches in projects with many files', async function() {
      this.timeout(TEST_TIMEOUTS.BULK);
      expect(testProjectId).to.not.be.null;

      // Create 20 additional files
      for (let i = 1; i <= 20; i++) {
        await gas.writeTestFile(
          testProjectId!,
          `PerfTest${i}`,
          `function test${i}() { return ${i}; }`
        );
      }

      const start = Date.now();

      const result = await client.callTool('grep', {
        scriptId: testProjectId,
        pattern: 'function'
      });

      const elapsed = Date.now() - start;

      expect(result.content[0].text).to.include('function');
      // Should complete in reasonable time
      expect(elapsed).to.be.lessThan(30000);
    });
  });
});
