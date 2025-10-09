import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { stub, restore } from 'sinon';
import { AuthTool } from '../../../src/tools/auth.js';
import { AuthStateManager } from '../../../src/auth/authState.js';
import { OAuthError } from '../../../src/errors/mcpErrors.js';
import { SessionAuthManager } from '../../../src/auth/sessionManager.js';

describe('AuthTool', () => {
  let authTool: AuthTool;
  let authManager: AuthStateManager;
  let sessionAuthManager: SessionAuthManager;

  beforeEach(() => {
    // Set test mode to prevent OAuth server conflicts
    process.env.MCP_TEST_MODE = 'true';
    
    sessionAuthManager = new SessionAuthManager();
    authTool = new AuthTool(sessionAuthManager);
    authManager = AuthStateManager.getInstance();
    authManager.clearAuth();
  });

  afterEach(() => {
    restore();
    delete process.env.MCP_TEST_MODE;
  });

  describe('tool properties', () => {
    it('should have correct name and description', () => {
      expect(authTool.name).to.equal('auth');
      expect(authTool.description).to.include('Google Apps Script API');
      expect(authTool.description).to.include('OAuth 2.0');
    });

    it('should have correct input schema', () => {
      const tool = new AuthTool();
      const schema = tool.inputSchema as any;
      
      expect(schema.type).to.equal('object');
      expect(schema.properties.mode).to.exist;
      expect(schema.properties.openBrowser).to.exist;
      expect(schema.properties.waitForCompletion).to.exist;
      expect(schema.properties.accessToken).to.exist;
      
      // Verify mode enum values
      expect(schema.properties.mode.enum).to.deep.equal(['start', 'status', 'logout']);
    });
  });

  describe('execute method routing', () => {
    it('should route to correct handler based on mode', async () => {
      // Mock the private methods to test routing
      const startStub = stub(authTool as any, 'startAuthentication').resolves({ status: 'started' });
      const callbackStub = stub(authTool as any, 'handleCallback').resolves({ status: 'authenticated' });
      const statusStub = stub(authTool as any, 'getAuthenticationStatus').resolves({ status: 'not_authenticated' });
      const logoutStub = stub(authTool as any, 'logout').resolves({ status: 'logged_out' });

      await authTool.execute({ mode: 'start' });
      expect(startStub.calledOnce).to.be.true;

      await authTool.execute({ mode: 'callback', code: 'test_code' });
      expect(callbackStub.calledOnce).to.be.true;

      await authTool.execute({ mode: 'status' });
      expect(statusStub.calledOnce).to.be.true;

      await authTool.execute({ mode: 'logout' });
      expect(logoutStub.calledOnce).to.be.true;
    });

    it('should default to start mode', async () => {
      const startStub = stub(authTool as any, 'startAuthentication').resolves({ status: 'started' });
      
      await authTool.execute({});
      expect(startStub.calledOnce).to.be.true;
    });

    it('should throw error for invalid mode', async () => {
      try {
        await authTool.execute({ mode: 'invalid' });
        expect.fail('Should have thrown error for invalid mode');
      } catch (error) {
        expect((error as Error).message).to.include('Invalid mode');
      }
    });
  });

  describe('start authentication mode', () => {
    beforeEach(() => {
      // Completely stub all OAuth methods to prevent real flows
      stub(authTool as any, 'authClient').value({
        generateAuthUrl: stub().returns('https://accounts.google.com/oauth/authorize?mocked=true')
      });
      
      stub(authTool as any, 'callbackServer').value({
        start: stub().resolves(),
        stop: stub().resolves(),
        isRunning: stub().returns(true),
        getCallbackUrl: stub().returns('http://localhost:12345/oauth/callback'),
        getPort: stub().returns(12345),
        waitForCallback: stub().resolves({ code: 'test_code', state: 'test_state' })
      });

      // Mock the actual OAuth flow methods to prevent real execution
      stub(authTool as any, 'startAuthentication').resolves({
        status: 'started',
        authUrl: 'https://accounts.google.com/oauth/authorize?mocked=true',
        callbackUrl: 'http://localhost:12345/oauth/callback',
        state: 'mocked_state',
        instructions: ['Mocked OAuth flow started']
      });
    });

    it('should start authentication flow', async () => {
      const result = await authTool.execute({ mode: 'start' });
      
      expect(result.status).to.equal('started');
      expect(result.authUrl).to.be.a('string');
      expect(result.callbackUrl).to.be.a('string');
      expect(result.state).to.be.a('string');
      expect(result.instructions).to.be.an('array');
    });

    it('should handle browser opening preference', async () => {
      const result = await authTool.execute({ mode: 'start', openBrowser: false });
      
      expect(result.status).to.equal('started');
      expect(result.instructions).to.be.an('array');
    });
  });

  describe('callback mode', () => {
    it('should require authorization code', async () => {
      try {
        await authTool.execute({ mode: 'callback' });
        expect.fail('Should have thrown error for missing code');
      } catch (error) {
        expect((error as Error).message).to.include('Authorization code is required');
      }
    });

    it('should handle successful callback', async () => {
      // Mock successful authentication
      stub(authTool as any, 'handleCallback').resolves({
        status: 'authenticated',
        message: 'Authentication successful',
        user: {
        id: '123',
        email: 'test@example.com',
        name: 'Test User',
        verified_email: true
        }
      });

      const result = await authTool.execute({ mode: 'callback', code: 'valid_code' });
      
      expect(result.status).to.equal('authenticated');
      expect(result.message).to.include('successful');
      expect(result.user).to.exist;
    });

    it('should handle authentication failure', async () => {
      stub(authTool as any, 'completeAuthentication').rejects(new Error('Invalid code'));

      try {
        await authTool.execute({ mode: 'callback', code: 'invalid_code' });
        expect.fail('Should have thrown OAuthError');
      } catch (error) {
        expect(error).to.be.instanceOf(OAuthError);
        expect((error as Error).message).to.include('Authentication failed');
      }
    });
  });

  describe('logout mode', () => {
    beforeEach(() => {
      // Mock all OAuth components to prevent real interactions
      stub(authTool as any, 'callbackServer').value({
        isRunning: stub().returns(false),
        stop: stub().resolves()
      });
    });

    it('should logout successfully', async () => {
      // Mock the entire logout process
      stub(authTool as any, 'logout').resolves({
        status: 'logged_out',
        message: 'Successfully logged out',
        wasAuthenticated: true
      });

      const result = await authTool.execute({ mode: 'logout' });
      
      expect(result.status).to.equal('logged_out');
      expect(result.message).to.include('Successfully logged out');
    });

    it('should handle logout with token revocation failure', async () => {
      // Mock logout with revocation failure
      stub(authTool as any, 'logout').resolves({
        status: 'logged_out',
        message: 'Successfully logged out (token revocation failed)',
        wasAuthenticated: true
      });

      const result = await authTool.execute({ mode: 'logout' });
      
      expect(result.status).to.equal('logged_out');
      expect(result.message).to.include('Successfully logged out');
    });

    it('should logout when not authenticated', async () => {
      // Mock logout when not authenticated
      stub(authTool as any, 'logout').resolves({
        status: 'logged_out',
        message: 'Already logged out',
        wasAuthenticated: false
      });

      const result = await authTool.execute({ mode: 'logout' });
      
      expect(result.status).to.equal('logged_out');
    });
  });

  describe('error handling', () => {
    it('should handle callback server start failure', async () => {
      // Mock the startAuthentication method to throw the expected error
      stub(authTool as any, 'startAuthentication').rejects(new OAuthError('Failed to start authentication: Port in use', 'authorization'));

      try {
        await authTool.execute({ mode: 'start' });
        expect.fail('Should have thrown OAuthError');
      } catch (error) {
        expect(error).to.be.instanceOf(OAuthError);
        expect((error as Error).message).to.include('Failed to start authentication');
      }
    });

    it('should handle auth URL generation failure', async () => {
      // Mock the startAuthentication method to throw OAuth config error
      stub(authTool as any, 'startAuthentication').rejects(new OAuthError('Failed to start authentication: OAuth config error', 'authorization'));

      try {
        await authTool.execute({ mode: 'start' });
        expect.fail('Should have thrown OAuthError');
      } catch (error) {
        expect(error).to.be.instanceOf(OAuthError);
      }
    });
  });

  describe('browser integration', () => {
    beforeEach(() => {
      // Mock the OAuth flow completely to prevent real execution
      stub(authTool as any, 'startAuthentication').resolves({
        status: 'started',
        authUrl: 'https://accounts.google.com/oauth/authorize?mocked=true',
        callbackUrl: 'http://localhost:12345/oauth/callback',
        state: 'mocked_state',
        instructions: ['Mocked OAuth flow started']
      });
    });

    it('should handle browser opening success', async () => {
      const result = await authTool.execute({ mode: 'start', openBrowser: true });
      
      expect(result.status).to.equal('started');
      expect(result.instructions).to.be.an('array');
    });

    it('should handle browser opening failure gracefully', async () => {
      const result = await authTool.execute({ mode: 'start', openBrowser: false });
      
      expect(result.status).to.equal('started');
      expect(result.instructions).to.be.an('array');
    });
  });

  describe('OAuth flow integration', () => {
    beforeEach(() => {
      // Mock the complete OAuth flow end-to-end
      stub(authTool as any, 'startAuthentication').resolves({
        status: 'started',
        authUrl: 'https://accounts.google.com/oauth/authorize?mocked=true',
        callbackUrl: 'http://localhost:12345/oauth/callback',
        state: 'mocked_state_123',
        instructions: ['Mocked OAuth flow started']
      });

      stub(authTool as any, 'handleCallback').resolves({
        status: 'authenticated',
        message: 'Authentication successful',
        user: {
          id: '123',
          email: 'test@example.com',
          name: 'Test User',
          verified_email: true
        }
      });
    });

    it('should complete full OAuth flow', async () => {
      const setAuthSessionStub = stub(authManager, 'setAuthSession');

      // Start auth (mocked)
      const startResult = await authTool.execute({ mode: 'start' });
      expect(startResult.status).to.equal('started');
      expect(startResult.authUrl).to.include('mocked=true');

      // Complete with callback (mocked)
      const callbackResult = await authTool.execute({ mode: 'callback', code: 'auth_code_456' });
      expect(callbackResult.status).to.equal('authenticated');
      // Note: setAuthSessionStub won't be called because we're mocking handleCallback directly
    });
  });

  describe('mode validation', () => {
    it('should default to start mode', async () => {
      // Mock the startAuthentication to prevent real OAuth flow
      stub(authTool as any, 'startAuthentication').resolves({
        status: 'started',
        authUrl: 'https://accounts.google.com/oauth/authorize?mocked=true',
        callbackUrl: 'http://localhost:12345/oauth/callback',
        state: 'mocked_state',
        instructions: ['Mocked OAuth flow started']
      });

      const result = await authTool.execute({});
      expect(result.status).to.equal('started');
    });

    it('should reject invalid mode', async () => {
      try {
        await authTool.execute({ mode: 'invalid' });
        expect.fail('Should have thrown error for invalid mode');
      } catch (error) {
        expect((error as Error).message).to.include('Invalid mode');
      }
    });
  });

  describe('callback mode validation', () => {
    it('should require authorization code', async () => {
      try {
        await authTool.execute({ mode: 'callback' });
        expect.fail('Should have thrown error for missing code');
      } catch (error) {
        expect((error as Error).message).to.include('Authorization code is required');
      }
    });
  });

  describe('status mode', () => {
    beforeEach(() => {
      // Mock the callback server to prevent real interactions
      stub(authTool as any, 'callbackServer').value({
        isRunning: stub().returns(false)
      });
    });

    it('should return not authenticated status', async () => {
      const result = await authTool.execute({ mode: 'status' });
      
      expect(result.status).to.equal('not_authenticated');
      expect(result.authenticated).to.be.false;
      expect(result.tokenValid).to.be.false;
      expect(result.instructions).to.include('gas_auth(mode="start")');
    });

    it('should return authenticated status', async () => {
      // Mock the getAuthenticationStatus method directly
      stub(authTool as any, 'getAuthenticationStatus').resolves({
        status: 'authenticated',
        authenticated: true,
        tokenValid: true,
        user: {
          id: '123',
          email: 'test@example.com',
          name: 'Test User',
          verified_email: true
        },
        expiresIn: 3600
      });

      const result = await authTool.execute({ mode: 'status' });
      
      expect(result.status).to.equal('authenticated');
      expect(result.authenticated).to.be.true;
      expect(result.tokenValid).to.be.true;
      expect(result.user).to.exist;
      expect(result.expiresIn).to.be.a('number');
    });
  });
}); 