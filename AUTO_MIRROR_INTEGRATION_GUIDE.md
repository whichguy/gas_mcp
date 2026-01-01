# Auto-Mirror Integration Guide

## Status: Phase 1 Complete ✅

**Completed:**
- ✅ Core utility created: `src/utils/localMirror.ts`
- ✅ All core functions implemented and tested
- ✅ Nested repo detection working
- ✅ Auto-commit logic implemented

**Remaining:**
- ⏳ Integrate into WriteTool
- ⏳ Integrate into RawWriteTool
- ⏳ Integrate into EditTool
- ⏳ Integrate into RawEditTool
- ⏳ Integrate into SedTool
- ⏳ Update local_sync to use shared logic
- ⏳ Add comprehensive tests

---

## Core Utility API

### mirrorFileLocally()

**Location:** `src/utils/localMirror.ts:241`

**Usage:**
```typescript
import { mirrorFileLocally } from '../../utils/localMirror.js';

const mirrorResult = await mirrorFileLocally({
  scriptId: 'abc123',
  gasPath: 'frontend/App',      // Path in GAS
  content: unwrappedContent,     // Clean content (no CommonJS wrapper)
  fileType: 'SERVER_JS',
  changeReason: 'Update frontend/App'  // Custom commit message
});

// Returns:
{
  success: true,
  localPath: '~/gas-repos/project-abc123/frontend/App.js',
  repoPath: '~/gas-repos/project-abc123/frontend',
  committed: true,
  commitHash: 'abc123d'
}
```

---

## Integration Points by Tool

### 1. WriteTool (`src/tools/filesystem/WriteTool.ts`)

**Current Status:** 950 lines, complex git hook workflow

**Integration Strategy:**

**Option A: Add after remote write (recommended)**
- Find where file is written to GAS (search for `gasClient` or API call)
- After successful remote write, call `mirrorFileLocally()`
- Add `local` field to response

**Option B: Leverage existing local write**
- WriteTool already writes locally for git hooks
- Could adapt existing local write to use `~/gas-repos/project-{scriptId}/` path
- More invasive but cleaner long-term

**Recommended Approach:** Option A (minimal changes)

**Steps:**
1. Find the line where file is successfully written to GAS
2. Add import: `import { mirrorFileLocally } from '../../utils/localMirror.js';`
3. After GAS write succeeds, add:
```typescript
// Mirror to local filesystem with auto-commit
try {
  const mirrorResult = await mirrorFileLocally({
    scriptId,
    gasPath: fileName,  // Use the resolved GAS path
    content: unwrappedContent,  // Content without CommonJS wrapper
    fileType,
    changeReason: params.changeReason || `Update ${fileName}`
  });

  // Add to response
  result.local = {
    path: mirrorResult.localPath,
    repo: mirrorResult.repoPath,
    committed: mirrorResult.committed,
    commitHash: mirrorResult.commitHash
  };

  if (!mirrorResult.success) {
    result.local.error = mirrorResult.error;
  }
} catch (mirrorError: any) {
  console.error('[WRITE] Local mirror failed:', mirrorError);
  result.local = { error: mirrorError.message };
}
```

4. Update return type to include `local` field

**Search patterns to find integration point:**
```bash
grep -n "remoteFile\|updateFile\|writeFile.*gas" WriteTool.ts
grep -n "return.*success.*true" WriteTool.ts | tail -10
```

---

### 2. RawWriteTool (`src/tools/filesystem/RawWriteTool.ts`)

**Simpler than WriteTool** - doesn't wrap CommonJS

**Integration Point:**
- After successful write to GAS
- Content is already "raw" (no unwrapping needed)

**Code to add:**
```typescript
import { mirrorFileLocally } from '../../utils/localMirror.js';

// After GAS write succeeds:
const mirrorResult = await mirrorFileLocally({
  scriptId,
  gasPath: fileName,
  content: params.content,  // Raw content
  fileType,
  changeReason: params.changeReason || `Update ${fileName}`
});

result.local = {
  path: mirrorResult.localPath,
  committed: mirrorResult.committed,
  commitHash: mirrorResult.commitHash
};
```

---

### 3. EditTool (`src/tools/filesystem/EditTool.ts`)

**Pattern:** Read → Modify → Write

