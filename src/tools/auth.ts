import { BaseTool } from './base.js';
import { GASAuthClient } from '../auth/oauthClient.js';
import { OAuthCallbackServer } from '../auth/callbackServer.js';
import { SessionAuthManager, TokenInfo, UserInfo } from '../auth/sessionManager.js';
import { OAuthError } from '../errors/mcpErrors.js';
import open from 'open';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const oauthConfig = JSON.parse(readFileSync(join(__dirname, '../../config/oauth.json'), 'utf8'));

// Debug: Log the configuration being loaded
console.log('🔍 Auth tool loaded OAuth config:', {
  client_id: oauthConfig.oauth.client_id.substring(0, 20) + '...',
  scopes: oauthConfig.oauth.scopes,
  scopeCount: oauthConfig.oauth.scopes.length
});

/**
 * Authentication tool for Google Apps Script OAuth
 * Now supports session isolation for concurrent MCP clients
 */
export class GASAuthTool extends BaseTool {
  public name = 'gas_auth';
  public description = 'Authenticate with Google Apps Script API using OAuth 2.0 (session-isolated)';
  public inputSchema = {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['start', 'callback', 'status', 'logout'],
        default: 'start',
        description: 'Authentication mode: start (begin flow), callback (manual code), status (check auth), logout (clear auth)'
      },
      code: {
        type: 'string',
        description: 'OAuth authorization code (for callback mode)'
      },
      openBrowser: {
        type: 'boolean',
        default: true,
        description: 'Automatically open browser for authentication'
      },
      waitForCompletion: {
        type: 'boolean',
        default: false,
        description: 'Wait for OAuth flow to complete before returning (for interactive use)'
      },
      accessToken: {
        type: 'string',
        description: 'Pre-existing access token for stateless operation (bypasses session storage)'
      }
    }
  };

  private callbackServer: OAuthCallbackServer;
  protected sessionAuthManager: SessionAuthManager;

  constructor(sessionAuthManager: SessionAuthManager) {
    super(sessionAuthManager);
    this.sessionAuthManager = sessionAuthManager;
    
    // Always use configured port 3000 for OAuth callback
    // This ensures consistent redirect URI matching with Google OAuth configuration
    // Even in test mode, OAuth must use the exact redirect URI configured with Google
    const port = oauthConfig.server.port; // Always use configured port (3000)
    
    // Temporarily disable test mode for OAuth callback server to ensure port 3000
    const originalTestMode = process.env.MCP_TEST_MODE;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.MCP_TEST_MODE = 'false';
    process.env.NODE_ENV = 'production';
    
    this.callbackServer = new OAuthCallbackServer(port);
    
    // Restore original environment
    if (originalTestMode) {
      process.env.MCP_TEST_MODE = originalTestMode;
    } else {
      delete process.env.MCP_TEST_MODE;
    }
    if (originalNodeEnv) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    
    console.log(`🔒 OAuth callback server for session ${sessionAuthManager.getSessionId().substring(0, 8)}... will use port ${port} (forced for OAuth compatibility)`);
  }

  async execute(params: any): Promise<any> {
    const mode = params.mode || 'start';
    const openBrowser = params.openBrowser !== false;
    const waitForCompletion = params.waitForCompletion === true;

    // Handle stateless mode with access token
    if (params.accessToken && mode === 'status') {
      return this.getStatelessAuthStatus(params.accessToken);
    }

    switch (mode) {
      case 'start':
        return this.startAuthentication(openBrowser, waitForCompletion);
      
      case 'callback':
        return this.handleCallback(params.code);
      
      case 'status':
        return this.getAuthenticationStatus();
      
      case 'logout':
        return this.logout();
      
      default:
        throw new Error(`Invalid mode: ${mode}`);
    }
  }

  /**
   * Get authentication status for stateless operation
   */
  private async getStatelessAuthStatus(accessToken: string): Promise<any> {
    try {
      // Validate token by getting user info
      const user = await this.authClient.getUserInfo(accessToken);
      
      return {
        status: 'authenticated',
        authenticated: true,
        tokenValid: true,
        user,
        mode: 'stateless',
        sessionId: this.sessionAuthManager.getSessionId(),
        instructions: 'Token is valid for stateless operation'
      };
    } catch (error: any) {
      return {
        status: 'not_authenticated',
        authenticated: false,
        tokenValid: false,
        mode: 'stateless',
        sessionId: this.sessionAuthManager.getSessionId(),
        error: error.message,
        instructions: 'Provided access token is invalid'
      };
    }
  }

  /**
   * Start the OAuth authentication flow
   */
  private async startAuthentication(openBrowser: boolean, waitForCompletion: boolean): Promise<any> {
    try {
      // Generate state parameter for security
      const state = `state_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      console.log(`🚀 Starting OAuth authentication flow...`);
      console.log(`📋 State: ${state}`);

      // Start callback server first to get the port
      await this.callbackServer.start();
      
      // Verify server is running
      const serverRunning = this.callbackServer.isRunning();
      console.log(`🔧 Callback server running: ${serverRunning}`);
      
      if (!serverRunning) {
        throw new OAuthError('Callback server failed to start properly', 'authorization');
      }

      const callbackUrl = this.callbackServer.getCallbackUrl();
      const callbackPort = this.callbackServer.getPort();
      console.log(`🔗 OAuth callback URL: ${callbackUrl}`);
      
      // Generate OAuth URL with the correct callback port
      const authUrl = this.authClient.generateAuthUrl(state, callbackPort);
      console.log(`🌐 OAuth auth URL: ${authUrl}`);
      
      const result = {
        status: 'started',
        authUrl,
        callbackUrl,
        state,
        instructions: [
          '🚀 OAuth authentication started!',
          '📱 Visit the authentication URL to authorize access to Google Apps Script',
          '🔄 The browser will redirect to the callback URL when complete',
          '✅ Authentication will complete automatically',
          '⚠️  The OAuth server will shut down automatically after authentication',
          '💡 Do not bookmark the callback URL - it\'s temporary'
        ]
      };

      if (openBrowser) {
        try {
          console.log(`🌐 Opening browser to: ${authUrl}`);
          await open(authUrl);
          result.instructions.unshift('🌐 Browser opened automatically - complete authentication in the new window');
        } catch (error) {
          console.warn(`⚠️  Failed to open browser automatically:`, error);
          result.instructions.unshift('⚠️  Could not open browser automatically - please visit the URL manually');
        }
      }

      // Wait for callback - either in background or synchronously
      console.log(`⏳ Waiting for OAuth callback...`);
      
      if (waitForCompletion) {
        console.log(`🔄 Synchronous mode: waiting for OAuth completion before returning...`);
        try {
          await this.waitForAuthCallback(state, waitForCompletion);
          
          // OAuth completed successfully
          return {
            status: 'authenticated',
            message: 'OAuth authentication completed successfully',
            user: this.sessionAuthManager.getUserInfo(),
            authUrl,
            callbackUrl,
            state
          };
        } catch (error: any) {
          console.error(`❌ OAuth completion failed:`, error);
          return {
            status: 'failed',
            error: error.message,
            authUrl,
            callbackUrl,
            state,
            instructions: [
              '❌ OAuth authentication failed',
              '🔄 You can try again with gas_auth(mode="start")',
              '💡 Make sure to complete the OAuth flow in your browser'
            ]
          };
        }
      } else {
        console.log(`🔄 Asynchronous mode: OAuth will complete in background...`);
        // Start waiting in background (don't await)
        this.waitForAuthCallback(state, waitForCompletion);
        
        // Return immediately with auth URL
        return result;
      }
    } catch (error: any) {
      console.error(`❌ Failed to start authentication:`, error);
      throw new OAuthError(`Failed to start authentication: ${error.message}`, 'authorization');
    }
  }

  /**
   * Wait for OAuth callback and complete authentication
   */
  private async waitForAuthCallback(state: string, waitForCompletion: boolean): Promise<void> {
    console.log(`⏳ Starting to wait for OAuth callback with state: ${state}`);
    console.log(`🔧 Wait mode: ${waitForCompletion ? 'synchronous' : 'background'}`);
    
    try {
      console.log(`🔍 Checking if callback server is still running...`);
      if (!this.callbackServer.isRunning()) {
        console.error(`❌ Callback server is not running when starting to wait for callback`);
        return;
      }

      console.log(`✅ Callback server confirmed running, waiting for OAuth callback...`);
      const callbackResult = await this.callbackServer.waitForCallback();
      
      console.log(`📥 OAuth callback received:`, {
        hasCode: !!callbackResult.code,
        hasState: !!callbackResult.state,
        hasError: !!callbackResult.error,
        stateMatches: callbackResult.state === state
      });
      
      if (callbackResult.error) {
        console.error(`❌ OAuth callback error: ${callbackResult.error} - ${callbackResult.error_description}`);
        return;
      }

      if (callbackResult.state !== state) {
        console.error(`❌ OAuth state mismatch - expected: ${state}, received: ${callbackResult.state}`);
        return;
      }

      console.log(`✅ OAuth callback validation passed, exchanging code for tokens...`);
      
      // Exchange code for tokens
      await this.completeAuthentication(callbackResult.code);
      console.log(`🎉 OAuth authentication completed successfully`);
      
    } catch (error) {
      console.error(`❌ OAuth callback timeout or error:`, error);
      
      // Log additional debug info
      console.log(`🔍 Debug info:`, {
        serverRunning: this.callbackServer.isRunning(),
        callbackUrl: this.callbackServer.getCallbackUrl(),
        expectedState: state
      });
      
      // Re-throw error if in synchronous mode
      if (waitForCompletion) {
        throw error;
      }
    } finally {
      // Handle server shutdown based on mode
      if (waitForCompletion) {
        // Synchronous mode: shut down immediately
        console.log(`🛑 Synchronous mode: shutting down OAuth callback server immediately...`);
        try {
          await this.callbackServer.stop();
          console.log(`✅ OAuth callback server shut down gracefully`);
        } catch (error) {
          console.error(`❌ Error shutting down callback server:`, error);
        }
      } else {
        // Background mode: give time to see success message
        console.log(`⏰ Background mode: OAuth callback server will shut down in 5 seconds...`);
        setTimeout(async () => {
          try {
            console.log(`🛑 Stopping OAuth callback server...`);
            await this.callbackServer.stop();
            console.log(`✅ OAuth callback server shut down gracefully`);
          } catch (error) {
            console.error(`❌ Error shutting down callback server:`, error);
          }
        }, 5000);
      }
    }
  }

  /**
   * Handle manual callback with authorization code
   */
  private async handleCallback(code: string): Promise<any> {
    if (!code) {
      throw new Error('Authorization code is required for callback mode');
    }

    try {
      await this.completeAuthentication(code);
      
      return {
        status: 'authenticated',
        message: 'Authentication completed successfully',
        user: this.sessionAuthManager.getUserInfo()
      };
    } catch (error: any) {
      throw new OAuthError(`Authentication failed: ${error.message}`, 'token_exchange');
    }
  }

  /**
   * Complete authentication by exchanging code for tokens
   */
  private async completeAuthentication(code: string): Promise<void> {
    // Exchange code for tokens
    const tokens = await this.authClient.exchangeCodeForTokens(code);
    
    // Get user info
    const user = await this.authClient.getUserInfo(tokens.access_token);

    // Store auth session with separate parameters
    this.sessionAuthManager.setAuthSession(tokens, user);
    
    console.log(`Authentication successful for user: ${user.email}`);
  }

  /**
   * Get current authentication status
   * 
   * ⚠️  IMPORTANT BEHAVIOR NOTE:
   * - This method ONLY checks authentication status and does NOT start auth flow
   * - However, when called through MCP server, if this method throws AuthenticationError,
   *   the server's auto-auth feature will automatically trigger gas_auth(mode="start")
   * - To disable auto-auth behavior, set MCP_TEST_MODE=true environment variable
   * - See src/server/mcpServer.ts handleAuthenticationError() method for auto-auth logic
   * 
   * The auto-auth behavior was added to improve user experience but can be unexpected
   * when you only want to check status without triggering authentication.
   */
  private async getAuthenticationStatus(): Promise<any> {
    const status = this.sessionAuthManager.getAuthStatus();
    
    return {
      status: status.authenticated ? 'authenticated' : 'not_authenticated',
      authenticated: status.authenticated,
      tokenValid: status.tokenValid,
      user: status.user,
      expiresIn: status.expiresIn,
      serverRunning: this.callbackServer.isRunning(),
      instructions: status.authenticated 
        ? 'You are authenticated and ready to use Gas tools'
        : 'Use gas_auth(mode="start") to authenticate'
    };
  }

  /**
   * Logout and clear authentication
   */
  private async logout(): Promise<any> {
    try {
      // Get current token for revocation
      const currentToken = this.sessionAuthManager.getValidToken();
      
      if (currentToken) {
        // Revoke token on Google's side
        await this.authClient.revokeTokens(currentToken);
      }
      
      // Clear local auth state
      this.sessionAuthManager.clearAuth();
      
      // Stop callback server if running
      if (this.callbackServer.isRunning()) {
        await this.callbackServer.stop();
      }
      
      return {
        status: 'logged_out',
        message: 'Successfully logged out and cleared authentication'
      };
    } catch (error: any) {
      // Still clear local state even if revocation fails
      this.sessionAuthManager.clearAuth();
      
      return {
        status: 'logged_out',
        message: 'Logged out locally (token revocation may have failed)',
        warning: error.message
      };
    }
  }

  // ✅ Use provided token or fall back to singleton auth
  private async initializeClient(accessToken?: string): Promise<void> {
    const token = accessToken || await this.authClient.getValidAccessToken();
    // ... rest of method
  }
} 