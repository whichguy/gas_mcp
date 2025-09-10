#!/bin/bash

# MCP GAS Server Installation Script
# Dynamically installs the server and configures MCP clients

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_status() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1" >&2; exit 1; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_info() { echo -e "${BLUE}ℹ${NC} $1"; }

# Banner
echo ""
echo "🚀 MCP GAS Server Installation"
echo "================================"
echo ""

# Find project root dynamically
find_project_root() {
    local dir="$PWD"
    while [[ "$dir" != "/" ]]; do
        if [[ -f "$dir/package.json" ]] && grep -q '"name": "gas-server"' "$dir/package.json" 2>/dev/null; then
            echo "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    return 1
}

# Get project root
if ! PROJECT_ROOT="$(find_project_root)"; then
    print_error "Not in mcp_gas project directory. Please run from within the project."
fi

print_info "Project root: $PROJECT_ROOT"

# Calculate absolute paths
MCP_INDEX_PATH="$PROJECT_ROOT/dist/src/index.js"
MCP_CONFIG_PATH="$PROJECT_ROOT/gas-config.json"
OAUTH_CONFIG_PATH="$PROJECT_ROOT/oauth-config.json"

# Change to project root
cd "$PROJECT_ROOT" || exit 1

# Check Node.js version
echo ""
echo "🔍 Checking requirements..."
echo "----------------------------"

if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18.0.0 or higher."
fi

NODE_VERSION=$(node -v | cut -d'v' -f2)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)

if [[ $NODE_MAJOR -lt 18 ]]; then
    print_error "Node.js version $NODE_VERSION is too old. Please install Node.js 18.0.0 or higher."
else
    print_status "Node.js $NODE_VERSION"
fi

if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm."
else
    NPM_VERSION=$(npm -v)
    print_status "npm $NPM_VERSION"
fi

# Check for OAuth config
if [[ ! -f "$OAUTH_CONFIG_PATH" ]]; then
    print_warning "oauth-config.json not found"
    echo ""
    echo "  To create OAuth credentials:"
    echo "  1. Go to https://console.cloud.google.com/"
    echo "  2. Enable Google Apps Script API"
    echo "  3. Create OAuth 2.0 credentials (Desktop application)"
    echo "  4. Download JSON and save as: $OAUTH_CONFIG_PATH"
    echo ""
    read -p "Continue without OAuth config? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    print_status "OAuth config found"
fi

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
echo "----------------------------"

if [[ ! -d "node_modules" ]] || [[ "package.json" -nt "node_modules" ]]; then
    npm install || print_error "Failed to install dependencies"
    print_status "Dependencies installed"
else
    print_status "Dependencies up to date"
fi

# Build project
echo ""
echo "🔨 Building project..."
echo "----------------------"

npm run build || print_error "Build failed"
print_status "Project built successfully"

if [[ ! -f "$MCP_INDEX_PATH" ]]; then
    print_error "Build output not found at $MCP_INDEX_PATH"
fi

# Function to update JSON config using jq or fallback
update_json_config() {
    local config_file="$1"
    local config_name="$2"
    local backup_file="${config_file}.backup.$(date +%Y%m%d_%H%M%S)"
    
    # Create backup
    cp "$config_file" "$backup_file" || return 1
    print_info "Backed up to: $(basename "$backup_file")"
    
    # MCP server configuration
    local mcp_config=$(cat <<EOF
{
  "gas": {
    "command": "node",
    "args": [
      "$MCP_INDEX_PATH",
      "--config",
      "$MCP_CONFIG_PATH"
    ],
    "env": {
      "NODE_ENV": "production"
    }
  }
}
EOF
)
    
    # Try to use jq if available
    if command -v jq &> /dev/null; then
        # Check if mcpServers exists
        if jq -e '.mcpServers' "$config_file" > /dev/null 2>&1; then
            # Update existing mcpServers
            jq --argjson mcp "$mcp_config" '.mcpServers = .mcpServers + $mcp' "$config_file" > "${config_file}.tmp" && \
            mv "${config_file}.tmp" "$config_file"
        else
            # Add mcpServers if it doesn't exist
            jq --argjson mcp "$mcp_config" '. + {mcpServers: $mcp}' "$config_file" > "${config_file}.tmp" && \
            mv "${config_file}.tmp" "$config_file"
        fi
        return $?
    else
        print_warning "jq not found, using fallback method"
        # Fallback: Manual JSON manipulation (less reliable)
        # This is a simplified approach - in production, you'd want more robust JSON handling
        return 1
    fi
}

# Update MCP client configurations
echo ""
echo "🔧 Configuring MCP clients..."
echo "-----------------------------"

# Claude Desktop
CLAUDE_DESKTOP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
if [[ -f "$CLAUDE_DESKTOP_CONFIG" ]]; then
    echo "Updating Claude Desktop..."
    if update_json_config "$CLAUDE_DESKTOP_CONFIG" "Claude Desktop"; then
        print_status "Claude Desktop configured"
    else
        print_warning "Failed to update Claude Desktop config automatically"
        echo "  Please add manually to: $CLAUDE_DESKTOP_CONFIG"
    fi
else
    print_info "Claude Desktop not found (skipping)"
fi

# Claude Code
CLAUDE_CODE_CONFIG="$HOME/.claude/settings.json"
if [[ -f "$CLAUDE_CODE_CONFIG" ]]; then
    echo "Updating Claude Code..."
    if update_json_config "$CLAUDE_CODE_CONFIG" "Claude Code"; then
        print_status "Claude Code configured"
    else
        print_warning "Failed to update Claude Code config automatically"
        echo "  Please add manually to: $CLAUDE_CODE_CONFIG"
    fi
else
    print_info "Claude Code not found (skipping)"
fi

# Cursor
CURSOR_CONFIG="$HOME/.cursor/mcp.json"
if [[ -f "$CURSOR_CONFIG" ]]; then
    echo "Updating Cursor..."
    if update_json_config "$CURSOR_CONFIG" "Cursor"; then
        print_status "Cursor configured"
    else
        print_warning "Failed to update Cursor config automatically"
        echo "  Please add manually to: $CURSOR_CONFIG"
    fi
else
    print_info "Cursor not found (skipping)"
fi

# Summary
echo ""
echo "================================"
echo "✅ Installation Complete!"
echo "================================"
echo ""
echo "📍 Installed from: $PROJECT_ROOT"
echo "📄 Server path: $MCP_INDEX_PATH"
echo ""

if [[ ! -f "$OAUTH_CONFIG_PATH" ]]; then
    echo "⚠️  Remember to add oauth-config.json before using the server"
    echo ""
fi

echo "To use the MCP GAS server:"
echo "1. Restart your MCP client (Claude Desktop, Claude Code, or Cursor)"
echo "2. The server will be available in your MCP tools"
echo ""
echo "For manual configuration, add this to your MCP client's config:"
echo ""
echo '  "gas": {'
echo '    "command": "node",'
echo "    \"args\": [\"$MCP_INDEX_PATH\", \"--config\", \"$MCP_CONFIG_PATH\"],"
echo '    "env": {"NODE_ENV": "production"}'
echo '  }'
echo ""