# Three-Way Merge Workflow for Git-GAS Integration

## Overview

The Git-GAS integration now supports sophisticated three-way merge capabilities to handle conflicts between Git repositories, local cache, and Google Apps Script projects. This ensures data integrity while allowing flexible workflows.

## Architecture

### Three Components in Merge

1. **Git Version**: Code from the Git repository (remote or local branch)
2. **Local Cache**: Temporary working copy at `~/gas-repos/[scriptId]/`
3. **GAS Version**: Code from Google Apps Script project (source of truth)

### Merge Strategies

- **`auto`** (default): Intelligent merge based on content analysis
  - If two versions match, uses the differing one
  - Prefers GAS for conflicts (source of truth)
  - Line-by-line merge for complex conflicts

- **`gas-wins`**: Always use GAS version (ignores Git changes)
- **`git-wins`**: Always use Git version (overwrites GAS)
- **`manual`**: Creates conflict markers for manual resolution
- **`ours`**: Local cache wins
- **`theirs`**: Git version wins

## Command Workflows

### gas_pull - Pull from Git to GAS

**Workflow**: Git Remote → Three-Way Merge → GAS

```bash
# Basic pull with auto merge
gas_pull --scriptId="YOUR_SCRIPT_ID" --gitUrl="https://github.com/user/repo.git"

# Force Git changes (ignore GAS)
gas_pull --scriptId="YOUR_SCRIPT_ID" --mergeStrategy="git-wins"

# Manual conflict resolution
gas_pull --scriptId="YOUR_SCRIPT_ID" --mergeStrategy="manual"

# Skip backup
gas_pull --scriptId="YOUR_SCRIPT_ID" --backup=false
```

**Process**:
1. Save current local cache state
2. Pull from Git remote
3. Fetch current GAS state
4. Perform three-way merge (Git, Local, GAS)
5. Create backup (optional)
6. Apply merged changes to GAS
7. Commit merge result to Git

### gas_push - Push from GAS to Git

**Workflow**: GAS → Three-Way Merge → Git Remote

```bash
# Basic push with auto merge
gas_push --scriptId="YOUR_SCRIPT_ID"

# Force GAS changes (ignore Git)
gas_push --scriptId="YOUR_SCRIPT_ID" --mergeStrategy="gas-wins"

# Custom commit message
gas_push --scriptId="YOUR_SCRIPT_ID" --commitMessage="Update from GAS"

# Manual conflict resolution
gas_push --scriptId="YOUR_SCRIPT_ID" --mergeStrategy="manual"
```

**Process**:
1. Fetch current GAS state
2. Get current local cache state
3. Pull from Git remote (get latest)
4. Perform three-way merge (Git, Local, GAS)
5. Create backup (optional)
6. Write merged files to local
7. Commit merged state
8. Push to Git remote

## Conflict Resolution

### Automatic Resolution (auto strategy)

The system automatically resolves conflicts using these rules:

1. **Identical files**: No action needed
2. **Two match, one differs**: Use the differing version (has changes)
3. **All three differ**: Line-by-line merge, preferring GAS for conflicts

### Manual Resolution

When using `mergeStrategy="manual"`, conflict markers are created:

```javascript
<<<<<<< GAS (Source of Truth)
function myFunction() {
  // GAS version
}
||||||| LOCAL (Cache)
function myFunction() {
  // Local cache version
}
======= GIT (Repository)
function myFunction() {
  // Git version
}
>>>>>>> GIT
```

## Backup System

By default, backups are created before merge operations:

- Location: `~/gas-repos/[scriptId]/.gas-backup/[timestamp]/`
- Contains: Full GAS project state before merge
- Disable: Use `--backup=false` flag

## Best Practices

### 1. Regular Synchronization

Sync frequently to minimize conflicts:
```bash
# Morning: Pull Git changes to GAS
gas_pull --scriptId="YOUR_SCRIPT_ID"

# Evening: Push GAS changes to Git
gas_push --scriptId="YOUR_SCRIPT_ID" --commitMessage="Daily sync"
```

### 2. Handle Conflicts Promptly

When conflicts occur:
```bash
# Use manual strategy to see conflicts
gas_pull --scriptId="YOUR_SCRIPT_ID" --mergeStrategy="manual"

# Review conflict markers in files
# Edit files to resolve conflicts
# Commit resolved state
gas_commit --scriptId="YOUR_SCRIPT_ID" --message="Resolved merge conflicts"
gas_push --scriptId="YOUR_SCRIPT_ID"
```

