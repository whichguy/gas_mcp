# Plan: Improve mcp_gas Server to Prevent HTML/CommonJS Wrapper Bug

## Background

An HTML file (`sheets-sidebar/css/SidebarBubbles.html`) was incorrectly wrapped with CommonJS module code when using `mcp__gas__write()`, breaking the GAS sidebar. The root cause was that `write()` applied CommonJS wrapping when it shouldn't have.

## Problem Analysis

### Current Detection Gaps

**`determineFileType()` in contentAnalyzer.ts (lines 35-48):**
- Only checks if content starts with `<!DOCTYPE` or `<html>`
- Does NOT check filename extension (`.html`)
- Does NOT detect `<style>` tags, scriptlets, etc.

**`detectContentFileTypeMismatch()` in contentAnalyzer.ts (lines 77-114):**
- Only blocks when content starts with `<!doctype`, `<html`, or `<?xml`
- Does NOT check filename extension
- A file named `foo.html` with `<style>` content passes through as SERVER_JS

### Why the Bug Occurred

1. File was `SidebarBubbles.html` (`.html` extension)
2. Content was `<style>...</style>` (not `<!DOCTYPE` or `<html>`)
3. Auto-detection returned `SERVER_JS` (default fallback)
4. CommonJS wrapper was applied, breaking the HTML

---

## Implementation Plan

### Change 1: Add Filename Extension Check to `determineFileType()`

**File:** `src/utils/contentAnalyzer.ts`
**Location:** Lines 35-48

**Current:**
```typescript
export function determineFileType(filename: string, content: string): string {
  if (isManifestFile(filename)) {
    return 'JSON';
  }
  const trimmed = content.trim();
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html>')) {
    return 'HTML';
  } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return 'JSON';
  } else {
    return 'SERVER_JS';
  }
}
```

**New:**
```typescript
export function determineFileType(filename: string, content: string): string {
  if (isManifestFile(filename)) {
    return 'JSON';
  }

  // Check filename extension first (strongest signal)
  const lowerFilename = filename.toLowerCase();
  if (lowerFilename.endsWith('.html') || lowerFilename.endsWith('.htm')) {
    return 'HTML';
  }
  if (lowerFilename.endsWith('.json')) {
    return 'JSON';
  }

  const trimmed = content.trim();
  const trimmedLower = trimmed.toLowerCase();

  // Expanded HTML detection patterns
  if (trimmedLower.startsWith('<!doctype') ||
      trimmedLower.startsWith('<html') ||
      trimmedLower.startsWith('<?xml') ||
      /^<style[\s>]/i.test(trimmed) ||
      /^<head[\s>]/i.test(trimmed) ||
      /^<body[\s>]/i.test(trimmed) ||
      /^\s*<\?!?=/.test(trimmed)) {  // GAS scriptlets
    return 'HTML';
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return 'JSON';
  }

  return 'SERVER_JS';
}
```

### Change 2: Add Filename Extension Block to `detectContentFileTypeMismatch()`

**File:** `src/utils/contentAnalyzer.ts`
**Location:** After line 86 (after `if (declaredFileType !== 'SERVER_JS') return null;`)

**Add:**
```typescript
// DEFENSIVE: Filename extension is authoritative - block obvious mistakes
const lowerFilename = filename.toLowerCase();
if (lowerFilename.endsWith('.html') || lowerFilename.endsWith('.htm')) {
  return {
    mismatch: true,
    detectedType: 'HTML',
    message: 'File has .html extension but fileType is SERVER_JS. ' +
             'HTML files cannot have CommonJS wrappers. ' +
             'Use raw_write() for HTML files or omit fileType for auto-detection.'
  };
}
```

**Also add expanded HTML content patterns after line 111:**
```typescript
// Check for additional HTML patterns (CSS, inline scripts, GAS scriptlets)
if (/<style[\s>]/i.test(content) ||
    /^<script[\s>]/i.test(content) ||
    /<head[\s>]/i.test(content) ||
    /<body[\s>]/i.test(content) ||
    /^\s*<\?!?=/.test(content)) {  // GAS scriptlets
  return {
    mismatch: true,
    detectedType: 'HTML',
    message: 'Content contains HTML patterns but fileType is SERVER_JS. ' +
             'Use raw_write() for HTML files or omit fileType for auto-detection.'
  };
}
```

### Change 3: Update FILE_TYPE_SCHEMA with llmHints

**File:** `src/tools/filesystem/shared/schemas.ts`
**Location:** Lines 16-21

**Current:**
```typescript
export const FILE_TYPE_SCHEMA = {
  type: 'string',
  description: 'Explicit file type for Google Apps Script (optional). If not provided, auto-detected from content.',
  enum: ['SERVER_JS', 'HTML', 'JSON'],
  examples: ['SERVER_JS', 'HTML', 'JSON']
} as const;
```

**New:**
```typescript
export const FILE_TYPE_SCHEMA = {
  type: 'string',
  description: 'File type (optional - auto-detected from filename/content). ⚠️ For .html files, use raw_write() instead of write() to avoid CommonJS wrapping.',
  enum: ['SERVER_JS', 'HTML', 'JSON'],
  examples: ['SERVER_JS', 'HTML', 'JSON'],
  llmHints: {
    autoDetection: 'Usually omit - auto-detected from filename extension (.html→HTML, .json→JSON)',
    htmlWarning: 'NEVER use SERVER_JS for .html files - use raw_write() or omit fileType',
    default: 'SERVER_JS is applied to .gs/.js files and triggers CommonJS wrapping'
  }
} as const;
```

### Change 4: Update CONTENT_SCHEMA llmHints

**File:** `src/tools/filesystem/shared/schemas.ts`
**Location:** Lines 80-90

**Add to llmHints:**
```typescript
llmHints: {
  toolChoice: 'write: new/large changes | edit: exact text (~10 tok) | aider: fuzzy (~10 tok) | 95%+ savings for small edits',
  htmlWarning: 'For HTML/CSS files, use raw_write() - write() adds CommonJS wrapper that breaks HTML'
}
```

---

## Files to Modify

| File | Changes | Priority |
|------|---------|----------|
| `src/utils/contentAnalyzer.ts` | Add filename extension checks + expanded HTML patterns | HIGH |
| `src/tools/filesystem/shared/schemas.ts` | Add llmHints for HTML warning | MEDIUM |

---

## Verification

1. **Build mcp_gas:**
   ```bash
   cd ~/src/mcp_gas && npm run build
   ```

2. **Test auto-detection:**
   ```javascript
   // Should return 'HTML' (filename wins)
   determineFileType('foo.html', 'function test() {}')

   // Should return 'HTML' (content pattern)
   determineFileType('foo', '<style>.class{}</style>')
   ```

3. **Test mismatch detection:**
   ```javascript
   // Should block with error
   detectContentFileTypeMismatch('<style>...</style>', 'SERVER_JS', 'foo.html')
   // Returns: { mismatch: true, detectedType: 'HTML', message: '...' }
   ```

4. **Integration test:**
   ```javascript
   // This should now fail with clear error message
   mcp__gas__write({
     scriptId: '...',
     path: 'test.html',
     content: '<style>.foo{}</style>',
     fileType: 'SERVER_JS'  // Explicit wrong type
   })
   ```

5. **Restart Claude Code** after build to pick up MCP changes
