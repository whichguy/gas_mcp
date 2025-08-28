# Git Sync Tools - Interoperability Guide

## Overview

The MCP GAS server's git sync tools provide comprehensive integration between Google Apps Script, local git repositories, and GitHub. This guide details how these tools work together with standard git commands, GitHub CLI (gh), and the GitHub MCP server.

## Tool Architecture

### Core Git Sync Tools (5 tools)

1. **gas_git_init** - Initialize git association
2. **gas_git_sync** - Bidirectional synchronization
3. **gas_git_status** - Check association and sync state
4. **gas_git_set_sync_folder** - Configure local sync location
5. **gas_git_get_sync_folder** - Query sync location

## Complete Workflow Examples

### Initial Setup Workflow

```typescript
// 1. Create GitHub repository (multiple options)
gh repo create owner/repo --public --clone            // GitHub CLI
mcp__github__create_repository({name: "repo"})        // GitHub MCP

// 2. Initialize GAS-Git association
gas_git_init({
  scriptId: "1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789",
  repository: "https://github.com/owner/repo.git",
  branch: "main",
  localPath: "~/projects/my-gas-app"
})

// 3. Clone repository locally
cd ~/projects
git clone https://github.com/owner/repo.git my-gas-app

// 4. Initial sync from GAS
gas_git_sync({scriptId: "..."})  // Pulls GAS files to local

// 5. Commit and push
cd ~/projects/my-gas-app
git add -A
git commit -m "Initial GAS project sync"
git push origin main
```

### Daily Development Workflow

```typescript
// Morning: Pull latest changes
cd ~/projects/my-gas-app
git pull origin main                     // Get GitHub changes
gas_git_sync({scriptId: "..."})         // Sync with GAS

// Work in GAS Editor...
// Edit code in script.google.com

// Evening: Sync back to git
gas_git_sync({scriptId: "..."})         // Pull GAS changes
git add -A
git commit -m "Feature: Added new functionality"
git push origin main

// Create pull request
gh pr create --title "Feature: New functionality" --body "..."
// OR
mcp__github__create_pull_request({...})
```

### Collaboration Workflow

```typescript
// Check project status
gas_git_status({scriptId: "..."})       // Shows sync state
gh repo view --json defaultBranchRef    // Check GitHub
mcp__github__get_repository({...})      // Detailed repo info

// Review changes before sync
git status                               // Local changes
gh pr list                               // Open PRs
mcp__github__list_pull_requests({...})  // PR details

// Safe sync with conflict handling
gas_git_sync({
  scriptId: "...",
  mergeStrategy: "manual"               // Stop for manual resolution
})

// After resolving conflicts
git add -A
git commit -m "Resolved merge conflicts"
gas_git_sync({scriptId: "..."})         // Push resolved version
```

## Tool-by-Tool Interoperability

### gas_git_init

**Works with:**
- `gh repo create` - Create repository before init
- `gh repo view --json defaultBranchRef` - Check default branch
- `mcp__github__search_repositories` - Find existing repos
- `git clone` - Clone after initialization

**Example:**
```bash
# Create repo first
gh repo create my-org/gas-project --public

# Initialize association
gas_git_init({
  scriptId: "...",
  repository: "https://github.com/my-org/gas-project.git"
})

# Clone locally
git clone https://github.com/my-org/gas-project.git
```

### gas_git_sync

**Critical Behaviors:**
- ⚠️ ALWAYS pulls from GAS first (never blind push)
- ✅ Merges intelligently using git merge-file
- 🔒 Only pushes if merge succeeds
- 🛑 Stops for manual conflict resolution

**Works with:**
- `git status` - Check before sync
- `git stash` - Save work temporarily
- `git diff` - Review changes after sync
- `git add && git commit` - Commit merged result
- `git push` - Push to GitHub
- `gh pr create` - Create pull request
- `mcp__github__get_file_contents` - Compare versions

**Example:**
```bash
# Pre-sync checks
git status                     # Check local state
git stash                      # Save uncommitted work

# Sync
gas_git_sync({scriptId: "..."})

# Post-sync
git diff                       # Review changes
git add -A
git commit -m "Synced with GAS editor changes"
git push origin main
gh pr create
```

### gas_git_status

**Works with:**
- `git status` - Compare local state
- `git log --oneline -5` - Recent commits
- `git remote -v` - Remote configuration
- `git branch -vv` - Tracking branches
- `gh repo view` - GitHub info
- `mcp__github__list_branches` - All branches
- `mcp__github__list_commits` - Commit history

**Status Interpretation:**
- `ahead > 0`: Local commits need pushing → `git push`
- `behind > 0`: Remote has new commits → `git pull`
- `modified > 0`: Uncommitted changes → `git add && git commit`
- `clean = true`: Ready for gas_git_sync

### gas_git_set_sync_folder

**Works with:**
- `pwd` - Current directory
- `git status` - Check before moving
- `git stash` - Save work before move
- `cd <newPath>` - Navigate after move
- `git remote -v` - Verify remotes preserved
- `gh repo clone` - Alternative fresh clone