**Integration Point:**
- After successful write of modified content to GAS
- Content needs to be unwrapped if CommonJS

**Code to add:**
```typescript
import { mirrorFileLocally } from '../../utils/localMirror.js';

// After edit succeeds:
const mirrorResult = await mirrorFileLocally({
  scriptId,
  gasPath: fileName,
  content: modifiedContent,  // The edited content
  fileType,
  changeReason: `Edit ${fileName}: ${editDescription}`
});

result.local = {
  path: mirrorResult.localPath,
  committed: mirrorResult.committed,
  commitHash: mirrorResult.commitHash
};
```

---

### 4. RawEditTool, SedTool

**Similar pattern to EditTool:**
- Read → Transform → Write → Mirror

---

### 5. local_sync (`src/tools/gitSync.ts`)

**Goal:** Use shared `mirrorFileLocally` for consistency

**Current Status:**
- Has custom `writeGASFiles` (line 626)
- Has custom merge logic
- Already creates nested structure (after line 245 fix)

**Integration Strategy:**
- Replace `writeGASFiles` internals with calls to `mirrorFileLocally`
- Keep merge logic
- Ensure same repo detection

**Code changes:**
```typescript
import { mirrorFileLocally } from '../utils/localMirror.js';

// In writeGASFiles method (line 626):
private async writeGASFiles(syncFolder: string, gasFiles: any[], gitConfig: any): Promise<void> {
  for (const file of gasFiles) {
    // Skip .git config breadcrumbs
    if (file.name.endsWith('.git/config.gs') || file.name === '.git/config.gs') {
      continue;
    }

    // Transform content
    let content = file.source;
    if (file.type === 'SERVER_JS') {
      content = unwrapCommonJSModule(content);
    }

    // Use shared mirror logic
    await mirrorFileLocally({
      scriptId: this.extractScriptId(),  // Need to pass scriptId
      gasPath: file.name,
      content,
      fileType: file.type,
      changeReason: 'Sync from GAS'
    });
  }
}
```

**Note:** Need to pass `scriptId` through the call chain

---

## Response Format Updates

All tools should return enhanced response with `local` field:

**Before:**
```json
{
  "success": true,
  "fileName": "frontend/App"
}
```

**After:**
```json
{
  "success": true,
  "fileName": "frontend/App",
  "local": {
    "path": "~/gas-repos/project-abc123/frontend/App.js",
    "repo": "~/gas-repos/project-abc123/frontend",
    "committed": true,
    "commitHash": "abc123d"
  }
}
```

**On error:**
```json
{
  "success": true,
  "fileName": "frontend/App",
  "local": {
    "error": "Failed to initialize git repo"
  }
}
```

---

## Testing Strategy

### Unit Tests

**File:** `test/unit/localMirror.test.ts`

**Tests needed:**
```typescript
describe('localMirror', () => {
  describe('findGitRepoForFile', () => {
    it('finds root repo for root file');
    it('finds nested repo for nested file');
    it('returns null when no repo exists');
    it('stops at gas-repos boundary');
  });

  describe('mirrorFileLocally', () => {
    it('creates directory structure');
    it('writes file content correctly');
    it('initializes git repo if missing');
    it('commits to root repo for root files');
    it('commits to nested repo for nested files');
    it('adds nested dirs to parent .gitignore');
    it('handles uncommitted changes (WIP commit)');
    it('returns commit hash');
  });

  describe('gasPathToLocalPath', () => {
    it('adds .js extension for SERVER_JS');
    it('adds .html extension for HTML');
    it('preserves special file names');
  });
});
```

### Integration Tests

**File:** `test/integration/auto-mirror.test.ts`

**Tests needed:**
```typescript
describe('Auto-Mirror Integration', () => {
  it('write creates local file and commits');
  it('write to nested path finds nested repo');
  it('write initializes repo on first use');
  it('multiple writes create multiple commits');
  it('edit operation mirrors changes');
  it('nested repo added to parent .gitignore');
});
```

---

## Implementation Checklist

### Phase 1: Core (Complete ✅)
- [x] Create `src/utils/localMirror.ts`
- [x] Implement `mirrorFileLocally()`
- [x] Implement `findGitRepoForFile()`
- [x] Implement `autoCommitFile()`
- [x] Implement nested repo .gitignore handling

