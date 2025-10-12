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
```bash
npm test                         # Run core system tests (30s timeout)
npm run test:unit                # Unit tests for individual modules
npm run test:integration         # Real GAS API tests (requires auth, 5min timeout)
npm run test:system              # System-level MCP protocol tests
npm run test:security            # Security and validation tests
npm run test:performance         # Performance tests (60s timeout)
npm run test:verification        # API schema and compliance verification
npm run test:all                 # Run unit + system tests

# Specialized verification tests
npm run test:git                 # Verify git sync operations
npm run test:auth                # Verify authentication flow
npm run test:files               # Verify file operations
npm run test:project             # Verify project management
npm run test:execution           # Verify code execution
npm run test:server              # Verify MCP server functionality

# Run single test file
npx mocha test/system/protocol/consolidated-core.test.ts --timeout 30000

# Debug test with logging
DEBUG=mcp:* npm test
```

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

**Session:** File-based (.auth/) → 24hr timeout → per-client isolation → auto-refresh tokens

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
**Unified Tool:** deploy({operation, environment, scriptId}) → single interface for all deployment ops
**Operations:**
- `promote` → dev→staging (creates version) or staging→prod (updates deployment)
- `rollback` → revert to previous tagged version (staging or prod)
- `status` → view all 3 environments (dev/staging/prod)
- `reset` → recreate 3 standard deployments

**Environments:**
- dev: Always HEAD (latest code, auto-updated)
- staging: Versioned snapshots (promote from dev)
- prod: Production versions (promote from staging)

**Version Tags:** Automatic `[DEV]`, `[STAGING]`, `[PROD]` tags in descriptions

---

### Architectural Patterns

**Tool Pattern:** `class extends BaseTool` → name (mcp__gas__*) + description + inputSchema (JSON) → `execute()` → validate → getAuthToken → operation → formatSuccess | handleApiError

**CommonJS Auto-wrap:** Write (wrap in _main) → Read (unwrap for editing) → Execute (CommonJS.js + __mcp_exec.js runtime) → __defineModule__(_main) registration

**Virtual Files:** `.git` ↔ `.git.gs` | `.gitignore` ↔ `.gitignore.gs` | `.env` ↔ `.env.gs` → period prefix → bidirectional (fileTransformations.ts handles MD ↔ HTML too)

**Sync Layers:** Local cache (./src/) → Remote GAS → Git mirror (~/gas-repos/project-[scriptId]/) → smart tools check local first → auto-sync

### Git Sync (LOCAL-FIRST, safe merge)

**Pattern:** pull→merge→push (never blind push) | Requires .git/config.gs breadcrumb
**Tools:** local_sync + config (sync_folder management)
**Breadcrumbs:** .git/config.gs + .git/refs/heads/main + .git/refs/remotes/origin/main
**See:** docs/GIT_SYNC_WORKFLOWS.md for complete workflow

### Project Management + Errors

**Management:** project_list (view projects) | project_create (infra setup with 3 deployments) → gas-config.json stores → all tools require explicit scriptId

**Errors:** MCPGasError → ValidationError | AuthenticationError | FileOperationError | QuotaError | ApiError → MCP-compatible transform

## Config + Tools

**Config:** gas-config.json (OAuth + projects) | oauth-config.json (GCP creds) | .auth/ (tokens)

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

**Design:** smart (unwrap) vs raw (preserve) | mcp__gas__* naming | period prefix (.gitignore.gs) | ~/gas-repos/project-[scriptId]/

## Development

**New Tool:** src/tools/ extend BaseTool (base.ts) → name (mcp__gas__*) + description + inputSchema → execute (validate → auth → operation) → register in mcpServer.ts → tests (unit/integration/system/security)

**TypeScript:** .js imports (ESM) | named exports | type imports `import type` | kebab-case files + PascalCase classes | strict ES2022 | tsconfig.production.json (no maps/declarations)

**Tests:** unit (mock) + integration (real GAS API + auth) + system (MCP protocol) + security (validation) + verification (API schema) + performance (benchmarks) → mocha + chai + .mocharc.json (15s timeout) + globalAuth.ts

**Test Organization:** Domain-based (project-lifecycle, file-operations, search-operations, module-system, code-execution, deployment) → See test/integration/mcp-gas-validation/TEST-SUITE-ORGANIZATION.md

**Security:** OAuth (OS-secure storage) + PKCE (intercept prevention) + input validation + scriptId (25-60 alphanumeric) + path traversal prevention + array-based git (injection prevention)

**Performance:** Local cache (reduce API) + incremental TS builds + concurrent asset copy + smart local-first + rate limiting (quota protection)

**Debug:** `DEBUG=mcp:* | mcp:auth | mcp:execution | mcp:sync npm start`

## MCP Integration

**Server:** MCP protocol → AI assistants (Claude) → 40 GAS tools

**Claude Desktop Config** (`~/.claude_desktop_config.json`):
```json
{"mcpServers": {"gas": {"command": "node", "args": ["/path/to/mcp_gas/dist/src/index.js"], "env": {"NODE_ENV": "production"}}}}
```

**Files:** gas-config.json (projects + OAuth + paths) + oauth-config.json (GCP creds) + .auth/ (tokens)

**Capabilities:** OAuth flow + file ops (CommonJS wrap) + cloud exec + git sync + project mgmt + unified deployment

## Key Changes (January 2025)

**Deployment Tool Consolidation:**
- Old: `version_create`, `version_list`, `version_get`, `deploy_create`, `deploy_list`, `deploy_get_details`, `deploy_delete`, `deploy_update`
- New: Single `deploy` tool with operations: promote/rollback/status/reset
- Benefit: Simplified workflows, atomic operations, environment-aware management

**Git Refs Support:**
- Added `.git/refs/heads/main` and `.git/refs/remotes/origin/main` to GIT_FILE_MAP
- Enables complete repository connection tracking in GAS projects
- Plain text files (40-char SHA-1 hashes), no encoding needed
