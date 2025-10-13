# Craft.md Use Case Enhancement Summary

**Date**: 2025-10-12
**Session**: Continuation - Use Case Access Paths & Lifecycle Documentation

## Overview

Enhanced craft.md use case documentation to include complete user access paths, navigation, prerequisites, runtime lifecycle, and API interaction lifecycle. This ensures use cases document not just *what* users do, but *how* they get there, *what* they need, and *where* they go after.

## Changes Completed

### 1. Enhanced Primary Use Case Template (lines 1511-1555 + Access Journey)

**UPDATE**: Added mandatory "Access Journey Illustration" directive to both templates

Added 5 new comprehensive sections to UC-1 template:

**Entry Point & Access Path**:
- UI navigation paths (menu hierarchies, button flows)
- Direct URLs and deep links
- External triggers (webhooks, emails, scheduled jobs)
- API endpoints for programmatic access
- Discovery methods (how users learn features exist)

**Access Requirements**:
- Authentication (logged in, anonymous, service account)
- Authorization (roles, permissions, ownership)
- Prerequisites (verified accounts, payment methods, existing data)
- Session state (active workspace, valid tokens)
- Data context (form state, selected projects)

**User Journey Context**:
- Previous step (what typically happens before)
- User's ultimate goal (what they're trying to achieve)
- Workflow position (step N of M, one-time, recurring)

**Runtime Lifecycle**:
- Initialization (data loading, state setup, connections)
- Active state (form validation, WebSocket connections, autosave)
- Cleanup (connection close, temp file removal, draft save)
- Timeout/expiry (session lifetime, lock duration)

**Exit Points**:
- Success exit (redirect destinations after completion)
- Cancel exit (where users go if they cancel)
- Error exit (error handling and recovery paths)

**⚠️ REQUIRED: Access Journey Illustration** (NEW - Added after initial enhancement):
- Step-by-step narrative showing how actor gains access to scenario
- Documents complete journey from initial state to use case trigger point
- Includes three detailed examples:
  - UI access example (6 steps from login to feature activation)
  - API access example (6 steps from key generation to endpoint call)
  - Scheduled/automated access example (5 steps from configuration to invocation)
