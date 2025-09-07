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
npm run test:verification        # API schema and compliance verification
npm run test:all                 # Run unit + system tests

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
npm run validate-setup.sh        # Validate setup and configuration
```

## Architecture Overview

This is a Model Context Protocol (MCP) server that bridges AI assistants with Google Apps Script (GAS). It provides 46 tools for creating, managing, and executing GAS projects through a unified interface.

### Core Flow: MCP Client ↔ MCP Server ↔ Google Apps Script API

1. **MCP Protocol Layer** (`src/server/mcpServer.ts`)
   - Handles MCP protocol communication via stdio
   - Registers and dispatches tool calls
   - Manages error responses and tool results

2. **Tool Layer** (`src/tools/`)
   - Each tool extends `BaseTool` with standardized interface
   - Tools handle parameter validation, authentication, and execution
   - Smart tools (gas_*) provide enhanced functionality with local caching
   - Raw tools (gas_raw_*) provide direct API access

3. **Authentication Layer** (`src/auth/`)
   - OAuth 2.0 PKCE flow implementation
   - Session-based token management with automatic refresh
   - Singleton fallback for backward compatibility

4. **API Client Layer** (`src/api/gasClient.ts`)
   - Google Apps Script API v1 client
   - Rate limiting and retry logic
   - Error transformation for MCP

### Key Architectural Patterns

#### Tool Implementation Pattern
Every tool follows this structure:
```typescript
export class GasTool extends BaseTool {
  public name = 'gas_tool_name';
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
gas_git_init({ scriptId: "...", repository: "https://github.com/..." })

// 2. Clone in sync folder (LLM uses standard git)
// cd /sync/folder && git clone ...

// 3. Sync files (safe merge)
gas_git_sync({ scriptId: "..." })  // ALWAYS pull-merge-push

// 4. Commit and push (standard git)
// git add -A && git commit -m "..." && git push
```

See `docs/GIT_SYNC_WORKFLOWS.md` for complete documentation.

### Project Context Management

The server maintains project context for simplified operations:
- **gas_project_set** - Set current project and auto-pull files
- **gas_project_list** - List configured projects
- Current project stored in `mcp-gas-config.json`
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

- **mcp-gas-config.json** - Unified configuration
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
The MCP server provides 46 tools organized into logical categories:

#### Smart Tools (CommonJS Processing)
- **gas_cat, gas_write, gas_cp** - Handle CommonJS wrapping/unwrapping automatically
- **gas_ls, gas_rm, gas_mv, gas_mkdir** - Directory and file operations with smart path handling
- **gas_run, gas_info, gas_reorder** - Execution and project management
- **gas_version_create, gas_deploy_create** - Deployment and versioning

#### Raw Tools (Exact Content Preservation)
- **gas_raw_cat, gas_raw_write, gas_raw_cp** - Preserve exact content including CommonJS wrappers
- **gas_raw_ls, gas_raw_rm, gas_raw_mv** - Low-level file operations
- **gas_raw_find** - Pattern-based file discovery

#### Git Integration Tools
- **gas_git_init, gas_git_sync, gas_git_status** - Core Git synchronization
- **gas_git_set_sync_folder, gas_git_get_sync_folder** - Local sync management

#### Project Management Tools
- **gas_project_set, gas_project_list** - Project context management
- **gas_auth** - OAuth authentication workflow

### Key Design Principles
- **Flat Function Architecture**: Each tool is a separate function following MCP best practices
- **Smart vs Raw**: Smart tools process CommonJS, raw tools preserve exact content
- **Consistent Naming**: gas_[action] for smart tools, gas_raw_[action] for raw tools
- **Period Prefix**: Dotfiles use actual periods (.gitignore.gs not _gitignore.gs)
- **Unified Path Pattern**: All projects use ~/gas-repos/project-[scriptId]/ structure

## Development Workflow

### Adding a New Tool
1. Create class in `src/tools/` extending `BaseTool`
2. Implement required properties: `name`, `description`, `inputSchema`
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

### Testing Approach
- **Unit tests** (`test/unit/`) - Mock external dependencies, test individual modules
- **Integration tests** (`test/integration/`) - Real GAS API tests, require authentication
- **System tests** (`test/system/`) - MCP protocol compliance and server behavior
- **Security tests** (`test/security/`) - Input validation and safety checks
- **Verification tests** (`test/verification/`) - API schema compliance and tool validation
- Use `sinon` for mocking, `chai` for assertions, organized in logical test hierarchy

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
    "mcp-gas": {
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

- **mcp-gas-config.json** - Central configuration with project definitions, OAuth settings, and sync paths
- **oauth-config.json** - Google OAuth 2.0 credentials (download from Google Cloud Console)
- **.auth/** directory - Session token storage with automatic refresh

### Working with MCP Gas Server

When Claude Code connects to this server, it gains access to 46 Google Apps Script tools. The server handles:
- OAuth authentication flow with Google
- File operations with automatic CommonJS module wrapping
- Real-time code execution in Google's cloud infrastructure
- Git integration with safe synchronization workflows
- Project management and deployment automation