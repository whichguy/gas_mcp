# MCP Gas Test Suite

## 📁 Test Organization

The test suite is organized into clear categories for better maintainability and navigation:

### 🧪 Unit Tests (`test/unit/`)
Fast, isolated tests for individual components:
- **api/**: API layer components (pathParser, rateLimiter)  
- **auth/**: Authentication logic (authState)
- **errors/**: Error handling (mcpErrors)
- **tools/**: Individual MCP tools (auth tool)
- **utils/**: Utility functions and classes

### 🔗 Integration Tests (`test/integration/`)
Tests that interact with real Google Apps Script APIs:
- **auth/**: OAuth integration tests
- **filesystem/**: File operation integration tests  
- **execution/**: Code execution integration tests
- **git/**: Git sync integration tests
- **end-to-end/**: Complete workflow tests

### 🌐 System Tests (`test/system/`)
MCP protocol and server-level tests:
- **connection/**: Server connection tests
- **protocol/**: MCP protocol compliance
- **auth/**: System-level authentication tests

### 🛡️ Security Tests (`test/security/`)
Security-focused validation tests:
- Path validation and traversal prevention
- Input sanitization tests
- Authentication security tests

### ⚡ Performance Tests (`test/performance/`)
Performance and load testing:
- Rate limiting behavior
- Large batch operations  
- Memory usage tests

### ✅ Verification Scripts (`test/verification/`)
Standalone verification scripts:
- `auth.cjs` - Authentication flow verification
- `execution.cjs` - Code execution verification  
- `file-ops.cjs` - File operations verification
- `git-sync.cjs` - Git sync verification
- `mcp-server.cjs` - MCP server verification
- `project-mgmt.cjs` - Project management verification
- `run-all.cjs` - Run all verification scripts

### 📦 Test Infrastructure

#### `test/helpers/`
Centralized test utilities:
- `index.ts` - Main export file for all helpers
- `mcpClient.ts` - MCP client test helpers
- `mcpTestHelpers.ts` - MCP-specific test utilities  
- `mcpGasTestHelpers.ts` - GAS-specific test utilities
- `assertions.ts` - Custom test assertions
- `testFactory.ts` - Test data factories
- `testResourceManager.ts` - Resource cleanup and management

#### `test/fixtures/`
Test data and configuration:
- `mock-projects/` - Mock GAS project data
- `sample-code/` - Sample code files for testing
- `test-configs/` - Test configuration files

#### `test/setup/`
Global test setup and configuration:
- `globalAuth.ts` - Global authentication state
- `setup.ts` - Global test setup/teardown

#### `test/docs/`
Test documentation:
- `README.md` - This file
- `system-tests.md` - System test documentation
- `integration-test-plan.md` - Integration test planning

## 🚀 Running Tests

### Quick Commands
```bash
# Run all tests
npm test

# Run only unit tests (fast)
npm run test:unit

# Run integration tests (requires auth)
npm run test:integration

# Run all verification scripts
node test/verification/run-all.cjs
```

### Category-Specific Commands
```bash
# Unit tests
npx mocha 'test/unit/**/*.test.ts' --timeout 10000

# Integration tests
npx mocha 'test/integration/**/*.test.ts' --timeout 60000

# System tests  
npx mocha 'test/system/**/*.test.ts' --timeout 30000

# Security tests
npx mocha 'test/security/**/*.test.ts' --timeout 15000
```

### Individual Test Files
```bash
# Specific test file
npx mocha test/unit/api/pathParser.test.ts

# With debugging
DEBUG=mcp:* npx mocha test/integration/auth/oauth-credentials.test.ts
```

## 🔧 Test Configuration

### Environment Variables
- `DEBUG=mcp:*` - Enable debug logging
- `TEST_TIMEOUT=30000` - Set test timeout (milliseconds)
- `SKIP_AUTH_TESTS=true` - Skip tests requiring authentication
- `USE_REAL_API=true` - Use real GAS APIs instead of mocks

### Authentication Requirements
- **Unit tests**: No authentication required
- **Integration tests**: Require OAuth setup with real Google account
- **System tests**: May require authentication for full functionality
- **Verification scripts**: Most require authentication

## 📊 Test Patterns

### Import Pattern
```typescript
// Use centralized helpers
import { MCPTestClient, AuthTestHelper, GASTestHelper } from '../../helpers/index.js';

// Global auth state
import { globalAuthState } from '../../setup/globalAuth.js';
```

### Test Structure Pattern
```typescript
describe('Feature Tests', () => {
  let client: MCPTestClient;
  let helper: GASTestHelper;

  before(async function() {
    // Setup - use global auth when available
    if (globalAuthState.isAuthenticated) {
      client = globalAuthState.client!;
      helper = new GASTestHelper(client);
    } else {
      this.skip(); // Skip if no auth available
    }
  });

  after(async () => {
    // Cleanup test resources
    await helper.cleanup();
  });

  it('should test specific functionality', async () => {
    // Test implementation
  });
});
```

## 🧹 Maintenance

### Adding New Tests
1. Choose appropriate category (unit/integration/system/security)
2. Use centralized helpers from `test/helpers/`
3. Follow existing patterns for setup/teardown
4. Update this README if adding new categories

### Test Data Management
- Use `test/fixtures/` for reusable test data
- Use `testFactory.ts` for generating test data programmatically
- Clean up resources in `after()` hooks

### Debugging Tests
- Use `DEBUG=mcp:*` for MCP protocol debugging
- Use `this.timeout(60000)` for longer operations
- Check `test/verification/` scripts for manual verification

This organization provides clear separation of concerns while maintaining easy access to shared utilities and fixtures.