import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';

// Import session manager instead of singleton
import { SessionAuthManager } from '../auth/sessionManager.js';

// Import local file manager for root initialization  
import { LocalFileManager } from '../utils/localFileManager.js';

// Import all tools
import { AuthTool } from '../tools/auth.js';
import { 
  LsTool, 
  CatTool, 
  WriteTool,
  RawCatTool,
  RawWriteTool,
  RawCpTool,
  RmTool, 
  MvTool, 
  CpTool 
} from '../tools/filesystem.js';
import { GrepTool, RawGrepTool } from '../tools/grep.js';
import { FindTool, RawFindTool } from '../tools/find.js';
import { RipgrepTool, RawRipgrepTool } from '../tools/ripgrep.js';
import { SedTool, RawSedTool } from '../tools/sed.js';
import { ContextTool } from '../tools/gas-context.js';
import { SummaryTool } from '../tools/gas-summary.js';
import { DepsTool } from '../tools/gas-deps.js';
import { TreeTool } from '../tools/gas-tree.js';
import { 
  MkdirTool, 
  InfoTool, 
  ReorderTool,
  ProjectMetricsTool
} from '../tools/project.js';
import { RunTool, ExecTool, ExecApiTool } from '../tools/execution.js';
import { ProxySetupTool } from '../tools/proxySetup.js';
import {
  DeployCreateTool,
  VersionCreateTool,
  DeployListTool,
  DeployGetDetailsTool,
  ProjectCreateTool,
  ProjectInitTool,
  DeployDeleteTool,
  DeployUpdateTool
} from '../tools/deployments.js';

import { 
  FindDriveScriptTool,
  BindScriptTool,
  CreateScriptTool
} from '../tools/driveContainerTools.js';

import {
  ProcessListTool,
  ProcessListScriptTool
} from '../tools/processes.js';

import {
  VersionGetTool,
  VersionListTool
} from '../tools/versions.js';

// Import new local sync and project context tools
import {
  PullTool,
  PushTool,
  StatusTool
} from '../tools/localSync.js';

import {
  ProjectSetTool,
  ProjectGetTool,
  ProjectAddTool,
  ProjectListTool
} from '../tools/projectContext.js';

// Local root tools removed - using git sync pattern instead
// Projects now use ~/gas-repos/project-{scriptId} automatically

// Import trigger management tools
import {
  TriggerListTool,
  TriggerCreateTool,
  TriggerDeleteTool
} from '../tools/triggers.js';

// Import NEW git sync tools
import {
  GitInitTool,
  GitSyncTool,
  GitStatusTool,
  GitSetSyncFolderTool,
  GitGetSyncFolderTool
} from '../tools/gitSync.js';

// Import error handling
import { MCPGasError, AuthenticationError, OAuthError } from '../errors/mcpErrors.js';

