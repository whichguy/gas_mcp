/**
 * Test Project Factory - Template-Based GAS Project Creation for System Tests
 * 
 * Leverages existing project templates and creates structured test scenarios
 * with proper cleanup and resource tracking.
 */

import { GasTestContext } from '../../helpers/mcpGasTestHelpers.js';
import { TestDataFactory } from '../../helpers/testFactory.js';
import fs from 'fs/promises';
import path from 'path';

export interface TestProjectTemplate {
  name: string;
  title: string;
  description: string;
  files: Array<{
    name: string;
    content: string;
    type: 'server_js' | 'html' | 'json';
  }>;
  functions: string[];
  testCases: Array<{
    function: string;
    input?: any;
    expected: any;
    description: string;
  }>;
  deploymentType?: 'WEB_APP' | 'EXECUTION_API' | 'ADD_ON';
}

export class TestProjectFactory {
  
  /**
   * Create a mathematical operations test project
   */
  static createMathOperationsProject(): TestProjectTemplate {
    return {
      name: `math-operations-${Date.now()}`,
      title: `Math Operations Test Project`,
      description: 'Test project for mathematical calculations and validations',
      files: [
        {
          name: 'appsscript.json',
          type: 'json',
          content: JSON.stringify({
            timeZone: 'America/New_York',
            dependencies: {},
            exceptionLogging: 'STACKDRIVER',
            runtimeVersion: 'V8'
          }, null, 2)
        },
        {
          name: 'mathOperations.gs',
          type: 'server_js',
          content: `/**
 * Mathematical Operations Test Suite
 */

function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

function isPrime(num) {
  if (num <= 1) return false;
  if (num <= 3) return true;
  if (num % 2 === 0 || num % 3 === 0) return false;
  
  for (let i = 5; i * i <= num; i += 6) {
    if (num % i === 0 || num % (i + 2) === 0) return false;
  }
  return true;
}

function runAllTests() {
  const results = {
    add: add(15, 27),
    multiply: multiply(6, 7),
    fibonacci: fibonacci(10),
    factorial: factorial(5),
    isPrime: isPrime(17),
    timestamp: new Date().toISOString(),
    success: true
  };
  
  return results;
}`
        }
      ],
      functions: ['add', 'multiply', 'fibonacci', 'factorial', 'isPrime', 'runAllTests'],
      testCases: [
        { function: 'add(15, 27)', expected: 42, description: 'Basic addition' },
        { function: 'multiply(6, 7)', expected: 42, description: 'Basic multiplication' },
        { function: 'fibonacci(10)', expected: 55, description: 'Fibonacci sequence' },
        { function: 'factorial(5)', expected: 120, description: 'Factorial calculation' },
        { function: 'isPrime(17)', expected: true, description: 'Prime number check' }
      ],
      deploymentType: 'WEB_APP'
    };
  }

