# Bootstrap OAuth Setup (No Manual OAuth Required)

🚀 **One-Click Authorization for MCP Gas Server Users**

## Overview

Instead of requiring users to create their own OAuth applications, this approach provides a bootstrap Google Apps Script web app that handles authorization automatically.

## Setup (One-Time - You Do This)

### 1. Create Bootstrap GAS Project

1. Go to [Google Apps Script](https://script.google.com)
2. Create new project: "MCP Gas OAuth Bootstrap"
3. Replace `Code.gs` with:

```javascript
/**
 * Bootstrap OAuth Web App for MCP Gas Server
 * Handles OAuth authorization without requiring users to create OAuth clients
 */

function doGet(e) {
  const mode = e.parameter.mode || 'authorize';
  
  switch(mode) {
    case 'authorize':
      return showAuthorizationPage();
    case 'callback':
      return handleCallback(e.parameter.code);
    case 'credentials':
      return showCredentials();
    default:
      return showAuthorizationPage();
  }
}

function showAuthorizationPage() {
  const authUrl = getAuthorizationUrl();
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>MCP Gas Server Authorization</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .button { display: inline-block; padding: 10px 20px; background: #4285f4; color: white; text-decoration: none; border-radius: 5px; }
        .code { background: #f5f5f5; padding: 10px; font-family: monospace; border-radius: 3px; }
      </style>
    </head>
    <body>
      <h1>🚀 MCP Gas Server Authorization</h1>
      <p>This will authorize the MCP Gas Server to access your Google Apps Script projects.</p>
      
      <h3>Required Permissions:</h3>
      <ul>
        <li>Create and manage Google Apps Script projects</li>
        <li>Execute Apps Script functions</li>
        <li>Access Google Drive (for script files)</li>
        <li>Read your basic profile information</li>
      </ul>
      
      <p><a href="${authUrl}" class="button">🔐 Authorize MCP Gas Server</a></p>
      
      <h3>After Authorization:</h3>
      <p>1. Complete the Google consent flow</p>
      <p>2. You'll get a success page with setup instructions</p>
      <p>3. Your MCP server will work without additional OAuth setup</p>
      
      <hr>
      <p><small>This authorization uses Google's standard OAuth 2.0 flow and only requests the minimum required permissions.</small></p>
    </body>
    </html>
  `;
  
  return HtmlService.createHtmlOutput(html);
}

function getAuthorizationUrl() {
  const clientId = getOAuthClientId();
  const redirectUri = getWebAppUrl() + '?mode=callback';
  const scopes = [
    'https://www.googleapis.com/auth/script.projects',
    'https://www.googleapis.com/auth/script.processes', 
    'https://www.googleapis.com/auth/script.deployments',
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.webapp.deploy',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ].join(' ');
  
  const params = {
    'client_id': clientId,
    'redirect_uri': redirectUri,
    'scope': scopes,
    'response_type': 'code',
    'access_type': 'offline',
    'prompt': 'consent'
  };
  
  const paramString = Object.keys(params).map(key => 
    encodeURIComponent(key) + '=' + encodeURIComponent(params[key])
  ).join('&');
  
  return 'https://accounts.google.com/o/oauth2/auth?' + paramString;
}

function handleCallback(code) {
  if (!code) {
    return HtmlService.createHtmlOutput('<h1>❌ Authorization failed</h1><p>No authorization code received.</p>');
  }
  
  try {
    // Exchange code for tokens
    const tokens = exchangeCodeForTokens(code);
    
    // Store tokens securely
    PropertiesService.getUserProperties().setProperties({
      'access_token': tokens.access_token,
      'refresh_token': tokens.refresh_token,
      'expires_at': (Date.now() + (tokens.expires_in * 1000)).toString()
    });
    
    // Show success page with MCP setup instructions
    return showSuccessPage(tokens);
    
  } catch (error) {
    console.error('Token exchange failed:', error);
    return HtmlService.createHtmlOutput(`
      <h1>❌ Authorization failed</h1>
      <p>Error: ${error.message}</p>
      <p><a href="?mode=authorize">Try again</a></p>
    `);
  }
}

function exchangeCodeForTokens(code) {
  const clientId = getOAuthClientId();
  const clientSecret = getOAuthClientSecret();
  const redirectUri = getWebAppUrl() + '?mode=callback';
  
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    payload: {
      'code': code,
      'client_id': clientId,
      'client_secret': clientSecret,
      'redirect_uri': redirectUri,
      'grant_type': 'authorization_code'
    }
  });
  
  const data = JSON.parse(response.getContentText());
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }
  
  return data;
}

