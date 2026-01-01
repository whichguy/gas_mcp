# Two-Phase Sync Quality Review

## Architecture Analysis

### New Flow (Two-Phase Sync)
```
Phase 1: Mirror ALL files (GAS → Local) - No filtering
         ↓
Phase 2: Git operations (git add/commit) - Only breadcrumb folders
         ↓
Phase 3: Push changes back (Local → GAS) - Bidirectional for all files
```

### Old Flow (Git-Only Sync)
```
Find breadcrumb folders → Filter files → Merge → Push filtered files
```

## Critical Bugs Identified

### 🔴 BUG #1: Data Loss - No Merge Protection
**Severity:** CRITICAL

**Problem:**
Phase 1 (`mirrorAllFilesToLocal`) blindly overwrites ALL local files with GAS content. No merge logic, no conflict detection.

**Scenario:**
1. User edits `tools/ToolBase.js` locally
2. File in GAS is older but different
3. Run `local_sync`
4. Phase 1 overwrites local changes with GAS version
5. **User's local work is LOST**

**Location:** `gitSync.ts:952-996` (mirrorAllFilesToLocal)

**Old Code (SAFE):**
```typescript
const mergeResult = await this.mergeWithLocal(syncFolder, gasFiles, config, mergeStrategy);
if (!mergeResult.success) {
  return this.createConflictResponse(mergeResult.conflicts, syncFolder);
}
```

**New Code (UNSAFE):**
```typescript
await fs.writeFile(fullPath, content, 'utf8');  // Direct overwrite!
```

**Fix Required:**
Add merge detection for non-git files:
```typescript
// Check if file exists and differs
const localExists = await fs.access(fullPath).then(() => true).catch(() => false);
if (localExists) {
  const localContent = await fs.readFile(fullPath, 'utf8');
  if (localContent !== content) {
    // Track as potential conflict
    conflicts.push({ path: fullPath, reason: 'Local changes exist' });
    continue; // Skip overwrite
  }
}
```

---

### 🔴 BUG #2: Wrong Module Names for Nested Paths
**Severity:** HIGH

**Problem:**
`scanLocalFiles()` uses `path.basename()` for module name, losing directory structure.

**Scenario:**
- File: `tools/ToolBase.js`
- GAS expects: `tools/ToolBase`
- Current code produces: `ToolBase` (wrong!)

**Location:** `gitSync.ts:1210`

```typescript
// WRONG:
const baseName = path.basename(relativePath, ext);
content = wrapAsCommonJSModule(content, baseName);

// For "tools/ToolBase.js":
// baseName = "ToolBase"  ← Should be "tools/ToolBase"
```

**Fix Required:**
```typescript
// Correct module name includes full path without extension
const moduleName = localPathToGas(relativePath);
content = wrapAsCommonJSModule(content, moduleName);
```

---

### 🟡 BUG #3: Incorrect Extension Handling
**Severity:** MEDIUM

**Problem:**
`localPathToGas()` uses regex that fails for multi-dot filenames.

**Scenario:**
- File: `my.config.js`
- Expected: `my.config`
- Actual: `my.config` (works by accident)
- But: `my.test.spec.js` → `my.test.spec` (correct)
- Edge case: `file.min.js` → `file.min` (correct)

**Actually this works fine** - regex only removes the LAST extension. No fix needed.

---

### 🟡 BUG #4: Unnecessary Pushes on First Sync
**Severity:** MEDIUM

**Problem:**
`shouldPushFile()` compares mtime, but Phase 1 just set mtime to GAS time.

**Scenario:**
1. First sync ever
2. Phase 1 writes file, sets mtime = GAS updateTime
3. Phase 3 compares: local mtime == GAS time
4. Result: Doesn't push (correct - no changes)

**But:**
If there's clock skew or timezone issues:
- GAS time: `2025-01-01T10:00:00Z` (UTC)
- Local writes at: `2025-01-01T10:00:00-08:00` (PST)
- File mtime: Local system time
- Comparison might be wrong due to timezone handling

**Location:** `gitSync.ts:1159-1176`

**Fix Required:**
Normalize timezones before comparison:
```typescript
const gasTime = new Date(gasFile.updateTime).getTime();
const localTime = localFile.mtime.getTime();
if (localTime > gasTime + 1000) {  // 1 second grace period
  return true;
}
```

---

### 🟡 BUG #5: No Deletion Support
**Severity:** MEDIUM

