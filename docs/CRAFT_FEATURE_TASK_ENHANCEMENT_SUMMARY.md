# Craft.md Feature Task Enhancement Summary

**Date**: 2025-10-12
**Session**: Feature Task Generation Directives & Experimental Planning Loop

## Overview

Enhanced craft.md with comprehensive feature task generation directives and added an experimental planning loop stage to Phase 3 task execution. These enhancements ensure thorough consideration of all feature dimensions and validate implementation approaches through experimentation before committing to full TDD implementation.

## Changes Completed

### 1. Comprehensive Feature Task Generation Directives (lines 6797-7014, +218 lines)

**Location**: Phase 2-D Step 2: Create Task Files for Each Feature

Added mandatory comprehensive directive covering 7 critical dimensions that must be considered when creating each feature task:

#### 1.1 Core Feature Aspects (lines 6803-6833)

**Actor Consideration:**
- Who interacts with feature (end user, admin, system, external service, scheduled job)
- Required permissions (roles, scopes, ownership requirements)
- Actor context (session state, workspace, selected items, external triggers)
- Feature discovery methods (navigation, notification, webhook, scheduled invocation)

**API Changes:**
- New endpoints required (REST routes, GraphQL mutations/queries, WebSocket events)
- Modified endpoints impacted (schema changes, backward compatibility)
- API contracts established (validation, response formats, error codes, pagination)
- Versioning strategy (v1 vs v2, deprecation timeline, migration path)

**Data Storage:**
- Schema changes needed (new tables, columns, indexes, constraints)
- Migrations required (data transformation, backfill, rollback strategy)
- Data relationships impacted (foreign keys, denormalization, cascade behaviors)
- Storage patterns used (RDBMS, NoSQL, blob storage, cache layers)

**User Interface (if applicable):**
- UI components needed (forms, modals, tables, cards, navigation elements)
- Screens/pages created or modified (routes, layouts, responsive behaviors)
- UI framework integration (component library, design system, theming)

**Use Cases & Requirements Mapping:**
- Which use cases from Phase 1 Stage 1 does this task implement
- Which requirements from Phase 1 Stage 2 does this satisfy
- Traceability established from requirements → use cases → tasks → tests

#### 1.2 UI Element Lifecycle (lines 6835-6885)

**⚠️ MANDATORY for tasks with UI components** - systematically address:

**Enablement:**
- Initial state (when enabled/disabled: page load, authentication, permission check)
- Dynamic enablement (conditions toggling state: validation, prerequisite selection, async completion)
- Visual feedback (disabled state communication: opacity, cursor, tooltips)

**Animation (if any):**
- Entrance animations (fade in, slide in, scale up, no animation)
- Exit animations (fade out, slide out, scale down, immediate removal)
- Transition animations (smooth transitions, loading spinners, skeleton screens)
- Performance considerations (GPU acceleration, frame rate, reduced motion preference)

**Placement for Purpose:**
- Visual hierarchy (primary/secondary/tertiary action positioning)
- Proximity to related elements (inline actions, contextual menus, grouped controls)
- Responsive behavior (desktop/tablet/mobile layout adaptation)
- Accessibility (screen readers, keyboard navigation, tab order, semantic HTML, ARIA labels)

**Input Validation:**
- Client-side validation (required fields, format constraints, length limits, pattern matching)
- Validation timing (on blur, on change, on submit, debounced)
- Error display (inline messages, field highlighting, summary panel, toast notifications)
- Error recovery (clear messages, examples of valid input, auto-correction suggestions)

**Output Display:**
- Dynamic display (real-time updates: WebSocket, polling, optimistic updates, refresh button)
- Static display (final result: tables, cards, charts, formatted text, downloadable files)
- Empty states (no data messaging: helpful message, illustration, call-to-action)
- Loading states (data fetching indicators: spinners, skeleton screens, progress bars, load more buttons)

**User Notifications:**
- Success notifications (completion communication: toast message, inline confirmation, redirect with message)
- Error notifications (error presentation: error banner, modal dialog, inline alert, toast with retry)
- Progress notifications (long-running progress: progress bar, step indicator, status messages, cancellation option)
- Notification persistence (visibility duration: auto-dismiss after N seconds, persist until dismissed, permanent until action)

**Waiting Patterns:**
- Blocking waits (when user must wait: synchronous save, file upload, payment processing)
- Non-blocking waits (what user can do while waiting: continue editing, navigate away, cancel operation)
- Wait indicators (visual feedback: loading spinner, progress bar, disabled state, overlay)
- Timeout handling (long operation handling: timeout message, retry option, cancel option, background processing)

**Multiple Languages (i18n):**
- Text externalization (no hardcoded strings, translation keys, pluralization rules)
- Date/number formatting (locale-aware: date formats, currency, number separators, timezone handling)
- Text expansion (layout accommodation: German/French can be 30% longer, flexible layouts, truncation strategies)
- RTL support (if applicable: Arabic, Hebrew - mirrored layouts, logical properties)
- Language switching (language picker, preference persistence, dynamic reload)

