# Cross-Tool Reference Strategy

**Purpose**: Guide LLMs to discover related tools and optimal workflows through strategic cross-referencing in tool schemas.

## Principles

### 1. **Context-Aware Suggestions**
Tools should suggest related tools when:
- A prerequisite step is needed (e.g., auth before execution)
- A better alternative exists for the use case
- A follow-up action is common (e.g., test after deploy)
- Error recovery requires another tool

### 2. **Workflow Chaining**
Suggest natural sequences:
- Before: Prerequisites (auth → project_create → write → run)
- During: Complementary actions (write + test, deploy + verify)
- After: Follow-up steps (create → list, search → edit)

### 3. **Error Recovery Paths**
When tools fail, suggest:
- Diagnostic tools (logs, status, info)
- Alternative approaches (raw_ variants, different strategies)
- Repair tools (init, sync, pull)

---

## Tool Relationship Categories

### Category 1: Core Workflows

#### **Authentication → Project → Code → Execute**

**gas_auth**
- `nextSteps`: Suggest project_create or project_list
- `whenAuthenticated`: Highlight project_create for new work

**project_create**
- `prerequisites`: Require gas_auth
- `nextSteps`: Suggest project_set, gas_write, gas_run
- `alternatives`: For container-bound, mention create_script

**gas_write**
- `prerequisites`: Mention gas_auth, project existence
- `nextSteps`: Suggest gas_run to test code
- `alternatives`: Mention raw_write for system files

**gas_run**
- `prerequisites`: Require gas_auth, project with code
- `nextSteps`: For failures, suggest logs_list or project_init
- `alternatives`: For API deployments, mention exec_api

#### **Search → Edit → Test**

**⚡ ripgrep (PREFERRED FOR ALL SEARCHES)**
- `nextSteps`: Suggest cat to read, sed to edit, write to update, gas_run to test
- `alternatives`: Use context for semantic search, find for file discovery
- **NOTE**: ripgrep is STRONGLY RECOMMENDED over grep for all searches

**grep (SIMPLE SEARCHES ONLY)**
- ⚠️ **Use ripgrep instead** - grep is for simple single-pattern searches only
- `alternatives`: Strongly recommend ripgrep for multi-pattern, smart case, context control
- `nextSteps`: Same as ripgrep (cat → sed → write → test)

**find**
- `nextSteps`: Use cat to read found files, grep/ripgrep to search content
- `alternatives`: ls for simple listing, ripgrep for content-based discovery

**cat**
- `nextSteps`: Suggest write to modify, grep to search more
- `alternatives`: Mention raw_cat for system inspection

**sed**
- `prerequisites`: Suggest grep/ripgrep to find targets first
- `nextSteps`: Suggest dryRun, then gas_run to test changes

### Category 2: Error Recovery

#### **Execution Failures**

**When gas_run fails with "__defineModule__ is not defined":**
- Suggest: `project_init({scriptId: "..."})`
- Context: "Infrastructure missing - initialize project"

**When gas_run fails with authentication errors:**
- Suggest: `gas_auth({mode: "start"})`
- Context: "Session expired - re-authenticate"

**When gas_run timeout:**
- Suggest: Increase `executionTimeout` parameter
- Context: "Long-running operation - adjust timeout"

#### **Logging Access**

**When logs_list fails for container-bound:**
- Suggest: `gas_run` with Logger.log()
- Context: "Container-bound scripts don't support historical logs - use real-time logging"

### Category 3: Alternative Approaches

#### **File Operations**

**cat → raw_cat**
- When: Need to see CommonJS wrappers
- Suggest: "Use raw_cat to inspect complete file with system code"

**write → raw_write**
- When: Creating system files (CommonJS.js, __mcp_gas_run.js)
- Suggest: "Use raw_write for exact content without automatic wrapping"

**grep → raw_grep**
- When: Searching for wrapper-related issues
- Suggest: "Use raw_grep to search complete files including system wrappers"

#### **Search Tools**

**find → ls**
- When: Need detailed file info
- Suggest: "Use ls with detailed: true for comprehensive file metadata"

**grep → ripgrep**
- When: Need advanced features (multi-pattern, context control)
- Suggest: "Use ripgrep for advanced search with multiple patterns and performance stats"

**grep → context**
- When: Natural language search needed
- Suggest: "Use context for semantic search with natural language queries"

### Category 4: Deployment Workflows