**Problem:**
If user deletes a file locally, it gets re-created in Phase 1.
No way to delete files from GAS via local_sync.

**Scenario:**
1. User deletes `old-file.js` locally
2. Run `local_sync`
3. Phase 1 pulls `old-file` from GAS and re-creates it
4. File keeps coming back (zombie file!)

**Workaround:**
User must delete in GAS directly, then sync.

**Enhancement:**
Track deletions in git-managed folders:
```typescript
// After Phase 1, check for files in local that don't exist in GAS
const localOnly = localFiles.filter(local =>
  !gasFiles.some(gas => gasPathToLocal(gas.name) === local.path)
);
// These were deleted in GAS - remove locally
```

---

### 🟡 BUG #6: Git Pollution with Empty Commits
**Severity:** LOW

**Problem:**
Phase 2 always runs `git add -A && git commit`, even if nothing changed.

**Location:** `gitSync.ts:401-409`

**Current:**
```typescript
try {
  await execFileAsync('git', ['add', '-A'], { cwd: syncFolder });
  await execFileAsync('git', ['commit', '-m', 'Merged changes from GAS'], { cwd: syncFolder });
} catch {
  // No changes to commit is fine
}
```

**Issue:**
The catch block silently swallows the "nothing to commit" error, so this works.
But it's better to check first:

```typescript
const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: syncFolder });
if (status.stdout.trim()) {
  await execFileAsync('git', ['add', '-A'], { cwd: syncFolder });
  await execFileAsync('git', ['commit', '-m', 'Merged changes from GAS'], { cwd: syncFolder });
}
```

---

### 🟡 BUG #7: Nested Git Repo Path Confusion
**Severity:** LOW

**Problem:**
Phase 1 writes to `~/gas-repos/project-{id}/`
Phase 2 expects git repo at `~/gas-repos/project-{id}/common-js/`

What if config.localPath is wrong or mismatched?

**Scenario:**
1. Breadcrumb says: `localPath = ~/gas-repos/project-{id}/common-js`
2. Phase 1 writes files to: `~/gas-repos/project-{id}/common-js/require.js` ✓
3. Phase 2 tries git in: `~/gas-repos/project-{id}/common-js/` ✓
4. Works correctly!

**But what if breadcrumb has custom path:**
```
localPath = ~/my-custom-path/common-js
```

Then Phase 1 writes to `~/gas-repos/project-{id}/` but Phase 2 runs git in `~/my-custom-path/`.
Files are in different locations!

**Fix Required:**
Phase 1 must respect custom localPath from breadcrumbs:
```typescript
// WRONG: Always uses base path
await this.mirrorAllFilesToLocal(scriptId, allGasFiles, baseProjectPath);

// RIGHT: Check breadcrumbs first, use custom paths if specified
const projects = await gitProjectManager.listGitProjects(scriptId, accessToken);
const customPaths = new Map();
for (const project of projects) {
  const config = await gitProjectManager.getProjectConfig(...);
  if (config.sync?.localPath) {
    customPaths.set(project, config.sync.localPath);
  }
}
// Mirror to custom paths, not just baseProjectPath
```

---

## Edge Cases

### Edge Case #1: Mixed Git and Non-Git Folders
**Scenario:**
- `common-js/` has .git breadcrumb → git-managed
- `tools/` has NO breadcrumb → non-git

**Behavior:**
- Phase 1: Both folders mirrored to `~/gas-repos/project-{id}/`
- Phase 2: Only `common-js/` gets git operations
- Phase 3: Both folders pushed back

**Result:** Works as designed ✓

---

### Edge Case #2: Conflicting Changes in Git Folder
**Scenario:**
1. User edits `common-js/require.js` locally
2. Someone else edits `common-js/require` in GAS
3. Run `local_sync`

**Current Behavior:**
- Phase 1: Overwrites local with GAS (DATA LOSS!)
- Phase 2: Commits the GAS version
- Phase 3: Pushes it back (redundant)

**Should Do:**
- Detect conflict
- Stop and ask user to resolve
- Don't lose local changes

---

### Edge Case #3: Empty Project (No Files)
**Scenario:**
New project with no files.

**Behavior:**
- Phase 1: No files to mirror (OK)
- Phase 2: No git breadcrumbs found (OK)
- Phase 3: No files to push (OK)

**Result:** Works correctly ✓

---

