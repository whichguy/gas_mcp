import { randomUUID } from 'crypto';

// IN-MEMORY AUTHENTICATION STORAGE
// Global Map to store all authentication sessions across MCP server instances
const MEMORY_AUTH_SESSIONS = new Map<string, AuthSession>();

// RACE CONDITION FIX: Session operation locks to prevent concurrent Map access
const sessionOperationLocks = new Map<string, Promise<void>>();

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
}

/**
 * Execute operation with session-specific lock to prevent race conditions
 * RACE CONDITION FIX: Prevents concurrent access to session data
 */
async function withSessionLock<T>(sessionId: string, operation: () => T | Promise<T>): Promise<T> {
  // Wait for any existing operation on this session
  while (sessionOperationLocks.has(sessionId)) {
    await sessionOperationLocks.get(sessionId);
  }
  
  // Create new lock for this operation
  let releaseLock: () => void;
  const lockPromise = new Promise<void>(resolve => {
    releaseLock = resolve;
  });
  sessionOperationLocks.set(sessionId, lockPromise);
  
  try {
    return await operation();
  } finally {
    sessionOperationLocks.delete(sessionId);
    releaseLock!();
  }
}

/**
 * In-Memory Session-based authentication manager
 * Supports concurrent MCP clients with proper isolation
 * NO FILE SYSTEM - all sessions stored in memory
 * Sessions are lost on server restart (requires re-authentication)
 * RACE CONDITION FIXES: Added session operation locking
 */
export class SessionAuthManager {
  private sessionId: string;

  constructor(sessionId?: string) {
    console.log(`🔧 SessionAuthManager (IN-MEMORY) constructor called with sessionId: ${sessionId || 'undefined'}`);
    
    // If no session ID provided, try to reuse existing valid session
    if (!sessionId) {
      console.log(`🔍 No session ID provided, looking for existing valid session...`);
      const existingSessionId = this.findExistingValidSession();
      if (existingSessionId) {
        this.sessionId = existingSessionId;
        console.log(`🔄 Reusing existing session: ${this.sessionId}`);
      } else {
        this.sessionId = randomUUID();
        console.log(`🔒 Created new session: ${this.sessionId}`);
      }
    } else {
      this.sessionId = sessionId;
      console.log(`🔒 Using specified session: ${this.sessionId}`);
    }
  }

