/**
 * In-Process Test Client
 *
 * Runs authentication and tools in the SAME process as tests.
 * No child process spawning, no stdio transport.
 * Direct access to class instances with full console output visibility.
 */

import { GASAuthClient } from '../../src/auth/oauthClient.js';
import { SessionAuthManager } from '../../src/auth/sessionManager.js';
import { GASClient } from '../../src/api/gasClient.js';
import { McpGasConfigManager } from '../../src/config/mcpGasConfig.js';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * In-process test client - runs everything in the same Node.js process
 */
export class InProcessTestClient {
  public authClient: GASAuthClient;
  public sessionManager: SessionAuthManager;
  public gasClient: GASClient;
  public configManager: typeof McpGasConfigManager;  // Static class reference
  private sessionId: string;

  private constructor(
    authClient: GASAuthClient,
    sessionManager: SessionAuthManager,
    gasClient: GASClient,
    configManager: typeof McpGasConfigManager,  // Static class reference
    sessionId: string
  ) {
    this.authClient = authClient;
    this.sessionManager = sessionManager;
    this.gasClient = gasClient;
    this.configManager = configManager;
    this.sessionId = sessionId;
  }

  /**
   * Create and initialize in-process client
   */
  static async create(): Promise<InProcessTestClient> {
    console.log('🔧 Initializing in-process test client...');

    // Initialize config
    const configPath = path.join(process.cwd(), 'gas-config.json');
    await McpGasConfigManager.initializeFromFile(configPath);
    console.log('✅ Config loaded');

    // Load OAuth config
    const oauthConfig = await McpGasConfigManager.getOAuthConfig();
    console.log('✅ OAuth config loaded');

    // Create OAuth client with config (force type to 'desktop' if it's 'web')
    const authClient = new GASAuthClient({
      client_id: oauthConfig.client_id,
      type: (oauthConfig.type === 'web' ? 'desktop' : oauthConfig.type) as 'uwp' | 'desktop',
      redirect_uris: oauthConfig.redirect_uris,
      scopes: oauthConfig.scopes
    });
    console.log('✅ OAuth client created');

    // Generate session ID
    const sessionId = `test-session-${randomUUID()}`;
    console.log(`✅ Session ID: ${sessionId}`);

    // Create session manager with session ID
    const sessionManager = new SessionAuthManager(sessionId);
    console.log('✅ Session manager created');

    // Create GAS API client
    const gasClient = new GASClient();
    console.log('✅ GAS API client created');

    console.log('✅ In-process client ready\n');

    return new InProcessTestClient(
      authClient,
      sessionManager,
      gasClient,
      McpGasConfigManager,  // Pass the class itself, not an instance
      sessionId
    );
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Check authentication status
   */
  async getAuthStatus(): Promise<any> {
    return await this.sessionManager.getAuthStatus();
  }

  /**
   * Start interactive authentication with browser
   */
  async startAuth(openBrowser: boolean = true, waitForCompletion: boolean = true): Promise<any> {
    console.log('\n🔐 Starting authentication flow...');
    console.log(`   openBrowser: ${openBrowser}`);
    console.log(`   waitForCompletion: ${waitForCompletion}`);

    try {
      if (!waitForCompletion) {
        // Non-blocking mode - just start the flow
        const authUrl = await this.authClient.startAuthFlow(openBrowser);
        console.log(`\n🔗 Auth URL: ${authUrl}\n`);

        return {
          authUrl,
          message: 'Authentication started. Complete OAuth flow in browser, then poll status.',
          waitForCompletion: false
        };
      }

      // Blocking mode - wait for completion using the session manager's auth flow
      // Import the auth function and use it
      const { auth } = await import('../../src/tools/auth.js');

      console.log(`🔐 [InProcessTestClient] Calling auth tool with session: ${this.sessionId}`);
      console.log(`   SessionManager instance: ${this.sessionManager.constructor.name}`);

      // Use auth with the session manager - this handles all the promise coordination
      const result = await auth({
        mode: 'start',
        openBrowser,
        waitForCompletion: true
      }, this.sessionManager);

      console.log('✅ OAuth flow completed');
      console.log('🔍 Checking if token was saved to SessionManager...');

      // Verify token is now available
      try {
        const verifyToken = await this.sessionManager.getValidToken();
        if (verifyToken) {
          console.log(`✅ Token successfully saved to SessionManager (length: ${verifyToken.length})`);
        } else {
          console.error('⚠️  OAuth completed but token not found in SessionManager!');
          console.error('   This is the root cause of "Access token is required" errors');
        }
      } catch (verifyError: any) {
        console.error(`❌ Error verifying token in SessionManager: ${verifyError.message}`);
      }

      return result;

    } catch (error: any) {
      console.error('❌ Authentication failed:', error.message);
      throw error;
    }
  }

  /**
   * Logout - clear session
   */
  async logout(): Promise<void> {
    console.log(`🔓 Logging out session: ${this.sessionId}`);
    await this.sessionManager.clearAuth();
    console.log('✅ Session cleared');
  }

  /**
   * Get access token for API calls
   */
  async getAccessToken(): Promise<string> {
    console.log(`🔍 [InProcessTestClient] Getting access token for session: ${this.sessionId}`);
    const token = await this.sessionManager.getValidToken();
    if (!token) {
      console.error(`❌ [InProcessTestClient] No token available from SessionManager for session: ${this.sessionId}`);
      console.error('   This indicates OAuth completed but token was not properly saved to SessionManager');
      throw new Error('Not authenticated - no access token available');
    }
    console.log(`✅ [InProcessTestClient] Token retrieved successfully (length: ${token.length})`);
    return token;
  }

  /**
   * List projects
   */
  async listProjects(): Promise<any> {
    const accessToken = await this.getAccessToken();
    const projects = await this.gasClient.listProjects(10, accessToken);
    return projects;
  }

  /**
   * Get project info
   */
  async getProjectInfo(scriptId: string): Promise<any> {
    const accessToken = await this.getAccessToken();
    const info = await this.gasClient.getProject(scriptId, accessToken);
    return info;
  }

  /**
   * List files in project
   */
  async listFiles(scriptId: string): Promise<any> {
    const accessToken = await this.getAccessToken();
    const files = await this.gasClient.getProjectContent(scriptId, accessToken);
    return files;
  }

  /**
   * Get file content
   */
  async getFileContent(scriptId: string, filename: string): Promise<string> {
    const accessToken = await this.getAccessToken();
    const files = await this.gasClient.getProjectContent(scriptId, accessToken);

    const file = files.find((f: any) => f.name === filename);
    if (!file) {
      throw new Error(`File not found: ${filename}`);
    }

    return file.source || '';
  }

  /**
   * Update file content
   */
  async updateFile(scriptId: string, filename: string, source: string): Promise<any> {
    const accessToken = await this.getAccessToken();
    const currentFiles = await this.gasClient.getProjectContent(scriptId, accessToken);

    // Find and update the file
    const fileIndex = currentFiles.findIndex((f: any) => f.name === filename);
    if (fileIndex === -1) {
      // Add new file
      currentFiles.push({ name: filename, type: 'SERVER_JS', source });
    } else {
      // Update existing file
      currentFiles[fileIndex].source = source;
    }

    return await this.gasClient.updateProjectContent(scriptId, currentFiles, accessToken);
  }

  /**
   * Create new project
   */
  async createProject(title: string): Promise<any> {
    const accessToken = await this.getAccessToken();
    // Note: GASClient.createProject signature is (title, parentId?, accessToken?)
    // Pass undefined for parentId to correctly position accessToken parameter
    const project = await this.gasClient.createProject(title, undefined, accessToken);
    return project;
  }

  /**
   * Call a tool by name (for backwards compatibility with MCP test client)
   * This executes tools directly in-process instead of via MCP protocol
   */
  async callTool(name: string, args: any = {}): Promise<any> {
    // Handle auth tool specially since it doesn't require API access
    if (name === 'auth') {
      return await this._handleAuthTool(args);
    }

    // Import and execute git tools
    if (name === 'local_sync') {
      const { LocalSyncTool } = await import('../../src/tools/gitSync.js');
      const tool = new LocalSyncTool(this.sessionManager);

      // Execute the tool (session manager is passed via constructor)
      const result = await tool.execute(args);

      // Return in MCP format
      return {
        content: [{
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        }]
      };
    }

    // Import and execute config tool
    if (name === 'config') {
      const { ConfigTool } = await import('../../src/tools/config.js');
      const tool = new ConfigTool(this.sessionManager);

      // Execute the tool (session manager is passed via constructor)
      const result = await tool.execute(args);

      // Return in MCP format
      return {
        content: [{
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        }]
      };
    }

    // Import and execute file operation tools
    if (name === 'cat' || name === 'raw_cat' || name === 'ls') {
      let tool;
      switch (name) {
        case 'cat':
          const { CatTool } = await import('../../src/tools/filesystem/CatTool.js');
          tool = new CatTool(this.sessionManager);
          break;
        case 'raw_cat':
          const { RawCatTool } = await import('../../src/tools/filesystem/RawCatTool.js');
          tool = new RawCatTool(this.sessionManager);
          break;
        case 'ls':
          const { LsTool } = await import('../../src/tools/filesystem/LsTool.js');
          tool = new LsTool(this.sessionManager);
          break;
      }

      // Execute the tool (session manager is passed via constructor)
      const result = await tool!.execute(args);

      // Return in MCP format
      return {
        content: [{
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        }]
      };
    }

    // For tools we haven't implemented, throw error
    const supportedTools = ['auth', 'gas_deploy', 'local_sync', 'config', 'cat', 'raw_cat', 'ls'];
    throw new Error(
      `Tool '${name}' not yet supported in direct execution mode.\n` +
      `Supported tools: ${supportedTools.join(', ')}\n` +
      `Use direct methods instead (e.g., client.listProjects() instead of callTool('gas_project_list'))`
    );
  }

  /**
   * Parse tool result (for backwards compatibility)
   * Extracts the content from MCP format and parses JSON if needed
   */
  parseToolResult(result: any): any {
    // If result has MCP content format, extract and parse
    if (result && result.content && Array.isArray(result.content) && result.content.length > 0) {
      const text = result.content[0].text;
      try {
        // Try to parse as JSON
        return JSON.parse(text);
      } catch {
        // If not JSON, return as-is
        return text;
      }
    }
    return result;
  }

  /**
   * Call tool and parse result (for backwards compatibility)
   */
  async callAndParse(name: string, args: any = {}): Promise<any> {
    const result = await this.callTool(name, args);
    return this.parseToolResult(result);
  }

  /**
   * Handle auth tool calls
   */
  private async _handleAuthTool(args: any): Promise<any> {
    const mode = args.mode || 'status';

    switch (mode) {
      case 'status':
        const status = await this.getAuthStatus();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(status, null, 2)
          }]
        };

