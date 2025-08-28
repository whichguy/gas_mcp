# Git Configuration Architecture Proposal

## Current State: Single .git.gs File
Currently using a monolithic `_git.gs` file that stores:
- Repository URL and branch
- Local sync path
- File transformations
- Sync metadata

## Proposed: Multi-File Architecture

### Benefits of Multiple Files

1. **Separation of Concerns**
   - Core config vs. user preferences vs. sync state
   - Easier to update individual aspects
   - Cleaner version control (some files tracked, others not)

2. **Flexibility**
   - Different update frequencies (config rarely changes, state changes often)
   - Optional components (hooks, attributes only when needed)
   - Progressive enhancement

3. **Git Parity**
   - More familiar to git users
   - Easier migration from real git repos
   - Better tool compatibility

### Proposed File Structure

```
GAS Project Root/
├── _git_config.gs          # Core configuration (like .git/config)
├── _git_attributes.gs      # Path attributes (like .git/info/attributes)
├── _git_exclude.gs         # Local excludes (like .git/info/exclude)
├── _git_hooks_config.gs    # Hook configurations
└── _git_state.gs          # Sync state and metadata (transient)
```

## Detailed File Specifications

### 1. `_git_config.gs` (Core Configuration)
**Purpose**: Repository settings, remotes, branches
**Tracked**: Yes (shared with team)
**Format**: INI-style wrapped in CommonJS

```javascript
function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  const GIT_CONFIG = `
[core]
  repositoryUrl = https://github.com/user/repo.git
  branch = main
  syncPrefix = src/gas
  localPath = ~/gas-repos/project-{scriptId}

[remote "origin"]
  url = https://github.com/user/repo.git
  fetch = +refs/heads/*:refs/remotes/origin/*

[branch "main"]  
  remote = origin
  merge = refs/heads/main

[user]
  name = Developer Name
  email = dev@example.com

[sync]
  autoCommit = true
  mergeStrategy = merge
  includeReadme = true
`;

  module.exports = {
    raw: GIT_CONFIG,
    parsed: parseINI(GIT_CONFIG),
    get: (section, key) => { /* helper */ },
    set: (section, key, value) => { /* helper */ }
  };
}
__defineModule__(_main);
```

### 2. `_git_attributes.gs` (Path Attributes)
**Purpose**: File handling rules (line endings, transformations)
**Tracked**: Yes (shared with team)
**Format**: Git attributes format

```javascript
function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  const GIT_ATTRIBUTES = `
# Line ending normalization
*.gs text eol=lf
*.html text eol=lf
*.json text eol=lf

# File transformations
README.md transform=markdown-to-html
.gitignore transform=dotfile-to-module
.github/** transform=skip

# Binary files
*.png binary
*.jpg binary
*.pdf binary base64=true

# GAS-specific
appsscript.json merge=ours
CommonJS.js readonly=true
`;

  module.exports = {
    raw: GIT_ATTRIBUTES,
    getAttributes: (path) => { /* parse and return attributes */ }
  };
}
__defineModule__(_main);
```

### 3. `_git_exclude.gs` (Local Excludes)
**Purpose**: Personal ignore patterns
**Tracked**: No (local only)
**Format**: Gitignore format

```javascript
function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  const GIT_EXCLUDE = `
# Personal development files
.vscode/
*.local.gs
debug.log
test-*.gs

# Local builds
dist/
build/
`;

  module.exports = {
    raw: GIT_EXCLUDE,
    isExcluded: (path) => { /* check if path is excluded */ }
  };
}
__defineModule__(_main);
```

### 4. `_git_hooks_config.gs` (Hook Configuration)
**Purpose**: Define sync hooks and triggers
**Tracked**: Optional (can be shared or local)
**Format**: JSON configuration

```javascript
function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  const HOOKS_CONFIG = {
    "pre-sync": {
      enabled: true,
      actions: [
        { type: "validate", target: "syntax" },
        { type: "format", target: "prettier" }
      ]
    },
    "post-sync": {
      enabled: true,
      actions: [
        { type: "notify", target: "slack" },
        { type: "deploy", target: "test" }
      ]
    },
    "pre-commit": {
      enabled: true,
      script: "TestRunner.runAll()"
    }
  };

  module.exports = HOOKS_CONFIG;
}
__defineModule__(_main);
```

### 5. `_git_state.gs` (Sync State)
**Purpose**: Transient sync metadata
**Tracked**: No (generated/updated)
**Format**: JSON state

```javascript
function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  const SYNC_STATE = {
    lastSync: {
      timestamp: "2024-01-27T10:30:00Z",
      direction: "pull",
      commitHash: "abc123",
      filesChanged: 12
    },
    fileHashes: {
      "Code.gs": "sha256:abcd...",
      "Utils.gs": "sha256:efgh..."
    },
    conflicts: [],
    pendingOperations: []
  };

  module.exports = SYNC_STATE;
}
__defineModule__(_main);
```

## Migration Strategy

### Phase 1: Backward Compatible
1. Keep reading single `_git.gs` file
2. Introduce new files gradually
3. Auto-migrate on first sync

### Phase 2: Dual Support
1. Check for new structure first
2. Fall back to single file
3. Provide migration command

### Phase 3: New Default
1. Create new structure by default
2. Maintain legacy support
3. Deprecation warnings

## Implementation Plan

### Step 1: Update GitConfigManager
```typescript
class GitConfigManager {
  // Add multi-file support
  static async loadConfig(scriptId: string): Promise<GitConfig> {
    // Try multi-file first
    const multiConfig = await this.loadMultiFileConfig(scriptId);
    if (multiConfig) return multiConfig;
    
    // Fall back to single file
    return this.loadSingleFileConfig(scriptId);
  }
  
