import { createTestClient, AuthTestHelper, GASTestHelper } from '../test/system/mcpClient.js';

async function main() {
  console.log('🚀 Creating MCP client to connect to the server...');
  const client = await createTestClient();
  const auth = new AuthTestHelper(client);
  const gas = new GASTestHelper(client);

  try {
    // 1. Authenticate
    console.log('\n🔐 STEP 1: Starting Authentication...');
    const authStatus = await auth.getAuthStatus();

    if (authStatus.authenticated && authStatus.tokenValid) {
      console.log(`✅ Already authenticated as ${authStatus.user.email}`);
    } else {
      console.log('🔑 No valid authentication found. Starting interactive OAuth flow...');
      const authResult = await auth.startInteractiveAuthWithBrowser();
      console.log(`\n🔗 Please visit this URL to authenticate:\n${authResult.authUrl}\n`);
      console.log('⏳ Waiting for you to complete authentication in the browser...');
      
      const authCompleted = await auth.waitForAuth(120000); // 2 minute timeout
      if (authCompleted) {
        const finalStatus = await auth.getAuthStatus();
        console.log(`✅ Authentication successful for ${finalStatus.user.email}!`);
      } else {
        throw new Error('Authentication timed out or was not completed.');
      }
    }

    // 2. List Projects (ls)
    console.log('\n📁 STEP 2: Listing Google Apps Script projects...');
    const projects = await gas.listProjects();
    
    if (projects && projects.items) {
        console.log(`\n🔍 Found ${projects.items.length} projects:`);
        if (projects.items.length > 0) {
          projects.items.forEach((p: any) => {
            console.log(`  - "${p.title}" (ID: ${p.scriptId})`);
          });
        } else {
          console.log('  No projects found in your Google account.');
        }
    } else {
        console.log('\nCould not retrieve project list. Response:', projects);
    }


  } catch (error) {
    console.error('\n❌ An error occurred:', error);
  } finally {
    console.log('\n🔌 Disconnecting client...');
    await client.disconnect();
    console.log('✅ Done.');
  }
}

main().catch(e => {
  console.error('The script encountered a fatal error:', e);
  process.exit(1);
}); 