/**
 * Integration tests for moduleOptions preservation across file operations
 *
 * Tests that edit, aider, cp, mv operations correctly preserve moduleOptions
 * (loadNow, hoistedFunctions, __global__, __events__) when modifying files.
 *
 * @see /Users/jameswiese/.claude/plans/quirky-stargazing-plum.md
 */

import { expect } from 'chai';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../helpers/inProcessClient.js';
import { setupIntegrationTest, globalAuthState, resetSharedProject } from '../setup/integrationSetup.js';

describe('moduleOptions Preservation Tests', function() {
  this.timeout(120000);

  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let gas: InProcessGASTestHelper;
  let testProjectId: string | null = null;
  const testFileName = 'ModuleOptionsTest';
  const testFileNameCopy = 'ModuleOptionsTestCopy';
  const testFileNameMoved = 'ModuleOptionsTestMoved';

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
  });

  after(async function() {
    // Shared project preserved for next suite — reset happens in next before()
  });

  beforeEach(async function() {
    // Validate server is authenticated
    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.error('⚠️  Server not authenticated - skipping test');
      this.skip();
    }

    // Clean up test files before each test
    if (testProjectId && client) {
      try { await client.callTool('rm', { scriptId: testProjectId, path: testFileName }); } catch (e) { /* ignore */ }
      try { await client.callTool('rm', { scriptId: testProjectId, path: testFileNameCopy }); } catch (e) { /* ignore */ }
      try { await client.callTool('rm', { scriptId: testProjectId, path: testFileNameMoved }); } catch (e) { /* ignore */ }
    }
  });

  describe('edit operation', function() {
    it('should preserve loadNow: true after edit', async function() {
      if (!testProjectId) this.skip();

      // Create file with loadNow: true
      await client.callTool('write', {
        scriptId: testProjectId,
        path: testFileName,
        content: `
function doGet(e) {
  return ContentService.createTextOutput("Hello");
}

module.exports = { doGet };
module.exports.__events__ = { doGet: "doGet" };
`,
        moduleOptions: { loadNow: true }
      });

      // Edit the file content
      await client.callTool('edit', {
        scriptId: testProjectId,
        path: testFileName,
        edits: [{
          oldText: 'return ContentService.createTextOutput("Hello");',
          newText: 'return ContentService.createTextOutput("Hello World");'
        }]
      });

      // Read the raw content to verify loadNow is preserved
      const rawResult = await client.callTool('raw_cat', {
        path: `${testProjectId}/${testFileName}`
      });

      // NEW format: __defineModule__(_main, true) - loadNow as 2nd boolean parameter
      expect(rawResult.content).to.include('__defineModule__(_main, true)');
    });

    it('should preserve hoistedFunctions after edit', async function() {
      if (!testProjectId) this.skip();

      // Create file with hoistedFunctions
      await client.callTool('write', {
        scriptId: testProjectId,
        path: testFileName,
        content: `
/**
 * @customfunction
 */
function ADD_NUMBERS(a, b) {
  return a + b;
}

module.exports = { ADD_NUMBERS };
`,
        moduleOptions: {
          hoistedFunctions: [{ name: 'ADD_NUMBERS', params: ['a', 'b'] }]
        }
      });

      // Edit the file content
      await client.callTool('edit', {
        scriptId: testProjectId,
        path: testFileName,
        edits: [{
          oldText: 'return a + b;',
          newText: 'return Number(a) + Number(b);'
        }]
      });

      // Read the raw content to verify hoistedFunctions is preserved
      const rawResult = await client.callTool('raw_cat', {
        path: `${testProjectId}/${testFileName}`
      });

      // Hoisted functions appear in the wrapped content between markers
      expect(rawResult.content).to.include('HOISTED CUSTOM FUNCTIONS');
      expect(rawResult.content).to.include('function ADD_NUMBERS');
    });
  });

  describe('aider operation', function() {
    it('should preserve loadNow: true after fuzzy edit', async function() {
      if (!testProjectId) this.skip();

      // Create file with loadNow: true
      await client.callTool('write', {
        scriptId: testProjectId,
        path: testFileName,
        content: `
function onOpen(e) {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("My Menu").addItem("Test", "testFunction").addToUi();
}

module.exports = { onOpen };
module.exports.__events__ = { onOpen: "onOpen" };
`,
        moduleOptions: { loadNow: true }
      });

      // Apply fuzzy edit
      await client.callTool('aider', {
        scriptId: testProjectId,
        path: testFileName,
        edits: [{
          searchText: 'ui.createMenu("My Menu")',
          replaceText: 'ui.createMenu("Custom Menu")',
          similarityThreshold: 0.8
        }]
      });

      // Read the raw content to verify loadNow is preserved
      const rawResult = await client.callTool('raw_cat', {
        path: `${testProjectId}/${testFileName}`
      });

      // NEW format: __defineModule__(_main, true) - loadNow as 2nd boolean parameter
      expect(rawResult.content).to.include('__defineModule__(_main, true)');
    });
  });

  describe('cp operation', function() {
    it('should preserve moduleOptions from source file', async function() {
      if (!testProjectId) this.skip();

      // Create source file with loadNow: true and __events__
      await client.callTool('write', {
        scriptId: testProjectId,
        path: testFileName,
        content: `
function doPost(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: "ok" }));
}

module.exports = { doPost };
module.exports.__events__ = { doPost: "doPost" };
`,
        moduleOptions: { loadNow: true }
      });

      // Copy to new location
      await client.callTool('cp', {
        scriptId: testProjectId,
        from: testFileName,
        to: testFileNameCopy
      });

      // Read the raw content of copied file to verify loadNow is preserved
      const rawResult = await client.callTool('raw_cat', {
        path: `${testProjectId}/${testFileNameCopy}`
      });

      // NEW format: __defineModule__(_main, true) - loadNow as 2nd boolean parameter
      expect(rawResult.content).to.include('__defineModule__(_main, true)');
    });
  });

  describe('mv operation', function() {
    it('should preserve moduleOptions after move/rename', async function() {
      if (!testProjectId) this.skip();

      // Create source file with loadNow: true
      await client.callTool('write', {
        scriptId: testProjectId,
        path: testFileName,
        content: `
function doGet(e) {
  return HtmlService.createHtmlOutput("<h1>Hello</h1>");
}

module.exports = { doGet };
module.exports.__events__ = { doGet: "doGet" };
`,
        moduleOptions: { loadNow: true }
      });

      // Move/rename the file
      await client.callTool('mv', {
        scriptId: testProjectId,
        from: testFileName,
        to: testFileNameMoved
      });

      // Read the raw content of moved file to verify loadNow is preserved
      const rawResult = await client.callTool('raw_cat', {
        path: `${testProjectId}/${testFileNameMoved}`
      });

      // NEW format: __defineModule__(_main, true) - loadNow as 2nd boolean parameter
      expect(rawResult.content).to.include('__defineModule__(_main, true)');
    });
  });

  describe('sed operation (via WriteTool)', function() {
    it('should preserve loadNow: true via WriteTool inheritance', async function() {
      if (!testProjectId) this.skip();

      // Create file with loadNow: true
      await client.callTool('write', {
        scriptId: testProjectId,
        path: testFileName,
        content: `
const CONFIG = {
  debug: false,
  version: "1.0.0"
};

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify(CONFIG));
}

module.exports = { doGet, CONFIG };
module.exports.__events__ = { doGet: "doGet" };
`,
        moduleOptions: { loadNow: true }
      });

      // Run sed replacement
      await client.callTool('sed', {
        scriptId: testProjectId,
        pattern: 'debug: false',
        replacement: 'debug: true',
        path: testFileName
      });

      // Read the raw content to verify loadNow is preserved
      const rawResult = await client.callTool('raw_cat', {
        path: `${testProjectId}/${testFileName}`
      });

      // NEW format: __defineModule__(_main, true) - loadNow as 2nd boolean parameter
      expect(rawResult.content).to.include('__defineModule__(_main, true)');
      expect(rawResult.content).to.include('debug: true');
    });
  });
});
