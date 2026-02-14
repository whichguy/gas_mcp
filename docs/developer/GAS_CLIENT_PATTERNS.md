# GAS Client-Side HTML Patterns

Patterns for HTML UIs calling GAS server functions via the Promise-based `createGasServer()` wrapper.

## createGasServer() — Always Use Instead of google.script.run

```javascript
// ❌ OLD PATTERN - Don't use:
google.script.run
  .withSuccessHandler(callback)
  .withFailureHandler(errorCallback)
  .exec_api(null, module, function, params);

// ✅ NEW PATTERN - Use this:
// Available globally as window.server (auto-configured)
window.server.exec_api(null, module, function, params)
  .then(callback)
  .catch(errorCallback);

// Or create custom server instance:
const server = createGasServer({
  debug: true,              // Enable debug logging
  throwOnUnhandled: true,   // Auto-throw on unhandled errors
  checkNetwork: true,       // Network connectivity checking
  onError: (err, func, args) => console.error(`[${func}]`, err)
});
```

## Key Features

- **Promise API**: Modern async/await support
- **Cancellable Calls**: `.cancel()`, `.pause()`, `.resume()` for long operations
- **Polling**: `.poll(callback)` for thinking messages/progress updates
- **Network Checking**: Auto-detects offline state
- **Validation**: Checks argument serializability, payload size limits
- **Enhanced Errors**: Contextual error messages with hints
- **Memory Leak Detection**: Warns if promises never executed

## Example with Polling and Cancel

```javascript
const call = window.server.exec_api(null, 'MyModule', 'longTask', params)
  .poll(
    messages => messages.forEach(m => console.log('Progress:', m)),
    { continuous: true, maxDuration: 180000 }
  )
  .then(response => {
    console.log('Result:', response.result);
    console.log('Logs:', response.logger_output);
  });

// Cancel if needed
document.getElementById('cancelBtn').onclick = () => call.cancel('User cancelled');
```

## Response Format (exec_api & invoke)

Both `exec_api()` and `invoke()` return structured responses with logger output capture:

```javascript
// Success response
{
  success: true,
  result: <your_function_return_value>,
  logger_output: "All Logger.log() output captured here",
  execution_type: 'exec_api' | 'invoke_module'
}

// Error response
{
  success: false,
  error: "Error.toString()",
  message: "error.message",
  stack: "error.stack",
  logger_output: "Logs captured before error"
}
```

**Note:** The MCP `exec` tool (HTTP path) is unaffected - it already used structured responses.

## Cancel Pattern

```javascript
// Architecture: client-side only — stops polling, server continues
const call = server.exec_api(null, module, fn, {requestId, ...params});
call.cancel('reason'); // → Promise<{success, reason}>

// Polling with controller
call.poll(callback, options); // returns controller with .stop() and .isActive()

// UI Pattern: store call → show cancel button → call.cancel() on click → hide button
```

## Infrastructure Files

- `common-js/html/gas_client.html` - Main implementation (39KB)
- `__mcp_exec/gas_client.html` - Execution infrastructure version (14KB)
