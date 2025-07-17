# Google Apps Script Projects

This directory contains all Google Apps Script projects managed by this MCP server.

## **Directory Structure**

```
gas-projects/
├── README.md                    # This file
└── [project-id]/               # Individual GAS project (using script ID)
    ├── appsscript.json         # GAS manifest (with MCP & git info)
    ├── Code.gs                 # Main code files directly in project dir
    ├── utils/                  # Directory structure preserved
    │   └── helper.gs
    └── .gitignore              # Git ignore file
```

## **Project Organization Principles**

### **1. Each Project is Self-Contained**
- All source files for a project are directly in the project directory
- Project metadata is stored in `appsscript.json` under the `mcp` section
- Git information is stored in `appsscript.json` under the `git` section

### **2. Source Control Friendly**
- All source files are stored as plain text
- Easy to track changes and collaborate
- Clear separation from Google Apps Script's cloud storage
- No unnecessary subdirectories or cache folders

### **3. Simplified Structure**
- No `src/` subdirectories - files are directly accessible
- No `.project-info.json` - metadata consolidated in `appsscript.json`
- No `.clasp.json` - not needed for MCP Gas Server
- No cache or deployments folders - managed via APIs

## **Adding a New Project**

1. **Create Project via MCP**:
   ```bash
   gas_project_create --title "My New Project" --localName "my-project"
   ```

2. **Pull Remote Files**:
   ```bash
   gas_pull --project "my-project"
   ```

3. **Start Development**:
   - Edit files directly in the project directory
   - Use `gas_push` to sync changes back to Google Apps Script

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