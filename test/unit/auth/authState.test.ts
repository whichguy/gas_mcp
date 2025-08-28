import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { AuthStateManager, TokenInfo, UserInfo, AuthSession } from '../../../src/auth/authState.js';

describe('AuthStateManager', () => {
  let authManager: AuthStateManager;
  let mockTokenInfo: TokenInfo;
  let mockUserInfo: UserInfo;
  let mockAuthSession: AuthSession;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    authManager = AuthStateManager.getInstance();
    authManager.clearAuth(); // Reset state between tests
    clock = sinon.useFakeTimers();

    mockTokenInfo = {
      access_token: 'mock_access_token',
      refresh_token: 'mock_refresh_token',
      expires_at: Date.now() + 3600000, // 1 hour from now
      scope: 'https://www.googleapis.com/auth/script.projects',
      token_type: 'Bearer'
    };

    mockUserInfo = {
      id: '12345',
      email: 'test@example.com',
      name: 'Test User',
      picture: 'https://example.com/avatar.jpg',
      verified_email: true
    };

    mockAuthSession = {
      tokens: mockTokenInfo,
      user: mockUserInfo,
      createdAt: Date.now(),
      lastUsed: Date.now()
    };
  });

  afterEach(() => {
    clock.restore();
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = AuthStateManager.getInstance();
      const instance2 = AuthStateManager.getInstance();
      expect(instance1).to.equal(instance2);
    });

    it('should maintain state across getInstance calls', () => {
      const instance1 = AuthStateManager.getInstance();
      instance1.setAuthSession(mockAuthSession);

      const instance2 = AuthStateManager.getInstance();
      expect(instance2.isAuthenticated()).to.be.true;
    });
  });

  describe('authentication session management', () => {
    it('should store and retrieve auth session', () => {
      authManager.setAuthSession(mockAuthSession);
      const retrievedSession = authManager.getAuthSession();
      
      expect(retrievedSession).to.deep.equal(mockAuthSession);
    });

    it('should update lastUsed when getting session', async () => {
      authManager.setAuthSession(mockAuthSession);
      const originalLastUsed = mockAuthSession.lastUsed;
      
      // Advance time
      await clock.tickAsync(10);
      
      const retrievedSession = authManager.getAuthSession();
      expect(retrievedSession!.lastUsed).to.be.greaterThan(originalLastUsed);
    });

    it('should return null when no session exists', () => {
      expect(authManager.getAuthSession()).to.be.null;
    });
  });

  describe('authentication status', () => {
    it('should return false when not authenticated', () => {
      expect(authManager.isAuthenticated()).to.be.false;
    });

    it('should return true when authenticated with valid token', () => {
      authManager.setAuthSession(mockAuthSession);
      expect(authManager.isAuthenticated()).to.be.true;
    });

    it('should return false when token is expired', () => {
      const expiredTokenInfo = { ...mockTokenInfo, expires_at: Date.now() - 1000 };
      const expiredSession = { ...mockAuthSession, tokens: expiredTokenInfo };
      
      authManager.setAuthSession(expiredSession);
      expect(authManager.isAuthenticated()).to.be.false;
    });
  });

  describe('token validation', () => {
    it('should validate token with 5 minute buffer', () => {
      const tokenInfo = { 
        ...mockTokenInfo, 
        expires_at: Date.now() + 6 * 60 * 1000 // 6 minutes from now
      };
      const session = { ...mockAuthSession, tokens: tokenInfo };
      
      authManager.setAuthSession(session);
      expect(authManager.isTokenValid()).to.be.true;
    });

    it('should invalidate token within 5 minute buffer', () => {
      const tokenInfo = { 
        ...mockTokenInfo, 
        expires_at: Date.now() + 4 * 60 * 1000 // 4 minutes from now (within buffer)
      };
      const session = { ...mockAuthSession, tokens: tokenInfo };
      
      authManager.setAuthSession(session);
      expect(authManager.isTokenValid()).to.be.false;
    });

    it('should return false when no session exists', () => {
      expect(authManager.isTokenValid()).to.be.false;
    });
  });

  describe('token access', () => {
    it('should return valid access token when authenticated', () => {
      authManager.setAuthSession(mockAuthSession);
      expect(authManager.getValidToken()).to.equal('mock_access_token');
    });

    it('should return null when not authenticated', () => {
      expect(authManager.getValidToken()).to.be.null;
    });

    it('should return null when token is expired', () => {
      const expiredTokenInfo = { ...mockTokenInfo, expires_at: Date.now() - 1000 };
      const expiredSession = { ...mockAuthSession, tokens: expiredTokenInfo };
      
      authManager.setAuthSession(expiredSession);
      expect(authManager.getValidToken()).to.be.null;
    });

    it('should return refresh token when available', () => {
      authManager.setAuthSession(mockAuthSession);
      expect(authManager.getRefreshToken()).to.equal('mock_refresh_token');
    });

    it('should return null when no refresh token', () => {
      const tokenInfoNoRefresh = { ...mockTokenInfo, refresh_token: undefined };
      const sessionNoRefresh = { ...mockAuthSession, tokens: tokenInfoNoRefresh };
      
      authManager.setAuthSession(sessionNoRefresh);
      expect(authManager.getRefreshToken()).to.be.null;
    });

    it('should return null refresh token when not authenticated', () => {
      expect(authManager.getRefreshToken()).to.be.null;
    });
  });

  describe('token updates', () => {
    it('should update tokens and lastUsed time', async () => {
      authManager.setAuthSession(mockAuthSession);
      const originalLastUsed = mockAuthSession.lastUsed;
      
      const newTokenInfo: TokenInfo = {
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_at: Date.now() + 7200000, // 2 hours from now
        scope: mockTokenInfo.scope,
        token_type: 'Bearer'
      };

      await clock.tickAsync(10);
      authManager.updateTokens(newTokenInfo);

      const session = authManager.getAuthSession();
      expect(session!.tokens).to.deep.equal(newTokenInfo);
      expect(session!.lastUsed).to.be.greaterThan(originalLastUsed);
    });

    it('should not update when no session exists', () => {
      const newTokenInfo: TokenInfo = {
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_at: Date.now() + 7200000,
        scope: mockTokenInfo.scope,
        token_type: 'Bearer'
      };

      // Should not throw
      authManager.updateTokens(newTokenInfo);
      expect(authManager.getAuthSession()).to.be.null;
    });
  });

  describe('user information', () => {
    it('should return user info when authenticated', () => {
      authManager.setAuthSession(mockAuthSession);
      expect(authManager.getUserInfo()).to.deep.equal(mockUserInfo);
    });

    it('should return null when not authenticated', () => {
      expect(authManager.getUserInfo()).to.be.null;
    });
  });

  describe('logout functionality', () => {
    it('should clear authentication session', () => {
      authManager.setAuthSession(mockAuthSession);
      expect(authManager.isAuthenticated()).to.be.true;

      authManager.clearAuth();
      expect(authManager.isAuthenticated()).to.be.false;
      expect(authManager.getAuthSession()).to.be.null;
    });
  });

  describe('authentication status reporting', () => {
    it('should return detailed status when authenticated', () => {
      authManager.setAuthSession(mockAuthSession);
      const status = authManager.getAuthStatus();

      expect(status.authenticated).to.be.true;
      expect(status.tokenValid).to.be.true;
      expect(status.user).to.deep.equal(mockUserInfo);
      expect(status.expiresIn).to.be.a('number');
      expect(status.expiresIn).to.be.greaterThan(0);
    });

    it('should return basic status when not authenticated', () => {
      const status = authManager.getAuthStatus();

      expect(status.authenticated).to.be.false;
      expect(status.tokenValid).to.be.false;
      expect(status.user).to.be.undefined;
      expect(status.expiresIn).to.be.undefined;
    });

    it('should calculate correct expires in time', () => {
      const tokenInfo = { 
        ...mockTokenInfo, 
        expires_at: Date.now() + 1800000 // 30 minutes from now
      };
      const session = { ...mockAuthSession, tokens: tokenInfo };
      
      authManager.setAuthSession(session);
      const status = authManager.getAuthStatus();

      expect(status.expiresIn).to.be.approximately(1800, 5); // Within 5 seconds
    });

    it('should handle expired tokens in status', () => {
      const expiredTokenInfo = { ...mockTokenInfo, expires_at: Date.now() - 1000 };
      const expiredSession = { ...mockAuthSession, tokens: expiredTokenInfo };
      
      authManager.setAuthSession(expiredSession);
      const status = authManager.getAuthStatus();

      expect(status.authenticated).to.be.true; // Session exists
      expect(status.tokenValid).to.be.false; // But token is invalid
      expect(status.expiresIn).to.equal(0);
    });
  });

  describe('edge cases', () => {
    it('should handle session with missing user info', () => {
      const sessionWithoutUser = { 
        ...mockAuthSession, 
        user: undefined as any 
      };
      
      authManager.setAuthSession(sessionWithoutUser);
      expect(authManager.getUserInfo()).to.be.null;
    });

    it('should handle session with missing tokens', () => {
      const sessionWithoutTokens = { 
        ...mockAuthSession, 
        tokens: undefined as any 
      };
      
      authManager.setAuthSession(sessionWithoutTokens);
      expect(authManager.isAuthenticated()).to.be.false;
    });

    it('should handle concurrent access', () => {
      authManager.setAuthSession(mockAuthSession);
      
      // Simulate concurrent access
      const token1 = authManager.getValidToken();
      const token2 = authManager.getValidToken();
      const session1 = authManager.getAuthSession();
      const session2 = authManager.getAuthSession();

      expect(token1).to.equal(token2);
      expect(session1).to.deep.equal(session2);
    });

    it('should preserve original session when updating tokens', () => {
      authManager.setAuthSession(mockAuthSession);
      const originalCreatedAt = mockAuthSession.createdAt;
      const originalUser = mockAuthSession.user;

      const newTokenInfo: TokenInfo = {
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_at: Date.now() + 7200000,
        scope: mockTokenInfo.scope,
        token_type: 'Bearer'
      };

      authManager.updateTokens(newTokenInfo);

      const session = authManager.getAuthSession();
      expect(session!.createdAt).to.equal(originalCreatedAt);
      expect(session!.user).to.deep.equal(originalUser);
    });
  });

  describe('memory management', () => {
    it('should not leak session data after clearing', () => {
      authManager.setAuthSession(mockAuthSession);
      authManager.clearAuth();

      // Should not have references to old session data
      expect(authManager.getValidToken()).to.be.null;
      expect(authManager.getRefreshToken()).to.be.null;
      expect(authManager.getUserInfo()).to.be.null;
      expect(authManager.isAuthenticated()).to.be.false;
    });
  });
}); 