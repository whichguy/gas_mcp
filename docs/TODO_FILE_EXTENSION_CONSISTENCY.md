# TODO: File Extension Consistency

**Status**: Planned
**Priority**: Medium
**Complexity**: High
**Created**: 2025-01-09

## Problem Statement

Currently, mcp_gas follows an inconsistent file extension pattern:

**Current Behavior:**
- **Local → GAS**: Extensions removed (e.g., `utils.js` → `utils`)
- **GAS → Local**: Extensions added back (e.g., `utils` → `utils.js`)
- **GAS Storage**: Files stored WITHOUT extensions (e.g., `utils`, `Calculator`)
- **Local Storage**: Files stored WITH extensions (e.g., `utils.js`, `Calculator.js`)

**Transform Functions:**
```typescript
// src/api/pathParser.ts
gasPathToLocal(gasPath, type) {
  // Adds extension: "utils" → "utils.js"
  return gasPath + extension;
}

localPathToGas(localPath) {
  // Removes extension: "utils.js" → "utils"
  return localPath.replace(/\.(js|html|json)$/, '');
}
```

## Proposed Change

**Goal**: Keep extensions consistently on files everywhere

**New Behavior:**
- **Local → GAS**: Keep extensions (e.g., `utils.js` → `utils.js`)
- **GAS → Local**: Keep extensions (e.g., `utils.js` → `utils.js`)
- **GAS Storage**: Files stored WITH extensions (e.g., `utils.js`, `Calculator.js`)
- **Local Storage**: Files stored WITH extensions (e.g., `utils.js`, `Calculator.js`)

## Benefits

1. **Consistency**: Same filename everywhere (local, GAS, git)
2. **Clarity**: File type immediately visible (`.js` vs `.html` vs `.json`)
3. **Git Simplicity**: No extension transformation in git workflows
4. **User Expectation**: Matches standard file system conventions
5. **Tool Integration**: Easier for external tools to identify file types

## Challenges

### 1. Backward Compatibility

**Problem**: Existing GAS projects have files WITHOUT extensions

**Example Scenario:**
```
Existing GAS Project:
- utils (SERVER_JS)
- Calculator (SERVER_JS)
- sidebar (HTML)

After migration, we need to handle:
- Old files: "utils" (no extension)
- New files: "utils.js" (with extension)
- Are these the same file or different files?
```

**Required Detection:**
- When reading project, check for both `filename` and `filename.js`
- If both exist, decide which takes precedence
- Migration strategy for existing projects

### 2. Migration Path

**Strategy Options:**

**Option A: Automatic Migration**
```typescript
// On first read after update, migrate all files
async migrateProjectExtensions(scriptId: string): Promise<void> {
  const files = await getProjectContent(scriptId);

  for (const file of files) {
    if (!hasExtension(file.name)) {
      // Rename: "utils" → "utils.js"
      const newName = file.name + getExtension(file.type);
      await renameFile(scriptId, file.name, newName);
    }
  }
}
```

**Option B: Dual Support (Transition Period)**
```typescript
// Support both for 6-12 months
async getFile(scriptId: string, filename: string): Promise<GASFile> {
  // Try with extension first
  let file = await tryGetFile(scriptId, filename);

  if (!file && hasExtension(filename)) {
    // Try without extension (backward compat)
    const noExt = removeExtension(filename);
    file = await tryGetFile(scriptId, noExt);

    if (file) {
      console.warn(`Found file without extension: ${noExt} - consider migrating to ${filename}`);
    }
  }

  return file;
}
```

**Option C: Feature Flag**
```typescript
const USE_EXTENSIONS = process.env.MCP_GAS_USE_EXTENSIONS === 'true';

if (USE_EXTENSIONS) {
  // New behavior: keep extensions
} else {
  // Old behavior: remove extensions
}
```

### 3. Local Git Repo Implications

**Scenario 1: Existing Git Repos**
```
Before update:
  ~/gas-repos/project-ABC123/
    ├── utils.js
    ├── Calculator.js
    └── sidebar.html

GAS has:
  - utils (no extension)
  - Calculator (no extension)
  - sidebar (no extension)

After update with migration:
  GAS now has:
    - utils.js
    - Calculator.js
    - sidebar.html

Git impact:
  - No changes needed (local already had extensions)
  - Pull operation: Files already match
  - Push operation: Now matches local names
```

**Scenario 2: Name Collision Risk**
```
Edge case:
  GAS has:
    - utils (SERVER_JS, old)
    - utils.js (SERVER_JS, new)

  Are these:
    a) Same file (migration incomplete)
    b) Different files (user created both)

  Detection needed:
    - Compare content checksums
    - Compare creation timestamps
    - User confirmation dialog
```

**Scenario 3: .clasp.json Compatibility**
```
Current .clasp.json:
{
  "filePushOrder": [
    "common-js/require.js",
    "utils.js",
    "Calculator.js"
  ]
}

GAS names (current): "require", "utils", "Calculator"
GAS names (after):    "require.js", "utils.js", "Calculator.js"

Impact:
  - .clasp.json already correct (has extensions)
  - No changes needed to file push order
  - GAS names will match .clasp.json after migration
```

