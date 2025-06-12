# Cursor Integration Guide

Complete guide for integrating the MCP Google Apps Script server with Cursor IDE for seamless Google Apps Script development.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Setup](#quick-setup)
3. [Google OAuth Configuration](#google-oauth-configuration)
4. [Build & Startup Validation](#build--startup-validation)
5. [Cursor MCP Configuration](#cursor-mcp-configuration)
6. [Usage Examples](#usage-examples)
7. [Troubleshooting](#troubleshooting)
8. [Advanced Configuration](#advanced-configuration)

## Prerequisites

### System Requirements
- **Node.js**: v18.0.0 or higher (tested with v22.13.1)
- **npm**: v8.0.0 or higher (tested with v11.2.0)
- **Cursor IDE**: Latest version with MCP support
- **Google Account**: With access to Google Cloud Console

### Verify Prerequisites
```bash
# Check Node.js version
node --version  # Should be v18+

# Check npm version
npm --version   # Should be v8+

# Check if Cursor supports MCP
# Open Cursor → Settings → MCP (should be available)
```

## Quick Setup

### 1. Clone and Install
```bash
git clone https://github.com/whichguy/gas_mcp.git
cd gas_mcp
npm install
```

### 2. Initial Configuration
```bash
# Create OAuth configuration file
npm run setup

# This copies config/oauth.json.template to config/oauth.json
# You'll need to edit it with real Google OAuth credentials
```

### 3. Validate Build Process
```bash
# Clean build test
npm run clean
npm run build

# Verify build output
ls -la dist/src/        # Should show compiled JavaScript files
ls -la dist/config/     # Should show copied config files
```

### 4. Test Startup (with test credentials)
```bash
# This will fail with OAuth error - that's expected with test credentials
npm start

# You should see:
# ✅ "Auth tool loaded OAuth config"
# ❌ OAuth error when trying to authenticate (expected)
```

## Google OAuth Configuration

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the following APIs:
   - Google Apps Script API
   - Google Drive API
   - Google Sheets API (optional)
   - Google Docs API (optional)

### Step 2: Create OAuth Credentials

1. **Navigate to Credentials**:
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth 2.0 Client IDs"

2. **Configure OAuth Consent Screen**:
   - User Type: External (for personal use) or Internal (for organization)
   - App name: "MCP Google Apps Script Integration"
   - Authorized domains: Add your domain if applicable

3. **Create OAuth Client**:
   - Application type: "Web application"
   - Name: "MCP Gas Server"
   - Authorized redirect URIs: `http://localhost:3000/oauth/callback`

4. **Download Credentials**:
   - Copy the Client ID and Client Secret

### Step 3: Configure OAuth File

Edit `config/oauth.json`:
```json
{
  "oauth": {
    "client_id": "YOUR_ACTUAL_CLIENT_ID_HERE",
    "client_secret": "YOUR_ACTUAL_CLIENT_SECRET_HERE", 
    "redirect_uri": "http://localhost:3000/oauth/callback",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "scopes": [
      "https://www.googleapis.com/auth/script.projects",
      "https://www.googleapis.com/auth/script.processes",
      "https://www.googleapis.com/auth/script.deployments",
      "https://www.googleapis.com/auth/script.scriptapp",
      "https://www.googleapis.com/auth/script.external_request",
      "https://www.googleapis.com/auth/script.webapp.deploy",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/forms",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile"
    ]
  },
  "server": {
    "port": 3000
  }
}
```

⚠️ **Security Note**: Add `config/oauth.json` to `.gitignore` (already done) to prevent committing credentials.

## Build & Startup Validation

### Validate Complete Build Process
```bash
# Full build validation
npm run clean           # ✅ Should clear dist/ directory
npm run build          # ✅ Should compile TypeScript and copy config
npm start              # ✅ Should start MCP server

# Expected output:
# 🔍 Auth tool loaded OAuth config: { client_id: 'your_id...', scopes: [...], scopeCount: 12 }
# 🚀 MCP server started on stdio transport
```

### Test Authentication Flow
```bash
# Start server in one terminal
npm start

# In another terminal, test the gas_auth tool
# (This will open browser for OAuth - complete the flow)
```

### Verify Core Functionality
```bash
# Run basic tests (with test mode to skip real OAuth)
MCP_TEST_MODE=true npm run test:system:basic

# Expected: Tests should pass without requiring real authentication
```

## Cursor MCP Configuration

### Step 1: Configure Cursor MCP Settings

1. **Open Cursor Settings**:
   - Cursor → Settings → MCP
   - Or press `Cmd/Ctrl + ,` and search for "MCP"

2. **Add MCP Server Configuration**:
```json
{
  "mcpServers": {
    "gas_mcp": {
      "command": "node",
      "args": ["/Users/jameswiese/src/mcp_gas/dist/src/index.js"],
      "cwd": "/Users/jameswiese/src/mcp_gas",
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

**Important**: Replace `/Users/jameswiese/src/mcp_gas` with your actual project path:
```bash
# Get your actual path
pwd
# Use this path in the Cursor configuration
```

### Step 2: Alternative Configuration (if absolute paths cause issues)

Create a startup script for easier configuration:

1. **Create startup script**:
```bash
# Create start-mcp.sh in project root
cat > start-mcp.sh << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
npm run build > /dev/null 2>&1
node dist/src/index.js
EOF

chmod +x start-mcp.sh
```

2. **Update Cursor configuration**:
```json
{
  "mcpServers": {
    "gas_mcp": {
      "command": "/Users/jameswiese/src/mcp_gas/start-mcp.sh",
      "cwd": "/Users/jameswiese/src/mcp_gas"
    }
  }
}
```

### Step 3: Verify MCP Connection

1. **Restart Cursor** after adding MCP configuration
2. **Check MCP Status**:
   - Look for MCP indicator in Cursor status bar
   - Should show "gas_mcp" as connected
3. **Test MCP Tools**:
   - Try using Google Apps Script commands in Cursor
   - Should see available gas_* tools

## Usage Examples

### Basic Workflow in Cursor

1. **Authenticate with Google**:
   ```
   Use MCP command: gas_auth --mode=start
   ```

2. **Create New Google Apps Script Project**:
   ```
   Use MCP command: gas_project_create --title="My New Project"
   ```

3. **Add Source Code**:
   ```
   Use MCP command: gas_write --path="[scriptId]/myFunction.js" --content="function test() { return 'Hello!'; }"
   ```

4. **Deploy and Execute**:
   ```
   Use MCP command: gas_deploy_create --script-id="[scriptId]"
   Use MCP command: gas_run --script-id="[scriptId]" --function-name="test"
   ```

### Integration with Cursor Features

- **Code Completion**: MCP tools will appear in Cursor's command palette
- **File Sync**: Use gas_write and gas_cat to sync code between local files and Google Apps Script
- **Project Management**: Manage multiple GAS projects from within Cursor
- **Real-time Execution**: Test functions directly from Cursor

## Troubleshooting

### Common Issues

#### 1. "Error: ENOENT: no such file or directory, open 'oauth.json'"
```bash
# Solution: Ensure config file exists and build copies it
npm run setup          # Creates config/oauth.json from template
npm run build         # Copies config to dist/config/
```

#### 2. "OAuth client was not found" (Error 401: invalid_client)
```bash
# Solution: Replace test credentials with real Google OAuth credentials
# 1. Follow "Google OAuth Configuration" section above
# 2. Update config/oauth.json with real credentials
# 3. Rebuild: npm run build
```

#### 3. "MCP server not connecting in Cursor"
```bash
# Solution: Check paths and permissions
# 1. Verify absolute path in Cursor config
# 2. Ensure start-mcp.sh is executable: chmod +x start-mcp.sh
# 3. Test server manually: npm start
# 4. Check Cursor logs for error details
```

#### 4. "Port 3000 already in use"
```bash
# Solution: Kill processes using port 3000
lsof -ti:3000 | xargs kill -9

# Or change port in config/oauth.json (also update Google OAuth redirect URI)
```

#### 5. Build issues with TypeScript
```bash
# Solution: Clean install
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Debug Mode

Enable debug logging:
```bash
# Set debug environment variable
export DEBUG=mcp:*
npm start

# Or in Cursor MCP config:
{
  "mcpServers": {
    "gas_mcp": {
      "command": "node",
      "args": ["/path/to/dist/src/index.js"],
      "env": {
        "DEBUG": "mcp:*",
        "NODE_ENV": "development"
      }
    }
  }
}
```

### Validation Commands

```bash
# Test build process
npm run clean && npm run build && echo "✅ Build successful"

# Test server startup  
timeout 5s npm start 2>&1 | grep -q "Auth tool loaded" && echo "✅ Server starts correctly"

# Test configuration loading
node -e "console.log(JSON.parse(require('fs').readFileSync('config/oauth.json')))" 2>/dev/null && echo "✅ Config valid"

# Test MCP connection (requires Cursor running)
echo "Manual test: Check Cursor MCP status bar for gas_mcp connection"
```

## Advanced Configuration

### Custom Port Configuration

If you need to use a different port:

1. **Update Google OAuth redirect URI** in Google Cloud Console
2. **Update config/oauth.json**:
   ```json
   {
     "oauth": {
       "redirect_uri": "http://localhost:YOUR_PORT/oauth/callback"
     },
     "server": {
       "port": YOUR_PORT
     }
   }
   ```

### Environment-Specific Configs

Create multiple config files:
```bash
# Development config
cp config/oauth.json config/oauth.dev.json

# Production config  
cp config/oauth.json config/oauth.prod.json

# Update package.json scripts:
"start:dev": "cp config/oauth.dev.json config/oauth.json && npm start",
"start:prod": "cp config/oauth.prod.json config/oauth.json && npm start"
```

### Cursor Workspace Settings

Add to `.vscode/settings.json` (Cursor uses VS Code settings format):
```json
{
  "mcp.servers": {
    "gas_mcp": {
      "enabled": true,
      "autoStart": true
    }
  }
}
```

## Security Best Practices

1. **Never commit OAuth credentials**:
   ```bash
   # Verify .gitignore includes:
   config/oauth.json
   **/*credentials*.json
   .auth/
   ```

2. **Use environment variables for sensitive data**:
   ```javascript
   // Alternative: Use environment variables instead of config file
   const client_id = process.env.GOOGLE_OAUTH_CLIENT_ID;
   const client_secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
   ```

3. **Limit OAuth scopes** to only what you need

4. **Regularly rotate OAuth credentials**

## Support

- **GitHub Issues**: [https://github.com/whichguy/gas_mcp/issues](https://github.com/whichguy/gas_mcp/issues)
- **Documentation**: Check `docs/` directory for additional guides
- **Examples**: See `examples/` directory for usage patterns

---

**Next Steps**: Once you have Cursor integration working, check out:
- [Gas Projects Documentation](gas-projects/README.md) - Managing GAS projects
- [Examples](examples/README.md) - Usage examples and patterns
- [Repository Structure](REPOSITORY_STRUCTURE.md) - Understanding the codebase 