### 3. Use Appropriate Strategies

- **Development**: Use `auto` for regular development
- **Deployment**: Use `git-wins` to deploy from Git to GAS
- **Backup**: Use `gas-wins` to preserve GAS state
- **Review**: Use `manual` to review all changes

### 4. Test After Merge

Always test your GAS project after merge:
```bash
# Run a test function
gas_run --scriptId="YOUR_SCRIPT_ID" --js_statement="require('TestModule').runTests()"
```

## Examples

### Scenario 1: Deploy Git Feature Branch to GAS

```bash
# 1. Create feature branch in Git
git checkout -b feature/new-api

# 2. Develop and commit changes
git commit -m "Add new API endpoints"

# 3. Deploy to GAS with Git priority
gas_pull --scriptId="YOUR_SCRIPT_ID" \
         --branch="feature/new-api" \
         --mergeStrategy="git-wins"

# 4. Test in GAS
gas_run --scriptId="YOUR_SCRIPT_ID" \
        --js_statement="require('API').test()"
```

### Scenario 2: Capture GAS Hotfix to Git

```bash
# 1. Make changes in GAS editor

# 2. Push to Git with GAS priority
gas_push --scriptId="YOUR_SCRIPT_ID" \
         --mergeStrategy="gas-wins" \
         --commitMessage="Hotfix: Fix production bug"

# 3. Create Git PR
git push origin main
```

### Scenario 3: Resolve Complex Merge

```bash
# 1. Pull with manual strategy
gas_pull --scriptId="YOUR_SCRIPT_ID" \
         --mergeStrategy="manual"

# 2. Review conflicts in local mirror
cd ~/gas-repos/YOUR_SCRIPT_ID/
grep -r "<<<<<<< GAS" .

# 3. Edit files to resolve conflicts
# Remove conflict markers, keep desired code

# 4. Commit resolution
gas_commit --scriptId="YOUR_SCRIPT_ID" \
           --message="Resolved: Merge Git feature with GAS hotfix"

# 5. Push resolved state
gas_push --scriptId="YOUR_SCRIPT_ID"
```

## Troubleshooting

### "Has conflicts" Status

Your operation completed but with conflicts:
- Check `conflictFiles` in response
- Review files with conflict markers
- Resolve manually and commit

### Backup Recovery

To restore from backup:
```bash
# List backups
ls -la ~/gas-repos/YOUR_SCRIPT_ID/.gas-backup/

# Restore specific backup
cp -r ~/gas-repos/YOUR_SCRIPT_ID/.gas-backup/2024-01-01T12:00:00.000Z/* \
      ~/gas-repos/YOUR_SCRIPT_ID/

# Push restored state to GAS
gas_push --scriptId="YOUR_SCRIPT_ID" \
         --mergeStrategy="gas-wins"
```

### Line Ending Issues

If you see unexpected conflicts:
- Check Git config: `git config core.autocrlf`
- Normalize line endings: `dos2unix` or `unix2dos`
- Use `.gitattributes` to set consistent line endings

## Configuration

### Set Default Merge Strategy

While not yet implemented in config, you can alias commands:

```bash
# In ~/.bashrc or ~/.zshrc
alias gas-pull-safe='gas_pull --mergeStrategy="manual" --backup=true'
alias gas-push-safe='gas_push --mergeStrategy="manual" --backup=true'
alias gas-deploy='gas_pull --mergeStrategy="git-wins"'
alias gas-backup='gas_push --mergeStrategy="gas-wins"'
```

## Security Considerations

1. **Backup Sensitive Files**: Always backup before merging production code
2. **Review Manual Merges**: Check for accidentally exposed secrets
3. **Test Merged Code**: Verify security functions still work correctly
4. **Audit Merge History**: Use `gas_log` to review merge commits

## Performance Tips

1. **Minimize Conflicts**: Sync frequently to reduce merge complexity
2. **Use Specific Paths**: Target specific directories when possible
3. **Clean Cache**: Remove old backups periodically
4. **Batch Operations**: Combine multiple file changes before syncing

## Future Enhancements

Planned improvements:
- Visual merge tool integration
- Automatic conflict resolution patterns
- Merge preview mode
- Rollback command
- Conflict resolution templates