# Git Integration Test Plan for MCP GAS Server

## Overview
This document outlines a comprehensive testing strategy for the Git integration features in MCP GAS Server. The plan covers repository setup, test scenarios, corner cases, and validation procedures.

## Test Environment Setup

### 1. GitHub Repository Setup

#### Repository 1: Simple GAS Project
```bash
# Create on GitHub: mcp-gas-test-simple
# Initialize with README
# Add .gitignore for Node.js
```

**Purpose**: Basic push/pull operations, simple file sync
**Contents**:
- README.md
- Simple JavaScript functions
- Basic HTML templates
- appsscript.json manifest

#### Repository 2: Complex GAS Project
```bash
# Create on GitHub: mcp-gas-test-complex
# Initialize empty (no README)
```

**Purpose**: Test virtual file translation, conflicts, complex sync scenarios
**Contents**:
- Multiple subdirectories
- Dotfiles (.gitignore, .env.example)
- Large number of files (20+)
- Mixed file types

#### Repository 3: Binary and Edge Cases
```bash
# Create on GitHub: mcp-gas-test-edge
# Initialize empty
```

**Purpose**: Test edge cases and error handling
**Contents**:
- Binary files (images, PDFs)
- Very large text files
- Special characters in filenames
- Deeply nested directories

### 2. Google Apps Script Project Setup

```javascript
// Create via MCP GAS Server
await gas_auth({ mode: "start" });

// Project 1: Fresh project for simple tests
const project1 = await gas_project_create({ 
  title: "MCP GAS Git Test Simple",
  localName: "test-simple"
});

// Project 2: Complex project with existing code
const project2 = await gas_project_create({ 
  title: "MCP GAS Git Test Complex",
  localName: "test-complex"
});

// Project 3: Edge case testing
const project3 = await gas_project_create({ 
  title: "MCP GAS Git Test Edge",
  localName: "test-edge"
});
```

## Test Scenarios

### Phase 1: Basic Git Operations

#### Test 1.1: Initialize Git Repository
```bash
# Test Command
gas_init({
  scriptId: project1.scriptId,
  gitUrl: "https://github.com/username/mcp-gas-test-simple.git",
  branch: "main"
})

# Validation
- Verify .git directory created at ~/gas-repos/[scriptId]/
- Check remote configuration
- Verify initial commit created
```

#### Test 1.2: Pull from Empty GitHub Repo
```bash
# Test Command
gas_pull({
  scriptId: project1.scriptId,
  remote: "origin",
  branch: "main"
})

# Expected Result
- No conflicts (empty repo)
- Local GAS files preserved
- Ready for initial push
```

#### Test 1.3: Initial Push to GitHub
```bash
# Test Command
gas_push({
  scriptId: project1.scriptId,
  commitMessage: "Initial GAS project sync",
  remote: "origin",
  branch: "main"
})

# Validation
- All GAS files appear in GitHub
- Virtual files translated (.gitignore appears as _gitignore.gs)
- Commit history preserved
```

#### Test 1.4: Clone Existing Repository
```bash
# Test Command
gas_git_clone({
  scriptId: project2.scriptId,
  gitUrl: "https://github.com/username/mcp-gas-test-complex.git",
  branch: "main"
})

# Validation
- Repository cloned successfully
- All files synced to GAS project
- Virtual files reverse-translated (_git.gs → .git)
```

### Phase 2: Bidirectional Sync

#### Test 2.1: Modify in GAS, Push to Git
```javascript
// Step 1: Modify file in GAS
await gas_write({
  scriptId: project1.scriptId,
  path: "newFeature",
  content: `function newFeature() { return "test"; }`
});

// Step 2: Commit and push
await gas_commit({
  scriptId: project1.scriptId,
  message: "Add new feature from GAS"
});

await gas_push({
  scriptId: project1.scriptId
});

// Validation
// - Check GitHub for new file
// - Verify CommonJS wrapper removed in Git
// - Confirm commit message
```

#### Test 2.2: Modify in GitHub, Pull to GAS
```bash
# Step 1: Edit file directly on GitHub
# Add new-github-feature.js via web interface

# Step 2: Pull changes
gas_pull({
  scriptId: project1.scriptId
})

# Step 3: Verify in GAS
gas_cat({
  scriptId: project1.scriptId,
  path: "new-github-feature"
})

# Validation
- File appears in GAS with CommonJS wrapper
- Content intact
- No conflicts
```

