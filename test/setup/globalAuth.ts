import { MCPTestClient, createTestClient, AuthTestHelper } from '../helpers/mcpClient.js';
import { testResourceManager } from '../helpers/testResourceManager.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// A singleton to hold the global state
class GlobalAuthState {
    private static instance: GlobalAuthState;
    public client: MCPTestClient | null = null;
    public auth: AuthTestHelper | null = null;
    public isAuthenticated: boolean = false;
    public allocatedPort: number | null = null;

    private constructor() {}

    public static getInstance(): GlobalAuthState {
        if (!GlobalAuthState.instance) {
            GlobalAuthState.instance = new GlobalAuthState();
        }
        return GlobalAuthState.instance;
    }
}

export const globalAuthState = GlobalAuthState.getInstance();

export const mochaHooks = {
  async beforeAll(this: any) {
    this.timeout(130000); // Long timeout for potential manual auth
    console.log('\n🌟 ===== GLOBAL TEST SETUP =====');

    // 0. TERMINATE any background MCP servers to avoid port conflicts
    await terminateBackgroundServers();

    // 1. Allocate dedicated port for OAuth to prevent conflicts
    try {
      globalAuthState.allocatedPort = testResourceManager.allocatePort();
      console.log(`🔌 Allocated OAuth port: ${globalAuthState.allocatedPort} (OAuth will still use 3000)`);
      if (globalAuthState.allocatedPort) {
        process.env.MCP_OAUTH_PORT = globalAuthState.allocatedPort.toString();
      }
    } catch (error) {
      console.warn('⚠️  Could not allocate dedicated port, using default');
    }

    // 2. DON'T clear sessions - we want to reuse valid cached tokens
    console.log('🔍 Checking for existing authentication sessions...');
    const sessionsDir = '.sessions';
    if (fs.existsSync(sessionsDir)) {
      const files = fs.readdirSync(sessionsDir);
      console.log(`📁 Found ${files.length} cached session file(s) - will check validity`);
    }

    // 3. Create a single client for all tests with isolated resources
    try {
      globalAuthState.client = await testResourceManager.createIsolatedClient({
        port: globalAuthState.allocatedPort ?? undefined,
        mockMode: process.env.GAS_MOCK_AUTH === 'true'
      });
    } catch (error) {
      console.warn('⚠️  Could not create isolated client, falling back to standard client');
    globalAuthState.client = await createTestClient();
    }
    
    if (globalAuthState.client) {
      globalAuthState.auth = new AuthTestHelper(globalAuthState.client);
    }

    // 4. Perform authentication based on environment
    if (process.env.GAS_MOCK_AUTH === 'true') {
      console.log('🔧 Using mock authentication for fast testing');
      globalAuthState.isAuthenticated = true;
    } else {
    console.log('🔐 Setting up REAL authentication for all tests...');
    if (!globalAuthState.auth) {
      throw new Error('Auth helper not initialized');
    }
    const authStatus = await globalAuthState.auth.getAuthStatus();

    if (authStatus.authenticated && authStatus.tokenValid) {
        console.log(`✅ Using valid cached session for ${authStatus.user.email}.`);
        globalAuthState.isAuthenticated = true;
    } else {
        console.log('🔑 No valid authentication found. Starting interactive OAuth flow...');
        console.log('⚠️ Please complete authentication in the browser that will open.');

          try {
        console.log('📋 Step 1: Starting OAuth flow with browser...');
        const authResult = await globalAuthState.auth!.startInteractiveAuthWithBrowser();
        console.log(`🔗 OAuth URL: ${authResult.authUrl}`);

        console.log('📋 Step 2: Polling for authentication completion...');
        const authCompleted = await globalAuthState.auth!.waitForAuth(120000); // 2 minutes
        
        if (!authCompleted) {
              throw new Error('Authentication timed out');
        }
        
        const finalStatus = await globalAuthState.auth!.getAuthStatus();
        if (!finalStatus.authenticated) {
                throw new Error('Authentication was not successful after OAuth flow');
        }
        
        console.log(`✅ Global authentication successful for ${finalStatus.user.email}.`);
        globalAuthState.isAuthenticated = true;
          } catch (authError) {
            console.warn(`⚠️  OAuth setup failed: ${authError}. Some tests may be skipped.`);
            globalAuthState.isAuthenticated = false;
          }
      }
    }

    console.log('\n✅ Global test setup complete. All tests will use this authenticated session.');
    console.log(`📊 Resource Stats: ${JSON.stringify(testResourceManager.getResourceStats())}`);
  },
  
  async afterAll() {
    console.log('\n🛑 ===== GLOBAL TEST TEARDOWN =====');
    
    // Clean up global resources
    if (globalAuthState.client) {
      await globalAuthState.client.disconnect();
      globalAuthState.client = null;
    }
    
    // Release allocated port
    if (globalAuthState.allocatedPort) {
      testResourceManager.releasePort(globalAuthState.allocatedPort);
      globalAuthState.allocatedPort = null;
    }
    
    // Clean up all test resources
    await testResourceManager.cleanupAllResources();
    
    console.log('✅ Global test teardown complete.\n');
  }
};

