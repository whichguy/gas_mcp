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
  FileStatusTool,
  RawCatTool,
  RawWriteTool,
  RawCpTool,
  RmTool,
  MvTool,
  CpTool,
  CacheClearTool
} from '../tools/filesystem/index.js';
import { GrepTool, RawGrepTool } from '../tools/grep.js';
import { FindTool, RawFindTool } from '../tools/find.js';
import { RipgrepTool, RawRipgrepTool } from '../tools/ripgrep.js';
import { SedTool, RawSedTool } from '../tools/sed.js';
import { EditTool } from '../tools/edit.js';
import { RawEditTool } from '../tools/raw-edit.js';
import { AiderTool } from '../tools/aider.js';
import { RawAiderTool } from '../tools/raw-aider.js';
import { DepsTool } from '../tools/gas-deps.js';
import {
  ReorderTool,
  ProjectListTool
} from '../tools/project.js';
import { ExecTool, ExecApiTool } from '../tools/execution.js';
import {
  ProjectCreateTool,
  ProjectInitTool
} from '../tools/deployments.js';

import { DeployTool } from '../tools/deployment.js';

import {
  FindDriveScriptTool,
  CreateScriptTool
} from '../tools/driveContainerTools.js';

import {
  ProcessListTool
} from '../tools/processes.js';

// Consolidated log tool with list and get operations
import { LogTool } from '../tools/logs.js';

// Local sync tools removed - cat/write already provide local caching via LocalFileManager
// PullTool, PushTool, StatusTool were redundant wrappers around same copyRemoteToLocal() calls

// Local root tools removed - using git sync pattern instead
// Projects now use ~/gas-repos/project-{scriptId} automatically

// Consolidated trigger tool with list, create, delete operations
import { TriggerTool } from '../tools/triggers.js';

// Import rsync tool (two-phase sync: plan → execute)
import { RsyncTool } from '../tools/rsync/index.js';

// Import git feature workflow tool
import { GitFeatureTool } from '../tools/git/GitFeatureTool.js';

// Import generic configuration tool
import { ConfigTool } from '../tools/config.js';

// Import Google Sheets SQL tool
import { SheetSqlTool } from '../tools/sheets/sheetsSql.js';

// Import error handling
import { MCPGasError, AuthenticationError, OAuthError } from '../errors/mcpErrors.js';

// Import unified configuration
import { McpGasConfigManager } from '../config/mcpGasConfig.js';


