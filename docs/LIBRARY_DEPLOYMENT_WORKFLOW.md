# Library Deployment Workflow Guide

> **Unified deployment tool.** This document covers the `deploy` tool (file-push to per-environment -source libraries).
> For deployment infrastructure (reset/status of deployment slots), see [DEPLOYMENT_WORKFLOW.md](DEPLOYMENT_WORKFLOW.md).

Complete guide to managing Google Apps Script library deployments across development, staging, and production environments using per-environment -source libraries with file push.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Setup](#setup)
3. [Promote](#promote)
4. [Status](#status)
5. [Dry-Run Preview](#dry-run-preview)
6. [Auto-Environment Creation](#auto-environment-creation)
7. [Sheet Sync](#sheet-sync)
8. [Troubleshooting](#troubleshooting)

---

## Architecture

### Per-Environment -Source Library Model

```
Main Library = dev-source (standalone, all source + CommonJS infra)
  └── Dev consumers (thin shim → main library @ HEAD, developmentMode: true)

stage-source (standalone library) ← files pushed from main library
  └── Stage consumers (thin shim → stage-source @ HEAD, developmentMode: true)

prod-source (standalone library) ← files pushed from stage-source
  └── Prod consumers (thin shim → prod-source @ HEAD, developmentMode: true)
```

### Key Concepts

- **Main library**: Your primary GAS codebase (standalone script). All development happens here.
- **-source libraries**: Standalone GAS projects per environment that receive file pushes. Staging-source gets files from the main library; prod-source gets files from staging-source.
- **Consumer spreadsheets**: Container-bound scripts that reference their environment's -source library via `appsscript.json` with `developmentMode: true`. Each contains only a thin shim.
- **File push**: Promotion reads all files from the source project and writes them to the target -source library. No versioning involved.
- **developmentMode: true**: All consumers use this mode, which resolves to the library's current HEAD code. When files are pushed to a -source library, all consumers automatically see the new code.
- **Thin shim**: A minimal `Code.gs` in each consumer that forwards events (`onOpen`, `onEdit`, `exec_api`) to the library via its `userSymbol`.

### Why This Pattern?

- **Copy-safe**: When users copy a consumer spreadsheet, the copy references the same -source library at HEAD. New promotions automatically propagate to all copies.
- **Single source of truth**: All code lives in the main library. -source libraries are mirrors.
- **No versioning overhead**: No version creation, no pin management, no 200-version GAS limit.
- **Fix-forward**: If something breaks in production, fix the code and re-promote. No rollback complexity.
- **Environment isolation**: Staging and prod run different code snapshots until explicitly promoted.

### No Rollback

This model intentionally has no rollback mechanism. If production has issues:

1. Fix the issue in the main library
2. Promote to staging: `deploy({to:"staging", scriptId})`
3. Test staging
4. Promote to prod: `deploy({to:"prod", scriptId})`

---

## Setup

Wire a template/dev spreadsheet to your main library at HEAD:

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

Pushes all files from the main library to the staging-source library.

```typescript
deploy({
  to: "staging",
  scriptId: "LIBRARY_SCRIPT_ID",
  description: "Add sidebar feature"  // optional contextual note
})
```

**What happens:**
1. Reads all files from the main library
2. Writes all files to the staging-source library (full replacement)
3. Stores promote timestamp in ConfigManager
4. All staging consumers automatically see the new code (via `developmentMode: true`)

**If staging environment doesn't exist:** Auto-creates a staging-source library, spreadsheet, and consumer.

### Promote to Production

Pushes all files from staging-source to prod-source.

```typescript
deploy({
  to: "prod",
  scriptId: "LIBRARY_SCRIPT_ID"
})
```

**What happens:**
1. Reads all files from the staging-source library (source of truth)
2. Writes all files to the prod-source library
3. Stores promote timestamp in ConfigManager
4. All prod consumers automatically see the new code

**No code comes from the main library directly** — prod always gets the exact code that was tested in staging.

---

## Status

### Check Environment State

```typescript
deploy({
  operation: "status",
  scriptId: "LIBRARY_SCRIPT_ID"
})
```

**Returns:**
- Dev: main library scriptId
- Staging/Prod: sourceScriptId, consumerScriptId, spreadsheetId, lastPromotedAt
- Discrepancies: consumer manifest issues (wrong library reference, missing developmentMode)

---

## Dry-Run Preview

Preview what a promote would do without making changes:

```typescript
deploy({
  to: "staging",
  scriptId: "LIBRARY_SCRIPT_ID",
  dryRun: true
})
// Returns: sourceScriptId, wouldPush (file count)
```

---

## Auto-Environment Creation

When promoting to an environment that doesn't exist yet, the deploy tool automatically:

1. Creates a standalone -source library (named `{ProjectName} [STAGING-SOURCE]` or `[PROD-SOURCE]`)
2. Pushes all files from the main library to the -source library
3. Creates a new Google Spreadsheet (named `{ProjectName} [STAGING]` or `[PROD]`)
4. Creates a container-bound script in that spreadsheet
5. Writes thin shim `Code.gs` + manifest with library reference to -source @ HEAD
6. Saves all script IDs to local config and ConfigManager

**No CommonJS infrastructure is installed in consumers** — they are pure thin shims. All module resolution happens in the -source library.

This means you can go from setup to production with just:

```typescript
deploy({operation: "setup", scriptId: "...", templateScriptId: "..."})
deploy({to: "staging", scriptId: "..."})
deploy({to: "prod", scriptId: "..."})
```

---

## Sheet Sync

When promoting, spreadsheet sheets are automatically synced from source to target environment:

- **dev→staging:** template spreadsheet → staging spreadsheet
- **staging→prod:** staging spreadsheet → prod spreadsheet

### Sync Strategy (by sheet name)

1. **Matching names** → replace (copy fresh, delete old, rename)
2. **New in source** → copy to target
3. **Only in target** → left untouched

### Disable Sheet Sync

```typescript
deploy({
  to: "staging",
  scriptId: "LIBRARY_SCRIPT_ID",
  syncSheets: false
})
```

### Response

```typescript
{
  sheetSync: {
    source: "spreadsheetId",
    target: "spreadsheetId",
    synced: ["Sheet1", "Config"],
    added: ["NewSheet"],
    skipped: ["TargetOnly"]
  }
}
```

---

## Troubleshooting

### ConfigManager Write Failures

**Symptom:** Response includes `configWarning` field.

**Impact:** Deployment succeeded (files were pushed), but ConfigManager timestamp may not be stored.

**Resolution:** Non-critical — the promote timestamp is for informational purposes only.

### "staging_source not configured"

**Cause:** No staging environment exists yet.

**Solution:** Just promote to staging — auto-environment creation will handle it:
```typescript
deploy({to: "staging", scriptId: "..."})
```

### Consumer Manifest Discrepancies

**Cause:** Consumer's `appsscript.json` doesn't reference the correct -source library or is missing `developmentMode: true`.

**Detection:** Run `deploy({operation: "status", scriptId: "..."})` — discrepancies appear in the response.

**Solution:** Re-run the promote to the affected environment, or manually update the consumer manifest.

### Copied Consumer Not Updating

**Symptom:** A copy of a consumer spreadsheet doesn't get updates.

**This should not happen with the file-push model.** All consumers (including copies) reference the -source library at HEAD with `developmentMode: true`. When files are pushed to the -source library, all consumers see the new code.

If a copied consumer is not updating:
1. Check its `appsscript.json` — verify `libraryId` points to the correct -source library
2. Verify `developmentMode: true` is set
3. Open the Apps Script editor in the copy to trigger a cache refresh

---

## Related Documentation

- **[DEPLOYMENT_WORKFLOW.md](DEPLOYMENT_WORKFLOW.md)**: Deployment infrastructure (`deploy_config`)
- **[CLAUDE.md](../CLAUDE.md)**: Quick reference for AI assistants
- **Tool source**: `src/tools/deploy.ts` (LibraryDeployTool)

---

**Last Updated**: 2026-02-16
**Version**: 2.0 (file-push model)
