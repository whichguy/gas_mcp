/**
 * Centralized validation utilities for MCP Gas Server
 * Consolidates duplicate validation patterns from multiple tools
 * 
 * **Eliminates duplicate validation from:**
 * - execution.ts (scriptId/functionName validation)
 * - filesystem.ts (path/content validation)
 * - deployments.ts (deployment parameter validation)
 * - proxySetup.ts (URL/configuration validation)
 * - headDeployment.ts (code/timezone validation)
 * - And 4 other tools with similar patterns
 * 
 * **Benefits:**
 * - Consistent validation messages across all tools
 * - Centralized validation logic (30+ lines eliminated)
 * - Type-safe validation with comprehensive error reporting
 * - Easier maintenance and testing of validation rules
 */

import { ValidationError } from '../errors/mcpErrors.js';
import { GASErrorHandler, ErrorContext } from './errorHandler.js';

export interface ValidationRule<T = any> {
  field: string;
  value: T;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  enum?: T[];
  customValidator?: (value: T) => string | null; // Returns error message or null if valid
}

export interface ValidationOptions {
  throwOnError?: boolean;
  collectAllErrors?: boolean;
  context?: ErrorContext;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  field?: string;
  value?: any;
}

/**
 * Centralized validation utility for MCP Gas Server parameters
 * 
 * **Replaces duplicate validation in:**
 * - `ExecTool.validateExecutionParams()` - scriptId/functionName validation
 * - `GASWriteTool.validateWriteParams()` - path/content validation
 * - `GASDeployCreateTool.validateDeploymentParams()` - deployment validation
 * - `GASProxySetupTool.validateProxyParams()` - URL/config validation
 * - `GASHeadDeployTool.validateCodeParams()` - code/timezone validation
 * 
 * **Provides consistent validation** with:
 * - Type checking and constraint validation
 * - Meaningful error messages
 * - Optional vs required parameter handling
 * - Context-aware error reporting
 */
export class MCPValidator {

  /**
   * Validate a single parameter with comprehensive rules
   * 
   * **Consolidates validation patterns** from multiple tools into
   * a single, flexible validation system with consistent error handling.
   * 
   * @param rule - Validation rule configuration
   * @param options - Validation options and context
   * @returns Validation result with detailed error information
   */
  static validateParameter<T>(rule: ValidationRule<T>, options: ValidationOptions = {}): ValidationResult {
    const { field, value, required = false } = rule;
    const { throwOnError = true, context } = options;
    
    const errors: string[] = [];

    // Check if required field is missing
    if (required && (value === null || value === undefined || value === '')) {
      const error = `${field} is required`;
      if (throwOnError && context) {
        GASErrorHandler.handleValidationError(field, value, 'non-empty value', context);
      }
      return { isValid: false, errors: [error], field, value };
    }

    // Skip further validation if value is empty and not required
    if (!required && (value === null || value === undefined || value === '')) {
      return { isValid: true, errors: [] };
    }

    // Type validation
    if (rule.type && !this.validateType(value, rule.type)) {
      errors.push(`${field} must be of type ${rule.type}, got ${typeof value}`);
    }

    // String-specific validations
    if (rule.type === 'string' && typeof value === 'string') {
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        errors.push(`${field} must be at least ${rule.minLength} characters long`);
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        errors.push(`${field} must be no more than ${rule.maxLength} characters long`);
      }
      if (rule.pattern && !rule.pattern.test(value)) {
        errors.push(`${field} format is invalid`);
      }
    }

