# Code Consolidation Plan

## Overview
Analysis of the mcp_gas codebase identified ~150+ lines of duplicate/dead code across several categories.

## High Priority (Immediate Action)

### 1. Extract Ripgrep Duplicate Methods (~60 lines saved)
**Files:** `src/tools/ripgrep.ts`
**Issue:** `sortResults()` and `trimResultLines()` are duplicated between RipgrepSearchEngine and RawRipgrepTool

**Action:**
- Extract to shared static utility in `src/utils/ripgrepUtils.ts`
- Or create base class with these methods

### 2. Consolidate Path Expansion (~50 lines saved)
**Files:**
- `src/utils/localGitDetection.ts` (public)
- `src/tools/config.ts:301` (private)
- `src/core/git/GitPathResolver.ts:170` (private)

**Action:**
- Keep only the public version in `src/utils/pathExpansion.ts`
- Update other files to import from there

### 3. Create Shared Manifest File Finder (~20 lines saved)
**Files:**
- `src/tools/deployments.ts:192`
- `src/tools/execution/utilities/manifest-config.ts:35-37`

**Action:**
- Create `findManifestFile(files: GASFile[]): GASFile | undefined` in `src/utils/fileHelpers.ts`
- Update both files to use it

## Medium Priority

### 4. Standardize Manifest File Detection
**Files:**
- `src/tools/rsync/SyncExecutor.ts:646, 663`
- `src/tools/filesystem/WriteTool.ts:772, 1208`
- `src/tools/filesystem/RawWriteTool.ts:113`

**Action:**
- Create `isManifestFile(filename: string): boolean` helper
- Standardize all to use `fileNameMatches()` pattern

### 5. Unify Critical File Position Validation
**Files:**
- `src/tools/deployments.ts:2004-2007`
- `src/tools/project.ts:113-150`
- `src/utils/validation.ts` (new CommonJS ordering)

**Action:**
- Already partially done with `validateCommonJSOrdering()`
- Consider using it in deployments.ts and project.ts instead of inline checks

### 6. Extract Common Edit Validation
**Files:**
- `src/tools/aider.ts:210`
- `src/tools/edit.ts:209`
- `src/tools/raw-edit.ts:126`
- `src/tools/raw-aider.ts:138`

**Action:**
- Extract to `validateEditOperations()` in validation.ts

## Low Priority (Cleanup)

### 7. Remove Dead Code in pathParser.ts
**Lines:** 57, 67, 92, 331-335

**Action:**
- Make private: `getCachedRegex`, `validateWildcardPattern`, `getPatternComplexity`
- Remove `sortFilesForExecution` (no-op function)

### 8. Consolidate Infrastructure Registry Lazy Loaders
**File:** `src/tools/infrastructure-registry.ts:57-110`

**Action:**
- Simplify lazy loading patterns or directly import

## Implementation Order

1. ✅ fileNameMatches migration (completed)
2. ✅ CommonJS ordering validation (completed)
3. ✅ Create shared manifest helpers (completed - isManifestFile, findManifestFile)
4. ✅ Extract ripgrep duplicate methods (completed - ripgrepUtils.ts)
5. [ ] Consolidate path expansion
6. ✅ Standardize manifest detection (completed - all files updated)
7. [ ] Extract edit validation
8. [ ] Clean up dead code

## Estimated Savings

| Category | Lines Saved | Time |
|----------|-------------|------|
| Ripgrep methods | ~60 | 2h |
| Path expansion | ~50 | 1.5h |
| Manifest helpers | ~30 | 1h |
| Edit validation | ~20 | 0.5h |
| Dead code removal | ~20 | 0.5h |
| **Total** | **~180** | **5.5h** |