  /**
   * Create a data processing test project
   */
  static createDataProcessingProject(): TestProjectTemplate {
    return {
      name: `data-processing-${Date.now()}`,
      title: `Data Processing Test Project`,
      description: 'Test project for data manipulation and JSON operations',
      files: [
        {
          name: 'appsscript.json',
          type: 'json',
          content: JSON.stringify({
            timeZone: 'America/New_York',
            dependencies: {},
            exceptionLogging: 'STACKDRIVER',
            runtimeVersion: 'V8'
          }, null, 2)
        },
        {
          name: 'dataProcessor.gs',
          type: 'server_js',
          content: `/**
 * Data Processing Test Suite
 */

function processArray(arr) {
  return arr
    .filter(x => x > 0)
    .map(x => x * 2)
    .reduce((sum, x) => sum + x, 0);
}

function transformObject(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key.toUpperCase()] = typeof value === 'string' ? value.toUpperCase() : value;
  }
  return result;
}

function parseAndValidateJSON(jsonString) {
  try {
    const parsed = JSON.parse(jsonString);
    return {
      valid: true,
      data: parsed,
      type: Array.isArray(parsed) ? 'array' : typeof parsed
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
      data: null
    };
  }
}

function generateTestData() {
  return {
    numbers: [1, 2, 3, 4, 5],
    strings: ['hello', 'world', 'test'],
    mixed: {
      name: 'test',
      value: 42,
      active: true
    },
    timestamp: new Date().toISOString()
  };
}

function runDataTests() {
  const testData = generateTestData();
  
  return {
    arrayProcessing: processArray([-1, 2, -3, 4, 5]),
    objectTransform: transformObject({ name: 'test', value: 'hello' }),
    jsonValidation: parseAndValidateJSON('{"test": true}'),
    testData: testData,
    success: true
  };
}`
        }
      ],
      functions: ['processArray', 'transformObject', 'parseAndValidateJSON', 'generateTestData', 'runDataTests'],
      testCases: [
        { function: 'processArray([-1, 2, -3, 4, 5])', expected: 22, description: 'Array processing pipeline' },
        { function: 'transformObject({name: "test"})', expected: {NAME: "TEST"}, description: 'Object transformation' },
        { function: 'parseAndValidateJSON(\'{"valid": true}\')', expected: {valid: true, type: 'object'}, description: 'JSON parsing' }
      ],
      deploymentType: 'EXECUTION_API'
    };
  }

  /**
   * Create a web app test project with HTML interface
   */
  static createWebAppProject(): TestProjectTemplate {
    return {
      name: `webapp-${Date.now()}`,
      title: `Web App Test Project`,
      description: 'Test project for web app functionality with HTML interface',
      files: [
        {
          name: 'appsscript.json',
          type: 'json',
          content: JSON.stringify({
            timeZone: 'America/New_York',
            dependencies: {},
            exceptionLogging: 'STACKDRIVER',
            runtimeVersion: 'V8'
          }, null, 2)
        },
        {
          name: 'webapp.gs',
          type: 'server_js',
          content: `/**
 * Web App Test Suite
 */

function doGet(e) {
  const page = e.parameter.page || 'index';
  
  switch(page) {
    case 'api':
      return handleAPIRequest(e);
    default:
      return HtmlService.createHtmlOutputFromFile('index')
        .setTitle('Test Web App')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    return ContentService
      .createTextOutput(JSON.stringify(processWebAppData(data)))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({error: error.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function handleAPIRequest(e) {
  const action = e.parameter.action || 'status';
  
  const response = {
    action: action,
    timestamp: new Date().toISOString(),
    data: getAPIData(action)
  };
  
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

function processWebAppData(inputData) {
  return {
    received: inputData,
    processed: {
      ...inputData,
      processed_at: new Date().toISOString(),
      hash: Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(inputData))
        .map(byte => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0'))
        .join('')
    }
  };
}

function getAPIData(action) {
  switch(action) {
    case 'users':
      return [{id: 1, name: 'Test User'}, {id: 2, name: 'Another User'}];
    case 'stats':
      return {total: 100, active: 85, pending: 15};
    default:
      return {status: 'ok', version: '1.0.0'};
  }
}`
        },
        {
          name: 'index.html',
          type: 'html',
          content: `<!DOCTYPE html>
<html>
<head>
  <title>Test Web App</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .container { max-width: 600px; margin: 0 auto; }
    .test-section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
    button { background: #4285f4; color: white; border: none; padding: 10px 20px; border-radius: 3px; cursor: pointer; }
    button:hover { background: #3367d6; }
    .result { margin: 10px 0; padding: 10px; background: #f9f9f9; border-radius: 3px; font-family: monospace; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Test Web App</h1>
    
    <div class="test-section">
      <h3>API Test</h3>
      <button onclick="testAPI()">Test API Endpoint</button>
      <div id="api-result" class="result"></div>
    </div>
    
    <div class="test-section">
      <h3>POST Test</h3>
      <button onclick="testPOST()">Test POST Data</button>
      <div id="post-result" class="result"></div>
    </div>
    
    <div class="test-section">
      <h3>Status</h3>
      <p>Webapp loaded successfully at: <span id="load-time"></span></p>
    </div>
  </div>

  <script>
    document.getElementById('load-time').textContent = new Date().toISOString();
    
    function testAPI() {
      fetch('?page=api&action=stats')
        .then(response => response.json())
        .then(data => {
          document.getElementById('api-result').textContent = JSON.stringify(data, null, 2);
        })
        .catch(error => {
          document.getElementById('api-result').textContent = 'Error: ' + error.message;
        });
    }
    
    function testPOST() {
      fetch('', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({test: 'data', timestamp: new Date().toISOString()})
      })
        .then(response => response.json())
        .then(data => {
          document.getElementById('post-result').textContent = JSON.stringify(data, null, 2);
        })
        .catch(error => {
          document.getElementById('post-result').textContent = 'Error: ' + error.message;
        });
    }
  </script>
</body>
</html>`
        }
      ],
      functions: ['doGet', 'doPost', 'handleAPIRequest', 'processWebAppData', 'getAPIData'],
      testCases: [
        { function: 'doGet({parameter: {page: "api", action: "stats"}})', expected: {action: 'stats'}, description: 'GET API request' },
        { function: 'processWebAppData({test: "data"})', expected: {received: {test: "data"}}, description: 'POST data processing' }
      ],
      deploymentType: 'WEB_APP'
    };
  }

