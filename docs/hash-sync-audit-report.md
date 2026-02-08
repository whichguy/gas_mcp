# Hash Comparison & Sync Logic Audit Report

**Date:** 2026-02-07
**Scope:** mcp_gas hash comparison, xattr cache lifecycle, and content-change signaling
**Method:** 3 parallel review agents examining 26+ source files

---

## Executive Summary

The hash comparison and sync infrastructure is **fundamentally sound**. All 13 hash comparison paths correctly compare WRAPPED-to-WRAPPED content, and the core `computeGitSha1` + `normalizeForHashing` pipeline is consistent. However, the audit uncovered **1 critical design fragility**, **4 important gaps**, and **4 minor issues** — mostly in the xattr cache lifecycle and LLM-facing content-change signaling.

The most impactful finding is that **CatTool provides no signal to the LLM when remote content has changed since the last read**, which can cause the LLM to apply edits based on a stale mental model.

---

## Prioritized Findings

### CRITICAL

#### C1: CatTool does NOT signal content changes to the LLM
**Files:** `src/tools/filesystem/CatTool.ts` (lines 333-345, 452)
**Agent:** content-change-signal-reviewer

When `cat` detects remote content differs from local:
- It silently overwrites the local file with remote content (line 337)
- It updates xattr with the new hash (line 341)
- It returns the new content with `hash: newHash`
- **It does NOT indicate the content changed since the LLM's previous read**

The response has no `contentChanged` flag, no `previousHash`, and no explicit message. The LLM cannot distinguish "file unchanged, cached" from "file changed on remote, pulled new version." The old hash IS available internally (from `isFileInSyncByHash`) but is discarded before response construction.

**Impact:** LLM may apply edits based on stale mental model of file content, causing incorrect modifications.

**Fix:** Add `contentChange` field to response using existing `isFileInSyncWithCacheByHash` (which returns full diagnostics including `localHash`). Changes needed in `CatTool.ts` and `types.ts` only. See implementation proposal below.

---

#### C2: GitOperationManager does not update xattr (fragile delegation pattern)
**Files:** `src/core/git/GitOperationManager.ts` (line 236)
**Agent:** xattr-lifecycle-reviewer

GitOperationManager writes files locally (`writeFile` at line 236) and pushes to remote, but does NOT call `updateCachedContentHash()` or `setFileMtimeToRemote()`. Each calling tool (edit, aider, cp, mv, rm) must independently remember to update xattr after `executeWithGit()` returns.

All **current** tools DO handle this correctly:
- `edit.ts:426` — `updateCachedContentHash()`
- `aider.ts:436` — `updateCachedContentHash()`
- `CpTool.ts:176` — `updateCachedContentHash()`
- `MvTool.ts:162,169` — `clearGASMetadata()` + `updateCachedContentHash()`
- `RmTool.ts:133` — `clearGASMetadata()`

**Impact:** Any new tool using GitOperationManager without post-hoc xattr update will silently have stale cache, causing incorrect sync detection. This is a maintainability trap.

**Fix:** Add xattr update logic to GitOperationManager itself after `applyChanges()` returns, for all non-deleted files. This centralizes the responsibility.

---

### IMPORTANT

#### I1: FileStatusTool duplicates `computeGitSha1` without normalization
**Files:** `src/tools/filesystem/FileStatusTool.ts` (lines 182-189)
**Agent:** hash-logic-reviewer

FileStatusTool has a private `computeGitSha1` that lacks CRLF normalization and UTF-8 BOM stripping that the canonical `hashUtils.ts` version performs.

**Impact:** Files with CRLF or BOM will produce different hashes from `file_status` vs all other tools (`cat`, `write`, `edit`, `git hash-object`).

**Fix:** Delete private method, import `computeGitSha1` from `hashUtils.ts`. Also consolidate duplicate `sha256`/`md5` logic (lines 198-211).

---

#### I2: SyncExecutor pull does not cache GAS metadata
**Files:** `src/tools/rsync/SyncExecutor.ts` (lines 467-483, 487-499)
**Agent:** xattr-lifecycle-reviewer

Pull ADD/UPDATE operations write files and call `updateCachedContentHash()` but do NOT call `setFileMtimeToRemote()` or `cacheGASMetadata()`. The GAS metadata (updateTime, fileType) is not cached.

**Impact:** After pull, CatTool fast path (line 121) checks `getCachedGASMetadata()` which returns null, forcing fallthrough to slow path (extra API call). Performance degradation, not correctness.

**Fix:** Add `setFileMtimeToRemote()` calls in SyncExecutor pull operations after `writeFile()`.

---

#### I3: SyncExecutor push does not update local xattr
**Files:** `src/tools/rsync/SyncExecutor.ts` (lines 558-571)
**Agent:** xattr-lifecycle-reviewer

After push, remote content may differ from local (due to CommonJS wrapping). No local xattr update is performed. Cached hash may mismatch remote on next conflict check.

**Impact:** Next `cat` or write conflict detection may see false hash mismatch. Mitigated by manifest tracking, but creates noise.

**Fix:** After push, update local xattr hash to reflect the remote-written content hash.

---

#### I4: Edit/aider tools don't refresh GAS metadata in xattr
**Files:** `src/tools/filesystem/edit.ts:426`, `aider.ts:436`, `raw-edit.ts:241`, `raw-aider.ts:266`
**Agent:** xattr-lifecycle-reviewer

These tools call `updateCachedContentHash()` but never `setFileMtimeToRemote()` or `cacheGASMetadata()`. The updateTime and fileType in xattr become stale after edits.

