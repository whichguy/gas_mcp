# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

### Core Development
```bash
npm install                      # Install dependencies
npm run build                    # Production build (TypeScript → JavaScript)
npm run build:dev                # Development build with source maps
npm run dev                      # Watch mode with auto-rebuild
npm start                        # Build and start MCP server
npm run clean                    # Clean dist/ directory
```

### Testing
```bash
npm test                         # Run core system tests (30s timeout)
npm run test:unit                # Unit tests for individual modules
npm run test:integration         # Real GAS API tests (requires auth, 5min timeout)
npm run test:system              # System-level MCP protocol tests
npm run test:security            # Security and validation tests
npm run test:performance         # Performance tests (60s timeout)
npm run test:verification        # API schema and compliance verification
npm run test:all                 # Run unit + system tests

# Specialized verification tests
npm run test:git                 # Verify git sync operations
npm run test:auth                # Verify authentication flow
npm run test:files               # Verify file operations
npm run test:project             # Verify project management
npm run test:execution           # Verify code execution
npm run test:server              # Verify MCP server functionality

# Run single test file
npx mocha test/system/protocol/consolidated-core.test.ts --timeout 30000

# Debug test with logging
DEBUG=mcp:* npm test
```

### Code Quality
```bash
npm run lint                     # ESLint with auto-fix
npm run bundle:analyze           # Analyze bundle size

# Production testing and verification
npm run test:production          # Production readiness report
npm run test:all-verify          # Run all verification tests
```

## Architecture Overview

This is a Model Context Protocol (MCP) server that bridges AI assistants with Google Apps Script (GAS). It provides 50 tools for creating, managing, and executing GAS projects through a unified interface.

### Session Management
The server uses in-memory session management (`SessionAuthManager`) for handling multiple concurrent MCP clients. Sessions are stored in a global `Map` and are lost on server restart, requiring re-authentication. This simplified approach removes filesystem dependencies and complex locking since MCP is half-duplex.

### Core Flow: MCP Client ↔ MCP Server ↔ Google Apps Script API

1. **MCP Protocol Layer** (`src/server/mcpServer.ts`)
   - Handles MCP protocol communication via stdio
   - Registers and dispatches tool calls (all 50 tools imported and registered)
   - Manages error responses and tool results
   - Entry point: `src/index.ts` starts the server

2. **Tool Layer** (`src/tools/`)
   - Each tool extends `BaseTool` (`src/tools/base.ts`) with standardized interface
   - Tools handle parameter validation, authentication, and execution
   - Smart tools (mcp__gas__*) provide enhanced functionality with local caching
   - Raw tools (mcp__gas__raw_*) provide direct API access
   - Specialized tools: filesystem.ts, execution.ts, deployments.ts, gitSync.ts, etc.

3. **Authentication Layer** (`src/auth/`)
   - OAuth 2.0 PKCE flow implementation (`oauthClient.ts`)
   - Session-based token management with automatic refresh (`sessionManager.ts`)
   - Auth state management (`authState.ts`)
   - Token storage in memory (no filesystem persistence)

4. **API Client Layer** (`src/api/gasClient.ts`)
   - Google Apps Script API v1 client
   - Rate limiting (`rateLimiter.ts`) and retry logic
   - Path parsing utilities (`pathParser.ts`)
   - Error transformation for MCP

### Core Capabilities

This MCP server provides three breakthrough capabilities for Google Apps Script development:

#### 1. Full CommonJS Module System

Write GAS code exactly like Node.js with automatic module system support:

**What You Get**:
- `require('ModuleName')` - Import other modules with automatic dependency resolution
- `module.exports = {...}` - Export functionality from your modules
- `exports.func = ...` - Shorthand export syntax
- Automatic wrapping/unwrapping - Write clean code, system handles module infrastructure

**Example Usage**:
```javascript
// In Calculator.js - write clean user code
function add(a, b) { return a + b; }
function multiply(a, b) { return a * b; }
module.exports = { add, multiply };

// In Main.js - use require() naturally
const calc = require('Calculator');
const result = calc.add(5, calc.multiply(2, 3));  // Returns 11
```

**Behind the Scenes**: Tools like `gas_cat` show clean user code without wrappers. `gas_write` automatically wraps your code in `_main()` functions. `CommonJS.js` provides runtime module loading and caching.

**Module Loading Control**: The `gas_write` tool supports optional `moduleOptions` parameter to control when modules load in the CommonJS system:

