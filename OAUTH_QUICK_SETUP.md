# Quick OAuth Setup Guide

🚀 **5-Minute Google OAuth Setup for MCP Gas Server**

## 📝 Prerequisites
- Google Account
- 5 minutes of time
- Your MCP server running on localhost:3000

## 🔧 Step-by-Step Setup

### 1. Create Google Cloud Project (2 minutes)

1. **Go to [Google Cloud Console](https://console.cloud.google.com/)**
2. **Create New Project**:
   - Click "Select a project" → "New Project"
   - Name: "MCP Gas Integration" (or any name)
   - Click "Create"

### 2. Enable APIs (1 minute)

1. **Enable Google Apps Script API**:
   - Go to "APIs & Services" → "Library"
   - Search "Google Apps Script API"
   - Click it → Click "Enable"

2. **Enable Google Drive API** (optional but recommended):
   - Search "Google Drive API" 
   - Click it → Click "Enable"

### 3. Configure OAuth Consent Screen (1 minute)

1. **Go to "APIs & Services" → "OAuth consent screen"**
2. **Choose "External"** (unless you have a Google Workspace)
3. **Fill required fields**:
   - App name: "MCP Gas Server"
   - User support email: your email
   - Developer contact: your email
4. **Click "Save and Continue"** through all steps (can skip optional fields)

### 4. Create OAuth Credentials (1 minute)

1. **Go to "APIs & Services" → "Credentials"**
2. **Click "Create Credentials" → "OAuth 2.0 Client IDs"**
3. **Application type**: "Web application"
4. **Name**: "MCP Gas OAuth Client"
5. **Authorized redirect URIs**: Add:
   ```
   http://localhost:3000/oauth/callback
   ```
6. **Click "Create"**
7. **Copy the Client ID and Client Secret**

### 5. Update MCP Configuration (30 seconds)

Edit `config/oauth.json`:
```json
{
  "oauth": {
    "client_id": "YOUR_ACTUAL_CLIENT_ID_HERE",
    "client_secret": "YOUR_ACTUAL_CLIENT_SECRET_HERE",
    "redirect_uri": "http://localhost:3000/oauth/callback",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
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
  },
  "server": {
    "port": 3000
  }
}
```

### 6. Test Authentication

```bash
# Rebuild with new credentials
npm run build

# Test OAuth flow
npm start
# Then in another terminal or via MCP tools:
# gas_auth --mode=start
```

## ✅ **Success Indicators**

After setup, you should see:
- ✅ Browser opens to real Google OAuth consent screen
- ✅ You can grant permissions to your app
- ✅ Successful redirect back to localhost:3000
- ✅ Authentication tokens saved
- ✅ MCP tools work with real Google Apps Script projects

## 🚫 **Common Issues**

| Problem | Solution |
|---------|----------|
| "OAuth client was not found" | You're still using test credentials - update config/oauth.json |
| "Redirect URI mismatch" | Make sure you added `http://localhost:3000/oauth/callback` exactly |
| "Access blocked" | Complete OAuth consent screen setup |
| "APIs not enabled" | Enable Google Apps Script API in Cloud Console |

## 📚 **What's Next?**

Once OAuth is working with real credentials:

1. **Test in Cursor**: Configure MCP server in Cursor settings
2. **Create GAS Projects**: Use `gas_project_create` tool
3. **Write Code**: Use `gas_write` to add functions
4. **Execute Functions**: Use `gas_run` to test your code
5. **Deploy**: Use `gas_deploy_create` for production

## 🔒 **Security Note**

- ✅ Your `config/oauth.json` is in `.gitignore` (never committed)
- ✅ Tokens are stored locally and encrypted
- ✅ Only you have access to your Google account through this app
- ✅ You can revoke access anytime in Google Account settings

---

**Total Time**: ~5 minutes
**Difficulty**: Easy
**Result**: Fully functional Google Apps Script integration! 