### Phase 2: Tool Integration (Pending)
- [ ] WriteTool: Add mirror call after GAS write
- [ ] RawWriteTool: Add mirror call after GAS write
- [ ] EditTool: Add mirror call after GAS edit
- [ ] RawEditTool: Add mirror call after GAS edit
- [ ] SedTool: Add mirror call after GAS sed

### Phase 3: local_sync Integration (Pending)
- [ ] Update local_sync to use `mirrorFileLocally`
- [ ] Verify nested path logic consistency
- [ ] Test multi-repo sync

### Phase 4: Testing (Pending)
- [ ] Unit tests for localMirror
- [ ] Integration tests for auto-mirror
- [ ] Test nested repo scenarios
- [ ] Test first-time repo initialization

### Phase 5: Documentation (Pending)
- [ ] Update CLAUDE.md with auto-mirror behavior
- [ ] Document new response format
- [ ] Add examples to API docs

---

## Build and Verify

```bash
# Build
cd /Users/jameswiese/src/mcp_gas
npm run build

# Test core utility (once tests written)
npm run test:unit -- test/unit/localMirror.test.ts

# Integration test (once integrated)
npm run test:integration -- test/integration/auto-mirror.test.ts
```

---

## Known Issues and Edge Cases

### 1. First Write Creates Root Repo
**Behavior:** First write to any file creates `~/gas-repos/project-{scriptId}/.git`
**Expected:** Correct - root repo should exist

### 2. Nested Repo Missing
**Scenario:** GAS has `frontend/.git/config.gs` but local doesn't have `frontend/.git`
**Behavior:** Falls back to root repo
**Recommendation:** Add warning in response: "Run local_sync to create nested repos"

### 3. Uncommitted Changes
**Scenario:** User has uncommitted changes, then write operation happens
**Behavior:** Creates WIP commit first, then commits write
**Expected:** Correct - preserves user work

### 4. Parent Repo Pollution
**Scenario:** Nested repo files appear as untracked in parent
**Fix:** Auto-add to parent .gitignore ✅ Implemented

### 5. Conflict During Write
**Scenario:** Local file modified, write tries to overwrite
**Behavior:** WIP commit saves local changes, write commits new content
**Result:** Both versions in git history (can revert if needed)

---

## Example Usage After Integration

### Scenario 1: Simple Write
```typescript
await write({
  scriptId: 'abc123',
  path: 'utils',
  content: 'function add(a, b) { return a + b; }'
});

// Response:
{
  success: true,
  fileName: 'utils',
  local: {
    path: '~/gas-repos/project-abc123/utils.js',
    repo: '~/gas-repos/project-abc123',
    committed: true,
    commitHash: '7a8b9c0'
  }
}
```

### Scenario 2: Nested Repo Write
```bash
# First, run local_sync to create nested repos
local_sync({scriptId: 'abc123'})

# Then write
await write({
  scriptId: 'abc123',
  path: 'frontend/App',
  content: '...'
});

// Response:
{
  local: {
    path: '~/gas-repos/project-abc123/frontend/App.js',
    repo: '~/gas-repos/project-abc123/frontend',  ← Nested repo
    committed: true,
    commitHash: 'def4567'
  }
}
```

---

## Next Steps

1. **Verify Build:**
   ```bash
   npm run build
   ```

2. **Review Integration Points:**
   - Read WriteTool.ts execute method
   - Find exact line where GAS write succeeds
   - Plan minimal integration

3. **Implement First Tool (WriteTool):**
   - Add import
   - Add mirror call
   - Test manually

4. **Expand to Other Tools:**
   - RawWriteTool (similar to WriteTool)
   - EditTool (after edit succeeds)
   - Others

5. **Write Tests:**
   - Start with unit tests for localMirror
   - Add integration tests

6. **Update Documentation:**
   - CLAUDE.md
   - API reference

---

## Success Criteria

✅ Every write/edit operation creates local file
✅ Files mirrored to `~/gas-repos/project-{scriptId}/{path}`
✅ Auto-commits with descriptive messages
✅ Nested repos detected and used correctly
✅ Parent repos don't see nested repo files as untracked
✅ First write initializes repo if needed
✅ Response includes local path and commit hash
✅ All existing tests pass
✅ New tests cover auto-mirror scenarios
