# MCP Gas Server - stdout and stderr Usage Documentation

## 🎯 Overview

The MCP Gas Server follows the Model Context Protocol (MCP) specification for client-server communication. This document explains how stdout and stderr are used for different purposes in the server architecture.

## 📡 Protocol Communication Architecture

### MCP Protocol Communication (stdout)

The MCP Gas Server uses **stdout** exclusively for MCP protocol communication with clients (like Claude/Cursor). This follows the MCP specification which requires:

1. **Structured JSON-RPC Messages**: All tool responses, resource data, and protocol handshakes are sent via stdout in JSON-RPC format
2. **Binary Cleanliness**: stdout must contain only valid JSON-RPC messages with no additional text, logs, or debug information
3. **Client-Server Data Exchange**: Tool execution results, authentication responses, and all functional data flow through stdout

#### Implementation Details

```typescript
// Located in: src/server/mcpServer.ts
const transport = new StdioServerTransport();
await this.server.connect(transport);
```

The `StdioServerTransport` from the MCP SDK automatically handles:
- Reading JSON-RPC requests from stdin
- Writing JSON-RPC responses to stdout
- Maintaining protocol compliance

### Diagnostic Logging (stderr)

The MCP Gas Server uses **stderr** for all diagnostic output, including:

1. **Server Status Messages**: Startup, shutdown, and operational status
2. **Authentication Flow Information**: OAuth status, session management, token operations
3. **API Operation Logs**: Google Apps Script API calls, deployment operations, execution traces
4. **Error Diagnostics**: Detailed error information for debugging
5. **Performance Metrics**: Timing information, API response details, caching status

#### Why stderr for Diagnostics?

- **Protocol Separation**: Keeps MCP communication clean on stdout
- **Client Independence**: Diagnostic logs don't interfere with client-server protocol
- **Development Support**: Enables rich debugging without breaking MCP compliance
- **Production Monitoring**: Allows operational monitoring without affecting tool responses

## 🔍 Detailed Usage Patterns

### Server Lifecycle Events (stderr)

```typescript
// Server startup
console.error('🚀 Starting MCP Gas Server with forced desktop authentication...');
console.error('🗑️  Clearing all cached authentication tokens (forced restart behavior)...');
console.error(`✅ Cleared ${clearedCount} cached session(s) - fresh authentication required`);

// Server ready
console.error('MCP Gas Server connected and ready');
console.error('Each client gets isolated authentication sessions');
console.error('Use sessionId parameter to manage multiple sessions');
console.error('Use gas_auth(mode="start") to authenticate with Google Apps Script');

// Graceful shutdown
console.error(`\nReceived ${signal}, shutting down gracefully...`);
console.error('MCP Gas Server stopped');
```

### Authentication Flow Diagnostics (stderr)

Authentication operations generate detailed logs to stderr for monitoring and debugging:

```typescript
// OAuth flow tracking
console.error(`🚀 Using cached API clients for token: ${tokenHash}...`);
console.error(`🔧 Initializing new API clients for token: ${tokenHash}...`);
console.error(`✅ API clients initialized and cached`);
console.error(`   scriptApi available: ${!!this.scriptApi}`);
console.error(`   driveApi available: ${!!this.driveApi}`);
```

### Google API Operation Logging (stderr)

All Google Apps Script API calls are extensively logged to stderr:

```typescript
// API request initiation
console.error(`📡 [GOOGLE API REQUEST] Starting: ${operationName}`);
console.error(`   ⏰ Timestamp: ${new Date().toISOString()}`);
console.error(`   🔑 Auth: ${accessToken ? 'Token present (' + accessToken.substring(0, 10) + '...)' : 'No token'}`);

// Successful API response
console.error(`✅ [GOOGLE API SUCCESS] Completed: ${operationName}`);
console.error(`   ⏱️  Duration: ${duration}ms`);
console.error(`   📊 Result type: ${typeof result}`);
console.error(`   📏 Result size: ${JSON.stringify(result).length} characters`);

// API error details
console.error(`❌ [GOOGLE API ERROR] Failed: ${operationName} after ${duration}ms`);
console.error(`   ⏰ Timestamp: ${new Date().toISOString()}`);
console.error(`   🔍 Error type: ${error.constructor?.name || 'Unknown'}`);
console.error(`   📍 API endpoint: ${error.config?.url || apiEndpoint}`);
console.error(`   🔢 Status code: ${error.response?.status || error.status || error.statusCode || 'Unknown'}`);
console.error(`   💬 Error message: ${error.message}`);
```

### Execution Engine Tracing (stderr)

