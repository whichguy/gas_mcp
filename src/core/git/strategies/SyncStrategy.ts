/**
 * SyncStrategy - Interface for git sync strategies
 *
 * Defines the contract for different sync modes:
 * - Simple: Local commit + push (no pull before operation)
 * - LocalOnly: No remote sync at all
 *
 * Each strategy implements the pre/post operation sync behavior.
 */

/**
 * Sync strategy interface
 */
export interface SyncStrategy {
  /**
   * Pull from remote before operation (if needed)
   *
   * @param scriptId - GAS project ID
   * @param localPath - Local git repository path
   * @param projectPath - Optional nested project path
   * @param accessToken - Optional access token
   */
  pullFromRemote(
    scriptId: string,
    localPath: string,
    projectPath?: string,
    accessToken?: string
  ): Promise<void>;

  /**
   * Push to remote after operation (if needed)
   *
   * @param scriptId - GAS project ID
   * @param localPath - Local git repository path
   * @param files - List of files to sync
   * @param projectPath - Optional nested project path
   * @param accessToken - Optional access token
   */
  pushToRemote(
    scriptId: string,
    localPath: string,
    files: string[],
    projectPath?: string,
    accessToken?: string
  ): Promise<void>;

  /**
   * Get strategy name for logging
   */
  getName(): string;
}
