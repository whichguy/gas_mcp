import { OAuth2Client } from 'google-auth-library';
import { AuthStateManager, TokenInfo, UserInfo } from './authState.js';
import { OAuthError } from '../errors/mcpErrors.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface OAuthConfig {
  oauth: {
    client_id: string;
    client_secret: string;
    redirect_uri: string;
    auth_uri: string;
    token_uri: string;
    scopes: string[];
  };
  server: {
    port: number;
  };
}

function loadOAuthConfig(): OAuthConfig {
  // Try environment variables first
  const envClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const envClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const envPort = process.env.OAUTH_SERVER_PORT;

  if (envClientId && envClientSecret) {
    console.log('🔑 Using OAuth credentials from environment variables');
    return {
      oauth: {
        client_id: envClientId,
        client_secret: envClientSecret,
        redirect_uri: `http://localhost:${envPort || 3000}/oauth/callback`,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        scopes: [
          "https://www.googleapis.com/auth/script.projects",
          "https://www.googleapis.com/auth/script.processes",
          "https://www.googleapis.com/auth/script.deployments",
          "https://www.googleapis.com/auth/script.scriptapp",
          "https://www.googleapis.com/auth/script.external_request",
          "https://www.googleapis.com/auth/script.webapp.deploy",
          "https://www.googleapis.com/auth/drive",
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/documents",
          "https://www.googleapis.com/auth/forms",
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/userinfo.profile"
        ]
      },
      server: {
        port: parseInt(envPort || '3000')
      }
    };
  }

  // Fallback to config file
  const configPath = path.join(__dirname, '..', '..', 'config', 'oauth.json');
  
  if (!fs.existsSync(configPath)) {
    console.error('❌ No OAuth configuration found!');
    console.error('📋 Options:');
    console.error('   1. Run "npm run setup" to create config/oauth.json');
    console.error('   2. Set environment variables: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET');
    console.error('   3. See OAUTH_QUICK_SETUP.md for getting real credentials');
    throw new Error('OAuth configuration not found. Run "npm run setup" or set environment variables.');
  }

  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData) as OAuthConfig;
    
    if (config.oauth.client_id === 'test_client_id') {
      console.log('⚠️  Using test OAuth credentials from config file');
      console.log('📘 See OAUTH_QUICK_SETUP.md to get real Google OAuth credentials');
    } else {
      console.log('✅ Using OAuth credentials from config file');
    }
    
    return config;
  } catch (error) {
    console.error('❌ Failed to parse OAuth config file:', error);
    throw new Error('Invalid OAuth configuration file. Check config/oauth.json format.');
  }
}

// Export the loaded config
export const oauthConfig: OAuthConfig = loadOAuthConfig();

// Export client configuration for OAuth tools
export const oauthClientConfig = {
  clientId: oauthConfig.oauth.client_id,
  clientSecret: oauthConfig.oauth.client_secret,
  redirectUri: oauthConfig.oauth.redirect_uri,
  authUri: oauthConfig.oauth.auth_uri,
  tokenUri: oauthConfig.oauth.token_uri,
  scopes: oauthConfig.oauth.scopes
};

export default oauthConfig;

/**
 * Google OAuth client for Apps Script authentication
 */
export class GASAuthClient {
  private oauth2Client: OAuth2Client;
  private authStateManager: AuthStateManager;
  private config: any;
  private authEndpoint: string;

  constructor() {
    this.oauth2Client = new OAuth2Client(
      oauthConfig.oauth.client_id,
      oauthConfig.oauth.client_secret,
      oauthConfig.oauth.redirect_uri
    );
    this.authStateManager = AuthStateManager.getInstance();
    this.config = oauthConfig;
    this.authEndpoint = 'https://accounts.google.com/o/oauth2/auth';
  }

