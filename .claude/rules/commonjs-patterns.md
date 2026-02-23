---
paths:
  - "src/utils/moduleWrapper.ts"
  - "src/utils/hoistedFunctionGenerator.ts"
---

## CommonJS Integration

- User writes clean code → `write` wraps with `_main()` function
- GAS executes wrapped code → `require()` resolves dependencies
- `cat` unwraps for editing → maintains clean code workflow
