# OAuth Configuration Issue

## Problem
The OAuth authentication is failing with error "400. The server cannot process the request because it is malformed."

## Root Cause
The OAuth client `428972970708-m9hptmp3idakolt9tgk5m0qs13cgj2kk.apps.googleusercontent.com` in Google Cloud Console is not properly configured with the required scopes.

## Current Scope Configuration

### What the code requests (src/tools/authConfig.ts):
```javascript
scopes: [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email'
]
```

### What oauth-config.json lists (not currently used):
All scopes including processes, deployments, scriptapp, external_request, webapp.deploy, spreadsheets, documents, forms, logging.read, userinfo.profile

## Fix Required

### Option 1: Update Google Cloud Console OAuth Consent Screen
1. Go to: https://console.cloud.google.com/apis/credentials/consent
2. Find the OAuth consent screen for client ID `428972970708-m9hptmp3idakolt9tgk5m0qs13cgj2kk`
3. Add the following scopes to the OAuth consent screen:
   - `https://www.googleapis.com/auth/script.projects` (required)
   - `https://www.googleapis.com/auth/drive` (required)
   - `https://www.googleapis.com/auth/userinfo.email` (required)

4. Optionally add additional scopes for full functionality:
   - `https://www.googleapis.com/auth/script.processes`
   - `https://www.googleapis.com/auth/script.deployments`
   - `https://www.googleapis.com/auth/script.scriptapp`
   - `https://www.googleapis.com/auth/script.external_request`
   - `https://www.googleapis.com/auth/script.webapp.deploy`
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/documents`
   - `https://www.googleapis.com/auth/forms`
   - `https://www.googleapis.com/auth/userinfo.profile`

### Option 2: Create New OAuth Client
1. Go to: https://console.cloud.google.com/apis/credentials
2. Create new OAuth 2.0 Client ID
3. Application type: "Desktop app" or "Web application"
4. Add authorized redirect URIs:
   - `http://127.0.0.1:3000/oauth/callback`
   - `http://localhost:3000/oauth/callback`
5. Download the client configuration
6. Update `oauth-config.json` with the new client_id

### Option 3: Use Existing Valid OAuth Client
If you have another OAuth client that's properly configured, update `src/tools/authConfig.ts`:
```javascript
client_id: 'YOUR-WORKING-CLIENT-ID.apps.googleusercontent.com'
```

## Testing After Fix
Once OAuth is properly configured:

```bash
# Rebuild
npm run build

# Run tests
npm run test:mcp-git
```

## Verification
The OAuth flow should open a browser and successfully complete authentication without the "400 malformed request" error.
