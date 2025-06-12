# Quick Cursor Setup Guide

🚀 **2-Minute Cursor MCP Integration**

## 📝 What You Need
- Cursor IDE installed
- MCP Gas server built and working (run `./validate-setup.sh` to verify)
- 2 minutes of time

## 🔧 Setup Steps

### 1. Get Your Project Path
```bash
# Run this in your mcp_gas directory
pwd
# Copy the output (e.g., /Users/jameswiese/src/mcp_gas)
```

### 2. Open Cursor Settings
1. **Open Cursor IDE**
2. **Press `Cmd+,` (Mac) or `Ctrl+,` (Windows/Linux)**
3. **Search for "MCP"** in settings

### 3. Add MCP Server Configuration

In the MCP settings section, add this configuration (replace the path with yours):

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

**⚠️ Important**: Replace `/Users/jameswiese/src/mcp_gas` with your actual project path from step 1.

### 4. Alternative: Create Startup Script (If paths cause issues)

Create `start-mcp.sh` in your project root:
```bash
#!/bin/bash
cd "$(dirname "$0")"
npm run build > /dev/null 2>&1
node dist/src/index.js
```

Make it executable:
```bash
chmod +x start-mcp.sh
```

Then use this Cursor config instead:
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

### 5. Restart Cursor
1. **Save the MCP settings**
2. **Restart Cursor completely** (Cmd+Q on Mac, then reopen)

### 6. Verify Connection
1. **Look for MCP indicator** in Cursor status bar
2. **Should show "gas_mcp" as connected**
3. **Try MCP commands** in Cursor's command palette

## ✅ **Success Indicators**

After setup, you should see:
- ✅ MCP server "gas_mcp" appears in Cursor status bar
- ✅ Gas tools available in Cursor command palette
- ✅ Can run MCP commands like `gas_auth`, `gas_project_create`

## 🎯 **Quick Test**

Once connected, try these MCP commands in Cursor:

1. **Check authentication status**:
   ```
   Use MCP tool: gas_auth --mode=status
   ```

2. **List available tools**:
   - Open Cursor command palette (Cmd+Shift+P)
   - Type "MCP" to see available tools

## 🚫 **Troubleshooting**

| Problem | Solution |
|---------|----------|
| MCP server not showing in status bar | Check absolute paths in config, restart Cursor |
| "Command not found" errors | Use the startup script approach |
| Connection fails | Run `./validate-setup.sh` to check server status |
| Tools not appearing | Wait 30 seconds after Cursor restart |

## 🔄 **Configuration Templates**

### For macOS:
```json
{
  "mcpServers": {
    "gas_mcp": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/src/mcp_gas/dist/src/index.js"],
      "cwd": "/Users/YOUR_USERNAME/src/mcp_gas"
    }
  }
}
```

### For Windows:
```json
{
  "mcpServers": {
    "gas_mcp": {
      "command": "node",
      "args": ["C:\\Users\\YOUR_USERNAME\\src\\mcp_gas\\dist\\src\\index.js"],
      "cwd": "C:\\Users\\YOUR_USERNAME\\src\\mcp_gas"
    }
  }
}
```

### For Linux:
```json
{
  "mcpServers": {
    "gas_mcp": {
      "command": "node", 
      "args": ["/home/YOUR_USERNAME/src/mcp_gas/dist/src/index.js"],
      "cwd": "/home/YOUR_USERNAME/src/mcp_gas"
    }
  }
}
```

## 📚 **What's Next?**

Once Cursor MCP is working:

1. **Get real OAuth credentials** (see `OAUTH_QUICK_SETUP.md`)
2. **Start creating Google Apps Script projects** from Cursor
3. **Use MCP tools** for seamless GAS development
4. **Check examples** in `examples/` directory

---

**Total Time**: ~2 minutes
**Difficulty**: Easy  
**Result**: Cursor + Google Apps Script integration ready! 