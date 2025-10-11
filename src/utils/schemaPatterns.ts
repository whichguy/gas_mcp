/**
 * Standardized MCP Schema Patterns for Google Apps Script Tools
 * 
 * This module provides reusable schema patterns that ensure consistency
 * across all MCP tools while reducing code duplication.
 */

/**
 * Type-safe enum definitions for deployment configurations
 */
export const EntryPointTypes = ['WEB_APP', 'EXECUTION_API', 'ADD_ON'] as const;
export type EntryPointType = typeof EntryPointTypes[number];

export const AccessLevels = ['MYSELF', 'DOMAIN', 'ANYONE', 'ANYONE_ANONYMOUS'] as const;
export type AccessLevel = typeof AccessLevels[number];

export const ExecutionModes = ['USER_ACCESSING', 'USER_DEPLOYING'] as const;
export type ExecutionMode = typeof ExecutionModes[number];

export const ProcessStates = ['RUNNING', 'PAUSED', 'COMPLETED', 'CANCELED', 'FAILED', 'TIMED_OUT', 'UNKNOWN'] as const;
export type ProcessState = typeof ProcessStates[number];

export const ProcessTypes = ['ADD_ON', 'EXECUTION_API', 'TIME_DRIVEN', 'TRIGGER', 'WEBAPP', 'EDITOR', 'SIMPLE_TRIGGER'] as const;
export type ProcessType = typeof ProcessTypes[number];

export const MetricsGranularities = ['WEEKLY', 'DAILY'] as const;
export type MetricsGranularity = typeof MetricsGranularities[number];

export const ContentModes = ['full', 'summary', 'signatures', 'exports', 'structure'] as const;
export type ContentMode = typeof ContentModes[number];

export const ContextModes = ['basic', 'enhanced', 'detailed'] as const;
export type ContextMode = typeof ContextModes[number];

/**
 * Context query mappings for semantic search expansion
 */
export const CONTEXT_QUERY_MAPPINGS = {
  'auth': ['authentication', 'login', 'token', 'oauth', 'credential', 'permission'],
  'test': ['spec', 'unittest', 'integration', 'mock', 'assert', 'expect'],
  'api': ['endpoint', 'request', 'response', 'http', 'rest', 'client'],
  'config': ['setting', 'parameter', 'option', 'preference', 'environment'],
  'error': ['exception', 'failure', 'bug', 'issue', 'problem', 'debug'],
  'data': ['model', 'schema', 'database', 'storage', 'persistence'],
  'ui': ['interface', 'component', 'view', 'template', 'frontend', 'display'],
  'util': ['helper', 'tool', 'library', 'common', 'shared', 'utility']
} as const;

/**
 * Standard content mode schema for context-aware tools
 */
export const CONTENT_MODE_SCHEMA = {
  type: 'string',
  enum: [...ContentModes],
  description: 'Content processing mode. LLM RECOMMENDATION: Use "summary" for overview, "full" for complete content.',
  default: 'summary',
  llmHints: {
    overview: 'Use "summary" for quick understanding and token efficiency',
    complete: 'Use "full" when complete content analysis is needed',
    api: 'Use "signatures" to focus on function/method signatures',
    module: 'Use "exports" to see what a module provides',
    architecture: 'Use "structure" for high-level code organization'
  }
} as const;

/**
 * Standard context mode schema for intelligent processing
 */
export const CONTEXT_MODE_SCHEMA = {
  type: 'string',
  enum: [...ContextModes],
  description: 'Context analysis depth. LLM RECOMMENDATION: Use "enhanced" for balanced performance and insight.',
  default: 'enhanced',
  llmHints: {
    fast: 'Use "basic" for simple queries and fast responses',
    balanced: 'Use "enhanced" for optimal balance of performance and context',
    comprehensive: 'Use "detailed" for complex queries requiring deep analysis'
  }
} as const;

/**
 * Standard token budget schema for optimization
 */
export const TOKEN_BUDGET_SCHEMA = {
  type: 'number',
  description: 'Maximum tokens for response content (default: 8000). LLM USE: Adjust based on context window size.',
  minimum: 1000,
  maximum: 50000,
  default: 8000,
  llmHints: {
    efficient: 'Use 4000-8000 for most queries to maintain efficiency',
    comprehensive: 'Use 12000-20000 for complex analysis requiring full context',
    minimal: 'Use 1000-2000 for quick overviews and summaries'
  }
} as const;

/**
 * Standard access token schema with LLM-friendly documentation
 */