### Edge Case #4: Large Projects (1000+ files)
**Scenario:**
Project with 1000 files.

**Performance:**
- Phase 1: 1000 file writes (slow but acceptable)
- Phase 2: Git operations (fast)
- Phase 3: 1000 mtime comparisons + pushes (could be slow)

**Optimization:**
Batch API calls in Phase 3:
```typescript
// Instead of 1000 individual updateFile calls
// Use batchUpdate if available
```

---

## State Transition Analysis

### State 1: Fresh Local (No Files)
**Actions:**
1. Run `local_sync`
2. Phase 1 mirrors all files ✓
3. Phase 2 creates git repos ✓
4. Phase 3 compares mtimes (all equal) → no pushes ✓

**Result:** ✅ All files present locally

---

### State 2: Local Has Uncommitted Changes
**Actions:**
1. User edits `tools/ToolBase.js`
2. Run `local_sync`
3. Phase 1 **OVERWRITES** local file ❌
4. User changes LOST

**Result:** 🔴 DATA LOSS

---

### State 3: Local is Ahead (Newer Files)
**Actions:**
1. User creates new file `tools/NewTool.js`
2. Run `local_sync`
3. Phase 1 doesn't delete it (only adds from GAS) ✓
4. Phase 3 detects new file → pushes to GAS ✓

**Result:** ✅ New file synced

---

### State 4: GAS is Ahead (Newer Files)
**Actions:**
1. File updated in GAS
2. Run `local_sync`
3. Phase 1 pulls newer version ✓
4. Phase 3 compares: GAS time > local time → doesn't push ✓

**Result:** ✅ GAS wins (correct)

---

### State 5: Diverged (Both Changed)
**Actions:**
1. User edits locally
2. Someone edits in GAS
3. Run `local_sync`
4. Phase 1 overwrites local ❌

**Result:** 🔴 DATA LOSS

---

## Recommendations

### Priority 1: Fix Data Loss (BUG #1)
**Add conflict detection to Phase 1:**
```typescript
// Before overwriting, check if local differs
if (localExists && localContent !== gasContent) {
  conflicts.push({ path: fullPath });
  continue; // Don't overwrite
}
```

### Priority 2: Fix Module Names (BUG #2)
**Use full path for module names:**
```typescript
const moduleName = this.localPathToGas(relativePath);
content = wrapAsCommonJSModule(content, moduleName);
```

### Priority 3: Add Custom Path Support (BUG #7)
**Respect breadcrumb localPath settings:**
```typescript
// Mirror to correct locations based on breadcrumbs
for (const project of projects) {
  const targetPath = customPaths.get(project) || `${baseProjectPath}/${project}`;
  await mirrorFilesToPath(files, targetPath);
}
```

### Priority 4: Improve shouldPushFile (BUG #4)
**Add grace period and better timezone handling:**
```typescript
const timeDiff = localTime - gasTime;
if (timeDiff > 1000) {  // 1 second grace
  return true;
}
```

### Priority 5: Add Deletion Support (BUG #5)
**Track and propagate deletions:**
```typescript
// Find files deleted from GAS
const deletedFiles = localFiles.filter(...)
// Remove locally or warn user
```

---

## Testing Checklist

- [ ] Test: Fresh sync with no local files
- [ ] Test: Sync with uncommitted local changes (should preserve or warn)
- [ ] Test: Sync with new local file (should push to GAS)
- [ ] Test: Sync with file deleted locally (should it re-create or delete from GAS?)
- [ ] Test: Sync with nested git repo (common-js)
- [ ] Test: Sync with non-git folders (tools, gas-queue)
- [ ] Test: Sync with custom localPath in breadcrumb
- [ ] Test: Sync with conflicting changes (local + GAS both modified)
- [ ] Test: Module names preserve directory structure
- [ ] Test: Large project (100+ files) performance

---

## Summary

### Bugs Found: 7 total
- 🔴 **Critical (1):** Data loss from no merge protection
- 🔴 **High (1):** Wrong module names
- 🟡 **Medium (3):** Clock skew, deletions, path confusion
- 🟡 **Low (2):** Empty commits, extension handling

### Must Fix Before Release:
1. BUG #1: Add conflict detection
2. BUG #2: Fix module names
3. BUG #7: Respect custom paths

### Can Fix Later:
4. BUG #4: Timezone handling
5. BUG #5: Deletion support
6. BUG #6: Git status check
