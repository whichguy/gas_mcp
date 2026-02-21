// Response formatters — buildExecErrorResponse and safe stack extraction
import { generateExecHints, ExecHints } from '../../utils/execHints.js';

/**
 * Structured error response with consistent metadata fields.
 * Used by all error paths to ensure consistent response shape.
 */
export interface ExecErrorResponse {
  status: 'error';
  scriptId: string;
  js_statement: string;
  error: {
    type: string;
    message: string;
    stack?: string;
    statusCode?: number;
    originalError?: string;
    context?: string;
    function_called?: string;
    accessed_url?: string;
    url_type?: string;
    debug_info?: {
      timestamp: string;
      deployment_mode: string;
      httpStatus: number;
      errorSource: string;
    };
  };
  logger_output: string;
  executedAt: string;
  environment: 'dev' | 'staging' | 'prod';
  versionNumber: number | null;
  ide_url_hint: string;
}

/**
 * Build standardized error response with consistent metadata fields.
 * Ensures all error paths include environment, versionNumber, ide_url_hint.
 *
 * @param scriptId - The script project ID
 * @param js_statement - The JavaScript that was executed
 * @param error - Error details object
 * @param loggerOutput - Captured Logger.log() output
 * @param options - Optional metadata (environment, versionNumber, executionUrl)
 * @returns Structured error response matching ExecErrorResponse interface
 */
export function buildExecErrorResponse(
  scriptId: string,
  js_statement: string,
  error: ExecErrorResponse['error'],
  loggerOutput: string,
  options: {
    environment?: 'dev' | 'staging' | 'prod';
    versionNumber?: number | null;
    executionUrl?: string | null;
  } = {}
): ExecErrorResponse & { hints?: ExecHints } {
  // Generate context-aware hints for the error
  const errorHints = generateExecHints(
    'error',
    js_statement,
    error.message || error.type,
    loggerOutput,
    undefined,
    false,
    options.environment || 'dev'
  );

  return {
    status: 'error',
    scriptId,
    js_statement,
    error,
    logger_output: loggerOutput,
    ...(Object.keys(errorHints).length > 0 && { hints: errorHints }),
    executedAt: new Date().toISOString(),
    environment: options.environment || 'dev',
    versionNumber: options.versionNumber ?? null,
    ide_url_hint: options.executionUrl
      ? `${options.executionUrl}?_mcp_run=true&action=auth_ide`
      : `https://script.google.com/home/projects/${scriptId}/edit`
  };
}

/**
 * Safely extract stack trace from any error-like object
 * Handles: Error objects, non-Error thrown objects, primitives, circular refs
 * @param err - Any thrown value
 * @param maxLength - Maximum stack length (default 8KB)
 * @returns Safe string representation of the stack
 */
export function getStackSafe(err: any, maxLength: number = 8192): string {
  try {
    if (!err) return '';
    if (typeof err === 'string') return err.length > maxLength ? err.substring(0, maxLength) + '\n... [truncated]' : err;

    // Prefer gasStack (GAS-originated) over generic stack
    let stack = '';
    if (typeof err.gasStack === 'string') {
      stack = err.gasStack;
    } else if (typeof err.stack === 'string') {
      stack = err.stack;
    } else if (typeof err.toString === 'function') {
      stack = err.toString();
    } else {
      stack = String(err);
    }

    return stack.length > maxLength ? stack.substring(0, maxLength) + '\n... [truncated]' : stack;
  } catch {
    return '[Unable to serialize error stack]';
  }
}
