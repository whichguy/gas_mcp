#!/bin/bash

# MCP GAS Server Uninstallation Script
# Enhanced version with multi-IDE support
# Cleanly removes gas server from all supported MCP clients

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
CLEANUP_BUILD=false
CLEANUP_BACKUPS=false
FORCE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --cleanup-build)
            CLEANUP_BUILD=true
            shift
            ;;
        --cleanup-backups)
            CLEANUP_BACKUPS=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --dry-run          Show what would be removed without making changes"
            echo "  --cleanup-build    Also remove build artifacts (dist/, node_modules/)"
            echo "  --cleanup-backups  Also remove all backup files created by install/uninstall"
            echo "  --force            Skip confirmation prompts"
            echo "  --help             Show this help message"
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
echo "🗑️  MCP GAS Server Uninstallation"
if [[ "$DRY_RUN" == true ]]; then
    echo "   [DRY RUN MODE - No changes will be made]"
fi
echo "=================================="
echo ""

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

# Function to remove from JSON config using jq
remove_from_json_config() {
    local config_file="$1"
    local config_name="$2"
    local config_key="${3:-mcpServers}"  # Default to mcpServers, but allow override for Zed
    
    if [[ "$DRY_RUN" == true ]]; then
        if jq -e ".${config_key}.gas" "$config_file" > /dev/null 2>&1; then
            print_info "[DRY RUN] Would remove gas server from $config_name"
        else
            print_skip "[DRY RUN] No gas server found in $config_name"
        fi
        return 0
    fi
    
    # Create backup
    local backup_file="${config_file}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$config_file" "$backup_file" || return 1
    print_info "Backed up to: $(basename "$backup_file")"
    
    # Try to use jq if available
    if command -v jq &> /dev/null; then
        # Check if gas exists in the config
        if jq -e ".${config_key}.gas" "$config_file" > /dev/null 2>&1; then
            # Remove gas entry
            local tmp_file="${config_file}.tmp.$$"
            if jq "del(.${config_key}.gas)" "$config_file" > "$tmp_file"; then
                # Clean up empty structures
                if jq ".${config_key} | length" "$tmp_file" 2>/dev/null | grep -q "^0$"; then
                    # Remove empty mcpServers/context_servers object
                    jq "del(.${config_key})" "$tmp_file" > "${tmp_file}.2" && mv "${tmp_file}.2" "$tmp_file"
                fi
                
                mv "$tmp_file" "$config_file"
                print_status "Removed from $config_name"
                
                # Check if file is now empty or just {}
                if [[ $(jq -r 'length' "$config_file" 2>/dev/null) == "0" ]]; then
                    if [[ "$FORCE" == false ]]; then
                        read -p "Config file is now empty. Delete it? (y/n) " -n 1 -r
                        echo
                        if [[ $REPLY =~ ^[Yy]$ ]]; then
                            rm "$config_file"
                            print_info "Deleted empty config file"
                        fi
                    fi
                fi
                return 0
            else
                rm -f "$tmp_file"
                mv "$backup_file" "$config_file"  # Restore on error
                print_error "Failed to update $config_name"
                return 1
            fi
        else
            print_skip "No gas server found in $config_name"
            rm "$backup_file"  # Remove unnecessary backup
            return 0
        fi
    else
        print_warning "jq not found, attempting manual removal"
        # Fallback: Try to remove gas configuration manually
        if sed -i.tmp '/"gas":/,/^[[:space:]]*}/d' "$config_file" 2>/dev/null; then
            rm -f "${config_file}.tmp"
            print_status "Removed from $config_name (manual method)"
        else
            print_warning "Could not automatically remove from $config_name"
            echo "  Please manually remove the 'gas' entry from: $config_file"
        fi
    fi
}