function showSuccessPage(tokens) {
  const webAppUrl = getWebAppUrl();
  const clientId = getOAuthClientId();
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>MCP Gas Server - Authorization Complete</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .success { color: #0f5132; background: #d1e7dd; padding: 15px; border-radius: 5px; }
        .code { background: #f8f9fa; padding: 15px; font-family: monospace; border-radius: 5px; overflow-x: auto; }
        .copy-button { background: #6c757d; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="success">
        <h1>✅ Authorization Successful!</h1>
        <p>Your MCP Gas Server is now authorized to access Google Apps Script.</p>
      </div>
      
      <h2>🔧 MCP Server Configuration</h2>
      <p>Use these environment variables with your MCP Gas Server:</p>
      
      <div class="code" id="envVars">
export GOOGLE_OAUTH_CLIENT_ID="${clientId}"
export GOOGLE_OAUTH_CLIENT_SECRET="${getOAuthClientSecret()}"
export GOOGLE_OAUTH_ACCESS_TOKEN="${tokens.access_token}"
export GOOGLE_OAUTH_REFRESH_TOKEN="${tokens.refresh_token || 'N/A'}"
      </div>
      <button class="copy-button" onclick="copyToClipboard()">📋 Copy to Clipboard</button>
      
      <h2>🚀 Start Your MCP Server</h2>
      <div class="code">
# Set the environment variables above, then:
npm run build
npm start
      </div>
      
      <h2>🔗 Quick Links</h2>
      <ul>
        <li><a href="${webAppUrl}?mode=credentials">View Current Credentials</a></li>
        <li><a href="${webAppUrl}?mode=authorize">Re-authorize</a></li>
      </ul>
      
      <script>
        function copyToClipboard() {
          const text = document.getElementById('envVars').textContent;
          navigator.clipboard.writeText(text).then(() => {
            alert('Copied to clipboard!');
          });
        }
      </script>
    </body>
    </html>
  `;
  
  return HtmlService.createHtmlOutput(html);
}

function showCredentials() {
  const props = PropertiesService.getUserProperties().getProperties();
  const hasTokens = props.access_token && props.refresh_token;
  
  if (!hasTokens) {
    return HtmlService.createHtmlOutput(`
      <h1>No Active Authorization</h1>
      <p><a href="?mode=authorize">Authorize MCP Gas Server</a></p>
    `);
  }
  
  const expiresAt = new Date(parseInt(props.expires_at));
  const isExpired = Date.now() > parseInt(props.expires_at);
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>MCP Gas Server - Current Credentials</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .status { padding: 15px; border-radius: 5px; margin: 10px 0; }
        .active { color: #0f5132; background: #d1e7dd; }
        .expired { color: #842029; background: #f8d7da; }
        .code { background: #f8f9fa; padding: 15px; font-family: monospace; border-radius: 5px; }
      </style>
    </head>
    <body>
      <h1>🔑 Current Authorization Status</h1>
      
      <div class="status ${isExpired ? 'expired' : 'active'}">
        <strong>Status:</strong> ${isExpired ? '❌ Expired' : '✅ Active'}<br>
        <strong>Expires:</strong> ${expiresAt.toLocaleString()}
      </div>
      
      <h2>Environment Variables</h2>
      <div class="code">
export GOOGLE_OAUTH_CLIENT_ID="${getOAuthClientId()}"
export GOOGLE_OAUTH_CLIENT_SECRET="${getOAuthClientSecret()}"
export GOOGLE_OAUTH_ACCESS_TOKEN="${props.access_token?.substring(0, 20)}..."
export GOOGLE_OAUTH_REFRESH_TOKEN="${props.refresh_token?.substring(0, 20)}..."
      </div>
      
      <p><a href="?mode=authorize">🔄 Re-authorize</a></p>
    </body>
    </html>
  `;
  
  return HtmlService.createHtmlOutput(html);
}

// Helper functions - you'll need to implement these based on your OAuth setup
function getOAuthClientId() {
  // Return your OAuth client ID
  return 'your_oauth_client_id_here';
}

function getOAuthClientSecret() {
  // Return your OAuth client secret  
  return 'your_oauth_client_secret_here';
}

function getWebAppUrl() {
  // Return the current web app URL
  return ScriptApp.getService().getUrl();
}
```

### 2. Deploy as Web App

1. **Deploy** → **New Deployment**
2. **Type**: Web app
3. **Execute as**: Me
4. **Who has access**: Anyone
5. **Deploy** and copy the web app URL

### 3. Configure OAuth Client

1. **Google Cloud Console** → **APIs & Services** → **Credentials**
2. **Create OAuth 2.0 Client ID**
3. **Authorized redirect URIs**: Add your web app URL + `?mode=callback`
4. **Update the helper functions** in your GAS code with the client ID/secret

## Usage (Users Do This)

### 1. Visit Authorization URL
Users visit: `https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec`

### 2. Authorize Application
- Click "Authorize MCP Gas Server"
- Complete Google OAuth consent
- Get environment variables automatically

### 3. Configure MCP Server
```bash
# Copy the provided environment variables
export GOOGLE_OAUTH_CLIENT_ID="..."
export GOOGLE_OAUTH_CLIENT_SECRET="..."
export GOOGLE_OAUTH_ACCESS_TOKEN="..."
export GOOGLE_OAUTH_REFRESH_TOKEN="..."

# Start MCP server
npm run build && npm start
```

## Benefits

✅ **No manual OAuth setup** required by users
✅ **One-click authorization** experience  
✅ **Automatic credential generation**
✅ **Secure token handling**
✅ **Works with existing MCP code** (no changes needed)
✅ **Professional consent screen**

## Security Notes

- Tokens are stored in Google Apps Script's secure PropertiesService
- Only authorized users can access their own tokens
- Standard Google OAuth 2.0 security practices
- Refresh tokens enable long-term access

---

**Result**: Users get the same "authorize this app" experience as GAS debug console, but for your MCP server! 