#### Test 2.3: Concurrent Modifications
```javascript
// Step 1: Modify same file in both places
// GAS: Update function A
await gas_write({
  scriptId: project1.scriptId,
  path: "shared",
  content: `function A() { return "GAS version"; }`
});

// GitHub: Update function A differently
// (manually edit via web)

// Step 2: Attempt pull
await gas_pull({
  scriptId: project1.scriptId
});

// Expected: Conflict detection
// Validation: Appropriate error message
```

### Phase 3: Virtual File Translation

#### Test 3.1: Dotfile Sync to GAS
```bash
# Create .gitignore in GitHub
echo "node_modules/" > .gitignore
git add .gitignore
git commit -m "Add gitignore"
git push

# Pull to GAS
gas_pull({
  scriptId: project2.scriptId
})

# Verify translation
gas_ls({
  scriptId: project2.scriptId,
  path: "_gitignore*"
})

# Expected: _gitignore.gs with CommonJS wrapper
```

#### Test 3.2: Dotfile Creation in GAS
```javascript
// Create virtual dotfile in GAS
await gas_write({
  scriptId: project2.scriptId,
  path: ".env.example",
  content: "API_KEY=your_key_here"
});

// Push to Git
await gas_push({
  scriptId: project2.scriptId,
  commitMessage: "Add env example"
});

// Validation in GitHub
// File should appear as .env.example (not _env_example.gs)
```

#### Test 3.3: Complex Virtual Files
```javascript
// Test all mapped virtual files
const virtualFiles = [
  { virtual: ".gitmodules", content: "[submodule]" },
  { virtual: ".dockerignore", content: "*.log" },
  { virtual: ".prettierrc", content: "{}" }
];

for (const file of virtualFiles) {
  await gas_write({
    scriptId: project2.scriptId,
    path: file.virtual,
    content: file.content
  });
}

// Sync and validate
await gas_push({ scriptId: project2.scriptId });
await gas_pull({ scriptId: project2.scriptId });
```

### Phase 4: Corner Cases and Error Handling

#### Test 4.1: Large Files
```javascript
// Create large file (>1MB)
const largeContent = "x".repeat(1024 * 1024 * 2); // 2MB
await gas_write({
  scriptId: project3.scriptId,
  path: "large-file",
  content: largeContent
});

// Test sync
await gas_push({ scriptId: project3.scriptId });

// Expected: Handle gracefully or error with size limit
```

#### Test 4.2: Binary Files
```javascript
// Attempt to sync binary content
const binaryContent = Buffer.from([0xFF, 0xD8, 0xFF]).toString('base64');
await gas_write({
  scriptId: project3.scriptId,
  path: "image-data",
  content: binaryContent,
  fileType: "JSON" // Store as JSON
});

// Validation: Should sync as base64 JSON
```

#### Test 4.3: Special Characters
```javascript
// Test filenames with special characters
const specialFiles = [
  "file with spaces",
  "file-with-dashes",
  "file_with_underscores",
  "fileWithCamelCase",
  "file.with.dots"
];

for (const name of specialFiles) {
  await gas_write({
    scriptId: project3.scriptId,
    path: name,
    content: `// ${name}`
  });
}

// Test sync both directions
```

#### Test 4.4: Deleted Files
```bash
# Delete file in Git
git rm some-file.js
git commit -m "Remove file"
git push

# Pull to GAS
gas_pull({ scriptId: project3.scriptId })

# Verify file removed from GAS
gas_ls({ scriptId: project3.scriptId })
```

#### Test 4.5: Repository Corruption
```bash
# Corrupt git repository
rm -rf ~/gas-repos/[scriptId]/.git/refs

# Attempt operations
gas_status({ scriptId: project3.scriptId })

# Expected: Helpful error message suggesting gas_init
```

### Phase 5: Authentication and Permissions

#### Test 5.1: Expired Token
```javascript
// Manually expire token
// Delete ~/.auth/mcp-gas-token.json

// Attempt operation
await gas_pull({ scriptId: project1.scriptId });

