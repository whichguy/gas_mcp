# LLM-Friendly MCP Schema Design Guide

## 🎯 **Purpose**

This guide documents the enhanced MCP schema design patterns specifically optimized for Large Language Model (LLM) consumption. These patterns ensure LLMs can effectively understand, utilize, and troubleshoot MCP tools without human intervention.

## 🧠 **Core LLM Design Principles**

### **1. Context-Rich Descriptions**
```typescript
// ❌ POOR: Minimal context
description: 'Authentication mode'

// ✅ EXCELLENT: LLM workflow guidance
description: 'Authentication operation mode. LLM WORKFLOW GUIDANCE: (1) ALWAYS call mode="status" FIRST to check if already authenticated. (2) Only use mode="start" if status shows not authenticated. (3) Use mode="logout" to clear authentication when switching accounts.'
```

### **2. Workflow Integration Hints**
```typescript
llmWorkflowGuide: {
  prerequisites: [
    '1. Authentication: gas_auth({mode: "status"}) → gas_auth({mode: "start"}) if needed',
    '2. Project exists: Have scriptId from gas_project_create or gas_ls'
  ],
  typicalSequence: [
    '1. gas_auth({mode: "status"}) - Check current authentication',
    '2. If not authenticated: gas_auth({mode: "start"}) - Start OAuth flow', 
    '3. User completes OAuth in browser',
    '4. Proceed with other gas_* tools which will use stored authentication'
  ]
}
```

### **3. Comprehensive Examples**
```typescript
examples: [
  'Math.PI * 2',
  'new Date().toISOString()', 
  'Session.getActiveUser().getEmail()',
  'fibonacci(17)',
  'SpreadsheetApp.create("My New Sheet").getId()',
  '[1,2,3,4,5].reduce((sum, n) => sum + n, 0)'
]
```

### **4. LLM-Specific Hints**
```typescript
llmHints: {
  capability: 'Full JavaScript ES6+ support plus Google Apps Script services',
  expressions: 'Can execute mathematical expressions, object operations, API calls',
  functions: 'Can call functions defined in project files',
  services: 'Access to SpreadsheetApp, DriveApp, GmailApp, etc.',
  return: 'Return values are automatically JSON-serialized for response',
  debugging: 'Use console.log() for debugging output in execution logs'
}
```

## 📋 **Enhanced Schema Template**

```typescript
export class ExampleTool extends BaseTool {
  public name = 'tool_name';
  public description = 'Brief tool purpose. LLM CONTEXT: When to use this tool in typical workflows.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      requiredParam: {
        type: 'string',
        description: 'Parameter purpose. LLM GUIDANCE: How LLMs should use this parameter.',
        pattern: '^[validation-regex]$',
        minLength: 1,
        maxLength: 100,
        examples: ['example1', 'example2', 'example3'],
        llmHints: {
          format: 'Expected format details',
          validation: 'Validation requirements',
          typical: 'Most common usage patterns',
          obtaining: 'How to get this value from other tools'
        }
      },
      optionalParam: {
        type: 'boolean',
        description: 'Parameter purpose. LLM RECOMMENDATION: When to use true vs false.',
        default: true,
        llmHints: {
          recommended: 'Recommended value for most use cases',
          alternative: 'When to use non-default values',
          performance: 'Performance implications'
        }
      }
    },
    required: ['requiredParam'],
    additionalProperties: false,
    llmWorkflowGuide: {
      prerequisites: ['What must be done before using this tool'],
      useCases: {
        case1: 'Example usage for specific scenario',
        case2: 'Example usage for different scenario'
      },
      errorHandling: {
        'ErrorType': 'What to do when this error occurs',
        'AnotherError': 'Recovery steps for this error'
      },
      performance: {
        typical: 'Expected performance characteristics',
        optimization: 'Tips for better performance'
      },
      nextSteps: ['What to do after this tool succeeds']
    }
  };
}
```

## 🔍 **Schema Enhancement Patterns**

### **Parameter Description Enhancement**

