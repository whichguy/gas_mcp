/**
 * @fileoverview MCP Gas Error Classes with LLM-friendly hints
 *
 * HIERARCHY: MCPGasError → ValidationError | AuthenticationError | FileOperationError | ConflictError | SyncDriftError
 * CODES: -32000 (auth) | -32001 (validation/quota) | -32002 (API) | -32004 (file) | -32005 (lock) | -32006 (sync) | 409 (conflict)
 * LLM HINTS: error.data.hints contains actionable recovery steps (primary, override, merge, testing)
 */
import { AUTH_MESSAGES, getOAuthInstructions } from '../constants/authMessages.js';

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

/**
 * Lock timeout error - thrown when unable to acquire write lock within timeout period
 */
export class LockTimeoutError extends MCPGasError {
  constructor(
    scriptId: string,
    timeout: number,
    operation: string,
    currentLockHolder?: { pid: number; hostname: string; operation: string }
  ) {
    const holderInfo = currentLockHolder
      ? `Currently held by PID ${currentLockHolder.pid} on ${currentLockHolder.hostname} (${currentLockHolder.operation}).`
      : '';

    const message = `Lock timeout after ${timeout}ms waiting for write access to project ${scriptId}. ` +
      `${holderInfo} Another operation may be in progress. Retry or check for stuck processes.`;

    super(message, -32005, {
      scriptId,
      timeout,
      operation,
      lockHolder: currentLockHolder
    });
  }
}

/**
 * Conflict details for ConflictError
 */
export interface ConflictDetails {
  scriptId: string;
  filename: string;
  operation: 'write' | 'edit' | 'aider' | 'cp' | 'sed';
  expectedHash: string;
  currentHash: string;
  hashSource: 'param' | 'xattr' | 'computed';
  changeDetails?: {
    sizeChange: string;
    timeElapsed?: string;
  };
  diff?: {
    format: 'unified' | 'info';  // 'unified' for actual diff, 'info' for hash mismatch without content comparison
    content: string;
    linesAdded?: number;   // Optional for 'info' format
    linesRemoved?: number; // Optional for 'info' format
    truncated: boolean;
    truncatedMessage?: string;
  };
}

/**
 * Conflict hints for LLM guidance
 */
export interface ConflictHints {
  primary: {
    action: 'refetch';
    description: string;
    command: string;
    llmGuidance: string;
  };
  force: {
    action: 'force_overwrite';
    description: string;
    command: string;
    warning: string;
    llmGuidance: string;
    confirmationPrompt: string;
  };
  merge: {
    action: 'manual_merge';
    description: string;
    steps: string[];
    llmGuidance: string;
  };
}

/**
 * Conflict error - thrown when file was modified externally since last read
 *
 * Used for hash-based conflict detection in parallel sessions.
 * Provides actionable hints with auto-generated unified diff.
 */
export class ConflictError extends MCPGasError {
  public conflict: ConflictDetails;
  public hints: ConflictHints;

  constructor(conflict: ConflictDetails) {
    const message = `File '${conflict.filename}' was modified externally since your last read`;

    // Generate actionable hints
    const hints: ConflictHints = {
      primary: {
        action: 'refetch',
        description: 'Get the latest version and re-apply your changes',
        command: `cat({scriptId: "${conflict.scriptId}", path: "${conflict.filename}"})`,
        llmGuidance: 'RECOMMENDED: Fetch current content, then re-apply your intended changes to the new baseline'
      },
      force: {
        action: 'force_overwrite',
        description: 'Discard external changes and apply your version',
        command: `${conflict.operation}({scriptId: "${conflict.scriptId}", path: "${conflict.filename}", ..., force: true})`,
        warning: conflict.diff
          ? `DESTRUCTIVE: This will discard ${conflict.diff.linesAdded} added lines, restore ${conflict.diff.linesRemoved} removed lines`
          : 'DESTRUCTIVE: This will overwrite external changes',
        llmGuidance: 'USE ONLY IF: User explicitly confirms they want to overwrite external changes. Show the diff above and ask for confirmation first.',
        confirmationPrompt: 'External changes will be lost. The diff above shows what will be discarded. Proceed with force: true?'
      },
      merge: {
        action: 'manual_merge',
        description: 'Manually combine both sets of changes',
        steps: [
          '1. Review the diff above to understand external changes',
          '2. cat() to get full current content if needed',
          '3. Merge your changes with the external changes',
          '4. write() with force: true (after merging)'
        ],
        llmGuidance: 'BEST FOR COMPLEX CONFLICTS: When both your changes and external changes are valuable. Help the user merge by showing both versions side-by-side.'
      }
    };

    super(message, 409, {
      conflict,
      hints
    });

    this.conflict = conflict;
    this.hints = hints;
  }
}

