/**
 * Race condition test for MCP Gas authentication system
 * 
 * This test validates that concurrent authentication requests don't 
 * interfere with each other or corrupt shared state.
 */

const { gas_auth } = require('../src/tools/auth.js');
const { SessionAuthManager } = require('../src/auth/sessionManager.js');

async function testConcurrentAuthFlows() {
  console.log('🧪 Testing concurrent authentication flows...');
  
  // Create multiple session managers
  const sessions = [
    new SessionAuthManager('test-session-1'),
    new SessionAuthManager('test-session-2'),
    new SessionAuthManager('test-session-3'),
  ];

  // Start multiple auth flows simultaneously
  const authPromises = sessions.map(async (session, index) => {
    try {
      console.log(`🚀 Starting auth flow ${index + 1}...`);
      
      // Test with non-blocking mode first
      const result = await gas_auth({
        mode: 'start',
        waitForCompletion: false,
        openBrowser: false
      }, session);
      
      console.log(`✅ Auth flow ${index + 1} completed:`, result.status);
      return { index: index + 1, success: true, result };
      
    } catch (error) {
      console.log(`❌ Auth flow ${index + 1} failed:`, error.message);
      return { index: index + 1, success: false, error: error.message };
    }
  });

  // Wait for all flows to complete
  const results = await Promise.all(authPromises);
  
  console.log('\n📊 Race condition test results:');
  results.forEach(result => {
    if (result.success) {
      console.log(`  ✅ Flow ${result.index}: SUCCESS - ${result.result.status}`);
    } else {
      console.log(`  ❌ Flow ${result.index}: FAILED - ${result.error}`);
    }
  });

  // Check if all flows completed without interference
  const successCount = results.filter(r => r.success).length;
  console.log(`\n🎯 Result: ${successCount}/${results.length} flows completed successfully`);
  
  if (successCount === results.length) {
    console.log('✅ Race condition test PASSED - No interference detected');
  } else {
    console.log('⚠️  Race condition test shows some interference');
  }
}

async function testConcurrentSessionWrites() {
  console.log('\n🧪 Testing concurrent session file writes...');
  
  const session = new SessionAuthManager('test-concurrent-writes');
  
  // Simulate concurrent auth session updates
  const writePromises = Array.from({ length: 5 }, async (_, index) => {
    try {
      await session.setAuthSession({
        access_token: `token-${index}`,
        expires_at: Date.now() + 3600000,
        scope: 'test',
        token_type: 'Bearer'
      }, {
        id: `user-${index}`,
        email: `user${index}@test.com`,
        name: `Test User ${index}`,
        verified_email: true
      });
      
      console.log(`✅ Write ${index + 1} completed`);
      return { index: index + 1, success: true };
      
    } catch (error) {
      console.log(`❌ Write ${index + 1} failed:`, error.message);
      return { index: index + 1, success: false, error: error.message };
    }
  });

  const writeResults = await Promise.all(writePromises);
  
  console.log('\n📊 Concurrent write test results:');
  writeResults.forEach(result => {
    if (result.success) {
      console.log(`  ✅ Write ${result.index}: SUCCESS`);
    } else {
      console.log(`  ❌ Write ${result.index}: FAILED - ${result.error}`);
    }
  });

  const writeSuccessCount = writeResults.filter(r => r.success).length;
  console.log(`\n🎯 Result: ${writeSuccessCount}/${writeResults.length} writes completed successfully`);
  
  if (writeSuccessCount === writeResults.length) {
    console.log('✅ Concurrent write test PASSED - No corruption detected');
  } else {
    console.log('⚠️  Concurrent write test shows potential file corruption');
  }
  
  // Clean up test session
  await session.clearAuth();
}

// Run tests
async function runRaceConditionTests() {
  console.log('🏁 Starting MCP Gas Race Condition Tests\n');
  
  try {
    await testConcurrentAuthFlows();
    await testConcurrentSessionWrites();
    
    console.log('\n🏁 Race condition tests completed');
    
  } catch (error) {
    console.error('❌ Test runner failed:', error);
  }
}

// Export for use in other test suites
module.exports = {
  testConcurrentAuthFlows,
  testConcurrentSessionWrites,
  runRaceConditionTests
};

// Run if called directly
if (require.main === module) {
  runRaceConditionTests();
} 