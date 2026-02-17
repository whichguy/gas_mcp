# Deployment Workflow Guide (Web App)

> **Note:** This document covers `version_deploy` (low-level web app deployments). For standard
> library version pinning (recommended for most projects), see
> **[LIBRARY_DEPLOYMENT_WORKFLOW.md](LIBRARY_DEPLOYMENT_WORKFLOW.md)**.

Complete guide to managing Google Apps Script web app deployments across development, staging, and production environments.

---

## Table of Contents

1. [Overview](#overview)
2. [Environments Explained](#environments-explained)
3. [Quick Start](#quick-start)
4. [Operations](#operations)
   - [Promote](#promote-operation)
   - [Rollback](#rollback-operation)
   - [Status](#status-operation)
   - [Reset](#reset-operation)
5. [Complete Workflow Example](#complete-workflow-example)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Overview

### Three-Environment Workflow

```
┌─────────┐         ┌──────────┐         ┌──────────┐
│   DEV   │ promote │ STAGING  │ promote │   PROD   │
│  (HEAD) ├────────>│ (versioned)├────────>│ (stable) │
└─────────┘         └──────────┘         └──────────┘
    ↑                    ↑                     ↑
    │                    │                     │
  latest             snapshot              production
   code               for testing            release
```

### Philosophy

- **dev**: Always points to HEAD (latest code) - no versioning
- **staging**: Versioned snapshots for QA/testing before production
- **prod**: Stable, tested production releases

All environments use automatic tagging: `[DEV]`, `[STAGING]`, `[PROD]` for easy identification.

---

## Environments Explained

### 1. **Development (dev)**

**Purpose**: Active development and testing

**Characteristics**:
- Always points to HEAD (latest code)
- Auto-updates when you modify files
- No version numbers
- Tagged with `[DEV]`

**Use for**:
- Rapid iteration during development
- Testing new features
- Quick debugging

**URL**: Provides test URL for immediate feedback

### 2. **Staging (staging)**

**Purpose**: Pre-production testing and validation

**Characteristics**:
- Versioned snapshots (v1, v2, v3, ...)
- Immutable once created
- Tagged with `[STAGING]`
- Requires explicit promotion from dev

**Use for**:
- QA testing
- Stakeholder review
- Integration testing
- Performance testing

**URL**: Stable URL for testers

### 3. **Production (prod)**

**Purpose**: Live, customer-facing deployment

**Characteristics**:
- Points to specific staging version
- Highly stable and tested
- Tagged with `[PROD]`
- Requires explicit promotion from staging

**Use for**:
- Live production workloads
- Customer/end-user access
- Mission-critical operations

**URL**: Production URL for real users

---

## Quick Start

### Initial Setup (First Time)

```typescript
// 1. Reset to create all 3 environments
const result = await version_deploy({
  operation: 'reset',
  scriptId: 'your-script-id-here'
});

// Result shows all 3 deployment URLs:
// - dev: https://...dev-deployment-id...
// - staging: https://...staging-deployment-id...
// - prod: https://...prod-deployment-id...
```

### First Promotion (dev → staging)

```typescript
// 2. After development, promote to staging
const promoteResult = await version_deploy({
  operation: 'promote',
  environment: 'staging',
  scriptId: 'your-script-id-here',
  description: 'v1.0 Release Candidate - Initial release'
});

// Creates version 1 and updates staging deployment
// Result shows: versionNumber: 1, url: ...
```

### Deploy to Production (staging → prod)

```typescript
// 3. After testing in staging, promote to prod
const prodResult = await version_deploy({
  operation: 'promote',
  environment: 'prod',
  scriptId: 'your-script-id-here'
});

// Updates prod deployment to staging's version
// No description needed - copies from staging version
```

---

## Operations

### Promote Operation

Moves code forward through the deployment pipeline.

#### Promote dev → staging

**Creates a version snapshot** from current HEAD and updates staging deployment.

```typescript
await version_deploy({
  operation: 'promote',
  environment: 'staging',
  scriptId: 'abc123...',
  description: 'Bug fixes for issues #42 and #53'
});
```

**What happens**:
1. Creates new version from HEAD (auto-increments: v1, v2, v3, ...)
2. Tags description with `[STAGING]`
3. Updates staging deployment to point to new version
4. Returns version number and staging URL

**When to use**:
- Feature complete and ready for QA
- Bug fixes ready for testing
- Want stable snapshot for review

**Requirements**:
- `description` parameter is **required**
- Dev deployment must exist (run `reset` if not)

#### Promote staging → prod

**Updates production** to staging's current version.

```typescript
await version_deploy({
  operation: 'promote',
  environment: 'prod',
  scriptId: 'abc123...'
});
```

**What happens**:
1. Reads staging's current version number
2. Updates prod deployment to that version
3. Tags as `[PROD] v{version} (promoted from staging)`
4. Returns version number and prod URL

**When to use**:
- QA complete in staging
- Ready for production release
- All stakeholders approved

**Requirements**:
- Staging must be on a version (not HEAD)
- If staging is on HEAD, promote dev→staging first

---

### Rollback Operation

Reverts to a previous version.

#### Automatic Rollback (to previous version)

```typescript
await version_deploy({
  operation: 'rollback',
  environment: 'staging',  // or 'prod'
  scriptId: 'abc123...'
});
```

**What happens**:
- Automatically finds previous tagged version
- Updates deployment to that version
- Preserves all version history

#### Manual Rollback (to specific version)

```typescript
await version_deploy({
  operation: 'rollback',
  environment: 'prod',
  scriptId: 'abc123...',
  toVersion: 3  // Rollback to version 3
});
```

**When to use**:
- Production issue discovered
- Need to revert to known good state
- Testing previous behavior

**Supported environments**:
- ✅ staging
- ✅ prod
- ❌ dev (always points to HEAD)

**Best practices**:
- Test rollback in staging first
- Document reason for rollback
- Keep old versions for at least 30 days

---

### Status Operation

View current state of all deployments.

```typescript
const status = await version_deploy({
  operation: 'status',
  scriptId: 'abc123...'
});
```

**Returns**:
```typescript
{
  dev: {
    deploymentId: "...",
    versionNumber: null,  // Always HEAD
    description: "[DEV] Development",
    url: "https://script.google.com/..."
  },
  staging: {
    deploymentId: "...",
    versionNumber: 5,
    description: "[STAGING] v5 Bug fixes",
    url: "https://script.google.com/..."
  },
  prod: {
    deploymentId: "...",
    versionNumber: 4,
    description: "[PROD] v4 (promoted from staging)",
    url: "https://script.google.com/..."
  }
}
```

**When to use**:
- Check which version is in each environment
- Get deployment URLs
- Verify promotion succeeded
- Audit current state

---

### Reset Operation

Recreates all three deployments from scratch.

```typescript
await version_deploy({
  operation: 'reset',
  scriptId: 'abc123...'
});
```

**What happens**:
1. **Deletes** all existing deployments (if any)
2. Creates new dev deployment (HEAD)
3. Creates new staging deployment (HEAD initially)
4. Creates new prod deployment (HEAD initially)
5. All tagged with environment names

**When to use**:
- First time setup
- Deployments are corrupted/missing
- Want clean slate (⚠️ **DESTRUCTIVE**)

**⚠️ Warning**:
- Deletes ALL existing deployments
- Creates new deployment IDs (URLs change)
- Consider impact on existing users
- Backup deployment IDs before reset

**Best practices**:
- Use during initial project setup
- Document old URLs before reset
- Update any external references to new URLs
- Run `status` after reset to save new URLs

---

## Complete Workflow Example

### Scenario: Building and Deploying a New Feature

#### Step 1: Initial Development

```typescript
// Develop locally, test with dev deployment
// Dev always points to HEAD - instant testing

// Check current state
await version_deploy({
  operation: 'status',
  scriptId: 'abc123...'
});
// dev: v1, staging: v1, prod: v1
```

#### Step 2: Feature Complete - Promote to Staging

```typescript
// Feature ready for QA
await version_deploy({
  operation: 'promote',
  environment: 'staging',
  scriptId: 'abc123...',
  description: 'v1.1 Add email notification feature'
});
// Creates version 2
// dev: HEAD, staging: v2, prod: v1
```

#### Step 3: QA Testing in Staging

```bash
# QA team tests staging URL
# Issues found? Fix in dev, promote again (creates v3)
# No issues? Ready for production
```

#### Step 4: Promote to Production

```typescript
// All tests passed in staging
await version_deploy({
  operation: 'promote',
  environment: 'prod',
  scriptId: 'abc123...'
});
// Prod now points to v2 (staging's version)
// dev: HEAD, staging: v2, prod: v2
```

#### Step 5: Bug Discovered in Production

```typescript
// Critical bug found - rollback immediately
await version_deploy({
  operation: 'rollback',
  environment: 'prod',
  scriptId: 'abc123...'
});
// Prod reverts to v1
// dev: HEAD, staging: v2, prod: v1

// Fix bug in dev, promote to staging (v3), test, then promote to prod
```

---

## Best Practices

### Version Descriptions

**Good descriptions**:
```typescript
✅ 'v1.0 Initial release with core features'
✅ 'Bug fixes for issues #42, #53, #67'
✅ 'Performance improvements for large datasets'
✅ 'Add user authentication and authorization'
```

**Poor descriptions**:
```typescript
❌ 'Update'
❌ 'Fix'
❌ 'Changes'
❌ 'Version 2'
```

**Guidelines**:
- Be specific about changes
- Reference issue/ticket numbers
- Mention feature names
- Include impact (bug fix, enhancement, breaking change)

### Promotion Timing

**Promote to staging when**:
- Feature development complete
- Local testing passed
- Ready for broader testing
- Want stable snapshot for review

**Promote to production when**:
- All QA tests passed in staging
- Stakeholder approval received
- No known critical bugs
- Change window allows deployment

**Don't promote when**:
- Tests are failing
- Known bugs exist
- During high-traffic periods (unless urgent fix)
- Without testing in staging first

### Rollback Strategy

**Plan before you need it**:
1. Document rollback procedure
2. Test rollback in staging periodically
3. Keep at least 3 previous versions
4. Have monitoring to detect issues early

**When to rollback**:
- Critical bugs affecting users
- Performance degradation
- Security vulnerability
- Data corruption risk

**After rollback**:
1. Document what went wrong
2. Fix issue in dev
3. Promote to staging for testing
4. Verify fix before re-promoting to prod

### Monitoring and Verification

**After each promotion**:
```typescript
// 1. Check status
const status = await version_deploy({
  operation: 'status',
  scriptId: 'abc123...'
});

// 2. Verify version numbers
console.log(`Staging is on v${status.staging.versionNumber}`);
console.log(`Prod is on v${status.prod.versionNumber}`);

// 3. Test deployment URL
console.log(`Test at: ${status.staging.url}`);

// 4. Verify functionality
// Run smoke tests, check logs, monitor metrics
```

---

## Troubleshooting

### "staging_deployment not found"

**Cause**: No staging deployment exists

**Solution**:
```typescript
await version_deploy({
  operation: 'reset',
  scriptId: 'abc123...'
});
```

### "staging_version is HEAD (null)"

**Cause**: Staging is on HEAD instead of a version

**Solution**: Promote dev→staging first to create a version
```typescript
await version_deploy({
  operation: 'promote',
  environment: 'staging',
  scriptId: 'abc123...',
  description: 'Create initial version'
});
```

### "description required for promote to staging"

**Cause**: Missing description parameter

**Solution**: Add description
```typescript
await version_deploy({
  operation: 'promote',
  environment: 'staging',
  scriptId: 'abc123...',
  description: 'Your version description here'  // ← Add this
});
```

### Wrong version in production

**Cause**: Promoted too quickly without testing

**Solution**: Rollback and test properly
```typescript
// 1. Rollback prod to previous version
await version_deploy({
  operation: 'rollback',
  environment: 'prod',
  scriptId: 'abc123...'
});

// 2. Fix issues in dev
// 3. Promote to staging and test thoroughly
// 4. Only then promote to prod
```

### Deployment URLs changed

**Cause**: Used `reset` operation

**Solution**:
- `reset` creates new deployment IDs (new URLs)
- Save URLs from `status` operation
- Update any external references
- Consider using config management for URLs

### Can't promote: "No version found"

**Cause**: Never promoted to staging before

**Solution**: First promotion creates version 1
```typescript
await version_deploy({
  operation: 'promote',
  environment: 'staging',
  scriptId: 'abc123...',
  description: 'v1.0 Initial version'
});
```

---

## Related Documentation

- **Tool Reference**: See `src/tools/deployment.ts` for implementation details
- **API Reference**: See `docs/api/API_REFERENCE.md` for API specifications
- **CLAUDE.md**: Quick reference for AI assistants

---

## Questions?

**Q: How do I get deployment URLs?**
A: Use `version_deploy({operation: 'status', ...})` to see all URLs

**Q: Can I skip staging and go directly to prod?**
A: Not recommended - always test in staging first for safety

**Q: How many versions can I keep?**
A: Google Apps Script keeps all versions - manage manually if needed

**Q: Can I rename environments?**
A: No - dev/staging/prod are fixed by design for consistency

**Q: What if I delete a deployment accidentally?**
A: Run `version_deploy({operation: 'reset', ...})` to recreate all three

**Q: Can I have more than 3 environments?**
A: Current design supports 3 - extend manually if needed

---

**Last Updated**: 2025-01-23
**Version**: 1.0
**Maintainer**: MCP Gas Server Team
