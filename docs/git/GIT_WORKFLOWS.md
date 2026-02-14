# Git Sync Workflows for MCP GAS

Complete guide for Git integration with Google Apps Script through the MCP GAS server.

## Overview

The Git Sync system provides stateless synchronization between Google Apps Script projects and local Git repositories. It uses `rsync` for unidirectional sync with pull/push operations (with optional dryrun preview), and `git_feature` for feature branch management.

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Tool Reference](#tool-reference)
3. [Common Workflows](#common-workflows)
4. [Merge Strategies](#merge-strategies)
5. [File Transformations](#file-transformations)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Core Concepts

### 1. Association Marker (`.git/config` file)

Every GAS project with Git association contains a `.git/config` file (stored as SERVER_JS type in GAS):

```javascript
// Example .git/config file content
[remote "origin"]
  url = https://github.com/user/repo.git
[branch "main"]
[sync]
  localPath = /Users/user/gas-projects/my-project
```

This file:
- Makes projects self-documenting about Git association
- Stores in the GAS project itself (travels with the code)
- Provides metadata for sync operations
- Shows LLMs where to perform git operations

### 2. Sync Folders

Local filesystem directories where:
- GAS files are synchronized for git operations
- LLMs run standard git commands
- Default location: `~/gas-repos/project-{scriptId}/`

### 3. Stateless Sync (rsync)

**Key design:** Every rsync operation is stateless — diff is computed and applied in a single call. Use `dryrun: true` to preview changes before applying.

- **No planId, no TTL, no drift detection**
- **No locking** — rsync is stateless; write tools handle their own locking
- **Dryrun is read-only** (no side effects)
- Deletions require `confirmDeletions: true`

---

## Tool Reference

### Core Git Sync Tools (3 tools)

1. **rsync** - Stateless unidirectional sync (pull/push with dryrun)
2. **git_feature** - Feature branch management (start/commit/push/finish/rollback/list/switch)
3. **config** - Configure sync folder location

### rsync (Stateless Sync)

Perform safe unidirectional synchronization with single-call workflow.

**Operations:**
- `pull` - Sync from GAS to local (add `dryrun: true` to preview)
- `push` - Sync from local to GAS (add `dryrun: true` to preview)

```typescript
// 1. Preview what will be synced (dryrun — no side effects)
rsync({
  operation: "pull",
  scriptId: "1abc...",
  dryrun: true
})

// Response shows what will be synced
{
  success: true,
  operation: "pull",
  dryrun: true,
  summary: {
    direction: "pull",
    additions: 2,
    updates: 1,
    deletions: 0,
    isBootstrap: false,
    totalOperations: 3
  },
  files: {
    add: [{ filename: "utils.js" }, { filename: "config.js" }],
    update: [{ filename: "main.js", sourceHash: "abc...", destHash: "def..." }],
    delete: []
  },
  nextStep: "rsync({operation: 'pull', scriptId: '1abc...'})"
}

// 2. Apply changes
rsync({
  operation: "pull",
  scriptId: "1abc..."
})

// Response confirms sync
{
  success: true,
  operation: "pull",
  dryrun: false,
  result: {
    direction: "pull",
    filesAdded: 2,
    filesUpdated: 1,
    filesDeleted: 0
  },
  recoveryInfo: { method: "git reset", command: "git reset --hard abc123" }
}
```

**Advanced Options:**
```typescript
rsync({
  operation: "pull",
  scriptId: "1abc...",
  projectPath: "libs/shared",  // For poly-repo support
  excludePatterns: ["test/*", "backup/"],
  force: true  // Skip uncommitted changes check
})
```

### git_feature (Feature Branch Management)

Manage feature branches for organized development.

**Operations:**
- `start` - Create new feature branch
- `commit` - Commit all changes
- `push` - Push to remote
- `finish` - Squash merge to main and optionally push
- `rollback` - Delete branch without merging
- `list` - Show all feature branches
- `switch` - Change between branches

```typescript
// Start a new feature
git_feature({
  operation: "start",
  scriptId: "1abc...",
  featureName: "user-auth"
})
// Creates: llm-feature-user-auth

// Commit changes
git_feature({
  operation: "commit",
  scriptId: "1abc...",
  message: "feat: Add login form"
})

// Finish and push to main
git_feature({
  operation: "finish",
  scriptId: "1abc...",
  pushToRemote: true
})
```

### config (Sync Folder Management)

Get or set the sync folder location.

```typescript
// Get current sync folder
config({
  action: "get",
  type: "sync_folder",
  scriptId: "1abc..."
})

// Set new sync folder
config({
  action: "set",
  type: "sync_folder",
  scriptId: "1abc...",
  value: "/Users/user/new-location/project",
  moveExisting: true  // Physically move git repo
})
```

---

## Common Workflows

### Workflow 1: Initialize New Project with Git

```typescript
// 1. Create GAS project
project_create({ title: "My New Project" })

// 2. Create .git/config breadcrumb in GAS
write({
  scriptId: "1abc...",
  path: ".git/config",
  content: `[remote "origin"]
  url = https://github.com/owner/repo.git
[branch "main"]
[sync]
  localPath = ~/gas-repos/project-1abc...`
})

// 3. Create local git repo
// cd ~/gas-repos/project-1abc...
// git init
// git remote add origin https://github.com/owner/repo.git

// 4. Pull from GAS
rsync({ operation: "pull", scriptId: "1abc..." })

// 5. Commit and push
// git add -A
// git commit -m "Initial GAS project sync"
// git push -u origin main
```

### Workflow 2: Daily Development

```typescript
// Morning: Pull latest changes from GAS
rsync({ operation: "pull", scriptId: "1abc..." })

// Work in GAS Editor...
// Edit code in script.google.com

// Evening: Pull changes and commit
rsync({ operation: "pull", scriptId: "1abc..." })

// Commit via git_feature
git_feature({ operation: "commit", scriptId: "1abc...", message: "feat: Added new functionality" })
git_feature({ operation: "push", scriptId: "1abc..." })
```

### Workflow 3: Feature Branch Development

```typescript
// 1. Start feature branch
git_feature({
  operation: "start",
  scriptId: "1abc...",
  featureName: "new-feature"
})

// 2. Make changes using write/edit tools
write({ scriptId: "1abc...", path: "feature", content: "..." })

// 3. Commit changes
git_feature({
  operation: "commit",
  scriptId: "1abc...",
  message: "feat: Implement new feature"
})

// 4. Push for backup/review
git_feature({ operation: "push", scriptId: "1abc..." })

// 5. When complete, merge to main and push
git_feature({
  operation: "finish",
  scriptId: "1abc...",
  pushToRemote: true
})
```

### Workflow 4: Handle Sync with Deletions

```typescript
// 1. Preview changes (dryrun)
rsync({ operation: "pull", scriptId: "1abc...", dryrun: true })

// Response shows deletions
{
  summary: { deletions: 2, ... },
  files: {
    delete: [{ filename: "old-file.js" }, { filename: "deprecated.js" }]
  },
  nextStep: "rsync({operation: 'pull', scriptId: '1abc...', confirmDeletions: true})"
}

// 2. Apply with deletion confirmation
rsync({
  operation: "pull",
  scriptId: "1abc...",
  confirmDeletions: true  // Required when deletions present
})
```

---

## File Transformations

The sync system automatically handles special file transformations:

### README Files
- `README.md` (local) ↔ `README.html` (GAS)
- Markdown converted to styled HTML for GAS storage
- HTML converted back to Markdown when pulling

### Dotfiles
- `.gitignore` (local) ↔ `.gitignore.gs` (GAS)
- `.git/config` (local) ↔ `.git/config` (GAS) - Note: no .gs extension for .git/* files
- Regular dotfiles wrapped for GAS storage

### CommonJS Wrapping
- All `.js` files automatically wrapped/unwrapped
- User sees clean code, GAS gets proper module structure

---

## Best Practices

### 1. Use Dryrun to Preview Changes
```typescript
// Preview first, then apply
rsync({ operation: "pull", scriptId: "...", dryrun: true })
// Review diff output
rsync({ operation: "pull", scriptId: "..." })
```

### 2. Commit Frequently with git_feature
```typescript
// After meaningful changes
git_feature({ operation: "commit", scriptId: "...", message: "..." })
```

### 3. Use Feature Branches for Major Work
```typescript
git_feature({ operation: "start", scriptId: "...", featureName: "big-feature" })
// ... work ...
git_feature({ operation: "finish", scriptId: "...", pushToRemote: true })
```

### 4. Push to Remote Regularly
```typescript
git_feature({ operation: "push", scriptId: "..." })
```

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| "No git association found" | Create `.git/config` breadcrumb in GAS |
| "Uncommitted changes" | Use `force: true` or commit changes first |
| "Deletions require confirmation" | Add `confirmDeletions: true` |
| "Lock timeout" | Another sync in progress — wait or check for stuck processes |

### Error Recovery

**Uncommitted Changes:**
```typescript
// Option 1: Force (skip check)
rsync({ operation: "pull", scriptId: "...", force: true })

// Option 2: Commit first
git_feature({ operation: "commit", scriptId: "...", message: "WIP" })
rsync({ operation: "pull", scriptId: "..." })
```

---

## Multi-Project Support (Poly-Repo)

GAS projects can contain multiple git-enabled subprojects:

```typescript
// Root project sync
rsync({ operation: "pull", scriptId: "..." })

// Subproject sync
rsync({
  operation: "pull",
  scriptId: "...",
  projectPath: "libs/shared"  // Sync only this subproject
})

// Feature branch on subproject
git_feature({
  operation: "start",
  scriptId: "...",
  featureName: "lib-update",
  projectPath: "libs/shared"
})
```

---

## Summary

The Git Sync system provides:

- Stateless synchronization (single-call pull/push with dryrun preview)
- Feature branch management via git_feature
- Deletion safety with confirmation
- Self-documenting projects via `.git/config`
- File transformation handling
- Multi-project (poly-repo) support
- Clear error messages and recovery paths

This approach maximizes safety while enabling powerful Git integration workflows for Google Apps Script development.

---

## Git Auto-Initialization

Automatic git repository initialization when `.git` directory is missing. Shared utility at `src/utils/gitInit.ts`, used by both `write` and `git_feature` tools.

### Auto-Init Strategy

1. Check if `.git` directory exists → skip if present
2. Run `git init` to create repository
3. Detect global git config: `git config --global user.name/user.email`
4. If global config exists → use automatically
5. If no global config → set local defaults: `user.name="MCP Gas"`, `user.email="mcp@gas.local"`

### When Auto-Init Triggers

- **write/raw_write**: When git repository detected but `.git` missing
- **git_feature**: Any operation (start/finish/list/etc.) when `.git` missing
- Both tools use identical initialization logic

### Config Detection Result

```typescript
{
  initialized: boolean,    // true if git repo exists
  isNew: boolean,          // true if just created
  configSource: 'global' | 'defaults' | 'existing',
  repoPath: string
}
```

---

## Poly-Repo Architecture (Assembled Git Repositories)

Enable a single GAS project to serve as an **assembled poly-repo** — combining multiple independent git repositories (shared libraries like auth, utils, ui) into one deployable unit.

### Architecture

```
GAS Project (Single scriptId)
├── .git/config                 → Root repo breadcrumb (main app)
├── common-js/require.gs
├── src/main.js
├── libs/auth/.git/config       → Auth library repo breadcrumb
│   ├── libs/auth/oauth.js
│   └── libs/auth/session.js
├── libs/utils/.git/config      → Utils library repo breadcrumb
│   ├── libs/utils/helpers.js
│   └── libs/utils/format.js
└── libs/ui/.git/config         → UI library repo breadcrumb
    ├── libs/ui/sidebar.html
    └── libs/ui/components.js
```

### Capabilities

| Capability | Tool/Mechanism | Status |
|------------|----------------|--------|
| Multiple git repos in one GAS | `.git/config` breadcrumbs | Full |
| Selective sync per repo | `rsync({operation, projectPath})` | Full |
| Write to specific repo | `write({projectPath})` | Full |
| Feature branches per repo | `git_feature({projectPath})` | Full |
| Auto-discovery of nested repos | `GitProjectManager.loadAllGitProjects()` | Full |
| File filtering per repo | `filterFilesByPath()` | Full |

### Per-Repo Workflow

```typescript
rsync({operation: 'pull', scriptId, projectPath: 'libs/auth', dryrun: true})
git_feature({operation: 'start', scriptId, featureName: 'oauth2', projectPath: 'libs/auth'})
write({scriptId, path: 'oauth.js', content: '...', projectPath: 'libs/auth'})
git_feature({operation: 'finish', scriptId, projectPath: 'libs/auth'})
```

### Key Infrastructure

- `GitProjectManager.ts` — Discovers all nested repos via `loadAllGitProjects()`
- `GitPathResolver.ts` — Resolves local git paths from breadcrumbs
- `filterFilesByPath()` — Filters GAS files to specific project path

---

## Worktree System (Parallel Development)

Enable multiple Claude Code agents to work concurrently on isolated GAS projects while sharing git history.

**Tool:** `worktree` with 10 operations

### Architecture

```
Claude Code Agents (A, B, C)
         │
         ▼
    Worktree Tool
         │
         ▼
GAS Projects (Isolated)              Local Git (Shared)
├── Parent scriptId:P                ~/gas-repos/project-{P}/
├── Worktree A scriptId:A    ←→      └── worktrees/A/ (feature-A branch)
├── Worktree B scriptId:B    ←→      └── worktrees/B/ (feature-B branch)
└── Worktree C scriptId:C    ←→      └── worktrees/C/ (feature-C branch)
```

**State Machine:** `CREATING → READY → CLAIMED → MERGING → MERGED | FAILED | ORPHAN_*`

### Operations

| Operation | Purpose | Key Params |
|-----------|---------|------------|
| `add` | Create worktree | `parentScriptId`, `branchName`, `claimImmediately` |
| `claim` | Get READY or create | `parentScriptId`, `createIfNone`, `agentId` |
| `release` | Return to READY | `worktreeScriptId`, `force` |
| `merge` | Squash merge to parent | `worktreeScriptId`, `pushToRemote`, `deleteAfterMerge` |
| `remove` | Delete worktree | `worktreeScriptId`, `force` |
| `list` | Filter worktrees | `parentScriptId`, `state[]` |
| `status` | Divergence info | `worktreeScriptId` |
| `sync` | Pull parent changes | `worktreeScriptId`, `refreshBaseHashes` |
| `batch-add` | Create N worktrees | `parentScriptId`, `count`, `branchPrefix` |
| `cleanup` | Remove orphans | `parentScriptId`, `maxAge`, `dryRun` |

### Typical Workflows

```typescript
// Single agent
const wt = await worktree({operation: 'add', parentScriptId, branchName: 'feature'});
// ... develop with write/edit tools using wt.scriptId ...
await worktree({operation: 'merge', worktreeScriptId: wt.scriptId});

// Pool workflow (multiple agents)
await worktree({operation: 'batch-add', parentScriptId, count: 3, branchPrefix: 'task'});
const wt = await worktree({operation: 'claim', parentScriptId, agentId: 'agent-A'});
// ... develop ...
await worktree({operation: 'merge', worktreeScriptId: wt.scriptId});
```

### Conflict Detection

Uses `baseHashes` (Git SHA-1 at worktree creation) for 3-way merge logic:
- Parent modified only → safe to sync
- Worktree modified only → safe to merge
- Both modified differently → conflict

**Concurrency:** File-based locking with heartbeat (15min timeout, 60s refresh)

**Files:** `src/tools/worktree/WorktreeTool.ts`, `WorktreeLockManager.ts`, `WorktreeStateManager.ts`, `src/types/worktreeTypes.ts`
