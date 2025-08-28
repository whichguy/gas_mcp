# Git Sync Tools - Comprehensive Test Plan

## Test Environment Setup

### Required Components
1. **Test GAS Project**: `gas-git-sync-test-YYYYMMDD`
2. **Test GitHub Repository**: `test-gas-git-sync`
3. **Test Local Directory**: `~/test-gas-repos/`
4. **Test Subproject**: For multi-project testing

## Test Suite Overview

### Phase 1: Setup & Initialization Tests

#### Test 1.1: Create Test Environment
```typescript
// Create test GAS project
const testProject = await gas_project_create({
  title: "Git Sync Test Project",
  localName: "git-sync-test"
});
const scriptId = testProject.scriptId;

// Add initial test files
await gas_write({
  scriptId,
  path: "TestModule",
  content: `
    function testFunction() {
      return "Initial version from GAS";
    }
    module.exports = { testFunction };
  `
});

await gas_write({
  scriptId,
  path: "Config",
  content: `
    const config = {
      version: "1.0.0",
      environment: "test"
    };
    module.exports = config;
  `
});
```

#### Test 1.2: Create GitHub Repository
```bash
# Using GitHub CLI
gh repo create test-gas-git-sync --public --description "Test repo for GAS git sync"

# Or using GitHub MCP
mcp__github__create_repository({
  name: "test-gas-git-sync",
  description: "Test repo for GAS git sync",
  private: false
})
```

#### Test 1.3: Initialize Git Association
```typescript
// Test basic initialization
await gas_git_init({
  scriptId,
  repository: "https://github.com/USERNAME/test-gas-git-sync.git",
  branch: "main",
  localPath: "~/test-gas-repos/sync-test"
});

// Verify .git/config.gs was created
const files = await gas_ls({ scriptId });
assert(files.includes('.git/config.gs'), '.git/config.gs should exist');

// Check status
const status = await gas_git_status({ scriptId });
assert(status.hasGitLink === true, 'Project should be git-linked');
assert(status.repository.includes('test-gas-git-sync'), 'Repository should be set');
```

### Phase 2: Synchronization Tests

#### Test 2.1: Initial Sync (GAS → Local)
```typescript
// Clone repository locally first
await execAsync('cd ~/test-gas-repos && git clone https://github.com/USERNAME/test-gas-git-sync.git sync-test');

// Sync from GAS to local
await gas_git_sync({
  scriptId,
  direction: "pull-only"
});

// Verify files exist locally
const localFiles = await fs.readdir('~/test-gas-repos/sync-test');
assert(localFiles.includes('TestModule.gs'), 'TestModule should be synced');
assert(localFiles.includes('Config.gs'), 'Config should be synced');

// Verify CommonJS wrapper was removed in local files
const content = await fs.readFile('~/test-gas-repos/sync-test/TestModule.gs', 'utf8');
assert(!content.includes('function _main('), 'CommonJS wrapper should be removed');
```

#### Test 2.2: Local Edit → GAS Sync
```typescript
// Edit file locally
await fs.writeFile('~/test-gas-repos/sync-test/TestModule.gs', `
  function testFunction() {
    return "Updated version from local";
  }
  
  function newFunction() {
    return "Added locally";
  }
  
  module.exports = { testFunction, newFunction };
`);

// Commit locally
await execAsync('cd ~/test-gas-repos/sync-test && git add -A && git commit -m "Local update"');

// Sync to GAS
await gas_git_sync({
  scriptId,
  direction: "push-only"
});

// Verify in GAS
const gasContent = await gas_cat({ scriptId, path: "TestModule" });
assert(gasContent.includes('Updated version from local'), 'Local changes should be in GAS');
assert(gasContent.includes('newFunction'), 'New function should be in GAS');
```

