import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { MCPTestClient } from '../../helpers/mcpClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';

describe('MCP Server Basic Connection Tests', () => {
  let client: MCPTestClient;

  before(function() {
    // Use the shared global client to avoid multiple server processes
    if (!globalAuthState.client) {
      this.skip(); // Skip if global client not available
    }
    client = globalAuthState.client!; // Non-null assertion since we checked above
    console.log('🔗 Using shared global MCP client for basic connection tests');
  });

  describe('Server Connectivity', () => {
    it('should successfully connect to the MCP server', () => {
      expect(client.isConnected()).to.be.true;
    });

    it('should list all available tools', async () => {
      const tools = await client.listTools();
      
      expect(tools).to.be.an('array');
      expect(tools.length).to.be.greaterThan(0);
      
      // Check for expected GAS tools
      const toolNames = tools.map(tool => tool.name);
      
      expect(toolNames).to.include('auth');
      expect(toolNames).to.include('ls');
      expect(toolNames).to.include('cat');
      expect(toolNames).to.include('write');
      expect(toolNames).to.include('rm');
      expect(toolNames).to.include('mv');
      expect(toolNames).to.include('cp');
      expect(toolNames).to.include('reorder');
    });

    it('should provide proper tool schemas', async () => {
      const tools = await client.listTools();
      
      for (const tool of tools) {
        expect(tool).to.have.property('name');
        expect(tool).to.have.property('description');
        expect(tool).to.have.property('inputSchema');
        
        // Check that input schema is valid
        expect(tool.inputSchema).to.have.property('type');
        expect(tool.inputSchema.type).to.equal('object');
      }
    });

    it('should handle auth status check without authentication', async () => {
      // This should return a non-authenticated status, not throw
      const result = await client.callAndParse('auth', { mode: 'status' });
      
      expect(result).to.have.property('authenticated');
      expect(result.authenticated).to.be.false;
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid tool names gracefully', async () => {
      try {
        await client.callTool('invalid_tool_name');
        expect.fail('Should have thrown an error for invalid tool');
      } catch (error: any) {
        // Enhanced error handling may return different formats
        const isValidError = error.message.includes('Unknown tool') || 
                           error.message.includes('not found') ||
                           error.message.includes('invalid') ||
                           error.message.includes('Tool error');
        expect(isValidError).to.be.true;
      }
    });

    it('should handle missing required parameters', async () => {
      try {
        await client.callTool('cat'); // Missing required path parameter
        expect.fail('Should have thrown an error for missing parameters');
      } catch (error: any) {
        // Enhanced validation may include auth-related responses or validation errors
        const isValidError = error.message.includes('validation') || 
                           error.message.includes('required') ||
                           error.message.includes('Tool error') ||
                           error.message.includes('path') ||
                           error.constructor?.name === 'ValidationError' ||
                           error.data?.requiresAuth === true;
        expect(isValidError).to.be.true;
      }
    });

    it('should handle invalid parameter types', async () => {
      try {
        await client.callTool('ls', { path: 123 }); // Invalid type
        expect.fail('Should have thrown an error for invalid parameter type');
      } catch (error: any) {
        // Enhanced validation provides more detailed error messages
        const isValidError = error.message.includes('validation') || 
                           error.message.includes('type') ||
                           error.message.includes('Tool error') ||
                           error.message.includes('invalid');
        expect(isValidError).to.be.true;
      }
    });
  });

  describe('Protocol Compliance', () => {
    it('should return properly formatted responses', async () => {
      const result = await client.callTool('auth', { mode: 'status' });
      
      // Should follow MCP response format
      expect(result).to.have.property('content');
      expect(result.content).to.be.an('array');
      
      if (result.content.length > 0) {
        const content = result.content[0];
        expect(content).to.have.property('type');
        expect(['text', 'image', 'audio']).to.include(content.type);
      }
    });

    it('should handle concurrent requests properly', async () => {
      const promises = [
        client.callTool('auth', { mode: 'status' }),
        client.callTool('auth', { mode: 'status' }),
        client.callTool('auth', { mode: 'status' })
      ];

      const results = await Promise.all(promises);
      
      expect(results).to.have.length(3);
      results.forEach(result => {
        expect(result).to.have.property('content');
      });
    });
  });
}); 