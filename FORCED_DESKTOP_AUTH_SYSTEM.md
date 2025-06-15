# Forced Desktop Authentication System

## Overview

The MCP Gas Server now implements a **FORCED DESKTOP AUTHENTICATION SYSTEM** that ensures reliable OAuth authentication by:

- ✅ **Always requiring client_secret** (no fallback to PKCE-only)
- ✅ **Clearing all cached tokens on server restart** (fresh auth required)
- ✅ **Desktop application OAuth type only** (never web app)
- ✅ **No optional parameters or fallback logic** (fail fast if misconfigured)
- ✅ **PKCE + client_secret for maximum compatibility** with Google OAuth

## Key Implementation Details

### 🔒 Forced Authentication Requirements

1. **Client Secret is REQUIRED**: No fallback to PKCE-only authentication
2. **Desktop OAuth Type Only**: Web application flows are explicitly forbidden
3. **Token Clearing on Restart**: All cached sessions are cleared when the server starts
4. **No Fallback Logic**: System fails fast if configuration is incomplete
5. **Cursor IDE Integration**: Optimized for use within Cursor IDE environment

### 🏗️ Architecture Changes

#### Server Startup (`src/index.ts`)
```typescript
// FORCE CLEAR ALL CACHED TOKENS ON STARTUP
console.log('🗑️  Clearing all cached authentication tokens (forced restart behavior)...');
const clearedCount = SessionAuthManager.clearAllSessions();
console.log(`✅ Cleared ${clearedCount} cached session(s) - fresh authentication required`);
```

#### OAuth Client (`src/auth/oauthClient.ts`)
```typescript
export interface AuthConfig {
    client_id: string;
    client_secret: string;  // REQUIRED - no longer optional
    type: 'desktop';        // FORCED - only desktop type allowed
    redirect_uris: string[];
    scopes: string[];
}
```

#### Auth Tool (`src/tools/auth.ts`)
```typescript
// FORCED VALIDATION - Both client_id and client_secret are REQUIRED
if (!clientSecret) {
    throw new OAuthError(
        'FORCED DESKTOP AUTH: Missing OAuth client_secret. This is REQUIRED - no fallback logic available.',
        'authorization'
    );
}
```

## Configuration Requirements

### OAuth Configuration File (`oauth-config.json`)

**REQUIRED** configuration file with both client_id and client_secret:

```json
{
  "description": "FORCED Desktop OAuth 2.0 Configuration for MCP Gas Server",
  "note": "Desktop application OAuth client with REQUIRED client_secret",
  "oauth": {
    "client_id": "428972970708-rcp6itnh5aqm25k2udf05cpcbfk7dk79.apps.googleusercontent.com",
    "client_secret": "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",
    "type": "desktop",
    "redirect_uris": ["http://127.0.0.1/*", "http://localhost/*"],
    "scopes": [
      "https://www.googleapis.com/auth/script.projects",
      "https://www.googleapis.com/auth/script.processes",
      "https://www.googleapis.com/auth/script.deployments",
      "https://www.googleapis.com/auth/script.scriptapp",
      "https://www.googleapis.com/auth/script.external_request",
      "https://www.googleapis.com/auth/script.webapp.deploy",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/forms",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile"
    ]
  }
}
```

### Environment Variables (Alternative)

```bash
export GOOGLE_OAUTH_CLIENT_ID="428972970708-rcp6itnh5aqm25k2udf05cpcbfk7dk79.apps.googleusercontent.com"
export GOOGLE_OAUTH_CLIENT_SECRET="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"
```

## Google Cloud Console Setup

### 1. OAuth Client Configuration

- **Application Type**: `Desktop application` (REQUIRED)
- **Client ID**: `428972970708-rcp6itnh5aqm25k2udf05cpcbfk7dk79.apps.googleusercontent.com`
- **Client Secret**: `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`

### 2. Authorized Redirect URIs

```
http://127.0.0.1/*
http://localhost/*
```

### 3. Required Scopes

All 12 Google Apps Script and Drive API scopes are required:

