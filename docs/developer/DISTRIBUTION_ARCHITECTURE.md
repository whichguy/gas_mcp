# Distribution Architecture: Thin Add-on + Central Standalone

## Overview

A lightweight container-bound add-on delegates to a centralized standalone script via iframe embedding. Update the standalone once — all users get the new version instantly.

## Container-Bound vs Standalone

### Container-Bound Exclusive Capabilities

| Capability | Notes |
|---|---|
| `getActiveSpreadsheet()` / `getActiveDocument()` | Active context — knows what file the user has open |
| `getActiveSheet()` / `getActiveRange()` | Knows what the user is looking at / has selected |
| `SpreadsheetApp.getUi()` | Custom menus, `alert()`, `prompt()` |
| `showSidebar()` / `showModalDialog()` | HtmlService UI embedded in the editor |
| `toast()` notifications | Quick feedback to user |
| Simple triggers (`onOpen`, `onEdit`, `onSelectionChange`) | Fire automatically, no user authorization needed |
| `ScriptApp.getContainer()` | Returns the parent file |

### Identical in Both

- All GAS services (SpreadsheetApp, DriveApp, GmailApp, etc.)
- `openById()` / `openByUrl()` — full read/write to any Sheet/Doc with access
- Web app deployment (`doGet`/`doPost`)
- API execution (`scripts.run`)
- Installable triggers, Libraries, PropertiesService, CacheService, LockService

### Container-Bound Disadvantages

- Invisible in Drive (can't star, organize, or search)
- Can't detach from container
- Copying a Sheet copies the script (version drift)
- Script ownership follows container ownership

## Quota Model

GAS has no monetary billing. "Cost" = quota consumption.

### "Execute as: User accessing the web app"
- Each user burns **their own** quota — scales well
- Users must authorize (OAuth consent screen)

### "Execute as: Me" (developer)
- All usage from all users counts against developer's quota — doesn't scale

### Per-User Quotas (24h reset)

| Quota | Consumer | Workspace |
|---|---|---|
| Script runtime | 6 min/execution | 6 min/execution |
| Script runtime total | 90 min/day | 6 hr/day |
| UrlFetch calls | 20,000/day | 100,000/day |
| Email sends | 100/day | 1,500/day |
| Triggers | 20/user | 20/user |

### Shared Resources
- **Concurrent executions**: max 30 simultaneous per script
- **ScriptProperties**: 500KB shared storage
- **ScriptCache**: shared, can collide between users

### Logging
- `Logger.log()` → executing user's logs (invisible to developer in "Execute as User" mode)
- `console.log()` → project's Cloud Logging (developer CAN see — tied to GCP project)

## Recommended Architecture: Single iframe

```
Add-on (3 functions, 1 HTML file — never changes):
├── Code.gs
│   ├── onOpen()           — creates menu
│   ├── showSidebar()      — opens sidebar with Bridge.html
│   └── getActiveContext()  — returns active sheet/range/values
└── Bridge.html
    ├── iframe src → standalone /exec URL (with sheetId param)
    └── postMessage listener for getActiveContext bridge calls

Standalone (all UI + all logic — update freely):
├── Code.gs
│   ├── doGet(e)           — serves App.html with sheetId from URL param
│   ├── business logic     — runs as user
│   └── ...all functions
└── App.html
    ├── Full sidebar UI (HTML/CSS/JS)
    ├── google.script.run   → calls standalone server directly
    └── postMessage to parent for getActiveContext() only
```

## Call Flow: Normal Server Calls

```
User clicks button in sidebar
  → iframe JS: google.script.run.summarizeSheet(sheetId)
  → standalone server (runs as user)
  → SpreadsheetApp.openById(sheetId)
  → returns result
  → iframe JS renders result
```

No bridge, no proxy. `google.script.run` in the iframe naturally points to the standalone.

## Call Flow: Active Context (Bridge Required)

```
User clicks "Process Selection"
  → iframe JS: window.parent.postMessage({type: 'getActive', id: N})
  → Bridge.html receives postMessage
  → Bridge.html: google.script.run.getActiveContext()
  → add-on server: getActiveSpreadsheet(), getActiveRange()
  → returns {spreadsheetId, sheetName, activeRange, activeValues}
  → Bridge.html: postMessage result back to iframe
  → iframe JS: google.script.run.processSelection(sheetId, context)
  → standalone server processes with active context
```

## Authorization: Shared GCP Project

Link both scripts to the **same GCP project**:

1. Both scripts: **Project Settings > GCP Project > Change project** → same project number
2. Add-on's `appsscript.json` requests superset of all OAuth scopes
3. User authorizes the add-on → grants scopes for the GCP project → standalone iframe loads already authorized

### Fallback: Explicit Auth
If shared GCP isn't possible:
- iframe `doGet` HTML tests auth with `google.script.run.ping()`
- If unauthorized: sends `postMessage({type: 'gas-needs-auth'})` to parent
- Parent shows "Authorize" button → opens standalone URL in new tab → user consents → close tab → reload iframe

## Key Tradeoffs

| Concern | iframe Architecture | Traditional Add-on |
|---|---|---|
| Code centralization | All logic + UI in standalone | Everything in add-on |
| Update propagation | Instant (standalone redeploy) | Must update each add-on |
| `getActiveSpreadsheet()` | Via postMessage bridge | Direct |
| Auth complexity | Shared GCP project needed | Single authorization |
| Performance | Extra iframe load on open | Native |
| `google.script.run` | Points to standalone | Points to add-on |

## Limitations & Gotchas

1. **`getActiveSheet()` from standalone** returns first sheet, not user's active tab — only container-bound context knows the actual active tab
2. **Concurrent execution limit**: 30 simultaneous per script regardless of user count
3. **iframe initial load**: slightly slower than native sidebar
4. **`setXFrameOptionsMode(ALLOWALL)`** required on standalone's `doGet()` to allow embedding
5. **Scope alignment**: if standalone requests scopes the add-on doesn't, user gets re-prompted
6. **`DocumentProperties`** doesn't exist for standalone — only `ScriptProperties` + `UserProperties`
7. **Simple triggers** (`onEdit`, `onOpen`) must live in the add-on
8. **Library performance**: if using library pattern instead of iframe, each call through library adds latency

## Alternative: Proxy Hijack Pattern

JavaScript `Proxy` can intercept `google.script.run` to redirect calls:

```javascript
google.script.run = new Proxy({}, {
  get(target, prop) {
    // Route actual function calls via postMessage to iframe
  }
});
```

Proven by [appsScriptAsync](https://github.com/InvincibleRain/appsScriptAsync) — `google.script.run` is not frozen/sealed and can be proxied. Direct fetch to /exec fails due to CORS.

## Example Implementation

See `examples/distribution-architecture/` for a working proof-of-concept with:
- **Standalone script**: `Code.gs` + `App.html` — deployable via MCP GAS tools
- **Add-on template**: `AddOnCode.gs` + `Bridge.html` — copy to a container-bound script
