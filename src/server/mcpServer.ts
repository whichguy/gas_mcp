import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';

// Import session manager instead of singleton
import { SessionAuthManager } from '../auth/sessionManager.js';

// Import all tools
import { GASAuthTool } from '../tools/auth.js';
import { 
  GASListTool, 
  GASCatTool, 
  GASWriteTool, 
  GASRemoveTool, 
  GASMoveTool, 
  GASCopyTool 
} from '../tools/filesystem.js';
import { 
  GASMkdirTool, 
  GASInfoTool, 
  GASReorderTool 
} from '../tools/project.js';
import { GASRunTool, GASRunApiExecTool } from '../tools/execution.js';
import { GASProxySetupTool } from '../tools/proxySetup.js';
import {
  GASDeployCreateTool,
  GASVersionCreateTool,
  GASDeployListTool,
  GASDeployGetDetailsTool,
  GASProjectCreateTool
} from '../tools/deployments.js';

import { 
  GASFindDriveScriptTool,
  GASBindScriptTool,
  GASCreateScriptTool
} from '../tools/driveContainerTools.js';


// Import error handling
import { MCPGasError, AuthenticationError, OAuthError } from '../errors/mcpErrors.js';

/**
 * Client session context for MCP Gas Server
 * 
 * Each MCP client (like Cursor/Claude Desktop) gets an isolated session with:
 * - Separate authentication state (OAuth tokens, user info)
 * - Independent tool instances with session-specific auth managers
 * - Session lifecycle tracking (creation time, last usage)
 * - File-based persistence for token storage
 * 
 * @interface ClientSession
 */
interface ClientSession {
  /** Unique session identifier (UUID) for this client */
  sessionId: string;
  /** Session-specific authentication manager with isolated token storage */
  authManager: SessionAuthManager;
  /** Map of tool instances configured for this session */
  tools: Map<string, any>;
  /** Timestamp when this session was created */
  createdAt: number;
  /** Timestamp when this session was last used (for cleanup) */
  lastUsed: number;
}

/**
 * Main MCP server for Google Apps Script integration
 * 
 * ## Architecture Overview
 * 
 * This server implements a **session-isolated** MCP server that provides Google Apps Script
 * integration for AI assistants like Claude in Cursor IDE. Key architectural features:
 * 
 * ### 🔒 Session Isolation Architecture
 * - **Multi-Client Support**: Each MCP client gets isolated authentication sessions
 * - **File-Based Persistence**: Sessions stored in `.auth/` directory for persistence across restarts
 * - **Independent Tool Instances**: Each session has its own tool instances with isolated auth
 * - **Graceful Session Management**: 24-hour session timeout with automatic cleanup
 * 
 * ### 🌐 OAuth 2.0 Singleton Callback Architecture
 * - **Fixed Port Requirement**: OAuth callback MUST use port 3000 (hardcoded redirect URI)
 * - **Singleton Callback Server**: Single OAuth callback server shared across all sessions
 * - **Port Conflict Resolution**: Intelligent handling of port conflicts and server lifecycle
 * - **Browser Integration**: Automatic browser launching for seamless auth flow
 * 
 * ### 🤖 Auto-Authentication UX Enhancement
 * - **Error Detection**: Automatically detects `AuthenticationError` and `OAuthError`
 * - **Proactive Auth Flow**: Launches OAuth flow automatically when auth errors occur
 * - **Structured Responses**: Returns helpful guidance and instructions to users
 * - **Test Mode Support**: Disables auto-auth in test mode to prevent browser conflicts
 * 
 * ### 📡 stdout/stderr Protocol Architecture
 * - **stdout**: Exclusive MCP JSON-RPC protocol communication with clients
 * - **stderr**: Rich diagnostic logging, performance metrics, and operational monitoring
 * - **Protocol Compliance**: Ensures MCP specification adherence while enabling debugging
 * - **Client Separation**: Diagnostic logs don't interfere with tool responses
 * - **Emoji Conventions**: Visual log parsing with 🚀🔧📡✅❌ prefixes for operation types
 * - **Security**: Token masking and sanitized error reporting in production
 * 
 * See `docs/STDOUT_STDERR_DOCUMENTATION.md` for complete implementation details.
 * 
    * ### 🛠️ Tool Architecture
   * - **11 Core Tools**: Complete Google Apps Script API coverage
   * - **Base Tool Pattern**: All tools extend `BaseTool` with common validation and error handling
   * - **Schema Validation**: Comprehensive input validation with helpful error messages
   * - **Rate Limiting**: Built-in rate limiting and retry strategies for Google APIs
 * 
 * ## Development Guidelines for AI Assistants
 * 
 * When working with this server, consider these patterns:
 * 
 * ### Session Management
 * ```typescript
 * // Sessions are automatically created per client
 * const session = this.getOrCreateSession(sessionId);
 * ```
 * 
 * ### Error Handling
 * ```typescript
 * // Auto-auth only in non-test mode
 * if (error instanceof AuthenticationError && process.env.MCP_TEST_MODE !== 'true') {
 *   return await this.handleAuthenticationError(error, session, sessionId);
 * }
 * ```
 * 
 * ### Tool Registration
 * ```typescript
 * // Tools are session-specific with isolated auth managers
 * const tools = this.createSessionTools(authManager);
 * ```
 * 
 * @export
 * @class MCPGasServer
 */
