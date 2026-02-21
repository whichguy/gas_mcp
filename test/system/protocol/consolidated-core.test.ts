import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';

describe('Consolidated MCP-GAS Core Functionality Tests', () => {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let gas: InProcessGASTestHelper;

  before(function() {
    // Try to use global authentication if available, otherwise create new client
    if (globalAuthState.isAuthenticated && globalAuthState.client) {
      client = globalAuthState.client;
      auth = globalAuthState.auth!;
      gas = globalAuthState.gas!;
      console.log('🔗 Using global authenticated client for consolidated tests');
    } else {
      // Create new client for testing (will be unauthenticated)
      console.log('🔧 Creating new client for consolidated tests (no global auth available)');
      // We'll create the client in individual tests as needed
    }
  });

  it('should test authentication infrastructure without assuming auth state', async function() {
    // Skip this test - InProcessTestClient auth interface differs from MCP protocol
    this.skip();
  });

  // Consolidated Server Connection & Tool Discovery Tests
  describe('Server Connection & Tool Discovery', () => {
    it('should connect and list all available tools with proper schemas', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createInProcessClient } = await import("../../helpers/inProcessClient.js");
        client = await createInProcessClient();
        auth = globalAuthState.auth!;  // Reuse global auth with sessionId
      }

      expect(client.isConnected()).to.be.true;

      const tools = await client.listTools();
      expect(tools).to.be.an('array');
      expect(tools.length).to.be.greaterThan(0);

      // Verify all expected GAS tools are present
      const toolNames = tools.map(tool => tool.name);
      const expectedTools = [
        'auth', 'ls', 'cat', 'write',
        'deploy_config', 'deploy', 'project_create', 'project_init'
      ];

      for (const expectedTool of expectedTools) {
        expect(toolNames).to.include(expectedTool);
      }

      // Verify tool schemas are valid
      for (const tool of tools) {
        expect(tool).to.have.property('name');
        expect(tool).to.have.property('description');
        expect(tool).to.have.property('inputSchema');
        expect(tool.inputSchema).to.have.property('type', 'object');
        expect(tool.description).to.be.a('string').that.is.not.empty;
      }
    });

    it('should handle concurrent requests properly', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createInProcessClient } = await import("../../helpers/inProcessClient.js");
        client = await createInProcessClient();
        auth = globalAuthState.auth!;  // Reuse global auth with sessionId
      }

      const promises = [
        client.callTool('auth', { mode: 'status' }),
        client.callTool('auth', { mode: 'status' }),
        client.callTool('auth', { mode: 'status' })
      ];

      const results = await Promise.all(promises);

      expect(results).to.have.length(3);
      results.forEach(result => {
        expect(result).to.have.property('content');
        expect(result.content).to.be.an('array');
      });
    });
  });

  // Consolidated Authentication Flow Tests
  describe('Authentication Flow & State Management', () => {
    it('should handle complete authentication workflow', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createInProcessClient } = await import("../../helpers/inProcessClient.js");
        client = await createInProcessClient();
        auth = globalAuthState.auth!;  // Reuse global auth with sessionId
      }

      // Test auth status checking (works regardless of current auth state)
      const initialStatus = await auth.getAuthStatus();
      expect(initialStatus).to.have.property('authenticated');
      expect(initialStatus).to.have.property('tokenValid');

      // Verify we can get auth status via tool as well
      const statusResult = await client.callTool('auth', { mode: 'status' });
      expect(statusResult).to.have.property('content');
      expect(statusResult.content).to.be.an('array');

      // Note: logout() and startAuth() not tested here because they mutate
      // global session state needed by subsequent tests. OAuth URL inspection
      // is covered by the OAuth Configuration & Validation tests below.

      console.log('✅ Authentication workflow test completed successfully');
    });

    it('should validate auth parameter requirements and modes', async () => {
      // Test invalid mode
      try {
        await client.callTool('auth', { mode: 'invalid_mode' });
        expect.fail('Should have thrown error for invalid mode');
      } catch (error: any) {
        // _handleAuthTool throws "Unknown auth mode: ..."
        const isValidError = error.message.includes('Invalid mode') ||
                           error.message.includes('validation') ||
                           error.message.includes('invalid') ||
                           error.message.includes('Unknown') ||
                           error.message.includes('Tool error');
        expect(isValidError).to.be.true;
      }

      // Test callback mode (unsupported in InProcessTestClient)
      try {
        await client.callTool('auth', { mode: 'callback' });
        expect.fail('Should have thrown error for unsupported mode');
      } catch (error: any) {
        const isValidError = error.message.includes('code') ||
                           error.message.includes('required') ||
                           error.message.includes('validation') ||
                           error.message.includes('Unknown') ||
                           error.message.includes('Tool error');
        expect(isValidError).to.be.true;
      }
    });
  });

  // Consolidated Error Handling & Validation Tests
  describe('Error Handling & Input Validation', () => {
    it('should handle invalid tool names and parameters', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createInProcessClient } = await import("../../helpers/inProcessClient.js");
        client = await createInProcessClient();
        auth = globalAuthState.auth!;  // Reuse global auth with sessionId
      }

      // Test invalid tool name
      try {
        await client.callTool('invalid_tool_name');
        expect.fail('Should have thrown error for invalid tool');
      } catch (error: any) {
        const isValidError = error.message.includes('Unknown tool') ||
                           error.message.includes('not found') ||
                           error.message.includes('invalid') ||
                           error.message.includes('not yet supported') ||
                           error.message.includes('Tool error');
        expect(isValidError).to.be.true;
      }

      // Test invalid parameters
      try {
        await client.callTool('ls', { invalidParam: 'value' });
        expect.fail('Should have thrown error for invalid parameters');
      } catch (error: any) {
        // May get auth error instead of validation error due to enhanced handling
        const isValidError = error.message.includes('validation') ||
                           error.message.includes('invalid') ||
                           error.message.includes('Tool error') ||
                           error.data?.requiresAuth === true;
        expect(isValidError).to.be.true;
      }
    });

    it('should validate file paths and content restrictions', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createInProcessClient } = await import("../../helpers/inProcessClient.js");
        client = await createInProcessClient();
        auth = globalAuthState.auth!;  // Reuse global auth with sessionId
      }

      // Test paths that trigger ValidationError from validateAndParseFilePath
      const restrictions = [
        { path: '', reason: 'empty path' },
        { path: 'scriptId123', reason: 'missing filename (directory-only path)' }
      ];

      let validationErrors = 0;

      for (const { path, reason } of restrictions) {
        try {
          await client.callTool('cat', { path });
          console.log(`Warning: ${reason} restriction not enforced for '${path}'`);
        } catch (error: any) {
          // Count validation errors
          if (error.message.includes('validation') ||
              error.message.includes('Validation') ||
              error.message.includes('non-empty') ||
              error.message.includes('file path') ||
              error.message.includes('Tool error') ||
              error.data?.requiresAuth === true) {
            validationErrors++;
          }
        }
      }

      // At least some restrictions should be enforced
      expect(validationErrors).to.be.at.least(1);
    });
  });

  // Consolidated Unauthenticated Access Tests
  describe('Unauthenticated Access Patterns', () => {
    it('should provide helpful authentication guidance', async function() {
      // InProcessTestClient auto-authenticates on tool calls — can't test
      // unauthenticated access patterns. Requires MCP protocol-level tests.
      this.skip();
    });
  });

  // Consolidated Protocol Compliance Tests
  describe('MCP Protocol Compliance', () => {
    it('should return properly formatted MCP responses', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createInProcessClient } = await import("../../helpers/inProcessClient.js");
        client = await createInProcessClient();
        auth = globalAuthState.auth!;  // Reuse global auth with sessionId
      }

      const result = await client.callTool('auth', { mode: 'status' });

      // Should follow MCP response format
      expect(result).to.have.property('content');
      expect(result.content).to.be.an('array');

      if (result.content.length > 0) {
        const content = result.content[0];
        expect(content).to.have.property('type');
        expect(['text', 'image', 'audio']).to.include(content.type);

        if (content.type === 'text') {
          expect(content).to.have.property('text');
          expect(content.text).to.be.a('string');
        }
      }
    });

    it('should handle rate limiting gracefully', async function() {
      this.timeout(15000);

      // Ensure we have a client for this test
      if (!client) {
        const { createInProcessClient } = await import("../../helpers/inProcessClient.js");
        client = await createInProcessClient();
        auth = globalAuthState.auth!;  // Reuse global auth with sessionId
      }

      // Make many concurrent requests to test rate limiting
      const promises: Promise<any>[] = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          client.callTool('auth', { mode: 'status' }).catch(error => ({ error: error.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => !r.error).length;
      const rateLimited = results.filter(r =>
        r.error && r.error.includes('rate limit')
      ).length;

      // Most should succeed
      expect(successful).to.be.greaterThan(40);

      // If any are rate limited, they should have helpful messages
      if (rateLimited > 0) {
        const rateLimitError = results.find(r => r.error && r.error.includes('rate limit'));
        expect(rateLimitError.error).to.include('retry') ||
               expect(rateLimitError.error).to.include('limit');
      }
    });
  });

  // Consolidated OAuth Configuration Tests
  // Uses direct config inspection to avoid starting OAuth callback servers
  describe('OAuth Configuration & Validation', () => {
    it('should have valid OAuth client credentials configured', async () => {
      // Read OAuth config directly — avoids starting a callback server on port 3000
      const { McpGasConfigManager } = await import('../../../src/config/mcpGasConfig.js');
      const oauthConfig = await McpGasConfigManager.getOAuthConfig();

      // Should have valid client_id
      expect(oauthConfig.client_id).to.be.a('string');
      expect(oauthConfig.client_id).to.have.length.greaterThan(10);
      expect(oauthConfig.client_id).to.include('.apps.googleusercontent.com');

      // Should have required scopes for Google Apps Script
      const requiredScopes = [
        'script.projects',
        'script.processes',
        'script.deployments',
        'drive',
        'userinfo.email'
      ];

      const scopeString = oauthConfig.scopes.join(' ');
      for (const scope of requiredScopes) {
        expect(scopeString).to.include(scope);
      }

      // Should have redirect URIs configured
      expect(oauthConfig.redirect_uris).to.be.an('array');
      expect(oauthConfig.redirect_uris.length).to.be.greaterThan(0);
    });

    it('should detect and handle placeholder credentials', async () => {
      // Read OAuth config directly — avoids starting a callback server on port 3000
      const { McpGasConfigManager } = await import('../../../src/config/mcpGasConfig.js');
      const oauthConfig = await McpGasConfigManager.getOAuthConfig();

      // The client_id should not contain obvious placeholder values
      const placeholderPatterns = [
        'your_client_id',
        'placeholder',
        'example.com',
        'test_secret'
      ];

      for (const placeholder of placeholderPatterns) {
        expect(oauthConfig.client_id).to.not.include(placeholder);
      }

      // Type should be valid
      expect(['uwp', 'desktop', 'web']).to.include(oauthConfig.type);
    });
  });

  // Real GAS Project Operations Tests
  describe('Real GAS Project Operations', () => {
    let testProjectId: string | null = null;
    // Shared project for exec tests (created once, reused across tests)
    let sharedExecProjectId: string | null = null;

    before(async function() {
      this.timeout(120000);
      // Skip entire block if not authenticated
      if (!globalAuthState.isAuthenticated) {
        console.log('⚠️  Authentication required - skipping real GAS operations');
        return;
      }

      // Create shared project for exec-only tests
      // Wrapped in try/catch so quota/API/domain-auth errors leave sharedExecProjectId null
      // and individual tests skip gracefully instead of crashing the whole block
      try {
        console.log('\n🔧 Creating shared project for exec tests...');
        const project = await globalAuthState.gas!.createTestProject('Shared Exec Test');
        const candidateId = project.scriptId;
        console.log(`✅ Created project: ${candidateId}, verifying exec works...`);

        // Verify exec actually works (domain auth may block newly created projects)
        const probe = await globalAuthState.gas!.runFunction(candidateId, '1+1');
        if (probe.status === 'success') {
          sharedExecProjectId = candidateId;
          console.log(`✅ Shared exec project verified: ${sharedExecProjectId}`);
        } else {
          console.warn(`⚠️  Exec probe failed on new project (tests will skip): ${JSON.stringify(probe)}`);
        }
      } catch (error: any) {
        console.warn(`⚠️  Failed to create/verify shared exec project (tests will skip): ${error.message}`);
      }
    });

    after(async function() {
      // Cleanup shared exec project
      if (sharedExecProjectId && globalAuthState.gas) {
        try {
          await globalAuthState.gas.cleanupTestProject(sharedExecProjectId);
        } catch (error) {
          console.warn(`⚠️  Failed to cleanup shared exec project ${sharedExecProjectId}`);
        }
      }
    });

    afterEach(async function() {
      // Cleanup per-test project (only used by first test)
      if (testProjectId && globalAuthState.gas) {
        try {
          await globalAuthState.gas.cleanupTestProject(testProjectId);
        } catch (error) {
          console.warn(`⚠️  Failed to cleanup project ${testProjectId}`);
        }
        testProjectId = null;
      }
    });

    it('should create real GAS project and write code', async function() {
      this.timeout(120000);

      if (!globalAuthState.isAuthenticated) this.skip();

      console.log('\n🎯 Testing Real Project Creation');

      // Create project
      const project = await globalAuthState.gas!.createTestProject('Consolidated Test Project');
      testProjectId = project.scriptId;
      expect(testProjectId).to.be.a('string');
      console.log(`✅ Created project: ${testProjectId}`);

      // Write test code
      await globalAuthState.gas!.writeTestFile(testProjectId!, 'testFile.gs',
        'function test() { return 42; }'
      );
      console.log('✅ Written test file');

      // Verify file was written
      const files = await globalAuthState.gas!.listFiles(testProjectId!);
      expect(files).to.be.an('array');
      expect(files.some((f: any) => f.name === 'testFile')).to.be.true;
      console.log('✅ Verified file exists in project');
    });

    it('should execute code with exec tool', async function() {
      this.timeout(120000);

      if (!globalAuthState.isAuthenticated || !sharedExecProjectId) this.skip();

      console.log('\n🧮 Testing Real Code Execution');

      // Execute simple expression using shared project
      const result = await globalAuthState.gas!.runFunction(sharedExecProjectId!, 'Math.PI * 2');
      expect(result.status).to.equal('success');
      expect(result.result).to.be.closeTo(6.283185, 0.0001);
      console.log(`✅ Executed Math.PI * 2 = ${result.result}`);
    });

    it('should capture Logger.log output', async function() {
      this.timeout(120000);

      if (!globalAuthState.isAuthenticated || !sharedExecProjectId) this.skip();

      console.log('\n📝 Testing Logger.log Capture');

      const result = await globalAuthState.gas!.runFunction(sharedExecProjectId!,
        'Logger.log("Test message"); return 42;'
      );

      expect(result.status).to.equal('success');
      expect(result.result).to.equal(42);
      expect(result.logger_output).to.include('Test message');
      console.log('✅ Logger.log output captured successfully');
    });

    it('should execute GAS service calls', async function() {
      this.timeout(120000);

      if (!globalAuthState.isAuthenticated || !sharedExecProjectId) this.skip();

      console.log('\n🔧 Testing GAS Service Calls');

      const result = await globalAuthState.gas!.runFunction(sharedExecProjectId!,
        'Session.getActiveUser().getEmail()'
      );

      expect(result.status).to.equal('success');
      expect(result.result).to.be.a('string');
      expect(result.result).to.include('@');
      console.log(`✅ Retrieved user email: ${result.result}`);
    });

    it('should execute complex JavaScript expressions', async function() {
      this.timeout(120000);

      if (!globalAuthState.isAuthenticated || !sharedExecProjectId) this.skip();

      console.log('\n🧪 Testing Complex JavaScript');

      const result = await globalAuthState.gas!.runFunction(sharedExecProjectId!,
        '[1,2,3,4,5].reduce((sum, n) => sum + n, 0)'
      );

      expect(result.status).to.equal('success');
      expect(result.result).to.equal(15);
      console.log('✅ Array reduction: [1,2,3,4,5] sum = 15');
    });
  });

  // Real File Operations Tests
  describe('Real File Operations', () => {
    let testProjectId: string | null = null;

    before(async function() {
      this.timeout(120000);
      if (!globalAuthState.isAuthenticated) {
        console.log('⚠️  Authentication required - skipping real file operations');
        return;
      }

      // Create one shared project for all file operation tests
      // Wrapped in try/catch so quota/API errors leave testProjectId null
      // and individual tests skip gracefully instead of crashing the whole block
      try {
        const project = await globalAuthState.gas!.createTestProject('File Ops Test');
        testProjectId = project.scriptId;
        console.log(`✅ Shared file ops project: ${testProjectId}`);
      } catch (error: any) {
        console.warn(`⚠️  Failed to create file ops test project (tests will skip): ${error.message}`);
      }
    });

    after(async function() {
      if (testProjectId && globalAuthState.gas) {
        try {
          await globalAuthState.gas.cleanupTestProject(testProjectId);
        } catch (error) {
          console.warn(`⚠️  Failed to cleanup project ${testProjectId}`);
        }
      }
    });

    it('should write and read files', async function() {
      this.timeout(90000);

      if (!globalAuthState.isAuthenticated || !testProjectId) this.skip();

      console.log('\n📄 Testing File Write/Read');

      const testCode = 'function hello() { return "world"; }';
      await globalAuthState.gas!.writeTestFile(testProjectId!, 'hello.gs', testCode);
      console.log('✅ File written');

      const content = await globalAuthState.gas!.readFile(testProjectId!, 'hello');
      expect(content).to.include('hello');
      expect(content).to.include('world');
      console.log('✅ File read successfully');
    });

    it('should list files in project', async function() {
      this.timeout(90000);

      if (!globalAuthState.isAuthenticated || !testProjectId) this.skip();

      console.log('\n📋 Testing File Listing');

      await globalAuthState.gas!.writeTestFile(testProjectId!, 'file1.gs', '// Test 1');
      await globalAuthState.gas!.writeTestFile(testProjectId!, 'file2.gs', '// Test 2');
      console.log('✅ Created 2 test files');

      const files = await globalAuthState.gas!.listFiles(testProjectId!);
      expect(files.length).to.be.at.least(2);
      console.log(`✅ Listed ${files.length} files`);
    });

    it('should update existing files', async function() {
      this.timeout(90000);

      if (!globalAuthState.isAuthenticated || !testProjectId) this.skip();

      console.log('\n✏️  Testing File Update');

      // Write initial version
      await globalAuthState.gas!.writeTestFile(testProjectId!, 'updatable.gs',
        'function version() { return 1; }'
      );
      console.log('✅ Created initial file (version 1)');

      // Update the file
      await globalAuthState.gas!.writeTestFile(testProjectId!, 'updatable.gs',
        'function version() { return 2; }'
      );
      console.log('✅ Updated file (version 2)');

      // Verify update
      const content = await globalAuthState.gas!.readFile(testProjectId!, 'updatable');
      expect(content).to.include('return 2');
      console.log('✅ Verified file was updated');
    });
  });

  // Real Module System Tests
  describe('Real Module System', () => {
    let testProjectId: string | null = null;

    before(async function() {
      this.timeout(120000);
      if (!globalAuthState.isAuthenticated) {
        console.log('⚠️  Authentication required - skipping real module tests');
        return;
      }

      // Create one shared project for all module tests
      // Wrapped in try/catch so quota/API/domain-auth errors leave testProjectId null
      // and individual tests skip gracefully instead of crashing the whole block
      try {
        const project = await globalAuthState.gas!.createTestProject('Module Test');
        const candidateId = project.scriptId;
        console.log(`✅ Created module project: ${candidateId}, verifying exec works...`);

        // Verify exec works (domain auth may block newly created projects)
        const probe = await globalAuthState.gas!.runFunction(candidateId, '1+1');
        if (probe.status === 'success') {
          testProjectId = candidateId;
          console.log(`✅ Shared module project verified: ${testProjectId}`);
        } else {
          console.warn(`⚠️  Exec probe failed on module project (tests will skip): ${JSON.stringify(probe)}`);
        }
      } catch (error: any) {
        console.warn(`⚠️  Failed to create/verify module test project (tests will skip): ${error.message}`);
      }
    });

    after(async function() {
      if (testProjectId && globalAuthState.gas) {
        try {
          await globalAuthState.gas.cleanupTestProject(testProjectId);
        } catch (error) {
          console.warn(`⚠️  Failed to cleanup project ${testProjectId}`);
        }
      }
    });

    it('should execute module functions via require()', async function() {
      this.timeout(120000);

      if (!globalAuthState.isAuthenticated || !testProjectId) this.skip();

      console.log('\n📦 Testing Module System');

      // Write module
      await globalAuthState.gas!.writeTestFile(testProjectId!, 'Calculator.gs',
        'function add(a,b) { return a + b; }\n' +
        'function multiply(a,b) { return a * b; }\n' +
        'module.exports = { add, multiply };'
      );
      console.log('✅ Created Calculator module');

      // Execute using require
      const result = await globalAuthState.gas!.runFunction(testProjectId!,
        'const calc = require("Calculator"); return calc.add(5, 7);'
      );

      expect(result.status).to.equal('success');
      expect(result.result).to.equal(12);
      console.log('✅ Module require() and function execution: 5 + 7 = 12');
    });

    it('should handle multiple module functions', async function() {
      this.timeout(120000);

      if (!globalAuthState.isAuthenticated || !testProjectId) this.skip();

      console.log('\n📦 Testing Multiple Module Functions');

      // Write module with multiple exports
      await globalAuthState.gas!.writeTestFile(testProjectId!, 'MathHelper.gs',
        'function double(x) { return x * 2; }\n' +
        'function triple(x) { return x * 3; }\n' +
        'function square(x) { return x * x; }\n' +
        'module.exports = { double, triple, square };'
      );
      console.log('✅ Created MathHelper module');

      // Use all three functions
      const result = await globalAuthState.gas!.runFunction(testProjectId!,
        `const math = require("MathHelper");
         const d = math.double(10);
         const t = math.triple(10);
         const s = math.square(5);
         Logger.log("Double: " + d);
         Logger.log("Triple: " + t);
         Logger.log("Square: " + s);
         return { doubled: d, tripled: t, squared: s };`
      );

      expect(result.status).to.equal('success');
      expect(result.result).to.deep.equal({ doubled: 20, tripled: 30, squared: 25 });
      expect(result.logger_output).to.include('Double: 20');
      expect(result.logger_output).to.include('Triple: 30');
      expect(result.logger_output).to.include('Square: 25');
      console.log('✅ Multiple module functions executed successfully');
    });

    it('should handle module chaining', async function() {
      this.timeout(120000);

      if (!globalAuthState.isAuthenticated || !testProjectId) this.skip();

      console.log('\n🔗 Testing Module Chaining');

      // Write first module
      await globalAuthState.gas!.writeTestFile(testProjectId!, 'StringUtils.gs',
        'function toUpper(s) { return s.toUpperCase(); }\n' +
        'module.exports = { toUpper };'
      );

      // Write second module that depends on first
      await globalAuthState.gas!.writeTestFile(testProjectId!, 'MessageFormatter.gs',
        'const stringUtils = require("StringUtils");\n' +
        'function formatMessage(msg) {\n' +
        '  return "MESSAGE: " + stringUtils.toUpper(msg);\n' +
        '}\n' +
        'module.exports = { formatMessage };'
      );
      console.log('✅ Created chained modules');

      // Use the chained modules
      const result = await globalAuthState.gas!.runFunction(testProjectId!,
        'const formatter = require("MessageFormatter");\n' +
        'return formatter.formatMessage("hello world");'
      );

      expect(result.status).to.equal('success');
      expect(result.result).to.equal('MESSAGE: HELLO WORLD');
      console.log('✅ Module chaining works: hello world → MESSAGE: HELLO WORLD');
    });
  });
});
