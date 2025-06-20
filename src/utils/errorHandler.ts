/**
 * Centralized error handling utilities for Google Apps Script operations
 * Consolidates duplicate error handling patterns from multiple tools
 * 
 * **Eliminates duplicate patterns from:**
 * - deployments.ts (403/404 handling)
 * - proxySetup.ts (permission denied handling)
 * - execution.ts (status code handling)
 * - filesystem.ts (API error handling)
 * - And 5 other tools with similar patterns
 * 
 * **Benefits:**
 * - Consistent error messages across all tools
 * - Centralized troubleshooting instructions
 * - Easier maintenance of error handling logic
 * - Reduced code duplication (50+ lines eliminated)
 */

import { GASApiError, ValidationError, AuthenticationError } from '../errors/mcpErrors.js';
import { AUTH_MESSAGES } from '../constants/authMessages.js';

export interface ErrorContext {
  operation: string;
  scriptId?: string;
  functionName?: string;
  tool: string;
  additionalInfo?: Record<string, any>;
}

export interface ErrorHandlingResult {
  error: Error;
  shouldThrow: boolean;
  helpMessage: string;
  troubleshootingSteps: string[];
}

/**
 * Centralized error handler for Google Apps Script API operations
 * 
 * **Replaces duplicate error handling in:**
 * - `GASDeployCreateTool` - 403/404 permission handling
 * - `GASProxySetupTool` - permission and validation errors
 * - `GASRunTool` - execution and deployment errors
 * - `GASWriteTool`, `GASCatTool`, etc. - file operation errors
 * 
 * **Provides consistent error responses** with:
 * - Contextual help messages
 * - Specific troubleshooting steps
 * - Appropriate error types
 * - Authentication guidance when needed
 */
export class GASErrorHandler {
  
  /**
   * Handle Google Apps Script API errors with context-aware responses
   * 
   * **Consolidates error handling patterns** from multiple tools into
   * a single, comprehensive error processor with consistent messaging
   * and troubleshooting guidance.
   * 
   * @param error - The original error from the API call
   * @param context - Context information for generating helpful messages
   * @returns Processed error with help information
   */
  static handleApiError(error: any, context: ErrorContext): never {
    // Enhanced HTTP status code extraction - check all possible sources
    const statusCode = error.status || 
                       error.statusCode || 
                       error.response?.status || 
                       error.response?.statusCode ||
                       error.data?.statusCode ||
                       error.code ||
                       (error.message && error.message.includes('HTTP ') ? 
                         parseInt(error.message.match(/HTTP (\d+)/)?.[1] || '500') : 500);
    
    // Enhanced error message extraction - get most detailed message available
    const errorMessage = error.response?.data?.error?.message ||
                         error.response?.data?.message ||
                         error.response?.statusText ||
                         error.message ||
                         error.error?.message ||
                         error.error ||
                         error.toString() ||
                         'Unknown error';
    
    // Extract additional error details for debugging
    const errorDetails = {
      originalError: error,
      httpStatusCode: statusCode,
      httpStatusText: error.response?.statusText,
      errorMessage: errorMessage,
      responseData: error.response?.data,
      googleErrorCode: error.response?.data?.error?.code,
      googleErrorStatus: error.response?.data?.error?.status,
      apiEndpoint: error.config?.url || error.request?.url,
      requestMethod: error.config?.method || error.request?.method,
      context: context
    };
    
    // Log comprehensive error information for debugging
    console.error(`🔍 Google API Error Details:`, errorDetails);
    
    // Process the error based on status code and context
    const result = this.processError(statusCode, errorMessage, context, errorDetails);
    
    // Enhance the error with additional debugging information
    (result.error as any).debugInfo = errorDetails;
    
    // Throw the appropriate error type
    throw result.error;
  }

  /**
   * Process errors and generate contextual help information
   * 
   * **Central processing logic** that replaces scattered error handling
   * across tools with consistent, context-aware error processing.
   */
  private static processError(
    statusCode: number, 
    errorMessage: string, 
    context: ErrorContext,
    errorDetails: Record<string, any>
  ): ErrorHandlingResult {
    
    switch (statusCode) {
      case 401:
        return this.handleAuthenticationError(errorMessage, context, errorDetails);
      
      case 403:
        return this.handlePermissionError(errorMessage, context, errorDetails);
      
      case 404:
        return this.handleNotFoundError(errorMessage, context, errorDetails);
      
      case 429:
        return this.handleRateLimitError(errorMessage, context, errorDetails);
      
      case 500:
      case 502:
      case 503:
        return this.handleServerError(statusCode, errorMessage, context, errorDetails);
      
      default:
        return this.handleUnknownError(statusCode, errorMessage, context, errorDetails);
    }
  }

