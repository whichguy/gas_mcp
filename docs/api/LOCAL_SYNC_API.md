# Local-Remote Sync API

This document describes the new local-remote synchronization functionality for the MCP Gas Server, which enables seamless development workflows between local files and Google Apps Script projects.

## 🎯 Overview

The MCP Gas Local Sync API provides seamless integration between local development and remote Google Apps Script projects. This system enables:

- **Current Project Concept**: Persistent project context that survives server restarts
- **Local Project References**: Named projects from `.gas-projects.json` vs remote script IDs
- **Environment Shortcuts**: Quick switching between dev/staging/production environments
- **Automatic File Sync**: Smart pulling and pushing with conflict detection
- **Git-Friendly Workflow**: Local `./src/` directory with proper file extensions

## **📋 Tool Usage Guide**

### **✅ RECOMMENDED TOOLS (Normal Workflow)**
Use these for day-to-day development. They handle local/remote sync automatically and provide module wrapper functionality.

| Tool | Purpose | Key Features | When to Use |
|------|---------|-------------|-------------|
| **`gas_project_set`** | Set project & auto-pull | Project context management | Start working on a project |
| **`gas_write`** | Auto-sync writer with module wrapper | **🎯 Automatic `_main()` wrapper for `require()` system** | Edit files with explicit paths (projectId/filename) |
| **`gas_cat`** | Smart reader | Local-first, remote fallback | Read files (local-first, remote fallback) |
| **`gas_run`** | Current project execution | Works with current project context | Run code in current project |

**🔑 Module Wrapper Advantage**: `gas_write` automatically wraps your JavaScript code with the proper `_main()` function signature, enabling seamless `require()` functionality across your modules without manual wrapper management.

### **🔄 EXPLICIT TOOLS (Multi-Environment)**
Use these for deployment workflows and troubleshooting.

| Tool | Purpose | When to Use |
|------|---------|-------------|
| **`gas_pull`** | Explicit remote → local | Multi-environment sync, reset local |
| **`gas_push`** | Explicit local → remote | Deploy to staging/production |
| **`gas_status`** | Compare local vs remote | Check sync status, find conflicts |

### **⚠️ ADVANCED TOOLS (Power Users Only)**
**🚨 WARNING**: Use these only when you need explicit control and understand the risks. They lack automatic module wrapper functionality.

| Tool | Purpose | ⚠️ Risks | When to Use | ❌ When NOT to Use |
|------|---------|----------|-------------|-------------------|
| **`gas_raw_write`** | ⚠️ Explicit project ID paths | **CLOBBERS files, no module wrapper** | File replacement, positioning control | Normal development, collaborative editing |
| **`gas_raw_cat`** | Explicit project ID paths | No local caching, no context | Direct API access, automation | Normal development, current project set |
| **`gas_raw_run`** | Explicit script ID | No current project context | Multiple projects, testing | Normal development, current project set |

**🔑 Key Limitation**: Raw tools do NOT provide automatic module wrapper functionality, meaning your code won't work with the `require()` system unless you manually add the `_main()` wrapper.

---

### **Key Terminology**

| Term | Description | Example |
|------|-------------|---------|
| **Local Project Reference** | Project name or environment from local config | `"my-calculator"`, `{dev: true}` |
| **Remote Script ID** | 44-character Google Drive file ID | `"1jK_ujSHRCsEeBizi6xycuj_0y..."` |
| **Current Project** | Active project set via `gas_project_set` | Stored in `.gas-current.json` |
| **Auto-sync** | Automatic local + remote synchronization | Smart tools handle this automatically |
| **Environment Shortcut** | Dev/staging/prod references in local config | `{staging: true}` |

## 🔧 Core Tools

### Project Context Management

#### `gas_project_set`

Set the current project for the workspace and **automatically pull files** to `./src/`.

**Key Features:**
- ✅ **Auto-pull by default** - Automatically syncs remote files to local
- ✅ **Controllable** - Use `autoPull: false` to skip file sync
- ✅ **Smart naming** - Uses local names when available

**Parameters:**
- `project` (required) - Project name, script ID, or environment object
- `workingDir` (optional) - Working directory (defaults to current directory)
- `accessToken` (optional) - Access token for stateless operation
- `autoPull` (optional) - Auto-pull files from remote (default: true)

**Examples:**
```javascript
// Auto-pull enabled (default)
gas_project_set({project: "my-calculator"})

// Skip auto-pull
gas_project_set({project: "my-calculator", autoPull: false})

// Environment shortcuts
gas_project_set({project: {dev: true}})
```

**Behavior:**
- Resolves project parameter to script ID
- Fetches project info using existing `gas_info` functionality
- Downloads all files using existing `gas_ls` and `gas_cat` functionality
- Caches files locally in `./src/` directory
- Updates `.gas-current.json` with project context

#### `gas_project_get`
Get current project information and status.

**Parameters:**
- `workingDir` (optional) - Working directory
- `detailed` (optional) - Include detailed comparison info
- `accessToken` (optional) - Access token for stateless operation

**Examples:**
```javascript
// Basic info
gas_project_get()

// Detailed info with file comparison
gas_project_get({detailed: true})
```

#### `gas_project_add`
Add a project to the local configuration.

**Parameters:**
- `name` (required) - Project name identifier
- `scriptId` (required) - Google Apps Script project ID
- `description` (optional) - Project description
- `workingDir` (optional) - Working directory

**Example:**
```javascript
gas_project_add({
  name: "calculator-dev",
  scriptId: "abc123def456ghi789...",
  description: "Calculator development environment"
})
```

#### `gas_project_list`
List all configured projects.

**Parameters:**
- `workingDir` (optional) - Working directory

