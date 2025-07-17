# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

### Core Development
- `npm install` - Install dependencies
- `npm run build` - Build TypeScript to dist/
- `npm start` - Build and start MCP server with config
- `npm run dev` - Watch mode compilation
- `npm run clean` - Clean build artifacts

### Testing Framework
- `npm test` - Run core system tests (default)
- `npm run test:core` - Run consolidated core tests (30s timeout)
- `npm run test:unit` - Unit tests for errors, api, auth, tools modules
- `npm run test:system` - System integration tests (30s timeout)
- `npm run test:workflow` - End-to-end workflow tests with real APIs (300s timeout, requires GAS_INTEGRATION_TEST=true)
- `npm run test:all` - Run core + unit + gas-run tests
- `npm run test:full` - Run all tests including advanced scenarios

### Specific Test Suites
- `npm run test:gas-run` - Code execution engine tests
- `npm run test:advanced` - Advanced project scenarios (requires OAuth)
- `npm run test:doget` - DoGet proxy tests (requires OAuth)
- `npm run test:proxy-live` - Live proxy tests (requires OAuth)

### Code Quality
- `npm run lint` - Run ESLint on src/
- `npm run lint:fix` - Fix ESLint issues

## Code Style Guidelines

### TypeScript Conventions
- **Strict Mode**: All code uses strict TypeScript with comprehensive type safety
- **Modules**: ES2022 modules with explicit .js extensions in imports
- **Classes**: PascalCase naming (e.g., `GASClient`, `BaseTool`, `AuthStateManager`)
- **Interfaces**: PascalCase with descriptive names (e.g., `TokenInfo`, `ValidationRule`)
- **Methods**: camelCase (e.g., `executeApiCall`, `validateParameter`)
- **Files**: kebab-case for multi-word files (e.g., `authState.ts`, `mcpErrors.ts`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `AUTH_MESSAGES`, `DEFAULT_TIMEOUT`)

### Import/Export Patterns
```typescript
// Always use explicit .js extensions for local imports
import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';

// Named exports preferred over default exports
export class MyTool extends BaseTool { }
export interface MyInterface { }
```

### Error Handling
- Use custom error hierarchy: `MCPGasError` → `ValidationError`, `AuthenticationError`, `QuotaError`
- Centralized error handling via `GASErrorHandler.handleApiError()`
- Structured error creation: `throw new ValidationError('field', value, 'expected format')`
- Always provide context and actionable error messages

### Tool Implementation Pattern
```typescript
export class MyTool extends BaseTool {
  public name = 'my_tool';
  public description = 'Clear description with usage context';
  
  public inputSchema = {
    type: 'object',
    properties: { /* ... */ },
    required: ['param1'],
    llmGuidance: {
      whenToUse: 'When to use this tool',
      workflow: 'Expected workflow',
      alternatives: 'Alternative approaches'
    }
  };

  async execute(params: any): Promise<any> {
    // 1. Validate parameters
    // 2. Authenticate if needed  
    // 3. Execute API calls with error handling
    // 4. Return structured response
  }
}
```

## Architecture

### Multi-Layered MCP Server Architecture
- **MCP Layer**: Model Context Protocol server implementation
- **Tool Layer**: 45+ tools organized by function (auth, filesystem, project, execution, deployment)
- **API Layer**: Google Apps Script API client with rate limiting and error handling
- **Auth Layer**: Dual authentication (session-based + singleton fallback) with OAuth 2.0 PKCE
- **Utility Layer**: Validation, file management, project resolution, local sync

### Tool Categories
- **Authentication**: `gas_auth` - OAuth 2.0 management
- **Filesystem**: `gas_cat`, `gas_write`, `gas_mv`, `gas_cp`, `gas_rm` - Smart local/remote file operations
- **Execution**: `gas_run`, `gas_raw_run` - Dynamic JavaScript execution in GAS environment
- **Project Management**: `gas_project_create`, `gas_info`, `gas_ls` - Project lifecycle
- **Deployment**: `gas_deploy_create`, `gas_version_create` - Web app and API deployments
- **Local Sync**: `gas_pull`, `gas_push`, `gas_status` - Bidirectional file synchronization
- **Drive Integration**: Container binding and script creation

