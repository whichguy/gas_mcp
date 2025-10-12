# MCP Gas Server - Tool Argument Validation Tests

This directory contains comprehensive integration tests for validating argument handling across all MCP Gas Server tools.

## Test Philosophy

These tests validate the **logical functionality and argument validation** of MCP tools by:
- Calling tools through the MCP protocol (real integration testing)
- Testing valid arguments, invalid arguments, boundary conditions, and edge cases
- Ensuring proper error messages and type validation
- Verifying required vs optional parameter handling

## Test Files

### `comprehensive-arguments.test.ts` (RECOMMENDED - Performance Optimized)
**Coverage**: 30+ tools across 9 categories
**Strategy**: Single shared project for ALL tests
**Runtime**: ~5 minutes
**Tools Covered**:
- Git Sync (3 tools): git_init, local_sync, config (sync_folder get/set)
- Deployment (8 tools): deploy_create, version_create, deploy_list, deploy_get_details, etc.
- Project Context (4 tools): project_set, project_list, project_add, project_get
- Versions (2 tools): version_list, version_get
- Processes (1 tool): process_list (supports scriptId filter)
- Logs (2 tools): logs_list, logs_get
- Triggers (3 tools): trigger_list, trigger_create, trigger_delete
- Local Sync (3 tools): pull, push, status
- Advanced Analysis (4 tools): context, summary, deps, tree
- Project Info (3 tools): info, project_metrics, reorder

**Performance Benefits**:
- Creates ONE project in `before` hook
- Reuses project across ALL 100+ test cases
- 4x faster than per-test project creation

### `auth-arguments.test.ts`
**Coverage**: Authentication tool (1 tool)
**Strategy**: Standalone (no project needed)
**Runtime**: ~30 seconds
**Tools Covered**: auth (all modes: status, start, logout, callback)

### `file-operation-arguments.test.ts`
**Coverage**: Core file operations (4 tools)
**Strategy**: Fresh project per test (legacy approach)
**Runtime**: ~5 minutes
**Tools Covered**: write, cat, ls, rm

**Note**: This file uses `beforeEach` to create fresh projects for isolation. Consider migrating to shared project pattern for better performance.

### `execution-arguments.test.ts`
**Coverage**: Code execution tools (2 tools)
**Strategy**: Fresh project per test (legacy approach)
**Runtime**: ~5 minutes
**Tools Covered**: run, exec

**Note**: This file uses `beforeEach` to create fresh projects. Consider migrating to shared project pattern.

### `search-arguments.test.ts`
**Coverage**: Search and text processing tools (4 tools)
**Strategy**: Fresh project per test (legacy approach)
**Runtime**: ~5 minutes
**Tools Covered**: grep, ripgrep, find, sed

**Note**: This file uses `beforeEach` to create fresh projects. Consider migrating to shared project pattern.

## Running Tests

### Run All Tool Argument Tests
```bash
npm run test:integration -- test/integration/tool-arguments/**/*.test.ts
```

### Run Specific Test File
```bash
# Comprehensive tests (recommended - fastest)
npx mocha test/integration/tool-arguments/comprehensive-arguments.test.ts --timeout 300000

# Auth tests
npx mocha test/integration/tool-arguments/auth-arguments.test.ts --timeout 30000

# File operation tests
npx mocha test/integration/tool-arguments/file-operation-arguments.test.ts --timeout 300000
```

### Run Individual Test Suites
```bash
# Run only Git Sync tests
npx mocha test/integration/tool-arguments/comprehensive-arguments.test.ts --grep "Git Sync"

# Run only Deployment tests
npx mocha test/integration/tool-arguments/comprehensive-arguments.test.ts --grep "Deployment Tools"
```

## Test Coverage Summary

| Category | Tools Covered | Test File | Runtime |
|----------|---------------|-----------|---------|
| Auth | 1 | auth-arguments.test.ts | 30s |
| File Operations | 4 | file-operation-arguments.test.ts | 5min |
| Execution | 2 | execution-arguments.test.ts | 5min |
| Search Tools | 4 | search-arguments.test.ts | 5min |
| Git Sync | 3 | comprehensive-arguments.test.ts | ~1min |
| Deployment | 8 | comprehensive-arguments.test.ts | ~1min |
| Project Context | 4 | comprehensive-arguments.test.ts | ~30s |
| Versions | 2 | comprehensive-arguments.test.ts | ~30s |
| Processes | 1 | comprehensive-arguments.test.ts | ~30s |
| Logs | 2 | comprehensive-arguments.test.ts | ~30s |
| Triggers | 3 | comprehensive-arguments.test.ts | ~30s |
| Local Sync | 3 | comprehensive-arguments.test.ts | ~30s |
| Advanced Analysis | 4 | comprehensive-arguments.test.ts | ~30s |
| Project Info | 3 | comprehensive-arguments.test.ts | ~30s |
| **TOTAL** | **47 tools** | **5 files** | **~25min** |

