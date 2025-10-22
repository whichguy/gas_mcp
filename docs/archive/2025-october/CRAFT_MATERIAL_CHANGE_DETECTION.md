# Craft.md Material Change Detection Enhancement

**Date**: 2025-10-12
**Session**: Material Change Detection and Jump-Back Logic Implementation

## Executive Summary

Enhanced craft.md with comprehensive material change detection at 13 strategic checkpoints throughout the workflow. When user feedback reveals a **material change** that invalidates earlier confirmed work, Claude now:
1. **Detects** the material change automatically
2. **Presents consequences** clearly to the user
3. **Offers options** (jump back, continue, or explain more)
4. **Executes chosen path** with proper documentation

**Total Impact**: 11,047 → 11,314 lines (+267 lines, +2.4% growth)

## Problem Statement

### Before Enhancement

**Issue**: User feedback during later phases sometimes revealed fundamental changes to earlier confirmed phases, but craft.md had no systematic way to:
- Detect when feedback contradicts earlier decisions
- Present the cost/impact of making the change
- Guide the decision on whether to jump back or continue
- Document the choice and reasoning

**Result**:
- Claude might continue forward despite fundamental misalignments
- Users unaware of downstream impacts of their feedback
- Inconsistencies between phases
- Technical debt accumulated without documentation

**Example Scenarios:**
- User in Phase 2: "Wait, external customers need access too" → Stage 1 only covered internal users
- User in Phase 3: "This needs real-time updates" → Stage 3 architecture assumed polling
- User in Phase 4: "Actually this is GraphQL, not REST" → All Phase 3 decisions based on REST

### After Enhancement

**Solution**: Systematic material change detection at 13 checkpoints:

**Detection Points:**
1. Stage 1-6 quality gates (uses unified Stage Execution Pattern)
2. Phase 1→2 transition
3. Phase 2→3 transition
4. Phase 3→4 transition
5. Phase 2-D task creation
6. Phase 3 task implementation start

**At Each Detection Point:**
```
1. Evaluate user feedback for contradictions
2. IF material change detected:
   → Identify affected phase/stage
   → Calculate impact (what needs revisiting)
   → Present consequences with 3 options:
      a) Jump back and fix (recommended)
      b) Continue with current approach (document alternative)
      c) Explain more about impact
3. IF jump-back chosen:
   → Update GUIDE.md with rationale
   → Jump to affected phase/stage
   → Re-execute with new understanding
4. IF continue chosen:
   → Document in GUIDE.md Decision History
   → Note technical debt/trade-off
   → Proceed forward
```

## Changes Implemented

### 1. GUIDE.md Template Enhancement (+99 lines)

**Location**: Lines 469-567 (after "How to Progress Through This Journey")

**Added Section**: "Material Changes: When to Jump Back"

**Content:**
- Definition of material changes
- 4 detection questions
- Material vs. non-material examples
- Consequence presentation template
- Jump-back procedure (5 steps)
- Alternative documentation if user declines
- Quality gates check reminder

**Why Important:**
- Provides philosophical foundation for material change handling
- Teaches Claude how to distinguish material from non-material changes
- Establishes consistent user experience across all detection points
- Ensures proper documentation regardless of user's choice

### 2. Stage Execution Pattern Enhancement (+36 lines)

**Location**: Lines 924-959 (applies to all Stages 1-6)

**Added**: "Check for Material Changes" section before "Process User Response"

**Content:**
```markdown
**Check for Material Changes:**

Before accepting confirmation, evaluate if user feedback reveals a material change...

**IF user feedback contradicts earlier confirmed stages:**
  → Identify which stage(s) are affected
  → Present consequences clearly:
    [Template with options]
  → IF user chooses jump-back:
     * Update GUIDE.md with jump-back rationale
     * Mark subsequent stages as "needs-review"
     * Jump to affected stage and re-execute
  → IF user chooses to continue:
     * Document alternative approach in GUIDE.md
     * Continue with current approach
```

**Why Important:**
- Single enhancement applies to all 6 stages (consistency)
- Catches issues before moving to next stage
- Prevents building on faulty foundations

### 3. Phase 1→2 Transition Check (+29 lines)

**Location**: Lines 4966-4993 (before Phase 2 begins)

**Added**: "Check for Material Changes Before Phase Transition"

