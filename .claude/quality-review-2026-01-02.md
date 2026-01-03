# Quality Developer Review: local_sync Remediation Plan
**Date**: 2026-01-02
**Reviewer Role**: Quality Developer (Test Coverage, Edge Cases, Acceptance Criteria)
**Subject**: Evaluation of proposed fixes for 6 issues in `gitSync.ts` (~1,481 lines)

---

## EXECUTIVE SUMMARY

**VERDICT: NO_GO - PLAN REQUIRES SIGNIFICANT REDESIGN**

The remediation plan addresses correctness symptoms but introduces new systemic issues and fails to establish clear acceptance criteria. Proposed tests will produce false positives because the underlying merge path remains incomplete. Test coverage metrics are ambiguous, and critical edge cases are missing entirely.

**Key Problems**:
1. Test plan doesn't verify merge is actually called in poly-repo mode
2. Test assertions are vague ("should detect conflicts" lacks verification mechanism)
3. Test isolation not defined (tests may interfere with each other)
4. Acceptance criteria missing for key fixes
5. No baseline coverage before/after comparison

---

## QUALITY FINDINGS

### FINDING: Poly-repo Merge Path Not Testable
**SEVERITY**: CRITICAL
**CATEGORY**: Test Design / Feature Completeness
**ISSUE**:
The proposed test "should honor merge strategy in multi-repo mode" cannot pass because the underlying `runGitOperations()` function (lines 356-416) doesn't call `mergeWithLocal()` at all. Tests will:
- Mock git operations successfully
- Report "PASS" despite merge never being invoked
- Create false confidence in poly-repo merge functionality

**Code Evidence** (gitSync.ts lines 400-410):
```typescript
if (autoCommit) {
  try {
    await execFileAsync('git', ['add', '-A'], { cwd: syncFolder });
    await execFileAsync('git', ['commit', '-m', 'Merged changes from GAS']);
    // ❌ NO mergeWithLocal() CALL HERE
    console.error(`   ✅ Auto-committed changes`);
  } catch { /* ... */ }
}
```

**RECOMMENDATION**:
1. Rewrite test to inject mock that tracks if `mergeWithLocal()` was called
2. Assert on mock call count before assertion on merge result
3. Add test that forces merge failure and validates error handling
4. Rename test to "should call mergeWithLocal in multi-repo mode" (more precise)

**Test Code Example**:
```typescript
it('should call mergeWithLocal for each repo in multi-repo mode', async () => {
  // ARRANGE
  const mergeWithLocalStub = sinon.stub(syncTool, 'mergeWithLocal').resolves({
    success: true,
    merged: ['file1.js'],
    hasChanges: true
  });

  // ACT
  await local_sync({scriptId, direction: 'sync'});

  // ASSERT
  expect(mergeWithLocalStub.callCount).to.be.greaterThan(0,
    'mergeWithLocal must be called for multi-repo sync');
  mergeWithLocalStub.restore();
});
```

---

### FINDING: Conflict Marker Verification Assertions Vague
**SEVERITY**: HIGH
**CATEGORY**: Test Acceptance Criteria
**ISSUE**:
Test "should generate conflict markers in multi-repo mode" specifies:
> "Verify in correct location"
> "SubFile should be synced"

But doesn't define:
- **What constitutes a valid conflict marker?** (Standard git format `<<<<<<<`, `=======`, `>>>>>>>` ?)
- **Where should markers appear?** (At function boundary? Variable assignment?)
- **How to verify they're not corrupted?** (Check regex? Parse JSON?)

**Impact**: Test can pass with malformed markers, incomplete merges.