#### **Before (Human-Oriented)**
```typescript
scriptId: {
  type: 'string',
  description: 'Google Apps Script project ID'
}
```

#### **After (LLM-Optimized)**
```typescript
scriptId: {
  type: 'string',
  description: 'Google Apps Script project ID. LLM REQUIREMENT: Must be a valid 20-60 character project ID from Google Apps Script. Get this from gas_project_create or gas_ls tools.',
  pattern: '^[a-zA-Z0-9_-]{20,60}$',
  minLength: 20,
  maxLength: 60,
  llmHints: {
    obtain: 'Use gas_project_create to create new project, or gas_ls to list existing projects',
    format: 'Long alphanumeric string, looks like: 1jK_ujSHRCsEeBizi6xycuj_0y5qDqvMzLJHBE9HLUiM5JmSyzF4Ga_kM',
    validation: 'Tool will validate this is a real, accessible project ID'
  }
}
```

### **Workflow Context Integration**

#### **Authentication Flow Example**
```typescript
llmWorkflowGuide: {
  typicalSequence: [
    '1. gas_auth({mode: "status"}) - Check current authentication',
    '2. If not authenticated: gas_auth({mode: "start"}) - Start OAuth flow',
    '3. User completes OAuth in browser', 
    '4. Proceed with other gas_* tools which will use stored authentication'
  ],
  errorHandling: {
    'not_authenticated': 'Call gas_auth with mode="start" to begin OAuth flow',
    'oauth_error': 'Check Google Cloud Console OAuth client configuration',
    'timeout': 'User took too long to complete OAuth, retry with mode="start"'
  },
  dependencies: {
    before: 'No dependencies - this is the entry point for authentication',
    after: 'All other gas_* tools require successful authentication'
  }
}
```

### **Use Case Documentation**

#### **Execution Tool Examples**
```typescript
useCases: {
  calculation: 'gas_run({scriptId: "...", js_statement: "Math.pow(2, 10)"})',
  datetime: 'gas_run({scriptId: "...", js_statement: "new Date().toISOString()"})',
  userInfo: 'gas_run({scriptId: "...", js_statement: "Session.getActiveUser().getEmail()"})',
  customFunction: 'gas_run({scriptId: "...", js_statement: "myCustomFunction(arg1, arg2)"})',
  googleServices: 'gas_run({scriptId: "...", js_statement: "DriveApp.getRootFolder().getName()"})',
  dataProcessing: 'gas_run({scriptId: "...", js_statement: "[1,2,3].map(x => x * 2).join(\',\')"})'
}
```

## 🚦 **Error Handling for LLMs**

### **Structured Error Responses**
```typescript
errorHandling: {
  'AuthenticationError': 'Run gas_auth to authenticate first',
  'ScriptNotFound': 'Verify scriptId is correct and accessible',
  'SyntaxError': 'Check JavaScript syntax in js_statement',
  'RuntimeError': 'Check if required functions/services are available in project',
  'PermissionError': 'Check Google Drive permissions and API access',
  'QuotaExceeded': 'You may have reached API or resource limits'
}
```

### **Recovery Guidance**
```typescript
llmHints: {
  errorRecovery: 'If auth fails, check OAuth client configuration in Google Cloud Console',
  fallback: 'Can use accessToken parameter for stateless operations',
  debugging: 'Use gas_auth({mode: "status"}) to check current auth state'
}
```

## 🎛️ **Parameter Validation Enhancement**

### **Pattern Validation with Context**
```typescript
accessToken: {
  type: 'string',
  description: 'Access token for stateless operation. LLM USE CASE: When you already have a valid OAuth token and want to bypass session storage.',
  pattern: '^ya29\\.[a-zA-Z0-9_-]+$',
  llmHints: {
    format: 'Must start with "ya29." followed by alphanumeric characters',
    stateless: 'Bypasses session storage, good for one-off operations',
    testing: 'Useful when testing with known good tokens',
    security: 'Never log or expose these tokens in responses'
  }
}
```