**Context**: At the **final quality gate** after Stage 6 synthesis

**Specific Prompt:**
```
⚠️ MATERIAL CHANGE DETECTED at Phase 1→2 Transition

Your feedback indicates a change to [Stage X].

To accommodate this change:
- Revisit: Stage [X] through Stage 6
- Update: [affected artifacts]
- Re-synthesize: task-definition.md

This affects our Phase 1 foundation.
```

**Why Important:**
- Last chance to fix understanding before planning begins
- Prevents planning on incorrect requirements
- Changes to understanding are cheap here, expensive later

### 4. Phase 2→3 Transition Check (+31 lines)

**Location**: Lines 9619-9647 (after Pre-Implementation Quality Gate passes)

**Added**: "Check for Material Changes Before Phase Transition"

**Context**: After automated quality gate verification, before implementation

**Specific Prompt:**
```
⚠️ MATERIAL CHANGE DETECTED at Phase 2→3 Transition

Gate verification revealed an issue with [Phase/Stage X]:
[Description of inconsistency]

To fix this:
- Revisit: [affected phases/stages]
- Update: [affected planning artifacts]
- Re-verify: Updated artifacts align with all requirements

This should be fixed before implementation begins.
```

**Why Important:**
- Last chance to fix planning before code is written
- Gate verification might reveal inconsistencies
- Implementation makes changes exponentially more expensive

### 5. Phase 3→4 Transition Check (+30 lines)

**Location**: Lines 10915-10942 (when all tasks complete, before delivery)

**Added**: "Check for Material Changes Before Phase Transition"

**Context**: After implementation reveals planning realities

**Specific Prompt:**
```
⚠️ MATERIAL CHANGE DETECTED at Phase 3→4 Transition

Implementation revealed an issue with [planning artifact]:
[Description: e.g., "Architecture assumed REST but implementation uses GraphQL"]

This means:
- Planning docs don't match implementation
- Future maintainers will be confused
- Technical debt documented
```

**Why Important:**
- Implementation often reveals planning assumptions were wrong
- Options: update docs, refactor code, or document debt
- Ensures planning artifacts match actual implementation

### 6. Phase 2-D Task Creation Check (+30 lines)

**Location**: Lines 7171-7200 (before creating task files)

**Added**: "Check for Material Changes Before Task Creation"

**Context**: Before decomposing features into tasks

**Specific Prompt:**
```
⚠️ MATERIAL CHANGE DETECTED in Phase 2-D Task Creation

Task breakdown doesn't align with Stage 1 use cases:
[Description: e.g., "Creating task for admin dashboard, but Stage 1 only covered user workflows"]

This means:
- Missing use case analysis in Stage 1
- Additional features creeping into scope
- OR: Features in Stage 1 not being implemented
```

**Why Important:**
- Catches scope creep before tasks are created
- Ensures all tasks trace to confirmed use cases
- Prevents "surprise features" during implementation

### 7. Phase 3 Task Implementation Check (+32 lines)

**Location**: Lines 9829-9858 (at start of each task, Stage 2: Plan the Work)

**Added**: "Check for Material Changes Before Implementation"

**Context**: Before planning implementation approach for a task

**Specific Prompt:**
```
⚠️ MATERIAL CHANGE DETECTED at Task Implementation Start

Task {task_number} requires an approach that conflicts with earlier planning:
[Description: e.g., "Task needs real-time updates but Stage 3 architecture uses polling"]

This means:
- Architecture decision may be wrong for this use case
- Task spec may not reflect architectural constraints
- Implementation will diverge from planning
```

**Why Important:**
- Catches architectural mismatches at individual task level
- Options: revise architecture, update task, or document exception
- Prevents silent divergence from architectural decisions

## Material Change Detection Criteria

### What Qualifies as Material?

**4 Detection Questions** (from GUIDE.md):
1. **Does this contradict a confirmed stage?**
2. **Would this require re-architecting?**
3. **Would this invalidate planning decisions?**
4. **Would this require significant refactoring?**

### Material Change Examples

