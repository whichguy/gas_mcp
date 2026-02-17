# Distribution Architecture Example

Proof-of-concept: thin container-bound add-on delegates to a centralized standalone script via iframe + postMessage bridge.

## Architecture

```
Container-Bound Add-on (thin shell)     Standalone Script (all logic + UI)
┌──────────────────────────┐            ┌────────────────────────────────┐
│ AddOnCode.gs             │            │ Code.gs                        │
│   onOpen()               │            │   doGet(e)                     │
│   showSidebar()          │            │   processSheet(sheetId)        │
│   getActiveContext()     │            │   getSheetSummary(sheetId)     │
│                          │            │   ping()                       │
│ Bridge.html              │            │                                │
│   <iframe src="/exec">──────────────────→ App.html                    │
│   postMessage bridge     │            │   google.script.run → Code.gs │
│                          │            │   postMessage → parent bridge  │
└──────────────────────────┘            └────────────────────────────────┘
```

## Files

| File | Deploys To | Purpose |
|------|-----------|---------|
| `Code.gs` | Standalone script | doGet + all business logic |
| `App.html` | Standalone script | Full UI served via web app |
| `AddOnCode.gs` | Container-bound (manual) | Thin shell: menu, sidebar, bridge |
| `Bridge.html` | Container-bound (manual) | iframe host + postMessage bridge |

## Deployment

### 1. Deploy Standalone (via MCP GAS)

```bash
# Create standalone project
gas_project_create --title="Central App"

# Write server code
gas_write --path="[scriptId]/Code.gs" --content="<Code.gs content>"

# Write HTML (raw_write for HTML files)
gas_raw_write --path="[scriptId]/App.html" --content="<App.html content>"

# Deploy as web app
gas_deploy --scriptId="[scriptId]" --operation="promote" --environment="dev"
```

### 2. Set Up Add-on (Manual — Container-Bound)

1. Open a Google Sheet
2. Extensions > Apps Script
3. Copy `AddOnCode.gs` content into `Code.gs`
4. Create `Bridge.html` with the Bridge.html content
5. Update `STANDALONE_URL` in `AddOnCode.gs` with the standalone's `/exec` URL
6. Both scripts: Project Settings > Change GCP Project → same project number
7. Reload the Sheet — "Central App" menu appears

## Key Patterns

### postMessage Bridge
The Bridge.html in the add-on listens for messages from the iframe and routes them to the container-bound server for active context operations.

### Shared GCP Project
Both scripts must be linked to the same GCP project so that authorizing the add-on also grants scopes for the standalone. Without this, the iframe's auth prompt would be invisible and fail silently.

### setXFrameOptionsMode(ALLOWALL)
The standalone's doGet() must call `.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)` to allow the sidebar iframe to embed it.

## Customization

- Replace `processSheet()` / `getSheetSummary()` with your business logic
- Add more bridge operations in Bridge.html's message handler
- Extend App.html with your full UI framework