#### Test 2.3: GAS Edit → Local Sync
```typescript
// Edit in GAS
await gas_write({
  scriptId,
  path: "TestModule",
  content: `
    function testFunction() {
      return "Updated version from GAS editor";
    }
    
    function newFunction() {
      return "Added locally";
    }
    
    function gasEditorFunction() {
      return "Added in GAS editor";
    }
    
    module.exports = { testFunction, newFunction, gasEditorFunction };
  `
});

// Sync to local
await gas_git_sync({
  scriptId,
  direction: "pull-only"
});

// Verify locally
const localContent = await fs.readFile('~/test-gas-repos/sync-test/TestModule.gs', 'utf8');
assert(localContent.includes('Updated version from GAS editor'), 'GAS changes should be local');
assert(localContent.includes('gasEditorFunction'), 'New GAS function should be local');
```

### Phase 3: Conflict Resolution Tests

#### Test 3.1: Conflicting Changes
```typescript
// Create conflicting changes
// 1. Edit in GAS
await gas_write({
  scriptId,
  path: "Config",
  content: `
    const config = {
      version: "2.0.0",  // GAS version
      environment: "production",
      gasEdit: true
    };
    module.exports = config;
  `
});

// 2. Edit locally (different change)
await fs.writeFile('~/test-gas-repos/sync-test/Config.gs', `
  const config = {
    version: "1.5.0",  // Local version
    environment: "development",
    localEdit: true
  };
  module.exports = config;
`);

// 3. Attempt sync
const syncResult = await gas_git_sync({
  scriptId,
  mergeStrategy: "manual"
});

// Should detect conflict
assert(syncResult.hasConflicts === true, 'Should detect conflicts');
assert(syncResult.conflicts.includes('Config.gs'), 'Config.gs should have conflict');

// Check conflict files created
const conflictFiles = await fs.readdir('~/test-gas-repos/sync-test/.git-gas');
assert(conflictFiles.includes('Config.gs.LOCAL'), 'Local version should be saved');
assert(conflictFiles.includes('Config.gs.REMOTE'), 'Remote version should be saved');
assert(conflictFiles.includes('Config.gs.MERGED'), 'Merged version with markers should exist');
```

#### Test 3.2: Resolve Conflicts
```typescript
// Manually resolve conflict
await fs.writeFile('~/test-gas-repos/sync-test/Config.gs', `
  const config = {
    version: "2.0.0",  // Take GAS version number
    environment: "development",  // Keep local environment
    gasEdit: true,
    localEdit: true  // Keep both flags
  };
  module.exports = config;
`);

// Commit resolution
await execAsync('cd ~/test-gas-repos/sync-test && git add Config.gs && git commit -m "Resolved conflicts"');

// Retry sync
await gas_git_sync({ scriptId });

// Verify resolution in both places
const gasConfig = await gas_cat({ scriptId, path: "Config" });
assert(gasConfig.includes('gasEdit: true'), 'Resolution should be in GAS');
assert(gasConfig.includes('localEdit: true'), 'Resolution should be in GAS');
```

### Phase 4: File Transformation Tests

#### Test 4.1: README Transformation
```typescript
// Create README.md locally
await fs.writeFile('~/test-gas-repos/sync-test/README.md', `
# Test Project

This is a **test** project for git sync.

## Features
- Feature 1
- Feature 2

\`\`\`javascript
function example() {
  return "code";
}
\`\`\`
`);

// Sync to GAS
await gas_git_sync({ scriptId });

// Verify transformation to HTML
const readmeHtml = await gas_cat({ scriptId, path: "README" });
assert(readmeHtml.includes('<h1>Test Project</h1>'), 'Markdown should be converted to HTML');
assert(readmeHtml.includes('<strong>test</strong>'), 'Bold should be converted');
assert(readmeHtml.includes('<!-- Original markdown preserved'), 'Original should be in comments');
```

#### Test 4.2: Dotfile Handling
```typescript
// Create .gitignore locally
await fs.writeFile('~/test-gas-repos/sync-test/.gitignore', `
node_modules/
*.log
.env
dist/
`);

// Create .env locally (should be handled carefully)
await fs.writeFile('~/test-gas-repos/sync-test/.env', `
API_KEY=test-key-12345
SECRET=do-not-expose
`);

// Sync to GAS
await gas_git_sync({ scriptId });

// Verify in GAS
const files = await gas_ls({ scriptId });
assert(files.includes('.gitignore.gs'), '.gitignore should become .gitignore.gs');