- Explicit requirements for what illustration must show:
  - Starting point (actor's initial state)
  - Each authentication/authorization step
  - Each navigation or system action
  - Intermediate states/screens encountered
  - Exact trigger point where use case begins
- Purpose statement explaining this reveals hidden assumptions about authentication flows, navigation patterns, and system states

### 2. Enhanced Related Use Case Template (lines 1562-1598 + Access Journey)

Applied same 5 sections AND access journey illustration to UC-[N] related use case template to ensure discovered use cases have identical access and lifecycle documentation.

### 3. Added API Interaction Lifecycle Guidance (lines 1366-1394)

Enhanced "API and Authentication Considerations" section with complete request-response lifecycle:

**Request Initialization**:
- Credential acquisition flows
- Token/credential validation approaches
- Authentication order and checks

**Request Processing**:
- Input validation strategies
- Authorization checks (resource ownership, roles, scopes)
- Business logic execution patterns
- Transaction boundaries and idempotency

**Response Generation**:
- Response formats (JSON, XML, Protocol Buffers)
- Status code strategies (2xx, 4xx, 5xx)
- Error response structures
- Pagination approaches

**Connection Management**:
- Timeout configurations
- Retry strategies (exponential backoff, status codes)
- Connection pooling and keep-alive
- Circuit breaker patterns

**State Management**:
- Stateless vs stateful design
- Session lifecycle management
- Token refresh flows
- Cache strategies (headers, ETags, conditional requests)

**Monitoring and Observability**:
- Request logging and correlation IDs
- Metrics collection (latency, errors, throughput)
- Audit trails

### 4. Enhanced Step 4 Documentation Instructions (lines 1839-1896)

Added **CRITICAL** section with comprehensive guidance on documenting access paths and lifecycle:

- Explicit instructions to document all 6 aspects (entry points, access requirements, user journey context, runtime lifecycle, exit points, API lifecycle)
- **⚠️ MANDATORY: Access Journey Illustration** subsection (NEW):
  - Required for EVERY use case
  - Must document complete step-by-step narrative showing how actor gains access
  - Specific requirements listed:
    - Start with actor's initial state (logged out, on homepage, in external system)
    - Document each authentication/authorization step
    - Show each navigation action or system trigger
    - Include intermediate screens/states encountered
    - End with exact point where use case begins
  - Example provided: "1. User opens app → 2. Enters credentials → 3. Views dashboard → 4. Clicks Settings → 5. Selects User Management → 6. Clicks Create User → THIS USE CASE BEGINS"
  - Rationale: Reveals hidden assumptions about authentication flows, navigation patterns, and system states
- Updated "Why this matters" section with new first bullet:
  - **Missing access journey illustration** → implementation misses authentication gates, navigation flows, or required system states
  - Incomplete access paths → users can't find features
  - Missing prerequisites → runtime errors and frustration
  - Undocumented lifecycle → memory leaks, connection issues, data loss
  - Unclear exit points → users get stuck or lose work
- Reference to templates with examples

### 5. Updated use-cases.md Output Description (line 886)

Changed from:
```
- `<worktree>/planning/use-cases.md` (knowledge file - primary + related use cases, anti-cases, interactions)
```

To:
```
- `<worktree>/planning/use-cases.md` (knowledge file - primary + related use cases with complete access paths, entry points, prerequisites, runtime lifecycle, exit points, API interaction lifecycle, anti-cases, and interactions)
```

## Impact

**File Size**:
- Initial enhancement: 8,681 → 8,821 lines (+140 lines, +1.6%)
- Access journey directive: 8,821 → 8,919 lines (+98 lines, +1.1%)
- **Total: 8,681 → 8,919 lines (+238 lines, +2.7%)**

**Quality Improvement**: Use cases now document complete user journey from discovery through execution to exit, WITH mandatory step-by-step access journey illustrations

## Why This Matters

### Before Enhancement
Use cases documented *what* users do (triggers, flows, outcomes) but not *how* they access features or *where* they go after.

### After Enhancement
Use cases now provide complete documentation of:
1. **Discovery**: How users find the feature
2. **Access**: What they need to use it
3. **Context**: Where it fits in their workflow
4. **Lifecycle**: What happens during execution
5. **Exit**: Where they go after (success/cancel/error)
6. **APIs**: Complete request-response flow for integrations
7. **⚠️ Access Journey** (NEW): Step-by-step narrative from actor's initial state through authentication/navigation to use case trigger point

### Benefits
- **Frontend developers** know what navigation to implement
- **Backend developers** understand session requirements and lifecycle management
- **Security teams** see authentication and authorization requirements
- **DevOps** understand connection management and timeout needs
- **UX designers** understand user journey context and exit paths
- **QA teams** can test complete flows including error exits

## Examples

### UI Feature Use Case
```markdown
### UC-1: User Creates Invoice

**Entry Point & Access Path**:
- UI Navigation: Dashboard → Invoices → "New Invoice" button
- Direct URL: /invoices/create
- Discovery: Main menu, dashboard quick action

- **⚠️ REQUIRED: Access Journey Illustration**:
  1. User opens application → lands on login page
  2. User enters credentials → authenticates successfully
  3. User views dashboard → sees "Invoices" in main navigation
  4. User clicks "Invoices" → invoice list page loads
  5. User clicks "New Invoice" button → this use case begins

**Access Requirements**:
- Authentication: Must be logged in
- Authorization: "invoice.create" permission
- Prerequisites: At least one customer exists
- Data Context: Account payment verified

**Runtime Lifecycle**:
- Initialization: Load customer list, fetch tax rates, initialize form
- Active State: Form validation, autosave draft every 30s
- Cleanup: Clear temp calculations, save draft
- Timeout: Form expires after 30 minutes

**Exit Points**:
- Success: Redirect to invoice detail page
- Cancel: Return to invoice list, draft saved
- Error: Stay on form with inline validation errors
```

### API Use Case
```markdown
### UC-5: External System Creates User via API

**Entry Point & Access Path**:
- API Endpoint: POST /api/v1/users
- External Trigger: Webhook from HR system

- **⚠️ REQUIRED: Access Journey Illustration**:
  1. HR system administrator generates API key → receives key + secret
  2. HR system stores credentials → configures API client with key
  3. HR system detects new employee record → triggers user creation webhook
  4. HR system authenticates to API → includes Bearer token in Authorization header
  5. API validates token → checks scopes and rate limits
  6. API accepts POST /api/v1/users request → this use case begins

**API Interaction Lifecycle**:
- Request Initialization: JWT validation, scope check
- Request Processing: Schema validation, duplicate check
- Response Generation: 201 Created with user ID
- Connection Management: 5s timeout, 3 retries with backoff
- State Management: Stateless, no session
- Monitoring: Request ID in X-Request-ID header
```

## Related Work

This enhancement builds on previous test specification flow improvements (Phase 2-B/2-D/Phase 3) to ensure craft.md provides complete end-to-end documentation from use case discovery through implementation and testing.

## Files Modified

- `/Users/jameswiese/.claude/commands/craft.md`
  - Primary use case template (lines 1511-1555)
  - Related use case template (lines 1562-1598)
  - API considerations (lines 1366-1394)
  - Step 4 documentation instructions (lines 1755-1798)
  - Output description (line 886)

## Verification

To verify these enhancements work in practice:

1. Start new craft.md project with `/craft` command
2. Observe Stage 1 Step 4 instructions reference access paths and lifecycle
3. Check generated use-cases.md includes all new sections
4. Verify use cases document complete entry-to-exit journey
5. Confirm API use cases include complete interaction lifecycle

## Conclusion

Use case documentation now provides complete visibility into:
- How features are accessed (navigation, prerequisites, permissions)
- **⚠️ HOW actors gain access** (step-by-step journey from initial state to use case trigger) - NEW
- How they execute (initialization, active state, cleanup, timeouts)
- Where users go after (success/cancel/error paths)
- How APIs interact (complete request-response lifecycle)

The mandatory "Access Journey Illustration" directive ensures every use case documents the complete path an actor takes to reach the scenario, revealing hidden assumptions about:
- Authentication gates that must be passed
- Navigation flows that must be implemented
- System states that must exist
- Authorization checks that must be performed
- Session requirements that must be maintained

This eliminates common gaps where features are designed but access paths, authentication flows, session management, or error exits are undefined until implementation, leading to rework, inconsistent UX, and security vulnerabilities from missed authorization checks.