  /**
   * Handle 401 authentication errors (consolidates auth error patterns)
   */
  private static handleAuthenticationError(message: string, context: ErrorContext, errorDetails: Record<string, any>): ErrorHandlingResult {
    const helpMessage = `Authentication required for ${context.operation}. Token may be expired or invalid.`;
    
    const troubleshootingSteps = [
      '🔑 AUTHENTICATION REQUIRED:',
      `   HTTP Status: ${errorDetails.httpStatusCode} ${errorDetails.httpStatusText || ''}`,
      `   API Endpoint: ${errorDetails.apiEndpoint || 'Unknown'}`,
      `   Re-authenticate with: ${AUTH_MESSAGES.START_FLOW_INSTRUCTION}`,
      '',
      '🔍 COMMON CAUSES:',
      '   • OAuth token has expired',
      '   • Invalid or malformed access token',
      '   • Authentication session was revoked',
      '   • Google API error: ' + (errorDetails.googleErrorCode || 'Unknown'),
      '',
      '🛠️ SOLUTIONS:',
      '   1. Run gas_auth(mode="logout") to clear current session',
      '   2. Run gas_auth(mode="start") to re-authenticate',
      '   3. Ensure you have the required OAuth scopes',
      '   4. Check that your credentials are properly configured'
    ];

    const error = new AuthenticationError(
      `${helpMessage} Context: ${context.operation} in ${context.tool}. HTTP ${errorDetails.httpStatusCode}: ${message}`,
      undefined // Auth URL will be generated by the error class
    );

    // Include full HTTP details in error data
    (error as any).data = {
      ...(error as any).data,
      httpDetails: errorDetails
    };

    return {
      error,
      shouldThrow: true,
      helpMessage,
      troubleshootingSteps
    };
  }

  /**
   * Handle 403 permission errors (consolidates permission patterns)
   */
  private static handlePermissionError(message: string, context: ErrorContext, errorDetails: Record<string, any>): ErrorHandlingResult {
    const helpMessage = this.getPermissionHelpMessage(context);
    
    const troubleshootingSteps = [
      '🚫 PERMISSION DENIED:',
      `   HTTP Status: ${errorDetails.httpStatusCode} ${errorDetails.httpStatusText || ''}`,
      `   API Endpoint: ${errorDetails.apiEndpoint || 'Unknown'}`,
      `   Operation: ${context.operation}`,
      `   Tool: ${context.tool}`,
      context.scriptId ? `   Script ID: ${context.scriptId}` : '',
      `   Google Error: ${errorDetails.googleErrorCode || 'Unknown'}`,
      '',
      '🔍 COMMON CAUSES:',
      '   • Insufficient OAuth scopes for this operation',
      '   • Google Cloud Project mismatch',
      '   • Script project access restrictions',
      '   • Account permissions limitations',
      '',
      '🛠️ SOLUTIONS:',
      '   1. Verify OAuth scopes include required permissions:',
      this.getRequiredScopes(context.operation),
      '   2. Ensure Google Cloud Project is linked to Apps Script project',
      '   3. Check that you have Editor/Owner permissions on the script',
      '   4. Re-authenticate with updated scopes:',
      `      ${AUTH_MESSAGES.REFRESH_INSTRUCTION}`,
      '   5. Verify the script project is accessible and deployed properly'
    ].filter(step => step !== ''); // Remove empty strings

    const error = new GASApiError(
      `${helpMessage} Context: ${context.operation} in ${context.tool}. HTTP ${errorDetails.httpStatusCode}: ${message}`,
      errorDetails.httpStatusCode,
      { 
        context, 
        troubleshootingSteps,
        httpDetails: errorDetails,
        originalError: errorDetails.originalError
      }
    );

    return {
      error,
      shouldThrow: true,
      helpMessage,
      troubleshootingSteps
    };
  }

