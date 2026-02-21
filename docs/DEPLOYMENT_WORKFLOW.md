# Deployment Infrastructure Guide (deploy_config)

> **Note:** This document covers `deploy_config` (deployment infrastructure — reset/status).
> For deploying code to environments (the standard workflow), see
> **[LIBRARY_DEPLOYMENT_WORKFLOW.md](LIBRARY_DEPLOYMENT_WORKFLOW.md)** and use the `deploy` tool.

Guide to managing Google Apps Script web app deployment slots across development, staging, and production environments.

---

## Table of Contents

1. [Overview](#overview)
2. [Operations](#operations)
   - [Status](#status-operation)
   - [Reset](#reset-operation)
3. [When to Use](#when-to-use)
4. [Troubleshooting](#troubleshooting)

---

## Overview

`deploy_config` is an infrastructure tool for inspecting and resetting web app deployment slots. It does NOT deploy code — use `deploy()` for that.

### Three-Environment Model

```
┌─────────┐         ┌──────────┐         ┌──────────┐
│   DEV   │         │ STAGING  │         │   PROD   │
│  (HEAD) │         │(versioned)│        │ (stable) │
└─────────┘         └──────────┘         └──────────┘
```

All environments use automatic tagging: `[DEV]`, `[STAGING]`, `[PROD]` for identification.

---

## Operations

### Status Operation

View raw deployment state for all environments.

```typescript
deploy_config({
  operation: 'status',
  scriptId: 'abc123...'
})
```

**Returns:**
```typescript
{
  environments: {
    dev: { deploymentId, versionNumber: null, url, updateTime },
    staging: { deploymentId, versionNumber, url, updateTime },
    prod: { deploymentId, versionNumber, url, updateTime }
  },
  versionManagement: { totalVersions, highestVersion, prodVersions, warnings }
}
```

### Reset Operation

Recreates all three deployment slots from scratch.

```typescript
deploy_config({
  operation: 'reset',
  scriptId: 'abc123...'
})
```

**What happens:**
1. Creates new dev deployment (HEAD)
2. Creates new staging deployment (HEAD initially)
3. Creates new prod deployment (HEAD initially)
4. Deletes all previous deployments
5. Stores new deployment URLs in ConfigManager

**Warning:** Destructive — creates new deployment IDs (URLs change).

---

## When to Use

| Scenario | Tool |
|----------|------|
| Deploy code to staging/prod | `deploy()` |
| Rollback a deployment | `deploy()` |
| Check environment versions | `deploy({operation: "status"})` |
| Inspect raw deployment IDs/URLs | `deploy_config({operation: "status"})` |
| Reset broken deployment slots | `deploy_config({operation: "reset"})` |
| First-time web app setup | `deploy_config({operation: "reset"})` |

---

## Troubleshooting

### "staging_deployment not found"

Run reset to create deployment slots:
```typescript
deploy_config({ operation: 'reset', scriptId: 'abc123...' })
```

### Deployment URLs changed

`reset` creates new deployment IDs. Save URLs from status and update external references.

### Missing deployments after reset

Check status to verify all three slots exist:
```typescript
deploy_config({ operation: 'status', scriptId: 'abc123...' })
```

---

## Related Documentation

- **[LIBRARY_DEPLOYMENT_WORKFLOW.md](LIBRARY_DEPLOYMENT_WORKFLOW.md)**: Standard deployment workflow using `deploy`
- **Tool source**: `src/tools/deployment.ts` (DeployConfigTool)

---

**Last Updated**: 2026-02-16
**Version**: 2.0