  /**
   * Create and deploy a test project based on template
   */
  static async createAndDeployProject(
    context: GasTestContext, 
    template: TestProjectTemplate
  ): Promise<{projectId: string, deploymentId?: string}> {
    if (!context.authenticated) {
      throw new Error('Authentication required for project creation and deployment');
    }

    console.log(`🏗️  Creating project from template: ${template.name}`);

    // Create the project
    const projectId = await context.client.callAndParse('gas_project_create', {
      title: template.title
    });

    context.projectIds.push(projectId.scriptId);

    // Add all files from template
    for (const file of template.files) {
      const filePath = `${projectId.scriptId}/${file.name}`;
      await context.client.callAndParse('gas_write', {
        path: filePath,
        content: file.content
      });
      context.createdFiles.push(filePath);
      console.log(`📄 Created file: ${file.name}`);
    }

    // Skip deployment creation - not required for test fixtures
    // Deployment testing is handled by dedicated deployment tests
    let deploymentId: string | undefined;
    if (template.deploymentType) {
      console.log(`📦 Skipping deployment creation for test fixture (not required)...`);
    }

    console.log(`✅ Project ready: ${projectId.scriptId}`);
    return { projectId: projectId.scriptId, deploymentId };
  }

  /**
   * Run all test cases for a project template
   */
  static async runProjectTests(
    context: GasTestContext,
    projectId: string,
    template: TestProjectTemplate
  ): Promise<Array<{test: string, result: any, passed: boolean, error?: string}>> {
    const results = [];

    console.log(`🧪 Running ${template.testCases.length} test cases for project ${projectId}`);

    for (const testCase of template.testCases) {
      try {
        console.log(`  Testing: ${testCase.description}`);
        
        const result = await context.client.callAndParse('exec', {
          scriptId: projectId,
          js_statement: testCase.function
        });

        const passed = this.compareResults(result.response?.result, testCase.expected);
        
        results.push({
          test: testCase.description,
          result: result.response?.result,
          passed,
          error: passed ? undefined : `Expected ${JSON.stringify(testCase.expected)}, got ${JSON.stringify(result.response?.result)}`
        });

        console.log(`    ${passed ? '✅' : '❌'} ${testCase.description}`);
      } catch (error: any) {
        results.push({
          test: testCase.description,
          result: null,
          passed: false,
          error: error.message
        });
        console.log(`    ❌ ${testCase.description}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Compare test results (basic comparison)
   */
  private static compareResults(actual: any, expected: any): boolean {
    if (typeof expected === 'object' && expected !== null) {
      if (typeof actual !== 'object' || actual === null) return false;
      
      for (const key in expected) {
        if (!(key in actual) || actual[key] !== expected[key]) {
          return false;
        }
      }
      return true;
    }
    
    return actual === expected;
  }
} 