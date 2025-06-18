import { createTestClient, AuthTestHelper, GASTestHelper } from '../test/system/mcpClient.js';

async function main() {
  console.log('🚀 Starting Fibonacci Demo with MCP Gas Server...');
  const client = await createTestClient();
  const auth = new AuthTestHelper(client);
  const gas = new GASTestHelper(client);

  try {
    // 1. Authenticate
    console.log('\n🔐 STEP 1: Authenticating...');
    const authStatus = await auth.getAuthStatus();

    if (authStatus.authenticated && authStatus.tokenValid) {
      console.log(`✅ Already authenticated as ${authStatus.user.email}`);
    } else {
      console.log('🔑 Starting authentication...');
      const authResult = await auth.startInteractiveAuthWithBrowser();
      const authCompleted = await auth.waitForAuth(120000);
      if (!authCompleted) {
        throw new Error('Authentication failed or timed out');
      }
      const finalStatus = await auth.getAuthStatus();
      console.log(`✅ Authentication successful for ${finalStatus.user.email}!`);
    }

    // 2. Create a new project
    console.log('\n📁 STEP 2: Creating new Fibonacci Calculator project...');
    const createProjectResult = await client.callTool('gas_project_create', {
      title: 'MCP Fibonacci Demo',
      description: 'A project to demonstrate Fibonacci calculation using MCP Gas Server'
    });
    
    console.log('Project creation result:', createProjectResult);
    
    // Extract project ID from the result
    let projectId: string | undefined;
    if (createProjectResult && createProjectResult.content && createProjectResult.content[0]) {
      const resultText = createProjectResult.content[0].text;
      const resultData = JSON.parse(resultText);
      projectId = resultData.scriptId || resultData.projectId;
    }
    
    if (!projectId) {
      throw new Error('Failed to get project ID from creation result');
    }
    
    console.log(`✅ Project created with ID: ${projectId}`);

    // 3. Create a Fibonacci function file
    console.log('\n📝 STEP 3: Creating Fibonacci function file...');
    
    const fibonacciCode = `/**
 * Calculate the nth Fibonacci number
 * @param {number} n - The position in the Fibonacci sequence
 * @returns {number} The nth Fibonacci number
 */
function fibonacci(n) {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    const temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}

/**
 * Calculate Fibonacci of 17 specifically
 * @returns {number} The 17th Fibonacci number
 */
function fibonacciOf17() {
  return fibonacci(17);
}

/**
 * Test function to demonstrate Fibonacci calculation
 */
function testFibonacci() {
  const result = fibonacciOf17();
  console.log('Fibonacci of 17 is:', result);
  return result;
}`;

    const writeResult = await client.callTool('gas_write', {
      projectId: projectId,
      fileName: 'fibonacci',
      content: fibonacciCode,
      fileType: 'gs'
    });
    
    console.log('✅ Fibonacci function file created successfully');

    // 4. Execute the Fibonacci calculation
    console.log('\n🔢 STEP 4: Calculating Fibonacci of 17...');
    
    const executeResult = await client.callTool('gas_run', {
      projectId: projectId,
      js_statement: 'fibonacci(17)'
    });
    
    console.log('Execution result:', executeResult);
    
    if (executeResult && executeResult.content && executeResult.content[0]) {
      const resultText = executeResult.content[0].text;
      const resultData = JSON.parse(resultText);
      
      if (resultData.result !== undefined) {
        console.log(`🎉 SUCCESS! Fibonacci of 17 = ${resultData.result}`);
      } else {
        console.log('Result data:', resultData);
      }
    }

    // 5. Also test the dedicated function
    console.log('\n🧪 STEP 5: Testing dedicated fibonacciOf17() function...');
    
    const testResult = await client.callTool('gas_run', {
      projectId: projectId,
      js_statement: 'fibonacciOf17()'
    });
    
    if (testResult && testResult.content && testResult.content[0]) {
      const resultText = testResult.content[0].text;
      const resultData = JSON.parse(resultText);
      
      if (resultData.result !== undefined) {
        console.log(`✅ fibonacciOf17() function returned: ${resultData.result}`);
      }
    }

    console.log('\n🎯 Summary:');
    console.log('- ✅ Created new Google Apps Script project');
    console.log('- ✅ Added Fibonacci calculation function');
    console.log('- ✅ Successfully calculated Fibonacci of 17');
    console.log('- ✅ All operations performed using MCP Gas Server tools');

  } catch (error) {
    console.error('\n❌ An error occurred:', error);
  } finally {
    console.log('\n🔌 Disconnecting client...');
    await client.disconnect();
    console.log('✅ Demo completed.');
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
}); 