  private static async loadMultiFileConfig(scriptId: string): Promise<GitConfig | null> {
    // Load and merge multiple config files
  }
}
```

### Step 2: Add File-Specific Managers
```typescript
class GitCoreConfigManager { /* handles _git_config.gs */ }
class GitAttributesManager { /* handles _git_attributes.gs */ }
class GitExcludeManager { /* handles _git_exclude.gs */ }
class GitHooksManager { /* handles _git_hooks_config.gs */ }
class GitStateManager { /* handles _git_state.gs */ }
```

### Step 3: Update Sync Tools
- Modify gas_git_init to create multi-file structure
- Update gas_git_sync to use appropriate managers
- Enhance gas_git_status to show file-level status

## Advantages of Multi-File Approach

1. **Granular Updates**: Update only what changed
2. **Better Performance**: Smaller file reads/writes
3. **Clear Ownership**: Some files tracked, others local
4. **Progressive Enhancement**: Start simple, add features
5. **Tool Compatibility**: Easier to integrate with git tools
6. **Conflict Resolution**: Simpler merges per file
7. **Caching**: Can cache rarely-changing configs

## Disadvantages to Consider

1. **Complexity**: More files to manage
2. **Discovery**: Harder to see all config at once
3. **Migration**: Existing projects need updating
4. **Storage**: More API calls for multiple files

## Recommendation

**Adopt a Hybrid Approach:**

1. **Start with Core + State** (2 files)
   - `_git_config.gs` - All configuration
   - `_git_state.gs` - Transient state

2. **Add Optional Files** as needed:
   - `_git_attributes.gs` - When transformations needed
   - `_git_exclude.gs` - When local excludes needed
   - `_git_hooks.gs` - When automation needed

3. **Benefits**:
   - Simple cases stay simple (2 files)
   - Complex cases supported (5+ files)
   - Progressive enhancement
   - Clear separation of concerns

## Next Steps

1. [ ] Implement GitStateManager separately
2. [ ] Update GitConfigManager for dual support
3. [ ] Create migration utilities
4. [ ] Update documentation
5. [ ] Add tests for multi-file scenarios

This approach provides the flexibility of multiple files while maintaining simplicity for basic use cases.