# Git Sync Workflows for MCP GAS

Complete guide for Git integration with Google Apps Script through the MCP GAS server.

## Overview

The Git Sync system provides safe, two-phase synchronization between Google Apps Script projects and local Git repositories. It uses `rsync` for unidirectional sync with plan→execute workflow, and `git_feature` for feature branch management.

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

### 3. Two-Phase Sync Pattern (rsync)

**Critical:** Every rsync operation follows a two-phase pattern:
1. **PLAN**: Compute diff and create sync plan (5-minute TTL)
2. **EXECUTE**: Validate and apply plan (with optional deletion confirmation)

This ensures safety by allowing review before changes are applied.

---

## Tool Reference

### Core Git Sync Tools (3 tools)

1. **rsync** - Two-phase unidirectional sync (plan→execute)
2. **git_feature** - Feature branch management (start/commit/push/finish/rollback/list/switch)
3. **config** - Configure sync folder location

### rsync (Two-Phase Sync)

Perform safe unidirectional synchronization with plan→execute workflow.

**Operations:**
- `plan` - Create sync plan (requires direction: pull or push)
- `execute` - Execute a plan (requires planId, optionally confirmDeletions)
- `status` - Check plan status
- `cancel` - Cancel pending plan

```typescript
// 1. Create sync plan (pull from GAS to local)
rsync({
  operation: "plan",
  scriptId: "1abc...",
  direction: "pull"  // or "push"
})

// Response shows what will be synced
{
  planId: "uuid-123...",
  direction: "pull",
  additions: ["utils.js", "config.js"],
  modifications: ["main.js"],
  deletions: [],
  ttl: "5 minutes",
  expiresAt: "2024-01-20T10:35:00Z"
}

// 2. Execute the plan
rsync({
  operation: "execute",
  scriptId: "1abc...",
  planId: "uuid-123...",
  confirmDeletions: true  // Required if plan has deletions
})

// Response confirms sync
{
  success: true,
  filesAdded: 2,
  filesModified: 1,
  filesDeleted: 0
}
```

**Advanced Options:**
```typescript
rsync({
  operation: "plan",
  scriptId: "1abc...",
  direction: "pull",
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
rsync({ operation: "plan", scriptId: "1abc...", direction: "pull" })
rsync({ operation: "execute", scriptId: "1abc...", planId: "..." })

// 5. Commit and push
// git add -A
// git commit -m "Initial GAS project sync"
// git push -u origin main
```

### Workflow 2: Daily Development

```typescript
// Morning: Pull latest changes from GAS
rsync({ operation: "plan", scriptId: "1abc...", direction: "pull" })
rsync({ operation: "execute", scriptId: "1abc...", planId: "..." })

// Work in GAS Editor...
// Edit code in script.google.com

// Evening: Pull changes and commit
rsync({ operation: "plan", scriptId: "1abc...", direction: "pull" })
rsync({ operation: "execute", scriptId: "1abc...", planId: "..." })

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
// 1. Create sync plan
rsync({ operation: "plan", scriptId: "1abc...", direction: "pull" })

// Response shows deletions
{
  planId: "uuid-123...",
  deletions: ["old-file.js", "deprecated.js"],
  warning: "Plan includes file deletions. Use confirmDeletions: true to proceed."
}

// 2. Execute with deletion confirmation
rsync({
  operation: "execute",
  scriptId: "1abc...",
  planId: "uuid-123...",
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

### 1. Always Use Two-Phase Sync
```typescript
// Plan first, then execute after review
rsync({ operation: "plan", scriptId: "...", direction: "pull" })
// Review plan output
rsync({ operation: "execute", scriptId: "...", planId: "..." })
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
| "Plan expired" | Plans have 5-minute TTL, create new plan |
| "Uncommitted changes" | Use `force: true` or commit changes first |
| "Deletions require confirmation" | Add `confirmDeletions: true` to execute |

### Error Recovery

**Plan Expired:**
```typescript
// Create new plan
rsync({ operation: "plan", scriptId: "...", direction: "pull" })
```

**Uncommitted Changes:**
```typescript
// Option 1: Force (skip check)
rsync({ operation: "plan", scriptId: "...", direction: "pull", force: true })

// Option 2: Commit first
git_feature({ operation: "commit", scriptId: "...", message: "WIP" })
rsync({ operation: "plan", scriptId: "...", direction: "pull" })
```

---

## Multi-Project Support (Poly-Repo)

GAS projects can contain multiple git-enabled subprojects:

```typescript
// Root project sync
rsync({ operation: "plan", scriptId: "...", direction: "pull" })

// Subproject sync
rsync({
  operation: "plan",
  scriptId: "...",
  direction: "pull",
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

- ✅ Safe, two-phase synchronization (plan→execute)
- ✅ Feature branch management via git_feature
- ✅ Deletion safety with confirmation
- ✅ Self-documenting projects via `.git/config`
- ✅ File transformation handling
- ✅ Multi-project (poly-repo) support
- ✅ Clear error messages and recovery paths

This approach maximizes safety while enabling powerful Git integration workflows for Google Apps Script development.
