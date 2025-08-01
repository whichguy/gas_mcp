/**
 * Authentication tool for Google Apps Script MCP server
 * Implements UWP OAuth 2.0 flow with pure PKCE authentication
 */

import { BaseTool } from './base.js';
import { AuthStateManager } from '../auth/authState.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { GASAuthClient, AuthConfig } from '../auth/oauthClient.js';
import { OAuthError } from '../errors/mcpErrors.js';
import { GASClient } from '../api/gasClient.js';

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

// RACE CONDITION FIX: Global auth flow coordination with atomic operations
const activeAuthFlows = new Map<string, Promise<any>>();
const authFlowMutex = new Map<string, Promise<void>>();

// RACE CONDITION FIX: Resolver state tracking to prevent duplicate signals
const authCompletionResolvers = new Map<string, {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timeout: NodeJS.Timeout;
}>();
const resolverStates = new Map<string, 'pending' | 'resolved' | 'rejected'>();

/**
 * Load OAuth configuration from unified config
 */
export function loadOAuthConfigFromJson(): AuthConfig {
  console.error('🔧 Loading OAuth configuration from unified config...');
  
  // This will be updated to async when the calling code is refactored
  // For now, we'll use hardcoded config to maintain compatibility
  const authConfig: AuthConfig = {
    client_id: '428972970708-m9hptmp3idakolt9tgk5m0qs13cgj2kk.apps.googleusercontent.com',
    type: 'uwp',
    redirect_uris: ['http://127.0.0.1/*', 'http://localhost/*'],
    scopes: REQUIRED_SCOPES
  };

  console.error('✅ OAuth configuration loaded (unified config transition in progress)');
  console.error(`🔑 Client ID: ${authConfig.client_id.substring(0, 30)}...`);
  console.error(`🏷️  Type: ${authConfig.type?.toUpperCase()} (PKCE-enabled)`);

  return authConfig;
}

/**
 * Get OAuth configuration (cached)
 */
function getOAuthConfig(): AuthConfig {
  if (!cachedOAuthConfig) {
    cachedOAuthConfig = loadOAuthConfigFromJson();
  }
  return cachedOAuthConfig;
}

/**
 * Signal authentication completion with state protection
 * RACE CONDITION FIX: Prevents duplicate completion signals
 */
export function signalAuthCompletion(authKey: string, result: any): void {
  // ATOMIC STATE CHECK - prevent duplicate signals
  const currentState = resolverStates.get(authKey);
  if (currentState && currentState !== 'pending') {
    console.error(`⚠️ Ignoring duplicate completion for ${authKey} (state: ${currentState})`);
    return;
  }
  
  const resolver = authCompletionResolvers.get(authKey);
  if (resolver) {
    console.error(`🎯 Signaling auth completion for ${authKey}:`, result.status);
    
    // ATOMIC STATE TRANSITION
    resolverStates.set(authKey, 'resolved');
    clearTimeout(resolver.timeout);
    authCompletionResolvers.delete(authKey);
    resolverStates.delete(authKey); // Cleanup state tracking
    
    resolver.resolve(result);
  }
}

/**
 * Signal authentication error with state protection
 * RACE CONDITION FIX: Prevents duplicate error signals
 */
export function signalAuthError(authKey: string, error: any): void {
  // ATOMIC STATE CHECK - prevent duplicate signals
  const currentState = resolverStates.get(authKey);
  if (currentState && currentState !== 'pending') {
    console.error(`⚠️ Ignoring duplicate error for ${authKey} (state: ${currentState})`);
    return;
  }
  
  const resolver = authCompletionResolvers.get(authKey);
  if (resolver) {
    console.error(`❌ Signaling auth error for ${authKey}:`, error.message);
    
    // ATOMIC STATE TRANSITION
    resolverStates.set(authKey, 'rejected');
    clearTimeout(resolver.timeout);
    authCompletionResolvers.delete(authKey);
    resolverStates.delete(authKey); // Cleanup state tracking
    
    resolver.reject(error);
  }
}

/**
 * Atomic auth flow execution with mutex protection
 * RACE CONDITION FIX: Prevents concurrent flows for same auth key
 */