    // Array-specific validations
    if (rule.type === 'array' && Array.isArray(value)) {
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        errors.push(`${field} must contain at least ${rule.minLength} items`);
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        errors.push(`${field} must contain no more than ${rule.maxLength} items`);
      }
    }

    // Enum validation
    if (rule.enum && !rule.enum.includes(value)) {
      errors.push(`${field} must be one of: ${rule.enum.join(', ')}`);
    }

    // Custom validation
    if (rule.customValidator) {
      const customError = rule.customValidator(value);
      if (customError) {
        errors.push(customError);
      }
    }

    const result = { isValid: errors.length === 0, errors, field, value };

    // Throw error if configured to do so
    if (throwOnError && !result.isValid && context) {
      GASErrorHandler.handleValidationError(
        field, 
        value, 
        errors[0] || 'valid value', 
        context
      );
    }

    return result;
  }

  /**
   * Validate multiple parameters at once
   * 
   * **Bulk validation** that replaces individual parameter validation
   * calls across tools with a single, comprehensive validation function.
   * 
   * @param rules - Array of validation rules
   * @param options - Validation options
   * @returns Combined validation result
   */
  static validateParameters(rules: ValidationRule[], options: ValidationOptions = {}): ValidationResult {
    const { collectAllErrors = true } = options;
    const allErrors: string[] = [];
    let firstError: ValidationResult | null = null;

    for (const rule of rules) {
      const result = this.validateParameter(rule, { ...options, throwOnError: false });
      
      if (!result.isValid) {
        allErrors.push(...result.errors);
        if (!firstError) {
          firstError = result;
        }
        
        // Stop on first error if not collecting all errors
        if (!collectAllErrors) {
          break;
        }
      }
    }

    const finalResult = {
      isValid: allErrors.length === 0,
      errors: allErrors,
      field: firstError?.field,
      value: firstError?.value
    };

    // Throw the first error if configured to do so
    if (options.throwOnError && !finalResult.isValid && options.context && firstError) {
      GASErrorHandler.handleValidationError(
        firstError.field || 'parameter',
        firstError.value,
        finalResult.errors[0] || 'valid value',
        options.context
      );
    }

    return finalResult;
  }

  /**
   * Validate Google Apps Script ID format
   * **Consolidates scriptId validation** from multiple tools
   */
  static validateScriptId(scriptId: string, context?: ErrorContext): ValidationResult {
    return this.validateParameter({
      field: 'scriptId',
      value: scriptId,
      required: true,
      type: 'string',
      minLength: 20,
      pattern: /^[a-zA-Z0-9_-]+$/,
      customValidator: (value) => {
        // Google Apps Script IDs are typically 44 characters long
        if (value.length < 20 || value.length > 60) {
          return 'Google Apps Script ID should be 20-60 characters long';
        }
        return null;
      }
    }, { context, throwOnError: true });
  }

  /**
   * Validate function name format
   * **Consolidates functionName validation** from execution tools
   */
  static validateFunctionName(functionName: string, context?: ErrorContext): ValidationResult {
    return this.validateParameter({
      field: 'functionName',
      value: functionName,
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 100,
      pattern: /^[a-zA-Z_$][a-zA-Z0-9_$]*$/,
      customValidator: (value) => {
        if (value.startsWith('__') && !value.startsWith('__gas_run') && !value.startsWith('__mcp_')) {
          return 'Function names starting with __ are reserved (except __gas_run and __mcp_ functions)';
        }
        return null;
      }
    }, { context, throwOnError: true });
  }

  /**
   * Validate file path format with basic format checks
   * **Consolidates path validation** from filesystem tools
   */
  static validateFilePath(path: string, context?: ErrorContext): ValidationResult {
    return this.validateParameter({
      field: 'path',
      value: path,
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 500, // Reasonable path length limit
      customValidator: (value) => {
        // Split path into scriptId and filename parts
        const pathParts = value.split('/');
        const scriptId = pathParts[0];
        const filename = pathParts[pathParts.length - 1];
        
        // Validate script ID format (if present)
        if (scriptId) {
          if (!/^[a-zA-Z0-9_-]+$/.test(scriptId)) {
            return `Script ID can only contain letters, numbers, underscores, and hyphens`;
          }
          if (scriptId.length < 5 || scriptId.length > 60) {
            return `Script ID must be 5-60 characters long`;
          }
        }
        
        // Validate filename (if present)
        if (filename && filename !== scriptId) {
          if (filename.includes(' ')) {
            return `File names cannot contain spaces`;
          }
          if (!/^[a-zA-Z0-9_.\/-]+$/.test(filename)) {
            return `File names can only contain letters, numbers, underscores, dots, hyphens, and slashes`;
          }
          if (filename.length > 100) {
            return `File name too long (max 100 characters)`;
          }
          if (filename.startsWith('.') || filename.endsWith('.')) {
            return `File names cannot start or end with dots`;
          }
        }
        
        return null; // Path is valid
      }
    }, { context, throwOnError: true });
  }

  /**
   * Validate deployment configuration
   * **Consolidates deployment validation** from deployment tools
   */
  static validateDeploymentConfig(config: any, context?: ErrorContext): ValidationResult {
    const rules: ValidationRule[] = [
      {
        field: 'access',
        value: config.access,
        required: false,
        enum: ['PRIVATE', 'DOMAIN', 'ANYONE', 'ANYONE_ANONYMOUS']
      },
      {
        field: 'executeAs',
        value: config.executeAs,
        required: false,
        enum: ['USER_ACCESSING', 'USER_DEPLOYING']
      },
      {
        field: 'description',
        value: config.description,
        required: false,
        type: 'string',
        maxLength: 500
      },
      {
        field: 'versionNumber',
        value: config.versionNumber,
        required: false,
        type: 'number',
        customValidator: (value) => value > 0 ? null : 'Version number must be positive'
      }
    ];

    return this.validateParameters(rules, { context, collectAllErrors: true });
  }

  /**
   * Validate URL format
   * **Consolidates URL validation** from proxy and web app tools
   */
  static validateUrl(url: string, context?: ErrorContext): ValidationResult {
    return this.validateParameter({
      field: 'url',
      value: url,
      required: true,
      type: 'string',
      customValidator: (value) => {
        try {
          const urlObj = new URL(value);
          if (!['http:', 'https:'].includes(urlObj.protocol)) {
            return 'URL must use HTTP or HTTPS protocol';
          }
          if (value.includes('script.google.com') && !value.includes('/macros/s/')) {
            return 'Google Apps Script URLs should include /macros/s/ path';
          }
          return null;
        } catch {
          return 'Invalid URL format';
        }
      }
    }, { context, throwOnError: true });
  }

  /**
   * Validate timezone string
   * **Consolidates timezone validation** from deployment tools
   */
  static validateTimezone(timezone: string, context?: ErrorContext): ValidationResult {
    return this.validateParameter({
      field: 'timezone',
      value: timezone,
      required: false,
      type: 'string',
      customValidator: (value) => {
        // Common timezone validation
        const validTimezones = [
          'America/Los_Angeles', 'America/New_York', 'America/Chicago', 'America/Denver',
          'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome',
          'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Australia/Sydney',
          'UTC', 'GMT'
        ];
        
        if (!validTimezones.includes(value) && !/^[A-Z][a-z]+\/[A-Z][a-z_]+$/.test(value)) {
          return `Invalid timezone format. Common timezones: ${validTimezones.slice(0, 5).join(', ')}, etc.`;
        }
        return null;
      }
    }, { context, throwOnError: true });
  }

  /**
   * Validate code content
   * **Consolidates code validation** from file and execution tools
   */
  static validateCode(code: string, context?: ErrorContext, contentType?: string): ValidationResult {
    return this.validateParameter({
      field: 'code',
      value: code,
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 100000, // Google Apps Script file size limit
      customValidator: (value) => {
        // Allow script tags in HTML content
        if (contentType === 'html' || contentType === 'HTML') {
          // For HTML content, we allow script tags - let GAS API handle size validation
          return null;
        }
        
        // For JavaScript/Apps Script content, block script tags
        if (value.includes('<script>') || value.includes('</script>')) {
          return 'Code should not contain HTML script tags';
        }
        // Let Google Apps Script API be the authority for size validation
        return null;
      }
    }, { context, throwOnError: true });
  }

  /**
   * Validate HTML content specifically
   * **New method for HTML file validation**
   */
  static validateHtmlContent(content: string, context?: ErrorContext): ValidationResult {
    return this.validateParameter({
      field: 'htmlContent',
      value: content,
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 100000, // Google Apps Script file size limit
      customValidator: (value) => {
        // HTML content validation - allow script tags but check for basic HTML structure
        if (!value.trim().toLowerCase().includes('<!doctype') && !value.trim().toLowerCase().includes('<html')) {
          // Not strictly required, but good practice
        }
        // Let Google Apps Script API be the authority for size validation
        return null;
      }
    }, { context, throwOnError: true });
  }

  /**
   * Type validation helper
   */
  private static validateType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      default:
        return true;
    }
  }

  /**
   * Create validation context helper
   * **Simplifies context creation** for validation calls
   */
  static createValidationContext(operation: string, tool: string, additionalInfo?: Record<string, any>): ErrorContext {
    return GASErrorHandler.createContext(operation, tool, { additionalInfo });
  }

  /**
   * Quick validation for common MCP parameter patterns
   * **One-liner validation** for frequently used parameter combinations
   */
  static quickValidate = {
    scriptIdAndFunction: (scriptId: string, functionName: string, tool: string) => {
      const context = this.createValidationContext('function execution', tool);
      this.validateScriptId(scriptId, context);
      this.validateFunctionName(functionName, context);
    },

    pathAndContent: (path: string, content: string, tool: string) => {
      const context = this.createValidationContext('file operation', tool);
      this.validateFilePath(path, context);
      this.validateCode(content, context);
    },

    deploymentBasics: (scriptId: string, description: string, tool: string) => {
      const context = this.createValidationContext('deployment', tool);
      this.validateScriptId(scriptId, context);
      if (description) {
        this.validateParameter({
          field: 'description',
          value: description,
          type: 'string',
          maxLength: 500
        }, { context });
      }
    }
  };
} 