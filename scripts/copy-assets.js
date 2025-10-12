#!/usr/bin/env node

import { promises as fs } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const srcDir = join(__dirname, '..', 'src');
const distDir = join(__dirname, '..', 'dist', 'src');

// Asset file extensions to copy (excluding demo files)
const ASSET_EXTENSIONS = ['.js', '.json', '.html', '.gs'];

// Essential files only (excluding demo/test files)
const ESSENTIAL_FILES = [
  'CommonJS.js',
  '__mcp_exec.js', 
  'appsscript.json'
];

// Production templates (new)
const PRODUCTION_TEMPLATES = [
  'templates/error-handler.gs',
  'templates/production-config.json'
];

// Files to exclude (demo/test files)
const EXCLUDED_FILES = [
  'LoggerTest.js',
  'components/navigation/header.html',
  'views/dashboard.html',
  'views/forms/user-registration.html'
];

async function copyAssets() {
  console.log('📦 Copying essential assets to dist directory...');
  
  let copiedCount = 0;
  
  try {
    // Ensure dist directory exists
    await fs.mkdir(distDir, { recursive: true });
    
    await copyAssetsRecursive(srcDir, distDir);
    
    console.log(`✅ Asset copying completed: ${copiedCount} essential files copied`);
    
  } catch (error) {
    console.error('❌ Asset copying failed:', error.message);
    process.exit(1);
  }

  async function copyAssetsRecursive(sourceDir, targetDir) {
    const items = await fs.readdir(sourceDir, { withFileTypes: true });
    
    for (const item of items) {
      const sourcePath = join(sourceDir, item.name);
      const targetPath = join(targetDir, item.name);
      
      if (item.isDirectory()) {
        // Recursively copy subdirectories
        await fs.mkdir(targetPath, { recursive: true });
        await copyAssetsRecursive(sourcePath, targetPath);
      } else if (item.isFile()) {
        // Check if this is an essential asset file or production template
        const shouldCopy = ASSET_EXTENSIONS.some(ext => item.name.endsWith(ext));
        const relativePath = relative(srcDir, sourcePath);
        const isExcluded = EXCLUDED_FILES.includes(relativePath);
        const isEssential = ESSENTIAL_FILES.includes(item.name);
        const isProductionTemplate = PRODUCTION_TEMPLATES.some(template => 
                                     relativePath === template);
        
        if (shouldCopy && (isEssential || isProductionTemplate || !isExcluded)) {
          // Ensure target directory exists
          await fs.mkdir(dirname(targetPath), { recursive: true });
          await fs.copyFile(sourcePath, targetPath);
          console.log(`📄 Copied: ${relativePath}`);
          copiedCount++;
        }
      }
    }
  }
}

copyAssets(); 