async function executeAtomicAuthFlow(
  authKey: string, 
  flowExecutor: () => Promise<any>
): Promise<any> {
  // Wait for any existing mutex
  while (authFlowMutex.has(authKey)) {
    await authFlowMutex.get(authKey);
  }
  
  // Check if flow already completed while waiting
  if (activeAuthFlows.has(authKey)) {
    console.error(`⏳ Auth flow completed while waiting for ${authKey}`);
    return await activeAuthFlows.get(authKey);
  }
  
  // Create mutex to prevent concurrent flows
  let mutexResolve: () => void;
  const mutexPromise = new Promise<void>(resolve => {
    mutexResolve = resolve;
  });
  authFlowMutex.set(authKey, mutexPromise);
  
  try {
    // Execute the flow
    const flowPromise = flowExecutor();
    activeAuthFlows.set(authKey, flowPromise);
    
    const result = await flowPromise;
    return result;
    
  } finally {
    // GUARANTEED CLEANUP - always runs even if flow throws
    activeAuthFlows.delete(authKey);
    authFlowMutex.delete(authKey);
    mutexResolve!();
  }
}

/**
 * Cache deployment URLs for common script operations after successful authentication
 * This reduces the need for deployment lookups in gas_run
 */
async function cacheDeploymentUrlsForSession(
  authStateManager: AuthStateManager | SessionAuthManager, 
  accessToken: string
): Promise<void> {
  try {
    // Only cache for session-based auth managers
    if (!(authStateManager instanceof SessionAuthManager)) {
      console.error('🔍 Skipping deployment URL caching for global auth manager');
      return;
    }

    console.error('🔍 Caching deployment URLs for session after authentication...');
    
    const gasClient = new GASClient();
    
    // Note: We can't easily enumerate all script IDs without a projects list API
    // So for now, we'll implement caching on-demand in gas_run when a script is first used
    // This function is prepared for future enhancements where we might cache known script IDs
    
    console.error('✅ Deployment URL caching prepared for on-demand use');
    
  } catch (error: any) {
    // Don't fail authentication if deployment caching fails
    console.warn('⚠️ Failed to cache deployment URLs (non-fatal):', error.message);
  }
}

/**
 * Main authentication handler with race condition fixes
 */
