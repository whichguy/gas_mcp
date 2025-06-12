# MCP Google Apps Script Server

**Version 1.0.1** - Model Context Protocol server for Google Apps Script integration

A powerful TypeScript-based MCP server that provides seamless integration between AI assistants (like Claude via Cursor) and Google Apps Script. Create, edit, deploy, and execute Google Apps Script projects directly from your development environment.

## 🚀 Quick Start

### Prerequisites
- **Node.js** v18+ (tested with v22.13.1)
- **npm** v8+ (tested with v11.2.0)
- **Google Account** with Cloud Console access
- **Cursor IDE** with MCP support

### Installation & Setup

1. **Clone and Install**:
   ```bash
   git clone https://github.com/whichguy/gas_mcp.git
   cd gas_mcp
   npm install
   ```

2. **Initialize Configuration**:
   ```bash
   npm run setup
   ```

3. **Validate Setup**:
   ```bash
   ./validate-setup.sh
   ```
   This comprehensive script validates build process, dependencies, config files, and server startup.

4. **Configure OAuth** (Required for real usage):
   - Follow the detailed guide in [`CURSOR_INTEGRATION.md`](CURSOR_INTEGRATION.md)
   - Set up Google Cloud OAuth credentials
   - Replace test credentials in `config/oauth.json`

5. **Integrate with Cursor**:
   - Add MCP server configuration to Cursor
   - Restart Cursor to load the server
   - See full instructions in [`CURSOR_INTEGRATION.md`](CURSOR_INTEGRATION.md)

## ✅ Current Status

The OAuth error you saw (`Error 401: invalid_client`) is **expected and correct** - it means:
- ✅ Build process works
- ✅ Config files are properly loaded
- ✅ Server starts successfully
- ❌ Using test OAuth credentials (not real Google credentials)

This is the normal state for initial setup. Follow the OAuth configuration in [`CURSOR_INTEGRATION.md`](CURSOR_INTEGRATION.md) to get real credentials.

## 🛠️ Features

### Core MCP Tools

- **Authentication**: `gas_auth` - OAuth 2.0 flow with Google
- **Project Management**: Create, list, and manage GAS projects
- **File Operations**: Read, write, copy, move, delete files in GAS projects
- **Code Execution**: 
  - `gas_run` - Execute functions via web app deployment (HTTP proxy)
  - `gas_run_api_exec` - Execute via API (requires deployment)
- **Deployment Management**: Create versions and deployments
- **Drive Integration**: Find and bind scripts to Sheets, Docs, Forms

### Advanced Features

- **Automatic Deployment**: Fresh deployments ensure latest code execution
- **Extension Handling**: Intelligent file extension management (strips `.js`, `.ts`, etc.)
- **Error Recovery**: Robust error handling with detailed diagnostics
- **Project Templates**: Structured project organization with metadata
- **Live Development**: Real-time code sync between local and Google Apps Script

## 📁 Project Structure

```
gas_mcp/
├── src/                     # TypeScript source code
│   ├── tools/              # MCP tool implementations
│   ├── auth/               # OAuth authentication
│   ├── api/                # Google Apps Script API client
│   └── index.ts            # MCP server entry point
├── config/                 # Configuration files
│   ├── oauth.json          # OAuth credentials (created by setup)
│   └── oauth.json.template # Template for OAuth config
├── gas-projects/           # Local GAS project management
│   ├── fibonacci-calculator/  # Example project
│   └── template/           # Project template
├── examples/               # Usage examples and patterns
├── test/                   # Comprehensive test suite
├── dist/                   # Compiled JavaScript (created by build)
├── validate-setup.sh       # Setup validation script
└── CURSOR_INTEGRATION.md   # Complete Cursor setup guide
```

## 🔧 Development Commands

```bash
# Setup and validation
npm run setup              # Create OAuth config from template
./validate-setup.sh        # Validate complete setup
npm run build             # Compile TypeScript + copy config
npm start                 # Start MCP server

# Testing
npm test                  # Run core tests
npm run test:system       # System integration tests
npm run test:workflow     # End-to-end workflow tests (requires auth)

# Development
npm run dev               # Watch mode TypeScript compilation
npm run clean             # Clean build directory
npm run lint              # ESLint code checking
```

## 📚 Documentation

- **[Cursor Integration Guide](CURSOR_INTEGRATION.md)** - Complete setup for Cursor IDE
- **[Repository Structure](REPOSITORY_STRUCTURE.md)** - Project organization and principles
- **[Gas Projects](gas-projects/README.md)** - Managing GAS projects locally
- **[Examples](examples/README.md)** - Usage patterns and examples

## 🧪 Example Workflow

Once set up with real OAuth credentials:

```javascript
// 1. Authenticate with Google
await gas_auth({ mode: "start" });

// 2. Create new project
const project = await gas_project_create({ title: "My Calculator" });

// 3. Add source code
await gas_write({
    path: `${project.scriptId}/calculator.js`,
    content: `
        function add(a, b) {
            return a + b;
        }
        
        function multiply(a, b) {
            return a * b;
        }
    `
});

// 4. Execute functions
const result = await gas_run({
    scriptId: project.scriptId,
    functionName: "add",
    parameters: [5, 3]
});
// Returns: 8
```

## 🔐 Security

- OAuth credentials in `config/oauth.json` are **never committed** (in `.gitignore`)
- Use environment variables for CI/CD environments
- Regular credential rotation recommended
- Scope-limited OAuth permissions

## 🆘 Troubleshooting

### Common Issues

1. **"OAuth client was not found"** - Expected with test credentials. Follow OAuth setup in `CURSOR_INTEGRATION.md`
2. **"ENOENT: oauth.json"** - Run `npm run setup` to create config file
3. **Build failures** - Run `npm run clean && npm install && npm run build`
4. **MCP not connecting in Cursor** - Check paths in Cursor config, restart Cursor

### Debug Mode
```bash
export DEBUG=mcp:*
npm start
```

### Validation
```bash
./validate-setup.sh  # Comprehensive setup validation
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature-name`
3. Run tests: `npm test`
4. Commit changes: `git commit -am 'Add feature'`
5. Push branch: `git push origin feature-name`
6. Submit pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🔗 Links

- **GitHub Repository**: [https://github.com/whichguy/gas_mcp](https://github.com/whichguy/gas_mcp)
- **Issues & Support**: [GitHub Issues](https://github.com/whichguy/gas_mcp/issues)
- **Google Apps Script API**: [Documentation](https://developers.google.com/apps-script/api)
- **Model Context Protocol**: [MCP Specification](https://modelcontextprotocol.io/)

---

**Next Steps**: Run `./validate-setup.sh` to verify your installation, then follow [`CURSOR_INTEGRATION.md`](CURSOR_INTEGRATION.md) for complete Cursor setup. 