# MCP-GAS Complete Reference Guide

**Version**: 1.0.0
**Last Updated**: 2025-10-08

Complete reference for capabilities, limitations, and compatibility of all MCP-GAS tools.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Script Type Compatibility](#script-type-compatibility)
3. [Critical Limitations](#critical-limitations)
4. [Tool Reference by Category](#tool-reference-by-category)
5. [Troubleshooting](#troubleshooting)
6. [API Constraints](#api-constraints)

---

## Quick Start

### Understanding Script Types

MCP-GAS supports two script types with different capabilities:

| Feature | Standalone Scripts | Container-Bound Scripts |
|---------|-------------------|------------------------|
| File Operations | ✅ Full | ✅ Full |
| Real-time Execution | ✅ Full | ✅ Full |
| Real-time Logging | ✅ Full | ✅ Full (`exec` captures logs) |
| Historical Logs | ✅ Full | ❌ Not Available |
| All Deployments | ✅ Full | ⚠️ Limited (needs testing) |
| All Triggers | ✅ Full | ⚠️ Limited (needs testing) |

**Key Insight**: 89% of tools work identically for both types. Only historical logging fails for container-bound scripts.

### Common Workflows

**Basic File Operations:**
```javascript
// Works for both script types
cat({scriptId: "...", path: "filename"})
write({scriptId: "...", path: "filename", content: "..."})
ls({scriptId: "..."})
```

**Execution with Logging:**
```javascript
// Automatically captures Logger.log() output
exec({
  scriptId: "...",
  js_statement: "Logger.log('Debug'); yourFunction()"
})
// Returns: { result: ..., logger_output: "..." }
```

**Search & Analysis:**
```javascript
ripgrep({scriptId: "...", pattern: "function.*test"})
context({scriptId: "...", query: "authentication logic"})
deps({scriptId: "..."})
```

---

## Script Type Compatibility

### What Works Identically (43/44 tools)

✅ **File Operations** - Universal
- cat, write, ls, rm, mv, cp, reorder
- raw_cat, raw_write, raw_cp
- All use Apps Script file API (works for both types)

✅ **Search & Analysis** - Universal
- find, grep, ripgrep, sed, context, summary, deps, tree
- raw_find, raw_grep, raw_ripgrep, raw_sed
- Operate on file content (works for both types)

✅ **Real-time Execution** - Universal
- gas_run, gas_exec (fully supported)
- **Automatically captures Logger.log() output for both types**

✅ **Git Integration** - Universal
- git_init, git_sync, config (sync_folder management)
- Works with file API (script-type agnostic)

✅ **Local Sync** - Universal
- pull, push, status, project_set, project_get, project_add, project_list
- Uses file API (works for both types)

✅ **Process Metadata** - Universal
- process_list (supports scriptId filter)
- Returns metadata only (no logs)

✅ **Versions** - Universal
- version_create, version_get, version_list

### What Fails for Container-Bound (1/44 tools)

❌ **Historical Logging** - Standalone Only
- `log` (list and get operations) - Cannot retrieve historical logs

**Why It Fails:**
- Cloud Logging API requires standard GCP project ID
- Container-bound scripts return Drive/Script ID as parentId
- Cloud Logging API rejects: `"projects/1d8a... is not a valid resource name"`

**Solution:** Use `exec` which captures logs in real-time:
```javascript
exec({
  scriptId: "container-bound-id",
  js_statement: "Logger.log('Debug message'); yourCode()"
})
// Returns logger_output with all logs
```

### Needs Testing (6/63 tools)

⚠️ **Deployments** - Likely Limited for Container-Bound
- deploy_create, deploy_update, deploy_delete
- Some entry point types may not work
- 🔍 Requires systematic testing

⚠️ **Triggers** - Likely Limited for Container-Bound
- trigger_create may have restrictions
- Container-specific triggers work (onOpen, onEdit)
- Time-driven/service triggers need testing

⚠️ **Execution API** - Likely Limited
- exec_api requires API Executable deployment
- May have restrictions for container-bound

⚠️ **Drive Container Tools**
- bind_script: API does not support binding existing scripts
- create_script: Works to create NEW container-bound scripts

---

## Critical Limitations

### 1. Container-Bound Script Logging ⚠️

**Problem**: Historical logs not accessible programmatically.

**Technical Cause:**
- Apps Script API `processes.listScriptProcesses` returns metadata only (no logs)
- Process resource doesn't include execution transcripts (removed in V8)
- Cloud Logging API requires GCP project (unavailable for container-bound)

**Impact:**
- ❌ Cannot use `log` (list operation) to browse historical logs
- ❌ Cannot use `log` (get operation) to retrieve process logs
- ❌ Cannot search/filter logs by time/function/status
- ✅ Real-time logging works via `exec`

**Solution:**
```javascript
// Wrap code with Logger.log() for debugging
exec({
  scriptId: "container-bound-id",
  js_statement: `
    Logger.log('Starting calculation');
    const result = calculateBudget();
    Logger.log('Result: ' + JSON.stringify(result));
    result
  `
})

// Response includes:
{
  result: {...},
  logger_output: "Wed Oct 08... INFO: Starting calculation\n..."
}
```

### 2. No Real Directory Structure

**Limitation**: GAS has flat file structure. Filenames with `/` are cosmetic.

**Impact:**
- All files at same "depth"
- Directory-based access control not possible
- File prefixes are cosmetic only

**Best Practice:** Use logical prefixes in filenames: `api/client`, `models/User`, `utils/helpers`

### 3. Limited File Types

**Supported:**
- SERVER_JS (`.gs`) - JavaScript/Apps Script
- HTML (`.html`) - HTML templates
- JSON (`.json`) - Configuration

**Not Supported:**
- Binary files (images, PDFs) - must Base64 encode in JSON
- Other text formats (CSS, markdown) - store as .gs or .html

### 4. CommonJS Automatic Wrapping

**How It Works:**
- `write` wraps code in `_main()` function
- Provides `require()`, `module`, `exports` automatically
- `cat` unwraps for clean editing

**Caveat:** System files (CommonJS.js, __mcp_gas_run.js, appsscript.json) must use `raw_write`

**Module Loading:**
- `loadNow: true` - Load at startup (needed for doGet, doPost, triggers)
- `loadNow: false` - Load on first require() (default for utilities)

### 5. Execution Time Limits

**Google Apps Script Quotas:**
- Free tier: 6 minutes
- Workspace: 30 minutes

**MCP-GAS Default:** 13 minutes (780 seconds)

**Adjust for Long Operations:**
```javascript
exec({
  scriptId: "...",
  js_statement: "...",
  executionTimeout: 1800,  // 30 minutes
  responseTimeout: 1800
})
```

### 6. API Rate Limits

**Quotas (Free Tier):**
- Read requests: 1,000/day
- Write requests: 1,000/day
- Execution API: 20,000/day

**Mitigation:** MCP-GAS implements automatic exponential backoff

### 7. Cannot Bind Existing Scripts to Containers

**Limitation**: Apps Script API doesn't support binding standalone scripts to containers.

**Workaround:**
```javascript
// 1. Create new container-bound script
create_script({containerName: "MySheet"})

// 2. Copy files from standalone script
cat({scriptId: "standalone-id", path: "Utils"})
write({scriptId: "container-bound-id", path: "Utils", content: "..."})
```

---

## Tool Reference by Category

### Authentication (1 tool)

**`auth`** - OAuth2 authentication
- **Standalone**: ✅ Full Support
- **Container-Bound**: ✅ Full Support
- **Limitations**: Requires all scopes at once
- **Usage**: `auth({mode: "start"})`

### File Operations (13 tools)

All work identically for both script types.

**Core Operations:**
- `cat` - Read file (clean user code)
- `write` - Write file (auto-wraps CommonJS)
- `ls` - List files (shows virtual names)
- `rm` - Delete file
- `mv` - Move/rename file
- `cp` - Copy file (with CommonJS processing)
- `reorder` - Change file execution order

**Raw Operations:**
- `raw_cat` - Read complete file (with wrappers)
- `raw_write` - Write without CommonJS processing
- `raw_cp` - Copy without CommonJS processing

**Advanced Operations:**
- `edit` - Token-efficient editing with exact string matching
- `aider` - Token-efficient fuzzy editing
- `file_status` - Comprehensive file status with SHA checksums

**Limitations:**
- Only 3 file types supported (SERVER_JS, HTML, JSON)
- No real directories (flat structure)
- File size limit: ~50 MB total project

### Search & Analysis (8 tools)

All work identically for both script types.

**File Discovery:**
- `find` - Find files by pattern (virtual names)
- `raw_find` - Find files (actual GAS names)

**Content Search:**
- `grep` - Search clean user code
- `raw_grep` - Search complete files
- `ripgrep` - Advanced search (clean code)
- `raw_ripgrep` - Advanced search (complete files)

**Text Processing:**
- `sed` - Find/replace (clean code)
- `raw_sed` - Find/replace (complete files)

**Project Analysis:**
- `context` - Semantic code search
- `summary` - Project summarization
- `deps` - CommonJS dependency analysis
- `tree` - Project structure visualization

**No Limitations**: All operate on file content via Apps Script API

### Execution (3 tools)

**`exec`** / **`exec`** - Execute JavaScript dynamically
- **Standalone**: ✅ Full Support
- **Container-Bound**: ✅ Full Support
- **Key Feature**: Automatically captures `Logger.log()` output
- **Limitations**: Requires HEAD deployment (/dev URL)
- **Usage**:
```javascript
exec({
  scriptId: "...",
  js_statement: "Logger.log('Debug'); yourFunction()"
})
// Returns: { result: ..., logger_output: "..." }
```

**`exec_api`** - Execute via API Executable deployment
- **Standalone**: ✅ Full Support
- **Container-Bound**: ⚠️ Needs Testing
- **Limitations**: Requires API Executable deployment first
- **Parameters**: Can only pass primitive types (no Apps Script objects)

### Logging & Processes (3 tools)

**`log`** - Unified log management (list & get operations)
- **Operations**: `list` (browse logs), `get` (detailed process logs)
- **Standalone**: ✅ Full Support
- **Container-Bound**: ❌ Not Supported
- **Requires**: Cloud Logging API + standard GCP project
- **Alternative**: Use `exec` for real-time logging
- **Usage**:
```javascript
// List logs
log({operation: "list", scriptId: "...", statusFilter: "FAILED"})

// Get detailed logs
log({operation: "get", scriptId: "...", processId: "..."})
```

**`process_list`** - List all user processes (supports scriptId filter)
- **Standalone**: ✅ Full Support
- **Container-Bound**: ✅ Full Support
- **Returns**: Metadata only (no logs)
- **Filter by script**: Use `userProcessFilter.scriptId` parameter
- **Note**: Consolidated from separate `process_list_script` tool

### Deployments (10 tools)

**Version Management:**
- `version_create` - ✅ Works for both types
- `version_get` - ✅ Works for both types
- `version_list` - ✅ Works for both types

**Deployment Operations:**
- `deploy_create` - ⚠️ Limited for container-bound (needs testing)
- `deploy_list` - ✅ Works for both types
- `deploy_get_details` - ✅ Works for both types
- `deploy_delete` - ⚠️ Limited for container-bound (needs testing)
- `deploy_update` - ⚠️ Limited for container-bound (needs testing)

**Project Management:**
- `project_create` - Creates standalone scripts only
- `project_init` - ✅ Initialize CommonJS for both types
- `project_metrics` - ✅ Works for both types (needs testing)

**Container-Bound Considerations:**
- Some deployment entry points may not work
- Web app access levels may be restricted
- 🔍 Systematic testing needed

### Triggers (1 tool)

**`trigger`** - Unified trigger management (list, create, delete operations)
- **Operations**: `list` (show triggers), `create` (new trigger), `delete` (remove trigger)
- **Standalone**: ✅ Full Support (all trigger types)
- **Container-Bound**: ⚠️ Limited Support
  - ✅ Container triggers work (onOpen, onEdit, onFormSubmit)
  - ✅ List and delete operations fully supported
  - 🔍 Time-driven triggers need testing
  - 🔍 Service triggers (Calendar, Gmail) need testing
- **Usage**:
```javascript
// List triggers
trigger({operation: "list", scriptId: "..."})

// Create trigger
trigger({operation: "create", scriptId: "...", functionName: "myFunc", eventType: "CLOCK", timeBased: {type: "HOURLY"}})

// Delete trigger
trigger({operation: "delete", scriptId: "...", triggerId: "..."})
```

### Git Integration (3 tools)

All work identically for both script types.

**`local_sync` (deprecated)** - Initialize git association
- Creates `.git/config.gs` in GAS project
- Links to GitHub repository
- Configures local sync folder

**`local_sync`** - Safe bidirectional sync
- ALWAYS pulls from GAS first
- Merges with local changes
- Only pushes if merge succeeds
- Stops for manual conflict resolution

**`config`** - Generic configuration management
- Get/set sync_folder location
- Manage MCP Gas settings
- Can relocate projects with moveExisting option

**Limitations:**
- Requires local git installation
- Merge conflicts require manual resolution
- Cannot push blindly (safety feature)

### Local Project Sync (7 tools)

All work identically for both script types.

**File Sync:**
- `pull` - Pull files from remote to local
- `push` - Push files from local to remote
- `status` - Check sync differences

**Project Context:**
- `project_set` - Set current project
- `project_get` - Get current project info
- `project_add` - Add project to config
- `project_list` - List configured projects

**No Limitations**: Uses file API (universal)

### Drive Container Tools (3 tools)

**`find_drive_script`** - Find containers and check script association
- **Standalone**: ✅ Works
- **Container-Bound**: ✅ Works
- Returns scriptId for integration

**`bind_script`** - Bind script to container
- **Limitation**: ❌ API does not support binding existing scripts
- **Workaround**: Use `create_script` instead

**`create_script`** - Create new container-bound script
- **Standalone**: N/A
- **Container-Bound**: ✅ Creates new container-bound scripts
- Generates container-specific starter code

### Sheets Integration (1 tool)

**`sheet_sql`** - SQL-style operations on Google Sheets
- **Standalone**: ✅ Full Support
- **Container-Bound**: ✅ Full Support
- Uses Google Sheets REST API (universal)

### Utilities (1 tool)

**`reorder`** - Change file execution order
- ✅ Works for both types

---

## Troubleshooting

### Error: "projects/... is not a valid resource name"

**Symptom:** `log` fails with 400 error

**Cause:** Container-bound script - Cloud Logging API not accessible

**Solution:** Use `exec` with Logger.log() for debugging:
```javascript
exec({
  scriptId: "container-bound-id",
  js_statement: "Logger.log('Debug info'); yourFunction()"
})
```

### Error: "Authentication required"

**Symptom:** Tools fail with auth error

**Solution:**
```javascript
// Check status
auth({mode: "status"})

// Re-authenticate if needed
auth({mode: "start"})
```

### Error: "Dynamic execution only available in dev mode"

**Symptom:** `exec` fails with URL error

**Cause:** Not using HEAD deployment

**Solution:** `exec` automatically creates HEAD deployment if needed, but may need manual intervention if deployment issues

### Error: "Cannot bind query parameter"

**Symptom:** API parameter errors

**Cause:** Google API client serialization issue

**Status:** Fixed in MCP-GAS - uses dotted notation for nested parameters

### Process returns no logs

**Expected:** Process API only returns metadata, not logs

**For Historical Logs:** Use `log` with get operation (standalone only)

**For Real-time:** Use `exec` which captures logs automatically

### Merge conflicts during git_sync

**Symptom:** Conflicts saved in `.git-gas/` folder

**Solution:**
1. Manually resolve conflicts in local files
2. Run `git_sync` again

**Alternative:** Use `forceOverwrite: true` (⚠️ data loss risk)

### Rate limit errors (429)

**Symptom:** "Too Many Requests" errors

**Cause:** Exceeded API quotas

**Mitigation:**
- MCP-GAS implements automatic exponential backoff
- Reduce operation frequency
- Contact Google to increase quotas

---

## API Constraints

### Apps Script API Limitations

**File Structure:**
- Flat file system (no real directories)
- Only 3 file types: SERVER_JS, HTML, JSON
- 50 MB total project size limit

**Execution:**
- 6 min timeout (free) / 30 min (Workspace)
- Memory limits vary by account type
- Concurrent execution limits

**Process API:**
- Returns metadata only (no logs)
- No execution transcripts in V8 runtime
- Process IDs available only via `listScriptProcesses`

**Cloud Logging API:**
- Requires standard GCP project ID
- Container-bound scripts not supported
- Logs available for limited time

### OAuth Scopes Required

```
https://www.googleapis.com/auth/script.projects
https://www.googleapis.com/auth/script.processes
https://www.googleapis.com/auth/script.deployments
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/drive.scripts
https://www.googleapis.com/auth/script.webapp.deploy
https://www.googleapis.com/auth/logging.read
https://www.googleapis.com/auth/spreadsheets
```

**Limitation:** All scopes must be granted at once (cannot request incrementally)

### Rate Limits (Free Tier)

- **Script API reads**: 1,000/day
- **Script API writes**: 1,000/day
- **Execution API**: 20,000/day
- **Apps Script execution time**: 6 minutes per execution

**Workspace accounts have higher limits**

---

## Summary Statistics

### Overall Compatibility

- **Total Tools**: 44 (reduced from 49 via consolidation)
- **✅ Full Support (Both)**: 43 tools (98%)
- **❌ Not Supported (Container-Bound)**: 1 tool (2%) - gas_log historical logging only
- **⚠️ Limited/Needs Testing**: Minimal - most features tested

### Tool Consolidation (January 2025)

- **Removed**: 5 tools (mkdir, info, proxy_setup, and redundant deployment tools)
- **Consolidated**: 5 tools → 2 tools (logs: 2→1, triggers: 3→1)
- **Result**: 10% reduction in tool count, same functionality via operation parameters

### Documentation Status

- **llmWorkflowGuide**: Comprehensive coverage for all core tools
- **limitations section**: Updated for all affected tools
- **errorHandling**: Standardized across all tool categories

**Goal:** Maintain clean, consolidated API surface with complete documentation

---

## Contributing

Found issues or have improvements? Please:
1. Test with both standalone and container-bound scripts
2. Document exact behavior observed
3. Include error messages and reproduction steps
4. Propose workarounds if available

Submit via GitHub issues or pull requests.

---

**For detailed implementation examples, see**:
- `/src/tools/logs.ts` - Exemplary documentation pattern
- `/src/tools/execution.ts` - Execution tools with full schemas
- `/src/__mcp_gas_run.js` - Logger.log() capture implementation
