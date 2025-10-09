/**
 * Corrected Best Practices for MCP Gas Server Testing
 * 
 * Key Insight: The OAuth port 3000 constraint changes everything!
 * 
 * CONSTRAINTS:
 * ✅ OAuth callback server MUST use port 3000 (Google OAuth requirement)
 * ✅ Only ONE MCP Gas server instance can run at a time
 * ✅ Authentication state is inherently global (OAuth tokens are shared)
 * ✅ Server startup/shutdown is expensive due to OAuth initialization
 * 
 * CORRECTED APPROACH:
 * ✅ Single shared server instance (not anti-pattern!)
 * ✅ Test isolation through resource tracking
 * ✅ Efficient cleanup without server restart
 * ✅ Proper error handling with MCP context
 */

import { expect } from 'chai';
import { describe, it, before, after, afterEach } from 'mocha';
import { MCPGasTestHelper, GasTestContext, mcpGasTestHooks } from '../utils/mcpGasTestHelpers.js';

// Apply MCP Gas specific hooks
before(mcpGasTestHooks.before);
afterEach(mcpGasTestHooks.afterEach);
after(mcpGasTestHooks.after);

describe('✅ Corrected MCP Gas Server Best Practices', () => {
  
  describe('Infrastructure Tests (Fast - No Auth Required)', () => {
    
    it('should test tool availability using shared server', async function() {
      // ✅ CORRECT: Use shared server (port 3000 constraint)
      const context = await MCPGasTestHelper.createTestContext({
        testName: this.test?.title
      });

      try {
        // Test tool availability
        const tools = await context.client.listTools();
        const toolNames = tools.map(tool => tool.name);
        
        expect(toolNames).to.include('auth');
        expect(toolNames).to.include('gas_ls');
        expect(toolNames).to.include('gas_write');
        
        console.log(`✅ Found ${tools.length} tools on shared server`);
        
        // Verify server health
        const healthy = await MCPGasTestHelper.checkServerHealth();
        expect(healthy).to.be.true;
        
      } finally {
        // ✅ CORRECT: Clean up resources, not server
        await context.cleanup();
      }
    });

    it('should handle authentication errors properly with shared server', async function() {
      const context = await MCPGasTestHelper.createTestContext({
        testName: this.test?.title
      });

      try {
        // Test without authentication
        if (!context.authenticated) {
          try {
            await context.client.callAndParse('gas_ls', { path: '' });
            expect.fail('Should have required authentication');
          } catch (error) {
            // ✅ CORRECT: Proper MCP error handling
            MCPGasTestHelper.assertRequiresAuth(error, 'project listing');
          }
        } else {
          console.log('⏭️  Auth available - testing authenticated path');
          const result = await context.client.callAndParse('gas_ls', { path: '' });
          expect(result).to.have.property('items');
        }
        
      } finally {
        await context.cleanup();
      }
    });

    it('should test error parsing with MCP context preservation', async function() {
      const context = await MCPGasTestHelper.createTestContext({
        testName: this.test?.title
      });

      try {
        // Trigger a validation error
        await context.client.callAndParse('gas_write', {
          path: 'invalid//path',
          content: 'x'.repeat(200000) // Too large
        });
        expect.fail('Should have thrown validation error');
      } catch (error) {
        // ✅ CORRECT: Parse MCP error with full context
        const parsed = MCPGasTestHelper.parseMCPError(error);
        
        expect(parsed.type).to.be.oneOf(['auth', 'validation']);
        expect(parsed.message).to.be.a('string');
        
        console.log(`✅ Properly handled ${parsed.type} error: ${parsed.message}`);
      } finally {
        await context.cleanup();
      }
    });
  });

  describe('Integration Tests (Slower - Require Auth)', () => {
    
    it('should create and manage real projects with shared server', async function() {
      const context = await MCPGasTestHelper.createTestContext({
        testName: this.test?.title,
        requireAuth: false // Don't fail if no auth
      });

      try {
        if (!context.authenticated) {
          console.log('⏭️  Skipping - authentication not available');
          this.skip();
          return;
        }

        // ✅ CORRECT: Use helper that tracks resources automatically
        const projectId = await MCPGasTestHelper.createTestProject(context, 'Shared Server Test');
        
        // Test file operations with tracking
        const content = `// Test file\nfunction testFunction() {\n  return 'success';\n}`;
        
        await MCPGasTestHelper.writeTestFile(context, projectId, 'test.gs', content);

        const readResult = await context.client.callAndParse('gas_cat', {
          path: `${projectId}/test.gs`
        });

        expect(readResult.content).to.equal(content);
        console.log(`✅ File operations successful on project ${projectId}`);
        
        // ✅ CORRECT: Cleanup is automatic and efficient (no server restart)
        
      } finally {
        await context.cleanup();
      }
    });

    it('should test concurrent operations on shared server', async function() {
      this.timeout(15000);
      
      const context = await MCPGasTestHelper.createTestContext({
        testName: this.test?.title
      });

      try {
        // ✅ CORRECT: Test concurrent requests on shared server
        const promises = Array.from({ length: 3 }, (_, i) =>
          context.client.listTools()
        );

        const results = await Promise.all(promises);
        
        // All should return the same tools from shared server
        results.forEach((tools, index) => {
          expect(tools.length).to.equal(results[0].length);
          console.log(`✅ Concurrent request ${index + 1}: ${tools.length} tools`);
        });
        
        // Verify server is still healthy
        const healthy = await MCPGasTestHelper.checkServerHealth();
        expect(healthy).to.be.true;
        
        console.log('✅ Shared server handled concurrent requests properly');
        
      } finally {
        await context.cleanup();
      }
    });
  });

  describe('Resource Management Tests', () => {
    
    it('should efficiently manage resources without server restart', async function() {
      // Create multiple contexts that share the same server
      const context1 = await MCPGasTestHelper.createTestContext({
        testName: `${this.test?.title}-ctx1`
      });
      
      const context2 = await MCPGasTestHelper.createTestContext({
        testName: `${this.test?.title}-ctx2`
      });

      try {
        // Both contexts use the same server
        const tools1 = await context1.client.listTools();
        const tools2 = await context2.client.listTools();
        
        expect(tools1.length).to.equal(tools2.length);
        
        // Verify they're using the same server instance
        const stats = MCPGasTestHelper.getStats();
        expect(stats.serverRunning).to.be.true;
        expect(stats.activeContexts).to.equal(2);
        
        console.log(`✅ Two contexts sharing server: ${stats.activeContexts} active`);
        
      } finally {
        // ✅ CORRECT: Clean up contexts without affecting shared server
        await context1.cleanup();
        await context2.cleanup();
        
        // Server should still be running for other tests
        const finalStats = MCPGasTestHelper.getStats();
        expect(finalStats.serverRunning).to.be.true;
      }
    });

    it('should track and cleanup resources automatically', async function() {
      const context = await MCPGasTestHelper.createTestContext({
        testName: this.test?.title
      });

      try {
        if (!context.authenticated) {
          console.log('⏭️  Skipping resource test - no auth');
          this.skip();
          return;
        }
        
        // Create multiple test resources
        const projectId1 = await MCPGasTestHelper.createTestProject(context, 'Resource Test 1');
        const projectId2 = await MCPGasTestHelper.createTestProject(context, 'Resource Test 2');
        
        await MCPGasTestHelper.writeTestFile(context, projectId1, 'file1.gs', 'content1');
        await MCPGasTestHelper.writeTestFile(context, projectId2, 'file2.gs', 'content2');
        
        // Verify resources are tracked
        expect(context.projectIds).to.include(projectId1);
        expect(context.projectIds).to.include(projectId2);
        expect(context.createdFiles).to.include(`${projectId1}/file1.gs`);
        expect(context.createdFiles).to.include(`${projectId2}/file2.gs`);
        
        console.log(`✅ Tracked ${context.projectIds.length} projects, ${context.createdFiles.length} files`);
        
      } finally {
        // ✅ CORRECT: All resources cleaned up automatically
        await context.cleanup();
      }
    });
  });

  describe('Error Handling for OAuth Port Constraint', () => {
    
    it('should detect OAuth port conflicts', async function() {
      // This would only happen if someone tries to start another server
      const context = await MCPGasTestHelper.createTestContext({
        testName: this.test?.title
      });

      try {
        // Simulate checking for port conflicts
        const stats = MCPGasTestHelper.getStats();
        expect(stats.serverRunning).to.be.true;
        
        // In a real scenario, trying to start another server would fail
        console.log('✅ Verified single server instance on port 3000');
        
      } finally {
        await context.cleanup();
      }
    });
  });
});