### 4. Google Apps Script API Behavior

**Question**: Does GAS API support files with extensions?

**Testing Needed:**
```typescript
// Test 1: Create file with extension
await createFile({
  name: "utils.js",
  type: "SERVER_JS",
  source: "function test() {}"
});
// Does this work? Or does GAS strip the extension?

// Test 2: File uniqueness
await createFile({name: "utils", type: "SERVER_JS", source: "v1"});
await createFile({name: "utils.js", type: "SERVER_JS", source: "v2"});
// Are these treated as 2 separate files or same file?

// Test 3: Execution
// If file is named "utils.js", does require("utils.js") work?
// Or must it still be require("utils")?
```

**API Documentation Research:**
- Check GAS API docs for filename constraints
- Check if extensions are allowed/required/stripped
- Verify behavior in Apps Script editor UI

### 5. CommonJS Module System Impact

**Current Behavior:**
```javascript
// File: Calculator.js (local)
// GAS name: Calculator (remote)
module.exports = { add, multiply };

// File: Main.js (local)
// GAS name: Main (remote)
const calc = require("Calculator");  // Works (no extension)
```

**After Change:**
```javascript
// File: Calculator.js (local)
// GAS name: Calculator.js (remote)
module.exports = { add, multiply };

// File: Main.js (local)
// GAS name: Main.js (remote)
const calc = require("Calculator.js");  // Extension required?
// OR
const calc = require("Calculator");     // Still works (CommonJS strips .js)?
```

**CommonJS Resolution Logic:**
```typescript
// In require.js, how does module resolution work?
function resolveModuleName(name: string): string {
  // Option 1: Strip extension automatically
  if (name.endsWith('.js')) {
    return name.slice(0, -3);
  }

  // Option 2: Try both
  if (moduleExists(name)) return name;
  if (moduleExists(name + '.js')) return name + '.js';

  throw new Error(`Module not found: ${name}`);
}
```

**Impact Assessment:**
- Will existing user code break?
- Do we need to update CommonJS resolver?
- Should `require()` support both with and without extension?

## Implementation Plan

### Phase 1: Research & Testing (1-2 weeks)

1. **API Testing**
   - [ ] Test GAS API with filenames containing extensions
   - [ ] Verify uniqueness behavior (`utils` vs `utils.js`)
   - [ ] Test execution with extension-named files
   - [ ] Document GAS API filename constraints

2. **Impact Analysis**
   - [ ] Survey existing projects for extension patterns
   - [ ] Identify projects that would need migration
   - [ ] Measure scope: How many files without extensions?

3. **CommonJS Analysis**
   - [ ] Review require.js module resolution logic
   - [ ] Test require("Module") vs require("Module.js")
   - [ ] Determine if resolution needs updating

### Phase 2: Design & Specification (1 week)

1. **Migration Strategy**
   - [ ] Choose approach (automatic, dual support, or feature flag)
   - [ ] Design rollback plan
   - [ ] Define success criteria

2. **Backward Compatibility**
   - [ ] Define detection logic for old vs new files
   - [ ] Design conflict resolution for name collisions
   - [ ] Plan deprecation timeline

3. **Git Integration**
   - [ ] Impact on rsync workflows
   - [ ] .clasp.json handling
   - [ ] Breadcrumb file naming (`.git/config.gs` → `.git/config` ?)

### Phase 3: Implementation (2-3 weeks)

1. **Core Changes**
   - [ ] Update `gasPathToLocal()` - stop adding extensions
   - [ ] Update `localPathToGas()` - stop removing extensions
   - [ ] Update all file operation tools (cat, write, ls, mv, cp, etc.)

2. **Backward Compatibility Layer**
   - [ ] Implement detection for extension-less files
   - [ ] Add fallback logic for old filenames
   - [ ] Create migration tool/command

3. **CommonJS Updates**
   - [ ] Update require.js resolution if needed
   - [ ] Update __defineModule__ if needed
   - [ ] Test with existing user projects

4. **Documentation**
   - [ ] Update CLAUDE.md with new behavior
   - [ ] Write migration guide for existing projects
   - [ ] Update tool documentation

### Phase 4: Testing (1-2 weeks)

1. **Unit Tests**
   - [ ] Test new path transformation functions
   - [ ] Test backward compatibility detection
   - [ ] Test migration logic

2. **Integration Tests**
   - [ ] Test with fresh GAS project (new behavior)
   - [ ] Test with existing GAS project (backward compat)
   - [ ] Test git workflows (rsync)
   - [ ] Test CommonJS module resolution

3. **User Testing**
   - [ ] Beta test with real projects
   - [ ] Gather feedback on migration experience
   - [ ] Identify edge cases

### Phase 5: Rollout (2-4 weeks)