### Configuration Management
- **Unified Config**: `mcp-gas-config.json` contains OAuth, projects, environments, local paths
- **Session Storage**: Authentication tokens in `.auth/` directory
- **Project Context**: Current project tracking for simplified tool usage

### Dual Authentication Architecture
```typescript
// Session-based (preferred) - provides isolation
constructor(sessionAuthManager?: SessionAuthManager) {
  this.sessionAuthManager = sessionAuthManager;
  // Singleton fallback for backward compatibility
  this.authStateManager = AuthStateManager.getInstance();
}
```

## Testing Architecture

### Test Framework Structure
- **Framework**: Mocha with Chai assertions and Sinon mocking
- **Organization**: Hierarchical test suites with timeouts for different scenarios
- **Integration**: Real Google Apps Script API testing with `GAS_INTEGRATION_TEST=true`
- **Helpers**: `MCPTestClient`, `AuthTestHelper`, `GASTestHelper` for consistent testing

### Test Environment Setup
```typescript
// Global auth setup for integration tests
// test/setup/globalAuth.ts provides shared authentication
describe('Component', () => {
  beforeEach(() => { /* setup */ });
  afterEach(() => { /* cleanup */ });
  
  it('should handle specific case', async () => {
    // Test implementation with proper async/await
  });
});
```

## Environment Variables & Configuration

### Required for Integration Testing
```bash
export GAS_INTEGRATION_TEST=true  # Enable real API testing
export GOOGLE_OAUTH_CLIENT_ID=    # OAuth client ID (optional override)
export DEBUG=mcp:*                # Enable debug logging
```

### Configuration Files
- `mcp-gas-config.json` - Main configuration (OAuth, projects, paths)
- `oauth-config.json` - OAuth credentials (NOT in version control)
- `tsconfig.json` - TypeScript configuration with strict mode
- `.mocharc.json` - Mocha test configuration with ts-node/esm loader

## Development Workflow

### Starting Development
1. `npm install` - Install dependencies
2. Configure OAuth credentials in `mcp-gas-config.json`
3. `npm run dev` - Start watch mode compilation
4. `npm test` - Run core tests to verify setup

### Adding New Tools
1. Create tool class extending `BaseTool` in `src/tools/`
2. Implement required properties and `execute()` method
3. Add to tool registry in `src/server/mcpServer.ts`
4. Write unit tests in `test/tools/`
5. Add integration tests if needed
6. Update API documentation

### Debugging
- Enable debug logging: `DEBUG=mcp:* npm start`
- Use TypeScript source maps for debugging
- Integration test mode: `GAS_INTEGRATION_TEST=true npm run test:workflow`

## Security Considerations

### OAuth Security
- PKCE OAuth 2.0 flow for enhanced security
- Secure token storage in OS-appropriate locations
- Automatic token refresh with expiry handling
- Session isolation between concurrent users

### Input Validation
- Comprehensive parameter validation before API calls
- Path validation prevents directory traversal
- Script ID format validation
- File size and content validation

### API Safety
- Rate limiting to respect Google quota limits
- Graceful degradation on quota exceeded
- Retry logic with exponential backoff
- Secure error message handling (no credential exposure)

## Project-Specific Patterns

### Tool Naming Convention
- Prefix: `gas_` for all Google Apps Script tools
- Categories: `gas_auth`, `gas_project_*`, `gas_deploy_*`, `gas_local_*`
- Raw tools: `gas_raw_*` for explicit project ID operations

### File Path Handling
- Smart path resolution: filename only when current project set
- Support for logical directories within GAS projects
- Local/remote path translation
- Extension handling (.gs, .html, .json)

### Local Sync Strategy
- Local files in `./src/` directory structure
- Automatic sync on project context changes
- Conflict resolution with user control
- Bidirectional sync with change detection

This architecture provides a robust, type-safe foundation for AI-assisted development with Google Apps Script through the Model Context Protocol.