# GAS Project Init Tool

## Overview

The `gas_project_init` tool retrofits existing Google Apps Script projects with the CommonJS module system and execution infrastructure that are normally installed by `gas_project_create`. This tool is essential for projects that:

- Were not created using `gas_project_create`
- Are missing the CommonJS module system
- Fail with "__defineModule__ is not defined" errors
- Need the execution infrastructure for `gas_run` to work properly

## Features

The tool installs three essential infrastructure files:

1. **CommonJS.js** - The module system that enables `require()` and `module.exports`
2. **__mcp_gas_run.js** - Execution infrastructure for dynamic code execution via `gas_run`  
3. **appsscript.json** - Standard manifest configuration with V8 runtime

## Usage

### Basic Usage
```javascript
// Install all infrastructure
gas_project_init({
  scriptId: "your-project-script-id"
})
```

### Selective Installation
```javascript
// Install only CommonJS (skip execution infrastructure)
gas_project_init({
  scriptId: "your-project-script-id", 
  includeExecutionInfrastructure: false
})

// Install only execution infrastructure (skip CommonJS)
gas_project_init({
  scriptId: "your-project-script-id",
  includeCommonJS: false
})

// Skip manifest update
gas_project_init({
  scriptId: "your-project-script-id",
  updateManifest: false
})
```

### Force Overwrite
```javascript
// Overwrite existing files
gas_project_init({
  scriptId: "your-project-script-id",
  force: true
})
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `scriptId` | string | required | Google Apps Script project ID (44 characters) |
| `includeCommonJS` | boolean | true | Install/update CommonJS module system |
| `includeExecutionInfrastructure` | boolean | true | Install/update __mcp_gas_run execution infrastructure |
| `updateManifest` | boolean | true | Update appsscript.json with standard configuration |
| `force` | boolean | false | Force overwrite existing files |
| `accessToken` | string | optional | Access token for stateless operation |

## Return Value

```javascript
{
  status: "success" | "partial" | "failed",
  scriptId: "project-id",
  filesInstalled: ["CommonJS", "__mcp_gas_run", "appsscript"],
  filesSkipped: [],
  errors: [],
  message: "Detailed status message"
}
```

## When to Use

### Error Scenarios
- `__defineModule__ is not defined` errors when running code
- `require is not defined` errors in modules
- Missing execution infrastructure for `gas_run`

### Project Types
- Legacy projects created before `gas_project_create` existed
- Projects imported from other sources
- Manually created projects in the Google Apps Script editor
- Projects that need to be retrofitted with modern infrastructure

### Development Workflow
1. Identify project with missing infrastructure
2. Run `gas_project_init` with appropriate parameters
3. Test with `gas_run` to verify functionality
4. Begin using CommonJS modules with `require()` and `module.exports`

## Example Workflow

```javascript
// 1. Check if project needs initialization (will fail)
gas_run({
  scriptId: "178Dnpjyh65oo9_9jbLKRoPAw7Z7jqR1v9WzXhZJV1CjBXV3HE6pjHP9G",
  js_statement: "Math.PI * 2"
})
// Returns: __defineModule__ is not defined

// 2. Initialize the project
gas_project_init({
  scriptId: "178Dnpjyh65oo9_9jbLKRoPAw7Z7jqR1v9WzXhZJV1CjBXV3HE6pjHP9G"
})
// Returns: Project initialization success - installed 3 file(s)

// 3. Test execution (should now work)
gas_run({
  scriptId: "178Dnpjyh65oo9_9jbLKRoPAw7Z7jqR1v9WzXhZJV1CjBXV3HE6pjHP9G", 
  js_statement: "Math.PI * 2"
})
// Returns: { result: 6.283185307179586, success: true }

// 4. Create modules using CommonJS pattern
gas_write({
  scriptId: "178Dnpjyh65oo9_9jbLKRoPAw7Z7jqR1v9WzXhZJV1CjBXV3HE6pjHP9G",
  path: "Utils",
  content: `
function _main(module = globalThis.__getCurrentModule(), exports = module.exports, require = globalThis.require) {
  function formatNumber(num) {
    return num.toLocaleString();
  }
  
  return { formatNumber };
}

__defineModule__(_main);
  `
})

// 5. Use the module
gas_run({
  scriptId: "178Dnpjyh65oo9_9jbLKRoPAw7Z7jqR1v9WzXhZJV1CjBXV3HE6pjHP9G",
  js_statement: `require("Utils").formatNumber(1234567)`
})
// Returns: { result: "1,234,567", success: true }
```

## File Details

### CommonJS.js
- Provides `require()`, `module`, and `exports` functionality
- Enables lazy loading of modules
- Handles circular dependency detection
- Preserves directory structure in module names
- Must be positioned at execution order 0

### __mcp_gas_run.js  
- Enables dynamic JavaScript execution via HTTP endpoints
- Provides `doGet()` and `doPost()` handlers
- Supports both simple expressions and complex code
- Includes automatic logger output capture
- Security: Only works with HEAD deployments (/dev URLs)

### appsscript.json
- Sets V8 runtime for modern JavaScript support
- Configures timezone (America/New_York by default)
- Enables Stackdriver logging for better debugging
- Provides foundation for adding advanced Google services

## Error Handling

The tool provides comprehensive error handling:

- **Existing Files**: Skipped by default, use `force: true` to overwrite
- **API Errors**: Detailed error messages with context
- **Partial Success**: Some files installed, others failed
- **Authentication**: Uses session auth or provided access token
- **Validation**: Input validation for script ID format

## Best Practices

1. **Always test after initialization** with a simple `gas_run` command
2. **Use selective installation** if you only need specific components
3. **Force overwrite carefully** - it will replace existing customizations
4. **Check existing files first** with `gas_ls` to see what's already present
5. **Backup important projects** before running with `force: true`

## Troubleshooting

### Common Issues
- **Authentication errors**: Run `gas_auth` first
- **Script ID format**: Must be exactly 44 characters
- **Permission errors**: Ensure you have edit access to the project
- **Network errors**: Check internet connection and Google API status

### Verification Steps
```javascript
// Check project files after initialization
gas_ls({ scriptId: "your-project-id" })

// Test basic execution
gas_run({ 
  scriptId: "your-project-id", 
  js_statement: "2 + 2" 
})

// Test module system
gas_run({
  scriptId: "your-project-id",
  js_statement: "typeof globalThis.require"
})
// Should return: "function"
```

## Integration with Other Tools

The `gas_project_init` tool works seamlessly with:

- `gas_project_create` - Use init for existing projects, create for new ones
- `gas_run` - Execution will work after initialization  
- `gas_write` - CommonJS modules will work after initialization
- `gas_ls` - Check project structure before/after initialization
- `gas_deploy_create` - Deploy projects after initialization