**✅ Material Changes** (require jump-back consideration):
- "Wait, this needs to work for external customers too" → **Stage 1 actors changed**
- "I thought we'd use GraphQL, but you've assumed REST" → **Stage 3 architecture invalidated**
- "This needs real-time updates, not polling" → **Stage 3 integration pattern wrong**
- "Actually this is for mobile, not desktop" → **Requirements and UI assumptions invalid**
- "We need admin dashboard too" → **Missing use case from Stage 1**
- "This must support 10K concurrent users" → **NFR changes Stage 2 requirements**

**❌ Non-Material Changes** (continue forward):
- "Can we add a tooltip here?" → UI refinement
- "Let's use blue instead of green" → Aesthetic choice
- "Can we add logging to this function?" → Enhancement
- "This error message should be clearer" → Improvement

## User Experience Flow

### Detection and Presentation

**When Claude Detects Material Change:**

1. **Pause before proceeding**
2. **Present clear consequence template:**
```
⚠️ MATERIAL CHANGE DETECTED

Your feedback indicates a fundamental change to [Stage/Phase X].

If we make this change now, we'll need to:
- Revisit: [affected stages/phases]
- Update: [affected artifacts]
- Refactor: [completed work]

Estimated rework: [assessment]

Options:
1. Jump back now and make the change (recommended if timeline allows)
2. Document as future enhancement and continue
3. Let me think about it (explain more)

What would you like to do?
```

### User Options

**Option 1: Jump Back** (recommended)
- Update GUIDE.md with jump-back rationale
- Mark subsequent work as "needs-review"
- Jump to affected stage/phase
- Re-execute with new understanding
- Re-confirm subsequent stages

**Option 2: Document and Continue**
- Document alternative in GUIDE.md Decision History
- Note trade-off in relevant planning docs
- Mark as technical debt if applicable
- Continue with current approach

**Option 3: Explain More**
- Provide deeper analysis of impacts
- Show affected files and decisions
- Estimate rework time
- Then return to Options 1-2

## Documentation Templates

### Jump-Back Documentation (GUIDE.md)

```markdown
## [Date] - Jump Back: [Current Phase] → [Target Stage]

**Reason:** [User feedback that revealed material change]

**What Changed:** [Specific contradiction or invalidated assumption]

**Affected Work:**
- Stages to revisit: [list]
- Planning artifacts to update: [list]
- Implementation to refactor: [list]

**Lessons:** [What this taught us about requirements gathering]
```

### Continue Documentation (GUIDE.md Decision History)

```markdown
## [Date] - Alternative Approach Not Taken

**User Feedback:** [what they suggested]

**Why It's Material:** [what it would change]

**Decision:** Continue with current approach because [timeline/scope/priority]

**Document for Future:** This could be addressed in [future work/phase/version]
```

### Git Commit Message (Jump-Back)

```
Jump back to [stage]: [brief reason]

User feedback revealed [material change]. Reverting to [stage]
to incorporate new understanding: [details]
```

## Complete Impact Analysis

### File Growth

| Milestone | Lines | Change | % Growth |
|-----------|-------|--------|----------|
| **Session Start** | 11,047 | - | - |
| After GUIDE.md Material Changes section | 11,146 | +99 | +0.9% |
| After Stage Execution Pattern check | 11,182 | +36 | +0.3% |
| After Phase 1→2 check | 11,211 | +29 | +0.3% |
| After Phase 2→3 check | 11,242 | +31 | +0.3% |
| After Phase 3→4 check | 11,272 | +30 | +0.3% |
| After Phase 2-D check | 11,302 | +30 | +0.3% |
| After Phase 3 task check | 11,334 | +32 | +0.3% |
| **Formatting cleanup** | **11,314** | **-20** | **-0.2%** |
| **TOTAL** | **11,314** | **+267** | **+2.4%** |

### Enhancement Breakdown

| Enhancement | Lines Added | % of Total | Checkpoints |
|-------------|-------------|------------|-------------|
| GUIDE.md Material Changes section | 99 | 37.1% | Foundation |
| Stage Execution Pattern (Stages 1-6) | 36 | 13.5% | 6 checkpoints |
| Phase 1→2 transition check | 29 | 10.9% | 1 checkpoint |
| Phase 2→3 transition check | 31 | 11.6% | 1 checkpoint |
| Phase 3→4 transition check | 30 | 11.2% | 1 checkpoint |
| Phase 2-D task creation check | 30 | 11.2% | 1 checkpoint |
| Phase 3 task implementation check | 32 | 12.0% | 1 per task |
| Formatting cleanup | -20 | -7.5% | Optimization |
| **TOTAL** | **267** | **100%** | **13 total checkpoints** |