## Test Patterns

### Shared Project Pattern (Recommended)
Used in `comprehensive-arguments.test.ts`:
```typescript
describe('Tool Category', function() {
  let sharedProjectId: string;

  before(async function() {
    // Create ONE project for ALL tests in this suite
    const result = await context.client.callAndParse('project_create', {...});
    sharedProjectId = result.scriptId;
  });

  it('test case 1', async function() {
    // Reuse sharedProjectId
  });

  it('test case 2', async function() {
    // Reuse sharedProjectId
  });
});
```

**Benefits**:
- ✅ 4x faster execution
- ✅ Fewer API calls
- ✅ Simpler cleanup
- ✅ Better for CI/CD

### Per-Test Project Pattern (Legacy)
Used in `file-operation-arguments.test.ts`, `execution-arguments.test.ts`, `search-arguments.test.ts`:
```typescript
describe('Tool Category', function() {
  let testProjectId: string | null = null;

  beforeEach(async function() {
    // Create fresh project for EACH test
    const result = await context.client.callAndParse('project_create', {...});
    testProjectId = result.scriptId;
  });

  it('test case 1', async function() {
    // Use testProjectId
  });

  it('test case 2', async function() {
    // NEW project created
  });
});
```

**Trade-offs**:
- ✅ Perfect isolation between tests
- ❌ 4x slower execution
- ❌ More API quota usage
- ❌ Harder to debug

## Authentication Requirements

Most tests require **real Google OAuth authentication**:
- Tests call actual MCP server with real Google Apps Script API
- Uses global authentication from `test/setup/globalAuth.ts`
- First run will prompt for browser-based OAuth flow
- Subsequent runs use cached tokens from `.auth/` directory

### Running Without Authentication
Some tests can run without auth:
```bash
# Only auth tool tests work without authentication
npx mocha test/integration/tool-arguments/auth-arguments.test.ts
```

## Test Data Setup

All test files use **own test data setup** with:
- Fresh project creation using unique names with timestamps
- Upload of test files with sample code
- Automatic cleanup via `context.cleanup()` in `after` hook

Example test data pattern:
```typescript
before(async function() {
  // Create test project
  const result = await context.client.callAndParse('project_create', {
    title: `TEST_Category_${context.testId}_${Date.now()}`,
    localName: `test-category-${context.testId}-${Date.now()}`
  });
  sharedProjectId = result.scriptId;

  // Upload test files
  await context.client.callAndParse('write', {
    scriptId: sharedProjectId,
    path: 'main',
    content: 'function doGet() { return "test"; }'
  });
});
```

## Missing Coverage

Tools not yet covered (20 remaining):
- Drive Integration: find_drive_script, bind_script, create_script
- Raw Tools: raw_cat, raw_write, raw_grep, raw_sed, raw_find, raw_edit, raw_aider, raw_ripgrep, raw_cp
- Advanced Tools: edit, aider, mkdir, proxy_setup, exec_api
- Sheets: sheet_sql

**To add coverage**: Add test suites to `comprehensive-arguments.test.ts` using the shared project pattern.

## Performance Optimization Tips

1. **Use Shared Projects**: Create one project per test suite, not per test
2. **Minimize API Calls**: Reuse test data across tests when possible
3. **Parallel Test Files**: Run different test files in parallel (Mocha default)
4. **Skip Slow Tests Locally**: Use `.skip()` for tests you're not working on

## Contribution Guidelines

When adding new tests:
1. ✅ **Add to comprehensive-arguments.test.ts** for best performance
2. ✅ **Use shared project pattern** (create in `before`, reuse in tests)
3. ✅ **Test all parameter variations**: required, optional, types, enums, boundaries
4. ✅ **Use ArgumentTestHelper**: `expectSuccess()`, `expectError()` utilities
5. ✅ **Follow naming convention**: `gas_tool_name` format
6. ✅ **Document expected behavior**: Add comments for edge cases

Example:
```typescript
describe('gas_new_tool', function() {
  it('should accept minimal required arguments', async function() {
    const result = await ArgumentTestHelper.expectSuccess(
      context.client,
      'new_tool',
      { scriptId: sharedProjectId, requiredParam: 'value' },
      'minimal new_tool arguments'
    );
    expect(result).to.have.property('expectedField');
  });

  it('should reject missing requiredParam', async function() {
    await ArgumentTestHelper.expectError(
      context.client,
      'new_tool',
      { scriptId: sharedProjectId },
      /requiredParam|required/i,
      'requiredParam is required'
    );
  });
});
```