/**
 * Drift file info for SyncDriftError
 */
export interface DriftFileInfo {
  filename: string;
  localHash?: string;
  remoteHash: string;
  sizeDiff?: string;
  /** Unified diff showing changes (truncated if large) */
  diff?: string;
  /** Preview of remote content (for new files) */
  remotePreview?: string;
}

/**
 * Sync drift details
 */
export interface SyncDriftDetails {
  staleLocal: DriftFileInfo[];
  missingLocal: DriftFileInfo[];
}

/**
 * Sync drift hints for LLM guidance
 */
export interface SyncDriftHints {
  primary: {
    action: 'rsync';
    command: string;
    description: string;
    llmGuidance: string;
  };
  override: {
    action: 'skip_sync_check';
    command: string;
    warning: string;
    llmGuidance: string;
  };
  /** Testing-specific hint - use skipSyncCheck for rapid iteration */
  testing: {
    action: 'skip_for_testing';
    command: string;
    description: string;
    llmGuidance: string;
  };
}

/**
 * Sync drift error - thrown when local state has diverged from remote before exec
 *
 * Used for pre-flight sync check in exec operations.
 * Prevents executing stale code by detecting drift between local and remote.
 */
export class SyncDriftError extends MCPGasError {
  public drift: SyncDriftDetails;
  public hints: SyncDriftHints;

  constructor(scriptId: string, drift: SyncDriftDetails) {
    const staleCount = drift.staleLocal.length;
    const missingCount = drift.missingLocal.length;

    // Build descriptive message with file list
    const fileDetails: string[] = [];
    if (staleCount > 0) {
      const staleFiles = drift.staleLocal.map(f => f.filename).slice(0, 10);
      fileDetails.push(`${staleCount} stale: ${staleFiles.join(', ')}${staleCount > 10 ? '...' : ''}`);
    }
    if (missingCount > 0) {
      const missingFiles = drift.missingLocal.map(f => f.filename).slice(0, 10);
      fileDetails.push(`${missingCount} missing locally: ${missingFiles.join(', ')}${missingCount > 10 ? '...' : ''}`);
    }

    const message = `Local state has diverged from remote: ${fileDetails.join('; ')}`;

    const hints: SyncDriftHints = {
      primary: {
        action: 'rsync',
        command: `rsync({operation: "plan", scriptId: "${scriptId}", direction: "pull"})`,
        description: 'Sync local files with remote to get latest changes',
        llmGuidance: 'RECOMMENDED: Pull remote changes first, then re-apply local modifications if needed. Review the diff below to understand what changed.'
      },
      override: {
        action: 'skip_sync_check',
        command: `exec({scriptId: "${scriptId}", js_statement: "...", skipSyncCheck: true})`,
        warning: 'WARNING: Executing stale code may produce unexpected results',
        llmGuidance: 'USE ONLY IF: You understand the drift and intentionally want to run the stale local version (e.g., debugging a specific version).'
      },
      testing: {
        action: 'skip_for_testing',
        command: `exec({scriptId: "${scriptId}", js_statement: "...", skipSyncCheck: true})`,
        description: 'Skip sync check for rapid testing iteration',
        llmGuidance: 'FOR TESTING: When actively developing and testing code, skipSyncCheck allows rapid iteration without constant rsync. The remote GAS code is what actually executes - local drift only matters if you need local git history.'
      }
    };

    super(message, -32006, {
      status: 'sync_required',
      drift,
      hints
    });

    this.drift = drift;
    this.hints = hints;
  }
} 