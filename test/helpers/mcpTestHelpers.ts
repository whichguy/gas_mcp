/**
 * MCP Test Helpers - Following MCP Server Best Practices
 * 
 * Key Principles:
 * 1. Test Isolation: Each test gets a fresh server instance
 * 2. Proper Lifecycle: Test server startup/shutdown robustness
 * 3. Resource Cleanup: Automatic cleanup after each test
 * 4. Mock vs Integration: Clear separation of concerns
 * 5. Error Handling: Proper MCP error context preservation
 */

import { MCPTestClient } from '../system/mcpClient.js';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

export interface TestContext {
  client: MCPTestClient;
  sessionId: string;
  authenticated: boolean;
  projectIds: string[];
  cleanup: () => Promise<void>;
}

export class MCPTestHelper {
  private static activeContexts = new Set<TestContext>();

  /**
   * Create an isolated test context for each test
   * Following MCP best practice: fresh server per test
   */
  static async createTestContext(options: {
    mockAuth?: boolean;
    skipAuth?: boolean;
    testName?: string;
  } = {}): Promise<TestContext> {
    const sessionId = randomUUID();
    const testName = options.testName || 'unknown-test';
    
    console.log(`🔧 Creating isolated test context for: ${testName}`);
    console.log(`📋 Session ID: ${sessionId}`);
    
    // Create fresh client with isolated environment
    const client = new MCPTestClient();
    
    // Set isolated environment variables
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      MCP_TEST_MODE: 'true',
      MCP_SESSION_ID: sessionId,
      NODE_ENV: 'test',
      GAS_MOCK_AUTH: options.mockAuth ? 'true' : 'false'
    };
    
    await client.startAndConnect();
    
    // Handle authentication based on test needs
    let authenticated = false;
    if (!options.skipAuth) {
      if (options.mockAuth) {
        // Mock authentication - fast for unit tests
        authenticated = true;
        console.log(`✅ Mock authentication enabled for ${testName}`);
      } else {
        // Check for real authentication - for integration tests
        try {
          const authResult = await client.callAndParse('gas_auth', { mode: 'status' });
          authenticated = authResult.authenticated || false;
          console.log(`🔐 Real authentication status: ${authenticated}`);
        } catch (error) {
          console.log(`⚠️  Authentication check failed: ${error}`);
          authenticated = false;
        }
      }
    }
    
    const context: TestContext = {
      client,
      sessionId,
      authenticated,
      projectIds: [],
      cleanup: async () => {
        await MCPTestHelper.cleanupTestContext(context);
      }
    };
    