/**
 * Authentication Configuration:
 * 
 * DEFAULT: Real OAuth authentication with browser launches
 * - Tests will trigger actual Google OAuth flows
 * - Browsers will open for authentication when needed
 * - Real tokens are cached in .sessions/ directory
 * 
 * MOCK MODE: Set GAS_MOCK_AUTH=true for fast testing
 * - No browser launches
 * - Uses fake tokens for testing
 * - Fast test execution
 * 
 * Examples:
 * npm test                    # Real auth (default)
 * GAS_MOCK_AUTH=true npm test # Mock auth (fast)
 */

// Set up process exit handlers
process.on('exit', () => {
  // Cleanup function will be called by mochaHooks
});

process.on('SIGINT', async () => {
  // Cleanup function will be called by mochaHooks
  process.exit(0);
});

process.on('SIGTERM', async () => {
  // Cleanup function will be called by mochaHooks
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  // Cleanup function will be called by mochaHooks
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  console.error('Unhandled rejection:', reason);
  // Cleanup function will be called by mochaHooks
  process.exit(1);
}); 

/**
 * Terminate any background MCP servers that might be running
 */
async function terminateBackgroundServers(): Promise<void> {
  console.log('🛑 Terminating any background MCP servers...');
  
  try {
    // Kill processes by name pattern
    const killCommands = [
      'pkill -f "mcp-gas"',
      'pkill -f "dist/src/index.js"',
      'pkill -f "node.*gas"'
    ];
    
    for (const cmd of killCommands) {
      try {
        execSync(cmd, { stdio: 'ignore' });
      } catch (error) {
        // Ignore errors - process might not exist
      }
    }
    
    // Kill processes on specific ports (OAuth callback needs port 3000)
    const ports = [3000, 3001, 8080];
    for (const port of ports) {
      try {
        if (port === 3000) {
          console.log(`🔒 Clearing port ${port} (OAuth callback port - will be needed for OAuth)`);
        } else {
          console.log(`🔌 Clearing port ${port}`);
        }
        
        // Find and kill processes on this port
        const lsofResult = execSync(`lsof -ti:${port}`, { encoding: 'utf8', stdio: 'pipe' });
        const pids = lsofResult.trim().split('\n').filter(pid => pid);
        
        for (const pid of pids) {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
          console.log(`💀 Killed process ${pid} on port ${port}`);
        }
      } catch (error) {
        // Port might not be in use - that's fine
      }
    }
    
    // Give processes time to shut down
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('✅ Background server cleanup completed');
  } catch (error) {
    console.warn('⚠️  Error during background server cleanup:', error);
  }
} 