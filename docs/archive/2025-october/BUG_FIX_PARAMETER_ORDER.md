# Bug Fix: Parameter Order Mismatch in createProject

## Problem

Integration tests were failing with "Access token is required for API initialization" even though:
- ✅ OAuth completed successfully
- ✅ Token was stored in SessionManager
- ✅ Token validation passed
- ✅ `getAccessToken()` returned valid token

## Root Cause

**Parameter order mismatch** between `GASClient.createProject()` and `InProcessTestClient.createProject()`.

### GASClient Signature

```typescript
// File: src/api/gasClient.ts:831
async createProject(title: string, parentId?: string, accessToken?: string): Promise<GASProject>
```

### InProcessTestClient Call (BEFORE FIX)

```typescript
// File: test/helpers/inProcessClient.ts:249-253
async createProject(title: string): Promise<any> {
  const accessToken = await this.getAccessToken();
  const project = await this.gasClient.createProject(title, accessToken);  // ❌ WRONG
  return project;
}
```

### The Problem

When calling `this.gasClient.createProject(title, accessToken)`:
- `title` → matched `title` parameter ✅
- `accessToken` → matched `parentId` parameter ❌ (wrong position!)
- `undefined` → matched `accessToken` parameter ❌ (missing!)

So the access token was being passed as the `parentId`, and the actual `accessToken` parameter received `undefined`, causing the "Access token is required" error.

## The Fix

```typescript
// File: test/helpers/inProcessClient.ts:249-255 (AFTER FIX)
async createProject(title: string): Promise<any> {
  const accessToken = await this.getAccessToken();
  // Note: GASClient.createProject signature is (title, parentId?, accessToken?)
  // Pass undefined for parentId to correctly position accessToken parameter
  const project = await this.gasClient.createProject(title, undefined, accessToken);  // ✅ CORRECT
  return project;
}
```

Now:
- `title` → `title` parameter ✅
- `undefined` → `parentId` parameter ✅ (optional, no parent)
- `accessToken` → `accessToken` parameter ✅ (correct position!)

## Why Token Validation Passed But API Call Failed

The token validation we added was checking that the token exists in the SessionManager:

```typescript
const testToken = await client.getAccessToken();  // This worked!
```

But the actual bug was in **how the token was passed** to the API call, not in retrieving it. The validation confirmed the token was available, but the parameter order bug meant it was being passed in the wrong position.

## Lesson Learned

When debugging "missing parameter" errors:
1. ✅ Check parameter retrieval (was token available?)
2. ✅ Check parameter passing (is it in the right position?)
3. ✅ Check function signatures (what's the exact parameter order?)

In this case, we focused on #1 (retrieval) and added excellent validation, but the actual bug was #2 (parameter order).

## Impact

**Before Fix**:
- Tests failed with "Access token is required for API initialization"
- Misleading error message (token WAS available, just passed incorrectly)

**After Fix**:
- Tests can successfully create projects
- Access token properly passed to GAS API
- All token validation still in place (good defensive programming!)

## Related Fixes

The token validation fixes we added are still valuable:
- They confirm authentication completed properly
- They provide clear diagnostic messages
- They catch token storage issues early
- They help identify the root cause faster

The bug we found was orthogonal to token availability - it was a classic parameter order mismatch that would have been caught immediately if TypeScript strict mode required all optional parameters to be explicitly passed.

## Prevention

Consider:
1. Using named parameters/options objects instead of positional parameters
2. Making required parameters non-optional at the API layer
3. Adding type guards or runtime validation for parameter positions
4. Better IDE/compiler warnings for optional parameter mismatches

## Files Modified

- `/Users/jameswiese/src/mcp_gas/test/helpers/inProcessClient.ts` (line 253)
  - Fixed: Added `undefined` for `parentId` parameter to correctly position `accessToken`
  - Added comment explaining the parameter order
