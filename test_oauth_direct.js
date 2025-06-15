// Direct test of OAuth configuration loading
import { loadOAuthConfigFromJson } from './dist/src/tools/auth.js';

console.log('🧪 Testing OAuth configuration loading directly...');
console.log('📁 Current working directory:', process.cwd());

try {
  const config = loadOAuthConfigFromJson();
  console.log('✅ SUCCESS: OAuth configuration loaded!');
  console.log('🔑 Client ID:', config.client_id);
  console.log('🏷️  Type:', config.type);
  console.log('🔐 Has client_secret:', !!config.client_secret);
} catch (error) {
  console.log('❌ ERROR:', error.message);
  console.log('💡 Error type:', error.constructor.name);
} 