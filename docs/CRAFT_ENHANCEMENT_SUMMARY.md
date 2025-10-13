# craft.md Enhancement Summary

## Work Completed

### 1. Enhanced GUIDE.md Section ✅
**What Changed:** Transformed from a basic navigation guide into a knowledge companion
**New Content:**
- "The Story So Far" narrative section that grows as layers progress
- Knowledge Checkpoints capturing not just WHAT but WHY
- Decision History & Rationale section
- "How to Progress Through This Journey" philosophy
- Testing Philosophy: Specifications of Understanding
- Quality Means Understanding section
- Implementation Philosophy: Build Until It's Right
- "If You Feel Lost" recovery guide with step-by-step instructions
- Progressive Layer Dependencies with cascade explanation

**Style:** Natural language, reflective, knowledge-building approach

### 2. Enhanced Movement I Introduction ✅
**What Changed:** Added context grounding and storytelling
**New Content:**
- 📖 Context reminder to review GUIDE.md for philosophy
- "What Movement I Is Really About" section
- "The Six Layers Ahead" overview
- "Your Mindset for This Movement" guidance

**Style:** Conversational, explains WHY behind each phase

### 3. Enhanced Layer 1 ✅
**What Changed:** Storytelling approach instead of procedural steps
**New Content:**
- 📖 Context reminder referencing GUIDE.md
- "Where We Are in the Journey" section
- "What This Layer Reveals" section
- "How This Connects" section
- "Your Exploration Approach" with thinking patterns
- Enhanced documentation guidance with reasoning

**Style:** Natural language guidance, teaches how to think

## Work Remaining

### 4. Enhance Layers 2-6 ✅ COMPLETED
**What Was Done:**
- ✅ Added 📖 Context reminders to each layer
- ✅ Added "Where We Are in the Journey" sections to all layers
- ✅ Added "What This Layer Reveals" sections to all layers
- ✅ Added "How This Connects" sections to all layers
- ✅ Transformed exploration sections to natural language guidance for all layers
- ✅ Kept existing quality gates and feedback loops intact

**Layers Enhanced:**
- ✅ Layer 2: Non-Functional Requirements (lines 445-557)
- ✅ Layer 3: Architectural Research & Context (lines 561-682)
- ✅ Layer 4: Assumptions & Risk Assessment (lines 686-800)
- ✅ Layer 5: Second-Order Effects & Anti-Cases (lines 804-925)
- ✅ Layer 6: Complete Synthesis & Final Confirmation (lines 929+)

**Pattern to Follow:**
```markdown
### Layer X: [Name]

📖 Context Reminder: [Natural language grounding]

**Progress:** X of 6 - [Phase name]

**Where We Are in the Journey:**
[Narrative of current position and what we're building on]

**What This Layer Reveals:**
[Deeper purpose beyond surface task]

**How This Connects:**
[Dependencies and impacts]

**Your Exploration Approach:**
[Natural language thinking guidance]

[Rest of existing content...]
```

### 5. Add GUIDE.md Update Steps ✅ COMPLETED
**What Was Done:**
At the end of each layer confirmation (Layers 1-6), added steps to update GUIDE.md:

```markdown
IF the user confirms:
  → Document confirmation to the layer file
  → **Update GUIDE.md** with layer insights:
     * Add core insight to "The Story So Far" → "What We've Learned"
     * Update "Knowledge Checkpoints" for this layer with:
       - Confirmation timestamp
       - Core insight discovered
       - What surprised us
       - User's clarifications
       - How it shaped understanding
     * Add key decisions to "Decision History & Rationale"
     * Update "Current State of Understanding" → "Latest Confirmed Knowledge"
  → Add "Layer X" to layers_confirmed
  → Announce: "✓ Layer X confirmed. Moving to Layer Y..."
  → Move to next layer
```

