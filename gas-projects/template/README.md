# [Project Name] Template

This is a template for creating new Google Apps Script projects with MCP integration.

## **Setup Instructions**

1. **Copy this template**:
   ```bash
   cp -r gas-projects/template/ gas-projects/[your-project-name]/
   ```

2. **Update project files**:
   - [ ] Rename this README.md and update content
   - [ ] Update `project-info.json` with your project details
   - [ ] Modify `src/appsscript.json` as needed
   - [ ] Add your source files to `src/` directory

3. **Create Google Apps Script project**:
   ```bash
   # Use MCP tools to create new project
   gas_project_create --title="Your Project Title"
   ```

4. **Add source files**:
   ```bash
   # Use gas_write to add your files
   gas_write --path="[scriptId]/[filename]" --content="[your-code]"
   ```

5. **Deploy and test**:
   ```bash
   # Deploy your project
   gas_deploy_create --script-id="[scriptId]"
   
   # Test your functions
   gas_run --script-id="[scriptId]" --function="[yourFunction]"
   ```

## **Template Structure**

```
[your-project-name]/
├── README.md                   # Project documentation (this file)
├── project-info.json           # Project metadata
├── src/                        # Source files
│   └── appsscript.json         # GAS manifest
└── deployments/                # Deployment info (created automatically)
```

## **Required Updates**

### **README.md (this file)**
- [ ] Update project title and description
- [ ] Add your project's specific features
- [ ] Document your functions and usage examples
- [ ] Include test results and validation

### **project-info.json**
- [ ] Update `name`, `title`, `description`
- [ ] Add your Google Apps Script details when available
- [ ] List your project files and functions
- [ ] Update version, tags, and metadata

### **src/appsscript.json**
- [ ] Update timezone if needed
- [ ] Add any required OAuth scopes
- [ ] Configure webapp settings if applicable
- [ ] Add dependencies if needed

## **Example Functions**

Add your main functions to separate `.gs` files in the `src/` directory:

```javascript
// Example: src/main.gs
function myMainFunction() {
  console.log("Hello from my new project!");
  return "Success!";
}

function testMyFunction() {
  const result = myMainFunction();
  return {
    result: result,
    timestamp: new Date().toISOString(),
    status: "completed"
  };
}
```

## **Best Practices**

1. **File Naming**: Use descriptive names for your `.gs` files
2. **Documentation**: Include JSDoc comments for functions
3. **Testing**: Create test functions for validation
4. **Error Handling**: Add proper error handling and validation
5. **MCP Integration**: Ensure functions work with gas_run tool

## **Next Steps**

1. Follow the setup instructions above
2. Implement your project-specific functionality
3. Test using MCP tools
4. Update documentation
5. Commit to version control

## **Resources**

- [Google Apps Script Documentation](https://developers.google.com/apps-script)
- [MCP Gas Tools Documentation](../../docs/)
- [Project Examples](../fibonacci-calculator/) 