// Import unified configuration
import { McpGasConfigManager } from '../config/mcpGasConfig.js';

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
        name: 'gas-server',
        version: '1.0.0',
        capabilities: {
          tools: {}
        }
      }
    );

    this.setupHandlers();
    this.initializeConfig();
  }

  /**
   * Initialize the unified configuration system
   */
  private async initializeConfig(): Promise<void> {
    try {
      // Check if configuration was already initialized from command line (--config argument)
      if (process.env.MCP_GAS_WORKING_DIR) {
        console.error(`🔧 [SERVER] Configuration already initialized from command line, skipping re-initialization`);
        console.error(`🔧 [SERVER] Using working directory: ${process.env.MCP_GAS_WORKING_DIR}`);
        return;
      }
      
      // Only initialize if not already done via command line
      const { LocalFileManager } = await import('../utils/localFileManager.js');
      const workingDir = LocalFileManager.getResolvedWorkingDirectory();
      await McpGasConfigManager.initialize(workingDir);
      console.error(`🔧 [SERVER] Unified configuration initialized`);
    } catch (error) {
      console.error(`❌ [SERVER] Config initialization failed: ${error}`);
    }
  }

  /**
   * Create session-specific tool instances with isolated authentication
   * 
   * Each session gets its own instances of all 49 MCP tools, each configured
   * with a session-specific authentication manager. This ensures complete
   * isolation between different MCP clients.
   * 
   * ## Tool Categories Created (49 total tools):
   * 
   * ### 🔐 Authentication & Session (1 tool)
   * - `gas_auth` - OAuth 2.0 flow management with desktop PKCE
   * 
   * ### 📂 Filesystem Operations - RECOMMENDED (9 tools)
   * - `gas_ls` - List projects and files  
   * - `gas_cat` - ✅ Smart reader (local-first with remote fallback)
   * - `gas_write` - ✅ Auto-sync writer (local + remote)
   * - `gas_grep` - ✅ Content search with pattern matching (unwrapped user code)
   * - `gas_ripgrep` - ⚡ High-performance search with ripgrep-inspired features including multi-pattern, context control, and advanced regex
   * - `gas_sed` - 🔧 sed-style find/replace operations with regex capture groups ($1, $2) and multi-pattern support on clean user code
   * - `gas_find` - ✅ Find files with shell-like patterns and virtual names
   * - `gas_rm` - Delete files
   * - `gas_mv` - Move/rename files
   * - `gas_cp` - Copy files
   * 
   * ### 🔧 Filesystem Operations - ADVANCED (6 tools)
   * - `gas_raw_cat` - ⚠️ Advanced: Read with explicit project ID paths
   * - `gas_raw_write` - ⚠️ Advanced: Write with explicit project ID paths
   * - `gas_raw_grep` - ⚠️ Advanced: Search full content (API-only, never local files)
   * - `gas_raw_ripgrep` - ⚠️ Advanced: High-performance search on raw content including CommonJS wrappers and system code
   * - `gas_raw_sed` - ⚠️ Advanced: sed-style find/replace on raw content including wrappers for system-level modifications
   * - `gas_raw_find` - ⚠️ Advanced: Find files with actual GAS names
   * - `gas_raw_copy` - ⚠️ Advanced: Remote-to-remote file copying with merge strategies
   * 
   * ### 🏗️ Project Management (4 tools)
   * - `gas_mkdir` - Create logical directories
   * - `gas_info` - Project information
   * - `gas_reorder` - File ordering
   * - `gas_project_metrics` - Performance analytics
   * 
   * ### 🚀 Script Execution - RECOMMENDED (1 tool)
   * - `gas_run` - ✅ Execute with current project context
   * 
   * ### 🔧 Script Execution - ADVANCED (3 tools)
   * - `gas_raw_run` - ⚠️ Advanced: Execute with explicit script ID
   * - `gas_run_api_exec` - API-based execution
   * - `gas_proxy_setup` - Proxy configuration
   * 
   * ### 🔄 Local-Remote Sync - INDIVIDUAL COMMANDS (3 tools)
   * - `gas_pull` - Pull remote files to local project-specific directory
   * - `gas_push` - Push local project-specific files to remote project  
   * - `gas_status` - Compare local and remote files
   * 
   * ### 🎯 Project Context - WORKFLOW (1 tool)
   * - `gas_project_set` - ✅ Set current project and auto-pull files
   * 
   * ### 📁 Local Root Management - PROJECT STRUCTURE (4 tools)
   * - `gas_local_set_root` - Set configurable local root directory for all projects
   * - `gas_local_get_root` - Get current local root configuration
   * - `gas_local_list_projects` - List all local projects in directory structure
   * - `gas_local_show_structure` - Show complete directory tree structure
   * 
   * ### Deployment Management (7 tools)
   * - `gas_deploy_create` - Create deployments
   * - `gas_deploy_list` - List deployments
   * - `gas_deploy_get_details` - Get deployment details
   * - `gas_deploy_delete` - Delete deployments
   * - `gas_deploy_update` - Update deployments
   * - `gas_version_create` - Create versions
   * - `gas_project_create` - Create projects
   * 
   * ### Version Management (2 tools)
   * - `gas_version_get` - Get version details
   * - `gas_version_list` - List all versions
   * 
   * ### Process Management (2 tools)
   * - `gas_process_list` - List user processes
   * - `gas_process_list_script` - List script processes
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
      new AuthTool(authManager),
      
      // 📂 Filesystem operations - RECOMMENDED auto-sync tools
      new LsTool(authManager),
      new CatTool(authManager),           // Smart reader (local-first)
      new WriteTool(authManager),         // Auto-sync writer
      new GrepTool(authManager),          // Content search with pattern matching
      new RipgrepTool(authManager),       // High-performance search with ripgrep-inspired features
      new SedTool(authManager),           // sed-style find/replace with CommonJS processing
      new FindTool(authManager),          // Find files with virtual names
      new ContextTool(authManager),       // Intelligent context-aware search (simplified version)
      new SummaryTool(authManager),       // Content summarization with multiple analysis modes
      new DepsTool(authManager),          // Dependency analysis with circular detection and complexity metrics
      new TreeTool(authManager),          // Project structure visualization with hierarchical trees and statistics
      new RmTool(authManager),
      new MvTool(authManager),
      new CpTool(authManager),
      
      // 🔧 Filesystem operations - ADVANCED raw tools (explicit project IDs)
      new RawCatTool(authManager),        // Advanced: Explicit project ID paths
      new RawWriteTool(authManager),      // Advanced: Explicit project ID paths
      new RawGrepTool(authManager),       // Advanced: Search full content (API-only, never local files)
      new RawRipgrepTool(authManager),    // Advanced: High-performance search on raw content with ripgrep features
      new RawSedTool(authManager),        // Advanced: sed-style find/replace on raw content including wrappers
      new RawFindTool(authManager),       // Advanced: Find with actual GAS names
      new RawCpTool(authManager),        // Advanced: Bulk copy without CommonJS processing
      
      // 🏗️ Project management
      new MkdirTool(authManager),
      new InfoTool(authManager),
      new ReorderTool(authManager),
      new ProjectMetricsTool(authManager),
      
      // 🚀 Script execution - RECOMMENDED auto-sync tool
      new RunTool(authManager),           // ✅ Uses current project context
      
      // 🔧 Script execution - ADVANCED raw tool
      new ExecTool(authManager),        // ⚠️ Advanced: Explicit script ID
      new ExecApiTool(authManager),    // Alternative API-based execution
      new ProxySetupTool(authManager),
      
      // Deployment management (with session-specific auth manager)
      new DeployCreateTool(authManager),
      new VersionCreateTool(authManager),
      new DeployListTool(authManager),
      new DeployGetDetailsTool(authManager),
      new ProjectCreateTool(authManager),
      new ProjectInitTool(authManager),
      new DeployDeleteTool(authManager),
      new DeployUpdateTool(authManager),

      
      // Drive container and script discovery/management
      new FindDriveScriptTool(authManager),
      new BindScriptTool(authManager),
      new CreateScriptTool(authManager),
      
      // Process management
      new ProcessListTool(authManager),
      new ProcessListScriptTool(authManager),
      
      // Version management
      new VersionGetTool(authManager),
      new VersionListTool(authManager),
      
      // 🔄 Local-Remote sync operations - EXPLICIT workflow tools
      new PullTool(authManager),          // Explicit pull for multi-env
      new PushTool(authManager),          // Explicit push for multi-env  
      new StatusTool(authManager),        // Diagnostic comparison
      
      // 🎯 Project context - WORKFLOW tools (visible to MCP)
      new ProjectSetTool(authManager),    // ✅ Main workflow: Set project & auto-pull
      new ProjectGetTool(authManager),    // Get current project information
      new ProjectAddTool(authManager),    // Add project to configuration  
      new ProjectListTool(authManager),   // List all configured projects
      
      // Local root management removed - all projects now use git sync pattern:
      // ~/gas-repos/project-{scriptId}/ for consistent file management
      
      // ⏰ Trigger management - AUTOMATION tools
      new TriggerListTool(authManager),    // List all installable triggers
      new TriggerCreateTool(authManager),  // Create time-based and event-driven triggers
      new TriggerDeleteTool(authManager),  // Delete triggers by ID or function name
      
      // 🔧 Git Sync - SAFE GIT INTEGRATION (5 tools replacing old 12 tools)
      new GitInitTool(authManager),           // Initialize git association with .git.gs file
      new GitSyncTool(authManager),           // Safe pull-merge-push synchronization
      new GitStatusTool(authManager),         // Check git association and sync status  
      new GitSetSyncFolderTool(authManager),  // Set/update sync folder location
      new GitGetSyncFolderTool(authManager),  // Query sync folder location
      
      // NOTE: All project context tools are now VISIBLE to MCP users/LLMs
      // This provides full project management capabilities
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
    const clearedSessions = await SessionAuthManager.clearAllSessions();
    console.error(`Cleared ${clearedSessions} cached session token(s)`);
    
    // Clear all in-memory sessions including browser launch flags
    this.sessions.clear();
    console.error('Cleared all in-memory sessions and browser launch flags');
    
    // Initialize default local root directory if not configured
    try {
      const localRoot = await LocalFileManager.initializeDefaultRoot();
      console.error(`🗂️  Local root directory: ${localRoot}`);
    } catch (error) {
      console.error('⚠️  Warning: Failed to initialize local root directory:', error);
      // Don't fail server startup for this, just log the warning
    }
    
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    console.error('MCP Gas Server connected and ready');
    console.error('Each client gets isolated authentication sessions');
    console.error('Use sessionId parameter to manage multiple sessions');
    console.error('Use gas_auth(mode="start") to authenticate with Google Apps Script');
    console.error('Authentication: Tools will return clear instructions when auth is needed');
    console.error('Direct execution: gas_run can execute ANY statement without wrapper functions');

    // Clean up expired sessions on startup
    await this.cleanupExpiredSessions();
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
  private async cleanupExpiredSessions(): Promise<void> {
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
    const filesCleaned = await SessionAuthManager.cleanupExpiredSessions();
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
      fileSessions: (await SessionAuthManager.listActiveSessions()).length,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
  }
} 