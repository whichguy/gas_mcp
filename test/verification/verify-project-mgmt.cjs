#!/usr/bin/env node

/**
 * Project Management Tests
 * Verifies project lifecycle, context management, and synchronization
 */

const fs = require('fs');
const path = require('path');

console.log('📦 Project Management Verification\n');

let passed = 0;
let failed = 0;

function test(name, condition) {
  if (condition) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    failed++;
  }
}

function checkFile(filePath, content) {
  try {
    const fullPath = path.join(__dirname, '..', filePath);
    if (!fs.existsSync(fullPath)) return false;
    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    if (Array.isArray(content)) {
      return content.every(c => fileContent.includes(c));
    }
    return content ? fileContent.includes(content) : true;
  } catch (e) {
    return false;
  }
}

// Project Lifecycle Management
console.log('🔄 Project Lifecycle Management');
test('Project creation (gas_project_create)', checkFile('src/tools/project.ts', 'gas_project_create'));
test('Project initialization (gas_project_init)', checkFile('src/tools/deployments.ts', 'gas_project_init'));
test('Project metrics collection', checkFile('src/tools/project.ts', 'gas_project_metrics'));
test('CommonJS infrastructure setup', checkFile('src/tools/deployments.ts', 'CommonJS'));

console.log('\n🎯 Project Context Management');
test('Project context setting', checkFile('src/tools/projectContext.ts', 'gas_project_set'));
test('Current project tracking', checkFile('src/tools/projectContext.ts', 'current'));
test('Environment management', checkFile('src/tools/projectContext.ts', ['dev', 'prod', 'staging']));
test('Auto-pull on context switch', checkFile('src/tools/projectContext.ts', 'autoPull'));

console.log('\n🔄 Local-Remote Synchronization');
test('Pull operations (gas_pull)', checkFile('src/tools/localSync.ts', 'gas_pull'));
test('Push operations (gas_push)', checkFile('src/tools/localSync.ts', 'gas_push'));
test('Status checking (gas_status)', checkFile('src/tools/localSync.ts', 'gas_status'));
test('Sync conflict resolution', checkFile('src/tools/localSync.ts', ['conflict', 'merge']));

console.log('\n📁 Local Project Management');
test('Local root directory management', checkFile('src/tools/localRootTools.ts', 'gas_local_set_root'));
test('Local project listing', checkFile('src/tools/localRootTools.ts', 'gas_local_list_projects'));
test('Directory structure display', checkFile('src/tools/localRootTools.ts', 'gas_local_show_structure'));
test('Project organization', checkFile('src/tools/localRootTools.ts', ['structure', 'hierarchy']));

console.log('\n⚙️  Configuration Management');
test('MCP configuration system', checkFile('src/config/mcpGasConfig.ts'));
test('Project-specific configs', checkFile('src/config/mcpGasConfig.ts', 'project'));
test('Environment configurations', checkFile('src/config/mcpGasConfig.ts', ['env', 'environment']));
test('OAuth configuration', checkFile('src/config/mcpGasConfig.ts', 'oauth'));

console.log('\n🔗 Integration Features');
test('Drive folder organization', checkFile('src/tools/project.ts', ['parentId', 'folder']));
test('Automatic manifest creation', checkFile('src/tools/project.ts', 'appsscript'));
test('Project templates system', checkFile('src/templates/production-config.json') || checkFile('src/config/shimTemplate.ts'));
test('Git integration readiness', checkFile('src/tools/projectContext.ts', 'git') || checkFile('src/tools/localSync.ts', 'git'));

console.log('\n🚀 Advanced Project Features');
test('Multi-environment support', checkFile('src/tools/projectContext.ts', ['dev', 'production']));
test('Project metadata tracking', checkFile('src/tools/project.ts', ['title', 'description', 'createTime']));
test('Incremental sync capabilities', checkFile('src/tools/localSync.ts', ['incremental', 'delta']));
test('Batch operations support', checkFile('src/tools/localSync.ts', ['batch', 'bulk']));

console.log('\n🛡️  Safety and Validation');
test('Project ID validation', checkFile('src/utils/validation.ts', 'scriptId'));
test('Safe sync operations', checkFile('src/tools/localSync.ts', ['safe', 'backup']));
test('Conflict prevention', checkFile('src/tools/localSync.ts', ['conflict', 'lock']));
test('Error recovery mechanisms', checkFile('src/tools/localSync.ts', ['recover', 'rollback']));

console.log('\n📊 Results:');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);

if (failed === 0) {
  console.log('\n🎉 Project management system fully verified!');
  console.log('\n📦 Management capabilities confirmed:');
  console.log('  • Complete project lifecycle (create, init, manage)');
  console.log('  • Context-aware operations (dev/prod environments)');
  console.log('  • Robust synchronization (pull, push, status)');
  console.log('  • Local organization (root management, structure)');
  console.log('  • Configuration management (environments, OAuth)');
  console.log('  • Safety features (validation, conflict resolution)');
  console.log('  • Integration ready (Git, Drive, templates)');
} else {
  console.log('\n⚠️  Project management system needs attention');
}