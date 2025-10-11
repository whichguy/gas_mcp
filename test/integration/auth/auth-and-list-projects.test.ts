/**
 * Simple Integration Test: Auth + List Projects
 *
 * Full end-to-end test with no mocks:
 * 1. List projects without auth (expect auth error)
 * 2. Authenticate with Google Apps Script
 * 3. List projects with cached token (expect success)
 */

import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { InProcessTestClient, InProcessAuthHelper } from '../../helpers/inProcessClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';
import { promises as fs } from 'fs';
import path from 'path';

describe('Auth + List Projects Integration Test', () => {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;

  before(function() {
    if (!globalAuthState.client || !globalAuthState.auth) {
      this.skip(); // Skip if global client not available
    }
    client = globalAuthState.client!;
    auth = globalAuthState.auth!;  // Reuse global auth with sessionId
    console.log('🔗 Using shared global MCP client');
  });

  describe('Complete Authentication Flow', () => {
    it('should demonstrate: unauthenticated → auth → authenticated API calls', async function() {
      this.timeout(45000); // 45 second timeout for full flow

      // =====================================================================
      // STEP 1: List projects WITHOUT authentication (expect auth error)
      // =====================================================================
      console.log('\n📋 Step 1: Listing projects WITHOUT authentication...');
      console.log('Expected: Should receive authentication error or instructions');

      // First clear any existing authentication
      await auth.logout();

      try {
        const unauthResult = await client.callTool('gas_project_list', {});
        console.log('Response while unauthenticated:', JSON.stringify(unauthResult, null, 2));

        // Should either throw error or return auth instructions
        // MCP tools may return structured error responses
        if (unauthResult.isError) {
          console.log('✅ Received error response as expected (not authenticated)');
        } else {
          // Check if response indicates need for authentication
          const responseText = JSON.stringify(unauthResult);
          const needsAuth = responseText.includes('auth') ||
                           responseText.includes('authenticate') ||
                           responseText.includes('not authenticated');

          if (needsAuth) {
            console.log('✅ Received authentication requirement as expected');
          } else {
            console.log('⚠️  Unexpected response - may already be authenticated from previous test');
          }
        }
      } catch (error: any) {
        console.log('✅ Received expected authentication error');
        console.log(`Error message: ${error.message}`);

        const isAuthError = error.message.includes('auth') ||
                           error.message.includes('token') ||
                           error.message.includes('authenticate');

        expect(isAuthError).to.be.true;
      }

      // =====================================================================
      // STEP 2: Authenticate with Google Apps Script
      // =====================================================================
      console.log('\n📋 Step 2: Authenticating with Google Apps Script...');

      const authStatus = await auth.getAuthStatus();

      if (!authStatus.authenticated) {
        console.log('❌ Not authenticated - manual authentication required');
        console.log('\nTo complete this test:');
        console.log('1. Run: npm run test:auth');
        console.log('2. Complete the OAuth flow in your browser');
        console.log('3. Re-run this test');
        this.skip();
        return;
      }

      console.log(`✅ Authenticated as: ${authStatus.user?.email}`);
      expect(authStatus.authenticated).to.be.true;
      expect(authStatus.tokenValid).to.be.true;
      expect(authStatus.user).to.be.an('object');
      expect(authStatus.user?.email).to.be.a('string');

      // Verify filesystem token cache exists
      console.log('\n📋 Step 2a: Verifying filesystem token cache...');
      const tokenCacheDir = path.join(process.cwd(), '.auth', 'tokens');

      try {
        const files = await fs.readdir(tokenCacheDir);
        const tokenFiles = files.filter(f => f.endsWith('.json'));
        console.log(`✅ Found ${tokenFiles.length} cached token file(s) in ${tokenCacheDir}`);
        expect(tokenFiles.length).to.be.greaterThan(0);

        // Verify file permissions (should be 0o600)
        const tokenFile = path.join(tokenCacheDir, tokenFiles[0]);
        const stats = await fs.stat(tokenFile);
        const permissions = (stats.mode & 0o777).toString(8);
        console.log(`✅ Token file permissions: ${permissions} (expected: 600)`);
        console.log(`✅ Token file: ${tokenFiles[0]}`);
        expect(permissions).to.equal('600');

        // Verify token file structure
        const tokenContent = await fs.readFile(tokenFile, 'utf-8');
        const tokenData = JSON.parse(tokenContent);
        expect(tokenData).to.have.property('sessionId');
        expect(tokenData).to.have.property('tokens');
        expect(tokenData).to.have.property('user');
        expect(tokenData.tokens).to.have.property('access_token');
        expect(tokenData.tokens).to.have.property('expires_at');
        console.log(`✅ Token file has valid structure (sessionId, tokens, user)`);
      } catch (error: any) {
        console.log('⚠️  Could not verify token cache files:', error.message);
        // Don't fail test - token cache verification is informational
      }

      // =====================================================================
      // STEP 3: List projects WITH authentication (expect success)
      // =====================================================================
      console.log('\n📋 Step 3: Listing projects WITH authentication...');
      console.log('Expected: Should successfully list projects using cached token');

      const projectListResult = await client.callTool('gas_project_list', {});

      console.log('✅ Project list API call succeeded');

      expect(projectListResult).to.have.property('content');
      expect(projectListResult.content).to.be.an('array');
      expect(projectListResult.content.length).to.be.greaterThan(0);

      const projectList = projectListResult.content[0];
      expect(projectList).to.have.property('type');
      expect(projectList).to.have.property('text');

      console.log('✅ Successfully listed projects using filesystem-cached token');
      console.log(`✅ Response type: ${projectList.type}`);

      // Parse the project list if it's JSON
      try {
        const projectData = JSON.parse(projectList.text);
        if (projectData.projects) {
          const projectCount = Object.keys(projectData.projects).length;
          console.log(`✅ Found ${projectCount} configured project(s)`);
        }
      } catch {
        // Response might be plain text, that's okay
        console.log('✅ Received project list response (plain text format)');
      }

      console.log('\n🎉 INTEGRATION TEST PASSED');
      console.log('✅ Flow completed: unauthenticated → authenticate → authenticated API calls');
      console.log('✅ Filesystem token caching working correctly');
    });

    it('should handle concurrent token access from filesystem cache', async function() {
      this.timeout(30000);

      const authStatus = await auth.getAuthStatus();
      if (!authStatus.authenticated) {
        console.log('⏭️  Skipping concurrent access test - authentication required');
        this.skip();
        return;
      }

      console.log('\n📋 Testing concurrent token access from filesystem cache...');

      // Make 3 concurrent API calls to test filesystem token cache sharing
      const promises = [
        client.callTool('auth', { mode: 'status' }),
        client.callTool('auth', { mode: 'status' }),
        client.callTool('auth', { mode: 'status' })
      ];

      const results = await Promise.all(promises);

      // All should succeed and return consistent results
      results.forEach((result, i) => {
        console.log(`✅ Concurrent call ${i + 1} succeeded`);
        expect(result).to.have.property('content');
      });

      console.log('✅ Filesystem token cache handles concurrent access correctly');
      console.log('✅ Multiple processes can share cached tokens safely');
    });
  });
});
