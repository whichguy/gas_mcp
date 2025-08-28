# Git Sync Workflows for MCP GAS

This document describes the new Git synchronization workflows for the MCP GAS server, which provide safe, merge-based synchronization between Google Apps Script projects and Git repositories.

## Overview

The Git Sync system separates concerns between the MCP server (which handles GAS operations) and standard git/GitHub tools (which handle version control). This separation allows LLMs to leverage existing git knowledge while maintaining safe, merge-based synchronization with GAS projects.

## Core Concepts

### 1. Association Marker (`.git.gs` file)

Every GAS project with Git association contains a special `.git.gs` file that serves as a self-documenting marker:

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
- Makes projects self-documenting about their Git association
- Stores in the GAS project itself (travels with the code)
- Provides metadata for sync operations
- Shows LLMs where to perform git operations

### 2. Sync Folders

Sync folders are local filesystem directories where:
- GAS files are synchronized for git operations
- LLMs can run standard git commands
- Three-way merges happen (GAS ↔ Local ↔ Git)
- File transformations occur (README.md ↔ README.html)

### 3. Safe Pull-Merge-Push Pattern

Every sync operation follows this safe pattern:
1. **PULL**: Always pull from GAS first to get latest remote state
2. **MERGE**: Merge with local git changes (local is merge authority)
3. **PUSH**: Push merged result back to GAS

This ensures no data loss and maintains consistency.

## Tool Reference

### gas_git_init

Initialize Git association for a GAS project.

```typescript
// Initialize with existing repo
gas_git_init({
  scriptId: "1abc...",
  repository: "https://github.com/user/repo.git",
  branch: "main",
  syncFolder: "/Users/user/gas-projects/my-project"
})

// Response includes next steps
{
  success: true,
  gitConfig: { ... },
  syncFolder: "/Users/user/gas-projects/my-project",
  recommendedNextSteps: [
    "cd /Users/user/gas-projects/my-project",
    "git clone https://github.com/user/repo.git .",
    "gas_git_sync({ scriptId: '1abc...' })"
  ]
}
```

### gas_git_sync

Perform safe pull-merge-push synchronization.

```typescript
// Basic sync with defaults
gas_git_sync({
  scriptId: "1abc..."
})

// Advanced sync with options
gas_git_sync({
  scriptId: "1abc...",
  mergeStrategy: "theirs",  // ours|theirs|manual
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

### gas_git_status

Check Git association and sync status.

```typescript
gas_git_status({
  scriptId: "1abc..."
})

// Response shows association and differences
{
  hasGitAssociation: true,
  gitConfig: { ... },
  syncFolder: "/Users/user/gas-projects/my-project",
  localChanges: 3,
  remoteChanges: 2,
  conflicts: [],
  recommendedNextSteps: [
    "gas_git_sync({ scriptId: '1abc...' }) to synchronize",
    "cd /Users/user/gas-projects/my-project && git status"
  ]
}
```

### gas_git_set_sync_folder

Set or update the sync folder for a project.

```typescript
gas_git_set_sync_folder({
  scriptId: "1abc...",
  syncFolder: "/Users/user/new-location/project"
})

// Response confirms update
{
  success: true,
  scriptId: "1abc...",
  oldFolder: "/Users/user/gas-projects/my-project",
  newFolder: "/Users/user/new-location/project",
  recommendedNextSteps: [
    "mv /Users/user/gas-projects/my-project /Users/user/new-location/project",
    "gas_git_sync({ scriptId: '1abc...' })"
  ]
}
```

### gas_git_get_sync_folder

Query the sync folder for a project.

```typescript
gas_git_get_sync_folder({
  scriptId: "1abc..."
})

// Response shows current configuration
{
  scriptId: "1abc...",
  syncFolder: "/Users/user/gas-projects/my-project",
  exists: true,
  isGitRepo: true,
  recommendedNextSteps: [
    "cd /Users/user/gas-projects/my-project",
    "git status"
  ]
}
```

## Common Workflows

### Workflow 1: Initialize New Project with Git

```bash
# 1. Create association
gas_git_init({
  scriptId: "1abc...",
  repository: "https://github.com/user/new-repo.git"
})

# 2. LLM follows recommended steps
cd /Users/user/gas-projects/project-1abc
git init
git remote add origin https://github.com/user/new-repo.git

# 3. Sync to pull GAS files
gas_git_sync({ scriptId: "1abc..." })

# 4. Commit and push
git add -A
git commit -m "Initial GAS project sync"
git push -u origin main
```

### Workflow 2: Clone Existing Repo to GAS

```bash
# 1. Initialize association
gas_git_init({
  scriptId: "1abc...",
  repository: "https://github.com/user/existing-repo.git"
})

# 2. Clone the repository
cd /Users/user/gas-projects/project-1abc
git clone https://github.com/user/existing-repo.git .

# 3. Sync to push to GAS
gas_git_sync({ scriptId: "1abc..." })
```

### Workflow 3: Create Feature Branch

```bash
# 1. Check current status
gas_git_status({ scriptId: "1abc..." })