## Benefits by Role

### For Claude (AI Agent)

**Detection Automation:**
- Clear criteria for detecting material changes
- Consistent detection across all workflow stages
- Unified templates reduce cognitive load

**Decision Support:**
- Options clearly presented to user
- Documentation requirements explicit
- Jump-back procedure standardized

**Quality Assurance:**
- Prevents building on faulty foundations
- Catches inconsistencies early when cheap to fix
- Ensures alignment across phases

### For Users

**Visibility:**
- Consequences of feedback made explicit
- Impact assessment before committing to change
- Options clearly presented with trade-offs

**Agency:**
- User decides whether to jump back or continue
- Can defer changes to future work if timeline-constrained
- "Explain more" option for complex decisions

**Documentation:**
- All decisions captured in GUIDE.md
- Rationale preserved for future reference
- Technical debt explicitly documented

### For Projects

**Consistency:**
- Planning docs match implementation
- No silent divergence from architectural decisions
- Scope changes explicitly acknowledged

**Technical Debt Management:**
- Known limitations documented
- Rationale for "continue despite issue" captured
- Future work clearly identified

**Risk Mitigation:**
- Fundamental issues caught early
- Cost of changes transparent
- Informed decision-making at each gate

## Strategic Placement of Checkpoints

### Stage-Level Checkpoints (6 total)

**Location**: Stage Execution Pattern (lines 924-959)
**Applies To**: Stages 1-6
**Triggers**: User confirmation of stage findings

**Why Here**:
- Each stage builds on previous confirmed stages
- Catching issues before next stage prevents cascade
- User feedback most likely to reveal contradictions at confirmation points

### Phase Transition Checkpoints (3 total)

**1. Phase 1→2 Transition** (lines 4966-4993)
- **Before**: Understanding complete
- **After**: Planning begins
- **Why**: Last chance to fix requirements cheaply

**2. Phase 2→3 Transition** (lines 9619-9647)
- **Before**: Planning complete
- **After**: Implementation begins
- **Why**: Last chance to fix design before code

**3. Phase 3→4 Transition** (lines 10915-10942)
- **Before**: Implementation complete
- **After**: Delivery begins
- **Why**: Ensure docs match reality before delivery

### Work Creation Checkpoints (2 total)

**1. Phase 2-D Task Creation** (lines 7171-7200)
- **Before**: Creating task files
- **Why**: Catch scope creep before tasks created

**2. Phase 3 Task Implementation** (lines 9829-9858)
- **Before**: Implementing each task
- **Why**: Catch architectural mismatches per task

## Before vs After Comparison

### Before Enhancement

**Scenario**: User says in Phase 3: "Wait, this needs to support external customers too"

**Old Behavior:**
- Claude might ask: "Should I add that feature?"
- User says yes
- Claude adds task without checking if Stage 1 covered external users
- Result: Scope creep, inconsistent planning, missing NFRs

**Issues:**
- No systematic detection of contradiction
- Impact not visible to user
- No option to jump back presented
- No documentation of decision
- Silent divergence from confirmed understanding

### After Enhancement

**Scenario**: Same user feedback in Phase 3

**New Behavior:**
1. **Claude detects** contradiction with Stage 1 (only internal users confirmed)
2. **Claude presents** consequences:
```
⚠️ MATERIAL CHANGE DETECTED

Your feedback adds external customer support, but Stage 1 only covered internal users.

To add this properly:
- Revisit: Stage 1 (add external user use cases)
- Update: Stage 2 (add external user NFRs), Stage 3 (add API authentication)
- Refactor: Tasks already created may need expansion

Estimated rework: ~2-4 hours to update planning phases

Options:
1. Jump back to Stage 1 and add external users properly
2. Document as "Phase 2" feature for next iteration
3. Explain more about what needs updating

What would you like to do?
```