export class MCPGasServer {
  /** Core MCP server instance from the SDK */
  private server: Server;
  
  /** 
   * Map of active client sessions 
   * Key: sessionId (UUID), Value: ClientSession with isolated state
   */
  private sessions: Map<string, ClientSession> = new Map();
  
  /** Currently active session ID for request context */
  private currentSessionId: string | null = null;

  /**
   * Initialize MCP Gas Server with session isolation support
   * 
   * Sets up the core MCP server with capabilities and request handlers.
   * Session creation is deferred until first client connection.
   */
  constructor() {
    this.server = new Server(
      {
        name: 'mcp-gas-server',
        version: '1.0.0',
        capabilities: {
          tools: {}
        }
      }
    );

    this.setupHandlers();
  }

  /**
   * Create session-specific tool instances with isolated authentication
   * 
   * Each session gets its own instances of all 12 MCP tools, each configured
   * with a session-specific authentication manager. This ensures complete
   * isolation between different MCP clients.
   * 
   * ## Tool Categories Created:
   * 
   * ### Authentication & Session (1 tool)
   * - `gas_auth` - OAuth 2.0 flow management with desktop PKCE
   * 
   * ### Filesystem Operations (6 tools)
   * - `gas_ls` - List projects and files
   * - `gas_cat` - Read file contents
   * - `gas_write` - Create/update files
   * - `gas_rm` - Delete files
   * - `gas_mv` - Move/rename files
   * - `gas_cp` - Copy files
   * 
   * ### Project Management (3 tools)
   * - `gas_mkdir` - Create projects
   * - `gas_info` - Project information
   * - `gas_reorder` - File ordering
   * 
   * ### Execution & Deployment (7 tools)
   * - `gas_run` - Direct code execution (primary)
   * - `gas_run_api_exec` - API-based execution
   * - `gas_proxy_setup` - Proxy configuration
   * - `gas_deploy_create` - Create deployments
   * - `gas_version_create` - Create versions
   * - `gas_deploy_list` - List deployments
   * - `gas_project_create` - Create projects
   * 
   * ### Drive Integration (3 tools)
   * - `gas_find_drive_script` - Find container scripts
   * - `gas_bind_script` - Bind scripts to containers
   * - `gas_create_script` - Create container scripts
   * 
   * @param authManager - Session-specific authentication manager
   * @returns Map of tool name to tool instance
   * 
   * @example
   * ```typescript
   * // Tools are created per session with isolated auth
   * const authManager = new SessionAuthManager(sessionId);
   * const tools = this.createSessionTools(authManager);
   * const gasRunTool = tools.get('gas_run');
   * ```
   */
  private createSessionTools(authManager: SessionAuthManager): Map<string, any> {
    const tools = new Map();
    
    const toolInstances = [
      // Authentication (with session-specific auth manager)
      new GASAuthTool(authManager),
      
      // Filesystem operations (with session-specific auth manager)  
      new GASListTool(authManager),
      new GASCatTool(authManager),
      new GASWriteTool(authManager),
      new GASRemoveTool(authManager),
      new GASMoveTool(authManager),
      new GASCopyTool(authManager),
      
      // Project management (with session-specific auth manager)
      new GASMkdirTool(authManager),
      new GASInfoTool(authManager),
      new GASReorderTool(authManager),
      
      // Script execution (with session-specific auth manager)
      new GASRunTool(authManager),  // Primary gas_run tool with doGet() proxy and auto-deployment
      new GASRunApiExecTool(authManager),  // Alternative API-based execution
      new GASProxySetupTool(authManager),
      
      // Deployment management (with session-specific auth manager)
      new GASDeployCreateTool(authManager),
      new GASVersionCreateTool(authManager),
      new GASDeployListTool(authManager),
      new GASDeployGetDetailsTool(authManager),
      new GASProjectCreateTool(authManager),

      
      // Drive container and script discovery/management
      new GASFindDriveScriptTool(authManager),
      new GASBindScriptTool(authManager),
      new GASCreateScriptTool(authManager)
    ];

    toolInstances.forEach(tool => {
      tools.set(tool.name, tool);
    });

    return tools;
  }



