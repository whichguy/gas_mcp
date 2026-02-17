# Library Deployment Workflow Guide

> **Recommended deployment tool.** This document covers the `deploy` tool (library version pinning).
> For low-level web app deployment management, see [DEPLOYMENT_WORKFLOW.md](DEPLOYMENT_WORKFLOW.md).

Complete guide to managing Google Apps Script library deployments across development, staging, and production environments using consumer spreadsheet version pinning.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Setup](#setup)
3. [Promote](#promote)
4. [Rollback](#rollback)
5. [Status & Reconciliation](#status--reconciliation)
6. [Dry-Run Preview](#dry-run-preview)
7. [Audit Trail](#audit-trail)
8. [Auto-Consumer Creation](#auto-consumer-creation)
9. [Troubleshooting](#troubleshooting)

---

## Architecture

### Library + Consumer Model

```
Library Project (standalone, edit via MCP GAS)
  ├── HEAD (current dev code)
  ├── v3 ← staging pins here
  └── v2 ← prod pins here

Template Sheet (container-bound thin shim → library @ HEAD, developmentMode: true)
Staging Sheet  (container-bound thin shim → library @ v3)
Prod Sheet     (container-bound thin shim → library @ v2)
```

### Key Concepts

- **Library project**: Your main GAS codebase (standalone script). All code lives here.
- **Consumer spreadsheets**: Container-bound scripts that reference the library via `appsscript.json`. Each contains only a thin shim that delegates all calls to the library.
- **Version pinning**: Consumer manifests specify which library version to use (e.g., `"version": "3"`). Changing the pin instantly switches which code the consumer runs.
- **Thin shim**: A minimal `Code.gs` in each consumer that forwards events (`onOpen`, `onEdit`, `exec_api`) to the library via its `userSymbol`.

### Why This Pattern?

- **Single source of truth**: All code lives in the library project. No duplication.
- **Instant rollback**: Change one number in a manifest to revert.
- **Environment isolation**: Staging and prod run different versions simultaneously.
- **No redeployment**: Version pins update immediately — no deployment propagation delay.

---

## Setup

Wire a template/dev spreadsheet to your library at HEAD:

```typescript
deploy({
  operation: "setup",
  scriptId: "LIBRARY_SCRIPT_ID",
  templateScriptId: "TEMPLATE_CONTAINER_SCRIPT_ID",
  userSymbol: "SheetsChat"  // optional — auto-derived from project name
})
```

**What happens:**
1. Updates template's `appsscript.json` to reference library at HEAD (`developmentMode: true`)
2. Writes thin shim `Code.gs` if not present
3. Saves config to `gas-config.json` and ConfigManager

**Result:** Template spreadsheet now runs your library code live (dev mode).

---

## Promote

### Promote to Staging

Creates a version from HEAD and pins the staging consumer to it.

```typescript
deploy({
  operation: "promote",
  to: "staging",
  scriptId: "LIBRARY_SCRIPT_ID",
  description: "v1.0 Add sidebar feature"
})
```

**What happens:**
1. Creates immutable library version (auto-increments: v1, v2, v3...)
2. Updates staging consumer's `appsscript.json` library pin to new version
3. Stores version state in ConfigManager (for rollback)
4. Appends to deployment audit log

**If staging consumer doesn't exist:** Auto-creates a new spreadsheet + container-bound script.

### Promote to Production

Copies staging's version pin to the prod consumer.

```typescript
deploy({
  operation: "promote",
  to: "prod",
  scriptId: "LIBRARY_SCRIPT_ID"
})
```

**What happens:**
1. Reads staging consumer's current version pin (source of truth)
2. Updates prod consumer's `appsscript.json` to match
3. Stores version state in ConfigManager

**No new version is created** — prod always gets the same version that was tested in staging.

### Retry After Partial Failure

If version creation succeeds but pin update fails, the response includes recovery info:

```typescript
// Response includes:
{
  createdVersion: 5,
  retryWith: 'deploy({operation:"promote", to:"staging", scriptId:"...", useVersion:5})'
}

// Retry using the already-created version:
deploy({
  operation: "promote",
  to: "staging",
  scriptId: "LIBRARY_SCRIPT_ID",
  useVersion: 5
})
```

---

## Rollback

Toggles between current and previous version. A second rollback undoes the first.

```typescript
deploy({
  operation: "rollback",
  to: "staging",  // or "prod"
  scriptId: "LIBRARY_SCRIPT_ID"
})
```

### Manual Rollback to Specific Version

```typescript
deploy({
  operation: "rollback",
  to: "prod",
  scriptId: "LIBRARY_SCRIPT_ID",
  toVersion: 3  // Pin prod to v3
})
```

### When ConfigManager Has No Previous Version

If ConfigManager state was lost (e.g., after a failed write), the error message includes the current pin to help you specify `toVersion`:

```
no previous version in ConfigManager. Current prod pin is v5. Use toVersion to specify rollback target.
```

---

## Status & Reconciliation

### Check Environment State

```typescript
deploy({
  operation: "status",
  scriptId: "LIBRARY_SCRIPT_ID"
})
```

**Returns:**
- Dev: always HEAD
- Staging/Prod: current version pin, consumer scriptId, spreadsheet ID
- Version gap between staging and prod
- Cleanup candidates (versions not pinned by any environment)
- Discrepancies between local config, ConfigManager, and consumer manifests

### Auto-Fix Discrepancies

When status detects mismatches, use `reconcile` to auto-fix:

```typescript
deploy({
  operation: "status",
  scriptId: "LIBRARY_SCRIPT_ID",
  reconcile: true
})
```

**Source of truth:** Consumer manifest (the actual `appsscript.json` library pin).

**What gets fixed:**
- ConfigManager stored versions updated to match consumer manifest
- Local `gas-config.json` updated to match consumer manifest

**Response includes:** `reconciled` array listing what was corrected.

---

## Dry-Run Preview

Preview what a promote or rollback would do without making changes:

```typescript
// Preview promote
deploy({
  operation: "promote",
  to: "staging",
  scriptId: "LIBRARY_SCRIPT_ID",
  description: "v2.0 Major update",
  dryRun: true
})
// Returns: wouldCreateVersion, wouldPin (from → to), description

// Preview rollback
deploy({
  operation: "rollback",
  to: "prod",
  scriptId: "LIBRARY_SCRIPT_ID",
  dryRun: true
})
// Returns: wouldRollbackTo, currentVersion, consumer
```

---

## Audit Trail

Every promote and rollback appends to a per-environment deployment log stored in ConfigManager. The log keeps the last 20 entries per environment.

The audit trail is automatic — no configuration needed. View it via ConfigManager:

```typescript
exec({
  scriptId: "LIBRARY_SCRIPT_ID",
  js_statement: "JSON.stringify(new (require('common-js/ConfigManager'))('DEPLOY').getScript('STAGING_DEPLOY_LOG'))"
})
```

Each entry records: version, previous version, and timestamp.

---

## Auto-Consumer Creation

When promoting to an environment that has no consumer configured, the deploy tool automatically:

1. Creates a new Google Spreadsheet (named `{ProjectName} [STAGING]` or `[PROD]`)
2. Creates a container-bound script in that spreadsheet
3. Writes thin shim `Code.gs` + manifest with library reference
4. Saves consumer scriptId to local config and ConfigManager

This means you can go from setup to production with just:

```typescript
deploy({operation: "setup", scriptId: "...", templateScriptId: "..."})
deploy({operation: "promote", to: "staging", scriptId: "...", description: "v1.0"})
deploy({operation: "promote", to: "prod", scriptId: "..."})
```

---

## Troubleshooting

### ConfigManager Write Failures

**Symptom:** Response includes `configWarning` field.

**Impact:** Deployment succeeded (consumer is pinned correctly), but ConfigManager state may be stale. Rollback without `toVersion` may fail.

**Resolution:**
1. Run `deploy({operation: "status", scriptId: "...", reconcile: true})` to auto-fix
2. Or manually specify `toVersion` for rollback

### "staging_consumer not configured"

**Cause:** No staging consumer exists and no template is set up.

**Solution:** Either run `setup` first, or just promote to staging — auto-consumer creation will handle it.

### "staging_version not pinned"

**Cause:** Staging consumer exists but is in development mode (HEAD).

**Solution:** Promote to staging to create a version and pin it.

### Discrepancies in Status

**Cause:** ConfigManager writes failed during a previous promote, or someone manually edited a consumer manifest.

**Solution:** Run status with `reconcile: true` to auto-fix using consumer manifests as source of truth.

### Version Limit Approaching

GAS projects have a 200-version limit. Status shows warnings at 150+ versions.

**Resolution:** Delete old versions manually via Apps Script UI > Project History. The status `keepSet` tells you which versions are still in use.

---

## Related Documentation

- **[DEPLOYMENT_WORKFLOW.md](DEPLOYMENT_WORKFLOW.md)**: Low-level web app deployments (`version_deploy`)
- **[CLAUDE.md](../CLAUDE.md)**: Quick reference for AI assistants
- **Tool source**: `src/tools/deploy.ts` (LibraryDeployTool)

---

**Last Updated**: 2026-02-16
**Version**: 1.0
