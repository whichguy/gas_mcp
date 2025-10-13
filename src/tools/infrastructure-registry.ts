/**
 * Infrastructure File Registry
 *
 * Defines all infrastructure files deployed to Google Apps Script projects
 * with their expected SHA-1 checksums for integrity verification.
 *
 * SHA-1 checksums use Git-compatible blob format: sha1("blob " + size + "\0" + content)
 */

import crypto from 'crypto';

/**
 * Represents a deployable infrastructure file with verification support
 */
export interface InfrastructureFile {
  /** File name as it appears in GAS project */
  name: string;

  /** Function to get the template content */
  getTemplate: () => string;

  /** Compute Git-compatible SHA-1 checksum */
  computeSHA: () => string;

  /** Category: universal (always needed) or optional (debugging/development) */
  category: 'universal' | 'optional';

  /** Human-readable description */
  description: string;
}

/**
 * Compute Git-compatible SHA-1 checksum for content
 *
 * Uses the same format as `git hash-object`:
 * sha1("blob " + <size> + "\0" + <content>)
 *
 * @param content - File content to hash
 * @returns SHA-1 checksum as hex string
 */
export function computeGitSHA(content: string): string {
  const size = Buffer.byteLength(content, 'utf8');
  const blob = `blob ${size}\0${content}`;
  return crypto.createHash('sha1').update(blob, 'utf8').digest('hex');
}

/**
 * Get template content for CommonJS module system
 *
 * This is imported from deployments.ts where SHIM_TEMPLATE is defined.
 * We use a lazy getter to avoid circular dependencies.
 */
let _shimTemplate: string | null = null;

function getCommonJSTemplate(): string {
  if (_shimTemplate === null) {
    // Lazy load to avoid circular dependency
    const { SHIM_TEMPLATE } = require('./deployments.js');
    _shimTemplate = SHIM_TEMPLATE;
  }
  return _shimTemplate!;
}

/**
 * Get template content for execution infrastructure
 *
 * This is imported from deployments.ts where getExecutionTemplate is defined.
 */
let _getExecutionTemplate: (() => string) | null = null;

function getExecutionInfraTemplate(): string {
  if (_getExecutionTemplate === null) {
    const { getExecutionTemplate } = require('./deployments.js');
    _getExecutionTemplate = getExecutionTemplate;
  }
  return _getExecutionTemplate!();
}

/**
 * Get template content for success HTML page
 */
let _getSuccessHtmlTemplate: (() => string) | null = null;

function getSuccessHtmlTemplate(): string {
  if (_getSuccessHtmlTemplate === null) {
    const { getSuccessHtmlTemplate } = require('./deployments.js');
    _getSuccessHtmlTemplate = getSuccessHtmlTemplate;
  }
  return _getSuccessHtmlTemplate!();
}

/**
 * Get template content for error HTML page
 */
let _getErrorHtmlTemplate: (() => string) | null = null;

function getErrorHtmlTemplate(): string {
  if (_getErrorHtmlTemplate === null) {
    const { getErrorHtmlTemplate } = require('./deployments.js');
    _getErrorHtmlTemplate = getErrorHtmlTemplate;
  }
  return _getErrorHtmlTemplate!();
}


/**
 * Infrastructure File Registry
 *
 * Maps infrastructure file names to their definitions and verification info.
 * SHA-1 checksums are computed at runtime from template content.
 */
export const INFRASTRUCTURE_REGISTRY: Record<string, InfrastructureFile> = {
  'common-js/require': {
    name: 'common-js/require',
    getTemplate: getCommonJSTemplate,
    computeSHA: () => computeGitSHA(getCommonJSTemplate()),
    category: 'universal',
    description: 'CommonJS module system providing require(), module.exports, and exports'
  },

  'common-js/__mcp_exec': {
    name: 'common-js/__mcp_exec',
    getTemplate: getExecutionInfraTemplate,
    computeSHA: () => computeGitSHA(getExecutionInfraTemplate()),
    category: 'optional',
    description: 'Execution infrastructure for exec tool with dynamic function execution'
  },

  'common-js/__mcp_exec_success': {
    name: 'common-js/__mcp_exec_success',
    getTemplate: getSuccessHtmlTemplate,
    computeSHA: () => computeGitSHA(getSuccessHtmlTemplate()),
    category: 'optional',
    description: 'HTML template for successful exec execution results'
  },

  'common-js/__mcp_exec_error': {
    name: 'common-js/__mcp_exec_error',
    getTemplate: getErrorHtmlTemplate,
    computeSHA: () => computeGitSHA(getErrorHtmlTemplate()),
    category: 'optional',
    description: 'HTML template for exec execution errors with debugging information'
  }
};

/**
 * Verification result from checking infrastructure file integrity
 */
export interface VerificationResult {
  /** Whether file content matches expected SHA-1 */
  verified: boolean;

  /** Expected SHA-1 checksum from template */
  expectedSHA?: string;

  /** Actual SHA-1 checksum from deployed file */
  actualSHA?: string;

  /** Error message if verification failed */
  error?: string;
}

/**
 * Get list of all universal infrastructure files
 * These should always be present in a functioning GAS project
 */
export function getUniversalInfrastructure(): InfrastructureFile[] {
  return Object.values(INFRASTRUCTURE_REGISTRY)
    .filter(file => file.category === 'universal');
}

/**
 * Get list of all optional infrastructure files
 * These are only needed for specific debugging/development scenarios
 */
export function getOptionalInfrastructure(): InfrastructureFile[] {
  return Object.values(INFRASTRUCTURE_REGISTRY)
    .filter(file => file.category === 'optional');
}
