# Desktop OAuth Setup Guide

## Overview

MCP Gas Server now uses **Desktop OAuth 2.0 with PKCE** (Proof Key for Code Exchange) for enhanced security and simplified setup. This eliminates the need for client secrets and supports random localhost ports.

## Key Advantages

- ✅ **No Client Secret Required** - Only `client_id` needed
- ✅ **Random Port Support** - Secure random localhost callback ports
- ✅ **PKCE Security** - Enhanced security with code challenge/verifier
- ✅ **System Browser** - Uses your default browser for authentication
- ✅ **Safe to Commit** - No sensitive credentials in your repository

## Prerequisites

1. **Google Cloud Console Project**
2. **Google Apps Script API enabled**
3. **OAuth 2.0 credentials configured**

## Setup Instructions

### Step 1: Google Cloud Console Setup

1. **Go to Google Cloud Console**
   - Visit: https://console.cloud.google.com/
   - Select or create a project

2. **Enable Google Apps Script API**
   - Navigate to "APIs & Services" → "Enabled APIs"
   - Click "+ ENABLE APIS AND SERVICES"
   - Search for "Google Apps Script API"
   - Click "ENABLE"

3. **Create OAuth 2.0 Credentials**
   - Go to "APIs & Services" → "Credentials"
   - Click "+ CREATE CREDENTIALS" → "OAuth client ID"
   - **Application type**: `Desktop application`
   - **Name**: `MCP Gas Desktop Client` (or your choice)
   - Click "CREATE"

4. **Configure Authorized Redirect URIs**
   - Click on your newly created OAuth client
   - Under "Authorized redirect URIs", add:
     - `http://127.0.0.1/*`
     - `http://localhost/*`
   - Click "SAVE"

### Step 2: Environment Configuration

1. **Set Environment Variable**
   ```bash
   export GOOGLE_OAUTH_CLIENT_ID="your-client-id-here.apps.googleusercontent.com"
   ```

2. **Make It Persistent** (Optional)
   Add to your shell profile (~/.bashrc, ~/.zshrc, etc.):
   ```bash
   echo 'export GOOGLE_OAUTH_CLIENT_ID="your-client-id-here.apps.googleusercontent.com"' >> ~/.bashrc
   source ~/.bashrc
   ```

### Step 3: Install and Start MCP Gas Server

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Build the Server**
   ```bash
   npm run build
   ```

3. **Start the Server**
   ```bash
   npm start
   ```

## Authentication Flow

### First Time Authentication

1. **Call Authentication**
   ```javascript
   // In your MCP client
   gas_auth()
   ```

2. **Browser Opens Automatically**
   - System browser opens to Google OAuth consent screen
   - Grant permissions to Google Apps Script API
   - Browser redirects to random localhost port

3. **Authentication Complete**
   - Tokens stored securely in `.auth/session.json`
   - Automatic token refresh when needed
   - Session persists across server restarts

### Subsequent Usage

- **Check Status**: `gas_auth({ mode: 'status' })`
- **Logout**: `gas_auth({ mode: 'logout' })`
- **Re-authenticate**: `gas_auth({ mode: 'start' })`

## Security Features

### PKCE Implementation

- **Code Verifier**: 128-character random string
- **Code Challenge**: SHA256 hash of verifier (base64url-encoded)
- **Challenge Method**: S256 (SHA256)
- **No Client Secret**: Eliminates secret management

### Secure Callback Server

- **Random Ports**: Uses available ports (e.g., 53847, 61234)
- **Localhost Only**: Binds to 127.0.0.1 (not accessible remotely)
- **Temporary Server**: Shuts down after authentication
- **State Validation**: Prevents CSRF attacks

## Troubleshooting

### Common Issues

1. **Missing Client ID**
   ```
   Error: Missing GOOGLE_OAUTH_CLIENT_ID environment variable
   ```
   **Solution**: Set the environment variable with your OAuth client ID

2. **Browser Doesn't Open**
   ```
   ⚠️  Could not open browser automatically
   ```
   **Solution**: Manually visit the displayed URL

3. **Port Already in Use**
   ```
   Error: EADDRINUSE: address already in use
   ```
   **Solution**: Server automatically tries different random ports

4. **OAuth Consent Screen Issues**
   - Ensure your Google Cloud project has OAuth consent screen configured
   - Add test users if in testing mode
   - Verify redirect URIs include wildcard patterns

### Debug Mode

Enable debug logging:
```bash
export DEBUG=mcp-gas:*
npm start
```

## Migration from Previous OAuth System

If you're upgrading from a previous OAuth setup:

1. **Clean Environment**
   - Remove any old `GOOGLE_OAUTH_CLIENT_SECRET` environment variable
   - Remove any old `config/oauth.json` files

2. **Update OAuth Client**
   - Ensure you're using "Desktop Application" type in Google Cloud Console
   - Verify redirect URIs include wildcard patterns: `http://127.0.0.1/*` and `http://localhost/*`

3. **Set Environment Variable**
   ```bash
   export GOOGLE_OAUTH_CLIENT_ID="your-client-id-here.apps.googleusercontent.com"
   ```

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_OAUTH_CLIENT_ID` | Yes | OAuth 2.0 Client ID from Google Cloud Console |
| `DEBUG` | No | Enable debug logging (set to `mcp-gas:*`) |
| `NODE_ENV` | No | Set to `production` for production deployments |

## File Structure

```
mcp_gas/
├── .auth/
│   └── session.json          # Encrypted auth tokens (auto-generated)
├── src/
│   ├── auth/
│   │   ├── authState.ts       # Auth state management
│   │   ├── oauthClient.ts     # Desktop OAuth client
│   │   ├── pkce.ts           # PKCE implementation
│   │   └── desktopOAuthServer.ts # Callback server
│   └── tools/
│       └── auth.ts           # Authentication tool
└── DESKTOP_OAUTH_SETUP.md    # This guide
```

## FAQ

**Q: Why use Desktop OAuth instead of Web Application OAuth?**
A: Desktop OAuth is more secure, simpler to configure, and follows OAuth 2.0 best practices for installed applications. No client secrets required and supports PKCE for enhanced security.

**Q: Can I use this in production?**
A: Yes! Desktop OAuth is designed for installed applications and is Google's recommended approach for desktop/CLI tools.

**Q: What about the old authentication data?**
A: Old sessions are automatically cleared. You'll need to re-authenticate once with the new system.

**Q: How do I revoke access?**
A: Use `gas_auth({ mode: 'logout' })` or revoke access in your Google Account settings.

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Enable debug logging for detailed information
3. Review the authentication flow logs
4. Ensure your Google Cloud Console setup matches this guide

---

🎉 **You're all set!** Your MCP Gas Server is now using secure desktop OAuth with PKCE. 