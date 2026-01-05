# MCP Gas Server - Complete API Reference

## 🎯 Overview

This comprehensive API reference documents all 46 MCP Gas tools with detailed schemas, examples, and error handling patterns. Designed to optimize AI-assisted development with Claude in Cursor IDE.

## 📋 Table of Contents

1. [Authentication Tools](#authentication-tools)
2. [Filesystem Tools](#filesystem-tools)
3. [Project Management Tools](#project-management-tools)
4. [Local Sync & Project Context Tools](#local-sync--project-context-tools)
5. [Execution Tools](#execution-tools)
6. [Deployment Tools](#deployment-tools)
7. [Drive Container Tools](#drive-container-tools)
8. [Local Root Management Tools](#local-root-management-tools)
9. [Trigger Management Tools](#trigger-management-tools)
10. [Process Management Tools](#process-management-tools)
11. [Version Management Tools](#version-management-tools)
12. [Git Operations Tools](#git-operations-tools)
13. [Error Handling](#error-handling)
14. [Usage Patterns](#usage-patterns)

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

### ⭐ RECOMMENDED: `gas_write` - Smart File Writer with Module Wrapper

**🎯 PREFERRED METHOD**: Use `gas_write` instead of `gas_raw_write` for all file operations. This tool automatically provides proper module wrappers for the `require()` system and handles intelligent local/remote synchronization.

**Key Advantages over `gas_raw_write`:**
- ✅ **Automatic Module Wrapper**: Wraps your code with proper `_main()` function signature for `require()` system
- ✅ **Intelligent Sync**: Writes to both local and remote by default with conflict detection
- ✅ **Type Detection**: Automatically detects JavaScript, HTML, and JSON content
- ✅ **Safer Operations**: Preserves existing content during merges (vs. clobbering)
- ✅ **Development Workflow**: Optimized for iterative development with local file caching

**Module Wrapper Functionality:**
When you write JavaScript content, `gas_write` automatically wraps it with:
```javascript
function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  // Your code here
  
  // Export functions
  exports.myFunction = myFunction;
  exports.anotherFunction = anotherFunction;
}

__defineModule__(_main);
```

**🚨 IMPORTANT**: The `__defineModule__(_main)` call uses auto-detection for module names. **DO NOT pass explicit module names** like `__defineModule__(_main, 'ModuleName')` - this is RESERVED for the CommonJS system module only. User modules should always use auto-detection.

This enables seamless `require()` functionality across your Google Apps Script modules.

### ⭐ RECOMMENDED: `gas_cat` - Smart File Reader

**🎯 PREFERRED METHOD**: Use `gas_cat` instead of `gas_raw_cat` for reading files. This tool provides intelligent local/remote file resolution and better error handling.

**Key Advantages over `gas_raw_cat`:**
- ✅ **Local-First**: Reads from local cache when available, falls back to remote
- ✅ **Automatic Project Context**: Works with current project when set via `gas_project_set`
- ✅ **Better Error Handling**: Provides clearer error messages and recovery suggestions
- ✅ **Consistent Interface**: Same path format as `gas_write` for consistency

### `gas_ls` - List Projects and Files

List Google Apps Script projects and files with **wildcard pattern support** and detailed information.

**Important Note**: Google Apps Script has no real folders or directories. What appears as `"models/User.gs"` is simply a filename with a forward slash prefix for logical organization. The `/` is just part of the filename.

**🎯 Wildcard Support**: Use `*` (any characters) and `?` (single character) patterns for powerful file filtering across pseudo-directories.

#### Input Schema
```typescript
interface GasLsInput {
  path?: string;                    // Now supports wildcard patterns!
  detailed?: boolean;
  recursive?: boolean;
  wildcardMode?: 'filename' | 'fullpath' | 'auto';  // NEW: Pattern matching mode
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
  "scriptId": "abc123def456...",
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
  "totalFiles": 3,
  "isWildcard": false,
  "wildcardMode": "auto"
}
```

**🌟 NEW: Wildcard Pattern Examples**

**Find All Files in a Pseudo-Directory**
```typescript
const aiToolsFiles = await callTool('gas_ls', {
  path: 'abc123def456.../ai_tools/*',
  detailed: true
});

// Finds all files with "ai_tools/" prefix
{
  "type": "files",
  "scriptId": "abc123def456...",
  "pattern": "ai_tools/*",
  "isWildcard": true,
  "wildcardMode": "auto",
  "matchedFiles": 25,
  "totalFiles": 137,
  "items": [
    { "name": "ai_tools/BaseConnector", "type": "SERVER_JS", "size": 60471 },
    { "name": "ai_tools/ClaudeConnector", "type": "SERVER_JS", "size": 31501 },
    // ... 23 more files
  ]
}
```

**Cross-Directory File Search**
```typescript
const connectorFiles = await callTool('gas_ls', {
  path: 'abc123def456.../*Connector*',
  detailed: true
});

// Finds all files containing "Connector" anywhere in the name
{
  "matchedFiles": 22,
  "items": [
    { "name": "ai_tools/BaseConnector", "type": "SERVER_JS" },
    { "name": "ai_tools/ClaudeConnector", "type": "SERVER_JS" },
    { "name": "gas-sync/GASBaseConnector", "type": "SERVER_JS" },
    { "name": "test/mocks/MockConnector", "type": "SERVER_JS" },
    // ... more connector files across directories
  ]
}
```

**Complex Multi-Level Pattern Matching**
```typescript
const testFiles = await callTool('gas_ls', {
  path: 'abc123def456.../test/*/*.test',
  detailed: true
});

// Finds all .test files in any subdirectory under test/
{
  "matchedFiles": 34,
  "items": [
    { "name": "test/async/core.test", "type": "SERVER_JS" },
    { "name": "test/integration/ClaudeConnector.integration.test", "type": "SERVER_JS" },
    { "name": "test/unit/LLMConversation.test", "type": "SERVER_JS" },
    // ... 31 more test files
  ]
}
```

**Single Character Wildcard with `?`**
```typescript
const versionFiles = await callTool('gas_ls', {
  path: 'abc123def456.../test/unit/LLMConversation?test',
  detailed: true
});

// Finds files where ? matches exactly one character (like ".")
{
  "matchedFiles": 1,
  "items": [
    { "name": "test/unit/LLMConversation.test", "type": "SERVER_JS" }
  ]
}
```

**Wildcard Mode Control**
```typescript
// Match only filename portion (not full path)
const files = await callTool('gas_ls', {
  path: 'abc123def456.../*User*',
  wildcardMode: 'filename'  // Only match basename
});

// Match full file path (default for patterns with /)
const files = await callTool('gas_ls', {
  path: 'abc123def456.../models/*',
  wildcardMode: 'fullpath'  // Match complete path
});
```

### `gas_grep` - Search File Contents (Clean User Code)

**🎯 RECOMMENDED**: Server-side content search with pattern matching and wildcard support.

Search **clean user code** (unwrapped from CommonJS wrappers) across Google Apps Script projects using regex or literal patterns. This searches the same content that `gas_cat` shows - the actual code developers write and edit, without system-generated wrappers.

**🔄 CURRENT BEHAVIOR**: Currently makes direct API calls like `gas_raw_grep`, but designed to potentially support local file access in the future (like `gas_cat` vs `gas_raw_cat` pattern).

**Content Examined**: Same as `gas_cat` - unwrapped user code only
- ✅ Your actual functions and logic
- ✅ `require()` calls you wrote
- ✅ `module.exports` and `exports.func` assignments  
- ❌ No `_main()` wrapper functions
- ❌ No `__defineModule__()` calls
- ❌ No `globalThis.__getCurrentModule()` system code

### `gas_raw_grep` - Search File Contents (Full Content)

**⚠️ ADVANCED**: Server-side content search including system-generated code.

Search **complete file content** including CommonJS wrappers and system-generated code across Google Apps Script projects. This searches the same content that `gas_raw_cat` shows - the full files including all system infrastructure.

**🔧 ALWAYS DIRECT API CALLS**: Like `gas_raw_cat`, this tool never uses local cached files and always makes direct API calls to Google Apps Script. Requires explicit project IDs in all paths.

**Content Examined**: Same as `gas_raw_cat` - complete file content
- ✅ All user code (your functions and logic)
- ✅ CommonJS `_main()` wrapper functions
- ✅ `__defineModule__()` system calls
- ✅ `globalThis.__getCurrentModule()` infrastructure
- ✅ Complete module system internals

**Data Source**: Direct Google Apps Script API calls only (never local files)

#### Content Comparison Example

**Example File**: `Calculator.gs`

**What `gas_cat` shows (and `gas_grep` searches):**
```javascript
function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

exports.add = add;
exports.multiply = multiply;
```

**What `gas_raw_cat` shows (and `gas_raw_grep` searches):**
```javascript
function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  function add(a, b) {
    return a + b;
  }

  function multiply(a, b) {
    return a * b;
  }

  exports.add = add;
  exports.multiply = multiply;
}

__defineModule__(_main);
```

#### Input Schema
```typescript
interface GasGrepInput {
  pattern: string;                        // Search pattern (regex or literal)
  path?: string;                         // Project/file path with wildcard/regex support
  pathMode?: 'wildcard' | 'regex' | 'auto';  // Path pattern interpretation
  files?: string[];                      // Alternative: specific file list
  searchMode?: 'regex' | 'literal' | 'auto';  // Pattern interpretation
  caseSensitive?: boolean;               // Case sensitivity (default: false)
  wholeWord?: boolean;                   // Match whole words only
  maxResults?: number;                   // Max matches (default: 50, max: 200)
  maxFilesSearched?: number;            // Max files to search (default: 100)
  contextLines?: number;                // Lines before/after match (default: 2)
  compact?: boolean;                    // Use compact output format
  excludeFiles?: string[];              // Files to exclude (wildcards supported)
  includeFileTypes?: string[];          // Filter by file types
  accessToken?: string;
}
```

#### Usage Examples

**Search Clean User Code (`gas_grep`)**
```typescript
// Find user functions (clean code search)
const userFunctions = await callTool('gas_grep', {
  pattern: 'function\\s+(\\w+)',
  path: 'abc123def456.../Calculator',
  searchMode: 'regex'
});

// Result: Finds only user functions like "function add", "function multiply"
// ✅ Finds: function add(a, b)
// ✅ Finds: function multiply(a, b)  
// ❌ Skips: function _main() wrapper
```

**Search Complete Content (`gas_raw_grep`)**
```typescript
// Find ALL functions including system wrappers
const allFunctions = await callTool('gas_raw_grep', {
  pattern: 'function\\s+(\\w+)',
  path: 'abc123def456.../Calculator',
  searchMode: 'regex'
});

// Result: Finds user functions AND system wrappers
// ✅ Finds: function add(a, b)
// ✅ Finds: function multiply(a, b)
// ✅ Finds: function _main() wrapper
```

**Debug CommonJS Module System**
```typescript
// Search for module system internals (only raw_grep finds these)
const moduleInternals = await callTool('gas_raw_grep', {
  pattern: '__defineModule__|_main\\s*\\(',
  path: 'abc123def456...',
  searchMode: 'regex'
});

// Result: Finds CommonJS infrastructure
// ✅ Finds: __defineModule__(_main);
// ✅ Finds: function _main(
// ✅ Finds: globalThis.__getCurrentModule()
```

**Search User Module Dependencies**
```typescript
// Both tools find require() calls in user code
const dependencies = await callTool('gas_grep', {  // or gas_raw_grep
  pattern: 'require\\([\'"`]([^\'"`]+)[\'"`]\\)',
  path: 'abc123def456...',
  searchMode: 'regex'
});

// Result: Finds user require() calls
// ✅ gas_grep: require("Utils") in user code
// ✅ gas_raw_grep: require("Utils") in user code + system context
```

**🆕 Regex Path Filtering (Enhanced)**
```typescript
// Find functions in Controllers (regex path)
const controllers = await callTool('gas_grep', {
  pattern: 'function\\s+(\\w+)',
  path: 'abc123def456.../.*Controller.*',
  pathMode: 'regex',
  searchMode: 'regex'
});

// Search utils OR helpers directories (regex alternation)
const utilities = await callTool('gas_grep', {
  pattern: 'require(',
  path: 'abc123def456.../(utils|helpers)/.*',
  pathMode: 'regex',
  searchMode: 'literal'
});
```

### `gas_ripgrep` - High-Performance Search with Advanced Features

**⚡ RECOMMENDED**: High-performance ripgrep-inspired search with multiple patterns, smart case, context control, and replacement suggestions. Searches clean user code with 98% ripgrep feature parity.

**NEW FEATURES** (Added 2025):
- ✅ **`ignoreCase`** - Explicit case-insensitive search (ripgrep `-i`)
- ✅ **`sort`** - Result sorting by path or modification time
- ✅ **`trim`** - Whitespace trimming from result lines

Search **clean user code** (unwrapped from CommonJS) with ripgrep-inspired performance and features. Processes the same content as `gas_cat` shows - actual developer code without system wrappers.

#### Input Schema
```typescript
interface GasRipgrepInput {
  scriptId: string;                          // Google Apps Script project ID
  pattern: string;                           // Primary search pattern (regex or literal)
  patterns?: string[];                       // Additional patterns (OR logic with main pattern)
  path?: string;                            // Filename prefix pattern for filtering

  // NEW: Enhanced case handling
  ignoreCase?: boolean;                     // Case-insensitive search (overrides smartCase)
  smartCase?: boolean;                      // Smart case matching (default: false)
  caseSensitive?: boolean;                  // Force case-sensitive (default: false)

  // Search control
  fixedStrings?: boolean;                   // Treat patterns as literal strings
  multiline?: boolean;                      // Enable multiline matching
  wholeWord?: boolean;                      // Match whole words only
  invertMatch?: boolean;                    // Show lines that do NOT match

  // Context control
  context?: number;                         // Lines before and after match
  contextBefore?: number;                   // Lines before match
  contextAfter?: number;                    // Lines after match

  // Output modes
  count?: boolean;                          // Show only match counts per file
  filesWithMatches?: boolean;               // Show only filenames with matches
  onlyMatching?: boolean;                   // Show only matched text portions
  showLineNumbers?: boolean;                // Include line numbers (default: true)
  compact?: boolean;                        // Use compact output format

  // Replacement
  replace?: string;                         // Generate replacement suggestions

  // Performance and filtering
  maxCount?: number;                        // Max matches per file (default: 50)
  maxFiles?: number;                        // Max files to search (default: 100)
  excludeFiles?: string[];                  // Filename patterns to exclude
  includeFileTypes?: ('SERVER_JS' | 'HTML' | 'JSON')[];  // Filter by file types
  pseudoDepth?: number;                     // Max "directory depth" by counting "/" in filenames

  // NEW: Result processing
  sort?: 'none' | 'path' | 'modified';      // Sort results (default: 'none')
  trim?: boolean;                           // Remove leading/trailing whitespace (default: false)
  showStats?: boolean;                      // Include performance statistics

  accessToken?: string;                     // Optional access token
}
```

#### NEW Features Usage Examples

**Case-Insensitive Search (NEW)**
```typescript
// Find "TODO", "todo", "Todo", etc.
const todos = await callTool('gas_ripgrep', {
  scriptId: "1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789",
  pattern: "todo",
  ignoreCase: true  // NEW: Explicit case-insensitive search
});

// ignoreCase overrides smartCase and caseSensitive
const results = await callTool('gas_ripgrep', {
  scriptId: "1abc2def...",
  pattern: "TODO",
  smartCase: true,    // Ignored when ignoreCase is true
  ignoreCase: true    // Takes precedence
});
```

**Sorted Results (NEW)**
```typescript
// Alphabetical sorting for predictable output
const functions = await callTool('gas_ripgrep', {
  scriptId: "1abc2def...",
  pattern: "function\\s+(\\w+)",
  sort: "path"  // NEW: Alphabetical by file path
});

// Results: api/client, models/User, utils/helper (alphabetical)

// Find recent changes (requires file metadata)
const recent = await callTool('gas_ripgrep', {
  scriptId: "1abc2def...",
  pattern: "TODO",
  sort: "modified"  // NEW: Newest files first
});
```

**Trimmed Output (NEW)**
```typescript
// Clean output for indented code
const classes = await callTool('gas_ripgrep', {
  scriptId: "1abc2def...",
  pattern: "class.*\\{",
  trim: true  // NEW: Remove leading/trailing whitespace
});

// Before trim: "     class Calculator {"
// After trim:  "class Calculator {"
```

**Combined NEW Features**
```typescript
// Code review: find all TODOs, sorted, clean
const review = await callTool('gas_ripgrep', {
  scriptId: "1abc2def...",
  pattern: "TODO|FIXME|HACK",
  ignoreCase: true,  // Find any case variation
  sort: "path",      // Alphabetical order
  trim: true,        // Clean whitespace
  context: 2         // 2 lines of context
});
```

#### Advanced Usage Examples

**Multi-Pattern Search**
```typescript
// Search for multiple patterns (OR logic)
const errorPatterns = await callTool('gas_ripgrep', {
  scriptId: "1abc2def...",
  patterns: ["error", "exception", "fail"],
  sort: "path",
  showStats: true
});
```

**Search and Replace Preview**
```typescript
// Generate replacement suggestions (non-destructive)
const replacements = await callTool('gas_ripgrep', {
  scriptId: "1abc2def...",
  pattern: "console\\.log",
  replace: "Logger.log",
  filesWithMatches: false  // Show full replacement context
});
```

**Filtered Search with Context**
```typescript
// Search specific path with context
const utils = await callTool('gas_ripgrep', {
  scriptId: "1abc2def...",
  pattern: "function.*util",
  path: "utils/*",
  context: 3,
  sort: "path",
  showLineNumbers: true
});
```

### `gas_raw_ripgrep` - High-Performance Search on Raw Content

**⚠️ ADVANCED**: Ripgrep-inspired search on complete file content including CommonJS wrappers and system code.

**NEW FEATURES** (Same as gas_ripgrep):
- ✅ **`ignoreCase`** - Explicit case-insensitive search
- ✅ **`sort`** - Result sorting by path or modification time
- ✅ **`trim`** - Whitespace trimming from result lines

Search **complete file content** including all system wrappers and infrastructure. Processes the same content as `gas_raw_cat` shows - full files with CommonJS module system code.

#### Content Comparison

**Content Searched by `gas_ripgrep` (clean user code):**
```javascript
function add(a, b) {
  return a + b;
}
module.exports = { add };
```

**Content Searched by `gas_raw_ripgrep` (raw with wrappers):**
```javascript
function _main(module, exports, require) {
  function add(a, b) {
    return a + b;
  }
  module.exports = { add };
}
__defineModule__(_main);
```

#### Input Schema
Same as `gas_ripgrep` (see above) - all parameters identical.

#### Usage Examples

**Search System Wrappers**
```typescript
// Find CommonJS infrastructure (only raw_ripgrep finds these)
const wrappers = await callTool('gas_raw_ripgrep', {
  scriptId: "1abc2def...",
  pattern: "_main|__defineModule__",
  sort: "path",
  trim: true
});
```

**Debug Module System**
```typescript
// Find all module initialization patterns
const modules = await callTool('gas_raw_ripgrep', {
  scriptId: "1abc2def...",
  pattern: "globalThis\\.__",
  multiline: true,
  context: 2,
  sort: "path"
});
```

**Case-Insensitive Wrapper Search (NEW)**
```typescript
// Find wrapper variations ignoring case
const wrapperSearch = await callTool('gas_raw_ripgrep', {
  scriptId: "1abc2def...",
  pattern: "_main",
  ignoreCase: true,  // NEW: Find _Main, _MAIN, etc.
  trim: true
});
```

#### Performance Notes

**Ripgrep Feature Parity**: 98% (17/17 major features)
- All core ripgrep search features
- Enhanced with sorting and trimming
- Optimized for LLM-friendly output

**When to Use Each**:
- Use `gas_ripgrep` for normal code searches (cleaner results)
- Use `gas_raw_ripgrep` for debugging module system or searching system code

See [RIPGREP_NEW_FEATURES.md](../RIPGREP_NEW_FEATURES.md) and [RIPGREP_COMPARISON.md](../RIPGREP_COMPARISON.md) for complete documentation.

### `gas_cat` - Read File Contents

**🎯 RECOMMENDED**: Use this instead of `gas_raw_cat` for better workflow integration.

Read the contents of a specific file in a Google Apps Script project with intelligent local/remote resolution.

#### Input Schema
```typescript
interface GasCatInput {
  path: string;  // Format: "scriptId/filename.gs" or just "filename" if current project is set
  preferLocal?: boolean;  // Prefer local file over remote when both exist (default: true)
  workingDir?: string;    // Working directory (defaults to current directory)
  accessToken?: string;
}
```

#### Usage Examples

**Read JavaScript File (Current Project)**
```typescript
// If current project is set via gas_project_set
const fileContent = await callTool('gas_cat', {
  path: 'utils.gs'
});

// Response:
{
  "content": "function _main(\n  module = globalThis.__getCurrentModule(),\n  exports = module.exports,\n  require = globalThis.require\n) {\n  function add(a, b) {\n    return a + b;\n  }\n  \n  exports.add = add;\n}\n\n__defineModule__(_main);",
  "fileName": "utils.gs",
  "fileType": "JAVASCRIPT",
  "lastModified": "2024-01-15T14:30:00Z",
  "size": 123,
  "source": "local"  // Indicates file was read from local cache
}
```

**Read with Explicit Project Path**
```typescript
const fileContent = await callTool('gas_cat', {
  path: 'abc123def456.../Code.gs'
});

// Response:
{
  "content": "function _main(\n  module = globalThis.__getCurrentModule(),\n  exports = module.exports,\n  require = globalThis.require\n) {\n  function myFunction() {\n    Logger.log('Hello World!');\n    return new Date().toISOString();\n  }\n  \n  exports.myFunction = myFunction;\n}\n\n__defineModule__(_main);",
  "fileName": "Code.gs",
  "fileType": "JAVASCRIPT",
  "lastModified": "2024-01-15T14:30:00Z",
  "size": 123,
  "source": "remote"  // Indicates file was read from remote
}
```

### `gas_write` - Create/Update Files with Module Wrapper

**🎯 RECOMMENDED**: Use this instead of `gas_raw_write` for all file operations.

Create new files or update existing files in Google Apps Script projects with automatic module wrapper and intelligent local/remote sync.

#### Key Features
- **Automatic Module Wrapper**: Wraps JavaScript code with proper `_main()` function for `require()` system
- **Intelligent Sync**: Writes to both local and remote by default with conflict detection
- **Type Detection**: Automatically detects JavaScript, HTML, and JSON content
- **Safer Operations**: Preserves existing content during merges (vs. clobbering)

#### Input Schema
```typescript
interface GasWriteInput {
  path: string;         // Format: "scriptId/filename" (WITHOUT extension) - same as gas_raw_write
  content: string;      // Your raw code content (will be wrapped automatically)
  fileType?: 'SERVER_JS' | 'HTML' | 'JSON';  // Optional - auto-detected if not provided
  localOnly?: boolean;  // Write only to local (skip remote sync)
  remoteOnly?: boolean; // Write only to remote (skip local sync)
  workingDir?: string;  // Working directory (defaults to current directory)
  accessToken?: string;
  changeReason?: string; // **NEW**: Custom commit message for git-enabled projects
                        // Example: "feat: Add user authentication"
                        // Default: "Update {filename}" or "Add {filename}"
  projectPath?: string; // **NEW**: Path to nested git project within GAS (polyrepo support)
                        // Example: "backend", "frontend", "libs/shared"
                        // Enables multiple independent git repositories in single GAS project
}
```

#### Usage Examples

**Create New JavaScript File with Module Wrapper**
```typescript
const writeResult = await callTool('gas_write', {
  path: 'abc123def456.../MathUtils',
  content: `
/**
 * Add two numbers
 */
function add(a, b) {
  return a + b;
}

/**
 * Multiply two numbers
 */
function multiply(a, b) {
  return a * b;
}

// Export functions
exports.add = add;
exports.multiply = multiply;`
});

// Response:
{
  "status": "success",
  "path": "abc123def456.../MathUtils",
  "scriptId": "abc123def456...",
  "filename": "MathUtils",
  "size": 187,
  "syncStatus": "synced",
  "localWritten": true,
  "remoteWritten": true,
  "detectedType": "SERVER_JS",
  "moduleWrapperApplied": true,
  "message": "File synced to local and remote with module wrapper"
}
```

**The above content is automatically wrapped as:**
```javascript
function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  /**
   * Add two numbers
   */
  function add(a, b) {
    return a + b;
  }

  /**
   * Multiply two numbers
   */
  function multiply(a, b) {
    return a * b;
  }

  // Export functions
  exports.add = add;
  exports.multiply = multiply;
}

__defineModule__(_main);
```

**Local-Only Write (for testing)**
```typescript
const localResult = await callTool('gas_write', {
  path: 'abc123def456.../TestFile',
  content: 'function test() { return "local only"; }',
  localOnly: true
});

// Response:
{
  "syncStatus": "local-only",
  "localWritten": true,
  "remoteWritten": false,
  "moduleWrapperApplied": true,
  "message": "File written to local only with module wrapper"
}
```

**HTML File (No Module Wrapper)**
```typescript
const htmlResult = await callTool('gas_write', {
  path: 'abc123def456.../index',
  content: '<!DOCTYPE html><html><body><h1>My App</h1></body></html>',
  fileType: 'HTML'
});

// Response:
{
  "detectedType": "HTML",
  "moduleWrapperApplied": false,
  "message": "HTML file written without module wrapper"
}
```

**Differences from `gas_raw_write`:**
- ✅ **Auto-sync**: Writes to both local and remote by default
- ✅ **Module wrapper**: Automatically wraps JavaScript with `_main()` function
- ✅ **File type detection**: Optional `fileType` parameter (auto-detected)
- ✅ **Sync control**: `localOnly`/`remoteOnly` options
- ✅ **Same path format**: Uses identical `scriptId/filename` format
- ✅ **Safer operations**: Merge-friendly vs. clobbering behavior
- ❌ **No positioning**: Cannot specify file order (use `gas_raw_write` for that)

### ⚠️ ADVANCED: `gas_raw_write` - Direct File Writer (Use with Caution)

**⚠️ WARNING**: This tool CLOBBERS (completely overwrites) remote files without merging. Use `gas_write` instead for safer operations.

**When to use `gas_raw_write`:**
- File positioning control (execution order)
- Intentional complete file replacement
- Advanced automation scenarios
- When you explicitly don't want module wrapper

**When NOT to use `gas_raw_write`:**
- Normal development workflow (use `gas_write`)
- Collaborative editing (use `gas_write`)
- When you want module wrapper for `require()` system

### ⚠️ ADVANCED: `gas_raw_cat` - Direct File Reader

**⚠️ NOTE**: Use `gas_cat` instead for better workflow integration.

**When to use `gas_raw_cat`:**
- Explicit project ID control
- Automation with multiple projects
- When you don't want local caching

**When NOT to use `gas_raw_cat`:**
- Normal development workflow (use `gas_cat`)
- When current project is set (use `gas_cat`)
- When you want local-first behavior

### `gas_rm` - Delete Files

Delete files from Google Apps Script projects with safety confirmations.

#### Input Schema
```typescript
interface GasRmInput {
  path: string;  // Format: "scriptId/filename.gs"
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

Move or rename files within Google Apps Script projects (supports cross-project moves).

#### Input Schema
```typescript
interface GasMvInput {
  scriptId: string;  // Required: Google Apps Script project ID (44 characters)
  from: string;      // Source path: filename OR scriptId/filename (overrides scriptId)
  to: string;        // Destination path: filename OR scriptId/filename (overrides scriptId)
  accessToken?: string;
}
```

#### Usage Examples

**Rename File Within Project**
```typescript
const moveResult = await callTool('gas_mv', {
  scriptId: 'abc123def456...',
  from: 'OldName.gs',
  to: 'NewName.gs'
});

// Response:
{
  "status": "moved",
  "from": "OldName.gs",
  "to": "NewName.gs",
  "fromScriptId": "abc123def456...",
  "toScriptId": "abc123def456...",
  "isCrossProject": false,
  "message": "Moved OldName.gs to NewName.gs within project abc123de..."
}
```

**Cross-Project Move**
```typescript
const moveResult = await callTool('gas_mv', {
  scriptId: 'abc123def456...',  // Default project
  from: 'utils.gs',             // Uses default project
  to: 'xyz789abc.../backup.gs'  // Different project (overrides scriptId)
});

// Response:
{
  "status": "moved",
  "from": "utils.gs",
  "to": "xyz789abc.../backup.gs",
  "fromScriptId": "abc123def456...",
  "toScriptId": "xyz789abc...",
  "isCrossProject": true,
  "message": "Moved utils.gs from project abc123de... to backup.gs in project xyz789ab..."
}
```

### `gas_cp` - Copy Files

Copy files within or between Google Apps Script projects (supports cross-project copies).

#### Input Schema
```typescript
interface GasCpInput {
  scriptId: string;  // Required: Google Apps Script project ID (44 characters)
  from: string;      // Source path: filename OR scriptId/filename (overrides scriptId)
  to: string;        // Destination path: filename OR scriptId/filename (overrides scriptId)
  accessToken?: string;
}
```

#### Usage Examples

**Copy File Within Project**
```typescript
const copyResult = await callTool('gas_cp', {
  scriptId: 'abc123def456...',
  from: 'utils.gs',
  to: 'utils-backup.gs'
});

// Response:
{
  "status": "copied",
  "from": "utils.gs",
  "to": "utils-backup.gs",
  "fromScriptId": "abc123def456...",
  "toScriptId": "abc123def456...",
  "isCrossProject": false,
  "size": 1024,
  "message": "Copied utils.gs to utils-backup.gs within project abc123de..."
}
```

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

### `gas_raw_copy` - Remote-to-Remote File Copying

Copy files from one remote Google Apps Script project to another with intelligent merge strategies. This is an advanced tool for power users who need explicit control over remote-to-remote operations.

#### Input Schema
```typescript
interface GasRawCopyInput {
  sourceScriptId: string;      // 44-character source project ID
  destinationScriptId: string; // 44-character destination project ID
  mergeStrategy?: 'preserve-destination' | 'overwrite-destination' | 'skip-conflicts';
  includeFiles?: string[];     // Optional: Only copy specific files
  excludeFiles?: string[];     // Optional: Exclude specific files  
  dryRun?: boolean;           // Show what would be copied
  accessToken?: string;
}
```

#### Usage Examples

**Copy All Files with Preservation (Default)**
```typescript
const copyResult = await callTool('gas_raw_copy', {
  sourceScriptId: '1abc123def456..._source_project_id_44_chars',
  destinationScriptId: '1xyz789ghi012..._dest_project_id_44_chars',
  mergeStrategy: 'preserve-destination'  // Default: keep destination files in conflicts
});

// Response:
{
  "success": true,
  "sourceScriptId": "1abc123def456...",
  "destinationScriptId": "1xyz789ghi012...",
  "mergeStrategy": "preserve-destination",
  "summary": {
    "totalSourceFiles": 8,
    "filteredSourceFiles": 8,
    "attemptedCopy": 5,
    "successfulCopies": 5,
    "errors": 0,
    "newFiles": 5,          // Files that didn't exist in destination
    "conflictFiles": 3,     // Files that existed but were preserved
    "identicalFiles": 0,    // Files that were already identical
    "excludedFiles": 3      // Files preserved due to conflicts
  },
  "details": {
    "newFiles": ["NewUtility", "Helper", "Config", "Models", "API"],
    "conflictFiles": ["Code", "Main", "Utils"],
    "excludedFiles": ["Code (preserved destination)", "Main (preserved destination)", "Utils (preserved destination)"]
  },
  "message": "Successfully copied 5 files from source to destination"
}
```

**Dry Run Analysis**
```typescript
const analysis = await callTool('gas_raw_copy', {
  sourceScriptId: '1abc123def456...',
  destinationScriptId: '1xyz789ghi012...',
  mergeStrategy: 'overwrite-destination',
  dryRun: true
});

// Response:
{
  "dryRun": true,
  "sourceScriptId": "1abc123def456...",
  "destinationScriptId": "1xyz789ghi012...", 
  "mergeStrategy": "overwrite-destination",
  "analysis": {
    "totalSourceFiles": 8,
    "filteredSourceFiles": 8,
    "newFiles": 5,
    "conflictFiles": 3,
    "identicalFiles": 0,
    "excludedFiles": 0,
    "wouldCopy": 8
  },
  "details": {
    "newFiles": ["NewUtility", "Helper", "Config", "Models", "API"],
    "conflictFiles": ["Code", "Main", "Utils"],
    "filesToCopy": [
      {"name": "NewUtility", "action": "new"},
      {"name": "Helper", "action": "new"},
      {"name": "Code", "action": "overwrite"},
      {"name": "Main", "action": "overwrite"}
    ]
  },
  "message": "Would copy 8 files from source to destination"
}
```

**Selective File Copying**
```typescript
const selectiveCopy = await callTool('gas_raw_copy', {
  sourceScriptId: '1abc123def456...',
  destinationScriptId: '1xyz789ghi012...',
  includeFiles: ['Utils', 'Helper', 'Config'],
  excludeFiles: ['TestFile'],
  mergeStrategy: 'skip-conflicts'
});

// Response:
{
  "success": true,
  "summary": {
    "totalSourceFiles": 8,
    "filteredSourceFiles": 2,  // Only Utils, Helper (Config excluded, Utils conflicts)
    "attemptedCopy": 1,        // Only Helper (new file)
    "successfulCopies": 1,
    "newFiles": 1,
    "conflictFiles": 1,        // Utils exists in destination
    "excludedFiles": 1         // Utils skipped due to conflict
  },
  "details": {
    "newFiles": ["Helper"],
    "conflictFiles": ["Utils"],
    "excludedFiles": ["Utils (skipped conflict)"]
  },
  "message": "Successfully copied 1 files from source to destination"
}
```

#### Merge Strategies

- **`preserve-destination`** (default): Keep destination files when conflicts occur
- **`overwrite-destination`**: Replace destination files with source files
- **`skip-conflicts`**: Skip any files that exist in both projects

#### Error Responses

**Authentication Error**
```json
{
  "error": {
    "type": "AuthenticationError", 
    "message": "Authentication required",
    "instructions": ["Use gas_auth({mode: \"start\"}) to authenticate"]
  }
}
```

**Invalid Project ID**
```json
{
  "error": {
    "type": "ValidationError",
    "message": "Invalid sourceScriptId: must be 44 characters",
    "field": "sourceScriptId"
  }
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

Get detailed information about Google Apps Script projects. For container-bound scripts (attached to Google Sheets, Docs, Forms, or Sites), this tool retrieves the URL for the parent container which points to the associated Sheet/Doc/Form/Site.

#### Input Schema
```typescript
interface GasInfoInput {
  scriptId: string;  // Required: Google Apps Script project ID (44 characters)
  includeContent?: boolean;
  accessToken?: string;
}
```

#### Usage Examples

**Get Project Info (Standalone Script)**
```typescript
const projectInfo = await callTool('gas_info', {
  scriptId: 'abc123def456...',
  includeContent: false
});

// Response:
{
  "scriptId": "abc123def456...",
  "title": "My Standalone Script",
  "createTime": "2024-01-01T12:00:00Z",
  "updateTime": "2024-01-15T14:30:00Z",
  "totalFiles": 3,
  "totalSize": 4567,
  "filesByType": {
    "SERVER_JS": 2,
    "JSON": 1
  },
  "prefixGroups": {
    "root": ["Code", "Utils", "appsscript"]
  },
  "structure": ["root"],
  "files": [
    {
      "name": "Code",
      "type": "SERVER_JS",
      "size": 1234
    },
    {
      "name": "Utils",
      "type": "SERVER_JS",
      "size": 2100
    },
    {
      "name": "appsscript",
      "type": "JSON",
      "size": 233
    }
  ]
}
```

**Get Container-Bound Script Info**
```typescript
const projectInfo = await callTool('gas_info', {
  scriptId: 'xyz789ghi012...',
  includeContent: false
});

// Response (includes container metadata):
{
  "scriptId": "xyz789ghi012...",
  "title": "Spreadsheet Script",
  "createTime": "2024-01-01T12:00:00Z",
  "updateTime": "2024-01-15T14:30:00Z",
  "totalFiles": 2,
  "totalSize": 3456,
  "filesByType": {
    "SERVER_JS": 1,
    "JSON": 1
  },
  "prefixGroups": {
    "root": ["Code", "appsscript"]
  },
  "structure": ["root"],
  "container": {
    "containerId": "container123abc...",
    "containerName": "Sales Data 2024",
    "containerType": "spreadsheet",
    "containerUrl": "https://docs.google.com/spreadsheets/d/container123abc.../edit",
    "createdTime": "2023-12-15T10:00:00Z",
    "modifiedTime": "2024-01-15T14:30:00Z"
  },
  "files": [
    {
      "name": "Code",
      "type": "SERVER_JS",
      "size": 2100
    },
    {
      "name": "appsscript",
      "type": "JSON",
      "size": 233
    }
  ]
}
```

**Container Types**
- `spreadsheet` - Google Sheets (URL: `https://docs.google.com/spreadsheets/d/{id}/edit`)
- `document` - Google Docs (URL: `https://docs.google.com/document/d/{id}/edit`)
- `form` - Google Forms (URL: `https://docs.google.com/forms/d/{id}/edit`)
- `site` - Google Sites (URL varies, uses webViewLink from Drive API)
```

### `gas_reorder` - Reorder Files

Change the execution order of files within a Google Apps Script project.

#### Input Schema
```typescript
interface GasReorderInput {
  scriptId: string;  // Required: Google Apps Script project ID (44 characters)
  fileName: string;
  newPosition: number;
  accessToken?: string;
}
```

#### Usage Examples

**Reorder File Position**
```typescript
const reorderResult = await callTool('gas_reorder', {
  scriptId: 'abc123def456...',
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

## 🔄 Local Sync & Project Context Tools

### `gas_project_set` - Set Current Project

Set the current project for the workspace and cache files locally for editing.

#### Input Schema
```typescript
interface GasProjectSetInput {
  project?: string | {
    dev?: boolean;
    staging?: boolean;
    prod?: boolean;
    production?: boolean;
  };
  workingDir?: string;
  accessToken?: string;
}
```

#### Usage Examples

**Set Current Project by Name**
```typescript
const result = await callTool('gas_project_set', {
  project: "my-calculator"
});

// Response:
{
  "success": true,
  "projectName": "my-calculator",
  "scriptId": "abc123def456...",
  "title": "Calculator App",
  "filesCached": 3,
  "localPath": "./src",
  "message": "Set current project to 'my-calculator' and cached 3 files to ./src/"
}
```

**Set Current Project by Script ID**
```typescript
const result = await callTool('gas_project_set', {
  project: "abc123def456ghi789jkl012mno345pqr678stu901vwx234"
});
```

**Set Environment Project**
```typescript
const result = await callTool('gas_project_set', {
  project: { dev: true }
});
```

### `gas_project_get` - Get Current Project

Get information about the current project and its status.

#### Input Schema
```typescript
interface GasProjectGetInput {
  workingDir?: string;
  detailed?: boolean;
  accessToken?: string;
}
```

#### Usage Examples

**Basic Project Info**
```typescript
const info = await callTool('gas_project_get', {});

// Response:
{
  "currentProject": {
    "projectName": "my-calculator",
    "scriptId": "abc123def456...",
    "lastSync": "2024-01-15T14:30:00Z"
  },
  "localPath": "./src",
  "hasLocalFiles": true
}
```

**Detailed Project Status**
```typescript
const detailed = await callTool('gas_project_get', {
  detailed: true
});

// Response includes file comparisons and sync status
{
  "currentProject": { /* ... */ },
  "remoteInfo": {
    "title": "Calculator App",
    "createTime": "2024-01-01T12:00:00Z",
    "updateTime": "2024-01-15T14:30:00Z"
  },
  "localFiles": 3,
  "remoteFiles": 3,
  "fileComparisons": [
    {
      "name": "Code.gs",
      "status": "same",
      "localSize": 1024,
      "remoteSize": 1024
    }
  ],
  "syncStatus": "in-sync"
}
```

### `gas_project_add` - Add Project to Configuration

Add a project to the local workspace configuration.

#### Input Schema
```typescript
interface GasProjectAddInput {
  name: string;
  scriptId: string;
  description?: string;
  environment?: 'dev' | 'staging' | 'production';
  workingDir?: string;
}
```

#### Usage Examples

**Add Regular Project**
```typescript
const result = await callTool('gas_project_add', {
  name: "calculator-app",
  scriptId: "abc123def456ghi789jkl012mno345pqr678stu901vwx234",
  description: "Calculator application for basic math operations"
});

// Response:
{
  "success": true,
  "name": "calculator-app",
  "scriptId": "abc123def456...",
  "description": "Calculator application for basic math operations",
  "configPath": "./.gas-projects.json",
  "message": "Added project 'calculator-app' to configuration"
}
```

**Add Environment Project**
```typescript
const result = await callTool('gas_project_add', {
  name: "calculator-prod",
  scriptId: "xyz789abc012def345ghi678jkl901mno234pqr567stu890",
  environment: "production"
});
```

### `gas_project_list` - List Configured Projects

List all projects in the local workspace configuration.

#### Input Schema
```typescript
interface GasProjectListInput {
  workingDir?: string;
}
```

#### Usage Examples

**List All Projects**
```typescript
const projects = await callTool('gas_project_list', {});

// Response:
{
  "projects": [
    {
      "name": "calculator-app",
      "scriptId": "abc123def456...",
      "description": "Calculator application",
      "type": "project"
    },
    {
      "name": "dev",
      "scriptId": "dev123abc456...",
      "description": "Development Environment",
      "type": "environment"
    }
  ],
  "currentProject": {
    "projectName": "calculator-app",
    "scriptId": "abc123def456...",
    "lastSync": "2024-01-15T14:30:00Z"
  },
  "totalProjects": 2,
  "configPath": "/workspace/path"
}
```

### `gas_pull` - Pull Remote Files

Pull files from a remote Google Apps Script project to the local `./src/` directory.

#### Input Schema
```typescript
interface GasPullInput {
  project?: string | {
    dev?: boolean;
    staging?: boolean;
    prod?: boolean;
    production?: boolean;
  };
  workingDir?: string;
  force?: boolean;
  accessToken?: string;
}
```

#### Usage Examples

**Pull from Current Project**
```typescript
const result = await callTool('gas_pull', {});

// Response:
{
  "success": true,
  "projectName": "calculator-app",
  "scriptId": "abc123def456...",
  "filesPulled": 4,
  "localPath": "./src",
  "message": "Pulled 4 files from 'calculator-app' to ./src/"
}
```

**Pull with Force (Overwrite Local Files)**
```typescript
const result = await callTool('gas_pull', {
  force: true
});
```

**Pull from Specific Environment**
```typescript
const result = await callTool('gas_pull', {
  project: { staging: true }
});
```

**Warning Response (Local Files Exist)**
```typescript
// When local files exist and force: false (default)
{
  "warning": true,
  "message": "Local files exist. Use force: true to overwrite, or check gas_status first.",
  "localFiles": 3,
  "remoteFiles": 4,
  "suggestion": "Run gas_status() to see differences before pulling"
}
```

### `gas_push` - Push Local Files

Push local files from the `./src/` directory to a remote Google Apps Script project.

#### Input Schema
```typescript
interface GasPushInput {
  project?: string | {
    dev?: boolean;
    staging?: boolean;
    prod?: boolean;
    production?: boolean;
  };
  workingDir?: string;
  dryRun?: boolean;
  accessToken?: string;
}
```

#### Usage Examples

**Push to Current Project**
```typescript
const result = await callTool('gas_push', {});

// Response:
{
  "success": true,
  "projectName": "calculator-app",
  "scriptId": "abc123def456...",
  "filesPushed": 3,
  "results": [
    { "name": "Code.gs", "status": "success" },
    { "name": "Utils.gs", "status": "success" },
    { "name": "appsscript.json", "status": "success" }
  ],
  "successCount": 3,
  "errorCount": 0,
  "message": "Successfully pushed 3 files to 'calculator-app'"
}
```

**Dry Run (Preview Changes)**
```typescript
const preview = await callTool('gas_push', {
  dryRun: true
});

// Response:
{
  "dryRun": true,
  "projectName": "calculator-app",
  "scriptId": "abc123def456...",
  "filesToPush": [
    {
      "name": "Code.gs",
      "size": 1024,
      "relativePath": "Code.gs"
    }
  ],
  "totalFiles": 3,
  "message": "Would push 3 files to 'calculator-app'"
}
```

**Push to Production Environment**
```typescript
const result = await callTool('gas_push', {
  project: { production: true }
});
```

### `gas_status` - Compare Local and Remote Files

Show the status and differences between local and remote files.

#### Input Schema
```typescript
interface GasStatusInput {
  project?: string | {
    dev?: boolean;
    staging?: boolean;
    prod?: boolean;
    production?: boolean;
  };
  workingDir?: string;
  detailed?: boolean;
  accessToken?: string;
}
```

#### Usage Examples

**Basic Status Check**
```typescript
const status = await callTool('gas_status', {});

// Response:
{
  "projectName": "calculator-app",
  "scriptId": "abc123def456...",
  "overallStatus": "modified",
  "summary": {
    "same": 2,
    "different": 1,
    "localOnly": 0,
    "remoteOnly": 1
  },
  "localFiles": 3,
  "remoteFiles": 4,
  "localPath": "./src",
  "needsAttention": [
    {
      "name": "Code.gs",
      "status": "different"
    },
    {
      "name": "NewFeature.gs",
      "status": "remote-only"
    }
  ],
  "message": "1 files modified locally, 1 files only exist remotely",
  "suggestions": {
    "toPush": "Use gas_push() to upload local changes",
    "toPull": "Use gas_pull({force: true}) to download remote files"
  }
}
```

**Detailed Status with File-by-File Comparison**
```typescript
const detailed = await callTool('gas_status', {
  detailed: true
});

// Response includes fileComparisons array with full details
{
  "projectName": "calculator-app",
  "scriptId": "abc123def456...",
  "overallStatus": "modified",
  "summary": { /* ... */ },
  "fileComparisons": [
    {
      "name": "Code.gs",
      "status": "different",
      "localPath": "Code.gs",
      "localSize": 1024,
      "remoteSize": 980,
      "lastModified": "2024-01-15T14:30:00Z"
    },
    {
      "name": "Utils.gs",
      "status": "same",
      "localPath": "Utils.gs",
      "localSize": 512,
      "remoteSize": 512,
      "lastModified": "2024-01-15T14:00:00Z"
    },
    {
      "name": "NewFeature.gs",
      "status": "remote-only",
      "remoteSize": 256
    }
  ]
}
```

**In-Sync Status**
```typescript
// When everything is synchronized
{
  "projectName": "calculator-app",
  "scriptId": "abc123def456...",
  "overallStatus": "in-sync",
  "summary": {
    "same": 3,
    "different": 0,
    "localOnly": 0,
    "remoteOnly": 0
  },
  "message": "Local and remote files are in sync"
}
```

#### Status Values

| Status | Description |
|--------|-------------|
| `in-sync` | All files match between local and remote |
| `modified` | Some files have been modified locally |
| `files-added-or-removed` | Files added or removed but no modifications |

---

## ⚡ Execution Tools

### ⭐ RECOMMENDED: `gas_run` - Execute Arbitrary JavaScript Code and Function Calls

**🎯 EXECUTION TOOL**: Direct JavaScript execution in Google Apps Script with automatic deployment handling.

🚀 **POWERFUL CODE EXECUTION**: Execute ANY JavaScript statement or function call directly in Google Apps Script. This tool can invoke arbitrary code in a single statement AND call existing functions that reside in the GAS repository, both returning results.

**Key Features:**
- ✅ **Direct Script ID**: Requires explicit script ID parameter for precise project targeting
- ✅ **Automatic Deployment**: Handles deployment infrastructure automatically
- ✅ **Better Error Handling**: Provides clearer error messages and recovery suggestions
- ✅ **Module System Integration**: Seamlessly works with `require()` system from wrapped files

#### Key Capabilities
- **💻 Arbitrary Code Execution**: Execute any valid JavaScript expression, mathematical operations, object manipulations
- **🔧 Function Invocation**: Call functions defined in your Google Apps Script project files using `require("ModuleName")`
- **📊 Built-in Services**: Access SpreadsheetApp, DriveApp, GmailApp, Session, and all Google Apps Script services
- **🔄 HEAD Deployment Strategy**: Uses HEAD deployments with `/dev` URLs for immediate code updates
- **⚡ Zero Setup**: Automatically creates deployment infrastructure and proxy shim if needed
- **📝 Direct Results**: Returns execution results immediately with JSON serialization
- **🔍 Logging Capture**: Use `Logger.getLog()` inline to capture current execution logs

#### What You Can Execute
| Category | Examples | Use Cases |
|----------|----------|-----------|
| **Math Expressions** | `Math.PI * 2`, `Math.sqrt(16)` | Calculations, formulas |
| **Date/Time** | `new Date().toISOString()`, `Session.getScriptTimeZone()` | Timestamps, timezone info |
| **User Functions** | `require("Calculator").add(5, 3)`, `require("MathLibrary").fibonacci(10)` | Custom business logic |
| **Array Operations** | `[1,2,3].map(x => x * 2)`, `data.filter(item => item.active)` | Data processing |
| **Object Creation** | `{timestamp: new Date(), user: Session.getActiveUser().getEmail()}` | Structured data |
| **Google Services** | `SpreadsheetApp.create("New Sheet").getId()` | Drive, Sheets, Gmail operations |
| **Complex Logic** | `users.find(u => u.role === "admin")?.permissions || []` | Business rules |
| **Logging Capture** | `Logger.getLog()` | Retrieve current execution logs |

#### Input Schema
```typescript
interface GasRunInput {
  scriptId: string;      // REQUIRED: Google Apps Script project ID (25-60 characters)
  js_statement: string;  // ANY JavaScript statement or function call
                        // 💡 TIP: Use Logger.getLog() to capture current execution logs
  autoRedeploy?: boolean;        // Auto-setup deployment (default: true)
  workingDir?: string;           // Working directory
  accessToken?: string;          // Optional access token
}
```

#### Usage Examples

**1. Mathematical Expressions and Calculations**
```typescript
// Simple math
const mathResult = await callTool('gas_run', {
  scriptId: '1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ',
  js_statement: 'Math.PI * 2'
});
// Returns: 6.283185307179586

// Complex calculations
const calculation = await callTool('gas_run', {
  scriptId: '1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ',
  js_statement: 'Math.sqrt(16) + Math.pow(2, 3)'
});
// Returns: 12

// Array reduction
const sum = await callTool('gas_run', {
  scriptId: '1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ',
  js_statement: '[1,2,3,4,5].reduce((sum, num) => sum + num, 0)'
});
// Returns: 15
```

**2. Google Apps Script Built-in Services**
```typescript
// Get timezone
const timezone = await callTool('gas_run', {
  scriptId: '1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ',
  js_statement: 'Session.getScriptTimeZone()'
});
// Returns: "America/Los_Angeles"

// Get user email
const email = await callTool('gas_run', {
  scriptId: '1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ',
  js_statement: 'Session.getActiveUser().getEmail()'
});
// Returns: "user@example.com"

// Create new spreadsheet
const sheetId = await callTool('gas_run', {
  scriptId: '1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ',
  js_statement: 'SpreadsheetApp.create("My New Sheet").getId()'
});
// Returns: "1abc123def456..."

// Get Drive root folder name
const folderName = await callTool('gas_run', {
  scriptId: '1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ',
  js_statement: 'DriveApp.getRootFolder().getName()'
});
// Returns: "My Drive"
```

**3. Call User-Defined Functions in GAS Repository**
```typescript
// Call a fibonacci function you've defined in your project
const fibResult = await callTool('gas_run', {
  scriptId: '1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ',
  js_statement: 'require("MathLibrary").fibonacci(10)'
});
// Returns: 55 (if fibonacci function exists in MathLibrary module)

// Call custom business logic
const total = await callTool('gas_run', {
  scriptId: '1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ',
  js_statement: 'require("Calculator").calculateOrderTotal([{price: 10, qty: 2}, {price: 5, qty: 3}])'
});
// Returns: result of your custom function

// Call data processing function
const processed = await callTool('gas_run', {
  js_statement: 'require("UserUtils").processUserData("john@example.com")'
});
// Returns: result from your custom function

// Alternative: Store module reference for multiple calls
const multiCall = await callTool('gas_run', {
  js_statement: 'const calc = require("Calculator"); calc.add(5, 3) + calc.multiply(2, 4)'
});
// Returns: result of combined operations
```

**4. Complex Data Manipulation**
```typescript
// Object creation with live data
const statusObject = await callTool('gas_run', {
  js_statement: 'JSON.stringify({timestamp: new Date().getTime(), timezone: Session.getScriptTimeZone(), user: Session.getActiveUser().getEmail()})'
});
// Returns: "{\"timestamp\":1705322400000,\"timezone\":\"America/Los_Angeles\",\"user\":\"user@example.com\"}"

// Array processing
const filtered = await callTool('gas_run', {
  js_statement: '[{name: "John", active: true}, {name: "Jane", active: false}].filter(user => user.active).map(user => user.name)'
});
// Returns: ["John"]

// Date manipulation
const dateInfo = await callTool('gas_run', {
  js_statement: 'new Date().toISOString()'
});
// Returns: "2024-01-15T14:30:00.000Z"
```

**5. Using Current Project Context (Recommended)**
```typescript
// When you have a current project set via gas_project_set
const result = await callTool('gas_run', {
  js_statement: 'require("MyModule").myProjectFunction(42)'
});

// Using environment shortcuts
const envResult = await callTool('gas_run', {
  js_statement: 'require("Config").getEnvironmentInfo()',
  scriptId: { dev: true }
});

// Using project name
const namedResult = await callTool('gas_run', {
  js_statement: 'require("DataProcessor").processData()',
  scriptId: 'my-calculator'
});
```

**6. Capturing Execution Logs**
```typescript
// 💡 RECOMMENDED: Use Logger.getLog() to capture current execution logs
const logs = await callTool('gas_run', {
  js_statement: 'Logger.getLog()'
});
// Returns: String containing all log statements from current execution context

// Example: Debug function execution with logging
const debugResult = await callTool('gas_run', {
  js_statement: 'Logger.log("Starting calculation"); const result = Math.PI * 2; Logger.log("Result: " + result); Logger.getLog()'
});
// Returns: "Starting calculation\nResult: 6.283185307179586\n"

// Capture logs from user functions
const functionLogs = await callTool('gas_run', {
  js_statement: 'require("MyModule").debugFunction(); Logger.getLog()'
});
// Returns: All log statements from debugFunction() execution
```

#### Response Format
```typescript
{
  "status": "success",
  "scriptId": "abc123def456...",
  "js_statement": "Math.PI * 2",
  "result": 6.283185307179586,
  "executedAt": "2024-01-15T14:30:00Z"
}
```

### ⚠️ ADVANCED: `gas_raw_run` - Direct Script Execution

**⚠️ NOTE**: Use `gas_run` instead for better workflow integration.

Execute JavaScript code with explicit script ID control. This tool requires you to specify the script ID explicitly.

**When to use `gas_raw_run`:**
- Explicit script ID control
- Automation with multiple projects
- When no current project is set
- Advanced automation scenarios

**When NOT to use `gas_raw_run`:**
- Normal development workflow (use `gas_run`)
- When current project is set (use `gas_run`)
- When you want automatic project context

#### Input Schema
```typescript
interface GasRawRunInput {
  scriptId: string;      // Must specify script ID explicitly
  js_statement: string;  // JavaScript statement to execute
  autoRedeploy?: boolean;
  accessToken?: string;
}
```

#### Usage Examples

**Execute with Explicit Script ID**
```typescript
const result = await callTool('gas_raw_run', {
  scriptId: 'abc123def456...',
  js_statement: 'Math.PI * 2'
});

// Response:
{
  "status": "success",
  "scriptId": "abc123def456...",
  "result": 6.283185307179586
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

Alternative method to create new Google Apps Script projects. Automatically installs full CommonJS infrastructure (require.js, __mcp_exec.gs, ConfigManager) and creates dev/staging/prod deployments with PropertiesService storage.

#### Input Schema
```typescript
interface GasProjectCreateInput {
  title: string;
  parentId?: string;
  accessToken?: string;
}
```

#### Response Schema
```typescript
interface GasProjectCreateResponse {
  status: 'created';
  scriptId: string;
  title: string;
  localName: string;
  addedToLocalConfig: boolean;
  createTime: string;
  updateTime: string;
  parentId?: string;
  infrastructure: {
    require: { installed: boolean };
    exec: { installed: boolean };
    configManager: { installed: boolean };
  };
  deployments: {
    dev: { deploymentId: string; url: string; versionNumber: null };
    staging: { deploymentId: string; url: string; versionNumber: null };
    prod: { deploymentId: string; url: string; versionNumber: null };
  } | null;
  deploymentsCreated: boolean;
  instructions: string;
  infraErrors?: string[];  // Present if any infrastructure installation failed
}
```

**Notes:**
- Full infrastructure automatically installed: `common-js/require`, `common-js/__mcp_exec`, `common-js/ConfigManager`
- Deployments automatically created with ConfigManager storage in PropertiesService
- PropertiesService keys: `DEV_URL`, `DEV_DEPLOYMENT_ID`, `STAGING_URL`, `STAGING_DEPLOYMENT_ID`, `PROD_URL`, `PROD_DEPLOYMENT_ID`
- Project creation succeeds even if deployment creation fails (graceful degradation)

---

### Built-in Deployment Utilities

The `common-js/__mcp_exec` module provides built-in utility functions for deployment environment detection and URL lookup. These functions are designed to be called from within your Google Apps Script code (e.g., toolbar logic, onOpen handlers).

#### `getDeploymentUrls()` - Get Environment URLs

Query the Apps Script API to retrieve deployment URLs for dev, staging, and prod environments.

**Function Signature:**
```javascript
function getDeploymentUrls(): {
  dev: string | null,
  staging: string | null,
  prod: string | null,
  error?: string
}
```

**Usage:**
```javascript
// From server-side GAS code
const urls = require('common-js/__mcp_exec').getDeploymentUrls();

// Example response:
{
  dev: "https://script.google.com/macros/s/abc123.../dev",
  staging: "https://script.google.com/macros/s/def456.../exec",
  prod: "https://script.google.com/macros/s/ghi789.../exec"
}
```

**Behavior:**
- Queries Apps Script API using `UrlFetchApp` with OAuth token
- Filters deployments by ENV_TAGS: `[DEV]`, `[STAGING]`, `[PROD]`
- Returns `null` for environments without deployments
- Falls back to current URL for dev if API call fails
- Requires OAuth scope: `https://www.googleapis.com/auth/script.deployments.readonly`

**Convention:**
- Dev environment always uses HEAD deployment (versionNumber = null)
- Staging and prod use versioned deployments

#### `getCurrentDeploymentType()` - Detect Current Environment

Determine which deployment environment is currently executing.

**Function Signature:**
```javascript
function getCurrentDeploymentType(): 'dev' | 'staging' | 'prod' | 'unknown'
```

**Usage:**
```javascript
// From server-side GAS code
const env = require('common-js/__mcp_exec').getCurrentDeploymentType();

// Use for environment-specific logic
if (env === 'prod') {
  // Production-only behavior
  Logger.log('Running in production');
} else if (env === 'dev') {
  // Development-only behavior
  Logger.log('Running in development');
}
```

**Behavior:**
- Fast path: HEAD deployments end with `/dev` → returns `'dev'` immediately
- Otherwise: Compares `ScriptApp.getService().getUrl()` with deployment URLs
- Returns `'unknown'` if current URL doesn't match any environment

**Example: Environment-Aware Menu**
```javascript
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const urls = require('common-js/__mcp_exec').getDeploymentUrls();

  const menu = ui.createMenu('My App');

  // Add environment-specific menu items
  if (urls.dev) {
    menu.addItem('Open Chat (Dev)', 'openChatDev');
  }
  if (urls.staging) {
    menu.addItem('Open Chat (Staging)', 'openChatStaging');
  }
  if (urls.prod) {
    menu.addItem('Open Chat', 'openChatProd');  // Production without label
  }

  menu.addToUi();
}

function openChatDev() {
  const urls = require('common-js/__mcp_exec').getDeploymentUrls();
  const html = HtmlService.createHtmlOutputFromFile('chat')
    .setWidth(400)
    .setHeight(600);
  html.setContent(html.getContent().replace('{{DEPLOY_URL}}', urls.dev));
  SpreadsheetApp.getUi().showSidebar(html);
}

function openChatStaging() {
  const urls = require('common-js/__mcp_exec').getDeploymentUrls();
  const html = HtmlService.createHtmlOutputFromFile('chat')
    .setWidth(400)
    .setHeight(600);
  html.setContent(html.getContent().replace('{{DEPLOY_URL}}', urls.staging));
  SpreadsheetApp.getUi().showSidebar(html);
}

function openChatProd() {
  const urls = require('common-js/__mcp_exec').getDeploymentUrls();
  const html = HtmlService.createHtmlOutputFromFile('chat')
    .setWidth(400)
    .setHeight(600);
  html.setContent(html.getContent().replace('{{DEPLOY_URL}}', urls.prod));
  SpreadsheetApp.getUi().showSidebar(html);
}
```

**OAuth Scope Required:**
Add to `appsscript.json`:
```json
{
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.deployments.readonly"
  ]
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
      "fileId": "sheet123...",
      "fileName": "My Spreadsheet",
      "containerType": "spreadsheet",
      "containerUrl": "https://docs.google.com/spreadsheets/d/sheet123.../edit",
      "hasScript": true,
      "scriptId": "script123...",
      "scriptUrl": "https://script.google.com/d/script123.../edit",
      "createdTime": "2023-12-15T10:00:00Z",
      "modifiedTime": "2024-01-15T14:30:00Z"
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
  "success": false,
  "error": "Cannot bind existing standalone script \"My Automation Script\" to container \"My Spreadsheet\". Google Apps Script API doesn't support converting standalone scripts to container-bound scripts. Use create_script to create a new container-bound script instead."
}

// Note: Google Apps Script API does not support binding existing standalone scripts to containers.
// Container-bound scripts must be created with the container using gas_create_script.
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
  "success": true,
  "scriptId": "newScript123...",
  "scriptTitle": "Sheet Automation",
  "scriptUrl": "https://script.google.com/d/newScript123.../edit",
  "container": {
    "fileId": "sheet123...",
    "fileName": "My New Spreadsheet",
    "containerType": "spreadsheet",
    "containerUrl": "https://docs.google.com/spreadsheets/d/sheet123.../edit",
    "hasScript": true
  },
  "message": "Created script 'Sheet Automation' and bound to container 'My New Spreadsheet'"
}
```

## 📁 Local Root Management Tools

### `gas_local_set_root` - Set Local Root Directory

Set the local root directory where all GAS project folders will be stored.

#### Input Schema
```typescript
interface GasLocalSetRootInput {
  rootPath: string;
  workingDir?: string;
  accessToken?: string;
}
```

#### Usage Examples

```typescript
const result = await callTool('gas_local_set_root', {
  rootPath: '~/Development/gas-projects'
});

// Response:
{
  "success": true,
  "rootPath": "/Users/username/Development/gas-projects",
  "created": true,
  "message": "Local root directory set successfully"
}
```

### `gas_local_get_root` - Get Current Local Root

Get the current local root directory configuration.

#### Input Schema
```typescript
interface GasLocalGetRootInput {
  workingDir?: string;
  accessToken?: string;
}
```

### `gas_local_list_projects` - List Local Projects

List all local GAS projects found in the local root directory structure.

#### Input Schema
```typescript
interface GasLocalListProjectsInput {
  detailed?: boolean;
  workingDir?: string;
  accessToken?: string;
}
```

### `gas_local_show_structure` - Show Directory Structure

Show the directory structure of the local root with all project folders.

#### Input Schema
```typescript
interface GasLocalShowStructureInput {
  depth?: number; // 1-3, default: 2
  workingDir?: string;
  accessToken?: string;
}
```

---

## ⏰ Trigger Management Tools

### `gas_trigger_list` - List Installable Triggers

List all installable triggers for a Google Apps Script project.

#### Input Schema
```typescript
interface GasTriggerListInput {
  scriptId: string;
  detailed?: boolean;
  accessToken?: string;
}
```

### `gas_trigger_create` - Create New Trigger

Create a new installable trigger for a Google Apps Script project.

#### Input Schema
```typescript
interface GasTriggerCreateInput {
  scriptId: string;
  functionName: string;
  triggerType: 'time' | 'spreadsheet' | 'form' | 'calendar' | 'document' | 'addon' | 'gmail';
  timeOptions?: TimeOptions;
  spreadsheetOptions?: SpreadsheetOptions;
  formOptions?: FormOptions;
  calendarOptions?: CalendarOptions;
  documentOptions?: DocumentOptions;
  addonOptions?: AddonOptions;
  gmailOptions?: GmailOptions;
  accessToken?: string;
}
```

#### Usage Examples

**Time-based Trigger**
```typescript
const trigger = await callTool('gas_trigger_create', {
  scriptId: 'abc123...',
  functionName: 'dailyReport',
  triggerType: 'time',
  timeOptions: {
    interval: 'daily',
    hour: 9,
    timezone: 'America/New_York'
  }
});
```

**Spreadsheet Trigger**
```typescript
const trigger = await callTool('gas_trigger_create', {
  scriptId: 'abc123...',
  functionName: 'onSheetEdit',
  triggerType: 'spreadsheet',
  spreadsheetOptions: {
    eventType: 'onEdit',
    spreadsheetId: 'spreadsheet123...'
  }
});
```

### `gas_trigger_delete` - Delete Trigger

Delete an installable trigger from a Google Apps Script project.

#### Input Schema
```typescript
interface GasTriggerDeleteInput {
  scriptId: string;
  triggerId?: string;
  functionName?: string;
  deleteAll?: boolean;
  accessToken?: string;
}
```

---

## 📊 Process Management Tools

### `gas_process_list` - List User Processes

List information about processes made by or on behalf of a user.

#### Input Schema
```typescript
interface GasProcessListInput {
  pageSize?: number; // 1-50, default: 50
  pageToken?: string;
  userProcessFilter?: UserProcessFilter;
  accessToken?: string;
}
```

### `gas_process_list` - List User/Script Processes

List information about processes made by or on behalf of a user. Supports filtering by scriptId.

**Note:** Consolidated from separate `gas_process_list` and `gas_process_list_script` tools.

#### Input Schema
```typescript
interface GasProcessListInput {
  pageSize?: number; // 1-50, default: 50
  pageToken?: string;
  userProcessFilter?: {
    scriptId?: string;  // Filter by specific script
    deploymentId?: string;
    projectName?: string;
    functionName?: string;
    startTime?: string;  // RFC3339 format
    endTime?: string;    // RFC3339 format
    types?: ProcessType[];
    statuses?: ProcessStatus[];
    userAccessLevels?: UserAccessLevel[];
  };
  accessToken?: string;
}
```

**Migration:** Use `userProcessFilter.scriptId` instead of separate tool.

---

## 📦 Version Management Tools

### `gas_version_get` - Get Version Details

Get details of a specific version of a script project.

#### Input Schema
```typescript
interface GasVersionGetInput {
  scriptId: string;
  versionNumber: number;
  accessToken?: string;
}
```

### `gas_version_list` - List All Versions

List all versions of a script project.

#### Input Schema
```typescript
interface GasVersionListInput {
  scriptId: string;
  pageSize?: number; // 1-50, default: 50
  pageToken?: string;
  accessToken?: string;
}
```

---

## 🔧 Git Operations Tools

### `gas_git_commit` - Add and Commit Synced Files

Add and commit currently synced Google Apps Script project files to git repository.

#### Key Features
- **📁 Smart File Detection**: Automatically finds and adds currently synced GAS project files
- **🔍 Git Status Integration**: Shows status before and after commit operations
- **🛡️ Safety Checks**: Validates git repository and working directory state
- **⚡ Flexible Options**: Support for adding all files or just tracked changes
- **🔄 Dry Run Mode**: Preview changes before committing

#### Input Schema
```typescript
interface GasGitCommitInput {
  message: string;           // Required commit message
  addAll?: boolean;          // Add all modified files (default: false)
  dryRun?: boolean;          // Show what would be committed (default: false)
  workingDir?: string;       // Working directory (optional)
  accessToken?: string;      // Optional access token
}
```

#### Usage Examples

**Basic Commit of Tracked Changes**
```typescript
const commitResult = await callTool('gas_git_commit', {
  message: 'Update GAS project functions'
});

// Response:
{
  "success": true,
  "message": "Successfully committed changes",
  "filesAdded": ["src/summation-test/SummationUtils.gs"],
  "commitHash": "abc123def456...",
  "workingDirectory": "/Users/user/src/mcp_gas"
}
```

**Add All Files and Commit**
```typescript
const commitAllResult = await callTool('gas_git_commit', {
  message: 'Sync all changes from Google Apps Script',
  addAll: true
});

// Response:
{
  "success": true,
  "message": "Successfully committed changes",
  "filesAdded": [
    "src/summation-test/SummationUtils.gs",
    "src/calculator/MathUtils.gs",
    ".gas-projects.json"
  ],
  "commitHash": "def456abc789...",
  "workingDirectory": "/Users/user/src/mcp_gas"
}
```

**Dry Run Preview**
```typescript
const dryRunResult = await callTool('gas_git_commit', {
  message: 'Preview commit',
  addAll: true,
  dryRun: true
});

// Response:
{
  "success": true,
  "dryRun": true,
  "message": "Dry run completed - no changes made",
  "wouldAdd": [
    "src/summation-test/SummationUtils.gs",
    "src/calculator/MathUtils.gs"
  ],
  "wouldCommit": "Preview commit",
  "workingDirectory": "/Users/user/src/mcp_gas"
}
```

### `git_feature` - Feature Branch Workflow Management

**NEW**: Consolidated tool for managing feature branches with 5 operations: start, finish, rollback, list, and switch.

#### Key Features
- **🌿 Auto Feature Branches**: Create branches with `llm-feature-{name}` naming convention
- **🚀 Auto Git Init**: Automatically initializes git repository if .git directory missing
- **⚙️ Smart Config Detection**: Uses global git config when available, falls back to sensible defaults
- **🔀 Squash Merge**: Squash all commits when finishing features
- **🧹 Branch Cleanup**: Delete branches after merge or rollback
- **📋 Branch Listing**: View all feature branches and current branch
- **🔄 Branch Switching**: Switch between branches safely
- **🛡️ Safety Checks**: Validates uncommitted changes, branch existence, naming patterns
- **🎯 Dynamic Detection**: Auto-detects main vs master as default branch
- **🔒 Security**: Branch name sanitization prevents shell injection

#### Input Schema
```typescript
interface GitFeatureInput {
  operation: 'start' | 'finish' | 'rollback' | 'list' | 'switch';
  scriptId: string;
  projectPath?: string;        // Optional path to nested git project (polyrepo support)
  featureName?: string;        // Required for 'start' - alphanumeric and hyphens only
  branch?: string;             // Optional for 'finish'/'switch', required for 'rollback'
  deleteAfterMerge?: boolean;  // For 'finish' operation (default: true)
}
```

#### Usage Examples

**Start New Feature Branch**
```typescript
const startResult = await callTool('git_feature', {
  operation: 'start',
  scriptId: 'abc123def456...',
  featureName: 'user-auth'
});

// Response:
{
  "status": "success",
  "operation": "start",
  "branch": "llm-feature-user-auth",
  "created": true,
  "previousBranch": "main"
}
```

**List All Feature Branches**
```typescript
const listResult = await callTool('git_feature', {
  operation: 'list',
  scriptId: 'abc123def456...'
});

// Response:
{
  "status": "success",
  "operation": "list",
  "branches": [
    "llm-feature-user-auth",
    "llm-feature-api-refactor",
    "llm-feature-auto-20250121143022"
  ],
  "current": "llm-feature-user-auth",
  "total": 3
}
```

**Switch Between Branches**
```typescript
const switchResult = await callTool('git_feature', {
  operation: 'switch',
  scriptId: 'abc123def456...',
  branch: 'llm-feature-api-refactor'
});

// Response:
{
  "status": "success",
  "operation": "switch",
  "branch": "llm-feature-api-refactor",
  "switched": true,
  "isFeatureBranch": true
}
```

**Finish Feature (Squash Merge to Main)**
```typescript
const finishResult = await callTool('git_feature', {
  operation: 'finish',
  scriptId: 'abc123def456...',
  deleteAfterMerge: true  // Default: true
});

// Response:
{
  "status": "success",
  "operation": "finish",
  "branch": "llm-feature-user-auth",
  "squashCommit": "abc123d",
  "commitMessage": "Feature: user-auth",
  "deleted": true,
  "currentBranch": "main"
}
```

**Rollback Feature (Delete Without Merging)**
```typescript
const rollbackResult = await callTool('git_feature', {
  operation: 'rollback',
  scriptId: 'abc123def456...',
  branch: 'llm-feature-user-auth'
});

// Response:
{
  "status": "success",
  "operation": "rollback",
  "branch": "llm-feature-user-auth",
  "deleted": true,
  "uncommittedChangesLost": false,
  "currentBranch": "main"
}
```

**Polyrepo Support (Nested Git Repositories)**
```typescript
// Work with nested git repo in "backend" subdirectory
const polyrepoResult = await callTool('git_feature', {
  operation: 'start',
  scriptId: 'abc123def456...',
  featureName: 'auth-service',
  projectPath: 'backend'  // Enables polyrepo support
});

// Response:
{
  "status": "success",
  "operation": "start",
  "branch": "llm-feature-auth-service",
  "created": true,
  "previousBranch": "main"
}
```

#### Git Auto-Initialization Behavior

**Automatic Repository Setup**: The `git_feature` tool automatically initializes git repositories when the `.git` directory is missing, providing a seamless development experience.

**Initialization Strategy**:
1. **Check for .git directory** - If exists, skip initialization
2. **Run git init** - Creates new git repository
3. **Detect global config** - Checks `git config --global user.name` and `user.email`
4. **Apply configuration**:
   - **If global config exists**: Uses global settings automatically
   - **If no global config**: Sets local defaults (`user.name="MCP Gas"`, `user.email="mcp@gas.local"`)

**Example Scenarios**:

**Scenario 1: Global Git Config Available**
```bash
# User has global git config
$ git config --global user.name
"John Doe"

$ git config --global user.email
"john@example.com"
```

When `git_feature` auto-initializes:
```
[GIT-INIT] Initializing git repository at /path/to/repo
[GIT-INIT] ✓ Git repository initialized
[GIT-INIT] Using global git config (name="John Doe", email="john@example.com")
```

**Scenario 2: No Global Git Config**
```bash
# No global git config set
$ git config --global user.name
# (empty)
```

When `git_feature` auto-initializes:
```
[GIT-INIT] Initializing git repository at /path/to/repo
[GIT-INIT] ✓ Git repository initialized
[GIT-INIT] No global git config found, setting local defaults
[GIT-INIT] Set default git config (user.name="MCP Gas", user.email="mcp@gas.local")
```

**Shared with Write Operations**: The auto-initialization logic is shared between `git_feature` and `write`/`raw_write` tools via the `ensureGitInitialized()` utility in `src/utils/gitInit.ts`, ensuring consistent behavior across all git operations.

**Benefits**:
- ✅ No manual `git init` required
- ✅ Respects user's global git configuration
- ✅ Graceful fallback to sensible defaults
- ✅ Automatic .gitignore creation for new repositories
- ✅ Consistent experience across all tools

#### Operation Details

**start**: Create New Feature Branch
- **Requirements**:
  - Not already on a feature branch
  - No uncommitted changes
  - Valid feature name (alphanumeric + hyphens only)
- **Behavior**: Creates `llm-feature-{featureName}` branch from current branch
- **Example**: `featureName: "user-auth"` → creates `llm-feature-user-auth`

**finish**: Squash Merge to Main/Master
- **Requirements**:
  - Currently on a feature branch (or specify with `branch` parameter)
  - No uncommitted changes
- **Behavior**:
  - Auto-detects default branch (main or master)
  - Squash merges all feature commits into single commit
  - Creates commit message: `"Feature: {description}"`
  - Optionally deletes branch (default: true)

**rollback**: Delete Branch Without Merging
- **Requirements**:
  - Branch must be a feature branch (starts with `llm-feature-`)
  - Branch must exist
- **Behavior**:
  - Switches to default branch if currently on target branch
  - Force deletes branch (discards all commits)
  - Warns if uncommitted changes will be lost

**list**: Show All Feature Branches
- **Requirements**: None
- **Behavior**: Lists all branches starting with `llm-feature-`
- **Returns**: Branch list, current branch, total count

**switch**: Switch Between Branches
- **Requirements**:
  - Branch must exist
  - No uncommitted changes
- **Behavior**: Checks out specified branch

#### Error Handling

**Invalid Feature Name**
```json
{
  "error": {
    "type": "ValidationError",
    "message": "featureName must contain only alphanumeric characters and hyphens",
    "field": "featureName",
    "value": "invalid name with spaces"
  }
}
```

**Already on Feature Branch**
```json
{
  "error": {
    "message": "Already on feature branch: llm-feature-user-auth. Finish or switch branches before starting new feature.",
    "type": "OperationError"
  }
}
```

**Uncommitted Changes Detected**
```json
{
  "error": {
    "message": "Uncommitted changes detected. Commit or stash changes before switching branches.",
    "type": "GitStateError"
  }
}
```

**Branch Not Found**
```json
{
  "error": {
    "type": "ValidationError",
    "message": "Branch 'non-existent' not found. Available branches: main, llm-feature-user-auth",
    "field": "branch",
    "value": "non-existent"
  }
}
```

---

### Git Auto-Commit Integration

**Automatic Feature Branch Creation**: When `write` or `raw_write` detects a git repository, it automatically creates feature branches and commits changes.

**Example: Write with Automatic Commit**
```typescript
const writeResult = await callTool('gas_write', {
  path: 'abc123def456.../UserAuth',
  content: 'function authenticate() { return true; }',
  changeReason: 'feat: Add user authentication'  // Custom commit message
});

// Response includes git information:
{
  "success": true,
  "path": "abc123def456.../UserAuth",
  "size": 45,
  "git": {
    "enabled": true,
    "source": "breadcrumb",
    "gitPath": "/Users/user/gas-repos/project-abc123def456",
    "branch": "llm-feature-auto-20250121143022",  // Auto-created
    "branchCreated": true,
    "commitHash": "def456a",
    "commitMessage": "feat: Add user authentication",
    "hookModified": false
  }
}
```

**Git Discovery Process**:
1. **Phase A (Local Filesystem)**: Scans for git repo at `~/gas-repos/project-{scriptId}/`
2. **Phase B (GAS Breadcrumbs)**: Reads `.git/config` from GAS project

**Workflow**:
1. Write operation detects git repository
2. Auto-creates feature branch if on main/master: `llm-feature-auto-{timestamp}`
3. Writes file locally → runs git hooks → commits atomically
4. Pushes to remote GAS
5. Rolls back on failure (atomic operation)

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

### 3. Deployment Workflow (dev → staging → prod)

**New Unified Deploy Tool**: All deployment operations now use the consolidated `deploy` tool with promote/rollback/status/reset operations.

#### Initial Setup

```typescript
// Create all 3 environments (dev, staging, prod)
const result = await callTool('deploy', {
  operation: 'reset',
  scriptId: 'abc123...'
});

// Returns deployment IDs and URLs for dev, staging, prod
console.log('Dev URL:', result.dev.url);
console.log('Staging URL:', result.staging.url);
console.log('Prod URL:', result.prod.url);
```

#### Promote dev → staging (Create Version)

```typescript
// Promote current HEAD to staging (creates version snapshot)
const promoteToStaging = await callTool('deploy', {
  operation: 'promote',
  environment: 'staging',
  scriptId: 'abc123...',
  description: 'v1.0 Release Candidate - Bug fixes and new features'
});

// Creates version 1 and updates staging deployment
console.log('Version:', promoteToStaging.version.versionNumber); // 1
console.log('Staging URL:', promoteToStaging.deployment.url);
```

#### Promote staging → prod

```typescript
// Promote tested staging version to production
const promoteToProd = await callTool('deploy', {
  operation: 'promote',
  environment: 'prod',
  scriptId: 'abc123...'
});

// Updates prod to staging's version (no description needed)
console.log('Prod Version:', promoteToProd.version.versionNumber);
console.log('Prod URL:', promoteToProd.deployment.url);
```

#### Check Deployment Status

```typescript
// View all environments
const status = await callTool('deploy', {
  operation: 'status',
  scriptId: 'abc123...'
});

// Returns current state of all 3 environments
console.log('Dev:', status.dev.versionNumber);      // null (HEAD)
console.log('Staging:', status.staging.versionNumber); // 1
console.log('Prod:', status.prod.versionNumber);     // 1
```

#### Rollback Production

```typescript
// Automatic rollback to previous version
const rollback = await callTool('deploy', {
  operation: 'rollback',
  environment: 'prod',
  scriptId: 'abc123...'
});

// Or rollback to specific version
const rollbackToVersion = await callTool('deploy', {
  operation: 'rollback',
  environment: 'prod',
  scriptId: 'abc123...',
  toVersion: 3
});
```

**Complete Guide**: See `docs/DEPLOYMENT_WORKFLOW.md` for detailed workflow documentation

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