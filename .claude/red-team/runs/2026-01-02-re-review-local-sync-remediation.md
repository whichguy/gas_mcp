# Red Team Review: local_sync Remediation Plan (Re-Review)

**Date**: 2026-01-02
**Plan**: `~/.claude/plans/wise-leaping-lake.md`
**Verdict**: **NO_GO**

---

## Executive Summary

The `local_sync` remediation plan was re-reviewed after the initial NO_GO verdict. The plan correctly identifies 6 critical issues in the current implementation but proposes fixes that are incomplete, introduce new vulnerabilities, or rely on non-existent infrastructure.

**Key Finding**: The proposed fix for Issue #1 (merge-base) uses `execAsync` with template literals, which is a **security regression** from the current code that uses `execFileAsync` with array arguments.

---

## Expert Panel Results

| Expert | Verdict | Critical | High | Medium |
|--------|---------|----------|------|--------|
| GAS Specialist | GO_WITH_FIXES | 3 | 3 | 2 |
| Performance Engineer | HOLD_FOR_REDESIGN | 2 | 3 | 4 |
| Quality Developer | NO_GO | 2 | 6 | 1 |
| DevOps Engineer | NO_GO | 3 | 2 | 2 |
| Security Developer | HOLD_FOR_REDESIGN | 2 | 2 | 3 |

**Consensus**: 2 NO_GO, 2 HOLD_FOR_REDESIGN, 1 GO_WITH_FIXES

---

## Cross-Expert Validated Findings (XVF)

### XVF-001: Command Injection via Template Literals
**Severity**: CRITICAL
**Experts**: Security, DevOps
**Issue**: Proposed fix uses:
```javascript
await execAsync(`git merge-base HEAD ${remoteBranch}`, { cwd: gitRoot })
```
This introduces command injection vulnerability if `remoteBranch` contains shell metacharacters.

**Current Code** (safer):
```javascript
await execFileAsync('git', ['merge-base', 'HEAD', remoteBranch], { cwd: gitRoot })
```

**Recommendation**: Reject template literal approach entirely. Continue using array-based arguments.

---

### XVF-002: Path Traversal via projectPath
**Severity**: CRITICAL
**Experts**: Security, DevOps
**Issue**: `projectPath` parameter accepts arbitrary strings without validation. Attacker can pass `"../../etc/passwd"` to escape sandbox.

**Recommendation**: Add strict validation:
```typescript
if (projectPath.includes('..') || projectPath.startsWith('/')) {
  throw new ValidationError('projectPath', projectPath, 'Path traversal detected');
}
```

---

### XVF-003: forceOverwrite Lacks Safety
**Severity**: CRITICAL
**Experts**: GAS, DevOps, Security
**Issue**: No verification backup succeeded, no dry-run mode, no confirmation required, no documented recovery.

**Recommendation**:
1. Require explicit confirmation: `confirm: 'DESTROY_LOCAL_CHANGES'`
2. Add dry-run mode: `forceOverwrite: true, dryRun: true`
3. Verify backup branch created before proceeding
4. Document recovery procedure

---

### XVF-004: Audit Log Infrastructure Missing
**Severity**: CRITICAL
**Experts**: DevOps, Security
**Issue**: Plan proposes `auditLog({...})` but no such function exists. Logger is console.error only.

**Recommendation**: Implement audit logging infrastructure before referencing it:
- Location: `~/.auth/mcp-gas/audit.log`
- Format: JSON lines with timestamp, operation, scriptId, user
- Rotation: 90-day retention

---

### XVF-005: Batch API Method Doesn't Exist
**Severity**: HIGH
**Experts**: GAS, Performance
**Issue**: Plan claims "single API call" via `gasClient.updateProjectContent()` but this method doesn't exist. Current code uses per-file `updateFile()` calls.

**Recommendation**:
1. Verify if batch method exists
2. If not, add to implementation scope (1-2 days)
3. Test with 100+ files before claiming performance improvement

---

### XVF-006: Poly-repo Merge Still Broken
**Severity**: HIGH
**Experts**: GAS, Quality
**Issue**: Proposed "unification" doesn't address why two code paths exist. The multi-repo path calls `mirrorAllFilesToLocal()` which does NOT call merge logic. Tests will pass via mocking while merge is never invoked.

**Recommendation**:
1. Document why two paths exist
2. Add test spies to verify `mergeWithLocal()` is called
3. Unify only after understanding the difference

---

### XVF-007: Test Isolation Undefined
**Severity**: HIGH
**Experts**: Quality, DevOps
**Issue**: No specification for whether tests share state. No beforeEach/afterEach cleanup. Tests will be flaky and order-dependent.

**Recommendation**: Each test gets fresh:
- GAS project (or mock)
- Local sync folder (tempdir)
- Git repository

---

### XVF-008: No Recovery Runbook
**Severity**: HIGH
**Experts**: DevOps, GAS
**Issue**: When forceOverwrite destroys local changes, there's a backup branch but no documented recovery procedure.

**Recommendation**: Add to CLAUDE.md:
```markdown
## Recovery from forceOverwrite

If forceOverwrite destroyed needed changes:
1. Find backup: `git -C ~/gas-repos/project-{scriptId} branch -l backup-*`
2. Restore: `git -C ~/gas-repos/project-{scriptId} reset --hard backup-{timestamp}`
3. Push to GAS: `local_sync({scriptId, direction: 'push-only'})`
```

---

## Required Changes Before GO

| Priority | Requirement | Effort |
|----------|-------------|--------|
| P0 | Remove template literal command construction | 2 hours |
| P0 | Add projectPath validation | 1 hour |
| P0 | Implement audit log infrastructure | 1 day |
| P0 | Verify/implement batch API | 1-2 days |
| P1 | Add forceOverwrite confirmation + dry-run | 4 hours |
| P1 | Document recovery procedures | 2 hours |
| P1 | Add test spies for merge verification | 4 hours |
| P2 | Define backup rotation policy | 2 hours |
| P2 | Add CI job for sync tests | 4 hours |

**Estimated Total**: 4-5 days additional work

---

## Conclusion

The remediation plan addresses real issues but requires significant redesign before implementation. The most critical finding is that the proposed security "fix" (Issue #1) actually introduces new vulnerabilities. The plan should be revised to:

1. Use array-based command construction (not template literals)
2. Implement missing infrastructure (audit log, batch API)
3. Add safety controls (confirmation, dry-run, recovery docs)
4. Improve test design (isolation, spies, edge cases)

**Next Action**: Revise plan to address XVF-001 through XVF-008 before re-submission.
