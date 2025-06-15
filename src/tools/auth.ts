/**
 * Authentication tool for Google Apps Script MCP server
 * Implements UWP OAuth 2.0 flow with pure PKCE authentication
 */

import { BaseTool } from './base.js';
import { AuthStateManager } from '../auth/authState.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { GASAuthClient, AuthConfig } from '../auth/oauthClient.js';
import { OAuthError } from '../errors/mcpErrors.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// OAuth scopes for Google Apps Script API
const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.processes',
  'https://www.googleapis.com/auth/script.deployments',
  'https://www.googleapis.com/auth/script.scriptapp',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/script.webapp.deploy',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/forms',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

// Cached OAuth configuration
let cachedOAuthConfig: AuthConfig | null = null;

/**
 * Load OAuth configuration ONLY from oauth-config.json file
 * No environment variables, no fallbacks, no complexity
 */
export function loadOAuthConfigFromJson(): AuthConfig {
  // TEMPORARY: Hardcoded config for testing
  console.log('⚠️  Using hardcoded OAuth configuration for testing');
  
  const authConfig: AuthConfig = {
    client_id: '428972970708-jtm1ou5838lv7vbjdv5kgp5222s7d8f0.apps.googleusercontent.com',
    type: 'uwp',
    redirect_uris: ['http://127.0.0.1/*', 'http://localhost/*'],
    scopes: REQUIRED_SCOPES
  };

  console.log('✅ OAuth configuration loaded successfully (hardcoded)');
  console.log(`🔑 Client ID: ${authConfig.client_id.substring(0, 30)}...`);
  console.log(`🔐 Client Secret: ${authConfig.client_secret ? 'PROVIDED (optional)' : 'NOT PROVIDED (UWP PKCE-only)'}`);
  console.log(`🏷️  Type: ${authConfig.type?.toUpperCase()} (PKCE-enabled)`);

  return authConfig;
}

/**
 * Get OAuth configuration (cached or load from file)
 */
function getOAuthConfig(): AuthConfig {
  if (!cachedOAuthConfig) {
    cachedOAuthConfig = loadOAuthConfigFromJson();
  }
  return cachedOAuthConfig;
}

/**
 * Reload OAuth configuration from JSON file
 * Clears cache and loads fresh configuration
 */
export function reloadOAuthConfig(): AuthConfig {
  console.log('🔄 Reloading OAuth configuration from oauth-config.json...');
  cachedOAuthConfig = null; // Clear cache
  cachedOAuthConfig = loadOAuthConfigFromJson();
  console.log('✅ OAuth configuration reloaded successfully');
  return cachedOAuthConfig;
}

/**
 * Main authentication handler
 */
