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

**MCP server:** AI ↔ GAS → 50 tools for create/manage/execute GAS projects

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
**ConfigManager:** Installed as `common-js/ConfigManager` - hierarchical configuration with 5-level scope priority (userDoc → doc → user → domain → script). Automatic PropertiesService integration for deployment URLs/IDs.

**Module Loading (write moduleOptions):**
- `loadNow: true` (eager) → _main() at startup → use for: doGet/doPost, onOpen/onEdit/onInstall triggers, __events__ registration
- `loadNow: false` (lazy) → _main() on first require() → use for: utils, helpers, internal logic
- `omit` (preserve) → reads existing setting (~200-500ms) | defaults lazy for new files → use for: updating existing, bulk ops (set explicit to skip lookup)

**Two Hoisted Function Systems:**

There are two separate systems for hoisting functions in GAS - each serves a different purpose:

| System | Location | Purpose | How to Use |
|--------|----------|---------|------------|
| **moduleOptions.hoistedFunctions** | `src/utils/moduleWrapper.ts` | Google Sheets custom functions (=MYFUNCTION) | `write({..., moduleOptions: { hoistedFunctions: [{name, params, jsdoc}] }})` |
| **@hoisted JSDoc annotation** | `src/utils/hoistedFunctionGenerator.ts` | Client-side google.script.run bridges | Add `@hoisted` to function JSDoc |

- **hoistedFunctions in moduleOptions**: Creates bridge functions visible to Google Sheets for autocomplete (e.g., custom functions). Generated between `// ===== HOISTED CUSTOM FUNCTIONS =====` markers.
- **@hoisted annotation**: Parses `@hoisted` JSDoc tags from source code to generate functions callable via `google.script.run` from HTML sidebars/dialogs.

These systems are **independent** and don't interact - choose based on whether you need Sheets custom functions (moduleOptions) or client-side HTML bridges (@hoisted).

#### Module Logging Control (Debugging CommonJS)

**Runtime Functions**: The CommonJS module system provides four global functions for controlling per-module debug logging:

**Enable logging for modules:**
```javascript
// Enable all modules
exec({scriptId, js_statement: "setModuleLogging('*', true)"})

// Enable specific folder
exec({scriptId, js_statement: "setModuleLogging('auth/*', true)"})

// Enable specific modules
exec({scriptId, js_statement: "setModuleLogging(['api/Handler', 'auth/Client'], true)"})
```

**Disable or exclude modules:**
```javascript
// Disable specific module (when * is enabled)
exec({scriptId, js_statement: "setModuleLogging('auth/NoisyModule', false, 'script', true)"})
```

**Query and clear:**
```javascript
exec({scriptId, js_statement: "getModuleLogging()"})       // Get all settings
exec({scriptId, js_statement: "listLoggingEnabled()"})     // List enabled patterns
exec({scriptId, js_statement: "clearModuleLogging()"})     // Clear all
```

**Pattern matching:**
- Exact name: `'auth/SessionManager'` - matches exactly
- Folder pattern: `'auth/*'` - matches all modules in auth/
- Wildcard: `'*'` - matches all modules
- Exclusion precedence: `false` takes precedence over `true`

**Typical debugging workflow:**
1. `setModuleLogging('*', true)` - Enable all logging
2. Execute your code
3. Review `logger_output` in exec result
4. `clearModuleLogging()` - Clean up

**Response Enhancement (write/raw_write):**
- Returns `local: {path, exists}` when file written locally
- Returns `git: {associated, syncFolder}` when `.git/config` breadcrumbs found
- **NEW:** Returns `git: {localGitDetected, breadcrumbExists, recommendation?}` for discovery
  - Automatically detects local git repos at `~/gas-repos/project-{scriptId}/`
  - Checks for `.git/config` breadcrumb in GAS project
  - Provides sync recommendation if local git found but no breadcrumb
  - Example: `{localGitDetected: true, breadcrumbExists: false, recommendation: {action: 'rsync', command: '...'}}`
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
**Auto-Storage:** Deploy operations automatically store URLs and IDs in PropertiesService via ConfigManager. Keys: `DEV_URL`, `DEV_DEPLOYMENT_ID`, `STAGING_URL`, `STAGING_DEPLOYMENT_ID`, `PROD_URL`, `PROD_DEPLOYMENT_ID` (scope: script)