1. **Gradual Rollout**
   - [ ] Release with feature flag (default: OFF)
   - [ ] Gather metrics on adoption
   - [ ] Monitor for issues

2. **Migration Support**
   - [ ] Provide migration tool/command
   - [ ] Documentation and tutorials
   - [ ] Support for users during transition

3. **Deprecation**
   - [ ] Announce timeline for removing old behavior
   - [ ] Final migration push
   - [ ] Remove backward compatibility code

## File Locations

### Files to Modify

**Core Path Transformation:**
- `src/api/pathParser.ts` - `gasPathToLocal()`, `localPathToGas()`

**File Operations:**
- `src/tools/filesystem/CatTool.ts`
- `src/tools/filesystem/WriteTool.ts`
- `src/tools/filesystem/LsTool.ts`
- `src/tools/filesystem/RmTool.ts`
- `src/tools/filesystem/MvTool.ts`
- `src/tools/filesystem/CpTool.ts`
- `src/tools/filesystem/GrepTool.ts`
- `src/tools/filesystem/FindTool.ts`

**Git Integration:**
- `src/tools/gitSync.ts` - .clasp.json generation
- `src/utils/claspConfig.ts` - filePushOrder handling

**CommonJS:**
- `src/require.js` - Module resolution
- `src/__mcp_exec.js` - Module execution

**Tests:**
- `test/unit/pathParser.test.ts`
- `test/integration/file-operations.test.ts`
- `test/integration/git-sync.test.ts`

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **GAS API doesn't support extensions** | Medium | High | Test early, maintain current behavior if unsupported |
| **Name collisions during migration** | Low | High | Detect and prompt user for resolution |
| **CommonJS breaks with extensions** | Low | Critical | Update resolution logic, maintain backward compat |
| **Git merge conflicts** | Medium | Medium | Clear migration docs, provide merge tools |
| **User code breaks** | Medium | High | Feature flag, gradual rollout, migration assistance |

## Decision Points

**Before proceeding, answer:**

1. ✅ **Does GAS API support filenames with extensions?**
   - Test: Create file named "utils.js" with type SERVER_JS
   - Expected: File created successfully
   - If NO → Cannot proceed with this change

2. ✅ **Are `utils` and `utils.js` treated as different files?**
   - Test: Create both in same project
   - Expected: Two separate files exist
   - Impact: Name collision detection needed

3. ✅ **Does require() work with extensions?**
   - Test: `require("Module.js")` when file is named "Module.js"
   - Expected: Module loads successfully
   - If NO → Need to update CommonJS resolver

4. ⚠️ **Is there a standard in GAS community?**
   - Research: Survey GAS projects on GitHub
   - Survey: .gs extension vs no extension
   - Best Practice: Follow community convention

## Alternative Approaches

### Alternative 1: Keep Current Behavior

**Pros:**
- No breaking changes
- No migration needed
- Proven and stable

**Cons:**
- Inconsistent with file system norms
- Confusing for new users
- Extra transformation logic

### Alternative 2: Use .gs Extension for GAS Files

**Rationale**: Google Apps Script editor uses `.gs` for server files

**Pros:**
- Matches GAS editor convention
- Clear distinction from Node.js files
- Industry standard for GAS

**Cons:**
- Would need to transform `.js` → `.gs` for GAS
- Syntax highlighting expects `.js`
- Tooling expects `.js` for JavaScript

### Alternative 3: Virtual File System

**Approach**: Abstract away GAS naming entirely

**Pros:**
- Complete control over naming
- Can support any local convention
- Isolates GAS API changes

**Cons:**
- High complexity
- Harder to understand for users
- More abstraction layers

## Recommendation

**Recommended Approach**: **Option B - Dual Support (Transition Period)**

**Rationale:**
1. **Safest**: Maintains backward compatibility
2. **Gradual**: Users can migrate at their own pace
3. **Testable**: Can validate before removing old behavior
4. **Reversible**: Can rollback if issues found

**Timeline:**
- **Month 1-2**: Research and testing
- **Month 3**: Implementation with dual support
- **Month 4-9**: Beta period, user migration
- **Month 10**: Deprecation announcement
- **Month 12**: Remove old behavior

## Open Questions

1. How many existing mcp_gas projects would be affected?
2. What percentage of files in those projects lack extensions?
3. Are there any GAS API limitations we haven't discovered?
4. Should we coordinate with clasp project for consistency?
5. What is the performance impact of dual detection?

## References

- Current implementation: `src/api/pathParser.ts`
- Related issue: File extension handling in git workflows
- GAS API docs: https://developers.google.com/apps-script/api/reference/rest/v1/projects.content
- Community discussion: (TBD - create GitHub discussion)

## Status Updates

**2025-01-09**: TODO created, awaiting initial research phase

---

**Next Steps**:
1. Assign owner for research phase
2. Schedule API testing session
3. Create GitHub issue for tracking
4. Survey existing projects for impact assessment