      case 'start':
        const openBrowser = args.openBrowser !== false;
        const waitForCompletion = args.waitForCompletion !== false;
        const authResult = await this.startAuth(openBrowser, waitForCompletion);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(authResult, null, 2)
          }]
        };

      case 'logout':
        await this.logout();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, message: 'Logged out successfully' }, null, 2)
          }]
        };

      default:
        throw new Error(`Unknown auth mode: ${mode}`);
    }
  }

  /**
   * Check if connected (always true for in-process)
   */
  isConnected(): boolean {
    return true;
  }

  /**
   * List available MCP tools (for test compatibility)
   * Returns basic tool information for tests that check tool availability
   */
  async listTools(): Promise<any[]> {
    // In-process client doesn't use MCP protocol, but we can return info about available operations
    // This is mainly for test compatibility
    return [
      { name: 'auth', description: 'OAuth authentication' },
      { name: 'gas_project_list', description: 'List GAS projects' },
      { name: 'gas_project_create', description: 'Create new GAS project' },
      { name: 'cat', description: 'Read file contents' },
      { name: 'write', description: 'Write file contents' },
      { name: 'ls', description: 'List files in project' },
      { name: 'exec', description: 'Execute code in GAS environment' }
    ];
  }

  /**
   * Cleanup - disconnect and clear state
   */
  async cleanup(): Promise<void> {
    console.log('\n🧹 Cleaning up in-process client...');
    await this.logout();
    console.log('✅ Cleanup complete\n');
  }
}