export const ACCESS_TOKEN_SCHEMA = {
  type: 'string',
  description: 'Access token for stateless operation (optional). LLM TYPICAL: Omit - tool uses session authentication.',
  pattern: '^ya29\\.[a-zA-Z0-9_-]+$',
  llmHints: {
    typical: 'Usually omitted - tool uses session authentication from auth',
    stateless: 'Include when doing token-based operations without session storage',
    security: 'Never log or expose these tokens in responses'
  }
} as const;

/**
 * Standard script ID schema with comprehensive validation and LLM guidance
 * Updated to match Google's actual 44-character Drive file ID format
 */
export const SCRIPT_ID_SCHEMA = {
  type: 'string',
  description: 'Google Apps Script project ID. LLM REQUIREMENT: Must be a valid Google Drive file ID for an Apps Script project.',
  pattern: '^[a-zA-Z0-9_-]{25,60}$',
  minLength: 25,
  maxLength: 60,
  examples: [
    '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
    '1p3DDxPcgw23lzn2NQl3gM7Nkztki3VmmES46FbLm5IPHizEdJzsQjvAN'
  ]
} as const;

/**
 * Standard pagination parameters with LLM workflow guidance
 */
export const PAGINATION_SCHEMA = {
  pageSize: {
    type: 'number',
    description: 'Maximum number of items to return (1-50, default: 50). LLM RECOMMENDATION: Use 50 for comprehensive data.',
    minimum: 1,
    maximum: 50,
    default: 50,
    llmHints: {
      comprehensive: 'Use 50 (default) for complete data sets',
      performance: 'Use smaller values (10-20) for faster responses',
      monitoring: 'Use 50 for comprehensive monitoring and analysis'
    }
  },
  pageToken: {
    type: 'string',
    description: 'Token for pagination (optional). LLM USE: Include token from previous response to get next page.',
    llmHints: {
      workflow: 'Get this from previous response.nextPageToken',
      iteration: 'Keep calling with pageToken until nextPageToken is null'
    }
  }
} as const;

/**
 * Standard deployment configuration schema
 */
export const DEPLOYMENT_CONFIG_SCHEMA = {
  entryPointType: {
    type: 'string',
    enum: [...EntryPointTypes], // Convert to regular array for JSON Schema
    description: 'Type of deployment entry point. LLM GUIDANCE: Use WEB_APP for web interfaces, EXECUTION_API for programmatic access.',
    default: 'EXECUTION_API',
    llmHints: {
      webApp: 'Use WEB_APP for browser-accessible applications',
      api: 'Use EXECUTION_API for programmatic function calls',
      addOn: 'Use ADD_ON for Google Workspace add-ons'
    }
  },
  webAppAccess: {
    type: 'string',
    enum: [...AccessLevels], // Convert to regular array for JSON Schema
    description: 'Who can access the web app (for WEB_APP type). LLM RECOMMENDATION: Use ANYONE for public tools, MYSELF for private tools.',
    default: 'ANYONE',
    llmHints: {
      public: 'Use ANYONE for public tools and utilities',
      private: 'Use MYSELF for personal tools and testing',
      domain: 'Use DOMAIN for organization-specific tools'
    }
  },
  webAppExecuteAs: {
    type: 'string',
    enum: [...ExecutionModes], // Convert to regular array for JSON Schema
    description: 'Who the web app runs as (for WEB_APP type). LLM GUIDANCE: USER_DEPLOYING for consistent permissions, USER_ACCESSING for user-specific data.',
    default: 'USER_DEPLOYING',
    llmHints: {
      consistent: 'Use USER_DEPLOYING for consistent permissions and data access',
      userSpecific: 'Use USER_ACCESSING when tool needs user-specific permissions'
    }
  },
  accessLevel: {
    type: 'string',
    enum: [...AccessLevels], // Convert to regular array for JSON Schema
    description: 'Access level for API Executable (for EXECUTION_API type). LLM RECOMMENDATION: Use MYSELF for secure APIs.',
    default: 'MYSELF',
    llmHints: {
      secure: 'Use MYSELF for secure API access',
      sharing: 'Use ANYONE for shared utility functions',
      organization: 'Use DOMAIN for organization-wide APIs'
    }
  }
} as const;

/**
 * Standard authentication prerequisites for LLM workflow guides
 */
export const AUTH_PREREQUISITES = [
  '1. Authentication: auth({mode: "status"}) → auth({mode: "start"}) if needed'
] as const;

/**
 * Standard authentication error handling for LLM workflow guides
 */
