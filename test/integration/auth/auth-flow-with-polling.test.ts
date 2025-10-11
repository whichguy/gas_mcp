/**
 * Complete Auth Flow Integration Test
 *
 * This test demonstrates the proper linear flow for authentication:
 * 1. Check status (unauthenticated)
 * 2. Start auth flow (non-blocking, returns auth URL)
 * 3. User completes OAuth in browser
 * 4. Poll status until authenticated
 * 5. Verify filesystem token cache
 * 6. Make authenticated API call
 *
 * This test is designed to be run in Claude Code's MCP session where
 * the MCP server is already running.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { promises as fs } from 'fs';
import path from 'path';

describe('Complete Auth Flow with Polling (Claude Code MCP Session)', () => {
  const tokenCacheDir = path.join(process.cwd(), '.auth', 'tokens');

  it('should demonstrate complete linear auth flow', async function() {
    this.timeout(120000); // 2 minutes for manual OAuth completion

    console.log('\n📋 Step 1: Check initial auth status');
    console.log('In Claude Code, run: auth({mode: "status"})');
    console.log('Expected: Should show not_authenticated with instructions\n');

    console.log('📋 Step 2: Start non-blocking auth flow');
    console.log('In Claude Code, run: auth({mode: "start", waitForCompletion: false})');
    console.log('Expected: Returns immediately with auth URL');
    console.log('Action: Open URL in browser and complete OAuth\n');

    console.log('📋 Step 3: Poll auth status until authenticated');
    console.log('While OAuth is in progress, you can run:');
    console.log('  auth({mode: "status"})');
    console.log('Expected: Eventually shows authenticated: true\n');

    console.log('📋 Step 4: Verify filesystem token cache');
    console.log('After authentication completes, this test will verify:');
    console.log('  - Token file created with 600 permissions');
    console.log('  - Token structure is valid');
    console.log('  - Token is not expired');
    console.log('  - Refresh token is present\n');

    console.log('📋 Step 5: Test authenticated API call');
    console.log('In Claude Code, run: gas_ls({scriptId: "..."})');
    console.log('Expected: Successfully lists files using cached token\n');

    console.log('⏳ Waiting for authentication to complete...');
    console.log('   (This test will poll for token file creation)');

    // Poll for token file creation
    const maxAttempts = 120; // 2 minutes
    const pollInterval = 1000; // 1 second
    let authenticated = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const files = await fs.readdir(tokenCacheDir);
        const tokenFiles = files.filter(f => f.endsWith('.json'));

        if (tokenFiles.length > 0) {
          console.log(`\n✅ Authentication detected! Token file created: ${tokenFiles[0]}`);
          authenticated = true;
          break;
        }
      } catch (error) {
        // Directory might not exist yet
      }

      if (attempt % 10 === 0) {
        console.log(`   Still waiting... (${attempt}s elapsed)`);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    if (!authenticated) {
      console.log('\n⏭️  No authentication detected within timeout');
      console.log('   This is expected if OAuth flow was not completed');
      console.log('   To complete this test:');
      console.log('   1. Run: auth({mode: "start", waitForCompletion: false})');
      console.log('   2. Complete OAuth in browser');
      console.log('   3. Re-run this test');
      this.skip();
      return;
    }

    // Verify token file permissions and structure
    const files = await fs.readdir(tokenCacheDir);
    const tokenFiles = files.filter(f => f.endsWith('.json'));
    const tokenFile = path.join(tokenCacheDir, tokenFiles[0]);

    // Check file permissions
    const stats = await fs.stat(tokenFile);
    const permissions = (stats.mode & 0o777).toString(8);
    console.log(`\n🔒 Token file permissions: ${permissions} (expected: 600)`);
    expect(permissions).to.equal('600');

    // Check token structure
    const content = await fs.readFile(tokenFile, 'utf-8');
    const data = JSON.parse(content);

    console.log(`\n🔍 Verifying token structure:`);
    expect(data).to.have.property('sessionId');
    expect(data).to.have.property('tokens');
    expect(data).to.have.property('user');
    expect(data.tokens).to.have.property('access_token');
    expect(data.tokens).to.have.property('refresh_token');
    expect(data.user).to.have.property('email');

    console.log(`   ✓ sessionId: ${data.sessionId}`);
    console.log(`   ✓ user: ${data.user.email}`);
    console.log(`   ✓ access_token: ${data.tokens.access_token.substring(0, 20)}...`);
    console.log(`   ✓ refresh_token: ${data.tokens.refresh_token ? 'present' : 'missing'}`);

    // Check token expiry
    const expiresAt = data.tokens.expires_at;
    const expiresIn = Math.floor((expiresAt - Date.now()) / 1000);
    console.log(`\n⏰ Token expires in: ${expiresIn} seconds (${Math.floor(expiresIn / 60)} minutes)`);
    expect(expiresAt).to.be.greaterThan(Date.now());

    console.log('\n✅ Authentication flow completed successfully!');
    console.log('✅ Filesystem token caching verified!');
    console.log('\nNext steps:');
    console.log('  - Run: auth({mode: "status"}) to see authenticated status');
    console.log('  - Run: gas_ls({scriptId: "..."}) to test API calls with cached token');
  });

  it('should explain blocking vs non-blocking auth modes', async function() {
    console.log('\n📚 Understanding auth modes:\n');

    console.log('1️⃣  Non-blocking mode (recommended for interactive use):');
    console.log('   auth({mode: "start", waitForCompletion: false})');
    console.log('   - Returns immediately with auth URL');
    console.log('   - User completes OAuth in browser');
    console.log('   - Poll auth({mode: "status"}) to check when complete');
    console.log('   - More responsive UX for CLI/interactive tools\n');

    console.log('2️⃣  Blocking mode (simpler but hangs until completion):');
    console.log('   auth({mode: "start", waitForCompletion: true})');
    console.log('   - Opens browser and waits for OAuth completion');
    console.log('   - Hangs the tool call until user completes auth');
    console.log('   - Simpler for scripts but poor UX for interactive use\n');

    console.log('3️⃣  Status check (always non-blocking):');
    console.log('   auth({mode: "status"})');
    console.log('   - Returns current authentication state');
    console.log('   - Never hangs or blocks');
    console.log('   - Use for polling during non-blocking auth\n');

    console.log('💡 Recommendation for tests:');
    console.log('   - Use waitForCompletion: false in automated tests');
    console.log('   - Poll status to detect when auth completes');
    console.log('   - Provides better test output and control');

    this.skip(); // This is informational only
  });
});
