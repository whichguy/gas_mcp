# Repository Structure

This document outlines the recommended directory structure for the MCP Google Apps Script project.

## **Current Structure (Recommended)**

```
mcp_gas/
├── README.md                           # Main project documentation
├── package.json                        # Node.js dependencies and scripts
├── package-lock.json                   # Locked dependency versions
├── tsconfig.json                       # TypeScript configuration
├── .gitignore                          # Git ignore patterns
├── .mocharc.json                       # Test configuration
│
├── src/                                # MCP Server Source Code
│   ├── index.ts                        # Main MCP server entry point
│   ├── api/                            # Google Apps Script API clients
│   ├── auth/                           # OAuth authentication logic
│   ├── tools/                          # MCP tool implementations
│   ├── utils/                          # Utility functions
│   └── server/                         # MCP server implementation
│
├── test/                               # Test Suite
│   ├── api/                            # API tests
│   ├── auth/                           # Authentication tests
│   ├── integration/                    # Integration tests
│   ├── system/                         # System tests
│   └── utils/                          # Test utilities
│
├── config/                             # Configuration Files
│   ├── oauth.json                      # OAuth configuration
│   └── oauth-debug.json               # Debug OAuth settings
│
├── scripts/                            # Build and utility scripts
│   ├── direct-call.ts                  # Direct call testing
│   └── test-integration.sh             # Integration test runner
│
├── docs/                               # Documentation
│   ├── API_REFERENCE.md                # API documentation
│   ├── OAUTH_SINGLETON_ARCHITECTURE.md # Auth architecture docs
│   └── SCHEMAS_AND_VALIDATION.md       # Schema documentation
│
├── gas-projects/                       # Google Apps Script Projects
│   ├── README.md                       # GAS projects documentation
│   ├── fibonacci-calculator/           # Individual GAS project
│   │   ├── README.md                   # Project-specific docs
│   │   ├── project-info.json           # Project metadata
│   │   ├── src/                        # Source files
│   │   │   ├── appsscript.json         # GAS manifest
│   │   │   ├── fibonacci.gs            # Main Fibonacci functions
│   │   │   ├── test-stringUtils.gs     # String utility functions
│   │   │   └── __mcp_gas_run.gs        # MCP runtime shim
│   │   └── deployments/                # Deployment configs
│   │       └── deployment-info.json    # Deployment metadata
│   │
│   └── template/                       # Project template
│       ├── README.md                   # Template documentation
│       ├── src/                        # Template source files
│       │   └── appsscript.json         # Base manifest
│       └── .clasp.json.template        # Clasp configuration template
│
├── dist/                               # Compiled output (git-ignored)
├── node_modules/                       # Dependencies (git-ignored)
├── .auth/                              # Authentication cache (git-ignored)
│
└── examples/                           # Usage Examples
    ├── README.md                       # Examples documentation
    ├── basic-usage/                    # Basic usage examples
    ├── advanced-patterns/              # Advanced usage patterns
    └── integration-examples/           # Integration examples
```

## **Key Organizational Principles**

### **1. Separation of Concerns**
- **`src/`** - MCP server implementation (TypeScript)
- **`gas-projects/`** - Google Apps Script source code (JavaScript/GS)
- **`test/`** - All testing code
- **`docs/`** - All documentation

### **2. Google Apps Script Projects**
- Each GAS project gets its own subdirectory under `gas-projects/`
- Source files are stored in `src/` subdirectory within each project
- Project metadata stored in `project-info.json`
- Deployment information tracked separately

### **3. Documentation Structure**
- Root `README.md` for main project overview
- `docs/` for detailed technical documentation
- Project-specific `README.md` files for each GAS project
- Examples with their own documentation

### **4. Git-Friendly**
- Clear separation between source and build artifacts
- Proper `.gitignore` for temporary files
- No sensitive credentials in source control
- Each GAS project is self-contained

### **5. Development Workflow**
- Source code stays in git repository
- Easy synchronization with Google Apps Script
- Clear deployment tracking
- Version control for both MCP server and GAS projects

## **Benefits of This Structure**

1. **Clear Separation** - MCP server code vs GAS project code
2. **Scalable** - Easy to add new GAS projects
3. **Maintainable** - Each project is self-contained
4. **Collaborative** - Multiple developers can work on different projects
5. **CI/CD Ready** - Structure supports automated testing and deployment
6. **Documentation** - Well-organized docs for different audiences 