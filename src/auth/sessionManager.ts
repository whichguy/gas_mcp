import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { OAuth2Client } from 'google-auth-library';

// FILESYSTEM-BASED AUTHENTICATION STORAGE
// Token cache directory in user home directory for consistent cross-session persistence
const TOKEN_CACHE_DIR = path.join(os.homedir(), '.auth', 'mcp-gas', 'tokens');

// MEMORY LEAK FIX: Maximum deployment URLs to cache (LRU eviction)
// Prevents unbounded growth in long-running sessions (10+ hours)
const MAX_DEPLOYMENT_URLS = 100;

// Maximum infrastructure verification entries to cache (LRU eviction)
const MAX_INFRASTRUCTURE_ENTRIES = 100;

/**
 * Cached entry for infrastructure verification state.
 * Transient (in-memory only) — if process restarts, re-verification is cheap
 * (one in-memory SHA comparison, zero API calls).
 */
export interface InfrastructureVerifiedEntry {
  execShimSHA: string;
  timestamp: number;
}

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
 * Filesystem helper functions for token cache
 */
class TokenCacheHelpers {
  /**
   * Get token cache file path for email
   */
  static getTokenCachePath(email: string): string {
    // Sanitize email for filesystem
    const safeEmail = email.replace(/[^a-z0-9@.-]/gi, '_');
    return path.join(TOKEN_CACHE_DIR, `${safeEmail}.json`);
  }

  /**
   * Ensure token cache directory exists
   */
  static async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(TOKEN_CACHE_DIR, { recursive: true, mode: 0o700 });
    } catch (error: any) {
      // Ignore EEXIST error
      if (error.code !== 'EEXIST') {
        console.error(`Failed to create token cache directory:`, error);
      }
    }
  }

  /**
   * Read token cache from filesystem
   */
  static async readTokenCache(email: string): Promise<AuthSession | null> {
    try {
      const cachePath = TokenCacheHelpers.getTokenCachePath(email);
      const content = await fs.readFile(cachePath, 'utf-8');
      const session = JSON.parse(content);

      // Validate structure
      if (!session.tokens || !session.user || !session.tokens.expires_at) {
        console.error(`Invalid token cache structure for ${email}`);
        return null;
      }

      // Convert deploymentUrls from plain object to Map if needed
      if (session.deploymentUrls && !(session.deploymentUrls instanceof Map)) {
        session.deploymentUrls = new Map(Object.entries(session.deploymentUrls));
      }

      return session;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - not an error
        return null;
      }
      console.error(`Error reading token cache for ${email}:`, error);
      return null;
    }
  }

  /**
   * Write token cache to filesystem with atomic write
   */
  static async writeTokenCache(email: string, session: AuthSession): Promise<void> {
    await TokenCacheHelpers.ensureCacheDir();

    const cachePath = TokenCacheHelpers.getTokenCachePath(email);
    const tempPath = `${cachePath}.tmp`;

    try {
      // Convert Map to plain object for JSON serialization
      const sessionToWrite = { ...session };
      if (session.deploymentUrls) {
        sessionToWrite.deploymentUrls = Object.fromEntries(session.deploymentUrls) as any;
      }

      // Write to temp file first
      await fs.writeFile(tempPath, JSON.stringify(sessionToWrite, null, 2), { mode: 0o600 });

      // Atomic rename
      await fs.rename(tempPath, cachePath);

      console.error(`Wrote token cache for ${email}`);
    } catch (error) {
      // Cleanup temp file on error
      try {
        await fs.unlink(tempPath);
      } catch {}
      throw error;
    }
  }

  /**
   * Delete token cache from filesystem
   */
  static async deleteTokenCache(email: string): Promise<void> {
    try {
      const cachePath = TokenCacheHelpers.getTokenCachePath(email);

      // Enhanced logging with stack trace to track who is deleting tokens
      console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.error(`🗑️  DELETING TOKEN CACHE`);
      console.error(`   Email: ${email}`);
      console.error(`   Path: ${cachePath}`);
      console.error(`   Time: ${new Date().toISOString()}`);
      console.error(`   Called from:`);
      const stack = new Error().stack?.split('\n').slice(2, 5).join('\n') || 'Stack trace unavailable';
      console.error(stack);
      console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      await fs.unlink(cachePath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`Error deleting token cache for ${email}:`, error);
      } else {
        console.error(`⚠️  Token cache already deleted for ${email}`);
      }
    }
  }

  /**
   * List all cached token files
   */
  static async listCachedEmails(): Promise<string[]> {
    try {
      await TokenCacheHelpers.ensureCacheDir();
      const files = await fs.readdir(TOKEN_CACHE_DIR);
      return files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
    } catch (error) {
      console.error(`Error listing token cache:`, error);
      return [];
    }
  }
}