**Workflow:**
```
dev (HEAD) → promote → staging (v1,v2,v3...) → promote → prod (stable)
```

**Operations:**

1. **Promote** - Move code forward through pipeline
   ```typescript
   // dev → staging (creates version snapshot)
   deploy({operation: 'promote', environment: 'staging', scriptId,
           description: 'v1.1 Bug fixes'})

   // staging → prod (updates prod to staging version)
   deploy({operation: 'promote', environment: 'prod', scriptId})
   ```

2. **Rollback** - Revert to previous version
   ```typescript
   deploy({operation: 'rollback', environment: 'prod', scriptId})
   // or specify version: toVersion: 3
   ```

3. **Status** - Check all environments
   ```typescript
   deploy({operation: 'status', scriptId})
   // Returns: dev/staging/prod versions + URLs
   ```

4. **Reset** - Recreate all 3 deployments (⚠️ destructive)
   ```typescript
   deploy({operation: 'reset', scriptId})
   // Creates fresh dev/staging/prod deployments
   ```

**Key Concepts:**
- **dev**: Always points to HEAD - instant feedback during development
- **staging**: Versioned snapshots - immutable for QA testing
- **prod**: Production-stable - only receives tested staging versions

**Typical Flow:**
1. Develop & test in dev (HEAD updates automatically)
2. When ready: promote dev→staging (creates v1)
3. QA tests staging v1
4. If approved: promote staging→prod (prod points to v1)
5. If issues: rollback prod to previous version

**Best Practices:**
- Always test in staging before promoting to prod
- Use descriptive version descriptions
- Check status after each promotion
- Keep 3+ previous versions for rollback

**Full Guide:** See `docs/DEPLOYMENT_WORKFLOW.md` for complete workflow documentation

#### 7. Write Operation Locking

**Protection**: Filesystem-based per-project write locks prevent concurrent modification collisions

**Why Necessary**: Google Apps Script API provides NO server-side concurrency control
- ❌ No ETags, If-Match headers, or version checking
- ❌ No conflict detection or error codes
- ⚠️ **Last-write-wins** behavior with complete project replacement
- ✅ **Client-side locking required** to prevent data loss

**Collision Example Without Locking:**
```
Client A: read → modify file 1 → write
Client B: read → modify file 2 → write ← OVERWRITES Client A's changes!
Result: File 1 changes lost
```

**Lock Behavior:**
- **Concurrent writes to different projects**: Allowed (no blocking)
- **Concurrent writes to same project**: Queued (second waits for first)
- **Timeout**: 30s default (configurable via `MCP_GAS_LOCK_TIMEOUT`)
- **Lock location**: `~/.auth/mcp-gas/locks/{scriptId}.lock`
- **Stale detection**: Automatic cleanup of locks from dead processes

**Protected Operations:**
All write operations that call `updateProjectContent`:
- write, raw_write, edit, aider, sed
- rm, mv, cp
- gitSync, deploy operations

**Error Handling:**
- `LockTimeoutError`: Thrown after 30s waiting for lock
- Indicates: Another operation in progress or stuck process
- Resolution: Retry operation or check for orphaned locks
- Error message includes current lock holder info (PID, hostname, operation)

**Automatic Recovery:**
- **Startup cleanup**: Removes stale locks from dead processes
- **Shutdown cleanup**: Releases all locks on SIGINT/SIGTERM
- **Exception safety**: Locks released even on write errors (try/finally)
- **No manual intervention**: System self-heals automatically

**Performance Impact:**
- **Uncontended locks**: ~2-10ms overhead (file create/delete)
- **Contended locks**: Wait time = first operation duration (100ms min, 30s max timeout)
  - Example: If operation 1 takes 5s, operation 2 waits ~5s + lock overhead
  - Operations to different projects run in parallel (no waiting)
- Network latency (100-500ms) typically dominates in uncontended case
- No impact on read operations (cat, ls, grep remain unlocked)

**Debugging:**
```typescript
// Check lock status
await lockManager.getLockStatus(scriptId)
// Returns: { locked: boolean, info?: { pid, hostname, operation, timestamp } }

// Manual cleanup if needed (rare)
await lockManager.cleanupStaleLocks()
```

