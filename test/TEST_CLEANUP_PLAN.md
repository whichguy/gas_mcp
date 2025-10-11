# Test Cleanup Plan - Deployment Tool Consolidation

**Date:** 2025-01-10
**Status:** In Progress
**Purpose:** Clean up test references to removed deployment tools after consolidation

## Removed Tools

The following 8 low-level deployment tools were removed and consolidated into a single `deploy` tool:

1. `gas_version_create` - Create version snapshot
2. `gas_version_list` - List versions
3. `gas_version_get` - Get version details
4. `gas_deploy_create` - Create deployment
5. `gas_deploy_list` - List deployments
6. `gas_deploy_get_details` - Get deployment details
7. `gas_deploy_delete` - Delete deployment
8. `gas_deploy_update` - Update deployment

**Replacement:** Single `deploy` tool with operations: `promote`, `rollback`, `status`, `reset`

---

## Test Files Requiring Updates

### 1. ✅ testTimeouts.ts (COMPLETED)
**File:** `test/integration/mcp-gas-validation/testTimeouts.ts`
**Status:** Already updated by linter
**Change:** Line 40 - Updated comment from `gas_version_create, gas_deploy_create` to `deploy`

### 2. ✅ consolidated-core.test.ts (COMPLETED)
**File:** `test/system/protocol/consolidated-core.test.ts`
**Status:** Already updated
**Change:** Line 52 - Tool list already shows `deploy` instead of old tools

### 3. ❌ comprehensive-arguments.test.ts (NEEDS REMOVAL)
**File:** `test/integration/tool-arguments/comprehensive-arguments.test.ts`
**Lines:** 148-347 (approx 200 lines)
**Action:** **DELETE** 6 test suites for removed tools

Test suites to remove:
- Line 148: `describe('gas_deploy_create', ...)`
- Line 192: `describe('gas_version_create', ...)`
- Line 220: `describe('gas_deploy_list', ...)`
- Line 233: `describe('gas_deploy_get_details', ...)`
- Line 288: `describe('gas_version_list', ...)`
- Line 328: `describe('gas_version_get', ...)`

**Rationale:** These tools no longer exist. The new `deploy` tool needs its own comprehensive argument validation tests designed for its operation-based interface.

**Future Work:** Create new test suite for `deploy` tool argument validation covering:
- `operation` enum validation (promote/rollback/status/reset)
- `environment` enum validation (staging/prod)
- Required parameters per operation
- Version number validation for rollback

### 4. ❌ gasOperations.test.ts (NEEDS UPDATE)
**File:** `test/integration/filesystem/gasOperations.test.ts`
**Action:** Update tool list reference
**Details:** Contains list of "required tools" that includes old deployment tools

### 5. ❌ comprehensive-workflow.test.ts (NEEDS UPDATE)
**File:** `test/integration/end-to-end/comprehensive-workflow.test.ts`
**References:** 2 calls to old tools
**Action:** Replace with new `deploy` tool calls

Example transformation:
```javascript
// OLD:
await client.callAndParse('gas_version_create', {
  scriptId,
  description: 'v1.0'
});
await client.callAndParse('gas_deploy_create', {
  scriptId,
  versionNumber: 1
});

// NEW:
await client.callAndParse('deploy', {
  scriptId,
  operation: 'promote',
  environment: 'staging',
  description: 'v1.0'
});
await client.callAndParse('deploy', {
  scriptId,
  operation: 'promote',
  environment: 'prod'
});
```

### 6. ❌ real-gas-integration.test.ts (NEEDS UPDATE)
**File:** `test/integration/end-to-end/real-gas-integration.test.ts`
**References:** 7 calls to old tools (most references in codebase)
**Action:** Replace with new `deploy` tool calls
**Details:** Multiple test scenarios using version_create and deploy_create

### 7. ❌ testProjectFactory.ts (NEEDS UPDATE)
**File:** `test/fixtures/mock-projects/testProjectFactory.ts`
**References:** 2 calls in test project setup
**Action:** Update factory methods to use new `deploy` tool
**Details:** Test helper methods that create versioned projects

### 8. ❌ TEST-SUITE-ORGANIZATION.md (NEEDS UPDATE)
**File:** `test/integration/mcp-gas-validation/TEST-SUITE-ORGANIZATION.md`
**Action:** Update deployment test documentation
**Details:** Document how deployment tests now work with unified tool

---

## Recommended Approach

### Phase 1: Documentation (COMPLETED ✅)
- [x] Update CLAUDE.md
- [x] Update README.md
- [x] Create this cleanup plan

### Phase 2: Remove Obsolete Tests
1. Delete 6 test suites from `comprehensive-arguments.test.ts` (~200 lines)
2. Run tests to confirm no syntax errors

### Phase 3: Update Test Helper (testProjectFactory.ts)
1. Update factory methods to use new `deploy` tool
2. This will make Phase 4-5 easier

### Phase 4: Update Integration Tests
1. Update `gasOperations.test.ts` (simple tool list update)
2. Update `comprehensive-workflow.test.ts` (2 transformations)
3. Update `real-gas-integration.test.ts` (7 transformations - most complex)

### Phase 5: Update Documentation
1. Update `TEST-SUITE-ORGANIZATION.md` with new deployment testing approach

### Phase 6: Verification
1. Run full test suite: `npm run test:unit && npm run test:system`
2. Run integration tests (if authenticated): `npm run test:integration`
3. Verify deployment tests pass

### Phase 7: New Tests (Future)
Create comprehensive tests for new `deploy` tool:
1. Argument validation tests (operation, environment, parameters)
2. Workflow tests (promote dev→staging→prod)
3. Rollback tests (staging and prod)
4. Status tests (3-environment view)
5. Reset tests (transactional deployment recreation)

---

## Test Execution Strategy

After cleanup, run tests in this order:

```bash
# 1. Unit tests (fastest, no auth needed)
npm run test:unit

# 2. Core system tests (protocol validation)
npm test

# 3. Integration tests (requires auth, slowest)
npm run test:integration
```

---

## Current Test Failures

Before cleanup: **53 failing tests out of 240 total**

Many failures are likely due to:
1. References to removed deployment tools
2. Other unrelated issues (regex, URL parsing, etc.)

After cleanup, expect:
- Fewer failures from removed tool references
- Remaining failures will be unrelated issues that need separate attention

---

## Notes

- The new `deploy` tool has a cleaner, more intuitive interface
- Operations are atomic and environment-aware
- Version tagging is automatic ([DEV], [STAGING], [PROD])
- Rollback is safer (finds previous tagged version automatically)
- Reset operation is transactional (creates new before deleting old)

## Status

- ✅ Phase 1 completed (documentation)
- ⏳ Phase 2-6 pending (requires test updates and verification)
- 📅 Phase 7 is future work (new comprehensive test suite for deploy tool)
