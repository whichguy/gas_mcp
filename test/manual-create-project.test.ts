/**
 * Manual test to create a new GAS project for testing
 * Run with: npx mocha test/manual-create-project.test.ts --timeout 60000
 */

import { InProcessTestClient, InProcessGASTestHelper } from './helpers/inProcessClient.js';
import { expect } from 'chai';

describe('Manual: Create Test Project', () => {
  let client: InProcessTestClient;
  let gas: InProcessGASTestHelper;

  before(async function() {
    this.timeout(60000);

    console.log('\n🚀 Initializing MCP Gas client...');
    client = await InProcessTestClient.create();

    console.log('🔐 Checking authentication...');
    const authStatus = await client.getAuthStatus();

    if (!authStatus.authenticated) {
      console.log('❌ Not authenticated. Please run authentication first.');
      console.log('Run: npm test (and complete OAuth flow)');
      this.skip();
      return;
    }

    console.log('✅ Authenticated as:', authStatus.user?.email);
    gas = new InProcessGASTestHelper(client);
  });

  it('should create a new test project', async function() {
    this.timeout(60000);

    const projectName = `Git Auto-Init Polyrepo Test - ${new Date().toISOString().split('T')[0]}`;
    console.log('\n📝 Creating project:', projectName);

    const result = await gas.createTestProject(projectName);

    console.log('\n✅ PROJECT CREATED SUCCESSFULLY!');
    console.log('=====================================');
    console.log('Script ID:', result.scriptId);
    console.log('Title:', result.title || projectName);
    console.log('URL:', `https://script.google.com/d/${result.scriptId}/edit`);
    console.log('=====================================\n');

    // Verify result
    expect(result).to.have.property('scriptId');
    expect(result.scriptId).to.be.a('string');
    expect(result.scriptId).to.have.length.greaterThan(20);

    // Output for capture
    console.log(`\n💾 SAVE THIS SCRIPT ID: ${result.scriptId}\n`);
  });
});