/**
 * Filesystem-based Session authentication manager
 * Supports concurrent MCP clients with cross-process token sharing
 * Token cache stored in process.cwd()/.auth/tokens/
 * Automatic token refresh using refresh_token
 * Half-duplex MCP protocol - no file locking required
 */
export class SessionAuthManager {
  private sessionId: string;
  private sessionIdConfirmed: boolean = false;

  constructor(sessionId?: string) {
    // Reduced logging - constructor is called on every tool execution

    if (sessionId) {
      // Explicit session ID provided - but still need to check for existing sessions
      this.sessionId = sessionId;
      this.sessionIdConfirmed = false; // Force search for existing sessions
    } else {
      // No session ID - generate temporary UUID, will check for existing sessions on first use
      this.sessionId = randomUUID();
      this.sessionIdConfirmed = false;
    }
  }

  /**
   * Refresh access token using refresh token
   * Uses google-auth-library's built-in refresh mechanism
   */
  private async refreshAccessToken(session: AuthSession): Promise<TokenInfo | null> {
    if (!session.tokens.refresh_token) {
      console.error(`No refresh token available for ${session.user.email}`);
      return null;
    }

    try {
      console.error(`Refreshing access token for ${session.user.email}...`);

      // Use google-auth-library's refresh method
      const oauth2Client = new OAuth2Client(
        '428972970708-m9hptmp3idakolt9tgk5m0qs13cgj2kk.apps.googleusercontent.com'
      );

      // Set credentials with refresh token
      oauth2Client.setCredentials({
        refresh_token: session.tokens.refresh_token
      });

      // Refresh token (google-auth-library handles the API call)
      const { credentials } = await oauth2Client.refreshAccessToken();

      // Apply 60-second buffer to expiry
      const expiresAt = credentials.expiry_date
        ? credentials.expiry_date - 60000
        : Date.now() + 3600000;

      const newTokens: TokenInfo = {
        access_token: credentials.access_token!,
        refresh_token: credentials.refresh_token || session.tokens.refresh_token,
        expires_at: expiresAt,
        scope: credentials.scope || session.tokens.scope,
        token_type: credentials.token_type || 'Bearer'
      };

      console.error(`Access token refreshed for ${session.user.email}`);
      console.error(`   New expiry: ${new Date(expiresAt).toISOString()}`);

      return newTokens;
    } catch (error: any) {
      console.error(`Token refresh failed for ${session.user.email}:`, error.message);

      // If refresh fails, delete cache (refresh_token might be revoked)
      await TokenCacheHelpers.deleteTokenCache(session.user.email);

      return null;
    }
  }

