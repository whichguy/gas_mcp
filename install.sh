#!/bin/bash

# MCP GAS Server Installation Script
# Enhanced version with multi-IDE support and idempotent operations
# Supports: Claude Desktop, Claude Code, Cursor, VS Code, Zed, Windsurf, Neovim MCPHub, Codex CLI

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Helper functions
print_status() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1" >&2; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_info() { echo -e "${BLUE}ℹ${NC} $1"; }
print_skip() { echo -e "${CYAN}○${NC} $1"; }

# Parse command line arguments
DRY_RUN=false
INTERACTIVE=false
FORCE_UPDATE=false
AUTO=false

# Check if running from pipe/curl (stdin is not a TTY)
if [ ! -t 0 ]; then
    AUTO=true
fi

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --interactive|-i)
            INTERACTIVE=true
            AUTO=false  # Override auto mode
            shift
            ;;
        --auto)
            AUTO=true
            INTERACTIVE=false
            shift
            ;;
        --force)
            FORCE_UPDATE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --dry-run        Show what would be changed without making changes"
            echo "  --interactive    Interactively select which IDEs to configure"
            echo "  --auto           Run in automatic mode (non-interactive)"
            echo "  --force          Force update even if already configured"
            echo "  --help           Show this help message"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Banner
echo ""
echo "🚀 MCP GAS Server Installation"
if [[ "$DRY_RUN" == true ]]; then
    echo "   [DRY RUN MODE - No changes will be made]"
fi
if [[ "$AUTO" == true ]]; then
    echo "   [AUTO MODE - Non-interactive installation]"
fi
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
    exit 1
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
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)

if [[ $NODE_MAJOR -lt 18 ]]; then
    print_error "Node.js version $NODE_VERSION is too old. Please install Node.js 18.0.0 or higher."
    exit 1
else
    print_status "Node.js $NODE_VERSION"
fi

if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm."
    exit 1
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
    if [[ "$DRY_RUN" == false ]]; then
        read -p "Continue without OAuth config? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
else
    print_status "OAuth config found"
fi

# Install dependencies and build (skip in dry-run mode)
if [[ "$DRY_RUN" == false ]]; then
    echo ""
    echo "📦 Installing dependencies..."
    echo "----------------------------"
    
    if [[ ! -d "node_modules" ]] || [[ "package.json" -nt "node_modules" ]]; then
        npm install || { print_error "Failed to install dependencies"; exit 1; }
        print_status "Dependencies installed"
    else
        print_status "Dependencies up to date"
    fi
    
    # Build project
    echo ""
    echo "🔨 Building project..."
    echo "----------------------"
    
    npm run build || { print_error "Build failed"; exit 1; }
    print_status "Project built successfully"
    
    if [[ ! -f "$MCP_INDEX_PATH" ]]; then
        print_error "Build output not found at $MCP_INDEX_PATH"
        exit 1
    fi
else
    print_info "Skipping dependency installation and build (dry-run mode)"
fi

# Function to check if IDE is installed
check_ide_installed() {
    case "$1" in
        "vscode")
            command -v code &>/dev/null || [[ -d "/Applications/Visual Studio Code.app" ]]
            ;;
        "vscode-insiders")
            command -v code-insiders &>/dev/null || [[ -d "/Applications/Visual Studio Code - Insiders.app" ]]
            ;;
        "vscodium")
            command -v codium &>/dev/null || [[ -d "/Applications/VSCodium.app" ]]
            ;;
        "zed")
            command -v zed &>/dev/null || [[ -d "/Applications/Zed.app" ]]
            ;;
        "windsurf")
            [[ -d "$HOME/.codeium/windsurf" ]]
            ;;
        "neovim")
            command -v nvim &>/dev/null
            ;;
        "codex")
            [[ -d "$HOME/.codex" ]]
            ;;
        "claude-desktop")
            [[ -f "$HOME/Library/Application Support/Claude/claude_desktop_config.json" ]]
            ;;
        "claude-code")
            [[ -f "$HOME/.claude/settings.json" ]]
            ;;
        "cursor")
            [[ -f "$HOME/.cursor/mcp.json" ]] || [[ -d "/Applications/Cursor.app" ]]
            ;;
        *)
            return 1
            ;;
    esac
}