#### **Code → Version → Deploy**

**gas_write (modified code)**
- `nextSteps`:
  - Suggest: gas_run to test
  - Then: version_create to snapshot
  - Then: deploy_create to deploy

**version_create**
- `prerequisites`: Code changes complete and tested
- `nextSteps`: Suggest deploy_create with versionNumber

**deploy_create**
- `prerequisites`: Suggest version_create first (best practice)
- `nextSteps`: Suggest deploy_list to verify, gas_run to test

**deploy_list**
- `nextSteps`:
  - If issues found: Suggest deploy_update or deploy_delete
  - If testing needed: Suggest gas_run with deployed URL

### Category 5: Debugging Workflows

#### **Process Inspection**

**process_list / process_list_script**
- `nextSteps`:
  - For FAILED status: Suggest logs_get for details
  - For COMPLETED: Suggest project_metrics for trends

**logs_list**
- `nextSteps`: Suggest logs_get with specific processId
- `limitations`: For container-bound failures, suggest gas_run

**logs_get**
- `prerequisites`: Get processId from logs_list first
- `alternatives`: For container-bound, use gas_run

### Category 6: Project Management

#### **Discovery → Configuration → Sync**

**project_list**
- `nextSteps`: Suggest project_set to activate, project_get for details

**project_set**
- `prerequisites`: Project must exist (create or add first)
- `nextSteps`: Suggest pull to sync files, gas_write to add code

**pull / push / status**
- `relatedTools`: Always mention the trio together
- `whenToUse`: status before pull/push, push after write, pull after remote changes

### Category 7: Analysis & Introspection

#### **Understanding Codebase**

**context (semantic search)**
- `nextSteps`: Suggest cat to read files, deps for relationships
- `alternatives`: For exact patterns, use ripgrep

**deps (dependencies)**
- `nextSteps`: Suggest tree for structure, context for usage
- `relatedTools`: Mention summary for overview

**tree (structure)**
- `nextSteps`: Suggest deps for relationships, find for specific files
- `relatedTools`: Mention summary for file-level details

**summary (overview)**
- `nextSteps`: Suggest context for deep dive, cat to read files
- `relatedTools`: Mention tree for structure, deps for relationships

---

## Implementation Strategy

### 1. Add to Existing llmGuidance/llmWorkflowGuide

For each tool, add relevant sections:

```typescript
llmGuidance: {
  whenToUse: '...',

  // NEW: Suggest prerequisites
  prerequisites: [
    'gas_auth - Authenticate first',
    'project_create - Ensure project exists'
  ],

  // NEW: Suggest next steps
  nextSteps: [
    'gas_run - Test your code changes',
    'version_create - Snapshot before deploying'
  ],

  // NEW: Suggest alternatives
  alternatives: {
    forSystemFiles: 'Use raw_write for exact content',
    forContainerBound: 'Use create_script instead of project_create'
  },

  // NEW: Suggest error recovery
  errorRecovery: {
    '__defineModule__ not defined': 'Run project_init to install infrastructure',
    'Authentication failed': 'Run gas_auth({mode: "start"}) to re-authenticate'
  }
}
```

### 2. Priority Order for Implementation

**Phase 1: Core Workflows (High Impact)**
1. auth → project_create → gas_write → gas_run
2. grep/ripgrep → cat → write
3. version_create → deploy_create → deploy_list

**Phase 2: Error Recovery (High Value)**
1. gas_run failures → project_init, gas_auth
2. logs_list failures → gas_run alternative
3. Deployment issues → version/deploy tools

**Phase 3: Advanced Features (Enhancement)**
1. Search alternatives (grep → ripgrep → context)
2. Analysis tools (tree, deps, summary, context)
3. Git workflow (git_init → git_sync → git_status)

### 3. Specific Tool Updates Needed

#### High Priority

**gas_run** (most used):
```typescript
errorRecovery: {
  '__defineModule__ not defined': 'Infrastructure missing - run project_init({scriptId})',
  'Execution timed out': 'Increase executionTimeout parameter for long operations',
  'Authentication required': 'Session expired - run gas_auth({mode: "start"})'
}
```

**logs_list** (fails for container-bound):
```typescript
limitations: {
  containerBoundScript: '❌ Cannot retrieve historical logs - use gas_run which captures Logger.log() in real-time'
},
alternatives: {
  containerBoundLogging: 'Use gas_run({scriptId, js_statement: "Logger.log(\'...\'); yourCode()"}) - returns logger_output field'
}
```

