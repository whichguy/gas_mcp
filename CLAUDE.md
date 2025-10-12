# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

### Core Development
```bash
npm install                      # Install dependencies
npm run build                    # Production build (TypeScript → JavaScript)
npm run build:dev                # Development build with source maps
npm run dev                      # Watch mode with auto-rebuild
npm start                        # Build and start MCP server
npm run clean                    # Clean dist/ directory
```

### Testing
| Category | Command | Purpose |
|----------|---------|---------|
| **Core** | `npm test` | System tests (30s timeout) |
| | `npm run test:unit` | Unit tests (mocked) |
| | `npm run test:integration` | Real GAS API (auth required, 5min) |
| | `npm run test:system` | MCP protocol tests |
| | `npm run test:all` | Unit + system combined |
| **Quality** | `npm run test:security` | Security & validation |
| | `npm run test:performance` | Performance benchmarks (60s) |
| | `npm run test:verification` | API schema compliance |
| **Verify** | `npm run test:git/auth/files/project/execution/server` | Domain-specific verification |
| **Debug** | `DEBUG=mcp:* npm test` | Enable debug logging |
| | `npx mocha test/path/file.test.ts --timeout 30000` | Single test file |

### Code Quality
```bash
npm run lint                     # ESLint with auto-fix
npm run bundle:analyze           # Analyze bundle size

# Production testing and verification
npm run test:production          # Production readiness report
npm run test:all-verify          # Run all verification tests
```

## Architecture Overview

**MCP server:** AI ↔ GAS → 40 tools for create/manage/execute GAS projects

**Flow:** Client ↔ stdio ↔ mcpServer → tools → gasClient → GAS API

**Layers:** Protocol (stdio + dispatch) → Tools (validate + auth + execute) → Auth (OAuth PKCE + refresh) → API (rate limit + retry)

**Tool Consolidation** (Jan 2025 - 39% reduction):
- **66 → 40 tools** via strategic consolidation
- **Analysis**: Removed context/summary/tree (LLMs read files directly with cat/grep/ripgrep)
- **Deployment**: Unified deploy tool (promote/rollback/status/reset operations)
- **Sync**: Removed pull/push/status (cat/write already provide auto-sync)
- **Management**: Removed bind_script, project_*, run (redundant wrappers)

### Core Capabilities

#### 1. CommonJS Module System
**Runtime:** require() + module.exports + exports → Node.js semantics in GAS
**Tools:** cat/write auto-unwrap/wrap → edit clean code → execute with full module access
**Pattern:** Calculator.js `module.exports = {add, multiply}` → Main.js `require('Calculator').add(5,6)`
**Infra:** CommonJS.js handles resolution/caching → transparent to user

**Module Loading (write moduleOptions):**
- `loadNow: true` (eager) → _main() at startup → use for: doGet/doPost, onOpen/onEdit/onInstall triggers, __events__ registration
- `loadNow: false` (lazy) → _main() on first require() → use for: utils, helpers, internal logic
- `omit` (preserve) → reads existing setting (~200-500ms) | defaults lazy for new files → use for: updating existing, bulk ops (set explicit to skip lookup)

**Response Enhancement (write):**
- Returns `local: {path, exists}` when file written locally
- Returns `git: {associated, syncFolder}` when `.git/config.gs` breadcrumbs found
- Git association signals local sync folder available for standard git commands

#### 2. Ad-hoc Execution
**Interface:** exec({scriptId, js_statement}) → cloud exec → no deploy
**Scope:** Math/Date + all GAS services (DriveApp/SpreadsheetApp/GmailApp/etc) + require("Module") + Logger capture
**Examples:**
- `js_statement: "Math.PI * 2"` → instant math
- `js_statement: "require('Utils').processData([1,2,3])"` → call your code
- `js_statement: "SpreadsheetApp.create('Report').getId()"` → multi-step workflow

#### 3. Unix Interface
**Commands:** cat ls grep find sed ripgrep → familiar workflow → auto CommonJS handling
**Duality:** regular tools (clean code) vs raw_* tools (system wrappers) → LLM chooses by tool name
**Why separate:** Tool selection = explicit intent | Parameter flags = cognitive overhead
**Pattern:** cat unwraps → edit clean → write wraps | raw_cat skips unwrap → see system code
**Ripgrep:** ignoreCase | sort: path/modified | trim → 98% feature parity + enhancements