# Function to get config path for IDE
get_config_path() {
    local ide="$1"
    case "$OSTYPE" in
        darwin*)
            case "$ide" in
                vscode) echo "$HOME/Library/Application Support/Code/User/globalStorage/github.copilot/mcp.json" ;;
                vscode-insiders) echo "$HOME/Library/Application Support/Code - Insiders/User/globalStorage/github.copilot/mcp.json" ;;
                vscodium) echo "$HOME/Library/Application Support/VSCodium/User/globalStorage/github.copilot/mcp.json" ;;
                zed) echo "$HOME/.config/zed/settings.json" ;;
                windsurf) echo "$HOME/.codeium/windsurf/mcp_config.json" ;;
                neovim) echo "$HOME/.config/mcphub/servers.json" ;;
                codex) echo "$HOME/.codex/config.toml" ;;
                claude-desktop) echo "$HOME/Library/Application Support/Claude/claude_desktop_config.json" ;;
                claude-code) echo "$HOME/.claude/settings.json" ;;
                cursor) echo "$HOME/.cursor/mcp.json" ;;
            esac
            ;;
        linux-gnu*)
            case "$ide" in
                vscode) echo "$HOME/.config/Code/User/globalStorage/github.copilot/mcp.json" ;;
                vscode-insiders) echo "$HOME/.config/Code - Insiders/User/globalStorage/github.copilot/mcp.json" ;;
                vscodium) echo "$HOME/.config/VSCodium/User/globalStorage/github.copilot/mcp.json" ;;
                zed) echo "$HOME/.config/zed/settings.json" ;;
                windsurf) echo "$HOME/.codeium/windsurf/mcp_config.json" ;;
                neovim) echo "$HOME/.config/mcphub/servers.json" ;;
                codex) echo "$HOME/.codex/config.toml" ;;
                claude-desktop) echo "$HOME/.config/claude/claude_desktop_config.json" ;;
                claude-code) echo "$HOME/.claude/settings.json" ;;
                cursor) echo "$HOME/.cursor/mcp.json" ;;
            esac
            ;;
        msys*|cygwin*|mingw*)
            case "$ide" in
                vscode) echo "$APPDATA/Code/User/globalStorage/github.copilot/mcp.json" ;;
                vscode-insiders) echo "$APPDATA/Code - Insiders/User/globalStorage/github.copilot/mcp.json" ;;
                vscodium) echo "$APPDATA/VSCodium/User/globalStorage/github.copilot/mcp.json" ;;
                # Windows paths for other IDEs would go here
            esac
            ;;
    esac
}

# Function to check permissions
check_permissions() {
    local file="$1"
    if [[ -e "$file" ]] && [[ ! -w "$file" ]]; then
        print_error "No write permission for $file"
        echo "  Try: sudo chown $USER '$file'"
        return 1
    fi
    local dir=$(dirname "$file")
    if [[ ! -d "$dir" ]]; then
        if [[ "$DRY_RUN" == false ]]; then
            mkdir -p "$dir" || return 1
        fi
    elif [[ ! -w "$dir" ]]; then
        print_error "No write permission for directory $dir"
        return 1
    fi
    return 0
}