const gitignore = await gas_cat({ scriptId, path: ".gitignore" });
assert(gitignore.includes('node_modules/'), 'Gitignore content preserved');
```

### Phase 5: Multi-Project Tests

#### Test 5.1: Nested Git Projects
```typescript
// Create main project config
await gas_git_init({
  scriptId,
  repository: "https://github.com/USERNAME/main-project.git",
  projectPath: ""  // Root
});

// Create subproject
await gas_git_init({
  scriptId,
  repository: "https://github.com/USERNAME/sub-library.git",
  projectPath: "libs/shared"
});

// Verify both configs exist
const files = await gas_ls({ scriptId });
assert(files.includes('.git/config.gs'), 'Root git config should exist');
assert(files.includes('libs/shared/.git/config.gs'), 'Subproject git config should exist');

// Get status for each
const mainStatus = await gas_git_status({ scriptId, projectPath: "" });
assert(mainStatus.repository.includes('main-project'), 'Main project should be configured');

const subStatus = await gas_git_status({ scriptId, projectPath: "libs/shared" });
assert(subStatus.repository.includes('sub-library'), 'Subproject should be configured');
```

#### Test 5.2: Sync Specific Project
```typescript
// Add file to subproject
await gas_write({
  scriptId,
  path: "libs/shared/SharedUtils",
  content: `
    function sharedHelper() {
      return "From shared library";
    }
    module.exports = { sharedHelper };
  `
});

// Sync only subproject
await gas_git_sync({
  scriptId,
  projectPath: "libs/shared"
});

// Verify in correct location
const subFiles = await fs.readdir('~/test-gas-repos/sub-library');
assert(subFiles.includes('SharedUtils.gs'), 'Subproject file should be synced');
```

### Phase 6: Sync Folder Operations

#### Test 6.1: Get Sync Folder
```typescript
const folderInfo = await gas_git_get_sync_folder({ scriptId });

assert(folderInfo.syncFolder === path.resolve('~/test-gas-repos/sync-test'), 'Should return correct path');
assert(folderInfo.exists === true, 'Folder should exist');
assert(folderInfo.isGitRepo === true, 'Should be a git repo');
assert(folderInfo.repository.includes('test-gas-git-sync'), 'Should have correct remote');
```

#### Test 6.2: Move Sync Folder
```typescript
// Move to new location
await gas_git_set_sync_folder({
  scriptId,
  localPath: "~/test-gas-repos/moved-project",
  moveExisting: true
});

// Verify move
const newInfo = await gas_git_get_sync_folder({ scriptId });
assert(newInfo.syncFolder.includes('moved-project'), 'Should be in new location');

// Verify git still works
await execAsync('cd ~/test-gas-repos/moved-project && git status');
await execAsync('cd ~/test-gas-repos/moved-project && git remote -v');

// Sync should still work
await gas_git_sync({ scriptId });
```

### Phase 7: Integration Tests

#### Test 7.1: Full Workflow with GitHub
```typescript
// Make changes locally
await fs.writeFile('~/test-gas-repos/sync-test/NewFeature.gs', `
  function featureX() {
    return "New feature implementation";
  }
  module.exports = { featureX };
`);

// Git workflow
await execAsync('cd ~/test-gas-repos/sync-test && git add NewFeature.gs');
await execAsync('cd ~/test-gas-repos/sync-test && git commit -m "Add feature X"');
await execAsync('cd ~/test-gas-repos/sync-test && git push origin main');

// Create PR using gh
await execAsync('cd ~/test-gas-repos/sync-test && gh pr create --title "Feature X" --body "New feature"');

// Sync to GAS
await gas_git_sync({ scriptId });

// Verify in GAS
const gasFiles = await gas_ls({ scriptId });
assert(gasFiles.includes('NewFeature.gs'), 'New feature should be in GAS');
```

#### Test 7.2: GitHub MCP Integration
```typescript
// Use GitHub MCP to check repository
const repoInfo = await mcp__github__get_repository({
  owner: "USERNAME",
  repo: "test-gas-git-sync"
});

// Compare with GAS status
const gasStatus = await gas_git_status({ scriptId });
assert(repoInfo.default_branch === gasStatus.branch, 'Branches should match');

