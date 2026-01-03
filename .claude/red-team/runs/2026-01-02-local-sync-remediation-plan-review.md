# Red Team Review: local_sync Remediation Plan

**Date**: 2026-01-02
**Plan Reviewed**: `~/.claude/plans/wise-leaping-lake.md`
**Verdict**: 🔴 **NO_GO - PLAN REQUIRES SIGNIFICANT REVISION**

---

## Executive Summary

The remediation plan for `local_sync` was reviewed by a 5-expert panel. All experts independently returned **NO_GO** verdicts. The plan addresses symptoms but introduces new critical issues and leaves architectural gaps.

**Total Findings**: 46 (13 Critical, 17 High, 14 Medium, 2 Low)

---

## Expert Panel Results

| Expert | Findings | Critical | High | Medium | Low | Verdict |
|--------|----------|----------|------|--------|-----|---------|
| GAS Specialist | 8 | 3 | 4 | 1 | 0 | NO_GO |
| Performance Engineer | 8 | 2 | 4 | 2 | 0 | NO_GO |
| Quality Developer | 13 | 2 | 5 | 5 | 1 | NO_GO |
| DevOps Engineer | 7 | 2 | 2 | 3 | 0 | NO_GO |
| Security Developer | 10 | 4 | 2 | 3 | 1 | NO_GO |
| **TOTAL** | **46** | **13** | **17** | **14** | **2** | **NO_GO** |

---

## Cross-Expert Validated Findings

Issues flagged by 3+ experts receive highest priority.

### XVF-001: forceOverwrite lacks backup/audit/recovery (CRITICAL)
**Experts**: GAS Specialist, DevOps Engineer, Security Developer

**Issue**: Proposed fix creates backup branch but:
- No scalable naming scheme (timestamp-only causes collisions, poor discoverability)
- No cleanup policy (100+ backup branches accumulate indefinitely)
- No automated rollback procedure documented
- Audit log design incomplete (no storage, query, retention specification)

**Remediation Required**:
1. Semantic naming: `backup-{scriptId}-{projectPath}-{timestamp}-{reason}`
2. Manifest file: `.backup-manifest.json` tracking all backups
3. Auto-cleanup: Keep last 10 backups, delete older than 30 days
4. Rollback command: `local_sync({operation: 'rollback', backupBranch: '...'})`
5. Audit log architecture: Storage location, rotation policy, query interface

---

### XVF-002: Partial batch/repo failure leaves inconsistent state (CRITICAL)
**Experts**: GAS Specialist, Performance Engineer, DevOps Engineer, Security Developer

**Issue**: Multi-repo sync continues after failure:
- Files already mirrored to some folders
- Other folders not yet processed
- GAS project in inconsistent state
- No transaction semantics or rollback

**Current Code** (lines 174-202):
```javascript
for (const project of projects) {
  try {
    const result = await this.runGitOperations(...);
    gitResults.push({ projectPath: project, success: true, ...result });
  } catch (error: any) {
    gitResults.push({ projectPath: project, success: false, error: error.message });
    // Continues to next project - no rollback!
  }
}
```

**Remediation Required**:
1. Pre-flight validation of all repos before starting
2. Create backup tag at start: `git tag sync-start-${timestamp}`
3. On ANY error, rollback all repos to start tag
4. Clear success/failure response showing per-repo status

---

### XVF-003: Batch API payload size limits not addressed (CRITICAL)
**Experts**: GAS Specialist, Performance Engineer

**Issue**: Proposed batch API sends all files in single call without:
- Checking total request payload size (GAS API ~10MB limit)
- Breaking large projects into batches
- Validating individual file sizes

**Impact**: Projects with 200+ files will fail 100% with 413 Payload Too Large errors.

**Remediation Required**:
```typescript
const MAX_BATCH_SIZE_BYTES = 8_000_000; // Leave 2MB buffer
const batches = [];
let currentBatch = [];
let currentSize = 0;

for (const file of files) {
  const fileSize = file.source.length;
  if (currentSize + fileSize > MAX_BATCH_SIZE_BYTES && currentBatch.length > 0) {
    batches.push(currentBatch);
    currentBatch = [];
    currentSize = 0;
  }
  currentBatch.push(file);
  currentSize += fileSize;
}
```

---

### XVF-004: Poly-repo merge path still bypassed (CRITICAL)
**Experts**: GAS Specialist, Quality Developer

**Issue**: The proposed unified merge path doesn't actually call `mergeWithLocal()` in poly-repo mode. The code at `runGitOperations()` lines 356-416 skips merge logic entirely for multi-repo scenarios:
- Phase 1: Mirrors files (done)
- Phase 2: Auto-commits directly (NO merge called!)
- Phase 3: Pushes back

