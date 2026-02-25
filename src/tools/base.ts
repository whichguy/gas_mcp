import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { AuthStateManager } from '../auth/authState.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { AuthenticationError, GASApiError } from '../errors/mcpErrors.js';
import { GASAuthClient } from '../auth/oauthClient.js';
import { AUTH_MESSAGES, getContextualAuthMessage } from '../constants/authMessages.js';
import { GASErrorHandler, ErrorContext } from '../utils/errorHandler.js';
import { MCPValidator } from '../utils/validation.js';
import { AuthConfig } from '../auth/oauthClient.js';
import { loadOAuthConfigFromJson } from './authConfig.js';
import { mcpLogger } from '../utils/mcpLogger.js';

/**
 * Base class for all MCP Gas tools with comprehensive authentication and validation support
 * 
 * ## Architecture Overview
 * 
 * This base class provides a **standardized foundation** for all MCP Gas tools, implementing
 * common patterns for authentication, validation, error handling, and Google API integration.
 * 
 * ### 🔐 Dual Authentication Architecture
 * 
 * Supports both legacy singleton and modern session-based authentication:
 * 
 * #### Session-Based Authentication (Preferred)
 * ```typescript
 * // Each tool instance gets a session-specific auth manager
 * const authManager = new SessionAuthManager(sessionId);
 * const tool = new MyTool(authManager);
 * ```
 * 
 * #### Singleton Authentication (Legacy)
 * ```typescript
 * // Falls back to singleton auth when no session manager provided
 * const tool = new MyTool(); // Uses AuthStateManager.getInstance()
 * ```
 * 
 * ### 🛡️ Comprehensive Validation Framework
 * 
 * Provides validation helpers for all common Google Apps Script parameters:
 * - **Script IDs**: Google Apps Script project identifiers
 * - **Function Names**: JavaScript function names and expressions
 * - **File Paths**: Apps Script file paths with extension handling
 * - **URLs**: Web app URLs and callback URLs
 * - **Code**: JavaScript/Apps Script code validation
 * - **Parameters**: Type checking, required fields, enums
 * 
 * ### 🚨 Centralized Error Handling
 * 
 * Implements consistent error handling patterns:
 * - **API Error Translation**: Converts Google API errors to user-friendly messages
 * - **Context Preservation**: Maintains operation context for better error messages
 * - **Rate Limiting**: Handles quota and rate limit errors with retry guidance
 * - **Authentication Errors**: Provides clear auth flow guidance
 * 
 * ### 🎯 Development Guidelines for AI Assistants
 * 
 * When extending this base class:
 * 
 * #### Tool Implementation Pattern
 * ```typescript
 * export class MyTool extends BaseTool {
 *   public name = 'my_tool';
 *   public description = 'Tool description';
 *   public inputSchema = { ... };
 * 
 *   async execute(params: any): Promise<any> {
 *     // 1. Validate inputs
 *     const scriptId = this.validate.scriptId(params.scriptId, 'my operation');
 *     
 *     // 2. Get authentication
 *     const token = await this.getAuthToken(params);
 *     
 *     // 3. Make API call with error handling
 *     return await this.handleApiCall(
 *       () => myApiCall(token, scriptId),
 *       'my operation',
 *       { scriptId }
 *     );
 *   }
 * }
 * ```
 * 
 * #### Authentication Checking
 * ```typescript
 * // Tools that require authentication
 * protected requiresAuthentication = true; // default
 * 
 * // Tools that can work without auth (rare)
 * protected requiresAuthentication = false;
 * ```
 * 
 * #### Validation Usage
 * ```typescript
 * // Use validation helpers for consistent error messages
 * const scriptId = this.validate.scriptId(params.scriptId, 'script execution');
 * const code = this.validate.code(params.code, 'code validation');
 * this.validate.required(params, ['scriptId', 'functionName'], 'parameter validation');
 * ```
 * 
 * @abstract
 * @export
 * @class BaseTool
 * @implements {Tool}
 */
export abstract class BaseTool implements Tool {
  [x: string]: unknown; // Index signature for Tool interface
  
  /** Tool name as registered with MCP server (must be unique) */
  public abstract name: string;
  
  /** Human-readable description of what this tool does */
  public abstract description: string;
  
