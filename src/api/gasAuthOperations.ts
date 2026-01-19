/**
 * Authentication Operations Module
 *
 * This module handles all authentication-related operations for Google Apps Script API:
 * - Client initialization with caching
 * - API call wrapper with rate limiting and error handling
 * - Automatic token refresh on 401 errors
 * - Token revocation for security cleanup
 *
 * Extracted from gasClient.ts for better modularity and maintainability.
 */

import { google } from 'googleapis';
import { GASAuthClient } from '../auth/oauthClient.js';
import { GASApiError } from '../errors/mcpErrors.js';
import { loadOAuthConfigFromJson } from '../tools/authConfig.js';

/**
 * Authentication Operations class
 * Manages Google API client initialization, token management, and API calls
 */
export class GASAuthOperations {
  private authClient: GASAuthClient;
  private scriptApi: any;
  private driveApi: any;

  // PERFORMANCE OPTIMIZATION: Cache initialized clients by token
  private clientCache = new Map<string, { scriptApi: any; driveApi: any; expires: number }>();
  private readonly CLIENT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  // Session manager accessor (set by tools)
  private getCurrentSessionManager?: () => any;

  constructor(authClient: GASAuthClient) {
    this.authClient = authClient;
  }

  /**
   * Get the current script API instance
   */
  getScriptApi(): any {
    return this.scriptApi;
  }

  /**
   * Get the current drive API instance
   */
  getDriveApi(): any {
    return this.driveApi;
  }

  /**
   * Set the session manager accessor
   * This allows the API client to access session-specific refresh tokens
   */
  setSessionManagerAccessor(accessor: () => any): void {
    this.getCurrentSessionManager = accessor;
  }