**Impact**:
- CVF-001 remains unfixed despite "remediation"
- Tests will pass with false positives (merge never happens)
- Merge strategy parameter ignored in poly-repo mode

**Remediation Required**:
```typescript
async function syncWithMerge(projectPath?: string) {
  const repos = projectPath ? [projectPath] : await discoverAllRepos();
  for (const repo of repos) {
    await pullPhase(repo);
    await mergeWithLocal(repo, mergeStrategy);  // MUST call merge!
    await commitPhase(repo);
    await pushPhase(repo);
  }
}
```

---

### XVF-005: Audit log design incomplete (HIGH)
**Experts**: DevOps Engineer, Security Developer

**Issue**: Plan proposes `auditLog()` but doesn't specify:
- Where is it stored? (file, database, service)
- Log rotation policy?
- Structured vs unstructured format?
- How to query historical audits?
- Retention period?

**Remediation Required**: Define complete audit architecture:
```
~/.mcp-gas/audit/
├── manifest.json          # Index of all audit files
├── 2025-01-02.ndjson      # Newline-delimited JSON per day
└── archive/               # Old months archived
```

---

### XVF-006: Path traversal via projectPath (CRITICAL)
**Experts**: Security Developer

**Issue**: `projectPath` parameter used to construct file paths without validation against `..` or absolute paths.

**Attack Vector**:
```
local_sync({scriptId, projectPath: "libs/../../../.ssh"})
// Could access parent directories
```

**Remediation Required**:
```typescript
function validateProjectPath(projectPath: string): void {
  if (!projectPath) return;
  const normalized = path.normalize(projectPath);
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new ValidationError('projectPath',
      'Path traversal not allowed. Use relative paths without ".."');
  }
  if (!/^[a-zA-Z0-9/_-]+$/.test(normalized)) {
    throw new ValidationError('projectPath',
      'Invalid characters in path');
  }
}
```

---

### XVF-007: Test coverage metrics ambiguous (HIGH)
**Experts**: Quality Developer

**Issue**: Plan claims ">80% test coverage" but:
- Doesn't specify coverage type (line vs branch vs path)
- No baseline established for comparison
- Poly-repo merge path not executable (false positives)

**Remediation Required**:
- Establish baseline coverage before fixes
- Require branch coverage (not just line coverage)
- Verify merge is actually called in tests (not bypassed)

---

### XVF-008: Cleanup/retention policy undefined (MEDIUM)
**Experts**: DevOps Engineer

**Issue**: Backup branches and audit logs accumulate indefinitely.

**Remediation Required**:
```ini
[cleanup]
backupRetentionDays=30
auditLogRetentionDays=90
maxBackupBranches=10
autoCleanupOnSync=true
```

---

## Additional Expert Findings (By Category)

### GAS-Specific Issues
- GAS-001: Incomplete batch API error handling (429/503 not sufficient)
- GAS-003: Merge strategy doesn't preserve file ordering/position
- GAS-004: CommonJS conflict markers break wrapping
- GAS-007: Container-bound script metadata loss

### Performance Issues
- PERF-002: Serial repo processing bottleneck
- PERF-003: Exponential backoff worst-case 75s latency
- PERF-004: Memory pressure on 200+ file projects
- PERF-005: Git operations lack concurrency within repo
- PERF-007: No incremental sync (pulls all files every time)

### Quality Issues
- QA-003: Missing edge case tests (empty repos)
- QA-004: Conflict marker verification vague
- QA-006: Only 1 of 4 merge strategies tested
- QA-008: Fork/join semantics not verified
- QA-009: No concurrency tests

### DevOps Issues
- OPS-004: No rollback procedure documentation
- OPS-006: No observability/monitoring/alerting
- OPS-007: CI/CD pipeline impact not assessed

### Security Issues
- SEC-006: Git index corruption via race conditions
- SEC-007: Merge base uses LOCAL as BASE (defeats conflict detection)
- SEC-008: No file integrity verification (checksum)
- SEC-009: Symlink following vulnerability

---

## Verdict: NO_GO

### Key Problems

1. **Issue 3 Fix is Incomplete**: Proposed unified merge path doesn't invoke merge logic in poly-repo mode. Fix as written will not solve CVF-001.

2. **Issue 4 Fix is Operationally Unsound**: Backup branches without cleanup policy creates operational debt.

3. **Issue 5 Fix Introduces New Failures**: Batching without payload limits causes 100% failure on large projects.

4. **Security Gaps**: Path traversal and symlink vulnerabilities not addressed.

5. **Test Plan Inadequate**: Tests will produce false positives because underlying merge path not fixed.