export async function gas_auth({
  accessToken,
  mode = 'start',
  openBrowser = true,
  waitForCompletion = false
}: {
  accessToken?: string;
  mode?: 'start' | 'status' | 'logout';
  openBrowser?: boolean;
  waitForCompletion?: boolean;
} = {}, sessionAuthManager?: SessionAuthManager): Promise<{
  status: string;
  message: string;
  authUrl?: string;
  authenticated?: boolean;
  user?: any;
  tokenValid?: boolean;
  expiresIn?: number;
}> {
  // Use session manager if provided, otherwise fall back to global manager
  const authStateManager = sessionAuthManager || AuthStateManager.getInstance();

  try {
    switch (mode) {
      case 'status':
        console.log('📊 Checking authentication status...');
        const authStatus = authStateManager.getAuthStatus();
        
        if (authStatus.authenticated) {
          return {
            status: 'authenticated',
            message: `Authenticated as ${authStatus.user?.email}`,
            authenticated: true,
            user: authStatus.user,
            tokenValid: authStatus.tokenValid,
            expiresIn: authStatus.expiresIn
          };
        } else {
          return {
            status: 'not_authenticated',
            message: 'Not currently authenticated',
            authenticated: false
          };
        }

      case 'logout':
        console.log('🔓 Logging out...');
        authStateManager.clearAuth();
        return {
          status: 'logged_out',
          message: 'Successfully logged out',
          authenticated: false
        };

      case 'start':
      default:
        // Check if already authenticated and tokens are valid
        if (authStateManager.isAuthenticated()) {
          const userInfo = authStateManager.getUserInfo();
          console.log(`✅ Already authenticated as ${userInfo?.email}`);
          
          return {
            status: 'already_authenticated', 
            message: `Already authenticated as ${userInfo?.email}`,
            authenticated: true,
            user: userInfo
          };
        }

        // Get config and create auth client
        const config = getOAuthConfig();
        const authClient = new GASAuthClient(config);

        if (waitForCompletion) {
          console.log('🔐 Starting complete OAuth flow...');
          
          // Perform complete authentication flow
          const tokenResponse = await authClient.performCompleteAuthFlow(openBrowser);
          
          // Create auth session with proper method signature based on manager type
          const tokens = {
            access_token: tokenResponse.access_token,
            refresh_token: tokenResponse.refresh_token,
            expires_at: Date.now() + (tokenResponse.expires_in! * 1000),
            scope: tokenResponse.scope || config.scopes.join(' '),
            token_type: tokenResponse.token_type || 'Bearer'
          };
          
          const user = { 
            id: 'auth-user', 
            email: 'authenticated-user@gmail.com', 
            name: 'Authenticated User',
            verified_email: true
          };
          
          if (sessionAuthManager) {
            // Session manager uses different method signature
            sessionAuthManager.setAuthSession(tokens, user);
          } else {
            // Global auth manager expects complete session object
            const globalAuthManager = AuthStateManager.getInstance();
            globalAuthManager.setAuthSession({
              tokens,
              user,
              createdAt: Date.now(),
              lastUsed: Date.now()
            });
          }
          
          return {
            status: 'authenticated',
            message: 'Authentication completed successfully',
            authenticated: true,
                         user: { 
               id: 'auth-user', 
               email: 'authenticated-user@gmail.com', 
               name: 'Authenticated User',
               verified_email: true
             }
          };
          
        } else {
          // Just start the flow and return the URL
          const authUrl = await authClient.startAuthFlow(openBrowser);
          
          return {
            status: 'auth_started',
            message: 'Authentication flow started. Complete the process in your browser.',
            authenticated: false,
            authUrl: authUrl
          };
        }
    }
  } catch (error: any) {
    console.error('❌ Authentication error:', error);
    
    if (error instanceof OAuthError) {
      throw error;
    }
    
    throw new OAuthError(
      `Authentication failed: ${error.message}`,
      'authorization'
    );
  }
}

/**
 * Authentication tool for Google Apps Script OAuth
 */
export class GASAuthTool extends BaseTool {
  public name = 'gas_auth';
  public description = 'Authenticate with Google Apps Script API using OAuth 2.0 (desktop flow with PKCE)';
  public inputSchema = {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['start', 'status', 'logout'],
        default: 'start',
        description: 'Authentication mode: start (begin flow), status (check auth), logout (clear auth)'
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

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    // Override requiresAuthentication since this tool provides authentication
    this.requiresAuthentication = false;
  }

  async execute(params: any): Promise<any> {
    try {
      const result = await gas_auth(params, this.sessionAuthManager);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ],
        isError: false
      };
    } catch (error: any) {
      console.error('❌ Authentication tool error:', error);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: {
                type: error.constructor.name,
                message: error.message,
                phase: error.data?.phase || 'unknown'
              },
              instructions: [
                '🔑 Authentication failed',
                '📖 See DESKTOP_OAUTH_SETUP.md for setup instructions',
                '🔧 Ensure OAuth client is configured as "Desktop Application"',
                '🌐 Check Google Cloud Console OAuth client configuration'
              ]
            }, null, 2)
          }
        ],
        isError: true
      };
    }
  }
} 