// Get file from GitHub
const ghFile = await mcp__github__get_file_contents({
  owner: "USERNAME",
  repo: "test-gas-git-sync",
  path: "TestModule.gs"
});

// Compare with GAS
const gasFile = await gas_cat({ scriptId, path: "TestModule" });
// Content should match (after transformation)
```

### Phase 8: Error Handling Tests

#### Test 8.1: No Git Link
```typescript
// Create new project without git
const noGitProject = await gas_project_create({
  title: "No Git Project"
});

// Try sync without init
try {
  await gas_git_sync({ scriptId: noGitProject.scriptId });
  assert(false, 'Should throw error');
} catch (error) {
  assert(error.message.includes('git-linked'), 'Should indicate no git link');
}

// Status should show not linked
const status = await gas_git_status({ scriptId: noGitProject.scriptId });
assert(status.hasGitLink === false, 'Should show not linked');
```

#### Test 8.2: Invalid Repository
```typescript
try {
  await gas_git_init({
    scriptId,
    repository: "not-a-valid-url"
  });
  assert(false, 'Should throw error');
} catch (error) {
  assert(error.message.includes('repository'), 'Should indicate invalid repository');
}
```

### Phase 9: Performance Tests

#### Test 9.1: Large File Sync
```typescript
// Create large file in GAS
const largeContent = Array(1000).fill(0).map((_, i) => `
  function generated_${i}() {
    return "Function ${i}";
  }
`).join('\n');

await gas_write({
  scriptId,
  path: "LargeModule",
  content: largeContent + '\nmodule.exports = {};'
});

// Time the sync
const startTime = Date.now();
await gas_git_sync({ scriptId });
const syncTime = Date.now() - startTime;

console.log(`Large file sync took ${syncTime}ms`);
assert(syncTime < 30000, 'Should complete within 30 seconds');
```

### Phase 10: Cleanup

#### Test 10.1: Clean Up Test Environment
```typescript
// Remove local repos
await execAsync('rm -rf ~/test-gas-repos/sync-test');
await execAsync('rm -rf ~/test-gas-repos/moved-project');
await execAsync('rm -rf ~/test-gas-repos/sub-library');

// Delete GitHub repo (optional, using gh)
// await execAsync('gh repo delete test-gas-git-sync --confirm');

// Keep GAS project for inspection or delete
// Note: No API to delete GAS projects, must be done manually
```

## Test Execution Script

```typescript
// test-git-sync.ts
import { runTests } from './test-framework';

async function runGitSyncTests() {
  const results = {
    passed: [],
    failed: [],
    skipped: []
  };
  
  // Run all test phases
  for (const phase of testPhases) {
    console.log(`\nRunning ${phase.name}...`);
    
    for (const test of phase.tests) {
      try {
        await test.run();
        results.passed.push(test.name);
        console.log(`✅ ${test.name}`);
      } catch (error) {
        results.failed.push({ name: test.name, error });
        console.log(`❌ ${test.name}: ${error.message}`);
      }
    }
  }
  
  // Summary
  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${results.passed.length}`);
  console.log(`Failed: ${results.failed.length}`);
  console.log(`Skipped: ${results.skipped.length}`);
  
  return results;
}

// Run tests
runGitSyncTests().catch(console.error);
```

## Expected Outcomes

### Success Criteria
- ✅ All initialization tests pass
- ✅ Bidirectional sync works correctly
- ✅ Conflicts are detected and can be resolved
- ✅ File transformations work as expected
- ✅ Multi-project support functions correctly
- ✅ Sync folder operations work
- ✅ Integration with git/gh commands works
- ✅ GitHub MCP interoperability verified
- ✅ Error handling is robust
- ✅ Performance is acceptable

### Known Limitations to Test
- Git binary must be installed
- GitHub CLI (gh) for some tests
- Network connectivity required
- OAuth authentication required
- File system permissions

## Test Data Preservation

Save test results in:
```
test-results/
├── git-sync-test-YYYYMMDD.json
├── screenshots/
├── logs/
└── artifacts/
    ├── conflict-samples/
    └── sync-outputs/
```