The `gas_run` tool provides detailed execution tracing via stderr:

```typescript
// Execution context
console.error(`[GAS_RUN] Executing: ${js_statement}`);
console.error('[MCP_GAS_RUN] Executing on HEAD deployment (/dev URL)');

// URL construction process
console.error(`🚀 [GAS_URL_CONSTRUCTION] Starting URL construction for script: ${scriptId}`);
console.error(`   ⏰ Timestamp: ${new Date().toISOString()}`);
console.error(`   🔑 Auth Token: ${accessToken ? `Present (${accessToken.substring(0, 10)}...)` : 'Not provided'}`);

// Deployment analysis
console.error(`📦 [DEPLOYMENT ${i + 1}/${basicDeployments.length}] Examining: ${basicDeployment.deploymentId}`);
console.error(`      📋 Description: ${basicDeployment.description || 'No description'}`);
console.error(`      🔢 Version: ${basicDeployment.versionNumber || 'HEAD'}`);
console.error(`      📅 Updated: ${basicDeployment.updateTime || 'Unknown'}`);
```

### Session Management (stderr)

Session isolation and cleanup operations are logged to stderr:

```typescript
// Session operations
console.error(`[Session ${sessionId}] Tool ${name} failed:`, error);
console.error(`Cleaned up ${cleaned} expired sessions`);
console.error(`Cleaned up ${filesCleaned} expired session files`);
```

## 🎮 Tool Response Format (stdout)

All tool responses follow the MCP JSON-RPC format sent via stdout:

```typescript
// Success response format
{
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        // Tool-specific response data
        status: 'success',
        data: { ... },
        sessionId: 'abc123-def456-...'
      }, null, 2)
    }
  ]
}

// Error response format
{
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        error: {
          type: 'AuthenticationError',
          message: 'OAuth token expired',
          code: 'token_expired',
          data: { ... }
        },
        sessionId: 'abc123-def456-...'
      }, null, 2)
    }
  ],
  isError: true
}
```

## 🔧 Development Guidelines

### For Tool Development

1. **Never log to stdout**: Use only stderr for diagnostic information
2. **Rich stderr logging**: Provide detailed operation traces for debugging
3. **Structured responses**: Always return structured JSON via the MCP protocol
4. **Session context**: Include sessionId in error logs for session-specific debugging

### For Client Integration

1. **Monitor stderr**: Parse stderr output for operational monitoring and debugging
2. **Process stdout**: Handle only MCP JSON-RPC messages from stdout
3. **Error handling**: Parse error responses from MCP protocol, not stderr
4. **Authentication flows**: Monitor stderr for auth flow status and URLs

### Log Level Conventions

The server uses emoji prefixes in stderr for visual parsing:

- `🚀` - Server startup/initialization
- `✅` - Successful operations
- `❌` - Errors and failures
- `⚠️` - Warnings and fallbacks
- `🔍` - Detailed analysis/debugging
- `📡` - API operations
- `🔧` - Configuration/setup
- `🗑️` - Cleanup operations
- `📦` - Resource/deployment operations
- `🌐` - Web/URL operations

## 🛡️ Security Considerations

### Token Protection

Sensitive authentication tokens are partially masked in stderr logs:

```typescript
// Token masking example
console.error(`🔑 Auth Token: ${accessToken ? `Present (${accessToken.substring(0, 10)}...)` : 'Not provided'}`);
```

### Error Sanitization

Production environments can disable stack traces by setting environment variables:

```typescript
stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
```

## 🧪 Testing and Debugging

### Development Mode

Set `NODE_ENV=development` for additional debugging information in stderr:

```bash
NODE_ENV=development npm start
```

### Test Mode

Set `MCP_TEST_MODE=true` to disable auto-authentication browser launches:

```bash
MCP_TEST_MODE=true npm test
```

### Log Filtering

Use standard shell tools to filter stderr output:

```bash
# Monitor only API operations
npm start 2>&1 | grep "📡\|✅\|❌"

# Monitor authentication flows
npm start 2>&1 | grep "🔑\|OAuth\|auth"

# Monitor deployment operations
npm start 2>&1 | grep "📦\|🌐"
```

## 📊 Performance Monitoring

The extensive stderr logging enables real-time performance monitoring:

- **API Response Times**: Each Google API call includes duration metrics
- **Cache Hit Rates**: OAuth client and token caching statistics
- **Session Activity**: Active session counts and cleanup metrics
- **Memory Usage**: Process memory statistics in server stats

This logging architecture ensures the MCP Gas Server maintains protocol compliance while providing comprehensive operational visibility for development, debugging, and production monitoring. 