**Locations Added:**
- ✅ Layer 1 confirmation (lines 419-432)
- ✅ Layer 2 confirmation (lines 548-556)
- ✅ Layer 3 confirmation (lines 680-688)
- ✅ Layer 4 confirmation (lines 805-813)
- ✅ Layer 5 confirmation (lines 940-948)
- ✅ Layer 6 confirmation (lines 1083-1091)

### 6. Add Movement II-B: Test-Driven Development Flow ✅ COMPLETED
**What Was Done:**
Added a new section after Movement II (Criteria Definition) and before Movement III (lines 1237-1347):

```markdown
## Movement II-B: Understanding Through Test Design

📖 Context Reminder: Before writing code, we clarify understanding through test design.
Review GUIDE.md section "Testing Philosophy: Specifications of Understanding"

**Where We Are in the Journey:**
We've defined WHAT to build (Movement I) and HOW to measure success (Movement II).
Now we design tests that express our understanding as specifications before writing
any implementation code.

**What This Phase Reveals:**
Tests aren't afterthoughts - they're specifications. By designing tests first, we
discover ambiguities in requirements, edge cases we haven't considered, and gaps
in our understanding. This saves massive rework later.

**Your Approach:**

Think through each requirement from Movement II criteria. For each one, ask:
"How would I know this works?" Then express that knowledge as a test case.

**Design Test Scenarios:**

Start with happy path tests - the canonical examples of success:
- What's the typical input?
- What's the expected behavior?
- What's the expected output?

Then edge cases - boundary conditions that reveal understanding:
- Empty inputs, null values, extreme values
- Boundary transitions (0, 1, max, max+1)
- Format variations, encoding issues

Finally error paths - what should NOT happen:
- Invalid inputs should be rejected with clear messages
- Error conditions should be handled gracefully
- Security violations should be prevented

**Document Test Plan:**

Write to `<worktree>/planning/test-plan.md`:
- Test categories (Unit, Integration, Edge Case, Error Path)
- For each test: name, setup, input, expected output, assertions

Use natural language first, not code:
"When user provides negative number, function should throw TypeError with message 'Must be positive'"

**Present Test Plan to User:**

[Present test design conversationally, get confirmation]

**Then Implement Tests:**

Once test design is confirmed, write actual Mocha/Chai tests in `<worktree>/test/`.
These become your specification - implementation will make them pass.

Update GUIDE.md with test plan completion in "Current State of Understanding"
```

**Where Added:** Between Movement II and Movement III (lines 1237-1347)

**Content Added:**
- Context reminder referencing GUIDE.md "Testing Philosophy"
- "Where We Are in the Journey" section
- "What This Phase Reveals" section
- "Your Approach" guidance
- Three test scenario categories: happy path, edge cases, error paths
- Test plan documentation instructions
- User confirmation gate
- Test implementation guidance with Mocha/Chai structure
- GUIDE.md update steps upon completion
- Verification that tests fail initially (TDD pattern)

### 7. Restructure Implementation Loop with Reflective Practice ✅ COMPLETED
**What Was Done:**
Transformed Movement III Step 4 (Verify Quality) into autonomous iteration loop with reflective practice:

**Movement III Step 4 Refactoring (lines 2510-2589+):**
- Added reflective philosophy introduction emphasizing learning over box-checking
- Added **⚠️ AUTONOMOUS ITERATION** reminder referencing GUIDE.md
- **Build Verification Loop**: Autonomous iteration until build succeeds
- **Test Iteration Loop**: Autonomous iteration with reflective analysis questions
  * What do failures teach about implementation or understanding?
  * Fix root causes, not symptoms
  * Commit each fix with learning message
- **Code Review Iteration Loop**: Autonomous iteration addressing blocking issues
  * Review patterns/principles missed
  * Refactor to improve design, not just patch
  * Re-run reviewer until issues resolved
- **Criteria Verification**: Calculate quality score, iterate if below threshold
- **Integration Verification**: Test all integration points from Layer 3
- Only proceeds when all quality gates met (tests pass, no blocking issues, criteria met, integrations work)

