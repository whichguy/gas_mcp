# Environment Variables Configuration

🔐 **Secure Credential Management with Environment Variables**

## Overview

The MCP Google Apps Script server supports loading OAuth credentials from environment variables as an alternative to config files. This is more secure for production deployments and CI/CD environments.

## Supported Environment Variables

### Required OAuth Variables
```bash
GOOGLE_OAUTH_CLIENT_ID="your_google_oauth_client_id"
GOOGLE_OAUTH_CLIENT_SECRET="your_google_oauth_client_secret"
```

### Optional Variables
```bash
OAUTH_SERVER_PORT="3000"                    # OAuth callback server port (default: 3000)
NODE_ENV="production"                       # Environment mode
DEBUG="mcp:*"                              # Enable debug logging
```

## Setup Methods

### Method 1: Export in Shell Session
```bash
# Set for current session
export GOOGLE_OAUTH_CLIENT_ID="your_actual_client_id_here"
export GOOGLE_OAUTH_CLIENT_SECRET="your_actual_client_secret_here"

# Start the server
npm start
```

### Method 2: Create .env File (Development)
```bash
# Create .env file (automatically ignored by git)
cat > .env << 'EOF'
GOOGLE_OAUTH_CLIENT_ID=your_actual_client_id_here
GOOGLE_OAUTH_CLIENT_SECRET=your_actual_client_secret_here
OAUTH_SERVER_PORT=3000
EOF

# Load and start
source .env && npm start
```

### Method 3: Shell Profile (Persistent)
```bash
# Add to ~/.zshrc, ~/.bashrc, or ~/.profile
echo 'export GOOGLE_OAUTH_CLIENT_ID="your_actual_client_id_here"' >> ~/.zshrc
echo 'export GOOGLE_OAUTH_CLIENT_SECRET="your_actual_client_secret_here"' >> ~/.zshrc

# Reload shell
source ~/.zshrc

# Start server (credentials now available)
npm start
```

### Method 4: Process Environment (Production)
```bash
# Run with environment variables inline
GOOGLE_OAUTH_CLIENT_ID="your_id" GOOGLE_OAUTH_CLIENT_SECRET="your_secret" npm start
```

## CI/CD Integration

### GitHub Actions
```yaml
name: MCP Gas Server
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    env:
      GOOGLE_OAUTH_CLIENT_ID: ${{ secrets.GOOGLE_OAUTH_CLIENT_ID }}
      GOOGLE_OAUTH_CLIENT_SECRET: ${{ secrets.GOOGLE_OAUTH_CLIENT_SECRET }}
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm test
```

### Docker
```dockerfile
FROM node:18
WORKDIR /app
COPY . .
RUN npm install && npm run build

# Environment variables provided at runtime
ENV NODE_ENV=production
CMD ["npm", "start"]
```

```bash
# Run with credentials
docker run -e GOOGLE_OAUTH_CLIENT_ID="your_id" \
           -e GOOGLE_OAUTH_CLIENT_SECRET="your_secret" \
           mcp-gas-server
```

## Cursor Integration with Environment Variables

### Option 1: Set Environment Variables Globally
```bash
# Set in your shell profile
export GOOGLE_OAUTH_CLIENT_ID="your_id"
export GOOGLE_OAUTH_CLIENT_SECRET="your_secret"

# Restart Cursor (will inherit environment)
```

Cursor MCP configuration:
```json
{
  "mcpServers": {
    "gas_mcp": {
      "command": "node",
      "args": ["/path/to/mcp_gas/dist/src/index.js"],
      "cwd": "/path/to/mcp_gas"
    }
  }
}
```

### Option 2: Specify Environment Variables in Cursor
```json
{
  "mcpServers": {
    "gas_mcp": {
      "command": "node",
      "args": ["/path/to/mcp_gas/dist/src/index.js"],
      "cwd": "/path/to/mcp_gas",
      "env": {
        "GOOGLE_OAUTH_CLIENT_ID": "your_actual_client_id",
        "GOOGLE_OAUTH_CLIENT_SECRET": "your_actual_client_secret",
        "NODE_ENV": "production"
      }
    }
  }
}
```

## Security Benefits

### ✅ Advantages of Environment Variables
- **No credentials in version control** - impossible to accidentally commit
- **Per-environment configuration** - different credentials for dev/staging/prod
- **Runtime security** - credentials only exist in memory
- **CI/CD friendly** - works with secret management systems
- **Access control** - only processes with access can read them

### ⚠️ Security Considerations
- **Process visibility** - other processes may see environment variables
- **Log exposure** - be careful not to log credential values
- **Shell history** - avoid putting credentials in command history

## Validation and Testing

### Check if Environment Variables are Set
```bash
echo "Client ID: ${GOOGLE_OAUTH_CLIENT_ID:0:20}..."
echo "Client Secret: ${GOOGLE_OAUTH_CLIENT_SECRET:+[SET]}"
```

### Test Configuration Loading
```bash
# Run credential setup check
npm run setup

# Should show: "✅ Environment variables detected"
```

### Validate OAuth Flow
```bash
# Start server with environment variables
npm start

# Should show: "🔑 Using OAuth credentials from environment variables"
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No OAuth configuration found" | Set both `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` |
| "Environment variables not working" | Check spelling and restart shell/Cursor |
| "Credentials in logs" | Review debug output, never log credential values |
| "Cursor not using environment" | Set in Cursor MCP config `env` section |

## Migration from Config Files

### Step 1: Extract Current Credentials
```bash
# Get credentials from config file
CLIENT_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('config/oauth.json')).oauth.client_id)")
CLIENT_SECRET=$(node -e "console.log(JSON.parse(require('fs').readFileSync('config/oauth.json')).oauth.client_secret)")

echo "Client ID: $CLIENT_ID"
echo "Client Secret: $CLIENT_SECRET"
```

### Step 2: Set Environment Variables
```bash
export GOOGLE_OAUTH_CLIENT_ID="$CLIENT_ID"
export GOOGLE_OAUTH_CLIENT_SECRET="$CLIENT_SECRET"
```

### Step 3: Test Environment Variable Usage
```bash
# Remove config file temporarily to test
mv config/oauth.json config/oauth.json.backup

# Start server - should use environment variables
npm start

# Should see: "🔑 Using OAuth credentials from environment variables"
```

### Step 4: Clean Up Config File (Optional)
```bash
# If environment variables work, you can remove the config file
# rm config/oauth.json.backup
```

## Best Practices

1. **Never log credential values** - use `[SET]` or truncated display
2. **Use different credentials per environment** (dev/staging/prod)
3. **Rotate credentials regularly**
4. **Use secret management systems** in production (AWS Secrets Manager, etc.)
5. **Set minimal required scopes** for security

---

**Next Steps**: 
- Set your environment variables using one of the methods above
- Run `npm run setup` to verify configuration
- Start the server with `npm start`
- Configure Cursor MCP integration 