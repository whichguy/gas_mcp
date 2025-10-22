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
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';

const execAsync = promisify(exec);

/**
 * GitFeatureTool - Manage feature branch workflow for git-enabled projects
 */
export class GitFeatureTool extends BaseFileSystemTool {
  public name = 'git_feature';
  public description = 'Manage feature branch workflow for git-enabled projects. Operations: start (create branch), finish (squash merge), rollback (delete branch), list (show branches), switch (change branch).';

  public inputSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['start', 'finish', 'rollback', 'list', 'switch'],
        description: 'Feature branch operation to perform',
        examples: ['start', 'finish', 'rollback', 'list', 'switch']
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
        switch: 'Change to different branch. Use when: switching between features, returning to previous work, reviewing other branches.'
      },
      examples: [
        'git_feature({operation: "start", scriptId, featureName: "user-auth"}) - Create llm-feature-user-auth',
        'git_feature({operation: "finish", scriptId}) - Squash merge current feature to main',
        'git_feature({operation: "rollback", scriptId, branch: "llm-feature-user-auth"}) - Delete branch without merging',
        'git_feature({operation: "list", scriptId}) - Show all feature branches',
        'git_feature({operation: "switch", scriptId, branch: "llm-feature-api-refactor"}) - Switch to feature branch'
      ],
      workflow: 'Typical: 1) git_feature start → 2) write files (auto-commits to feature branch) → 3) git_feature finish (squash merge)',
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
        return this.executeFinish(gitRoot, params.branch, params.deleteAfterMerge ?? true);
      case 'rollback':
        return this.executeRollback(gitRoot, params.branch);
      case 'list':
        return this.executeList(gitRoot);
      case 'switch':
        return this.executeSwitch(gitRoot, params.branch);
      default:
        throw new ValidationError('operation', operation, 'valid operation (start/finish/rollback/list/switch)');
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
   * Validate operation-specific parameters
   */
  private validateOperationParams(params: any): void {
    const { operation, featureName, branch } = params;

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

    await execAsync(`git checkout -b ${safeBranchName}`, { cwd: gitRoot });

    log.info(`[GIT_FEATURE] ✓ Feature branch created: ${branchName}`);

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
    deleteAfterMerge: boolean = true
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

    await execAsync(`git checkout ${safeDefaultBranch}`, { cwd: gitRoot });
    await execAsync(`git merge --squash ${safeTargetBranch}`, { cwd: gitRoot });

    // Create squash commit with feature name
    const featureDesc = targetBranch.replace('llm-feature-', '').replace('llm-feature-auto-', 'auto-');
    const commitMessage = `Feature: ${featureDesc}`;

    await execAsync(`git commit -m "${commitMessage}"`, { cwd: gitRoot });

    // Get squash commit SHA
    const commitResult = await execAsync('git rev-parse HEAD', { cwd: gitRoot });
    const commitSha = commitResult.stdout.trim();

    log.info(`[GIT_FEATURE] ✓ Squash commit created: ${commitSha}`);

    // Delete feature branch if requested
    let deleted = false;
    if (deleteAfterMerge) {
      await execAsync(`git branch -D ${safeTargetBranch}`, { cwd: gitRoot });
      deleted = true;
      log.info(`[GIT_FEATURE] ✓ Feature branch deleted: ${targetBranch}`);
    }

    return {
      status: 'success',
      operation: 'finish',
      branch: targetBranch,
      squashCommit: commitSha,
      commitMessage,
      deleted,
      currentBranch: defaultBranch
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
      await execAsync(`git checkout ${safeDefaultBranch}`, { cwd: gitRoot });
    }

    // Delete feature branch (force delete to discard commits)
    await execAsync(`git branch -D ${safeBranch}`, { cwd: gitRoot });

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
    await execAsync(`git checkout ${safeBranch}`, { cwd: gitRoot });

    log.info(`[GIT_FEATURE] ✓ Switched to branch: ${branch}`);

    return {
      status: 'success',
      operation: 'switch',
      branch,
      switched: true,
      isFeatureBranch: isFeatureBranch(branch)
    };
  }
}