**Impact:** Same as I2 — CatTool fast path degraded after edits. Performance, not correctness.

**Fix:** Add `setFileMtimeToRemote()` after `updateCachedContentHash()` in these tools, or centralize in GitOperationManager (see C2).

---

### MINOR

#### M1: `===` vs `hashesEqual()` inconsistency
**Files:** Multiple (CatTool uses `===`, WriteTool uses `hashesEqual()`)
**Agent:** hash-logic-reviewer

**No practical impact.** All generated hashes are lowercase hex. `hashesEqual()` is intentionally used where user input (mixed case) is possible. Design is sound; optionally document the convention.

---

#### M2: Wrap/unwrap roundtrip whitespace normalization
**Files:** `src/utils/moduleWrapper.ts` (lines 519-582, 590-696)
**Agent:** hash-logic-reviewer

`wrapModuleContent()` and `unwrapModuleContent()` both call `.trim()`. If user code has trailing blank lines, they're lost in roundtrip. **No practical impact** because hash comparisons always use actual stored content, not re-wrapped derivations.

---

#### M3: Hash-before-mtime ordering in project.ts and deployments.ts
**Files:** `src/tools/project.ts:151-155`, `src/tools/deployments.ts:2019-2023`
**Agent:** xattr-lifecycle-reviewer

`updateCachedContentHash()` called BEFORE `setFileMtimeToRemote()`. The hashMtime stored in xattr won't match the file's final mtime, causing unnecessary recompute on next read (~5-50ms wasted).

**Fix:** Swap order to: `setFileMtimeToRemote()` then `updateCachedContentHash()`.

---

#### M4: `local_only` status is dead code in syncStatusChecker
**Files:** `src/utils/syncStatusChecker.ts`
**Agent:** hash-logic-reviewer

The checker only iterates `remoteFiles`, so `local_only` status is never returned despite being in the type definition. Cosmetic issue.

---

## Cross-Agent Correlations

| Finding | Agents | Connection |
|---------|--------|------------|
| C1 + C2 | Signal + xattr | If GitOperationManager updated xattr (C2 fix), CatTool's `contentChange` detection (C1 fix) would benefit from more reliable cached hashes |
| I2 + I4 | xattr | Both are the same pattern: missing `setFileMtimeToRemote()` after operations. Centralizing in GitOperationManager (C2 fix) would address I4. I2 (SyncExecutor) needs separate fix. |
| I1 + M1 | hash-logic | FileStatusTool's duplicate hash (I1) compounds the `===` vs `hashesEqual()` inconsistency (M1) — different normalization means case isn't the only divergence source |
| C1 + I3 | Signal + xattr | After push changes remote content (I3), the next cat won't properly detect the change (C1) because both the local hash and the "previous" hash would be stale |

---

## Implementation Proposal: Content-Change Signaling (C1)

### New type in `src/tools/filesystem/shared/types.ts`

```typescript
export interface ContentChangeInfo {
  /** Whether content has changed since last cached read */
  changed: boolean;
  /** Hash of previously cached content (null if first read) */
  previousHash: string | null;
  /** Hash of current content being returned */
  currentHash: string;
  /** What triggered the change detection */
  source: 'fast_path_cache' | 'slow_path_sync' | 'first_read';
}

export interface FileResult {
  // ... existing fields ...
  contentChange?: ContentChangeInfo;
}
```

### Changes to `CatTool.ts`

1. **Fast path** (line ~208): Add `contentChange: { changed: false, previousHash: cachedHash, currentHash: cachedHash, source: 'fast_path_cache' }`

2. **Fast path hash mismatch** (line ~233): Hoist `previousCachedHash` variable to capture old hash before falling to slow path

3. **Slow path** (line ~333): Replace `isFileInSyncByHash()` with `isFileInSyncWithCacheByHash()` to capture the old local hash

4. **Response construction** (line ~452): Add `contentChange: { changed: prevHash !== contentHash, previousHash: prevHash, currentHash: contentHash, source: prevHash ? 'slow_path_sync' : 'first_read' }`

### Import change

Replace `isFileInSyncByHash` with `isFileInSyncWithCacheByHash` from `fileHelpers.ts`.

---

## Recommended Fix Order

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| 1 | **C1** — CatTool content-change signaling | Medium (2 files) | High — prevents LLM stale-edit bugs |
| 2 | **C2** — GitOperationManager xattr centralization | Medium (1 file + remove from 6) | High — eliminates maintainability trap |
| 3 | **I1** — FileStatusTool hash dedup | Low (1 file) | Medium — hash consistency |
| 4 | **I2** — SyncExecutor pull metadata | Low (1 file) | Medium — fast path performance |
| 5 | **M3** — Hash/mtime ordering | Low (2 files) | Low — eliminates wasteful recompute |
| 6 | **I3** — SyncExecutor push xattr | Low (1 file) | Low-Medium — reduces false mismatch |
| 7 | **I4** — Edit/aider metadata | Low (4 files, or free with C2 fix) | Low — fast path perf |

---

## Verification Plan

After implementing fixes:
1. `cd ~/src/mcp_gas && npm run test:unit` — all existing tests pass
2. `npx mocha test/unit/utils/gasMetadataCache.test.ts` — hash cache tests
3. Manual: `cat` a file → modify remote via GAS editor → `cat` again → verify `contentChange.changed: true`
4. Integration: `write` → `cat` → external modify → `cat` → verify `contentChange` field
5. New unit test: verify `contentChange` field in CatTool response for both paths