# Function to safely update JSON config (idempotent)
update_json_safely() {
    local config_file="$1"
    local config_name="$2"
    local config_key="${3:-mcpServers}"  # Default to mcpServers, but allow override for Zed
    
    # Check permissions
    if ! check_permissions "$config_file"; then
        return 1
    fi
    
    # If file doesn't exist, create it with minimal structure
    if [[ ! -f "$config_file" ]]; then
        if [[ "$DRY_RUN" == true ]]; then
            print_info "[DRY RUN] Would create $config_file"
            return 0
        fi
        echo '{}' > "$config_file"
    fi
    
    # Validate JSON
    if ! jq '.' "$config_file" > /dev/null 2>&1; then
        print_error "Invalid JSON in $config_file"
        return 1
    fi
    
    # Check if gas already exists
    if jq -e ".${config_key}.gas" "$config_file" > /dev/null 2>&1; then
        if [[ "$FORCE_UPDATE" == false ]]; then
            # Check if path is different
            local installed_path=$(jq -r ".${config_key}.gas.args[0] // .${config_key}.gas.command.args[0] // \"\"" "$config_file" 2>/dev/null)
            if [[ "$installed_path" == "$MCP_INDEX_PATH" ]]; then
                print_skip "$config_name already configured with current version"
                return 0
            else
                print_warning "$config_name has different version configured"
                if [[ "$DRY_RUN" == false ]]; then
                    read -p "  Update to current version? (y/n) " -n 1 -r
                    echo
                    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                        return 0
                    fi
                else
                    print_info "[DRY RUN] Would prompt to update version"
                    return 0
                fi
            fi
        else
            print_info "Force updating $config_name"
        fi
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would update $config_name"
        return 0
    fi
    
    # Create backup
    local backup_file="${config_file}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$config_file" "$backup_file" || return 1
    print_info "Backed up to: $(basename "$backup_file")"
    
    # Prepare MCP configuration based on IDE type
    local mcp_config
    if [[ "$config_name" == "Zed" ]]; then
        # Zed uses a different format with context_servers
        mcp_config=$(cat <<EOF
{
  "gas": {
    "settings": {},
    "command": {
      "path": "node",
      "args": ["$MCP_INDEX_PATH", "--config", "$MCP_CONFIG_PATH"],
      "env": {"NODE_ENV": "production"}
    }
  }
}
EOF
)
    else
        # Standard format for most IDEs
        mcp_config=$(cat <<EOF
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
    fi
    
    # Update JSON with error handling
    local tmp_file="${config_file}.tmp.$$"
    if jq --argjson mcp "$mcp_config" --arg key "$config_key" '
        if has($key) then
            .[$key] = (.[$key] // {}) + $mcp
        else
            . + {($key): $mcp}
        end' "$config_file" > "$tmp_file"; then
        mv "$tmp_file" "$config_file"
        print_status "$config_name configured"
    else
        rm -f "$tmp_file"
        # Restore from backup on error
        mv "$backup_file" "$config_file"
        print_error "Failed to update $config_name"
        return 1
    fi
}

# Function to update TOML config for Codex
update_toml_config() {
    local config_file="$1"
    local config_name="$2"
    
    # Check permissions
    if ! check_permissions "$config_file"; then
        return 1
    fi
    
    # If file doesn't exist, create it
    if [[ ! -f "$config_file" ]]; then
        if [[ "$DRY_RUN" == true ]]; then
            print_info "[DRY RUN] Would create $config_file"
            return 0
        fi
        touch "$config_file"
    fi
    
    # Check if gas server already exists in TOML
    if grep -q "^\[mcp_servers\.gas\]" "$config_file" 2>/dev/null; then
        if [[ "$FORCE_UPDATE" == false ]]; then
            print_skip "$config_name already configured"
            return 0
        else
            print_info "Force updating $config_name"
            # Remove existing gas configuration
            sed -i.bak '/^\[mcp_servers\.gas\]/,/^\[/{ /^\[mcp_servers\.gas\]/d; /^\[/!d; }' "$config_file"
        fi
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would update $config_name"
        return 0
    fi
    
    # Create backup
    local backup_file="${config_file}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$config_file" "$backup_file" || return 1
    print_info "Backed up to: $(basename "$backup_file")"
    
    # Append MCP server configuration in TOML format
    cat >> "$config_file" <<EOF

[mcp_servers.gas]
command = "node"
args = ["$MCP_INDEX_PATH", "--config", "$MCP_CONFIG_PATH"]

[[mcp_servers.gas.env]]
NODE_ENV = "production"
EOF
    
    print_status "$config_name configured"
}

# Function to get IDE display name
get_ide_name() {
    case "$1" in
        "claude-desktop") echo "Claude Desktop" ;;
        "claude-code") echo "Claude Code" ;;
        "cursor") echo "Cursor" ;;
        "vscode") echo "VS Code" ;;
        "vscode-insiders") echo "VS Code Insiders" ;;
        "vscodium") echo "VSCodium" ;;
        "zed") echo "Zed" ;;
        "windsurf") echo "Windsurf" ;;
        "neovim") echo "Neovim MCPHub" ;;
        "codex") echo "Codex CLI" ;;
        *) echo "$1" ;;
    esac
}

# Array to track which IDEs to configure
declare -a IDES_TO_CONFIGURE=()

