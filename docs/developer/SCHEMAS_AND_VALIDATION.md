# MCP Gas Server - Schemas and Validation Guide

## 🎯 Overview

This guide provides comprehensive documentation of all JSON schemas, validation patterns, and input/output formats used by the MCP Gas Server. It's designed to optimize AI-assisted development by providing clear examples and validation rules.

## 📋 Table of Contents

1. [MCP Protocol Schemas](#mcp-protocol-schemas)
2. [Tool Input Schemas](#tool-input-schemas)
3. [Validation Patterns](#validation-patterns)
4. [Error Response Schemas](#error-response-schemas)
5. [Usage Examples](#usage-examples)
6. [Development Guidelines](#development-guidelines)

---

## 🔧 MCP Protocol Schemas

### Server Capabilities Schema

```json
{
  "name": "mcp-gas-server",
  "version": "1.0.0",
  "capabilities": {
    "tools": {}
  }
}
```

### Tool Registration Schema

```typescript
interface ToolSchema {
  name: string;                    // Unique tool identifier
  description: string;             // Human-readable description
  inputSchema: {                   // JSON Schema for input validation
    type: "object";
    properties: Record<string, any>;
    required?: string[];
    additionalProperties?: boolean;
  };
}
```

---

## 🛠️ Tool Input Schemas

### 1. Authentication Tools

#### `gas_auth` - OAuth Authentication

```typescript
interface GasAuthInput {
  mode: 'start' | 'callback' | 'status' | 'logout';  // Authentication mode
  code?: string;                                      // OAuth callback code
  openBrowser?: boolean;                              // Auto-open browser (default: true)
  waitForCompletion?: boolean;                        // Wait for auth completion (default: false)
  accessToken?: string;                               // Pre-existing token (stateless mode)
}
```

**JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": ["start", "callback", "status", "logout"],
      "description": "Authentication operation mode",
      "default": "start"
    },
    "code": {
      "type": "string",
      "description": "OAuth authorization code (for callback mode)",
      "pattern": "^[a-zA-Z0-9/_-]+$"
    },
    "openBrowser": {
      "type": "boolean",
      "description": "Automatically open browser for authentication",
      "default": true
    },
    "waitForCompletion": {
      "type": "boolean", 
      "description": "Wait for OAuth flow to complete before returning",
      "default": false
    },
    "accessToken": {
      "type": "string",
      "description": "Pre-existing access token for stateless operation",
      "pattern": "^ya29\\.[a-zA-Z0-9_-]+$"
    }
  },
  "required": ["mode"],
  "additionalProperties": false
}
```

**Usage Examples:**
```typescript
// Start authentication flow
await callTool('gas_auth', { mode: 'start' });

// Check authentication status
await callTool('gas_auth', { mode: 'status' });

// Manual callback (development/testing)
await callTool('gas_auth', { 
  mode: 'callback', 
  code: 'auth_code_here' 
});

// Stateless operation with token
await callTool('gas_auth', {
  mode: 'status',
  accessToken: 'ya29.a0AW4Xtxiw...'
});
```

### 2. Filesystem Operations

#### `gas_ls` - List Files and Projects

```typescript
interface GasLsInput {
  path?: string;                    // Project ID or empty for all projects
  detailed?: boolean;               // Include detailed file information
  recursive?: boolean;              // List files recursively
  accessToken?: string;             // Optional access token
}
```

**JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Path to list: empty for all projects, scriptId for project files",
      "pattern": "^[a-zA-Z0-9_/-]*$",
      "maxLength": 200
    },
    "detailed": {
      "type": "boolean",
      "description": "Include detailed file information (size, type, etc.)",
      "default": false
    },
    "recursive": {
      "type": "boolean",
      "description": "List files recursively in pseudo-directories",
      "default": true
    },
    "accessToken": {
      "type": "string",
      "description": "Access token for stateless operation",
      "pattern": "^ya29\\.[a-zA-Z0-9_-]+$"
    }
  },
  "additionalProperties": false
}
```

#### `gas_cat` - Read File Contents (⭐ RECOMMENDED)

**🎯 PREFERRED METHOD**: Use `gas_cat` instead of `gas_raw_cat` for better workflow integration and local/remote file resolution.

```typescript
interface GasCatInput {
  path: string;                     // Full path: scriptId/filename.gs or just filename if current project set
  preferLocal?: boolean;            // Prefer local file over remote when both exist (default: true)
  workingDir?: string;              // Working directory (defaults to current directory)
  accessToken?: string;             // Optional access token
}
```

**JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Full path to file: scriptId/path/to/file.ext",
      "pattern": "^[a-zA-Z0-9_-]+/[a-zA-Z0-9_.//-]+$",
      "minLength": 3,
      "maxLength": 200
    },
    "accessToken": {
      "type": "string",
      "description": "Access token for stateless operation",
      "pattern": "^ya29\\.[a-zA-Z0-9_-]+$"
    }
  },
  "required": ["path"],
  "additionalProperties": false
}
```

#### `gas_write` - Create/Update Files with Module Wrapper (⭐ RECOMMENDED)

**🎯 PREFERRED METHOD**: Use `gas_write` instead of `gas_raw_write` for automatic module wrapper functionality and safer file operations.

**Key Features:**
- **Automatic Module Wrapper**: Wraps JavaScript code with proper `_main()` function for `require()` system
- **Intelligent Sync**: Writes to both local and remote by default with conflict detection
- **Type Detection**: Automatically detects JavaScript, HTML, and JSON content
- **Safer Operations**: Preserves existing content during merges (vs. clobbering)

```typescript
interface GasWriteInput {
  path: string;                     // Full path: scriptId/filename (WITHOUT extension)
  content: string;                  // Your raw code content (will be wrapped automatically)
  fileType?: 'SERVER_JS' | 'HTML' | 'JSON';  // Optional - auto-detected if not provided
  localOnly?: boolean;              // Write only to local (skip remote sync)
  remoteOnly?: boolean;             // Write only to remote (skip local sync)
  workingDir?: string;              // Working directory (defaults to current directory)
  accessToken?: string;             // Optional access token
}
```

**JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Full path to file: scriptId/path/to/file.ext",
      "pattern": "^[a-zA-Z0-9_-]+/[a-zA-Z0-9_./-]+$",
      "minLength": 3,
      "maxLength": 200
    },
    "content": {
      "type": "string",
      "description": "Content to write to the file",
      "minLength": 0,
      "maxLength": 100000
    },
    "position": {
      "type": "number",
      "description": "Position in file order (0-based, optional)",
      "minimum": 0,
      "maximum": 100
    },
    "accessToken": {
      "type": "string",
      "description": "Access token for stateless operation",
      "pattern": "^ya29\\.[a-zA-Z0-9_-]+$"
    }
  },
  "required": ["path", "content"],
  "additionalProperties": false
}
```