**Environment Variables:**
- `MCP_GAS_LOCK_TIMEOUT=60000` - Override default 30s timeout (minimum 1000ms)
- Lock directory: `~/.auth/mcp-gas/locks/` (consistent with token storage)

**Limitations:**
- **Single-user per machine**: Locks are stored in user home directory (`~/.auth/mcp-gas/locks/`)
  - Users A and B on same machine have separate lock directories → won't coordinate
  - Only protects concurrent operations from the same user account
  - Multi-user environments: Each user's operations are isolated, no cross-user protection
- **Local filesystem required**: Lock atomicity requires local filesystem
  - ✅ Works: Local disk (ext4, APFS, NTFS, etc.)
  - ⚠️ May fail: NFS, SMB/CIFS, distributed filesystems (lock atomicity not guaranteed)
  - Use local disk for lock directory to ensure correctness
- **Cross-machine coordination**: Different hostnames rely on timestamp-based stale detection
  - Clock skew between machines can affect stale detection accuracy
  - 5-minute threshold provides buffer for minor clock differences
  - Same user on different machines will coordinate via shared home directory (if networked)

**Observability:**
```typescript
// Get lock usage metrics for debugging
const metrics = lockManager.getMetrics();
// Returns: { acquisitions, contentions, timeouts, staleRemoved, currentlyHeld }
```

---

### Architectural Patterns

**Tool:** BaseTool → name (mcp__gas__*) + inputSchema → execute (validate → auth → operation) → formatSuccess/handleApiError
**Virtual Files:** .git/.gitignore/.env ↔ .gs suffix → period prefix handling → MD ↔ HTML transforms
**Sync:** Local (./src/) → Remote GAS → Git mirror (~/gas-repos/project-[scriptId]/) → local-first auto-sync

#### File Operation Strategy Pattern

**Location:** `src/core/git/operations/`

**Purpose:** Separates file operation logic from git orchestration. Used by edit, aider, mv, cp, rm tools.

**Two-Phase Workflow:**
1. `computeChanges()` - Read from remote, compute changes (NO side effects, NO remote writes)
2. `applyChanges(validatedContent)` - Write hook-validated content to remote

**Key Files:**
| File | Purpose |
|------|---------|
| `FileOperationStrategy.ts` | Interface defining the contract |
| `EditOperationStrategy.ts` | Exact string matching edits |
| `AiderOperationStrategy.ts` | Fuzzy matching edits (Levenshtein distance) |
| `CopyOperationStrategy.ts` | File copy with CommonJS unwrap/rewrap |
| `MoveOperationStrategy.ts` | File move/rename with CommonJS processing |
| `DeleteOperationStrategy.ts` | File deletion |

**Orchestrator:** `GitOperationManager` (`src/core/git/GitOperationManager.ts`)
- Path resolution → Branch management → computeChanges() → Hook validation → applyChanges() → Git commit → Sync
- Atomic rollback on any failure via strategy.rollback()

**moduleOptions Preservation:**
All strategies preserve `loadNow`, `hoistedFunctions`, `__global__`, `__events__` when unwrapping/rewrapping CommonJS:
```typescript
// In computeChanges():
const { unwrappedContent, existingOptions } = unwrapModuleContent(content);
this.existingOptions = existingOptions;  // Store for later

// In applyChanges():
finalContent = wrapModuleContent(content, moduleName, this.existingOptions);  // Preserve!
```

### Worktree System (Parallel Development)

**Purpose:** Enable multiple Claude Code agents to work concurrently on isolated GAS projects while sharing git history.

**Tool:** `mcp__gas__worktree` with 10 operations

**Architecture:**
```
Claude Code Agents (A, B, C)
         │
         ▼
    Worktree Tool
         │
         ▼
GAS Projects (Isolated)              Local Git (Shared)
├── Parent scriptId:P                ~/gas-repos/project-{P}/
├── Worktree A scriptId:A    ←→      └── worktrees/A/ (feature-A branch)
├── Worktree B scriptId:B    ←→      └── worktrees/B/ (feature-B branch)
└── Worktree C scriptId:C    ←→      └── worktrees/C/ (feature-C branch)
```

