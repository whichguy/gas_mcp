const { gas_auth } = require('./src/tools/auth.js');
const { GASRunTool } = require('./src/tools/execution.js');
const { SessionAuthManager } = require('./src/auth/sessionManager.js');

async function testGasRun() {
  console.log('🧪 Testing gas_run with race condition fixes...');
  console.log('📋 Project ID: 1jK_ujSHRCsEeBizi6xycuj_0y5qDqvMzLJHBE9HLUiM5JmSyzF4Ga_kM');
  console.log('🔢 Expression: 8 * 9');
  console.log('');
  
  // Create session manager
  const sessionManager = new SessionAuthManager('test-session-gas-run');
  
  try {
    // Check auth status first
    console.log('📊 Checking authentication status...');
    const authStatus = await gas_auth({ mode: 'status' }, sessionManager);
    console.log('📈 Auth Status:', authStatus.status);
    
    if (!authStatus.authenticated) {
      console.log('🔑 Starting authentication flow...');
      const authResult = await gas_auth({ 
        mode: 'start', 
        openBrowser: true, 
        waitForCompletion: false 
      }, sessionManager);
      console.log('🚀 Auth Flow Started:', authResult.status);
      console.log('🌐 Auth URL:', authResult.authUrl);
      console.log('');
      console.log('⏳ Please complete authentication in browser, then run this test again.');
      return;
    }
    
    console.log(`✅ Already authenticated as: ${authStatus.user?.email}`);
    console.log('');
    
    // Test gas_run
    console.log('🚀 Testing gas_run execution...');
    const runTool = new GASRunTool(sessionManager);
    
    const result = await runTool.execute({
      scriptId: '1jK_ujSHRCsEeBizi6xycuj_0y5qDqvMzLJHBE9HLUiM5JmSyzF4Ga_kM',
      js_statement: '8 * 9',
      devMode: true,
      autoRedeploy: true
    });
    
    console.log('📋 Gas Run Result:');
    console.log('================');
    if (result.content && result.content[0] && result.content[0].text) {
      const resultData = JSON.parse(result.content[0].text);
      console.log('🎯 Execution Result:', resultData.result);
      console.log('📊 Status:', resultData.status);
      console.log('⏱️  Execution Time:', resultData.executionTime);
      if (resultData.deploymentUrl) {
        console.log('🔗 Deployment URL:', resultData.deploymentUrl);
      }
      console.log('');
      console.log('📝 Full Response:');
      console.log(JSON.stringify(resultData, null, 2));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.data) {
      console.error('📋 Error details:', error.data);
    }
    console.error('🔍 Stack:', error.stack);
  }
}

// Run the test
console.log('🏁 Starting MCP Gas Run Test');
console.log('🔧 Testing race condition fixes and authentication flow');
console.log('');

testGasRun().then(() => {
  console.log('');
  console.log('✅ Test completed');
}).catch(error => {
  console.error('💥 Unexpected error:', error);
}); 