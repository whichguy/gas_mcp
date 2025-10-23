/**
 * FileOperationStrategy - Interface for file operations
 *
 * All file operations (edit, aider, mv, cp, rm, write, etc) implement this
 * interface to work with GitOperationManager.
 *
 * This separates file operation logic from git concerns:
 * - Operation strategy: What to do with the file
 * - GitOperationManager: How to sync with git
 *
 * Benefits:
 * - Reusable git workflow across all tools
 * - Testable operation logic in isolation
 * - Easy to add new operations
 */

/**
 * Type of file operation (for commit message generation)
 */
export type OperationType =
  | 'edit'
  | 'aider'
  | 'write'
  | 'move'
  | 'copy'
  | 'delete'
  | 'sync'
  | 'unknown';

/**
 * Interface for all file operations using two-phase workflow
 * Each tool implements this to define its specific logic
 *
 * TWO-PHASE WORKFLOW:
 * 1. computeChanges() - Read from remote, compute what to change (no side effects)
 * 2. applyChanges() - Write validated changes to remote (side effects)
 *
 * This enables:
 * - Hook validation between phases (local write + git commit + read back)
 * - Proper separation of concerns (compute vs apply)
 * - No duplicate remote writes
 * - Atomic rollback on failure
 *
 * @template T - Operation-specific result type
 */
export interface FileOperationStrategy<T = any> {
  /**
   * PHASE 1: Compute changes without side effects
   *
   * This method should:
   * 1. Read current file content from remote GAS
   * 2. Compute what changes to make (edit/move/copy/delete logic)
   * 3. Return map of filename → new content (NO remote writes)
   *
   * Special semantics:
   * - Empty string content signals file deletion
   * - For move: returns { 'source.gs': '', 'dest.gs': 'content' }
   * - For edit: returns { 'file.gs': 'modified content' }
   *
   * @returns Map of filename to new content
   * @throws Error if unable to read source files or compute changes
   *
   * @example
   * // Edit operation
   * await computeChanges() // Map { 'test.gs' => 'const x = 2;' }
   *
   * // Move operation
   * await computeChanges() // Map { 'old.gs' => '', 'new.gs' => 'content' }
   *
   * // Delete operation
   * await computeChanges() // Map { 'file.gs' => '' }
   */
  computeChanges(): Promise<Map<string, string>>;

  /**
   * PHASE 2: Apply validated changes to remote
   *
   * This method should:
   * 1. Receive hook-validated content (may differ from computeChanges output)
   * 2. Write all files to remote GAS
   * 3. Return operation-specific result
   *
   * Hook-validated content may have been:
   * - Auto-formatted (Prettier, ESLint --fix)
   * - Modified by pre-commit hooks
   * - Validated for correctness
   *
   * @param validatedContent - Hook-validated file contents to write
   * @returns Operation-specific result
   * @throws Error if remote write fails
   *
   * @example
   * // After hooks ran and validated content
   * await applyChanges(validatedMap) // { success: true, ... }
   */
  applyChanges(validatedContent: Map<string, string>): Promise<T>;

  /**
   * Rollback the operation (for atomic failure handling)
   *
   * This method should:
   * 1. Revert the file operation
   * 2. Restore original state in remote GAS
   * 3. Clean up any temporary state
   *
   * Called by GitOperationManager if:
   * - applyChanges() fails
   * - Git commit fails (after local validation)
   * - Remote sync fails
   *
   * Note: computeChanges() doesn't need rollback (no side effects)
   */
  rollback(): Promise<void>;

  /**
   * Get list of files affected by this operation
   *
   * Used for:
   * - Git commit (which files to add)
   * - Commit message generation
   * - Remote sync (which files to push)
   *
   * @returns Array of file names (relative paths)
   *
   * @example
   * // Edit operation
   * getAffectedFiles() // ['test.gs']
   *
   * // Move operation
   * getAffectedFiles() // ['old.gs', 'new.gs']
   */
  getAffectedFiles(): string[];

  /**
   * Get operation type (for commit message generation)
   *
   * Used by GitOperationManager to generate smart commit messages
   * when changeReason is not provided.
   *
   * @returns Operation type
   *
   * @example
   * getType() // 'edit'
   */
  getType(): OperationType;

  /**
   * Get operation description (optional, for logging)
   *
   * @returns Human-readable description
   *
   * @example
   * getDescription() // "Edit test.gs: 3 edits applied"
   */
  getDescription?(): string;
}
