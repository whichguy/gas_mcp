# Test Setup Guide

## Simple Test Pattern

### Unit Tests (No Auth)
Unit tests run without authentication and test pure logic:

```bash
npm run test:unit
```

**No setup needed** - just write your tests.

### Integration Tests (With Auth)
Integration tests need authentication. Add explicit setup in your test file:

```typescript
import { setupIntegrationTest, globalAuthState } from '../../setup/integrationSetup.js';

describe('My Integration Test', () => {
  let client: MCPTestClient;

  before(async function() {
    this.timeout(130000); // Allow time for OAuth if needed

    // This triggers auth ONCE for all test files
    await setupIntegrationTest();

    if (!globalAuthState.isAuthenticated) {
      this.skip();
    }

    client = globalAuthState.client;
  });

  it('should do something', async () => {
    // Your test here
  });
});
```

## How Auth Works

1. **First test file** that calls `setupIntegrationTest()`:
   - Checks for cached token in `.sessions/`
   - If no valid token, opens browser for OAuth
   - Saves token for reuse

2. **All other test files** that call `setupIntegrationTest()`:
   - Reuse the same authenticated session
   - No additional browser windows
   - Fast execution

## Key Points

- ✅ **One OAuth flow** for entire test suite
- ✅ **Explicit setup** in each test file (clearer than mocha config)
- ✅ **Token caching** in `.sessions/` directory
- ✅ **Unit tests** never trigger auth

## Troubleshooting

**Problem**: Multiple auth windows open
**Solution**: Fixed - singleton pattern ensures one auth flow

**Problem**: "Authentication failed"
**Solution**: Delete `.sessions/` directory and re-run

**Problem**: Tests skip immediately
**Solution**: Run integration tests explicitly: `npm run test:integration`
