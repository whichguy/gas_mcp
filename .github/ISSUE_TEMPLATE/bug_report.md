---
name: Bug Report
about: Create a report to help us improve the MCP Gas Server
title: '[BUG] '
labels: 'bug'
assignees: ''
---

## 🐛 Bug Description
A clear and concise description of what the bug is.

## 🔄 Steps to Reproduce
Steps to reproduce the behavior:
1. Run command '...'
2. Use tool '...'
3. See error

## ✅ Expected Behavior
A clear and concise description of what you expected to happen.

## ❌ Actual Behavior
A clear and concise description of what actually happened.

## 🖼️ Screenshots/Logs
If applicable, add screenshots or log output to help explain your problem.

## 🖥️ Environment
**Operating System:** [e.g. macOS 14.5, Windows 11, Ubuntu 22.04]
**Node.js Version:** [e.g. v18.17.0]
**npm Version:** [e.g. v9.6.7]
**MCP Gas Server Version:** [e.g. v1.0.0]
**IDE/Client:** [e.g. Cursor, Claude Desktop]

## 🔍 Additional Context
- Are you using OAuth authentication?
- What Google Apps Script permissions do you have?
- Any custom configuration?
- Error messages from browser console?

## 📋 Debugging Information
Please run the following and include output:
```bash
npm start 2>&1 | head -20
node --version
npm --version
```

## 🧪 Minimal Reproduction
If possible, provide a minimal code example that reproduces the issue:

```typescript
// Example that causes the bug
await gas_auth({ mode: "start" });
// ... other relevant code
``` 