  /**
   * Find an existing valid session to reuse
   */
  private findExistingValidSession(): string | null {
    try {
      console.log(`🔍 Looking for existing sessions in memory...`);
      console.log(`💾 Found ${MEMORY_AUTH_SESSIONS.size} sessions in memory`);
      
      for (const [sessionId, sessionData] of MEMORY_AUTH_SESSIONS.entries()) {
        try {
          console.log(`📄 Checking session: ${sessionId}`);
          console.log(`   User: ${sessionData.user?.email}`);
          console.log(`   Expires at: ${sessionData.tokens?.expires_at} (${new Date(sessionData.tokens?.expires_at).toLocaleString()})`);
          
          // Check if session is valid and not expired
          if (sessionData.tokens && sessionData.user && sessionData.tokens.expires_at) {
            const bufferMs = 5 * 60 * 1000; // 5 minute buffer
            const currentTime = Date.now();
            const expiresAt = sessionData.tokens.expires_at;
            const isValid = currentTime < (expiresAt - bufferMs);
            
            console.log(`   Current time: ${currentTime}`);
            console.log(`   Expires with buffer: ${expiresAt - bufferMs}`);
            console.log(`   Is valid: ${isValid}`);
            
            if (isValid) {
              console.log(`✅ Found valid session for ${sessionData.user.email}`);
              return sessionData.sessionId;
            } else {
              console.log(`⏰ Session expired for ${sessionData.user.email}`);
              // Clean up expired session
              MEMORY_AUTH_SESSIONS.delete(sessionId);
            }
          } else {
            console.log(`⚠️  Session missing required fields`);
          }
        } catch (error) {
          // Skip corrupted session data
          console.warn(`⚠️  Skipping corrupted session: ${sessionId}`, error);
          MEMORY_AUTH_SESSIONS.delete(sessionId);
        }
      }
      
      console.log(`❌ No valid sessions found`);
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
   * Store authentication session in memory with race condition protection
   */
  async setAuthSession(tokens: TokenInfo, user: UserInfo): Promise<void> {
    return await withSessionLock(this.sessionId, () => {
      const authSession: AuthSession = {
        sessionId: this.sessionId,
        tokens,
        user,
        createdAt: Date.now(),
        lastUsed: Date.now()
      };
      
      MEMORY_AUTH_SESSIONS.set(this.sessionId, authSession);
      console.log(`✅ Stored session ${this.sessionId} for ${user.email} in memory`);
    });
  }

  /**
   * Get current authentication session from memory with race condition protection
   */
  async getAuthSession(): Promise<AuthSession | null> {
    return await withSessionLock(this.sessionId, () => {
      const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
      
      if (authSession) {
        // Update last used timestamp
        authSession.lastUsed = Date.now();
        MEMORY_AUTH_SESSIONS.set(this.sessionId, authSession);
      }
      
      return authSession || null;
    });
  }

  /**
   * Force reload authentication session (no-op for in-memory, just here for compatibility)
   */
  public async reloadAuthSession(): Promise<void> {
    console.log(`🔄 Reload session ${this.sessionId} (no-op for in-memory)`);
  }

  /**
   * Check if current token is valid (not expired) - INTERNAL METHOD (no locking)
   */
  private isTokenValidInternal(authSession: AuthSession): boolean {
    if (!authSession || !authSession.tokens) return false;
    
    // Add 5 minute buffer before expiration
    const bufferMs = 5 * 60 * 1000;
    const isValid = Date.now() < (authSession.tokens.expires_at - bufferMs);
    
    return isValid;
  }

  /**
   * Check if currently authenticated with race condition protection
   * FIXED: Removed double-locking by making token validation internal
   */
  async isAuthenticated(): Promise<boolean> {
    return await withSessionLock(this.sessionId, () => {
      const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
      if (!authSession) return false;
      
      // Check if token is valid using internal method (no additional locking)
      const tokenValid = this.isTokenValidInternal(authSession);
      
      // Auto-delete expired tokens
      if (!tokenValid) {
        console.log(`🗑️  Auto-deleting expired session tokens for ${this.sessionId}`);
        MEMORY_AUTH_SESSIONS.delete(this.sessionId);
        return false;
      }
      
      return true;
    });
  }

  /**
   * Check if current token is valid (not expired) with race condition protection
   */
  async isTokenValid(): Promise<boolean> {
    return await withSessionLock(this.sessionId, () => {
      const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
      if (!authSession) return false;
      
      const isValid = this.isTokenValidInternal(authSession);
      
      // Auto-cleanup expired sessions
      if (!isValid && authSession) {
        console.log(`⏰ Session ${this.sessionId} token expired at ${new Date(authSession.tokens.expires_at).toISOString()}, auto-cleaning up`);
        MEMORY_AUTH_SESSIONS.delete(this.sessionId);
      }
      
      return isValid;
    });
  }

  /**
   * Get current access token if valid with race condition protection
   */
  async getValidToken(): Promise<string | null> {
    return await withSessionLock(this.sessionId, () => {
      const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
      if (!authSession) return null;
      
      // Check token validity using internal method
      if (!this.isTokenValidInternal(authSession)) {
        console.log(`🗑️  Token expired for session ${this.sessionId}, removing session`);
        MEMORY_AUTH_SESSIONS.delete(this.sessionId);
        return null;
      }
      
      return authSession.tokens.access_token;
    });
  }

  /**
   * Get refresh token for renewal with race condition protection
   */
  async getRefreshToken(): Promise<string | null> {
    return await withSessionLock(this.sessionId, () => {
      const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
      return authSession?.tokens.refresh_token || null;
    });
  }

  /**
   * Update tokens after refresh with race condition protection
   */
  async updateTokens(tokens: TokenInfo): Promise<void> {
    return await withSessionLock(this.sessionId, () => {
      const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
      
      if (authSession) {
        authSession.tokens = tokens;
        authSession.lastUsed = Date.now();
        MEMORY_AUTH_SESSIONS.set(this.sessionId, authSession);
        console.log(`✅ Updated tokens for session ${this.sessionId}`);
      }
    });
  }

  /**
   * Get current user info with race condition protection
   */
  async getUserInfo(): Promise<UserInfo | null> {
    return await withSessionLock(this.sessionId, () => {
      const authSession = MEMORY_AUTH_SESSIONS.get(this.sessionId);
      return authSession?.user || null;
    });
  }

  /**
   * Clear authentication session (logout) with race condition protection
   */
  async clearAuth(): Promise<void> {
    return await withSessionLock(this.sessionId, () => {
      MEMORY_AUTH_SESSIONS.delete(this.sessionId);
      console.log(`✅ Cleared session ${this.sessionId} from memory`);
    });
  }

  /**
   * Get authentication status for reporting with race condition protection
   * FIXED: Simplified to avoid double-locking issues
   */
  async getAuthStatus(): Promise<{
    sessionId: string;
    authenticated: boolean;
    user?: UserInfo;
    tokenValid: boolean;
    expiresIn?: number;
  }> {
    return await withSessionLock(this.sessionId, () => {
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
    });
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
        console.log(`🗑️  Cleaning up old session: ${sessionId} (last used: ${new Date(sessionData.lastUsed).toISOString()})`);
        shouldDelete = true;
      }
      
      // Clean up expired tokens
      if (sessionData.tokens?.expires_at && currentTime > sessionData.tokens.expires_at) {
        console.log(`🗑️  Cleaning up expired session: ${sessionId} (expired: ${new Date(sessionData.tokens.expires_at).toISOString()})`);
        shouldDelete = true;
      }
      
      if (shouldDelete) {
        MEMORY_AUTH_SESSIONS.delete(sessionId);
        cleaned++;
      }
    }
    
    console.log(`🧹 Cleaned up ${cleaned} expired sessions from memory`);
    return cleaned;
  }

  /**
   * Clear all sessions (for testing/debugging)
   */
  static clearAllSessions(): number {
    const count = MEMORY_AUTH_SESSIONS.size;
    MEMORY_AUTH_SESSIONS.clear();
    console.log(`🗑️  Cleared ${count} sessions from memory`);
    return count;
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