### 3. Execution Tools

#### `gas_run` - Direct Code Execution with Current Project Context (⭐ RECOMMENDED)

**🎯 PREFERRED METHOD**: Use `gas_run` instead of `gas_raw_run` for automatic project context and better error handling.

**Key Advantages:**
- **Automatic Project Context**: Works with current project when set via `gas_project_set`
- **Better Error Handling**: Provides clearer error messages and recovery suggestions
- **Simplified Interface**: No need to specify script ID when current project is set
- **Module System Integration**: Seamlessly works with `require()` system from wrapped files

```typescript
interface GasRunInput {
  js_statement: string;             // Any JavaScript statement or function call
  project?: string | object;        // Project reference (uses current if not specified)
  autoRedeploy?: boolean;           // Ensures HEAD deployment exists (default: true)
  workingDir?: string;              // Working directory (defaults to current directory)
  accessToken?: string;             // Optional access token
}
```

**Deployment Strategy:**
- **HEAD Deployments**: `versionNumber=null`, uses `/dev` URLs, serves latest content automatically
- **Testing Endpoint**: Follows Google Apps Script documentation for proper testing workflow
- **No Redeployment**: Content updates are automatic when using HEAD deployments

**JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "scriptId": {
      "type": "string",
      "description": "Google Apps Script project ID. Tool will use or create HEAD deployment with /dev URL for testing latest content.",
      "pattern": "^[a-zA-Z0-9_-]{20,60}$",
      "minLength": 20,
      "maxLength": 60
    },
    "functionName": {
      "type": "string", 
      "description": "Any JavaScript/Apps Script statement or function call to execute directly via doGet() proxy",
      "minLength": 1,
      "maxLength": 1000,
      "examples": [
        "Session.getScriptTimeZone()",
        "add(2,6)",
        "Math.PI * 2",
        "new Date().getTime()",
        "[1,2,3].reduce((sum, n) => sum + n, 0)"
      ]
    },
    "parameters": {
      "type": "array",
      "description": "Array of parameters to pass to the function (optional)",
      "items": {
        "oneOf": [
          { "type": "string" },
          { "type": "number" },
          { "type": "boolean" },
          { "type": "null" },
          { "type": "object" },
          { "type": "array" }
        ]
      },
      "maxItems": 10
    },
    "devMode": {
      "type": "boolean",
      "description": "Run in development mode using HEAD deployment (default: true)",
      "default": true
    },
    "autoRedeploy": {
      "type": "boolean", 
      "description": "Enable automatic HEAD deployment setup: ensures HEAD deployment exists with /dev URL for testing. Content updates are automatic without redeployment. (default: true)",
      "default": true
    },
    "accessToken": {
      "type": "string",
      "description": "Access token for stateless operation",
      "pattern": "^ya29\\.[a-zA-Z0-9_-]+$"
    }
  },
  "required": ["scriptId", "functionName"],
  "additionalProperties": false
}
```

#### `gas_run_api_exec` - API-Based Execution

```typescript
interface GasRunApiExecInput {
  scriptId: string;                 // Google Apps Script project ID (must be deployed)
  functionName: string;             // Function name to execute
  parameters?: any[];               // Function parameters
  devMode?: boolean;                // Run in development mode
  accessToken?: string;             // Optional access token
}
```

**JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "scriptId": {
      "type": "string",
      "description": "Google Apps Script project ID (must be deployed as API executable)",
      "pattern": "^[a-zA-Z0-9_-]{20,60}$",
      "minLength": 20,
      "maxLength": 60
    },
    "functionName": {
      "type": "string",
      "description": "Name of the function to execute",
      "pattern": "^[a-zA-Z_$][a-zA-Z0-9_$]*$",
      "minLength": 1,
      "maxLength": 100
    },
    "parameters": {
      "type": "array",
      "description": "Array of parameters (must be primitive types)",
      "items": {
        "oneOf": [
          { "type": "string" },
          { "type": "number" },
          { "type": "boolean" },
          { "type": "null" },
          { "type": "object" },
          { "type": "array" }
        ]
      },
      "maxItems": 10
    },
    "devMode": {
      "type": "boolean",
      "description": "Run in development mode",
      "default": true
    },
    "accessToken": {
      "type": "string",
      "description": "Access token for stateless operation",
      "pattern": "^ya29\\.[a-zA-Z0-9_-]+$"
    }
  },
  "required": ["scriptId", "functionName"],
  "additionalProperties": false
}
```