/**
 * Helper function to create in-process test client
 */
export async function createInProcessClient(): Promise<InProcessTestClient> {
  return await InProcessTestClient.create();
}

/**
 * In-process auth helper
 */
export class InProcessAuthHelper {
  private client: InProcessTestClient;

  constructor(client: InProcessTestClient) {
    this.client = client;
  }

  async getAuthStatus(): Promise<any> {
    return await this.client.getAuthStatus();
  }

  async isAuthenticated(): Promise<boolean> {
    const status = await this.getAuthStatus();
    return status.authenticated === true;
  }

  async startInteractiveAuthWithBrowser(): Promise<any> {
    return await this.client.startAuth(true, true);
  }

  async startInteractiveAuth(): Promise<any> {
    // Alias for startInteractiveAuthWithBrowser
    return await this.startInteractiveAuthWithBrowser();
  }

  async completeAuth(code: string): Promise<any> {
    // Note: In-process client doesn't support manual code completion
    // The OAuth flow is handled entirely by startAuth()
    throw new Error('completeAuth() not supported in in-process client. Use startInteractiveAuth() instead.');
  }

  async logout(): Promise<void> {
    await this.client.logout();
  }

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
 * In-process GAS test helper - provides common GAS testing operations
 */
export class InProcessGASTestHelper {
  private client: InProcessTestClient;

  constructor(client: InProcessTestClient) {
    this.client = client;
  }

  /**
   * List all projects
   */
  async listProjects(): Promise<any> {
    return await this.client.listProjects();
  }

