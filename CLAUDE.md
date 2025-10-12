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

**MCP server:** AI ↔ GAS → ~50 tools for create/manage/execute GAS projects

**Session:** In-memory Map → lost on restart → re-auth required → no filesystem/locking (MCP half-duplex)

**Flow:** MCP Client ↔ stdio ↔ mcpServer.ts → tools → gasClient.js → GAS API v1

**Layers:**
1. **Protocol** (index.ts → mcpServer.ts) → stdio + tool dispatch + error handling
2. **Tools** (src/tools/) → BaseTool extends → validate + auth + execute → smart (cache) vs raw (direct API)
3. **Auth** (src/auth/) → OAuth PKCE (oauthClient.ts) + session refresh (sessionManager.ts) + in-memory tokens
4. **API** (gasClient.ts) → rate limit + retry + path parse + error transform

**Tool Consolidation** (Completed 2025-01-10):
- Removed 7 redundant/low-level tools (~1,200 lines)
- Eliminated: `bind_script`, `project_set`, `project_get`, `project_add`, `project_metrics`, `run`, `pull`, `push`, `status`
- Replaced with: Unified `deploy` tool (promote/rollback/status/reset operations)
- Result: Cleaner API surface, fewer integration points, simplified workflows

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

#### 5. Metadata Caching (Extended Attributes)
**Purpose:** Eliminate redundant API calls by caching GAS metadata in filesystem xattr
**Performance:** 85-95% faster reads (fast path: ~5-50ms vs slow path: ~800-1200ms)
**Storage:** `user.gas.updateTime` + `user.gas.fileType` stored in extended attributes
**Sync Detection:** Compare local mtime with cached updateTime → fast path if match (no API call)
**Tools:** cat (fast path read) | write/raw_write (cache on write) | local_sync (cache on sync) | cache_clear (debug utility)
**Docs:** See docs/METADATA_CACHING.md for complete architecture and usage examples

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

### Git Sync (2 tools, safe merge, LOCAL-FIRST)

**Tools:** local_sync (ALWAYS pull→merge→push) → config (manage sync_folder and settings)

**Concepts:** .git/config.gs breadcrumb (REQUIRED, manually created) + sync folders (LLM git commands) + pull-merge-push (never blind push) + auto-transforms (README.md ↔ .html, dotfiles)

**Workflow:**
1. Manually create .git/config.gs in GAS using write
2. Create local git repo: git init && git remote add origin <url>
3. Run local_sync({scriptId}) to sync files
4. Standard git: git add/commit/push
5. See docs/GIT_SYNC_WORKFLOWS.md for details

**Git Refs Breadcrumbs:** `.git/refs/heads/main` and `.git/refs/remotes/origin/main` stored in GAS for repository connection tracking

**NO AUTO-BOOTSTRAP:** .git/config.gs must exist in GAS before running local_sync

### Project Management + Errors

**Management:** project_list (view projects) | project_create (infra setup with 3 deployments) → gas-config.json stores → all tools require explicit scriptId

**Errors:** MCPGasError → ValidationError | AuthenticationError | FileOperationError | QuotaError | ApiError → MCP-compatible transform

## Config + Tools

**Config:** gas-config.json (OAuth + projects + envs + paths) | oauth-config.json (GCP credentials, desktop app) | .auth/ (session tokens, auto-refresh)

**Smart Tools** (auto CommonJS): cat/write/cp (wrap/unwrap) + ls/rm/mv/mkdir (paths) + file_status (SHA checksums) + exec/info/reorder (exec/mgmt) + grep/find/ripgrep/sed (search) + deploy (unified deployment)

**Raw Tools** (exact content): raw_cat/raw_write/raw_cp (preserve wrappers) + raw_ls/raw_rm/raw_mv + raw_find/raw_grep/raw_ripgrep/raw_sed

**Git Tools:** local_sync + config (sync_folder management) — Breadcrumb files: .git/config.gs + .git/refs/heads/main + .git/refs/remotes/origin/main

**Project Tools:** project_list/project_create/project_init + auth (OAuth)

**Design:** Flat architecture + smart (process) vs raw (preserve) + naming (mcp__gas__* vs mcp__gas__raw_*) + period prefix (.gitignore.gs) + unified paths (~/gas-repos/project-[scriptId]/)

## Development

**New Tool:** src/tools/ extend BaseTool (base.ts) → name (mcp__gas__*) + description + inputSchema → execute (validate → auth → operation) → register in mcpServer.ts → tests (unit/integration/system/security)

**TypeScript:** .js imports (ESM) | named exports | type imports `import type` | kebab-case files + PascalCase classes | strict ES2022 | tsconfig.production.json (no maps/declarations)

**Tests:** unit (mock) + integration (real GAS API + auth) + system (MCP protocol) + security (validation) + verification (API schema) + performance (benchmarks) → mocha + chai + .mocharc.json (15s timeout) + globalAuth.ts

**Test Organization:** Functional domain-based test files (project-lifecycle, file-operations, search-operations, module-system, code-execution, deployment, error-handling, performance) → See test/integration/mcp-gas-validation/TEST-SUITE-ORGANIZATION.md

**Security:** OAuth (OS-secure storage) + PKCE (intercept prevention) + input validation + scriptId (25-60 alphanumeric) + path traversal prevention + array-based git (injection prevention)

**Performance:** Local cache (reduce API) + incremental TS builds + concurrent asset copy + smart local-first + rate limiting (quota protection)

**Debug:** `DEBUG=mcp:* | mcp:auth | mcp:execution | mcp:sync npm start`

## MCP Integration

**Server:** MCP protocol → AI assistants (Claude) → ~50 GAS tools

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
