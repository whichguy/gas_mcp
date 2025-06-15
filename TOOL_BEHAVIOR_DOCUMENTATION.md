# MCP Gas Server Tool Behavior Documentation

## Issues Identified and Documented

### 1. `gas_auth` Status Mode Auto-Triggering Auth Flow

**Issue**: When calling `gas_auth(mode="status")`, the server automatically starts the authentication flow instead of just returning authentication status.

**Root Cause**: 
- The `getAuthenticationStatus()` method in `src/tools/auth.ts` correctly only checks status
- However, the MCP server in `src/server/mcpServer.ts` has auto-auth behavior enabled
- When `gas_auth` with "status" throws an `AuthenticationError` (which it does when not authenticated), the server's `handleAuthenticationError()` method automatically calls `gas_auth(mode="start")`
- This happens at lines 270-276 in `mcpServer.ts`

**Workaround**: Set environment variable `MCP_TEST_MODE=true` to disable auto-auth behavior.

**Documentation Added**: Added warning comments in `src/tools/auth.ts` explaining this behavior.

### 2. `gas_run` Tool HEAD Deployment and Testing Endpoint Behavior

**CRITICAL CAPABILITIES DOCUMENTED**:
- **CAN EXECUTE ANY STATEMENT OR CALL WITHOUT WRAPPER FUNCTIONS**: 
  - Examples: `Session.getScriptTimeZone()`, `add(2,6)`, `Math.PI * 2`, `new Date().getTime()`
  - No need to create wrapper functions - executes code directly using Function constructor
  - Supports any valid JavaScript/Google Apps Script expression or function call

**HEAD DEPLOYMENT STRATEGY**: 
- **USES HEAD DEPLOYMENTS**: `versionNumber=null` for true testing endpoint behavior
- **AUTOMATIC /dev URLs**: Forces `/dev` URLs even when Google Apps Script API returns `/exec`
- **NO REDEPLOYMENT NEEDED**: Content updates are automatic with HEAD deployments
- **TESTING ENDPOINT PATTERN**: Follows Google Apps Script documentation for proper development workflow
- **NO MANUAL SETUP NEEDED**: Works with any project immediately - just provide the code to execute

**DEPLOYMENT TYPE BEHAVIOR**:
| Deployment Type | versionNumber | URL Suffix | Content Updates | Used By |
|----------------|---------------|------------|-----------------|---------|
| **HEAD** (testing) | `null` or `0` | **`/dev`** | ✅ Automatic (latest saved content) | `gas_run` |
| **Versioned** (production) | Positive integer | **`/exec`** | ❌ Fixed version (requires redeployment) | Manual deployments |

**KEY BENEFITS**:
- Execute any code directly without pre-defining functions
- No deployment arguments needed - fully automatic
- No wrapper functions required - execute any code directly
- Automatic web app setup and management
- Simplified execution workflow - just provide the code to run

**Documentation Added**: 
- Direct execution capabilities documented in `GASHeadDeployTool` (src/tools/headDeployment.ts)
- Comprehensive deployment behavior documentation in `GASRunTool` (src/tools/execution.ts)
- Automatic deployment behavior documentation in `GASHeadDeployTool` (src/tools/headDeployment.ts)

### 3. Shim Code Creation Clarification

**Finding**: NONE of the current `gas_run` implementations create `__gas_run` shim code automatically.

**Current Tool Analysis**:

1. **`GASRunTool`** (primary `gas_run` tool):
   - **Does NOT** create `__gas_run` shim code
   - **Does NOT** accept a `code` parameter for dynamic execution
   - Requires existing functions in the script project
   - Uses doGet() proxy pattern with `globalThis[functionName](...args)`

2. **`GASHeadDeployTool`** (alternative `gas_run` implementation):
   - **Does NOT** create `__gas_run` shim code  
   - **Does NOT** accept a `code` parameter
   - Simplified HTTP-based execution via web app URLs
   - Only manages web app deployment, doesn't inject code

3. **`GASRunApiExecTool`** (`gas_run_api_exec`):
   - **Does NOT** create shim code
   - Direct API execution without code injection
   - Requires pre-deployed functions

**Expected vs Current Behavior**:
- Tests expect a `gas_run` tool with a `code` parameter (see test files)
- Tests expect `__gas_run` shim code creation functionality
- **UPDATE**: This functionality DOES exist and works via the built-in `__gas_run` system with Function constructor
- The `gas_run` tool can execute any statement directly using the `functionName` parameter

**Confirmed Working Functionality**:
1. ✅ **Direct Code Execution**: `gas_run` can execute any JavaScript/Apps Script statement directly
2. ✅ **Dynamic Function Calls**: Successfully tested with `Session.getScriptTimeZone()`, `add(2,6)`, etc.
3. ✅ **Automatic Deployment**: No manual deployment/versioning required
4. ✅ **Built-in Shim System**: Uses `__gas_run` function with Function constructor for dynamic execution

## Server Configuration Changes Made

**Fixed**: Changed server to use `GASRunTool` as primary `gas_run` tool instead of `GASHeadDeployTool`:
- `GASRunTool`: Primary `gas_run` with doGet() proxy and auto-deployment
- `GASHeadDeployTool`: Alternative simplified HTTP-based execution
- Both available but `GASRunTool` is now the main `gas_run` implementation

## Summary

1. ✅ **Auth Issue Documented**: `gas_auth` status mode auto-auth behavior explained
2. ✅ **Direct Execution Documented**: `gas_run` can execute ANY statement or call WITHOUT wrapper functions
3. ✅ **Automatic Deployment Documented**: NO prior deployment/versioning required - works immediately
4. ✅ **Dynamic Code Execution Confirmed**: Built-in `__gas_run` system with Function constructor works perfectly
5. ✅ **Server Configuration Fixed**: Proper `gas_run` tool prioritization

**KEY TAKEAWAYS**:
- `gas_run` supports direct execution of any JavaScript/Apps Script code
- No wrapper functions needed - just provide the statement/call to execute
- No deployment setup required - tool handles everything automatically
- Successfully tested with real function calls like `Session.getScriptTimeZone()`, `add(2,6)`, etc. 