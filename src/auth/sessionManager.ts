import { randomUUID } from 'crypto';

// IN-MEMORY AUTHENTICATION STORAGE
// Global Map to store all authentication sessions across MCP server instances
const MEMORY_AUTH_SESSIONS = new Map<string, AuthSession>();

/**
 * OAuth token information
 */
export interface TokenInfo {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope: string;
  token_type: string;
}

/**
 * User information from Google OAuth
 */
export interface UserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
  verified_email: boolean;
}

/**
 * Complete authentication session
 */
export interface AuthSession {
  sessionId: string;
  tokens: TokenInfo;
  user: UserInfo;
  createdAt: number;
  lastUsed: number;
  deploymentUrls?: Map<string, string>; // Map of scriptId -> gas_run URL
}

/**
 * Simplified Session-based authentication manager
 * Supports concurrent MCP clients with basic isolation
 * NO FILE SYSTEM - all sessions stored in memory
 * Sessions are lost on server restart (requires re-authentication)
 * SIMPLIFIED: Removed complex locking since MCP is half-duplex
 */
export class SessionAuthManager {
  private sessionId: string;

  constructor(sessionId?: string) {
    console.error(`🔧 SessionAuthManager (IN-MEMORY) constructor called with sessionId: ${sessionId || 'undefined'}`);
    
    // If no session ID provided, try to reuse existing valid session
    if (!sessionId) {
      console.error(`🔍 No session ID provided, looking for existing valid session...`);
      const existingSessionId = this.findExistingValidSession();
      if (existingSessionId) {
        this.sessionId = existingSessionId;
        console.error(`🔄 Reusing existing session: ${this.sessionId}`);
      } else {
        this.sessionId = randomUUID();
        console.error(`🔒 Created new session: ${this.sessionId}`);
      }
    } else {
      this.sessionId = sessionId;
      console.error(`🔒 Using specified session: ${this.sessionId}`);
    }
  }

  /**
   * Find an existing valid session to reuse
   */
  private findExistingValidSession(): string | null {
    try {
      console.error(`🔍 Looking for existing sessions in memory...`);
      console.error(`💾 Found ${MEMORY_AUTH_SESSIONS.size} sessions in memory`);
      
      for (const [sessionId, sessionData] of MEMORY_AUTH_SESSIONS.entries()) {
        try {
          console.error(`📄 Checking session: ${sessionId}`);
          console.error(`   User: ${sessionData.user?.email}`);
          console.error(`   Expires at: ${sessionData.tokens?.expires_at} (${new Date(sessionData.tokens?.expires_at).toLocaleString()})`);
          
          // Check if session is valid and not expired
          if (sessionData.tokens && sessionData.user && sessionData.tokens.expires_at) {
            const bufferMs = 5 * 60 * 1000; // 5 minute buffer
            const currentTime = Date.now();
            const expiresAt = sessionData.tokens.expires_at;
            const isValid = currentTime < (expiresAt - bufferMs);
            
            console.error(`   Current time: ${currentTime}`);
            console.error(`   Expires with buffer: ${expiresAt - bufferMs}`);
            console.error(`   Is valid: ${isValid}`);
            
            if (isValid) {
              console.error(`✅ Found valid session for ${sessionData.user.email}`);
              return sessionData.sessionId;
            } else {
              console.error(`⏰ Session expired for ${sessionData.user.email}`);
              // Clean up expired session
              MEMORY_AUTH_SESSIONS.delete(sessionId);
            }
          } else {
            console.error(`⚠️  Session missing required fields`);
          }
        } catch (error) {
          // Skip corrupted session data
          console.warn(`⚠️  Skipping corrupted session: ${sessionId}`, error);
          MEMORY_AUTH_SESSIONS.delete(sessionId);
        }
      }
      
      console.error(`❌ No valid sessions found`);
      return null;
    } catch (error) {
      console.warn(`⚠️  Failed to find existing sessions:`, error);
      return null;
    }
  }

  /**
   * Get the session ID for this manager
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Store authentication session in memory
   * SIMPLIFIED: Removed complex locking since MCP is half-duplex
   */
  async setAuthSession(tokens: TokenInfo, user: UserInfo): Promise<void> {
    const authSession: AuthSession = {
      sessionId: this.sessionId,
      tokens,
      user,
      createdAt: Date.now(),
      lastUsed: Date.now()
    };
    
    MEMORY_AUTH_SESSIONS.set(this.sessionId, authSession);
    console.error(`✅ Stored session ${this.sessionId} for ${user.email} in memory`);
  }

