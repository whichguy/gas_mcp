# MCP Google Apps Script Examples

This directory contains practical examples of using the MCP (Model Context Protocol) Google Apps Script tools.

## **Directory Structure**

```
examples/
├── README.md                    # This file
├── basic-usage/                 # Simple usage examples
│   ├── README.md               # Basic usage documentation
│   ├── create-project.md       # Creating new projects
│   ├── deploy-functions.md     # Deploying functions
│   └── execute-functions.md    # Executing functions
│
├── advanced-patterns/          # Advanced usage patterns
│   ├── README.md               # Advanced patterns documentation
│   ├── authentication.md      # OAuth and authentication
│   ├── error-handling.md      # Error handling strategies
│   └── project-management.md  # Managing multiple projects
│
└── integration-examples/       # Real integration examples
    ├── README.md               # Integration examples documentation
    ├── sheets-integration.md   # Google Sheets integration
    ├── drive-integration.md    # Google Drive integration
    └── workflow-automation.md  # Automation workflows
```

## **Quick Start Examples**

### **1. Create a New Project**
```bash
# Authenticate first
gas_auth --mode="start"

# Create new project
gas_project_create --title="My New Project"

# Result: Returns scriptId for further operations
```

### **2. Add Source Code**
```bash
# Write a function to the project
gas_write --path="[scriptId]/myFunction.js" --content="
function myFunction() {
  return 'Hello World!';
}
"

# List project files
gas_ls --path="[scriptId]" --detailed=true

# List files with wildcard patterns (NEW!)
gas_ls --path="[scriptId]/utils/*" --detailed=true     # All files in utils/
gas_ls --path="[scriptId]/*Connector*" --detailed=true # All connector files
gas_ls --path="[scriptId]/test/*/*.test" --detailed=true # All test files

# Search file contents with patterns (ENHANCED!)
gas_grep --pattern="function\\s+(\\w+)" --path="[scriptId]/.*Controller.*" --path-mode=regex --search-mode=regex
gas_grep --pattern="require(" --path="[scriptId]/(utils|helpers)/.*" --path-mode=regex --search-mode=literal
gas_grep --pattern="TODO:|FIXME:" --path="[scriptId]/*" --path-mode=wildcard --exclude-files="*/test/*"
gas_grep --pattern="\\.(test|spec)$" --path="[scriptId]/.*\\.(test|spec)$" --path-mode=regex --context-lines=3
```

### **3. Deploy and Execute**
```bash
# Create deployment
gas_deploy_create --script-id="[scriptId]" --entry-point-type="WEB_APP"

# Execute function
gas_run --script-id="[scriptId]" --function-name="myFunction"
```

## **Common Workflows**

### **Development Workflow**
1. **Create Project** → `gas_project_create`
2. **Add Source Files** → `gas_write`
3. **Test Locally** → (write test functions)
4. **Deploy** → `gas_deploy_create`
5. **Execute & Test** → `gas_run`
6. **Iterate** → Repeat steps 2-5

### **Project Management Workflow**
1. **List Projects** → `gas_ls` (root level)
2. **Get Project Info** → `gas_info`
3. **List Deployments** → `gas_deploy_list`
4. **Manage Files** → `gas_mv`, `gas_cp`, `gas_rm`

### **Execution Workflow**
1. **Direct Execution** → `gas_run`
2. **API Execution** → `gas_run_api_exec`
3. **Web App Testing** → HTTP requests to deployment URLs

## **Tool Categories**

### **📁 Project Management**
- `gas_project_create` - Create new projects
- `gas_ls` - List projects and files with **wildcard support** (`*`, `?` patterns)
- `gas_info` - Get project information

### **📝 File Operations**
- `gas_write` - Create/update files
- `gas_cat` - Read file contents (clean user code, unwrapped)
- `gas_grep` - **Search file contents** with pattern matching (same clean content as `gas_cat`)
- `gas_raw_grep` - **Search file contents** including CommonJS wrappers (same full content as `gas_raw_cat`, API-only)
- `gas_mv` - Move/rename files
- `gas_cp` - Copy files
- `gas_rm` - Delete files
- `gas_mkdir` - Create logical directories

### **🚀 Deployment & Execution**
- `gas_deploy_create` - Create deployments
- `gas_deploy_list` - List deployments
- `gas_run` - Execute functions (web app)
- `gas_run_api_exec` - Execute via API
- `gas_version_create` - Create versions

### **🔐 Authentication**
- `gas_auth` - OAuth authentication
- Session management
- Token handling

### **🔗 Drive Integration**
- `gas_find_drive_script` - Find container scripts
- `gas_bind_script` - Bind existing scripts
- `gas_create_script` - Create container-bound scripts

## **Content Processing: gas_grep vs gas_raw_grep**

Understanding what content each search tool examines:

### **gas_grep** (Clean User Code)
- Searches the same content `gas_cat` shows
- Your actual functions without system wrappers
- Clean, readable code for development
```javascript
// What gas_grep searches:
function calculateTax(amount) {
  return amount * 0.08;
}
exports.calculateTax = calculateTax;
```

### **gas_raw_grep** (Complete File Content)  
- Searches the same content `gas_raw_cat` shows
- Includes CommonJS wrappers and system code
- Full file infrastructure for debugging
- **Always makes direct API calls** (never uses local files)
```javascript
// What gas_raw_grep searches:
function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  function calculateTax(amount) {
    return amount * 0.08;
  }
  exports.calculateTax = calculateTax;
}

__defineModule__(_main);
```

**Choose the right tool:**
- 🎯 Use `gas_grep` for normal development (finding your functions, require calls, etc.)
- 🔧 Use `gas_raw_grep` for debugging CommonJS module system issues

## **Best Practices**

1. **Always Authenticate First**: Run `gas_auth` before other operations
2. **Use Descriptive Names**: Clear project and function names
3. **Test Functions**: Include test functions in your projects
4. **Document Your Code**: Use JSDoc comments
5. **Version Control**: Keep source code in git repository
6. **Deployment Tracking**: Track deployment URLs and versions

## **Error Handling**

### **Common Issues & Solutions**
- **Authentication Errors** → Run `gas_auth --mode="start"`
- **Permission Errors** → Check OAuth scopes in appsscript.json
- **Deployment Errors** → Ensure project has no syntax errors
- **Execution Errors** → Check function names and parameters

### **Debugging Tips**
- Use `gas_info` to check project status
- Check `gas_deploy_list` for deployment issues
- Test functions incrementally
- Use console.log() for debugging output

## **Related Documentation**

- [Repository Structure](../REPOSITORY_STRUCTURE.md)
- [Gas Projects Documentation](../gas-projects/README.md)
- [API Reference](../docs/API_REFERENCE.md)
- [OAuth Architecture](../docs/OAUTH_SINGLETON_ARCHITECTURE.md) 