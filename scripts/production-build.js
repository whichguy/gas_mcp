#!/usr/bin/env node

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

/**
 * Production-ready build script for MCP Gas Server
 * Handles environment-specific configurations and deployment artifacts
 */

async function productionBuild() {
  console.log('🏭 Starting production build process...');
  
  const environment = process.env.NODE_ENV || 'production';
  const version = process.env.BUILD_VERSION || 'latest';
  
  console.log(`📊 Build Configuration:`);
  console.log(`   Environment: ${environment}`);
  console.log(`   Version: ${version}`);
  console.log(`   Platform: ${process.platform}`);
  
  try {
    // 1. Clean previous builds
    console.log('🧹 Cleaning previous builds...');
    execSync('npm run clean', { cwd: projectRoot, stdio: 'inherit' });
    
    // 2. TypeScript compilation (production config)
    console.log('📦 Compiling TypeScript (production)...');
    execSync('npx tsc -p tsconfig.production.json', { cwd: projectRoot, stdio: 'inherit' });
    
    // 3. Copy essential assets and production templates
    console.log('📄 Copying production assets...');
    execSync('npm run copy:assets', { cwd: projectRoot, stdio: 'inherit' });
    
    // 4. Create environment-specific configurations
    console.log('⚙️ Creating environment configurations...');
    await createEnvironmentConfigs(environment, version);
    
    // 5. Generate deployment artifacts
    console.log('🚀 Generating deployment artifacts...');
    await generateDeploymentArtifacts(environment, version);
    
    // 6. Create production package info
    console.log('📋 Creating package metadata...');
    await createPackageMetadata(environment, version);
    
    // 7. Validate production build
    console.log('✅ Validating production build...');
    await validateProductionBuild();
    
    console.log('🎉 Production build completed successfully!');
    console.log(`📦 Build artifacts available in: dist/`);
    console.log(`🏷️  Version: ${version}`);
    console.log(`🌍 Environment: ${environment}`);
    
  } catch (error) {
    console.error('❌ Production build failed:', error.message);
    process.exit(1);
  }
}

/**
 * Create environment-specific configuration files
 */
async function createEnvironmentConfigs(environment, version) {
  const configDir = join(projectRoot, 'dist', 'config');
  await fs.mkdir(configDir, { recursive: true });
  
  // Read the production config template
  const templatePath = join(projectRoot, 'src', 'templates', 'production-config.json');
  const template = await fs.readFile(templatePath, 'utf-8');
  
  // Replace environment variables with actual values (client_id is hardcoded in template)
  const config = template
    .replace(/\${MCP_GAS_PROJECTS_ROOT}/g, process.env.MCP_GAS_PROJECTS_ROOT || '~/.mcp-gas/projects')
    .replace(/\${MCP_GAS_WORKSPACE}/g, process.env.MCP_GAS_WORKSPACE || '~/.mcp-gas/workspace')
    .replace(/\${DEPLOYMENT_VERSION}/g, version)
    .replace(/\${MCP_GAS_TIMEZONE:-America\/New_York}/g, process.env.MCP_GAS_TIMEZONE || 'America/New_York');
  
  // Write environment-specific config
  const configPath = join(configDir, `${environment}-config.json`);
  await fs.writeFile(configPath, config);
  console.log(`   ✅ Created ${environment} configuration: ${configPath}`);
}

/**
 * Generate deployment artifacts for different environments
 */
async function generateDeploymentArtifacts(environment, version) {
  const artifactsDir = join(projectRoot, 'dist', 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });
  
  // Create deployment info
  const deploymentInfo = {
    version: version,
    environment: environment,
    buildTime: new Date().toISOString(),
    platform: process.platform,
    nodeVersion: process.version,
    dependencies: await getProductionDependencies(),
    entryPoint: 'src/index.js',
    configFile: `config/${environment}-config.json`,
    templates: [
      'src/CommonJS.js',
      'src/__mcp_gas_run.js',
      'src/appsscript.json',
      'src/templates/error-handler.gs'
    ]
  };
  
  await fs.writeFile(
    join(artifactsDir, 'deployment-info.json'),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  // Create startup script
  const startupScript = `#!/bin/bash
# MCP Gas Server Startup Script
# Version: ${version}
# Environment: ${environment}

export NODE_ENV=${environment}
export MCP_GAS_VERSION=${version}

# Start the MCP Gas Server
node dist/src/index.js --config dist/config/${environment}-config.json
`;
  
  await fs.writeFile(join(artifactsDir, 'start.sh'), startupScript);
  await fs.chmod(join(artifactsDir, 'start.sh'), 0o755);
  
  console.log(`   ✅ Created deployment artifacts for ${environment}`);
}

/**
 * Create package metadata for production deployment
 */
async function createPackageMetadata(environment, version) {
  const packageJsonPath = join(projectRoot, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
  
  const productionMetadata = {
    name: packageJson.name,
    version: version,
    description: packageJson.description,
    main: 'dist/src/index.js',
    environment: environment,
    buildInfo: {
      buildTime: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      dependencies: Object.keys(packageJson.dependencies || {}),
      devDependencies: Object.keys(packageJson.devDependencies || {})
    },
    scripts: {
      start: `node dist/src/index.js --config dist/config/${environment}-config.json`,
      health: 'node dist/scripts/health-check.js'
    }
  };
  
  await fs.writeFile(
    join(projectRoot, 'dist', 'package-production.json'),
    JSON.stringify(productionMetadata, null, 2)
  );
  
  console.log(`   ✅ Created production package metadata`);
}

/**
 * Get production dependencies only
 */
async function getProductionDependencies() {
  const packageJsonPath = join(projectRoot, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
  return packageJson.dependencies || {};
}

/**
 * Validate the production build
 */
async function validateProductionBuild() {
  const requiredFiles = [
    'dist/src/index.js',
    'dist/src/CommonJS.js',
    'dist/src/__mcp_gas_run.js',
    'dist/src/appsscript.json',
    'dist/src/templates/error-handler.gs',
    'dist/artifacts/deployment-info.json'
  ];
  
  const missingFiles = [];
  
  for (const file of requiredFiles) {
    const fullPath = join(projectRoot, file);
    try {
      await fs.access(fullPath);
    } catch (error) {
      missingFiles.push(file);
    }
  }
  
  if (missingFiles.length > 0) {
    throw new Error(`Missing required files: ${missingFiles.join(', ')}`);
  }
  
  // Validate that entry point can be loaded (basic syntax check)
  try {
    const entryPointPath = join(projectRoot, 'dist', 'src', 'index.js');
    const entryPointContent = await fs.readFile(entryPointPath, 'utf-8');
    if (!entryPointContent.includes('import') && !entryPointContent.includes('export')) {
      throw new Error('Entry point does not appear to be valid ES module');
    }
  } catch (error) {
    throw new Error(`Entry point validation failed: ${error.message}`);
  }
  
  console.log(`   ✅ All required files present and valid`);
}

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  productionBuild().catch(error => {
    console.error('❌ Production build failed:', error);
    process.exit(1);
  });
} 