#### 1.3 UI Interaction Patterns (lines 6887-6899)

**Component-to-Component Interaction:**
- State propagation (how component's state affects others: parent-child, sibling, global state updates)
- Event handling (events emitted: button clicks, form submissions, selection changes, custom events)
- Shared state (state shared with other components: selected items, filters, pagination, sort order)
- Dependency on other components (what component needs from others: data from parent, configuration from siblings, global context)

**Component-to-API Interaction:**
- API call triggers (user actions triggering API calls: button clicks, form submissions, infinite scroll, auto-save)
- Request lifecycle (API request management: loading states, cancellation on unmount, retry logic, concurrent request handling)
- Response handling (API response processing: success updates, error handling, optimistic updates with rollback, cache invalidation)
- Polling/WebSockets (real-time updates needed: polling interval, WebSocket connection management, reconnection strategy)

#### 1.4 Data Interaction & Integrity (lines 6901-6914)

**Actor Data Interaction:**
- Read access (how actors query/view data: list views, detail views, search, filters, exports)
- Write access (how actors create/update/delete data: forms, bulk operations, imports, API endpoints)
- Access control (data access restriction by actor: row-level security, field-level permissions, ownership checks, team boundaries)
- Audit trails (actor data interaction logging: who accessed what when, change history, compliance requirements)

**Data Integrity While Providing Rich Experience:**
- Optimistic updates (immediate UI updates reconciled with server state: rollback on failure, conflict resolution, version tracking)
- Validation layers (where data validated: client-side for UX, server-side for security, database constraints for integrity)
- Transaction boundaries (operations that must be atomic: multi-step processes, rollback strategies, saga patterns for distributed transactions)
- Referential integrity (data relationship enforcement: foreign keys, cascade deletes, orphan prevention, soft deletes)
- Conflict resolution (concurrent edits handling: last-write-wins, optimistic locking, pessimistic locking, CRDTs)

#### 1.5 Data Lifecycle (lines 6916-6936)

**Creation:**
- Data origin (where data comes from: user input, external API, file upload, scheduled import, system-generated)
- Initial validation (rules governing data creation: required fields, format validation, uniqueness checks, business rules)
- Default values (defaults applied: timestamps, status fields, derived values, system assignments)

**Transformation:**
- Processing stages (how data transformed: enrichment, normalization, aggregation, encryption)
- Intermediate states (temporary states: pending, processing, validated, failed)
- Side effects (other systems notified: webhooks, message queues, external services, caches)

**Storage Duration:**
- Retention policies (how long data kept: permanent, time-limited, lifecycle tiers - hot/warm/cold)
- Archival strategies (when data archived: age-based, size-based, compliance-driven)
- Backup strategies (data protection: frequency, retention, restoration testing)

**Deletion/Expiration:**
- Soft delete vs hard delete (data truly deleted or marked inactive: recoverability requirements, compliance constraints)
- Cascade effects (related data handling: cascade deletes, orphan handling, archive before delete)
- Compliance requirements (legal obligations: GDPR right to erasure, data retention laws, audit preservation)

#### 1.6 Security Considerations (lines 6938-6963)

**Authentication Requirements:**
- Authentication level (required authentication: anonymous, authenticated user, verified account, MFA)
- Session management (session validation: token validation, session timeout, concurrent session limits)
- Credential handling (credential management: OAuth flows, API keys, service accounts, credential rotation)

**Authorization Checks:**
- Permission model (permissions controlling access: RBAC roles, ABAC attributes, resource ownership, team membership)
- Authorization points (where checks enforced: API gateway, service layer, data layer, UI layer)
- Privilege escalation prevention (unauthorized access prevention: input validation, resource isolation, audit logging)

**Input Security:**
- Injection prevention (malicious input blocking: parameterized queries, input sanitization, content security policy)
- File upload security (uploaded file validation: file type checking, size limits, virus scanning, sandboxed processing)
- Rate limiting (abuse prevention: request throttling, CAPTCHA, IP blocking, account lockout)

**Data Protection:**
- Encryption at rest (stored data encryption: PII, credentials, sensitive business data, encryption algorithms used)
- Encryption in transit (data protection during transmission: TLS/SSL, API authentication, secure WebSockets)
- Data masking (sensitive data masking in logs/UI: PII redaction, credential masking, partial display)

**Audit & Compliance:**
- Audit logging (actions logged: access attempts, data changes, permission changes, security events)
- Compliance requirements (regulations applying: GDPR, HIPAA, SOC2, PCI-DSS, industry-specific)
- Security testing (security validation needed: penetration testing, vulnerability scanning, dependency audits)

#### 1.7 Observability & Monitoring (lines 6965-6986)

**Logging Requirements:**
- Log levels (what logged at each level: DEBUG, INFO, WARN, ERROR - avoid over-logging sensitive data)
- Structured logging (machine-readable logs: JSON format, consistent field names, correlation IDs)
- Contextual information (context included: user ID, request ID, trace ID, timestamp, environment)

**Metrics Collection:**
- Performance metrics (what measured: latency, throughput, error rate, resource utilization)
- Business metrics (feature success indicators: usage count, conversion rate, feature adoption, user engagement)
- Custom metrics (feature-specific metrics: specific to task's domain - e.g., search query latency, payment success rate)

**Actor-Specific Observability:**
- Admin observability (what admins need to see: system health, user activity, error trends, performance dashboards)
- Developer observability (what developers need for debugging: detailed traces, error context, reproduction steps, stack traces)
- End-user observability (what users need to see: operation status, error messages, progress indicators, history/audit trails)
- Support team observability (what helps support troubleshoot: user session playback, action history, system state at error time)

**Alerting & Incident Response:**
- Alert conditions (when alerts fire: error rate thresholds, performance degradation, security events, business anomalies)
- Alert routing (who gets notified: on-call rotation, escalation policies, severity-based routing)
- Runbook references (documentation helping respond: common issues, remediation steps, escalation procedures)

#### 1.8 Application to Task Creation (lines 6988-7012)

**When creating each task file:**

1. Review entire directive before filling out task template
2. For each section above, ask: "Does this feature task involve this aspect?"
3. Document applicable aspects in task file's Implementation Scope section
4. Write test specifications that verify each aspect is correctly implemented
5. Update acceptance criteria to include verification of security, observability, and data integrity
6. Cross-reference to use cases (Phase 1 Stage 1) and requirements (Phase 1 Stage 2) that justify each aspect

**Why this matters:**
- **Missing actor consideration** → features that don't match actual user permissions or workflows
- **Missing API design** → inconsistent interfaces, breaking changes, poor client integration
- **Missing data lifecycle** → data leaks, orphaned records, compliance violations
- **Missing UI lifecycle** → confusing interfaces, poor accessibility, broken responsive layouts
- **Missing security considerations** → vulnerabilities, unauthorized access, data breaches
- **Missing observability** → production issues that can't be diagnosed, silent failures, poor user experience

**This comprehensive approach ensures:**
- ✅ Complete features that consider all dimensions
- ✅ Secure implementations that protect data and users
- ✅ Observable systems that can be monitored and debugged
- ✅ Maintainable code that respects data integrity
- ✅ Excellent user experiences across all UI interactions

### 2. Experimental Planning Loop Stage (lines 8619-9069, +451 lines)

**Location**: Phase 3 Task Execution Loop, Stage 2b (between "Plan the Work" and "Craft the Solution")

Added comprehensive experimental planning loop that validates implementation approaches through focused experiments before committing to full TDD implementation.

**Loop Structure:**
- **Loop Condition**: Continue WHILE key questions remain OR plan revisions are needed
- **Quality Gate**: Exit ONLY when all critical questions answered, approach validated, plan complete

#### 2.1 Step 1: Identify Key Questions (lines 8636-8688)

**Question Categories:**

**Technical Feasibility Questions:**
- "Can library X handle use case Y?" (performance, edge cases, compatibility)
- "Does API Z support the operation we need?" (rate limits, response format, error handling)
- "Will pattern A work with constraint B?" (memory limits, concurrency, latency)
- "Is approach C compatible with existing code D?" (integration points, breaking changes)

**Implementation Approach Questions:**
- "Should we use strategy X or strategy Y?" (comparing alternatives)
- "What's the best way to handle edge case Z?" (data validation, error recovery)
- "How should we structure module A for extensibility?" (design patterns, abstraction level)
- "Which data structure optimizes for our access patterns?" (trade-offs, complexity)

**Integration Questions:**
- "How does external service X actually behave?" (real-world vs documented behavior)
- "What happens when system Y fails or times out?" (failure modes, cascading effects)
- "Can we rely on assumption Z about the environment?" (OS capabilities, network conditions)
- "What's the actual performance of operation W?" (benchmark vs theoretical)

**Requirements Clarity Questions:**
- "What should happen in ambiguous scenario X?" (user expectations, business rules)
- "How do users expect feature Y to behave?" (UX patterns, mental models)
- "What constitutes 'acceptable performance' for operation Z?" (response time, throughput)
- "Which error conditions must we handle vs can gracefully fail?" (priority, impact)

**Question Documentation Format:**
```markdown
### Key Questions for This Task

**Question 1: [Specific question]**
- **Why it matters:** [Impact on implementation approach]
- **Current assumption:** [What we think is true]
- **Risk if wrong:** [Consequences of incorrect assumption]
- **Experiment needed:** [How we'll answer this]
```

**Question Prioritization:**
- **MUST answer:** Questions that block implementation (architectural decisions, critical unknowns)
- **SHOULD answer:** Questions that significantly affect approach (optimization strategies, error handling)
- **NICE to answer:** Questions that refine details (cosmetic choices, minor optimizations)

#### 2.2 Step 2: Design Targeted Experiments (lines 8692-8822)

**Experiment Design Principles:**
- **Minimal scope:** Test only what's needed to answer the question (avoid over-building)
- **Realistic conditions:** Use actual APIs, real data, production-like environment
- **Measurable outcomes:** Define clear success/failure criteria
- **Time-boxed:** Set maximum time limit (15-30 minutes per experiment)
- **Isolated:** Experiment should not affect existing code or state

**5 Experiment Types with Code Examples:**

**1. API Exploration Experiment** (lines 8705-8721)
```javascript
// Question: "Does API X support operation Y with our constraints?"
const experiment_api_capability = async () => {
  const testPayload = { /* realistic data */ };
  try {
    const response = await apiClient.operation(testPayload);
    console.log('Success:', response);
    console.log('Response time:', response.timing);
    console.log('Supports our use case:', checkCriteria(response));
  } catch (error) {
    console.log('Failure:', error.message, error.code);
    console.log('Can we handle this error?:', analyzeError(error));
  }
};
```

**2. Performance Benchmark Experiment** (lines 8724-8741)
```javascript
// Question: "Is approach X fast enough for requirement Y?"
const experiment_performance = () => {
  const testData = generateRealisticDataset(1000); // Production scale
  const start = Date.now();

  for (let i = 0; i < 100; i++) {
    performOperation(testData);
  }

  const avgTime = (Date.now() - start) / 100;
  console.log('Average operation time:', avgTime, 'ms');
  console.log('Meets requirement (<50ms):', avgTime < 50);
  console.log('Scaling factor:', predictScaling(avgTime));
};
```

**3. Integration Compatibility Experiment** (lines 8744-8761)
```javascript
// Question: "Can new module X integrate with existing module Y?"
const experiment_integration = () => {
  const existingModule = require('../src/existing-module');
  const newModuleMock = { /* minimal interface */ };

  try {
    const result = existingModule.processWithNew(newModuleMock);
    console.log('Integration successful:', result);
    console.log('Interface compatible:', validateInterface(result));
  } catch (error) {
    console.log('Integration issue:', error.message);
    console.log('Interface mismatch:', identifyMismatch(error));
  }
};
```

**4. Edge Case Behavior Experiment** (lines 8764-8785)
```javascript
// Question: "How does library X handle edge case Y?"
const experiment_edge_cases = () => {
  const edgeCases = [
    { input: null, expected: 'graceful null handling' },
    { input: [], expected: 'empty array handling' },
    { input: hugeArray, expected: 'large data handling' },
    { input: malformed, expected: 'error detection' }
  ];

  edgeCases.forEach(testCase => {
    try {
      const result = library.operation(testCase.input);
      console.log(`Case ${testCase.expected}:`, result);
    } catch (error) {
      console.log(`Case ${testCase.expected} error:`, error.message);
    }
  });
};
```

**5. Architectural Pattern Experiment** (lines 8788-8805)
```javascript
// Question: "Should we use pattern X or pattern Y for requirement Z?"
const experiment_pattern_comparison = () => {
  // Pattern X: Strategy A
  const resultX = implementPatternX(sampleData);
  console.log('Pattern X complexity:', analyzeComplexity(resultX));
  console.log('Pattern X extensibility:', analyzeExtensibility(resultX));

  // Pattern Y: Strategy B
  const resultY = implementPatternY(sampleData);
  console.log('Pattern Y complexity:', analyzeComplexity(resultY));
  console.log('Pattern Y extensibility:', analyzeExtensibility(resultY));

  console.log('Recommendation:', comparePatterns(resultX, resultY));
};
```

**Experiment Documentation Template:**
```markdown
### Experiments for This Task

**Experiment 1: [Purpose - answers Question N]**
- **Type:** [API/Performance/Integration/EdgeCase/Pattern]
- **Setup:** [What needs to be prepared]
- **Execution:** [What will be run/tested]
- **Success criteria:** [What indicates answer is "yes"]
- **Failure criteria:** [What indicates answer is "no"]
- **Time limit:** [Maximum time to spend]
```

#### 2.3 Step 3: Execute Experiments and Capture Findings (lines 8826-8879)

**Execution Pattern:**
1. **Set up experiment environment** (install test dependencies, configure API clients)
2. **Run experiment** (execute code, capture output, measure results)
3. **Observe behavior** (note actual behavior vs expected, identify surprises)
4. **Document findings** (write down what you learned, even if unexpected)

**Findings Documentation Format:**
```markdown
### Experiment Results

**Experiment 1: [Name]**
- **Question addressed:** [Which question this answers]
- **Execution date:** [Timestamp]
- **Outcome:** [Success/Failure/Partial/Unexpected]
- **Key findings:**
  * [Specific observation 1]
  * [Specific observation 2]
  * [Unexpected behavior observed]
- **Performance metrics:** [If applicable: timing, memory, error rate]
- **Answer to question:** [Direct answer with confidence level]
- **Supporting evidence:** [Log excerpts, measurements, error messages]
- **Implications for plan:** [How this affects implementation approach]
```

**Handle Unexpected Results:**
- **Don't ignore surprises** - they reveal faulty assumptions
- **Investigate anomalies** - understand why actual ≠ expected
- **Adjust hypotheses** - revise your mental model based on evidence
- **Consider follow-up experiments** - if results raise new questions

**Time Management:**
- **Respect time boxes** - don't get stuck perfecting experiments
- **Prioritize learning** - goal is answers, not perfect code
- **Parallel experiments** - run independent experiments concurrently if possible
- **Know when to stop** - sufficient confidence to proceed ≠ perfect certainty

#### 2.4 Step 4: Consolidate Findings and Map to Key Questions (lines 8883-8925)

**Consolidation Format:**
```markdown
### Findings Consolidation

**Question 1: [Original question]**
- **Answered by:** Experiment 1, Experiment 3
- **Answer:** [Clear, evidence-based answer]
- **Confidence level:** [High/Medium/Low]
- **Evidence summary:**
  * Experiment 1 showed: [Key finding]
  * Experiment 3 confirmed: [Supporting finding]
- **Decision:** [What we'll do based on this answer]
- **Rationale:** [Why this decision given the evidence]

**Question 3: [Original question]**
- **Status:** UNANSWERED or PARTIALLY ANSWERED
- **Remaining uncertainty:** [What we still don't know]
- **Why not answered:** [Experiment failed, time limit, need different approach]
- **Next steps:** [New experiment needed, or acceptable to proceed with assumption]
```

**Identify Patterns and Insights:**
- **Consistent findings:** Multiple experiments pointing to same conclusion
- **Conflicting findings:** Experiments suggesting different answers (investigate why)
- **Emergent patterns:** Insights that weren't questions but discovered through experiments
- **New questions:** Additional questions raised by experiment results

**Assess Completion:**
- **All MUST-answer questions:** Resolved with high confidence?
- **Most SHOULD-answer questions:** Resolved with medium+ confidence?
- **Acceptable uncertainty:** Remaining unknowns won't block implementation?

#### 2.5 Step 5: Reconcile Findings and Update Plan (Quality Gate) (lines 8929-9068)

**Quality Gate Decision:**

**✅ PROCEED to Stage 3 (TDD Implementation) IF:**
- All MUST-answer questions have clear, evidence-based answers
- Implementation approach is validated by experiments
- Key risks are understood and mitigated
- Confidence level is sufficient to begin TDD without major unknowns
- Plan from Stage 2 is still valid OR has been updated based on findings

**🔁 LOOP BACK to Step 1 (Revise Plan) IF:**
- Critical questions remain unanswered
- Experiments revealed approach is not viable
- New questions emerged that are blocking
- Plan needs significant revision based on findings
- Confidence level is too low to proceed responsibly

**Quality Gate Evaluation Checklist:**
```markdown
### Quality Gate: Ready to Proceed to TDD Implementation?

**Critical Questions Status:**
- [ ] All MUST-answer questions resolved
- [ ] Answers are evidence-based (not assumptions)
- [ ] Confidence level ≥ High for architectural decisions
- [ ] Confidence level ≥ Medium for implementation details

**Plan Validity:**
- [ ] Original plan still viable OR updated plan documented
- [ ] Implementation approach validated by experiments
- [ ] Integration points confirmed to work
- [ ] Performance validated against requirements
- [ ] Edge cases understood and have handling strategy

**Risk Assessment:**
- [ ] Known risks are documented and mitigated
- [ ] Unknowns are acceptable (won't block progress)
- [ ] Failure modes are understood
- [ ] Rollback/recovery strategies defined if needed

**Ready to proceed:** YES / NO (if NO, loop back with revised plan)
```

**If LOOPING BACK - Revise Plan Format:**
```markdown
### Plan Revision (Loop Iteration N)

**Original approach:** [What we planned in Stage 2 or previous iteration]

**Why revision needed:**
- Finding: [Experiment result that invalidates original approach]
- Finding: [New insight that suggests better approach]
- Finding: [Risk discovered that must be addressed]

**Revised approach:** [Updated implementation strategy]

**New assumptions:** [What we're now assuming based on evidence]

**Residual questions:** [New questions that emerged]
```

**Loop Termination:**
- Maximum 3-4 iterations typical for most tasks
- If stuck in loop >4 iterations, escalate: may need user input, architectural change, or task decomposition

**If PROCEEDING - Document Validated Plan:**
```markdown
## Implementation Plan (Pre-Implementation)

**Approach validated through experiments:** [Date]

**Key Questions Resolved:**
1. Question: [Original question] → Answer: [Evidence-based answer from experiments]
2. Question: [Original question] → Answer: [Evidence-based answer from experiments]

**Validated Implementation Strategy:**
- Approach: [Confirmed approach with rationale]
- Technology choices: [Confirmed based on experiments]
- Integration patterns: [Validated integration points]
- Performance expectations: [Benchmarked and realistic]
- Edge case handling: [Tested strategies]

**Lessons from Experiments:**
- [Key insight from experimentation]
- [Pitfall avoided through testing]
- [Optimization opportunity discovered]

**Ready for TDD implementation with confidence.**
```

**🎯 Benefits of Experimental Planning Loop:**
- ✅ **Validates assumptions** before committing to full implementation
- ✅ **Discovers issues early** when they're cheap to fix
- ✅ **Reduces rework** by testing approaches with minimal code
- ✅ **Builds confidence** through evidence rather than guesswork
- ✅ **Documents decisions** with rationale based on experiments
- ✅ **Prevents false starts** that waste time on wrong approach
- ✅ **Reveals edge cases** and failure modes before production
- ✅ **Optimizes approach** by comparing alternatives empirically

**When to skip this stage:**
- Task is trivial (simple utility function, minor refactor)
- Approach is well-established (proven pattern, similar to previous tasks)
- No uncertainty exists (clear requirements, known technologies)
- Experiments would take longer than just implementing
- Prior tasks have already validated the approach

## Impact

**File Size:**
- Starting: 9,244 lines (from previous session)
- Final: 9,916 lines
- **Added: 672 lines (+7.3%)**

**Breakdown:**
- Feature Task Generation Directives: +218 lines
- Experimental Planning Loop: +451 lines
- Formatting/spacing: +3 lines

**Quality Improvement:**
- Feature task files now systematically address 7 critical dimensions
- Implementation approaches validated through evidence-based experimentation before TDD
- Reduced false starts and rework through early validation

## Why This Matters

### Before Enhancement

**Feature task creation:**
- Focused primarily on functionality and tests
- Security, observability, data lifecycle often discovered during implementation
- UI considerations handled ad-hoc
- Assumptions not validated until coding begins

**Implementation approach:**
- Planned once, then committed to TDD
- Assumptions discovered incorrect during implementation
- Rework required when approach doesn't work
- False starts waste time on wrong direction

### After Enhancement

**Feature task creation now ensures:**
1. **Complete actor consideration** - permissions, context, discovery paths
2. **Comprehensive API design** - contracts, versioning, compatibility
3. **Full data lifecycle** - creation, transformation, retention, deletion with compliance
4. **Thorough UI lifecycle** - enablement, animation, placement, validation, output, notifications, waiting patterns, i18n
5. **UI interaction patterns** - component-to-component and component-to-API interactions
6. **Data interaction & integrity** - access control, optimistic updates, validation layers, transaction boundaries, conflict resolution
7. **Security from start** - authentication, authorization, input security, data protection, audit/compliance
8. **Observability built-in** - logging, metrics, actor-specific visibility, alerting

**Implementation approach now includes:**
1. **Question identification** - explicit unknowns and assumptions documented
2. **Experiment design** - focused, time-boxed, measurable experiments
3. **Evidence gathering** - actual API behavior, real performance, proven integration
4. **Findings consolidation** - map evidence back to questions, assess confidence
5. **Quality gate** - proceed only when validated, loop back if uncertain
6. **Plan refinement** - iterate based on evidence until confident
7. **Documentation** - validated approach with rationale for TDD phase

### Benefits

**For Feature Tasks:**
- **Frontend developers** know complete UI lifecycle to implement
- **Backend developers** understand data lifecycle, security, observability requirements
- **Security teams** see authentication, authorization, data protection requirements upfront
- **DevOps** understand observability, monitoring, alerting needs
- **UX designers** understand complete user interaction patterns
- **QA teams** can test against comprehensive acceptance criteria
- **Product managers** see traceability from requirements to implementation

**For Experimental Loop:**
- **Reduces implementation time** - no backtracking from wrong approach
- **Increases confidence** - evidence-based decisions vs guesswork
- **Discovers issues early** - when cheap to fix (minutes in experiments vs hours in implementation)
- **Documents rationale** - future developers understand why approach chosen
- **Prevents false starts** - validates before committing to full TDD cycle
- **Reveals edge cases** - discovers failure modes before production
- **Optimizes approach** - empirically compares alternatives

## Examples

### Feature Task with All 7 Dimensions

```markdown
# Task 015: User Invoice Creation

## Feature Description
Users can create invoices with line items, tax calculation, and customer selection.

## Core Feature Aspects

**Actor:** End user with "invoice.create" permission
**API:** POST /api/v1/invoices (creates), GET /api/v1/customers (loads dropdown)
**Data Storage:** invoices table (id, customer_id, total, tax, status, created_at), line_items table (invoice_id, description, amount)
**UI:** Invoice creation form modal with customer dropdown, line items table, tax summary
**Use Cases:** Implements UC-3 "Create Invoice" from Phase 1 Stage 1

## UI Element Lifecycle

**Enablement:**
- Form initially disabled until customer selected
- "Add Line Item" button enabled after customer selection
- "Save" button enabled when form valid (≥1 line item, all fields complete)

**Placement:**
- Primary modal dialog, centered viewport
- Customer dropdown at top (most important selection)
- Line items table in main area
- Tax summary right-aligned
- Save/Cancel buttons bottom-right (Save = primary)

**Input Validation:**
- Customer: Required, validate customer exists and user has access
- Line item description: Required, max 200 chars
- Line item amount: Required, numeric, > 0, max 2 decimals
- Validation on blur with inline error messages

**Output Display:**
- Total updates dynamically as line items added/changed
- Tax calculation shown in real-time
- Success: Close modal, refresh invoice list, show toast "Invoice #123 created"

**Waiting Patterns:**
- Non-blocking: User can edit form while customer dropdown loads
- Blocking: Spinner on Save button during API call (prevents double-submit)
- Timeout: If save takes >5s, show "Still processing..." message with cancel option

## Data Interaction & Integrity

**Actor Data Interaction:**
- Read: Customer list filtered to user's accessible accounts
- Write: Invoice created with line items in single transaction
- Access control: Can only create invoices for customers user has "invoice.create" permission on

**Data Integrity:**
- Transaction boundary: Invoice + all line items must be created atomically (rollback on failure)
- Validation: Customer ID validated against accessible customers, amounts validated positive
- Optimistic updates: Invoice added to UI list immediately, rolled back if API fails

## Data Lifecycle

**Creation:** User input via form, validated client + server, default status = "draft"
**Transformation:** Tax calculated server-side, total aggregated from line items
**Storage Duration:** Permanent, retained for 7 years per accounting regulations
**Deletion:** Soft delete only (status = "deleted"), hard delete after 7 years for compliance

## Security Considerations

**Authentication:** Must be logged in with valid session token
**Authorization:** Requires "invoice.create" permission, customer ID validated against user's accessible accounts
**Input Security:** All inputs sanitized server-side, SQL injection prevented via parameterized queries
**Data Protection:** Invoice data encrypted at rest (PII: customer info), TLS in transit
**Audit:** Log invoice creation with user ID, timestamp, customer ID, total amount

## Observability

**Logging:** INFO log on successful creation with invoice ID and total, ERROR log on validation/database failures
**Metrics:** Track invoice_creation_count, invoice_creation_latency_ms, invoice_creation_errors
**End-user observability:** Success toast shows invoice number, error banner shows validation issues
**Admin observability:** Dashboard shows invoice creation volume, success rate, average processing time
```

### Experimental Planning Loop Example

```markdown
### Key Questions for Task 015

**Question 1: Can we calculate tax in real-time without lag?**
- **Why it matters:** UX requires instant feedback as line items added
- **Current assumption:** Tax API responds <100ms for single invoice
- **Risk if wrong:** Slow UX, users perceive form as broken
- **Experiment needed:** Benchmark tax API with realistic invoice data

**Question 2: Should we use optimistic updates or wait for server confirmation?**
- **Why it matters:** Affects perceived performance and error handling complexity
- **Current assumption:** API is reliable enough for optimistic updates
- **Risk if wrong:** Users see invoice in list, then it disappears on failure
- **Experiment needed:** Measure API error rate, test rollback UX

**Question 3: How should we handle concurrent edits to same customer's invoices?**
- **Why it matters:** Multiple users might create invoices for same customer simultaneously
- **Current assumption:** No conflicts because each invoice has unique ID
- **Risk if wrong:** Race conditions on customer credit limit checks
- **Experiment needed:** Test concurrent invoice creation for same customer

### Experiments Designed

**Experiment 1: Tax Calculation Performance**
- **Type:** Performance Benchmark
- **Setup:** Create mock invoice with 10 line items, realistic amounts
- **Execution:** Call tax API 100 times, measure average response time
- **Success criteria:** Average <100ms, p95 <150ms
- **Failure criteria:** Average >100ms or p95 >200ms
- **Time limit:** 20 minutes

**Experiment 2: API Reliability Check**
- **Type:** API Exploration
- **Setup:** Create test invoice via API with realistic data
- **Execution:** Create 50 invoices rapidly, track success/failure rate
- **Success criteria:** Success rate >99%, errors are graceful
- **Failure criteria:** Success rate <95% or errors lose data
- **Time limit:** 15 minutes

**Experiment 3: Concurrent Creation Test**
- **Type:** Integration/EdgeCase
- **Setup:** Two API clients authenticated as different users
- **Execution:** Both create invoices for same customer simultaneously
- **Success criteria:** Both succeed, no data corruption, credit limits respected
- **Failure criteria:** One fails, data corrupted, race condition observed
- **Time limit:** 20 minutes

### Experiment Results

**Experiment 1: Tax Calculation Performance**
- **Outcome:** Success
- **Key findings:**
  * Average response time: 45ms
  * p95 response time: 82ms
  * p99 response time: 134ms
  * All responses <200ms
- **Answer:** Real-time tax calculation is feasible
- **Implications:** Can use optimistic UI updates with confidence

**Experiment 2: API Reliability Check**
- **Outcome:** Partial Success
- **Key findings:**
  * 49/50 succeeded (98% success rate)
  * 1 failed with 503 Service Unavailable (transient)
  * Retry after 2s succeeded
  * No data lost on failure
- **Answer:** API is reliable with graceful degradation
- **Implications:** Implement retry logic, optimistic updates are safe

**Experiment 3: Concurrent Creation Test**
- **Outcome:** Unexpected behavior discovered
- **Key findings:**
  * Both invoices created successfully
  * BUT: Credit limit check raced - both saw available credit before either was deducted
  * Result: Customer went over credit limit
- **Answer:** Race condition exists in credit limit enforcement
- **Implications:** Need server-side locking or pessimistic credit check

### Quality Gate: Ready to Proceed?

**Critical Questions Status:**
- ✅ Question 1: Resolved (High confidence - real-time calculation works)
- ✅ Question 2: Resolved (High confidence - optimistic updates safe with retry)
- ⚠️ Question 3: PARTIALLY RESOLVED - race condition discovered

**Plan Validity:**
- ⚠️ Original plan needs revision - must handle credit limit race condition
- ✅ Tax calculation approach validated
- ✅ Error handling strategy validated

**Decision:** LOOP BACK - Need to design credit limit handling before TDD

### Plan Revision (Loop Iteration 2)

**Original approach:** Create invoice directly, check credit limit in validation

**Why revision needed:**
- Experiment 3 revealed: Credit limit check has race condition
- Risk: Multiple users could create invoices that collectively exceed credit limit
- Must solve before implementing feature

**Revised approach:**
- Option A: Use database row-level locking on customer record during invoice creation
- Option B: Implement optimistic locking with version field on customer
- Option C: Move credit limit enforcement to async background job (accept brief over-limit)

**New questions:**
- Which approach provides best UX? (blocking vs async)
- What's acceptable over-limit duration? (business question - ask user)

**Residual questions:**
- Question 4: Should we block invoice creation while checking credit, or allow creation and reject later?
```

## Related Work

This enhancement builds on:
- **Secondary/tertiary unstated expectations** (Phase 1 Stage 1) - systematic discovery of hidden requirements
- **Source code layout research** (Phase 2-C) - runtime convention discovery
- **TDD test specification flow** (Phase 2-B/2-D/Phase 3) - complete test-first implementation
- **Access journey illustrations** (Phase 1 Stage 1) - actor access path documentation

## Files Modified

- `/Users/jameswiese/.claude/commands/craft.md`
  - Feature Task Generation Directives (lines 6797-7014, +218 lines)
  - Experimental Planning Loop Stage (lines 8619-9069, +451 lines)

## Verification

To verify these enhancements work in practice:

1. Start new craft.md project with `/craft` command
2. Observe Phase 2-D task creation instructions reference comprehensive directives
3. Check generated task files include all 7 dimensions in Implementation Scope
4. Verify Phase 3 execution includes Stage 2b (Experimental Planning Loop)
5. Confirm quality gate properly gates progression to TDD implementation
6. Observe loop behavior when experiments reveal issues with plan

## Conclusion

Feature task generation now systematically addresses 7 critical dimensions (actor, API, data storage, UI, use cases/requirements, data interaction/integrity, data lifecycle, security, observability), ensuring complete, secure, observable, and maintainable implementations from the start.

The experimental planning loop validates implementation approaches through evidence-based experiments before committing to full TDD implementation, significantly reducing false starts, rework, and implementation time while building confidence through measured results rather than assumptions.

Together, these enhancements ensure:
- ✅ **Complete feature specifications** that address all dimensions
- ✅ **Validated implementation approaches** through experimentation
- ✅ **Reduced rework** from wrong assumptions or approaches
- ✅ **Evidence-based decisions** with documented rationale
- ✅ **Secure, observable, maintainable systems** by design
- ✅ **Excellent user experiences** across all interactions
- ✅ **Faster implementation** through upfront validation

The comprehensive directive (218 lines) and experimental loop (451 lines) add **672 lines (+7.3%)** to craft.md, providing significant quality improvements for minimal size increase.