  /**
   * Handle 404 not found errors (consolidates not found patterns)
   */
  private static handleNotFoundError(message: string, context: ErrorContext, errorDetails: Record<string, any>): ErrorHandlingResult {
    const helpMessage = this.getNotFoundHelpMessage(context);
    
    const troubleshootingSteps = [
      '📭 RESOURCE NOT FOUND:',
      `   HTTP Status: ${errorDetails.httpStatusCode} ${errorDetails.httpStatusText || ''}`,
      `   API Endpoint: ${errorDetails.apiEndpoint || 'Unknown'}`,
      `   Operation: ${context.operation}`,
      `   Tool: ${context.tool}`,
      context.scriptId ? `   Script ID: ${context.scriptId}` : '',
      context.functionName ? `   Function: ${context.functionName}` : '',
      `   Google Error: ${errorDetails.googleErrorCode || 'Unknown'}`,
      '',
      '🔍 VERIFICATION STEPS:',
      '   1. Verify the script ID is correct and accessible',
      '   2. Check that the resource exists in your Google Apps Script account',
      '   3. Ensure you have the necessary permissions to access the resource',
      '',
      '🛠️ SOLUTIONS:',
      context.operation.includes('function') ? '   • Check that the function name is spelled correctly' : '',
      context.operation.includes('deployment') ? '   • Verify deployment exists and is active' : '',
      context.operation.includes('file') ? '   • Confirm file exists in the script project' : '',
      '   • Use gas_ls() to list available resources',
      '   • Use gas_project_info() to verify script details',
      '   • Create the resource if it doesn\'t exist'
    ].filter(step => step !== '');

    const error = new ValidationError(
      context.scriptId ? 'scriptId' : 'resource',
      context.scriptId || 'unknown',
      `valid ${context.operation.split(' ')[0]} that exists and is accessible`
    );

    // Include full HTTP details in error data
    (error as any).data = {
      ...(error as any).data,
      httpDetails: errorDetails
    };

    return {
      error,
      shouldThrow: true,
      helpMessage,
      troubleshootingSteps
    };
  }

  /**
   * Handle 429 rate limit errors
   */
  private static handleRateLimitError(message: string, context: ErrorContext, errorDetails: Record<string, any>): ErrorHandlingResult {
    const helpMessage = `Rate limit exceeded for ${context.operation}. Please wait before retrying.`;
    
    const troubleshootingSteps = [
      '⏱️ RATE LIMIT EXCEEDED:',
      `   HTTP Status: ${errorDetails.httpStatusCode} ${errorDetails.httpStatusText || ''}`,
      `   API Endpoint: ${errorDetails.apiEndpoint || 'Unknown'}`,
      `   Google Error: ${errorDetails.googleErrorCode || 'Unknown'}`,
      '   Google Apps Script API has rate limits to prevent abuse',
      '',
      '🔍 LIMITS:',
      '   • Script execution: 6 minutes per execution',
      '   • API calls: 100 requests per 100 seconds',
      '   • Projects: 20 script projects per user',
      '',
      '🛠️ SOLUTIONS:',
      '   1. Wait a few minutes before retrying',
      '   2. Reduce the frequency of API calls',
      '   3. Implement exponential backoff in your scripts',
      '   4. Consider batching operations to reduce API calls'
    ];

    const error = new GASApiError(
      `${helpMessage} HTTP ${errorDetails.httpStatusCode}: ${message}`,
      errorDetails.httpStatusCode,
      { 
        retryAfterSeconds: 60, 
        context,
        httpDetails: errorDetails,
        originalError: errorDetails.originalError
      }
    );

    return {
      error,
      shouldThrow: true,
      helpMessage,
      troubleshootingSteps
    };
  }

  /**
   * Handle 500/502/503 server errors
   */
  private static handleServerError(statusCode: number, message: string, context: ErrorContext, errorDetails: Record<string, any>): ErrorHandlingResult {
    const helpMessage = `Google Apps Script API server error (${statusCode}). This is usually temporary.`;
    
    const troubleshootingSteps = [
      `🔧 SERVER ERROR (${statusCode}):`,
      `   HTTP Status: ${errorDetails.httpStatusCode} ${errorDetails.httpStatusText || ''}`,
      `   API Endpoint: ${errorDetails.apiEndpoint || 'Unknown'}`,
      `   Google Error: ${errorDetails.googleErrorCode || 'Unknown'}`,
      '   This is typically a temporary issue with Google\'s servers',
      '',
      '🛠️ SOLUTIONS:',
      '   1. Wait a few minutes and retry the operation',
      '   2. Check Google Apps Script status: https://status.cloud.google.com',
      '   3. If the issue persists, report it to Google Support',
      '   4. Consider implementing retry logic with exponential backoff'
    ];

    const error = new GASApiError(
      `${helpMessage} Operation: ${context.operation}. HTTP ${errorDetails.httpStatusCode}: ${message}`,
      statusCode,
      { 
        temporary: true, 
        context,
        httpDetails: errorDetails,
        originalError: errorDetails.originalError
      }
    );

    return {
      error,
      shouldThrow: true,
      helpMessage,
      troubleshootingSteps
    };
  }

