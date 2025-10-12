/**
 * Standardized Test Timeout Constants
 *
 * Provides consistent timeout values across all MCP Gas integration tests.
 * Timeouts are calibrated based on operation type and expected duration.
 */

export const TEST_TIMEOUTS = {
  /**
   * QUICK (15 seconds)
   * Use for: Auth status checks, simple API queries
   * Examples: auth status, isAuthenticated()
   */
  QUICK: 15000,

  /**
   * STANDARD (30 seconds)
   * Use for: File operations, ls, grep, info, find
   * Examples: write, cat, ls, rm, grep
   */
  STANDARD: 30000,

  /**
   * EXECUTION (60 seconds)
   * Use for: Code execution, module loading, require()
   * Examples: exec, require("Module"), module dependencies
   */
  EXECUTION: 60000,

  /**
   * BULK (120 seconds)
   * Use for: Batch operations, multiple file creation
   * Examples: Creating 10+ files, bulk copy/move, search on large projects
   */
  BULK: 120000,

  /**
   * EXTENDED (300 seconds / 5 minutes)
   * Use for: Deployment, versioning, full test suites
   * Examples: deploy, complete suite runs
   */
  EXTENDED: 300000
} as const;

/**
 * Helper function to get timeout description for documentation
 */
export function getTimeoutDescription(timeout: number): string {
  switch (timeout) {
    case TEST_TIMEOUTS.QUICK:
      return 'QUICK (15s): Auth checks, simple queries';
    case TEST_TIMEOUTS.STANDARD:
      return 'STANDARD (30s): File operations';
    case TEST_TIMEOUTS.EXECUTION:
      return 'EXECUTION (60s): Code execution';
    case TEST_TIMEOUTS.BULK:
      return 'BULK (120s): Batch operations';
    case TEST_TIMEOUTS.EXTENDED:
      return 'EXTENDED (300s): Deployment, full suites';
    default:
      return `CUSTOM (${timeout}ms)`;
  }
}