#### 4. File Integrity & Git
**Checksums:** Git SHA-1 (`sha1("blob "+size+"\0"+content)`) + SHA-256 + MD5 → verify without download
**Tools:** gas_ls({checksums:true}) quick | gas_file_status({hashTypes:["git-sha1"]}) detailed + metadata
**Integration:** Compare with `git hash-object` → detect changes → selective sync → build optimization
**Performance:** checksums=false (default, fast) | checksums=true (~50-100ms/file) | file_status (200 files max, 50 default)

#### 5. Metadata Caching
**Fast Path:** 85-95% faster (5-50ms vs 800-1200ms) via extended attributes caching
**Storage:** updateTime + fileType cached in xattr → skip API call if local mtime matches
**See:** docs/METADATA_CACHING.md for complete architecture

#### 6. Deployment & Version Control
**Tool:** deploy({operation, environment, scriptId}) → promote/rollback/status/reset operations
**Environments:** dev (HEAD, auto) | staging (versioned) | prod (tagged) → automatic [DEV]/[STAGING]/[PROD] tags

---

### Architectural Patterns

**Tool:** BaseTool → name (mcp__gas__*) + inputSchema → execute (validate → auth → operation) → formatSuccess/handleApiError
**Virtual Files:** .git/.gitignore/.env ↔ .gs suffix → period prefix handling → MD ↔ HTML transforms
**Sync:** Local (./src/) → Remote GAS → Git mirror (~/gas-repos/project-[scriptId]/) → local-first auto-sync

### Git Sync (LOCAL-FIRST, safe merge)

**Pattern:** pull→merge→push (never blind push) | Requires .git/config.gs breadcrumb
**Tools:** local_sync + config (sync_folder management)
**See:** docs/GIT_SYNC_WORKFLOWS.md for complete workflow

### Project Management + Errors

**Management:** project_list (view projects) | project_create (infra setup with 3 deployments) → gas-config.json stores → all tools require explicit scriptId

**Errors:** MCPGasError → ValidationError | AuthenticationError | FileOperationError | QuotaError | ApiError → MCP-compatible transform

## Config + Tools

**Tools (40 total):**
| Category | Count | Tools |
|----------|-------|-------|
| **File (Smart)** | 14 | cat, write, ls, rm, mv, cp, file_status, grep, find, ripgrep, sed, edit, aider, cache_clear |
| **File (Raw)** | 9 | raw_cat, raw_write, raw_cp, raw_grep, raw_find, raw_ripgrep, raw_sed, raw_edit, raw_aider |
| **Analysis** | 1 | deps (dependency graphs) |
| **Execution** | 2 | exec, exec_api |
| **Deployment** | 3 | deploy, project_create, project_init |
| **Management** | 6 | auth, project_list, reorder, process_list |
| **Logging** | 1 | log (list + get operations) |
| **Triggers** | 1 | trigger (list + create + delete operations) |
| **Git Sync** | 2 | local_sync, config |
| **Sheets** | 1 | sheet_sql |

**Config:** gas-config.json (OAuth + projects) | oauth-config.json (GCP creds) | .auth/ (tokens)
**Design:** smart (unwrap) vs raw (preserve) | mcp__gas__* naming | period prefix (.gitignore.gs) | ~/gas-repos/project-[scriptId]/

## Development

| Area | Details |
|------|---------|
| **New Tool** | Extend BaseTool → name (mcp__gas__*) + inputSchema → execute (validate → auth → operation) → register in mcpServer.ts → tests |
| **TypeScript** | ESM imports (.js) \| named exports \| type imports \| kebab-case files \| PascalCase classes \| strict ES2022 |
| **Tests** | unit (mock) + integration (real API) + system (MCP) + security + verification + performance → mocha/chai (15s timeout) |
| **Test Org** | Domain-based: project-lifecycle, file-operations, search-operations, module-system, code-execution, deployment |
| **Security** | OAuth (OS-secure) + PKCE + input validation + scriptId pattern (25-60 alphanumeric) + path traversal prevention |
| **Performance** | Local cache + incremental builds + concurrent copy + local-first + rate limiting |
| **Debug** | `DEBUG=mcp:* \| mcp:auth \| mcp:execution \| mcp:sync npm start` |

## MCP Integration

**Server:** MCP protocol → AI assistants (Claude) → 40 GAS tools

**Claude Desktop Config** (`~/.claude_desktop_config.json`):
```json
{"mcpServers": {"gas": {"command": "node", "args": ["/path/to/mcp_gas/dist/src/index.js"], "env": {"NODE_ENV": "production"}}}}
```