**Example:**
```bash
# Check current location
gas_git_get_sync_folder({scriptId: "..."})

# Ensure clean state
git status
git stash

# Move to new location
gas_git_set_sync_folder({
  scriptId: "...",
  localPath: "~/organized/gas-projects/my-app",
  moveExisting: true
})

# Verify move
cd ~/organized/gas-projects/my-app
git status
git remote -v
```

### gas_git_get_sync_folder

**Works with:**
- `cd <syncFolder>` - Navigate to folder
- `git status` - Check state
- `git log` - View history
- `gh repo clone` - Clone if missing
- `mcp__github__get_repository` - Compare states

## File Transformations

The git sync tools automatically handle:

1. **README transformation**
   - `README.md` ↔ `README.html` (with styling)
   - Preserves markdown in HTML comments

2. **Dotfile handling**
   - `.gitignore` → `_gitignore.gs` (CommonJS module)
   - `.env` → `_env.gs` (secure handling)

3. **Git config files** (NEW)
   - `.git/config` → `.git/config.gs` (INI format preserved)
   - `.git/info/attributes` → `.git/info/attributes.gs`
   - Supports multiple git projects in one GAS project

## Multi-Project Support

GAS projects can contain multiple git-enabled subprojects:

```typescript
// Root project
gas_git_init({
  scriptId: "...",
  repository: "https://github.com/org/main.git",
  projectPath: ""  // Root .git/
})

// Subproject
gas_git_init({
  scriptId: "...",
  repository: "https://github.com/org/library.git",
  projectPath: "libs/shared"  // Creates libs/shared/.git/
})

// Sync specific project
gas_git_sync({
  scriptId: "...",
  projectPath: "libs/shared"
})
```

## Error Handling & Recovery

### Merge Conflicts

```bash
# Conflict detected during sync
gas_git_sync({scriptId: "..."})
# → Creates .git-gas/ folder with conflict files

# Manual resolution
cd sync-folder/.git-gas
# Edit conflict files
git add .
git commit -m "Resolved conflicts"

# Retry sync
gas_git_sync({scriptId: "..."})
```

### Force Overwrite (Dangerous)

```typescript
// Take GAS version (lose local changes)
gas_git_sync({
  scriptId: "...",
  forceOverwrite: true,
  mergeStrategy: "theirs"
})

// Take local version (overwrite GAS)
gas_git_sync({
  scriptId: "...",
  forceOverwrite: true,
  mergeStrategy: "ours"
})
```

## Best Practices

1. **Always check status before operations**
   ```bash
   gas_git_status({scriptId: "..."})
   git status
   gh repo view
   ```

2. **Commit before syncing**
   ```bash
   git add -A
   git commit -m "Save work before sync"
   gas_git_sync({scriptId: "..."})
   ```

3. **Use pull-only for testing**
   ```typescript
   gas_git_sync({
     scriptId: "...",
     direction: "pull-only"  // Safe exploration
   })
   ```

4. **Document sync direction in commits**
   ```bash
   git commit -m "Sync from GAS: Added editor changes"
   git commit -m "Sync to GAS: Deployed local features"
   ```

## Integration Points

### With GitHub MCP Server

- **Repository Management**
  - `mcp__github__create_repository` → `gas_git_init`
  - `mcp__github__get_repository` → `gas_git_status`
  
- **Pull Request Workflow**
  - `gas_git_sync` → `mcp__github__create_pull_request`
  - `mcp__github__list_pull_requests` → `gas_git_sync`

- **File Comparison**
  - `mcp__github__get_file_contents` ↔ GAS file contents
  - `mcp__github__list_commits` → Sync history

### With Git Commands

- **Standard Workflow**
  - `git clone` → `gas_git_sync` → `git add/commit/push`
  
- **Branch Management**
  - `git checkout -b feature` → develop → `gas_git_sync`
  - `git merge main` → `gas_git_sync` → `git push`

### With GitHub CLI (gh)

- **Repository Operations**
  - `gh repo create` → `gas_git_init`
  - `gh repo clone` → sync folder setup
  
- **PR Workflow**
  - `gas_git_sync` → `gh pr create`
  - `gh pr merge` → `gas_git_sync`

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Project not git-linked" | Run `gas_git_init` first |
| "Merge conflicts detected" | Check `.git-gas/` folder for conflict files |
| "Sync folder not found" | Run `gas_git_get_sync_folder` to find location |
| "Behind remote" | Run `git pull` before `gas_git_sync` |
| "Ahead of remote" | Run `git push` after `gas_git_sync` |

## Security Notes

- OAuth tokens stored securely in OS keychain
- Git credentials managed by system git
- `.git/config.gs` in GAS is read-only via API
- Sensitive files (.env) handled with care

## Performance Tips

- Use `pull-only` for quick updates
- Batch commits before syncing
- Keep sync folders on SSD for speed
- Use `forceOverwrite` sparingly (data loss risk)