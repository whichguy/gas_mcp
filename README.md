# MCP Google Apps Script Server

<div align="center">

[![npm version](https://img.shields.io/npm/v/mcp-gas-server.svg)](https://www.npmjs.com/package/mcp-gas-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue.svg)](https://www.typescriptlang.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-0.4.0-orange.svg)](https://modelcontextprotocol.io/)

**A powerful Model Context Protocol server for seamless Google Apps Script integration**

[Features](#-features) • [Quick Start](#-quick-start) • [Installation](#-installation) • [Usage](#-usage) • [API Reference](#-api-reference) • [Contributing](#-contributing)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Usage](#-usage)
- [API Reference](#-api-reference)
- [Configuration](#-configuration)
- [Examples](#-examples)
- [Development](#-development)
- [Testing](#-testing)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [Security](#-security)
- [License](#-license)
- [Support](#-support)

## 🎯 Overview

The MCP Google Apps Script Server bridges the gap between AI assistants and Google Apps Script, enabling seamless creation, execution, and management of Google Apps Script projects directly from your development environment. Built with TypeScript and following the Model Context Protocol specification, it provides a robust, type-safe interface for Google Apps Script operations.

### Key Benefits

- **🚀 Direct Code Execution**: Run JavaScript/Apps Script code instantly without manual deployment
- **📁 Full Project Management**: Create, edit, organize, and deploy complete GAS projects
- **🔐 Secure OAuth Integration**: Industry-standard PKCE OAuth 2.0 flow with Google
- **🔄 Real-time Synchronization**: Live sync between local development and Google Apps Script
- **🛠️ Developer-Friendly**: Comprehensive error handling, logging, and debugging tools
- **📱 Drive Integration**: Seamless binding with Google Sheets, Docs, Forms, and Sites

## ✨ Features

### 🔧 Core Functionality
- **Project Management**: Create, list, delete, and manage GAS projects
- **Smart File Operations**: Read, write, copy, move, and organize files with automatic module wrapper
- **Dynamic Code Execution**: Execute JavaScript code directly in GAS environment with `require()` support
- **Deployment Management**: Create, update, and manage web app and API deployments
- **Version Control**: Create and manage project versions with detailed metadata
- **Module System**: Automatic `require()` wrapper for seamless inter-module dependencies

### 🔗 Integration Capabilities
- **Google Drive**: Find and bind scripts to Sheets, Docs, Forms, and Sites
- **OAuth 2.0**: Secure authentication with PKCE flow
- **MCP Protocol**: Standards-compliant Model Context Protocol implementation
- **TypeScript**: Full type safety and IntelliSense support

### 📊 Monitoring & Analytics
- **Execution Metrics**: Track script performance and usage statistics
- **Process Monitoring**: View execution history and debug failed runs
- **Error Reporting**: Comprehensive error tracking and diagnostics

## 📋 Prerequisites

Before getting started, ensure you have:

- **Node.js** v18.0.0 or higher ([Download](https://nodejs.org/))
- **npm** v8.0.0 or higher (comes with Node.js)
- **Google Account** with access to Google Cloud Console
- **Cursor IDE** or another MCP-compatible client
- **Google Cloud Project** with Apps Script API enabled

## 🎯 Recommended Tools

For optimal development experience, use these **preferred tools** that provide automatic module wrapper functionality:

### ✅ **Smart File Operations**
- **`gas_write`**: Automatically wraps JavaScript code with `_main()` function for `require()` system
- **`gas_cat`**: Intelligent local/remote file reading with project context
- **`gas_run`**: Code execution with current project context

### ⚠️ **Advanced Tools (Use with Caution)**
- **`gas_raw_write`**: Direct file writing (clobbers files, no module wrapper)
- **`gas_raw_cat`**: Direct file reading (no local caching)
- **`gas_raw_run`**: Direct code execution (requires explicit script ID)

**🔑 Key Advantage**: Smart tools automatically wrap your JavaScript code with the proper `_main()` function signature, enabling seamless `require()` functionality across your modules without manual wrapper management.

## 🚀 Installation

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/whichguy/mcp_gas.git
cd mcp_gas

# Install dependencies
npm install

# Build the project
npm run build
```

### 2. OAuth Configuration

Create Google OAuth credentials:

1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the **Google Apps Script API**
4. Go to **Credentials** → **Create Credentials** → **OAuth client ID**
5. Choose **Desktop Application**
6. Download the JSON file

Configure the server:

```bash
# Copy your OAuth credentials
cp path/to/your/credentials.json oauth-config.json
```

### 3. Verify Installation

```bash
# Run validation script
./validate-setup.sh

# Start the server
npm start
```

## 🏃 Quick Start

### Basic Workflow

```typescript
// 1. Authenticate with Google
await gas_auth({ mode: "start" });

// 2. Create a new project
const project = await gas_project_create({ 
  title: "My First Calculator" 
});

// 3. Add source code
await gas_write({
  path: `${project.scriptId}/calculator`,
  content: `
    function add(a, b) {
      return a + b;
    }
    
    function fibonacci(n) {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }
  `
});

// 4. Execute code directly
const result = await gas_run({
  scriptId: project.scriptId,
  js_statement: "add(5, 3)"
});
console.log(result); // 8

// 5. Run complex calculations
const fibResult = await gas_run({
  scriptId: project.scriptId,
  js_statement: "fibonacci(10)"
});
console.log(fibResult); // 55
```

### Integration with Cursor IDE

Add to your Cursor configuration:

```json
{
  "mcpServers": {
    "mcp-gas": {
      "command": "node",
      "args": ["/path/to/mcp_gas/dist/src/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

## ⚙️ Configuration

The MCP Gas Server uses a single unified configuration file: `mcp-gas-config.json`

### Unified Configuration Structure

```json
{
  "oauth": {
    "client_id": "your-oauth-client-id.apps.googleusercontent.com",
    "type": "uwp",
    "redirect_uris": ["http://127.0.0.1/*", "http://localhost/*"],
    "scopes": ["https://www.googleapis.com/auth/script.projects", "..."]
  },
  "projects": {
    "my-project": {
      "scriptId": "1ABC...XYZ",
      "name": "my-project",
      "description": "My project description"
    }
  },
  "environments": {
    "dev": { "scriptId": "1ABC...XYZ", "name": "my-project" }
  },
  "localRoot": {
    "rootPath": "/Users/you/src/mcp_gas/gas-projects",
    "lastUpdated": "2025-06-29T16:47:43.135Z"
  },
  "server": {
    "defaultWorkingDir": "/Users/you/src/mcp_gas",
    "configVersion": "1.0.0",
    "lastModified": "2025-06-29T16:47:43.135Z"
  }
}
```

### Starting the Server

```bash
# Using npm (recommended)
npm start

# Direct invocation
node dist/src/index.js --config ./mcp-gas-config.json

# Custom config location
node dist/src/index.js --config /path/to/custom-config.json
```

### Cursor IDE Integration

Update your Cursor configuration to include the config file:

```json
{
  "mcpServers": {
    "mcp-gas": {
      "command": "node",
      "args": [
        "/Users/you/src/mcp_gas/dist/src/index.js",
        "--config",
        "/Users/you/src/mcp_gas/mcp-gas-config.json"
      ],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

## 🔧 All 43 Available Tools

### **📋 Tool Usage Guide**

| Tool Type | When to Use | Examples |
|-----------|-------------|-----------|
| **✅ RECOMMENDED** | Normal development workflow | `gas_write`, `gas_cat`, `gas_run` |
| **🔄 EXPLICIT** | Multi-environment, troubleshooting | `gas_pull`, `gas_push`, `gas_status` |
| **⚠️ ADVANCED** | Power users, explicit control | `gas_raw_write`, `gas_raw_cat`, `gas_raw_copy`, `gas_raw_run` |

---

## **✅ RECOMMENDED TOOLS (Normal Workflow)**

### Authentication (1 tool)
| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_auth` | OAuth 2.0 authentication | `mode`, `openBrowser?` |

### 📂 Smart Filesystem Operations (6 tools)
> **Auto-sync**: Automatically handles local/remote synchronization

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_ls` | List projects/files **with wildcard support** | `path?` (supports `*` and `?` patterns), `detailed?`, `wildcardMode?` |
| **`gas_cat`** | **✅ Smart reader** (local-first, remote fallback) | `path` |
| **`gas_write`** | **✅ Auto-sync writer** (local + remote) | `path` (projectId/filename), `content` |
| `gas_rm` | Delete files | `path` |
| `gas_mv` | Move/rename files | `from`, `to` |
| `gas_cp` | Copy files | `from`, `to` |

### ⚠️ Advanced Filesystem Operations (3 tools)
> **Raw access**: Direct remote operations with explicit project IDs

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_raw_cat` | Read files with explicit project ID | `path` (full projectId/filename) |
| `gas_raw_write` | ⚠️ Write files with explicit project ID (CLOBBERS remote files - use gas_write for safe merging) | `path`, `content` |
| `gas_raw_copy` | Copy files between projects | `from`, `to` |

### 🚀 Smart Execution (1 tool)
> **Current project**: Uses project context automatically

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| **`gas_run`** | **✅ Execute with current project** | `js_statement` |

### ⚠️ Advanced Execution (1 tool)
> **Raw execution**: Direct execution with explicit project IDs

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_raw_run` | Execute with explicit project ID | `scriptId`, `js_statement` |

### 🎯 Project Workflow (1 tool)
> **Main workflow**: Set project and start development

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| **`gas_project_set`** | **✅ Set project & auto-pull files** | `project` |

---

## **🔄 EXPLICIT TOOLS (Multi-Environment)**

### Project Management (4 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_mkdir` | Create logical directories | `projectId`, `directoryPath` |
| `gas_info` | Get project information | `projectId`, `includeContent?` |
| `gas_reorder` | Change file execution order | `projectId`, `fileName`, `newPosition` |
| `gas_project_metrics` | Get project analytics | `scriptId`, `metricsGranularity?` |

### Local Sync & Project Context (4 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_project_set` | Set current project & cache files | `project?`, `workingDir?` |
| `gas_pull` | Pull remote files to local src | `project?`, `force?` |
| `gas_push` | Push local files to remote | `project?`, `dryRun?` |
| `gas_status` | Compare local vs remote files | `project?`, `detailed?` |

### Execution Tools (2 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_run_api_exec` | Execute via API | `scriptId`, `functionName`, `parameters?` |
| `gas_proxy_setup` | Setup HTTP proxy | `scriptId`, `deploy?` |

### Deployment Management (7 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_version_create` | Create project version | `scriptId`, `description?` |
| `gas_deploy_create` | Create deployment | `scriptId`, `entryPointType`, `versionNumber?` |
| `gas_deploy_list` | List deployments | `scriptId` |
| `gas_deploy_get_details` | Get deployment info | `scriptId`, `deploymentId` |
| `gas_deploy_delete` | Delete deployment | `scriptId`, `deploymentId` |
| `gas_deploy_update` | Update deployment | `scriptId`, `deploymentId` |
| `gas_project_create` | Create new project | `title`, `parentId?` |

### Version Management (2 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_version_get` | Get version details | `scriptId`, `versionNumber` |
| `gas_version_list` | List all versions | `scriptId`, `pageSize?` |

### Process Management (2 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_process_list` | List user processes | `pageSize?`, `userProcessFilter?` |
| `gas_process_list_script` | List script processes | `scriptId`, `scriptProcessFilter?` |

### Drive Integration (3 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_find_drive_script` | Find container scripts | `fileName` |
| `gas_bind_script` | Bind script to container | `containerName`, `scriptName` |
| `gas_create_script` | Create container script | `containerName`, `scriptName?` |

### Local Root Management (4 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_local_set_root` | Set local root directory | `rootPath`, `workingDir?` |
| `gas_local_get_root` | Get current local root | `workingDir?` |
| `gas_local_list_projects` | List local projects | `detailed?`, `workingDir?` |
| `gas_local_show_structure` | Show directory structure | `depth?`, `workingDir?` |

### Trigger Management (3 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_trigger_list` | List installable triggers | `scriptId`, `detailed?` |
| `gas_trigger_create` | Create new trigger | `scriptId`, `functionName`, `triggerType` |
| `gas_trigger_delete` | Delete trigger | `scriptId`, `triggerId?`, `functionName?` |

For complete API documentation, see [docs/api/API_REFERENCE.md](docs/api/API_REFERENCE.md) and [docs/api/LOCAL_SYNC_API.md](docs/api/LOCAL_SYNC_API.md).

## 📖 Usage

### Authentication

```typescript
// Check current authentication status
await gas_auth({ mode: "status" });

// Start OAuth flow (opens browser)
await gas_auth({ mode: "start" });

// Logout and clear credentials
await gas_auth({ mode: "logout" });
```

### Project Operations

```typescript
// Create a new project
const project = await gas_project_create({
  title: "Data Analytics Suite",
  parentId: "optional_drive_folder_id"
});

// List all accessible projects
const projects = await gas_ls({ path: "" });

// List files with wildcard patterns (NEW!)
const aiFiles = await gas_ls({ 
  path: "scriptId/ai_tools/*",        // All files in ai_tools/
  detailed: true 
});
const testFiles = await gas_ls({ 
  path: "scriptId/test/*/*.test",     // All .test files in test subdirs
  detailed: true 
});

// Get detailed project information
const info = await gas_info({ 
  projectId: project.scriptId,
  includeContent: true 
});
```

### File Management

```typescript
// Write a new file
await gas_write({
  path: `${scriptId}/utils/helpers`,
  content: `
    function formatDate(date) {
      return new Date(date).toISOString().split('T')[0];
    }
    
    function validateEmail(email) {
      const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return re.test(email);
    }
  `,
  position: 0  // Execute first
});

// Read file contents
const content = await gas_cat({
  path: `${scriptId}/utils/helpers`
});

// Copy file to new location
await gas_cp({
  from: `${scriptId}/utils/helpers`,
  to: `${scriptId}/shared/utilities`
});

// Move/rename file
await gas_mv({
  from: `${scriptId}/shared/utilities`,
  to: `${scriptId}/lib/common`
});
```

### Code Execution

```typescript
// Execute simple expressions
await gas_run({
  scriptId: scriptId,
  js_statement: "Math.PI * 2"
});

// Call custom functions
await gas_run({
  scriptId: scriptId,
  js_statement: "formatDate(new Date())"
});

// Access Google Services
await gas_run({
  scriptId: scriptId,
  js_statement: "DriveApp.getRootFolder().getName()"
});

// Execute complex operations
await gas_run({
  scriptId: scriptId,
  js_statement: `
    const sheet = SpreadsheetApp.create('Analytics Data');
    const id = sheet.getId();
    sheet.getActiveSheet().getRange('A1').setValue('Hello World');
    return id;
  `
});
```

### Deployment Management

```typescript
// Create a version (required for deployment)
const version = await gas_version_create({
  scriptId: scriptId,
  description: "Initial release with analytics functions"
});

// Deploy as web app
const deployment = await gas_deploy_create({
  scriptId: scriptId,
  entryPointType: "WEB_APP",
  webAppAccess: "ANYONE",
  webAppExecuteAs: "USER_ACCESSING",
  versionNumber: version.versionNumber
});

// Deploy as API executable
const apiDeployment = await gas_deploy_create({
  scriptId: scriptId,
  entryPointType: "EXECUTION_API",
  accessLevel: "ANYONE",
  versionNumber: version.versionNumber
});

// Execute via API (requires deployment)
const apiResult = await gas_run_api_exec({
  scriptId: scriptId,
  functionName: "formatDate",
  parameters: [new Date()]
});
```

## 📚 API Reference

### Authentication Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `gas_auth` | Manage OAuth authentication | `mode`: "start" \| "status" \| "logout" |

### Project Management Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_project_create` | Create new GAS project | `title`, `parentId?` |
| `gas_ls` | List projects and files with **wildcard patterns** (`*`, `?`) | `path` (supports wildcards), `detailed?`, `recursive?`, `wildcardMode?` |
| `gas_info` | Get project details | `projectId`, `includeContent?` |

### File Operation Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_write` | Write file content | `path`, `content`, `position?` |
| `gas_cat` | Read file content | `path` |
| `gas_mv` | Move/rename files | `from`, `to` |
| `gas_cp` | Copy files | `from`, `to` |
| `gas_rm` | Delete files | `path` |

### Execution Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_run` | Execute JavaScript dynamically | `scriptId`, `js_statement` |
| `gas_run_api_exec` | Execute via API | `scriptId`, `functionName`, `parameters?` |

### Deployment Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gas_version_create` | Create project version | `scriptId`, `description?` |
| `gas_deploy_create` | Create deployment | `scriptId`, `entryPointType`, `versionNumber?` |
| `gas_deploy_list` | List deployments | `scriptId` |
| `gas_deploy_get_details` | Get deployment info | `scriptId`, `deploymentId` |

For complete API documentation, see [docs/api/API_REFERENCE.md](docs/api/API_REFERENCE.md).

## ⚙️ Configuration

### OAuth Configuration

The `oauth-config.json` file contains your Google OAuth credentials:

```json
{
  "client_id": "your-client-id.apps.googleusercontent.com",
  "client_secret": "your-client-secret",
  "redirect_uris": ["http://localhost:3000/oauth/callback"],
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

### Environment Variables

```bash
# Optional: Override OAuth client ID
export GOOGLE_OAUTH_CLIENT_ID="your-client-id"

# Optional: Set custom OAuth port
export OAUTH_PORT="3000"

# Optional: Enable debug logging
export DEBUG="mcp:*"

# Optional: Set custom timeout
export REQUEST_TIMEOUT="30000"
```

### MCP Server Configuration

For Cursor IDE integration:

```json
{
  "mcpServers": {
    "mcp-gas": {
      "command": "node",
      "args": ["/absolute/path/to/mcp_gas/dist/src/index.js"],
      "env": {
        "NODE_ENV": "production",
        "DEBUG": "mcp:error"
      }
    }
  }
}
```

## 💡 Examples

### Example 1: Spreadsheet Analytics

```typescript
// Create analytics project
const project = await gas_project_create({
  title: "Spreadsheet Analytics"
});

// Add analytics functions
await gas_write({
  path: `${project.scriptId}/analytics`,
  content: `
    function analyzeSheet(sheetId) {
      const sheet = SpreadsheetApp.openById(sheetId);
      const data = sheet.getActiveSheet().getDataRange().getValues();
      
      return {
        rows: data.length,
        columns: data[0]?.length || 0,
        lastUpdate: sheet.getLastUpdate().toISOString()
      };
    }
    
    function generateReport(sheetIds) {
      return sheetIds.map(id => ({
        sheetId: id,
        analysis: analyzeSheet(id)
      }));
    }
  `
});

// Execute analytics
const report = await gas_run({
  scriptId: project.scriptId,
  js_statement: `generateReport(["sheet_id_1", "sheet_id_2"])`
});
```

### Example 2: Gmail Automation

```typescript
// Create email automation project
const emailProject = await gas_project_create({
  title: "Email Automation Suite"
});

// Add email functions
await gas_write({
  path: `${emailProject.scriptId}/email`,
  content: `
    function sendWelcomeEmail(recipient, name) {
      const subject = "Welcome to Our Platform!";
      const body = \`
        Hello \${name},
        
        Welcome to our platform! We're excited to have you on board.
        
        Best regards,
        The Team
      \`;
      
      GmailApp.sendEmail(recipient, subject, body);
      return \`Email sent to \${recipient}\`;
    }
    
    function getUnreadCount() {
      return GmailApp.getInboxUnreadCount();
    }
  `
});

// Send welcome email
await gas_run({
  scriptId: emailProject.scriptId,
  js_statement: `sendWelcomeEmail("user@example.com", "John Doe")`
});

// Check unread emails
const unreadCount = await gas_run({
  scriptId: emailProject.scriptId,
  js_statement: "getUnreadCount()"
});
```

### Example 3: Drive Integration

```typescript
// Find existing spreadsheet and bind script
const driveFiles = await gas_find_drive_script({
  fileName: "Sales Data"
});

if (driveFiles.containers.length > 0) {
  // Bind script to spreadsheet
  const binding = await gas_bind_script({
    containerName: "Sales Data",
    scriptName: "Data Processor"
  });
  
  // Add functions to bound script
  await gas_write({
    path: `${binding.scriptId}/processor`,
    content: `
      function onOpen() {
        const ui = SpreadsheetApp.getUi();
        ui.createMenu('Data Tools')
          .addItem('Process Data', 'processCurrentSheet')
          .addToUi();
      }
      
      function processCurrentSheet() {
        const sheet = SpreadsheetApp.getActiveSheet();
        const data = sheet.getDataRange().getValues();
        
        // Process data logic here
        Browser.msgBox('Data processed successfully!');
      }
    `
  });
}
```

More examples available in the [examples/](examples/) directory.

## 🛠️ Development

### Project Structure

```
mcp_gas/
├── src/                    # TypeScript source code
│   ├── tools/             # MCP tool implementations
│   │   ├── auth.ts        # Authentication tools
│   │   ├── execution.ts   # Code execution tools
│   │   ├── filesystem.ts  # File operation tools
│   │   └── project.ts     # Project management tools
│   ├── auth/              # OAuth authentication
│   ├── api/               # Google Apps Script API client
│   ├── server/            # MCP server implementation
│   └── index.ts           # Main server entry point
├── test/                  # Comprehensive test suite
├── docs/                  # Documentation
├── examples/              # Usage examples
└── gas-projects/          # Local project templates
```

### Development Commands

```bash
# Development workflow
npm run dev                # Watch mode compilation
npm run build             # Production build
npm run clean             # Clean build artifacts

# Code quality
npm run lint              # Run ESLint
npm run lint:fix          # Fix linting issues

# Testing
npm test                  # Run core tests
npm run test:unit         # Unit tests only
npm run test:system       # System integration tests
npm run test:workflow     # End-to-end workflow tests
npm run test:all          # Run all test suites
```

### Adding New Tools

1. Create tool implementation in `src/tools/`
2. Extend the base tool class
3. Add comprehensive TypeScript types
4. Write unit tests in `test/tools/`
5. Update API documentation

Example tool structure:

```typescript
import { BaseTool } from './base.js';

export class MyNewTool extends BaseTool {
  public name = "my_new_tool";
  public description = "Description of what this tool does";
  public inputSchema = {
    type: "object" as const,
    properties: {
      parameter1: {
        type: "string",
        description: "Parameter description"
      }
    },
    required: ["parameter1"]
  };

  async execute(args: any): Promise<any> {
    // Implementation here
  }
}
```

## 🧪 Testing

### Test Categories

- **Unit Tests**: Individual function and class testing
- **System Tests**: MCP protocol and authentication testing
- **Integration Tests**: End-to-end workflow testing with real Google APIs
- **Security Tests**: OAuth flow and permission validation

### Running Tests

```bash
# Quick validation
npm test

# Comprehensive testing
npm run test:all

# Integration tests (requires OAuth setup)
npm run test:workflow

# Specific test suites
npm run test:unit         # Unit tests only
npm run test:system       # System tests only
npm run test:gas-run      # Execution engine tests
```

### Test Configuration

For integration tests, set up environment:

```bash
# Enable integration testing
export GAS_INTEGRATION_TEST=true

# Optional: Use custom OAuth credentials
export GOOGLE_OAUTH_CLIENT_ID="test-client-id"
```

## 🔧 Troubleshooting

### Common Issues

#### Authentication Problems

**Issue**: "OAuth client was not found" or "invalid_client"
```bash
# Solution: Check OAuth configuration
cat oauth-config.json  # Verify credentials exist
./validate-setup.sh    # Run comprehensive validation
```

**Issue**: Browser doesn't open during authentication
```bash
# Solution: Check browser setup
export BROWSER=chrome  # Set preferred browser
npm start             # Restart server
```

#### Connection Issues

**Issue**: MCP server not connecting in Cursor
```bash
# Check Cursor configuration
# Ensure absolute paths in mcpServers config
# Restart Cursor IDE after configuration changes
```

**Issue**: Server startup failures
```bash
# Validate Node.js version
node --version  # Should be ≥18.0.0

# Rebuild project
npm run clean && npm install && npm run build
```

#### Execution Problems

**Issue**: `gas_run` timeouts or hangs
```bash
# Check Google Apps Script quota limits
# Verify project permissions
# Try simpler code execution first
```

**Issue**: File operation failures
```bash
# Check project permissions
# Verify file paths (no extensions needed)
# Ensure authentication is valid
```

### Debug Mode

Enable comprehensive logging:

```bash
# Enable all debug output
export DEBUG=mcp:*
npm start

# Enable specific debug categories
export DEBUG=mcp:auth,mcp:execution
npm start
```

### Validation Script

Run the comprehensive setup validator:

```bash
./validate-setup.sh
```

This script checks:
- ✅ Node.js and npm versions
- ✅ Project dependencies
- ✅ OAuth configuration
- ✅ Build process
- ✅ Server startup
- ✅ MCP protocol compliance

### Getting Help

1. **Check Documentation**: Review [docs/](docs/) directory
2. **Search Issues**: Look for similar problems in project issues
3. **Enable Debug Mode**: Use `DEBUG=mcp:*` for detailed logs
4. **Run Validation**: Execute `./validate-setup.sh`
5. **Check Examples**: Review [examples/](examples/) for working patterns

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](.github/CONTRIBUTING.md) for details.

### Quick Start for Contributors

1. **Fork the repository**
2. **Create a feature branch**:
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Make your changes**
4. **Add tests** for new functionality
5. **Run the test suite**:
   ```bash
   npm run test:all
   ```
6. **Commit your changes**:
   ```bash
   git commit -am 'Add amazing feature'
   ```
7. **Push to your branch**:
   ```bash
   git push origin feature/amazing-feature
   ```
8. **Open a Pull Request**

### Development Guidelines

- **Code Style**: Follow TypeScript best practices
- **Testing**: Maintain >90% test coverage
- **Documentation**: Update README and docs for new features
- **Backwards Compatibility**: Don't break existing APIs without major version bump

### Areas for Contribution

- 🚀 **Performance Optimization**: Improve execution speed and memory usage
- 📚 **Documentation**: Enhance guides, examples, and API docs
- 🧪 **Testing**: Add more comprehensive test coverage
- 🔌 **Integration**: Add support for more Google services
- 🛠️ **Tools**: Create new MCP tools for additional functionality

## 🔐 Security

### Security Best Practices

- **OAuth Credentials**: Never commit `oauth-config.json` to version control
- **Environment Variables**: Use environment variables for sensitive configuration
- **Scope Limitation**: Request only necessary OAuth scopes
- **Token Storage**: Credentials are stored securely using OS keychain
- **Regular Updates**: Keep dependencies updated for security patches

### Security Features

- **PKCE OAuth Flow**: Proof Key for Code Exchange for enhanced security
- **State Parameter Validation**: CSRF protection during OAuth flow
- **Token Expiry Handling**: Automatic token refresh with clock skew protection
- **Secure Token Storage**: OS-level credential storage
- **Input Validation**: Comprehensive validation of all inputs

### Reporting Security Issues

If you discover a security vulnerability, please:

1. **DO NOT** open a public issue
2. Email security concerns to [security@example.com]
3. Include detailed description and reproduction steps
4. Allow time for investigation and resolution

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2024 MCP Gas Server Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 🆘 Support

### Documentation

- **📖 [Complete Documentation Index](docs/README.md)** - Organized documentation hub
- **📚 [API Reference](docs/api/API_REFERENCE.md)** - Complete API documentation
- **🔧 [Developer Guides](docs/developer/)** - Technical documentation for developers
- **🛠️ [LLM Schema Guide](docs/developer/LLM_SCHEMA_DESIGN_GUIDE.md)** - Schema design for AI assistants

### Community

- **💬 [Discussions](https://github.com/whichguy/mcp_gas/discussions)** - Ask questions and share ideas
- **🐛 [Issues](https://github.com/whichguy/mcp_gas/issues)** - Report bugs and request features
- **📧 [Email Support](mailto:support@example.com)** - Direct support for critical issues

### Resources

- **🌐 [Model Context Protocol](https://modelcontextprotocol.io/)** - MCP specification
- **📱 [Google Apps Script](https://developers.google.com/apps-script)** - Official GAS documentation
- **🔐 [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)** - OAuth implementation guide

---

<div align="center">

**Made with ❤️ by the MCP Gas Server team**

[⭐ Star this repo](https://github.com/whichguy/mcp_gas) • [🐛 Report a bug](https://github.com/whichguy/mcp_gas/issues) • [💡 Request a feature](https://github.com/whichguy/mcp_gas/issues)

</div> 