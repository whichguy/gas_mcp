# MCP Gas Server Tool Naming Reference

## Critical Discovery: Tool Names Do NOT Use `mcp__gas__` Prefix

**IMPORTANT**: All MCP Gas Server tools use **plain names without the `mcp__gas__` prefix** when called from clients!

## Complete Tool Inventory (70 tools)

### Authentication & Project Management
- ✅ `auth` - OAuth authentication
- ✅ `project_set` - Set current project context
- ✅ `project_list` - List configured projects
- ✅ `project_create` - Create new project
- ✅ `project_get` - Get project details
- ✅ `project_add` - Add existing project
- ✅ `project_init` - Initialize project configuration
- ✅ `project_metrics` - Get project metrics

### File Operations (Smart - CommonJS Processing)
- ✅ `cat` - Read file (unwrapped)
- ✅ `write` - Write file (auto-wraps)
- ✅ `ls` - List files
- ✅ `rm` - Remove file
- ✅ `cp` - Copy file
- ✅ `mv` - Move/rename file
- ✅ `mkdir` - Create directory/prefix
- ✅ `reorder` - Reorder files
- ✅ `edit` - Edit file with diff
- ✅ `tree` - Show file tree

### File Operations (Raw - Exact Content)
- ✅ `raw_cat` - Read file (exact content)
- ✅ `raw_write` - Write file (no wrapping)
- ✅ `raw_cp` - Copy file (exact)
- ✅ `raw_edit` - Edit file (raw)

### Search & Text Processing
- ✅ `grep` - Pattern search
- ✅ `find` - Find files by criteria
- ✅ `sed` - Find and replace
- ✅ `ripgrep` - Advanced multi-pattern search
- ✅ `raw_grep` - Raw grep
- ✅ `raw_find` - Raw find
- ✅ `raw_sed` - Raw sed
- ✅ `raw_ripgrep` - Raw ripgrep

### Fuzzy Matching & AI-Assisted Editing
- ✅ `aider` - Fuzzy match editing
- ✅ `raw_aider` - Raw aider

### Code Execution
- ✅ `run` - Execute JavaScript code
- ✅ `exec` - Execute with deployment
- ✅ `exec_api` - Execute via API

### Versioning & Deployment
- ✅ `version_create` - Create version
- ✅ `version_list` - List versions
- ✅ `version_get` - Get version details
- ✅ `deploy_create` - Create deployment
- ✅ `deploy_list` - List deployments
- ✅ `deploy_get_details` - Get deployment details
- ✅ `deploy_delete` - Delete deployment
- ✅ `deploy_update` - Update deployment

### Git Sync Operations
- ✅ `git_init` - Initialize git association
- ✅ `git_sync` - Synchronize files
- ✅ `git_status` - Check git status
- ✅ `git_set_sync_folder` - Set sync folder
- ✅ `git_get_sync_folder` - Get sync folder

### Project Information & Analysis
- ✅ `info` - Get project info
- ✅ `status` - Get project status
- ✅ `summary` - Get project summary
- ✅ `file_status` - Get file checksums/metadata
- ✅ `deps` - Analyze dependencies
- ✅ `context` - Get project context

### Scripts & Bindings
- ✅ `create_script` - Create standalone script
- ✅ `bind_script` - Bind script to container
- ✅ `find_drive_script` - Find scripts in Drive

### Triggers
- ✅ `trigger_create` - Create trigger
- ✅ `trigger_list` - List triggers
- ✅ `trigger_delete` - Delete trigger

### Logging & Monitoring
- ✅ `logs_list` - List execution logs
- ✅ `logs_get` - Get specific log
- ✅ `process_list` - List running processes
- ✅ `process_list_script` - List script processes

### Sync Operations
- ✅ `pull` - Pull from GAS
- ✅ `push` - Push to GAS
- ✅ `proxy_setup` - Setup proxy configuration

### Spreadsheet Operations
- ✅ `sheet_sql` - SQL-like spreadsheet queries

## Wrong Names (DO NOT USE)