```javascript
// Eager loading (loadNow=true) - Module executes at script startup
// Use for: Web app handlers (doGet/doPost), triggers (onOpen/onEdit/onInstall)
gas_write({
  scriptId: "...",
  path: "WebApp",
  content: "function doGet(e) { return HtmlService.createHtmlOutput('Hello'); }",
  moduleOptions: { loadNow: true }  // Module._main() executes immediately at startup
})

// Lazy loading (loadNow=false) - Module executes on first require()
// Use for: Utility modules that are only needed via require() calls
gas_write({
  scriptId: "...",
  path: "Utils",
  content: "function formatDate(date) { return Utilities.formatDate(date, 'GMT', 'yyyy-MM-dd'); }",
  moduleOptions: { loadNow: false }  // Module._main() executes on first require("Utils")
})

// Preservation mode (omit moduleOptions) - RECOMMENDED for updates
// Reads existing file and preserves current loadNow setting
gas_write({
  scriptId: "...",
  path: "existing",
  content: "// Updated code"
  // No moduleOptions = preserves existing loadNow setting from remote file
})

// Default for new files (omit moduleOptions)
// Creates lazy-loading module (equivalent to loadNow=false/null)
gas_write({
  scriptId: "...",
  path: "Helper",
  content: "function helper() {...}"
  // No moduleOptions = default lazy loading (null) for new files
})
```

