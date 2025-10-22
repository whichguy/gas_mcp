# craft.md Phase 2-C Enhancement: MCP Server Layout Integration

**Date:** 2025-01-12
**Enhancement:** MCP Server Organization Guidance Aligned with Poly Repo Architecture
**Impact:** Phase 2-C (Planning) Step 1 (Define Project Structure)

---

## Executive Summary

Enhanced craft.md's directory planning directive (Phase 2-C Step 1) to provide explicit guidance on MCP server organization within poly repo architecture. Added research step, three organizational patterns with decision criteria, and consistent documentation across planning artifacts.

**Core Enhancement:** MCP server placement decisions now receive same systematic treatment as service/library organization within poly repo context.

---

## Problem Statement

### Before Enhancement

craft.md had:
- ✅ Comprehensive poly repo guidance (lines 5774-5804)
- ✅ MCP server discovery and integration patterns (tooling.md)
- ✅ Source Code Layout Conventions section (lines 6028-6092)

**Gap identified:** No explicit guidance on WHERE MCP servers should be organized within poly repo architecture. Developers had to infer placement decisions without clear patterns or decision criteria.

### After Enhancement

craft.md now provides:
- ✅ MCP server organization research step (Phase 2-C Step 1)
- ✅ Three MCP server patterns with benefits/use cases (co-located, standalone, shared)
- ✅ Decision factors framework (workflow, deployment, versioning, reusability, ownership)
- ✅ Consistent documentation across architecture.md, project-structure.md, tooling.md templates

---

## Enhancement Details

### 1. Research Step Addition (Phase 2-C Step 1)

**Location:** Lines 5745-5749 (new step 5 in research process)
**Content:** Added MCP server organization research to planning phase

```markdown
5. **Research MCP server organization patterns (use WebSearch):**
   - "[framework] MCP server deployment patterns"
   - "MCP server repository organization best practices"
   - "MCP server co-location vs standalone repository"
   - Look for: service-specific vs shared server patterns, versioning strategies
```

**Why important:** Ensures MCP server organization decisions are research-driven rather than ad-hoc, matching the systematic approach used for service/library organization.

---

### 2. MCP Server Organization Patterns (Phase 2-C Step 1)

**Location:** Lines 5811-5824 (within poly repo considerations)
**Content:** Three patterns with clear decision criteria

#### Pattern 1: Co-located
- **Structure:** MCP server code in same repo as service (`<worktree>/mcp/`)
- **Benefits:** Version coupling, easier development, single deployment unit
- **Use when:** MCP server tightly coupled to specific service/API
- **Example:** Service-specific MCP tools for internal operations

#### Pattern 2: Standalone
- **Structure:** Dedicated repository per MCP server
- **Benefits:** Independent versioning, reusable across projects, clear boundaries
- **Use when:** MCP server provides general-purpose functionality
- **Example:** `mcp-database-tools` repo used by multiple services

#### Pattern 3: Shared Server
- **Structure:** Single repository hosting multiple related MCP servers
- **Benefits:** Reduced repo overhead, shared infrastructure, cohesive tooling
- **Use when:** Multiple small MCP servers share common dependencies
- **Example:** `mcp-cloud-tools` repo hosting AWS/Azure/GCP tool servers

#### Decision Factors
- Development workflow complexity
- Deployment strategy requirements
- Versioning coupling needs
- Reusability across projects
- Team ownership boundaries

**Why important:** Provides pattern library matching established poly repo decision-making for services/libraries, ensuring consistent organizational principles.

---

### 3. Source Code Layout Conventions Enhancement (Phase 2-C Step 1)

**Location:** Lines 6095-6100 (within architecture.md template "Poly Repo Integration" section)
**Content:** Added MCP Server Organization subsection to canonical architecture documentation

```markdown
**MCP Server Organization:**
- MCP server location strategy: [co-located with service, standalone repo, shared repo]
- MCP server structure: [where server code lives if co-located: mcp/, tools/, servers/]
- MCP server versioning: [how MCP server versions relate to service versions]
- MCP server dependencies: [shared dependencies between MCP servers if applicable]
- Integration points: [which service operations exposed via MCP, which external MCP tools consumed]
```

