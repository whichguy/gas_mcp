import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, ChildProcess } from 'child_process';
import { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP Test Client for system testing the Gas server
 */
export class MCPTestClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private serverProcess: ChildProcess | null = null;
  private connected = false;

  constructor() {
    this.client = new Client(
      {
        name: 'gas-test-client',
        version: '1.0.0',
        capabilities: {}
      }
    );
  }

  /**
   * Start the MCP Gas server process and connect
   */
  async startAndConnect(): Promise<void> {
    // Create filtered env without undefined values
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    
    // Set test mode to prevent OAuth conflicts
    env.MCP_TEST_MODE = 'true';
    env.NODE_ENV = 'test';

    // Create transport that launches the server with config file
    this.transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/src/index.js', '--config', 'gas-config.json'],
      env
    });

    // Connect client to the transport
    await this.client.connect(this.transport);
    this.connected = true;
    
    console.log('MCP Test Client connected to server');
  }

  /**
   * List available tools
   */
  async listTools(): Promise<Tool[]> {
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    const response = await this.client.listTools();
    return response.tools;
  }

  /**
   * Call a tool with parameters
   * Server handles authentication and tokens internally - no sessionId needed
   */
  async callTool(name: string, arguments_?: any): Promise<any> {
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    const result = await this.client.callTool({
      name,
      arguments: arguments_ || {}
    });

    // Check for tool errors and throw them (consistent with test expectations)
    if (result.isError) {
      throw new Error(`Tool error: ${JSON.stringify(result.content)}`);
    }

    return result;
  }

  /**
   * List available resources
   */
  async listResources(): Promise<any> {
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    return await this.client.listResources();
  }

  /**
   * Read a resource
   */
  async readResource(uri: string): Promise<any> {
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    return await this.client.readResource({ uri });
  }

  /**
   * List available prompts
   */
  async listPrompts(): Promise<any> {
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    return await this.client.listPrompts();
  }

  /**
   * Get a prompt
   */
  async getPrompt(name: string, arguments_?: any): Promise<any> {
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    return await this.client.getPrompt({
      name,
      arguments: arguments_ || {}
    });
  }

  /**
   * Parse tool result content
   */
  parseToolResult(result: any): any {
    if (result.isError) {
      throw new Error(`Tool error: ${JSON.stringify(result.content)}`);
    }

    if (!result.content || result.content.length === 0) {
      return null;
    }

    const textContent = result.content.find((c: any) => c.type === 'text');
    if (!textContent || !('text' in textContent)) {
      throw new Error('No text content in tool result');
    }

    try {
      return JSON.parse(textContent.text);
    } catch (error) {
      // If not JSON, return raw text
      return textContent.text;
    }
  }

  /**
   * Call tool and parse result in one step
   */
  async callAndParse(name: string, arguments_?: any): Promise<any> {
    const result = await this.callTool(name, arguments_);
    return this.parseToolResult(result);
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }

    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
  }

  /**
   * Check if server is running
   */
  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Helper function to create and setup test client
 */
export async function createTestClient(): Promise<MCPTestClient> {
  const client = new MCPTestClient();
  await client.startAndConnect();
  return client;
}

/**
 * Test helper for authentication flow
 * Server handles sessionId and tokens internally - no manual session management needed
 */
export class AuthTestHelper {
  private client: MCPTestClient;

  constructor(client: MCPTestClient) {
    this.client = client;
  }

  /**
   * Test authentication status
   * Server manages sessions internally
   */
  async getAuthStatus(): Promise<any> {
    return await this.client.callAndParse('auth', { mode: 'status' });
  }

  /**
   * Check if authenticated
   * Server manages sessions internally
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      const status = await this.getAuthStatus();
      return status.authenticated === true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Start interactive authentication
   * Server manages sessions internally
   */
  async startInteractiveAuth(): Promise<any> {
    return await this.client.callAndParse('auth', {
      mode: 'start',
      openBrowser: true,
      waitForCompletion: true
    });
  }

  /**
   * Start interactive authentication with browser
   * Server manages sessions internally
   */
  async startInteractiveAuthWithBrowser(): Promise<any> {
    return await this.client.callAndParse('auth', {
      mode: 'start',
      openBrowser: true,
      waitForCompletion: true
    });
  }

  /**
   * Complete authentication with code
   * Server manages sessions internally
   */
  async completeAuth(code: string): Promise<any> {
    return await this.client.callAndParse('auth', {
      mode: 'callback',
      code
    });
  }

  /**
   * Logout
   * Server manages sessions internally
   */
  async logout(): Promise<any> {
    return await this.client.callAndParse('auth', { mode: 'logout' });
  }