### 4. Deployment Management

#### `gas_deploy_create` - Create Deployment

```typescript
interface GasDeployCreateInput {
  scriptId: string;                 // Google Apps Script project ID
  entryPointType?: 'WEB_APP' | 'EXECUTION_API' | 'ADD_ON';
  description?: string;             // Deployment description
  versionNumber?: number;           // Version to deploy
  webAppAccess?: 'MYSELF' | 'DOMAIN' | 'ANYONE' | 'ANYONE_ANONYMOUS';
  webAppExecuteAs?: 'USER_ACCESSING' | 'USER_DEPLOYING';
  accessLevel?: 'MYSELF' | 'DOMAIN' | 'ANYONE' | 'ANYONE_ANONYMOUS';
  accessToken?: string;             // Optional access token
}
```

**JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "scriptId": {
      "type": "string",
      "description": "Google Apps Script project ID",
      "pattern": "^[a-zA-Z0-9_-]{44}$",
      "minLength": 44,
      "maxLength": 44
    },
    "entryPointType": {
      "type": "string",
      "enum": ["WEB_APP", "EXECUTION_API", "ADD_ON"],
      "description": "Type of deployment",
      "default": "EXECUTION_API"
    },
    "description": {
      "type": "string",
      "description": "Description of this deployment",
      "maxLength": 500,
      "default": "API Deployment"
    },
    "versionNumber": {
      "type": "number",
      "description": "Version number to deploy (optional - uses HEAD if not specified)",
      "minimum": 1,
      "maximum": 1000
    },
    "webAppAccess": {
      "type": "string",
      "enum": ["MYSELF", "DOMAIN", "ANYONE", "ANYONE_ANONYMOUS"],
      "description": "Who can access the web app (for WEB_APP type)",
      "default": "ANYONE"
    },
    "webAppExecuteAs": {
      "type": "string",
      "enum": ["USER_ACCESSING", "USER_DEPLOYING"],
      "description": "Who the web app runs as (for WEB_APP type)",
      "default": "USER_DEPLOYING"
    },
    "accessLevel": {
      "type": "string",
      "enum": ["MYSELF", "DOMAIN", "ANYONE", "ANYONE_ANONYMOUS"],
      "description": "Access level for API Executable (for EXECUTION_API type)",
      "default": "MYSELF"
    },
    "accessToken": {
      "type": "string",
      "description": "Access token for stateless operation",
      "pattern": "^ya29\\.[a-zA-Z0-9_-]+$"
    }
  },
  "required": ["scriptId"],
  "additionalProperties": false
}
```

### 5. Drive Container Tools

#### `gas_find_drive_script` - Find Drive Container Scripts

```typescript
interface GasFindDriveScriptInput {
  fileName: string;                 // Name of container file to search for
}
```

**JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "fileName": {
      "type": "string",
      "description": "Name of container file to search for (supports partial matches)",
      "minLength": 1,
      "maxLength": 100,
      "pattern": "^[a-zA-Z0-9\\s\\-_\\.\\(\\)]+$"
    }
  },
  "required": ["fileName"],
  "additionalProperties": false
}
```