**Why important:**
- Makes MCP server decisions part of architectural documentation reviewed during planning
- Ensures task implementers reference consistent MCP server organization strategy
- Documents versioning and dependency relationships explicitly

---

### 4. project-structure.md Template Enhancement (Phase 2-C Step 1)

**Location:** Lines 5892-5921 (new section between "Cross-Repository Integration Points" and "Task-Based Development Structure")
**Content:** Added comprehensive MCP Server Organization section with concrete examples

**Subsections:**
1. **MCP Server Strategy:** Choice of co-located, standalone, or shared pattern
2. **Rationale:** Documented reasoning for organization choice
3. **MCP Server Location:** Directory structure example showing `mcp/` folder organization
4. **Related MCP Server Repositories:** Links to external MCP server repos if standalone/shared
5. **MCP Server Integration Points:** Operations exposed/consumed, versioning, auth

**Example Directory Structure:**
```
<worktree>/
├── src/                    # Service implementation code
├── mcp/                    # MCP server code (if co-located)
│   ├── server.js          # MCP server entry point
│   ├── tools/             # MCP tool implementations
│   │   ├── tool-one.js
│   │   └── tool-two.js
│   ├── config/            # MCP server configuration
│   └── README.md          # MCP server documentation
├── test/                   # Tests (including MCP tool tests)
└── ...
```

**Why important:**
- Provides concrete structural guidance for implementers
- Documents MCP server integration points for cross-team coordination
- Ensures versioning strategy is explicitly defined and followed

---

### 5. tooling.md Template Enhancement (Phase 2-C Step 2)

**Location:** Lines 6730-6731 (within MCP Servers section)
**Content:** Added repository organization metadata to each MCP server entry

```markdown
- **Repository Organization**: [Co-located in this repo at ./mcp/ | Standalone repo at <URL> | Part of shared server repo at <URL>]
- **Organization Rationale**: [Why this organization - matches project-structure.md MCP Server Strategy]
```

**Why important:**
- Links tooling documentation back to architectural decisions in project-structure.md
- Makes MCP server location immediately visible when reviewing tooling integration
- Ensures consistency between planning artifacts

---

## Implementation Impact

### Files Modified
- **File:** `~/.claude/commands/craft.md`
- **Starting lines:** 11,621
- **Ending lines:** 11,682
- **Net change:** +61 lines (+0.5%)

### Line Number Changes (Due to Insertions)

| Section | Original Lines | New Lines | Change |
|---------|---------------|-----------|--------|
| Research Step | 5739-5749 | 5745-5749 | +5 lines inserted |
| Poly Repo Considerations | 5774-5809 | 5780-5824 | +14 lines inserted |
| Source Code Layout | 6028-6094 | 6034-6106 | +6 lines inserted |
| project-structure.md | 5833-5892 | 5839-5921 | +30 lines inserted |
| tooling.md | 6727-6738 | 6727-6740 | +2 lines inserted |

**Total:** 5 locations enhanced, 61 lines added

---

## Benefits by Role

### For Product Owners
- **Visibility:** MCP server organization decisions documented in planning phase
- **Trade-offs:** Clear patterns show deployment/reusability trade-offs
- **Cost awareness:** Understand repo overhead vs reusability benefits

### For Architects
- **Pattern library:** Three established patterns with decision criteria
- **Consistency:** MCP servers follow same poly repo principles as services
- **Documentation:** Organization strategy documented in architecture.md

### For Developers
- **Clarity:** Know exactly where MCP server code should live
- **Examples:** Concrete directory structures with real-world scenarios
- **Integration:** Clear integration points between services and MCP servers

### For DevOps/Platform Teams
- **Deployment:** Organization pattern informs deployment strategy
- **Versioning:** Explicit versioning relationships documented
- **Boundaries:** Clear ownership boundaries for standalone/shared patterns

---

## Example Scenarios

### Scenario 1: Service-Specific MCP Server

**Context:** Building user authentication service that needs MCP tools for admin operations