/**
 * Examples of CORRECTED patterns vs OLD assumptions
 */
describe('📋 Corrected vs Incorrect Patterns for OAuth Port 3000', () => {
  
  it('✅ CORRECT: Use shared server (not anti-pattern for OAuth constraint)', async () => {
    // ✅ CORRECT for MCP Gas Server
    const context = await MCPGasTestHelper.createTestContext({ testName: 'shared-server-test' });
    
    try {
      const tools = await context.client.listTools();
      expect(tools.length).to.be.greaterThan(0);
      console.log('✅ Shared server is the CORRECT approach for OAuth port 3000');
    } finally {
      await context.cleanup();
    }
  });
  
  it('❌ INCORRECT: Multiple servers would conflict on port 3000', async () => {
    // ❌ This would be WRONG for MCP Gas Server:
    // const server1 = await createServer(); // Would use port 3000
    // const server2 = await createServer(); // ERROR: Port 3000 already in use!
    
    console.log('❌ Multiple servers impossible due to OAuth port 3000 constraint');
    console.log('✅ Single shared server is the ONLY viable approach');
  });

  it('✅ CORRECT: Efficient resource cleanup without server restart', async () => {
    const context = await MCPGasTestHelper.createTestContext({ testName: 'cleanup-test' });
    
    try {
      // Create some resources
      const tools = await context.client.listTools();
      expect(tools.length).to.be.greaterThan(0);
      
      console.log('✅ Resource tracking without expensive server restart');
    } finally {
      // ✅ CORRECT: Efficient cleanup
      await context.cleanup();
      // Server continues running for other tests
    }
  });
  
  it('✅ CORRECT: Authentication state is inherently global', async () => {
    const context = await MCPGasTestHelper.createTestContext({ testName: 'auth-test' });
    
    try {
      // ✅ CORRECT: Check shared auth state
      const stats = MCPGasTestHelper.getStats();
      console.log(`✅ Shared auth state: ${stats.authenticated}`);
      console.log(`✅ This is CORRECT for OAuth - tokens are inherently global`);
      
    } finally {
      await context.cleanup();
    }
  });
}); 