**RECOMMENDATION**:
Define conflict marker acceptance criteria as property-based test:
```typescript
it('should generate valid git-format conflict markers', async () => {
  // Create conflicting versions
  await gas_write({scriptId, path: 'test.js', content: 'const x = "gas"'});
  await fs.writeFile(localFile, 'const x = "local"');

  // Trigger sync
  const result = await local_sync({scriptId, mergeStrategy: 'manual'});

  // ASSERT: markers follow git standard format
  const markedContent = await fs.readFile(localFile, 'utf8');

  // Must have all three sections
  expect(markedContent).to.match(/<<<<<<<\s+HEAD/);
  expect(markedContent).to.match(/^=======/m);
  expect(markedContent).to.match(/>>>>>>>\s+[a-f0-9]{40}/);

  // Must have content from both versions
  expect(markedContent).to.include('const x = "gas"');
  expect(markedContent).to.include('const x = "local"');

  // Must not have nested markers
  const betweenMarkers = markedContent.match(/<<<<<<<[\s\S]*?=======/)[0];
  expect(betweenMarkers).to.not.match(/<<<<<<</);

  // Must be valid JavaScript (parseable with conflict markers removed)
  const cleanContent = markedContent
    .replace(/<<<<<<<.*?\n/g, '')
    .replace(/=======\n/g, '')
    .replace(/>>>>>>>.*?\n/g, '');
  expect(() => new Function(cleanContent)).to.not.throw();
});
```

---

### FINDING: Test Isolation Not Defined - Sequential Tests Can Interfere
**SEVERITY**: HIGH
**CATEGORY**: Test Architecture / Reliability
**ISSUE**:
The proposed tests (Phase 5, "Nested Git Projects") show tests running sequentially on same `testProjectId`:
- Test 5.1 creates configs at root and `libs/shared`
- Test 5.2 adds file to `libs/shared`
- Test 5.3 syncs only `libs/shared`

But doesn't specify:
1. **How are tests isolated?** (Each test gets fresh project? Shared state?)
2. **What if Test 5.1 fails?** (Does Test 5.2 see stale config?)
3. **Test order dependencies?** (Can tests run in different orders?)
4. **Cleanup between tests?** (Delete created files? Reset sync folder?)

**Impact**:
- Flaky tests (sometimes pass, sometimes fail based on order)
- Hard-to-reproduce bugs
- Test failures mask actual code bugs

**RECOMMENDATION**:
Define test isolation strategy explicitly:
```typescript
describe('Multi-Project Sync Tests', () => {
  let testProjectId: string;
  let syncFolders: Map<string, string> = new Map();

  // ISOLATION: Each test gets fresh project + sync folder
  beforeEach(async function() {
    this.timeout(120000);

    // Create new project for THIS test only
    testProjectId = await gas_project_create({
      title: `Multi-project-test-${Date.now()}`
    }).then(p => p.scriptId);

    // Create temp sync folder for THIS test
    const tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
    syncFolders.set(this.currentTest.title, tempFolder);
  });

  afterEach(async function() {
    // CLEANUP: Each test removes its resources
    const syncFolder = syncFolders.get(this.currentTest.title);
    if (syncFolder) {
      await fs.rm(syncFolder, {recursive: true, force: true});
    }
    // Don't delete GAS project - reuse for suite efficiency
  });

  it('should create nested git configs independently', async () => {
    // This test doesn't affect other tests
  });

  it('should sync specific repo independently', async () => {
    // Fresh project, fresh sync folder - isolated
  });
});
```

---

