# CommonJS Module System — Deep Dive

Additional detail on module logging, response enhancement, and debugging for the CommonJS module system. For core concepts (runtime, loading options, hoisted functions), see the main [CLAUDE.md](../CLAUDE.md).

## Module Logging Control (Debugging CommonJS)

The CommonJS module system provides four global functions for controlling per-module debug logging:

### Enable Logging

```javascript
// Enable all modules
exec({scriptId, js_statement: "setModuleLogging('*', true)"})

// Enable specific folder
exec({scriptId, js_statement: "setModuleLogging('auth/*', true)"})

// Enable specific modules
exec({scriptId, js_statement: "setModuleLogging(['api/Handler', 'auth/Client'], true)"})
```

### Disable or Exclude

```javascript
// Disable specific module (when * is enabled)
exec({scriptId, js_statement: "setModuleLogging('auth/NoisyModule', false, 'script', true)"})
```

### Query and Clear

```javascript
exec({scriptId, js_statement: "getModuleLogging()"})       // Get all settings
exec({scriptId, js_statement: "listLoggingEnabled()"})     // List enabled patterns
exec({scriptId, js_statement: "clearModuleLogging()"})     // Clear all
```

### Pattern Matching

- Exact name: `'auth/SessionManager'` - matches exactly
- Folder pattern: `'auth/*'` - matches all modules in auth/
- Wildcard: `'*'` - matches all modules
- Exclusion precedence: `false` takes precedence over `true`

### Typical Debugging Workflow

1. `setModuleLogging('*', true)` - Enable all logging
2. Execute your code
3. Review `logger_output` in exec result
4. `clearModuleLogging()` - Clean up

## Response Enhancement (write/raw_write)

Write operations return additional metadata:

- `local: {path, exists}` — when file written locally
- `git: {associated, syncFolder}` — when `.git/config` breadcrumbs found
- `git: {localGitDetected, breadcrumbExists, recommendation?}` — git discovery
  - Automatically detects local git repos at `~/gas-repos/project-{scriptId}/`
  - Checks for `.git/config` breadcrumb in GAS project
  - Provides sync recommendation if local git found but no breadcrumb
  - Example: `{localGitDetected: true, breadcrumbExists: false, recommendation: {action: 'rsync', command: '...'}}`
- Git association signals local sync folder available for standard git commands
