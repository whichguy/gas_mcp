# Git Sync Workflows for MCP GAS

Complete guide for Git integration with Google Apps Script through the MCP GAS server.

## Overview

The Git Sync system provides safe, merge-based synchronization between Google Apps Script projects and Git repositories. It separates concerns between the MCP server (GAS operations) and standard git/GitHub tools (version control), allowing LLMs to leverage existing git knowledge while maintaining safe synchronization.

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Tool Reference](#tool-reference)
3. [Common Workflows](#common-workflows)
4. [Interoperability Guide](#interoperability-guide)
5. [Merge Strategies](#merge-strategies)
6. [File Transformations](#file-transformations)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Core Concepts

### 1. Association Marker (`.git.gs` file)

Every GAS project with Git association contains a `.git.gs` file:

```javascript
// Example .git.gs file content
module.exports = {
  repository: 'https://github.com/user/repo.git',
  branch: 'main',
  syncFolder: '/Users/user/gas-projects/my-project',
  lastSync: '2024-01-20T10:30:00Z'
};
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
- Three-way merges happen (GAS ↔ Local ↔ Git)
- File transformations occur (README.md ↔ README.html)

### 3. Safe Pull-Merge-Push Pattern

**Critical:** Every sync operation follows this safe pattern:
1. **PULL**: Always pull from GAS first (latest remote state)
2. **MERGE**: Merge with local git changes (local is merge authority)
3. **PUSH**: Push merged result back to GAS

⚠️ **Never blindly pushes** - always pulls first to prevent data loss

---

## Tool Reference

### Core Git Sync Tools (2 tools - LOCAL-FIRST)

1. **local_sync** - Bidirectional synchronization (ALWAYS pull→merge→push)
2. **config (action: get/set, type: sync_folder)** - Configure local sync location

**IMPORTANT:** `git_init` tool was removed. You must manually create `.git/config.gs` breadcrumb in GAS before using `local_sync`.

### Manual Breadcrumb Creation (Required First Step)

Before using local_sync, you MUST manually create `.git/config.gs` in your GAS project:

```typescript
// 1. Create .git/config.gs breadcrumb in GAS
gas_write({
  scriptId: "1abc...",
  fileName: ".git/config.gs",
  content: `[remote "origin"]
\turl = https://github.com/user/repo.git
[branch "main"]
[sync]
\tlocalPath = /Users/user/gas-projects/my-project`
})

// 2. Create local git repo
// cd /Users/user/gas-projects/my-project
// git init
// git remote add origin https://github.com/user/repo.git

// 3. Now you can use local_sync
local_sync({
  scriptId: "1abc..."
})
```

### local_sync (formerly local_sync)

Perform safe pull-merge-push synchronization.

**Critical Behaviors:**
- ⚠️ ALWAYS pulls from GAS first (never blind push)
- ✅ Merges intelligently using git merge-file
- 🔒 Only pushes if merge succeeds
- 🛑 Stops for manual conflict resolution

```typescript
// Basic sync with defaults
local_sync({
  scriptId: "1abc..."
})

// Advanced sync with options
local_sync({
  scriptId: "1abc...",
  mergeStrategy: "theirs",  // ours|theirs|manual
  direction: "pull-only",   // sync|pull-only|push-only
  dryRun: true,
  includeFiles: ["*.js", "*.html"],
  excludeFiles: ["test/*"]
})

// Response with git command suggestions
{
  success: true,
  pulled: 5,
  merged: 3,
  pushed: 8,
  conflicts: [],
  syncFolder: "/Users/user/gas-projects/my-project",
  recommendedNextSteps: [
    "cd /Users/user/gas-projects/my-project",
    "git add -A",
    "git commit -m 'Sync with GAS project'",
    "git push origin main"
  ]
}
```

### config (action: get, type: sync_folder) - Status Check

Check Git association and sync folder status. **NOTE:** `config({action: "get", type: "sync_folder"})` tool was removed - use `config` instead.

```typescript
config({
  action: "get",
  type: "sync_folder",
  scriptId: "1abc..."
})

// Response shows sync folder and git status
{
  scriptId: "1abc...",
  syncFolder: "/Users/user/gas-projects/my-project",
  exists: true,
  isGitRepo: true,
  gitStatus: {
    branch: "main",
    ahead: 0,
    behind: 0,
    modified: 2,
    untracked: 1,
    clean: false
  },
  recommendedNextSteps: [
    "cd /Users/user/gas-projects/my-project",
    "git status"
  ]
}
```

**Status Interpretation:**
- `ahead > 0`: Local commits need pushing → `git push`
- `behind > 0`: Remote has new commits → `git pull`
- `modified > 0`: Uncommitted changes → `git add && git commit`
- `clean = true`: Ready for local_sync

### gas_config (action: set, type: sync_folder)

Set or update the sync folder for a project.

```typescript
gas_config (action: set, type: sync_folder)({
  scriptId: "1abc...",
  syncFolder: "/Users/user/new-location/project",
  moveExisting: true  // Physically move git repo
})

// Response confirms update
{
  success: true,
  scriptId: "1abc...",
  oldFolder: "/Users/user/gas-projects/my-project",
  newFolder: "/Users/user/new-location/project",
  recommendedNextSteps: [
    "cd /Users/user/new-location/project",
    "git remote -v  # Verify remotes preserved",
    "local_sync({ scriptId: '1abc...' })"
  ]
}
```

### gas_config (action: get, type: sync_folder)

Query the sync folder for a project.

```typescript
gas_config (action: get, type: sync_folder)({
  scriptId: "1abc..."
})

// Response shows current configuration
{
  scriptId: "1abc...",
  syncFolder: "/Users/user/gas-projects/my-project",
  exists: true,
  isGitRepo: true,
  gitStatus: { branch: "main", ... },
  recommendedNextSteps: [
    "cd /Users/user/gas-projects/my-project",
    "git status"
  ]
}
```

---

## Common Workflows

### Workflow 1: Initialize New Project with Git

```bash
# 1. Create GitHub repository (choose method)
gh repo create owner/repo --public --clone           # GitHub CLI
# OR
mcp__github__create_repository({name: "repo"})       # GitHub MCP

# 2. Manually create .git/config.gs breadcrumb in GAS
gas_write({
  scriptId: "1abc...",
  fileName: ".git/config.gs",
  content: `[remote "origin"]
\turl = https://github.com/owner/repo.git
[branch "main"]
[sync]
\tlocalPath = ~/projects/my-gas-app`
})

# 3. Create local git repo
cd ~/projects
mkdir my-gas-app && cd my-gas-app
git init
git remote add origin https://github.com/owner/repo.git

# 4. Initial sync from GAS
local_sync({scriptId: "1abc..."})  // Pulls GAS files to local

# 5. Commit and push
git add -A
git commit -m "Initial GAS project sync"
git push -u origin main
```

### Workflow 2: Clone Existing Repo to GAS

```bash
# 1. Manually create .git/config.gs breadcrumb
gas_write({
  scriptId: "1abc...",
  fileName: ".git/config.gs",
  content: `[remote "origin"]
\turl = https://github.com/user/existing-repo.git
[branch "main"]
[sync]
\tlocalPath = /Users/user/gas-projects/project-1abc`
})

# 2. Clone the repository
cd /Users/user/gas-projects
git clone https://github.com/user/existing-repo.git project-1abc
cd project-1abc

# 3. Sync to push to GAS
local_sync({scriptId: "1abc..."})
```

### Workflow 3: Daily Development

```typescript
// Morning: Pull latest changes
cd ~/projects/my-gas-app
git pull origin main                     // Get GitHub changes
local_sync({scriptId: "..."})         // Sync with GAS

// Work in GAS Editor...
// Edit code in script.google.com

// Evening: Sync back to git
local_sync({scriptId: "..."})         // Pull GAS changes
git diff                                 // Review changes
git add -A
git commit -m "Feature: Added new functionality"
git push origin main

// Create pull request
gh pr create --title "Feature: New functionality" --body "..."
// OR
mcp__github__create_pull_request({...})
```

### Workflow 4: Create Feature Branch

```bash
# 1. Check current status
config({action: "get", type: "sync_folder", scriptId: "1abc..."})

# 2. Create branch in sync folder
cd /Users/user/gas-projects/project-1abc
git checkout -b feature/new-feature

# 3. Make changes in GAS
# ... edit files in GAS editor ...

# 4. Sync to pull changes
local_sync({scriptId: "1abc..."})

# 5. Commit and push branch
git add -A
git commit -m "Add new feature"
git push origin feature/new-feature

# 6. Create PR using gh CLI or GitHub MCP
gh pr create --title "New feature" --body "Description"
# OR
mcp__github__create_pull_request({
  owner: "org",
  repo: "repo",
  title: "New feature",
  head: "feature/new-feature",
  base: "main"
})
```

### Workflow 5: Handle Merge Conflicts

```bash
# 1. Attempt sync
local_sync({scriptId: "1abc..."})
# Returns: { conflicts: ["utils.js", "config.js"] }
# Creates .git-gas/ folder with conflict files

# 2. Resolve in sync folder
cd /Users/user/gas-projects/project-1abc/.git-gas
git status  # See conflicted files
vim utils.js  # Edit conflicts
vim config.js  # Edit conflicts

# 3. Mark resolved and sync again
git add utils.js config.js
local_sync({scriptId: "1abc...", mergeStrategy: "ours"})

# 4. Commit resolution
git commit -m "Resolve merge conflicts"
git push
```

### Workflow 6: Collaboration

```typescript
// Check project status
config({action: "get", type: "sync_folder", scriptId: "..."})  // Shows sync state
gh repo view --json defaultBranchRef    // Check GitHub
mcp__github__get_repository({...})      // Detailed repo info

// Review changes before sync
git status                               // Local changes
gh pr list                               // Open PRs
mcp__github__list_pull_requests({...})  // PR details

// Safe sync with conflict handling
local_sync({
  scriptId: "...",
  mergeStrategy: "manual"               // Stop for manual resolution
})

// After resolving conflicts
git add -A
git commit -m "Resolved merge conflicts"
local_sync({scriptId: "..."})         // Push resolved version
```

---

## Interoperability Guide

### Integration with Git Commands

**Standard Workflow:**
```bash
git clone → local_sync → git add/commit/push
```

**Branch Management:**
```bash
git checkout -b feature → develop → local_sync
git merge main → local_sync → git push
```

**Pre-sync Checks:**
```bash
git status                     # Check local state
git stash                      # Save uncommitted work
local_sync({scriptId: "..."})
git diff                       # Review changes
git add -A && git commit
git push origin main
```

### Integration with GitHub CLI (gh)

**Repository Operations:**
```bash
gh repo create → manually create .git/config.gs breadcrumb
gh repo clone → sync folder setup
```

**PR Workflow:**
```bash
local_sync → gh pr create
gh pr merge → local_sync
```

**Status Checks:**
```bash
gh repo view
gh pr list
gh run list  # Check workflows
```

### Integration with GitHub MCP Server

**Repository Management:**
- `mcp__github__create_repository` → manually create `.git/config.gs` breadcrumb
- `mcp__github__get_repository` → `config({action: "get", type: "sync_folder"})`

**Pull Request Workflow:**
- `local_sync` → `mcp__github__create_pull_request`
- `mcp__github__list_pull_requests` → `local_sync`

**File Comparison:**
- `mcp__github__get_file_contents` ↔ GAS file contents
- `mcp__github__list_commits` → Sync history

### Multi-Tool Workflow Example

```typescript
// 1. Check project state across all tools
config({action: "get", type: "sync_folder"})({scriptId: "..."})       // GAS sync state
git status                               // Local git state
gh repo view                             // GitHub state
mcp__github__get_repository({...})      // Detailed GitHub info

// 2. Sync and review
local_sync({scriptId: "..."})
git diff
mcp__github__get_file_contents({...})  // Compare with GitHub

// 3. Commit and create PR
git add -A && git commit -m "..."
git push origin feature-branch
mcp__github__create_pull_request({...})
```

---

## Merge Strategies

### "ours" (default)
- Local/Git changes take precedence
- GAS changes incorporated where no conflict
- Safe for development workflows

### "theirs"
- GAS changes take precedence
- Local changes incorporated where no conflict
- Useful when GAS is authoritative

### "manual"
- Creates conflict markers in files
- Requires manual resolution
- Full control over merge decisions

### "auto"
- Intelligent merge based on content analysis
- If two versions match, uses the differing one
- Prefers GAS for conflicts (source of truth)
- Line-by-line merge for complex conflicts

---

## File Transformations

The sync system automatically handles special file transformations:

### README Files
- `README.md` (local) ↔ `README.html` (GAS)
- Markdown converted to styled HTML for GAS storage
- HTML converted back to Markdown when pulling
- Preserves markdown in HTML comments

### Dotfiles
- `.gitignore` (local) ↔ `_gitignore.gs` (GAS)
- `.env` (local) ↔ `_env.gs` (GAS)
- Dotfiles wrapped as CommonJS modules in GAS

### Git Config Files (NEW)
- `.git/config` → `.git/config.gs` (INI format preserved)
- `.git/info/attributes` → `.git/info/attributes.gs`
- Supports multiple git projects in one GAS project

### CommonJS Wrapping
- All `.js` files automatically wrapped/unwrapped
- User sees clean code, GAS gets proper module structure

---

## Best Practices

### 1. Always Check Status First
```typescript
config({action: "get", type: "sync_folder"})({scriptId: "..."})  // Before any operation
git status                          // Local state
gh repo view                        // Remote state
```

### 2. Commit Before Syncing
```bash
git add -A
git commit -m "Save work before sync"
local_sync({scriptId: "..."})
```

### 3. Use Dry Run for Testing
```typescript
local_sync({scriptId: "...", dryRun: true})  // Preview changes
```

### 4. Use Pull-Only for Safe Exploration
```typescript
local_sync({
  scriptId: "...",
  direction: "pull-only"  // Safe exploration, no push
})
```

### 5. Document Sync Direction in Commits
```bash
git commit -m "Sync from GAS: Added editor changes"
git commit -m "Sync to GAS: Deployed local features"
```

### 6. Set Up CI/CD
```yaml
# .github/workflows/gas-sync.yml
on:
  push:
    branches: [main]
jobs:
  sync:
    steps:
      - uses: actions/checkout@v2
      - run: local_sync({scriptId: "${{ secrets.GAS_SCRIPT_ID }}"})
```

### 7. Use Branch Protection
- Require PR reviews before merging to main
- Run tests in CI before allowing merge
- Use local_sync in merge checks

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| "No git association found" | Manually create `.git/config.gs` file in GAS using `gas_write` |
| "No .git/config.gs breadcrumb found" | Create breadcrumb with `gas_write({fileName: ".git/config.gs", content: ...})` |
| "Sync folder does not exist" | Check path with `config({action: "get", type: "sync_folder"})` |
| "Merge conflicts detected" | Check `.git-gas/` folder for conflict files |
| "Permission denied" | Check GAS permissions and OAuth scopes |
| "Project not git-linked" | Create `.git/config.gs` breadcrumb first |
| "Behind remote" | Run `git pull` before `local_sync` |
| "Ahead of remote" | Run `git push` after `local_sync` |

### Error Handling & Recovery

**Merge Conflicts:**
```bash
# Conflict detected during sync
local_sync({scriptId: "..."})
# → Creates .git-gas/ folder with conflict files

# Manual resolution
cd sync-folder/.git-gas
# Edit conflict files
git add .
git commit -m "Resolved conflicts"

# Retry sync
local_sync({scriptId: "..."})
```

**Force Overwrite (Dangerous):**
```typescript
// ⚠️ Take GAS version (lose local changes)
local_sync({
  scriptId: "...",
  forceOverwrite: true,
  mergeStrategy: "theirs"
})

// ⚠️ Take local version (overwrite GAS)
local_sync({
  scriptId: "...",
  forceOverwrite: true,
  mergeStrategy: "ours"
})
```

---

## Security Considerations

1. **OAuth Tokens**: Never stored in `.git.gs` files
2. **Credentials**: Use git credential manager for auth
3. **Sensitive Files**: Add to `.gitignore` before sync
4. **Public Repos**: Review `.git.gs` before making public
5. **Sync Folders**: Keep in secure locations with proper permissions
6. **Git Config**: `.git/config.gs` in GAS is read-only via API

---

## Performance Tips

1. **Exclude Large Files**: Use excludeFiles parameter
2. **Partial Sync**: Use includeFiles for specific patterns
3. **Dry Run First**: Test with dryRun for large projects
4. **Parallel Operations**: Sync multiple projects concurrently
5. **Cache Git Repos**: Keep clones to avoid re-cloning
6. **Use pull-only**: For quick updates without push
7. **Batch Commits**: Combine changes before syncing
8. **SSD Storage**: Keep sync folders on SSD for speed

---

## Multi-Project Support

GAS projects can contain multiple git-enabled subprojects by creating separate `.git/config.gs` files in different paths:

```typescript
// Root project - create .git/config.gs in root
gas_write({
  scriptId: "...",
  fileName: ".git/config.gs",
  content: `[remote "origin"]
\turl = https://github.com/org/main.git
[branch "main"]`
})

// Subproject - create .git/config.gs in subdirectory
gas_write({
  scriptId: "...",
  fileName: "libs/shared/.git/config.gs",
  content: `[remote "origin"]
\turl = https://github.com/org/library.git
[branch "main"]`
})

// Sync specific project
local_sync({
  scriptId: "...",
  projectPath: "libs/shared"
})
```

---

## LLM Integration

The design enables LLMs to:

1. **Understand Context**: Read `.git.gs` to know repository
2. **Use Git Knowledge**: Run standard git commands
3. **Follow Recommendations**: Use suggested next steps
4. **Handle Errors**: Clear error messages with solutions
5. **Maintain Safety**: Always pull-merge-push pattern

---

## Summary

The Git Sync system provides:

- ✅ Safe, merge-based synchronization (always pull first)
- ✅ Separation of concerns (MCP vs Git)
- ✅ Self-documenting projects via `.git.gs`
- ✅ LLM-friendly with clear next steps
- ✅ File transformation handling
- ✅ Standard git workflow compatibility
- ✅ Interoperability with git/gh/GitHub MCP
- ✅ Multi-project support
- ✅ Comprehensive error handling

This approach maximizes safety while enabling powerful Git integration workflows for Google Apps Script development.
