# Git Operations Test Suite

## Overview

Comprehensive integration test suite for the 5 core git sync tools in the MCP Gas Server. Tests real-world scenarios using the ThenRunLater repository as a test case.

## Running the Tests

### Quick Start
```bash
npm run test:mcp-git
```

This command:
1. Builds the TypeScript project
2. Runs all git operations tests
3. Uses 5-minute timeout for complex sync operations
4. Requires OAuth authentication (opens browser once)

### Individual Test Execution
```bash
# Run just the git operations tests
npx mocha test/integration/mcp-gas-validation/git-operations.test.ts --timeout 300000

# Run with specific grep pattern
npx mocha test/integration/mcp-gas-validation/git-operations.test.ts --timeout 300000 --grep "git_init"
```

## Test Suite Structure

### 1. Git Init - Association Initialization (4 tests)
- ✅ Initialize git association with ThenRunLater repo
- ✅ Create .git.gs file in GAS project
- ✅ Verify .git.gs is CommonJS module format
- ✅ Fail gracefully with invalid repository URL

### 2. Git Get Sync Folder - Query Configuration (3 tests)
- ✅ Return sync folder after initialization
- ✅ Detect if sync folder is a git repository
- ✅ Provide recommended next steps

### 3. Git Status - Check Association State (3 tests)
- ✅ Confirm git association exists
- ✅ Show sync folder in status
- ✅ Provide git status information

### 4. Git Sync - Clone and Initial Pull (4 tests)
- ✅ Perform initial sync from local to GAS
- ✅ Verify all ThenRunLater files transferred to GAS
- ✅ Verify file content integrity after sync
- ✅ Handle README.md to README.html transformation

### 5. Git Sync - Push Changes from GAS (3 tests)
- ✅ Modify file in GAS and sync back to local
- ✅ Show uncommitted changes in git status after sync
- ✅ Handle bidirectional changes safely

### 6. Git Set Sync Folder - Reconfigure Location (3 tests)
- ✅ Update sync folder configuration
- ✅ Verify .git.gs file reflects new folder
- ✅ Return new folder in subsequent get_sync_folder calls

### 7. Git Sync Workflows - Advanced Operations (4 tests)
- ✅ Support dry-run mode
- ✅ Support pull-only direction
- ✅ Support file filtering with includeFiles
- ✅ Support file filtering with excludeFiles

### 8. Error Handling and Edge Cases (3 tests)
- ✅ Fail gracefully when syncing project without git association
- ✅ Handle missing sync folder gracefully
- ✅ Provide helpful error for invalid scriptId

### 9. File Transformations (3 tests)
- ✅ Verify .git.gs file is NOT synced to local
- ✅ Handle CommonJS wrapping during sync
- ✅ Verify local files match GAS content (ignoring wrapper)

## Tool Names (IMPORTANT)

**CRITICAL**: MCP Gas Server tool naming conventions:

### Git Sync Tools (NO prefix)
Git sync tools use **plain names without the `mcp__gas__` prefix**:
- ✅ `git_init` (NOT `mcp__gas__git_init`)
- ✅ `git_sync` (NOT `mcp__gas__git_sync`)
- ✅ `git_status` (NOT `mcp__gas__git_status`)
- ✅ `git_set_sync_folder` (NOT `mcp__gas__git_set_sync_folder`)
- ✅ `git_get_sync_folder` (NOT `mcp__gas__git_get_sync_folder`)

### File Operation Tools (NO prefix)
File operation tools ALSO use **plain names without the `mcp__gas__` prefix**:
- ✅ `cat` (NOT `mcp__gas__cat`)
- ✅ `write` (NOT `mcp__gas__write`)
- ✅ `ls` (NOT `mcp__gas__ls`)
- ✅ `raw_cat` (NOT `mcp__gas__raw_cat`)
- ✅ `raw_write` (NOT `mcp__gas__raw_write`)
- ✅ `grep` (NOT `mcp__gas__grep`)
- ✅ `find` (NOT `mcp__gas__find`)

**Note**: The `mcp__gas__` prefix is ONLY used internally by the MCP server for tool registration, but clients should use the plain names.

## Parameter Names

### git_init
- ✅ `localPath` (NOT `syncFolder`)
- ✅ `repository` (required)
- ✅ `branch` (optional, default: 'main')
- ✅ `scriptId` (required)

### git_set_sync_folder
- ✅ `localPath` (NOT `syncFolder`)
- ✅ `moveExisting` (optional, default: false)
- ✅ `scriptId` (required)