# Interactive mode - let user select IDEs
if [[ "$INTERACTIVE" == true ]] && [[ "$AUTO" == false ]]; then
    echo ""
    echo "🎯 Select IDEs to configure:"
    echo "----------------------------"
    
    declare -a AVAILABLE_IDES=()
    i=1
    for ide in claude-desktop claude-code cursor vscode vscode-insiders vscodium zed windsurf neovim codex; do
        if check_ide_installed "$ide"; then
            AVAILABLE_IDES+=("$ide")
            echo "  [$i] $(get_ide_name "$ide")"
            ((i++))
        fi
    done
    
    if [[ ${#AVAILABLE_IDES[@]} -eq 0 ]]; then
        print_warning "No supported IDEs found"
        exit 0
    fi
    
    echo "  [a] All detected"
    echo "  [q] Quit"
    echo ""
    read -p "Enter your choices (e.g., 1,3,5 or a): " choices
    
    if [[ "$choices" == "q" ]]; then
        exit 0
    elif [[ "$choices" == "a" ]]; then
        IDES_TO_CONFIGURE=("${AVAILABLE_IDES[@]}")
    else
        IFS=',' read -ra SELECTIONS <<< "$choices"
        for sel in "${SELECTIONS[@]}"; do
            sel=$(echo "$sel" | tr -d ' ')
            if [[ "$sel" =~ ^[0-9]+$ ]] && [[ $sel -ge 1 ]] && [[ $sel -le ${#AVAILABLE_IDES[@]} ]]; then
                IDES_TO_CONFIGURE+=("${AVAILABLE_IDES[$((sel-1))]}")
            fi
        done
    fi
else
    # Auto mode - configure all detected IDEs
    for ide in claude-desktop claude-code cursor vscode vscode-insiders vscodium zed windsurf neovim codex; do
        if check_ide_installed "$ide"; then
            IDES_TO_CONFIGURE+=("$ide")
        fi
    done
fi

# Update MCP client configurations
echo ""
echo "🔧 Configuring MCP clients..."
echo "-----------------------------"

configured_count=0
skipped_count=0
failed_count=0

for ide in "${IDES_TO_CONFIGURE[@]}"; do
    config_path=$(get_config_path "$ide")
    ide_name="$(get_ide_name "$ide")"
    
    echo "Processing $ide_name..."
    
    if [[ "$ide" == "codex" ]]; then
        # Special handling for Codex TOML
        if update_toml_config "$config_path" "$ide_name"; then
            ((configured_count++))
        else
            ((failed_count++))
        fi
    elif [[ "$ide" == "zed" ]]; then
        # Zed uses context_servers instead of mcpServers
        if update_json_safely "$config_path" "$ide_name" "context_servers"; then
            ((configured_count++))
        else
            ((failed_count++))
        fi
    else
        # Standard JSON format
        if update_json_safely "$config_path" "$ide_name"; then
            ((configured_count++))
        else
            ((failed_count++))
        fi
    fi
done

# Also check for IDEs not in the configure list (to report as skipped)
for ide in claude-desktop claude-code cursor vscode vscode-insiders vscodium zed windsurf neovim codex; do
    if ! [[ " ${IDES_TO_CONFIGURE[@]} " =~ " ${ide} " ]]; then
        if ! check_ide_installed "$ide"; then
            ((skipped_count++))
        fi
    fi
done

# Summary
echo ""
echo "================================"
if [[ "$DRY_RUN" == true ]]; then
    echo "✅ Dry Run Complete!"
else
    echo "✅ Installation Complete!"
fi
echo "================================"
echo ""

if [[ "$configured_count" -gt 0 ]]; then
    print_status "Configured: $configured_count IDE(s)"
fi
if [[ "$skipped_count" -gt 0 ]]; then
    print_info "Not installed: $skipped_count IDE(s)"
fi
if [[ "$failed_count" -gt 0 ]]; then
    print_warning "Failed: $failed_count IDE(s)"
fi

echo ""
echo "📍 Project location: $PROJECT_ROOT"
echo "📄 Server path: $MCP_INDEX_PATH"
echo ""

if [[ ! -f "$OAUTH_CONFIG_PATH" ]]; then
    echo "⚠️  Remember to add oauth-config.json before using the server"
    echo ""
fi

if [[ "$DRY_RUN" == false ]] && [[ "$configured_count" -gt 0 ]]; then
    echo "To use the MCP GAS server:"
    echo "1. Restart your configured IDE(s)"
    echo "2. The 'gas' server will be available in your MCP tools"
    echo ""
fi

echo "For manual configuration, add this to your MCP client's config:"
echo ""
echo '  "gas": {'
echo '    "command": "node",'
echo "    \"args\": [\"$MCP_INDEX_PATH\", \"--config\", \"$MCP_CONFIG_PATH\"],"
echo '    "env": {"NODE_ENV": "production"}'
echo '  }'
echo ""