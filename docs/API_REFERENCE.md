# MCP Gas Server - Complete API Reference

## 🎯 Overview

This comprehensive API reference documents all 11 MCP Gas tools with detailed schemas, examples, and error handling patterns. Designed to optimize AI-assisted development with Claude in Cursor IDE.

## 📋 Table of Contents

1. [Authentication Tools](#authentication-tools)
2. [Filesystem Tools](#filesystem-tools)
3. [Project Management Tools](#project-management-tools)
4. [Execution Tools](#execution-tools)
5. [Deployment Tools](#deployment-tools)
6. [Drive Container Tools](#drive-container-tools)
7. [Error Handling](#error-handling)
8. [Usage Patterns](#usage-patterns)

---

## 🔐 Authentication Tools

### `gas_auth` - OAuth 2.0 Authentication

Complete OAuth authentication management for Google Apps Script access.

#### Input Schema
```typescript
interface GasAuthInput {
  mode: 'start' | 'callback' | 'status' | 'logout';
  code?: string;
  openBrowser?: boolean;
  waitForCompletion?: boolean;
  accessToken?: string;
}
```

#### Usage Examples

**Start Authentication Flow**
```typescript
const authResult = await callTool('gas_auth', {
  mode: 'start',
  openBrowser: true
});

// Response:
{
  "authUrl": "https://accounts.google.com/o/oauth2/auth?...",
  "callbackUrl": "http://localhost:3000/oauth/callback",
  "sessionId": "abc123-def456-...",
  "status": "started",
  "instructions": [
    "🚀 OAuth authentication started automatically!",
    "📱 Complete authentication in the browser window",
    "✅ Once authenticated, tools will work automatically"
  ]
}
```

**Check Authentication Status**
```typescript
const status = await callTool('gas_auth', {
  mode: 'status'
});

// Response when authenticated:
{
  "authenticated": true,
  "user": {
    "email": "user@example.com",
    "name": "User Name"
  },
  "sessionId": "abc123-def456-...",
  "tokenExpiry": "2024-01-15T14:30:00Z"
}

// Response when not authenticated:
{
  "authenticated": false,
  "sessionId": "abc123-def456-...",
  "requiresAuth": true,
  "authUrl": "https://accounts.google.com/o/oauth2/auth?..."
}
```

**Manual Logout**
```typescript
const logoutResult = await callTool('gas_auth', {
  mode: 'logout'
});

// Response:
{
  "success": true,
  "message": "Successfully logged out",
  "sessionCleared": true
}
```

#### Error Responses

**OAuth Error**
```json
{
  "error": {
    "type": "OAuthError",
    "message": "OAuth callback error: access_denied",
    "code": "access_denied",
    "data": {
      "error": "access_denied",
      "error_description": "User denied access"
    }
  }
}
```

---

## 📁 Filesystem Tools

### `gas_ls` - List Projects and Files

List Google Apps Script projects and files with optional filtering and detailed information.

**Important Note**: Google Apps Script has no real folders or directories. What appears as `"models/User.gs"` is simply a filename with a forward slash prefix for logical organization. The `/` is just part of the filename.

#### Input Schema
```typescript
interface GasLsInput {
  path?: string;
  detailed?: boolean;
  recursive?: boolean;
  accessToken?: string;
}
```

#### Usage Examples

**List All Projects**
```typescript
const projects = await callTool('gas_ls', {
  path: '',
  detailed: true
});

// Response:
{
  "projects": [
    {
      "scriptId": "abc123...",
      "title": "My Script Project",
      "createTime": "2024-01-01T12:00:00Z",
      "updateTime": "2024-01-15T14:30:00Z",
      "parentId": "folder123...",
      "functionSet": {
        "values": [
          { "name": "myFunction" },
          { "name": "anotherFunction" }
        ]
      }
    }
  ],
  "totalProjects": 1
}
```

**List Files in Project with Logical Organization**
```typescript
const files = await callTool('gas_ls', {
  path: 'abc123def456...',
  detailed: true,
  recursive: true
});

// Response shows files grouped by filename prefixes (not real folders):
{
  "type": "files",
  "projectId": "abc123def456...",
  "items": [
    {
      "name": "Code.gs",                    // Root level file
      "type": "SERVER_JS",
      "size": 1024
    },
    {
      "name": "models/User.gs",             // Filename with "models/" prefix
      "type": "SERVER_JS", 
      "size": 2048
    },
    {
      "name": "utils/helpers.gs",           // Filename with "utils/" prefix
      "type": "SERVER_JS",
      "size": 512
    }
  ],
  "totalFiles": 3
}
```

### `gas_cat` - Read File Contents

Read the contents of a specific file in a Google Apps Script project.

#### Input Schema
```typescript
interface GasCatInput {
  path: string;  // Format: "projectId/filename.gs"
  accessToken?: string;
}
```

#### Usage Examples

**Read JavaScript File**
```typescript
const fileContent = await callTool('gas_cat', {
  path: 'abc123def456.../Code.gs'
});

// Response:
{
  "content": "function myFunction() {\n  Logger.log('Hello World!');\n  return new Date().toISOString();\n}",
  "fileName": "Code.gs",
  "fileType": "JAVASCRIPT",
  "lastModified": "2024-01-15T14:30:00Z",
  "size": 123
}
```

**Read Manifest File**
```typescript
const manifest = await callTool('gas_cat', {
  path: 'abc123def456.../appsscript.json'
});

// Response:
{
  "content": "{\n  \"timeZone\": \"America/Los_Angeles\",\n  \"dependencies\": {},\n  \"exceptionLogging\": \"STACKDRIVER\",\n  \"runtimeVersion\": \"V8\"\n}",
  "fileName": "appsscript.json",
  "fileType": "JSON",
  "parsed": {
    "timeZone": "America/Los_Angeles",
    "dependencies": {},
    "exceptionLogging": "STACKDRIVER",
    "runtimeVersion": "V8"
  }
}
```

### `gas_write` - Create/Update Files

Create new files or update existing files in Google Apps Script projects.

#### Input Schema
```typescript
interface GasWriteInput {
  path: string;     // Format: "projectId/filename"
  content: string;
  position?: number;
  accessToken?: string;
}
```

#### Usage Examples

**Create New JavaScript File**
```typescript
const writeResult = await callTool('gas_write', {
  path: 'abc123def456.../MyNewFile',
  content: `
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

function testFibonacci() {
  Logger.log('fib(10) = ' + fibonacci(10));
}`,
  position: 0
});

// Response:
{
  "success": true,
  "fileName": "MyNewFile.gs",  // .gs automatically appended
  "fileType": "JAVASCRIPT",
  "bytesWritten": 187,
  "position": 0,
  "message": "File created successfully"
}
```

**Update Existing File**
```typescript
const updateResult = await callTool('gas_write', {
  path: 'abc123def456.../Code.gs',
  content: `
function myFunction() {
  Logger.log('Updated function!');
  return {
    timestamp: new Date().toISOString(),
    timezone: Session.getScriptTimeZone()
  };
}`
});

// Response:
{
  "success": true,
  "fileName": "Code.gs",
  "fileType": "JAVASCRIPT",
  "bytesWritten": 156,
  "message": "File updated successfully",
  "previousVersion": "backup-timestamp"
}
```

### `gas_rm` - Delete Files

Delete files from Google Apps Script projects with safety confirmations.

#### Input Schema
```typescript
interface GasRmInput {
  path: string;  // Format: "projectId/filename.gs"
  accessToken?: string;
}
```

#### Usage Examples

**Delete File**
```typescript
const deleteResult = await callTool('gas_rm', {
  path: 'abc123def456.../OldFile.gs'
});

// Response:
{
  "success": true,
  "fileName": "OldFile.gs",
  "message": "File deleted successfully",
  "deletedAt": "2024-01-15T14:30:00Z"
}
```

### `gas_mv` - Move/Rename Files

Move or rename files within Google Apps Script projects.

#### Input Schema
```typescript
interface GasMvInput {
  from: string;  // Format: "projectId/oldname.gs"
  to: string;    // Format: "projectId/newname"
  accessToken?: string;
}
```

#### Usage Examples

**Rename File**
```typescript
const moveResult = await callTool('gas_mv', {
  from: 'abc123def456.../OldName.gs',
  to: 'abc123def456.../NewName'
});

// Response:
{
  "success": true,
  "oldName": "OldName.gs",
  "newName": "NewName.gs",
  "message": "File renamed successfully"
}
```

### `gas_cp` - Copy Files

Copy files between Google Apps Script projects.

#### Input Schema
```typescript
interface GasCpInput {
  from: string;  // Format: "sourceProjectId/filename.gs"
  to: string;    // Format: "targetProjectId/filename"
  accessToken?: string;
}
```

#### Usage Examples

**Copy File Between Projects**
```typescript
const copyResult = await callTool('gas_cp', {
  from: 'sourceProject123.../Utils.gs',
  to: 'targetProject456.../SharedUtils'
});

// Response:
{
  "success": true,
  "sourceFile": "Utils.gs",
  "targetFile": "SharedUtils.gs",
  "bytescopied": 1024,
  "message": "File copied successfully"
}
```

---

## 🛠️ Project Management Tools

### `gas_mkdir` - Create Projects

Create new Google Apps Script projects with optional configuration.

#### Input Schema
```typescript
interface GasMkdirInput {
  title: string;
  parentId?: string;
  accessToken?: string;
}
```

#### Usage Examples

**Create New Project**
```typescript
const newProject = await callTool('gas_mkdir', {
  title: 'My Automation Project',
  parentId: 'folderAbc123...'  // Optional Drive folder
});

// Response:
{
  "scriptId": "newProject123456...",
  "title": "My Automation Project",
  "createTime": "2024-01-15T14:30:00Z",
  "parentId": "folderAbc123...",
  "webAppUrl": null,
  "defaultFiles": [
    {
      "name": "Code.gs",
      "type": "JAVASCRIPT",
      "content": "function myFunction() {\n  \n}"
    },
    {
      "name": "appsscript.json",
      "type": "JSON",
      "content": "{\n  \"timeZone\": \"America/Los_Angeles\",\n  \"dependencies\": {},\n  \"exceptionLogging\": \"STACKDRIVER\"\n}"
    }
  ]
}
```

### `gas_info` - Project Information

Get detailed information about Google Apps Script projects.

#### Input Schema
```typescript
interface GasInfoInput {
  projectId: string;
  includeContent?: boolean;
  accessToken?: string;
}
```

#### Usage Examples

**Get Project Info**
```typescript
const projectInfo = await callTool('gas_info', {
  projectId: 'abc123def456...',
  includeContent: false
});

// Response:
{
  "scriptId": "abc123def456...",
  "title": "My Script Project",
  "createTime": "2024-01-01T12:00:00Z",
  "updateTime": "2024-01-15T14:30:00Z",
  "parentId": "folderAbc123...",
  "deployments": [
    {
      "deploymentId": "deployment123...",
      "entryPoints": [
        {
          "entryPointType": "WEB_APP",
          "webApp": {
            "url": "https://script.google.com/macros/s/deployment123.../exec",
            "executeAs": "USER_DEPLOYING",
            "access": "ANYONE"
          }
        }
      ]
    }
  ],
  "files": [
    {
      "name": "Code.gs",
      "type": "JAVASCRIPT",
      "createTime": "2024-01-01T12:00:00Z",
      "updateTime": "2024-01-15T14:30:00Z"
    }
  ],
  "functionSet": {
    "values": [
      { "name": "myFunction" },
      { "name": "doGet" },
      { "name": "fibonacci" }
    ]
  }
}
```

### `gas_reorder` - Reorder Files

Change the execution order of files within a Google Apps Script project.

#### Input Schema
```typescript
interface GasReorderInput {
  projectId: string;
  fileName: string;
  newPosition: number;
  accessToken?: string;
}
```

#### Usage Examples

**Reorder File Position**
```typescript
const reorderResult = await callTool('gas_reorder', {
  projectId: 'abc123def456...',
  fileName: 'Utils.gs',
  newPosition: 0  // Move to first position
});

// Response:
{
  "success": true,
  "fileName": "Utils.gs",
  "oldPosition": 2,
  "newPosition": 0,
  "fileOrder": [
    "Utils.gs",
    "Code.gs",
    "appsscript.json"
  ]
}
```

---

## ⚡ Execution Tools

### `gas_run` - Direct Code Execution

Execute any JavaScript/Apps Script statement directly without requiring deployment or wrapper functions.

#### Input Schema
```typescript
interface GasRunInput {
  scriptId: string;
  functionName: string;  // Any JavaScript statement or function call
  parameters?: any[];
  accessToken?: string;
}
```

#### Usage Examples

**Execute Built-in Functions**
```typescript
const timezoneResult = await callTool('gas_run', {
  scriptId: 'abc123def456...',
  functionName: 'Session.getScriptTimeZone()'
});

// Response:
{
  "function_called": "Session.getScriptTimeZone()",
  "result": "America/Los_Angeles",
  "execution_time": 245,
  "timestamp": "2024-01-15T14:30:00Z"
}
```

**Execute Mathematical Expressions**
```typescript
const mathResult = await callTool('gas_run', {
  scriptId: 'abc123def456...',
  functionName: 'Math.PI * 2'
});

// Response:
{
  "function_called": "Math.PI * 2",
  "result": 6.283185307179586,
  "execution_time": 12,
  "timestamp": "2024-01-15T14:30:00Z"
}
```

**Execute User Functions**
```typescript
const fibResult = await callTool('gas_run', {
  scriptId: 'abc123def456...',
  functionName: 'fibonacci(10)'
});

// Response:
{
  "function_called": "fibonacci(10)",
  "result": 55,
  "execution_time": 156,
  "timestamp": "2024-01-15T14:30:00Z"
}
```

**Execute Complex Expressions**
```typescript
const complexResult = await callTool('gas_run', {
  scriptId: 'abc123def456...',
  functionName: '[1,2,3,4,5].reduce((sum, num) => sum + num, 0)'
});

// Response:
{
  "function_called": "[1,2,3,4,5].reduce((sum, num) => sum + num, 0)",
  "result": 15,
  "execution_time": 89,
  "timestamp": "2024-01-15T14:30:00Z"
}
```

**Execute with Return Object**
```typescript
const objectResult = await callTool('gas_run', {
  scriptId: 'abc123def456...',
  functionName: 'JSON.stringify({time: new Date().getTime(), timezone: Session.getScriptTimeZone()})'
});

// Response:
{
  "function_called": "JSON.stringify({time: new Date().getTime(), timezone: Session.getScriptTimeZone()})",
  "result": "{\"time\":1705322400000,\"timezone\":\"America/Los_Angeles\"}",
  "execution_time": 178,
  "timestamp": "2024-01-15T14:30:00Z"
}
```

### `gas_run_api_exec` - API-Based Execution

Execute functions in deployed Google Apps Script projects via the Apps Script API.

#### Input Schema
```typescript
interface GasRunApiExecInput {
  scriptId: string;      // Must be deployed as API executable
  functionName: string;  // Function name (not expression)
  parameters?: any[];
  devMode?: boolean;
  accessToken?: string;
}
```

#### Usage Examples

**Execute Deployed Function**
```typescript
const apiResult = await callTool('gas_run_api_exec', {
  scriptId: 'abc123def456...',  // Must have API executable deployment
  functionName: 'myFunction',
  parameters: ['param1', 42, true],
  devMode: true
});

// Response:
{
  "response": {
    "result": "Function executed successfully",
    "logs": ["Log message 1", "Log message 2"]
  },
  "executionId": "execution123...",
  "done": true
}
```

---

## 🚀 Deployment Tools

### `gas_deploy_create` - Create Deployments

Create new deployments for Google Apps Script projects.

#### Input Schema
```typescript
interface GasDeployCreateInput {
  scriptId: string;
  entryPointType?: 'WEB_APP' | 'EXECUTION_API' | 'ADD_ON';
  description?: string;
  versionNumber?: number;
  webAppAccess?: 'MYSELF' | 'DOMAIN' | 'ANYONE' | 'ANYONE_ANONYMOUS';
  webAppExecuteAs?: 'USER_ACCESSING' | 'USER_DEPLOYING';
  accessLevel?: 'MYSELF' | 'DOMAIN' | 'ANYONE' | 'ANYONE_ANONYMOUS';
  accessToken?: string;
}
```

#### Usage Examples

**Create Web App Deployment**
```typescript
const deployment = await callTool('gas_deploy_create', {
  scriptId: 'abc123def456...',
  entryPointType: 'WEB_APP',
  description: 'Production Web App',
  webAppAccess: 'ANYONE',
  webAppExecuteAs: 'USER_DEPLOYING'
});

// Response:
{
  "deploymentId": "deployment123...",
  "entryPoints": [
    {
      "entryPointType": "WEB_APP",
      "webApp": {
        "url": "https://script.google.com/macros/s/deployment123.../exec",
        "executeAs": "USER_DEPLOYING",
        "access": "ANYONE"
      }
    }
  ],
  "description": "Production Web App",
  "createTime": "2024-01-15T14:30:00Z"
}
```

### `gas_version_create` - Create Versions

Create new versions of Google Apps Script projects for deployment.

#### Input Schema
```typescript
interface GasVersionCreateInput {
  scriptId: string;
  description?: string;
  accessToken?: string;
}
```

#### Usage Examples

**Create Version**
```typescript
const version = await callTool('gas_version_create', {
  scriptId: 'abc123def456...',
  description: 'Version with bug fixes'
});

// Response:
{
  "versionNumber": 5,
  "description": "Version with bug fixes",
  "createTime": "2024-01-15T14:30:00Z",
  "scriptId": "abc123def456..."
}
```

### `gas_deploy_list` - List Deployments

List all deployments for a Google Apps Script project with comprehensive analysis, health assessment, and actionable recommendations.

#### Input Schema
```typescript
interface GasDeployListInput {
  scriptId: string;
  pageSize?: number;
  pageToken?: string;
  accessToken?: string;
}
```

#### Enhanced Features
- **Deployment Categorization**: Groups deployments by type (Web App, API Executable, HEAD, Versioned)
- **Health Assessment**: Identifies issues and provides deployment health status
- **Web App URL Extraction**: Automatically finds and displays web app URLs
- **Entry Point Analysis**: Detailed breakdown of deployment entry points
- **Actionable Recommendations**: Context-aware suggestions for next steps
- **Quick Access Commands**: Ready-to-use test commands and gas_run examples

#### Usage Examples

**List Deployments with Analysis**
```typescript
const result = await callTool('gas_deploy_list', {
  scriptId: 'abc123def456...'
});

// Enhanced Response:
{
  "scriptId": "abc123def456...",
  "totalCount": 3,
  
  // Summary statistics
  "summary": {
    "totalDeployments": 3,
    "webAppDeployments": 2,
    "apiExecutableDeployments": 1,
    "headDeployments": 1,
    "versionedDeployments": 2,
    "deploymentsWithUrls": 2,
    "deploymentsWithIssues": 0
  },
  
  // Categorized deployments
  "byType": {
    "webApps": [
      {
        "deploymentId": "web_app_123...",
        "url": "https://script.google.com/macros/s/web_app_123.../exec",
        "access": "ANYONE",
        "executeAs": "USER_DEPLOYING",
        "isHead": true
      }
    ],
    "apiExecutables": [
      {
        "deploymentId": "api_exec_456...",
        "access": "MYSELF",
        "isHead": false
      }
    ]
  },
  
  // Health and status
  "health": {
    "status": "HEALTHY",
    "issues": [],
    "recommendations": [
      "Consider creating a HEAD deployment for automatic latest-code serving"
    ]
  },
  
  // Quick access
  "quickAccess": {
    "webAppUrls": [
      "https://script.google.com/macros/s/web_app_123.../exec"
    ],
    "testCommands": [
      "curl \"https://script.google.com/macros/s/web_app_123.../exec?func=myFunction\""
    ],
    "gasRunCommands": [
      "gas_run_api_exec --scriptId=api_exec_456... --functionName=myFunction"
    ]
  },
  
  // Enhanced deployment data
  "deployments": [
    {
      "deploymentId": "deployment123...",
      "versionNumber": 1,
      "description": "Production Web App",
      "updateTime": "2024-01-15T14:30:00Z",
      "entryPoints": [
        {
          "type": "WEB_APP",
          "webApp": {
            "url": "https://script.google.com/macros/s/deployment123.../exec",
            "access": "ANYONE",
            "executeAs": "USER_DEPLOYING"
          }
        }
      ],
      "isHead": false,
      "hasWebApp": true,
      "hasApiExecutable": false,
      "webAppUrl": "https://script.google.com/macros/s/deployment123.../exec"
    }
  ]
}
```

#### Health Status Values
- `HEALTHY`: All deployments functional with proper entry points
- `WARNING`: Some deployments have issues
- `NO_FUNCTIONAL_DEPLOYMENTS`: No web app or API executable deployments found
- `UNKNOWN`: Status could not be determined

### `gas_project_create` - Create Projects

Alternative method to create new Google Apps Script projects.

#### Input Schema
```typescript
interface GasProjectCreateInput {
  title: string;
  parentId?: string;
  accessToken?: string;
}
```

---

## 📋 Drive Container Tools

### `gas_find_drive_script` - Find Drive Container Scripts

Find Google Drive containers (Sheets, Docs, Forms, Sites) and check their Apps Script associations.

#### Input Schema
```typescript
interface GasFindDriveScriptInput {
  fileName: string;
}
```

#### Usage Examples

**Find Sheet with Script**
```typescript
const findResult = await callTool('gas_find_drive_script', {
  fileName: 'My Spreadsheet'
});

// Response:
{
  "containers": [
    {
      "id": "sheet123...",
      "name": "My Spreadsheet",
      "type": "SPREADSHEET",
      "url": "https://docs.google.com/spreadsheets/d/sheet123.../edit",
      "hasScript": true,
      "scriptId": "script123...",
      "scriptTitle": "My Spreadsheet - Script",
      "lastModified": "2024-01-15T14:30:00Z"
    }
  ],
  "totalFound": 1
}
```

### `gas_bind_script` - Bind Script to Container

Bind an existing Apps Script project to a Drive container.

#### Input Schema
```typescript
interface GasBindScriptInput {
  containerName: string;
  scriptName: string;
}
```

#### Usage Examples

**Bind Script to Sheet**
```typescript
const bindResult = await callTool('gas_bind_script', {
  containerName: 'My Spreadsheet',
  scriptName: 'My Automation Script'
});

// Response:
{
  "success": true,
  "container": {
    "id": "sheet123...",
    "name": "My Spreadsheet",
    "type": "SPREADSHEET"
  },
  "script": {
    "scriptId": "script123...",
    "title": "My Automation Script"
  },
  "bindingComplete": true
}
```

### `gas_create_script` - Create Container Script

Create a new Apps Script project and bind it to a Drive container with starter code.

#### Input Schema
```typescript
interface GasCreateScriptInput {
  containerName: string;
  scriptName?: string;
  description?: string;
}
```

#### Usage Examples

**Create Sheet Script**
```typescript
const createResult = await callTool('gas_create_script', {
  containerName: 'My New Spreadsheet',
  scriptName: 'Sheet Automation',
  description: 'Automated data processing script'
});

// Response:
{
  "scriptId": "newScript123...",
  "title": "Sheet Automation",
  "container": {
    "id": "sheet123...",
    "name": "My New Spreadsheet",
    "type": "SPREADSHEET",
    "url": "https://docs.google.com/spreadsheets/d/sheet123.../edit"
  },
  "starterCode": {
    "Code.gs": "function onOpen() {\n  // Add custom menu\n}\n\nfunction processData() {\n  const sheet = SpreadsheetApp.getActiveSheet();\n  // Process spreadsheet data\n}",
    "appsscript.json": "{\n  \"timeZone\": \"America/Los_Angeles\",\n  \"dependencies\": {\n    \"enabledAdvancedServices\": []\n  }\n}"
  }
}
```

---

## 🚨 Error Handling

### Common Error Types

#### Authentication Errors
```json
{
  "error": {
    "type": "AuthenticationError",
    "message": "Authentication required. Please authenticate first.",
    "code": "AUTH_REQUIRED",
    "data": {
      "requiresAuth": true,
      "authUrl": "https://accounts.google.com/o/oauth2/auth?...",
      "instructions": "Use gas_auth tool to authenticate"
    }
  },
  "sessionId": "session-uuid"
}
```

#### Validation Errors
```json
{
  "error": {
    "type": "ValidationError",
    "message": "Invalid scriptId: must be 20-60 characters long",
    "code": "VALIDATION_FAILED",
    "data": {
      "field": "scriptId",
      "value": "short-id",
      "expected": "20-60 character Google Apps Script ID",
      "pattern": "^[a-zA-Z0-9_-]{20,60}$"
    }
  }
}
```

#### API Errors
```json
{
  "error": {
    "type": "GASApiError",
    "message": "Google Apps Script API error: Script not found",
    "code": "SCRIPT_NOT_FOUND",
    "data": {
      "operation": "get project",
      "scriptId": "invalid-script-id",
      "suggestions": [
        "Verify the script ID is correct",
        "Ensure you have access to the script",
        "Check if the script still exists"
      ]
    }
  }
}
```

### Error Recovery Patterns

```typescript
// Comprehensive error handling
try {
  const result = await callTool('gas_run', {
    scriptId: 'abc123...',
    functionName: 'myFunction()'
  });
} catch (error) {
  switch (error.type) {
    case 'AuthenticationError':
      // Auto-auth will be triggered - guide user
      console.log('🔑 Please complete authentication in browser');
      break;
      
    case 'ValidationError':
      // Fix validation issues
      console.log('❌ Validation failed:', error.data.field);
      break;
      
    case 'GASApiError':
      // Handle API-specific errors
      if (error.code === 'SCRIPT_NOT_FOUND') {
        console.log('📝 Script not found - check script ID');
      }
      break;
      
    default:
      console.log('⚠️ Unexpected error:', error.message);
  }
}
```

---

## 🎯 Usage Patterns

### 1. Project Setup Workflow

```typescript
// 1. Create new project
const newProject = await callTool('gas_mkdir', {
  title: 'My Automation Project'
});

// 2. Add initial code
await callTool('gas_write', {
  path: `${newProject.scriptId}/Utils`,
  content: `
function helper() {
  return 'Helper function';
}

function main() {
  Logger.log(helper());
  return new Date().toISOString();
}`
});

// 3. Test the code
const testResult = await callTool('gas_run', {
  scriptId: newProject.scriptId,
  functionName: 'main()'
});

console.log('Test result:', testResult.result);
```

### 2. File Management Workflow

```typescript
// 1. List project files
const files = await callTool('gas_ls', {
  path: 'abc123...',
  detailed: true
});

// 2. Backup important file
await callTool('gas_cp', {
  from: 'abc123.../ImportantFile.gs',
  to: 'backup456.../ImportantFile_backup'
});

// 3. Update file
await callTool('gas_write', {
  path: 'abc123.../ImportantFile.gs',
  content: updatedContent
});

// 4. Test changes
const testResult = await callTool('gas_run', {
  scriptId: 'abc123...',
  functionName: 'testFunction()'
});
```

### 3. Deployment Workflow

```typescript
// 1. Create version
const version = await callTool('gas_version_create', {
  scriptId: 'abc123...',
  description: 'Production release v1.0'
});

// 2. Deploy as web app
const deployment = await callTool('gas_deploy_create', {
  scriptId: 'abc123...',
  entryPointType: 'WEB_APP',
  versionNumber: version.versionNumber,
  webAppAccess: 'ANYONE',
  webAppExecuteAs: 'USER_DEPLOYING'
});

console.log('Web app URL:', deployment.entryPoints[0].webApp.url);
```

### 4. Testing and Debugging

```typescript
// 1. Test basic functionality
const basicTest = await callTool('gas_run', {
  scriptId: 'abc123...',
  functionName: 'Session.getScriptTimeZone()'
});

// 2. Test user functions
const userTest = await callTool('gas_run', {
  scriptId: 'abc123...',
  functionName: 'myFunction("test", 42)'
});

// 3. Test complex expressions
const complexTest = await callTool('gas_run', {
  scriptId: 'abc123...',
  functionName: 'JSON.stringify({result: calculateSomething(), timestamp: new Date()})'
});
```

---

This comprehensive API reference provides all the information needed to effectively use the MCP Gas Server tools in AI-assisted development workflows. 