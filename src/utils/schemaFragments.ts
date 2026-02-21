/**
 * SchemaFragments - Reusable JSON Schema property definitions
 *
 * Eliminates duplication of common schema properties across 45+ tool definitions.
 * Each fragment is a complete JSON Schema property definition ready for inclusion
 * in tool inputSchema.properties objects.
 *
 * Usage:
 *   import { SchemaFragments } from '../utils/schemaFragments.js';
 *
 *   public inputSchema = {
 *     type: 'object',
 *     properties: {
 *       ...SchemaFragments.scriptId,
 *       ...SchemaFragments.accessToken,
 *       customProperty: { type: 'string', description: 'Custom' }
 *     },
 *     required: ['scriptId']
 *   };
 */

export class SchemaFragments {
  /**
   * Google Apps Script project ID parameter
   * Used in 45+ tools
   *
   * Note: Google Apps Script IDs are typically 44 characters, but we allow
   * 25-60 to support various formats and potential future changes
   */
  static readonly scriptId = {
    scriptId: {
      type: 'string' as const,
      description: 'Google Apps Script project ID',
      pattern: '^[a-zA-Z0-9_-]{25,60}$',
      minLength: 25,
      maxLength: 60,
      examples: [
        '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
        '1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ'
      ]
    }
  };

  /**
   * Strict Script ID parameter for tools requiring exact 44-character IDs
   * Used in tools that need strict validation (e.g., raw-aider, edit)
   */
  static readonly scriptId44 = {
    scriptId: {
      type: 'string' as const,
      description: 'Google Apps Script project ID (44 characters)',
      pattern: '^[a-zA-Z0-9_-]{44}$',
      minLength: 44,
      maxLength: 44
    }
  };

  /**
   * OAuth access token parameter for stateless operations
   * Used in 40+ tools
   */
  static readonly accessToken = {
    accessToken: {
      type: 'string' as const,
      description: 'Access token for stateless operation (optional)',
      pattern: '^ya29\\.[a-zA-Z0-9_-]+$'
    }
  };

  /**
   * File path parameter (filename only, or scriptId/filename)
   * Used in 30+ tools
   */
  static readonly path = {
    path: {
      type: 'string' as const,
      description: 'File path (filename only, or scriptId/filename if scriptId parameter is empty)',
      minLength: 1,
      examples: [
        'utils.gs',
        'models/User.gs',
        'abc123def456.../helpers.gs'
      ]
    }
  };

  /**
   * Working directory parameter
   * Used in 20+ tools
   */
  static readonly workingDir = {
    workingDir: {
      type: 'string' as const,
      description: 'Working directory (defaults to current directory)'
    }
  };

  /**
   * Dry-run parameter for preview mode
   * Used in 15+ tools
   */
  static readonly dryRun = {
    dryRun: {
      type: 'boolean' as const,
      description: 'Preview changes without applying them',
      default: false
    }
  };

  /**
   * Case-sensitive search parameter
   * Used in search tools (grep, ripgrep, sed, find)
   */
  static readonly caseSensitive = {
    caseSensitive: {
      type: 'boolean' as const,
      description: 'Enable case-sensitive matching',
      default: false
    }
  };

  /**
   * Search pattern parameter
   * Used in grep, ripgrep, sed tools
   */
  static readonly pattern = {
    pattern: {
      type: 'string' as const,
      description: 'Search pattern (supports regex and literal text)',
      minLength: 1,
      examples: [
        'require\\(',
        'function\\s+(\\w+)',
        'TODO:|FIXME:',
        'console\\.log'
      ]
    }
  };

  /**
   * Include file types filter
   * Used in search tools
   */
  static readonly includeFileTypes = {
    includeFileTypes: {
      type: 'array' as const,
      description: 'Filter by file types (SERVER_JS, HTML, JSON)',
      items: {
        type: 'string' as const,
        enum: ['SERVER_JS', 'HTML', 'JSON']
      },
      examples: [
        ['SERVER_JS'],
        ['SERVER_JS', 'HTML'],
        ['JSON']
      ]
    }
  };

  /**
   * Exclude files parameter
   * Used in search tools
   */
  static readonly excludeFiles = {
    excludeFiles: {
      type: 'array' as const,
      description: 'Files to exclude from search (supports wildcards)',
      items: {
        type: 'string' as const
      },
      examples: [
        ['*/test/*', 'common-js/require'],
        ['scriptId/dist/*', 'scriptId/node_modules/*']
      ]
    }
  };

