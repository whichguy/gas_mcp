import { loadOAuthConfigFromJson } from './dist/src/tools/auth.js';
import { writeFileSync } from 'fs';

try {
  console.log('Testing OAuth configuration loading with debug output...');
  const config = loadOAuthConfigFromJson();
  
  const debugInfo = {
    success: true,
    client_id: config.client_id,
    type: config.type,
    timestamp: new Date().toISOString()
  };
  
  writeFileSync('auth_debug.log', JSON.stringify(debugInfo, null, 2));
  console.log('✅ SUCCESS: OAuth config loaded and written to auth_debug.log');

} catch (error) {
  const debugInfo = {
    success: false,
    error: error.message,
    errorType: error.constructor.name,
    timestamp: new Date().toISOString(),
    currentWorkingDirectory: process.cwd()
  };
  
  writeFileSync('auth_debug.log', JSON.stringify(debugInfo, null, 2));
  console.log('❌ ERROR: Written debug info to auth_debug.log');
  console.log('Error:', error.message);
} 