---

## 🛡️ Validation Patterns

### Core Validation Rules

#### Google Apps Script Project ID
```typescript
const SCRIPT_ID_PATTERN = /^[a-zA-Z0-9_-]{20,60}$/;
const SCRIPT_ID_RULES = {
  minLength: 20,
  maxLength: 60,
  pattern: SCRIPT_ID_PATTERN,
  description: "Google Apps Script project identifier"
};
```

#### Function Names
```typescript
const FUNCTION_NAME_PATTERN = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const FUNCTION_NAME_RULES = {
  minLength: 1,
  maxLength: 100,
  pattern: FUNCTION_NAME_PATTERN,
  description: "Valid JavaScript function name"
};
```

#### File Paths (Security-Critical)
```typescript
const FILE_PATH_VALIDATION = {
  // Security checks for path traversal prevention
  dangerousPatterns: [
    /\.\./,                    // Any .. sequence
    /[\\\/]\.\.[\\\/]/,       // ../  or ..\  patterns  
    /^[\\\/]/,                // Absolute paths
    /[\\\/]{2,}/,             // Multiple slashes
    /\0/,                     // Null bytes
    /%2e%2e/i,                // URL encoded ..
    /%2f/i,                   // URL encoded /
    /%00/i,                   // URL encoded null
  ],
  maxLength: 200,
  allowedCharacters: /^[a-zA-Z0-9_.\/-]+$/
};
```

#### Access Token Format
```typescript
const ACCESS_TOKEN_PATTERN = /^ya29\.[a-zA-Z0-9_-]+$/;
const ACCESS_TOKEN_RULES = {
  pattern: ACCESS_TOKEN_PATTERN,
  description: "Google OAuth 2.0 access token"
};
```

### Validation Helper Usage

```typescript
// In tool implementation
import { MCPValidator } from '../utils/validation.js';

// Validate individual parameters
const scriptId = MCPValidator.validateScriptId(params.scriptId, context);
const functionName = MCPValidator.validateFunctionName(params.functionName, context);
const filePath = MCPValidator.validateFilePath(params.path, context);

// Validate multiple parameters
const result = MCPValidator.validateParameters([
  { field: 'scriptId', value: params.scriptId, required: true, type: 'string' },
  { field: 'code', value: params.code, required: true, type: 'string', minLength: 1 }
], { context, collectAllErrors: true });
```

---

## 🚨 Error Response Schemas

### Authentication Error
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
  "sessionId": "session-uuid-here"
}
```

### Validation Error
```json
{
  "error": {
    "type": "ValidationError",
    "message": "Invalid parameter: scriptId must be 20-60 characters long",
    "code": "VALIDATION_FAILED",
    "data": {
      "field": "scriptId",
      "value": "invalid-id",
      "expected": "20-60 character Google Apps Script ID",
      "pattern": "^[a-zA-Z0-9_-]{20,60}$"
    }
  },
  "sessionId": "session-uuid-here"
}
```

### API Error
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
  },
  "sessionId": "session-uuid-here"
}
```

