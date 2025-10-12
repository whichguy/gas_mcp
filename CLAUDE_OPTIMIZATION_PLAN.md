# CLAUDE.md Optimization Plan

## Goal
Reduce from 224 lines → ~150 lines (33% reduction) while improving clarity and accuracy

## Strategy: Progressive Disclosure Pattern
Use layered information architecture: Core → Details → Deep Dive

### Phase 1: Update Outdated Information (High Priority)

**Issues:**
1. Line 55: "~50 tools" → should be "40 tools"
2. Lines 67-71: Tool consolidation outdated (mentions 7 tools, but we removed 26 total)
3. Missing: Analysis tool removal (context/summary/tree)

**Fix:**
```markdown
**MCP server:** AI ↔ GAS → 40 tools for create/manage/execute GAS projects

**Tool Consolidation** (Jan 2025 - 39% reduction):
- 66 → 40 tools via strategic consolidation
- Removed: context/summary/tree (LLMs read files directly)
- Removed: bind_script, project_*, run, pull/push/status (redundant)
- Unified: deploy (promote/rollback/status/reset), log (list/get), trigger (list/create/delete)
```

### Phase 2: Compress Verbose Sections (Medium Priority)

**Section: Architecture Overview (Lines 53-71)**
Current: 19 lines | Target: 12 lines (37% reduction)

**Before:**
```markdown
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
```

**After (Compressed):**
```markdown
**Flow:** Client ↔ stdio ↔ mcpServer → tools → gasClient → GAS API

**Layers:** Protocol (stdio + dispatch) → Tools (validate + auth + execute) → Auth (OAuth PKCE + refresh) → API (rate limit + retry)

**Consolidation (39% reduction, 66→40 tools):**
- Analysis: Removed context/summary/tree (LLMs read files directly)
- Deployment: Unified deploy tool (promote/rollback/status/reset)
- Sync: Removed pull/push/status (cat/write handle it)
- Management: Removed bind_script, project_*, run (redundant)
```

### Phase 3: Eliminate Redundancy (High Priority)

**Duplicate Information:**

1. **Tools listed 3 times** (Lines 174-180):
   - "Smart Tools" section
   - "Raw Tools" section
   - "Git Tools" / "Project Tools" sections

   **Solution:** Consolidate into single table

2. **Config mentioned twice** (Lines 172-173, 209):
   **Solution:** Single location

**Before (3 separate lists, 9 lines):**
```markdown
**Smart Tools** (auto CommonJS): cat/write/cp (wrap/unwrap) + ls/rm/mv/mkdir (paths) + file_status (SHA checksums) + exec/info/reorder (exec/mgmt) + grep/find/ripgrep/sed (search) + deploy (unified deployment)

**Raw Tools** (exact content): raw_cat/raw_write/raw_cp (preserve wrappers) + raw_ls/raw_rm/raw_mv + raw_find/raw_grep/raw_ripgrep/raw_sed

**Git Tools:** local_sync + config (sync_folder management) — Breadcrumb files: .git/config.gs + .git/refs/heads/main + .git/refs/remotes/origin/main

**Project Tools:** project_list/project_create/project_init + auth (OAuth)
```

**After (Single table, 6 lines):**
```markdown
**Tools (40 total):**
- **File**: cat/write/ls/rm/mv/cp + raw_* variants (14+9=23 tools)
- **Search**: grep/find/ripgrep/sed + raw_* variants (4+4=8 tools)
- **Analysis**: deps (dependency graphs only, 1 tool)
- **Exec**: exec/exec_api (2 tools)
- **Deploy**: deploy/project_create/project_init (3 tools)
- **Other**: auth, project_list, local_sync, config, trigger, log (6 tools)
```

### Phase 4: Use References for Deep Content (Low Priority)

**Move to separate docs:**
- Line 192-193: Test organization → Already in TEST-SUITE-ORGANIZATION.md
- Lines 112-118: Metadata caching → Already in METADATA_CACHING.md
- Lines 147-162: Git sync workflow → Already in GIT_SYNC_WORKFLOWS.md

**Replace with:**
```markdown
#### 5. Metadata Caching
**Fast Path:** 85-95% faster (5-50ms vs 800-1200ms) via extended attributes
**See:** docs/METADATA_CACHING.md

#### Git Sync
**Pattern:** LOCAL-FIRST (pull→merge→push), requires .git/config.gs breadcrumb
**See:** docs/GIT_SYNC_WORKFLOWS.md
```

### Phase 5: Restructure for Scanability

**Apply Information Hierarchy:**

```markdown
# CLAUDE.md

## Quick Start (Commands)
- Build & Run
- Testing
- Code Quality

## Architecture (High-Level)
- Server flow (1 line)
- Layers (1 line each)
- Tools (table)
- Consolidation summary

## Core Capabilities (6 numbered sections)
Each: 1-line purpose + 2-3 key facts + reference to detailed docs

## Development (How to extend)
- New tool pattern
- TypeScript guidelines
- Testing approach
- (References to detailed guides)

## Integration (MCP setup)
- Config snippet
- Key capabilities list
```

## Optimization Metrics

| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| Total Lines | 224 | ~150 | 33% |
| Architecture | 19 lines | 12 lines | 37% |
| Tools Section | 9 lines | 6 lines | 33% |
| Redundancy | 3 tool lists | 1 table | 67% |
| Accuracy | ~50 tools | 40 tools | ✓ |

## Implementation Priority

1. **MUST DO** (Correctness):
   - [ ] Update tool count (50 → 40)
   - [ ] Update consolidation details
   - [ ] Add analysis tool removal

2. **SHOULD DO** (Efficiency):
   - [ ] Compress verbose sections
   - [ ] Eliminate duplicate tool lists
   - [ ] Use progressive disclosure

3. **NICE TO HAVE** (Polish):
   - [ ] Restructure for scanability
   - [ ] Add visual hierarchy

## Result
- **33% smaller** (easier to read)
- **100% accurate** (reflects current state)
- **Better organized** (progressive disclosure)
- **Faster to scan** (tables + hierarchy)
