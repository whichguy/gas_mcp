#!/bin/bash

echo "🔐 MCP Google Apps Script - Credential Setup"
echo "============================================="

# Function to print colored output
print_status() {
    if [ "$1" = "success" ]; then
        echo "✅ $2"
    elif [ "$1" = "warning" ]; then
        echo "⚠️  $2"
    elif [ "$1" = "error" ]; then
        echo "❌ $2"
    elif [ "$1" = "info" ]; then
        echo "📋 $2"
    fi
}

# Check if we're in the right directory
if [ ! -f "package.json" ] || ! grep -q "mcp-gas-server" package.json; then
    print_status "error" "Please run this script from the mcp_gas project root directory"
    exit 1
fi

echo
print_status "info" "Checking credential configuration options..."

# Check for environment variables
ENV_CLIENT_ID="${GOOGLE_OAUTH_CLIENT_ID}"
ENV_CLIENT_SECRET="${GOOGLE_OAUTH_CLIENT_SECRET}"

if [ -n "$ENV_CLIENT_ID" ] && [ -n "$ENV_CLIENT_SECRET" ]; then
    print_status "success" "Environment variables detected:"
    echo "   GOOGLE_OAUTH_CLIENT_ID: ${ENV_CLIENT_ID:0:20}..."
    echo "   GOOGLE_OAUTH_CLIENT_SECRET: [SET]"
    echo "   🚀 You can use environment variables - no config file needed!"
    USING_ENV_VARS=true
else
    print_status "info" "No environment variables found, will use config file approach"
    USING_ENV_VARS=false
fi

echo
print_status "info" "Checking config file status..."

# Check if config directory exists
if [ ! -d "config" ]; then
    print_status "warning" "Config directory missing, creating..."
    mkdir -p config
fi

# Check if template exists
if [ ! -f "config/oauth.json.template" ]; then
    print_status "warning" "Template missing, creating oauth.json.template..."
    cat > config/oauth.json.template << 'EOF'
{
  "oauth": {
    "client_id": "test_client_id",
    "client_secret": "test_client_secret",
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
EOF
    print_status "success" "Created oauth.json.template"
fi

# Check if config file exists
if [ ! -f "config/oauth.json" ]; then
    print_status "warning" "config/oauth.json missing, creating from template..."
    cp config/oauth.json.template config/oauth.json
    print_status "success" "Created config/oauth.json from template"
    CONFIG_CREATED=true
else
    print_status "success" "config/oauth.json exists"
    CONFIG_CREATED=false
fi

# Verify config content
if [ -f "config/oauth.json" ]; then
    CLIENT_ID=$(node -e "try { const c=JSON.parse(require('fs').readFileSync('config/oauth.json')); console.log(c.oauth.client_id); } catch(e) { console.log('ERROR'); }" 2>/dev/null)
    
    if [ "$CLIENT_ID" = "ERROR" ]; then
        print_status "error" "config/oauth.json has invalid JSON format"
        echo "   Please check the file manually or delete it to recreate"
    elif [ "$CLIENT_ID" = "test_client_id" ]; then
        print_status "warning" "Using test credentials (will show OAuth error)"
        USING_TEST_CREDS=true
    else
        print_status "success" "Real OAuth credentials configured in config file"
        USING_TEST_CREDS=false
    fi
fi

echo
print_status "info" "Setup Summary"
echo "=============================="

if [ "$USING_ENV_VARS" = true ]; then
    print_status "success" "Credential source: Environment variables"
    print_status "info" "The server will use your environment variables for OAuth"
elif [ "$USING_TEST_CREDS" = true ]; then
    print_status "warning" "Credential source: Test credentials in config file"
    print_status "info" "You'll see OAuth errors - this is expected for initial setup"
else
    print_status "success" "Credential source: Real credentials in config file"
fi

echo
print_status "info" "Next Steps"
echo "=============================="

if [ "$USING_ENV_VARS" = true ]; then
    echo "🎉 You're all set! Your environment variables will be used."
    echo "   Run: npm run build && npm start"
elif [ "$USING_TEST_CREDS" = true ]; then
    echo "🔧 To get real OAuth credentials:"
    echo "   1. Follow the guide in OAUTH_QUICK_SETUP.md"
    echo "   2. OR set environment variables:"
    echo "      export GOOGLE_OAUTH_CLIENT_ID='your_real_client_id'"
    echo "      export GOOGLE_OAUTH_CLIENT_SECRET='your_real_client_secret'"
    echo "   3. Then run: npm run build && npm start"
    echo ""
    echo "📋 For now, you can test with: npm run build && ./validate-setup.sh"
else
    echo "🎉 You have real credentials configured!"
    echo "   Run: npm run build && npm start"
fi

echo
print_status "info" "Documentation"
echo "=============================="
echo "📖 Setup guides:"
echo "   • OAUTH_QUICK_SETUP.md - Get real Google OAuth credentials"
echo "   • CURSOR_QUICK_SETUP.md - Configure Cursor IDE integration"
echo "   • CURSOR_INTEGRATION.md - Comprehensive setup guide"
echo ""
echo "🔧 Commands:"
echo "   • ./validate-setup.sh - Test complete setup"
echo "   • npm run build - Compile and copy config files"
echo "   • npm start - Start MCP server"

# Update .gitignore to ensure oauth.json is not committed
if ! grep -q "config/oauth.json" .gitignore 2>/dev/null; then
    echo "" >> .gitignore
    echo "# OAuth credentials (keep private)" >> .gitignore
    echo "config/oauth.json" >> .gitignore
    print_status "success" "Added config/oauth.json to .gitignore"
fi

echo
print_status "success" "Credential setup completed!" 