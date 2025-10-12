/**
 * MCP Gas Server Test Helpers - Optimized for OAuth Port 3000 Constraint
 * 
 * Key Constraints:
 * 1. OAuth callback server MUST use port 3000 (Google OAuth requirement)
 * 2. Only ONE MCP Gas server instance can run at a time
 * 3. Authentication state is inherently global (OAuth tokens are shared)
 * 4. Server startup/shutdown is expensive due to OAuth initialization
 * 
 * Best Practices for MCP Gas Server:
 * 1. Single shared server instance across all tests
 * 2. Proper test isolation within shared server context
 * 3. Efficient resource cleanup without server restart
 * 4. Clear separation of authenticated vs infrastructure tests
 */

import { MCPTestClient } from './mcpClient.js';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

export interface GasTestContext {
  client: MCPTestClient;
  testId: string;
  authenticated: boolean;
  projectIds: string[];
  createdFiles: string[];
  cleanup: () => Promise<void>;
}

export class MCPGasTestHelper {
  private static sharedClient: MCPTestClient | null = null;
  private static sharedAuthStatus: { authenticated: boolean; user?: any } | null = null;
  private static activeContexts = new Set<GasTestContext>();

  /**
   * Get or create the shared MCP Gas server instance
   * This follows the constraint that only one server can run on port 3000
   */
  static async getSharedClient(): Promise<MCPTestClient> {
    if (!MCPGasTestHelper.sharedClient) {
      console.log('🔧 Creating shared MCP Gas server instance (port 3000 constraint)');
      
      MCPGasTestHelper.sharedClient = new MCPTestClient();
      await MCPGasTestHelper.sharedClient.startAndConnect();
      
      // Cache authentication status to avoid repeated calls
      try {
        const authResult = await MCPGasTestHelper.sharedClient.callAndParse('auth', { mode: 'status' });
        MCPGasTestHelper.sharedAuthStatus = {
          authenticated: authResult.authenticated || false,
          user: authResult.user
        };
        console.log(`🔐 Shared auth status: ${MCPGasTestHelper.sharedAuthStatus.authenticated}`);
      } catch (error) {
        console.log(`⚠️  Authentication check failed: ${error}`);
        MCPGasTestHelper.sharedAuthStatus = { authenticated: false };
      }
    }
    
    return MCPGasTestHelper.sharedClient;
  }

  /**
   * Create a test context using the shared server
   * Provides isolation through resource tracking, not server isolation
   */
  static async createTestContext(options: {
    testName?: string;
    requireAuth?: boolean;
  } = {}): Promise<GasTestContext> {
    const testId = randomUUID();
    const testName = options.testName || 'unknown-test';
    
    console.log(`📋 Creating test context for: ${testName}`);
    console.log(`🆔 Test ID: ${testId}`);
    
    // Get shared client (only one can exist due to port 3000)
    const client = await MCPGasTestHelper.getSharedClient();
    const authStatus = MCPGasTestHelper.sharedAuthStatus!;
    
    // Check authentication requirement
    if (options.requireAuth && !authStatus.authenticated) {
      throw new Error(`Test "${testName}" requires authentication but none is available`);
    }
    
    const context: GasTestContext = {
      client,
      testId,
      authenticated: authStatus.authenticated,
      projectIds: [],
      createdFiles: [],
      cleanup: async () => {
        await MCPGasTestHelper.cleanupTestContext(context);
      }
    };
    
    MCPGasTestHelper.activeContexts.add(context);
    console.log(`✅ Test context ready: ${testName} (auth: ${context.authenticated})`);
    
    return context;
  }

  /**
   * Cleanup test context resources without shutting down shared server
   */
  static async cleanupTestContext(context: GasTestContext): Promise<void> {
    console.log(`🧹 Cleaning up test context: ${context.testId}`);
    
    try {
      // Clean up any test files created
      for (const filePath of context.createdFiles) {
        try {
          const [projectId, fileName] = filePath.split('/');
          await context.client.callAndParse('rm', { path: filePath });
          console.log(`🗑️  Deleted file: ${filePath}`);
        } catch (error) {
          console.warn(`⚠️  Failed to delete file ${filePath}:`, error);
        }
      }
      
      // Clean up any test projects created
      for (const projectId of context.projectIds) {
        try {
          await MCPGasTestHelper.cleanupTestProject(context.client, projectId);
        } catch (error) {
          console.warn(`⚠️  Failed to cleanup project ${projectId}:`, error);
        }
      }
      
    } catch (error) {
      console.warn(`⚠️  Error during test context cleanup:`, error);
    } finally {
      MCPGasTestHelper.activeContexts.delete(context);
      console.log(`✅ Test context cleaned: ${context.testId}`);
    }
  }