**project_create** (entry point):
```typescript
nextSteps: [
  'project_set - Set as current project',
  'gas_write - Add code files',
  'gas_run - Execute and test code'
],
alternatives: {
  containerBound: 'Cannot create container-bound via API - use create_script or Apps Script UI'
}
```

**grep**:
```typescript
nextSteps: [
  'cat - Read matched files',
  'sed - Apply find/replace',
  'write - Update files after manual edits'
],
alternatives: {
  advancedSearch: 'Use ripgrep for multi-pattern search with context control',
  semanticSearch: 'Use context for natural language queries'
}
```

---

## Benefits of Cross-Referencing

### For LLMs
- Discover related tools without exhaustive search
- Understand workflow sequences naturally
- Recover from errors with clear guidance
- Choose optimal tools for each situation

### For Users
- Faster problem resolution
- Better tool discovery
- Clearer workflow patterns
- Reduced trial-and-error

### For Development
- Self-documenting system
- Natural workflow emergence
- Error handling built-in
- Discoverability without separate docs

---

## Maintenance Guidelines

### When Adding New Tools
1. Identify prerequisites (what must run first)
2. Identify next steps (what commonly follows)
3. Identify alternatives (when to use different tools)
4. Identify error recovery (how to fix common failures)

### When Updating Existing Tools
1. Check for new relationships with recent tools
2. Update error recovery for new failure modes
3. Refine workflow suggestions based on usage patterns

### Testing Cross-References
1. Verify all mentioned tools exist
2. Ensure suggested sequences make sense
3. Test error recovery paths work
4. Validate alternative recommendations are accurate

---

## Examples of Excellent Cross-Referencing

### Example 1: gas_run (Complete Context)
```typescript
llmWorkflowGuide: {
  whenToUse: 'Execute JavaScript in Google Apps Script projects',

  prerequisites: [
    'gas_auth({mode: "status"}) - Check authentication',
    'project_create or project_list - Ensure project exists'
  ],

  nextSteps: [
    'SUCCESS: version_create - Snapshot tested code',
    'FAILURE: Check logger_output for errors',
    'FAILURE: Run project_init if "__defineModule__ not defined"'
  ],

  alternatives: {
    apiDeployment: 'exec_api - For deployed API executables',
    manualExecution: 'Apps Script editor - For interactive debugging'
  },

  errorRecovery: {
    '__defineModule__ not defined': {
      action: 'project_init({scriptId})',
      reason: 'CommonJS infrastructure missing'
    },
    'Authentication required': {
      action: 'gas_auth({mode: "start"})',
      reason: 'Session expired or not authenticated'
    },
    'Execution timeout': {
      action: 'Increase executionTimeout parameter',
      reason: 'Default 13 minutes insufficient for long operations'
    }
  }
}
```

### Example 2: logs_list (Clear Alternative for Limitation)
```typescript
llmWorkflowGuide: {
  limitations: {
    containerBound: '❌ Cloud Logging API requires standard GCP project - container-bound scripts use Drive ID and fail'
  },

  alternatives: {
    containerBoundLogging: {
      tool: 'gas_run',
      usage: 'gas_run({scriptId, js_statement: "Logger.log(\'debug\'); code()"})',
      benefit: 'Automatically captures all Logger.log() output in logger_output field',
      why: 'Real-time logging works for all script types'
    }
  }
}
```

### Example 3: grep → sed → write (Workflow Chain)
```typescript
// In grep
llmGuidance: {
  nextSteps: [
    'cat - Read full context of matched files',
    'sed - Apply find/replace to matched patterns',
    'write - Manually update files after inspection'
  ]
}

// In sed
llmGuidance: {
  prerequisites: [
    'grep or ripgrep - Find patterns to replace first'
  ],

  nextSteps: [
    'dryRun: true - Preview changes before applying',
    'After changes: gas_run - Test modified code'
  ]
}
```

---

## Conclusion

Strategic cross-tool referencing creates a self-documenting, discoverable system where:
- LLMs learn optimal workflows naturally
- Users get guided toward best practices
- Error recovery is immediate and contextual
- Tool capabilities are maximized through proper chaining

The investment in comprehensive cross-references pays dividends in:
- Reduced support burden
- Faster user onboarding
- Better tool utilization
- More robust error handling
