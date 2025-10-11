# Local Sync Architecture for MCP GAS

## Core Concept: Git Breadcrumbs + Local Sync

The goal is simple and elegant:
1. **Git Breadcrumbs in GAS**: `.git/config.gs` files mark folders and provide git metadata
2. **Local Sync**: `local_sync(scriptId)` syncs entire GAS project to local filesystem
3. **LLM Discovery**: When LLM reads local files, it discovers git associations and uses standard git commands

## Simplified Tool Architecture

### Primary Tool: `local_sync`

**Purpose**: Mirror entire GAS project to local filesystem with git-aware organization

**Signature**:
```typescript
local_sync({
  scriptId: string,           // GAS project to sync
  direction?: 'pull' | 'push' | 'sync',  // Default: 'sync'
  forceOverwrite?: boolean    // Skip merge (dangerous)
})
```

**Behavior**:
1. Pulls ALL files from GAS project
2. Discovers `.git/config.gs` files (breadcrumbs)
3. Organizes files into appropriate local git repos based on breadcrumbs
4. Performs 3-way merge if conflicts exist
5. Returns information about where files were synced locally

**Response Structure**:
```typescript
{
  success: boolean,
  syncedRepos: [
    {
      projectPath: '' | 'frontend' | 'backend',  // Path in GAS
      localPath: '~/gas-repos/project-abc123',   // Where files are locally
      repository: 'https://github.com/user/repo',
      branch: 'main',
      filesSynced: 42,
      gitStatus: {
        clean: boolean,
        modified: number,
        untracked: number
      }
    }
  ],
  recommendedActions: {
    primary: 'cd ~/gas-repos/project-abc123 && git status',
    gitCommands: [...]
  }
}
```

### Supporting Tools (Keep Existing)

- **`git_init`** - Create breadcrumb (`.git/config.gs`) in GAS
- **`config (action: get, type: sync_folder)`** - Query where a project syncs locally (includes repo status)
- **`config (action: set, type: sync_folder)`** - Update local sync location

**Remove/Rename**:
- ~~`git_sync`~~ → Becomes `local_sync` (more accurate name)

## File Organization Pattern

### GAS Project Structure (Poly-Repo)
```
GAS Project (scriptId: abc123)
├── .git/config.gs              ← Breadcrumb for root repo
├── frontend/
│   ├── .git/config.gs          ← Breadcrumb for frontend repo
│   ├── App.js
│   └── components/
│       └── Header.js
├── backend/
│   ├── .git/config.gs          ← Breadcrumb for backend repo
│   ├── api.js
│   └── database.js
└── shared/
    └── utils.js                ← Belongs to root repo
```

### Local Filesystem After local_sync
```
~/gas-repos/
├── project-abc123/             ← Root repo
│   ├── .git/                   ← Real git repo
│   ├── .git-gas/               ← Copy of .git/config.gs for reference
│   │   └── config
│   ├── shared/
│   │   └── utils.js
│   └── README.md
├── project-abc123-frontend/    ← Frontend repo
│   ├── .git/                   ← Real git repo
│   ├── .git-gas/
│   │   └── config
│   ├── App.js
│   └── components/
│       └── Header.js
└── project-abc123-backend/     ← Backend repo
    ├── .git/                   ← Real git repo
    ├── .git-gas/
    │   └── config
    ├── api.js
    └── database.js
```

## Git Breadcrumb Structure (`.git/config.gs`)

Stored in GAS as CommonJS module with INI format content:

```ini
[remote "origin"]
    url = https://github.com/user/frontend-app.git
    fetch = +refs/heads/*:refs/remotes/origin/*

[branch "main"]
    remote = origin
    merge = refs/heads/main

[sync]
    localPath = ~/gas-repos/project-abc123-frontend
    lastSync = 2025-10-11T10:30:00Z
```

**Purpose**:
- **Discovery**: LLM finds this and knows git exists
- **Configuration**: Tells `local_sync` where to put files locally
- **Team Collaboration**: Other developers see git association
- **Not Used for Complex Logic**: Just a marker + config

## Workflow Examples

