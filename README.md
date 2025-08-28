# MCP Google Apps Script Server

<div align="center">

[![npm version](https://img.shields.io/npm/v/mcp-gas-server.svg)](https://www.npmjs.com/package/mcp-gas-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue.svg)](https://www.typescriptlang.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.0.0-orange.svg)](https://modelcontextprotocol.io/)

**Bridge AI assistants with Google Apps Script through the Model Context Protocol**

[Quick Start](#-quick-start) • [Features](#-features) • [Tools](#-tools) • [Examples](#-examples) • [Documentation](#-documentation)

</div>

---

## 🎯 What is MCP GAS Server?

MCP GAS Server is a Model Context Protocol (MCP) server that enables AI assistants like Claude to directly interact with Google Apps Script. It provides 46 specialized tools for creating, managing, and executing Google Apps Script projects without leaving your development environment.

### ✨ Key Features

- **🤖 AI-Native Development** - Purpose-built for AI assistants to manage GAS projects
- **⚡ Instant Execution** - Run JavaScript code directly in Google's cloud
- **🔄 Bidirectional Sync** - Automatic sync between local files and Google Apps Script
- **🔀 Git Integration** - Safe Git synchronization with pull-merge-push workflow
- **📦 Module System** - Built-in CommonJS support with `require()` for modular development
- **🛡️ Type-Safe** - Full TypeScript implementation with comprehensive error handling
- **🔒 Secure** - OAuth 2.0 PKCE flow with secure token storage
- **🎯 Smart vs Raw Tools** - Smart tools handle CommonJS automatically, raw tools preserve exact content

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18.0.0+ ([Download](https://nodejs.org/))
- **Google Account** with [Google Cloud Console](https://console.cloud.google.com/) access
- **MCP-compatible client** ([Claude Desktop](https://claude.ai/download), [Cursor IDE](https://cursor.sh/), etc.)

### Installation

```bash
# Clone the repository
git clone https://github.com/whichguy/mcp_gas.git
cd mcp_gas

# Install dependencies
npm install

# Build the server
npm run build
```

### Google Cloud Setup

1. **Enable Google Apps Script API**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create or select a project
   - Enable "Google Apps Script API"

2. **Create OAuth 2.0 Credentials**
   - Navigate to APIs & Services → Credentials
   - Create Credentials → OAuth client ID
   - Application type: **Desktop app**
   - Download JSON and save as `oauth-config.json` in project root

### Connect to Your AI Assistant

<details>
<summary><b>Claude Desktop Configuration</b></summary>

Edit Claude Desktop settings:

```json
{
  "mcpServers": {
    "mcp-gas": {
      "command": "node",
      "args": ["/absolute/path/to/mcp_gas/dist/src/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```
</details>

<details>
<summary><b>Cursor IDE Configuration</b></summary>

Add to Cursor MCP settings:

```json
{
  "mcpServers": {
    "mcp-gas": {
      "command": "node",
      "args": ["./dist/src/index.js", "--config", "./mcp-gas-config.json"],
      "cwd": "/path/to/mcp_gas"
    }
  }
}
```
</details>

### First Project Example

```javascript
// Tell your AI assistant:
"Create a Google Apps Script project that calculates Fibonacci numbers"

// The AI will execute:
// 1. Authenticate
await gas_auth({ mode: "start" });

// 2. Create project
const project = await gas_project_create({ 
  title: "Fibonacci Calculator" 
});

// 3. Add code
await gas_write({
  scriptId: project.scriptId,
  path: "fibonacci",
  content: `
    function fibonacci(n) {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }
    
    function getFibonacciSequence(length) {
      return Array.from({length}, (_, i) => fibonacci(i));
    }
  `
});

// 4. Execute
const result = await gas_run({
  scriptId: project.scriptId,
  js_statement: "getFibonacciSequence(10)"
});
// Result: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
```

## 🛠️ Tools Overview

The server provides 46 tools organized into logical categories:

### 🔐 Authentication & Setup
- `gas_auth` - OAuth 2.0 authentication with Google

### 📝 Smart File Operations (CommonJS Processing)
- `gas_write` - Write files with automatic CommonJS wrapper
- `gas_cat` - Read files with local/remote fallback, unwraps CommonJS  
- `gas_ls` - List files with wildcard patterns
- `gas_rm`, `gas_mv`, `gas_cp` - File management with CommonJS handling
- `gas_mkdir` - Create directories

### 🔧 Raw File Operations (Exact Content)
- `gas_raw_write` - Write files preserving exact content
- `gas_raw_cat` - Read raw file content including wrappers
- `gas_raw_ls` - Raw directory listings
- `gas_raw_rm`, `gas_raw_mv`, `gas_raw_cp` - Raw file operations
- `gas_raw_find` - Pattern-based file discovery

### 🔍 Search Operations
- `gas_grep` - Search content with regex patterns  
- `gas_find` - Find files using shell-like syntax

### 🚀 Code Execution
- `gas_run` - Execute JavaScript in GAS environment
- `gas_run_api_exec` - Execute deployed functions

### 📦 Project Management
- `gas_project_create` - Create new projects
- `gas_project_set` - Set current project context
- `gas_project_list` - List configured projects
- `gas_info` - Get project details
- `gas_project_metrics` - View execution metrics

### 🔀 Git Integration (Safe Synchronization)
- `gas_git_init` - Initialize git association with `.git.gs` marker
- `gas_git_sync` - Safe pull-merge-push synchronization (always pulls first)
- `gas_git_status` - Check git association and sync status
- `gas_git_set_sync_folder` - Set local sync folder for git operations
- `gas_git_get_sync_folder` - Query current sync folder location

**Key Features**: Self-documenting `.git.gs` files, automatic README.md ↔ README.html transformation, dotfile handling with period prefix

### 🌐 Deployment & Versioning
- `gas_version_create` - Create project versions
- `gas_deploy_create` - Deploy as web app or API
- `gas_deploy_list` - List deployments
- `gas_deploy_update` - Update deployments

### 🔄 Local/Remote Synchronization  
- `gas_pull` - Pull remote files to local with caching
- `gas_push` - Push local files to remote
- `gas_status` - Compare local vs remote state
- `gas_sync` - Bidirectional synchronization

## 📚 Examples

### Basic Workflow: Smart vs Raw Tools

**Smart Tools** (Recommended for development):
```javascript
// Write a module - CommonJS wrapper added automatically
await gas_write({
  scriptId: "your-script-id", 
  path: "utils/math",
  content: `
    function add(a, b) { return a + b; }
    function multiply(a, b) { return a * b; }
    module.exports = { add, multiply };
  `
});

// Read the same file - CommonJS wrapper removed automatically  
const content = await gas_cat({
  scriptId: "your-script-id",
  path: "utils/math"
});
// Returns clean user code without wrapper functions

// Copy with CommonJS processing
await gas_cp({
  scriptId: "your-script-id",
  fromPath: "utils/math", 
  toPath: "backup/math"  // Source unwrapped, destination re-wrapped
});
```

**Raw Tools** (For exact content control):
```javascript  
// Write exact content - no processing
await gas_raw_write({
  scriptId: "your-script-id",
  path: "legacy/old-script", 
  content: `function _main() { console.log('exact content'); }`
});

// Read exact content - including all wrappers
const rawContent = await gas_raw_cat({
  scriptId: "your-script-id", 
  path: "legacy/old-script"
});
// Returns exactly what's stored in GAS

// Copy without any processing
await gas_raw_cp({
  scriptId: "your-script-id",
  fromPath: "legacy/old-script",
  toPath: "archive/old-script"  // Exact copy
});
```

### Git Integration Workflow

```javascript
// 1. Initialize git association
await gas_git_init({
  scriptId: "your-script-id",
  repository: "https://github.com/user/project.git",
  branch: "main", 
  localPath: "~/gas-repos/project-your-script-id"
});

// 2. Set sync folder for git commands
await gas_git_set_sync_folder({
  scriptId: "your-script-id",
  syncFolder: "~/dev/my-gas-project" 
});

// 3. Safe synchronization (always pulls first, then merges)
await gas_git_sync({
  scriptId: "your-script-id"
});

// Check association and sync status
const status = await gas_git_status({
  scriptId: "your-script-id"
});
// Shows git association, sync folder, and file differences
```

### Spreadsheet Automation

```javascript
// Create project
const project = await gas_project_create({
  title: "Spreadsheet Processor"
});

// Add processing logic
await gas_write({
  scriptId: project.scriptId,
  path: "processor",
  content: `
    function processData(spreadsheetId) {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      const data = ss.getActiveSheet().getDataRange().getValues();
      
      // Transform data
      const processed = data.map(row => 
        row.map(cell => typeof cell === 'number' ? cell * 2 : cell)
      );
      
      // Write results
      const newSheet = ss.insertSheet('Processed');
      newSheet.getRange(1, 1, processed.length, processed[0].length)
        .setValues(processed);
      
      return { rowsProcessed: processed.length };
    }
  `
});

// Execute
const result = await gas_run({
  scriptId: project.scriptId,
  js_statement: 'processData("your-sheet-id")'
});
```

### Gmail Automation

```javascript
await gas_write({
  scriptId: project.scriptId,
  path: "email-automation",
  content: `
    function sendBulkEmails(recipients, subject, template) {
      return recipients.map(recipient => {
        try {
          const body = template.replace('{{name}}', recipient.name);
          GmailApp.sendEmail(recipient.email, subject, body);
          return { email: recipient.email, status: 'sent' };
        } catch (error) {
          return { email: recipient.email, status: 'failed', error: error.message };
        }
      });
    }
  `
});
```

### Project Context Management

```javascript
// Set a project as current context
await gas_project_set({
  scriptId: "your-script-id",
  name: "MyProject",
  description: "Main development project"
});

// Now tools can omit scriptId - it's resolved automatically
await gas_write({
  path: "main",  // scriptId auto-resolved from context
  content: `console.log('Hello World');`
});

// List all configured projects
const projects = await gas_project_list();
// Shows current project and all configured ones

// Get detailed project information
const info = await gas_info();  // Uses current project context
// Returns file count, size, last modified, etc.
```

### Virtual File Handling (Dotfiles)

```javascript
// Write a .gitignore file - automatically translated to .gitignore.gs
await gas_write({
  path: ".gitignore",
  content: `
    node_modules/
    *.log
    .env
  `
});

// Read back - translation is transparent
const gitignore = await gas_cat({ path: ".gitignore" });
// Returns clean content, no .gs extension visible

// List shows virtual names
const files = await gas_ls({ path: "." });
// Shows: [".gitignore", "main.js"] not [".gitignore.gs", "main.gs"]
```

### Advanced Search and Discovery

```javascript
// Find files with patterns
const jsFiles = await gas_find({ name: "*.js" });
const testFiles = await gas_find({ name: "*test*" });  
const dotfiles = await gas_find({ name: ".git*" });

// Search content with regex
const todos = await gas_grep({ 
  pattern: "TODO|FIXME", 
  flags: "i"  // case insensitive
});

// Raw find for exact GAS names
const rawGitFiles = await gas_raw_find({ name: ".git*" });
// Finds actual .git.gs files in GAS storage
```

## 🏗️ Architecture

### Project Structure

```
mcp_gas/
├── src/
│   ├── server/          # MCP server implementation
│   ├── tools/           # Tool implementations
│   ├── auth/            # OAuth & session management
│   ├── api/             # Google Apps Script API client
│   └── utils/           # Utilities & helpers
├── test/                # Test suites
├── docs/                # Documentation
└── examples/            # Example scripts
```

### Key Architecture Principles

- **Flat Function Architecture** - Each tool is a separate function following MCP best practices
- **Smart vs Raw Tools** - Smart tools process CommonJS automatically, raw tools preserve exact content  
- **Virtual File Translation** - Seamless handling of dotfiles (`.git` → `.git.gs` with period prefix)
- **Project Context Management** - Automatic script ID resolution from `mcp-gas-config.json`
- **Three-Layer File Access** - Local cache → Remote GAS → Git mirror (~/gas-repos pattern)
- **Session-Based Authentication** - OAuth 2.0 PKCE with secure token storage and auto-refresh
- **CommonJS Module System** - Automatic wrapping/unwrapping for require(), module.exports pattern

## 🧪 Testing

```bash
# Run tests
npm test                    # Core system tests  
npm run test:unit          # Unit tests for individual modules
npm run test:integration   # Real GAS API tests (requires auth)
npm run test:system        # System-level MCP protocol tests
npm run test:security      # Security and validation tests
npm run test:verification  # API schema and compliance verification
npm run test:all           # Run unit + system tests

# Debug mode
DEBUG=mcp:* npm test

# Single test file  
npx mocha test/system/protocol/consolidated-core.test.ts --timeout 30000
```

## 🔧 Development

### Building

```bash
npm run build              # Production build
npm run build:dev          # Development build
npm run dev                # Watch mode
```

### Adding New Tools

1. Create tool class extending `BaseTool` in `src/tools/`
2. Implement required properties: `name`, `description`, `inputSchema`  
3. Implement `execute(params)` method with validation and error handling
4. Register in `src/server/mcpServer.ts` tool array
5. Add tests in appropriate `test/` subdirectory (unit/integration/system/security)
6. Update documentation and examples

### Debugging

```bash
DEBUG=mcp:* npm start           # All logs
DEBUG=mcp:auth npm start        # Auth only
DEBUG=mcp:execution npm start   # Execution only
```

## 📖 Documentation

- [API Reference](docs/api/API_REFERENCE.md) - Complete tool documentation
- [Developer Guide](docs/developer/) - Architecture and development
- [Examples](examples/README.md) - Code examples and patterns
- [CLAUDE.md](CLAUDE.md) - Claude Code specific instructions
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues

## 🔒 Security

- **OAuth 2.0 PKCE** - Enhanced security flow
- **Secure Storage** - OS-level token protection
- **Input Validation** - Comprehensive parameter validation
- **Command Injection Prevention** - Safe Git operations
- **Rate Limiting** - Respects API quotas

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for guidelines.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: [Full docs](docs/README.md)
- **Issues**: [GitHub Issues](https://github.com/whichguy/mcp_gas/issues)
- **Discussions**: [GitHub Discussions](https://github.com/whichguy/mcp_gas/discussions)

## 🙏 Acknowledgments

Built with:
- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- [Google Apps Script API](https://developers.google.com/apps-script/api)
- [TypeScript](https://www.typescriptlang.org/)
- [Node.js](https://nodejs.org/)

---

<div align="center">

**Made with ❤️ by the MCP GAS Server team**

[⭐ Star this repo](https://github.com/whichguy/mcp_gas) • [🐛 Report a bug](https://github.com/whichguy/mcp_gas/issues) • [💡 Request a feature](https://github.com/whichguy/mcp_gas/issues)

</div>