# 2. Create branch in sync folder
cd /Users/user/gas-projects/project-1abc
git checkout -b feature/new-feature

# 3. Make changes in GAS
# ... edit files in GAS editor ...

# 4. Sync to pull changes
gas_git_sync({ scriptId: "1abc..." })

# 5. Commit and push branch
git add -A
git commit -m "Add new feature"
git push origin feature/new-feature

# 6. Create PR using gh CLI
gh pr create --title "New feature" --body "Description"
```

### Workflow 4: Handle Merge Conflicts

```bash
# 1. Attempt sync
gas_git_sync({ scriptId: "1abc..." })
# Returns: { conflicts: ["utils.js", "config.js"] }

# 2. Resolve in sync folder
cd /Users/user/gas-projects/project-1abc
git status  # See conflicted files
vim utils.js  # Edit conflicts
vim config.js  # Edit conflicts

# 3. Mark resolved and sync again
git add utils.js config.js
gas_git_sync({ scriptId: "1abc...", mergeStrategy: "ours" })

# 4. Commit resolution
git commit -m "Resolve merge conflicts"
git push
```

## File Transformations

The sync system automatically handles special file transformations:

### README Files
- `README.md` (local) ↔ `README.html` (GAS)
- Markdown converted to styled HTML for GAS storage
- HTML converted back to Markdown when pulling

### Dotfiles
- `.gitignore` (local) ↔ `_gitignore.gs` (GAS)
- `.env` (local) ↔ `_env.gs` (GAS)
- Dotfiles wrapped as CommonJS modules in GAS

### CommonJS Wrapping
- All `.js` files automatically wrapped/unwrapped
- User sees clean code, GAS gets proper module structure

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

## Best Practices

### 1. Always Check Status First
```typescript
gas_git_status({ scriptId: "..." })  // Before any operation
```

### 2. Use Dry Run for Testing
```typescript
gas_git_sync({ scriptId: "...", dryRun: true })  // Preview changes
```

### 3. Commit After Sync
```bash
gas_git_sync({ scriptId: "..." })
cd /path/to/sync/folder
git add -A
git commit -m "Sync with GAS"
git push
```

### 4. Set Up CI/CD
```yaml
# .github/workflows/gas-sync.yml
on:
  push:
    branches: [main]
jobs:
  sync:
    steps:
      - uses: actions/checkout@v2
      - run: gas_git_sync({ scriptId: "${{ secrets.GAS_SCRIPT_ID }}" })
```

### 5. Use Branch Protection
- Require PR reviews before merging to main
- Run tests in CI before allowing merge
- Use gas_git_sync in merge checks

## Troubleshooting

### "No git association found"
- Run `gas_git_init` first to create `.git.gs` file

### "Sync folder does not exist"
- Check path with `gas_git_get_sync_folder`
- Create folder or update path with `gas_git_set_sync_folder`

### "Merge conflicts detected"
- Review conflicts in sync folder
- Resolve manually or change merge strategy
- Re-run sync after resolution

### "Permission denied"
- Check GAS project permissions
- Ensure OAuth token has necessary scopes
- Verify local folder write permissions

## Migration from Old Tools

If using old git integration tools, migrate as follows:

1. **Replace gas_pull/gas_push** → Use `gas_git_sync`
2. **Replace gas_init** → Use `gas_git_init`
3. **Replace gas_commit** → Use standard `git commit` in sync folder
4. **Replace gas_git_clone** → Clone with git, then `gas_git_sync`
5. **Remove mirror root** → Use sync folders instead

## Security Considerations

1. **OAuth Tokens**: Never stored in `.git.gs` files
2. **Credentials**: Use git credential manager for auth
3. **Sensitive Files**: Add to `.gitignore` before sync
4. **Public Repos**: Review `.git.gs` before making public
5. **Sync Folders**: Keep in secure locations with proper permissions

## Performance Tips

1. **Exclude Large Files**: Use excludeFiles parameter
2. **Partial Sync**: Use includeFiles for specific patterns  
3. **Dry Run First**: Test with dryRun for large projects
4. **Parallel Operations**: Sync multiple projects concurrently
5. **Cache Git Repos**: Keep clones to avoid re-cloning

## Integration with LLM Workflows

The design enables LLMs to:

1. **Understand Context**: Read `.git.gs` to know repository
2. **Use Git Knowledge**: Run standard git commands
3. **Follow Recommendations**: Use suggested next steps
4. **Handle Errors**: Clear error messages with solutions
5. **Maintain Safety**: Always pull-merge-push pattern

## Summary

The new Git Sync system provides:
- ✅ Safe, merge-based synchronization
- ✅ Separation of concerns (MCP vs Git)
- ✅ Self-documenting projects via `.git.gs`
- ✅ LLM-friendly with clear next steps
- ✅ File transformation handling
- ✅ Standard git workflow compatibility

This approach maximizes safety while enabling powerful Git integration workflows for Google Apps Script development.