  /**
   * Create a test project with CommonJS infrastructure
   */
  async createTestProject(name?: string): Promise<any> {
    const projectName = name || `Test Project ${Date.now()}`;

    // Import ProjectCreateTool which sets up CommonJS automatically
    const { ProjectCreateTool } = await import('../../src/tools/deployments.js');
    const projectCreateTool = new ProjectCreateTool(this.client.sessionManager);

    // Create project with CommonJS infrastructure
    const result = await projectCreateTool.execute({
      title: projectName
    });

    // Parse result if it's a string
    if (typeof result === 'string') {
      return JSON.parse(result);
    }

    return result;
  }

  /**
   * List files in a project
   */
  async listFiles(projectId: string): Promise<any> {
    return await this.client.listFiles(projectId);
  }

  /**
   * Write a test file with CommonJS wrapping support
   */
  async writeTestFile(projectId: string, filename: string, content?: string): Promise<any> {
    const fileContent = content || `// Test file created at ${new Date().toISOString()}\nfunction testFunction() {\n  console.log('Hello from ${filename}');\n}`;

    // Strip .gs extension if present - GAS stores files without extension
    const gasFilename = filename.endsWith('.gs') ? filename.slice(0, -3) : filename;

    // If content uses module.exports or exports, use WriteTool for CommonJS wrapping
    if (fileContent.includes('module.exports') || fileContent.includes('exports.')) {
      const { WriteTool } = await import('../../src/tools/filesystem/WriteTool.js');
      const writeTool = new WriteTool(this.client.sessionManager);

      const result = await writeTool.execute({
        scriptId: projectId,
        path: gasFilename,
        content: fileContent
      });

      return result;
    }

    // For non-module files, use direct update
    return await this.client.updateFile(projectId, gasFilename, fileContent);
  }

  /**
   * Read a file
   */
  async readFile(projectId: string, filename: string): Promise<any> {
    return await this.client.getFileContent(projectId, filename);
  }

  /**
   * Get project info
   */
  async getProjectInfo(projectId: string): Promise<any> {
    return await this.client.getProjectInfo(projectId);
  }

  /**
   * Cleanup test projects (helper for test teardown)
   */
  async cleanupTestProjects(): Promise<void> {
    console.log('⚠️  Note: In-process client does not implement project deletion yet');
    console.log('   Manual cleanup may be required via Google Apps Script dashboard');
  }

  /**
   * Cleanup a single test project (alias for compatibility)
   */
  async cleanupTestProject(projectId: string): Promise<void> {
    console.log(`⚠️  Note: In-process client does not implement project deletion yet`);
    console.log(`   Manual cleanup required for project: ${projectId}`);
    console.log('   Visit: https://script.google.com to delete manually');
  }

  /**
   * Run a function in a project using exec tool
   * @param projectId The GAS project scriptId
   * @param code JavaScript code/expression to execute
   * @returns Execution result with status, result, and logger_output
   */
  async runFunction(projectId: string, code: string): Promise<any> {
    // Import ExecTool and execute it directly
    const { ExecTool } = await import('../../src/tools/execution.js');
    const execTool = new ExecTool(this.client.sessionManager);

    // Execute the code with autoRedeploy enabled
    const result = await execTool.execute({
      scriptId: projectId,
      js_statement: code,
      autoRedeploy: true
    });

    // Parse result from string if needed
    if (typeof result === 'string') {
      try {
        return JSON.parse(result);
      } catch {
        // If not JSON, return as object with the string
        return { status: 'success', result: result };
      }
    }

    return result;
  }

  /**
   * Copy a file within a project or between projects
   */
  async copyFile(sourceProjectId: string, sourceFilename: string, destProjectId: string, destFilename: string): Promise<any> {
    throw new Error('copyFile() not yet implemented in InProcessGASTestHelper. Use callTool("gas_cp") instead.');
  }

  /**
   * Move/rename a file within a project or between projects
   */
  async moveFile(sourceProjectId: string, sourceFilename: string, destProjectId: string, destFilename: string): Promise<any> {
    throw new Error('moveFile() not yet implemented in InProcessGASTestHelper. Use callTool("gas_mv") instead.');
  }

  /**
   * Delete a file from a project
   */
  async deleteFile(projectId: string, filename: string): Promise<any> {
    throw new Error('deleteFile() not yet implemented in InProcessGASTestHelper. Use callTool("gas_rm") instead.');
  }

  /**
   * Reorder files in a project
   */
  async reorderFiles(projectId: string, fileOrder: string[]): Promise<any> {
    throw new Error('reorderFiles() not yet implemented in InProcessGASTestHelper. Use callTool("gas_reorder") instead.');
  }
}
