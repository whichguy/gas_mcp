import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Store auth session in a local file
const AUTH_DIR = join(__dirname, '../../.auth');
const AUTH_FILE = join(AUTH_DIR, 'session.json');

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
  tokens: TokenInfo;
  user: UserInfo;
  createdAt: number;
  lastUsed: number;
}

/**
 * Persistent authentication state manager
 * Stores sessions in local file to survive process restarts
 */
export class AuthStateManager {
  private static instance: AuthStateManager;
  private authSession: AuthSession | null = null;
  private loaded = false;

  private constructor() {}

  static getInstance(): AuthStateManager {
    if (!AuthStateManager.instance) {
      AuthStateManager.instance = new AuthStateManager();
    }
    return AuthStateManager.instance;
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
      if (existsSync(AUTH_FILE)) {
        const data = readFileSync(AUTH_FILE, 'utf8');
        const session = JSON.parse(data) as AuthSession;
        
        // Validate session structure
        if (session.tokens && session.user && session.createdAt && session.lastUsed) {
          this.authSession = session;
          console.log(`✅ Loaded authentication session for ${session.user.email}`);
        } else {
          console.log('⚠️  Invalid session file, ignoring');
        }
      }
    } catch (error: any) {
      console.warn('⚠️  Failed to load auth session:', error.message);
    }
    
    this.loaded = true;
  }

  /**
   * Save authentication session to file
   */
  private saveAuthSession(): void {
    try {
      this.ensureAuthDir();
      
      if (this.authSession) {
        writeFileSync(AUTH_FILE, JSON.stringify(this.authSession, null, 2));
        console.log(`✅ Saved authentication session for ${this.authSession.user.email}`);
      } else {
        // Remove file when clearing auth
        if (existsSync(AUTH_FILE)) {
          import('fs').then(fs => {
            fs.unlinkSync(AUTH_FILE);
            console.log('✅ Cleared authentication session file');
          }).catch(() => {
            // Ignore errors when clearing
          });
        }
      }
    } catch (error: any) {
      console.warn('⚠️  Failed to save auth session:', error.message);
    }
  }

  /**
   * Store authentication session
   */
  setAuthSession(session: AuthSession): void {
    this.loadAuthSession();
    this.authSession = session;
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
      console.log('🗑️  Auto-deleting expired authentication tokens');
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
    
    if (!this.authSession || !this.authSession.tokens) return false;
    
    // Check if expires_at field exists
    if (!this.authSession.tokens.expires_at) {
      console.log('⚠️  Token missing expiration time, treating as invalid');
      this.clearAuth();
      return false;
    }
    
    // Add 5 minute buffer before expiration
    const bufferMs = 5 * 60 * 1000;
    const isValid = Date.now() < (this.authSession.tokens.expires_at - bufferMs);
    
    // Auto-cleanup expired sessions
    if (!isValid && this.authSession) {
      console.log(`⏰ Token expired at ${new Date(this.authSession.tokens.expires_at).toISOString()}, auto-cleaning up`);
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
    authenticated: boolean;
    user?: UserInfo;
    tokenValid: boolean;
    expiresIn?: number;
  } {
    this.loadAuthSession();
    
    if (!this.authSession) {
      return { authenticated: false, tokenValid: false };
    }

    // Capture session existence and data before token validation (which might clear the session)
    const sessionExists = this.authSession !== null;
    const user = this.authSession.user;
    const tokens = this.authSession.tokens;

    const tokenValid = this.isTokenValid();
    
    // Calculate expiresIn using captured token data (since session might be cleared)
    const expiresIn = tokens
      ? Math.max(0, Math.floor((tokens.expires_at - Date.now()) / 1000))
      : 0;

    return {
      authenticated: sessionExists, // Report whether session existed, not current state
      user: user,
      tokenValid,
      expiresIn
    };
  }
} 