**Impact:**
- Transforms quality verification from checklist to learning opportunity
- Autonomous iteration reduces user interruptions
- Reflective questions guide better debugging and refactoring
- Emphasizes understanding over mechanical fixes
- Git commits capture learnings for future reference
- Aligns with autonomous iteration directive from Section 10

### 8. Add GUIDE.md Update at Movement Transitions ✅ COMPLETED
**What Was Done:**
At the end of each Movement transition, added GUIDE.md update steps:

**Movement I → II Transition:**
```markdown
**Update GUIDE.md:**
- Mark Movement I complete in "Current State of Understanding"
- Update "The Story So Far" with synthesis insight
- Add final Layer 6 insight to knowledge checkpoints
```

**Movement II → III Transition:**
```markdown
**Update GUIDE.md:**
- Mark Movement II complete with criteria defined
- Add test plan reference
- Update "Current State" to show entering implementation phase
```

**Movement III → IV Transition:**
```markdown
**Update GUIDE.md:**
- Mark Movement III complete with implementation done
- Update with final quality scores and iteration count
- Note any key learnings from implementation
```

**Locations Added:**
- ✅ Movement I → II transition (after Layer 6 synthesis, lines 1091-1096)
- ✅ Movement II → III transition (after planning phase, lines 1684-1689)
- ✅ Movement III → IV transition (when crafting loop exits, lines 2033-2038)

### 9. Enhance Layer 3 with Technology Research Directives ✅ COMPLETED
**What Was Done:**
Added comprehensive technology research guidance to Layer 3 (Architectural Research & Context):

**New Content Added (lines 620-676):**
- **Research technology choices deeply** section with 4-step process:
  1. Identify key questions that must be answered
  2. Research available options
  3. Make reasonable assumptions when answers aren't clear (with confidence levels)
  4. Compare trade-offs
- **Discover useful MCP servers and APIs** section with 3-step process:
  1. Search for relevant MCP servers
  2. Evaluate MCP server capabilities
  3. Document discovered MCP servers
- Examples of useful MCP servers (filesystem, postgres, playwright, domain APIs)
- Directive to document MCP servers in architecture file for planning reference

**Documentation Section Updated (lines 698-699):**
- Added **Technology decisions** to documentation checklist
- Added **MCP servers discovered** to documentation checklist

**Presentation Section Updated (lines 714-721, 736):**
- Added **Technology Choices** section to Layer 3 presentation
- Added **MCP Servers Discovered** section to Layer 3 presentation
- Updated Quality Gate Question to include technology choices feedback

**Filesystem Access Pattern Guidance Added (lines 663-690):**
- **Consider filesystem access patterns carefully** section
- Evaluates three approaches:
  1. Direct filesystem API (Node.js fs) - fastest, most control, least portable
  2. MCP server API - abstraction, testability, AI-assisted
  3. Hybrid approach - use right tool for right job
- Each approach includes:
  * Pros and cons
  * Best use cases
  * Trade-off considerations
- Directive to document choice with rationale
- Updated MCP server documentation checklist to include filesystem access pattern

**Impact:**
- Ensures comprehensive technology research with explicit decision-making
- Makes assumptions explicit with confidence levels (HIGH/MEDIUM/LOW)
- Prompts user for clarification when confidence is LOW
- Discovers automation/testing tools (MCP servers) that could accelerate implementation
- Documents technology rationale for future developers
- Provides clear guidance on filesystem access patterns and trade-offs

### 10. Add Autonomous Iteration Directive ✅ COMPLETED
**What Was Done:**
Added guidance for autonomous iteration during implementation phase to reduce unnecessary user prompts:

**GUIDE.md Enhancement (lines 234-247):**
Added **"Autonomous Iteration During Implementation"** section to Implementation Philosophy:
- Continue iterating autonomously to resolve issues during Movement III
- Fix failing tests without prompting user
- Address code review feedback iteratively
- Refactor to meet quality criteria
- Debug and resolve implementation issues

