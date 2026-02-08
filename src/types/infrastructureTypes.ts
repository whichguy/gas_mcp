/**
 * @fileoverview Infrastructure verification types for exec sync detection
 *
 * USAGE: Return InfrastructureStatus in exec responses to inform LLM about
 * infrastructure file sync state. Allows LLM to make informed decisions about
 * updating out-of-sync infrastructure.
 *
 * KEY DESIGN: Uses Git SHA-1 hashes for comparison with MCP server templates
 */

/**
 * Infrastructure verification status for a single file
 */
export interface InfrastructureVerification {
  /** Overall verification status */
  verified: boolean;

  /** File that was verified */
  file: string;

  /** Expected SHA from MCP server template */
  expectedSHA?: string;

  /** Actual SHA from deployed GAS file */
  actualSHA?: string;

  /** Error message if verification failed */
  error?: string;

  /** Whether file was created (new) or already existed */
  wasCreated?: boolean;
}

/**
 * Infrastructure status included in exec response
 */
export interface InfrastructureStatus {
  /** Primary execution infrastructure verified */
  execShim: InfrastructureVerification;

  /** Overall sync status */
  inSync: boolean;

  /** Human-readable summary */
  summary: string;
}

/**
 * Build InfrastructureStatus from verification result
 *
 * @param verification - Result from verifyInfrastructureFile()
 * @param wasCreated - Whether the file was just created
 * @returns Structured InfrastructureStatus for response
 */
export function buildInfrastructureStatus(
  verification: { verified: boolean; expectedSHA?: string; actualSHA?: string; error?: string },
  wasCreated: boolean = false
): InfrastructureStatus {
  const execShim: InfrastructureVerification = {
    verified: verification.verified,
    file: 'common-js/__mcp_exec',
    expectedSHA: verification.expectedSHA,
    actualSHA: verification.actualSHA,
    error: verification.error,
    wasCreated
  };

  const summary = verification.verified
    ? `Infrastructure verified${verification.actualSHA ? ` (SHA: ${verification.actualSHA.slice(0, 12)}...)` : ''}`
    : verification.error
      ? `Infrastructure verification failed: ${verification.error}`
      : `Infrastructure mismatch: expected ${verification.expectedSHA?.slice(0, 8) || 'unknown'}..., got ${verification.actualSHA?.slice(0, 8) || 'unknown'}...`;

  return {
    execShim,
    inSync: verification.verified,
    summary
  };
}

/**
 * Empty infrastructure status (verification skipped)
 */
export const NO_INFRASTRUCTURE_STATUS: InfrastructureStatus = {
  execShim: {
    verified: true,
    file: 'common-js/__mcp_exec'
  },
  inSync: true,
  summary: 'Infrastructure verification skipped'
};
