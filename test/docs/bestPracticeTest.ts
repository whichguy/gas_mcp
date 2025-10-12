/**
 * Example: MCP Server Testing Best Practices
 * 
 * This demonstrates the correct way to test MCP servers following best practices:
 * - Test isolation with fresh server per test
 * - Proper resource cleanup
 * - Clear separation of unit vs integration tests
 * - Proper error handling with MCP context preservation
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import { MCPTestHelper, TestContext, mcpTestHooks } from '../utils/mcpTestHelpers.js';

// Apply MCP test hooks for proper cleanup
afterEach(mcpTestHooks.afterEach);

describe('Best Practice MCP Server Tests', () => {
  
  describe('Unit Tests (Fast - Use Mock Auth)', () => {
    let context: TestContext;

    afterEach(async () => {
      if (context) {
        await context.cleanup();
      }
    });

    it('should test tool availability without authentication', async function() {
      // ✅ GOOD: Fresh server instance per test
      context = await MCPTestHelper.createTestContext({
        mockAuth: true,
        skipAuth: true,
        testName: this.test?.title
      });

      // Test tool availability
      const tools = await context.client.listTools();
      const toolNames = tools.map(tool => tool.name);
      
      expect(toolNames).to.include('auth');
      expect(toolNames).to.include('ls');
      expect(toolNames).to.include('write');
      
      console.log(`✅ Found ${tools.length} tools available`);
    });

    it('should handle authentication errors properly', async function() {
      context = await MCPTestHelper.createTestContext({
        mockAuth: false,
        skipAuth: true,
        testName: this.test?.title
      });

      // Test that operations properly require authentication
      try {
        await context.client.callAndParse('ls', { path: '' });
        expect.fail('Should have required authentication');
      } catch (error) {
        // ✅ GOOD: Proper MCP error handling
        MCPTestHelper.assertRequiresAuth(error, 'project listing');
      }
    });

    it('should test error parsing with MCP context', async function() {
      context = await MCPTestHelper.createTestContext({
        mockAuth: false,
        skipAuth: true,
        testName: this.test?.title
      });

      try {
        await context.client.callAndParse('write', {
          path: 'invalid/project/file.gs',
          content: 'test content'
        });
        expect.fail('Should have thrown validation error');
      } catch (error) {
        // ✅ GOOD: Parse MCP error with full context
        const parsed = MCPTestHelper.parseMCPError(error);
        
        expect(parsed.type).to.be.oneOf(['auth', 'validation']);
        expect(parsed.message).to.be.a('string');
        expect(parsed.code).to.be.a('number');
        
        console.log(`✅ Properly handled ${parsed.type} error: ${parsed.message}`);
      }
    });
  });

  describe('Integration Tests (Slower - Require Real Auth)', () => {
    let context: TestContext;

    afterEach(async () => {
      if (context) {
        await context.cleanup();
      }
    });

    it('should create and manage real projects', async function() {
      // ✅ GOOD: Fresh server and session per test
      context = await MCPTestHelper.createTestContext({
        mockAuth: false,
        testName: this.test?.title
      });

      if (!context.authenticated) {
        console.log('⏭️  Skipping - real authentication not available');
        this.skip();
        return;
      }

      // ✅ GOOD: Automatic project tracking and cleanup
      const projectId = await MCPTestHelper.createTestProject(context, 'Best Practice Test');
      
      // Test file operations
      const content = `// Test file\nfunction testFunction() {\n  return 'success';\n}`;
      
      await context.client.callAndParse('write', {
        path: `${projectId}/test.gs`,
        content: content
      });

      const readResult = await context.client.callAndParse('cat', {
        path: `${projectId}/test.gs`
      });

      expect(readResult.content).to.equal(content);
      console.log(`✅ Successfully tested file operations on project ${projectId}`);
      
      // ✅ GOOD: Cleanup is automatic via context.cleanup()
    });

    it('should test server lifecycle robustness', async function() {
      // ✅ GOOD: Each test gets fresh server - tests startup robustness
      const context1 = await MCPTestHelper.createTestContext({
        mockAuth: true,
        testName: `${this.test?.title}-context1`
      });

      const tools1 = await context1.client.listTools();
      expect(tools1.length).to.be.greaterThan(0);
      
      // Cleanup first context
      await context1.cleanup();
      
      // ✅ GOOD: Create second context - tests server restart robustness
      const context2 = await MCPTestHelper.createTestContext({
        mockAuth: true,
        testName: `${this.test?.title}-context2`
      });

      const tools2 = await context2.client.listTools();
      expect(tools2.length).to.equal(tools1.length);
      
      await context2.cleanup();
      
      console.log('✅ Server lifecycle robustness verified');
    });
  });

  describe('Performance Tests (Optional)', () => {
    it('should handle concurrent requests properly', async function() {
      this.timeout(10000);
      
      const context = await MCPTestHelper.createTestContext({
        mockAuth: true,
        testName: this.test?.title
      });

      try {
        // ✅ GOOD: Test MCP server's request handling
        const promises = Array.from({ length: 5 }, (_, i) =>
          context.client.listTools()
        );

        const results = await Promise.all(promises);
        
        // All should return the same tools
        results.forEach((tools, index) => {
          expect(tools.length).to.equal(results[0].length);
          console.log(`✅ Request ${index + 1}: ${tools.length} tools`);
        });
        
        console.log('✅ Concurrent request handling verified');
      } finally {
        await context.cleanup();
      }
    });
  });
});

/**
 * Anti-Pattern Examples (DON'T DO THIS)
 */
describe('❌ Anti-Patterns to Avoid', () => {
  
  it('❌ DON\'T: Share client between tests', async () => {
    // This would violate test isolation:
    // const sharedClient = globalAuthState.client; // ❌ BAD
    
    // Instead do this:
    const context = await MCPTestHelper.createTestContext({ mockAuth: true });
    const tools = await context.client.listTools(); // ✅ GOOD
    expect(tools.length).to.be.greaterThan(0);
    await context.cleanup();
  });

  it('❌ DON\'T: Share authentication state', async () => {
    // This would cause state pollution:
    // if (globalAuthState.isAuthenticated) { ... } // ❌ BAD
    
    // Instead do this:
    const context = await MCPTestHelper.createTestContext({ mockAuth: true });
    if (context.authenticated) { // ✅ GOOD - isolated auth state
      console.log('Test-specific authentication available');
    }
    await context.cleanup();
  });

  it('❌ DON\'T: Forget cleanup', async () => {
    const context = await MCPTestHelper.createTestContext({ mockAuth: true });
    
    // Test operations...
    const tools = await context.client.listTools();
    expect(tools.length).to.be.greaterThan(0);
    
    // ✅ GOOD: Always cleanup
    await context.cleanup();
    
    // ❌ BAD: Forgetting cleanup would leave server processes running
  });
}); 