  /**
   * Handle unknown/unexpected errors
   */
  private static handleUnknownError(statusCode: number, message: string, context: ErrorContext, errorDetails: Record<string, any>): ErrorHandlingResult {
    const helpMessage = `Unexpected error during ${context.operation} (status: ${statusCode}).`;
    
    const troubleshootingSteps = [
      `❓ UNEXPECTED ERROR (${statusCode}):`,
      `   HTTP Status: ${errorDetails.httpStatusCode} ${errorDetails.httpStatusText || ''}`,
      `   API Endpoint: ${errorDetails.apiEndpoint || 'Unknown'}`,
      `   Request Method: ${errorDetails.requestMethod || 'Unknown'}`,
      `   Operation: ${context.operation}`,
      `   Tool: ${context.tool}`,
      `   Message: ${message}`,
      `   Google Error: ${errorDetails.googleErrorCode || 'Unknown'}`,
      '',
      '🛠️ GENERAL SOLUTIONS:',
      '   1. Check the original error message for specific details',
      '   2. Verify your internet connection',
      '   3. Ensure the Google Apps Script API is accessible',
      '   4. Try the operation again in a few minutes',
      '   5. Check Google Apps Script service status'
    ];

    const error = new GASApiError(
      `${helpMessage} HTTP ${errorDetails.httpStatusCode}: ${message}`,
      statusCode,
      { 
        context, 
        originalMessage: message,
        httpDetails: errorDetails,
        originalError: errorDetails.originalError
      }
    );

    return {
      error,
      shouldThrow: true,
      helpMessage,
      troubleshootingSteps
    };
  }

  /**
   * Get permission-specific help message based on operation
   */
  private static getPermissionHelpMessage(context: ErrorContext): string {
    const operationMap: Record<string, string> = {
      'deploy': 'Deployment requires script.deployments and script.projects scopes',
      'execute': 'Function execution requires script.scriptapp scope',
      'read': 'File reading requires script.projects scope',
      'write': 'File writing requires script.projects scope',
      'create': 'Project creation requires script.projects scope',
      'delete': 'Resource deletion requires script.projects scope',
      'list': 'Resource listing requires script.projects scope'
    };

    const operation = context.operation.toLowerCase();
    for (const [key, message] of Object.entries(operationMap)) {
      if (operation.includes(key)) {
        return message;
      }
    }

    return `Permission denied for ${context.operation}. Check OAuth scopes and project access.`;
  }

  /**
   * Get not found help message based on operation
   */
  private static getNotFoundHelpMessage(context: ErrorContext): string {
    if (context.scriptId) {
      return `Script project not found: ${context.scriptId}. Verify the ID is correct and accessible.`;
    }
    
    if (context.functionName) {
      return `Function not found: ${context.functionName}. Check the function name and deployment status.`;
    }

    return `Resource not found for ${context.operation}. Verify the resource exists and is accessible.`;
  }

  /**
   * Get required OAuth scopes for specific operations
   */
  private static getRequiredScopes(operation: string): string {
    const scopeMap: Record<string, string[]> = {
      deploy: ['script.deployments', 'script.projects'],
      execute: ['script.scriptapp'],
      file: ['script.projects'],
      project: ['script.projects'],
      drive: ['drive'],
      sheets: ['spreadsheets']
    };

    const operationLower = operation.toLowerCase();
    for (const [key, scopes] of Object.entries(scopeMap)) {
      if (operationLower.includes(key)) {
        return `      • https://www.googleapis.com/auth/${scopes.join('\n      • https://www.googleapis.com/auth/')}`;
      }
    }

    return '      • https://www.googleapis.com/auth/script.projects (minimum)';
  }

  /**
   * Utility method to create error context
   * Helps tools create consistent context objects
   */
  static createContext(
    operation: string,
    tool: string,
    options: {
      scriptId?: string;
      functionName?: string;
      additionalInfo?: Record<string, any>;
    } = {}
  ): ErrorContext {
    return {
      operation,
      tool,
      ...options
    };
  }

  /**
   * Quick error handler for common validation errors
   * Provides consistent validation error handling
   */
  static handleValidationError(
    field: string,
    value: any,
    expected: string,
    context: ErrorContext
  ): never {
    const error = new ValidationError(field, value, expected);
    (error as any).context = context;
    throw error;
  }

  /**
   * Quick error handler for authentication failures
   * Provides consistent auth error handling
   */
  static handleAuthError(
    message: string,
    context: ErrorContext,
    authUrl?: string
  ): never {
    const error = new AuthenticationError(
      `${message} Context: ${context.operation} in ${context.tool}`,
      authUrl
    );
    throw error;
  }

  /**
   * Extract meaningful error message from various error types
   * Provides consistent error message extraction across tools
   */
  static extractErrorMessage(error: any): string {
    if (error instanceof Error) {
      return error.message;
    }
    
    if (typeof error === 'string') {
      return error;
    }
    
    if (error?.message) {
      return error.message;
    }
    
    if (error?.error) {
      return typeof error.error === 'string' ? error.error : error.error.message || 'Unknown error';
    }
    
    return 'Unknown error occurred';
  }
} 