/**
 * Main MCP server for Google Apps Script integration
 * 
 * ## Architecture Overview
 * 
 * This server implements a **session-isolated** MCP server that provides Google Apps Script
 * integration for AI assistants like Claude in Cursor IDE. Key architectural features:
 * 
 * ### Session Isolation Architecture
 * - **Multi-Client Support**: Each MCP client gets isolated authentication sessions
 * - **File-Based Persistence**: Sessions stored in `.auth/` directory for persistence across restarts
 * - **Independent Tool Instances**: Each session has its own tool instances with isolated auth
 * - **Graceful Session Management**: 24-hour session timeout with automatic cleanup
 * 
 * ### OAuth 2.0 Singleton Callback Architecture
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
 * ### stdout/stderr Protocol Architecture
 * - **stdout**: Exclusive MCP JSON-RPC protocol communication with clients
 * - **stderr**: Rich diagnostic logging, performance metrics, and operational monitoring
 * - **Protocol Compliance**: Ensures MCP specification adherence while enabling debugging
 * - **Client Separation**: Diagnostic logs don't interfere with tool responses
 * - **Emoji Conventions**: Visual log parsing with prefixes for operation types
 * - **Security**: Token masking and sanitized error reporting in production
 * 
 * See `docs/STDOUT_STDERR_DOCUMENTATION.md` for complete implementation details.
 *
    * ### Tool Architecture
   * - **40 MCP Tools**: Streamlined Google Apps Script API coverage
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

  /** PERFORMANCE FIX: Cached tool schemas to avoid creating 40+ tool instances per ListTools request */
  private cachedToolSchemas?: any[];

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
        console.error(`[SERVER] Configuration already initialized from command line, skipping re-initialization`);
        console.error(`[SERVER] Using working directory: ${process.env.MCP_GAS_WORKING_DIR}`);
        return;
      }
      
      // Only initialize if not already done via command line
      const { LocalFileManager } = await import('../utils/localFileManager.js');
      const workingDir = LocalFileManager.getResolvedWorkingDirectory();
      await McpGasConfigManager.initialize(workingDir);
      console.error(`[SERVER] Unified configuration initialized`);
    } catch (error) {
      console.error(`[SERVER] Config initialization failed: ${error}`);
    }
  }

  /**
   * Create session-specific tool instances with isolated authentication
   *
   * Each session gets its own instances of all 40 MCP tools, each configured
   * with a session-specific authentication manager. This ensures complete
   * isolation between different MCP clients.
   *
   * ## Tool Categories Created (40 total tools):
   *
   * ### Authentication & Session (1 tool)
   * - `auth` - OAuth 2.0 flow management with desktop PKCE
   *
   * ### 📂 Filesystem Operations - RECOMMENDED (14 tools)
   * - `ls` - List projects and files
   * - `file_status` - Get comprehensive file status with SHA checksums
   * - `cat` - Smart reader (local-first with remote fallback)
   * - `write` - Auto-sync writer (local + remote)
   * - `grep` - Content search with pattern matching (unwrapped user code)
   * - `ripgrep` - ⚡ High-performance search with ripgrep-inspired features including multi-pattern, context control, and advanced regex
   * - `sed` - sed-style find/replace operations with regex capture groups ($1, $2) and multi-pattern support on clean user code
   * - `edit` - 💎 Token-efficient file editing with exact string matching (83% token savings vs write)
   * - `find` - Find files with shell-like patterns and virtual names
   * - `rm` - Delete files
   * - `mv` - Move/rename files
   * - `cp` - Copy files
   *
   * ### Filesystem Operations - ADVANCED (6 tools)
   * - `raw_cat` - Advanced: Read with explicit project ID paths
   * - `raw_write` - Advanced: Write with explicit project ID paths
   * - `raw_grep` - Advanced: Search full content (API-only, never local files)
   * - `raw_ripgrep` - Advanced: High-performance search on raw content including CommonJS wrappers and system code
   * - `raw_sed` - Advanced: sed-style find/replace on raw content including wrappers for system-level modifications
   * - `raw_edit` - Advanced: Token-efficient editing on raw content (includes CommonJS wrappers)
   * - `raw_find` - Advanced: Find files with actual GAS names
   * - `raw_cp` - Advanced: Remote-to-remote file copying with merge strategies
   *
   * ### 🏗Project Management (1 tool)
   * - `reorder` - File ordering
   *
   * ### Script Execution (2 tools)
   * - `exec` - JavaScript execution with explicit script ID
   * - `exec_api` - API-based execution
   *
   * ### 📁 Project List (1 tool)
   * - `project_list` - List all configured projects from gas-config.json
   *
   * ### Deployment & Project Creation (3 tools)
   * - `deploy` - 🎯 Consolidated deployment workflow across dev/staging/prod environments
   * - `project_create` - Create new GAS projects with infrastructure
   * - `project_init` - Initialize projects with standard configuration
   *
   * ### Process Management (1 tool)
   * - `process_list` - List user processes (supports scriptId filter)
   *
   * ### Execution Logs (1 tool)
   * - `log` - Browse execution logs (list operation) and get detailed process logs (get operation)
   *
   * ### Drive Integration (2 tools)
   * - `find_drive_script` - Find container scripts
   * - `create_script` - Create container scripts
   * 
   * @param authManager - Session-specific authentication manager
   * @returns Map of tool name to tool instance
   * 
   * @example
   * ```typescript
   * // Tools are created per session with isolated auth
   * const authManager = new SessionAuthManager(sessionId);
   * const tools = this.createSessionTools(authManager);
   * const execTool = tools.get('exec');
   * ```
   */
  private createSessionTools(authManager: SessionAuthManager): Map<string, any> {
    const tools = new Map();
    
    const toolInstances = [
      // Authentication (with session-specific auth manager)
      new AuthTool(authManager),
      
      // 📂 Filesystem operations - RECOMMENDED auto-sync tools
      new LsTool(authManager),
      new FileStatusTool(authManager),    // Get comprehensive file status with SHA checksums
      new CatTool(authManager),           // Smart reader (local-first)
      new WriteTool(authManager),         // Auto-sync writer
      new GrepTool(authManager),          // Content search with pattern matching
      new RipgrepTool(authManager),       // High-performance search with ripgrep-inspired features
      new SedTool(authManager),           // sed-style find/replace with CommonJS processing
      new EditTool(authManager),          // Token-efficient exact string editing
      new AiderTool(authManager),         // Token-efficient fuzzy string editing
      new FindTool(authManager),          // Find files with virtual names
      new DepsTool(authManager),          // Dependency analysis with circular detection and complexity metrics
      new RmTool(authManager),
      new MvTool(authManager),
      new CpTool(authManager),
      new CacheClearTool(authManager),    // Clear cached GAS metadata from extended attributes

      // Filesystem operations - ADVANCED raw tools (explicit project IDs)
      new RawCatTool(authManager),        // Advanced: Explicit project ID paths
      new RawWriteTool(authManager),      // Advanced: Explicit project ID paths
      new RawGrepTool(authManager),       // Advanced: Search full content (API-only, never local files)
      new RawRipgrepTool(authManager),    // Advanced: High-performance search on raw content with ripgrep features
      new RawSedTool(authManager),        // Advanced: sed-style find/replace on raw content including wrappers
      new RawEditTool(authManager),       // Advanced: Token-efficient editing on raw content
      new RawAiderTool(authManager),      // Advanced: Token-efficient fuzzy editing on raw content
      new RawFindTool(authManager),       // Advanced: Find with actual GAS names
      new RawCpTool(authManager),        // Advanced: Bulk copy without CommonJS processing
      
      // 🏗Project management
      new ReorderTool(authManager),

      // Script execution tools
      new ExecTool(authManager),        // JavaScript execution with explicit script ID
      new ExecApiTool(authManager),     // Alternative API-based execution
      
      // Deployment management (with session-specific auth manager)
      new DeployTool(authManager),          // Consolidated deployment management across dev/staging/prod

      // Project creation and initialization (separate from deployment workflow)
      new ProjectCreateTool(authManager),
      new ProjectInitTool(authManager),

      
      // Drive container and script discovery/management
      new FindDriveScriptTool(authManager),
      new CreateScriptTool(authManager),
      
      // Process management
      new ProcessListTool(authManager),

      // Execution logs with Cloud Logging integration (consolidated: list + get operations)
      new LogTool(authManager),          // Browse logs (list) and get detailed process logs (get)

      // Local-Remote sync removed - cat/write provide auto-sync via LocalFileManager
      // PullTool/PushTool/StatusTool were redundant (used same copyRemoteToLocal calls)

      // Project context - WORKFLOW tools (visible to MCP)
      new ProjectListTool(authManager),   // List all configured projects
      
      // Local root management removed - all projects now use git sync pattern:
      // ~/gas-repos/project-{scriptId}/ for consistent file management
      
      // Trigger management - AUTOMATION tools (consolidated: list + create + delete operations)
      new TriggerTool(authManager),        // List, create, and delete installable triggers
      
      // Git Sync - SAFE GIT INTEGRATION (3 tools - LOCAL-FIRST, no auto-bootstrap)
      new RsyncTool(authManager),             // Unidirectional sync: plan → execute (two-phase workflow)
      new GitFeatureTool(authManager),        // Feature branch workflow (start/finish/rollback/list/switch)
      new ConfigTool(authManager),            // Generic configuration (sync_folder get/set)

      // Google Sheets SQL - SQL-STYLE OPERATIONS on Google Sheets
      new SheetSqlTool(authManager),          // Execute SELECT/INSERT/UPDATE/DELETE on Google Sheets with SQL syntax

      // NOTE: All project context tools are now VISIBLE to MCP users/LLMs
      // This provides full project management capabilities
    ];

    toolInstances.forEach(tool => {
      tools.set(tool.name, tool);
    });

    return tools;
  }



  /**
   * Setup MCP protocol handlers
   */
  private setupHandlers(): void {
    // List available tools with schema caching (PERFORMANCE FIX)
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // Return cached schemas if available (avoids creating 40+ tool instances)
      if (this.cachedToolSchemas) {
        return { tools: this.cachedToolSchemas };
      }

      // First request: create tools to extract schemas, then cache
      const authManager = new SessionAuthManager();
      const tools = this.createSessionTools(authManager);

      this.cachedToolSchemas = Array.from(tools.values()).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }));

      console.error(`[PERFORMANCE] Cached schemas for ${this.cachedToolSchemas.length} tools`);

      return { tools: this.cachedToolSchemas };
    });

    // Execute tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Extract sessionId from args BEFORE creating SessionAuthManager
      // This allows clients to specify which session to use
      const requestedSessionId = args?.sessionId;

      // Create SessionAuthManager with explicit sessionId if provided
      // Otherwise it will auto-discover existing sessions from filesystem
      const authManager = (requestedSessionId && typeof requestedSessionId === 'string')
        ? new SessionAuthManager(requestedSessionId)
        : new SessionAuthManager();
      let sessionId: string;

      try {

        // Create tools for this request
        const tools = this.createSessionTools(authManager);

        const tool = tools.get(name);
        if (!tool) {
          throw new Error(`Unknown tool: ${name}`);
        }

        // Reduced logging - only log non-auth operations
        if (name !== 'auth' || (args && args.mode !== 'status')) {
          console.error(`Executing tool: ${name}`);
        }

        // Remove sessionId from args before passing to tool (already used in constructor)
        const toolArgs = { ...args };
        delete toolArgs.sessionId;

        const result = await tool.execute(toolArgs || {});

        // Get session ID AFTER execution (when discovery has happened)
        sessionId = authManager.getSessionId();

        // Include session ID in response for client tracking
        const responseWithSession = {
          ...result,
          sessionId: sessionId
        };

        // Reduced logging - only log auth and execution tools, not status checks
        if (name !== 'auth' || (args && args.mode !== 'status')) {
          console.error(`[Session ${sessionId}] Tool ${name} completed successfully`);
        }

        // SCHEMA FIX: Check if tool already returned proper MCP format
        // Some tools (like auth) return { content: [...], isError: false }
        // Others return plain objects that need wrapping
        if (result && Array.isArray(result.content)) {
          // Tool already returned proper MCP format, just add sessionId
          return {
            ...result,
            sessionId: sessionId
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
        console.error(`Tool ${name} failed:`, error);

        // Get session ID for error reporting (may be temporary if tool failed before discovery)
        sessionId = authManager.getSessionId();

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
                      'Use auth with mode="start" to begin authentication',
                      'Complete the OAuth flow in your browser', 
                      'Then retry your original request'
                    ],
                    command: `auth({"mode": "start"})`,
                    statusCheck: `auth({"mode": "status"})`
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
    
    // Only clear tokens if explicitly requested via environment variable
    if (process.env.MCP_CLEAR_TOKENS_ON_STARTUP === 'true') {
      console.error('Clearing all cached session tokens on startup (MCP_CLEAR_TOKENS_ON_STARTUP=true)...');
      const clearedSessions = await SessionAuthManager.clearAllSessions();
      console.error(`Cleared ${clearedSessions} cached session token(s)`);
    } else {
      console.error('Reusing existing session tokens from ~/.auth/mcp-gas/tokens/');
      console.error('Set MCP_CLEAR_TOKENS_ON_STARTUP=true to clear tokens on startup');
    }
    
    // Initialize default local root directory if not configured
    try {
      const localRoot = await LocalFileManager.initializeDefaultRoot();
      console.error(` Local root directory: ${localRoot}`);
    } catch (error) {
      console.error(' Warning: Failed to initialize local root directory:', error);
      // Don't fail server startup for this, just log the warning
    }
    
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    console.error('MCP Gas Server connected and ready');
    console.error('Each client gets isolated authentication sessions');
    console.error('Use sessionId parameter to manage multiple sessions');
    console.error('Use auth(mode="start") to authenticate with Google Apps Script');
    console.error('Authentication: Tools will return clear instructions when auth is needed');
    console.error('Direct execution: exec can execute ANY statement without wrapper functions');

    // Clean up expired filesystem sessions on startup
    const filesCleaned = await SessionAuthManager.cleanupExpiredSessions();
    if (filesCleaned > 0) {
      console.error(`Cleaned up ${filesCleaned} expired session files from filesystem`);
    }
  }

  /**
   * Stop the server gracefully
   */
  async stop(): Promise<void> {
    console.error('Stopping MCP Gas Server...');
    await this.server.close();
    console.error('MCP Gas Server stopped');
  }

  /**
   * Get server statistics
   */
  async getStats(): Promise<any> {
    const fileStats = await SessionAuthManager.getMemoryStats();

    return {
      filesystemSessions: fileStats.totalSessions,
      activeSessions: fileStats.activeSessions,
      expiredSessions: fileStats.expiredSessions,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
  }
} 