### Auto-Authentication Response
```json
{
  "error": {
    "type": "AuthenticationError",
    "message": "Authentication required",
    "code": "AUTH_REQUIRED",
    "data": { ... }
  },
  "autoAuth": {
    "status": "initiated",
    "message": "Authentication flow automatically started",
    "authUrl": "https://accounts.google.com/o/oauth2/auth?...",
    "callbackUrl": "http://localhost:3000/oauth/callback",
    "instructions": [
      "🚀 OAuth authentication started automatically!",
      "📱 Complete authentication in the browser window",
      "✅ Then retry your original request"
    ]
  },
  "sessionId": "session-uuid-here"
}
```

---

## 💡 Development Guidelines for AI Assistants

### 1. Schema-First Development

Always define JSON schemas before implementing tools:

```typescript
// 1. Define the schema
const inputSchema = {
  type: "object",
  properties: {
    scriptId: { type: "string", pattern: "^[a-zA-Z0-9_-]{20,60}$" },
    functionName: { type: "string", minLength: 1, maxLength: 100 }
  },
  required: ["scriptId", "functionName"],
  additionalProperties: false
};

// 2. Implement validation
const scriptId = this.validate.scriptId(params.scriptId, 'execution');
const functionName = this.validate.functionName(params.functionName, 'execution');

// 3. Use in tool class
export class MyTool extends BaseTool {
  public inputSchema = inputSchema;
  // ...
}
```

### 2. Consistent Error Handling

Use the centralized error handling pattern:

```typescript
// Use handleApiCall for all Google API calls
const result = await this.handleApiCall(
  () => googleApi.callMethod(params),
  'operation description',
  { scriptId: params.scriptId }
);
```

### 3. Security-First Validation

Always validate inputs with security in mind:

```typescript
// Path validation with security checks
const safePath = this.validate.filePath(params.path, 'file operation');

// Script ID validation
const scriptId = this.validate.scriptId(params.scriptId, 'script access');

// Code validation for injection prevention
const safeCode = this.validate.code(params.code, 'code execution');
```

### 4. Comprehensive Documentation

Include examples in all schemas:

```json
{
  "functionName": {
    "type": "string",
    "description": "Any JavaScript statement or function call",
    "examples": [
      "Session.getScriptTimeZone()",
      "add(2, 6)",
      "Math.PI * 2",
      "new Date().getTime()"
    ]
  }
}
```

### 5. Testing Schema Compliance

Validate schemas in tests:

```typescript
describe('Tool Schema Validation', () => {
  it('should validate input schema correctly', () => {
    const validInput = { scriptId: 'valid-script-id-here', functionName: 'test' };
    const result = validateSchema(MyTool.inputSchema, validInput);
    expect(result.isValid).toBe(true);
  });
  
  it('should reject invalid inputs', () => {
    const invalidInput = { scriptId: 'short', functionName: '' };
    const result = validateSchema(MyTool.inputSchema, invalidInput);
    expect(result.isValid).toBe(false);
  });
});
```

---

## 🔄 Schema Versioning

### Current Version: 1.0.0

All schemas are currently at version 1.0.0. Future changes will follow semantic versioning:

- **Major (2.0.0)**: Breaking changes to existing schemas
- **Minor (1.1.0)**: New optional fields, backward-compatible additions
- **Patch (1.0.1)**: Bug fixes, clarifications, better descriptions

### Migration Strategy

When schemas change:

1. **Deprecation Notice**: Mark old fields as deprecated
2. **Backward Compatibility**: Support old and new schemas simultaneously
3. **Migration Guide**: Provide clear upgrade instructions
4. **Version Headers**: Include schema version in responses

```json
{
  "schemaVersion": "1.0.0",
  "result": { ... },
  "deprecations": [
    {
      "field": "oldField",
      "replacement": "newField", 
      "removeInVersion": "2.0.0"
    }
  ]
}
```

---

This comprehensive schema documentation ensures consistent validation, clear error messages, and secure input handling across all MCP Gas tools. Use it as a reference for implementing new tools and validating existing ones. 