### Example 1: Initial Setup
```typescript
// 1. Create breadcrumb in GAS
git_init({
  scriptId: 'abc123',
  repository: 'https://github.com/user/main-repo.git',
  branch: 'main'
})

// 2. Sync everything locally
local_sync({ scriptId: 'abc123' })

// Response shows:
// ✅ Synced to: ~/gas-repos/project-abc123
// 📁 Git repo initialized at: ~/gas-repos/project-abc123/.git
// 🔗 Remote: https://github.com/user/main-repo.git

// 3. LLM can now use standard git commands
cd ~/gas-repos/project-abc123
git status
git add -A
git commit -m "Initial sync from GAS"
git push origin main
```

### Example 2: Poly-Repo Setup
```typescript
// 1. Create breadcrumbs for multiple repos
git_init({
  scriptId: 'abc123',
  projectPath: '',  // Root
  repository: 'https://github.com/user/main.git'
})

git_init({
  scriptId: 'abc123',
  projectPath: 'frontend',
  repository: 'https://github.com/user/frontend.git'
})

git_init({
  scriptId: 'abc123',
  projectPath: 'backend',
  repository: 'https://github.com/user/backend.git'
})

// 2. Single sync command handles all repos
local_sync({ scriptId: 'abc123' })

// Response shows:
// ✅ Synced 3 repositories:
// - Root: ~/gas-repos/project-abc123
// - frontend: ~/gas-repos/project-abc123-frontend
// - backend: ~/gas-repos/project-abc123-backend

// 3. LLM works with each repo independently
cd ~/gas-repos/project-abc123-frontend
git checkout -b feature/new-ui
# Make changes
git add -A && git commit -m "New UI" && git push

cd ~/gas-repos/project-abc123-backend
git checkout -b feature/api-v2
# Make changes
git add -A && git commit -m "API v2" && git push
```

### Example 3: Merge Conflict Detection
```typescript
// Someone edited in GAS, you edited locally
local_sync({ scriptId: 'abc123' })

// Response shows:
// ❌ Conflicts detected in: ~/gas-repos/project-abc123
// Files with conflicts:
// - frontend/App.js (LOCAL vs REMOTE)
//
// Recommended actions:
// cd ~/gas-repos/project-abc123
// git status  # See conflicted files
// # Edit files to resolve <<<< ==== >>>> markers
// git add -A
// git commit -m "Resolved conflicts"
// local_sync({ scriptId: 'abc123' })  # Try again
```

## File Filtering Logic (Poly-Repo Support)

### Current Implementation (Keep This)

From lines 150-199 of gitSync.ts:

```typescript
private filterFilesByPath(files: any[], projectPath: string): any[] {
  if (!projectPath) {
    // Root project - exclude files belonging to nested git projects
    return files.filter(f => {
      if (f.name.startsWith('.git/')) return true;
      const parts = f.name.split('/');
      for (let i = 0; i < parts.length - 1; i++) {
        const checkPath = parts.slice(0, i + 1).join('/') + '/.git/config.gs';
        if (files.some(file => file.name === checkPath)) {
          return false; // Belongs to nested project
        }
      }
      return true;
    });
  }

  // Sub-project - only files under this path
  const prefix = projectPath + '/';
  return files.filter(f => {
    if (f.name === projectPath + '/.git/config.gs') return true;
    if (f.name.startsWith(prefix)) {
      const relativePath = f.name.slice(prefix.length);
      const parts = relativePath.split('/');
      for (let i = 0; i < parts.length - 1; i++) {
        const checkPath = projectPath + '/' + parts.slice(0, i + 1).join('/') + '/.git/config.gs';
        if (files.some(file => file.name === checkPath)) {
          return false; // Belongs to deeper nested project
        }
      }
      return true;
    }
    return false;
  });
}
```

**Why This Works**:
- Prevents file cross-contamination between repos
- Uses `.git/config.gs` as boundary markers
- Supports arbitrary nesting depth
- Each repo gets isolated file set

## Merge Strategy: Worktree vs Three-Way

### Current Implementation (Keep Both with Fallback)

From lines 228-237:
```typescript
private async mergeWithLocal(syncFolder: string, gasFiles: any[], gitConfig: any, strategy: string): Promise<any> {
  // Try worktree method first, fall back to three-way merge if not supported
  const hasWorktreeSupport = await this.checkWorktreeSupport(syncFolder);

  if (hasWorktreeSupport) {
    return this.mergeWithWorktree(syncFolder, gasFiles, gitConfig, strategy);
  } else {
    return this.mergeWithThreeWay(syncFolder, gasFiles, gitConfig, strategy);
  }
}
```

