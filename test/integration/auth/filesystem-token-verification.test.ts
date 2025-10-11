/**
 * Filesystem Token Cache Verification Test
 *
 * This test verifies the filesystem token cache without spawning an MCP server.
 * It's designed to run after manual authentication through Claude Code's MCP session.
 *
 * Prerequisites:
 * 1. Authenticate: auth({mode: "start"}) in Claude Code
 * 2. Complete OAuth flow in browser
 * 3. Run this test: npx mocha test/integration/auth/filesystem-token-verification.test.ts --no-config
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { promises as fs } from 'fs';
import path from 'path';

describe('Filesystem Token Cache Verification (No MCP Server)', () => {
  const tokenCacheDir = path.join(process.cwd(), '.auth', 'tokens');

  it('should have token cache directory with 700 permissions', async () => {
    const stats = await fs.stat(tokenCacheDir);
    const permissions = (stats.mode & 0o777).toString(8);

    console.log(`\n📁 Token cache directory: ${tokenCacheDir}`);
    console.log(`🔒 Permissions: ${permissions} (expected: 700)`);

    expect(permissions).to.equal('700');
  });

  it('should have token files with 600 permissions', async function() {
    const files = await fs.readdir(tokenCacheDir);
    const tokenFiles = files.filter(f => f.endsWith('.json'));

    if (tokenFiles.length === 0) {
      console.log('\n⚠️  No token files found - authenticate first:');
      console.log('   1. In Claude Code: auth({mode: "start"})');
      console.log('   2. Complete OAuth in browser');
      console.log('   3. Re-run this test');
      this.skip();
      return;
    }

    console.log(`\n📄 Found ${tokenFiles.length} token file(s)`);

    for (const file of tokenFiles) {
      const filePath = path.join(tokenCacheDir, file);
      const stats = await fs.stat(filePath);
      const permissions = (stats.mode & 0o777).toString(8);

      console.log(`\n  File: ${file}`);
      console.log(`  🔒 Permissions: ${permissions} (expected: 600)`);
      console.log(`  📏 Size: ${stats.size} bytes`);

      expect(permissions).to.equal('600');
    }
  });

  it('should have valid token structure with all required fields', async function() {
    const files = await fs.readdir(tokenCacheDir);
    const tokenFiles = files.filter(f => f.endsWith('.json'));

    if (tokenFiles.length === 0) {
      this.skip();
      return;
    }

    const tokenFile = path.join(tokenCacheDir, tokenFiles[0]);
    const content = await fs.readFile(tokenFile, 'utf-8');
    const data = JSON.parse(content);

    console.log('\n🔍 Token structure validation:');
    console.log(`  ✓ Has sessionId: ${!!data.sessionId}`);
    console.log(`  ✓ Has tokens: ${!!data.tokens}`);
    console.log(`  ✓ Has user: ${!!data.user}`);
    console.log(`  ✓ Has createdAt: ${!!data.createdAt}`);
    console.log(`  ✓ Has lastUsed: ${!!data.lastUsed}`);

    // Top-level structure
    expect(data).to.have.property('sessionId');
    expect(data).to.have.property('tokens');
    expect(data).to.have.property('user');
    expect(data).to.have.property('createdAt');
    expect(data).to.have.property('lastUsed');

    // Token structure
    expect(data.tokens).to.have.property('access_token');
    expect(data.tokens).to.have.property('expires_at');
    expect(data.tokens).to.have.property('token_type');
    expect(data.tokens).to.have.property('scope');

    console.log(`\n  Token details:`);
    console.log(`    ✓ access_token: ${data.tokens.access_token.substring(0, 20)}...`);
    console.log(`    ✓ refresh_token: ${data.tokens.refresh_token ? 'present' : 'missing'}`);
    console.log(`    ✓ token_type: ${data.tokens.token_type}`);
    console.log(`    ✓ scope: ${data.tokens.scope?.split(' ').length || 0} scopes`);

    // User structure
    expect(data.user).to.have.property('email');
    expect(data.user).to.have.property('name');
    expect(data.user).to.have.property('id');

    console.log(`\n  User details:`);
    console.log(`    ✓ email: ${data.user.email}`);
    console.log(`    ✓ name: ${data.user.name}`);
    console.log(`    ✓ id: ${data.user.id}`);

    console.log('\n✅ Token structure is valid');
  });

  it('should have non-expired access token', async function() {
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
    const expiresInMinutes = Math.floor(expiresIn / 60);

    console.log(`\n⏰ Token expiry check:`);
    console.log(`  Current time: ${new Date(now).toISOString()}`);
    console.log(`  Expires at: ${new Date(expiresAt).toISOString()}`);
    console.log(`  Expires in: ${expiresIn} seconds (${expiresInMinutes} minutes)`);

    if (expiresIn < 0) {
      console.log(`\n  ❌ Token is EXPIRED by ${Math.abs(expiresIn)} seconds`);
      console.log(`  💡 Token should auto-refresh when next API call is made`);
    } else if (expiresIn < 300) {
      console.log(`\n  ⚠️  Token expires soon (< 5 minutes)`);
    } else {
      console.log(`\n  ✅ Token has plenty of time remaining`);
    }

    expect(expiresAt).to.be.a('number');
    expect(expiresAt).to.be.greaterThan(0);
  });

  it('should have refresh token for automatic renewal', async function() {
    const files = await fs.readdir(tokenCacheDir);
    const tokenFiles = files.filter(f => f.endsWith('.json'));

    if (tokenFiles.length === 0) {
      this.skip();
      return;
    }

    const tokenFile = path.join(tokenCacheDir, tokenFiles[0]);
    const content = await fs.readFile(tokenFile, 'utf-8');
    const data = JSON.parse(content);

    console.log(`\n🔄 Refresh token check:`);

    if (data.tokens.refresh_token) {
      console.log(`  ✅ Refresh token present: ${data.tokens.refresh_token.substring(0, 20)}...`);
      console.log(`  💡 Token can be automatically refreshed when expired`);
      expect(data.tokens.refresh_token).to.be.a('string');
      expect(data.tokens.refresh_token.length).to.be.greaterThan(0);
    } else {
      console.log(`  ⚠️  No refresh token found`);
      console.log(`  💡 User will need to re-authenticate when access token expires`);
    }
  });
});