### git_sync
- ✅ `direction` (optional: 'sync' | 'pull-only' | 'push-only')
- ✅ `mergeStrategy` (optional: 'merge' | 'ours' | 'theirs' | 'manual')
- ✅ `forceOverwrite` (optional, default: false)
- ✅ `scriptId` (required)

## Test Repository

- **Repository**: https://github.com/whichguy/ThenRunLater.git
- **Branch**: main
- **Files**: index.html, LICENSE, permissions.js, README.md, script_scheduler.js, ui.js
- **Purpose**: Real-world GAS project for testing sync operations
- **Note**: Tests use temporary sync folder to avoid affecting real repository

## Test Infrastructure

### Authentication
- Uses singleton pattern from `setupIntegrationTest()`
- Single OAuth flow for all tests
- Shared session across all test files
- Cached tokens in `.sessions/` directory

### Cleanup
- Creates temporary sync folders (`os.tmpdir()`)
- Creates test GAS projects
- Automatic cleanup in `after()` hooks
- Safe teardown even if tests fail

### Timeouts
- **Standard operations**: 15s (from TEST_TIMEOUTS.STANDARD)
- **Extended operations**: 90s (from TEST_TIMEOUTS.EXTENDED)
- **Sync operations**: 300s (5 minutes, allows for git clone)

## Expected Behavior

### Safe Pull-Merge-Push Pattern
All sync operations follow this pattern:
1. **PULL**: Always pull ALL files from GAS first
2. **MERGE**: Merge with local git changes (local is merge authority)
3. **PUSH**: Push merged result back to GAS (only if merge succeeds)

### File Transformations
- **README.md** (local) ↔ **README.html** (GAS)
- **JavaScript files** - Automatically wrapped/unwrapped as CommonJS modules
- **.git.gs** - Stays in GAS only, never synced to local
- **.gitignore** - Transformed as needed

### Error Handling
- Clear error messages for common issues
- Recommended next steps in responses
- Graceful failures with state preservation
- Conflict detection and manual resolution support

## Integration with Other Tools

### Standard Git Commands
```bash
cd <syncFolder>
git status              # Check local state
git add -A && git commit -m "message"
git push origin main    # Push to GitHub
```

### GitHub CLI (gh)
```bash
gh repo view            # Check repo status
gh pr create            # Create pull request
gh pr list              # View open PRs
```

### GitHub MCP Server
- `mcp__github__get_repository` - Compare with remote state
- `mcp__github__create_pull_request` - After pushing changes
- `mcp__github__list_commits` - Review commit history

## Common Issues

### "No git association found"
**Solution**: Run `git_init` first to create `.git.gs` file

### "Sync folder does not exist"
**Solution**: Check path with `git_get_sync_folder`, folder will be created automatically

### "Merge conflicts detected"
**Solution**: Resolve conflicts in local files, then run `git_sync` again

### "Permission denied"
**Solution**: Check GAS permissions and OAuth scopes

## Test Metrics

- **Total Tests**: 30 test cases
- **Tool Coverage**: All 5 git sync tools
- **Workflow Coverage**: Initialization, sync, status, reconfiguration
- **Error Coverage**: Invalid inputs, missing associations, merge conflicts
- **Transformation Coverage**: README, CommonJS, dotfiles

## Development Notes

### Adding New Tests
Follow the existing pattern:
```typescript
it('should <expected behavior>', async function() {
  this.timeout(TEST_TIMEOUTS.STANDARD);
  expect(testProjectId).to.not.be.null;

  const result = await client.callAndParse('git_<tool>', {
    scriptId: testProjectId,
    // ... parameters
  });

  expect(result).to.have.property('success', true);
  // ... assertions
});
```

### Test Isolation
- Each test suite creates its own GAS project
- Uses temporary sync folders (cleaned up automatically)
- Does not affect the actual ThenRunLater repository
- Safe to run multiple times

### Debugging
Enable debug logging:
```bash
DEBUG=mcp:* npm run test:mcp-git
```

## Documentation References

- **GIT_WORKFLOWS.md** - Complete git sync documentation
- **CLAUDE.md** - MCP Gas Server architecture
- **test/README.md** - Test pattern documentation
- **TESTING_COMPLETE.md** - Previous test improvements

## Summary

This test suite provides comprehensive coverage of all git sync tools, ensuring:
- ✅ Safe synchronization with pull-merge-push pattern
- ✅ Proper file transformations
- ✅ Error handling with clear messages
- ✅ Integration with standard git workflows
- ✅ Real-world testing with actual GAS projects

Run `npm run test:mcp-git` to execute the complete suite!