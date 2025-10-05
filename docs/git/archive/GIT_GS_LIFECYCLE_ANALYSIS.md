# .git.gs File Lifecycle Analysis

## Current Implementation Issues

### 1. **Naming Inconsistency**
- **Problem**: The file is named `.git` in GAS but referenced as `.git.gs` in documentation and local storage
- **In GAS**: Stored as `.git` (type: SERVER_JS)
- **Locally**: Stored as `.gasmodules/.git.gs`
- **Virtual mapping**: `.git` → `_git` (but we're not using this correctly)

### 2. **Template Issues**
The current template has incorrect function signature:
```javascript
function _main(module, exports, require) {  // ❌ Wrong signature
```
Should be:
```javascript
function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {  // ✅ Correct CommonJS signature
```

### 3. **Parsing Issues**
Current parsing is fragile and incomplete:
- Only extracts 4 fields (repository, branch, localPath, lastSync)
- Ignores nested objects like transformations, pathMappings
- Uses simple regex that breaks with complex values
- Doesn't handle the CommonJS wrapper properly

### 4. **Storage Confusion**
- `.git` file in GAS contains configuration
- `.gasmodules/.git.gs` locally contains the same content
- But when syncing, we check for `.git` not `_git`
- Virtual translation isn't applied consistently

## Correct Lifecycle Flow

### Phase 1: Initialization (gas_git_init)
```
User calls gas_git_init
    ↓
1. Create local sync folder
2. Initialize git repo if needed
3. Create GIT_CONFIG object
4. Wrap in CommonJS module format
5. Upload to GAS as '_git.gs' (using virtual translation)
6. Store locally in .gasmodules/.git.gs
```

### Phase 2: Reading Configuration (getGitConfig)
```
Need to read config
    ↓
1. Get files from GAS
2. Look for '_git' file (after virtual translation)
3. Unwrap CommonJS module
4. Parse GIT_CONFIG object properly
5. Return full configuration
```

### Phase 3: Syncing Files (gas_git_sync)
```
Pull from GAS → Merge → Push to GAS
    ↓
1. Read git config from '_git.gs'
2. Pull all files from GAS
3. Apply transformations:
   - '_git.gs' → .gasmodules/.git.gs (preserve config)
   - '_gitignore.gs' → .gitignore
   - 'README' (HTML) → README.md
   - Unwrap CommonJS from .js files
4. Merge with local git repo
5. Transform back for GAS:
   - .gitignore → '_gitignore.gs' (wrapped)
   - README.md → 'README' (HTML)
   - .js files → wrapped CommonJS
6. Push to GAS
7. Update '_git.gs' with sync metadata
```

### Phase 4: Status Check (gas_git_status)
```
Check sync status
    ↓
1. Read '_git.gs' configuration
2. Check local repo status
3. Compare with GAS files
4. Return differences and recommendations
```

## Corner Cases to Handle

### 1. **Missing .git.gs**
- User manually deleted the file in GAS
- Sync should detect and recreate from local .gasmodules/.git.gs

### 2. **Corrupted .git.gs**
- Manual editing broke the format
- Should fallback to defaults or prompt for re-initialization

### 3. **Conflicting Names**
- User has a file named `.git` in their project
- Should use `_git.gs` consistently to avoid conflicts

### 4. **Circular Transformation**
- .git.gs shouldn't be transformed when syncing
- Should be excluded from normal file processing

### 5. **Multiple Projects**
- Each project needs its own .git.gs
- Sync folder collision if multiple projects use same path

## Required Fixes

### 1. **Use Consistent Naming**
```typescript
// Always use '_git' in GAS (with virtual translation)
const GAS_GIT_CONFIG_NAME = '_git';
const LOCAL_GIT_CONFIG_PATH = '.gasmodules/.git.gs';
```

### 2. **Fix Template**
```typescript
const GIT_CONFIG_TEMPLATE = `function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  const GIT_CONFIG = {
    version: "2.1",
    repository: "{{repository}}",
    branch: "{{branch}}",
    localPath: "{{localPath}}",
    syncPrefix: "{{syncPrefix}}",
    // ... rest of config
  };
  
  module.exports = GIT_CONFIG;
}