  /**
   * Find an existing valid session to reuse (with automatic refresh)
   * Searches filesystem token cache and auto-refreshes expired tokens
   */
  private async findExistingValidSession(): Promise<string | null> {
    try {
      console.error(`[Session Discovery] Searching filesystem token cache at ${TOKEN_CACHE_DIR}`);

      const emails = await TokenCacheHelpers.listCachedEmails();
      console.error(`[Session Discovery] Found ${emails.length} cached token files: ${emails.join(', ') || 'none'}`);

      for (const email of emails) {
        const session = await TokenCacheHelpers.readTokenCache(email);

        if (!session) continue;

        console.error(`Checking ${email}...`);
        console.error(`   Expires at: ${new Date(session.tokens.expires_at).toISOString()}`);

        const currentTime = Date.now();
        const bufferMs = 5 * 60 * 1000; // 5 minute buffer
        const isValid = currentTime < (session.tokens.expires_at - bufferMs);

        if (isValid) {
          // Token is still valid
          console.error(`[Session Discovery] ✓ Found valid session for ${email}`);
          console.error(`[Session Discovery]   SessionId: ${session.sessionId}`);
          console.error(`[Session Discovery]   Expires: ${new Date(session.tokens.expires_at).toISOString()}`);

          // Update lastUsed timestamp
          session.lastUsed = currentTime;
          await TokenCacheHelpers.writeTokenCache(email, session);

          return session.sessionId;
        } else if (session.tokens.refresh_token) {
          // Token expired but we have refresh_token
          console.error(`Token expired for ${email}, attempting refresh...`);

          const newTokens = await this.refreshAccessToken(session);
          if (newTokens) {
            // Refresh successful - update session
            session.tokens = newTokens;
            session.lastUsed = currentTime;
            await TokenCacheHelpers.writeTokenCache(email, session);

            console.error(`[Session Discovery] ✓ Refreshed and using session for ${email}`);
            console.error(`[Session Discovery]   SessionId: ${session.sessionId}`);
            return session.sessionId;
          } else {
            console.error(`[Session Discovery] ✗ Refresh failed for ${email}`);
          }
        } else {
          console.error(`Session expired for ${email} (no refresh token)`);
        }
      }

      console.error(`No valid sessions found in cache`);
      return null;
    } catch (error) {
      console.error(`Error searching token cache:`, error);
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
   * Store authentication session to filesystem
   * Half-duplex MCP protocol - no locking required
   */
  async setAuthSession(tokens: TokenInfo, user: UserInfo): Promise<void> {
    const authSession: AuthSession = {
      sessionId: this.sessionId,
      tokens,
      user,
      createdAt: Date.now(),
      lastUsed: Date.now()
    };

    await TokenCacheHelpers.writeTokenCache(user.email, authSession);
    console.error(`Stored session ${this.sessionId} for ${user.email} in filesystem cache`);
  }

  /**
   * Find session by sessionId across all cached tokens
   */
  private async findSessionById(sessionId: string): Promise<AuthSession | null> {
    const emails = await TokenCacheHelpers.listCachedEmails();

    for (const email of emails) {
      const session = await TokenCacheHelpers.readTokenCache(email);
      if (session && session.sessionId === sessionId) {
        return session;
      }
    }

    return null;
  }

  /**
   * Ensure session ID is confirmed by checking filesystem for existing sessions
   * This implements lazy session discovery for cross-process credential sharing
   */
  private async ensureSessionIdConfirmed(): Promise<void> {
    if (this.sessionIdConfirmed) return;

    console.error(`Lazy session discovery: checking filesystem for existing sessions...`);
    const existingSessionId = await this.findExistingValidSession();

    if (existingSessionId) {
      console.error(`Found existing session: ${existingSessionId}`);
      this.sessionId = existingSessionId;
    } else {
      console.error(` No existing session found, using new session: ${this.sessionId}`);
    }

    this.sessionIdConfirmed = true;
  }

  /**
   * Get current authentication session from filesystem
   * Updates lastUsed timestamp
   */
  async getAuthSession(): Promise<AuthSession | null> {
    // Ensure we've checked for existing sessions before accessing
    await this.ensureSessionIdConfirmed();

    const authSession = await this.findSessionById(this.sessionId);

    if (authSession) {
      // Update last used timestamp
      authSession.lastUsed = Date.now();
      await TokenCacheHelpers.writeTokenCache(authSession.user.email, authSession);
    }

    return authSession || null;
  }

  /**
   * Force reload authentication session from filesystem
   */
  public async reloadAuthSession(): Promise<void> {
    console.error(`Reload session ${this.sessionId} from filesystem`);
    // Nothing to do - next getAuthSession() will read from filesystem
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
   * Reads from filesystem and validates token expiry
   */
  async isAuthenticated(): Promise<boolean> {
    // Ensure we've checked for existing sessions before accessing
    await this.ensureSessionIdConfirmed();

    const authSession = await this.findSessionById(this.sessionId);
    if (!authSession) return false;

    // Check if token is valid
    const tokenValid = this.isTokenValidInternal(authSession);

    // Auto-delete expired tokens without refresh_token
    if (!tokenValid && !authSession.tokens.refresh_token) {
      console.error(` Auto-deleting expired session tokens for ${this.sessionId}`);
      await TokenCacheHelpers.deleteTokenCache(authSession.user.email);
      return false;
    }

    return tokenValid;
  }

  /**
   * Wait for session to be ready and fully synchronized
   * Ensures session is fully set up before API operations
   */
  async waitForSessionReady(timeoutMs: number = 10000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 100; // Check every 100ms

    console.error(`Waiting for session ${this.sessionId} to be ready...`);

    while (Date.now() - startTime < timeoutMs) {
      const authSession = await this.findSessionById(this.sessionId);

      if (authSession && authSession.tokens && authSession.user) {
        // Double-check token validity
        const tokenValid = this.isTokenValidInternal(authSession);
        if (tokenValid) {
          console.error(`Session ${this.sessionId} is ready and authenticated as ${authSession.user.email}`);
          return true;
        }
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    console.error(`Session ${this.sessionId} readiness timeout after ${timeoutMs}ms`);
    return false;
  }

  /**
   * Check if current token is valid (not expired)
   * Auto-refreshes if expired but refresh_token exists
   */
  async isTokenValid(): Promise<boolean> {
    // Ensure we've checked for existing sessions before accessing
    await this.ensureSessionIdConfirmed();

    const authSession = await this.findSessionById(this.sessionId);
    if (!authSession) return false;

    const isValid = this.isTokenValidInternal(authSession);

    // Try to refresh if expired
    if (!isValid && authSession.tokens.refresh_token) {
      console.error(`Session ${this.sessionId} token expired, attempting refresh...`);
      const newTokens = await this.refreshAccessToken(authSession);
      if (newTokens) {
        authSession.tokens = newTokens;
        await TokenCacheHelpers.writeTokenCache(authSession.user.email, authSession);
        return true;
      }
    }

    // Auto-cleanup expired sessions without refresh_token
    if (!isValid && !authSession.tokens.refresh_token) {
      console.error(`Session ${this.sessionId} token expired at ${new Date(authSession.tokens.expires_at).toISOString()}, auto-cleaning up`);
      await TokenCacheHelpers.deleteTokenCache(authSession.user.email);
    }

    return isValid;
  }

  /**
   * Get current access token if valid
   * Auto-refreshes if expired but refresh_token exists
   */
  async getValidToken(): Promise<string | null> {
    // Ensure we've checked for existing sessions before accessing
    await this.ensureSessionIdConfirmed();

    const authSession = await this.findSessionById(this.sessionId);
    if (!authSession) return null;

    // Check token validity
    if (!this.isTokenValidInternal(authSession)) {
      // Try to refresh if we have refresh_token
      if (authSession.tokens.refresh_token) {
        console.error(`Token expired for session ${this.sessionId}, attempting refresh...`);
        const newTokens = await this.refreshAccessToken(authSession);
        if (newTokens) {
          authSession.tokens = newTokens;
          await TokenCacheHelpers.writeTokenCache(authSession.user.email, authSession);
          return authSession.tokens.access_token;
        }
      }

      console.error(` Token expired for session ${this.sessionId}, removing session`);
      await TokenCacheHelpers.deleteTokenCache(authSession.user.email);
      return null;
    }

    return authSession.tokens.access_token;
  }

  /**
   * Get refresh token for renewal
   */
  async getRefreshToken(): Promise<string | null> {
    const authSession = await this.findSessionById(this.sessionId);
    return authSession?.tokens.refresh_token || null;
  }

  /**
   * Update tokens after refresh
   */
  async updateTokens(tokens: TokenInfo): Promise<void> {
    const authSession = await this.findSessionById(this.sessionId);

    if (authSession) {
      authSession.tokens = tokens;
      authSession.lastUsed = Date.now();
      await TokenCacheHelpers.writeTokenCache(authSession.user.email, authSession);
      console.error(`Updated tokens for session ${this.sessionId}`);
    }
  }

  /**
   * Get current user info
   */
  async getUserInfo(): Promise<UserInfo | null> {
    const authSession = await this.findSessionById(this.sessionId);
    return authSession?.user || null;
  }

  /**
   * Clear authentication session (logout)
   */
  async clearAuth(): Promise<void> {
    // BUG FIX: Must adopt existing session ID first, otherwise findSessionById
    // will fail to find the session (new sessionId != stored sessionId)
    await this.ensureSessionIdConfirmed();

    const authSession = await this.findSessionById(this.sessionId);
    if (authSession) {
      await TokenCacheHelpers.deleteTokenCache(authSession.user.email);
      console.error(`Cleared session ${this.sessionId} from filesystem`);
    }
  }

  /**
   * Get authentication status for reporting
   */
  async getAuthStatus(): Promise<{
    sessionId: string;
    authenticated: boolean;
    user?: UserInfo;
    tokenValid: boolean;
    expiresIn?: number;
  }> {
    // Ensure we've checked for existing sessions before accessing
    await this.ensureSessionIdConfirmed();

    const authSession = await this.findSessionById(this.sessionId);

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
  static async listActiveSessions(): Promise<string[]> {
    const emails = await TokenCacheHelpers.listCachedEmails();
    const sessionIds: string[] = [];

    for (const email of emails) {
      const session = await TokenCacheHelpers.readTokenCache(email);
      if (session) {
        sessionIds.push(session.sessionId);
      }
    }

    return sessionIds;
  }

  /**
   * Clean up expired sessions and tokens from filesystem
   */
  static async cleanupExpiredSessions(): Promise<number> {
    let cleaned = 0;
    const currentTime = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    try {
      const emails = await TokenCacheHelpers.listCachedEmails();

      for (const email of emails) {
        const session = await TokenCacheHelpers.readTokenCache(email);

        if (!session) {
          // Invalid file - delete it
          await TokenCacheHelpers.deleteTokenCache(email);
          cleaned++;
          continue;
        }

        // Clean up sessions older than 30 days
        if (currentTime - session.lastUsed > thirtyDaysMs) {
          console.error(` Removing old session for ${email} (last used: ${new Date(session.lastUsed).toISOString()})`);
          await TokenCacheHelpers.deleteTokenCache(email);
          cleaned++;
          continue;
        }

        // Clean up expired tokens without refresh_token
        if (!session.tokens.refresh_token && currentTime > session.tokens.expires_at) {
          console.error(` Removing expired session for ${email} (no refresh token)`);
          await TokenCacheHelpers.deleteTokenCache(email);
          cleaned++;
        }
      }

      console.error(`Cleaned up ${cleaned} expired sessions from filesystem`);
      return cleaned;
    } catch (error) {
      console.error(`Error during cleanup:`, error);
      return cleaned;
    }
  }

  /**
   * Clear all sessions (for testing/debugging)
   */
  static async clearAllSessions(): Promise<number> {
    const emails = await TokenCacheHelpers.listCachedEmails();
    let count = 0;

    for (const email of emails) {
      await TokenCacheHelpers.deleteTokenCache(email);
      count++;
    }

    console.error(` Cleared ${count} sessions from filesystem`);
    return count;
  }

  // ─── Static in-memory infrastructure verification cache ───
  // Unlike deployment URLs (persisted to filesystem), infrastructure verification
  // is transient — if the process restarts, re-verifying is cheap (one in-memory
  // SHA comparison). Static avoids filesystem I/O overhead per cache write.
  private static infrastructureCache = new Map<string, InfrastructureVerifiedEntry>();

  /**
   * Record that infrastructure for a script has been verified with the given exec shim SHA.
   * Uses LRU eviction at MAX_INFRASTRUCTURE_ENTRIES to prevent unbounded growth.
   */
  static setInfrastructureVerified(scriptId: string, entry: InfrastructureVerifiedEntry): void {
    // LRU eviction: remove oldest if at capacity
    if (
      SessionAuthManager.infrastructureCache.size >= MAX_INFRASTRUCTURE_ENTRIES &&
      !SessionAuthManager.infrastructureCache.has(scriptId)
    ) {
      const firstKey = SessionAuthManager.infrastructureCache.keys().next().value;
      if (firstKey) {
        SessionAuthManager.infrastructureCache.delete(firstKey);
      }
    }
    // Delete + set for LRU ordering (most recent at end)
    SessionAuthManager.infrastructureCache.delete(scriptId);
    SessionAuthManager.infrastructureCache.set(scriptId, entry);
  }

  /**
   * Get cached infrastructure verification entry for a script, or null if not cached.
   */
  static getInfrastructureVerified(scriptId: string): InfrastructureVerifiedEntry | null {
    return SessionAuthManager.infrastructureCache.get(scriptId) ?? null;
  }

  /**
   * Invalidate cached infrastructure verification for a script.
   * Called when infrastructure is re-deployed (shim recreated).
   */
  static invalidateInfrastructure(scriptId: string): void {
    SessionAuthManager.infrastructureCache.delete(scriptId);
  }

  /**
   * Cache deployment URL for a script ID with LRU eviction
   * MEMORY LEAK FIX: Caps at MAX_DEPLOYMENT_URLS entries for long-running sessions
   */
  async setCachedDeploymentUrl(scriptId: string, gasRunUrl: string): Promise<void> {
    const authSession = await this.findSessionById(this.sessionId);

    if (authSession) {
      if (!authSession.deploymentUrls) {
        authSession.deploymentUrls = new Map();
      }

      // MEMORY LEAK FIX: LRU eviction for long-running sessions (10+ hours)
      // Remove the oldest entry if we've hit the limit
      if (authSession.deploymentUrls.size >= MAX_DEPLOYMENT_URLS && !authSession.deploymentUrls.has(scriptId)) {
        const firstKey = authSession.deploymentUrls.keys().next().value;
        if (firstKey) {
          authSession.deploymentUrls.delete(firstKey);
          console.error(`[LRU] Evicted oldest deployment URL: ${firstKey} (limit: ${MAX_DEPLOYMENT_URLS})`);
        }
      }

      // For LRU: delete and re-add to move to end (most recent)
      authSession.deploymentUrls.delete(scriptId);
      authSession.deploymentUrls.set(scriptId, gasRunUrl);

      await TokenCacheHelpers.writeTokenCache(authSession.user.email, authSession);
      console.error(`Cached deployment URL for ${scriptId}: ${gasRunUrl}`);
    }
  }

  /**
   * Get cached deployment URL for a script ID
   * MEMORY LEAK FIX: Updates LRU order on access
   */
  async getCachedDeploymentUrl(scriptId: string): Promise<string | null> {
    const authSession = await this.findSessionById(this.sessionId);

    if (authSession?.deploymentUrls) {
      const url = authSession.deploymentUrls.get(scriptId);
      if (url) {
        // LRU: move to end (most recently used)
        authSession.deploymentUrls.delete(scriptId);
        authSession.deploymentUrls.set(scriptId, url);
        await TokenCacheHelpers.writeTokenCache(authSession.user.email, authSession);
      }
      return url || null;
    }

    return null;
  }

  /**
   * Clear cached deployment URLs for this session
   */
  async clearCachedDeploymentUrls(): Promise<void> {
    const authSession = await this.findSessionById(this.sessionId);

    if (authSession) {
      authSession.deploymentUrls = new Map();
      await TokenCacheHelpers.writeTokenCache(authSession.user.email, authSession);
      console.error(`Cleared cached deployment URLs for session ${this.sessionId}`);
    }
  }

  /**
   * Get filesystem cache statistics
   */
  static async getMemoryStats(): Promise<{
    totalSessions: number;
    activeSessions: number;
    expiredSessions: number;
  }> {
    const currentTime = Date.now();
    let activeSessions = 0;
    let expiredSessions = 0;

    const emails = await TokenCacheHelpers.listCachedEmails();

    for (const email of emails) {
      const sessionData = await TokenCacheHelpers.readTokenCache(email);
      if (sessionData?.tokens?.expires_at && currentTime < sessionData.tokens.expires_at) {
        activeSessions++;
      } else {
        expiredSessions++;
      }
    }

    return {
      totalSessions: emails.length,
      activeSessions,
      expiredSessions
    };
  }
} 