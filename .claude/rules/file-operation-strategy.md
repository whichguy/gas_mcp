---
paths:
  - "src/core/git/operations/**"
---

## File Operation Strategy Pattern

**Location:** `src/core/git/operations/`
**Purpose:** Separates file operation logic from git orchestration. Used by edit, aider, mv, cp, rm tools.
**Two-Phase Workflow:**
1. `computeChanges()` - Read from remote, compute changes (NO side effects)
2. `applyChanges(validatedContent)` - Write hook-validated content to remote

**Key Files:** `FileOperationStrategy.ts` (interface), `EditOperationStrategy.ts`, `AiderOperationStrategy.ts`, `CopyOperationStrategy.ts`, `MoveOperationStrategy.ts`, `DeleteOperationStrategy.ts`, `WriteOperationStrategy.ts`
**Orchestrator:** `GitOperationManager` (`src/core/git/GitOperationManager.ts`) — path resolution → branch management → compute → hook validation → apply → git commit → sync

**moduleOptions Preservation:** All strategies preserve `loadNow`, `hoistedFunctions`, `__global__`, `__events__` when unwrapping/rewrapping CommonJS.