// Expected: Re-authentication prompt
```

#### Test 5.2: Invalid Git URL
```javascript
await gas_init({
  scriptId: project1.scriptId,
  gitUrl: "not-a-valid-url"
});

// Expected: Validation error
```

#### Test 5.3: Private Repository Access
```javascript
// Test with private GitHub repo
await gas_git_clone({
  scriptId: project2.scriptId,
  gitUrl: "https://github.com/username/private-repo.git"
});

// Expected: Authentication required message
```

### Phase 6: Performance and Scale

#### Test 6.1: Many Files
```javascript
// Create 100 files
for (let i = 0; i < 100; i++) {
  await gas_write({
    scriptId: project3.scriptId,
    path: `file${i}`,
    content: `// File ${i}`
  });
}

// Time the sync
const start = Date.now();
await gas_push({ scriptId: project3.scriptId });
const duration = Date.now() - start;

// Validation: Should complete within reasonable time (<60s)
```

#### Test 6.2: Deep Directory Structure
```javascript
// Create nested directories
await gas_write({
  scriptId: project3.scriptId,
  path: "a/b/c/d/e/f/g/deeply-nested",
  content: "// Deep file"
});

// Test sync
await gas_push({ scriptId: project3.scriptId });
```

### Phase 7: Status and Diff Operations

#### Test 7.1: Status Command
```javascript
// Make local changes
await gas_write({
  scriptId: project1.scriptId,
  path: "modified-file",
  content: "// Modified"
});

// Check status
await gas_status({ scriptId: project1.scriptId });

// Expected: Show uncommitted changes
```

#### Test 7.2: Diff Command
```javascript
// After modifications
await gas_diff({ scriptId: project1.scriptId });

// Expected: Show file differences
```

#### Test 7.3: Log Command
```javascript
await gas_log({ 
  scriptId: project1.scriptId,
  options: "--oneline -10"
});

// Expected: Show commit history
```

## Validation Checklist

### For Each Test:
- [ ] Command executes without errors
- [ ] Expected files present in destination
- [ ] File content preserved correctly
- [ ] CommonJS wrappers handled properly
- [ ] Virtual file translation working
- [ ] Error messages are helpful
- [ ] No data loss occurs
- [ ] Git history preserved

### Overall System:
- [ ] Bidirectional sync maintains consistency
- [ ] Large projects handled efficiently
- [ ] Concurrent operations handled safely
- [ ] Authentication flow works smoothly
- [ ] Error recovery is possible
- [ ] Performance is acceptable

## Known Limitations to Test

1. **GAS File Type Restrictions**
   - Only SERVER_JS, HTML, JSON supported
   - Binary files need base64 encoding
   - Test handling of unsupported types

2. **Git Command Availability**
   - Requires Git installed locally
   - Test error when Git missing

3. **OAuth Token Expiry**
   - Tokens expire after period
   - Test refresh mechanism

4. **API Rate Limits**
   - Google Apps Script API has quotas
   - Test throttling behavior

## Test Execution Order

1. **Setup Phase** (30 min)
   - Create GitHub repositories
   - Create GAS projects
   - Configure authentication

2. **Basic Operations** (1 hour)
   - Run Phase 1 tests
   - Validate each operation

3. **Sync Testing** (2 hours)
   - Run Phase 2 tests
   - Test bidirectional flow
   - Verify data integrity

4. **Virtual Files** (1 hour)
   - Run Phase 3 tests
   - Verify all translations

5. **Edge Cases** (2 hours)
   - Run Phase 4 tests
   - Document any failures

6. **Security & Performance** (1 hour)
   - Run Phases 5-6 tests
   - Measure performance

7. **Utility Commands** (30 min)
   - Run Phase 7 tests
   - Verify output format

## Success Criteria

- All basic operations complete without errors
- Bidirectional sync preserves all data
- Virtual file translation works correctly
- Error messages are helpful and actionable
- Performance is acceptable for typical projects
- No security vulnerabilities exposed
- Documentation matches actual behavior

## Issue Tracking

Create GitHub issues for any problems found:
- Include test case number
- Steps to reproduce
- Expected vs actual behavior
- Error messages/logs
- Suggested fix if applicable

## Post-Test Actions

1. Document any limitations discovered
2. Update README with tested scenarios
3. Create troubleshooting guide
4. Consider automated test suite
5. Plan fixes for critical issues