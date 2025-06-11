# Fibonacci Calculator Project

A comprehensive Google Apps Script project demonstrating mathematical calculations, string utilities, and MCP (Model Context Protocol) runtime integration.

## **Project Overview**

This project showcases:
- **Fibonacci Number Calculations** using efficient iterative algorithms
- **String Manipulation Utilities** with comprehensive testing
- **MCP Runtime Integration** with fixed double extension handling
- **Dynamic Function Execution** via web app deployments

## **Key Features**

### **✅ Mathematical Functions**
- `fib(n)` - Calculate nth Fibonacci number (iterative approach)
- `getFibonacciSequence(count)` - Generate Fibonacci sequence array
- `testFibonacci()` - Comprehensive testing function

### **✅ String Utilities**
- `double_string(str)` - Concatenate string with itself
- `testDoubleString()` - Test multiple string scenarios
- `simpleDoubleTest(input)` - Simple string doubling test

### **✅ MCP Runtime System**
- `doGet(e)` / `doPost(e)` - Web app entry points
- `__gas_run(function_plus_args)` - Dynamic function execution
- **Fixed Double Extension Bug** - Proper `.gs` file handling

## **Validated Test Results**

| Function | Input | Expected | Actual | Status |
|----------|-------|----------|--------|---------|
| `fib(9)` | 9 | 34 | 34 | ✅ |
| `fib(11)` | 11 | 89 | 89 | ✅ |
| `fib(12)` | 12 | 144 | 144 | ✅ |
| `double_string("Hello")` | "Hello" | "HelloHello" | "HelloHello" | ✅ |
| `double_string("Testing123_LLM_Generated!🎯")` | Test String | Doubled String | Doubled String | ✅ |

## **Google Apps Script Details**

- **Script ID**: `1Yw-r4apdS-_95TQyZnbsQK3HiEaO-wGE2_VTydYnZ5kIH6C8_Uh3ggqp`
- **Runtime**: V8 JavaScript Engine
- **Timezone**: America/New_York
- **Deployment**: Web App (Access: MYSELF, Execute As: USER_DEPLOYING)

## **Source Files**

```
src/
├── appsscript.json          # GAS manifest configuration
├── fibonacci.gs             # Fibonacci calculation functions
├── test-stringUtils.gs      # String utility functions
└── __mcp_gas_run.gs        # MCP runtime shim (fixed version)
```

## **Usage Examples**

### **Direct Function Calls**
```javascript
// Calculate 12th Fibonacci number
const result = fib(12); // Returns: 144

// Generate first 10 Fibonacci numbers
const sequence = getFibonacciSequence(10); 
// Returns: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]

// Double a string
const doubled = double_string("Hello"); // Returns: "HelloHello"
```

### **MCP Tool Integration**
```bash
# Execute via MCP gas_run tool
gas_run --script-id="1Yw-r4apdS-_95TQyZnbsQK3HiEaO-wGE2_VTydYnZ5kIH6C8_Uh3ggqp" --function="fib" --params='[12]'

# Result: {"result": 144, "status": "success"}
```

### **Web App Execution**
```bash
# GET request to web app URL
curl "https://script.google.com/macros/.../exec?function_plus_args=fib(9)"

# Response: {"result": 34, "function_called": "fib(9)"}
```

## **Development Notes**

### **Fixed Issues**
- ✅ **Double Extension Bug**: Fixed `__mcp_gas_run.gs.gs` → `__mcp_gas_run.gs`
- ✅ **Extension Handling**: Proper gas_write integration for file creation
- ✅ **Version Tracking**: Updated to v1.0.1 with fix indicators

### **Architecture**
- **Iterative Fibonacci**: O(n) time complexity, O(1) space complexity
- **Error Handling**: Proper input validation and error messages
- **Testing**: Comprehensive test functions for validation
- **MCP Integration**: Dynamic execution with proper proxy patterns

## **Deployment Information**

- **Type**: Web App
- **Access Level**: MYSELF (Owner only)
- **Execute As**: USER_DEPLOYING
- **Auto-redeploy**: Enabled for latest code execution

## **Future Enhancements**

1. **Additional Math Functions**: Prime numbers, factorials, etc.
2. **Enhanced String Utils**: Regex operations, formatting functions
3. **Data Processing**: CSV parsing, JSON manipulation
4. **Integration Examples**: Sheets, Docs, Drive integration

## **Contributing**

When modifying this project:
1. Update source files in `src/` directory
2. Test functions locally using MCP tools
3. Update `project-info.json` with changes
4. Document new functions in this README
5. Validate test results before committing

## **License**

MIT License - See project root for details. 