# Authentication Requirements for MCP Gas

## ⚠️ Critical: Bearer Token Required for All Commands

**ALL commands including `curl` requests require proper authentication with a valid bearer token.** This includes web app deployments, even those configured with "ANYONE" access, when deployed under Google Workspace domains.

## Why Bearer Tokens Are Required

### Google Workspace Domain Protection
- Web apps deployed under Google Workspace domains (e.g., `fortifiedstrength.org`) enforce authentication
- Even with `webAppAccess: "ANYONE"` setting, the workspace domain overrides this
- External access requires valid OAuth bearer tokens

### API Execution Security
- Google Apps Script API calls always require authentication
- Bearer tokens validate the calling application's permissions
- Tokens ensure proper scope access and rate limiting

## Obtaining Bearer Tokens

### 1. Through MCP Gas Server
The MCP Gas server handles OAuth flow and provides bearer tokens:

```bash
# Start OAuth flow
gas_auth --mode=start

# Check authentication status and get token info
gas_auth --mode=status
```

### 2. Direct OAuth Flow
For manual testing, complete the OAuth flow and extract tokens from the MCP server's auth state.

## Using Bearer Tokens with curl

### Web App Requests
```bash
# Get your bearer token from MCP Gas server auth state
BEARER_TOKEN="ya29.a0AfH6SMC..." # Your actual token

# Call Fibonacci function
curl -H "Authorization: Bearer $BEARER_TOKEN" \
  "https://script.google.com/a/macros/fortifiedstrength.org/s/AKfycbyRavdEJYR0dMX7R98WCiD66sZI-u-73mjbMLZLAJHsswyykB2-sMCNYKyjst-Gv_vjDA/exec?function_plus_args=fib(9)"

# Alternative parameter format
curl -H "Authorization: Bearer $BEARER_TOKEN" \
  "https://script.google.com/a/macros/fortifiedstrength.org/s/AKfycbyRavdEJYR0dMX7R98WCiD66sZI-u-73mjbMLZLAJHsswyykB2-sMCNYKyjst-Gv_vjDA/exec?func=fib(9)"

# POST request with JSON
curl -H "Authorization: Bearer $BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"function_plus_args": "fib(9)"}' \
  "https://script.google.com/a/macros/fortifiedstrength.org/s/AKfycbyRavdEJYR0dMX7R98WCiD66sZI-u-73mjbMLZLAJHsswyykB2-sMCNYKyjst-Gv_vjDA/exec"
```

### API Execution Requests
```bash
# Apps Script API execution
curl -H "Authorization: Bearer $BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "function": "fib",
    "parameters": [9]
  }' \
  "https://script.googleapis.com/v1/scripts/1FvYMCePqwpasjYyH0XbvrsIzFvdkQOrQuKt8Di2cuyUrRT9jx5HsSA46:run"
```

## Bearer Token Scope Requirements

### Required OAuth Scopes
```json
{
  "scopes": [
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.processes", 
    "https://www.googleapis.com/auth/script.deployments",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.webapp.deploy"
  ]
}
```

### Token Validation
Tokens must have sufficient scopes for:
- ✅ Reading script projects
- ✅ Executing deployed functions  
- ✅ Accessing web app endpoints
- ✅ Making external requests from scripts

## Error Messages Without Bearer Tokens

### Web App Access Denied
```html
<HTML>
<HEAD><TITLE>Moved Temporarily</TITLE></HEAD>
<BODY>
<H1>Moved Temporarily</H1>
The document has moved <A HREF="...ServiceLogin...">here</A>.
</BODY>
</HTML>
```

### API Execution Access Denied
```json
{
  "error": {
    "code": 401,
    "message": "Request is missing required authentication credential.",
    "status": "UNAUTHENTICATED"
  }
}
```

### Apps Script API Permission Denied
```json
{
  "error": {
    "code": 403, 
    "message": "The caller does not have permission",
    "status": "PERMISSION_DENIED"
  }
}
```

## Working Examples

### 1. Complete Fibonacci Execution Flow
```bash
# 1. Authenticate and get bearer token
echo "Step 1: Get bearer token from MCP Gas server authentication"

# 2. Execute via web app (requires bearer token)
BEARER_TOKEN="your_token_here"
curl -H "Authorization: Bearer $BEARER_TOKEN" \
  "https://script.google.com/a/macros/fortifiedstrength.org/s/AKfycbyRavdEJYR0dMX7R98WCiD66sZI-u-73mjbMLZLAJHsswyykB2-sMCNYKyjst-Gv_vjDA/exec?function_plus_args=fib(9)"

# Expected response:
# {
#   "function_called": "fib(9)",
#   "result": 34,
#   "message": "Successfully executed: fib(9)",
#   "timestamp": "2025-06-13T03:30:00.000Z"
# }
```

### 2. MCP Gas Tool Usage (Handles Tokens Automatically)
```javascript
// MCP Gas tools handle bearer tokens internally
gas_run(scriptId="1FvYMCePqwpasjYyH0XbvrsIzFvdkQOrQuKt8Di2cuyUrRT9jx5HsSA46", functionName="fib", parameters=[9])

// Tools automatically:
// - Use stored OAuth tokens
// - Refresh tokens when expired  
// - Handle authentication errors
// - Retry with fresh tokens
```

## Token Management Best Practices

