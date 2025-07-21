#!/usr/bin/env node

import { build } from 'esbuild';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, '..');

async function bundle() {
  console.log('🚀 Starting esbuild bundle...');
  
  try {
    // Ensure dist directory exists
    await fs.mkdir(join(projectRoot, 'dist'), { recursive: true });
    
    const result = await build({
      entryPoints: [join(projectRoot, 'src/index.ts')],
      bundle: true,
      outfile: join(projectRoot, 'dist/index.js'),
      platform: 'node',
      target: 'node18',
      format: 'esm',
      external: [
        '@modelcontextprotocol/sdk',
        'google-auth-library',
        'googleapis',
        'open'
      ],
      sourcemap: process.env.NODE_ENV !== 'production',
      minify: process.env.NODE_ENV === 'production',
      treeShaking: true,
      metafile: true,
      logLevel: 'info',
      define: {
        'process.env.NODE_ENV': `"${process.env.NODE_ENV || 'development'}"`
      }
    });
    
    // Write bundle analysis
    await fs.writeFile(
      join(projectRoot, 'dist/bundle-meta.json'),
      JSON.stringify(result.metafile, null, 2)
    );
    
    console.log('✅ Bundle created successfully');
    console.log('📊 Use `npm run bundle:analyze` to analyze bundle size');
    
  } catch (error) {
    console.error('❌ Bundle failed:', error.message);
    process.exit(1);
  }
}

// Only run if called directly
if (process.argv[1] === __filename) {
  bundle();
}

export { bundle }; 