**When to Prompt User:**
- Catastrophic failure (fundamental approach broken)
- Critical architectural decision needed (changes Layer 3 assumptions)
- Clarification required on requirements (ambiguity in Layers 1-2)
- Maximum iterations reached without meeting criteria

**Movement III Step 4 Reinforcement (lines 2179-2180):**
Added **"⚠️ AUTONOMOUS ITERATION"** reminder at start of quality verification:
- Work through all quality issues without prompting
- References GUIDE.md section for full details
- Emphasizes trust in LLM to handle normal implementation challenges

**Impact:**
- Reduces interruptions during implementation flow
- Clarifies when user intervention is actually needed
- Empowers LLM to iterate autonomously on quality issues
- Maintains user oversight for critical decisions
- Improves development velocity

### 11. Enhance Movement II-B Test Planning with Comprehensive Test Guidance ✅ COMPLETED
**What Was Done:**
Added comprehensive test planning guidance to Movement II-B (Understanding Through Test Design):

**Expanded Happy Path Tests Section (lines 1368-1412):**
- Added detailed guidance on "the expected journey" from user scenarios
- Expanded "typical input" to include realistic data patterns, representative volumes, common value ranges
- Expanded "expected behavior" to include core workflow, transformations, mocked external interactions
- Expanded "expected output" to include data structure/format, transformed values, status indicators
- Added complete working example with realistic invoice processing test showing Arrange-Act-Assert pattern

**Expanded Corner Cases Section (lines 1414-1462):**
- **Empty and minimal inputs**: Empty strings/arrays/objects, single-item collections, minimal valid input
- **Boundary transitions**: Zero variations, off-by-one boundaries, min/max values, string length boundaries
- **Format variations**: Date formats, case variations, whitespace, Unicode/internationalization, encoding edge cases
- **State-based scenarios**: First-time vs. subsequent execution, empty vs. populated systems, different system states
- Added three complete working example tests demonstrating corner case patterns

**Expanded Error Paths Section (lines 1464-1512):**
- **Invalid inputs to reject**: Wrong data types, malformed data, out-of-range values, missing required fields, invalid formats
- **Error conditions to handle gracefully**: External service unavailable, database failures, authentication issues, rate limiting, partial failures
- **Security violations to prevent**: SQL injection, XSS attempts, path traversal, oversized inputs (DoS), unauthorized access
- Added three complete working example tests demonstrating security and error handling

**New Test Setup and Test Data Section (lines 1514-1606):**
- **Test Setup Strategy**:
  - Test fixtures and mock data with reusable objects and factory functions
  - Before/after hooks with detailed guidance on when to use each (before, beforeEach, afterEach, after)
  - Mocking external dependencies (APIs, databases, file system, date/time, random)
  - Complete working example with database and email service mocking pattern
- **Test Data Creation Guidance**:
  - Realistic data patterns that mirror production
  - Data factories for flexibility with complete working example showing factory pattern and usage
  - Deterministic test data principles (avoid randomness, mock clocks, sequential IDs)

**Total Addition**: ~250 lines of comprehensive test planning guidance with working examples

**Impact:**
- Transforms test planning from brief bullet points into actionable, detailed guidance
- Provides concrete working examples developers can adapt for their specific use cases
- Covers the full spectrum: happy path → corner cases → error paths → test setup → test data
- Emphasizes security testing (SQL injection, XSS, path traversal, DoS, unauthorized access)
- Teaches test organization patterns (fixtures, factories, mocks, hooks)
- Promotes deterministic, maintainable test suites
- Aligns with TDD philosophy from GUIDE.md "Testing Philosophy" section

### 12. Add Task-Based Development Workflow to Movement II-C ✅ COMPLETED
**What Was Done:**
Added comprehensive task-based development workflow to Movement II-C (Implementation Planning & Infrastructure Setup):