❌ `mcp__gas__cat` → Use `cat`
❌ `mcp__gas__write` → Use `write`
❌ `mcp__gas__ls` → Use `ls`
❌ `mcp__gas__grep` → Use `grep`
❌ `mcp__gas__find` → Use `find`
❌ `mcp__gas__sed` → Use `sed`
❌ `mcp__gas__rm` → Use `rm`
❌ `mcp__gas__cp` → Use `cp`
❌ `mcp__gas__mv` → Use `mv`
❌ `mcp__gas__git_init` → Use `git_init`
❌ `mcp__gas__git_sync` → Use `git_sync`
❌ `mcp__gas__version_create` → Use `version_create`
❌ `mcp__gas__deploy_create` → Use `deploy_create`
❌ `mcp__gas__run` → Use `run`
❌ `mcp__gas__info` → Use `info`
❌ `mcp__gas__aider` → Use `aider`
❌ `mcp__gas__ripgrep` → Use `ripgrep`
❌ `mcp__gas__reorder` → Use `reorder`
❌ `mcp__gas__raw_cat` → Use `raw_cat`
❌ `mcp__gas__project_create` → Use `project_create`

## Why This Matters

The `mcp__gas__` prefix is **only used internally** by the MCP server for tool registration. When clients (like tests, Claude Desktop, or other MCP clients) call tools, they should use the **plain names**.

### Internal Registration (Server Side)
```typescript
// In src/server/mcpServer.ts - how tools are registered internally
const server = new Server({
  name: 'mcp-gas',
  version: '1.0.0'
}, {
  capabilities: {
    tools: {}
  }
});

// Each tool registers itself
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'cat', ... },      // Plain name in MCP protocol
    { name: 'write', ... },    // Plain name in MCP protocol
    { name: 'git_init', ... }  // Plain name in MCP protocol
  ]
}));
```

### Client Usage (Test Side)
```typescript
// CORRECT - Use plain names
await client.callTool('cat', { scriptId: '...', path: 'file' });
await client.callTool('git_init', { scriptId: '...', repository: 'https://...' });
await client.callTool('version_create', { scriptId: '...', description: '...' });

// WRONG - Do NOT use mcp__gas__ prefix
await client.callTool('mcp__gas__cat', { ... });  // ❌ Will fail!
await client.callTool('mcp__gas__git_init', { ... });  // ❌ Will fail!
```

## Test Files Fixed

All test files have been corrected to use plain names:
- ✅ `test/integration/mcp-gas-validation/git-operations.test.ts`
- ✅ `test/integration/mcp-gas-validation/search-operations.test.ts`
- ✅ `test/integration/mcp-gas-validation/file-operations.test.ts`
- ✅ `test/integration/mcp-gas-validation/performance.test.ts`
- ✅ `test/integration/mcp-gas-validation/error-handling.test.ts`
- ✅ `test/integration/mcp-gas-validation/module-system.test.ts`
- ✅ `test/integration/mcp-gas-validation/deployment.test.ts`

## Common Patterns

### File Reading
```typescript
// Smart cat - unwraps CommonJS
const result = await client.callTool('cat', {
  scriptId: projectId,
  path: 'MyModule'
});

// Raw cat - shows exact content
const result = await client.callTool('raw_cat', {
  scriptId: projectId,
  path: 'MyModule.gs'
});
```

### Git Operations
```typescript
// Initialize git association
await client.callTool('git_init', {
  scriptId: projectId,
  repository: 'https://github.com/user/repo.git',
  localPath: '/path/to/sync/folder'
});

// Sync files
await client.callTool('git_sync', {
  scriptId: projectId
});
```

### Versioning & Deployment
```typescript
// Create version
const versionResult = await client.callTool('version_create', {
  scriptId: projectId,
  description: 'Release v1.0'
});

// Create deployment
const deployResult = await client.callTool('deploy_create', {
  scriptId: projectId,
  versionNumber: 1,
  description: 'Production deployment'
});
```

## Reference

See also:
- `GIT_OPERATIONS_TESTS.md` - Git sync tool documentation
- `CLAUDE.md` - Complete MCP Gas Server documentation
- `src/tools/` - Tool implementations
