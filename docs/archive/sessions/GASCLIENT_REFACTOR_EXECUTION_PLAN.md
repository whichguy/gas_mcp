# GASClient Refactoring - Detailed Execution Plan

**Status**: Planning phase
**Date**: 2025-10-22

---

## Current State

✅ **Completed**:
- Created `GASCLIENT_REFACTOR_PLAN.md` (high-level architecture plan)
- Created `src/api/gasTypes.ts` (all shared type definitions extracted)

⏳ **In Progress**: Module extraction

📁 **Source File**: `src/api/gasClient.ts` (2498 lines)

---

## Challenges Identified

1. **File Size**: gasClient.ts is 26,465+ tokens (exceeds 25,000 token Read limit)
2. **Complex Dependencies**: Methods call each other, share state (clientCache, authClient)
3. **Private State**: clientCache, CLIENT_CACHE_TTL need to be shared
4. **Method Interdependencies**: makeApiCall used by all operations
5. **Backward Compatibility**: Must not break any existing code

---

## Revised Strategy: Incremental Refactoring

Instead of creating all modules at once, use **incremental approach**:

### Phase 1: Analyze & Extract (Manual with Grep/Read)
Use grep and targeted Read operations to extract specific sections without reading entire file.

### Phase 2: Create Foundation Module (gasAuthOperations.ts)
Extract core authentication infrastructure that all other modules depend on.

### Phase 3: Create Operation Modules (One at a Time)
Create each operation module incrementally, testing compilation after each.

### Phase 4: Refactor Main Client
Update gasClient.ts to use modules as facade.

### Phase 5: Verify & Test
Run compilation and verify no imports broke.

---

## Detailed Step-by-Step Plan

### STEP 1: Extract Auth Infrastructure ✅ Next

**File**: `src/api/gasAuthOperations.ts`

**What to extract**:
```
Lines 236-485 (approximately):
- private authClient: GASAuthClient
- private scriptApi, driveApi
- private clientCache
- constructor()
- initializeClient()
- makeApiCall()
- isTokenExpiredError()
- attemptTokenRefresh()
- revokeTokens()
```

**How**:
1. Read lines 236-600 from gasClient.ts (covers auth section)
2. Create gasAuthOperations.ts with GASAuthOperations class
3. Make clientCache, authClient, apis part of class state
4. Export GASAuthOperations class
5. Compile to verify

**Dependencies**:
- Import gasTypes.ts
- Import googleapis, GASAuthClient, rateLimiter, etc.

**Key Decision**: Make `makeApiCall` public so other modules can use it

---

### STEP 2: Extract Project Operations

**File**: `src/api/gasProjectOperations.ts`

**What to extract**:
```
- listProjects()
- getProject()
- createProject()
```

**How**:
1. Use grep to find line numbers
2. Read those specific sections
3. Create GASProjectOperations class
4. Inject GASAuthOperations in constructor
5. Replace direct makeApiCall with this.authOps.makeApiCall()

---

### STEP 3: Extract File Operations

**File**: `src/api/gasFileOperations.ts`

**What to extract**:
```
- getProjectContent()
- getProjectMetadata()
- updateProjectContent()
- updateFile()
- deleteFile()
- reorderFiles()
```

**How**: Same as Step 2

---

### STEP 4: Extract Deploy Operations

**File**: `src/api/gasDeployOperations.ts`

**What to extract**:
```
- listDeployments()
- getDeployment()
- createVersion()
- createDeployment()
- findHeadDeployment()
- createHeadDeployment()
- ensureHeadDeployment()
- updateContentForHeadDeployment()
- constructWebAppUrl()
- constructGasRunUrl()
- constructGasRunUrlFromWebApp()
- isHeadDeployment()
```

**Special**: Needs both GASAuthOperations and GASFileOperations

---

### STEP 5: Extract Script Operations

**File**: `src/api/gasScriptOperations.ts`

**What to extract**:
```
- executeFunction()
```

**How**: Same as Step 2

---

### STEP 6: Refactor Main Client

**File**: `src/api/gasClient.ts` (updated)

**New Structure**:
```typescript
import { GASAuthOperations } from './gasAuthOperations.js';
import { GASProjectOperations } from './gasProjectOperations.js';
import { GASFileOperations } from './gasFileOperations.js';
import { GASDeployOperations } from './gasDeployOperations.js';
import { GASScriptOperations } from './gasScriptOperations.js';
// Re-export types for backward compatibility
export * from './gasTypes.js';

export class GASClient {
  private authOps: GASAuthOperations;
  private projectOps: GASProjectOperations;
  private fileOps: GASFileOperations;
  private deployOps: GASDeployOperations;
  private scriptOps: GASScriptOperations;

  constructor() {
    this.authOps = new GASAuthOperations();
    this.projectOps = new GASProjectOperations(this.authOps);
    this.fileOps = new GASFileOperations(this.authOps);
    this.deployOps = new GASDeployOperations(this.authOps, this.fileOps);
    this.scriptOps = new GASScriptOperations(this.authOps);
  }

  // Delegate all methods
  async listProjects(pageSize?: number, accessToken?: string) {
    return this.projectOps.listProjects(pageSize, accessToken);
  }

  async getProject(scriptId: string, accessToken?: string) {
    return this.projectOps.getProject(scriptId, accessToken);
  }

  // ... etc for all methods
}
```

---

### STEP 7: Update Imports Across Codebase

**Files to update**:
- Strategy files (already import from gasClient.ts)
- Tool files (already import from gasClient.ts)
- Test files (if any)

**Changes needed**: NONE if we re-export from gasClient.ts

---

### STEP 8: Verify Compilation

```bash
npm run build
```

**Expected**: ✅ No TypeScript errors

---

## Implementation Approach

### Use Targeted Reads (Not Full File)

```bash
# Find line numbers for specific methods
grep -n "async listProjects" src/api/gasClient.ts

# Read specific line range
Read file with offset=LINE_NUM, limit=50
```

### Extract Pattern

For each method:
1. Find line number with grep
2. Read section (method + docs)
3. Copy to new module file
4. Adjust imports
5. Compile to verify

---

## Risk Mitigation

1. **Test after each step**: Compile after creating each module
2. **Keep original file**: Don't delete gasClient.ts until everything works
3. **Small commits**: Commit after each working module
4. **Backward compatibility**: Re-export everything from main gasClient.ts

---

## Success Criteria

- [ ] All 6 modules created (gasTypes.ts already done)
- [ ] gasClient.ts refactored to facade pattern
- [ ] `npm run build` succeeds
- [ ] No imports broken across codebase
- [ ] Each module file < 600 lines
- [ ] All types exported from gasTypes.ts
- [ ] All functionality preserved

---

## Time Estimate

- Auth operations: 30 min
- Project operations: 15 min
- File operations: 20 min
- Deploy operations: 30 min
- Script operations: 10 min
- Main client refactor: 20 min
- Import updates: 10 min
- Testing: 15 min

**Total**: ~2.5 hours

---

## Next Immediate Action

Start with STEP 1: Extract Auth Infrastructure

**Command**:
```bash
grep -n "constructor\|initializeClient\|makeApiCall\|isTokenExpiredError\|attemptTokenRefresh\|revokeTokens" src/api/gasClient.ts
```

This will give me exact line numbers to extract.

---

**Status**: Ready to execute STEP 1
