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
- `gas_ls` - List projects and files
- `gas_info` - Get project information

### **📝 File Operations**
- `gas_write` - Create/update files
- `gas_cat` - Read file contents
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