  /**
   * Get current authentication session from memory
   * SIMPLIFIED: Basic Map operation since MCP is half-duplex
   */
  async getAuthSession(): Promise<AuthSession | null> {
    const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
    
    if (authSession) {
      // Update last used timestamp
      authSession.lastUsed = Date.now();
      MEMORY_AUTH_SESSIONS.set(this.sessionId, authSession);
    }
    
    return authSession || null;
  }

  /**
   * Force reload authentication session (no-op for in-memory, just here for compatibility)
   */
  public async reloadAuthSession(): Promise<void> {
    console.error(`🔄 Reload session ${this.sessionId} (no-op for in-memory)`);
  }

  /**
   * Check if current token is valid (not expired) - INTERNAL METHOD
   */
  private isTokenValidInternal(authSession: AuthSession): boolean {
    if (!authSession || !authSession.tokens) return false;
    
    // Add 5 minute buffer before expiration
    const bufferMs = 5 * 60 * 1000;
    const isValid = Date.now() < (authSession.tokens.expires_at - bufferMs);
    
    return isValid;
  }

  /**
   * Check if currently authenticated
   * SIMPLIFIED: Basic operation since MCP is half-duplex
   */
  async isAuthenticated(): Promise<boolean> {
    const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
    if (!authSession) return false;
    
    // Check if token is valid
    const tokenValid = this.isTokenValidInternal(authSession);
    
    // Auto-delete expired tokens
    if (!tokenValid) {
      console.error(`🗑️  Auto-deleting expired session tokens for ${this.sessionId}`);
      MEMORY_AUTH_SESSIONS.delete(this.sessionId);
      return false;
    }
    
    return true;
  }

  /**
   * Check if current token is valid (not expired)
   * SIMPLIFIED: Basic operation since MCP is half-duplex
   */
  async isTokenValid(): Promise<boolean> {
    const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
    if (!authSession) return false;
    
    const isValid = this.isTokenValidInternal(authSession);
    
    // Auto-cleanup expired sessions
    if (!isValid && authSession) {
      console.error(`⏰ Session ${this.sessionId} token expired at ${new Date(authSession.tokens.expires_at).toISOString()}, auto-cleaning up`);
      MEMORY_AUTH_SESSIONS.delete(this.sessionId);
    }
    
    return isValid;
  }

  /**
   * Get current access token if valid
   * SIMPLIFIED: Basic operation since MCP is half-duplex
   */
  async getValidToken(): Promise<string | null> {
    const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
    if (!authSession) return null;
    
    // Check token validity
    if (!this.isTokenValidInternal(authSession)) {
      console.error(`🗑️  Token expired for session ${this.sessionId}, removing session`);
      MEMORY_AUTH_SESSIONS.delete(this.sessionId);
      return null;
    }
    
    return authSession.tokens.access_token;
  }

  /**
   * Get refresh token for renewal
   */
  async getRefreshToken(): Promise<string | null> {
    const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
    return authSession?.tokens.refresh_token || null;
  }

  /**
   * Update tokens after refresh
   */
  async updateTokens(tokens: TokenInfo): Promise<void> {
    const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
    
    if (authSession) {
      authSession.tokens = tokens;
      authSession.lastUsed = Date.now();
      MEMORY_AUTH_SESSIONS.set(this.sessionId, authSession);
      console.error(`✅ Updated tokens for session ${this.sessionId}`);
    }
  }

  /**
   * Get current user info
   */
  async getUserInfo(): Promise<UserInfo | null> {
    const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
    return authSession?.user || null;
  }

  /**
   * Clear authentication session (logout)
   */
  async clearAuth(): Promise<void> {
    MEMORY_AUTH_SESSIONS.delete(this.sessionId);
    console.error(`✅ Cleared session ${this.sessionId} from memory`);
  }

