# Git Integration Workflow - Proper Sequencing

## Core Principle: GAS is the Source of Truth
The Google Apps Script project contains the authoritative code. Local files and Git repositories serve as:
1. **Local files** (`~/gas-repos/`): Temporary cache for Git operations
2. **Git repository**: Version control and collaboration medium
3. **GAS project**: The primary, sensitive source of truth

## Workflow Sequences

### 1. GAS → Git (Primary Workflow)
This is the safest workflow since GAS is the source of truth.

```mermaid
GAS Project (Source) → Local Cache → Git Repository (Version Control)
```

**Sequence:**
1. **gas_push**: Push GAS content to Git
   - Syncs GAS → Local (`syncGASToLocal`)
   - Commits to local Git
   - Pushes to remote repository
2. **gas_commit**: Save GAS state to local Git
   - Syncs GAS → Local
   - Creates local commit (no remote push)
3. **gas_status**: Check sync state
   - Shows GAS vs Git differences

**Use Cases:**
- Saving GAS development work to version control
- Creating backups of GAS projects
- Sharing GAS code via GitHub
- Creating releases/tags from GAS state

### 2. Git → GAS (Secondary Workflow)
More sensitive - must be careful not to corrupt GAS projects.

```mermaid
Git Repository → Local Cache → GAS Project (Target)
```

**Sequence:**
1. **gas_pull**: Pull from Git to GAS
   - Pulls from remote Git → Local
   - Filters Git metadata (NEW: protection added)
   - Syncs Local → GAS (`syncLocalToGAS`)
2. **gas_git_clone**: Clone entire repo to GAS
   - Clones Git repository → Local
   - Filters and syncs to GAS

**Use Cases:**
- Restoring GAS project from Git backup
- Deploying tested code from Git to GAS
- Migrating projects between GAS accounts
- Applying updates from collaborators

## Critical Protections Implemented

### Git Metadata Filtering
**Problem Solved:** Git metadata files were corrupting GAS projects

**Files Never Synced to GAS:**
```typescript
GIT_METADATA_EXCLUSIONS = [
  '.git',           // Git directory - NEVER sync
  '.gitattributes', // Git config files
  '.gitkeep',       
  '.gitmodules',    
  'node_modules',   // Dependencies
  '.DS_Store',      // OS files
  '*.log',          // Temporary files
  '*.tmp',
  '.env*',          // Secrets
]
```

**Implementation:** `shouldSyncFileToGAS()` function filters during `syncLocalToGAS()`

### Local Cache Management

**Location:** `~/gas-repos/[scriptId]/[gasPath]/`

**Characteristics:**
- Temporary workspace for Git operations
- Can be deleted and recreated anytime
- Not meant for direct editing
- Automatically created by Git commands

**Clean State:**
```bash
# Remove all local caches (safe operation)
rm -rf ~/gas-repos/

# Will be recreated on next git operation
gas_init, gas_pull, gas_push, etc.
```

## Recommended Workflows

### Development Workflow (GAS-First)
1. **Edit in GAS** (via `gas_write` or Apps Script Editor)
2. **Test in GAS** (via `gas_run`)
3. **Commit to Git** (via `gas_push` or `gas_commit`)
4. **Tag releases** in Git for version control

### Collaboration Workflow
1. **Team edits** in shared Git repository
2. **Review changes** via Git PR/MR process
3. **Deploy to GAS** via `gas_pull` after approval
4. **Test in GAS** before production use

### Backup/Restore Workflow
1. **Regular backups**: `gas_push` to Git repository
2. **Disaster recovery**: `gas_pull` from Git backup
3. **Version rollback**: `git checkout <tag>` then `gas_pull`

## Testing Validation

### Test 1: GAS → Git → GAS Round Trip
✅ **Passed**: Content files sync correctly
✅ **Protected**: Git metadata excluded

### Test 2: Git Metadata Exclusion
✅ **Verified**: `.git/` directory never syncs to GAS
✅ **Verified**: `.gitignore`, `.gitattributes` excluded
✅ **Verified**: Log files, temp files excluded

### Test 3: Corruption Recovery
✅ **Manual cleanup**: `gas_rm` removes `_git` files
✅ **Project recovery**: Fresh projects work correctly
⏳ **Future**: Automated cleanup tool planned

## Best Practices

### DO:
- ✅ Always treat GAS as source of truth
- ✅ Use `gas_push` regularly to backup to Git
- ✅ Test in GAS before deploying to production
- ✅ Review Git changes before `gas_pull`
- ✅ Keep Git repositories clean (no build artifacts)

### DON'T:
- ❌ Edit files directly in `~/gas-repos/` (temporary cache)
- ❌ Force push over GAS without backup
- ❌ Sync binary files or large assets to GAS
- ❌ Include secrets/credentials in Git
- ❌ Manually create `_git` files in GAS

## Error Recovery

### GAS Project Corruption (400 errors)
1. Create new GAS project
2. Pull clean code from Git: `gas_pull`
3. Or copy from working project: `gas_cp`

### Git Sync Issues
1. Clear local cache: `rm -rf ~/gas-repos/[scriptId]`
2. Reinitialize: `gas_init`
3. Resync: `gas_pull` or `gas_push`

### Merge Conflicts
1. Resolve in Git (standard Git workflow)
2. Test merged code locally if possible
3. Deploy to GAS: `gas_pull`
4. Test thoroughly in GAS environment

## Summary

The Git integration follows a **GAS-first** philosophy where:
1. **GAS projects** are the authoritative source
2. **Local files** are temporary caches for Git operations
3. **Git repositories** provide version control and collaboration
4. **Filtering** protects GAS from Git metadata corruption

This architecture ensures GAS projects remain clean and functional while leveraging Git for version control.