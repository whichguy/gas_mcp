# GASClient Refactoring Plan

## Overview

Split `src/api/gasClient.ts` (2498 lines, 26,465+ tokens) into focused modules of ~500 lines each.

---

## Module Structure

### 1. **gasTypes.ts** (Shared Type Definitions)
**Lines**: ~200
**Purpose**: All interfaces and types used across modules

**Exports**:
- `GASProject`
- `GASFile`
- `GASDeployment`
- `EntryPointType`
- `WebAppAccess`
- `WebAppExecuteAs`
- `WebAppConfig`
- `WebAppEntryPoint`
- `ExecutionApiEntryPoint`
- `EntryPoint`
- `ExecutionResponse`
- `ExecutionStatus`
- Any other shared types

---

### 2. **gasAuthOperations.ts** (Authentication)
**Lines**: ~300
**Purpose**: Authentication and token management

**Methods**:
- `revokeTokens(accessToken?: string): Promise<boolean>`
- `private initializeClient(accessToken?: string): Promise<void>`
- `private makeApiCall<T>(apiCall, accessToken?): Promise<T>`
- `private isTokenExpiredError(error: any): boolean`
- `private attemptTokenRefresh(expiredToken: string): Promise<string | null>`

**Dependencies**:
- `GASAuthClient`
- Google APIs (google.script, google.drive)
- Rate limiter
- Token cache management

---

### 3. **gasProjectOperations.ts** (Project Management)
**Lines**: ~400
**Purpose**: Project-level operations

**Methods**:
- `listProjects(pageSize?: number, accessToken?: string): Promise<GASProject[]>`
- `getProject(scriptId: string, accessToken?: string): Promise<GASProject>`
- `createProject(title: string, parentId?: string, accessToken?: string): Promise<GASProject>`

**Dependencies**:
- gasAuthOperations (for makeApiCall)
- gasTypes

---

### 4. **gasFileOperations.ts** (File Management)
**Lines**: ~600
**Purpose**: File CRUD operations

**Methods**:
- `getProjectContent(scriptId: string, accessToken?: string): Promise<GASFile[]>`
- `getProjectMetadata(scriptId: string, accessToken?: string): Promise<GASFile[]>`
- `updateProjectContent(scriptId: string, files: GASFile[], accessToken?: string): Promise<GASFile[]>`
- `updateFile(scriptId: string, fileName: string, content: string, position?: number, accessToken?: string, explicitType?: 'SERVER_JS' | 'HTML' | 'JSON'): Promise<GASFile[]>`
- `deleteFile(scriptId: string, fileName: string, accessToken?: string): Promise<GASFile[]>`
- `reorderFiles(scriptId: string, fileOrder: string[], accessToken?: string): Promise<GASFile[]>`

**Dependencies**:
- gasAuthOperations (for makeApiCall)
- gasTypes
- pathParser (getFileType, sortFilesForExecution)

---

### 5. **gasDeployOperations.ts** (Deployment Management)
**Lines**: ~600
**Purpose**: Deployment and versioning

**Methods**:
- `listDeployments(scriptId: string, accessToken?: string): Promise<GASDeployment[]>`
- `getDeployment(scriptId: string, deploymentId: string, accessToken?: string): Promise<GASDeployment>`
- `createVersion(scriptId: string, description?: string, accessToken?: string): Promise<any>`
- `createDeployment(...)`
- `findHeadDeployment(scriptId: string, accessToken?: string): Promise<GASDeployment | null>`
- `createHeadDeployment(...)`
- `ensureHeadDeployment(...)`
- `updateContentForHeadDeployment(...)`
- `constructWebAppUrl(deploymentId: string, isHeadDeployment?: boolean): string`
- `constructGasRunUrl(scriptId: string, accessToken?: string): Promise<string>`
- `constructGasRunUrlFromWebApp(webAppUrl: string): string`
- `isHeadDeployment(deployment: GASDeployment): boolean`

**Dependencies**:
- gasAuthOperations (for makeApiCall)
- gasTypes
- gasFileOperations (for updateProjectContent)
- urlParser

---

### 6. **gasScriptOperations.ts** (Script Execution)
**Lines**: ~300
**Purpose**: Script execution API

**Methods**:
- `executeFunction(scriptId: string, functionName: string, parameters: any[], accessToken?: string): Promise<ExecutionResponse>`

**Dependencies**:
- gasAuthOperations (for makeApiCall)
- gasTypes

---

### 7. **gasClient.ts** (Main Facade)
**Lines**: ~400
**Purpose**: Orchestration and backward compatibility