  /**
   * Get authentication status for reporting
   * SIMPLIFIED: Basic operation since MCP is half-duplex
   */
  async getAuthStatus(): Promise<{
    sessionId: string;
    authenticated: boolean;
    user?: UserInfo;
    tokenValid: boolean;
    expiresIn?: number;
  }> {
    const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
    
    if (!authSession) {
      return { 
        sessionId: this.sessionId,
        authenticated: false, 
        tokenValid: false 
      };
    }

    const tokenValid = this.isTokenValidInternal(authSession);
    const expiresIn = tokenValid 
      ? Math.max(0, Math.floor((authSession.tokens.expires_at - Date.now()) / 1000))
      : 0;

    return {
      sessionId: this.sessionId,
      authenticated: true,
      user: authSession.user,
      tokenValid,
      expiresIn
    };
  }

  /**
   * Create a session manager from an external session ID
   * Used when clients want to resume existing sessions
   */
  static fromSessionId(sessionId: string): SessionAuthManager {
    return new SessionAuthManager(sessionId);
  }

  /**
   * List all active sessions (for debugging/admin)
   */
  static listActiveSessions(): string[] {
    return Array.from(MEMORY_AUTH_SESSIONS.keys());
  }

  /**
   * Clean up expired sessions and tokens
   */
  static cleanupExpiredSessions(): number {
    let cleaned = 0;
    const currentTime = Date.now();
    
    for (const [sessionId, sessionData] of MEMORY_AUTH_SESSIONS.entries()) {
      let shouldDelete = false;
      
      // Clean up sessions older than 30 days
      if (currentTime - sessionData.lastUsed > 30 * 24 * 60 * 60 * 1000) {
        console.error(`🗑️  Cleaning up old session: ${sessionId} (last used: ${new Date(sessionData.lastUsed).toISOString()})`);
        shouldDelete = true;
      }
      
      // Clean up expired tokens
      if (sessionData.tokens?.expires_at && currentTime > sessionData.tokens.expires_at) {
        console.error(`🗑️  Cleaning up expired session: ${sessionId} (expired: ${new Date(sessionData.tokens.expires_at).toISOString()})`);
        shouldDelete = true;
      }
      
      if (shouldDelete) {
        MEMORY_AUTH_SESSIONS.delete(sessionId);
        cleaned++;
      }
    }
    
    console.error(`🧹 Cleaned up ${cleaned} expired sessions from memory`);
    return cleaned;
  }

  /**
   * Clear all sessions (for testing/debugging)
   */
  static clearAllSessions(): number {
    const count = MEMORY_AUTH_SESSIONS.size;
    MEMORY_AUTH_SESSIONS.clear();
    console.error(`🗑️  Cleared ${count} sessions from memory`);
    return count;
  }

  /**
   * Cache deployment URL for a script ID
   */
  async setCachedDeploymentUrl(scriptId: string, gasRunUrl: string): Promise<void> {
    const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
    
    if (authSession) {
      if (!authSession.deploymentUrls) {
        authSession.deploymentUrls = new Map();
      }
      authSession.deploymentUrls.set(scriptId, gasRunUrl);
      MEMORY_AUTH_SESSIONS.set(this.sessionId, authSession);
      console.error(`✅ Cached deployment URL for ${scriptId}: ${gasRunUrl}`);
    }
  }

  /**
   * Get cached deployment URL for a script ID
   */
  async getCachedDeploymentUrl(scriptId: string): Promise<string | null> {
    const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
    
    if (authSession?.deploymentUrls) {
      return authSession.deploymentUrls.get(scriptId) || null;
    }
    
    return null;
  }

  /**
   * Clear cached deployment URLs for this session
   */
  async clearCachedDeploymentUrls(): Promise<void> {
    const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
    
    if (authSession) {
      authSession.deploymentUrls = new Map();
      MEMORY_AUTH_SESSIONS.set(this.sessionId, authSession);
      console.error(`✅ Cleared cached deployment URLs for session ${this.sessionId}`);
    }
  }

  /**
   * Get memory usage statistics
   */
  static getMemoryStats(): {
    totalSessions: number;
    activeSessions: number;
    expiredSessions: number;
  } {
    const currentTime = Date.now();
    let activeSessions = 0;
    let expiredSessions = 0;
    
    for (const sessionData of MEMORY_AUTH_SESSIONS.values()) {
      if (sessionData.tokens?.expires_at && currentTime < sessionData.tokens.expires_at) {
        activeSessions++;
      } else {
        expiredSessions++;
      }
    }
    
    return {
      totalSessions: MEMORY_AUTH_SESSIONS.size,
      activeSessions,
      expiredSessions
    };
  }
} 