- `https://www.googleapis.com/auth/script.projects`
- `https://www.googleapis.com/auth/script.processes`
- `https://www.googleapis.com/auth/script.deployments`
- `https://www.googleapis.com/auth/script.scriptapp`
- `https://www.googleapis.com/auth/script.external_request`
- `https://www.googleapis.com/auth/script.webapp.deploy`
- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/forms`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`

## Usage Instructions

### 1. Kill Any Running Servers

```bash
pkill -f "node.*mcp_gas" || pkill -f "npm.*start" || true
```

### 2. Build and Start Server

```bash
npm run build && npm start
```

### 3. Authentication Flow

1. **Server Startup**: All cached tokens are automatically cleared
2. **First API Call**: Authentication error triggers auto-OAuth flow
3. **Browser Opens**: Complete authentication in browser
4. **Tokens Stored**: Session persisted until next server restart
5. **API Operations**: All Google Apps Script operations available

### 4. Verify Authentication

```javascript
// Check authentication status
gas_auth({ mode: 'status' })

// Force re-authentication
gas_auth({ mode: 'logout' })
gas_auth({ mode: 'start' })
```

## Testing and Validation

### Create Test Script

```javascript
// test_forced_desktop_auth.js
import { mcp_mcp-gas_gas_auth } from './path/to/mcp-gas';

async function testAuth() {
    console.log('🧪 Testing FORCED DESKTOP AUTH system...');
    
    try {
        // This should work with forced client_secret
        const result = await mcp_mcp-gas_gas_auth({
            mode: 'start',
            waitForCompletion: true
        });
        
        console.log('✅ Forced desktop auth successful:', result);
        
        // Test project listing
        const projects = await mcp_mcp-gas_gas_ls({ path: '' });
        console.log('✅ Project listing successful:', projects);
        
    } catch (error) {
        console.error('❌ Forced desktop auth failed:', error);
    }
}

testAuth();
```

### Run Test

```bash
npm run build
node test_forced_desktop_auth.js
```

## Security Features

### 1. PKCE + Client Secret

- **Code Verifier**: 128-character random string
- **Code Challenge**: SHA256 hash (base64url-encoded)
- **Client Secret**: Always included in token exchange
- **State Parameter**: CSRF protection

### 2. Token Management

- **Fresh Authentication**: Tokens cleared on every server restart
- **Session Isolation**: Each client gets separate authentication
- **Automatic Cleanup**: Expired tokens automatically removed
- **File-based Persistence**: Sessions stored in `.sessions/` directory

### 3. Error Handling

- **Fail Fast**: Missing client_secret causes immediate error
- **No Fallback**: No PKCE-only fallback to prevent confusion
- **Clear Messages**: Explicit error messages for configuration issues
- **Auto-Recovery**: Automatic re-authentication on token expiry

## Troubleshooting

### Common Issues

1. **Missing Client Secret**
   ```
   Error: FORCED DESKTOP AUTH: Missing OAuth client_secret
   ```
   **Solution**: Add client_secret to oauth-config.json or environment variables

2. **Wrong OAuth Type**
   ```
   Error: FORCED DESKTOP AUTH: Only desktop application type is allowed
   ```
   **Solution**: Ensure Google Cloud Console OAuth client is configured as "Desktop application"

3. **Authentication Required**
   ```
   Error: Authentication required
   ```
   **Solution**: Complete the OAuth flow in the browser that opens automatically

### Debug Mode

```bash
export DEBUG=mcp-gas:*
npm run build && npm start
```

## Benefits of Forced Desktop Auth

1. **Reliability**: No fallback logic means consistent behavior
2. **Compatibility**: Client secret ensures compatibility with all Google OAuth scenarios
3. **Fresh State**: Token clearing prevents stale authentication issues
4. **Clear Errors**: Explicit validation provides clear error messages
5. **Cursor Integration**: Optimized for Cursor IDE environment

## Migration from Previous System

If upgrading from a previous OAuth system:

1. **Update Configuration**: Ensure oauth-config.json includes client_secret
2. **Clear Old Sessions**: Server automatically clears on restart
3. **Re-authenticate**: Complete OAuth flow in browser
4. **Verify Operations**: Test Google Apps Script operations

---

🎉 **Your MCP Gas Server is now using FORCED DESKTOP AUTHENTICATION!**

This system ensures reliable, consistent OAuth authentication with Google Apps Script APIs. 