  /**
   * Generate OAuth authorization URL with state parameter
   */
  generateAuthUrl(state?: string, callbackPort?: number): string {
    const stateParam = state || `state_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Always use the configured redirect URI (port 3000)
    const redirectUri = this.config.oauth.redirect_uri;
    
    // Debug: Log the scopes being requested
    console.log('🔍 OAuth scopes from config:', this.config.oauth.scopes);
    const scopeString = this.config.oauth.scopes.join(' ');
    console.log('🔍 OAuth scope string:', scopeString);
    
    const params = new URLSearchParams({
      access_type: 'offline',
      scope: scopeString,
      prompt: 'consent',
      state: stateParam,
      response_type: 'code',
      client_id: this.config.oauth.client_id,
      redirect_uri: redirectUri
    });

    const authUrl = `${this.authEndpoint}?${params.toString()}`;
    console.log('🔍 Generated OAuth URL:', authUrl);
    
    return authUrl;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string): Promise<TokenInfo> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      
      if (!tokens.access_token) {
        throw new OAuthError('No access token received', 'token_exchange');
      }

      const tokenInfo: TokenInfo = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || undefined,
        expires_at: tokens.expiry_date || (Date.now() + 3600000), // 1 hour default
        scope: tokens.scope || this.config.oauth.scopes.join(' '),
        token_type: tokens.token_type || 'Bearer'
      };

      return tokenInfo;
    } catch (error: any) {
      throw new OAuthError(
        `Failed to exchange code for tokens: ${error.message}`,
        'token_exchange'
      );
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshTokens(refreshToken: string): Promise<TokenInfo> {
    try {
      this.oauth2Client.setCredentials({
        refresh_token: refreshToken
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new OAuthError('No access token received during refresh', 'token_refresh');
      }

      const tokenInfo: TokenInfo = {
        access_token: credentials.access_token,
        refresh_token: credentials.refresh_token || refreshToken, // Keep original if not provided
        expires_at: credentials.expiry_date || (Date.now() + 3600000),
        scope: credentials.scope || this.config.oauth.scopes.join(' '),
        token_type: credentials.token_type || 'Bearer'
      };

      return tokenInfo;
    } catch (error: any) {
      throw new OAuthError(
        `Failed to refresh tokens: ${error.message}`,
        'token_refresh'
      );
    }
  }

  /**
   * Get user info from Google OAuth
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const userData = await response.json();

      return {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        picture: userData.picture,
        verified_email: userData.verified_email
      };
    } catch (error: any) {
      throw new OAuthError(
        `Failed to get user info: ${error.message}`,
        'validation'
      );
    }
  }

  /**
   * Validate access token
   */
  async validateToken(accessToken: string): Promise<boolean> {
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        return false;
      }

      const tokenInfo = await response.json();
      
      // Check if token has required scopes
      const requiredScopes = ['script.projects', 'script.processes', 'script.deployments', 'script.scriptapp'];
      const tokenScopes = tokenInfo.scope?.split(' ') || [];
      
      console.log('🔍 Token scopes:', tokenScopes);
      console.log('🔍 Required scopes:', requiredScopes);
      
      const hasRequiredScopes = requiredScopes.every(scope =>
        tokenScopes.some((ts: string) => ts.includes(scope))
      );
      
      console.log('🔍 Has required scopes:', hasRequiredScopes);

      return hasRequiredScopes;
    } catch (error) {
      return false;
    }
  }

  /**
   * Revoke tokens (logout)
   */
  async revokeTokens(accessToken: string): Promise<void> {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${accessToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
    } catch (error) {
      // Don't throw on revoke errors - just log them
      console.warn('Failed to revoke tokens:', error);
    }
  }

  /**
   * Get valid access token, refreshing if necessary
   */
  async getValidAccessToken(): Promise<string> {
    if (!this.authStateManager.isAuthenticated()) {
      throw new OAuthError('Not authenticated', 'validation');
    }

    // Check if current token is valid
    if (this.authStateManager.isTokenValid()) {
      return this.authStateManager.getValidToken()!;
    }

    // Try to refresh token
    const refreshToken = this.authStateManager.getRefreshToken();
    if (!refreshToken) {
      throw new OAuthError('No refresh token available', 'token_refresh');
    }

    try {
      const newTokens = await this.refreshTokens(refreshToken);
      this.authStateManager.updateTokens(newTokens);
      return newTokens.access_token;
    } catch (error) {
      // Refresh failed - clear auth and require re-authentication
      this.authStateManager.clearAuth();
      throw new OAuthError('Token refresh failed, re-authentication required', 'token_refresh');
    }
  }
} 