**State Machine:** `CREATING → READY → CLAIMED → MERGING → MERGED | FAILED | ORPHAN_*`

**Operations:**

| Operation | Purpose | Key Params |
|-----------|---------|------------|
| `add` | Create worktree | `parentScriptId`, `branchName`, `claimImmediately` |
| `claim` | Get READY or create | `parentScriptId`, `createIfNone`, `agentId` |
| `release` | Return to READY | `worktreeScriptId`, `force` |
| `merge` | Squash merge to parent | `worktreeScriptId`, `pushToRemote`, `deleteAfterMerge` |
| `remove` | Delete worktree | `worktreeScriptId`, `force` |
| `list` | Filter worktrees | `parentScriptId`, `state[]` |
| `status` | Divergence info | `worktreeScriptId` |
| `sync` | Pull parent changes | `worktreeScriptId`, `refreshBaseHashes` |
| `batch-add` | Create N worktrees | `parentScriptId`, `count`, `branchPrefix` |
| `cleanup` | Remove orphans | `parentScriptId`, `maxAge`, `dryRun` |

**Typical Workflows:**

```typescript
// Single agent workflow
const wt = await worktree({operation: 'add', parentScriptId, branchName: 'feature'});
// ... develop using write/edit tools with wt.scriptId ...
await worktree({operation: 'merge', worktreeScriptId: wt.scriptId});

// Pool workflow (multiple agents)
await worktree({operation: 'batch-add', parentScriptId, count: 3, branchPrefix: 'task'});
// Each agent:
const wt = await worktree({operation: 'claim', parentScriptId, agentId: 'agent-A'});
// ... develop ...
await worktree({operation: 'merge', worktreeScriptId: wt.scriptId});

// Cleanup stale worktrees
await worktree({operation: 'cleanup', parentScriptId, dryRun: true}); // preview
await worktree({operation: 'cleanup', parentScriptId}); // execute
```

**Conflict Detection:** Uses `baseHashes` (Git SHA-1 at worktree creation) for 3-way merge logic:
- Parent modified only → safe to sync
- Worktree modified only → safe to merge
- Both modified differently → conflict

**Concurrency:** File-based locking with heartbeat (15min timeout, 60s refresh)

**Files:**
- `src/tools/worktree/WorktreeTool.ts` - Main tool
- `src/tools/worktree/WorktreeLockManager.ts` - Concurrency control
- `src/tools/worktree/WorktreeStateManager.ts` - State machine
- `src/types/worktreeTypes.ts` - Type definitions

### Git Integration

#### Git Sync (Two-Phase Workflow)

**Pattern:** plan→execute (two-phase, never blind push) | Requires .git/config breadcrumb
**Tools:** rsync + config (sync_folder management)
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

#### Git Workflow (NO Auto-Commit - Explicit git_feature Required)

**CRITICAL:** Write tools do NOT auto-commit. This aligns with Claude Code's philosophy: "NEVER commit unless explicitly asked."

**Behavior:**
1. `write`, `edit`, `aider`, `cp`, `mv`, `rm` push to GAS but do NOT commit locally
2. Files are staged (`git add`) but require explicit commit
3. Response includes `git.taskCompletionBlocked: true` when uncommitted changes exist
4. LLM must call `git_feature({operation:'commit'})` to save changes to git

**Two-Phase Discovery:**
- **Phase A (Local Filesystem):** Scans for git repo at `~/gas-repos/project-{scriptId}/`
- **Phase B (GAS Breadcrumbs):** Reads `.git/config` from GAS project for sync folder path

**Response with Git Hints:**
```typescript
{
  success: true,
  git: {
    detected: true,
    branch: 'main',
    uncommittedChanges: {
      count: 3,
      files: ['auth.js', 'utils.js', 'config.js'],
      thisFile: true
    },
    recommendation: {
      urgency: 'HIGH',  // CRITICAL (5+), HIGH (3-4), NORMAL (1-2)
      action: 'commit',
      command: "git_feature({operation:'commit', scriptId:'...', message:'...'})",
      reason: '3 files uncommitted - consider committing soon'
    },
    taskCompletionBlocked: true  // LLM signal: task NOT complete
  }
}
```