  /** JSON schema defining input parameters and validation rules */
  public abstract inputSchema: any;

  /** Optional JSON schema defining structured output format (MCP 2025-11-25) */
  public outputSchema?: { type: 'object'; properties?: Record<string, object>; required?: string[]; [key: string]: unknown };

  /** Optional MCP tool annotations for selection hints (MCP 2025-06-18) */
  public annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };

  /** 
   * Whether this tool requires authentication to function
   * 
   * - `true` (default): Tool requires OAuth authentication before use
   * - `false`: Tool can work with public/unauthenticated APIs
   */
  protected requiresAuthentication: boolean = true;

  /** Legacy singleton auth state manager (fallback) */
  protected authStateManager: AuthStateManager;
  
  /** Session-specific auth manager (preferred when available) */
  protected sessionAuthManager?: SessionAuthManager;
  
  /** OAuth client for Google Apps Script authentication */
  protected authClient: GASAuthClient;

  /**
   * Initialize base tool with authentication support
   * 
   * ## Authentication Architecture Selection:
   * 
   * - **With Session Manager**: Creates session-isolated tool instance
   * - **Without Session Manager**: Falls back to singleton authentication
   * 
   * ## Initialization Process:
   * 1. **Session Auth Setup**: Configure session-specific auth if provided
   * 2. **Singleton Auth Fallback**: Initialize singleton auth manager as backup
   * 3. **OAuth Client**: Create shared OAuth client for Google API calls
   * 
   * @param sessionAuthManager - Optional session-specific auth manager for isolation
   * 
   * @example
   * ```typescript
   * // Session-based tool (preferred)
   * const sessionAuth = new SessionAuthManager('session-123');
   * const tool = new MyTool(sessionAuth);
   * 
   * // Singleton tool (legacy)
   * const tool = new MyTool();
   * ```
   */
  constructor(sessionAuthManager?: SessionAuthManager) {
    // Support both session-based and singleton authentication
    this.sessionAuthManager = sessionAuthManager;
    this.authStateManager = AuthStateManager.getInstance();
    
    // Use simplified OAuth configuration from JSON file only
    try {
      const fullConfig = loadOAuthConfigFromJson();
      this.authClient = new GASAuthClient(fullConfig);
    } catch (error) {
      // If config loading fails, use a minimal config for base tool
      mcpLogger.warning('base', { message: 'Base tool: Failed to load OAuth config, using minimal fallback' });
      const minimalConfig: AuthConfig = {
        client_id: 'base-tool-fallback',
        client_secret: undefined,
        type: 'uwp',
        redirect_uris: ['http://127.0.0.1/*', 'http://localhost/*'],
        scopes: []
      };
      this.authClient = new GASAuthClient(minimalConfig);
    }
  }

  /**
   * Abstract method that must be implemented by each tool
   * 
   * ## Implementation Requirements:
   * 
   * Each tool must implement this method to handle:
   * 1. **Parameter Validation**: Use `this.validate.*` helpers
   * 2. **Authentication**: Call `await this.getAuthToken(params)`
   * 3. **API Calls**: Use `await this.handleApiCall(...)` for Google API calls
   * 4. **Response Formatting**: Return structured response data
   * 
   * @param params - Input parameters from MCP client (validated against inputSchema)
   * @returns Promise resolving to tool execution result
   * 
   * @example
   * ```typescript
   * async execute(params: any): Promise<any> {
   *   // Validate required parameters
   *   const scriptId = this.validate.scriptId(params.scriptId, 'list files');
   *   
   *   // Get authentication token
   *   const token = await this.getAuthToken(params);
   *   
   *   // Make API call with error handling
   *   return await this.handleApiCall(
   *     () => this.gasClient.listFiles(scriptId, token),
   *     'list files',
   *     { scriptId }
   *   );
   * }
   * ```
   */
  abstract execute(params: any): Promise<any>;

  /**
   * Check authentication status and get valid access token
   * 
   * ## Authentication Flow:
   * 
   * 1. **Session Auth First**: Try session-specific authentication if available
   * 2. **Token Validation**: Verify token is valid and not expired
   * 3. **Reload on Failure**: Refresh auth state from disk if auth fails initially
   * 4. **Retry After Reload**: Try authentication again after reloading state
   * 5. **Singleton Fallback**: Use singleton auth if session auth unavailable
   * 6. **Error Handling**: Throw `AuthenticationError` with auth URL if failed
   * 
   * ## Error Scenarios:
   * - **Not Authenticated**: User hasn't completed OAuth flow
   * - **Token Expired**: Access token needs refresh
   * - **Invalid Token**: Token is malformed or revoked
   * 
   * @protected
   * @returns Valid Google Apps Script access token
   * @throws {AuthenticationError} When authentication is required or expired
   * 
   * @example
   * ```typescript
   * // In tool implementation
   * try {
   *   const token = await this.requireAuthentication();
   *   // Use token for API calls
   * } catch (error) {
   *   // Error contains auth URL for user guidance
   *   throw error; // Will trigger auto-auth flow in server
   * }
   * ```
   */
  protected async requireAuthentication(): Promise<string> {
    // Try session auth first if available
    if (this.sessionAuthManager) {
      try {
        // RACE CONDITION FIX: Wait for session to be fully ready
        console.error(`🔄 [${this.name}] Checking session readiness before authentication...`);
        const sessionReady = await this.sessionAuthManager.waitForSessionReady(5000); // 5 second timeout
        
        if (!sessionReady) {
          console.error(`⚠️ [${this.name}] Session not ready after timeout, proceeding anyway...`);
        }
        
        // SIMPLIFIED: Basic async operations since MCP is half-duplex
        // First attempt - use cached auth state
        if (await this.sessionAuthManager.isAuthenticated()) {
          const token = await this.sessionAuthManager.getValidToken();
          if (token) {
            return token;
          }
        }

        // If first attempt failed, reload auth state from disk
        // This ensures we see authentication saved by other tools (like auth)
        console.error(`🔄 [${this.name}] Reloading auth state to check for fresh authentication...`);
        await this.sessionAuthManager.reloadAuthSession();
        
        // Second attempt - try again with fresh state
        if (await this.sessionAuthManager.isAuthenticated()) {
          const token = await this.sessionAuthManager.getValidToken();
          if (token) {
            console.error(`✅ [${this.name}] Found fresh authentication after reload`);
            return token;
          }
        }

      } catch (error: any) {
        // Log auth errors but continue to fallback
        mcpLogger.warning('base', { message: `[${this.name}] Session auth error`, details: error.message });
      }

      // Both attempts failed
      throw new AuthenticationError(
        `Authentication required for ${this.name}. Please run auth(mode="start") to authenticate with Google Apps Script, then retry this command.`
      );
    }

    // Fall back to singleton auth
    if (!this.authStateManager.isAuthenticated()) {
      throw new AuthenticationError(
        `Authentication required for ${this.name}. Please run auth(mode="start") to authenticate with Google Apps Script, then retry this command.`
      );
    }

    const token = this.authStateManager.getValidToken();
    if (!token) {
      throw new AuthenticationError(
        `Authentication expired for ${this.name}. Please run auth(mode="start") to re-authenticate with Google Apps Script, then retry this command.`
      );
    }
    
    return token;
  }

  /**
   * Get authentication token from parameters or session/singleton auth
   * 
   * ## Token Resolution Priority:
   * 
   * 1. **Direct Token**: Use `params.accessToken` if provided (for stateless operation)
   * 2. **Session Auth**: Use session-specific authentication if available
   * 3. **Singleton Auth**: Fall back to singleton authentication
   * 4. **Error**: Throw authentication error if no valid token found
   * 
   * ## Use Cases:
   * - **Stateless Operation**: Client provides access token directly
   * - **Session Operation**: Use session-based auth (most common)
   * - **Legacy Operation**: Use singleton auth (backward compatibility)
   * 
   * @protected
   * @param params - Tool parameters that may contain accessToken
   * @returns Valid Google Apps Script access token
   * @throws {AuthenticationError} When authentication is required
   * 
   * @example
   * ```typescript
   * // In tool execute method
   * const token = await this.getAuthToken(params);
   * 
   * // Token can come from:
   * // 1. params.accessToken (stateless)
   * // 2. Session authentication
   * // 3. Singleton authentication
   * ```
   */
  protected async getAuthToken(params: any): Promise<string> {
    // If access token provided directly, use it
    if (params.accessToken) {
      return params.accessToken;
    }

    // Otherwise use session or singleton auth
    return await this.requireAuthentication();
  }

  /**
   * Enhanced API call handler with centralized error handling
   * 
   * ## Error Handling Features:
   * 
   * - **Google API Errors**: Translates Google API errors to user-friendly messages
   * - **Rate Limiting**: Handles quota exceeded and rate limit errors
   * - **Authentication Errors**: Detects expired tokens and auth failures
   * - **Context Preservation**: Maintains operation context for better error messages
   * - **Retry Guidance**: Provides specific guidance for recoverable errors
   * 
   * ## Usage Pattern:
   * ```typescript
   * const result = await this.handleApiCall(
   *   () => googleApi.doSomething(params),
   *   'operation description',
   *   { additionalContext: 'for debugging' }
   * );
   * ```
   * 
   * ## Error Context:
   * The error context helps provide better error messages by including:
   * - Operation being performed
   * - Tool that failed
   * - Additional context (script ID, function name, etc.)
   * 
   * @protected
   * @template T - Return type of the API call
   * @param apiCall - Function that makes the Google API call
   * @param operation - Human-readable description of the operation
   * @param additionalContext - Additional context for error messages
   * @returns Result of the API call
   * @throws {MCPGasError} Translated error with context and guidance
   * 
   * @example
   * ```typescript
   * // Example API call with error handling
   * const files = await this.handleApiCall(
   *   () => this.gasClient.getProject(scriptId, token),
   *   'get project information',
   *   { scriptId, operation: 'project lookup' }
   * );
   * ```
   */
  protected async handleApiCall<T>(
    apiCall: () => Promise<T>,
    operation: string,
    additionalContext?: Record<string, any>
  ): Promise<T> {
    try {
      const result = await apiCall();
      return result;
    } catch (error: any) {
      // Use centralized error handler
      const context: ErrorContext = {
        operation,
        tool: this.name,
        additionalInfo: additionalContext
      };
      
      // This will throw the appropriate error type with comprehensive help
      GASErrorHandler.handleApiError(error, context);
    }
  }

  /**
   * Create error context for this tool instance
   * 
   * Helper method for creating consistent error context objects that are used
   * throughout the error handling system to provide better error messages.
   * 
   * @protected
   * @param operation - Description of the operation being performed
   * @param options - Additional context options
   * @param options.scriptId - Google Apps Script project ID
   * @param options.functionName - Function being executed
   * @param options.additionalInfo - Any additional context information
   * @returns Error context object for use in error handling
   * 
   * @example
   * ```typescript
   * const context = this.createErrorContext('execute function', {
   *   scriptId: 'abc123',
   *   functionName: 'myFunction',
   *   additionalInfo: { parameters: params }
   * });
   * ```
   */
  protected createErrorContext(
    operation: string, 
    options: {
      scriptId?: string;
      functionName?: string;
      additionalInfo?: Record<string, any>;
    } = {}
  ): ErrorContext {
    return GASErrorHandler.createContext(operation, this.name, options);
  }

  /**
   * Get current authentication status for this tool
   * 
   * @protected
   * @returns Authentication status information
   */
  protected async getAuthStatus() {
    if (this.sessionAuthManager) {
      return await this.sessionAuthManager.getAuthStatus();
    }
    return this.authStateManager.getAuthStatus();
  }

  /**
   * Check if this tool requires authentication
   * 
   * @protected
   * @returns Object indicating if auth is required and why
   */
  protected getAuthRequirement(): { required: boolean; message?: string } {
    if (!this.requiresAuthentication) {
      return { 
        required: false, 
        message: 'This tool can work without authentication for public resources' 
      };
    }

    return {
      required: true,
      message: AUTH_MESSAGES.TOOL_REQUIRES_AUTH
    };
  }

  /**
   * Comprehensive validation helpers for Google Apps Script parameters
   * 
   * ## Validation Categories:
   * 
   * ### Google Apps Script Specific
   * - `scriptId`: Google Apps Script project identifiers
   * - `functionName`: JavaScript function names and expressions
   * - `filePath`: Apps Script file paths with extension handling
   * - `code`: JavaScript/Apps Script code validation
   * - `url`: Web app URLs and callback URLs
   * - `timezone`: Timezone identifiers
   * 
   * ### General Parameter Validation
   * - `required`: Check for required fields
   * - `string`: String type validation with length constraints
   * - `number`: Number type validation with min/max constraints
   * - `boolean`: Boolean type validation
   * - `enum`: Enum value validation
   * 
   * ## Usage Examples:
   * ```typescript
   * // Google Apps Script specific
   * const scriptId = this.validate.scriptId(params.scriptId, 'script execution');
   * const code = this.validate.code(params.code, 'code validation');
   * 
   * // General validation
   * this.validate.required(params, ['scriptId', 'functionName'], 'execution');
   * const port = this.validate.number(params.port, 'port', 'port validation', 1000, 65535);
   * const mode = this.validate.enum(params.mode, 'mode', ['start', 'stop'], 'mode selection');
   * ```
   * 
   * ## Error Handling:
   * All validation methods throw appropriate errors with:
   * - Clear error messages
   * - Operation context
   * - Suggested fixes
   * - Parameter requirements
   * 
   * @protected
   */
  protected validate = {
    scriptId: (scriptId: string, operation: string): string => {
      const coerced = MCPValidator.coerceScriptId(scriptId);
      const context = this.createErrorContext(operation, { scriptId: coerced });
      MCPValidator.validateScriptId(coerced, context);
      return coerced;
    },

    functionName: (functionName: string, operation: string): string => {
      const context = this.createErrorContext(operation, { functionName });
      MCPValidator.validateFunctionName(functionName, context);
      return functionName;
    },

    filePath: (path: string, operation: string): string => {
      const context = this.createErrorContext(operation);
      MCPValidator.validateFilePath(path, context);
      return path;
    },

    code: (code: string, operation: string, contentType?: string): string => {
      const context = this.createErrorContext(operation);
      MCPValidator.validateCode(code, context, contentType);
      return code;
    },

    url: (url: string, operation: string): string => {
      const context = this.createErrorContext(operation);
      MCPValidator.validateUrl(url, context);
      return url;
    },

    timezone: (timezone: string, operation: string): string => {
      const context = this.createErrorContext(operation);
      MCPValidator.validateTimezone(timezone, context);
      return timezone;
    },

    htmlContent: (content: string, operation: string): string => {
      const context = this.createErrorContext(operation);
      MCPValidator.validateHtmlContent(content, context);
      return content;
    },

    // Legacy validation methods for backward compatibility
    required: (params: any, requiredFields: string[], operation: string = 'parameter validation') => {
      const context = this.createErrorContext(operation);
      for (const field of requiredFields) {
        MCPValidator.validateParameter({
          field,
          value: params[field],
          required: true
        }, { context });
    }
    },

    string: (value: any, fieldName: string, operation: string = 'parameter validation', minLength: number = 1): string => {
      const context = this.createErrorContext(operation);
      MCPValidator.validateParameter({
        field: fieldName,
        value,
        required: true,
        type: 'string',
        minLength
      }, { context });
    return value;
    },

    number: (value: any, fieldName: string, operation: string = 'parameter validation', min?: number, max?: number): number => {
      const context = this.createErrorContext(operation);
      MCPValidator.validateParameter({
        field: fieldName,
        value,
        required: true,
        type: 'number',
        customValidator: (val) => {
          if (min !== undefined && val < min) return `must be at least ${min}`;
          if (max !== undefined && val > max) return `must be at most ${max}`;
          return null;
    }
      }, { context });
    return value;
    },

    boolean: (value: any, fieldName: string, operation: string = 'parameter validation'): boolean => {
      const context = this.createErrorContext(operation);
      MCPValidator.validateParameter({
        field: fieldName,
        value,
        required: true,
        type: 'boolean'
      }, { context });
    return value;
    },

    enum: <T extends string>(value: any, fieldName: string, allowedValues: T[], operation: string = 'parameter validation'): T => {
      const context = this.createErrorContext(operation);
      MCPValidator.validateParameter({
        field: fieldName,
        value,
        required: true,
        enum: allowedValues
      }, { context });
    return value;
  }
  };


} 