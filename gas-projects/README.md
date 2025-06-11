# Google Apps Script Projects

This directory contains all Google Apps Script projects managed by this MCP server.

## **Directory Structure**

```
gas-projects/
├── README.md                    # This file
├── template/                    # Project template for new GAS projects
│   ├── README.md               # Template documentation
│   ├── src/                    # Template source files
│   │   └── appsscript.json     # Base GAS manifest
│   └── .clasp.json.template    # Clasp configuration template
│
└── [project-name]/             # Individual GAS project
    ├── README.md               # Project documentation
    ├── project-info.json       # Project metadata
    ├── src/                    # Source files (.gs, .html, .json)
    │   ├── appsscript.json     # GAS manifest file
    │   ├── [main-code].gs      # Main project code
    │   └── [other-files]       # Additional project files
    └── deployments/            # Deployment configurations
        └── deployment-info.json # Deployment metadata
```

## **Project Organization Principles**

### **1. Each Project is Self-Contained**
- All source files for a project are in its `src/` directory
- Project metadata is stored in `project-info.json`
- Deployment information is tracked separately

### **2. Source Control Friendly**
- All source files are stored as plain text
- Easy to track changes and collaborate
- Clear separation from Google Apps Script's cloud storage

### **3. Deployment Tracking**
- Deployment configurations and URLs are tracked
- Version history maintained locally
- Easy rollback and deployment management

## **Adding a New Project**

1. **Copy Template**:
   ```bash
   cp -r template/ [project-name]/
   ```

2. **Update Documentation**:
   - Edit `[project-name]/README.md`
   - Update `[project-name]/project-info.json`

3. **Add Source Files**:
   - Place `.gs` files in `[project-name]/src/`
   - Update `appsscript.json` as needed

4. **Deploy and Track**:
   - Use MCP tools to deploy to Google Apps Script
   - Update deployment info in `deployments/`

## **Current Projects**

- **fibonacci-calculator**: Fibonacci number calculator with string utilities and MCP runtime integration

## **MCP Integration**

All projects in this directory can be:
- Deployed using `gas_deploy_create`
- Executed using `gas_run`
- Managed using other MCP gas tools
- Synchronized between local files and Google Apps Script

## **Best Practices**

1. **Naming**: Use kebab-case for project directory names
2. **Documentation**: Always include a project-specific README
3. **Version Control**: Commit source files, not deployment artifacts
4. **Testing**: Include test functions in your GAS projects
5. **Metadata**: Keep project-info.json updated with current details 