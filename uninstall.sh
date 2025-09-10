#!/bin/bash

# MCP GAS Server Uninstallation Script
# Safely removes the server from MCP client configurations

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
echo "🗑️  MCP GAS Server Uninstallation"
echo "==================================="
echo ""

# Confirmation
echo "This will remove the MCP GAS server from your MCP client configurations."
echo ""
read -p "Are you sure you want to uninstall? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstallation cancelled."
    exit 0
fi

echo ""

# Function to remove gas server from JSON config
remove_from_json_config() {
    local config_file="$1"
    local config_name="$2"
    
    if [[ ! -f "$config_file" ]]; then
        return 0  # File doesn't exist, nothing to do
    fi
    
    # Check if file contains gas server
    if ! grep -q '"gas"' "$config_file" 2>/dev/null; then
        return 0  # No gas server config found
    fi
    
    echo "Removing from $config_name..."
    
    # Create backup
    local backup_file="${config_file}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$config_file" "$backup_file" || return 1
    print_info "Backed up to: $(basename "$backup_file")"
    
    # Try to use jq if available
    if command -v jq &> /dev/null; then
        # Remove gas entry from mcpServers
        if jq -e '.mcpServers.gas' "$config_file" > /dev/null 2>&1; then
            jq 'del(.mcpServers.gas)' "$config_file" > "${config_file}.tmp" && \
            mv "${config_file}.tmp" "$config_file"
            
            # Clean up empty mcpServers if no other servers exist
            if jq -e '.mcpServers | length == 0' "$config_file" > /dev/null 2>&1; then
                jq 'del(.mcpServers)' "$config_file" > "${config_file}.tmp" && \
                mv "${config_file}.tmp" "$config_file"
            fi
            
            print_status "Removed from $config_name"
            return 0
        else
            print_info "No gas server found in $config_name"
            return 0
        fi
    else
        print_warning "jq not found, attempting manual removal"
        # Fallback: Try to remove gas configuration manually
        # This is less reliable but better than nothing
        if sed -i.tmp '/"gas":/,/^[[:space:]]*}/d' "$config_file" 2>/dev/null; then
            rm -f "${config_file}.tmp"
            print_status "Removed from $config_name (manual method)"
        else
            print_warning "Could not automatically remove from $config_name"
            echo "  Please manually remove the 'gas' entry from: $config_file"
        fi
    fi
}

# Remove from MCP client configurations
echo "🔧 Removing from MCP clients..."
echo "-------------------------------"

removed_count=0

# Claude Desktop
CLAUDE_DESKTOP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
if [[ -f "$CLAUDE_DESKTOP_CONFIG" ]]; then
    if remove_from_json_config "$CLAUDE_DESKTOP_CONFIG" "Claude Desktop"; then
        ((removed_count++))
    fi
else
    print_info "Claude Desktop not found (skipping)"
fi

# Claude Code
CLAUDE_CODE_CONFIG="$HOME/.claude/settings.json"
if [[ -f "$CLAUDE_CODE_CONFIG" ]]; then
    if remove_from_json_config "$CLAUDE_CODE_CONFIG" "Claude Code"; then
        ((removed_count++))
    fi
else
    print_info "Claude Code not found (skipping)"
fi

# Cursor
CURSOR_CONFIG="$HOME/.cursor/mcp.json"
if [[ -f "$CURSOR_CONFIG" ]]; then
    if remove_from_json_config "$CURSOR_CONFIG" "Cursor"; then
        ((removed_count++))
    fi
else
    print_info "Cursor not found (skipping)"
fi

# Check if we're in the project directory
echo ""
if [[ -f "package.json" ]] && grep -q '"name": "gas-server"' package.json 2>/dev/null; then
    echo "📦 Local cleanup options..."
    echo "---------------------------"
    
    # Option to remove build artifacts
    read -p "Remove build artifacts (dist/)? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf dist/
        print_status "Build artifacts removed"
    fi
    
    # Option to remove node_modules
    read -p "Remove node_modules? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf node_modules/
        print_status "Dependencies removed"
    fi
    
    # Inform about config files
    echo ""
    print_info "Configuration files preserved:"
    [[ -f "gas-config.json" ]] && echo "  - gas-config.json"
    [[ -f "oauth-config.json" ]] && echo "  - oauth-config.json"
    echo ""
    read -p "Remove configuration files? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        [[ -f "gas-config.json" ]] && rm -f gas-config.json && print_status "Removed gas-config.json"
        [[ -f "oauth-config.json" ]] && rm -f oauth-config.json && print_status "Removed oauth-config.json"
    fi
fi

# Summary
echo ""
echo "==================================="
echo "✅ Uninstallation Complete!"
echo "==================================="
echo ""

if [[ $removed_count -gt 0 ]]; then
    echo "The MCP GAS server has been removed from your MCP clients."
    echo "Restart your MCP client to complete the removal."
else
    echo "No MCP GAS server configurations were found to remove."
fi

echo ""
echo "Backup files have been created for all modified configurations."
echo "You can restore them if needed by renaming them back to the original names."
echo ""

# List backup files created in this session
echo "Backup files created:"
for backup in "$HOME/Library/Application Support/Claude"/*.backup.* \
             "$HOME/.claude"/*.backup.* \
             "$HOME/.cursor"/*.backup.*; do
    if [[ -f "$backup" ]] && [[ "$(stat -f %Sm -t %Y%m%d "$backup" 2>/dev/null || date -r "$backup" +%Y%m%d 2>/dev/null)" == "$(date +%Y%m%d)" ]]; then
        echo "  - $(basename "$backup")"
    fi
done 2>/dev/null

echo ""