### Worktree Approach (Preferred)

**How It Works**:
1. Save current local state with `git commit -m "WIP: Save before sync"`
2. Create temporary worktree: `git worktree add /tmp/gas-worktree HEAD`
3. Write GAS files to worktree
4. Commit in worktree: `git commit -m "GAS state for merge"`
5. Generate patch: `git diff HEAD~1 HEAD`
6. Apply patch to main repo: `git apply --3way patch.diff`
7. Check for conflicts: `git status --porcelain`
8. Clean up: `git worktree remove /tmp/gas-worktree`

**Advantages**:
- Git-native approach
- Preserves all git history
- Clean conflict detection
- No manual file-by-file processing

**Disadvantages**:
- Requires git 2.5+ (2015+)
- More complex error handling
- Worktree cleanup on failures

### Three-Way Merge Approach (Fallback)

**How It Works**:
1. Create `.gas-merge/` directory
2. For each file individually:
   - Write BASE (current local content)
   - Write REMOTE (GAS content with transformations)
   - Call `git merge-file LOCAL BASE REMOTE`
3. Check exit code: 0 = success, 1 = conflict
4. Leave conflict markers in files if conflicts

**Advantages**:
- Works on older git versions
- Simple file-by-file logic
- Easy to debug individual files

**Disadvantages**:
- Manual file iteration
- Less git-native
- Requires BASE version management

### Recommendation: Keep Current Fallback Strategy

The current implementation is **correct** for poly-repo:
- Try worktree first (better experience)
- Fall back to three-way (compatibility)
- Both handle conflicts properly
- Both work with file filtering

## State Management

### GAS State (Source of Truth for Content)
- **Files**: All project files with CommonJS wrappers
- **Breadcrumbs**: `.git/config.gs` files marking git associations
- **Metadata**: File types, modification times

### Local State (Source of Truth for Git)
- **Git Repos**: Multiple repos in `~/gas-repos/`
- **Working Files**: Clean source code (no CommonJS wrappers)
- **Git History**: Commits, branches, remotes
- **`.git-gas/` Folder**: Copy of breadcrumbs for reference

### Sync State (Tracked in Breadcrumbs)
```ini
[sync]
    localPath = ~/gas-repos/project-abc123
    lastSync = 2025-10-11T10:30:00Z
    filesChanged = 42
```

## Corner Cases and Edge Conditions

### 1. Nested Git Projects
**Scenario**: `frontend/admin/.git/config.gs` inside `frontend/.git/config.gs`

**Handling**:
- File filtering detects nested `.git/config.gs`
- Each repo gets isolated file set
- No cross-contamination
- `local_sync` processes each independently

**Test Coverage Needed**:
- 3-level nesting (root → frontend → admin)
- Files at each level
- Verify isolation

### 2. Conflicting Changes (Local + GAS)
**Scenario**: User edits locally, someone edits in GAS, both modify same file

**Handling**:
- Worktree/three-way merge detects conflicts
- Leaves conflict markers: `<<<< ==== >>>>`
- Returns conflict list in response
- User resolves manually

**Test Coverage Needed**:
- Same line modified in both
- Different lines modified
- File deleted in one, modified in other

### 3. Missing Local Repo
**Scenario**: Breadcrumb exists, but local folder doesn't

**Handling**:
- `local_sync` creates directory
- Initializes git repo: `git init`
- Sets up remote: `git remote add origin <url>`
- Writes files and commits

**Test Coverage Needed**:
- First sync after `git_init`
- Deleted local folder
- Changed local path

### 4. Orphaned Files (No Breadcrumb)
**Scenario**: Files in GAS not covered by any `.git/config.gs`

**Handling**:
- Root repo (if exists) claims them
- If no root repo, error: "Files without git association"
- User must run `git_init` for root

**Test Coverage Needed**:
- Files in root with no root breadcrumb
- Files between nested repos

### 5. File Transformations
**Scenario**: README.md ↔ README.html, `.gitignore` ↔ `.gitignore.gs`

**Handling** (Current):
- Markdown → HTML when pushing to GAS
- HTML → Markdown when pulling to local
- Dotfiles wrapped in CommonJS for GAS
- Unwrapped when pulled locally