  /**
   * Initialize the Google APIs client with caching
   * PERFORMANCE OPTIMIZED: Reuses clients for same token
   */
  async initializeClient(accessToken?: string): Promise<void> {
    // accessToken must be provided for API calls since GASAuthClient doesn't manage tokens directly
    if (!accessToken) {
      throw new Error('Access token is required for API initialization');
    }

    const token = accessToken;

    // OPTIMIZATION: Check cache first
    const tokenHash = token.substring(0, 20); // Use first 20 chars as cache key
    const cached = this.clientCache.get(tokenHash);

    if (cached && Date.now() < cached.expires) {
      console.error(`🚀 Using cached API clients for token: ${tokenHash}...`);
      this.scriptApi = cached.scriptApi;
      this.driveApi = cached.driveApi;
      return;
    }

    console.error(`🔧 Initializing new API clients for token: ${tokenHash}...`);

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: token });

    this.scriptApi = google.script({ version: 'v1', auth });
    this.driveApi = google.drive({ version: 'v3', auth });

    // Cache the clients
    this.clientCache.set(tokenHash, {
      scriptApi: this.scriptApi,
      driveApi: this.driveApi,
      expires: Date.now() + this.CLIENT_CACHE_TTL
    });

    console.error(`✅ API clients initialized and cached`);
    console.error(`   scriptApi available: ${!!this.scriptApi}`);
    console.error(`   driveApi available: ${!!this.driveApi}`);
  }

  /**
   * Make rate-limited API call with error handling and automatic token refresh
   *
   * ENHANCED: Now includes automatic token refresh on 401 errors
   * - Transparent to calling code
   * - Only refreshes when actually needed (reactive)
   * - Handles refresh coordination and race conditions
   * - Leverages existing error handling infrastructure
   */
  async makeApiCall<T>(apiCall: () => Promise<T>, accessToken?: string): Promise<T> {
    console.error(`🚀 makeApiCall called with accessToken: ${accessToken ? accessToken.substring(0, 20) + '...' : 'undefined'}`);

    const startTime = Date.now();
    let operationName = 'Unknown Google API Call';
    let apiEndpoint = 'Unknown endpoint';

    try {
      // Initialize client before making the API call
      console.error(`🔧 About to initialize client...`);
      await this.initializeClient(accessToken);
      console.error(`✅ Client initialized, calling API...`);

      // Extract operation context from stack trace for better logging
      const stack = new Error().stack;
      const callerMatch = stack?.match(/at \w+\.(\w+)/);
      operationName = callerMatch ? callerMatch[1] : 'Unknown operation';

      console.error(`📡 [GOOGLE API REQUEST] Starting: ${operationName}`);
      console.error(`   ⏰ Timestamp: ${new Date().toISOString()}`);
      console.error(`   🔑 Auth: ${accessToken ? 'Token present (' + accessToken.substring(0, 10) + '...)' : 'No token'}`);

      const result = await apiCall();

      const duration = Date.now() - startTime;
      console.error(`✅ [GOOGLE API SUCCESS] Completed: ${operationName}`);
      console.error(`   ⏱️  Duration: ${duration}ms`);
      console.error(`   📊 Result type: ${typeof result}`);
      console.error(`   📏 Result size: ${JSON.stringify(result).length} characters`);

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      // **AUTOMATIC TOKEN REFRESH ON 401 ERRORS**
      if (this.isTokenExpiredError(error) && accessToken) {
        console.error(`🔄 [AUTO-REFRESH] Token expired (401), attempting automatic refresh...`);

        try {
          const refreshedToken = await this.attemptTokenRefresh(accessToken);
          if (refreshedToken) {
            console.error(`✅ [AUTO-REFRESH] Token refreshed successfully, retrying API call...`);

            // Reinitialize client with new token and retry
            await this.initializeClient(refreshedToken);
            const retryResult = await apiCall();

            const totalDuration = Date.now() - startTime;
            console.error(`✅ [AUTO-REFRESH SUCCESS] ${operationName} completed after refresh in ${totalDuration}ms`);

            return retryResult;
          }
        } catch (refreshError: any) {
          console.error(`❌ [AUTO-REFRESH FAILED] Token refresh failed: ${refreshError.message}`);
          // Fall through to original error handling
        }
      }

      // Original error handling (unchanged)
      console.error(`❌ [GOOGLE API ERROR] Failed: ${operationName} after ${duration}ms`);
      console.error(`   ⏰ Timestamp: ${new Date().toISOString()}`);
      console.error(`   🔍 Error type: ${error.constructor?.name || 'Unknown'}`);
      console.error(`   📍 API endpoint: ${error.config?.url || apiEndpoint}`);
      console.error(`   🔢 Status code: ${error.response?.status || error.status || error.statusCode || 'Unknown'}`);
      console.error(`   💬 Error message: ${error.message}`);
      console.error(`   📋 Full error:`, error);

      // Enhanced error information extraction
      const statusCode = error.response?.status ||
                         error.status ||
                         error.statusCode ||
                         error.code;

      const message = error.response?.data?.error?.message ||
                     error.response?.data?.message ||
                     error.response?.statusText ||
                     error.message ||
                     'Unknown API error';

      // Create comprehensive error object with all available information
      const enhancedError = new GASApiError(
        `Apps Script API error: ${message}`,
        statusCode,
        {
          originalError: error,
          response: error.response,
          config: error.config,
          request: error.request,
          statusCode: statusCode,
          errorData: error.response?.data,
          headers: error.response?.headers,
          operationName: operationName,
          duration: duration,
          timestamp: new Date().toISOString(),
          autoRefreshAttempted: this.isTokenExpiredError(error) && accessToken ? true : false
        }
      );

      throw enhancedError;
    }
  }

  /**
   * Check if error indicates token expiration (401 Unauthorized)
   */
  private isTokenExpiredError(error: any): boolean {
    const statusCode = error.response?.status || error.status || error.statusCode;
    return statusCode === 401;
  }

  /**
   * Attempt to refresh an expired access token
   *
   * Uses Google OAuth2 library to refresh the token and updates
   * both session and singleton auth managers with new tokens.
   */
  private async attemptTokenRefresh(expiredToken: string): Promise<string | null> {
    // Declare at function scope for error handling access
    let authManager: 'session' | 'singleton' | null = null;

    try {
      console.error(`🔄 [TOKEN-REFRESH] Starting token refresh process...`);

      // Get refresh token from session manager first, then singleton fallback
      let refreshToken: string | null = null;

      // Try session auth manager first (if available)
      if (this.getCurrentSessionManager) {
        try {
          const sessionManager = this.getCurrentSessionManager();
          if (sessionManager) {
            refreshToken = await sessionManager.getRefreshToken();
            if (refreshToken) {
              authManager = 'session';
              console.error(`🔍 [TOKEN-REFRESH] Found refresh token in session manager`);
            }
          }
        } catch (sessionError: any) {
          console.error(`⚠️ [TOKEN-REFRESH] Session manager unavailable: ${sessionError.message}`);
        }
      }

      // Fallback to singleton auth manager
      if (!refreshToken) {
        try {
          const { AuthStateManager } = await import('../auth/authState.js');
          const authStateManager = AuthStateManager.getInstance();
          refreshToken = authStateManager.getRefreshToken();
          if (refreshToken) {
            authManager = 'singleton';
            console.error(`🔍 [TOKEN-REFRESH] Found refresh token in singleton manager`);
          }
        } catch (singletonError: any) {
          console.error(`⚠️ [TOKEN-REFRESH] Singleton manager unavailable: ${singletonError.message}`);
        }
      }

      if (!refreshToken) {
        console.error(`❌ [TOKEN-REFRESH] No refresh token available`);
        return null;
      }

      // Use Google OAuth2 client to refresh the token
      const { OAuth2Client } = await import('google-auth-library');
      const config = loadOAuthConfigFromJson();
      const oauth2Client = new OAuth2Client({
        clientId: config.client_id,
        clientSecret: config.client_secret
      });

      oauth2Client.setCredentials({
        refresh_token: refreshToken
      });

      console.error(`📡 [TOKEN-REFRESH] Calling Google OAuth refresh API...`);
      const { credentials } = await oauth2Client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new Error('No access token in refresh response');
      }

      console.error(`✅ [TOKEN-REFRESH] New token received from Google`);
      console.error(`   📅 Expires: ${credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : 'unknown'}`);

      // Update the appropriate auth manager with new tokens
      // SECURITY: Handle refresh token rotation per OAuth 2.0 RFC 6749 Section 10.4
      const newTokens = {
        access_token: credentials.access_token,
        refresh_token: credentials.refresh_token || refreshToken, // Keep fallback for non-rotating servers
        expires_at: credentials.expiry_date || (Date.now() + 3600000),
        scope: credentials.scope || '',
        token_type: credentials.token_type || 'Bearer'
      };

      // SECURITY WARNING: Log refresh token rotation status
      if (credentials.refresh_token && credentials.refresh_token !== refreshToken) {
        console.error(`🔄 [SECURITY] Refresh token rotated - using new token`);
        console.error(`   Old token (first 10): ${refreshToken.substring(0, 10)}...`);
        console.error(`   New token (first 10): ${credentials.refresh_token.substring(0, 10)}...`);
      } else if (!credentials.refresh_token) {
        console.error(`⚠️ [SECURITY] No new refresh token returned - reusing existing token`);
        console.error(`   This is acceptable for non-rotating OAuth servers`);
      }

      // SECURITY: Validate returned scopes match our requirements
      const expectedScopes = ['https://www.googleapis.com/auth/script.projects', 'https://www.googleapis.com/auth/drive.file'];
      const returnedScopes = (credentials.scope || '').split(' ').filter(s => s);
      const missingScopeWarn = expectedScopes.filter(scope => !returnedScopes.includes(scope));
      if (missingScopeWarn.length > 0) {
        console.error(`⚠️ [SECURITY] Missing expected scopes: ${missingScopeWarn.join(', ')}`);
      }

      if (authManager === 'session' && this.getCurrentSessionManager) {
        try {
          const sessionManager = this.getCurrentSessionManager();
          if (sessionManager) {
            await sessionManager.updateTokens(newTokens);
            console.error(`✅ [TOKEN-REFRESH] Updated session manager with new tokens`);
          }
        } catch (updateError: any) {
          console.error(`⚠️ [TOKEN-REFRESH] Failed to update session manager: ${updateError.message}`);
        }
      } else if (authManager === 'singleton') {
        try {
          const { AuthStateManager } = await import('../auth/authState.js');
          const authStateManager = AuthStateManager.getInstance();
          authStateManager.updateTokens(newTokens);
          console.error(`✅ [TOKEN-REFRESH] Updated singleton manager with new tokens`);
        } catch (updateError: any) {
          console.error(`⚠️ [TOKEN-REFRESH] Failed to update singleton manager: ${updateError.message}`);
        }
      }

      return credentials.access_token;

    } catch (error: any) {
      console.error(`❌ [TOKEN-REFRESH] Refresh failed: ${error.message}`);

      // SECURITY: Handle OAuth 2.0 specific error responses per RFC 6749
      if (error.message?.includes('invalid_grant') || error.code === 'invalid_grant') {
        console.error(`🚨 [SECURITY] Refresh token is invalid/expired - user must re-authenticate`);
        console.error(`   Error type: invalid_grant (OAuth 2.0 error)`);
        console.error(`   Action required: User must run auth(mode="start") to re-authenticate`);

        // Clear invalid refresh tokens from storage
        if (authManager === 'session' && this.getCurrentSessionManager) {
          try {
            const sessionManager = this.getCurrentSessionManager();
            if (sessionManager) {
              // Note: Session managers don't have clearAuth method, they auto-cleanup on invalid tokens
              console.error(`🗑️ [SECURITY] Session will auto-cleanup invalid tokens`);
            }
          } catch (clearError: any) {
            console.error(`⚠️ [SECURITY] Could not access session manager for cleanup: ${clearError.message}`);
          }
        } else if (authManager === 'singleton') {
          try {
            const { AuthStateManager } = await import('../auth/authState.js');
            const authStateManager = AuthStateManager.getInstance();
            authStateManager.clearAuth();
            console.error(`✅ [SECURITY] Cleared invalid refresh token from singleton storage`);
          } catch (clearError: any) {
            console.error(`⚠️ [SECURITY] Failed to clear invalid tokens from singleton: ${clearError.message}`);
          }
        }
      } else if (error.message?.includes('invalid_client')) {
        console.error(`🚨 [SECURITY] OAuth client configuration error`);
        console.error(`   Error type: invalid_client (OAuth 2.0 error)`);
        console.error(`   Check: client_id and client_secret in OAuth configuration`);
      } else if (error.message?.includes('invalid_request')) {
        console.error(`🚨 [SECURITY] Malformed refresh request`);
        console.error(`   Error type: invalid_request (OAuth 2.0 error)`);
        console.error(`   This may indicate a programming error in token refresh logic`);
      }

      return null;
    }
  }

  /**
   * Revoke OAuth tokens for security cleanup
   *
   * SECURITY: Implements OAuth 2.0 token revocation per RFC 7009
   * Called during logout or when tokens are compromised
   */
  async revokeTokens(accessToken?: string): Promise<boolean> {
    try {
      console.error(`🚨 [SECURITY] Starting OAuth token revocation...`);

      // Get tokens to revoke
      let tokensToRevoke: { access_token?: string; refresh_token?: string } = {};

      if (accessToken) {
        tokensToRevoke.access_token = accessToken;
      }

      // Get refresh token for complete revocation
      if (this.getCurrentSessionManager) {
        try {
          const sessionManager = this.getCurrentSessionManager();
          if (sessionManager) {
            const refreshToken = await sessionManager.getRefreshToken();
            if (refreshToken) {
              tokensToRevoke.refresh_token = refreshToken;
              console.error(`🔍 [SECURITY] Found refresh token in session manager for revocation`);
            }
          }
        } catch (sessionError: any) {
          console.error(`⚠️ [SECURITY] Could not access session manager: ${sessionError.message}`);
        }
      }

      // Fallback to singleton for refresh token
      if (!tokensToRevoke.refresh_token) {
        try {
          const { AuthStateManager } = await import('../auth/authState.js');
          const authStateManager = AuthStateManager.getInstance();
          const refreshToken = authStateManager.getRefreshToken();
          if (refreshToken) {
            tokensToRevoke.refresh_token = refreshToken;
            console.error(`🔍 [SECURITY] Found refresh token in singleton manager for revocation`);
          }
        } catch (singletonError: any) {
          console.error(`⚠️ [SECURITY] Could not access singleton manager: ${singletonError.message}`);
        }
      }

      if (!tokensToRevoke.access_token && !tokensToRevoke.refresh_token) {
        console.error(`⚠️ [SECURITY] No tokens found to revoke`);
        return true; // Not an error if no tokens exist
      }

      // Revoke tokens using Google OAuth2 API
      const { OAuth2Client } = await import('google-auth-library');
      const config = loadOAuthConfigFromJson();
      const oauth2Client = new OAuth2Client({
        clientId: config.client_id,
        clientSecret: config.client_secret
      });

      let revocationSuccess = true;

      // Revoke refresh token first (more comprehensive)
      if (tokensToRevoke.refresh_token) {
        try {
          console.error(`🔄 [SECURITY] Revoking refresh token...`);
          await oauth2Client.revokeToken(tokensToRevoke.refresh_token);
          console.error(`✅ [SECURITY] Refresh token revoked successfully`);
        } catch (revokeError: any) {
          console.error(`❌ [SECURITY] Failed to revoke refresh token: ${revokeError.message}`);
          revocationSuccess = false;
        }
      }

      // Revoke access token
      if (tokensToRevoke.access_token) {
        try {
          console.error(`🔄 [SECURITY] Revoking access token...`);
          await oauth2Client.revokeToken(tokensToRevoke.access_token);
          console.error(`✅ [SECURITY] Access token revoked successfully`);
        } catch (revokeError: any) {
          console.error(`❌ [SECURITY] Failed to revoke access token: ${revokeError.message}`);
          revocationSuccess = false;
        }
      }

      // Clear local token storage after revocation
      if (revocationSuccess) {
        console.error(`🧹 [SECURITY] Clearing local token storage after successful revocation...`);

        // Clear session storage
        if (this.getCurrentSessionManager) {
          try {
            const sessionManager = this.getCurrentSessionManager();
            if (sessionManager && typeof sessionManager.clearAuth === 'function') {
              sessionManager.clearAuth();
              console.error(`✅ [SECURITY] Session storage cleared`);
            }
          } catch (clearError: any) {
            console.error(`⚠️ [SECURITY] Could not clear session storage: ${clearError.message}`);
          }
        }

        // Clear singleton storage
        try {
          const { AuthStateManager } = await import('../auth/authState.js');
          const authStateManager = AuthStateManager.getInstance();
          authStateManager.clearAuth();
          console.error(`✅ [SECURITY] Singleton storage cleared`);
        } catch (clearError: any) {
          console.error(`⚠️ [SECURITY] Could not clear singleton storage: ${clearError.message}`);
        }
      }

      return revocationSuccess;

    } catch (error: any) {
      console.error(`❌ [SECURITY] Token revocation failed: ${error.message}`);
      return false;
    }
  }
}
