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

### Development Workflow

**Critical**: After making changes to MCP server code or CommonJS modules:
1. Build: `npm run build`
2. **Restart Claude Code** - Required to pick up changes
3. Test the changes

**Test Project**: Use scriptId `1Y72rigcMUAwRd7bwl3CR57O6ENo5sKTn0xAl2C4HoZys75N5utGfkCUG` for testing

## Architecture Overview

**MCP server:** AI ↔ GAS → 41 tools for create/manage/execute GAS projects

**Flow:** Client ↔ stdio ↔ mcpServer → tools → gasClient → GAS API

**Layers:** Protocol (stdio + dispatch) → Tools (validate + auth + execute) → Auth (OAuth PKCE + refresh) → API (rate limit + retry)

**Tool Consolidation** (Jan 2025 - 38% reduction):
- **66 → 41 tools** via strategic consolidation (66 → 40 consolidated, +1 git_feature)
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

**Response Enhancement (write/raw_write):**
- Returns `local: {path, exists}` when file written locally
- Returns `git: {associated, syncFolder}` when `.git/config.gs` breadcrumbs found
- **NEW:** Returns `git: {localGitDetected, breadcrumbExists, recommendation?}` for discovery
  - Automatically detects local git repos at `~/gas-repos/project-{scriptId}/`
  - Checks for `.git/config.gs` breadcrumb in GAS project
  - Provides sync recommendation if local git found but no breadcrumb
  - Example: `{localGitDetected: true, breadcrumbExists: false, recommendation: {action: 'local_sync', command: '...'}}`
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

### Git Integration

#### Git Sync (LOCAL-FIRST, safe merge)

**Pattern:** pull→merge→push (never blind push) | Requires .git/config.gs breadcrumb
**Tools:** local_sync + config (sync_folder management)
**See:** docs/GIT_SYNC_WORKFLOWS.md for complete workflow

#### Git Auto-Initialization (Automatic .git setup)

**NEW:** Automatic git repository initialization when .git directory missing

**Shared Utility:** `src/utils/gitInit.ts` - Used by both `write` and `git_feature` tools

**Auto-Init Strategy:**
1. Check if `.git` directory exists → skip if present
2. Run `git init` to create repository
3. Detect global git config: `git config --global user.name/user.email`
4. If global config exists → use automatically
5. If no global config → set local defaults: `user.name="MCP Gas"`, `user.email="mcp@gas.local"`

**When Auto-Init Triggers:**
- **write/raw_write**: When git repository detected but .git missing
- **git_feature**: Any operation (start/finish/list/etc.) when .git missing
- **Consistent behavior**: Both tools use identical initialization logic

**Config Detection Result:**
```typescript
{
  initialized: boolean,    // true if git repo exists
  isNew: boolean,          // true if just created
  configSource: 'global' | 'defaults' | 'existing',
  repoPath: string
}
```

**Example Logging:**
```
[GIT-INIT] Initializing git repository at /path/to/repo
[GIT-INIT] ✓ Git repository initialized
[GIT-INIT] Using global git config (name="Your Name", email="you@email.com")
```

or

```
[GIT-INIT] No global git config found, setting local defaults
[GIT-INIT] Set default git config (user.name="MCP Gas", user.email="mcp@gas.local")
```

**Benefits:**
- Seamless experience - no manual `git init` required
- Respects user's global git configuration
- Consistent behavior across all git operations
- Automatic .gitignore creation for new repos

#### Git Auto-Commit (Atomic write → commit → push workflow)

**NEW:** Automatic feature branch creation and atomic commits when git repository detected

**Two-Phase Discovery:**
- **Phase A (Local Filesystem):** Scans for git repo at `~/gas-repos/project-{scriptId}/`
- **Phase B (GAS Breadcrumbs):** Reads `.git/config.gs` from GAS project for sync folder path

**Automatic Workflow:**
1. `write` or `raw_write` detects git repository (Phase A + B)
2. Auto-creates feature branch if on main/master: `llm-feature-auto-{timestamp}`
3. Writes file locally → runs git hooks → commits atomically
4. Pushes to remote GAS
5. Rolls back on failure (atomic operation)

**Custom Commit Messages:**
- Use `changeReason` parameter: `write({..., changeReason: 'feat: Add user auth'})`
- Default: `"Update {filename}"` or `"Add {filename}"`

**Polyrepo Support:**
- Use `projectPath` parameter for nested git repos: `write({..., projectPath: 'backend'})`
- Enables multiple independent git repositories within single GAS project

**Response Enhancement:**
```typescript
{
  success: true,
  git: {
    enabled: true,
    source: 'breadcrumb' | 'local',  // Discovery method
    gitPath: '/path/to/git/repo',
    branch: 'llm-feature-auto-20250121143022',
    branchCreated: true,
    commitHash: 'abc123d',
    commitMessage: 'feat: Add user auth',
    hookModified: false,  // True if git hooks modified content
    breadcrumbsPulled: ['config']  // Breadcrumbs synced from GAS
  }
}
```

#### Git Feature Workflow (Manual branch management)