**Startup Check:**
- On server startup, checks `~/gas-repos/project-*` for uncommitted changes
- Logs warning with file counts and commit instructions
- Helps recover from interrupted sessions

#### Git Feature Workflow (Manual branch management)

**Tool:** `git_feature` - Consolidated tool with 7 operations

**Operations:**
- **`start`**: Create new feature branch `llm-feature-{name}`
  - Example: `git_feature({operation: 'start', scriptId, featureName: 'user-auth'})`
  - Creates: `llm-feature-user-auth`
  - Validates: Not already on feature branch, no uncommitted changes

- **`commit`**: Commit all changes with custom message
  - Example: `git_feature({operation: 'commit', scriptId, message: 'feat: Add user authentication'})`
  - Always commits all changes (`git add -A`)
  - Pre-flight checks: Not in detached HEAD, has changes to commit
  - Returns: commit SHA, message, files changed count, timestamp

- **`push`**: Push current branch to remote with auto-upstream
  - Example: `git_feature({operation: 'push', scriptId})` (uses default remote: origin)
  - Example: `git_feature({operation: 'push', scriptId, remote: 'upstream'})`
  - Auto-sets upstream tracking (`git push -u`)
  - Pre-flight checks: Not in detached HEAD, remote exists
  - Validates remote name for security

- **`finish`**: Squash merge to main/master and optionally delete branch
  - Example: `git_feature({operation: 'finish', scriptId, deleteAfterMerge: true})`
  - Example: `git_feature({operation: 'finish', scriptId, pushToRemote: true})` (merge + push)
  - Auto-detects default branch (main or master)
  - Creates squash commit: `"Feature: {description}"`
  - Optional `pushToRemote` flag to push after merge
  - Handles partial success (merge OK, push failed)

- **`rollback`**: Delete branch without merging
  - Example: `git_feature({operation: 'rollback', scriptId, branch: 'llm-feature-user-auth'})`
  - Warns if uncommitted changes will be lost

- **`list`**: Show all feature branches
  - Example: `git_feature({operation: 'list', scriptId})`
  - Returns: `{branches: [...], current: 'llm-feature-user-auth', total: 3}`

- **`switch`**: Switch between branches
  - Example: `git_feature({operation: 'switch', scriptId, branch: 'llm-feature-user-auth'})`
  - Validates: Branch exists, no uncommitted changes

**Typical Workflow:**
```typescript
// 1. Start feature
git_feature({operation: 'start', scriptId, featureName: 'user-auth'})

// 2. Make changes with auto-commits (via write operations)
// ... or manually commit
git_feature({operation: 'commit', scriptId, message: 'feat: Add login form'})

// 3. Push to backup/share
git_feature({operation: 'push', scriptId})

// 4. Finish and push to main
git_feature({operation: 'finish', scriptId, pushToRemote: true})
```

#### Git Workflow Completion (CRITICAL)

**Write tools do NOT auto-commit. You MUST explicitly commit changes.**

**Workflow:**
1. **During development**: `write` operations stage files but do NOT commit
2. **After each logical change**: Commit explicitly:
   ```typescript
   git_feature({ operation: 'commit', scriptId, message: 'feat: Add user auth' })
   ```
3. **When feature is complete**: Finish and push:
   ```typescript
   git_feature({ operation: 'finish', scriptId, pushToRemote: true })
   ```

**Task Completion Rule:**
- A task is NOT complete while `git.taskCompletionBlocked: true` in responses
- Check `git.uncommittedChanges.count` - if > 0, commit before reporting task done

**When to commit** - Commit changes when:
- User says "done", "finished", "complete", "that's all"
- User requests "commit this", "push this", "save to github"
- After completing a logical unit of work
- Before switching to a different task

**Do NOT leave uncommitted work** - always commit changes and push to GitHub before ending the task.

**If git_feature finish fails**, use Bash tool with these commands:
```bash
git -C ~/gas-repos/project-{scriptId} checkout main && \
git -C ~/gas-repos/project-{scriptId} merge --squash {feature-branch} && \
git -C ~/gas-repos/project-{scriptId} commit -m "feat: {description}" && \
git -C ~/gas-repos/project-{scriptId} push origin main
```

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

