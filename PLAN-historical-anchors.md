# Historical Anchors Implementation Plan

## Status: In Progress

**ScriptId:** `1Y72rigcMUAwRd7bwl3CR57O6ENo5sKTn0xAl2C4HoZys75N5utGfkCUG`
**Date:** 2026-01-04

---

## Overview

Historical Anchors is a lightweight layer (~160 LOC) that preserves structural facts (URLs, files, errors, decisions) across thread continuations. Thread continuation triggers at 140K tokens or 80 messages, creating a new thread with inherited context.

### Key Design Decisions
- **Deterministic regex-based extraction** (not LLM) for 100% reliability
- **Anchor limit:** Keep last 20 thread anchors (~2K tokens total)
- **Anchor types:** URLs, file paths, error patterns, decisions, code references

---

## Completed Tasks

### 1. AnchorExtractor Module (`sheets-chat/AnchorExtractor`)
- [x] Created regex-based extraction for URLs, files, errors, decisions
- [x] `extractAnchors(messages)` - extracts anchors from conversation messages
- [x] `mergeAnchors(existing, new)` - merges and deduplicates anchors
- [x] Exports: `{ extractAnchors, mergeAnchors }`

### 2. SystemPrompt Updates (`sheets-chat/SystemPrompt`)
- [x] Added `formatHistoricalAnchors(anchors)` - formats anchors for system prompt
- [x] Updated `buildSystemPrompt(knowledge, historicalAnchors)` to accept anchors parameter
- [x] Historical context section appears in generated prompts when anchors provided

### 3. ClaudeConversation Wiring (`sheets-chat/ClaudeConversation`)
- [x] Added `historicalAnchors` to params extraction in `sendMessage()`
- [x] Updated `_buildSystemPrompt(knowledge, historicalAnchors)` signature
- [x] Passes `historicalAnchors` to SystemPrompt.buildSystemPrompt()

### 4. UISupport Wiring (`sheets-chat/UISupport`)
- [x] Extract `historicalAnchors` from params in `sendMessageToClaude()`
- [x] Pass `historicalAnchors` to `claude.sendMessage()`

### 5. ThreadContinuation Integration (`sheets-chat/ThreadContinuation`)
- [x] Uses AnchorExtractor during thread continuation
- [x] Preserves anchors across thread boundaries

---

## Pending Tasks

### Deferred: require.js / QueueManager Fix
**Status:** Deferred - not blocking Historical Anchors feature

The QueueManager constructor export issue (`typeof QueueManager === 'object'` instead of `function`) exists but doesn't block the Historical Anchors feature since:
- Historical Anchors doesn't depend on QueueManager
- Thinking message queue still functions (issue is with fresh loads only)

If needed later:
1. Check `__defineModule__` signature handling
2. Verify module.exports assignment propagates correctly
3. Test with cache clearing

### Historical Anchors Completion

1. **Quality review all Historical Anchors changes**

   Files to review:
   - `sheets-chat/AnchorExtractor` - Regex patterns, extraction logic
   - `sheets-chat/SystemPrompt` - formatHistoricalAnchors(), buildSystemPrompt()
   - `sheets-chat/ClaudeConversation` - Parameter threading
   - `sheets-chat/UISupport` - Parameter extraction and passing
   - `sheets-chat/ThreadContinuation` - Anchor usage during continuation

   Review checklist:
   - [ ] No syntax errors
   - [ ] Proper error handling
   - [ ] Consistent parameter naming
   - [ ] JSDoc comments present
   - [ ] No unused imports/variables

2. **Add unit tests for AnchorExtractor**

   Test file: `sheets-chat/test/AnchorExtractor.unit.test.js`

   Test cases:
   - [ ] Extract URLs from messages
   - [ ] Extract file paths from messages
   - [ ] Extract error patterns from messages
   - [ ] Extract decisions from messages
   - [ ] Merge anchors without duplicates
   - [ ] Handle empty messages array
   - [ ] Handle messages without anchors
   - [ ] Respect anchor limit (20 max)

3. **Test end-to-end thread continuation with anchors**

   Manual test steps:
   1. Start a conversation with URLs and file references
   2. Continue until thread continuation triggers (or force it)
   3. Verify anchors appear in new thread's system prompt
   4. Verify Claude acknowledges historical context

   Automated test:
   - [ ] Create integration test that simulates thread continuation
   - [ ] Verify anchor extraction and formatting
   - [ ] Verify system prompt includes historical section

---

## File Reference

### Modified Files
| File | Changes |
|------|---------|
| `sheets-chat/AnchorExtractor` | NEW - Regex-based anchor extraction |
| `sheets-chat/SystemPrompt` | Added formatHistoricalAnchors(), updated buildSystemPrompt() |
| `sheets-chat/ClaudeConversation` | Added historicalAnchors parameter throughout |
| `sheets-chat/UISupport` | Added historicalAnchors extraction and passing |
| `sheets-chat/ThreadContinuation` | Integrated AnchorExtractor |

### Test Commands
```javascript
// Test anchor formatting exists and works
const { formatHistoricalAnchors } = require('sheets-chat/SystemPrompt');
formatHistoricalAnchors([{type: 'url', value: 'https://example.com', context: 'test'}]);

// Test system prompt includes anchors
const { buildSystemPrompt } = require('sheets-chat/SystemPrompt');
const prompt = buildSystemPrompt(null, [{type: 'url', value: 'https://example.com'}]);
prompt.includes('Historical Context');

// Test AnchorExtractor
const { extractAnchors } = require('sheets-chat/AnchorExtractor');
extractAnchors([{role: 'user', content: 'Check https://example.com and file.js:42'}]);
```

---

## Notes

- QueueManager issue deferred - doesn't block this feature
- Previous session had file corruption from mcp__gas__aider - fixed with direct Edit tool
