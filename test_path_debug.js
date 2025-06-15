import { join } from 'path';
import { existsSync } from 'fs';

console.log('🔍 Path Debug Information:');
console.log('Current working directory:', process.cwd());
console.log('Script directory (__dirname):', new URL('.', import.meta.url).pathname);

const configPath = join(process.cwd(), 'oauth-config.json');
console.log('Looking for oauth-config.json at:', configPath);
console.log('File exists:', existsSync(configPath));

// Also check in the script directory
const scriptDir = new URL('.', import.meta.url).pathname.slice(0, -1); // Remove trailing slash
const configPath2 = join(scriptDir, 'oauth-config.json');
console.log('Alternative path:', configPath2);
console.log('Alternative exists:', existsSync(configPath2));

// List files in current directory
import { readdirSync } from 'fs';
console.log('Files in current directory:');
try {
  const files = readdirSync(process.cwd());
  files.forEach(file => {
    if (file.includes('oauth') || file.includes('config')) {
      console.log(`  📄 ${file}`);
    }
  });
} catch (error) {
  console.log('Error reading directory:', error.message);
} 