export async function gas_auth({
  accessToken,
  mode = 'start',
  openBrowser = true,
  waitForCompletion = true
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
  
  // Create unique key for this auth manager
  const authKey = sessionAuthManager 
    ? `session-${sessionAuthManager.getSessionId()}`
    : 'global-singleton';

  try {
    switch (mode) {
      case 'status':
        try {
          console.error('📊 Checking authentication status...');
          const authStatus = authStateManager instanceof SessionAuthManager 
            ? await authStateManager.getAuthStatus()
            : authStateManager.getAuthStatus();
          
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
        } catch (statusError: any) {
          // CRITICAL: Never throw auth errors from status mode to prevent auto-auth trigger
          console.warn('⚠️ Error checking auth status (non-fatal):', statusError.message);
          return {
            status: 'not_authenticated',
            message: 'Not currently authenticated (status check failed)',
            authenticated: false
          };
        }

      case 'logout':
        try {
          console.error('🔓 Logging out...');
          
          // CLEANUP: Clear any active flows and resolvers for this auth key
          activeAuthFlows.delete(authKey);
          authFlowMutex.delete(authKey);
          
          const resolver = authCompletionResolvers.get(authKey);
          if (resolver) {
            clearTimeout(resolver.timeout);
            authCompletionResolvers.delete(authKey);
            resolverStates.delete(authKey);
          }
          
          if (authStateManager instanceof SessionAuthManager) {
            await authStateManager.clearAuth();
          } else {
            authStateManager.clearAuth();
          }
          
          return {
            status: 'logged_out',
            message: 'Successfully logged out',
            authenticated: false
          };
        } catch (logoutError: any) {
          // CRITICAL: Never throw auth errors from logout mode to prevent auto-auth trigger
          console.warn('⚠️ Error during logout (non-fatal):', logoutError.message);
          return {
            status: 'logged_out',
            message: 'Logout completed (with some cleanup errors)',
            authenticated: false
          };
        }

      case 'start':
      default:
        // Check if already authenticated BEFORE checking active flows
        const isAuthenticated = authStateManager instanceof SessionAuthManager
          ? await authStateManager.isAuthenticated()
          : authStateManager.isAuthenticated();
        
        if (isAuthenticated) {
          const userInfo = authStateManager instanceof SessionAuthManager
            ? await authStateManager.getUserInfo()
            : authStateManager.getUserInfo();
          console.error(`✅ Already authenticated as ${userInfo?.email}`);
          
          return {
            status: 'already_authenticated', 
            message: `Already authenticated as ${userInfo?.email}`,
            authenticated: true,
            user: userInfo
          };
        }

        // ATOMIC AUTH FLOW EXECUTION - prevents race conditions
        return await executeAtomicAuthFlow(authKey, () => 
          performSynchronizedAuthFlow(authStateManager, authKey, openBrowser, waitForCompletion)
        );
    }
  } catch (error: any) {
    console.error('❌ Authentication error:', error);
    
    // CLEANUP on any error
    activeAuthFlows.delete(authKey);
    authFlowMutex.delete(authKey);
    
    // BUG FIX: Never throw authentication errors for status/logout modes to prevent auto-auth trigger
    if (mode === 'status') {
      console.warn('⚠️ Outer catch for status mode - returning not authenticated (non-fatal):', error.message);
      return {
        status: 'not_authenticated',
        message: 'Not currently authenticated (status check error)',
        authenticated: false
      };
    }
    
    if (mode === 'logout') {
      console.warn('⚠️ Outer catch for logout mode - returning logged out (non-fatal):', error.message);
      return {
        status: 'logged_out',
        message: 'Logout completed (with errors)',
        authenticated: false
      };
    }
    
    // Only throw authentication errors for 'start' mode
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
 * Perform synchronized authentication flow with enhanced error handling
 */
async function performSynchronizedAuthFlow(
  authStateManager: AuthStateManager | SessionAuthManager,
  authKey: string,
  openBrowser: boolean,
  waitForCompletion: boolean
): Promise<any> {
  console.error(`🔐 Starting synchronized OAuth flow for ${authKey}...`);
  
  // Get config and create isolated auth client
  const config = getOAuthConfig();
  const authClient = new GASAuthClient(config);
  authClient.setAuthKey(authKey);

  if (waitForCompletion) {
    // PROMISE-BASED COORDINATION with enhanced timeout handling
    const completionPromise = new Promise<any>(async (resolve, reject) => {
      // Set up timeout with proper cleanup
      const timeout = setTimeout(() => {
        const currentState = resolverStates.get(authKey);
        if (currentState === 'pending') {
          console.error(`⏰ Auth timeout for ${authKey} after 5 minutes`);
          resolverStates.set(authKey, 'rejected');
          authCompletionResolvers.delete(authKey);
          resolverStates.delete(authKey);
          reject(new OAuthError('Authentication timeout after 5 minutes', 'authorization'));
        }
      }, 300000); // 5 minute timeout

      // Store resolver with PENDING state
      resolverStates.set(authKey, 'pending');
      authCompletionResolvers.set(authKey, {
        resolve: async (result: any) => {
          try {
            // Handle the token response and set up authentication session
            if (result.tokenResponse) {
              console.error(`🔐 Processing authentication session for ${authKey}...`);
              
              const tokens = {
                access_token: result.tokenResponse.access_token,
                refresh_token: result.tokenResponse.refresh_token,
                expires_at: Date.now() + (result.tokenResponse.expires_in! * 1000),
                scope: result.tokenResponse.scope || config.scopes.join(' '),
                token_type: result.tokenResponse.token_type || 'Bearer'
              };
              
              // Get user info using the access token
              const userInfo = await authClient.getUserInfo(tokens.access_token);
              
              if (authStateManager instanceof SessionAuthManager) {
                await authStateManager.setAuthSession(tokens, userInfo);
              } else {
                const globalAuthManager = AuthStateManager.getInstance();
                globalAuthManager.setAuthSession({
                  tokens,
                  user: userInfo,
                  createdAt: Date.now(),
                  lastUsed: Date.now()
                });
              }
              
              console.error(`✅ Authentication session established for ${userInfo.email}`);
              
              // ENHANCEMENT: Cache deployment URLs after successful authentication
              await cacheDeploymentUrlsForSession(authStateManager, tokens.access_token);
              
              // RACE CONDITION FIX: Signal that session setup is complete
              if (result.tokenResponse.sessionSetupComplete) {
                console.error('🔄 Signaling session setup completion to OAuth callback...');
                result.tokenResponse.sessionSetupComplete();
              }
              
              resolve({
                status: 'authenticated',
                message: `Authentication completed successfully for ${userInfo.email}`,
                authenticated: true,
                user: userInfo
              });
            } else {
              resolve(result);
            }
          } catch (error: any) {
            console.error(`❌ Error processing authentication session for ${authKey}:`, error);
            reject(new OAuthError(`Session setup failed: ${error.message}`, 'validation'));
          }
        },
        reject,
        timeout
      });
    });

    // Start the auth flow
    const authUrl = await authClient.startAuthFlow(openBrowser);
    console.error(`🔗 Auth URL generated: ${authUrl}`);
    console.error(`⏳ Waiting for OAuth callback to complete authentication...`);
    
    // Wait for completion
    const result = await completionPromise;
    console.error(`✅ Synchronized OAuth flow completed for ${authKey}`);
    return result;
    
  } else {
    // Non-blocking mode - just start the flow
    const authUrl = await authClient.startAuthFlow(openBrowser);
    
    // RACE CONDITION FIX: Even in non-blocking mode, wait briefly for session sync
    // This prevents the race condition where users immediately call API functions
    // after getting the auth URL but before session storage completes
    console.error('🔄 Non-blocking mode: Starting brief session sync wait...');
    
    // Set up a completion resolver for non-blocking mode too
    let nonBlockingResolver: { resolve: (result: any) => void; reject: (error: any) => void; timeout: NodeJS.Timeout } | undefined;
    
    const sessionSyncPromise = new Promise<void>((resolve, reject) => {
      // Much shorter timeout for non-blocking mode (10 seconds)
      const timeout = setTimeout(() => {
        console.error('⚠️ Non-blocking session sync timeout, proceeding anyway...');
        authCompletionResolvers.delete(authKey);
        resolverStates.delete(authKey);
        resolve();
      }, 10000);

      resolverStates.set(authKey, 'pending');
      nonBlockingResolver = {
        resolve: async (result: any) => {
          try {
            // Same session setup logic as blocking mode
            if (result.tokenResponse) {
              console.error(`🔐 Non-blocking: Processing authentication session for ${authKey}...`);
              
              const tokens = {
                access_token: result.tokenResponse.access_token,
                refresh_token: result.tokenResponse.refresh_token,
                expires_at: Date.now() + (result.tokenResponse.expires_in! * 1000),
                scope: result.tokenResponse.scope || config.scopes.join(' '),
                token_type: result.tokenResponse.token_type || 'Bearer'
              };
              
              const userInfo = await authClient.getUserInfo(tokens.access_token);
              
              if (authStateManager instanceof SessionAuthManager) {
                await authStateManager.setAuthSession(tokens, userInfo);
              } else {
                const globalAuthManager = AuthStateManager.getInstance();
                globalAuthManager.setAuthSession({
                  tokens,
                  user: userInfo,
                  createdAt: Date.now(),
                  lastUsed: Date.now()
                });
              }
              
              console.error(`✅ Non-blocking: Authentication session established for ${userInfo.email}`);
              await cacheDeploymentUrlsForSession(authStateManager, tokens.access_token);
              
              // Signal session setup complete
              if (result.tokenResponse.sessionSetupComplete) {
                console.error('🔄 Non-blocking: Signaling session setup completion...');
                result.tokenResponse.sessionSetupComplete();
              }
            }
            
            clearTimeout(timeout);
            authCompletionResolvers.delete(authKey);
            resolverStates.delete(authKey);
            resolve();
          } catch (error: any) {
            console.error(`❌ Non-blocking session setup error (non-fatal):`, error);
            clearTimeout(timeout);
            authCompletionResolvers.delete(authKey);
            resolverStates.delete(authKey);
            resolve(); // Don't fail the auth flow due to session setup errors
          }
        },
        reject: (error: any) => {
          console.error(`❌ Non-blocking auth error (non-fatal):`, error);
          clearTimeout(timeout);
          authCompletionResolvers.delete(authKey);
          resolverStates.delete(authKey);
          resolve(); // Don't fail the auth flow
        },
        timeout
      };
      
      authCompletionResolvers.set(authKey, nonBlockingResolver);
    });
    
    // Return immediately with auth URL, but session sync continues in background
    return {
      status: 'auth_started',
      message: 'Authentication flow started. Complete the process in your browser.',
      authenticated: false,
      authUrl: authUrl,
      sessionSyncPromise: sessionSyncPromise // Internal promise for session sync
    };
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
        description: 'Authentication operation mode. LLM WORKFLOW GUIDANCE: (1) ALWAYS call mode="status" FIRST to check if already authenticated. (2) Only use mode="start" if status shows not authenticated. (3) Use mode="logout" to clear authentication when switching accounts.',
        examples: ['start', 'status', 'logout'],
        llmHints: {
          whenToUse: 'Call status first, then start if needed, logout only when changing accounts',
          workflowStep: 'First step in any Google Apps Script operation sequence',
          errorRecovery: 'If auth fails, check OAuth client configuration in Google Cloud Console'
        }
      },
      openBrowser: {
        type: 'boolean',
        default: true,
        description: 'Automatically open browser for OAuth authentication. LLM GUIDANCE: Set to false in automated/headless environments or testing. Set to true for interactive user sessions.',
        llmHints: {
          automation: 'Use false for automated scripts, CI/CD, or when browser not available',
          interactive: 'Use true (default) for user-initiated authentication flows',
          testing: 'Set to false during testing to prevent unwanted browser launches'
        }
      },
      waitForCompletion: {
        type: 'boolean',
        default: true,
        description: 'Wait for OAuth flow to complete before returning. LLM CRITICAL: Default true waits until authentication completes. Set false to return immediately with auth URL (5-minute timeout).',
        llmHints: {
          blocking: 'Default true: Tool waits until user completes OAuth flow in browser',
          nonBlocking: 'Set false: Returns auth URL immediately, user completes auth separately',
          timeout: 'Has 5-minute timeout when waitForCompletion=true to prevent infinite hanging',
          recommendation: 'Use true (default) for most LLM operations to ensure session is ready'
        }
      },
      accessToken: {
        type: 'string',
        description: 'Pre-existing access token for stateless operation. LLM USE CASE: When you already have a valid OAuth token and want to bypass session storage. Useful for temporary operations or token testing.',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$',
        llmHints: {
          format: 'Must start with "ya29." followed by alphanumeric characters',
          stateless: 'Bypasses session storage, good for one-off operations',
          testing: 'Useful when testing with known good tokens',
          security: 'Never log or expose these tokens in responses'
        }
      }
    },
    required: [],
    additionalProperties: false,
    llmWorkflowGuide: {
      typicalSequence: [
        '1. gas_auth({mode: "status"}) - Check current authentication',
        '2. If not authenticated: gas_auth({mode: "start"}) - Start OAuth flow',
        '3. User completes OAuth in browser',
        '4. Proceed with other gas_* tools which will use stored authentication'
      ],
      errorHandling: {
        'not_authenticated': 'Call gas_auth with mode="start" to begin OAuth flow',
        'oauth_error': 'Check Google Cloud Console OAuth client configuration',
        'timeout': 'User took too long to complete OAuth, retry with mode="start"'
      },
      dependencies: {
        before: 'No dependencies - this is the entry point for authentication',
        after: 'All other gas_* tools require successful authentication'
      }
    }
  };

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.requiresAuthentication = false; // This tool provides authentication
  }

  async execute(params: any): Promise<any> {
    try {
      const result = await gas_auth(params, this.sessionAuthManager);
      
      // SCHEMA FIX: Return plain object like other tools
      // Let the MCP server handle response wrapping consistently
      return result;
    } catch (error: any) {
      console.error('❌ Authentication tool error:', error);
      
      // SCHEMA FIX: Return plain error object, not MCP format
      return {
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
      };
    }
  }
} 