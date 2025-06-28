# System Tests Documentation

## Overview

This directory contains comprehensive system tests that create real Google Apps Script projects and test the full MCP Gas Server functionality. These tests provide extensive coverage of project creation, file operations, function execution, and deployment scenarios.

## Test Structure

### Core Test Infrastructure

- **`mcpClient.ts`** - MCP test client with authentication helpers
- **`../utils/mcpGasTestHelpers.ts`** - Test helpers optimized for OAuth port 3000 constraint
- **`../utils/testProjectFactory.ts`** - Template-based GAS project factory (NEW)
- **`../utils/testResourceManager.ts`** - Resource allocation and cleanup

### System Test Suites

#### 1. **Basic System Tests**
- `comprehensive-workflow.test.ts` - End-to-end workflow validation
- `gasOperations.test.ts` - Core GAS operations testing
- `gas-run-integration.test.ts` - Code execution testing

#### 2. **Advanced Project Scenarios** (NEW)
- `advanced-project-scenarios.test.ts` - Template-based project testing
  - Mathematical operations projects
  - Data processing projects  
  - Web app projects with HTML interfaces
  - Cross-project file operations
  - Deployment lifecycle testing

#### 3. **Specialized Tests**
- `doget-proxy.test.ts` - Web app proxy functionality
- `gas-run-proxy-live.test.ts` - Live proxy testing
- `authentication.test.ts` - OAuth flow testing

## New Template-Based Testing

### TestProjectFactory Usage

The `TestProjectFactory` provides structured templates for creating realistic test projects:

```typescript
import { TestProjectFactory } from '../utils/testProjectFactory.js';
import { MCPGasTestHelper } from '../utils/mcpGasTestHelpers.js';

// Create test context
const context = await MCPGasTestHelper.createTestContext({
  testName: 'My Test'
});

// Create mathematical operations project
const mathTemplate = TestProjectFactory.createMathOperationsProject();
const { projectId, deploymentId } = await TestProjectFactory.createAndDeployProject(context, mathTemplate);

// Run template test cases
const results = await TestProjectFactory.runProjectTests(context, projectId, mathTemplate);

// Cleanup is automatic via context.cleanup()
```

### Available Project Templates

#### 1. Mathematical Operations Project
- **Functions**: `add`, `multiply`, `fibonacci`, `factorial`, `isPrime`
- **Test Cases**: Comprehensive mathematical validations
- **Deployment**: WEB_APP type with web interface

#### 2. Data Processing Project  
- **Functions**: `processArray`, `transformObject`, `parseAndValidateJSON`
- **Test Cases**: Array processing, object transformation, JSON validation
- **Deployment**: EXECUTION_API for programmatic access

#### 3. Web App Project
- **Functions**: `doGet`, `doPost`, `handleAPIRequest`, `processWebAppData`
- **Files**: Includes HTML interface with JavaScript
- **Test Cases**: Web app data processing and API generation
- **Deployment**: WEB_APP with full web interface

## Running System Tests

### Prerequisites

1. **Authentication Required**: Most system tests require Google OAuth authentication
2. **Shared Server**: Tests use shared MCP server instance (port 3000 constraint)
3. **Cleanup**: Automatic resource cleanup prevents test pollution

### Test Execution

```bash
# Run all system tests
npm test -- test/system/

# Run specific test suite  
npm test -- test/system/advanced-project-scenarios.test.ts

# Run with authentication
npm test -- test/system/comprehensive-workflow.test.ts

# Run infrastructure tests only (no auth required)
npm test -- test/system/gasOperations.test.ts --grep "infrastructure"
```

### Test Configuration

Tests automatically handle:
- **Authentication Detection**: Skip or run based on auth availability
- **Resource Tracking**: Automatic cleanup of created projects and files
- **Error Handling**: Graceful handling of API failures
- **Timeout Management**: Extended timeouts for real API operations

## Test Categories

### 1. Infrastructure Tests (Fast)
- **No Authentication Required**
- **Quick Execution** (~5-10 seconds)
- Test tool availability, error handling, server health

### 2. Integration Tests (Medium)
- **Authentication Recommended**
- **Moderate Execution** (~30-60 seconds)
- Test project operations, file management, basic execution

### 3. Full Workflow Tests (Slow)
- **Authentication Required**
- **Extended Execution** (~2-5 minutes)
- Test complete project lifecycle including deployment

## Best Practices

### Test Isolation
```typescript
// ✅ CORRECT: Use test context for isolation
const context = await MCPGasTestHelper.createTestContext({
  testName: this.test?.title
});

try {
  // Test operations
} finally {
  await context.cleanup(); // Automatic resource cleanup
}
```

### Authentication Handling
```typescript
// ✅ CORRECT: Check authentication and skip gracefully
if (!context.authenticated) {
  console.log('⏭️  Skipping - authentication required');
  this.skip();
  return;
}
```

### Error Handling
```typescript
// ✅ CORRECT: Handle expected failures gracefully
try {
  const result = await context.client.callAndParse('gas_run', {...});
  // Validate result
} catch (error: any) {
  console.log('⚠️  Expected failure:', error.message);
  // Continue with test or skip
}
```

## Resource Management

### Automatic Cleanup
- **Project Deletion**: Test projects are automatically cleaned up
- **File Removal**: Created files are tracked and removed
- **Port Management**: Shared server prevents port conflicts
- **Memory Management**: Resources are released after each test

### Manual Cleanup
```typescript
// Emergency cleanup if needed
await MCPGasTestHelper.emergencyCleanup();
```

## Debugging System Tests

### Verbose Logging
Tests include comprehensive logging:
- **🚀** Test start indicators
- **✅** Success confirmations  
- **⚠️** Warning messages
- **❌** Error details
- **📋** Step-by-step progress

### Common Issues

1. **Authentication Timeouts**
   - Solution: Use `gas_auth(mode="start")` manually before tests

2. **Project Creation Failures**
   - Solution: Check Google Drive permissions and quotas

3. **Function Execution Delays**
   - Solution: Tests include retry logic and extended timeouts

4. **Deployment Permissions**
   - Solution: Some deployment tests may fail due to API restrictions

## Contributing

When adding new system tests:

1. **Use TestProjectFactory** for structured project creation
2. **Follow Test Context Pattern** for proper isolation
3. **Include Authentication Checks** and graceful skipping
4. **Add Comprehensive Logging** for debugging
5. **Handle Expected Failures** in real API environments
6. **Test Resource Cleanup** to prevent pollution

## Example Test Structure

```typescript
describe('My New System Test', () => {
  let context: GasTestContext;

  before(async function() {
    this.timeout(30000);
    context = await MCPGasTestHelper.createTestContext({
      testName: 'My New System Test'
    });
  });

  after(async () => {
    if (context) {
      await context.cleanup();
    }
  });

  it('should test specific functionality', async function() {
    this.timeout(120000);

    if (!context.authenticated) {
      this.skip();
      return;
    }

    // Create test project using template
    const template = TestProjectFactory.createMathOperationsProject();
    const { projectId } = await TestProjectFactory.createAndDeployProject(context, template);

    // Test operations
    const result = await context.client.callAndParse('gas_run', {
      scriptId: projectId,
      js_statement: 'add(2, 3)'
    });

    expect(result.response?.result).to.equal(5);
  });
});
```

This structure ensures reliable, maintainable system tests that provide comprehensive coverage of real Google Apps Script functionality. 