**Project Structure Enhancement (lines 1759-1771):**
- Added `tasks-pending/` and `tasks-completed/` directories to project structure
- Added `learnings.md` file to capture cumulative lessons learned during implementation
- Documented purpose: end-to-end feature tasks with quality verification, testing, and fix loops
- Documented learnings.md purpose: creates feedback loop that improves subsequent tasks

**New Step 1b: Establish Task-Based Development Workflow (lines 1770-1960):**
- **Task-Based Development Philosophy**: Break features into discrete end-to-end tasks representing complete vertical slices of functionality
- **What is a Task**: Comprehensive definition covering UI/API/schema/service/data access/quality/testing/fix loops
- **Creating Task Files**: Detailed task template (task-NNN-[feature-name].md) with:
  * Feature description (from Layer 1)
  * Implementation scope breakdown (UI/API/schema/service/data access)
  * Quality gates checklist (code review, criteria score, integration, security)
  * Test requirements (unit/integration/edge cases/error paths from test-plan.md)
  * Dependencies (prerequisites, blocks)
  * Infrastructure references (from infrastructure-identifiers.md)
  * Architecture references (from layer-3-architecture.md)
  * Acceptance criteria checklist
  * Completion notes section (iterations, learnings, issues, quality score)

**Task Execution Loop (lines 1870-1920):**
- SELECT next task from tasks-pending/ (respect dependencies)
- ANNOUNCE task start
- IMPLEMENT task components (write code, write tests, commit incrementally)
- QUALITY VERIFICATION LOOP (run tests, analyze failures, code review, refactor, commit fixes)
- FINAL VALIDATION (verify checkboxes, confirm acceptance criteria, integration test)
- COMPLETE task (fill completion notes, move to tasks-completed/, update log, commit)
- ANNOUNCE task completion with metrics
- Continue to next task

**Task Prioritization (lines 1922-1928):**
- Dependencies first (no pending prerequisites)
- Foundation before features (utilities before features that use them)
- High-risk first (complex/uncertain tasks tackled early)
- User value (visible user value prioritized)

**Autonomous Iteration Within Tasks (lines 1930-1942):**
- Fix failing tests without prompting
- Address code review feedback iteratively
- Refactor to meet quality criteria
- Debug implementation issues
- Only prompt user for: catastrophic failures, critical architectural decisions, requirement clarifications, max iterations reached

**Benefits of Task-Based Approach (lines 1944-1951):**
- Clear progress tracking
- Parallel potential (future enhancement)
- Isolated quality verification
- Manageable scope
- Flexible ordering
- Complete features

**Integration with Implementation Steps (lines 1953-1960):**
- Phase 1 (Foundation) → Core models and utilities tasks
- Phase 2 (Service Integration) → Auth and external client tasks
- Phase 3 (Business Logic) → Use case tasks from Layer 1
- Phase 4 (Quality) → Cross-task quality improvement tasks
- Phase 5 (Finalization) → Documentation and polish tasks

**Total Addition**: ~190 lines of comprehensive task-based workflow guidance

**Impact:**
- Transforms implementation from monolithic approach to discrete, manageable tasks
- Each task is a complete vertical slice: UI → API → schema → service → DB → quality → testing
- Built-in quality verification loop within each task (iterate until tests pass and quality met)
- Clear progress tracking via tasks-pending/ → tasks-completed/ movement
- Autonomous iteration guidance reduces user interruptions
- Integration with existing planning artifacts (infrastructure-identifiers.md, layer-3-architecture.md, test-plan.md, quality-criteria.md)
- Aligns with TDD philosophy and autonomous iteration directives from earlier enhancements

### 13. Add Learnings Integration and Per-Task Planning Directive ✅ COMPLETED
**What Was Done:**
Enhanced task-based development workflow with continuous learning loop and per-task planning:

