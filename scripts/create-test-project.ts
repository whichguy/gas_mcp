#!/usr/bin/env ts-node

/**
 * Create a new Google Apps Script project using MCP Gas infrastructure
 */

import { InProcessTestClient, InProcessGASTestHelper } from '../test/helpers/inProcessClient.js';

async function main() {
  try {
    console.log('🚀 Creating new Google Apps Script project...\n');

    // Initialize client
    const client = await InProcessTestClient.create();
    console.log('✅ Client initialized\n');

    // Authenticate if needed
    const authStatus = await client.getAuthStatus();
    if (!authStatus.authenticated) {
      console.log('🔐 Starting authentication...');
      await client.authenticate();
    } else {
      console.log('✅ Already authenticated as:', authStatus.user?.email, '\n');
    }

    // Create GAS helper
    const gas = new InProcessGASTestHelper(client);

    // Create test project
    const projectName = `Git Auto-Init Polyrepo Test - ${new Date().toISOString().split('T')[0]}`;
    console.log('📝 Creating project:', projectName);

    const result = await gas.createTestProject(projectName);

    console.log('\n✅ Project created successfully!');
    console.log('=====================================');
    console.log('Script ID:', result.scriptId);
    console.log('Title:', result.title || projectName);
    console.log('URL:', result.url || `https://script.google.com/d/${result.scriptId}/edit`);
    console.log('=====================================\n');

    // Output for easy capture
    console.log('SCRIPTID=' + result.scriptId);

    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