**Decision Process:**
1. Research MCP server patterns (Step 5)
2. Evaluate: Tools tightly coupled to auth service internals
3. Choose: Co-located pattern
4. Document in project-structure.md: `./mcp/` with version coupling to service
5. Document in tooling.md: "Co-located in this repo at ./mcp/"

**Result:**
- Single deployment unit (service + MCP server)
- Version-coupled releases
- Simplified development workflow

---

### Scenario 2: General-Purpose Database MCP Server

**Context:** Building database migration tools usable across multiple services

**Decision Process:**
1. Research MCP server patterns (Step 5)
2. Evaluate: Tools reusable across 5+ services, need independent versioning
3. Choose: Standalone pattern
4. Document in project-structure.md: External repo `mcp-database-tools`
5. Document in tooling.md: "Standalone repo at github.com/org/mcp-database-tools"

**Result:**
- Reusable across projects
- Independent versioning (semver)
- Clear ownership boundaries

---

### Scenario 3: Cloud Provider Tools Collection

**Context:** Building MCP tools for AWS, Azure, GCP operations (each ~200 LOC)

**Decision Process:**
1. Research MCP server patterns (Step 5)
2. Evaluate: 3 small servers, shared AWS SDK dependencies, cohesive domain
3. Choose: Shared server pattern
4. Document in project-structure.md: `mcp-cloud-tools` repo hosts all 3
5. Document in tooling.md: "Part of shared server repo at github.com/org/mcp-cloud-tools"

**Result:**
- Reduced repo overhead (1 repo instead of 3)
- Shared infrastructure (AWS SDK, auth, config)
- Cohesive tooling domain

---

## Integration with Existing Workflow

### Phase 1 (Discovery)
- **No change:** MCP servers discovered during Stage 3 Architecture research
- **Enhancement:** Research now includes organization patterns (Step 5)

### Phase 2-A (Quality Criteria)
- **No change:** Quality criteria apply uniformly to all code (including MCP servers)

### Phase 2-B (Test Plan)
- **No change:** Test plan includes MCP tool testing
- **Enhancement:** MCP tool tests documented in test/ structure

### Phase 2-C (Planning)
- **ENHANCED:** Step 1 now includes MCP server organization decisions
- **NEW:** project-structure.md documents MCP server location
- **NEW:** architecture.md documents MCP server versioning/dependencies
- **NEW:** tooling.md links to organization strategy

### Phase 2-D (Task Breakdown)
- **No change:** Tasks reference architecture.md for MCP server location
- **Enhancement:** Tasks now have explicit MCP server organization context

### Phase 3 (Implementation)
- **No change:** Implementation follows documented structure
- **Enhancement:** Clearer where to place MCP server code

### Phase 4 (Delivery)
- **No change:** Delivery includes MCP server deployment if co-located
- **Enhancement:** Deployment strategy informed by organization pattern

---

## Documentation Consistency

### Three Planning Artifacts Enhanced

| Artifact | Purpose | MCP Server Content |
|----------|---------|-------------------|
| **architecture.md** | Canonical technical decisions | § Poly Repo Integration → MCP Server Organization (lines 6095-6100) |
| **project-structure.md** | Directory layout documentation | § MCP Server Organization with examples (lines 5892-5921) |
| **tooling.md** | Tool integration plan | § MCP Servers → Repository Organization per entry (lines 6730-6731) |

**Consistency pattern:**
1. architecture.md documents HIGH-LEVEL organization strategy and decision factors
2. project-structure.md documents CONCRETE directory structure and examples
3. tooling.md LINKS BACK to project-structure.md strategy for each MCP server

**Cross-reference flow:**
```
tooling.md (per-server)
    ↓ "matches project-structure.md MCP Server Strategy"
project-structure.md (concrete structure)
    ↓ "implements conventions documented in architecture.md § Poly Repo Integration"
architecture.md (canonical decisions)
```

---

## Comparison: Before vs After

### Before Enhancement

**Developer Question:** "Where should I put the MCP server code for this service?"