**Task Template Enhancement (lines 1854-1865):**
- Added **"Learnings References"** section to task template:
  * Reference relevant lessons from previous tasks
  * Note patterns that worked well
  * Identify pitfalls to avoid
- Added **"Implementation Plan (Pre-Implementation)"** section to task template:
  * Document approach hypothesis
  * Explain how it builds on previous learnings
  * Identify task-specific risks
  * Highlight integration points needing attention

**Task Execution Loop Enhancement (lines 1881-1978):**
- **Step 3: PLAN this specific task implementation** (NEW):
  * Read `<worktree>/planning/learnings.md` if exists
  * Consider lessons from previous tasks (patterns, pitfalls, architectural insights, testing strategies)
  * Review task requirements and dependencies
  * Form implementation hypothesis
  * Document task-specific plan in task file under "Implementation Plan (Pre-Implementation)"

- **Step 8: CAPTURE learnings** (NEW):
  * Review what was learned during task implementation
  * Check if `layer-3-architecture.md` needs updates:
    - New architectural patterns discovered?
    - Integration approaches that worked well?
    - Technology choices to document?
  * Check if new lessons emerged:
    - Insights not apparent when started?
    - Patterns helpful for future tasks?
    - Pitfalls to avoid?
    - Testing strategies that proved valuable?
  * Append to `<worktree>/planning/learnings.md` with structured format:
    ```markdown
    ## [Date] - Task [N]: [Feature Name]
    ### What We Learned
    ### Impact on Future Work
    ### Architectural Insights
    ```
  * Commit learnings with descriptive message

- **Step 9: ANNOUNCE task completion** (ENHANCED):
  * Now includes notification when learnings captured: "📝 Key learnings documented for future tasks"

- **When tasks-pending/ is empty** (ENHANCED):
  * Added: "Review cumulative learnings in learnings.md" before proceeding to final quality pass

**Folder Structure Enhancement (lines 1775-1790):**
- Added creation of `learnings.md` file: `touch "<worktree>/planning/learnings.md"`
- Added initialization content for learnings.md explaining its purpose

**Total Addition**: ~70 lines of learning loop integration guidance

**Impact:**
- Creates continuous learning feedback loop across tasks
- Each task benefits from lessons learned in previous tasks
- Prevents repeating mistakes discovered during earlier implementation
- Captures architectural insights that emerge during implementation
- Task-specific planning considers cumulative project learnings
- Documents patterns that work well for future reference
- Keeps architecture.md synchronized with implementation discoveries
- Reinforces iterative knowledge-building philosophy from GUIDE.md
- Complements autonomous iteration by providing context for decision-making
- Improves development velocity as project progresses (learn → apply → improve)

### 14. Add Poly Repo Layout Consideration to Planning Phase ✅ COMPLETED
**What Was Done:**
Enhanced Movement II-C Step 1 (Define Project Structure) with poly repo organization guidance:

**Step 1 Enhancement (lines 1722-1757):**
- **Consider the existing structure first** section (lines 1722-1726):
  * Check if repository structure already exists
  * Note established conventions to follow
  * Identify existing code/projects to integrate
  * Determine if starting fresh or working within existing codebase

- **Consider repository organization strategy** section (lines 1728-1757):
  * **Poly Repo Approach**: Emphasizes multiple related repositories (focused and independent) rather than monorepo
  * **Poly Repo Benefits**: Independent deployments, clearer ownership, simpler CI/CD, smaller codebases, different tech stacks
  * **When to create separate repositories**: Independently deployable services, different release schedules, different teams, reusable libraries, frontend/backend separation
  * **Within this specific repository (worktree)**: Source code location, module organization, test placement, configuration files, documentation structure
  * **Cross-repository considerations**: How repositories relate, shared libraries/dependencies, service communication patterns, documentation distribution

**project-structure.md Template Enhancement (lines 1764-1806):**
- Added **"Existing Structure Assessment"** section:
  * Describe existing repository structure
  * Note established conventions
  * Identify existing code to integrate
  * Document starting fresh vs. existing codebase

