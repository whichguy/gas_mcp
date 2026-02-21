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
npm run test:production          # Production readiness report
npm run test:all-verify          # Run all verification tests
```

### Development Workflow

**Critical**: After making changes to MCP server code or CommonJS modules:
1. Build: `npm run build`
2. **Restart Claude Code** - Required to pick up changes
3. Test the changes

**Test Project**: Use scriptId `1Y72rigcMUAwRd7bwl3CR57O6ENo5sKTn0xAl2C4HoZys75N5utGfkCUG` for testing

## Architecture Overview

**MCP server:** AI ↔ GAS → 52 tools for create/manage/execute GAS projects

**Flow:** Client ↔ stdio ↔ mcpServer → tools → gasClient → GAS API

**Layers:** Protocol (stdio + dispatch) → Tools (validate + auth + execute) → Auth (OAuth PKCE + refresh) → API (rate limit + retry)

**See:** [docs/REFERENCE.md](docs/REFERENCE.md) for complete tool reference

## Core Capabilities

### 1. CommonJS Module System
**Runtime:** require() + module.exports + exports → Node.js semantics in GAS
**Tools:** cat/write auto-unwrap/wrap → edit clean code → execute with full module access
**Pattern:** Calculator.js `module.exports = {add, multiply}` → Main.js `require('Calculator').add(5,6)`
**Infra:** CommonJS.js handles resolution/caching → transparent to user
**ConfigManager:** Installed as `common-js/ConfigManager` - hierarchical configuration with 5-level scope priority (userDoc → doc → user → domain → script)

**Module Loading (write moduleOptions):**
- `loadNow: true` (eager) → _main() at startup → use for: doGet/doPost, onOpen/onEdit/onInstall triggers, __events__ registration
- `loadNow: false` (lazy) → _main() on first require() → use for: utils, helpers, internal logic
- `omit` (preserve) → reads existing setting → use for: updating existing, bulk ops (set explicit to skip lookup)

**Two Hoisted Function Systems:**

| System | Location | Purpose | How to Use |
|--------|----------|---------|------------|
| **moduleOptions.hoistedFunctions** | `src/utils/moduleWrapper.ts` | Google Sheets custom functions (=MYFUNCTION) | `write({..., moduleOptions: { hoistedFunctions: [{name, params, jsdoc}] }})` |
| **@hoisted JSDoc annotation** | `src/utils/hoistedFunctionGenerator.ts` | Client-side google.script.run bridges | Add `@hoisted` to function JSDoc |

These systems are **independent** — choose based on whether you need Sheets custom functions (moduleOptions) or client-side HTML bridges (@hoisted).

**See:** [docs/developer/COMMONJS_DEEP_DIVE.md](docs/developer/COMMONJS_DEEP_DIVE.md) for module logging control and response enhancement

### 2. Ad-hoc Execution
**Interface:** exec({scriptId, js_statement}) → cloud exec → no deploy
**Scope:** Math/Date + all GAS services (DriveApp/SpreadsheetApp/GmailApp/etc) + require("Module") + Logger capture
**Examples:**
- `js_statement: "Math.PI * 2"` → instant math
- `js_statement: "require('Utils').processData([1,2,3])"` → call your code
- `js_statement: "SpreadsheetApp.create('Report').getId()"` → multi-step workflow

### 3. Unix Interface
**Commands:** cat ls grep find sed ripgrep → familiar workflow → auto CommonJS handling
**Duality:** regular tools (clean code) vs raw_* tools (system wrappers) → LLM chooses by tool name
**Pattern:** cat unwraps → edit clean → write wraps | raw_cat skips unwrap → see system code

### 4. File Integrity & Caching
**Checksums:** Git SHA-1 (`sha1("blob "+size+"\0"+content)`) + SHA-256 + MD5 → verify without download
**Tools:** ls({checksums:true}) quick | file_status({hashTypes:["git-sha1"]}) detailed
**Metadata Caching:** 85-95% faster (5-50ms vs 800-1200ms) via extended attributes. See [docs/METADATA_CACHING.md](docs/METADATA_CACHING.md)

### 5. Deployment
**Tools:** `deploy` (unified — version snapshot + consumer pin + sheet sync) | `deploy_config` (infrastructure — reset/status only)
**Workflow:** `deploy({to: "staging", scriptId, description: "v1.0"})` → test → `deploy({to: "prod", scriptId})`
**Safety:** Both tools use LockManager for concurrent write protection. `dryRun: true` previews changes without applying.
**Sheet Sync:** Promotes copy spreadsheet sheets from source to target env (disable with `syncSheets: false`).
**Resilience:** ConfigManager write failures produce `configWarning` (deployment still succeeds). Rollback with missing state gives helpful error with current pin.
**Auto-Storage:** URLs and deployment IDs stored in PropertiesService via ConfigManager
**See:** [docs/LIBRARY_DEPLOYMENT_WORKFLOW.md](docs/LIBRARY_DEPLOYMENT_WORKFLOW.md) for deploy guide | [docs/DEPLOYMENT_WORKFLOW.md](docs/DEPLOYMENT_WORKFLOW.md) for deploy_config guide

### 6. Write Locking
**Protection:** Filesystem-based per-project write locks prevent concurrent modification (GAS API has no server-side concurrency control)
**Behavior:** Same-project writes queued (30s timeout) | different-project writes parallel | reads unlocked | auto-recovery on crash
**See:** [docs/developer/WRITE_LOCKING.md](docs/developer/WRITE_LOCKING.md) for full details

## Architectural Patterns

**Tool:** BaseTool → name + inputSchema → execute (validate → auth → operation) → formatSuccess/handleApiError
**Virtual Files:** .git/.gitignore/.env ↔ .gs suffix → period prefix handling → MD ↔ HTML transforms
**Sync:** Local (./src/) → Remote GAS → Git mirror (~/gas-repos/project-[scriptId]/) → local-first auto-sync

### File Operation Strategy Pattern

**Location:** `src/core/git/operations/`
**Purpose:** Separates file operation logic from git orchestration. Used by edit, aider, mv, cp, rm tools.
**Two-Phase Workflow:**
1. `computeChanges()` - Read from remote, compute changes (NO side effects)
2. `applyChanges(validatedContent)` - Write hook-validated content to remote

**Key Files:** `FileOperationStrategy.ts` (interface), `EditOperationStrategy.ts`, `AiderOperationStrategy.ts`, `CopyOperationStrategy.ts`, `MoveOperationStrategy.ts`, `DeleteOperationStrategy.ts`
**Orchestrator:** `GitOperationManager` (`src/core/git/GitOperationManager.ts`) — path resolution → branch management → compute → hook validation → apply → git commit → sync

**moduleOptions Preservation:** All strategies preserve `loadNow`, `hoistedFunctions`, `__global__`, `__events__` when unwrapping/rewrapping CommonJS.

### Worktree System

Enable multiple Claude Code agents to work concurrently on isolated GAS projects while sharing git history. `worktree` tool with 10 operations (add/claim/release/merge/remove/list/status/sync/batch-add/cleanup).

**See:** [docs/git/GIT_WORKFLOWS.md](docs/git/GIT_WORKFLOWS.md) — Worktree System section

## Git Integration

**See:** [docs/git/GIT_WORKFLOWS.md](docs/git/GIT_WORKFLOWS.md) for complete workflows, tool reference, and examples.

### Sync (rsync)

**Pattern:** Single-call stateless sync with optional dryrun preview | Requires `.git/config` breadcrumb
**Operations:** `pull` (GAS → Local) | `push` (Local → GAS) — add `dryrun: true` to preview
**Key features:**
- No planId, no TTL — diff computed and applied in single call
- No locking — rsync is stateless; write tools handle their own locking
- Deletions require `confirmDeletions: true`; bootstrap blocks all deletions
- Execute responses include `git.workflowHint` with suggested next action (push/finish via git_feature)

### Auto-Initialization

Git repos auto-initialized when `.git` directory is missing. Uses global git config if available, otherwise sets defaults. Shared utility: `src/utils/gitInit.ts`.

### Commit Workflow — CRITICAL

**Write tools do NOT auto-commit.** This aligns with Claude Code's philosophy: "NEVER commit unless explicitly asked."

**Behavior:**
1. `write`, `edit`, `aider`, `cp`, `mv`, `rm` push to GAS but do NOT commit locally
2. Files are staged (`git add`) but require explicit commit
3. Response includes `git.blocked: true` when uncommitted changes exist
4. LLM must call `git_feature({operation:'commit'})` to save changes to git

**Response with Git Hints (CompactGitHint):**
```typescript
{
  git: {
    branch: 'llm-feature-user-auth',
    uncommitted: 3,
    files: ['auth.js', 'utils.js', 'config.js'],
    blocked: true,
    urgency: 'HIGH',          // omitted for NORMAL; CRITICAL (5+), HIGH (3-4)
    action: 'commit'           // or 'finish' on feature branches
  }
}
```

**Task Completion Rule:**
- A task is NOT complete while `git.blocked: true`
- Check `git.uncommitted` — if > 0, commit before reporting task done

**When to commit:**
- User says "done", "finished", "complete", "that's all"
- User requests "commit this", "push this", "save to github"
- After completing a logical unit of work
- Before switching to a different task

**Do NOT leave uncommitted work** — always commit and push before ending the task.

**If git_feature finish fails**, use Bash tool:
```bash
git -C ~/gas-repos/project-{scriptId} checkout main && \
git -C ~/gas-repos/project-{scriptId} merge --squash {feature-branch} && \
git -C ~/gas-repos/project-{scriptId} commit -m "feat: {description}" && \
git -C ~/gas-repos/project-{scriptId} push origin main
```

### Deploy Workflow Hints

After `git_feature commit` or `git_feature finish`, the response includes a `deploy` envelope that nudges the LLM to promote to staging:

```typescript
// Response with deploy hint (commit → LOW, finish → MEDIUM):
{
  "deploy": {
    "staging": "stale",
    "hint": "Commit ready — deploy to staging to test",
    "urgency": "LOW"   // LOW (after commit) | MEDIUM (after finish)
  }
}
```

**Escalation Rules:**
- After `git_feature commit` → `urgency: "LOW"`, hint: "Commit ready — deploy to staging to test"
- After `git_feature finish` → `urgency: "MEDIUM"`, hint: "Changes merged — deploy to staging before prod"
- After `deploy({to:'staging'})` succeeds → hint **suppressed** on next commit (staging is current)
- While uncommitted changes exist → hint **absent** (git hint takes priority)

**Expected LLM behavior:** When `deploy.urgency` is present, the task is NOT complete until staging is deployed. Run `deploy({to: "staging", scriptId})` before reporting the task done.

**Implementation:** `CompactDeployHint` in `src/utils/gitStatus.ts` | `deployState` Map (session-scoped, resets on restart) | `updateDeployState()` called by `deploy` tool after successful staging promote.

### git_feature Operations

**Tool:** `git_feature` — 7 operations: start, commit, push, finish, rollback, list, switch

**Typical Workflow:**
```typescript
git_feature({operation: 'start', scriptId, featureName: 'user-auth'})  // → llm-feature-user-auth
git_feature({operation: 'commit', scriptId, message: 'feat: Add login form'})
git_feature({operation: 'push', scriptId})
git_feature({operation: 'finish', scriptId, pushToRemote: true})
```

**Security:** Branch names sanitized — pattern `^[a-zA-Z0-9-]+$`, prevents git option injection.
**Polyrepo:** Use `projectPath` parameter: `git_feature({..., projectPath: 'backend'})`

### Project Management + Errors

**Management:** project_list (view projects) | project_create (infra setup with 3 deployments) → gas-config.json stores → all tools require explicit scriptId
**Errors:** MCPGasError → ValidationError | AuthenticationError | FileOperationError | QuotaError | ApiError → MCP-compatible transform

## Config + Tools

**Tools (52 total):**
| Category | Count | Tools |
|----------|-------|-------|
| **File (Smart)** | 14 | cat, write, ls, rm, mv, cp, file_status, grep, find, ripgrep, sed, edit, aider, cache_clear |
| **File (Raw)** | 9 | raw_cat, raw_write, raw_cp, raw_grep, raw_find, raw_ripgrep, raw_sed, raw_edit, raw_aider |
| **Analysis** | 1 | deps (dependency graphs) |
| **Execution** | 2 | exec, exec_api |
| **Deployment** | 12 | deploy, deploy_config, project_create, project_init, deploy_create, deploy_delete, deploy_get_details, deploy_list, deploy_update, version_create, version_get, version_list |
| **Management** | 4 | auth, project_list, reorder, process_list |
| **Logging** | 2 | cloud_logs (list + get operations), executions (execution history) |
| **Triggers** | 1 | trigger (list + create + delete operations) |
| **Git** | 3 | rsync, config, git_feature (start/commit/push/finish/rollback/list/switch) |
| **Worktree** | 1 | worktree (add/claim/release/merge/remove/list/status/sync/batch-add/cleanup) |
| **Sheets** | 1 | sheet_sql |
| **Drive** | 2 | create_script, find_drive_script |
| **Status** | 1 | status (project health + lock diagnostics) |

**Config:** gas-config.json (OAuth + projects) | oauth-config.json (GCP creds) | ~/.auth/mcp-gas/tokens/ (persistent auth tokens)
**Design:** smart (unwrap) vs raw (preserve) | period prefix (.gitignore.gs) | ~/gas-repos/project-[scriptId]/

### Authentication & Token Persistence

**Token Storage:** `~/.auth/mcp-gas/tokens/{email}.json` — persists across server restarts
**Key Features:** Auto-persistence | auto-refresh | cross-session sharing | 0600 permissions | 30-day cleanup
**Workflow:** First use → OAuth flow → token cached | Server restart → auto-loaded | Token expiry → auto-refresh
**Manual Clear:** `rm -rf ~/.auth/mcp-gas/tokens/`

## Development

| Area | Details |
|------|---------|
| **New Tool** | Extend BaseTool → name + inputSchema → execute (validate → auth → operation) → register in mcpServer.ts → tests |
| **TypeScript** | ESM imports (.js) \| named exports \| type imports \| kebab-case files \| PascalCase classes \| strict ES2022 |
| **Tests** | unit (mock) + integration (real API) + system (MCP) + security + verification + performance → mocha/chai (15s timeout) |
| **Test Org** | Domain-based: project-lifecycle, file-operations, search-operations, module-system, code-execution, deployment |
| **Security** | Always use `spawn` with array args, never `exec` with template literals. See [docs/security/SECURITY_GUIDELINES.md](docs/security/SECURITY_GUIDELINES.md) |
| **Performance** | Local cache + incremental builds + concurrent copy + local-first + rate limiting |
| **Debug** | `DEBUG=mcp:* \| mcp:auth \| mcp:execution \| mcp:sync npm start` |

### Key Patterns

**Tool Development:**
- All tools in `src/tools/` extend `BaseTool` from `src/tools/base-tool.ts`
- Input schemas define parameters with TypeScript types + validation
- Tools must be registered in `src/server/mcpServer.ts`

**File Operations:**
- **Smart tools** (cat, write, etc.): Auto-handle CommonJS wrapping/unwrapping
- **Raw tools** (raw_cat, raw_write, etc.): Preserve exact content including system wrappers
- Virtual files: `.gitignore` ↔ `.gitignore.gs` (but `.git/config` stays as-is, no extension)

**CommonJS Integration:**
- User writes clean code → `write` wraps with `_main()` function
- GAS executes wrapped code → `require()` resolves dependencies
- `cat` unwraps for editing → maintains clean code workflow

**Client-Side HTML:**
- Always use `createGasServer()` wrapper instead of `google.script.run`
- Response format: `{success, result, logger_output, execution_type}`
- See [docs/developer/GAS_CLIENT_PATTERNS.md](docs/developer/GAS_CLIENT_PATTERNS.md) for full patterns

**Testing Strategy:**
- **Unit tests**: Fast, mocked dependencies, test individual functions
- **Integration tests**: Real GAS API calls, require authentication, slower
- **System tests**: Full MCP protocol, end-to-end validation

## MCP Integration

**Server:** MCP protocol → AI assistants (Claude) → 52 GAS tools

**Claude Desktop Config** (`~/.claude_desktop_config.json`):
```json
{"mcpServers": {"gas": {"command": "node", "args": ["/path/to/mcp_gas/dist/src/index.js"], "env": {"NODE_ENV": "production"}}}}
```

## Proactive Code Review

After writing or modifying GAS files (.gs/.html/.json), Claude automatically invokes the **gas-code-reviewer** agent when detecting high-risk patterns:

- **Auto-invoke** for: `__events__`, `__global__`, doGet/doPost/onOpen/onEdit handlers
- **Suggest** for: Simple utility modules (user can decline)
- **Milestone reviews**: User says "done", "review", before git commits

This catches critical CommonJS pattern violations (missing loadNow, wrong __global__ syntax) before they cause runtime failures.

## Common Issues

### Build/Restart Required
**Problem**: Changes to tools, schemas, or CommonJS modules not working
**Solution**:
1. `npm run build`
2. Restart Claude Code (changes don't hot-reload)

### Module Updates Not Appearing in GAS
**Problem**: Updated CommonJS infrastructure files not syncing
**Solution**: Update template files in `mcp_gas` repository, rebuild, then update GAS project

### Git Changes Not Being Committed
**Problem**: Write operations not creating commits (this is expected behavior)
**Solution**: Write tools do NOT auto-commit. You must explicitly commit:
1. After writes, call `git_feature({operation: 'commit', scriptId, message: '...'})`
2. Check response for `git.blocked: true` - this means uncommitted changes exist
3. Verify git repo exists at `~/gas-repos/project-{scriptId}/`
4. Check server startup logs for uncommitted changes from previous sessions

### Authentication Tokens Not Persisting
**Problem**: Server requires re-authentication after every restart
**Solution**:
1. Verify token storage location: `ls -la ~/.auth/mcp-gas/tokens/`
2. Check file permissions: should be 0600 (owner-only)
3. If tokens exist but still prompting: Check server startup logs for token loading errors
4. Manual token clear if needed: `rm -rf ~/.auth/mcp-gas/tokens/`

### Integration Tests Failing
**Problem**: Tests fail with authentication errors
**Solution**:
1. First run triggers OAuth flow automatically
2. Tokens cached at `~/.auth/mcp-gas/tokens/` for future runs
3. Set `MCP_TEST_MODE=true` to preserve tokens during testing

### "Cannot find module" Errors
**Problem**: TypeScript imports not resolving
**Solution**:
1. Ensure `.js` extensions on all imports (ESM requirement)
2. Check `tsconfig.json` module resolution settings
3. Rebuild: `npm run clean && npm run build`
