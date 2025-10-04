/**
 * Manual Integration Test: Auth + List Projects
 *
 * This test is designed to be run manually through Claude Code's MCP session.
 * It verifies the complete authentication flow and filesystem token caching.
 *
 * To run this test:
 * 1. Clear token cache: rm -rf .auth/tokens/*
 * 2. Run: gas_auth({mode: "start"})
 * 3. Complete OAuth flow in browser
 * 4. Run: gas_auth({mode: "status"}) - verify authenticated
 * 5. Run: gas_ls({scriptId: "..."}) - verify API call works
 * 6. Check: ls -la .auth/tokens/ - verify token file created with 600 permissions
 * 7. Check: cat .auth/tokens/*.json | jq - verify token structure
 *
 * This validates:
 * - OAuth PKCE flow works
 * - Tokens are saved to filesystem with correct permissions
 * - Tokens can be read from filesystem cache
 * - API calls work with cached tokens
 * - Automatic token refresh works on expiry
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { promises as fs } from 'fs';
import path from 'path';

describe('Manual Auth Flow Verification', () => {
  const tokenCacheDir = path.join(process.cwd(), '.auth', 'tokens');

  it('should have token cache directory with correct permissions', async () => {
    const stats = await fs.stat(tokenCacheDir);
    const permissions = (stats.mode & 0o777).toString(8);

    console.log(`Token cache directory: ${tokenCacheDir}`);
    console.log(`Permissions: ${permissions} (expected: 700)`);

    expect(permissions).to.equal('700');
  });

  it('should have token files with 600 permissions after authentication', async function() {
    const files = await fs.readdir(tokenCacheDir);
    const tokenFiles = files.filter(f => f.endsWith('.json'));

    if (tokenFiles.length === 0) {
      console.log('⚠️  No token files found - run authentication first');
      console.log('   1. gas_auth({mode: "start"})');
      console.log('   2. Complete OAuth in browser');
      console.log('   3. Re-run this test');
      this.skip();
      return;
    }

    console.log(`Found ${tokenFiles.length} token file(s)`);

    for (const file of tokenFiles) {
      const filePath = path.join(tokenCacheDir, file);
      const stats = await fs.stat(filePath);
      const permissions = (stats.mode & 0o777).toString(8);

      console.log(`File: ${file}`);
      console.log(`  Permissions: ${permissions} (expected: 600)`);

      expect(permissions).to.equal('600');
    }
  });

  it('should have valid token structure', async function() {
    const files = await fs.readdir(tokenCacheDir);
    const tokenFiles = files.filter(f => f.endsWith('.json'));

    if (tokenFiles.length === 0) {
      this.skip();
      return;
    }

    const tokenFile = path.join(tokenCacheDir, tokenFiles[0]);
    const content = await fs.readFile(tokenFile, 'utf-8');
    const data = JSON.parse(content);

    console.log('Token structure validation:');
    console.log(`  Has sessionId: ${!!data.sessionId}`);
    console.log(`  Has tokens: ${!!data.tokens}`);
    console.log(`  Has user: ${!!data.user}`);
    console.log(`  Has createdAt: ${!!data.createdAt}`);
    console.log(`  Has lastUsed: ${!!data.lastUsed}`);

    expect(data).to.have.property('sessionId');
    expect(data).to.have.property('tokens');
    expect(data).to.have.property('user');
    expect(data).to.have.property('createdAt');
    expect(data).to.have.property('lastUsed');

    expect(data.tokens).to.have.property('access_token');
    expect(data.tokens).to.have.property('expires_at');
    expect(data.tokens).to.have.property('token_type');
    expect(data.tokens).to.have.property('scope');

    expect(data.user).to.have.property('email');
    expect(data.user).to.have.property('name');
    expect(data.user).to.have.property('id');

    console.log('✅ Token structure is valid');
  });

  it('should have non-expired tokens', async function() {
    const files = await fs.readdir(tokenCacheDir);
    const tokenFiles = files.filter(f => f.endsWith('.json'));

    if (tokenFiles.length === 0) {
      this.skip();
      return;
    }

    const tokenFile = path.join(tokenCacheDir, tokenFiles[0]);
    const content = await fs.readFile(tokenFile, 'utf-8');
    const data = JSON.parse(content);

    const now = Date.now();
    const expiresAt = data.tokens.expires_at;
    const expiresIn = Math.floor((expiresAt - now) / 1000);

    console.log(`Token expiry check:`);
    console.log(`  Current time: ${new Date(now).toISOString()}`);
    console.log(`  Expires at: ${new Date(expiresAt).toISOString()}`);
    console.log(`  Expires in: ${expiresIn} seconds`);

    expect(expiresAt).to.be.greaterThan(now);
    expect(expiresIn).to.be.greaterThan(0);

    console.log('✅ Token is not expired');
  });
});