#### Poly-Repo Architecture (Assembled Git Repositories)

**Purpose:** Enable a single GAS project to serve as an **assembled poly-repo** - combining multiple independent git repositories (shared libraries like auth, utils, ui) into one deployable unit.

**Architecture:**
```
GAS Project (Single scriptId)
├── .git/config                 → Root repo breadcrumb (main app)
├── common-js/require.gs
├── src/main.js
├── libs/auth/.git/config       → Auth library repo breadcrumb
│   ├── libs/auth/oauth.js
│   └── libs/auth/session.js
├── libs/utils/.git/config      → Utils library repo breadcrumb
│   ├── libs/utils/helpers.js
│   └── libs/utils/format.js
└── libs/ui/.git/config         → UI library repo breadcrumb
    ├── libs/ui/sidebar.html
    └── libs/ui/components.js
```

Each `.git/config` breadcrumb maps to an independent local git repository:
```
~/gas-repos/project-{scriptId}/
├── .git/                    → Root repo
├── libs/auth/.git/          → Auth library (separate repo)
├── libs/utils/.git/         → Utils library (separate repo)
└── libs/ui/.git/            → UI library (separate repo)
```

**Current Capabilities:**

| Capability | Tool/Mechanism | Status |
|------------|----------------|--------|
| Multiple git repos in one GAS | `.git/config` breadcrumbs | ✅ Full |
| Selective sync per repo | `rsync({operation, projectPath})` | ✅ Full |
| Write to specific repo | `write({projectPath})` | ✅ Full |
| Feature branches per repo | `git_feature({projectPath})` | ✅ Full |
| Auto-discovery of nested repos | `GitProjectManager.loadAllGitProjects()` | ✅ Full |
| File filtering per repo | `filterFilesByPath()` | ✅ Full |

**Per-Repo Workflow:**
```typescript
// Sync just the auth library
rsync({operation: 'plan', scriptId, projectPath: 'libs/auth', direction: 'pull'})

// Start feature on auth library
git_feature({operation: 'start', scriptId, featureName: 'oauth2', projectPath: 'libs/auth'})

// Write to auth library (auto-commits to its repo)
write({scriptId, path: 'oauth.js', content: '...', projectPath: 'libs/auth'})

// Finish feature on auth library
git_feature({operation: 'finish', scriptId, projectPath: 'libs/auth'})
```

**Key Infrastructure:**
- `GitProjectManager.ts` - Discovers all nested repos via `loadAllGitProjects()`
- `GitPathResolver.ts` - Resolves local git paths from breadcrumbs
- `filterFilesByPath()` - Filters GAS files to specific project path

**Known Gaps (Future Enhancement):**
- No atomic multi-repo feature branches (each repo operates independently)
- No cross-repo sync coordination (no transaction semantics)
- Missing `projectPath` on some tools (edit, aider, rm, grep, find)
- No version pinning or dependency awareness between repos

**Full Gap Analysis:** See `~/.claude/plans/quirky-stargazing-plum.md` for complete roadmap

### Project Management + Errors

**Management:** project_list (view projects) | project_create (infra setup with 3 deployments) → gas-config.json stores → all tools require explicit scriptId

**Errors:** MCPGasError → ValidationError | AuthenticationError | FileOperationError | QuotaError | ApiError → MCP-compatible transform

## Config + Tools

**Tools (50 total):**
| Category | Count | Tools |
|----------|-------|-------|
| **File (Smart)** | 14 | cat, write, ls, rm, mv, cp, file_status, grep, find, ripgrep, sed, edit, aider, cache_clear |
| **File (Raw)** | 9 | raw_cat, raw_write, raw_cp, raw_grep, raw_find, raw_ripgrep, raw_sed, raw_edit, raw_aider |
| **Analysis** | 1 | deps (dependency graphs) |
| **Execution** | 2 | exec, exec_api |
| **Deployment** | 11 | deploy, project_create, project_init, deploy_create, deploy_delete, deploy_get_details, deploy_list, deploy_update, version_create, version_get, version_list |
| **Management** | 4 | auth, project_list, reorder, process_list |
| **Logging** | 1 | log (list + get operations) |
| **Triggers** | 1 | trigger (list + create + delete operations) |
| **Git** | 3 | rsync, config, git_feature (start/commit/push/finish/rollback/list/switch) |
| **Worktree** | 1 | worktree (add/claim/release/merge/remove/list/status/sync/batch-add/cleanup) |
| **Sheets** | 1 | sheet_sql |
| **Drive** | 2 | create_script, find_drive_script |

