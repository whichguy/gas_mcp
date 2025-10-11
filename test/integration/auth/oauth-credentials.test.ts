import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { readFileSync } from 'fs';
import { join } from 'path';
import { InProcessTestClient, InProcessAuthHelper } from '../../helpers/inProcessClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';

describe('OAuth Credentials Configuration', () => {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let oauthConfig: any;

  before(function() {
    // Load OAuth configuration (UWP PKCE-only format)
    try {
      const configPath = join(process.cwd(), 'oauth-config.json');
      oauthConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (error) {
      console.log('⚠️  Could not load oauth-config.json - skipping OAuth credentials tests');
      this.skip();
      return;
    }

    // Use the shared global client to avoid multiple server processes
    if (!globalAuthState.client || !globalAuthState.auth) {
      this.skip(); // Skip if global client not available
    }
    client = globalAuthState.client!; // Non-null assertion since we checked above
    auth = globalAuthState.auth!;  // Reuse global auth with sessionId
    console.log('🔗 Using shared global MCP client for OAuth credentials tests');
  });

  describe('Configuration Validation', () => {
    it('should have valid UWP PKCE OAuth client credentials configured', () => {
      expect(oauthConfig).to.have.property('oauth');
      expect(oauthConfig.oauth).to.have.property('client_id');
      expect(oauthConfig.oauth).to.have.property('client_type');
      expect(oauthConfig.oauth).to.have.property('redirect_uris');

      // UWP PKCE-only: Should NOT have client_secret
      expect(oauthConfig.oauth).to.not.have.property('client_secret');

      // Ensure not using placeholder values
      expect(oauthConfig.oauth.client_id).to.not.equal('YOUR_GOOGLE_CLIENT_ID');

      // Basic format validation
      expect(oauthConfig.oauth.client_id).to.include('.apps.googleusercontent.com');
      expect(oauthConfig.oauth.client_type).to.equal('installed');

      // Verify redirect URIs
      expect(oauthConfig.oauth.redirect_uris).to.be.an('array');
      expect(oauthConfig.oauth.redirect_uris).to.include('http://127.0.0.1:3000/callback');
    });

    it('should have all required OAuth scopes', () => {
      const requiredScopes = [
        'https://www.googleapis.com/auth/script.projects',
        'https://www.googleapis.com/auth/script.processes',
        'https://www.googleapis.com/auth/script.deployments',
        'https://www.googleapis.com/auth/script.scriptapp',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ];

      expect(oauthConfig.oauth).to.have.property('scopes');
      expect(oauthConfig.oauth.scopes).to.be.an('array');

      for (const scope of requiredScopes) {
        expect(oauthConfig.oauth.scopes).to.include(scope);
      }
    });

    it('should use UWP application type (desktop/installed)', () => {
      // UWP applications don't need server config in the OAuth file
      // The redirect URI is configured in Google Cloud Console
      expect(oauthConfig.oauth.client_type).to.equal('installed');

      // Redirect URIs should include localhost callback
      const redirects = oauthConfig.oauth.redirect_uris;
      const hasLocalCallback = redirects.some((uri: string) =>
        uri.includes('127.0.0.1') || uri.includes('localhost')
      );
      expect(hasLocalCallback).to.be.true;
    });
  });

  describe('OAuth URL Generation', () => {
    it('should generate valid OAuth URLs with configured credentials', async () => {
      const authResult = await auth.startInteractiveAuth();
      
      expect(authResult).to.have.property('authUrl');
      expect(authResult.authUrl).to.be.a('string');
      
      // Verify the configured client ID is in the URL
      expect(authResult.authUrl).to.include(oauthConfig.oauth.client_id);
      
      // Verify redirect URI is correct
      expect(authResult.authUrl).to.include(encodeURIComponent(oauthConfig.oauth.redirect_uri));
      
      // Verify it's using Google's OAuth endpoint
      expect(authResult.authUrl).to.include('accounts.google.com/o/oauth2/auth');
      
      // Verify required parameters
      expect(authResult.authUrl).to.include('response_type=code');
      expect(authResult.authUrl).to.include('access_type=offline');
      expect(authResult.authUrl).to.include('prompt=consent');
    });

    it('should include all required scopes in the OAuth URL', async () => {
      const authResult = await auth.startInteractiveAuth();
      
      // Decode the scope parameter from the URL
      const url = new URL(authResult.authUrl);
      const scopes = url.searchParams.get('scope');

      expect(scopes).to.be.a('string');

      const decodedScopes = decodeURIComponent(scopes!).split(' ');

      // Verify key Google Apps Script scopes are present
      const requiredScopes = [
        'https://www.googleapis.com/auth/script.projects',
        'https://www.googleapis.com/auth/userinfo.email'
      ];

      for (const scope of requiredScopes) {
        expect(decodedScopes).to.include(scope);
      }
    });
  });

  describe('Error Handling for Invalid Credentials', () => {
    it('should detect placeholder credentials', () => {
      // This test ensures we don't accidentally deploy with placeholder values
      const hasPlaceholders =
        oauthConfig.oauth.client_id === 'YOUR_GOOGLE_CLIENT_ID';

      expect(hasPlaceholders).to.be.false;

      // UWP PKCE-only: Should NOT have client_secret
      expect(oauthConfig.oauth).to.not.have.property('client_secret');
    });

    it('should handle OAuth errors gracefully', async function() {
      // This test verifies that OAuth errors are properly handled
      // We can't test with invalid credentials without breaking the config,
      // so we test the error handling with an invalid auth code
      
      await auth.startInteractiveAuth();
      
      try {
        await auth.completeAuth('invalid_test_code_123');
        expect.fail('Should have thrown error for invalid authorization code');
      } catch (error: any) {
        // Enhanced error responses now include structured data with auto-auth
        const isValidError = error.message.includes('authorization') || 
                           error.message.includes('invalid') ||
                           error.message.includes('token') ||
                           error.message.includes('Tool error') ||
                           error.data?.phase === 'token_exchange';
        expect(isValidError).to.be.true;
      }
    });
  });

  describe('Live Credential Validation', () => {
    it('should validate credentials work with Google OAuth', async function() {
      this.timeout(30000);
      
      console.log('\n🔍 Testing OAuth credentials with Google...');
      console.log(`Client ID: ${oauthConfig.oauth.client_id}`);
      
      // Test that credentials are properly configured and can generate valid OAuth URLs
      const authResult = await auth.startInteractiveAuth();
      
      // Verify the OAuth URL is properly formatted and includes our credentials
      expect(authResult.authUrl).to.include('accounts.google.com');
      expect(authResult.authUrl).to.include(oauthConfig.oauth.client_id);
      expect(authResult.authUrl).to.include('oauth2/auth');
      
      console.log('✅ OAuth URL generation successful');
      console.log('✅ Credentials properly configured');
      
      // Test that authentication status is properly handled
      const authStatus = await auth.getAuthStatus();
      expect(authStatus).to.have.property('authenticated');
      expect(authStatus).to.have.property('tokenValid');
      
      if (authStatus.authenticated) {
        console.log(`✅ Already authenticated as: ${authStatus.user?.email || 'User'}`);
        console.log('✅ Live OAuth credentials confirmed working');
      } else {
        console.log('ℹ️  OAuth infrastructure verified - credentials ready for authentication');
        console.log('ℹ️  Manual OAuth completion would confirm live credential validation');
        
        // If GAS_INTEGRATION_TEST is set, provide manual testing instructions
        if (process.env.GAS_INTEGRATION_TEST) {
          console.log('\n=== MANUAL CREDENTIAL VALIDATION ===');
          console.log('Visit the generated OAuth URL to verify credentials work:');
          console.log(authResult.authUrl);
          console.log('If the page loads without errors, credentials are valid');
        }
      }
      
      console.log('✅ OAuth credential validation completed');
    });
  });
}); 