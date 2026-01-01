/**
 * GitFeatureTool - Consolidated feature branch workflow management
 *
 * Provides all feature workflow operations in a single tool:
 * - start: Create new feature branch
 * - finish: Squash merge to main and delete branch
 * - rollback: Delete branch without merging
 * - list: Show all feature branches
 * - switch: Switch between branches
 */

import { BaseFileSystemTool } from '../filesystem/shared/BaseFileSystemTool.js';
import { SCRIPT_ID_SCHEMA } from '../filesystem/shared/schemas.js';
import { ValidationError } from '../../errors/mcpErrors.js';
import { LocalFileManager } from '../../utils/localFileManager.js';
import { getCurrentBranch, isFeatureBranch, hasUncommittedChanges, getAllBranches } from '../../utils/gitAutoCommit.js';
import { log } from '../../utils/logger.js';
import { ensureGitInitialized } from '../../utils/gitInit.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';

const execAsync = promisify(exec);

/**
 * GitFeatureTool - Manage feature branch workflow for git-enabled projects
 */
export class GitFeatureTool extends BaseFileSystemTool {
  public name = 'git_feature';
  public description = 'Manage feature branch workflow for git-enabled projects. Operations: start (create branch), finish (squash merge), rollback (delete branch), list (show branches), switch (change branch), commit (commit changes), push (push to remote).';