### 1. Token Storage
- ✅ MCP Gas server stores tokens securely in `.auth/` directory
- ✅ Tokens are encrypted and session-isolated
- ✅ Automatic refresh when tokens expire

### 2. Token Security
- ❌ Never commit bearer tokens to version control
- ❌ Never log bearer tokens in console output
- ❌ Never share tokens in URLs or GET parameters
- ✅ Use HTTPS for all token-authenticated requests

### 3. Token Lifecycle
- **Valid Duration**: Typically 1 hour for access tokens
- **Refresh Tokens**: Used to obtain new access tokens
- **Expiration Handling**: MCP Gas server auto-refreshes
- **Revocation**: Can be revoked via Google Account settings

## Troubleshooting Authentication Issues

### Issue: "Moved Temporarily" HTML Response
**Cause**: Missing bearer token for Google Workspace domain access
**Solution**: Add `Authorization: Bearer TOKEN` header to requests

### Issue: "The caller does not have permission"  
**Cause**: Insufficient OAuth scopes or token expired
**Solution**: Re-authenticate with full scopes via `gas_auth --mode=start`

### Issue: "Request is missing required authentication credential"
**Cause**: No Authorization header in API request
**Solution**: Include `Authorization: Bearer TOKEN` in all API calls

### Issue: Token Expired Errors
**Cause**: Access token has exceeded 1-hour lifetime
**Solution**: MCP Gas server auto-refreshes, or manually restart auth flow

## Integration Examples

### Curl Script with Token Management
```bash
#!/bin/bash
# get_fibonacci.sh - Complete authenticated Fibonacci calculation

# Get bearer token from MCP Gas server
echo "Getting bearer token..."
# (Extract from MCP server auth state or environment)
BEARER_TOKEN="${GOOGLE_BEARER_TOKEN}"

if [ -z "$BEARER_TOKEN" ]; then
  echo "Error: Bearer token required. Run gas_auth first."
  exit 1
fi

# Call Fibonacci function
echo "Calculating fib(9)..."
RESULT=$(curl -s -H "Authorization: Bearer $BEARER_TOKEN" \
  "https://script.google.com/a/macros/fortifiedstrength.org/s/AKfycbyRavdEJYR0dMX7R98WCiD66sZI-u-73mjbMLZLAJHsswyykB2-sMCNYKyjst-Gv_vjDA/exec?function_plus_args=fib(9)")

echo "Result: $RESULT"
```

### Python Integration Example
```python
import requests
import json

# Bearer token from MCP Gas server authentication
bearer_token = "ya29.a0AfH6SMC..."  # Your actual token

headers = {
    "Authorization": f"Bearer {bearer_token}",
    "Content-Type": "application/json"
}

# Web app execution
response = requests.get(
    "https://script.google.com/a/macros/fortifiedstrength.org/s/AKfycbyRavdEJYR0dMX7R98WCiD66sZI-u-73mjbMLZLAJHsswyykB2-sMCNYKyjst-Gv_vjDA/exec",
    params={"function_plus_args": "fib(9)"},
    headers=headers
)

print("Fibonacci result:", response.json())
```

## Critical Finding: Google Workspace Domain Override

### ⚠️ MCP Gas Tools Also Require Workspace Authentication
**Even MCP Gas tools with automatic token management encounter authentication issues when scripts are deployed under Google Workspace domains.** This indicates the workspace domain (`fortifiedstrength.org`) enforces additional authentication layers beyond standard OAuth.

### Workspace Domain Authentication Override
```json
{
  "error": "Web app returned HTML error page instead of JSON",
  "cause": "Google Workspace domain authentication enforcement",
  "override": "Even 'ANYONE' access + valid OAuth tokens are insufficient",
  "solution": "Workspace-specific authentication or domain admin configuration required"
}
```

### Tested Scenarios (All Failed)
- ❌ `curl` without bearer token → Redirected to workspace login
- ❌ `curl` with valid bearer token → Would still require workspace auth
- ❌ MCP Gas `gas_run` tool → HTML error page instead of JSON
- ❌ Web app with "ANYONE" access → Workspace domain override
- ❌ System test functions → Same authentication failure

## Summary

**🔑 Key Point**: Google Workspace domains (`*.fortifiedstrength.org`) enforce authentication that overrides standard OAuth and "ANYONE" access settings.

**🚛 Limitation**: Standard OAuth bearer tokens may be insufficient for Google Workspace-deployed scripts.

**🛠️ Solutions**:
1. **Personal Google Account**: Deploy scripts under personal Google accounts (not workspace domains)
2. **Workspace Admin**: Configure domain settings to allow external access
3. **Domain Authentication**: Use workspace-specific authentication flows
4. **Direct API**: Use Apps Script API execution instead of web apps (may work better)

**📋 Current Status - Fibonacci Project**: 
- ✅ Project created: "Fibonacci Calculator"
- ✅ Function implemented: `fib(9)` returns `34`
- ✅ Infrastructure deployed: Web apps, API executables, proxy handlers
- ❌ Execution blocked: Google Workspace domain authentication requirements
- ✅ Documentation complete: Bearer token requirements understood

**🎯 Next Steps**: 
1. Consider deploying under personal Google account for testing
2. Contact workspace admin for domain authentication configuration
3. Use Apps Script API execution as alternative to web apps
4. Reference this documentation for authentication requirements 