- Added **"Repository Organization (Poly Repo Context)"** section:
  * This repository's role in poly repo architecture
  * Related repositories and relationships
  * Shared dependencies across repositories
  * Inter-repository communication patterns

- Enhanced **"Module Organization"** section:
  * Added note for modules/patterns inherited from existing structure

- Added **"Cross-Repository Integration Points"** section:
  * API endpoints consumed from other repos
  * API endpoints exposed to other repos
  * Shared data models or contracts
  * Events published/subscribed across repos

**Total Addition**: ~50 lines of poly repo organization guidance

**Impact:**
- Provides explicit guidance for poly repo architecture (multiple focused repositories)
- Encourages assessment of existing structure before planning
- Documents repository relationships and communication patterns
- Clarifies when to create separate repositories vs. extending existing ones
- Helps understand this repository's role within larger poly repo ecosystem
- Documents cross-repository integration points for coordination
- Balances poly repo benefits (independence, clear ownership) with integration needs
- Aligns with modern microservices and distributed system architectures
- Prevents accidental creation of monolithic structures in poly repo environments

### 15. Fix Path References to Use <worktree> Prefix ✅ COMPLETED
**What Was Done:**
Systematically audited and fixed all path references in craft.md to use `<worktree>` prefix for consistency:

**Path Audit and Fix:**
- Identified 49+ path references without `<worktree>` prefix
- Used sed to batch-fix all `planning/` paths: `sed -i '' 's|`planning/|`<worktree>/planning/|g' craft.md`
- Fixed references in:
  * GUIDE.md section (lines 87, 96-98, 144)
  * Key Documents Reference section (lines 272-278)
  * Movement II-C context reminder (line 1700)
  * Task template references (lines 1861, 1863, 1899, 1910, 1914)
  * All other `planning/` path references throughout craft.md

**Result:**
- 110+ instances now use `<worktree>/planning/` prefix
- Consistent path references across entire document
- Clear worktree context for all file operations
- Prevents ambiguity about where files should be located

**Impact:**
- Eliminates confusion about file locations
- Ensures all paths are relative to worktree root
- Makes it clear that operations happen within isolated worktree
- Aligns with git worktree pattern used throughout craft workflow
- Improves clarity for LLM executing craft commands
- Prevents accidental operations outside worktree boundaries

## Style Guidelines Applied

**Prompt-as-Code Principles:**
- Natural language guidance instead of rigid procedures
- Explains WHY not just WHAT
- Runtime decision-making encouraged
- Knowledge building through reflection
- Conversational, mentoring tone

**Natural Language Patterns:**
- "Think about..." instead of "List..."
- "Ask yourself..." instead of "Check..."
- "This reveals..." instead of "This does..."
- "Your approach..." instead of "The steps are..."

**Knowledge Building:**
- Each section builds on previous understanding
- Explicit connections between layers/phases
- Decision rationale captured
- Learning emphasized over completion

## Testing Needed

After all enhancements are complete:
1. Read through entire craft.md - does it flow naturally?
2. Does each phase teach thinking, not just list steps?
3. Are context reminders natural, not mechanical?
4. Does GUIDE.md actually help rebuild context?
5. Is the language conversational and knowledge-building?

## Files Modified

- `/Users/jameswiese/.claude/commands/craft.md` - Main craft command file
  - GUIDE.md section: ~230 lines rewritten (lines 59-290)
  - Movement I introduction: ~30 lines added (lines 308-336)
  - Layer 1: ~50 lines enhanced (lines 338-388)
  - **Remaining:** Layers 2-6, Movement II-B, Movement III refactor, GUIDE.md updates

## Estimated Remaining Work

