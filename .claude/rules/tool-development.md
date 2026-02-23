---
paths:
  - "src/tools/**"
  - "src/core/git/operations/**"
---

## Tool Development

- All tools in `src/tools/` extend `BaseTool` from `src/tools/base.ts`
- Input schemas define parameters with TypeScript types + validation
- Tools must be registered in `src/server/mcpServer.ts`

## File Operations

- **Smart tools** (cat, write, etc.): Auto-handle CommonJS wrapping/unwrapping
- **Raw tools** (raw_cat, raw_write, etc.): Preserve exact content including system wrappers
- Virtual files: `.gitignore` ↔ `.gitignore.gs` (but `.git/config` stays as-is, no extension)
