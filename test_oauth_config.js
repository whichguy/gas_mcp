import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

console.log('🔍 Testing OAuth configuration loading...');
console.log('Current working directory:', process.cwd());

const configPath = join(process.cwd(), 'oauth-config.json');
console.log('Looking for config at:', configPath);
console.log('Config file exists:', existsSync(configPath));

if (existsSync(configPath)) {
  try {
    const configData = readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);
    
    console.log('✅ Successfully loaded oauth-config.json');
    console.log('🔑 Client ID:', config.oauth?.client_id?.substring(0, 30) + '...');
    console.log('🏷️  Type:', config.oauth?.type);
    console.log('🌐 Redirect URIs:', config.oauth?.redirect_uris);
    
    if (config.oauth?.client_id) {
      console.log('✅ Configuration is valid');
    } else {
      console.log('❌ Configuration missing client_id');
    }
  } catch (error) {
    console.log('❌ Error parsing config:', error.message);
  }
} else {
  console.log('❌ oauth-config.json file not found!');
} 