**Config:** gas-config.json (OAuth + projects) | oauth-config.json (GCP creds) | ~/.auth/mcp-gas/tokens/ (persistent auth tokens)
**Design:** smart (unwrap) vs raw (preserve) | mcp__gas__* naming | period prefix (.gitignore.gs) | ~/gas-repos/project-[scriptId]/

### Authentication & Token Persistence

**Token Storage:** `~/.auth/mcp-gas/tokens/{email}.json` - Home directory-based for consistent persistence across server restarts

**Key Features:**
- **Auto-Persistence**: Credentials survive server restarts (no forced re-authentication)
- **Auto-Refresh**: Expired tokens automatically refreshed using refresh_token
- **Cross-Session**: Multiple MCP clients share cached tokens via filesystem
- **Security**: File permissions 0600 (owner-only read/write)
- **Cleanup**: 30-day auto-cleanup of stale sessions

**Workflow:**
- **First Use**: OAuth flow required (one-time per account) → token cached
- **Server Restart**: Credentials automatically loaded from cache → no re-auth needed
- **Token Expiry**: Automatic refresh transparent to user
- **Manual Clear**: `rm -rf ~/.auth/mcp-gas/tokens/` to force re-authentication

**Migration Note:** Tokens previously stored at `~/src/mcp_gas/.auth/tokens/` are automatically migrated to new location on first use.

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

### Security Best Practices

**Critical: Command Injection Prevention**

When executing git commands or any shell operations with user input, **ALWAYS use spawn with array arguments, NEVER use exec with template literals**:

```typescript
// ❌ VULNERABLE - Never do this:
await execAsync(`git commit -m "${userMessage}"`, { cwd });
// Attack: userMessage = 'test"; rm -rf / #' → executes arbitrary commands

// ✅ SECURE - Always do this:
import { spawn } from 'child_process';

function execGitCommand(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    git.stdout.on('data', (data) => { stdout += data.toString(); });
    git.stderr.on('data', (data) => { stderr += data.toString(); });

    git.on('close', (code) => {
      code === 0 ? resolve(stdout) : reject(new Error(stderr || `Exit code ${code}`));
    });
  });
}

// Safe usage:
await execGitCommand(['commit', '-m', userMessage], gitRoot);
```

**Why This Matters:**
- `exec` spawns a shell that interprets special characters (`"`, `;`, `$`, etc.)
- `spawn` with array args directly executes the command without shell interpretation
- Special characters in user input become literal strings, not shell commands
- 2-3x faster (no shell spawn overhead) + more secure

**When to Apply:**
- Any git command with user input (commit messages, branch names, file paths)
- Any shell command that includes user-controlled data
- Even with input sanitization (defense in depth)

**Testing:**
Always add security tests for command injection:
```typescript
it('should prevent command injection in commit message', async () => {
  const maliciousMessages = [
    'Test"; rm -rf / #',    // Quote injection
    'Test`echo pwned`',     // Backtick execution
    'Test$(echo pwned)',    // Command substitution
    'Test & echo pwned',    // Command chaining
    'Test | echo pwned',    // Pipe injection
  ];

  for (const msg of maliciousMessages) {
    await git_feature({operation: 'commit', scriptId, message: msg});
    // Should succeed with exact message, no command execution
  }
});
```

**References:**
- Pattern implemented in `src/tools/git/GitFeatureTool.ts` (lines 247-296, execGitCommand)
- Security test: `test/integration/mcp-gas-validation/git-feature-workflow.test.ts:720-765`
- Similar patterns throughout codebase (lockManager, gitInit, etc.)

### Key Patterns

**Tool Development:**
- All tools in `src/tools/` extend `BaseTool` from `src/tools/base-tool.ts`
- Tools use `mcp__gas__*` naming convention (e.g., `mcp__gas__write`, `mcp__gas__exec`)
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
- Infrastructure files: `src/require.js`, `src/__mcp_exec.js`