**Example:**
```javascript
gas_project_list()
```

### Local-Remote Sync

#### `gas_pull`
Pull files from remote project to local `./src/` directory.

**Parameters:**
- `project` (optional) - Project to pull from (defaults to current project)
- `workingDir` (optional) - Working directory
- `force` (optional) - Overwrite local files without confirmation
- `accessToken` (optional) - Access token for stateless operation

**Examples:**
```javascript
// Pull from current project
gas_pull()

// Pull from specific project
gas_pull({project: "staging"})

// Force overwrite local files
gas_pull({force: true})

// Pull from environment
gas_pull({project: {prod: true}})
```

**Behavior:**
- Uses existing `gas_ls` to get remote file list
- Uses existing `gas_cat` to get file contents
- Writes files to local `./src/` directory with proper extensions
- Warns if local files exist unless `force: true`

#### `gas_push`
Push local `./src/` files to remote project.

**Parameters:**
- `project` (optional) - Project to push to (defaults to current project)
- `workingDir` (optional) - Working directory  
- `dryRun` (optional) - Show what would be pushed without pushing
- `accessToken` (optional) - Access token for stateless operation

**Examples:**
```javascript
// Push to current project
gas_push()

// Push to specific project
gas_push({project: "production"})

// Dry run to see what would be pushed
gas_push({dryRun: true})
```

**Behavior:**
- Scans local `./src/` directory for files
- Uses existing `gas_write` functionality to update each file
- Reports success/error status for each file
- Returns summary of push operation

#### `gas_status`
Show status and differences between local and remote files.

**Parameters:**
- `project` (optional) - Project to compare with (defaults to current project)
- `workingDir` (optional) - Working directory
- `detailed` (optional) - Show detailed file-by-file comparison
- `accessToken` (optional) - Access token for stateless operation

**Examples:**
```javascript
// Status vs current project
gas_status()

// Status vs specific project
gas_status({project: "staging"})

// Detailed comparison
gas_status({detailed: true})
```

**Response Statuses:**
- `same` - Files are identical
- `different` - Files have different content
- `local-only` - File exists only locally
- `remote-only` - File exists only remotely

## Configuration Files

### `.gas-current.json`
Stores the current project context:

```json
{
  "projectName": "calculator-dev",
  "scriptId": "abc123def456ghi789...",
  "lastSync": "2024-01-15T10:30:00Z"
}
```

### `.gas-projects.json`
Stores project registry and environment shortcuts:

```json
{
  "projects": {
    "calculator-dev": {
      "scriptId": "abc123def456...",
      "name": "Calculator Development",
      "description": "Development environment for calculator app"
    },
    "inventory-system": {
      "scriptId": "def456ghi789...",
      "name": "Inventory Management System"
    }
  },
  "environments": {
    "dev": {
      "scriptId": "abc123def456...",
      "name": "Development Environment"
    },
    "staging": {
      "scriptId": "def456ghi789...",
      "name": "Staging Environment"
    },
    "production": {
      "scriptId": "ghi789abc123...",
      "name": "Production Environment"
    }
  }
}
```

## Workflow Examples

### Daily Development Workflow

```javascript
// 1. Set current project (downloads files to ./src/)
gas_project_set({project: "calculator-dev"})

// 2. Edit files locally using Cursor IDE
// Files are in ./src/ directory with proper extensions

// 3. Check status
gas_status()

// 4. Push changes
gas_push()

// 5. Execute code remotely (using existing tools)
gas_run({js_statement: "myFunction()"})
```

### Multi-Environment Deployment

```javascript
// 1. Develop locally
gas_project_set({project: {dev: true}})
// Edit files...
gas_push()

// 2. Deploy to staging
gas_push({project: "staging"})

// 3. Deploy to production
gas_push({project: "production"})

// 4. Create production version (using existing tools)
gas_version_create("ghi789abc123...")
gas_deploy_create("ghi789abc123...", {entryPointType: "WEB_APP"})
```

### Project Comparison

```javascript
// Compare local changes with different environments
gas_status({project: {dev: true}})
gas_status({project: {staging: true}})
gas_status({project: {prod: true}})
```

## Integration with Existing Tools

The sync functionality leverages existing MCP Gas tools:

### File Operations
- `gas_ls()` - Lists remote project files
- `gas_cat()` - Reads remote file contents  
- `gas_write()` - Updates remote files
- `gas_info()` - Gets project information

### Project Management
- `gas_run()` - Executes code on current project
- `gas_version_create()` - Creates versions for deployment
- `gas_deploy_create()` - Deploys projects

### Authentication
- `gas_auth()` - OAuth authentication (shared across all tools)

## Error Handling

The sync tools provide comprehensive error handling:

- **Missing current project**: Clear message to use `gas_project_set` first
- **File conflicts**: Warning messages with suggestions
- **Network errors**: Proper error propagation from underlying GAS API calls
- **Authentication errors**: Standard OAuth error handling

## Best Practices

### Git Integration
1. Initialize git repository in your workspace
2. Add `./src/` directory to git
3. Add `.gas-current.json` and `.gas-projects.json` to git
4. Use standard git workflow for local version control

### Development Process
1. Use `gas_project_set()` to start working on a project
2. Edit files locally in `./src/` using your preferred IDE
3. Use `gas_status()` to check changes before pushing
4. Use `gas_push()` to update remote project
5. Use existing `gas_run()` to test code remotely
6. Use `gas_push()` to deploy to other environments

### File Organization
- Keep related functionality in separate `.gs` files
- Use meaningful file names (utilities, main, config, etc.)
- Organize with logical naming conventions
- Let the system handle file extensions automatically

This sync functionality provides a complete local development experience while leveraging all existing MCP Gas server capabilities. 