  /**
   * Wait for authentication with timeout
   * Server manages sessions internally
   */
  async waitForAuth(timeoutMs: number = 60000): Promise<boolean> {
    const startTime = Date.now();
    let attempt = 0;

    console.log(`⏳ Waiting for authentication (timeout: ${timeoutMs}ms)...`);

    while (Date.now() - startTime < timeoutMs) {
      attempt++;
      const elapsed = Date.now() - startTime;

      try {
        const isAuth = await this.isAuthenticated();

        if (attempt === 1 || attempt % 5 === 0) {
          console.log(`   Attempt ${attempt} (${Math.floor(elapsed/1000)}s elapsed): ${isAuth ? '✅ Authenticated' : '⏳ Not yet authenticated'}`);
        }

        if (isAuth) {
          console.log(`✅ Authentication confirmed after ${attempt} attempts (${Math.floor(elapsed/1000)}s)`);
          return true;
        }
      } catch (error) {
        if (attempt === 1 || attempt % 10 === 0) {
          console.log(`   Attempt ${attempt}: Error checking auth status - ${error}`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`❌ Authentication timeout after ${attempt} attempts (${timeoutMs}ms)`);
    return false;
  }
}

/**
 * Test helper for GAS operations
 */
export class GASTestHelper {
  private client: MCPTestClient;

  constructor(client: MCPTestClient) {
    this.client = client;
  }

  /**
   * List all projects
   */
  async listProjects(): Promise<any> {
    return await this.client.callAndParse('mcp__gas__ls', { path: '' });
  }

  /**
   * Create a test project
   */
  async createTestProject(name?: string): Promise<any> {
    const projectName = name || `Test Project ${Date.now()}`;
    return await this.client.callAndParse('project_create', { title: projectName });
  }

  /**
   * List files in a project
   */
  async listFiles(projectId: string): Promise<any> {
    return await this.client.callAndParse('mcp__gas__ls', { scriptId: projectId });
  }

  /**
   * Write a test file
   */
  async writeTestFile(projectId: string, filename: string, content?: string): Promise<any> {
    const fileContent = content || `// Test file created at ${new Date().toISOString()}\nfunction testFunction() {\n  console.log('Hello from ${filename}');\n}`;

    return await this.client.callAndParse('mcp__gas__write', {
      scriptId: projectId,
      path: filename,
      content: fileContent
    });
  }

  /**
   * Read a file
   */
  async readFile(projectId: string, filename: string): Promise<any> {
    return await this.client.callAndParse('mcp__gas__cat', {
      scriptId: projectId,
      path: filename
    });
  }

  /**
   * Get project info
   */
  async getProjectInfo(projectId: string): Promise<any> {
    return await this.client.callAndParse('mcp__gas__info', { scriptId: projectId });
  }

  /**
   * Delete a file
   */
  async deleteFile(projectId: string, filename: string): Promise<any> {
    return await this.client.callAndParse('mcp__gas__rm', {
      scriptId: projectId,
      path: filename
    });
  }

  /**
   * Copy a file
   */
  async copyFile(fromProjectId: string, fromFilename: string, toProjectId: string, toFilename: string): Promise<any> {
    return await this.client.callAndParse('mcp__gas__cp', {
      scriptId: fromProjectId,
      from: fromFilename,
      to: toFilename
    });
  }

  /**
   * Move/rename a file
   */
  async moveFile(fromProjectId: string, fromFilename: string, toProjectId: string, toFilename: string): Promise<any> {
    return await this.client.callAndParse('mcp__gas__mv', {
      scriptId: fromProjectId,
      from: fromFilename,
      to: toFilename
    });
  }

  /**
   * Run a JavaScript statement in a project
   */
  async runFunction(projectId: string, js_statement: string): Promise<any> {
    return await this.client.callAndParse('mcp__gas__run', {
      scriptId: projectId,
      js_statement: js_statement
    });
  }

  /**
   * Reorder files
   */
  async reorderFiles(projectId: string, fileOrder: string[]): Promise<any> {
    return await this.client.callAndParse('mcp__gas__reorder', {
      scriptId: projectId,
      fileOrder
    });
  }

  /**
   * Clean up test project (delete if possible)
   */
  async cleanupTestProject(projectId: string): Promise<void> {
    try {
      // Note: We don't have a delete project tool yet, so just list files and delete them
      const files = await this.listFiles(projectId);
      
      if (files.items && files.items.length > 0) {
        for (const file of files.items) {
          try {
            await this.deleteFile(projectId, file.name);
          } catch (error) {
            console.warn(`Failed to delete file ${file.name}:`, error);
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to cleanup project ${projectId}:`, error);
    }
  }
} 