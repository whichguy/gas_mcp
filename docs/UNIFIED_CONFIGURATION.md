# MCP Gas Server - Unified Configuration

The MCP Gas Server now uses a **single consolidated configuration file** instead of multiple separate configuration files. This simplifies management and reduces file sprawl.

## Configuration File Location

**Primary Configuration File:** `gas-config.json` (in the root directory where the Node server starts)

## Migration from Legacy Configuration

The server automatically migrates from the legacy configuration files:

### Legacy Files (DEPRECATED)
- ❌ `oauth-config.json` - OAuth settings
- ❌ `.gas-projects.json` - Project configurations  
- ❌ `.gas-current.json` - Current active project
- ❌ `.gas-local-root.json` - Local root directory

### New Unified Configuration
- ✅ `gas-config.json` - **All settings consolidated**

## Configuration Schema

```json
{
  "oauth": {
    "client_id": "YOUR_GOOGLE_OAUTH_CLIENT_ID",
    "type": "uwp",
    "redirect_uris": ["http://127.0.0.1/*", "http://localhost/*"],
    "scopes": ["https://www.googleapis.com/auth/script.projects", "..."]
  },
  "projects": {
    "project-name": {
      "scriptId": "GOOGLE_APPS_SCRIPT_PROJECT_ID",
      "name": "project-name", 
      "description": "Optional description"
    }
  },
  "environments": {
    "dev": { "scriptId": "DEV_PROJECT_ID", "name": "dev-project" },
    "staging": { "scriptId": "STAGING_PROJECT_ID", "name": "staging-project" },
    "production": { "scriptId": "PROD_PROJECT_ID", "name": "prod-project" }
  },
  "currentProject": {
    "projectName": "project-name",
    "scriptId": "CURRENT_ACTIVE_PROJECT_ID",
    "lastSync": "2025-06-29T15:31:08.555Z"
  },
  "localRoot": {
    "rootPath": "/path/to/local/gas-projects",
    "lastUpdated": "2025-06-29T14:19:29.414Z"
  },
  "server": {
    "defaultWorkingDir": "/path/to/server/root",
    "configVersion": "1.0.0",
    "lastModified": "2025-06-29T16:00:00.000Z"
  }
}
```

## Automatic Migration

When you start the server, it will automatically:

1. **Check for existing unified config** - Use if `gas-config.json` exists
2. **Migrate legacy configs** - Automatically consolidate legacy files if unified config doesn't exist
3. **Create default config** - Initialize with defaults if no configuration exists
4. **Preserve legacy files** - Original files are left intact after migration

## Configuration Sections

### 🔐 OAuth Configuration
- **client_id**: Google OAuth 2.0 client ID
- **type**: OAuth client type (`uwp` recommended for PKCE-only)
- **redirect_uris**: Allowed redirect URIs for OAuth callback
- **scopes**: Required Google API permissions

### 🗂️ Project Management
- **projects**: Named project configurations with script IDs
- **environments**: Environment shortcuts (dev, staging, production)
- **currentProject**: Currently active project context

### 📁 Local File System
- **localRoot**: Directory where all project folders are stored
- **defaultWorkingDir**: Server working directory

### ⚙️ Server Metadata
- **configVersion**: Configuration schema version
- **lastModified**: Last configuration update timestamp

## Benefits of Unified Configuration

### ✅ Advantages
- **Single Source of Truth**: All settings in one file
- **Easier Management**: No need to track multiple config files
- **Better Portability**: Copy one file to migrate entire configuration
- **Atomic Updates**: All settings updated together consistently
- **Built-in Migration**: Seamless transition from legacy setup

### 🔄 Backward Compatibility
- **Automatic Detection**: Server detects and migrates legacy files
- **Non-Destructive**: Original files preserved during migration
- **Gradual Transition**: Tools work with both legacy and unified configs during transition

## Working with the Unified Configuration

### Viewing Current Configuration
```bash
# Check configuration via MCP API
gas_local_get_root  # Shows local root path
gas_project_list    # Shows all configured projects
```

## Special Files in Google Apps Script Projects

### 📋 `appsscript.json` - Project Manifest File

**CRITICAL:** The `appsscript.json` file is a **special manifest file** with specific requirements:

#### **Requirements:**
- ✅ **Must be included** in every Google Apps Script project if it exists
- ✅ **Must reside in the root folder** of the project (cannot be in subfolders)
- ✅ **Automatically managed** by the MCP Gas Server during sync operations
- ✅ **Contains project metadata** including time zone, dependencies, and permissions

#### **File Structure:**
```json
{
  "timeZone": "America/New_York",
  "dependencies": {
    "enabledAdvancedServices": []
  },
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
```

#### **MCP Gas Server Handling:**
- **`gas_ls`:** Always shows `appsscript.json` in project file listings
- **`gas_pull`:** Automatically downloads `appsscript.json` to project root
- **`gas_push`:** Automatically uploads `appsscript.json` from project root
- **`gas_write`:** Cannot create `appsscript.json` in subfolders (enforced at root level)

#### **Best Practices:**
- **Do not manually edit** unless you understand Google Apps Script project structure
- **Keep in project root** - never move to subfolders
- **Include in version control** to track project configuration changes
- **Backup before major changes** as it controls project runtime behavior

### Modifying Configuration
```bash
# Set local root directory
gas_local_set_root /path/to/projects

# Add new project
gas_project_create --title "My New Project" --localName "my-project"

# Set current project
gas_project_set my-project
```

### Manual Configuration Editing
You can directly edit `gas-config.json`, but ensure:
- **Valid JSON format**
- **Required fields present** (oauth, projects, localRoot, server)
- **Server restart** after manual edits (for config cache refresh)

## Configuration File Management

### Backup and Restore
```bash
# Backup configuration
cp gas-config.json mcp-gas-config-backup.json

# Restore configuration
cp mcp-gas-config-backup.json gas-config.json
```

### Reset to Defaults
```bash
# Delete unified config to trigger default initialization
rm gas-config.json
# Restart server to recreate with defaults
```

### Sharing Configuration
```bash
# Share configuration between team members
cp gas-config.json team-shared-config.json
# Edit team-shared-config.json to remove personal settings
# Team members copy and customize as needed
```

## Troubleshooting

### Configuration Issues
- **Server won't start**: Check JSON syntax in `gas-config.json`
- **Projects not found**: Verify `projects` section has correct script IDs
- **OAuth errors**: Check `oauth.client_id` matches Google Cloud Console
- **File path errors**: Ensure `localRoot.rootPath` exists and is writable

### Migration Issues
- **Legacy files not migrated**: Check file permissions and JSON validity
- **Conflicting configs**: Delete legacy files after confirming migration worked
- **Lost projects**: Check both legacy and unified configs for missing entries

### Configuration Validation
The server validates configuration on startup and reports:
- ✅ **Valid sections**: OAuth, projects, localRoot properly configured
- ⚠️ **Missing sections**: Sections using defaults (warnings, not errors)
- ❌ **Invalid sections**: JSON errors, missing required fields (startup failure)

## Support and Feedback

For issues with the unified configuration system:
1. Check server startup logs for specific error messages
2. Verify JSON syntax using a JSON validator
3. Compare your config against the schema above
4. File an issue if automatic migration fails 