  public inputSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['start', 'finish', 'rollback', 'list', 'switch', 'commit', 'push'],
        description: 'Feature branch operation to perform',
        examples: ['start', 'finish', 'rollback', 'list', 'switch', 'commit', 'push']
      },
      scriptId: {
        ...SCRIPT_ID_SCHEMA
      },
      projectPath: {
        type: 'string',
        default: '',
        description: 'Optional path to nested git project within GAS (for polyrepo support)',
        examples: ['', 'backend', 'frontend', 'libs/shared', 'api/v2']
      },
      featureName: {
        type: 'string',
        description: 'Feature name (required for start operation). Alphanumeric and hyphens only.',
        pattern: '^[a-zA-Z0-9-]+$',
        examples: ['user-auth', 'pdf-export', 'api-refactor', 'bug-fix-123']
      },
      branch: {
        type: 'string',
        description: 'Branch name (optional for finish/switch - auto-detects current if omitted, required for rollback)',
        examples: ['llm-feature-user-auth', 'llm-feature-auto-20250121143022']
      },
      deleteAfterMerge: {
        type: 'boolean',
        default: true,
        description: 'Delete branch after merge (finish operation only). Default: true'
      },
      message: {
        type: 'string',
        description: 'Commit message (required for commit operation)',
        examples: ['feat: Add user authentication', 'fix: Resolve validation bug', 'refactor: Improve error handling']
      },
      remote: {
        type: 'string',
        default: 'origin',
        description: 'Remote name for push operation. Default: origin',
        examples: ['origin', 'upstream', 'github']
      },
      pushToRemote: {
        type: 'boolean',
        default: false,
        description: 'Push to remote after merge (finish operation only). Default: false'
      }
    },
    required: ['operation', 'scriptId'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Manual feature branch management. Use git_feature for explicit branch control. Auto-commit (via write) creates llm-feature-auto-{timestamp} branches automatically.',
      operations: {
        start: 'Create new feature branch for development. Use when: starting new feature, need explicit branch name, want to separate work from main.',
        finish: 'Complete feature and merge to main. Use when: feature complete, want squash commit, ready to clean up branch.',
        rollback: 'Abandon feature without merging. Use when: feature cancelled, wrong approach, want to start over.',
        list: 'View all active feature branches. Use when: checking current branches, deciding which to work on, reviewing open work.',
        switch: 'Change to different branch. Use when: switching between features, returning to previous work, reviewing other branches.',
        commit: 'Commit all changes with custom message. Use when: need manual commit after multiple edits, want specific commit message.',
        push: 'Push current branch to remote. Use when: sharing work, backing up to GitHub, preparing for PR.'
      },
      examples: [
        'git_feature({operation: "start", scriptId, featureName: "user-auth"}) - Create llm-feature-user-auth',
        'git_feature({operation: "commit", scriptId, message: "feat: Add authentication"}) - Commit all changes',
        'git_feature({operation: "push", scriptId}) - Push current branch to origin',
        'git_feature({operation: "finish", scriptId, pushToRemote: true}) - Merge to main and push',
        'git_feature({operation: "rollback", scriptId, branch: "llm-feature-user-auth"}) - Delete branch without merging',
        'git_feature({operation: "list", scriptId}) - Show all feature branches',
        'git_feature({operation: "switch", scriptId, branch: "llm-feature-api-refactor"}) - Switch to feature branch'
      ],
      workflow: 'Typical: 1) git_feature start → 2) write files (auto-commits) → 3) git_feature commit (optional) → 4) git_feature push → 5) git_feature finish (squash merge + optional push)',
      vsAutoCommit: 'Auto-commit (write): creates llm-feature-auto-{timestamp} automatically | git_feature: explicit branch names for meaningful features',
      polyrepo: 'Use projectPath for nested git repos: git_feature({operation: "start", scriptId, featureName: "auth", projectPath: "backend"})'
    }
  };

  async execute(params: any): Promise<any> {
    const operation = params.operation;
    const scriptId = this.validate.scriptId(params.scriptId, 'git feature operation');
    const projectPath = params.projectPath || '';

    // Validate operation-specific parameters
    this.validateOperationParams(params);

    // Resolve git repository path
    const projectRoot = await LocalFileManager.getProjectDirectory(scriptId);
    const gitRoot = projectPath ? join(projectRoot, projectPath) : projectRoot;

    // Ensure git repository is initialized (auto-init if missing)
    const gitResult = await ensureGitInitialized(gitRoot);

    if (gitResult.isNew) {
      log.info(`[GIT_FEATURE] Auto-initialized git repository (config: ${gitResult.configSource})`);
    }

    log.info(`[GIT_FEATURE] Operation: ${operation}, Git root: ${gitRoot}`);

    // Route to operation handler
    switch (operation) {
      case 'start':
        return this.executeStart(gitRoot, params.featureName);
      case 'finish':
        return this.executeFinish(gitRoot, params.branch, params.deleteAfterMerge ?? true, params.pushToRemote ?? false, params.remote);
      case 'rollback':
        return this.executeRollback(gitRoot, params.branch);
      case 'list':
        return this.executeList(gitRoot);
      case 'switch':
        return this.executeSwitch(gitRoot, params.branch);
      case 'commit':
        return this.executeCommit(gitRoot, params.message);
      case 'push':
        return this.executePush(gitRoot, params.branch, params.remote);
      default:
        throw new ValidationError('operation', operation, 'valid operation (start/finish/rollback/list/switch/commit/push)');
    }
  }

  /**
   * Sanitize branch name for use in git commands
   * Provides defense-in-depth against shell injection
   *
   * @param branchName - Branch name to sanitize
   * @returns Sanitized branch name safe for use in shell commands
   * @throws ValidationError if branch name contains unsafe characters
   */
  private sanitizeBranchName(branchName: string): string {
    // Enforce strict alphanumeric + hyphen pattern
    if (!/^[a-zA-Z0-9-]+$/.test(branchName)) {
      throw new ValidationError(
        'branch',
        branchName,
        'alphanumeric characters and hyphens only (no spaces, slashes, or special characters)'
      );
    }

    // Additional safety: prevent command injection via branch names
    if (branchName.includes('--') || branchName.startsWith('-')) {
      throw new ValidationError(
        'branch',
        branchName,
        'branch name cannot start with hyphen or contain double hyphens (potential git option injection)'
      );
    }

    return branchName;
  }

  /**
   * Get default branch name (main or master)
   * Tries multiple strategies to detect the correct default branch
   */
  private async getDefaultBranch(gitRoot: string): Promise<string> {
    try {
      // Strategy 1: Check symbolic-ref for origin/HEAD
      const result = await execAsync('git symbolic-ref refs/remotes/origin/HEAD', { cwd: gitRoot });
      const defaultBranch = result.stdout.trim().replace('refs/remotes/origin/', '');
      if (defaultBranch) {
        log.debug(`[GIT_FEATURE] Default branch detected via symbolic-ref: ${defaultBranch}`);
        return defaultBranch;
      }
    } catch {
      // symbolic-ref not available, try other strategies
    }

    try {
      // Strategy 2: Check if 'main' branch exists
      await execAsync('git show-ref --verify --quiet refs/heads/main', { cwd: gitRoot });
      log.debug('[GIT_FEATURE] Default branch detected: main (verified exists)');
      return 'main';
    } catch {
      // main doesn't exist, try master
    }

    try {
      // Strategy 3: Check if 'master' branch exists
      await execAsync('git show-ref --verify --quiet refs/heads/master', { cwd: gitRoot });
      log.debug('[GIT_FEATURE] Default branch detected: master (verified exists)');
      return 'master';
    } catch {
      // Neither main nor master exists
    }

    // Strategy 4: Get current branch as fallback
    try {
      const result = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: gitRoot });
      const currentBranch = result.stdout.trim();
      if (currentBranch && currentBranch !== 'HEAD') {
        log.warn(`[GIT_FEATURE] Using current branch as default: ${currentBranch}`);
        return currentBranch;
      }
    } catch {
      // Can't determine current branch
    }

    // Final fallback: assume 'main'
    log.warn('[GIT_FEATURE] Could not detect default branch, defaulting to main');
    return 'main';
  }

  /**
   * Check if git repository is in detached HEAD state
   */
  private async isDetachedHead(gitRoot: string): Promise<boolean> {
    try {
      const result = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: gitRoot });
      return result.stdout.trim() === 'HEAD';
    } catch {
      return false;
    }
  }

  /**
   * Execute git command with array arguments (prevents command injection)
   *
   * Uses spawn instead of exec to avoid shell interpretation of arguments.
   * This is the ONLY secure way to pass user-controlled data to git commands.
   *
   * @param args - Git command arguments as array
   * @param cwd - Working directory for git command
   * @returns Promise resolving to stdout
   *
   * @example
   * // Secure: Array arguments prevent injection
   * await this.execGitCommand(['commit', '-m', userMessage], gitRoot);
   *
   * @example
   * // INSECURE: Don't do this!
   * await execAsync(`git commit -m "${userMessage}"`, { cwd });
   */
  private execGitCommand(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const git = spawn('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      git.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      git.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      git.on('close', (code: number | null) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          const errorMsg = stderr || `Git command failed with code ${code}`;
          reject(new Error(errorMsg));
        }
      });

      git.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  /**
   * Validate operation-specific parameters
   */
  private validateOperationParams(params: any): void {
    const { operation, featureName, branch, message } = params;

    if (operation === 'start') {
      if (!featureName) {
        throw new ValidationError(
          'featureName',
          '',
          'featureName is required for start operation'
        );
      }

      // Validate feature name pattern
      if (!/^[a-zA-Z0-9-]+$/.test(featureName)) {
        throw new ValidationError(
          'featureName',
          featureName,
          'alphanumeric characters and hyphens only'
        );
      }
    }

    if (operation === 'commit') {
      if (!message || !message.trim()) {
        throw new ValidationError(
          'message',
          message || '',
          'commit message is required for commit operation and cannot be empty'
        );
      }
    }

    if (operation === 'rollback' && !branch) {
      throw new ValidationError(
        'branch',
        '',
        'branch is required for rollback operation (specify which branch to delete)'
      );
    }

    if (operation === 'switch' && !branch) {
      throw new ValidationError(
        'branch',
        '',
        'branch is required for switch operation (specify target branch)'
      );
    }
  }

  /**
   * START: Create new feature branch
   */
  private async executeStart(gitRoot: string, featureName: string): Promise<any> {
    // Check if already on feature branch
    const currentBranch = await getCurrentBranch(gitRoot);

    if (currentBranch && isFeatureBranch(currentBranch)) {
      throw new Error(
        `Already on feature branch: ${currentBranch}. ` +
        `Finish (git_feature finish) or switch branches before starting new feature.`
      );
    }

    // Check for uncommitted changes
    const hasChanges = await hasUncommittedChanges(gitRoot);
    if (hasChanges) {
      throw new Error(
        'Uncommitted changes detected. Commit or stash changes before starting new feature branch.'
      );
    }

    // Create feature branch
    const branchName = `llm-feature-${featureName}`;
    const safeBranchName = this.sanitizeBranchName(branchName);

    log.info(`[GIT_FEATURE] Creating feature branch: ${safeBranchName}`);

    await this.execGitCommand(['checkout', '-b', safeBranchName], gitRoot);

    log.info(`[GIT_FEATURE] ✓ Feature branch created: ${branchName}`);

    return {
      status: 'success',
      operation: 'start',
      branch: branchName,
      created: true,
      previousBranch: currentBranch || 'main',
      nextAction: {
        hint: `Feature branch created. When complete: git_feature({ operation: 'finish', scriptId, pushToRemote: true })`,
        required: false
      }
    };
  }

  /**
   * FINISH: Squash merge to main and optionally delete branch
   */
  private async executeFinish(
    gitRoot: string,
    branch?: string,
    deleteAfterMerge: boolean = true,
    pushToRemote: boolean = false,
    remote: string = 'origin'
  ): Promise<any> {
    // Get current branch if not specified
    const targetBranch = branch || await getCurrentBranch(gitRoot);

    if (!targetBranch) {
      throw new Error('Could not determine current branch');
    }

    if (!isFeatureBranch(targetBranch)) {
      throw new Error(
        `Not on a feature branch: ${targetBranch}. ` +
        `Feature branches must start with 'llm-feature-'.`
      );
    }

    // Check for uncommitted changes
    const hasChanges = await hasUncommittedChanges(gitRoot);
    if (hasChanges) {
      throw new Error(
        'Uncommitted changes detected. Commit or stash before finishing feature.'
      );
    }

    log.info(`[GIT_FEATURE] Finishing feature branch: ${targetBranch}`);

    // Sanitize branch names for safety
    const safeTargetBranch = this.sanitizeBranchName(targetBranch);

    // Detect default branch and switch to it
    const defaultBranch = await this.getDefaultBranch(gitRoot);
    const safeDefaultBranch = this.sanitizeBranchName(defaultBranch);
    log.info(`[GIT_FEATURE] Switching to default branch: ${safeDefaultBranch}`);

    await this.execGitCommand(['checkout', safeDefaultBranch], gitRoot);
    await this.execGitCommand(['merge', '--squash', safeTargetBranch], gitRoot);

    // Create squash commit with feature name
    const featureDesc = targetBranch.replace('llm-feature-', '').replace('llm-feature-auto-', 'auto-');
    const commitMessage = `Feature: ${featureDesc}`;

    // Use secure command execution (prevents injection via feature description)
    await this.execGitCommand(['commit', '-m', commitMessage], gitRoot);

    // Get squash commit SHA
    const commitShaOutput = await this.execGitCommand(['rev-parse', 'HEAD'], gitRoot);
    const commitSha = commitShaOutput.trim();

    log.info(`[GIT_FEATURE] ✓ Squash commit created: ${commitSha}`);

    // Push to remote if requested
    let pushed = false;
    let pushError: string | undefined;
    if (pushToRemote) {
      try {
        log.info(`[GIT_FEATURE] Pushing ${defaultBranch} to ${remote}`);
        const safeDefaultBranchForPush = this.sanitizeBranchName(defaultBranch);
        await this.execGitCommand(['push', '-u', remote, safeDefaultBranchForPush], gitRoot);
        pushed = true;
        log.info(`[GIT_FEATURE] ✓ Pushed ${defaultBranch} to ${remote}`);
      } catch (error) {
        // Don't fail the merge if push fails - partial success is OK
        pushError = error instanceof Error ? error.message : String(error);
        log.warn(`[GIT_FEATURE] ⚠ Push failed: ${pushError}`);
        log.warn(`[GIT_FEATURE] Merge successful but push failed. Run git push manually.`);
      }
    }

    // Delete feature branch if requested
    let deleted = false;
    if (deleteAfterMerge) {
      await this.execGitCommand(['branch', '-D', safeTargetBranch], gitRoot);
      deleted = true;
      log.info(`[GIT_FEATURE] ✓ Feature branch deleted: ${targetBranch}`);
    }

    // Add warning hint if merged but NOT pushed to GitHub
    const nextAction = !pushed ? {
      hint: `WARNING: Changes merged locally but NOT pushed to GitHub. Run: git_feature({ operation: 'push', scriptId }) or use pushToRemote: true`,
      required: true
    } : undefined;

    return {
      status: 'success',
      operation: 'finish',
      branch: targetBranch,
      squashCommit: commitSha,
      commitMessage,
      deleted,
      currentBranch: defaultBranch,
      pushed,
      ...(pushError && { pushError }),
      ...(nextAction && { nextAction })
    };
  }

  /**
   * ROLLBACK: Delete branch without merging
   */
  private async executeRollback(gitRoot: string, branch: string): Promise<any> {
    // Validate it's a feature branch
    if (!isFeatureBranch(branch)) {
      throw new ValidationError(
        'branch',
        branch,
        'feature branch (must start with llm-feature-)'
      );
    }

    // Check if branch exists
    const allBranches = await getAllBranches(gitRoot);
    if (!allBranches.includes(branch)) {
      throw new ValidationError('branch', branch, 'existing branch');
    }

    // Check if currently on this branch
    const currentBranch = await getCurrentBranch(gitRoot);
    const onTargetBranch = currentBranch === branch;

    // Check for uncommitted changes (only if on target branch)
    let uncommittedChangesLost = false;
    if (onTargetBranch) {
      uncommittedChangesLost = await hasUncommittedChanges(gitRoot);
    }

    log.info(`[GIT_FEATURE] Rolling back feature branch: ${branch}`);

    // Sanitize branch name for safety
    const safeBranch = this.sanitizeBranchName(branch);

    // Switch to default branch if currently on target branch
    let defaultBranch = 'main';  // Default value
    let safeDefaultBranch = defaultBranch;
    if (onTargetBranch) {
      defaultBranch = await this.getDefaultBranch(gitRoot);
      safeDefaultBranch = this.sanitizeBranchName(defaultBranch);
      log.info(`[GIT_FEATURE] Switching to default branch: ${safeDefaultBranch}`);
      await this.execGitCommand(['checkout', safeDefaultBranch], gitRoot);
    }

    // Delete feature branch (force delete to discard commits)
    await this.execGitCommand(['branch', '-D', safeBranch], gitRoot);

    log.info(`[GIT_FEATURE] ✓ Feature branch deleted: ${branch}`);

    return {
      status: 'success',
      operation: 'rollback',
      branch,
      deleted: true,
      uncommittedChangesLost,
      currentBranch: onTargetBranch ? defaultBranch : currentBranch || defaultBranch
    };
  }

  /**
   * LIST: Show all feature branches
   */
  private async executeList(gitRoot: string): Promise<any> {
    // Get all branches
    const allBranches = await getAllBranches(gitRoot);

    // Filter feature branches
    const featureBranches = allBranches.filter(isFeatureBranch);

    // Get current branch
    const currentBranch = await getCurrentBranch(gitRoot);

    log.info(`[GIT_FEATURE] Found ${featureBranches.length} feature branches`);

    return {
      status: 'success',
      operation: 'list',
      branches: featureBranches,
      current: currentBranch || null,
      total: featureBranches.length
    };
  }

  /**
   * SWITCH: Switch between branches
   */
  private async executeSwitch(gitRoot: string, branch: string): Promise<any> {
    // Validate branch exists
    const allBranches = await getAllBranches(gitRoot);

    if (!allBranches.includes(branch)) {
      throw new ValidationError(
        'branch',
        branch,
        `existing branch. Available branches: ${allBranches.join(', ')}`
      );
    }

    // Check for uncommitted changes
    const hasChanges = await hasUncommittedChanges(gitRoot);
    if (hasChanges) {
      throw new Error(
        'Uncommitted changes detected. Commit or stash before switching branches.'
      );
    }

    log.info(`[GIT_FEATURE] Switching to branch: ${branch}`);

    // Sanitize branch name for safety
    const safeBranch = this.sanitizeBranchName(branch);

    // Switch branch
    await this.execGitCommand(['checkout', safeBranch], gitRoot);

    log.info(`[GIT_FEATURE] ✓ Switched to branch: ${branch}`);

    return {
      status: 'success',
      operation: 'switch',
      branch,
      switched: true,
      isFeatureBranch: isFeatureBranch(branch)
    };
  }

  /**
   * Commit all changes with custom message
   */
  private async executeCommit(
    gitRoot: string,
    message: string
  ): Promise<Record<string, unknown>> {
    log.info('[GIT_FEATURE] Executing commit operation');

    // Pre-flight check: not in detached HEAD
    if (await this.isDetachedHead(gitRoot)) {
      throw new Error(
        'Cannot commit in detached HEAD state. Create a branch first with: git checkout -b <branch-name>'
      );
    }

    // Pre-flight check: has changes to commit
    const hasChanges = await hasUncommittedChanges(gitRoot);
    if (!hasChanges) {
      throw new Error(
        'No changes to commit. Working tree is clean.'
      );
    }

    // Get current branch name
    const currentBranch = await getCurrentBranch(gitRoot);
    if (!currentBranch) {
      throw new Error('Could not determine current branch');
    }

    log.info(`[GIT_FEATURE] Committing changes on branch: ${currentBranch}`);

    // Stage all changes (per user preference: always commit all)
    await this.execGitCommand(['add', '-A'], gitRoot);

    // Commit with message (using array args prevents command injection)
    await this.execGitCommand(['commit', '-m', message], gitRoot);

    // Get commit SHA
    const commitSha = await this.execGitCommand(['rev-parse', 'HEAD'], gitRoot);
    const shortSha = commitSha.trim().substring(0, 7);

    // Get commit timestamp
    const timestamp = await this.execGitCommand(['show', '-s', '--format=%ci', 'HEAD'], gitRoot);

    // Get files committed count
    const stats = await this.execGitCommand(['show', '--stat', '--oneline', 'HEAD'], gitRoot);
    const filesChanged = (stats.match(/\|/g) || []).length;

    log.info(`[GIT_FEATURE] ✓ Committed ${filesChanged} file(s): ${shortSha}`);

    // Add hint for feature branch workflow completion
    const onFeatureBranch = isFeatureBranch(currentBranch);
    const nextAction = onFeatureBranch ? {
      hint: `Changes committed. When complete: git_feature({ operation: 'finish', scriptId, pushToRemote: true })`,
      required: false
    } : undefined;

    return {
      status: 'success',
      operation: 'commit',
      branch: currentBranch,
      commitSha: commitSha.trim(),
      shortSha,
      message,
      filesChanged,
      timestamp: timestamp.trim(),
      isFeatureBranch: onFeatureBranch,
      ...(nextAction && { nextAction })
    };
  }

  /**
   * Push current branch to remote
   */
  private async executePush(
    gitRoot: string,
    branch?: string,
    remote: string = 'origin'
  ): Promise<Record<string, unknown>> {
    log.info('[GIT_FEATURE] Executing push operation');

    // Pre-flight check: not in detached HEAD
    if (await this.isDetachedHead(gitRoot)) {
      throw new Error(
        'Cannot push in detached HEAD state. Create a branch first with: git checkout -b <branch-name>'
      );
    }

    // Get current branch if not specified
    const branchResult = branch || await getCurrentBranch(gitRoot);
    if (!branchResult) {
      throw new Error('Could not determine current branch');
    }
    const currentBranch = branchResult;

    log.info(`[GIT_FEATURE] Pushing branch: ${currentBranch} to remote: ${remote}`);

    // Sanitize remote name for safety
    if (!/^[a-zA-Z0-9_-]+$/.test(remote)) {
      throw new ValidationError('remote', remote, 'alphanumeric characters, hyphens, and underscores only');
    }

    // Check if remote exists
    const remotes = await this.execGitCommand(['remote'], gitRoot);
    if (!remotes.split('\n').includes(remote)) {
      throw new Error(
        `Remote '${remote}' not found. Available remotes: ${remotes.trim() || 'none'}. Add remote with: git remote add ${remote} <url>`
      );
    }

    // Sanitize branch name for safety
    const safeBranch = this.sanitizeBranchName(currentBranch);

    // Push with auto-upstream (always use -u for convenience)
    // This is safe and idempotent - sets local tracking configuration
    // Using array args prevents command injection
    try {
      await this.execGitCommand(['push', '-u', remote, safeBranch], gitRoot);
    } catch (error) {
      // Provide helpful error messages for common push failures
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (errorMsg.includes('no upstream branch')) {
        throw new Error(
          `No upstream branch configured. This should not happen with -u flag. Try: git push --set-upstream ${remote} ${currentBranch}`
        );
      } else if (errorMsg.includes('rejected')) {
        throw new Error(
          `Push rejected. Remote has changes not in local branch. Pull first with: git pull ${remote} ${currentBranch}`
        );
      } else if (errorMsg.includes('permission denied') || errorMsg.includes('authentication failed')) {
        throw new Error(
          `Authentication failed. Check your git credentials and repository access permissions.`
        );
      } else {
        throw error;
      }
    }

    log.info(`[GIT_FEATURE] ✓ Pushed ${currentBranch} to ${remote}`);

    // Add workflow hint for feature branches
    const onFeatureBranch = isFeatureBranch(currentBranch);
    const nextAction = onFeatureBranch ? {
      hint: `Branch pushed to remote. When complete: git_feature({ operation: 'finish', scriptId, pushToRemote: true })`,
      required: false
    } : undefined;

    return {
      status: 'success',
      operation: 'push',
      branch: currentBranch,
      remote,
      upstreamSet: true,
      isFeatureBranch: onFeatureBranch,
      ...(nextAction && { nextAction })
    };
  }
}