**Process:**
1. Check existing repos for patterns (inconsistent)
2. Ask team lead (knowledge in heads, not docs)
3. Make ad-hoc decision (not documented)
4. Implementation proceeds without architectural review

**Result:** Inconsistent MCP server organization across projects, undocumented decisions, difficult to find MCP server code

---

### After Enhancement

**Developer Question:** "Where should I put the MCP server code for this service?"

**Process:**
1. Read project-structure.md § MCP Server Organization (documented in planning phase)
2. See three patterns with decision criteria (co-located, standalone, shared)
3. Review architecture.md § Poly Repo Integration → MCP Server Organization for rationale
4. Follow documented structure (consistent with architectural decisions)

**Result:** Consistent MCP server organization, documented decisions, easy to locate MCP server code, alignment with poly repo principles

---

## Quality Gates Impact

### Phase 2-C Step 1 Quality Gate

**Before:** "Does the directory structure follow technology conventions?"

**After:** "Does the directory structure follow technology conventions **including MCP server organization**?"

**New checks:**
- ✅ MCP server pattern chosen (co-located, standalone, or shared)
- ✅ Decision rationale documented in project-structure.md
- ✅ MCP server versioning strategy documented
- ✅ Integration points identified (exposed/consumed MCP tools)

---

## Maintenance Notes

### When to Update This Enhancement

**Trigger scenarios:**
1. New MCP server organizational patterns emerge in community
2. Framework-specific MCP server conventions established
3. Deployment tooling changes affect MCP server organization preferences
4. Versioning strategies evolve (monorepo support, etc.)

### How to Update

1. **Research:** Run Phase 2-C Step 1 research step 5 with updated queries
2. **Patterns:** Update lines 5811-5824 with new patterns if discovered
3. **Templates:** Update architecture.md, project-structure.md, tooling.md templates
4. **Documentation:** Update this file with new patterns and rationale

---

## Related Enhancements

### Previously Completed (This Session)

1. **Material Change Detection** (docs/CRAFT_MATERIAL_CHANGE_DETECTION.md)
   - Lines: 11,047 → 11,269 (+222 lines, +2.0%)
   - Purpose: Detect when user feedback invalidates earlier planning decisions
   - 13 checkpoints across workflow phases

2. **Holistic Quality Review** (docs/CRAFT_HOLISTIC_QUALITY_REVIEW.md)
   - Lines: 11,269 → 11,621 (+352 lines, +3.1%)
   - Purpose: Comprehensive quality review of feature tasks before user presentation
   - 8 quality dimensions with issue categorization

3. **MCP Server Layout** (this document)
   - Lines: 11,621 → 11,682 (+61 lines, +0.5%)
   - Purpose: Explicit MCP server organization guidance aligned with poly repo architecture
   - 3 organizational patterns with decision criteria

### Cumulative Session Impact

- **Starting:** 11,047 lines
- **After 3 enhancements:** 11,682 lines
- **Total added:** +635 lines (+5.7%)
- **Total enhancement locations:** 5 + 11 + 5 = 21 locations
- **Total documentation:** 3 comprehensive docs (487 + 582 + this file lines)

---

## Success Metrics

### Adoption Indicators

**Short-term (1-2 projects):**
- [ ] MCP server organization documented in project-structure.md
- [ ] Rationale explicitly stated (not just "because I said so")
- [ ] tooling.md entries link back to organization strategy

**Medium-term (5+ projects):**
- [ ] Consistent pattern usage across projects (not ad-hoc per project)
- [ ] Pattern choice predictable based on use case (service-specific → co-located, etc.)
- [ ] Onboarding developers can find MCP server code location from docs alone

**Long-term (ecosystem):**
- [ ] Community patterns emerge and are incorporated into craft.md
- [ ] Framework-specific conventions discovered and documented
- [ ] Organization patterns referenced in team discussions ("We should use the co-located pattern here")

---

## Lessons Learned

### What Worked Well

1. **Pattern library approach:** Three patterns with clear decision criteria matches poly repo service organization style
2. **Consistent documentation:** Cross-referencing architecture.md ↔ project-structure.md ↔ tooling.md ensures alignment
3. **Concrete examples:** Directory structure diagrams make patterns immediately understandable
4. **Research-driven:** Adding research step ensures decisions informed by community practice