  /**
   * Create a test project and track it for cleanup
   */
  static async createTestProject(context: GasTestContext, name?: string): Promise<string> {
    if (!context.authenticated) {
      throw new Error('Authentication required for project creation');
    }
    
    const projectName = name || `Test Project ${Date.now()}`;
    console.log(`📂 Creating test project: ${projectName}`);
    
    const result = await context.client.callAndParse('project_create', { 
      title: projectName 
    });
    
    const projectId = result.scriptId;
    context.projectIds.push(projectId);
    
    console.log(`✅ Created test project: ${projectId}`);
    return projectId;
  }

  /**
   * Write a test file and track it for cleanup
   */
  static async writeTestFile(
    context: GasTestContext, 
    projectId: string, 
    fileName: string, 
    content: string
  ): Promise<void> {
    const filePath = `${projectId}/${fileName}`;
    
    await context.client.callAndParse('write', {
      path: filePath,
      content: content
    });
    
    context.createdFiles.push(filePath);
    console.log(`📝 Created test file: ${filePath}`);
  }

  /**
   * Cleanup a test project
   */
  static async cleanupTestProject(client: MCPTestClient, projectId: string): Promise<void> {
    console.log(`🗑️  Cleaning up test project: ${projectId}`);
    
    try {
      // List and delete all files in the project
      const files = await client.callAndParse('ls', { path: projectId });
      
      if (files.items && files.items.length > 0) {
        for (const file of files.items) {
          try {
            await client.callAndParse('rm', {
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
    type: 'auth' | 'validation' | 'permission' | 'network' | 'oauth_port' | 'unknown';
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
    }

    // Handle OAuth port conflicts specifically
    if (error.message && error.message.includes('port 3000')) {
      return {
        type: 'oauth_port',
        message: 'OAuth port 3000 conflict - another server may be running',
        code: error.code,
        data: error.data
      };
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
            return MCPGasTestHelper.parseMCPError(innerError);
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
    const parsed = MCPGasTestHelper.parseMCPError(error);
    
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
  static skipIfNotAuthenticated(context: GasTestContext, testFn: any): void {
    if (!context.authenticated) {
      console.log(`⏭️  Skipping test - authentication not available`);
      testFn.skip();
      return;
    }
  }

  /**
   * Check if the shared server is healthy
   */
  static async checkServerHealth(): Promise<boolean> {
    try {
      if (!MCPGasTestHelper.sharedClient) {
        return false;
      }
      
      const tools = await MCPGasTestHelper.sharedClient.listTools();
      return tools.length > 0;
    } catch (error) {
      console.warn('⚠️  Server health check failed:', error);
      return false;
    }
  }

  /**
   * Get statistics about the shared server and active contexts
   */
  static getStats(): {
    serverRunning: boolean;
    authenticated: boolean;
    activeContexts: number;
    user?: string;
  } {
    return {
      serverRunning: MCPGasTestHelper.sharedClient?.isConnected() || false,
      authenticated: MCPGasTestHelper.sharedAuthStatus?.authenticated || false,
      activeContexts: MCPGasTestHelper.activeContexts.size,
      user: MCPGasTestHelper.sharedAuthStatus?.user?.email
    };
  }

  /**
   * Emergency cleanup - for test suite teardown
   */
  static async emergencyCleanup(): Promise<void> {
    console.log(`🛑 Emergency cleanup: ${MCPGasTestHelper.activeContexts.size} active contexts`);
    
    // Clean up all active contexts
    const cleanupPromises = Array.from(MCPGasTestHelper.activeContexts).map(context =>
      MCPGasTestHelper.cleanupTestContext(context).catch(error =>
        console.warn('Error during emergency cleanup:', error)
      )
    );
    
    await Promise.all(cleanupPromises);
    
    // Disconnect shared client
    if (MCPGasTestHelper.sharedClient) {
      await MCPGasTestHelper.sharedClient.disconnect();
      MCPGasTestHelper.sharedClient = null;
      MCPGasTestHelper.sharedAuthStatus = null;
    }
    
    console.log('✅ Emergency cleanup completed');
  }
}

/**
 * Mocha hooks optimized for MCP Gas Server constraints
 */
export const mcpGasTestHooks = {
  async before() {
    // Initialize shared server early
    console.log('🚀 Initializing shared MCP Gas server (OAuth port 3000)');
    await MCPGasTestHelper.getSharedClient();
  },

  async afterEach() {
    // Clean up any leaked contexts after each test
    const stats = MCPGasTestHelper.getStats();
    if (stats.activeContexts > 0) {
      console.warn(`⚠️  Found ${stats.activeContexts} uncleaned contexts after test`);
      // Don't auto-cleanup here - let tests handle their own cleanup
    }
  },

  async after() {
    // Final cleanup
    await MCPGasTestHelper.emergencyCleanup();
  }
}; 