export const AUTH_ERROR_HANDLING = {
  'AuthenticationError': 'Run auth({mode: "start"}) to authenticate first',
  'PermissionError': 'Check Google Cloud Console permissions and API access',
  'TokenExpired': 'Authentication token expired, run auth({mode: "start"}) to re-authenticate'
} as const;

/**
 * Common error handling patterns for script operations
 */
export const SCRIPT_ERROR_HANDLING = {
  ...AUTH_ERROR_HANDLING,
  'ScriptNotFound': 'Verify scriptId is correct and accessible',
  'InvalidScriptId': 'ScriptId must be a valid Google Drive file ID for an Apps Script project (25-60 characters, alphanumeric, _, -)'
} as const;

/**
 * Common error handling patterns for deployment operations
 */
export const DEPLOYMENT_ERROR_HANDLING = {
  ...SCRIPT_ERROR_HANDLING,
  'DeploymentNotFound': 'Verify deploymentId is correct and accessible',
  'ManifestError': 'Project manifest configuration may be invalid'
} as const;

/**
 * Helper function to create consistent tool input schemas
 */
export function createToolSchema(properties: Record<string, any>, required: string[] = []): any {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  };
}

/**
 * Helper function to create consistent LLM workflow guides
 */
export function createWorkflowGuide(options: {
  prerequisites?: string[];
  useCases?: Record<string, string>;
  errorHandling?: Record<string, string>;
  returnValue?: Record<string, string>;
  nextSteps?: string[];
}): any {
  return {
    llmWorkflowGuide: {
      prerequisites: options.prerequisites || AUTH_PREREQUISITES,
      ...(options.useCases && { useCases: options.useCases }),
      errorHandling: options.errorHandling || AUTH_ERROR_HANDLING,
      ...(options.returnValue && { returnValue: options.returnValue }),
      ...(options.nextSteps && { nextSteps: options.nextSteps })
    }
  };
}

/**
 * Pre-configured schema combinations for common tool types
 */
export const COMMON_TOOL_SCHEMAS = {
  /**
   * Standard schema for tools that operate on scripts
   */
  scriptOperation: (additionalProperties: Record<string, any> = {}) => createToolSchema({
    scriptId: SCRIPT_ID_SCHEMA,
    ...additionalProperties,
    accessToken: ACCESS_TOKEN_SCHEMA
  }, ['scriptId']),

  /**
   * Standard schema for tools that list items with pagination
   */
  listOperation: (additionalProperties: Record<string, any> = {}) => createToolSchema({
    ...PAGINATION_SCHEMA,
    ...additionalProperties,
    accessToken: ACCESS_TOKEN_SCHEMA
  }),

  /**
   * Standard schema for tools that operate on scripts with pagination
   */
  scriptListOperation: (additionalProperties: Record<string, any> = {}) => createToolSchema({
    scriptId: SCRIPT_ID_SCHEMA,
    ...PAGINATION_SCHEMA,
    ...additionalProperties,
    accessToken: ACCESS_TOKEN_SCHEMA
  }, ['scriptId']),

  /**
   * Standard schema for deployment tools
   */
  deploymentOperation: (additionalProperties: Record<string, any> = {}) => createToolSchema({
    scriptId: SCRIPT_ID_SCHEMA,
    ...DEPLOYMENT_CONFIG_SCHEMA,
    ...additionalProperties,
    accessToken: ACCESS_TOKEN_SCHEMA
  }, ['scriptId']),

  /**
   * Standard schema for context-aware tools
   */
  contextOperation: (additionalProperties: Record<string, any> = {}) => createToolSchema({
    scriptId: SCRIPT_ID_SCHEMA,
    query: {
      type: 'string',
      description: 'Search query with semantic expansion. LLM USE: Use natural language to find related code.',
      minLength: 1,
      llmHints: {
        semantic: 'Query is expanded using semantic mappings (e.g., "auth" finds authentication-related code)',
        natural: 'Use natural language descriptions of what you\'re looking for',
        specific: 'More specific queries yield better results'
      }
    },
    contentMode: CONTENT_MODE_SCHEMA,
    contextMode: CONTEXT_MODE_SCHEMA,
    tokenBudget: TOKEN_BUDGET_SCHEMA,
    ...additionalProperties,
    accessToken: ACCESS_TOKEN_SCHEMA
  }, ['scriptId', 'query'])
};

/**
 * Export commonly used complete schemas
 */
export {
  createToolSchema as toolSchema,
  createWorkflowGuide as workflowGuide
}; 