    MCPTestHelper.activeContexts.add(context);
    return context;
  }

  /**
   * Cleanup test context - following MCP best practice of proper resource cleanup
   */
  static async cleanupTestContext(context: TestContext): Promise<void> {
    console.log(`🧹 Cleaning up test context: ${context.sessionId}`);
    
    try {
      // Cleanup any test projects created during the test
      for (const projectId of context.projectIds) {
        try {
          await MCPTestHelper.cleanupTestProject(context.client, projectId);
        } catch (error) {
          console.warn(`⚠️  Failed to cleanup project ${projectId}:`, error);
        }
      }
      
      // Disconnect client - this terminates the server process
      await context.client.disconnect();
      
      // Clean up session files
      const sessionFile = path.join('.sessions', `${context.sessionId}.json`);
      try {
        await fs.unlink(sessionFile);
      } catch (error) {
        // Session file might not exist - that's ok
      }
      
    } catch (error) {
      console.warn(`⚠️  Error during test context cleanup:`, error);
    } finally {
      MCPTestHelper.activeContexts.delete(context);
    }
  }

  /**
   * Cleanup all active test contexts - for emergency cleanup
   */
  static async cleanupAllContexts(): Promise<void> {
    console.log(`🛑 Emergency cleanup: ${MCPTestHelper.activeContexts.size} active contexts`);
    
    const cleanupPromises = Array.from(MCPTestHelper.activeContexts).map(context =>
      MCPTestHelper.cleanupTestContext(context).catch(error =>
        console.warn('Error during emergency cleanup:', error)
      )
    );
    
    await Promise.all(cleanupPromises);
  }

  /**
   * Create a test project and track it for cleanup
   */
  static async createTestProject(context: TestContext, name?: string): Promise<string> {
    if (!context.authenticated) {
      throw new Error('Authentication required for project creation');
    }
    
    const projectName = name || `Test Project ${Date.now()}`;
    console.log(`📂 Creating test project: ${projectName}`);
    
    const result = await context.client.callAndParse('gas_project_create', { 
      title: projectName 
    });
    
    const projectId = result.scriptId;
    context.projectIds.push(projectId);
    
    console.log(`✅ Created test project: ${projectId}`);
    return projectId;
  }

  /**
   * Cleanup a test project
   */
  static async cleanupTestProject(client: MCPTestClient, projectId: string): Promise<void> {
    console.log(`🗑️  Cleaning up test project: ${projectId}`);
    
    try {
      // List and delete all files in the project
      const files = await client.callAndParse('gas_ls', { path: projectId });
      
      if (files.items && files.items.length > 0) {
        for (const file of files.items) {
          try {
            await client.callAndParse('gas_rm', {
              path: `${projectId}/${file.name}`
            });
          } catch (error) {
            console.warn(`⚠️  Failed to delete file ${file.name}:`, error);
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️  Failed to cleanup project ${projectId}:`, error);
    }
  }

  /**
   * Enhanced error handling that preserves MCP context
   */
  static parseMCPError(error: any): {
    type: 'auth' | 'validation' | 'permission' | 'network' | 'unknown';
    message: string;
    code?: number;
    data?: any;
  } {
    // Handle MCP-specific error structures
    if (error.code) {
      if (error.code === -32000) {
        return {
          type: 'auth',
          message: error.message || 'Authentication required',
          code: error.code,
          data: error.data
        };
      }
      
      if (error.code === -32001) {
        return {
          type: 'validation',
          message: error.message || 'Validation error',
          code: error.code,
          data: error.data
        };
      }
      
      if (error.code === -32002) {
        return {
          type: 'permission',
          message: error.message || 'Permission denied',
          code: error.code,
          data: error.data
        };
      }
    }
    
    // Handle tool error responses
    if (error.message && error.message.includes('Tool error:')) {
      try {
        const jsonStr = error.message.replace('Tool error: ', '');
        const parsed = JSON.parse(jsonStr);
        
        if (Array.isArray(parsed) && parsed.length > 0) {
          const textContent = parsed.find(item => item.type === 'text');
          if (textContent && textContent.text) {
            const innerError = JSON.parse(textContent.text);
            return MCPTestHelper.parseMCPError(innerError);
          }
        }
      } catch (parseError) {
        // Fall through to generic handling
      }
    }
    
    // Generic error handling
    return {
      type: 'unknown',
      message: error.message || 'Unknown error',
      code: error.code,
      data: error.data
    };
  }

  /**
   * Assert that an operation requires authentication
   */
  static assertRequiresAuth(error: any, operation: string): void {
    const parsed = MCPTestHelper.parseMCPError(error);
    
    if (parsed.type !== 'auth') {
      throw new Error(
        `Expected authentication error for ${operation}, but got ${parsed.type}: ${parsed.message}`
      );
    }
    
    console.log(`✅ ${operation} properly requires authentication`);
  }

  /**
   * Skip test if authentication is not available
   */
  static skipIfNotAuthenticated(context: TestContext, testFn: any): void {
    if (!context.authenticated) {
      console.log(`⏭️  Skipping test - authentication not available`);
      testFn.skip();
      return;
    }
  }
}

/**
 * Mocha hooks for proper test lifecycle management
 */
export const mcpTestHooks = {
  async afterEach() {
    // Clean up any contexts that weren't properly cleaned up
    if (MCPTestHelper['activeContexts'].size > 0) {
      console.warn(`⚠️  Found ${MCPTestHelper['activeContexts'].size} uncleaned contexts after test`);
      await MCPTestHelper.cleanupAllContexts();
    }
  },

  async after() {
    // Final emergency cleanup
    await MCPTestHelper.cleanupAllContexts();
  }
}; 