**Structure**:
```typescript
export class GASClient {
  private authOps: GASAuthOperations;
  private projectOps: GASProjectOperations;
  private fileOps: GASFileOperations;
  private deployOps: GASDeployOperations;
  private scriptOps: GASScriptOperations;

  constructor(authClient: GASAuthClient) {
    this.authOps = new GASAuthOperations(authClient);
    this.projectOps = new GASProjectOperations(this.authOps);
    this.fileOps = new GASFileOperations(this.authOps);
    this.deployOps = new GASDeployOperations(this.authOps, this.fileOps);
    this.scriptOps = new GASScriptOperations(this.authOps);
  }

  // Delegate all methods to respective operations
  async listProjects(...args) {
    return this.projectOps.listProjects(...args);
  }

  // ... etc for all methods
}
```

---

## Refactoring Strategy

### Phase 1: Extract Types
1. Create `gasTypes.ts`
2. Move all interfaces and types
3. Update imports

### Phase 2: Extract Auth Operations
1. Create `gasAuthOperations.ts`
2. Move auth-related methods and private helpers
3. Keep client cache and initialization logic
4. Export `GASAuthOperations` class

### Phase 3: Extract Project Operations
1. Create `gasProjectOperations.ts`
2. Move project CRUD methods
3. Inject `GASAuthOperations` dependency
4. Export `GASProjectOperations` class

### Phase 4: Extract File Operations
1. Create `gasFileOperations.ts`
2. Move file CRUD methods
3. Inject `GASAuthOperations` dependency
4. Export `GASFileOperations` class

### Phase 5: Extract Deploy Operations
1. Create `gasDeployOperations.ts`
2. Move deployment methods
3. Inject `GASAuthOperations` and `GASFileOperations`
4. Export `GASDeployOperations` class

### Phase 6: Extract Script Operations
1. Create `gasScriptOperations.ts`
2. Move executeFunction method
3. Inject `GASAuthOperations` dependency
4. Export `GASScriptOperations` class

### Phase 7: Refactor Main Client
1. Update `gasClient.ts` to use all modules
2. Keep as facade/orchestrator
3. Maintain backward compatibility
4. All existing imports still work

### Phase 8: Update Imports
1. Update all strategy files
2. Update all tool files
3. Test compilation

### Phase 9: Verification
1. Run TypeScript compilation
2. Verify all imports resolve
3. Check no circular dependencies
4. Run existing tests

---

## Dependency Graph

```
gasTypes.ts (no dependencies)
    ↓
gasAuthOperations.ts (uses gasTypes)
    ↓
    ├── gasProjectOperations.ts (uses gasAuthOps, gasTypes)
    ├── gasFileOperations.ts (uses gasAuthOps, gasTypes)
    ├── gasScriptOperations.ts (uses gasAuthOps, gasTypes)
    └── gasDeployOperations.ts (uses gasAuthOps, gasFileOps, gasTypes)
    ↓
gasClient.ts (uses all modules, re-exports as facade)
```

---

## Backward Compatibility

**Guarantee**: All existing code continues to work without changes.

**How**:
1. `gasClient.ts` remains the main export
2. All methods delegated to sub-modules
3. Same method signatures
4. Same return types
5. Existing imports like `import { GASClient } from './api/gasClient.js'` still work

**Optional**: Export sub-modules for direct access:
```typescript
// New way (optional, for advanced users)
import { GASFileOperations } from './api/gasFileOperations.js';

// Old way (still works, backward compatible)
import { GASClient } from './api/gasClient.js';
```

---

## Benefits

1. **Readability**: Each file ~500 lines (down from 2498)
2. **Maintainability**: Clear separation of concerns
3. **Testability**: Test each module independently
4. **Reusability**: Use sub-modules directly if needed
5. **Type Safety**: Explicit dependencies via injection
6. **No Breaking Changes**: Existing code works as-is

---

## File Size Estimates

| File | Lines | Tokens (est) |
|------|-------|--------------|
| gasTypes.ts | 200 | 1,500 |
| gasAuthOperations.ts | 300 | 2,500 |
| gasProjectOperations.ts | 400 | 3,000 |
| gasFileOperations.ts | 600 | 5,000 |
| gasDeployOperations.ts | 600 | 5,000 |
| gasScriptOperations.ts | 300 | 2,500 |
| gasClient.ts (refactored) | 400 | 3,000 |
| **Total** | **2,800** | **22,500** |

**Note**: Total lines increased due to class definitions and imports, but each file is now easily readable.

---

## Next Steps

1. ✅ Create plan document (this file)
2. Create gasTypes.ts
3. Create gasAuthOperations.ts
4. Create gasProjectOperations.ts
5. Create gasFileOperations.ts
6. Create gasDeployOperations.ts
7. Create gasScriptOperations.ts
8. Refactor gasClient.ts
9. Update imports across codebase
10. Test and verify

---

**Status**: Plan complete, ready for implementation
