import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Store auth sessions in individual files by session ID
const AUTH_DIR = join(__dirname, '../../.sessions');

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
 * Session-based authentication manager
 * Supports concurrent MCP clients with proper isolation
 * NO SINGLETON PATTERN - each client gets its own instance
 */
export class SessionAuthManager {
  private sessionId: string;
  private authSession: AuthSession | null = null;
  private loaded = false;

  constructor(sessionId?: string) {
    console.log(`🔧 SessionAuthManager constructor called with sessionId: ${sessionId || 'undefined'}`);
    
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
      console.log(`🔍 Looking for existing sessions in: ${AUTH_DIR}`);
      if (!existsSync(AUTH_DIR)) {
        console.log(`⚠️  AUTH_DIR doesn't exist: ${AUTH_DIR}`);
        return null;
      }
      
      const files = readdirSync(AUTH_DIR).filter((f: string) => f.endsWith('.json'));
      console.log(`📁 Found ${files.length} session files: ${files.join(', ')}`);
      
      for (const file of files) {
        try {
          const filePath = join(AUTH_DIR, file);
          console.log(`📄 Checking session file: ${filePath}`);
          const sessionData = JSON.parse(readFileSync(filePath, 'utf8')) as AuthSession;
          console.log(`   Session ID: ${sessionData.sessionId}`);
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
            }
          } else {
            console.log(`⚠️  Session missing required fields`);
          }
        } catch (error) {
          // Skip corrupted session files
          console.warn(`⚠️  Skipping corrupted session file: ${file}`, error);
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
   * Get session file path
   */
  private getSessionFilePath(): string {
    return join(AUTH_DIR, `${this.sessionId}.json`);
  }

  /**
   * Ensure auth directory exists
   */
  private ensureAuthDir(): void {
    if (!existsSync(AUTH_DIR)) {
      mkdirSync(AUTH_DIR, { recursive: true });
    }
  }

  /**
   * Load authentication session from file
   */
  private loadAuthSession(): void {
    if (this.loaded) return;
    
    try {
      const sessionFile = this.getSessionFilePath();
      
      if (existsSync(sessionFile)) {
        const data = readFileSync(sessionFile, 'utf8');
        const session = JSON.parse(data) as AuthSession;
        
        // Validate session structure and session ID match
        if (session.tokens && session.user && session.createdAt && 
            session.lastUsed && session.sessionId === this.sessionId) {
          this.authSession = session;
          console.log(`✅ Loaded session ${this.sessionId} for ${session.user.email}`);
        } else {
          console.log(`⚠️  Invalid session file for ${this.sessionId}, ignoring`);
        }
      }
    } catch (error: any) {
      console.warn(`⚠️  Failed to load session ${this.sessionId}:`, error.message);
    }
    
    this.loaded = true;
  }

  /**
   * Force reload authentication session from file
   * This bypasses the loaded cache and re-reads from disk
   */
  public reloadAuthSession(): void {
    this.loaded = false;
    this.authSession = null;
    this.loadAuthSession();
  }

  /**
   * Save authentication session to file
   */
  private saveAuthSession(): void {
    try {
      this.ensureAuthDir();
      const sessionFile = this.getSessionFilePath();
      
      if (this.authSession) {
        writeFileSync(sessionFile, JSON.stringify(this.authSession, null, 2));
        console.log(`✅ Saved session ${this.sessionId} for ${this.authSession.user.email}`);
      } else {
        // Remove file when clearing auth
        if (existsSync(sessionFile)) {
          try {
            unlinkSync(sessionFile);
            console.log(`✅ Cleared session file for ${this.sessionId}`);
          } catch (error) {
            console.warn(`⚠️  Failed to clear session file for ${this.sessionId}:`, error);
          }
        }
      }
    } catch (error: any) {
      console.warn(`⚠️  Failed to save session ${this.sessionId}:`, error.message);
    }
  }

  /**
   * Store authentication session
   */
  setAuthSession(tokens: TokenInfo, user: UserInfo): void {
    this.loadAuthSession();
    
    this.authSession = {
      sessionId: this.sessionId,
      tokens,
      user,
      createdAt: Date.now(),
      lastUsed: Date.now()
    };
    
    this.saveAuthSession();
  }

  /**
   * Get current authentication session
   */
  getAuthSession(): AuthSession | null {
    this.loadAuthSession();
    
    if (this.authSession) {
      this.authSession.lastUsed = Date.now();
      this.saveAuthSession(); // Update lastUsed timestamp
    }
    return this.authSession;
  }

  /**
   * Check if currently authenticated
   */
  isAuthenticated(): boolean {
    this.loadAuthSession();
    
    if (!this.authSession) return false;
    
    // Check if token is valid
    const tokenValid = this.isTokenValid();
    
    // Auto-delete expired tokens
    if (!tokenValid) {
      console.log(`🗑️  Auto-deleting expired session tokens for ${this.sessionId}`);
      this.clearAuth();
      return false;
    }
    
    return true;
  }

  /**
   * Check if current token is valid (not expired)
   */
  isTokenValid(): boolean {
    this.loadAuthSession();
    
    if (!this.authSession) return false;
    
    // Add 5 minute buffer before expiration
    const bufferMs = 5 * 60 * 1000;
    const isValid = Date.now() < (this.authSession.tokens.expires_at - bufferMs);
    
    // Auto-cleanup expired sessions
    if (!isValid && this.authSession) {
      console.log(`⏰ Session ${this.sessionId} token expired at ${new Date(this.authSession.tokens.expires_at).toISOString()}, auto-cleaning up`);
      this.clearAuth();
    }
    
    return isValid;
  }

  /**
   * Get current access token if valid
   */
  getValidToken(): string | null {
    // This will auto-delete expired tokens via isAuthenticated()
    if (!this.isAuthenticated()) return null;
    return this.authSession!.tokens.access_token;
  }

  /**
   * Get refresh token for renewal
   */
  getRefreshToken(): string | null {
    this.loadAuthSession();
    
    if (!this.authSession?.tokens.refresh_token) return null;
    return this.authSession.tokens.refresh_token;
  }

  /**
   * Update tokens after refresh
   */
  updateTokens(tokens: TokenInfo): void {
    this.loadAuthSession();
    
    if (this.authSession) {
      this.authSession.tokens = tokens;
      this.authSession.lastUsed = Date.now();
      this.saveAuthSession();
    }
  }

  /**
   * Get current user info
   */
  getUserInfo(): UserInfo | null {
    this.loadAuthSession();
    return this.authSession?.user || null;
  }

  /**
   * Clear authentication session (logout)
   */
  clearAuth(): void {
    this.authSession = null;
    this.saveAuthSession();
  }

  /**
   * Get authentication status for reporting
   */
  getAuthStatus(): {
    sessionId: string;
    authenticated: boolean;
    user?: UserInfo;
    tokenValid: boolean;
    expiresIn?: number;
  } {
    this.loadAuthSession();
    
    if (!this.authSession) {
      return { 
        sessionId: this.sessionId,
        authenticated: false, 
        tokenValid: false 
      };
    }

    const tokenValid = this.isTokenValid();
    const expiresIn = tokenValid 
      ? Math.max(0, Math.floor((this.authSession.tokens.expires_at - Date.now()) / 1000))
      : 0;

    return {
      sessionId: this.sessionId,
      authenticated: true,
      user: this.authSession.user,
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
    try {
      if (!existsSync(AUTH_DIR)) return [];
      
      return readdirSync(AUTH_DIR)
        .filter((file: string) => file.endsWith('.json'))
        .map((file: string) => file.replace('.json', ''));
    } catch {
      return [];
    }
  }

  /**
   * Clean up expired sessions and tokens
   */
  static cleanupExpiredSessions(): number {
    try {
      if (!existsSync(AUTH_DIR)) return 0;
      
      const files = readdirSync(AUTH_DIR).filter((f: string) => f.endsWith('.json'));
      let cleaned = 0;
      
      for (const file of files) {
        try {
          const sessionPath = join(AUTH_DIR, file);
          const sessionData = JSON.parse(readFileSync(sessionPath, 'utf8'));
          
          let shouldDelete = false;
          
          // Clean up sessions older than 30 days
          if (Date.now() - sessionData.lastUsed > 30 * 24 * 60 * 60 * 1000) {
            console.log(`🗑️  Cleaning up old session: ${file} (last used: ${new Date(sessionData.lastUsed).toISOString()})`);
            shouldDelete = true;
          }
          
          // Clean up sessions with expired tokens
          if (sessionData.tokens && sessionData.tokens.expires_at) {
            const bufferMs = 5 * 60 * 1000; // 5 minute buffer
            if (Date.now() >= (sessionData.tokens.expires_at - bufferMs)) {
              console.log(`🗑️  Cleaning up expired token session: ${file} (expired: ${new Date(sessionData.tokens.expires_at).toISOString()})`);
              shouldDelete = true;
            }
          }
          
          if (shouldDelete) {
            unlinkSync(sessionPath);
            cleaned++;
          }
        } catch (error) {
          // Remove corrupted session files
          console.log(`🗑️  Removing corrupted session file: ${file}`);
          unlinkSync(join(AUTH_DIR, file));
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        console.log(`✅ Cleaned up ${cleaned} expired/invalid session(s)`);
      }
      
      return cleaned;
    } catch {
      return 0;
    }
  }

  /**
   * Clear ALL cached session tokens (for startup cleanup)
   */
  static clearAllSessions(): number {
    try {
      if (!existsSync(AUTH_DIR)) return 0;
      
      const files = readdirSync(AUTH_DIR).filter((f: string) => f.endsWith('.json'));
      let cleared = 0;
      
      for (const file of files) {
        try {
          const sessionPath = join(AUTH_DIR, file);
          unlinkSync(sessionPath);
          cleared++;
          console.log(`🗑️  Cleared session: ${file}`);
        } catch (error) {
          console.warn(`⚠️  Failed to clear session file: ${file}`, error);
        }
      }
      
      if (cleared > 0) {
        console.log(`✅ Cleared ${cleared} cached session token(s)`);
      }
      
      return cleared;
    } catch (error) {
      console.warn('⚠️  Failed to clear sessions:', error);
      return 0;
    }
  }
} 