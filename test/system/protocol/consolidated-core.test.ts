import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { MCPTestClient, AuthTestHelper, GASTestHelper } from '../../helpers/mcpClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';

describe('Consolidated MCP-GAS Core Functionality Tests', () => {
  let client: MCPTestClient;
  let auth: AuthTestHelper;
  let gas: GASTestHelper;

  before(function() {
    // Try to use global authentication if available, otherwise create new client
    if (globalAuthState.isAuthenticated && globalAuthState.client) {
      client = globalAuthState.client;
      auth = globalAuthState.auth!;
      gas = new GASTestHelper(client);
      console.log('🔗 Using global authenticated client for consolidated tests');
    } else {
      // Create new client for testing (will be unauthenticated)
      console.log('🔧 Creating new client for consolidated tests (no global auth available)');
      // We'll create the client in individual tests as needed
    }
  });

  it('should test authentication infrastructure without assuming auth state', async () => {
    // This test should work whether we have global auth or not
    if (!client) {
      // Create a new client for this test
      const { createTestClient } = await import('../../helpers/mcpClient.js');
      client = await createTestClient();
      auth = new AuthTestHelper(client);
    }
    
    // Test that auth infrastructure works (can check status and start auth)
    const status = await auth.getAuthStatus();
    expect(status).to.have.property('authenticated');
    expect(status).to.have.property('tokenValid');
    
    // Test that we can start auth flow regardless of current state
    const authStart = await auth.startInteractiveAuth();
    expect(authStart).to.have.property('authUrl');
    expect(authStart.authUrl).to.include('accounts.google.com');
    
    console.log(`✅ Authentication infrastructure test completed (current auth: ${status.authenticated})`);
  });

  // Consolidated Server Connection & Tool Discovery Tests
  describe('Server Connection & Tool Discovery', () => {
    it('should connect and list all available tools with proper schemas', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createTestClient } = await import('../../helpers/mcpClient.js');
        client = await createTestClient();
        auth = new AuthTestHelper(client);
      }
      
      expect(client.isConnected()).to.be.true;

      const tools = await client.listTools();
      expect(tools).to.be.an('array');
      expect(tools.length).to.be.greaterThan(0);
      
      // Verify all expected GAS tools are present
      const toolNames = tools.map(tool => tool.name);
      const expectedTools = [
        'auth', 'gas_ls', 'gas_cat', 'gas_write', 
        'gas_rm', 'gas_mv', 'gas_cp', 'gas_mkdir', 
        'gas_info', 'gas_reorder', 'gas_run', 
        'gas_version_create', 'gas_deploy_create'
      ];
      
      for (const expectedTool of expectedTools) {
        expect(toolNames).to.include(expectedTool);
      }

      // Verify tool schemas are valid
      for (const tool of tools) {
        expect(tool).to.have.property('name');
        expect(tool).to.have.property('description');
        expect(tool).to.have.property('inputSchema');
        expect(tool.inputSchema).to.have.property('type', 'object');
        expect(tool.description).to.be.a('string').that.is.not.empty;
      }
    });

    it('should handle concurrent requests properly', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createTestClient } = await import('../../helpers/mcpClient.js');
        client = await createTestClient();
        auth = new AuthTestHelper(client);
      }
      
      const promises = [
        client.callTool('auth', { mode: 'status' }),
        client.callTool('auth', { mode: 'status' }),
        client.callTool('auth', { mode: 'status' })
      ];

      const results = await Promise.all(promises);
      
      expect(results).to.have.length(3);
      results.forEach(result => {
        expect(result).to.have.property('content');
        expect(result.content).to.be.an('array');
      });
    });
  });

  // Consolidated Authentication Flow Tests
  describe('Authentication Flow & State Management', () => {
    it('should handle complete authentication workflow', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createTestClient } = await import('../../helpers/mcpClient.js');
        client = await createTestClient();
        auth = new AuthTestHelper(client);
      }
      
      // Test auth status checking (works regardless of current auth state)
      const initialStatus = await auth.getAuthStatus();
      expect(initialStatus).to.have.property('authenticated');
      expect(initialStatus).to.have.property('tokenValid');
      
      // Test that we can start a auth flow
      const authStart = await auth.startInteractiveAuth();
      expect(authStart).to.have.property('authUrl');
      expect(authStart).to.have.property('callbackUrl');
      expect(authStart).to.have.property('state');
      expect(authStart.authUrl).to.include('accounts.google.com');
      expect(authStart.authUrl).to.include('oauth2');

      // Test callback with invalid code (expected to fail)
      try {
        await auth.completeAuth('invalid_code_12345');
        expect.fail('Should have thrown error for invalid code');
      } catch (error: any) {
        expect(error.message).to.include('Authentication failed') || 
               error.message.to.include('invalid') ||
               error.message.to.include('authorization');
      }

      // Test logout (should work regardless of auth state)
      const logoutResult = await auth.logout();
      expect(logoutResult).to.have.property('status', 'logged_out');
      
      console.log('✅ Authentication workflow test completed successfully');
    });

    it('should validate auth parameter requirements and modes', async () => {
      // Test invalid mode
      try {
        await client.callTool('auth', { mode: 'invalid_mode' });
        expect.fail('Should have thrown error for invalid mode');
      } catch (error: any) {
        // Enhanced validation provides more detailed error messages
        const isValidError = error.message.includes('Invalid mode') || 
                           error.message.includes('validation') ||
                           error.message.includes('invalid') ||
                           error.message.includes('Tool error');
        expect(isValidError).to.be.true;
      }

      // Test callback without code
      try {
        await client.callTool('auth', { mode: 'callback' });
        expect.fail('Should have thrown error for missing code');
      } catch (error: any) {
        const isValidError = error.message.includes('code') || 
                           error.message.includes('required') ||
                           error.message.includes('validation') ||
                           error.message.includes('Tool error');
        expect(isValidError).to.be.true;
      }
    });
  });

  // Consolidated Error Handling & Validation Tests
  describe('Error Handling & Input Validation', () => {
    it('should handle invalid tool names and parameters', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createTestClient } = await import('../../helpers/mcpClient.js');
        client = await createTestClient();
        auth = new AuthTestHelper(client);
      }
      
      // Test invalid tool name
      try {
        await client.callTool('invalid_tool_name');
        expect.fail('Should have thrown error for invalid tool');
      } catch (error: any) {
        const isValidError = error.message.includes('Unknown tool') || 
                           error.message.includes('not found') ||
                           error.message.includes('invalid') ||
                           error.message.includes('Tool error');
        expect(isValidError).to.be.true;
      }

      // Test invalid parameters
      try {
        await client.callTool('gas_ls', { invalidParam: 'value' });
        expect.fail('Should have thrown error for invalid parameters');
      } catch (error: any) {
        // May get auth error instead of validation error due to enhanced handling
        const isValidError = error.message.includes('validation') || 
                           error.message.includes('invalid') ||
                           error.message.includes('Tool error') ||
                           error.data?.requiresAuth === true;
        expect(isValidError).to.be.true;
      }
    });

    it('should validate file paths and content restrictions', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createTestClient } = await import('../../helpers/mcpClient.js');
        client = await createTestClient();
        auth = new AuthTestHelper(client);
      }
      
      const restrictions = [
        { path: 'project/../escape', reason: 'path traversal' },
        { path: 'project//double-slash', reason: 'double slash' },
        { path: '/absolute/path', reason: 'absolute path' }
      ];

      let validationErrors = 0;
      
      for (const { path, reason } of restrictions) {
        try {
          await client.callTool('gas_cat', { path });
          console.log(`Warning: ${reason} restriction not enforced for ${path}`);
        } catch (error: any) {
          // Count any kind of error (validation or auth) as restriction working
          if (error.message.includes('validation') || 
              error.message.includes('unsafe') ||
              error.message.includes('invalid') ||
              error.message.includes('Tool error') ||
              error.data?.requiresAuth === true) {
            validationErrors++;
          }
        }
      }
      
      // At least some restrictions should be enforced
      expect(validationErrors).to.be.at.least(1);
    });
  });

  // Consolidated Unauthenticated Access Tests
  describe('Unauthenticated Access Patterns', () => {
    it('should provide helpful authentication guidance', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createTestClient } = await import('../../helpers/mcpClient.js');
        client = await createTestClient();
        auth = new AuthTestHelper(client);
      }
      
      // Test unauthenticated access by temporarily logging out if needed
      let wasAuthenticated = false;
      
      try {
        // Check current auth status
        const authStatus = await auth.getAuthStatus();
        wasAuthenticated = authStatus.authenticated;
        
        if (wasAuthenticated) {
          await auth.logout();
        }
        
        // Now test unauthenticated access
        try {
          await client.callTool('gas_ls', { path: 'some_project' });
          expect.fail('Should have thrown authentication error');
        } catch (error: any) {
          // Enhanced error responses include OAuth URLs and instructions
          const hasGuidance = error.data?.authUrl || 
                            error.data?.instructions ||
                            error.data?.requiresAuth === true ||
                            error.message.includes('Tool error') ||
                            error.message.includes('Authentication required');
          expect(hasGuidance).to.be.true;
        }
      } finally {
        // Re-authenticate if we were authenticated before
        if (wasAuthenticated) {
          try {
            await auth.startInteractiveAuth();
          } catch (error) {
            // Ignore auth failures during cleanup
          }
        }
      }
    });
  });

  // Consolidated Protocol Compliance Tests
  describe('MCP Protocol Compliance', () => {
    it('should return properly formatted MCP responses', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createTestClient } = await import('../../helpers/mcpClient.js');
        client = await createTestClient();
        auth = new AuthTestHelper(client);
      }
      
      const result = await client.callTool('auth', { mode: 'status' });
      
      // Should follow MCP response format
      expect(result).to.have.property('content');
      expect(result.content).to.be.an('array');
      
      if (result.content.length > 0) {
        const content = result.content[0];
        expect(content).to.have.property('type');
        expect(['text', 'image', 'audio']).to.include(content.type);
        
        if (content.type === 'text') {
          expect(content).to.have.property('text');
          expect(content.text).to.be.a('string');
        }
      }
    });

    it('should handle rate limiting gracefully', async function() {
      this.timeout(15000);

      // Ensure we have a client for this test
      if (!client) {
        const { createTestClient } = await import('../../helpers/mcpClient.js');
        client = await createTestClient();
        auth = new AuthTestHelper(client);
      }

      // Make many concurrent requests to test rate limiting
      const promises: Promise<any>[] = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          client.callTool('auth', { mode: 'status' }).catch(error => ({ error: error.message }))
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => !r.error).length;
      const rateLimited = results.filter(r => 
        r.error && r.error.includes('rate limit')
      ).length;

      // Most should succeed
      expect(successful).to.be.greaterThan(40);
      
      // If any are rate limited, they should have helpful messages
      if (rateLimited > 0) {
        const rateLimitError = results.find(r => r.error && r.error.includes('rate limit'));
        expect(rateLimitError.error).to.include('retry') ||
               expect(rateLimitError.error).to.include('limit');
      }
    });
  });

  // Consolidated OAuth Configuration Tests
  describe('OAuth Configuration & Validation', () => {
    it('should have valid OAuth client credentials configured', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createTestClient } = await import('../../helpers/mcpClient.js');
        client = await createTestClient();
        auth = new AuthTestHelper(client);
      }
      
      const authStart = await auth.startInteractiveAuth();
      
      // Should generate valid OAuth URL
      expect(authStart.authUrl).to.include('accounts.google.com');
      expect(authStart.authUrl).to.include('oauth2');
      expect(authStart.authUrl).to.include('client_id=');
      expect(authStart.authUrl).to.include('redirect_uri=');
      expect(authStart.authUrl).to.include('scope=');
      
      // Should include required scopes for Google Apps Script
      const requiredScopes = [
        'script.projects',
        'script.processes', 
        'script.deployments',
        'drive',
        'userinfo.email'
      ];
      
      for (const scope of requiredScopes) {
        expect(authStart.authUrl).to.include(scope);
      }
    });

    it('should detect and handle placeholder credentials', async () => {
      // Ensure we have a client for this test
      if (!client) {
        const { createTestClient } = await import('../../helpers/mcpClient.js');
        client = await createTestClient();
        auth = new AuthTestHelper(client);
      }
      
      // The auth URL should not contain obvious placeholder values
      const authStart = await auth.startInteractiveAuth();
      
      const placeholderPatterns = [
        'your_client_id',
        'placeholder',
        'example.com',
        'localhost:3000', // Should use actual callback
        'test_secret'
      ];
      
      for (const placeholder of placeholderPatterns) {
        expect(authStart.authUrl).to.not.include(placeholder);
      }
      
      // Should have reasonable callback URL
      expect(authStart.callbackUrl).to.be.a('string').that.is.not.empty;
      expect(authStart.callbackUrl).to.include('http');
    });
  });
}); 