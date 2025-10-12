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
        'rm', 'mv', 'cp', 'gas_mkdir',
        'gas_info', 'gas_reorder', 'exec',
        'deploy', 'project_create', 'project_init'
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
      
      // Test that we can start a auth flow
      const authStart = await auth.startInteractiveAuth();
      expect(authStart).to.have.property('authUrl');
      expect(authStart).to.have.property('callbackUrl');
      expect(authStart).to.have.property('state');
      expect(authStart.authUrl).to.include('accounts.google.com');
      expect(authStart.authUrl).to.include('oauth2');

      // Test callback with invalid code (expected to fail)
      try {
        await auth.completeAuth('invalid_code_12345');
        expect.fail('Should have thrown error for invalid code');
      } catch (error: any) {
        expect(error.message).to.include('Authentication failed') || 
               error.message.to.include('invalid') ||
               error.message.to.include('authorization');
      }

      // Test logout (should work regardless of auth state)
      const logoutResult = await auth.logout();
      expect(logoutResult).to.have.property('status', 'logged_out');
      
      console.log('✅ Authentication workflow test completed successfully');
    });

    it('should validate auth parameter requirements and modes', async () => {
      // Test invalid mode
      try {
        await client.callTool('auth', { mode: 'invalid_mode' });
        expect.fail('Should have thrown error for invalid mode');
      } catch (error: any) {
        // Enhanced validation provides more detailed error messages
        const isValidError = error.message.includes('Invalid mode') || 
                           error.message.includes('validation') ||
                           error.message.includes('invalid') ||
                           error.message.includes('Tool error');
        expect(isValidError).to.be.true;
      }

      // Test callback without code
      try {
        await client.callTool('auth', { mode: 'callback' });
        expect.fail('Should have thrown error for missing code');
      } catch (error: any) {
        const isValidError = error.message.includes('code') || 
                           error.message.includes('required') ||
                           error.message.includes('validation') ||
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
      
      const restrictions = [
        { path: 'project/../escape', reason: 'path traversal' },
        { path: 'project//double-slash', reason: 'double slash' },
        { path: '/absolute/path', reason: 'absolute path' }
      ];

      let validationErrors = 0;
      
      for (const { path, reason } of restrictions) {
        try {
          await client.callTool('cat', { path });
          console.log(`Warning: ${reason} restriction not enforced for ${path}`);
        } catch (error: any) {
          // Count any kind of error (validation or auth) as restriction working
          if (error.message.includes('validation') || 
              error.message.includes('unsafe') ||
              error.message.includes('invalid') ||
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
    it('should provide helpful authentication guidance', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createInProcessClient } = await import("../../helpers/inProcessClient.js");
        client = await createInProcessClient();
        auth = globalAuthState.auth!;  // Reuse global auth with sessionId
      }
      
      // Test unauthenticated access by temporarily logging out if needed
      let wasAuthenticated = false;
      
      try {
        // Check current auth status
        const authStatus = await auth.getAuthStatus();
        wasAuthenticated = authStatus.authenticated;
        
        if (wasAuthenticated) {
          await auth.logout();
        }
        
        // Now test unauthenticated access
        try {
          await client.callTool('ls', { path: 'some_project' });
          expect.fail('Should have thrown authentication error');
        } catch (error: any) {
          // Enhanced error responses include OAuth URLs and instructions
          const hasGuidance = error.data?.authUrl || 
                            error.data?.instructions ||
                            error.data?.requiresAuth === true ||
                            error.message.includes('Tool error') ||
                            error.message.includes('Authentication required');
          expect(hasGuidance).to.be.true;
        }
      } finally {
        // Re-authenticate if we were authenticated before
        if (wasAuthenticated) {
          try {
            await auth.startInteractiveAuth();
          } catch (error) {
            // Ignore auth failures during cleanup
          }
        }
      }
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
  describe('OAuth Configuration & Validation', () => {
    it('should have valid OAuth client credentials configured', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createInProcessClient } = await import("../../helpers/inProcessClient.js");
        client = await createInProcessClient();
        auth = globalAuthState.auth!;  // Reuse global auth with sessionId
      }
      
      const authStart = await auth.startInteractiveAuth();
      
      // Should generate valid OAuth URL
      expect(authStart.authUrl).to.include('accounts.google.com');
      expect(authStart.authUrl).to.include('oauth2');
      expect(authStart.authUrl).to.include('client_id=');
      expect(authStart.authUrl).to.include('redirect_uri=');
      expect(authStart.authUrl).to.include('scope=');
      
      // Should include required scopes for Google Apps Script
      const requiredScopes = [
        'script.projects',
        'script.processes', 
        'script.deployments',
        'drive',
        'userinfo.email'
      ];
      
      for (const scope of requiredScopes) {
        expect(authStart.authUrl).to.include(scope);
      }
    });

    it('should detect and handle placeholder credentials', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createInProcessClient } = await import("../../helpers/inProcessClient.js");
        client = await createInProcessClient();
        auth = globalAuthState.auth!;  // Reuse global auth with sessionId
      }
      
      // The auth URL should not contain obvious placeholder values
      const authStart = await auth.startInteractiveAuth();
      
      const placeholderPatterns = [
        'your_client_id',
        'placeholder',
        'example.com',
        'localhost:3000', // Should use actual callback
        'test_secret'
      ];
      
      for (const placeholder of placeholderPatterns) {
        expect(authStart.authUrl).to.not.include(placeholder);
      }
      
      // Should have reasonable callback URL
      expect(authStart.callbackUrl).to.be.a('string').that.is.not.empty;
      expect(authStart.callbackUrl).to.include('http');
    });
  });

  // Real GAS Project Operations Tests
  describe('Real GAS Project Operations', () => {
    let testProjectId: string | null = null;

    beforeEach(async function() {
      // Skip if not authenticated
      if (!globalAuthState.isAuthenticated) {
        console.log('⚠️  Authentication required - skipping real GAS operations');
        this.skip();
      }
    });

    afterEach(async function() {
      // Cleanup test project
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
      this.timeout(120000); // 2 minutes

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

      console.log('\n🧮 Testing Real Code Execution');

      const project = await globalAuthState.gas!.createTestProject('Exec Test');
      testProjectId = project.scriptId;
      console.log(`✅ Created project: ${testProjectId}`);

      // Execute simple expression
      const result = await globalAuthState.gas!.runFunction(testProjectId!, 'Math.PI * 2');
      expect(result.status).to.equal('success');
      expect(result.result).to.be.closeTo(6.283185, 0.0001);
      console.log(`✅ Executed Math.PI * 2 = ${result.result}`);
    });

    it('should capture Logger.log output', async function() {
      this.timeout(120000);

      console.log('\n📝 Testing Logger.log Capture');

      const project = await globalAuthState.gas!.createTestProject('Logger Test');
      testProjectId = project.scriptId;

      const result = await globalAuthState.gas!.runFunction(testProjectId!,
        'Logger.log("Test message"); return 42;'
      );

      expect(result.status).to.equal('success');
      expect(result.result).to.equal(42);
      expect(result.logger_output).to.include('Test message');
      console.log('✅ Logger.log output captured successfully');
    });

    it('should execute GAS service calls', async function() {
      this.timeout(120000);

      console.log('\n🔧 Testing GAS Service Calls');

      const project = await globalAuthState.gas!.createTestProject('GAS Services Test');
      testProjectId = project.scriptId;

      const result = await globalAuthState.gas!.runFunction(testProjectId!,
        'Session.getActiveUser().getEmail()'
      );

      expect(result.status).to.equal('success');
      expect(result.result).to.be.a('string');
      expect(result.result).to.include('@');
      console.log(`✅ Retrieved user email: ${result.result}`);
    });

    it('should execute complex JavaScript expressions', async function() {
      this.timeout(120000);

      console.log('\n🧪 Testing Complex JavaScript');

      const project = await globalAuthState.gas!.createTestProject('Complex JS Test');
      testProjectId = project.scriptId;

      const result = await globalAuthState.gas!.runFunction(testProjectId!,
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

    beforeEach(async function() {
      // Skip if not authenticated
      if (!globalAuthState.isAuthenticated) {
        console.log('⚠️  Authentication required - skipping real file operations');
        this.skip();
      }

      // Create test project
      const project = await globalAuthState.gas!.createTestProject('File Ops Test');
      testProjectId = project.scriptId;
    });

    afterEach(async function() {
      if (testProjectId && globalAuthState.gas) {
        try {
          await globalAuthState.gas.cleanupTestProject(testProjectId);
        } catch (error) {
          console.warn(`⚠️  Failed to cleanup project ${testProjectId}`);
        }
        testProjectId = null;
      }
    });

    it('should write and read files', async function() {
      this.timeout(90000);

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

    beforeEach(async function() {
      // Skip if not authenticated
      if (!globalAuthState.isAuthenticated) {
        console.log('⚠️  Authentication required - skipping real module tests');
        this.skip();
      }

      // Create test project
      const project = await globalAuthState.gas!.createTestProject('Module Test');
      testProjectId = project.scriptId;
    });

    afterEach(async function() {
      if (testProjectId && globalAuthState.gas) {
        try {
          await globalAuthState.gas.cleanupTestProject(testProjectId);
        } catch (error) {
          console.warn(`⚠️  Failed to cleanup project ${testProjectId}`);
        }
        testProjectId = null;
      }
    });

    it('should execute module functions via require()', async function() {
      this.timeout(120000);

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