  /**
   * Context lines parameter for grep-style output
   * Used in grep, ripgrep tools
   */
  static readonly contextLines = {
    contextLines: {
      type: 'number' as const,
      description: 'Number of lines before/after each match for context',
      default: 2,
      minimum: 0,
      maximum: 10
    }
  };

  /**
   * Show line numbers parameter
   * Used in grep, ripgrep tools
   */
  static readonly showLineNumbers = {
    showLineNumbers: {
      type: 'boolean' as const,
      description: 'Include line numbers in results',
      default: true
    }
  };

  /**
   * Max results parameter for search tools
   * Used in grep, ripgrep, find tools
   */
  static readonly maxResults = {
    maxResults: {
      type: 'number' as const,
      description: 'Maximum total matches to return (prevents token overflow)',
      default: 50,
      minimum: 1,
      maximum: 200
    }
  };

  /**
   * Project path parameter for git operations
   * Used in git tools
   */
  static readonly projectPath = {
    projectPath: {
      type: 'string' as const,
      description: 'Path to nested git project within GAS (for multi-project support)',
      default: '',
      examples: ['', 'subproject1', 'libs/shared']
    }
  };

  /**
   * Repository URL parameter for git operations
   * Used in git tools
   */
  static readonly repository = {
    repository: {
      type: 'string' as const,
      description: 'Git repository URL',
      examples: [
        'https://github.com/owner/repo.git',
        'git@github.com:owner/repo.git',
        'https://gitlab.com/owner/repo.git',
        'local'
      ]
    }
  };

  /**
   * Branch name parameter for git operations
   * Used in git tools
   */
  static readonly branch = {
    branch: {
      type: 'string' as const,
      description: 'Git branch to track',
      default: 'main',
      examples: ['main', 'master', 'develop', 'feature/my-feature']
    }
  };

  /**
   * File content parameter for write operations
   * Used in write, raw_write tools
   */
  static readonly content = {
    content: {
      type: 'string' as const,
      description: 'File content to write',
      minLength: 0
    }
  };

  /**
   * Deployment ID parameter
   * Used in deployment tools
   */
  static readonly deploymentId = {
    deploymentId: {
      type: 'string' as const,
      description: 'The deployment ID'
    }
  };

  /**
   * Version number parameter
   * Used in version and deployment tools
   */
  static readonly versionNumber = {
    versionNumber: {
      type: 'number' as const,
      description: 'Version number',
      minimum: 1,
      examples: [1, 5, 10],
      llmHints: {
        typical: 'Versions start at 1 and increment with each deployment',
        discovery: 'Use deploy({operation:"status"}) or deploy_config({operation:"status"}) to see current versions'
      }
    }
  };

  /**
   * Page size parameter for pagination
   * Used in list tools
   */
  static readonly pageSize = {
    pageSize: {
      type: 'number' as const,
      description: 'Maximum number of results to return',
      default: 50,
      minimum: 1,
      examples: [10, 25, 50, 100],
      llmHints: {
        performance: 'Smaller values (10-25) for faster responses',
        typical: 'Use default 50 for most listing operations'
      }
    }
  };

  /**
   * Page token parameter for pagination
   * Used in list tools
   */
  static readonly pageToken = {
    pageToken: {
      type: 'string' as const,
      description: 'Token for pagination (optional)'
    }
  };

  /**
   * Function name parameter for execution tools
   * Used in exec_api, trigger tools
   */
  static readonly functionName = {
    functionName: {
      type: 'string' as const,
      description: 'Name of the function to execute',
      minLength: 1
    }
  };

  /**
   * JavaScript statement parameter for execution
   * Used in run, exec tools
   */
  static readonly jsStatement = {
    js_statement: {
      type: 'string' as const,
      description: 'JavaScript statement to execute',
      minLength: 1,
      examples: [
        'Math.PI * 2',
        'new Date().toISOString()',
        'DriveApp.getRootFolder().getName()',
        'require("Calculator").add(5, 3)'
      ]
    }
  };

  /**
   * Module name parameter for CommonJS module execution
   * Used in exec_api tool for calling module functions
   */
  static readonly moduleName = {
    moduleName: {
      type: 'string' as const,
      description: 'Optional CommonJS module name. If provided, calls require(moduleName)[functionName](parameters). Supports paths like "Utils", "models/User", "api/client".',
      minLength: 1,
      examples: [
        'Utils',
        'Calculator',
        'models/User',
        'api/client'
      ]
    }
  };

  /**
   * Combine multiple schema fragments
   * Helper method for creating composite schemas
   */
  static combine(...fragments: Array<Record<string, any>>): Record<string, any> {
    return Object.assign({}, ...fragments);
  }
}
