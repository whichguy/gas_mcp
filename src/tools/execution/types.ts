/**
 * Shared Types for Execution Tools
 *
 * Common type definitions used across execution, auth, and infrastructure modules.
 */

/**
 * Entry point types for Google Apps Script deployments
 */
export type EntryPointType = 'WEB_APP' | 'EXECUTION_API';

/**
 * Access levels for deployments
 */
export type AccessLevel = 'MYSELF' | 'DOMAIN' | 'ANYONE' | 'ANYONE_ANONYMOUS';

/**
 * Execution result from Google Apps Script
 */
export interface ExecutionResult {
  status: 'success' | 'error';
  result?: any;
  logger_output?: string;
  error?: string;
  executedAt?: string;
  cookieAuthUsed?: boolean;
  ide_url_hint?: string;
}

/**
 * Deployment information
 */
export interface DeploymentInfo {
  deploymentId: string;
  url?: string;
  versionNumber?: number;
}

/**
 * Logger output filtering options
 */
export interface LogFilterOptions {
  filterPattern?: string;
  tailLines?: number;
}