### Improvements for Future Enhancements

1. **Visual diagrams:** Could add ASCII art showing repo relationships for each pattern
2. **Migration paths:** Could document how to migrate between patterns (co-located → standalone)
3. **Performance implications:** Could add notes on deployment/build time trade-offs per pattern
4. **Testing patterns:** Could expand on MCP tool testing strategies per organization pattern

---

## Appendix: Full Text of Enhancements

### Enhancement 1: Research Step (Lines 5745-5749)

```markdown
5. **Research MCP server organization patterns (use WebSearch):**
   - "[framework] MCP server deployment patterns"
   - "MCP server repository organization best practices"
   - "MCP server co-location vs standalone repository"
   - Look for: service-specific vs shared server patterns, versioning strategies
```

---

### Enhancement 2: Organization Patterns (Lines 5811-5824)

```markdown
- **MCP server organization:**
  - **Co-located pattern**: MCP server code lives in same repository as service it supports
    * Benefits: Version coupling, easier development, single deployment unit
    * Use when: MCP server is tightly coupled to specific service/API
    * Example structure: `<worktree>/mcp/` alongside `<worktree>/src/`
  - **Standalone pattern**: Dedicated repository per MCP server
    * Benefits: Independent versioning, reusable across projects, clear boundaries
    * Use when: MCP server provides general-purpose functionality
    * Example: Separate repo `mcp-database-tools` used by multiple services
  - **Shared server pattern**: Single repository hosting multiple related MCP servers
    * Benefits: Reduced repo overhead, shared infrastructure, cohesive tooling
    * Use when: Multiple small MCP servers share common dependencies
    * Example: `mcp-cloud-tools` repo hosting AWS/Azure/GCP tool servers
  - **Decision factors:** Development workflow, deployment strategy, versioning needs, reusability, team ownership
```

---

### Enhancement 3: Source Code Layout (Lines 6095-6100)

```markdown
**MCP Server Organization:**
- MCP server location strategy: [co-located with service, standalone repo, shared repo - document choice with rationale]
- MCP server structure: [where server code lives if co-located: mcp/, tools/, servers/]
- MCP server versioning: [how MCP server versions relate to service versions]
- MCP server dependencies: [shared dependencies between MCP servers if applicable]
- Integration points: [which service operations exposed via MCP, which external MCP tools consumed]
```

---

### Enhancement 4: project-structure.md Section (Lines 5892-5921)

```markdown
## MCP Server Organization

**MCP Server Strategy:** [Co-located | Standalone | Shared]

**Rationale:** [Why this organization chosen - development workflow, deployment needs, reusability, team ownership]

**MCP Server Location (if co-located):**
```
<worktree>/
├── src/                    # Service implementation code
├── mcp/                    # MCP server code (if co-located)
│   ├── server.js          # MCP server entry point
│   ├── tools/             # MCP tool implementations
│   │   ├── tool-one.js
│   │   └── tool-two.js
│   ├── config/            # MCP server configuration
│   └── README.md          # MCP server documentation
├── test/                   # Tests (including MCP tool tests)
└── ...
```

**Related MCP Server Repositories (if standalone/shared):**
- [Repository name]: [Purpose and capabilities]
- [How this service integrates with MCP servers in other repos]

**MCP Server Integration Points:**
- [Which operations this service exposes via MCP tools]
- [Which MCP tools in other repos this service uses]
- [Versioning strategy for MCP server APIs]
- [Authentication/authorization for MCP tool access]
```

---

### Enhancement 5: tooling.md Entry Addition (Lines 6730-6731)

```markdown
- **Repository Organization**: [Co-located in this repo at ./mcp/ | Standalone repo at <URL> | Part of shared server repo at <URL>]
- **Organization Rationale**: [Why this organization - matches project-structure.md MCP Server Strategy]
```

---

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2025-01-12 | 1.0 | Initial documentation of MCP server layout enhancement |

---

**END OF DOCUMENT**