# Function to remove from TOML config for Codex
remove_from_toml_config() {
    local config_file="$1"
    local config_name="$2"
    
    if [[ "$DRY_RUN" == true ]]; then
        if grep -q "^\[mcp_servers\.gas\]" "$config_file" 2>/dev/null; then
            print_info "[DRY RUN] Would remove gas server from $config_name"
        else
            print_skip "[DRY RUN] No gas server found in $config_name"
        fi
        return 0
    fi
    
    # Check if gas server exists in TOML
    if ! grep -q "^\[mcp_servers\.gas\]" "$config_file" 2>/dev/null; then
        print_skip "No gas server found in $config_name"
        return 0
    fi
    
    # Create backup
    local backup_file="${config_file}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$config_file" "$backup_file" || return 1
    print_info "Backed up to: $(basename "$backup_file")"
    
    # Remove gas server section from TOML
    # This removes from [mcp_servers.gas] to the next section or end of file
    awk '
        /^\[mcp_servers\.gas\]/ { skip = 1; next }
        /^\[/ && skip { skip = 0 }
        !skip { print }
    ' "$config_file" > "${config_file}.tmp" && mv "${config_file}.tmp" "$config_file"
    
    print_status "Removed from $config_name"
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

# Remove from MCP client configurations
echo "🔧 Removing from MCP clients..."
echo "-------------------------------"

removed_count=0
skipped_count=0
failed_count=0

for ide in claude-desktop claude-code cursor vscode vscode-insiders vscodium zed windsurf neovim codex; do
    config_path=$(get_config_path "$ide")
    ide_name="$(get_ide_name "$ide")"
    
    if [[ -f "$config_path" ]]; then
        echo "Processing $ide_name..."
        
        if [[ "$ide" == "codex" ]]; then
            # Special handling for Codex TOML
            if remove_from_toml_config "$config_path" "$ide_name"; then
                ((removed_count++))
            else
                ((failed_count++))
            fi
        elif [[ "$ide" == "zed" ]]; then
            # Zed uses context_servers instead of mcpServers
            if remove_from_json_config "$config_path" "$ide_name" "context_servers"; then
                ((removed_count++))
            else
                ((failed_count++))
            fi
        else
            # Standard JSON format
            if remove_from_json_config "$config_path" "$ide_name"; then
                ((removed_count++))
            else
                ((failed_count++))
            fi
        fi
    else
        ((skipped_count++))
    fi
done

echo ""

# Optional: Clean up build artifacts
if [[ "$CLEANUP_BUILD" == true ]]; then
    echo "🧹 Cleaning build artifacts..."
    echo "------------------------------"
    
    # Find project root
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
    
    if PROJECT_ROOT="$(find_project_root)"; then
        if [[ "$DRY_RUN" == true ]]; then
            print_info "[DRY RUN] Would remove:"
            [[ -d "$PROJECT_ROOT/dist" ]] && echo "  - dist/"
            [[ -d "$PROJECT_ROOT/node_modules" ]] && echo "  - node_modules/"
            [[ -f "$PROJECT_ROOT/package-lock.json" ]] && echo "  - package-lock.json"
        else
            if [[ "$FORCE" == false ]]; then
                echo "This will remove:"
                [[ -d "$PROJECT_ROOT/dist" ]] && echo "  - dist/"
                [[ -d "$PROJECT_ROOT/node_modules" ]] && echo "  - node_modules/"
                [[ -f "$PROJECT_ROOT/package-lock.json" ]] && echo "  - package-lock.json"
                read -p "Continue? (y/n) " -n 1 -r
                echo
                if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                    print_info "Skipping build cleanup"
                else
                    [[ -d "$PROJECT_ROOT/dist" ]] && rm -rf "$PROJECT_ROOT/dist" && print_status "Removed dist/"
                    [[ -d "$PROJECT_ROOT/node_modules" ]] && rm -rf "$PROJECT_ROOT/node_modules" && print_status "Removed node_modules/"
                    [[ -f "$PROJECT_ROOT/package-lock.json" ]] && rm -f "$PROJECT_ROOT/package-lock.json" && print_status "Removed package-lock.json"
                fi
            else
                [[ -d "$PROJECT_ROOT/dist" ]] && rm -rf "$PROJECT_ROOT/dist" && print_status "Removed dist/"
                [[ -d "$PROJECT_ROOT/node_modules" ]] && rm -rf "$PROJECT_ROOT/node_modules" && print_status "Removed node_modules/"
                [[ -f "$PROJECT_ROOT/package-lock.json" ]] && rm -f "$PROJECT_ROOT/package-lock.json" && print_status "Removed package-lock.json"
            fi
        fi
    else
        print_warning "Not in project directory, skipping build cleanup"
    fi
    echo ""
fi

# Optional: Clean up backup files
if [[ "$CLEANUP_BACKUPS" == true ]]; then
    echo "🧹 Cleaning backup files..."
    echo "---------------------------"
    
    backup_count=0
    
    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would remove backup files:"
    else
        print_info "Removing backup files..."
    fi
    
    # Find and remove backup files in all config directories
    for ide in claude-desktop claude-code cursor vscode vscode-insiders vscodium zed windsurf neovim codex; do
        config_path=$(get_config_path "$ide")
        config_dir=$(dirname "$config_path")
        
        if [[ -d "$config_dir" ]]; then
            for backup in "$config_dir"/*.backup.*; do
                if [[ -f "$backup" ]]; then
                    if [[ "$DRY_RUN" == true ]]; then
                        echo "  - $(basename "$backup")"
                    else
                        rm "$backup"
                    fi
                    ((backup_count++))
                fi
            done
        fi
    done
    
    if [[ "$backup_count" -gt 0 ]]; then
        if [[ "$DRY_RUN" == false ]]; then
            print_status "Removed $backup_count backup file(s)"
        fi
    else
        print_info "No backup files found"
    fi
    echo ""
fi

# Summary
echo "================================"
if [[ "$DRY_RUN" == true ]]; then
    echo "✅ Dry Run Complete!"
else
    echo "✅ Uninstallation Complete!"
fi
echo "================================"
echo ""

if [[ "$removed_count" -gt 0 ]]; then
    print_status "Removed from: $removed_count IDE(s)"
fi
if [[ "$skipped_count" -gt 0 ]]; then
    print_info "Not found: $skipped_count IDE(s)"
fi
if [[ "$failed_count" -gt 0 ]]; then
    print_warning "Failed: $failed_count IDE(s)"
fi

if [[ "$DRY_RUN" == false ]]; then
    echo ""
    echo "The MCP GAS server has been removed from client configurations."
    echo "Configuration files (gas-config.json, oauth-config.json) have been preserved."
    echo ""
    
    if [[ "$removed_count" -gt 0 ]]; then
        echo "You may need to restart your IDE(s) for changes to take effect."
    fi
    
    # List remaining backup files if not cleaned up
    if [[ "$CLEANUP_BACKUPS" == false ]]; then
        echo ""
        echo "Backup files have been created and can be restored if needed."
        echo "To remove all backup files, run: $0 --cleanup-backups"
    fi
fi