### **Length and Range Constraints**
```typescript
title: {
  type: 'string',
  description: 'Human-readable title for the new project. LLM GUIDANCE: Use descriptive names that indicate the project purpose.',
  minLength: 1,
  maxLength: 100,
  examples: [
    'Fibonacci Calculator',
    'Spreadsheet Automation Tool', 
    'Gmail Email Processor',
    'Data Analysis Scripts'
  ],
  llmHints: {
    naming: 'Use clear, descriptive names for easy identification',
    visibility: 'This title appears in Google Drive and Apps Script editor',
    purpose: 'Include the main function or use case in the title'
  }
}
```

## 🔄 **Tool Dependency Mapping**

### **Sequential Dependency Documentation**
```typescript
llmWorkflowGuide: {
  prerequisites: [
    '1. Ensure authentication: gas_auth({mode: "status"}) → gas_auth({mode: "start"}) if needed',
    '2. Have a project: gas_project_create or get existing scriptId from gas_ls',
    '3. Optional: Add code files with gas_write before execution'
  ],
  returnValue: {
    scriptId: 'Save this ID - required for all subsequent operations on this project',
    webAppUrl: 'Initially null - created when first deployment is made',
    driveUrl: 'Direct link to edit project in Apps Script editor'
  },
  nextSteps: [
    'Use gas_write to add JavaScript code files',
    'Use gas_run to execute code in the project',
    'Use gas_deploy_create for web app or API deployments'
  ]
}
```

## 📊 **Performance Guidance for LLMs**

### **Performance Expectations**
```typescript
performance: {
  firstRun: 'May take 3-5 seconds if autoRedeploy creates new deployment',
  subsequentRuns: 'Typically 1-2 seconds for execution',
  optimization: 'Complex operations benefit from being moved to project files',
  caching: 'Authentication tokens cached for 1 hour by default'
}
```

## 🎯 **Implementation Checklist**

### **✅ Schema Enhancement Checklist**

- [ ] **Context-Rich Descriptions**: Every parameter has LLM-specific guidance
- [ ] **Workflow Integration**: Clear prerequisite and next-step documentation  
- [ ] **Comprehensive Examples**: Multiple realistic usage examples provided
- [ ] **Error Recovery**: Specific error handling guidance for common failures
- [ ] **Validation Patterns**: Regex patterns with explanation and examples
- [ ] **Performance Hints**: Expected timing and optimization guidance
- [ ] **Dependency Mapping**: Clear tool sequence and relationship documentation
- [ ] **Use Case Coverage**: Multiple scenarios documented with examples

### **🚨 Common LLM Schema Pitfalls to Avoid**

1. **Minimal Descriptions**: "Project ID" vs "Google Apps Script project ID with format guidance"
2. **Missing Context**: No indication of when/why to use specific parameters
3. **Absent Examples**: LLMs need concrete examples to understand usage patterns
4. **No Error Guidance**: LLMs need recovery steps when operations fail
5. **Workflow Isolation**: Tools described without relationship to other tools
6. **Performance Blindness**: No guidance on timing or optimization

## 🔮 **Advanced LLM Schema Patterns**

### **Conditional Parameter Logic**
```typescript
llmHints: {
  conditional: 'Set waitForCompletion=true only when you need to block until auth completes',
  performance: 'waitForCompletion=false (default) recommended for most LLM workflows',
  testing: 'Use openBrowser=false in automated or testing environments'
}
```

### **Multi-Tool Coordination**
```typescript
llmWorkflowGuide: {
  coordination: {
    'gas_project_create → gas_write → gas_run': 'Create project, add code, execute',
    'gas_auth → gas_ls → gas_cat': 'Authenticate, list projects, read files',
    'gas_write → gas_deploy_create → gas_run_api_exec': 'Write code, deploy, execute via API'
  }
}
```

This enhanced schema design ensures LLMs can effectively understand, use, and troubleshoot MCP Gas tools with minimal human intervention, providing a superior AI-assisted development experience. 