3. **User chooses** (let's say Option 1)
4. **Claude executes**:
   - Updates GUIDE.md with jump-back rationale
   - Returns to Stage 1
   - Adds external customer use cases
   - Re-confirms with user
   - Progresses through Stage 2, 3, etc. with new understanding
   - Returns to Phase 3 with consistent planning

**Benefits:**
- Issue detected automatically
- Consequences clear to user
- User makes informed decision
- Proper jump-back execution
- Documentation captures reasoning
- Result: Consistent, complete planning

## Edge Cases Handled

### Multiple Affected Stages

**Scenario**: Feedback in Stage 4 contradicts Stage 2

**Handling**:
- Identify all affected stages (Stage 2 through current)
- Present complete impact
- If jump-back chosen, return to Stage 2
- Re-confirm Stage 2, 3, 4 sequentially

### Cascading Changes

**Scenario**: Jump-back to Stage 1 affects Stage 3 architecture

**Handling**:
- Mark Stage 3 as "needs-review"
- When reaching Stage 3, explicitly note: "Reviewing architecture given Stage 1 changes"
- Re-confirm architecture with updated context

### Late Discovery (Phase 3)

**Scenario**: Implementation reveals Stage 3 architecture won't work

**Handling**:
- Options include: update planning docs, refactor implementation, or document debt
- If update planning chosen: preserve implementation, update architecture.md to match
- Document why implementation diverged in GUIDE.md

### User Declines Jump-Back

**Scenario**: Material change detected but user wants to continue

**Handling**:
- Document alternative in GUIDE.md Decision History
- Note known limitation in affected planning docs
- Mark as technical debt if applicable
- Proceed forward with awareness

## Verification Checklist

To verify material change detection works:

**Stage-Level Detection:**
- [ ] Start craft session, reach Stage 1
- [ ] Provide feedback contradicting later stages
- [ ] Verify material change detection triggers
- [ ] Confirm options presented (jump-back, continue, explain)
- [ ] Test jump-back flow updates GUIDE.md correctly

**Phase Transition Detection:**
- [ ] Complete Phase 1, at Phase 1→2 gate
- [ ] Provide feedback contradicting Stage 3
- [ ] Verify detection and consequence presentation
- [ ] Test continue flow documents alternative

**Task-Level Detection:**
- [ ] In Phase 2-D, create tasks
- [ ] Propose task not in Stage 1 use cases
- [ ] Verify scope creep detection
- [ ] Test options (add use case, remove task, document expansion)

**Implementation Detection:**
- [ ] In Phase 3, start task
- [ ] Task requires approach conflicting with Stage 3
- [ ] Verify architectural conflict detection
- [ ] Test options (revise architecture, update task, document exception)

## Future Enhancements

### Automated Consistency Checking

**Potential**: Add automated checks that scan planning artifacts for contradictions
- Compare use-cases.md with tasks-pending/*.md (all use cases covered?)
- Compare architecture.md with implementation (all architectural patterns followed?)
- Compare requirements.md with quality-criteria.md (all NFRs measurable?)

### Confidence Scoring

**Potential**: Track confidence levels in decisions, flag low-confidence items for extra scrutiny
- Stage-level confidence: How certain are we about this stage?
- Decision-level confidence: How solid is this architectural choice?
- Material change likelihood: Predict which decisions most likely to need revision

### Impact Estimation

**Potential**: Automatically estimate rework hours based on affected artifacts
- Simple heuristic: 1 hour per stage, 2 hours per phase
- More sophisticated: analyze size of affected files, count dependencies

## Conclusion

This enhancement transforms craft.md from a linear workflow into a **self-correcting development system** that:

**Prevents Mistakes:**
- Detects contradictions automatically
- Makes impacts visible before committing
- Offers informed choices at each decision point

**Preserves Quality:**
- Ensures consistency across phases
- Prevents building on faulty foundations
- Documents all decisions with rationale

**Respects User Agency:**
- User decides whether to jump back or continue
- Options clearly presented with trade-offs
- "Explain more" available for complex decisions

**Maintains Documentation:**
- All jump-backs documented with rationale
- Alternatives documented if user continues
- Technical debt explicitly captured

**Result**: A workflow that gracefully handles evolving understanding, prevents costly late-stage discoveries, and ensures delivered work aligns with confirmed planning throughout.

**Total Enhancement**: +267 lines (+2.4%) adding 13 strategic material change detection checkpoints that prevent inconsistencies, make consequences visible, and ensure informed decision-making throughout the craft workflow.

**Final State**: craft.md at 11,314 lines with comprehensive material change detection protecting workflow integrity from Stage 1 through Phase 4 delivery.