__defineModule__(_main);`;
```

### 3. **Improve Parsing**
```typescript
private async getGitConfig(scriptId: string, gasClient: GASClient, accessToken: string): Promise<any> {
  const files = await gasClient.getProjectContent(scriptId, accessToken);
  const gitFile = files.find((f: any) => f.name === '_git'); // Use _git not .git
  
  if (!gitFile?.source) return null;
  
  // First unwrap CommonJS module
  const unwrapped = unwrapCommonJSModule(gitFile.source);
  
  // Then parse the exported config
  // Could use a safer JSON-like parser or AST parser
  try {
    // Extract module.exports = {...}
    const exportMatch = unwrapped.match(/module\.exports\s*=\s*({[\s\S]*});?$/);
    if (exportMatch) {
      // Parse as JSON-like structure
      return this.parseConfigObject(exportMatch[1]);
    }
  } catch {
    return null;
  }
}
```

### 4. **Fix File Transformations**
```typescript
// When reading from GAS
if (file.name === '_git') {
  // This is our config file, handle specially
  const config = this.parseGitConfig(file.source);
  // Store in .gasmodules
  await fs.writeFile('.gasmodules/.git.gs', file.source);
  continue; // Don't process as normal file
}

// When writing to GAS
if (localPath === '.gasmodules/.git.gs') {
  // Skip - this is already in GAS as _git
  continue;
}
```

### 5. **Update Sync Logic**
```typescript
// Exclude .gasmodules from normal sync
private async walkDirectory(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    // Skip .git and .gasmodules
    if (entry.name === '.git' || entry.name === '.gasmodules') {
      continue;
    }
    // ... rest of logic
  }
}
```

## Recommended Implementation Changes

### 1. **Create a dedicated GitConfigManager class**
```typescript
class GitConfigManager {
  private static readonly GAS_NAME = '_git';
  private static readonly LOCAL_PATH = '.gasmodules/.git.gs';
  
  static create(params: GitConfigParams): string {
    // Create properly formatted config with CommonJS wrapper
  }
  
  static parse(source: string): GitConfig | null {
    // Safely parse config from GAS source
  }
  
  static update(config: GitConfig, updates: Partial<GitConfig>): string {
    // Update config and return new source
  }
}
```

### 2. **Use Type-Safe Config Interface**
```typescript
interface GitConfig {
  version: string;
  repository: string;
  branch: string;
  localPath: string;
  syncPrefix?: string;
  lastSync?: {
    timestamp: string;
    direction: 'init' | 'pull' | 'push' | 'sync';
    commitHash?: string;
    filesChanged?: number;
  };
  transformations?: Record<string, FileTransformation>;
  pathMappings?: Record<string, string>;
}
```

### 3. **Separate Config from File Sync**
- Don't sync .gasmodules/.git.gs as a regular file
- Update _git in GAS directly when config changes
- Keep local copy in .gasmodules for reference

### 4. **Add Validation**
```typescript
private validateGitConfig(config: any): config is GitConfig {
  return config &&
    typeof config.repository === 'string' &&
    typeof config.branch === 'string' &&
    typeof config.localPath === 'string';
}
```

## Summary

The current implementation has several issues:
1. **Inconsistent naming** (.git vs _git vs .git.gs)
2. **Incomplete parsing** (only extracts 4 fields)
3. **Wrong CommonJS format** (incorrect function signature)
4. **Confusion about storage** (where and how the file is stored)
5. **Missing corner case handling** (corrupted files, conflicts)

The fixes should:
1. Use `_git` consistently in GAS (with virtual translation)
2. Parse the full config object properly
3. Use correct CommonJS wrapper format
4. Keep .gasmodules/.git.gs separate from normal sync
5. Add proper validation and error handling