**Client-Side HTML Pattern:**

For HTML UIs calling GAS server functions, **ALWAYS use the Promise-based `createGasServer()` wrapper** instead of google.script.run:

```javascript
// ❌ OLD PATTERN - Don't use:
google.script.run
  .withSuccessHandler(callback)
  .withFailureHandler(errorCallback)
  .exec_api(null, module, function, params);

// ✅ NEW PATTERN - Use this:
// Available globally as window.server (auto-configured)
window.server.exec_api(null, module, function, params)
  .then(callback)
  .catch(errorCallback);

// Or create custom server instance:
const server = createGasServer({
  debug: true,              // Enable debug logging
  throwOnUnhandled: true,   // Auto-throw on unhandled errors
  checkNetwork: true,       // Network connectivity checking
  onError: (err, func, args) => console.error(`[${func}]`, err)
});
```

**Key Features:**
- **Promise API**: Modern async/await support
- **Cancellable Calls**: `.cancel()`, `.pause()`, `.resume()` for long operations
- **Polling**: `.poll(callback)` for thinking messages/progress updates
- **Network Checking**: Auto-detects offline state
- **Validation**: Checks argument serializability, payload size limits
- **Enhanced Errors**: Contextual error messages with hints
- **Memory Leak Detection**: Warns if promises never executed

**Example with exec_api:**
```javascript
// With thinking message polling
const call = window.server.exec_api(null, 'MyModule', 'longTask', params)
  .poll(
    messages => messages.forEach(m => console.log('Progress:', m)),
    { continuous: true, maxDuration: 180000 }
  )
  .then(response => {
    console.log('Result:', response.result);
    console.log('Logs:', response.logger_output);
  });

// Cancel if needed
document.getElementById('cancelBtn').onclick = () => call.cancel('User cancelled');
```

**Response Format (exec_api & invoke):**

Both `exec_api()` and `invoke()` now return structured responses with logger output capture:

```javascript
// Success response
{
  success: true,
  result: <your_function_return_value>,
  logger_output: "All Logger.log() output captured here",
  execution_type: 'exec_api' | 'invoke_module'
}

// Error response
{
  success: false,
  error: "Error.toString()",
  message: "error.message",
  stack: "error.stack",
  logger_output: "Logs captured before error"
}
```

**Migration from raw return values:**
```javascript
// ❌ OLD - exec_api returned raw value:
server.exec_api(null, 'Math', 'add', [1, 2])
  .then(result => console.log(result));  // 3

// ✅ NEW - exec_api returns structured response:
server.exec_api(null, 'Math', 'add', [1, 2])
  .then(response => {
    console.log(response.result);         // 3
    console.log(response.logger_output);  // Any Logger.log() calls
  });
```

**Note:** The MCP `exec` tool (HTTP path) is unaffected - it already used structured responses.

**Infrastructure Files:**
- `common-js/html/gas_client.html` - Main implementation (39KB)
- `__mcp_exec/gas_client.html` - Execution infrastructure version (14KB)

**Testing Strategy:**
- **Unit tests**: Fast, mocked dependencies, test individual functions
- **Integration tests**: Real GAS API calls, require authentication, slower
- **System tests**: Full MCP protocol, end-to-end validation
- Run unit tests frequently during development
- Run integration tests before major commits

## MCP Integration

**Server:** MCP protocol → AI assistants (Claude) → 49 GAS tools

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
2. Check response for `git.taskCompletionBlocked: true` - this means uncommitted changes exist
3. Verify git repo exists at `~/gas-repos/project-{scriptId}/`
4. Check server startup logs for uncommitted changes from previous sessions

### Authentication Tokens Not Persisting
**Problem**: Server requires re-authentication after every restart
**Solution**:
1. Verify token storage location: `ls -la ~/.auth/mcp-gas/tokens/`
2. Check file permissions: should be 0600 (owner-only)
3. If tokens exist but still prompting: Check server startup logs for token loading errors
4. Manual token clear if needed: `rm -rf ~/.auth/mcp-gas/tokens/`

**Note**: As of latest version, tokens persist automatically across server restarts. No re-authentication should be needed unless tokens are manually cleared or expired without refresh_token.

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