**Test Coverage Needed**:
- Markdown transformation preserves formatting
- Dotfiles roundtrip correctly
- Multiple dotfiles in one project

### 6. Large Projects (1000+ files)
**Scenario**: Entire GAS project with many files

**Handling**:
- Filters efficiently using path checks
- Processes repos independently
- May take time but doesn't break

**Performance Considerations**:
- O(n) filtering per repo
- Parallel repo processing possible
- Rate limiting on GAS API

### 7. Git Configuration Conflicts
**Scenario**: Multiple breadcrumbs claim same local path

**Handling** (Should Error):
- Detect during `local_sync`
- Error: "Multiple repos claim same localPath"
- User must fix with `config (action: set, type: sync_folder)`

**Test Coverage Needed**:
- Duplicate localPath detection
- Clear error message

### 8. Branch Mismatches
**Scenario**: Local on `develop`, breadcrumb says `main`

**Handling**:
- Use local branch (don't force switch)
- Update breadcrumb to match reality
- Warn user in response

**Test Coverage Needed**:
- Branch mismatch handling
- Multi-branch workflows

## Implementation Plan

### Phase 1: Rename and Simplify
1. Rename `GitSyncTool` → `LocalSyncTool`
2. Update `name` property: `git_sync` → `local_sync`
3. Update descriptions to emphasize "sync entire project"
4. Keep all existing logic (just rename)

### Phase 2: Test Coverage
1. Add poly-repo test cases (3-level nesting)
2. Add conflict detection tests
3. Add orphaned file tests
4. Add large project performance tests
5. Add git configuration conflict tests

### Phase 3: Documentation
1. Update CLAUDE.md with new naming
2. Create LOCAL_SYNC_WORKFLOWS.md
3. Update existing GIT_SYNC_WORKFLOWS.md
4. Add poly-repo examples to docs

### Phase 4: Validation
1. Run all existing tests (should pass)
2. Add new test cases
3. Manual testing with real projects
4. Performance benchmarking

## Migration Path for Users

### Breaking Change: Tool Name
- **Old**: `git_sync({ scriptId: 'abc123' })`
- **New**: `local_sync({ scriptId: 'abc123' })`

### Backwards Compatibility Option
Keep `git_sync` as alias to `local_sync` for 1-2 releases:
```typescript
export class GitSyncTool extends LocalSyncTool {
  public name = 'git_sync';
  public description = '⚠️ DEPRECATED: Use local_sync instead. This alias will be removed in v2.0';
}
```

## Summary of Changes

### What Changes
- **Tool Name**: `git_sync` → `local_sync`
- **Class Name**: `GitSyncTool` → `LocalSyncTool`
- **Descriptions**: Emphasize "sync entire GAS project"
- **Documentation**: New LOCAL_SYNC_ARCHITECTURE.md

### What Stays the Same
- All file filtering logic (perfect for poly-repo)
- Worktree/three-way merge fallback
- File transformations (README, dotfiles)
- Multi-repo support
- Breadcrumb (`.git/config.gs`) structure
- Supporting tools (git_init, config (action: get, type: sync_folder), etc.)

### Why This is Better
1. **Accurate Naming**: "local_sync" clearly means "sync GAS to local"
2. **Breadcrumb Metaphor**: Git files are markers, not complex config
3. **LLM Workflow**: LLM discovers git via breadcrumbs, uses standard commands
4. **Poly-Repo Native**: Design naturally supports multiple repos
5. **Simpler Mental Model**: One function, clear purpose

## Questions for Validation

1. ✅ Should `local_sync` require breadcrumbs, or work without git?
   - **Answer**: Require breadcrumbs (use `git_init` first)
   - **Reason**: Need to know where to put files locally

2. ✅ Should we support root files without breadcrumb?
   - **Answer**: Error if files have no breadcrumb
   - **Reason**: User must explicitly associate with git

3. ✅ Keep worktree + three-way fallback?
   - **Answer**: YES - provides best experience + compatibility

4. ✅ How to handle local path conflicts?
   - **Answer**: Error immediately, user fixes with `config (action: set, type: sync_folder)`

5. ✅ Support for non-git local sync?
   - **Answer**: NO - use regular `pull`/`push` tools for that
   - **Reason**: `local_sync` is specifically for git workflows