---

## Recommended Path Forward

### Phase 0: Pre-Implementation Fixes (Before coding)
- [ ] Verify Issue 3 fix calls `mergeWithLocal()` for poly-repos
- [ ] Add path validation for `projectPath`
- [ ] Define audit log architecture
- [ ] Define backup cleanup policy

### Phase 1: Critical Correctness (Week 1)
- [ ] Fix merge base detection (Issue 1) ✅
- [ ] Fix git index usage (Issue 2) ✅
- [ ] Fix unified merge path (Issue 3) ⚠️ Needs revision
- [ ] Add path traversal validation

### Phase 2: Safety Rails (Week 2)
- [ ] forceOverwrite backup with semantic naming
- [ ] Audit logging with storage/query/retention
- [ ] Atomic sync with rollback
- [ ] Smart batching with 8MB payload limits

### Phase 3: Quality & Observability (Week 3)
- [ ] Poly-repo test coverage with baseline
- [ ] Branch coverage requirements
- [ ] Metrics/alerting for monitoring
- [ ] Rollback procedure documentation

---

## Acceptance Gate

Before approving for implementation:
- [ ] `mergeWithLocal()` called for ALL sync modes
- [ ] Path validation for `projectPath`
- [ ] Audit log architecture documented
- [ ] Backup naming + cleanup policy defined
- [ ] Batch API chunking with 8MB limits
- [ ] Test baseline established
- [ ] Atomic sync with rollback designed

---

## Appendix: Expert Reports

### A. GAS Specialist Findings
- GAS-001: Incomplete batch API error handling (CRITICAL)
- GAS-002: Batch API payload size not validated (HIGH)
- GAS-003: Merge strategy doesn't preserve file ordering (CRITICAL)
- GAS-004: CommonJS wrapping broken with conflict markers (HIGH)
- GAS-005: forceOverwrite missing audit trail (HIGH)
- GAS-006: Poly-repo phase execution lacks error recovery (CRITICAL)
- GAS-007: Container-bound script metadata loss (MEDIUM)
- GAS-008: Rate limiter doesn't account for batch operations (HIGH)

### B. Performance Engineer Findings
- PERF-001: Batch API payload size limits (CRITICAL)
- PERF-002: Serial repo processing bottleneck (CRITICAL)
- PERF-003: Exponential backoff excessive latency (HIGH)
- PERF-004: Memory pressure on large projects (HIGH)
- PERF-005: Git operations lack concurrency (HIGH)
- PERF-006: Partial batch failure lacks recovery (HIGH)
- PERF-007: No incremental sync (MEDIUM)
- PERF-008: forceOverwrite clears directory inefficiently (MEDIUM)

### C. Quality Developer Findings
- QA-001: Poly-repo merge logic bypassed (CRITICAL)
- QA-002: Coverage metrics conflict (CRITICAL)
- QA-003: Missing edge case: empty repos (HIGH)
- QA-004: Conflict marker verification vague (HIGH)
- QA-005: Missing response validation (HIGH)
- QA-006: Missing merge strategy coverage (HIGH)
- QA-007: Test fixture inadequacy (MEDIUM)
- QA-008: Missing fork/join semantics (MEDIUM)
- QA-009: Missing concurrency tests (MEDIUM)
- QA-010: Test isolation not specified (MEDIUM)
- QA-011: Coverage definition ambiguous (MEDIUM)
- QA-012: Test dependency chain not handled (MEDIUM)
- QA-013: Test description vagueness (LOW)

### D. DevOps Engineer Findings
- OPS-001: Backup strategy lacks scalability (CRITICAL)
- OPS-002: Audit log design incomplete (CRITICAL)
- OPS-003: Partial failure inconsistent state (HIGH)
- OPS-004: No rollback procedure (HIGH)
- OPS-005: Cleanup policy undefined (MEDIUM)
- OPS-006: Observability gaps (MEDIUM)
- OPS-007: CI/CD impact not addressed (MEDIUM)

### E. Security Developer Findings
- SEC-001: Command injection analysis (OK - actually safe)
- SEC-002: Path traversal via projectPath (CRITICAL)
- SEC-003: forceOverwrite lacks recovery (CRITICAL)
- SEC-004: Audit logging not implemented (HIGH)
- SEC-005: Partial batch failure state (HIGH)
- SEC-006: Git index corruption possible (MEDIUM)
- SEC-007: Merge base validation missing (MEDIUM)
- SEC-008: File integrity not verified (MEDIUM)
- SEC-009: Symlink following vulnerability (MEDIUM)
- SEC-010: Unvalidated git config values (LOW)

---

*Report generated by Claude Code Red Team Protocol v1.0*