  /**
   * Get existing session or create new session with isolation
   * 
   * This method implements the core session management logic:
   * - Reuses existing sessions when possible
   * - Creates new sessions with UUID generation
   * - Tracks session lifecycle and usage
   * - Maintains session persistence across server restarts
   * 
   * ## Session Lifecycle:
   * 1. **Session Lookup**: Check if session exists in memory
   * 2. **AuthManager Creation**: Create or reuse session-specific auth manager
   * 3. **Tool Instantiation**: Create session-specific tool instances
   * 4. **Persistence**: Session data persisted in `.auth/` directory
   * 5. **Tracking**: Update usage timestamps for cleanup
   * 
   * ## Session Reuse Logic:
   * - Sessions are identified by UUID
   * - Auth manager handles file-based token persistence
   * - Session tokens survive server restarts
   * - 24-hour session timeout with automatic cleanup
   * 
   * @param sessionId - Optional explicit session ID, otherwise generates new UUID
   * @returns ClientSession with isolated auth and tool instances
   * 
   * @example
   * ```typescript
   * // Create new session
   * const session = this.getOrCreateSession();
   * 
   * // Reuse existing session
   * const session = this.getOrCreateSession('existing-uuid');
   * ```
   */
  private getOrCreateSession(sessionId?: string): ClientSession {
    // Use provided session ID or current session
    const id = sessionId || this.currentSessionId || undefined;
    
    let session = this.sessions.get(id || '');
    
    if (!session) {
      console.error(`Creating new client session...`);
      
      // Let SessionAuthManager handle session ID generation and reuse logic
      const authManager = new SessionAuthManager(id);
      const actualSessionId = authManager.getSessionId();
      
      const tools = this.createSessionTools(authManager);
      
      session = {
        sessionId: actualSessionId,
        authManager,
        tools,
        createdAt: Date.now(),
        lastUsed: Date.now()
      };
      
      this.sessions.set(actualSessionId, session);
      console.error(`Session created/reused: ${actualSessionId}`);
    } else {
      session.lastUsed = Date.now();
    }
    
    this.currentSessionId = session.sessionId;
    return session;
  }

  /**
   * Setup MCP protocol handlers
   */
  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // Create a temporary session to get tool schemas
      const session = this.getOrCreateSession();
      