**CommonJS Loading Behavior**:
- `loadNow: true` = **Eager loading** - `module._main()` executes at script startup (similar to Webpack's "eager" mode)
- `loadNow: false` or `null` = **Lazy loading** - `module._main()` executes on first `require()` call
- Omitting `moduleOptions` = **Preservation mode** - Reads existing file setting (~200-500ms overhead) or uses default (lazy) for new files

**When to use `loadNow: true`** (Eager Loading):
- **Web app handlers**: `doGet()`, `doPost()` - Must be available when HTTP requests arrive
- **Trigger functions**: `onOpen()`, `onEdit()`, `onInstall()` - Called automatically by Google Apps Script
- **Event registrations**: Modules that export `__events__` object - Need immediate registration
- **Global functions**: Any functions that need to be callable immediately without `require()`

**When to use `loadNow: false`** (Explicit Lazy Loading):
- **Utility libraries**: Helper functions and formatters
- **Required modules**: Code only loaded via `require()` calls
- **Internal logic**: Business logic modules used by other modules
- **Performance optimization**: Large modules that are rarely used

**When to omit `moduleOptions`** (RECOMMENDED):
- **Updating existing files**: Preserves the current `loadNow` setting automatically
- **New utility files**: Uses default lazy loading behavior
- **Bulk operations**: Explicitly set `loadNow` to skip preservation API call overhead

**Performance Note**: Omitting `moduleOptions` requires an API call (~200-500ms) to read the existing file. For bulk operations on multiple files, provide explicit `loadNow` values to skip this lookup.

#### 2. Ad-hoc Code Execution

Run any JavaScript expression instantly without deployment or wrapper functions:

**What You Can Execute**:
- Mathematical expressions: `Math.PI * 2`
- Google Apps Script services: `DriveApp.getRootFolder().getName()`
- Your project functions: `require("Utils").processData([1,2,3])`
- Complex workflows: Multi-line operations with full GAS API access
- Logger output automatically captured and returned

**Example Usage**:
```javascript
// Execute one-liners instantly
gas_run({scriptId: "...", js_statement: "new Date().toISOString()"})

// Call your project functions
gas_run({scriptId: "...", js_statement: "require('Calculator').fibonacci(10)"})

// Complex data operations
gas_run({scriptId: "...", js_statement: `
  const data = require('API').fetchData();
  const sheet = SpreadsheetApp.create('Report');
  sheet.getActiveSheet().getRange(1,1,data.length,3).setValues(data);
  return sheet.getId();
`})
```

**Behind the Scenes**: The `gas_run` tool uses `__mcp_gas_run.js` execution infrastructure and deployment management to run code in Google's cloud environment without manual deployment steps.

#### 3. Unix-inspired Command Interface

Familiar commands for intuitive GAS project management (note: GAS uses filename prefixes, not real directories):

**Core Commands**:
- `gas_cat utils/helper` - Read file contents (unwraps CommonJS for editing)
- `gas_ls utils/*` - List files matching pattern
- `gas_grep "function.*test"` - Search code with regex
- `gas_find {name: "*.test"}` - Find files by pattern
- `gas_sed {pattern: "console\\.log", replacement: "Logger.log"}` - Find/replace
- `gas_ripgrep` - High-performance multi-pattern search (98% ripgrep feature parity)

**New Ripgrep Features** (Added 2025):
- `ignoreCase: true` - Explicit case-insensitive search (ripgrep `-i`)
- `sort: 'path' | 'modified'` - Result sorting (enhancement over ripgrep)
- `trim: true` - Whitespace trimming (enhancement over ripgrep)

**Example Workflows**:
```bash
# Find all TODO comments
gas_grep {scriptId: "...", pattern: "TODO:|FIXME:"}

# List all test files
gas_find {scriptId: "...", name: "*test*"}

# Replace all console.log with Logger.log
gas_sed {scriptId: "...", pattern: "console\\.log", replacement: "Logger.log"}

# Advanced ripgrep with new features
gas_ripgrep {
  scriptId: "...",
  pattern: "TODO|FIXME|HACK",
  ignoreCase: true,
  sort: "path",
  trim: true,
  context: 2
}
```

**Behind the Scenes**: Smart tools (cat, grep, sed) automatically unwrap CommonJS for clean editing. Raw variants (raw_cat, raw_grep) preserve exact content including system wrappers.

#### 4. File Integrity and Git Integration

Verify file integrity and detect changes without downloading entire file contents using Git-compatible SHA-1 checksums:

**LS Tool with Checksums** (Quick verification):
- `gas_ls` with `checksums: true` parameter adds Git SHA-1 to each file
- Default behavior omits checksums for faster listing
- Useful for quick file verification in large projects

**File Status Tool** (Comprehensive analysis):
- Dedicated tool for file verification and change detection
- Supports multiple hash types: Git-compatible SHA-1, SHA-256, MD5
- Pattern matching with wildcards for bulk operations
- Rich metadata: lines, size, encoding, timestamps, modification user

**Example Workflows**:
```typescript
// Quick verification during listing
gas_ls({
  scriptId: "...",
  path: "*",
  checksums: true  // Adds gitSha1 to each file
})

// Comprehensive file analysis
gas_file_status({
  scriptId: "...",
  path: "utils/helper.gs",
  hashTypes: ["git-sha1", "sha256", "md5"],  // Multiple hash algorithms
  includeMetadata: true  // Lines, size, timestamps, user
})

// Pattern-based verification
gas_file_status({
  scriptId: "...",
  path: "utils/*",  // Wildcard matching
  hashTypes: ["git-sha1"]
})

// Detect file changes without downloading
const status1 = gas_file_status({ scriptId: "...", path: "config.gs" });
// ... make some changes ...
const status2 = gas_file_status({ scriptId: "...", path: "config.gs" });
// Compare status1.files[0].hashes['git-sha1'] vs status2.files[0].hashes['git-sha1']
```

**Git Integration Use Cases**:
- **Change Detection**: Compare GAS files with local Git repository using `git hash-object`
- **Integrity Verification**: Ensure files haven't changed since last sync
- **Selective Downloads**: Only download files with SHA mismatches
- **Build Optimization**: Skip unchanged files during deployment

**Git SHA-1 Compatibility**:
The Git-compatible SHA-1 uses the same blob format as `git hash-object`:
```bash
# Verify locally: the SHA-1 from gas_file_status should match
echo -n "content" | git hash-object --stdin
```

Format: `sha1("blob " + <size> + "\0" + <content>)`

**Performance Considerations**:
- `gas_ls` with `checksums: false` (default) - Fastest for large directories
- `gas_ls` with `checksums: true` - Adds ~50-100ms per file for checksum computation
- `gas_file_status` - Best for detailed analysis of specific files or patterns
- Supports up to 200 files per request (default 50)

---

### Key Architectural Patterns

#### Tool Implementation Pattern
Every tool follows this structure:
```typescript
export class GasTool extends BaseTool {
  public name = 'mcp__gas__tool_name';  // Note: MCP naming with mcp__gas__ prefix
  public description = 'User-facing description';
  public inputSchema = {
    type: 'object',
    properties: { /* JSON Schema with validation */ },
    required: ['fieldName'],
    additionalProperties: false
  };

  async execute(params: any): Promise<any> {
    // 1. Validate input parameters
    const validated = this.validate.scriptId(params.scriptId);

    // 2. Get authentication token
    const accessToken = await this.getAuthToken(params);

    // 3. Perform operation with error handling
    try {
      const result = await this.gasClient.operation(validated, accessToken);
      return this.formatSuccess(result);
    } catch (error) {
      throw GASErrorHandler.handleApiError(error);
    }
  }
}
```

#### CommonJS Module System for GAS
The server automatically manages a CommonJS-like module system for GAS:
- **Write**: User code is wrapped in `_main()` function with module/exports/require
- **Read**: Wrapper is removed to show clean user code
- **Execute**: `CommonJS.js` and `__mcp_gas_run.js` provide runtime support
- Files use `__defineModule__(_main)` pattern for module registration

#### Virtual File Translation
Dotfiles are automatically translated for GAS compatibility:
- `.git` → `.git.gs` (stored as CommonJS module)
- `.gitignore` → `.gitignore.gs`
- `.env` → `.env.gs`
- Translation happens transparently in both directions using period prefix
- Handled by `src/utils/fileTransformations.ts` (also does Markdown ↔ HTML conversion)

#### Local/Remote Synchronization
Three-layer file access pattern:
1. **Local cache** (`./src/` or project directory)
2. **Remote GAS** (Google Apps Script project)
3. **Git mirror** (`~/gas-repos/project-[scriptId]/` for Git integration)

Smart tools check local first, then remote, with automatic sync. All projects use the standardized `~/gas-repos` pattern.

### Git Sync Architecture (NEW)

Safe Git synchronization with separation of concerns:

#### Core Tools (5 total, replacing old 12 tools)
- **gas_git_init** - Initialize git association with `.git.gs` marker file
- **gas_git_sync** - Safe pull-merge-push synchronization (ALWAYS pulls first)
- **gas_git_status** - Check git association and sync status
- **gas_git_set_sync_folder** - Set local sync folder for git operations
- **gas_git_get_sync_folder** - Query current sync folder location

#### Key Concepts
- **`.git.gs` file** - Self-documenting association marker in GAS project (uses period prefix)
- **Sync Folders** - Local directories where LLMs run standard git commands (~/gas-repos pattern)
- **Pull-Merge-Push** - Always pulls from GAS first, merges locally, pushes back
- **File Transformations** - Automatic README.md ↔ README.html, dotfile handling with period prefix

#### Recommended Workflow
```typescript
// 1. Initialize association
mcp__gas__git_init({ scriptId: "...", repository: "https://github.com/..." })

// 2. Clone in sync folder (LLM uses standard git)
// cd /sync/folder && git clone ...

// 3. Sync files (safe merge)
mcp__gas__git_sync({ scriptId: "..." })  // ALWAYS pull-merge-push

// 4. Commit and push (standard git)
// git add -A && git commit -m "..." && git push
```

See `docs/GIT_SYNC_WORKFLOWS.md` for complete documentation.

### Project Context Management

The server maintains project context for simplified operations:
- **mcp__gas__project_set** - Set current project and auto-pull files
- **mcp__gas__project_list** - List configured projects
- **mcp__gas__project_create** - Create new projects with infrastructure setup
- Current project stored in `gas-config.json`
- Tools auto-resolve script IDs from current context

### Error Handling Hierarchy

```
MCPGasError (base)
├── ValidationError     - Parameter validation failures
├── AuthenticationError - OAuth/token issues
├── FileOperationError  - File access problems
├── QuotaError         - API quota exceeded
└── ApiError           - Google API errors
```

All errors are transformed to MCP-compatible format with helpful messages.

## Configuration Files

- **gas-config.json** - Unified configuration
  - OAuth settings
  - Project definitions
  - Environment mappings
  - Local sync paths

- **oauth-config.json** - OAuth 2.0 credentials (not in version control)
  - Download from Google Cloud Console
  - Desktop application type required

- **.auth/** - Session token storage
  - Automatic token refresh
  - Multiple session support

## Tool Architecture & Naming Conventions

### Tool Categories and Naming
The MCP server provides 50 tools organized into logical categories:

#### Smart Tools (CommonJS Processing)
- **mcp__gas__cat, mcp__gas__write, mcp__gas__cp** - Handle CommonJS wrapping/unwrapping automatically
- **mcp__gas__ls, mcp__gas__rm, mcp__gas__mv, mcp__gas__mkdir** - Directory and file operations with smart path handling
- **mcp__gas__file_status** - Comprehensive file verification with Git-compatible SHA-1, SHA-256, MD5 checksums
- **mcp__gas__run, mcp__gas__info, mcp__gas__reorder** - Execution and project management
- **mcp__gas__version_create, mcp__gas__deploy_create** - Deployment and versioning
- **mcp__gas__grep, mcp__gas__find, mcp__gas__ripgrep, mcp__gas__sed** - Search and text processing tools

#### Raw Tools (Exact Content Preservation)
- **mcp__gas__raw_cat, mcp__gas__raw_write, mcp__gas__raw_cp** - Preserve exact content including CommonJS wrappers
- **mcp__gas__raw_ls, mcp__gas__raw_rm, mcp__gas__raw_mv** - Low-level file operations
- **mcp__gas__raw_find, mcp__gas__raw_grep, mcp__gas__raw_ripgrep, mcp__gas__raw_sed** - Raw search and processing tools

#### Git Integration Tools
- **mcp__gas__git_init, mcp__gas__git_sync, mcp__gas__git_status** - Core Git synchronization
- **mcp__gas__git_set_sync_folder, mcp__gas__git_get_sync_folder** - Local sync management

#### Project Management Tools
- **mcp__gas__project_set, mcp__gas__project_list, mcp__gas__project_create** - Project context management
- **mcp__gas__auth** - OAuth authentication workflow

### Key Design Principles
- **Flat Function Architecture**: Each tool is a separate function following MCP best practices
- **Smart vs Raw**: Smart tools process CommonJS, raw tools preserve exact content
- **Consistent Naming**: mcp__gas__[action] for smart tools, mcp__gas__raw_[action] for raw tools
- **Period Prefix**: Dotfiles use actual periods (.gitignore.gs not _gitignore.gs)
- **Unified Path Pattern**: All projects use ~/gas-repos/project-[scriptId]/ structure

## Development Workflow

### Adding a New Tool
1. Create class in `src/tools/` extending `BaseTool` (located in `src/tools/base.ts`)
2. Implement required properties: `name` (with `mcp__gas__` prefix), `description`, `inputSchema`
3. Implement `execute(params)` method with validation and error handling
4. Register in `src/server/mcpServer.ts` tool array
5. Add tests in appropriate `test/` subdirectory (unit/integration/system/security)
6. Update API documentation if needed


### TypeScript Conventions
- Use `.js` extensions in imports (required for ES modules)
- Prefer named exports over default exports
- Use type imports for types: `import type { TokenInfo } from './types.js'`
- Files use kebab-case, classes/interfaces use PascalCase
- Strict TypeScript configuration with ES2022 target
- ESM modules with Node.js resolution
- Production builds use `tsconfig.production.json` (no source maps/declarations)

### Testing Approach
- **Unit tests** (`test/unit/`) - Mock external dependencies, test individual modules
- **Integration tests** (`test/integration/`) - Real GAS API tests, require authentication
- **System tests** (`test/system/`) - MCP protocol compliance and server behavior
- **Security tests** (`test/security/`) - Input validation and safety checks
- **Verification tests** (`test/verification/`) - API schema compliance and tool validation
- **Performance tests** (`test/performance/`) - Performance benchmarks and optimization validation
- Use `mocha` test runner with `chai` assertions
- Test configuration in `.mocharc.json` with 15s default timeout
- Global auth setup in `test/setup/globalAuth.ts`

## Security Considerations

- OAuth tokens stored in OS-appropriate secure locations
- PKCE flow prevents authorization code interception
- Input validation on all parameters before API calls
- Script IDs validated as 25-60 character alphanumeric
- Path traversal prevention in file operations
- Command injection prevention in Git operations (array-based execution)

## Performance Optimizations

- Local file caching reduces API calls
- Incremental TypeScript compilation for faster builds
- Concurrent asset copying in watch mode
- Smart tools check local cache before remote
- Rate limiting prevents quota exhaustion

## Debug Logging

Enable debug output with DEBUG environment variable:
```bash
DEBUG=mcp:* npm start           # All MCP logs
DEBUG=mcp:auth npm start        # Auth logs only
DEBUG=mcp:execution npm start   # Execution logs
DEBUG=mcp:sync npm start        # Sync operations
```

## MCP GAS Server Integration

This is an **MCP (Model Context Protocol) server** specifically designed to work with AI assistants like Claude. When integrated with an MCP client:

### MCP Client Configuration

**For Claude Desktop** (`~/.claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "gas": {
      "command": "node",
      "args": ["/absolute/path/to/mcp_gas/dist/src/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

### Essential Configuration Files

- **gas-config.json** - Central configuration with project definitions, OAuth settings, and sync paths
- **oauth-config.json** - Google OAuth 2.0 credentials (download from Google Cloud Console)
- **.auth/** directory - Session token storage with automatic refresh

### Working with MCP Gas Server

When Claude Code connects to this server, it gains access to 50 Google Apps Script tools. The server handles:
- OAuth authentication flow with Google
- File operations with automatic CommonJS module wrapping
- Real-time code execution in Google's cloud infrastructure
- Git integration with safe synchronization workflows
- Project management and deployment automation