**Tool:** `git_feature` - Consolidated tool with 5 operations

**Operations:**
- **`start`**: Create new feature branch `llm-feature-{name}`
  - Example: `git_feature({operation: 'start', scriptId, featureName: 'user-auth'})`
  - Creates: `llm-feature-user-auth`
  - Validates: Not already on feature branch, no uncommitted changes

- **`finish`**: Squash merge to main/master and optionally delete branch
  - Example: `git_feature({operation: 'finish', scriptId, deleteAfterMerge: true})`
  - Auto-detects default branch (main or master)
  - Creates squash commit: `"Feature: {description}"`

- **`rollback`**: Delete branch without merging
  - Example: `git_feature({operation: 'rollback', scriptId, branch: 'llm-feature-user-auth'})`
  - Warns if uncommitted changes will be lost

- **`list`**: Show all feature branches
  - Example: `git_feature({operation: 'list', scriptId})`
  - Returns: `{branches: [...], current: 'llm-feature-user-auth', total: 3}`

- **`switch`**: Switch between branches
  - Example: `git_feature({operation: 'switch', scriptId, branch: 'llm-feature-user-auth'})`
  - Validates: Branch exists, no uncommitted changes

**Dynamic Branch Detection:**
- 4-strategy detection for default branch (main vs master)
- Strategy 1: Check `git symbolic-ref refs/remotes/origin/HEAD`
- Strategy 2: Verify if 'main' exists
- Strategy 3: Verify if 'master' exists
- Strategy 4: Use current branch as fallback

**Security:**
- Branch names sanitized for shell safety
- Pattern: `^[a-zA-Z0-9-]+$` (alphanumeric + hyphens only)
- Prevents git option injection (`--` and leading `-` rejected)

**Polyrepo Support:**
- Use `projectPath` parameter: `git_feature({..., projectPath: 'backend'})`

### Project Management + Errors

**Management:** project_list (view projects) | project_create (infra setup with 3 deployments) → gas-config.json stores → all tools require explicit scriptId

**Errors:** MCPGasError → ValidationError | AuthenticationError | FileOperationError | QuotaError | ApiError → MCP-compatible transform

## Config + Tools

**Tools (41 total):**
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
| **Git** | 3 | local_sync, config, git_feature (start/finish/rollback/list/switch) |
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

### Key Patterns

**Tool Development:**
- All tools in `src/tools/` extend `BaseTool` from `src/tools/base-tool.ts`
- Tools use `mcp__gas__*` naming convention (e.g., `mcp__gas__write`, `mcp__gas__exec`)
- Input schemas define parameters with TypeScript types + validation
- Tools must be registered in `src/server/mcpServer.ts`

**File Operations:**
- **Smart tools** (cat, write, etc.): Auto-handle CommonJS wrapping/unwrapping
- **Raw tools** (raw_cat, raw_write, etc.): Preserve exact content including system wrappers
- Virtual files: `.gitignore` ↔ `.gitignore.gs`, `.git/config` ↔ `.git/config.gs`

**CommonJS Integration:**
- User writes clean code → `write` wraps with `_main()` function
- GAS executes wrapped code → `require()` resolves dependencies
- `cat` unwraps for editing → maintains clean code workflow
- Infrastructure files: `src/require.js`, `src/__mcp_exec.js`

**Testing Strategy:**
- **Unit tests**: Fast, mocked dependencies, test individual functions
- **Integration tests**: Real GAS API calls, require authentication, slower
- **System tests**: Full MCP protocol, end-to-end validation
- Run unit tests frequently during development
- Run integration tests before major commits

## MCP Integration

**Server:** MCP protocol → AI assistants (Claude) → 40 GAS tools

**Claude Desktop Config** (`~/.claude_desktop_config.json`):
```json
{"mcpServers": {"gas": {"command": "node", "args": ["/path/to/mcp_gas/dist/src/index.js"], "env": {"NODE_ENV": "production"}}}}
```

## Common Issues

### Build/Restart Required
**Problem**: Changes to tools, schemas, or CommonJS modules not working
**Solution**:
1. `npm run build`
2. Restart Claude Code (changes don't hot-reload)

### Module Updates Not Appearing in GAS
**Problem**: Updated CommonJS infrastructure files not syncing
**Solution**: Update template files in `mcp_gas` repository, rebuild, then update GAS project

### Git Auto-Commit Not Working
**Problem**: Write operations not creating commits
**Solution**:
1. Ensure git repo exists at `~/gas-repos/project-{scriptId}/`
2. Create `.git/config.gs` breadcrumb in GAS project
3. Verify git is initialized: `cd ~/gas-repos/project-{scriptId} && git status`

### Integration Tests Failing
**Problem**: Tests fail with authentication errors
**Solution**: Run `npm test` first to trigger OAuth flow, then run integration tests

### "Cannot find module" Errors
**Problem**: TypeScript imports not resolving
**Solution**:
1. Ensure `.js` extensions on all imports (ESM requirement)
2. Check `tsconfig.json` module resolution settings
3. Rebuild: `npm run clean && npm run build`
