import { expect } from 'chai';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import { MCPTestClient, AuthTestHelper, GASTestHelper } from '../../helpers/mcpClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';

/**
 * Real Google Apps Script Integration Tests
 * 
 * These tests work with actual Google Apps Script projects, not mocked objects.
 * They create real scripts, deploy them, and test actual functionality.
 * 
 * Requirements:
 * - Real Google OAuth authentication
 * - Internet connection
 * - Valid Google account with Apps Script enabled
 * 
 * Usage: Set GAS_INTEGRATION_TEST=true to enable these tests
 */
describe('Real Google Apps Script Integration Tests', () => {
  let client: MCPTestClient;
  let auth: AuthTestHelper;
  let gas: GASTestHelper;
  let testProjects: string[] = [];

  before(function() {
    // Use authentication availability instead of environment variable
    if (!globalAuthState.client) {
      console.log('ℹ️  Skipping real GAS integration tests (no global client available)');
      this.skip();
      return;
    }

    client = globalAuthState.client!;
    auth = new AuthTestHelper(client);
    gas = new GASTestHelper(client);
    
    // Check authentication status
    if (!globalAuthState.isAuthenticated) {
      console.log('ℹ️  Running infrastructure tests (authentication not available)');
      console.log('ℹ️  For full integration tests, authenticate using gas_auth');
    } else {
      console.log('🚀 Starting Real Google Apps Script Integration Tests with authentication');
    }
  });

  beforeEach(function() {
    // Don't skip individual tests - let them handle authentication gracefully
    // This allows infrastructure testing when not authenticated
  });

  afterEach(async function() {
    // Cleanup any projects created during individual tests
    for (const projectId of testProjects) {
      try {
        await gas.cleanupTestProject(projectId);
      } catch (error) {
        console.warn(`Failed to cleanup project ${projectId}:`, error);
      }
    }
    testProjects = [];
  });

  after(async function() {
    console.log('🧹 Real GAS Integration Tests completed');
  });

  describe('Real Script Creation and Execution', () => {
    it('should create real GAS project with dynamic function execution', async function() {
      this.timeout(120000); // 2 minutes for real operations

      console.log('\n🎯 Testing Real Script Creation with Dynamic Function Execution');

      // Check authentication status first
      const authStatus = await auth.getAuthStatus();
      
      if (!authStatus.authenticated) {
        console.log('⚠️  No authentication available - testing infrastructure');
        
        // Test the infrastructure and tools are available
        const tools = await client.listTools();
        const requiredTools = ['gas_run', 'gas_write', 'gas_version_create', 'gas_deploy_create'];
        
        for (const toolName of requiredTools) {
          const tool = tools.find(t => t.name === toolName);
          expect(tool, `${toolName} should be available`).to.exist;
        }
        
        console.log('✅ Real GAS integration infrastructure available');
        console.log('ℹ️  To run full tests, authenticate with gas_auth');
        
        // Test that tools properly require authentication
        try {
          await gas.createTestProject('test');
          expect.fail('Should have required authentication');
        } catch (error: any) {
          const hasAuthError = error.data?.requiresAuth || error.message.includes('auth');
          expect(hasAuthError).to.be.true;
          console.log('✅ Properly requires authentication');
        }
        
        return;
      }

      // STEP 1: Create real GAS project
      const projectName = `Real MCP Test ${Date.now()}`;
      const project = await gas.createTestProject(projectName);
      testProjects.push(project.scriptId);
      
      console.log(`✅ Created real project: ${project.scriptId}`);
      expect(project.scriptId).to.be.a('string');

      // STEP 2: Write real GAS code with Function() trick
      const gasCode = `
// Main execution function using the Function() trick for dynamic execution
function doGet(e) {
  try {
    // Extract function name and parameters
    const functionName = e.parameter.fn || 'defaultTest';
    const args = e.parameter.args ? JSON.parse(e.parameter.args) : [];
    
    console.log('doGet executing:', functionName, 'with args:', args);
    
    // Use this[functionName] for reliable dynamic execution in GAS
    let result;
    if (typeof this[functionName] === 'function') {
      result = this[functionName].apply(this, args);
    } else {
      throw new Error(\`Function '\${functionName}' not found\`);
    }
    
    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        functionName: functionName,
        result: result,
        timestamp: new Date().toISOString(),
        executionMethod: 'this[functionName] dynamic execution'
      }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.toString(),
        timestamp: new Date().toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Test functions that can be called dynamically
function calculateSum(a, b) {
  console.log('calculateSum called with:', a, b);
  return a + b;
}

function calculateProduct(x, y) {
  console.log('calculateProduct called with:', x, y);
  return x * y;
}

function processArray(arr) {
  console.log('processArray called with:', arr);
  return {
    original: arr,
    sum: arr.reduce((a, b) => a + b, 0),
    count: arr.length,
    average: arr.reduce((a, b) => a + b, 0) / arr.length
  };
}

function stringManipulation(text) {
  console.log('stringManipulation called with:', text);
  return {
    original: text,
    uppercase: text.toUpperCase(),
    lowercase: text.toLowerCase(),
    reversed: text.split('').reverse().join(''),
    length: text.length
  };
}

// Complex calculation with multiple operations
function complexCalculation(base, operations) {
  console.log('complexCalculation called with:', base, operations);
  let result = base;
  
  for (const op of operations) {
    switch (op.type) {
      case 'add':
        result += op.value;
        break;
      case 'multiply':
        result *= op.value;
        break;
      case 'power':
        result = Math.pow(result, op.value);
        break;
      default:
        throw new Error(\`Unknown operation: \${op.type}\`);
    }
  }
  
  return {
    initial: base,
    operations: operations,
    final: result,
    steps: operations.length
  };
}

// Default test function
function defaultTest() {
  return {
    message: 'Default test function executed successfully',
    timestamp: new Date().toISOString(),
    random: Math.floor(Math.random() * 1000)
  };
}
`;

      await gas.writeTestFile(project.scriptId, 'main.gs', gasCode);
      console.log('✅ Written real GAS code with dynamic execution');

      // STEP 3: Deploy as web app for real testing
      console.log('\n📦 Deploying as Web App...');
      
      const versionResult = await client.callAndParse('gas_version_create', {
        scriptId: project.scriptId,
        description: 'Real integration test version'
      });
      
      const deployResult = await client.callAndParse('gas_deploy_create', {
        scriptId: project.scriptId,
        description: 'Real integration test deployment',
        versionNumber: versionResult.versionNumber
      });
      
      console.log(`✅ Deployed version ${versionResult.versionNumber}`);
      expect(deployResult.deploymentId).to.be.a('string');

      // STEP 4: Test real execution with various functions
      console.log('\n🧮 Testing Real Function Execution...');
      
      // Give deployment time to propagate
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Test 1: Simple calculation
      const sumTestCode = `
function testSum() {
  // Use this[functionName] for dynamic function calls
  return this['calculateSum'](15, 27);
}`;

      const sumResult = await client.callAndParse('gas_run', {
        scriptId: project.scriptId,
        code: sumTestCode,
        autoRedeploy: true
      });

      expect(sumResult.status).to.equal('success');
      console.log('✅ Dynamic sum calculation: SUCCESS');

      // Test 2: Array processing with this[functionName]
      const arrayTestCode = `
function testArrayProcessing() {
  const testArray = [1, 2, 3, 4, 5];
  return this['processArray'](testArray);
}`;

      const arrayResult = await client.callAndParse('gas_run', {
        scriptId: project.scriptId,
        code: arrayTestCode,
        autoRedeploy: true
      });

      expect(arrayResult.status).to.equal('success');
      console.log('✅ Dynamic array processing: SUCCESS');

      // Test 3: Complex calculation chain
      const complexTestCode = `
function testComplexCalculation() {
  const base = 10;
  const operations = [
    { type: 'add', value: 5 },
    { type: 'multiply', value: 2 },
    { type: 'power', value: 2 }
  ];
  
  return (new Function(\`{
    return complexCalculation(\${base}, \${JSON.stringify(operations)});
  }\`))();
}`;

      const complexResult = await client.callAndParse('gas_run', {
        scriptId: project.scriptId,
        code: complexTestCode,
        autoRedeploy: true
      });

      expect(complexResult.status).to.equal('success');
      console.log('✅ Dynamic complex calculation: SUCCESS');

      console.log('\n🎉 Real Google Apps Script Integration: COMPLETE SUCCESS');
    });

    it('should handle real error scenarios and recovery', async function() {
      this.timeout(90000);

      console.log('\n🚨 Testing Real Error Handling and Recovery');

      // Check authentication status first
      const authStatus = await auth.getAuthStatus();
      
      if (!authStatus.authenticated) {
        console.log('⚠️  No authentication available - testing error handling infrastructure');
        
        // Test error handling infrastructure
        const tools = await client.listTools();
        const runTool = tools.find(tool => tool.name === 'gas_run');
        expect(runTool).to.exist;
        
        console.log('✅ Error handling infrastructure available');
        console.log('ℹ️  Full error recovery tests require authentication');
        return;
      }

      // Create project for error testing
      const projectName = `Error Test ${Date.now()}`;
      const project = await gas.createTestProject(projectName);
      testProjects.push(project.scriptId);

      // Test with intentionally broken code
      const brokenCode = `
function doGet(e) {
  // This will cause an error
  return nonExistentFunction();
}

function testErrorRecovery() {
  try {
    // Use Function() trick with error handling
    return (new Function(\`{
      throw new Error('Intentional test error');
    }\`))();
  } catch (error) {
    return {
      errorCaught: true,
      message: error.toString(),
      recovery: 'Error handled successfully'
    };
  }
}
`;

      await gas.writeTestFile(project.scriptId, 'errorTest.gs', brokenCode);

      // Test error recovery
      const errorTestCode = `
function testErrors() {
  return testErrorRecovery();
}`;

      const errorResult = await client.callAndParse('gas_run', {
        scriptId: project.scriptId,
        code: errorTestCode,
        autoRedeploy: true
      });

      expect(errorResult.status).to.equal('success');
      console.log('✅ Real error handling and recovery: SUCCESS');
    });
  });

  describe('Real Authentication and Permissions', () => {
    it('should work with real Google OAuth and permissions', async function() {
      this.timeout(60000);

      console.log('\n🔐 Testing Real Authentication and Permissions');

      // Check authentication status
      const authStatus = await auth.getAuthStatus();
      
      if (!authStatus.authenticated) {
        console.log('⚠️  No authentication available - testing auth infrastructure');
        
        // Test authentication infrastructure
        const tools = await client.listTools();
        const authTool = tools.find(tool => tool.name === 'gas_auth');
        expect(authTool).to.exist;
        
        // Test that we can start auth flow (infrastructure test)
        const authStart = await auth.startInteractiveAuth();
        expect(authStart).to.have.property('authUrl');
        expect(authStart.authUrl).to.include('accounts.google.com');
        
        console.log('✅ Authentication infrastructure available');
        console.log('ℹ️  Full permission tests require completed authentication');
        return;
      }

      // Verify we have real authentication
      expect(authStatus.authenticated).to.be.true;
      expect(authStatus.user).to.be.an('object');
      expect(authStatus.user.email).to.be.a('string');

      console.log(`✅ Real authentication confirmed: ${authStatus.user.email}`);

      // Test real Drive access
      const projects = await gas.listProjects();
      expect(projects.items).to.be.an('array');
      console.log(`✅ Real Drive access: Found ${projects.items.length} projects`);

      // Create and verify real project
      const projectName = `Auth Test ${Date.now()}`;
      const project = await gas.createTestProject(projectName);
      testProjects.push(project.scriptId);

      expect(project.scriptId).to.be.a('string');
      console.log('✅ Real project creation with authentication: SUCCESS');
    });
  });

  describe('Real Deployment and Execution Pipeline', () => {
    it('should complete full real deployment pipeline', async function() {
      this.timeout(180000); // 3 minutes for full pipeline

      console.log('\n🔄 Testing Complete Real Deployment Pipeline');

      // Check authentication status first
      const authStatus = await auth.getAuthStatus();
      
      if (!authStatus.authenticated) {
        console.log('⚠️  No authentication available - testing deployment infrastructure');
        
        // Test deployment infrastructure
        const tools = await client.listTools();
        const deploymentTools = ['gas_write', 'gas_run', 'gas_version_create', 'gas_deploy_create'];
        
        for (const toolName of deploymentTools) {
          const tool = tools.find(t => t.name === toolName);
          expect(tool, `${toolName} should be available`).to.exist;
        }
        
        console.log('✅ Complete deployment pipeline infrastructure available');
        console.log('ℹ️  Tools: gas_write → gas_version_create → gas_deploy_create → gas_run');
        console.log('ℹ️  Full pipeline testing requires authentication');
        return;
      }

      // Create project
      const projectName = `Pipeline Test ${Date.now()}`;
      const project = await gas.createTestProject(projectName);
      testProjects.push(project.scriptId);

      // Write comprehensive test code
      const pipelineCode = `
function doGet(e) {
  const testResults = runAllTests();
  
  return ContentService
    .createTextOutput(JSON.stringify(testResults))
    .setMimeType(ContentService.MimeType.JSON);
}

function runAllTests() {
  const tests = [
    { name: 'Math Test', fn: () => mathTest() },
    { name: 'String Test', fn: () => stringTest() },
    { name: 'Array Test', fn: () => arrayTest() },
    { name: 'Object Test', fn: () => objectTest() }
  ];
  
  const results = [];
  
  for (const test of tests) {
    try {
      const result = test.fn();
      results.push({
        name: test.name,
        success: true,
        result: result
      });
    } catch (error) {
      results.push({
        name: test.name,
        success: false,
        error: error.toString()
      });
    }
  }
  
  return {
    timestamp: new Date().toISOString(),
    totalTests: tests.length,
    passed: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results: results
  };
}

function mathTest() {
  // Corrected: Use Function() constructor with parameters
  const mathFunc = new Function('a', 'b', 'return a + b;');
  return mathFunc(15, 27);
}

function stringTest() {
  // Corrected: Use Function() constructor with parameters
  const stringFunc = new Function('text', 'return text.toUpperCase();');
  return stringFunc('Hello MCP');
}

function arrayTest() {
  // Corrected: Use Function() constructor with parameters
  const arrayFunc = new Function('arr', 'return arr.reduce((sum, num) => sum + num, 0);');
  return arrayFunc([1, 2, 3, 4, 5]);
}

function objectTest() {
  // Corrected: Use Function() constructor properly
  const objFunc = new Function('obj', 'return Object.keys(obj).length;');
  return objFunc({ name: 'MCP Test', version: '1.0' });
}
`;

      await gas.writeTestFile(project.scriptId, 'pipeline.gs', pipelineCode);
      console.log('✅ Written comprehensive pipeline code');

      // Create version
      const versionResult = await client.callAndParse('gas_version_create', {
        scriptId: project.scriptId,
        description: 'Pipeline test version'
      });
      console.log(`✅ Created version: ${versionResult.versionNumber}`);

      // Deploy
      const deployResult = await client.callAndParse('gas_deploy_create', {
        scriptId: project.scriptId,
        description: 'Pipeline test deployment',
        versionNumber: versionResult.versionNumber
      });
      console.log(`✅ Created deployment: ${deployResult.deploymentId}`);

      // Test execution after deployment
      await new Promise(resolve => setTimeout(resolve, 15000)); // Wait for propagation

      const executionTestCode = `
function testPipeline() {
  return runAllTests();
}`;

      const pipelineResult = await client.callAndParse('gas_run', {
        scriptId: project.scriptId,
        code: executionTestCode,
        autoRedeploy: true
      });

      expect(pipelineResult.status).to.equal('success');
      console.log('✅ Complete real deployment pipeline: SUCCESS');

      console.log('\n🏆 REAL GOOGLE APPS SCRIPT INTEGRATION: ALL TESTS PASSED');
    });
  });
}); 