- ~~Enhance Layers 2-6: ~300 lines~~ ✅ COMPLETED
- ~~Add GUIDE.md update steps: ~60 lines to add (6 locations × 10 lines)~~ ✅ COMPLETED
- ~~Add Movement II-B (TDD): ~110 new lines~~ ✅ COMPLETED (lines 684-793)
- ~~Add Movement II-C (Planning): ~335 new lines~~ ✅ COMPLETED (lines 797-1139)
- ~~Add Movement transition updates: ~30 lines~~ ✅ COMPLETED (3 locations)
- ~~Enhance Layer 3 with technology research: ~80 lines~~ ✅ COMPLETED (lines 620-690)
- ~~In planning testing section: add happy path, corner cases, test setup guidance: ~250 lines~~ ✅ COMPLETED (lines 1366-1606)
- ~~Add autonomous iteration directive: ~15 lines~~ ✅ COMPLETED (lines 234-247 in GUIDE.md, lines 2179-2180 in Movement III)
- ~~Add task-based development workflow: ~190 lines~~ ✅ COMPLETED (lines 1759-1960 in Movement II-C)
- ~~Add learnings.md integration and per-task planning: ~70 lines~~ ✅ COMPLETED (lines 1775-1790, 1854-1865, 1881-1978 in Movement II-C)
- ~~Add poly repo layout consideration: ~50 lines~~ ✅ COMPLETED (lines 1722-1757, 1764-1806 in Movement II-C)
- ~~Verify all updates applied to craft.md itself~~ ✅ COMPLETED (Verified all 14 sections present in craft.md, updated Section 7 status)
- ~~Consider all path references and ensure <worktree> prefix~~ ✅ COMPLETED (Fixed 110+ instances)
- ~~Flatten and renumber movement/phase structure~~ ✅ COMPLETED (Full transformation applied)

**Total Remaining:** None - All enhancements complete

**Current Progress:** 100% complete

### 16. Flatten and Renumber Movement/Phase Structure ✅ COMPLETED
**What Was Done:**
Systematically transformed hierarchical naming from "Movement"/"Layer"/"Step" to "Phase"/"Stage" for clarity:

**Header Transformations:**
- `## Movement I/II/III/IV` → `## Phase 1/2/3/4` (4 main headers)
- `### Layer 1-6` → `### Stage 1-6` (6 stages under Phase 1)
- `#### Step 1-6` → `#### Stage 1-6` (6 stages under Phase 3)
- Preserved "Step" subsections within phases (procedural steps remain as "Step")

**Body Text Transformations (using sed):**
- All numbered layer references: `Layer 1-6` → `Stage 1-6`
- Multi-layer references: `Layers 1-2`, `Layers 1-3`, etc. → `Stages 1-2`, `Stages 1-3`, etc.
- Generic layer references: `each layer`, `this layer`, `previous layers`, `six layers` → stage equivalents
- Movement references: `Movement I/II/III/IV` → `Phase 1/2/3/4` in all contexts
- Variable names: `current_layer`, `total_layers`, `layers_confirmed` → stage equivalents

**File Path Transformations:**
- `<worktree>/planning/layers/` → `<worktree>/planning/stages/`
- `/layer-1-*.md` through `/layer-6-*.md` → `/stage-1-*.md` through `/stage-6-*.md`
- `layer-*.md` wildcard patterns → `stage-*.md`

**Total Transformations:** 200+ instances across:
- 4 phase headers
- 12 stage headers (6 under Phase 1, 6 under Phase 3)
- 110+ stage/layer references in body text
- 25+ file path references
- Variable name updates throughout

**Impact:**
- Simpler, flatter hierarchical structure (Phase → Stage)
- More accessible terminology ("Phase 1" clearer than "Movement I")
- Consistent naming throughout document
- Easier to reference ("Stage 3" vs. "Layer 3")
- Preserves procedural "Step" subsections where appropriate
- Aligns folder structure (`stages/` instead of `layers/`)
- Improves scanability and navigation
- Reduces cognitive overhead for understanding document structure
