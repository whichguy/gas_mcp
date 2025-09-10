# MCP Google Apps Script Server

<div align="center">

![GitHub stars](https://img.shields.io/github/stars/whichguy/mcp_gas?style=social)
[![npm version](https://img.shields.io/npm/v/gas-server.svg)](https://www.npmjs.com/package/gas-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue.svg)](https://www.typescriptlang.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.0.0-orange.svg)](https://modelcontextprotocol.io/)

### 🤖 + 📝 = ⚡

**Let AI assistants build and manage Google Apps Script projects for you**

[🚀 Quick Start](#-quick-start) • [💡 Use Cases](#-use-cases) • [🛠️ Features](#-whats-included) • [📚 Docs](#-documentation)

</div>

---

## 🎯 Why MCP GAS Server?

### The Problem
Google Apps Script is powerful for automating Google Workspace, but developing GAS projects traditionally requires:
- Switching between local development and the online editor
- Manual copy-pasting of code
- No proper module system or version control
- Limited tooling for testing and deployment

### The Solution
MCP GAS Server bridges AI assistants with Google Apps Script, enabling:
- **AI-Driven Development**: Tell Claude/Cursor what to build, and it handles the implementation
- **Local Development**: Write code locally with full IDE support
- **Automatic Sync**: Bidirectional sync between local files and Google's cloud
- **Modern JavaScript**: CommonJS modules, require(), and proper code organization
- **Git Integration**: Version control for your GAS projects with safe merging

### Who Is This For?
- **Developers** who want AI to handle Google Apps Script boilerplate
- **Teams** automating Google Workspace workflows
- **Non-programmers** who need custom Google Sheets functions or automation
- **Anyone** tired of the limitations of Google's online script editor

## 💡 Use Cases

### What You Can Build
- **📊 Custom Spreadsheet Functions**: Complex calculations, data processing, API integrations
- **📧 Email Automation**: Process Gmail, send bulk emails, manage drafts
- **📅 Calendar Management**: Schedule events, sync calendars, automate meeting creation
- **🗂️ Drive Automation**: File organization, backup systems, document generation
- **📝 Document Processing**: Generate reports, merge documents, extract data
- **🔗 API Integrations**: Connect Google Workspace to external services
- **🤖 Chatbots & Add-ons**: Build custom tools for Sheets, Docs, and Forms

### Real Examples
```javascript
// Tell your AI: "Create a function that fetches stock prices and updates my spreadsheet"
// AI will create, deploy, and test the entire solution

// Tell your AI: "Build an expense tracker that categorizes Gmail receipts"
// AI handles OAuth, Gmail API, and spreadsheet integration

// Tell your AI: "Make a custom menu in Sheets for data analysis tools"
// AI creates the UI, functions, and deploys everything
```

## 🚀 Quick Start

### ⚡ 30-Second Installation

<div align="center">

```bash
curl -fsSL https://raw.githubusercontent.com/whichguy/mcp_gas/main/install.sh | bash -s -- --auto
```

**— OR —**

```bash
git clone https://github.com/whichguy/mcp_gas.git && cd mcp_gas && ./install.sh
```

</div>

### Prerequisites

| Requirement | Why Needed | How to Get |
|------------|------------|------------|
| **Node.js 18+** | Runs the MCP server | [Download](https://nodejs.org/) |
| **Google Account** | Access Google Apps Script | [Create free account](https://accounts.google.com/) |
| **AI Assistant** | Sends commands to MCP server | [Claude](https://claude.ai/download), [Cursor](https://cursor.sh/), etc. |

### 🎯 First Project in 2 Minutes

<table>
<tr>
<td width="60px" align="center"><strong>1️⃣</strong></td>
<td>

**Install** (if not already done)
```bash
curl -fsSL https://raw.githubusercontent.com/whichguy/mcp_gas/main/install.sh | bash
```

</td>
</tr>
<tr>
<td align="center"><strong>2️⃣</strong></td>
<td>

**Tell your AI assistant:**
> "Create a Google Apps Script project that adds a custom menu to Google Sheets 
> with options to highlight duplicate values and remove empty rows"

</td>
</tr>
<tr>
<td align="center"><strong>3️⃣</strong></td>
<td>

**AI handles everything:**
- ✅ Creates the project
- ✅ Writes the code  
- ✅ Sets up the menu
- ✅ Deploys to Google
- ✅ Tests the functionality

</td>
</tr>
</table>

## ⚙️ Installation Details

### Installation Script Features
The installer (`install.sh`) provides:
- ✅ **Idempotent operation** - Safe to run multiple times without duplicating entries
- 🔍 **Auto-detection** of installed IDEs and editors
- 🎯 **Supports 10+ IDEs**: Claude Desktop/Code, Cursor, VS Code, Zed, Windsurf, Neovim, Codex
- 📦 **Automatic setup** - Dependencies, build, and configuration
- 🔐 **OAuth checking** with helpful setup instructions
- 💾 **Backup creation** before any modifications

### Command-line Options
```bash
./install.sh --dry-run       # Preview changes without making them
./install.sh --interactive   # Choose which IDEs to configure
./install.sh --auto          # Non-interactive mode (for CI/CD)
./install.sh --force         # Update existing configurations
./install.sh --help          # Show detailed usage
```

### Manual Installation
```bash
# Clone and build manually
git clone https://github.com/whichguy/mcp_gas.git
cd mcp_gas
npm install
npm run build
```

### Uninstallation
```bash
# Remove MCP GAS from all IDEs
./uninstall.sh

# With cleanup options:
./uninstall.sh --cleanup-build      # Also remove dist/ and node_modules/
./uninstall.sh --cleanup-backups    # Remove all backup files
./uninstall.sh --dry-run           # Preview what would be removed
```

## 📋 Google Cloud Setup

### One-Time Configuration

1. **Enable Google Apps Script API**:
   - Visit [Google Cloud Console](https://console.cloud.google.com/)
   - Create or select a project
   - Search for "Google Apps Script API" and enable it

2. **Create OAuth 2.0 Credentials**:
   - Navigate to APIs & Services → Credentials
   - Click "Create Credentials" → "OAuth client ID"
   - Application type: **Desktop app**
   - Download JSON and save as `oauth-config.json` in project root

## 🖥️ Supported IDEs

The MCP GAS Server works with any MCP-compatible client:

| IDE/Editor | Platform Support | Configuration File | Notes |
|------------|-----------------|-------------------|-------|
| **Claude Desktop** | macOS, Windows | `claude_desktop_config.json` | Official Anthropic desktop app |
| **Claude Code** | macOS, Linux | `~/.claude/settings.json` | Claude's code editor |
| **Cursor IDE** | All platforms | `~/.cursor/mcp.json` | AI-powered IDE |
| **VS Code** | All platforms | `mcp.json` in globalStorage | Microsoft's editor |
| **VS Code Insiders** | All platforms | `mcp.json` in globalStorage | Preview version |
| **VSCodium** | All platforms | `mcp.json` in globalStorage | Open-source VS Code |
| **Zed Editor** | macOS, Linux | `~/.config/zed/settings.json` | Uses `context_servers` key |
| **Windsurf IDE** | All platforms | `~/.codeium/windsurf/mcp_config.json` | Codeium's AI IDE |
| **Neovim MCPHub** | All platforms | `~/.config/mcphub/servers.json` | Neovim plugin |
| **Codex CLI** | All platforms | `~/.codex/config.toml` | Uses TOML format |

<details>
<summary><b>Manual IDE Configuration Examples</b></summary>

### Claude Desktop
```json
{
  "mcpServers": {
    "gas": {
      "command": "node",
      "args": ["/absolute/path/to/mcp_gas/dist/src/index.js"],
      "env": {"NODE_ENV": "production"}
    }
  }
}
```

### VS Code
```json
{
  "mcpServers": {
    "gas": {
      "command": "node",
      "args": ["/absolute/path/to/mcp_gas/dist/src/index.js"],
      "env": {"NODE_ENV": "production"}
    }
  }
}
```

### Zed Editor (uses `context_servers`)
```json
{
  "context_servers": {
    "gas": {
      "command": {
        "path": "node",
        "args": ["/absolute/path/to/mcp_gas/dist/src/index.js"]
      }
    }
  }
}
```

### Codex CLI (uses TOML)
```toml
[mcp_servers.gas]
command = "node"
args = ["/absolute/path/to/mcp_gas/dist/src/index.js"]

[[mcp_servers.gas.env]]
NODE_ENV = "production"
```

</details>

## 📦 What's Included

### 🛠️ 46 Specialized Tools

<table>
<tr>
<td>

**📁 File Management**
- `ls` - List files
- `cat` - Read files
- `write` - Write files
- `rm` - Delete files
- `mv` - Move files
- `cp` - Copy files
- `mkdir` - Create folders

</td>
<td>

**🔍 Search & Edit**
- `grep` - Search text
- `find` - Find files
- `ripgrep` - Fast search
- `sed` - Find & replace

</td>
<td>

**⚡ Execution**
- `run` - Run code
- `exec` - Execute functions

</td>
</tr>
<tr>
<td>

**🔀 Git Integration**
- `git_init` - Initialize repo
- `git_sync` - Sync changes
- `git_status` - Check status

</td>
<td>

**🚀 Deployment**
- `deploy_create` - Deploy apps
- `version_create` - Create versions

</td>
<td>

**📋 Projects**
- `project_create` - New project
- `project_set` - Set current
- `project_list` - List all

</td>
</tr>
</table>

### Smart vs Raw Tools
- **Smart tools** (`cat`, `write`): Automatically handle CommonJS module wrapping
- **Raw tools** (`raw_cat`, `raw_write`): Preserve exact file content
- Choose based on whether you want automatic module management or full control

## 🎓 When to Use MCP GAS Server

### ✅ Perfect For
- **Automation Projects**: Gmail, Calendar, Drive, Sheets automation
- **Custom Functions**: Complex spreadsheet formulas and data processing
- **API Integrations**: Connecting Google Workspace to external services
- **Rapid Prototyping**: Quick proof-of-concepts and MVPs
- **Learning GAS**: Let AI teach by example

### ❌ Not Ideal For
- **Large Applications**: Consider App Engine or Cloud Functions for complex apps
- **Real-time Systems**: GAS has execution time limits (6 minutes)
- **Heavy Computing**: Limited CPU/memory compared to dedicated servers
- **Sensitive Data**: Evaluate security requirements carefully

## 🛠️ Advanced Features

### Git Workflow Integration
```javascript
// Initialize git for a GAS project
mcp__gas__git_init({ scriptId: "...", repository: "https://github.com/..." })

// Sync changes (always safe - pulls, merges, then pushes)
mcp__gas__git_sync({ scriptId: "..." })

// Standard git workflow works in sync folder
cd ~/gas-repos/project-xxx
git add . && git commit -m "Update" && git push
```

### Module System
```javascript
// Write modular code with CommonJS
const utils = require('./utils');
const api = require('./api/client');

function processData() {
  const data = api.fetchData();
  return utils.transform(data);
}

module.exports = { processData };
```

### First Project Example
```javascript
// Tell your AI assistant:
"Create a Google Apps Script project that calculates Fibonacci numbers"

// The AI will execute:
// 1. Authenticate
await mcp__gas__auth({ mode: "start" });

// 2. Create project
const project = await mcp__gas__project_create({ 
  title: "Fibonacci Calculator" 
});

// 3. Add code
await mcp__gas__write({
  scriptId: project.scriptId,
  path: "fibonacci",
  content: `
    function fibonacci(n) {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }
    
    function test() {
      Logger.log(fibonacci(10)); // 55
    }
    
    module.exports = { fibonacci };
  `
});

// 4. Execute
const result = await mcp__gas__run({
  scriptId: project.scriptId,
  js_statement: "require('fibonacci').fibonacci(10)"
});
// Returns: 55
```

## 🔧 Troubleshooting

### Common Issues

| Problem | Solution |
|---------|----------|
| "Not authenticated" | Run `mcp__gas__auth({ mode: "start" })` in your AI assistant |
| "Script not found" | Check scriptId in gas-config.json |
| "Module not found" | Ensure proper require() paths and file exists |
| "Quota exceeded" | Wait or upgrade Google Cloud quotas |
| "Permission denied" | Check OAuth scopes and project permissions |

### Debug Mode
```bash
# Enable debug logging
DEBUG=mcp:* npm start

# Test installation without changes
./install.sh --dry-run

# Check configuration
cat ~/.claude/claude_desktop_config.json | jq '.mcpServers.gas'
```

## 📂 Project Structure

```
mcp_gas/
├── src/                     # TypeScript source code
│   ├── tools/              # All 46 MCP tools
│   ├── auth/               # OAuth authentication
│   ├── api/                # Google Apps Script API client
│   └── server/             # MCP server implementation
├── dist/                    # Compiled JavaScript (after build)
├── test/                    # Test suites
├── docs/                    # Documentation
├── install.sh              # Automated installer
├── uninstall.sh            # Clean uninstaller
├── gas-config.json         # Project configuration
└── oauth-config.json       # OAuth credentials (create this)
```

## 🧪 Development

### Setup
```bash
# Clone and install
git clone https://github.com/whichguy/mcp_gas.git
cd mcp_gas
npm install

# Development mode with watch
npm run dev

# Build for production
npm run build
```

### Testing
```bash
npm test                    # Run all tests
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests (requires auth)
npm run test:system        # System-level tests
npm run test:security      # Security validation
```

### Architecture

The MCP GAS Server uses a layered architecture:

1. **MCP Protocol Layer**: Handles communication with AI assistants
2. **Tool Layer**: 46 specialized tools for GAS operations
3. **Authentication Layer**: OAuth 2.0 PKCE flow with token management
4. **API Client Layer**: Google Apps Script API v1 client with rate limiting
5. **File System Layer**: Local caching and synchronization

## 📚 Documentation

- **[Tool Reference](docs/TOOLS.md)**: Detailed documentation for all 46 tools
- **[Architecture Guide](docs/ARCHITECTURE.md)**: System design and internals
- **[Git Integration](docs/GIT_SYNC_WORKFLOWS.md)**: Version control workflows
- **[API Documentation](docs/API.md)**: TypeScript API reference
- **[Examples](examples/)**: Sample projects and use cases

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

- 🐛 [Report bugs](https://github.com/whichguy/mcp_gas/issues)
- 💡 [Request features](https://github.com/whichguy/mcp_gas/issues)
- 📖 [Improve documentation](https://github.com/whichguy/mcp_gas/pulls)
- 🔧 [Submit pull requests](https://github.com/whichguy/mcp_gas/pulls)

## 📄 License

MIT - See [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

Built on:
- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- [Google Apps Script API](https://developers.google.com/apps-script/api)
- TypeScript, Node.js, and the amazing open-source community

---

<div align="center">

### 🌟 Ready to supercharge your Google Apps Script development?

<br>

<a href="#-quick-start">
  <img src="https://img.shields.io/badge/Get%20Started-00897B?style=for-the-badge&logo=google&logoColor=white" alt="Get Started">
</a>
&nbsp;&nbsp;
<a href="https://github.com/whichguy/mcp_gas/issues">
  <img src="https://img.shields.io/badge/Report%20Issue-DC382D?style=for-the-badge&logo=github&logoColor=white" alt="Report Issue">
</a>
&nbsp;&nbsp;
<a href="https://github.com/whichguy/mcp_gas">
  <img src="https://img.shields.io/badge/Star%20on%20GitHub-FFC107?style=for-the-badge&logo=github&logoColor=black" alt="Star on GitHub">
</a>

<br><br>

Made with ❤️ by the MCP GAS community

</div>