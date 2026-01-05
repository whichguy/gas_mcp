# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking Changes

#### exec_api() and invoke() Response Format Change

**Date**: 2025-01-04

Both `exec_api()` and `invoke()` (module path mode) now return structured responses instead of raw values. This enables Logger.log() output capture for debugging.

**Before (raw value):**
```javascript
// exec_api returned the raw function return value
google.script.run.exec_api(null, 'Math', 'add', [1, 2])
  .withSuccessHandler(result => console.log(result));  // 3
```

**After (structured response):**
```javascript
// exec_api returns { success, result, logger_output, execution_type }
server.exec_api(null, 'Math', 'add', [1, 2])
  .then(response => {
    console.log(response.result);         // 3
    console.log(response.logger_output);  // Any Logger.log() calls during execution
  });
```

**Response Schema:**
```typescript
// Success
{
  success: true,
  result: T,                    // Your function's return value
  logger_output: string,        // All Logger.log() output captured
  execution_type: 'exec_api' | 'invoke_module'
}

// Error
{
  success: false,
  error: string,                // error.toString()
  message: string,              // error.message
  stack: string,                // error.stack
  logger_output: string         // Logs captured before error
}
```

**Migration Path:**

1. **Using createGasServer() wrapper** (recommended): Change `.then(result => ...)` to `.then(response => response.result)`
2. **Using raw google.script.run**: Access result via `.result` property in success handler

**Not Affected:**
- MCP `exec` tool (HTTP path) - already used structured responses
- `invoke()` with raw JS statements (delegated to `__gas_run()`)

**Files Changed:**
- `src/__mcp_exec.js` - exec_api() and invoke() implementations
- `gas-runtime/common-js/__mcp_exec.gs` - Template file

### Added

- Logger output capture in exec_api() responses
- Logger output capture in invoke() module path mode responses
- Stack traces included in error responses

### Fixed

- Logger.log() output was lost when calling GAS functions via google.script.run.exec_api() or google.script.run.invoke()
