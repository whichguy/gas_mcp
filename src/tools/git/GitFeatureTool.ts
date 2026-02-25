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
import { buildCompactDeployHint } from '../../utils/gitStatus.js';
import { mcpLogger } from '../../utils/mcpLogger.js';
import { ensureGitInitialized } from '../../utils/gitInit.js';
import { SessionWorktreeManager } from '../../utils/sessionWorktree.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';

const execAsync = promisify(exec);

/**
 * GitFeatureTool - Manage feature branch workflow for git-enabled projects
 */
export class GitFeatureTool extends BaseFileSystemTool {
  public name = 'git_feature';
  public description = '[GIT] Feature branch workflow — start, commit, push, finish, rollback, list, and switch branches in the local git mirror. WHEN: managing git history for GAS projects. AVOID: use rsync for syncing files; git_feature for branch workflow and committing changes. Example: git_feature({scriptId, operation: "start", featureName: "user-auth"})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      status: { type: 'string', description: 'Operation status (success)' },
      operation: { type: 'string', description: 'Operation that was performed' },
      branch: { type: 'string', description: 'Branch name involved' },
      created: { type: 'boolean', description: 'Whether branch was created (start)' },
      switched: { type: 'boolean', description: 'Whether branch was switched (switch)' },
      deleted: { type: 'boolean', description: 'Whether branch was deleted (finish/rollback)' },
      commitSha: { type: 'string', description: 'Full commit SHA (commit/finish)' },
      shortSha: { type: 'string', description: 'Short commit SHA (commit)' },
      message: { type: 'string', description: 'Commit message (commit)' },
      filesChanged: { type: 'number', description: 'Number of files in commit (commit)' },
      currentBranch: { type: 'string', description: 'Current branch after operation' },
      pushed: { type: 'boolean', description: 'Whether pushed to remote (finish/push)' },
      branches: { type: 'array', description: 'List of feature branches (list)' },
      total: { type: 'number', description: 'Total feature branches (list)' },
      isFeatureBranch: { type: 'boolean', description: 'Whether current branch is a feature branch' }
    }
  };

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
      CRITICAL: 'start BEFORE 3+ file changes | commit AFTER each write (no auto-commit) | finish+push when done | NEVER leave uncommitted work',
      trigger: 'start: user says build/create/implement + feature | commit: after write/edit/aider | finish: user says done/finished/complete',
      operations: 'start: create branch | commit: REQUIRED after writes | push: backup to remote | finish: merge to main (use pushToRemote:true) | rollback: delete branch | list: show branches | switch: change branch',
      workflow: 'start → write files → commit after each → finish+push when done',
      branching: 'Use branch for 3+ files or named feature. Skip for single file fix or config change.',
      polyrepo: 'Use projectPath for nested repos: git_feature({..., projectPath: "backend"})'
    }
  };

  public annotations = {
    title: 'Git Feature Workflow',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
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
      mcpLogger.info('git-feature', `[GIT_FEATURE] Auto-initialized git repository (config: ${gitResult.configSource})`);
    }

    mcpLogger.info('git-feature', `[GIT_FEATURE] Operation: ${operation}, Git root: ${gitRoot}`);

    // Use session worktree if available (all operations should be session-aware)
    let effectiveGitRoot = gitRoot;
    const worktreeManager = new SessionWorktreeManager();
    const worktreePath = worktreeManager.getWorktreePath(scriptId);
    if (worktreePath) {
      const { access } = await import('fs/promises');
      try {
        await access(join(worktreePath, '.git'));
        effectiveGitRoot = worktreePath;
        mcpLogger.info('git-feature', `[GIT_FEATURE] Using session worktree: ${effectiveGitRoot}`);
      } catch {
        mcpLogger.debug('git-feature', `[GIT_FEATURE] Session worktree not on disk, using main repo`);
      }
    }

    // Route to operation handler (all use effectiveGitRoot for session isolation)
    // commit/finish capture result so P7 deploy hint can be merged in
    let result: any;
    switch (operation) {
      case 'start':
        return this.executeStart(effectiveGitRoot, params.featureName);
      case 'finish':
        result = await this.executeFinish(effectiveGitRoot, params.branch, params.deleteAfterMerge ?? true, params.pushToRemote ?? false, params.remote);
        break;
      case 'rollback':
        return this.executeRollback(effectiveGitRoot, params.branch);
      case 'list':
        return this.executeList(effectiveGitRoot);
      case 'switch':
        return this.executeSwitch(effectiveGitRoot, params.branch);
      case 'commit':
        result = await this.executeCommit(effectiveGitRoot, params.message);
        break;
      case 'push':
        return this.executePush(effectiveGitRoot, params.branch, params.remote);
      default:
        throw new ValidationError('operation', operation, 'valid operation (start/finish/rollback/list/switch/commit/push)');
    }

    // P7: Inject deploy hint for commit/finish — nudges LLM to promote to staging
    if (operation === 'commit' || operation === 'finish') {
      try {
        const deployHint = await buildCompactDeployHint(
          scriptId,
          effectiveGitRoot,
          operation as 'commit' | 'finish'
        );
        if (deployHint) {
          result.deploy = deployHint;
        }
      } catch (err: unknown) {
        mcpLogger.warning('git-feature', `[GIT_FEATURE] Failed to build deploy hint (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return result;
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
        mcpLogger.debug('git-feature', `[GIT_FEATURE] Default branch detected via symbolic-ref: ${defaultBranch}`);
        return defaultBranch;
      }
    } catch {
      // symbolic-ref not available, try other strategies
    }

    try {
      // Strategy 2: Check if 'main' branch exists
      await execAsync('git show-ref --verify --quiet refs/heads/main', { cwd: gitRoot });
      mcpLogger.debug('git-feature', '[GIT_FEATURE] Default branch detected: main (verified exists)');
      return 'main';
    } catch {
      // main doesn't exist, try master
    }

    try {
      // Strategy 3: Check if 'master' branch exists
      await execAsync('git show-ref --verify --quiet refs/heads/master', { cwd: gitRoot });
      mcpLogger.debug('git-feature', '[GIT_FEATURE] Default branch detected: master (verified exists)');
      return 'master';
    } catch {
      // Neither main nor master exists
    }

    // Strategy 4: Get current branch as fallback
    try {
      const result = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: gitRoot });
      const currentBranch = result.stdout.trim();
      if (currentBranch && currentBranch !== 'HEAD') {
        mcpLogger.warning('git-feature', `[GIT_FEATURE] Using current branch as default: ${currentBranch}`);
        return currentBranch;
      }
    } catch {
      // Can't determine current branch
    }

    // Final fallback: assume 'main'
    mcpLogger.warning('git-feature', '[GIT_FEATURE] Could not detect default branch, defaulting to main');
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

    mcpLogger.info('git-feature', `[GIT_FEATURE] Creating feature branch: ${safeBranchName}`);

    await this.execGitCommand(['checkout', '-b', safeBranchName], gitRoot);

    mcpLogger.info('git-feature', `[GIT_FEATURE] ✓ Feature branch created: ${branchName}`);

    return {
      status: 'success',
      operation: 'start',
      branch: branchName,
      created: true,
      previousBranch: currentBranch || 'main'
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

    mcpLogger.info('git-feature', `[GIT_FEATURE] Finishing feature branch: ${targetBranch}`);

    // Sanitize branch names for safety
    const safeTargetBranch = this.sanitizeBranchName(targetBranch);

    // Detect default branch and switch to it
    const defaultBranch = await this.getDefaultBranch(gitRoot);
    const safeDefaultBranch = this.sanitizeBranchName(defaultBranch);
    mcpLogger.info('git-feature', `[GIT_FEATURE] Switching to default branch: ${safeDefaultBranch}`);

    await this.execGitCommand(['checkout', safeDefaultBranch], gitRoot);

    try {
      await this.execGitCommand(['merge', '--squash', safeTargetBranch], gitRoot);
    } catch (mergeError) {
      // Check for merge conflicts
      const statusOutput = await this.execGitCommand(['status', '--porcelain'], gitRoot);
      const hasConflicts = statusOutput.split('\n').some(
        (line: string) => line.startsWith('UU ') || line.startsWith('AA ') || line.startsWith('DD ')
      );

      if (hasConflicts) {
        // Abort the merge to restore clean state
        await this.execGitCommand(['merge', '--abort'], gitRoot).catch(() => {
          // If abort also fails, reset
          return this.execGitCommand(['reset', '--hard', 'HEAD'], gitRoot);
        });
        // Switch back to feature branch
        await this.execGitCommand(['checkout', safeTargetBranch], gitRoot);
        throw new Error(
          `Merge conflicts detected between '${targetBranch}' and '${defaultBranch}'. ` +
          `The merge was aborted and you are back on '${targetBranch}'. ` +
          `Resolve conflicts manually: git -C ${gitRoot} checkout ${defaultBranch} && git -C ${gitRoot} merge ${targetBranch}`
        );
      }
      throw mergeError;
    }

    // Create squash commit with feature name
    const featureDesc = targetBranch.replace('llm-feature-', '').replace('llm-feature-auto-', 'auto-');
    const commitMessage = `Feature: ${featureDesc}`;

    // Use secure command execution (prevents injection via feature description)
    await this.execGitCommand(['commit', '-m', commitMessage], gitRoot);

    // Get squash commit SHA
    const commitShaOutput = await this.execGitCommand(['rev-parse', 'HEAD'], gitRoot);
    const commitSha = commitShaOutput.trim();

    mcpLogger.info('git-feature', `[GIT_FEATURE] ✓ Squash commit created: ${commitSha}`);

    // Push to remote if requested
    let pushed = false;
    let pushError: string | undefined;
    if (pushToRemote) {
      try {
        mcpLogger.info('git-feature', `[GIT_FEATURE] Pushing ${defaultBranch} to ${remote}`);
        const safeDefaultBranchForPush = this.sanitizeBranchName(defaultBranch);
        await this.execGitCommand(['push', '-u', remote, safeDefaultBranchForPush], gitRoot);
        pushed = true;
        mcpLogger.info('git-feature', `[GIT_FEATURE] ✓ Pushed ${defaultBranch} to ${remote}`);
      } catch (error) {
        // Don't fail the merge if push fails - partial success is OK
        pushError = error instanceof Error ? error.message : String(error);
        mcpLogger.warning('git-feature', `[GIT_FEATURE] ⚠ Push failed: ${pushError}`);
        mcpLogger.warning('git-feature', `[GIT_FEATURE] Merge successful but push failed. Run git push manually.`);
      }
    }

    // Delete feature branch if requested
    let deleted = false;
    if (deleteAfterMerge) {
      await this.execGitCommand(['branch', '-D', safeTargetBranch], gitRoot);
      deleted = true;
      mcpLogger.info('git-feature', `[GIT_FEATURE] ✓ Feature branch deleted: ${targetBranch}`);
    }

    // Add warning hint if merged but NOT pushed to GitHub
    const nextAction = !pushed ? {
      hint: `WARNING: Changes merged locally but NOT pushed to GitHub. Run: git_feature({ operation: 'push', scriptId }) or use pushToRemote: true`,
      required: true
    } : undefined;

    // Add promotion hint after successful finish
    const promotionHint = pushed ? {
      message: `Feature '${featureDesc}' merged and pushed to ${defaultBranch}.`,
      hint: `Consider promoting to staging: deploy({ operation: 'promote', to: 'staging', scriptId, description: 'Feature: ${featureDesc}' })`,
      workflow: 'dev (HEAD) → staging (versioned) → prod (stable)'
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
      ...(nextAction && { nextAction }),
      ...(promotionHint && { promotionHint })
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

    mcpLogger.info('git-feature', `[GIT_FEATURE] Rolling back feature branch: ${branch}`);

    // Sanitize branch name for safety
    const safeBranch = this.sanitizeBranchName(branch);

    // Switch to default branch if currently on target branch
    let defaultBranch = 'main';  // Default value
    let safeDefaultBranch = defaultBranch;
    if (onTargetBranch) {
      defaultBranch = await this.getDefaultBranch(gitRoot);
      safeDefaultBranch = this.sanitizeBranchName(defaultBranch);
      mcpLogger.info('git-feature', `[GIT_FEATURE] Switching to default branch: ${safeDefaultBranch}`);
      await this.execGitCommand(['checkout', safeDefaultBranch], gitRoot);
    }

    // Delete feature branch (force delete to discard commits)
    await this.execGitCommand(['branch', '-D', safeBranch], gitRoot);

    mcpLogger.info('git-feature', `[GIT_FEATURE] ✓ Feature branch deleted: ${branch}`);

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

    mcpLogger.info('git-feature', `[GIT_FEATURE] Found ${featureBranches.length} feature branches`);

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

    mcpLogger.info('git-feature', `[GIT_FEATURE] Switching to branch: ${branch}`);

    // Sanitize branch name for safety
    const safeBranch = this.sanitizeBranchName(branch);

    // Switch branch
    await this.execGitCommand(['checkout', safeBranch], gitRoot);

    mcpLogger.info('git-feature', `[GIT_FEATURE] ✓ Switched to branch: ${branch}`);

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
    mcpLogger.info('git-feature', '[GIT_FEATURE] Executing commit operation');

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

    mcpLogger.info('git-feature', `[GIT_FEATURE] Committing changes on branch: ${currentBranch}`);

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

    mcpLogger.info('git-feature', `[GIT_FEATURE] ✓ Committed ${filesChanged} file(s): ${shortSha}`);

    return {
      status: 'success',
      operation: 'commit',
      branch: currentBranch,
      commitSha: commitSha.trim(),
      shortSha,
      message,
      filesChanged,
      timestamp: timestamp.trim(),
      isFeatureBranch: isFeatureBranch(currentBranch)
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
    mcpLogger.info('git-feature', '[GIT_FEATURE] Executing push operation');

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

    mcpLogger.info('git-feature', `[GIT_FEATURE] Pushing branch: ${currentBranch} to remote: ${remote}`);

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

    mcpLogger.info('git-feature', `[GIT_FEATURE] ✓ Pushed ${currentBranch} to ${remote}`);

    return {
      status: 'success',
      operation: 'push',
      branch: currentBranch,
      remote,
      upstreamSet: true,
      isFeatureBranch: isFeatureBranch(currentBranch)
    };
  }
}
