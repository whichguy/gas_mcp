# Authentication Testing Patterns

## Overview

The MCP GAS server supports two authentication modes, each with different trade-offs for testing and interactive use.

## Authentication Modes

### 1. Non-Blocking Mode (Recommended for Tests)

```typescript
// Start auth flow without waiting
const result = await gas_auth({
  mode: "start",
  waitForCompletion: false  // Returns immediately
});

// Result contains auth URL
console.log(result.authUrl);  // User opens this in browser

// Poll for completion
while (true) {
  const status = await gas_auth({mode: "status"});
  if (status.authenticated) {
    break;
  }
  await sleep(1000);
}
```

**Advantages:**
- ✅ Doesn't block test execution
- ✅ Better test output (can show progress)
- ✅ Can implement timeout logic
- ✅ More control over flow

**Disadvantages:**
- ❌ Requires polling logic
- ❌ More complex code

### 2. Blocking Mode (Simpler but Hangs)

```typescript
// Start auth and wait for completion
const result = await gas_auth({
  mode: "start",
  waitForCompletion: true  // Hangs until OAuth completes
});

// Result contains authenticated session
console.log(result.user.email);
```

**Advantages:**
- ✅ Simpler code (single call)
- ✅ No polling needed

**Disadvantages:**
- ❌ Hangs the tool call for entire OAuth flow
- ❌ No progress feedback
- ❌ Hard to implement timeouts
- ❌ Poor UX in interactive tools

## Testing Patterns

### Pattern 1: Skip if Not Authenticated (Recommended)

```typescript
it('should test authenticated operation', async function() {
  const status = await gas_auth({mode: "status"});

  if (!status.authenticated) {
    console.log('⏭️  Skipping - authentication required');
    console.log('Run: gas_auth({mode: "start"}) first');
    this.skip();
    return;
  }

  // Proceed with test
  const result = await gas_ls({scriptId: "..."});
  expect(result).to.have.property('items');
});
```

**When to Use:**
- Integration tests in CI/CD (pre-authenticated)
- Tests that require existing auth
- Tests run in Claude Code MCP session

### Pattern 2: Poll for Authentication

```typescript
it('should wait for authentication', async function() {
  this.timeout(120000); // 2 minutes

  // Check if already authenticated
  let status = await gas_auth({mode: "status"});

  if (!status.authenticated) {
    console.log('Starting auth flow...');
    await gas_auth({mode: "start", waitForCompletion: false});

    // Poll until authenticated
    for (let i = 0; i < 120; i++) {
      await sleep(1000);
      status = await gas_auth({mode: "status"});
      if (status.authenticated) break;
    }
  }

  expect(status.authenticated).to.be.true;
});
```

**When to Use:**
- Tests that can initiate auth
- Automated test suites with manual OAuth step
- Tests that verify auth flow itself

### Pattern 3: Verify Filesystem Cache (No MCP Server)

```typescript
it('should have valid token cache', async function() {
  const tokenDir = path.join(process.cwd(), '.auth', 'tokens');
  const files = await fs.readdir(tokenDir);
  const tokenFiles = files.filter(f => f.endsWith('.json'));

  if (tokenFiles.length === 0) {
    console.log('No tokens found - authenticate first');
    this.skip();
    return;
  }

  const tokenFile = path.join(tokenDir, tokenFiles[0]);
  const stats = await fs.stat(tokenFile);
  const permissions = (stats.mode & 0o777).toString(8);

  expect(permissions).to.equal('600');
});
```

**When to Use:**
- Verify filesystem token cache implementation
- Security testing (file permissions)
- Tests that don't need MCP server running

## Claude Code MCP Session Testing

When testing in Claude Code's MCP session, the MCP server is already running. Tests should:

1. **Use MCP tools directly** (not spawn new server)
2. **Check auth status first** before attempting operations
3. **Skip gracefully** if authentication not available
4. **Provide clear instructions** for manual authentication

Example:

```typescript
describe('MCP Session Tests', () => {
  it('should list projects with cached token', async function() {
    // This runs in Claude Code's existing MCP session
    const status = await gas_auth({mode: "status"});

    if (!status.authenticated) {
      console.log('To run this test:');
      console.log('1. In Claude Code: gas_auth({mode: "start"})');
      console.log('2. Complete OAuth in browser');
      console.log('3. Re-run test');
      this.skip();
      return;
    }

    const result = await gas_project_list();
    expect(result).to.have.property('projects');
  });
});
```

## Best Practices

### ✅ DO:
- Use `waitForCompletion: false` for better test control
- Implement proper timeout logic
- Provide clear skip messages
- Verify filesystem token cache separately
- Use status checks before authenticated operations

### ❌ DON'T:
- Don't spawn MCP server in tests run from Claude Code
- Don't use `waitForCompletion: true` in automated tests
- Don't assume authentication is available
- Don't fail tests when auth is missing - skip instead

## Example Test Suite

See:
- `test/integration/auth/filesystem-token-verification.test.ts` - Filesystem cache verification
- `test/integration/auth/auth-flow-with-polling.test.ts` - Polling pattern example
- `test/integration/auth/auth-and-list-projects.test.ts` - Skip-if-not-authenticated pattern

## Filesystem Token Caching

The server stores tokens at: `process.cwd()/.auth/tokens/`

**Directory permissions:** `700` (drwx------)
**File permissions:** `600` (-rw-------)

Token files are named: `{email}.json`

Example: `jim@fortifiedstrength.org.json`

Structure:
```json
{
  "sessionId": "uuid",
  "tokens": {
    "access_token": "ya29...",
    "refresh_token": "1//...",
    "expires_at": 1234567890,
    "token_type": "Bearer",
    "scope": "..."
  },
  "user": {
    "email": "user@example.com",
    "name": "User Name",
    "id": "123456789"
  },
  "createdAt": 1234567890,
  "lastUsed": 1234567890
}
```

Tokens are automatically refreshed when expired using the refresh_token.
