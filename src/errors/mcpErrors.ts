import { AUTH_MESSAGES, getOAuthInstructions } from '../constants/authMessages.js';

/**
 * Custom error classes for MCP Gas Server
 * Provides structured error information for better error handling
 */

/**
 * Base error class for MCP Gas operations
 */
export class MCPGasError extends Error {
  constructor(
    message: string,
    public code: number,
    public data?: any
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Authentication required error with helpful instructions
 */
export class AuthenticationError extends MCPGasError {
  constructor(message: string, authUrl?: string) {
    super(message, -32000, {
      requiresAuth: true,
      authUrl,
      instructions: AUTH_MESSAGES.BASIC_INSTRUCTION
    });
  }
}

/**
 * Input validation error
 */
export class ValidationError extends MCPGasError {
  constructor(field: string, value: any, expected: string) {
    // Create more user-friendly error message
    const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    const message = `Invalid ${field}: expected ${expected}, got "${displayValue}"`;
    
    super(message, -32001, {
      field,
      value,
      expected
    });
  }
}

/**
 * API quota/rate limit exceeded error
 */
export class QuotaError extends MCPGasError {
  constructor(message: string, retryAfterSeconds?: number) {
    super(message, -32001, {
      retryAfterSeconds,
      rateLimited: true
    });
  }
}

/**
 * Google Apps Script API error wrapper
 */
export class GASApiError extends MCPGasError {
  constructor(message: string, statusCode?: number, originalError?: any) {
    let processedError = originalError;
    
    // Handle different types of original errors
    if (originalError instanceof Error) {
      processedError = originalError.message;
    } else if (typeof originalError === 'object' && originalError !== null) {
      // Keep object errors as-is for test compatibility
      processedError = originalError;
    } else if (typeof originalError === 'string') {
      processedError = originalError;
    }
    
    super(message, -32002, {
      statusCode,
      originalError: processedError
    });
  }
}

/**
 * OAuth-specific errors
 */
export class OAuthError extends MCPGasError {
  constructor(message: string, phase: 'authorization' | 'token_exchange' | 'token_refresh' | 'validation') {
    super(message, -32003, {
      phase,
      instructions: getOAuthInstructions(phase)
    });
  }
}

/**
 * File operation error (read, write, delete, etc.)
 */
export class FileOperationError extends MCPGasError {
  constructor(operation: string, path: string, reason: string) {
    super(`Cannot ${operation} ${path}: ${reason}`, -32004, {
      operation,
      path,
      reason
    });
  }
} 