### FINDING: Branch Coverage Not Specified - Tests Check Happy Paths Only
**SEVERITY**: HIGH
**CATEGORY**: Test Completeness
**ISSUE**:
Plan states ">80% test coverage" but doesn't specify:
1. **Line coverage vs branch coverage?** (100 lines with no branches = "100% line coverage" but 50% branch coverage)
2. **Which branches matter?** (Error paths? Strategy selection logic?)
3. **Coverage baseline before/after?** (Can't verify improvement without baseline)

**Example coverage gap**: Test for "mergeStrategy: 'ours'" exists, but no test for invalid `mergeStrategy: 'invalid'` branch:
```typescript
// Current code doesn't validate strategy parameter
const mergeStrategy = params.mergeStrategy || 'merge'; // No validation!

// Test should cover invalid strategy
it('should reject invalid merge strategy', async () => {
  const result = await local_sync({
    scriptId,
    mergeStrategy: 'invalid'  // ← What happens here?
  });

  // No test for this branch!
});
```

**RECOMMENDATION**:
1. Establish baseline coverage BEFORE fixes: `npm run test:coverage -- --reporter=text-summary`
2. Require branch coverage (not just line): `nyc --reporter=lcov --check-coverage --lines=80 --branches=80`
3. Add to CI/CD gate: `fail-on-coverage-decrease.js`
4. Document coverage expectations per function:
```
gitSync.ts:
  - execute() - 85% branch (handles auth, direction, projects)
  - syncSingleRepo() - 90% branch (all strategies, errors)
  - mergeWithLocal() - 95% branch (both implementations)
  - forceWriteFiles() - 85% branch (success + backup failure)
  - filterFilesByPath() - 80% branch (root, sub-project, nested)
```

---

### FINDING: Missing Edge Case Tests - Empty/Large/Malformed Projects
**SEVERITY**: HIGH
**CATEGORY**: Test Completeness
**ISSUE**:
Proposed test suite covers happy paths but omits critical edge cases:
1. **Empty repository** - 0 files in GAS
2. **Large repository** - 1000+ files (quota limit)
3. **Malformed git config** - Invalid INI in `.git/config.gs`
4. **Symlinks in git repo** - Can cause path traversal
5. **Concurrent syncs** - Two users sync simultaneously
6. **Network failure mid-sync** - Partial state corruption
7. **Git index corruption** - Stale `.git/index` file

**Impact**: Tests pass but production fails on real-world scenarios.

**RECOMMENDATION**:
Add edge case test suite:
```typescript
describe('Edge Cases', () => {
  it('should handle empty GAS project (0 files)', async () => {
    const emptyProject = await gas_project_create({title: 'Empty'});

    const result = await local_sync({scriptId: emptyProject.scriptId});

    expect(result.success).to.equal(true);
    expect(result.filesFromGAS).to.equal(0);
    expect(result.syncFolder).to.exist;
    expect(fs.existsSync(result.syncFolder)).to.equal(true);
  });

  it('should handle large project (>500 files)', async () => {
    // Create 500 files
    for (let i = 0; i < 500; i++) {
      await gas_write({
        scriptId,
        path: `generated_${i}`,
        content: `function func_${i}() { return ${i}; }`
      });
    }

    const result = await local_sync({scriptId});

    expect(result.success).to.equal(true);
    expect(result.filesFromGAS).to.equal(500);
    // Verify no files were skipped silently
    const localFiles = (await fs.promises.readdir(syncFolder)).length;
    expect(localFiles).to.be.greaterThanOrEqual(500);
  });

  it('should handle malformed .git/config.gs gracefully', async () => {
    // Write invalid INI (unclosed section)
    await gas_write({
      scriptId,
      path: '.git/config',
      content: '[remote "origin"\nurl = https://...'  // Missing closing bracket
    });

    // Should error or skip gracefully, not crash
    try {
      await local_sync({scriptId});
      // If succeeds, at least local sync folder was created
      expect(fs.existsSync(syncFolder)).to.equal(true);
    } catch (error) {
      // If fails, error must be clear
      expect(error.message).to.include('git/config');
    }
  });

  it('should prevent path traversal attacks via projectPath', async () => {
    // Attempt traversal
    try {
      await local_sync({
        scriptId,
        projectPath: '../../../../../../etc/passwd'
      });
      // If succeeds, verify we didn't escape the GAS project
      expect(false, 'Should have rejected path traversal').to.equal(true);
    } catch (error) {
      expect(error.message).to.include('path traversal') ||
                               expect(error.message).to.include('invalid');
    }
  });

  it('should handle concurrent sync operations gracefully', async () => {
    // Start two syncs simultaneously
    const sync1 = local_sync({scriptId, direction: 'pull-only'});
    const sync2 = local_sync({scriptId, direction: 'pull-only'});

    const [result1, result2] = await Promise.allSettled([sync1, sync2]);

    // At least one should succeed
    const succeeded = [result1, result2].filter(r => r.status === 'fulfilled').length;
    expect(succeeded).to.be.greaterThanOrEqual(1);

    // If concurrent failure, should not corrupt git state
    // Verify local repo still valid
    execSync('git status', {cwd: syncFolder}); // Should not throw
  });
});
```

---

### FINDING: Acceptance Criteria Unclear - "Should Detect Conflicts" Not Measurable
**SEVERITY**: HIGH
**CATEGORY**: Acceptance Criteria
**ISSUE**:
Test specification states:
```
assert(syncResult.hasConflicts === true, 'Should detect conflicts');
assert(syncResult.conflicts.includes('Config.gs'), 'Config.gs should have conflict');
```

But plan doesn't define:
1. **What is `syncResult.conflicts` format?** (Array of filenames? Objects with details?)
2. **What counts as a "conflict"?** (Overlapping line changes? Deleted vs modified?)
3. **How deep should conflict analysis go?** (Function-level? Line-level?)
4. **Acceptance threshold?** (Detect 100% of conflicts? 95%?)

**Impact**: Test can pass with incomplete conflict detection.

**RECOMMENDATION**:
Define clear acceptance criteria with response schema:
```typescript
// ACCEPTANCE CRITERIA for syncResult when mergeStrategy='manual'
interface ConflictResponse {
  success: false;
  hasConflicts: true;
  conflicts: Array<{
    file: string;                    // e.g., "Config.gs"
    type: 'overlapping_edits' |      // Both sides changed same line
           'delete_vs_modify' |       // One deleted, other modified
           'add_vs_add';              // Both added same line
    localVersion: string;            // Content from local
    remoteVersion: string;           // Content from GAS
    mergedWithMarkers: string;       // Content with conflict markers
    lineNumber?: number;             // Where conflict starts
  }>;
}

// TEST ACCEPTANCE CRITERIA:
it('should detect overlapping edits as conflicts', async () => {
  // Setup: GAS has "version: 2.0.0", local has "version: 1.5.0"

  const result = await local_sync({
    scriptId,
    mergeStrategy: 'manual'
  });

  // ACCEPT only if:
  expect(result.success).to.equal(false);
  expect(result.hasConflicts).to.equal(true);
  expect(result.conflicts).to.be.an('array').with.lengthOf(1);

  const conflict = result.conflicts[0];
  expect(conflict.file).to.equal('Config.gs');
  expect(conflict.type).to.equal('overlapping_edits');
  expect(conflict.localVersion).to.include('1.5.0');
  expect(conflict.remoteVersion).to.include('2.0.0');
  expect(conflict.mergedWithMarkers).to.match(/<<<<<<<\s+HEAD/);
  expect(conflict.lineNumber).to.be.a('number').greaterThan(0);
});
```

---

### FINDING: No Regression Test for Original Issues
**SEVERITY**: MEDIUM
**CATEGORY**: Test Coverage
**ISSUE**:
Plan mentions fixing "Issue 1: Wrong Merge Base" but proposes no test that:
1. **Creates scenario where merge base matters** (3-way merge with all three versions different)
2. **Validates correct merge base used** (Mocks git command to verify which commit is base)
3. **Demonstrates old behavior was wrong** (Shows what incorrect base produces vs correct)

**Impact**: Fix may be incomplete or revert without detection.

**Test Example**:
```typescript
it('should use correct merge base (not HEAD) for 3-way merge', async () => {
  // SETUP: Three-way merge scenario
  // BASE (last sync): "function add(a,b) { return a+b; }"
  // LOCAL (developer): "function add(a,b) { return a+b+1; }"  // +1
  // GAS (editor):     "function add(a,b,c) { return a+b+c; }" // Added c param

  // MOCK git command to capture merge-base usage
  const gitStub = sinon.stub(execFileAsync, 'git').callsFake(
    (cmd, args) => {
      if (cmd === 'git' && args[0] === 'merge-base') {
        // Verify we're asking for merge-base, not using HEAD
        recordGitCall('merge-base', args);
      }
      return originalGit(cmd, args);
    }
  );

  const result = await local_sync({scriptId});

  // ASSERT: merge-base was called
  const mergeBaseCalls = gitStub.getCalls()
    .filter(c => c.args[1][0] === 'merge-base');
  expect(mergeBaseCalls.length).to.be.greaterThan(0,
    'Must call git merge-base to find true common ancestor, not use HEAD');

  // ASSERT: Result contains additions from both sides
  const merged = result.merged[0];
  expect(merged).to.include('function add(a,b,c)');  // GAS version (added c)
  expect(merged).to.include('return a+b+1');         // Local version (+1)
  // ← This proves merge base was correct (not HEAD) because both changes preserved
});
```

---

### FINDING: Test Execution Order Dependencies Not Documented
**SEVERITY**: MEDIUM
**CATEGORY**: Test Reliability
**ISSUE**:
Phase 1 tests create project, Phase 2 tests use it, Phase 5 tests add nested configs. But no specification of:
1. **Required test order** - Are these sequential dependencies or parallel-safe?
2. **Cleanup points** - When to reset state between phases?
3. **Timeout scaling** - Phase 1 setup takes 10 min, does that impact CI timeout?

**Recommendation**:
Document test sequence with explicit state contracts:
```typescript
describe('Git Sync Suite (Sequential)', () => {
  let testProjectId: string;
  let syncFolder: string;

  describe('Phase 1: Setup', () => {
    before(() => {
      // STATE: No project exists
    });

    it('Phase 1.1: Create test project', async () => { /*...*/ });
    it('Phase 1.2: Add initial files', async () => { /*...*/ });

    after(() => {
      // STATE: Project has 2 files
      // INVARIANT: testProjectId is set
    });
  });

  describe('Phase 2: Sync (depends on Phase 1)', () => {
    before(() => {
      // REQUIRE: Phase 1 completed
      // INVARIANT: testProjectId has 2 files
    });

    it('Phase 2.1: Sync GAS to local', async () => { /*...*/ });
    // etc...
  });
});
```

---

## SUMMARY OF FINDINGS

| Finding | Severity | Category | Fixable |
|---------|----------|----------|---------|
| Poly-repo merge path not testable | CRITICAL | Test Design | Yes |
| Conflict marker verification vague | HIGH | Acceptance Criteria | Yes |
| Test isolation not defined | HIGH | Test Architecture | Yes |
| Branch coverage not specified | HIGH | Test Completeness | Yes |
| Missing edge case tests | HIGH | Test Completeness | Yes |
| Acceptance criteria unclear | HIGH | Acceptance Criteria | Yes |
| No regression test for Issue 1 | MEDIUM | Test Coverage | Yes |
| Test order dependencies undefined | MEDIUM | Test Reliability | Yes |

---

## VERDICT: NO_GO

### Rationale
The proposed test plan creates **false confidence** through vague assertions and untestable scenarios:

1. **Poly-repo merge path will appear to work** when tested, despite never calling the merge function (CRITICAL)
2. **Conflict detection assertions lack verification mechanism** - tests pass with incomplete merges (HIGH)
3. **Test isolation not defined** - makes results unreliable and hard to debug (HIGH)
4. **Edge cases not covered** - real-world failures won't be caught in testing (HIGH)
5. **Acceptance criteria ambiguous** - no way to know if fixes are actually working (HIGH)

The test plan as written will:
- ✅ Pass completely
- ✅ Show >80% coverage
- ❌ Miss critical merge path bugs
- ❌ Allow poly-repo silent failures to reach production
- ❌ Provide false confidence in conflict detection

### Path to GO

Address these before test implementation:

1. **Rewrite poly-repo test** to verify `mergeWithLocal()` is actually called (use spies/stubs)
2. **Define conflict marker format** and validate structurally in tests
3. **Specify test isolation strategy** (fresh project/folder per test)
4. **Require branch coverage** (not just line coverage)
5. **Add edge case tests** (empty, large, malformed projects)
6. **Define acceptance criteria schemas** (what should `syncResult` contain?)
7. **Add regression tests** for each of the 6 issues being fixed
8. **Document test execution order** (Phase dependencies, cleanup points)

Once these are addressed, the test plan becomes verifiable and reliable.

---

**Report Date**: 2026-01-02
**Reviewer**: Quality Developer
**Status**: Requires Redesign Before Implementation
