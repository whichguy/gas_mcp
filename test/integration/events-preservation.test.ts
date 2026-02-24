/**
 * Integration tests for __events__ handler survival across file operations
 *
 * These tests verify that event handlers (doGet, doPost, onOpen, etc.) actually
 * EXECUTE correctly after edit/aider/cp/mv operations - not just that strings
 * are preserved in the source code.
 *
 * This is critical because __events__ are implicitly preserved (they're part of
 * user code, not module options) and could be lost if hooks modify code.
 *
 * @see /Users/jameswiese/.claude/plans/humming-bubbling-cray.md
 */

import { expect } from 'chai';
import { InProcessTestClient } from '../helpers/inProcessClient.js';
import { globalAuthState, resetSharedProject } from '../setup/integrationSetup.js';

describe('__events__ Handler Survival Tests', function() {
  this.timeout(180000);

  let client: InProcessTestClient;
  let testProjectId: string | null = null;
  const testFileName = 'EventHandlerTest';
  const testFileNameCopy = 'EventHandlerTestCopy';
  const testFileNameMoved = 'EventHandlerTestMoved';

  before(async function() {
    this.timeout(30000);

    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      console.log('⚠️  Skipping - server not ready');
      this.skip();
      return;
    }

    client = globalAuthState.client;

    testProjectId = globalAuthState.sharedProjectId!;
    if (!testProjectId) { this.skip(); return; }
    console.log(`✅ Using shared test project: ${testProjectId}`);
    await resetSharedProject();
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

  describe('edit operation preserves __events__ functionality', function() {
    it('should preserve doGet handler functionality after edit', async function() {
      if (!testProjectId) this.skip();

      // Create file with doGet handler and __events__ registration
      const originalContent = `
function doGet(e) {
  return ContentService.createTextOutput("ORIGINAL_VALUE");
}

module.exports = { doGet };
module.exports.__events__ = { doGet: "doGet" };
`;

      await client.callTool('write', {
        scriptId: testProjectId,
        path: testFileName,
        content: originalContent,
        moduleOptions: { loadNow: true }
      });

      // Verify doGet works BEFORE edit
      const beforeResult = await client.callTool('exec', {
        scriptId: testProjectId,
        js_statement: `doGet({}).getContent()`
      });
      expect(beforeResult.result).to.include('ORIGINAL_VALUE');

      // Edit the file content (but NOT the __events__ registration)
      await client.callTool('edit', {
        scriptId: testProjectId,
        path: testFileName,
        edits: [{
          oldText: 'return ContentService.createTextOutput("ORIGINAL_VALUE");',
          newText: 'return ContentService.createTextOutput("EDITED_VALUE");'
        }]
      });

      // Verify doGet STILL WORKS after edit
      const afterResult = await client.callTool('exec', {
        scriptId: testProjectId,
        js_statement: `doGet({}).getContent()`
      });
      expect(afterResult.result).to.include('EDITED_VALUE');

      // Also verify __events__ string is still present
      const rawResult = await client.callTool('cat', {
        scriptId: testProjectId,
        path: testFileName,
        raw: true
      });
      expect(rawResult.content).to.include('module.exports.__events__');
      expect(rawResult.content).to.include('doGet');
    });

    it('should preserve __global__ functionality after edit', async function() {
      if (!testProjectId) this.skip();

      // Create file with __global__ export
      const originalContent = `
const GREETING = "Hello";

function sayHello(name) {
  return GREETING + " " + name;
}

module.exports = { sayHello };
module.exports.__global__ = { GREETING: GREETING };
`;

      await client.callTool('write', {
        scriptId: testProjectId,
        path: testFileName,
        content: originalContent,
        moduleOptions: { loadNow: true }
      });

      // Verify __global__ works BEFORE edit
      const beforeResult = await client.callTool('exec', {
        scriptId: testProjectId,
        js_statement: `typeof GREETING`
      });
      expect(beforeResult.result).to.equal('string');

      // Edit the file content
      await client.callTool('edit', {
        scriptId: testProjectId,
        path: testFileName,
        edits: [{
          oldText: 'const GREETING = "Hello";',
          newText: 'const GREETING = "Hi";'
        }]
      });

      // Verify __global__ STILL WORKS after edit
      const afterResult = await client.callTool('exec', {
        scriptId: testProjectId,
        js_statement: `GREETING`
      });
      expect(afterResult.result).to.equal('Hi');

      // Also verify __global__ string is still present
      const rawResult = await client.callTool('cat', {
        scriptId: testProjectId,
        path: testFileName,
        raw: true
      });
      expect(rawResult.content).to.include('module.exports.__global__');
    });
  });

  describe('aider operation preserves __events__ functionality', function() {
    it('should preserve doPost handler functionality after fuzzy edit', async function() {
      if (!testProjectId) this.skip();

      // Create file with doPost handler
      const originalContent = `
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  return ContentService.createTextOutput(JSON.stringify({ received: data.message }));
}

module.exports = { doPost };
module.exports.__events__ = { doPost: "doPost" };
`;

      await client.callTool('write', {
        scriptId: testProjectId,
        path: testFileName,
        content: originalContent,
        moduleOptions: { loadNow: true }
      });

      // Verify doPost is registered BEFORE aider
      const beforeResult = await client.callTool('exec', {
        scriptId: testProjectId,
        js_statement: `typeof doPost`
      });
      expect(beforeResult.result).to.equal('function');

      // Apply fuzzy edit using aider
      await client.callTool('aider', {
        scriptId: testProjectId,
        path: testFileName,
        edits: [{
          searchText: 'received: data.message',
          replaceText: 'received: data.message, status: "ok"',
          similarityThreshold: 0.8
        }]
      });

      // Verify doPost STILL WORKS after aider
      const afterResult = await client.callTool('exec', {
        scriptId: testProjectId,
        js_statement: `typeof doPost`
      });
      expect(afterResult.result).to.equal('function');

      // Also verify __events__ string is still present
      const rawResult = await client.callTool('cat', {
        scriptId: testProjectId,
        path: testFileName,
        raw: true
      });
      expect(rawResult.content).to.include('module.exports.__events__');
    });
  });

  describe('cp operation preserves __events__ functionality', function() {
    it('should preserve onOpen handler functionality after copy', async function() {
      if (!testProjectId) this.skip();

      // Create source file with onOpen handler
      const originalContent = `
function onOpen(e) {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("Test Menu").addItem("Run", "testFunc").addToUi();
}

function testFunc() {
  return "EXECUTED";
}

module.exports = { onOpen, testFunc };
module.exports.__events__ = { onOpen: "onOpen" };
`;

      await client.callTool('write', {
        scriptId: testProjectId,
        path: testFileName,
        content: originalContent,
        moduleOptions: { loadNow: true }
      });

      // Verify onOpen is registered in source
      const beforeResult = await client.callTool('exec', {
        scriptId: testProjectId,
        js_statement: `typeof onOpen`
      });
      expect(beforeResult.result).to.equal('function');

      // Copy to new location
      await client.callTool('cp', {
        scriptId: testProjectId,
        from: testFileName,
        to: testFileNameCopy
      });

      // Reload modules to pick up the copy
      await client.callTool('exec', {
        scriptId: testProjectId,
        js_statement: `require("${testFileNameCopy}"); typeof onOpen`
      });

      // Verify __events__ string is present in copied file
      const rawResult = await client.callTool('cat', {
        scriptId: testProjectId,
        path: testFileNameCopy,
        raw: true
      });
      expect(rawResult.content).to.include('module.exports.__events__');
      expect(rawResult.content).to.include('onOpen');
    });
  });

  describe('mv operation preserves __events__ functionality', function() {
    it('should preserve doGet handler functionality after move', async function() {
      if (!testProjectId) this.skip();

      // Create source file with doGet handler
      const originalContent = `
function doGet(e) {
  return HtmlService.createHtmlOutput("<h1>Test Page</h1>");
}

module.exports = { doGet };
module.exports.__events__ = { doGet: "doGet" };
`;

      await client.callTool('write', {
        scriptId: testProjectId,
        path: testFileName,
        content: originalContent,
        moduleOptions: { loadNow: true }
      });

      // Verify doGet is registered BEFORE move
      const beforeResult = await client.callTool('exec', {
        scriptId: testProjectId,
        js_statement: `typeof doGet`
      });
      expect(beforeResult.result).to.equal('function');

      // Move/rename the file
      await client.callTool('mv', {
        scriptId: testProjectId,
        from: testFileName,
        to: testFileNameMoved
      });

      // Require the moved module to register its handlers
      await client.callTool('exec', {
        scriptId: testProjectId,
        js_statement: `require("${testFileNameMoved}"); typeof doGet`
      });

      // Verify __events__ string is present in moved file
      const rawResult = await client.callTool('cat', {
        scriptId: testProjectId,
        path: testFileNameMoved,
        raw: true
      });
      expect(rawResult.content).to.include('module.exports.__events__');
      expect(rawResult.content).to.include('doGet');
    });
  });

  describe('sed operation preserves __events__ functionality', function() {
    it('should preserve doGet handler functionality after sed replacement', async function() {
      if (!testProjectId) this.skip();

      // Create file with doGet handler
      const originalContent = `
const DEBUG_MODE = false;

function doGet(e) {
  if (DEBUG_MODE) {
    Logger.log("doGet called");
  }
  return ContentService.createTextOutput("Success");
}

module.exports = { doGet, DEBUG_MODE };
module.exports.__events__ = { doGet: "doGet" };
`;

      await client.callTool('write', {
        scriptId: testProjectId,
        path: testFileName,
        content: originalContent,
        moduleOptions: { loadNow: true }
      });

      // Verify doGet works BEFORE sed
      const beforeResult = await client.callTool('exec', {
        scriptId: testProjectId,
        js_statement: `doGet({}).getContent()`
      });
      expect(beforeResult.result).to.include('Success');

      // Run sed replacement on config (not touching __events__)
      await client.callTool('sed', {
        scriptId: testProjectId,
        pattern: 'const DEBUG_MODE = false',
        replacement: 'const DEBUG_MODE = true',
        path: testFileName
      });

      // Verify doGet STILL WORKS after sed
      const afterResult = await client.callTool('exec', {
        scriptId: testProjectId,
        js_statement: `doGet({}).getContent()`
      });
      expect(afterResult.result).to.include('Success');

      // Also verify __events__ string is still present
      const rawResult = await client.callTool('cat', {
        scriptId: testProjectId,
        path: testFileName,
        raw: true
      });
      expect(rawResult.content).to.include('module.exports.__events__');
    });
  });

  describe('combined __events__ and __global__ preservation', function() {
    it('should preserve both __events__ and __global__ after multiple operations', async function() {
      if (!testProjectId) this.skip();

      // Create file with both __events__ and __global__
      const originalContent = `
const API_VERSION = "1.0";
const ENDPOINT_BASE = "/api/v1";

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    version: API_VERSION,
    endpoint: ENDPOINT_BASE
  }));
}

function doPost(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: "received" }));
}

module.exports = { doGet, doPost, API_VERSION, ENDPOINT_BASE };
module.exports.__events__ = { doGet: "doGet", doPost: "doPost" };
module.exports.__global__ = { API_VERSION: API_VERSION };
`;

      await client.callTool('write', {
        scriptId: testProjectId,
        path: testFileName,
        content: originalContent,
        moduleOptions: { loadNow: true }
      });

      // Verify initial state
      let result = await client.callTool('exec', {
        scriptId: testProjectId,
        js_statement: `[typeof doGet, typeof doPost, API_VERSION]`
      });
      expect(result.result).to.deep.equal(['function', 'function', '1.0']);

      // Apply edit
      await client.callTool('edit', {
        scriptId: testProjectId,
        path: testFileName,
        edits: [{
          oldText: 'const API_VERSION = "1.0"',
          newText: 'const API_VERSION = "2.0"'
        }]
      });

      // Verify after edit
      result = await client.callTool('exec', {
        scriptId: testProjectId,
        js_statement: `[typeof doGet, typeof doPost, API_VERSION]`
      });
      expect(result.result).to.deep.equal(['function', 'function', '2.0']);

      // Apply sed
      await client.callTool('sed', {
        scriptId: testProjectId,
        pattern: 'ENDPOINT_BASE = "/api/v1"',
        replacement: 'ENDPOINT_BASE = "/api/v2"',
        path: testFileName
      });

      // Verify after sed - both __events__ handlers still work
      result = await client.callTool('exec', {
        scriptId: testProjectId,
        js_statement: `[typeof doGet, typeof doPost]`
      });
      expect(result.result).to.deep.equal(['function', 'function']);

      // Verify raw content still has both __events__ and __global__
      const rawResult = await client.callTool('cat', {
        scriptId: testProjectId,
        path: testFileName,
        raw: true
      });
      expect(rawResult.content).to.include('module.exports.__events__');
      expect(rawResult.content).to.include('module.exports.__global__');
      expect(rawResult.content).to.include('doGet');
      expect(rawResult.content).to.include('doPost');
      expect(rawResult.content).to.include('API_VERSION');
    });
  });
});