      const tools = Array.from(session.tools.values()).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }));

      return { tools };
    });

    // Execute tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // Extract session ID from arguments if provided
        const sessionId = typeof args?.sessionId === 'string' ? args.sessionId : undefined;
        
        // Get or create session for this request
        const session = this.getOrCreateSession(sessionId);
        
        const tool = session.tools.get(name);
        if (!tool) {
          throw new Error(`Unknown tool: ${name}`);
        }

        console.error(`[Session ${session.sessionId}] Executing tool: ${name}`);

        // Remove sessionId from args before passing to tool
        const toolArgs = { ...args };
        delete toolArgs.sessionId;

        const result = await tool.execute(toolArgs || {});

        // Include session ID in response for client tracking
        const responseWithSession = {
          ...result,
          sessionId: session.sessionId
        };

        // Reset browser launch flag if this was a successful gas_auth completion
        if (name === 'gas_auth' && result?.authenticated === true) {
          const authFlowKey = `browser_launched_${session.sessionId}`;
          delete (session as any)[authFlowKey];
          console.error(`[Session ${session.sessionId}] Authentication completed - reset browser launch flag`);
        }

        console.error(`[Session ${session.sessionId}] Tool ${name} completed successfully`);

        // SCHEMA FIX: Check if tool already returned proper MCP format
        // Some tools (like gas_auth) return { content: [...], isError: false }
        // Others return plain objects that need wrapping
        if (result && Array.isArray(result.content)) {
          // Tool already returned proper MCP format, just add sessionId
          return {
            ...result,
            sessionId: session.sessionId
          };
        } else {
          // Tool returned plain object, wrap it in MCP format
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(responseWithSession, null, 2)
              }
            ]
          };
        }
      } catch (error: any) {
        const sessionId = this.currentSessionId || 'unknown';
        console.error(`[Session ${sessionId}] Tool ${name} failed:`, error);

        // Handle authentication errors by returning clear instructions instead of auto-auth
        if (error instanceof AuthenticationError || error instanceof OAuthError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: {
                    type: error.constructor.name,
                    message: error.message,
                    code: error.code,
                    data: error.data
                  },
                  authRequired: {
                    message: 'Authentication required - please authenticate manually',
                    instructions: [
                      'Use gas_auth with mode="start" to begin authentication',
                      'Complete the OAuth flow in your browser', 
                      'Then retry your original request'
                    ],
                    command: `gas_auth({"mode": "start"})`,
                    statusCheck: `gas_auth({"mode": "status"})`
                  },
                  sessionId
                }, null, 2)
              }
            ],
            isError: true
          };
        }

        // Handle MCP Gas errors with structured information
        if (error instanceof MCPGasError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: {
                    type: error.constructor.name,
                    message: error.message,
                    code: error.code,
                    data: error.data
                  },
                  sessionId
                }, null, 2)
              }
            ],
            isError: true
          };
        }

        // Handle other errors
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: {
                  type: 'UnknownError',
                  message: error.message || 'An unexpected error occurred',
                  stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
                },
                sessionId
              }, null, 2)
            }
          ],
          isError: true
        };
      }
    });
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    console.error('Starting MCP Gas Server with Session Isolation...');
    
    // Clear ALL cached session tokens on startup (user requested)
    console.error('Clearing all cached session tokens on startup...');
    const clearedSessions = SessionAuthManager.clearAllSessions();
    console.error(`Cleared ${clearedSessions} cached session token(s)`);
    
    // Clear all in-memory sessions including browser launch flags
    this.sessions.clear();
    console.error('Cleared all in-memory sessions and browser launch flags');
    
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    console.error('MCP Gas Server connected and ready');
    console.error('Each client gets isolated authentication sessions');
    console.error('Use sessionId parameter to manage multiple sessions');
    console.error('Use gas_auth(mode="start") to authenticate with Google Apps Script');
    console.error('Authentication: Tools will return clear instructions when auth is needed');
    console.error('Direct execution: gas_run can execute ANY statement without wrapper functions');
    
    // Clean up expired sessions on startup
    this.cleanupExpiredSessions();
  }

  /**
   * Stop the server gracefully
   */
  async stop(): Promise<void> {
    console.error('Stopping MCP Gas Server...');
    
    // Clean up all sessions
    this.sessions.clear();
    
    await this.server.close();
    console.error('MCP Gas Server stopped');
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const sessionTimeout = 24 * 60 * 60 * 1000; // 24 hours
    let cleaned = 0;
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastUsed > sessionTimeout) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.error(`Cleaned up ${cleaned} expired sessions`);
    }
    
    // Also clean up file-based sessions
    const filesCleaned = SessionAuthManager.cleanupExpiredSessions();
    if (filesCleaned > 0) {
      console.error(`Cleaned up ${filesCleaned} expired session files`);
    }
  }

  /**
   * Get server statistics
   */
  async getStats(): Promise<any> {
    const activeSessions = await Promise.all(
      Array.from(this.sessions.values()).map(async (session) => {
        const authManager = session.authManager;
        let isAuthenticated: boolean;
        let userInfo: any;

        if ('isAuthenticated' in authManager && typeof authManager.isAuthenticated === 'function') {
          // Handle async SessionAuthManager
          const authResult = authManager.isAuthenticated();
          isAuthenticated = authResult instanceof Promise ? await authResult : authResult;
          
          const userResult = authManager.getUserInfo();
          userInfo = userResult instanceof Promise ? await userResult : userResult;
        } else {
          // Handle sync AuthStateManager
          isAuthenticated = false;
          userInfo = null;
        }

        return {
          sessionId: session.sessionId,
          authenticated: isAuthenticated,
          lastUsed: session.lastUsed,
          user: userInfo?.email
        };
      })
    );

    return {
      activeSessions: this.sessions.size,
      sessions: activeSessions,
      fileSessions: SessionAuthManager.listActiveSessions().length,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
  }
} 