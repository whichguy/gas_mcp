import { testResourceManager } from '../helpers/testResourceManager.js';
import { execSync } from 'child_process';
import { InProcessTestClient, createInProcessClient, InProcessAuthHelper, InProcessGASTestHelper } from '../helpers/inProcessClient.js';

// A singleton to hold the global state
class GlobalAuthState {
    private static instance: GlobalAuthState;
    public client: InProcessTestClient | null = null;
    public auth: InProcessAuthHelper | null = null;
    public gas: InProcessGASTestHelper | null = null;
    public isAuthenticated: boolean = false;

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
    console.log('\n🌟 ===== GLOBAL TEST SETUP: ONE SERVER, ONE AUTH =====');

    // 0. TERMINATE any background MCP servers to avoid conflicts
    await terminateBackgroundServers();

    // 1. CREATE IN-PROCESS CLIENT (SAME PROCESS, SAME CLASS INSTANCES)
    console.log('🚀 Creating in-process test client (no child process)...');
    try {
      globalAuthState.client = await createInProcessClient();
      console.log('✅ In-process client created - same Node.js process, full console visibility');
    } catch (error) {
      console.error('❌ Failed to create in-process client:', error);
      throw error;
    }

    // 2. AUTHENTICATE ONCE - IN-PROCESS AUTH
    if (process.env.GAS_MOCK_AUTH === 'true') {
      console.log('🔧 Using mock authentication for fast testing');
      globalAuthState.isAuthenticated = true;
      globalAuthState.auth = new InProcessAuthHelper(globalAuthState.client);
      globalAuthState.gas = new InProcessGASTestHelper(globalAuthState.client);
    } else {
      console.log('🔐 Authenticating with Google (ONE TIME for all tests)...');
      globalAuthState.auth = new InProcessAuthHelper(globalAuthState.client);
      globalAuthState.gas = new InProcessGASTestHelper(globalAuthState.client);

      // Check if already authenticated from previous run
      const authStatus = await globalAuthState.auth.getAuthStatus();
      let needsAuth = true;

      if (authStatus.authenticated && authStatus.tokenValid) {
        console.log(`✅ Using valid cached session for ${authStatus.user.email}`);
        console.log('   Server will handle tokens transparently for all tests');

        // Verify token is accessible
        try {
          const testToken = await globalAuthState.client!.getAccessToken();
          if (!testToken) {
            console.error('⚠️  Cached auth status says authenticated but token not accessible');
            throw new Error('Token not accessible despite valid auth status');
          }
          console.log('✅ Token verified in session manager - ready for API calls');
          globalAuthState.isAuthenticated = true;
          needsAuth = false;
        } catch (tokenError: any) {
          console.error(`❌ Token verification failed for cached session: ${tokenError.message}`);
          console.log('🔄 Will trigger new OAuth flow...');
          await new Promise(resolve => setTimeout(resolve, 500)); // Brief delay
        }
      }

      if (needsAuth) {
        console.log('🔑 No valid authentication found. Starting interactive OAuth flow...');
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('⚠️  ⚠️  ⚠️   BROWSER SHOULD BE OPENING NOW   ⚠️  ⚠️  ⚠️');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('📋 If browser doesn\'t open automatically:');
        console.log('   1. Check if a browser window opened in the background');
        console.log('   2. Look for browser on other screens/desktops');
        console.log('   3. The OAuth URL will be shown below if auto-launch fails');
        console.log('');

        try {
          console.log('🌐 Starting OAuth flow with browser (waitForCompletion=true)...');
          const authResult = await globalAuthState.auth.startInteractiveAuthWithBrowser();
          console.log(`🔗 OAuth completed: ${JSON.stringify(authResult, null, 2)}`);

          // Verify authentication succeeded
          if (authResult.authenticated) {
            console.log(`✅ Global authentication successful for ${authResult.user?.email || 'user'}`);
            globalAuthState.isAuthenticated = true;
          } else {
            // Double-check final auth status
            await new Promise(resolve => setTimeout(resolve, 500));
            const finalStatus = await globalAuthState.auth.getAuthStatus();

            if (!finalStatus.authenticated) {
              throw new Error('Authentication was not successful after OAuth flow');
            }

            console.log(`✅ Global authentication successful for ${finalStatus.user.email}`);
            globalAuthState.isAuthenticated = true;
          }

          console.log('✅ Server now authenticated - all tests will use this session');

          // CRITICAL: Verify token is actually available in the client's session manager
          console.log('🔍 Verifying token availability in session manager...');
          try {
            const testToken = await globalAuthState.client!.getAccessToken();
            if (!testToken) {
              throw new Error('OAuth completed but token not retrievable from session manager');
            }
            console.log('✅ Token verified in session manager - tests can make API calls');
          } catch (tokenError: any) {
            console.error(`❌ Token verification failed: ${tokenError.message}`);
            console.error('   OAuth succeeded but token not available for API calls');
            globalAuthState.isAuthenticated = false;
            throw new Error(`Token not available after OAuth: ${tokenError.message}`);
          }
        } catch (authError) {
          console.error(`❌ OAuth setup failed: ${authError}`);
          globalAuthState.isAuthenticated = false;
          throw authError;
        }
      }
    }

    console.log('\n✅ Global test setup complete. All tests will use this authenticated server.');
    console.log('   No per-test authentication needed - server handles tokens transparently.\n');
  },

  async afterAll() {
    console.log('\n🛑 ===== GLOBAL TEST TEARDOWN =====');

    // Clean up in-process client - ONCE
    if (globalAuthState.client) {
      console.log('🧹 Cleaning up in-process client...');
      await globalAuthState.client.cleanup();
      globalAuthState.client = null;
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
 * - ONE server started for entire test suite
 * - ONE OAuth flow for all tests
 * - Server manages tokens internally
 * - All tests use same authenticated server
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
