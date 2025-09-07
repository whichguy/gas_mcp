/**
 * Git-GAS Synchronization Tools
 * 
 * Provides safe, merge-based synchronization between Google Apps Script projects
 * and local git repositories. Uses `.git/` folder structure for git configuration.
 * 
 * Core principle: ALWAYS pull-merge-push to prevent data loss.
 * The local sync folder is the merge authority for all operations.
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ValidationError, FileOperationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  transformMarkdownToHTML,
  transformHTMLToMarkdown,
  transformDotfileToModule,
  transformModuleToDotfile,
  wrapAsCommonJSModule,
  unwrapCommonJSModule,
  transformForGAS,
  transformFromGAS
} from '../utils/fileTransformations.js';
import { GitProjectManager, type GitConfigData } from '../utils/GitProjectManager.js';
import { serializeINI } from '../utils/iniParser.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// Default sync folder base path
const DEFAULT_SYNC_BASE = '~/gas-repos';

/**
 * Initialize git association for a GAS project
 */
export class GitInitTool extends BaseTool {
  public name = 'git_init';
  public description = 'Initialize git association for a GAS project by creating .git/config.gs configuration file in CommonJS format. Works alongside GitHub MCP server and standard git/gh commands for complete workflow integration.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID',
        pattern: '^[a-zA-Z0-9_-]{25,60}$',
        minLength: 25,
        maxLength: 60
      },
      repository: {
        type: 'string',
        description: 'Git repository URL (can be obtained from GitHub MCP: mcp__github__search_repositories or gh repo view)',
        examples: [
          'https://github.com/owner/repo.git',
          'git@github.com:owner/repo.git',
          'https://gitlab.com/owner/repo.git',
          'local' // For local-only projects without remote
        ]
      },
      branch: {
        type: 'string',
        description: 'Git branch to track (check with: gh repo view --json defaultBranchRef or git branch -r)',
        default: 'main',
        examples: ['main', 'master', 'develop', 'feature/my-feature']
      },
      localPath: {
        type: 'string',
        description: 'Custom local sync folder for git operations (default: ~/gas-repos/project-{scriptId})',
        examples: [
          '~/projects/my-gas-project',
          './gas-project',
          '/absolute/path/to/project'
        ]
      },
      syncPrefix: {
        type: 'string',
        description: 'Path prefix in git repo for GAS files (useful for monorepos)',
        default: '',
        examples: [
          'src/gas',      // GAS files in src/gas/ subdirectory
          'apps-script',  // GAS files in apps-script/ subdirectory
          'backend/gas',  // Nested path for complex projects
          ''              // GAS files at repo root (default)
        ]
      },
      projectPath: {
        type: 'string',
        description: 'Path within GAS project for nested .git folders (supports multiple git projects in one GAS project)',
        default: '',
        examples: [
          '',             // Root level .git/ folder
          'subproject1',  // Creates subproject1/.git/config.gs
          'libs/shared'   // Creates libs/shared/.git/config.gs
        ]
      },
      includeReadme: {
        type: 'boolean',
        description: 'Convert and include README.md as README.html',
        default: true
      }
    },
    required: ['scriptId', 'repository'],
    additionalProperties: false,
    llmWorkflowGuide: {
      prerequisites: [
        'GAS project must exist (use gas_project_create if needed)',
        'Git repository should exist (create with gh repo create or GitHub MCP)'
      ],
      typicalSequence: [
        '1. Create repo: gh repo create owner/repo --public',
        '2. Initialize: git_init({scriptId, repository})',
        '3. Clone locally: cd ~/gas-repos && git clone <repository>',
        '4. Sync files: git_sync({scriptId})',
        '5. Work with standard git: git add, commit, push'
      ],
      interoperability: {
        githubMcp: [
          'mcp__github__search_repositories - Find existing repos',
          'mcp__github__get_repository - Get repo details',
          'mcp__github__create_repository - Create new repo',
          'mcp__github__create_pull_request - After pushing changes'
        ],
        gitCommands: [
          'git clone <repository> - Clone to local sync folder',
          'git status - Check local changes',
          'git add -A && git commit -m "msg" - Commit changes',
          'git push origin <branch> - Push to GitHub'
        ],
        ghCommands: [
          'gh repo create - Create new repository',
          'gh repo clone - Clone repository',
          'gh pr create - Create pull request',
          'gh repo view --json defaultBranchRef - Check default branch'
        ]
      },
      nextSteps: [
        'git_sync - Synchronize files between GAS and local',
        'git clone <repository> ~/gas-repos/project - Clone locally',
        'gh repo view <repository> - Verify repo configuration'
      ]
    }
  };

  async execute(params: any): Promise<any> {
    const scriptId = this.validate.scriptId(params.scriptId, 'git operation');
    const repository = params.repository;
    const branch = params.branch || 'main';
    const syncPrefix = params.syncPrefix || '';
    const projectPath = params.projectPath || ''; // Support nested projects
    
    // Determine local sync folder
    const localPath = params.localPath || 
      path.join(this.expandPath(DEFAULT_SYNC_BASE), `project-${scriptId}`);
    const expandedPath = this.expandPath(localPath);
    
    // Get auth token
    const accessToken = await this.getAuthToken(params);
    const gitProjectManager = new GitProjectManager();
    
    try {
      // Create local sync folder if it doesn't exist
      await fs.mkdir(expandedPath, { recursive: true });
      
      // Initialize git repo if needed
      if (!await this.isGitRepo(expandedPath)) {
        await execFileAsync('git', ['init'], { cwd: expandedPath });
        await execFileAsync('git', ['checkout', '-b', branch], { cwd: expandedPath });
        
        // Add remote if it's a real URL
        if (repository !== 'local' && repository.includes('://')) {
          await execFileAsync('git', ['remote', 'add', 'origin', repository], { cwd: expandedPath });
        }
      }
      
      // Create .git/config in GAS project using native INI format
      await gitProjectManager.initGitConfig(
        scriptId,
        accessToken,
        projectPath,
        repository,
        branch,
        expandedPath
      );
      
      // Also create a local .git/config copy for reference
      const localGitPath = path.join(expandedPath, '.git-gas');
      await fs.mkdir(localGitPath, { recursive: true });
      
      const config = await gitProjectManager.getProjectConfig(scriptId, accessToken, projectPath);
      if (config) {
        const iniContent = serializeINI(config);
        await fs.writeFile(path.join(localGitPath, 'config'), iniContent);
      }
      
      return {
        success: true,
        syncFolder: expandedPath,
        gitConfigCreated: true,
        projectPath: projectPath || '(root)',
        repository: repository,
        branch: branch,
        gitFilePath: projectPath ? `${projectPath}/.git/config.gs` : '.git/config.gs',
        recommendedActions: {
          primary: 'Sync existing files between local and GAS',
          alternatives: [
            'Pull latest from GitHub first',
            'Configure git remote if needed',
            'Add .git/info/exclude.gs for local exclusions'
          ],
          gitCommands: repository !== 'local' ? [
            `git -C "${expandedPath}" fetch origin ${branch}`,
            `git -C "${expandedPath}" pull origin ${branch}`
          ] : [],
          gasCommands: [
            `git_sync({scriptId: '${scriptId}', projectPath: '${projectPath}'})`
          ]
        }
      };
    } catch (error: any) {
      throw new FileOperationError('initialize', scriptId, error.message || 'Failed to initialize git association');
    }
  }
  
  private expandPath(filePath: string): string {
    if (!filePath) return '';
    if (filePath.startsWith('~/')) {
      return path.join(os.homedir(), filePath.slice(2));
    }
    return path.resolve(filePath);
  }
  
  private async isGitRepo(dir: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: dir });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Safe merge-based synchronization - ALWAYS pulls before pushing
 */
export class GitSyncTool extends BaseTool {
  public name = 'git_sync';
  public description = 'Safe merge-based synchronization - ALWAYS pulls from GAS, merges locally, then pushes back. Critical bridge between GAS editing and git version control. Works with standard git workflow and GitHub MCP for complete development cycle.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID with .git/config.gs association (must run git_init first)',
        pattern: '^[a-zA-Z0-9_-]{25,60}$',
        examples: [
          '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
          '1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ'
        ]
      },
      projectPath: {
        type: 'string',
        description: 'Path to nested git project within GAS (for multi-project support)',
        default: '',
        examples: [
          '',             // Root project
          'subproject1',  // Sync subproject1/.git/
          'libs/shared'   // Sync libs/shared/.git/
        ]
      },
      direction: {
        type: 'string',
        enum: ['sync', 'pull-only', 'push-only'],
        default: 'sync',
        description: 'Sync direction - NOTE: Even push-only pulls first to prevent data loss',
        examples: [
          'sync',       // Full bidirectional sync (most common)
          'pull-only',  // Just update local from GAS
          'push-only'   // Push local to GAS (still pulls first for safety)
        ],
        llmHints: {
          sync: 'Default: Pulls from GAS, merges with local, pushes back if successful',
          'pull-only': 'Updates local repo from GAS without pushing changes back',
          'push-only': 'STILL pulls first for safety, then pushes local changes to GAS'
        }
      },
      autoCommit: {
        type: 'boolean',
        default: true,
        description: 'Auto-commit after successful merge'
      },
      mergeStrategy: {
        type: 'string',
        enum: ['merge', 'ours', 'theirs', 'manual'],
        default: 'merge',
        description: 'Git merge strategy for handling conflicts',
        examples: [
          'merge',   // Standard 3-way merge (default)
          'ours',    // Keep local version on conflicts
          'theirs',  // Take GAS version on conflicts
          'manual'   // Stop for manual resolution
        ]
      },
      forceOverwrite: {
        type: 'boolean',
        default: false,
        description: '⚠️ DANGEROUS: Skip merge, directly overwrite destination (data loss risk!)'
      },
      transformOptions: {
        type: 'object',
        properties: {
          preserveMarkdownComments: {
            type: 'boolean',
            default: true
          },
          styleReadme: {
            type: 'boolean',
            default: true
          }
        }
      }
    },
    required: ['scriptId'],
    additionalProperties: false,
    llmWorkflowGuide: {
      prerequisites: [
        'Project must have .git/config.gs file (use git_init first)',
        'Local git repo will be created automatically if needed',
        'Git must be installed on the system'
      ],
      typicalWorkflow: [
        '1. Edit in GAS editor or locally',
        '2. Run git_sync({scriptId}) to merge changes',
        '3. Resolve any conflicts if they occur',
        '4. Commit: git add -A && git commit -m "Synced with GAS"',
        '5. Push to GitHub: git push origin main',
        '6. Create PR if needed: gh pr create'
      ],
      useCases: {
        afterGasEdit: 'git_sync({scriptId}) - Pull GAS changes to local',
        beforeDeploy: 'git_sync({scriptId, direction: "push-only"}) - Push local to GAS',
        regularSync: 'git_sync({scriptId}) - Full bidirectional sync',
        pullOnly: 'git_sync({scriptId, direction: "pull-only"}) - Update local only',
        forceOverwrite: 'git_sync({scriptId, forceOverwrite: true}) - ⚠️ DANGEROUS'
      },
      interoperability: {
        beforeSync: [
          'git status - Check local uncommitted changes',
          'git stash - Save local changes temporarily',
          'gh repo sync - Pull latest from GitHub'
        ],
        afterSync: [
          'git diff - Review merged changes',
          'git add -A && git commit -m "msg" - Commit merged result',
          'git push origin branch - Push to GitHub',
          'gh pr create - Create pull request'
        ],
        githubMcp: [
          'mcp__github__get_file_contents - Compare with GitHub version',
          'mcp__github__create_pull_request - After pushing synced changes',
          'mcp__github__list_commits - Review commit history'
        ]
      },
      criticalBehavior: [
        '⚠️ ALWAYS pulls ALL files from GAS first (never blind push)',
        '✅ Merges intelligently with local changes using git merge-file',
        '🔒 Only pushes back to GAS if merge succeeds without conflicts',
        '🛑 Stops for manual resolution if conflicts detected',
        '📁 Creates .git-gas/ folder with merge artifacts for debugging'
      ],
      conflictResolution: [
        'Conflicts are saved in .git-gas/ folder',
        'Use git merge-tool or manually edit conflicts',
        'Run git_sync again after resolving',
        'Or use forceOverwrite: true to take one version (dangerous)'
      ]
    }
  };

  async execute(params: any): Promise<any> {
    const scriptId = this.validate.scriptId(params.scriptId, 'git operation');
    const direction = params.direction || 'sync';
    const autoCommit = params.autoCommit !== false;
    const mergeStrategy = params.mergeStrategy || 'merge';
    const forceOverwrite = params.forceOverwrite === true;
    const projectPath = params.projectPath || '';
    
    const accessToken = await this.getAuthToken(params);
    const gasClient = new GASClient();
    const gitProjectManager = new GitProjectManager();
    
    try {
      // If specific projectPath provided (including empty string for root), sync just that repo
      if (projectPath !== undefined && params.projectPath !== undefined) {
        return await this.syncSingleRepo(
          scriptId, projectPath, direction, autoCommit, 
          mergeStrategy, forceOverwrite, gasClient, 
          accessToken, params.transformOptions
        );
      }
      
      // Otherwise, sync ALL repos in the project
      const projects = await gitProjectManager.listGitProjects(scriptId, accessToken);
      if (projects.length === 0) {
        throw new ValidationError('git-link', scriptId, 'Project must have .git/config.gs file(s) - run git_init first');
      }
      
      console.error(`🔄 Found ${projects.length} git repositories in project`);
      const results = [];
      
      for (const project of projects) {
        const repoPath = project === '(root)' ? '' : project;
        console.error(`\n📦 Syncing repository: ${project}`);
        
        try {
          const result = await this.syncSingleRepo(
            scriptId, repoPath, direction, autoCommit,
            mergeStrategy, forceOverwrite, gasClient,
            accessToken, params.transformOptions
          );
          results.push({ 
            projectPath: project, 
            success: true, 
            ...result 
          });
        } catch (error: any) {
          console.error(`❌ Failed to sync ${project}: ${error.message}`);
          results.push({ 
            projectPath: project, 
            success: false, 
            error: error.message 
          });
          // Continue syncing other repos even if one fails
        }
      }
      
      // Aggregate results
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;
      
      return {
        success: failureCount === 0,
        message: `Synced ${successCount} repositories${failureCount > 0 ? `, ${failureCount} failed` : ''}`,
        repositories: results,
        totalPulled: results.reduce((sum, r) => sum + (r.pulledFiles || 0), 0),
        totalPushed: results.reduce((sum, r) => sum + (r.pushedFiles || 0), 0),
        recommendedActions: failureCount > 0 ? {
          primary: 'Review and resolve failures in individual repositories',
          commands: results
            .filter(r => !r.success)
            .map(r => `git_sync({scriptId: '${scriptId}', projectPath: '${r.projectPath === '(root)' ? '' : r.projectPath}'})`)
        } : undefined
      };
      
    } catch (error: any) {
      throw new FileOperationError('sync', scriptId, error.message || 'Failed to synchronize project');
    }
  }
  
  private async syncSingleRepo(
    scriptId: string,
    projectPath: string,
    direction: string,
    autoCommit: boolean,
    mergeStrategy: string,
    forceOverwrite: boolean,
    gasClient: GASClient,
    accessToken: string,
    transformOptions?: any
  ): Promise<any> {
    const gitProjectManager = new GitProjectManager();
    
    // Get git configuration for this specific repo
    const gitConfig = await gitProjectManager.getProjectConfig(scriptId, accessToken, projectPath);
    if (!gitConfig) {
      throw new ValidationError('git-link', `${projectPath || 'root'}`, 'Repository must have .git/config.gs file');
    }
    
    // Transform config to expected format
    const config = {
      repository: gitConfig.remote?.origin?.url || '',
      branch: Object.keys(gitConfig.branch || {})[0] || 'main',
      localPath: (gitConfig as any).sync?.localPath || `~/gas-repos/project-${scriptId}${projectPath ? '-' + projectPath.replace(/\//g, '-') : ''}`,
      lastSync: (gitConfig as any).sync?.lastSync,
      projectPath: projectPath
    };
    
    const syncFolder = this.expandPath(config.localPath);
    
    // Ensure sync folder exists and is a git repo
    await this.ensureGitRepo(syncFolder, config);
    
    // Get only files belonging to this repo (based on path prefix)
    console.error(`📥 Pulling files from GAS path: ${projectPath || '(root)'}...`);
    const allGasFiles = await gasClient.getProjectContent(scriptId, accessToken);
    console.error(`Found ${allGasFiles.length} total files in GAS`);
    const gasFiles = this.filterFilesByPath(allGasFiles, projectPath);
    console.error(`Filtered to ${gasFiles.length} files for path: ${projectPath || '(root)'}`);
    
    if (forceOverwrite) {
      // Force overwrite mode - skip merge
      await this.forceWriteFiles(syncFolder, gasFiles, config);
      
      if (direction === 'pull-only') {
        return this.createSuccessResponse('pull', gasFiles.length, 0, syncFolder, []);
      }
    } else {
      // Normal merge mode
      const mergeResult = await this.mergeWithLocal(syncFolder, gasFiles, config, mergeStrategy);
      
      if (!mergeResult.success) {
        return this.createConflictResponse(mergeResult.conflicts, syncFolder);
      }
      
      // Auto-commit if requested
      if (autoCommit && mergeResult.hasChanges) {
        await execFileAsync('git', ['add', '-A'], { cwd: syncFolder });
        try {
          await execFileAsync('git', ['commit', '-m', 'Merged changes from GAS'], { cwd: syncFolder });
        } catch {
          // No changes to commit is fine
        }
      }
      
      if (direction === 'pull-only') {
        return this.createSuccessResponse('pull', gasFiles.length, mergeResult.merged.length, syncFolder, mergeResult.merged);
      }
    }
    
    // Push merged result back to GAS (for 'sync' and 'push-only')
    console.error(`📤 Pushing merged result back to GAS path: ${projectPath || '(root)'}...`);
    const localFiles = await this.readLocalFiles(syncFolder, config);
    const prefixedFiles = this.addPathPrefix(localFiles, projectPath);
    const pushedCount = await this.pushToGAS(scriptId, prefixedFiles, gasClient, accessToken, transformOptions);
    
    // Update .git/config.gs with sync metadata
    await gitProjectManager.updateProjectConfig(scriptId, accessToken, projectPath, {
      sync: {
        ...(gitConfig as any).sync,
        lastSync: {
          timestamp: new Date().toISOString(),
          direction: direction,
          filesChanged: pushedCount
        }
      }
    });
    
    return this.createSuccessResponse('complete', gasFiles.length, pushedCount, syncFolder, []);
  }
  
  private filterFilesByPath(files: any[], projectPath: string): any[] {
    if (!projectPath) {
      // Root project - exclude files that belong to sub-projects with their own .git/ folders
      // But include the root .git/ config itself
      return files.filter(f => {
        // Include root .git files
        if (f.name.startsWith('.git/')) return true;
        // Exclude files that belong to nested git projects
        const parts = f.name.split('/');
        for (let i = 0; i < parts.length - 1; i++) {
          const checkPath = parts.slice(0, i + 1).join('/') + '/.git/config.gs';
          if (files.some(file => file.name === checkPath)) {
            // This file belongs to a nested git project
            return false;
          }
        }
        return true;
      });
    }
    
    // Sub-project - only include files under this path
    const prefix = projectPath + '/';
    const gitConfigPath = projectPath + '/.git/config.gs';
    
    return files.filter(f => {
      // Include the git config file itself
      if (f.name === gitConfigPath) return true;
      // Include files under this path
      if (f.name.startsWith(prefix)) {
        // But exclude files that belong to deeper nested git projects
        const relativePath = f.name.slice(prefix.length);
        const parts = relativePath.split('/');
        for (let i = 0; i < parts.length - 1; i++) {
          const checkPath = projectPath + '/' + parts.slice(0, i + 1).join('/') + '/.git/config.gs';
          if (files.some(file => file.name === checkPath)) {
            // This file belongs to a deeper nested git project
            return false;
          }
        }
        return true;
      }
      return false;
    }).map(f => ({
      ...f,
      // Remove the project path prefix for local storage
      name: f.name === gitConfigPath 
        ? '.git/config.gs' 
        : (f.name.startsWith(prefix) ? f.name.slice(prefix.length) : f.name)
    }));
  }
  
  private addPathPrefix(files: any[], projectPath: string): any[] {
    if (!projectPath) return files;
    
    return files.map(f => ({
      ...f,
      name: projectPath + '/' + f.name
    }));
  }
  
  
  private async ensureGitRepo(syncFolder: string, gitConfig: any): Promise<void> {
    await fs.mkdir(syncFolder, { recursive: true });
    
    if (!await this.isGitRepo(syncFolder)) {
      await execFileAsync('git', ['init'], { cwd: syncFolder });
      await execFileAsync('git', ['checkout', '-b', gitConfig.branch || 'main'], { cwd: syncFolder });
      
      if (gitConfig.repository && gitConfig.repository !== 'local') {
        try {
          await execFileAsync('git', ['remote', 'add', 'origin', gitConfig.repository], { cwd: syncFolder });
        } catch {
          // Remote might already exist
        }
      }
    }
  }
  
  private async mergeWithLocal(syncFolder: string, gasFiles: any[], gitConfig: any, strategy: string): Promise<any> {
    // Try worktree method first, fall back to three-way merge if not supported
    const hasWorktreeSupport = await this.checkWorktreeSupport(syncFolder);
    
    if (hasWorktreeSupport) {
      return this.mergeWithWorktree(syncFolder, gasFiles, gitConfig, strategy);
    } else {
      return this.mergeWithThreeWay(syncFolder, gasFiles, gitConfig, strategy);
    }
  }
  
  private async checkWorktreeSupport(syncFolder: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['worktree', 'list'], { cwd: syncFolder });
      return true;
    } catch {
      return false;
    }
  }
  
  private async mergeWithWorktree(syncFolder: string, gasFiles: any[], gitConfig: any, strategy: string): Promise<any> {
    // Use git worktree for safe merging that preserves all files
    const worktreePath = path.join(syncFolder, '..', `.gas-worktree-${Date.now()}`);
    const currentBranch = await this.getCurrentBranch(syncFolder);
    
    try {
      // Save current state
      await execFileAsync('git', ['add', '-A'], { cwd: syncFolder });
      try {
        await execFileAsync('git', ['commit', '-m', 'WIP: Save before sync'], { cwd: syncFolder });
      } catch {
        // No changes to commit, that's fine
      }
      
      // Create worktree with current state
      await execFileAsync('git', ['worktree', 'add', worktreePath, 'HEAD'], { cwd: syncFolder });
      
      // Write GAS files to worktree
      await this.writeGASFiles(worktreePath, gasFiles, gitConfig);
      
      // Commit in worktree
      await execFileAsync('git', ['add', '-A'], { cwd: worktreePath });
      await execFileAsync('git', ['commit', '-m', 'GAS state for merge'], { cwd: worktreePath });
      
      // Generate patch from worktree
      const patch = await execFileAsync('git', ['diff', 'HEAD~1', 'HEAD'], { cwd: worktreePath });
      
      // Apply patch to main working directory
      if (patch.stdout.trim()) {
        try {
          // Try to apply patch
          const applyArgs = ['apply', '--3way'];
          if (strategy === 'ours') applyArgs.push('--reject');
          
          // Write patch to temp file
          const patchFile = path.join(syncFolder, '.gas-sync.patch');
          await fs.writeFile(patchFile, patch.stdout);
          
          try {
            await execFileAsync('git', [...applyArgs, patchFile], { cwd: syncFolder });
          } finally {
            // Clean up patch file
            await fs.unlink(patchFile).catch(() => {});
          }
          
          // Check for conflicts
          const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: syncFolder });
          const conflicts = this.parseConflicts(status.stdout);
          
          if (conflicts.length > 0) {
            // Clean up worktree
            await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: syncFolder });
            return { success: false, conflicts };
          }
        } catch (patchError: any) {
          // Check if it's a conflict
          const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: syncFolder });
          const conflicts = this.parseConflicts(status.stdout);
          
          if (conflicts.length > 0) {
            // Clean up worktree
            await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: syncFolder });
            return { success: false, conflicts };
          }
          
          throw patchError;
        }
      }
      
      // Clean up worktree
      await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: syncFolder });
      
      // Return list of files that were updated
      const mergedFiles = gasFiles.map(f => f.name);
      return { success: true, hasChanges: true, merged: mergedFiles };
      
    } catch (error: any) {
      // Ensure worktree is cleaned up
      try {
        await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: syncFolder });
      } catch {}
      throw error;
    }
  }
  
  private async mergeWithThreeWay(syncFolder: string, gasFiles: any[], gitConfig: any, strategy: string): Promise<any> {
    // Three-way merge: BASE (last sync), LOCAL (current), REMOTE (GAS)
    const mergeDir = path.join(syncFolder, '.gas-merge');
    const conflicts: string[] = [];
    const merged: string[] = [];
    
    try {
      // Create merge directory
      await fs.mkdir(mergeDir, { recursive: true });
      
      // Store current state
      await execFileAsync('git', ['add', '-A'], { cwd: syncFolder });
      try {
        await execFileAsync('git', ['commit', '-m', 'WIP: Save before merge'], { cwd: syncFolder });
      } catch {
        // No changes to commit
      }
      
      // Process each GAS file
      for (const gasFile of gasFiles) {
        const localPath = await this.transformGASToLocal(gasFile, gitConfig);
        const localFile = path.join(syncFolder, localPath);
        const baseFile = path.join(mergeDir, 'base-' + path.basename(localPath));
        const remoteFile = path.join(mergeDir, 'remote-' + path.basename(localPath));
        
        // Transform GAS content
        let gasContent = gasFile.source;
        if (gasFile.name === 'README' && gasFile.type === 'HTML') {
          const result = transformHTMLToMarkdown(gasContent, gasFile.name);
          gasContent = result.content;
        } else if (gasFile.name.startsWith('_') || gasFile.name === '.gitignore' || gasFile.name === '.git') {
          // For dotfiles, don't add .gs extension as they're already stored with proper names
          const result = transformFromGAS(gasContent, gasFile.name);
          gasContent = result.content;
        } else if (gasFile.type === 'SERVER_JS') {
          gasContent = unwrapCommonJSModule(gasContent);
        }
        
        // Write remote (GAS) version
        await fs.writeFile(remoteFile, gasContent, 'utf8');
        
        // Check if local file exists
        const localExists = await fs.access(localFile).then(() => true).catch(() => false);
        
        if (!localExists) {
          // New file from GAS - just write it
          await fs.mkdir(path.dirname(localFile), { recursive: true });
          await fs.writeFile(localFile, gasContent, 'utf8');
          merged.push(localPath);
        } else {
          // Get base version (last known state - for simplicity, use local as base)
          const localContent = await fs.readFile(localFile, 'utf8');
          await fs.writeFile(baseFile, localContent, 'utf8');
          
          // Check if files differ
          if (localContent === gasContent) {
            // No changes needed
            continue;
          }
          
          // Three-way merge
          try {
            // Use git merge-file for three-way merge
            await execFileAsync('git', [
              'merge-file',
              '-p',  // Print to stdout
              localFile,
              baseFile,
              remoteFile
            ], { cwd: syncFolder });
            
            merged.push(localPath);
          } catch (mergeError: any) {
            if (mergeError.code === 1) {
              // Conflict detected
              conflicts.push(localPath);
              
              // Apply merge with conflict markers
              await execFileAsync('git', [
                'merge-file',
                localFile,
                baseFile,
                remoteFile
              ], { cwd: syncFolder }).catch(() => {});
            } else {
              throw mergeError;
            }
          }
        }
      }
      
      // Clean up merge directory
      await fs.rm(mergeDir, { recursive: true, force: true });
      
      if (conflicts.length > 0) {
        return { success: false, conflicts };
      }
      
      return { success: true, hasChanges: merged.length > 0, merged };
      
    } catch (error) {
      // Clean up
      await fs.rm(mergeDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }
  
  private async forceWriteFiles(syncFolder: string, gasFiles: any[], gitConfig: any): Promise<void> {
    await this.clearDirectory(syncFolder);
    await this.writeGASFiles(syncFolder, gasFiles, gitConfig);
    await execFileAsync('git', ['add', '-A'], { cwd: syncFolder });
    await execFileAsync('git', ['commit', '-m', 'Force sync from GAS'], { cwd: syncFolder });
  }
  
  private async clearDirectory(syncFolder: string): Promise<void> {
    // Clear all files except .git directory
    const entries = await fs.readdir(syncFolder);
    for (const entry of entries) {
      if (entry !== '.git') {
        const fullPath = path.join(syncFolder, entry);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          await fs.rm(fullPath, { recursive: true, force: true });
        } else {
          await fs.unlink(fullPath);
        }
      }
    }
  }
  
  private async writeGASFiles(syncFolder: string, gasFiles: any[], gitConfig: any): Promise<void> {
    for (const file of gasFiles) {
      const localPath = await this.transformGASToLocal(file, gitConfig);
      const fullPath = path.join(syncFolder, localPath);
      
      // Create directory if needed
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      
      // Transform and write content
      let content = file.source;
      
      // Handle transformations
      if (file.name === 'README' && file.type === 'HTML') {
        const result = transformHTMLToMarkdown(content, file.name);
        content = result.content;
      } else if (file.name.startsWith('_') || file.name === '.gitignore' || file.name === '.git') {
        // Transform from GAS format back to original - dotfiles already have proper names
        const result = transformFromGAS(content, file.name);
        content = result.content;
      } else if (file.type === 'SERVER_JS') {
        content = unwrapCommonJSModule(content);
      }
      
      await fs.writeFile(fullPath, content, 'utf8');
    }
    
    // Store git config files in .git-gas folder for local reference
    const gitConfigFiles = gasFiles.filter(f => f.name.startsWith('.git/'));
    if (gitConfigFiles.length > 0) {
      const gitGasPath = path.join(syncFolder, '.git-gas');
      await fs.mkdir(gitGasPath, { recursive: true });
      for (const gitFile of gitConfigFiles) {
        const fileName = gitFile.name.replace('.git/', '');
        await fs.writeFile(path.join(gitGasPath, fileName), gitFile.source, 'utf8');
      }
    }
  }

  private async updateGASFiles(syncFolder: string, gasFiles: any[], gitConfig: any): Promise<void> {
    // Like writeGASFiles but doesn't delete existing files
    // Only updates/adds files that exist in GAS
    for (const file of gasFiles) {
      const localPath = await this.transformGASToLocal(file, gitConfig);
      const fullPath = path.join(syncFolder, localPath);
      
      // Create directory if needed
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      
      // Transform and write content
      let content = file.source;
      
      // Handle transformations
      if (file.name === 'README' && file.type === 'HTML') {
        const result = transformHTMLToMarkdown(content, file.name);
        content = result.content;
      } else if (file.name.startsWith('_') || file.name === '.gitignore' || file.name === '.git') {
        // Transform from GAS format back to original
        const result = transformFromGAS(content, file.name);
        content = result.content;
      } else if (file.type === 'SERVER_JS') {
        content = unwrapCommonJSModule(content);
      }
      
      await fs.writeFile(fullPath, content, 'utf8');
    }
    
    // Store git config files in .git-gas folder for local reference
    const gitConfigFiles = gasFiles.filter(f => f.name.startsWith('.git/'));
    if (gitConfigFiles.length > 0) {
      const gitGasPath = path.join(syncFolder, '.git-gas');
      await fs.mkdir(gitGasPath, { recursive: true });
      for (const gitFile of gitConfigFiles) {
        const fileName = gitFile.name.replace('.git/', '');
        await fs.writeFile(path.join(gitGasPath, fileName), gitFile.source, 'utf8');
      }
    }
  }
  
  private async readLocalFiles(syncFolder: string, gitConfig: any): Promise<any[]> {
    console.error(`🔍 DEBUG: readLocalFiles called for folder: ${syncFolder}`);
    const files: any[] = [];
    const entries = await this.walkDirectory(syncFolder);
    console.error(`📁 DEBUG: Found ${entries.length} total files in directory`);
    
    for (const entry of entries) {
      const relativePath = path.relative(syncFolder, entry);
      console.error(`  📄 DEBUG: Processing file: ${relativePath}`);
      
      // Skip .git and .git-gas
      if (relativePath.startsWith('.git')) {
        console.error(`    ⏭️ DEBUG: Skipping .git file: ${relativePath}`);
        continue;
      }
      
      const content = await fs.readFile(entry, 'utf8');
      const gasFile = await this.transformLocalToGAS(relativePath, content, gitConfig);
      if (gasFile) {
        console.error(`    ✅ DEBUG: Transformed to GAS file: ${gasFile.name} (type: ${gasFile.type})`);
        files.push(gasFile);
      } else {
        console.error(`    ⚠️ DEBUG: File skipped (not GAS compatible): ${relativePath}`);
      }
    }
    
    console.error(`📊 DEBUG: Returning ${files.length} files to push to GAS`);
    return files;
  }
  
  private async walkDirectory(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        files.push(...await this.walkDirectory(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    
    return files;
  }
  
  private async transformGASToLocal(gasFile: any, gitConfig: any): Promise<string> {
    // Handle special transformations
    if (gasFile.name === 'README' && gasFile.type === 'HTML') {
      return 'README.md';
    }
    if (gasFile.name === '.gitignore') {
      return '.gitignore';
    }
    if (gasFile.name.startsWith('.git/')) {
      return '.git-gas/' + gasFile.name.replace('.git/', '');
    }
    
    // Handle folder structure (underscore to slash)
    let localName = gasFile.name.replace(/_/g, '/');
    
    // Add appropriate extension
    if (gasFile.type === 'SERVER_JS') {
      localName += '.js';
    } else if (gasFile.type === 'HTML') {
      localName += '.html';
    } else if (gasFile.type === 'JSON') {
      localName += '.json';
    }
    
    // Apply sync prefix if configured
    if (gitConfig.syncPrefix) {
      localName = path.join(gitConfig.syncPrefix, localName);
    }
    
    return localName;
  }
  
  private async transformLocalToGAS(localPath: string, content: string, gitConfig: any): Promise<any> {
    // Skip non-GAS compatible files
    const ext = path.extname(localPath).toLowerCase();
    if (!['.js', '.gs', '.html', '.json', '.md', ''].includes(ext) && 
        !localPath.includes('.gitignore') && !localPath.includes('.git')) {
      return null;
    }
    
    // Handle README transformation
    if (localPath === 'README.md' || localPath.endsWith('/README.md')) {
      const result = transformMarkdownToHTML(content, localPath);
      return {
        name: 'README',
        type: 'HTML',
        source: result.content
      };
    }
    
    // Handle .gitignore
    if (localPath === '.gitignore' || localPath.endsWith('/.gitignore')) {
      const result = transformDotfileToModule(content, '.gitignore');
      return {
        name: '.gitignore',
        type: 'SERVER_JS',
        source: result.content
      };
    }
    
    // Remove sync prefix if present
    let gasName = localPath;
    if (gitConfig.syncPrefix && gasName.startsWith(gitConfig.syncPrefix)) {
      gasName = gasName.slice(gitConfig.syncPrefix.length);
      if (gasName.startsWith('/')) gasName = gasName.slice(1);
    }
    
    // Convert slashes to underscores for folder structure
    gasName = gasName.replace(/\//g, '_');
    
    // Remove extension
    gasName = gasName.replace(/\.(js|gs|html|json)$/i, '');
    
    // Determine file type
    let fileType = 'SERVER_JS';
    if (ext === '.html') fileType = 'HTML';
    if (ext === '.json') fileType = 'JSON';
    
    // Wrap JavaScript in CommonJS module
    let source = content;
    if (fileType === 'SERVER_JS') {
      source = wrapAsCommonJSModule(content, gasName);
    }
    
    return {
      name: gasName,
      type: fileType,
      source: source
    };
  }
  
  private async pushToGAS(scriptId: string, files: any[], gasClient: GASClient, accessToken: string, transformOptions?: any): Promise<number> {
    console.error(`🔍 DEBUG: pushToGAS called with ${files.length} files`);
    let pushedCount = 0;
    
    for (const file of files) {
      try {
        console.error(`📤 DEBUG: Attempting to push file: ${file.name} (type: ${file.type}, size: ${file.source?.length || 0} bytes)`);
        await gasClient.updateFile(scriptId, file.name, file.source, undefined, accessToken, file.type);
        pushedCount++;
        console.error(`✅ DEBUG: Successfully pushed ${file.name}`);
      } catch (error: any) {
        console.error(`❌ DEBUG: Failed to push ${file.name}: ${error.message}`);
      }
    }
    
    return pushedCount;
  }
  
  private async getCurrentBranch(syncFolder: string): Promise<string> {
    const result = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: syncFolder });
    return result.stdout.trim();
  }
  
  private parseConflicts(statusOutput: string): string[] {
    const conflicts: string[] = [];
    const lines = statusOutput.split('\n');
    for (const line of lines) {
      if (line.startsWith('UU ') || line.startsWith('AA ') || line.startsWith('DD ')) {
        conflicts.push(line.substring(3).trim());
      }
    }
    return conflicts;
  }
  
  private createSuccessResponse(phase: string, filesFromGAS: number, filesMerged: number, syncFolder: string, mergedFiles: string[]): any {
    const response: any = {
      success: true,
      phase: phase,
      filesFromGAS: filesFromGAS,
      syncFolder: syncFolder
    };
    
    if (phase === 'complete') {
      response.filesPushedToGAS = filesMerged;
      response.recommendedActions = {
        primary: 'Push to GitHub to save changes',
        gitCommands: [
          `git -C "${syncFolder}" push origin main`
        ]
      };
    } else if (phase === 'pull') {
      response.filesMerged = filesMerged;
      response.recommendedActions = {
        primary: 'Review merged changes locally',
        alternatives: ['Run full sync to push changes back', 'Commit to git'],
        gitCommands: [
          `git -C "${syncFolder}" diff`,
          `git -C "${syncFolder}" add -A`,
          `git -C "${syncFolder}" commit -m "Pulled from GAS"`
        ]
      };
    }
    
    return response;
  }
  
  private createConflictResponse(conflicts: string[], syncFolder: string): any {
    return {
      success: false,
      phase: 'merge',
      conflicts: conflicts,
      syncFolder: syncFolder,
      message: 'Merge conflicts detected. Resolve locally then run sync again.',
      recommendedActions: {
        primary: 'Resolve conflicts in local files',
        gitCommands: [
          `git -C "${syncFolder}" status`,
          `git -C "${syncFolder}" diff`,
          '# Edit files to resolve conflict markers',
          `git -C "${syncFolder}" add .`,
          `git -C "${syncFolder}" commit -m "Resolved conflicts"`,
          `git_sync({scriptId: '...'})`
        ]
      }
    };
  }
  
  private expandPath(filePath: string): string {
    if (!filePath) return '';
    if (filePath.startsWith('~/')) {
      return path.join(os.homedir(), filePath.slice(2));
    }
    return path.resolve(filePath);
  }
  
  private async isGitRepo(dir: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: dir });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Check git association and sync status
 */
export class GitStatusTool extends BaseTool {
  public name = 'git_status';
  public description = 'Check git association and sync status for a GAS project. Shows local repo state, remote tracking, and recommends next actions. Integrates with git status and GitHub MCP for complete repository visibility.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID to check for git association',
        pattern: '^[a-zA-Z0-9_-]{25,60}$',
        examples: [
          '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789'
        ]
      },
      projectPath: {
        type: 'string',
        description: 'Optional: Check specific nested project within GAS',
        default: '',
        examples: ['', 'subproject1', 'libs/shared']
      }
    },
    required: ['scriptId'],
    additionalProperties: false,
    llmWorkflowGuide: {
      typicalSequence: [
        '1. git_status({scriptId}) - Check if project is git-linked',
        '2. If not linked: git_init({scriptId, repository})',
        '3. If linked: Review sync status and recommendations',
        '4. Follow recommended git/gh commands for next steps'
      ],
      returnValue: {
        hasGitLink: 'boolean - true if .git/config.gs exists',
        repository: 'Git repository URL from config',
        localRepo: 'Path to local git repository',
        branch: 'Current git branch',
        projects: 'Array of all git-enabled projects in GAS',
        syncStatus: {
          exists: 'boolean - local repo exists',
          branch: 'Current local branch',
          ahead: 'Number of commits ahead of remote',
          behind: 'Number of commits behind remote',
          modified: 'Number of modified files',
          untracked: 'Number of untracked files',
          clean: 'boolean - working directory clean'
        },
        recommendedActions: 'Context-specific next steps'
      },
      interoperability: {
        relatedGitCommands: [
          'git status - Check local repository state',
          'git log --oneline -5 - Review recent commits',
          'git remote -v - Check remote configuration',
          'git branch -vv - Show tracking branches'
        ],
        relatedGhCommands: [
          'gh repo view - Check GitHub repository info',
          'gh pr list - View open pull requests',
          'gh run list - Check workflow runs'
        ],
        relatedGithubMcp: [
          'mcp__github__get_repository - Get detailed repo info',
          'mcp__github__list_branches - View all branches',
          'mcp__github__list_commits - Review commit history',
          'mcp__github__get_pull_request - Check PR status'
        ]
      },
      statusInterpretation: {
        'ahead > 0': 'Local has commits not pushed to GitHub - use: git push',
        'behind > 0': 'GitHub has commits not pulled locally - use: git pull',
        'modified > 0': 'Local changes need committing - use: git add && git commit',
        'untracked > 0': 'New files need adding - use: git add',
        'clean = true': 'Everything synced and committed - ready for git_sync'
      }
    }
  };

  async execute(params: any): Promise<any> {
    const scriptId = this.validate.scriptId(params.scriptId, 'git operation');
    const accessToken = await this.getAuthToken(params);
    const gitProjectManager = new GitProjectManager();
    
    try {
      // Check for git config in any project
      const projects = await gitProjectManager.listGitProjects(scriptId, accessToken);
      
      if (projects.length === 0) {
        return {
          hasGitLink: false,
          message: 'Project is not git-linked. Use git_init to create association.',
          recommendedActions: {
            primary: 'Initialize git association',
            gasCommands: [
              `git_init({scriptId: '${scriptId}', repository: 'https://github.com/owner/repo.git'})`
            ]
          }
        };
      }
      
      // Get git config from the first project with one
      const projectPath = projects[0] === '(root)' ? '' : projects[0];
      const gitConfig = await gitProjectManager.getProjectConfig(scriptId, accessToken, projectPath);
      
      if (!gitConfig) {
        throw new ValidationError('.git/config.gs', 'invalid-config', 'Valid git configuration');
      }
      
      const repository = gitConfig.remote?.origin?.url || '';
      const branch = Object.keys(gitConfig.branch || {})[0] || 'main';
      const localPath = (gitConfig as any).sync?.localPath || `~/gas-repos/project-${scriptId}`;
      const localRepo = this.expandPath(localPath);
      
      // Check local repo status
      let gitStatus: any = {};
      if (await this.isGitRepo(localRepo)) {
        const branch = await this.getCurrentBranch(localRepo);
        const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: localRepo });
        const modifiedFiles = status.stdout.split('\n').filter(line => line.trim()).length;
        
        // Check ahead/behind
        let ahead = 0, behind = 0;
        try {
          const revList = await execFileAsync('git', ['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`], { cwd: localRepo });
          const counts = revList.stdout.trim().split('\t');
          behind = parseInt(counts[0]) || 0;
          ahead = parseInt(counts[1]) || 0;
        } catch {
          // No remote or not tracking
        }
        
        gitStatus = {
          branch: branch,
          ahead: ahead,
          behind: behind,
          modified: modifiedFiles,
          clean: modifiedFiles === 0
        };
      }
      
      const response: any = {
        hasGitLink: true,
        repository: repository,
        localRepo: localRepo,
        branch: branch,
        lastSync: (gitConfig as any).sync?.lastSync?.timestamp,
        syncStatus: gitStatus,
        projects: projects  // Show all projects with git configs
      };
      
      // Add recommended actions based on status
      if (gitStatus.ahead > 0) {
        response.recommendedActions = {
          primary: 'Push local changes to GitHub',
          alternatives: ['Sync changes to GAS first'],
          gitCommands: [
            `git -C "${localRepo}" push origin ${gitStatus.branch}`
          ],
          gasCommands: [
            `git_sync({scriptId: '${scriptId}'})`
          ]
        };
      } else if (gitStatus.behind > 0) {
        response.recommendedActions = {
          primary: 'Pull changes from GitHub',
          gitCommands: [
            `git -C "${localRepo}" pull origin ${gitStatus.branch}`
          ],
          gasCommands: [
            `git_sync({scriptId: '${scriptId}'})`
          ]
        };
      } else if (gitStatus.modified > 0) {
        response.recommendedActions = {
          primary: 'Commit local changes',
          gitCommands: [
            `git -C "${localRepo}" add -A`,
            `git -C "${localRepo}" commit -m "Update"`
          ]
        };
      } else {
        response.recommendedActions = {
          primary: 'Everything is in sync',
          alternatives: ['Make changes and sync when ready']
        };
      }
      
      return response;
      
    } catch (error: any) {
      throw new FileOperationError('status', scriptId, error.message || 'Failed to get git status');
    }
  }
  
  private expandPath(filePath: string): string {
    if (!filePath) return '';
    if (filePath.startsWith('~/')) {
      return path.join(os.homedir(), filePath.slice(2));
    }
    return path.resolve(filePath);
  }
  
  private async isGitRepo(dir: string): Promise<boolean> {
    try {
      await fs.access(dir);
      await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: dir });
      return true;
    } catch {
      return false;
    }
  }
  
  private async getCurrentBranch(syncFolder: string): Promise<string> {
    try {
      const result = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: syncFolder });
      return result.stdout.trim();
    } catch {
      return 'main';
    }
  }
}

/**
 * Set or update the local sync folder for a GAS project
 */
export class GitSetSyncFolderTool extends BaseTool {
  public name = 'git_set_sync_folder';
  public description = 'Set or update the local sync folder for a GAS project. Allows relocating where git operations happen locally. Useful for organizing projects or moving to a different directory structure.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID with git association',
        pattern: '^[a-zA-Z0-9_-]{25,60}$',
        examples: ['1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789']
      },
      localPath: {
        type: 'string',
        description: 'New local sync folder path where git operations will occur',
        examples: [
          '~/projects/my-gas-app',      // Home directory path
          './gas-project',               // Relative to current directory
          '/Users/me/dev/gas',          // Absolute path
          '../sibling-folder/project'   // Relative path navigation
        ]
      },
      moveExisting: {
        type: 'boolean',
        description: 'Physically move existing git repo to new location (preserves history)',
        default: false,
        examples: [
          true,   // Move the entire git repo to new location
          false   // Just update config, don't move files
        ]
      }
    },
    required: ['scriptId', 'localPath'],
    additionalProperties: false,
    llmWorkflowGuide: {
      useCases: {
        organize: 'git_set_sync_folder({scriptId, localPath: "~/organized/project", moveExisting: true})',
        rename: 'git_set_sync_folder({scriptId, localPath: "./new-name", moveExisting: true})',
        setup: 'git_set_sync_folder({scriptId, localPath: "~/my-projects/gas"})',
        relocate: 'git_set_sync_folder({scriptId, localPath: "/new/disk/location", moveExisting: true})'
      },
      typicalWorkflow: [
        '1. Check current location: git_get_sync_folder({scriptId})',
        '2. Set new location: git_set_sync_folder({scriptId, localPath, moveExisting})',
        '3. Verify move: git -C <newPath> status',
        '4. Sync if needed: git_sync({scriptId})'
      ],
      interoperability: {
        beforeMove: [
          'git status - Ensure no uncommitted changes',
          'git stash - Save any work in progress',
          'pwd - Note current directory'
        ],
        afterMove: [
          'cd <newPath> - Navigate to new location',
          'git status - Verify repo moved correctly',
          'git remote -v - Check remotes still configured',
          'ls -la - Verify all files present'
        ],
        githubIntegration: [
          'gh repo clone <repo> <newPath> - Alternative: clone fresh',
          'gh repo view --json name,owner - Verify repo details'
        ]
      },
      warnings: [
        '⚠️ Ensure no uncommitted changes before moving',
        '📁 moveExisting:true physically moves the git repo',
        '🔗 Git remotes and history are preserved when moving',
        '📝 Updates .git/config.gs in GAS to track new location'
      ]
    }
  };

  async execute(params: any): Promise<any> {
    const scriptId = this.validate.scriptId(params.scriptId, 'git operation');
    const newPath = this.expandPath(params.localPath);
    const moveExisting = params.moveExisting === true;
    
    const accessToken = await this.getAuthToken(params);
    const gasClient = new GASClient();
    
    try {
      // Get current git config using GitProjectManager
      const gitProjectManager = new GitProjectManager();
      const config = await gitProjectManager.getProjectConfig(scriptId, accessToken, '');
      
      if (!config) {
        throw new ValidationError('git-link', scriptId, 'Project must have .git/config.gs file - run git_init first');
      }
      
      // Get paths from config
      const oldPath = this.expandPath((config as any).sync?.localPath || '');
      
      // Move existing repo if requested
      if (moveExisting && oldPath !== newPath) {
        if (await this.pathExists(oldPath)) {
          // Create parent directory
          await fs.mkdir(path.dirname(newPath), { recursive: true });
          // Move the directory
          await fs.rename(oldPath, newPath);
        }
      } else if (!await this.pathExists(newPath)) {
        // Create new directory
        await fs.mkdir(newPath, { recursive: true });
      }
      
      // Update git config in GAS
      const updatedConfig = {
        ...config,
        sync: {
          ...(config as any).sync,
          localPath: params.localPath
        }
      };
      
      await gitProjectManager.saveGitFile(scriptId, accessToken, '', 'config', serializeINI(updatedConfig));
      
      return {
        success: true,
        oldPath: oldPath,
        newPath: newPath,
        moved: moveExisting && oldPath !== newPath,
        recommendedActions: {
          primary: 'Sync to ensure everything is connected',
          gasCommands: [
            `git_sync({scriptId: '${scriptId}'})`
          ]
        }
      };
      
    } catch (error: any) {
      throw new FileOperationError('set-sync-folder', scriptId, error.message || 'Failed to set sync folder');
    }
  }
  
  private expandPath(filePath: string): string {
    if (!filePath) return '';
    if (filePath.startsWith('~/')) {
      return path.join(os.homedir(), filePath.slice(2));
    }
    return path.resolve(filePath);
  }
  
  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Query the current sync folder for a GAS project
 */
export class GitGetSyncFolderTool extends BaseTool {
  public name = 'git_get_sync_folder';
  public description = 'Query the current sync folder location for a GAS project. Shows where git commands should be run locally. Essential for understanding the local/remote/GAS file structure.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID to query',
        pattern: '^[a-zA-Z0-9_-]{25,60}$',
        examples: ['1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789']
      }
    },
    required: ['scriptId'],
    additionalProperties: false,
    llmWorkflowGuide: {
      purpose: 'Find where project is synced locally to run git commands',
      typicalUsage: [
        '1. git_get_sync_folder({scriptId}) - Find sync location',
        '2. cd <syncFolder> - Navigate to the folder',
        '3. git status - Check repository state',
        '4. Standard git workflow: add, commit, push'
      ],
      returnValue: {
        syncFolder: 'Absolute path to local sync folder',
        exists: 'boolean - Whether folder currently exists',
        isGitRepo: 'boolean - Whether it contains .git directory',
        repository: 'Remote repository URL from config',
        branch: 'Configured branch to track',
        gitStatus: {
          branch: 'Current local git branch',
          clean: 'boolean - Working directory clean',
          modified: 'Number of modified files',
          untracked: 'Number of untracked files'
        },
        recommendedActions: 'Next steps based on current state'
      },
      interoperability: {
        afterQuery: [
          'cd <syncFolder> - Navigate to sync folder',
          'git status - Check current state',
          'git log --oneline -5 - Review recent commits',
          'git remote -v - Verify remote configuration'
        ],
        withGithubMcp: [
          'mcp__github__get_repository - Compare with remote state',
          'mcp__github__list_commits - Review GitHub history',
          'mcp__github__create_pull_request - After pushing changes'
        ],
        withGhCli: [
          'gh repo clone <repository> <syncFolder> - Clone if not exists',
          'gh pr list - Check pull requests',
          'gh repo sync - Sync with upstream'
        ]
      },
      troubleshooting: {
        'exists: false': 'Folder doesn\'t exist - run git_sync to create',
        'isGitRepo: false': 'Not a git repo - clone or init needed',
        'no syncFolder': 'Project not git-linked - run git_init first'
      }
    }
  };

  async execute(params: any): Promise<any> {
    const scriptId = this.validate.scriptId(params.scriptId, 'git operation');
    const accessToken = await this.getAuthToken(params);
    const gasClient = new GASClient();
    
    try {
      // Get git config from GAS using GitProjectManager
      const gitProjectManager = new GitProjectManager();
      const projects = await gitProjectManager.listGitProjects(scriptId, accessToken);
      
      if (projects.length === 0) {
        return {
          hasGitLink: false,
          message: 'Project is not git-linked',
          recommendedActions: {
            primary: 'Initialize git association first',
            gasCommands: [
              `git_init({scriptId: '${scriptId}', repository: 'https://github.com/owner/repo.git'})`
            ]
          }
        };
      }
      
      // Get config from the first project
      const projectPath = projects[0] === '(root)' ? '' : projects[0];
      const config = await gitProjectManager.getProjectConfig(scriptId, accessToken, projectPath);
      
      if (!config) {
        throw new ValidationError('.git/config.gs', 'invalid', 'Valid git configuration');
      }
      
      const gitConfig: any = {
        repository: config.remote?.origin?.url || '',
        branch: Object.keys(config.branch || {})[0] || 'main',
        localPath: (config as any).sync?.localPath || `~/gas-repos/project-${scriptId}`
      };
      
      const syncFolder = gitConfig.localPath ? this.expandPath(gitConfig.localPath) : '';
      
      const response: any = {
        syncFolder: syncFolder,
        exists: await this.pathExists(syncFolder),
        isGitRepo: false,
        gitStatus: null
      };
      
      // Check git status if it's a repo
      if (response.exists && await this.isGitRepo(syncFolder)) {
        response.isGitRepo = true;
        
        const branch = await this.getCurrentBranch(syncFolder);
        const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: syncFolder });
        const clean = status.stdout.trim() === '';
        
        let remoteUrl = '';
        try {
          const remote = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: syncFolder });
          remoteUrl = remote.stdout.trim();
        } catch {
          // No remote
        }
        
        response.gitStatus = {
          branch: branch,
          clean: clean,
          remoteUrl: remoteUrl
        };
      }
      
      return response;
      
    } catch (error: any) {
      throw new FileOperationError('get-sync-folder', scriptId, error.message || 'Failed to get sync folder');
    }
  }
  
  private expandPath(filePath: string): string {
    if (!filePath) return '';
    if (filePath.startsWith('~/')) {
      return path.join(os.homedir(), filePath.slice(2));
    }
    return path.resolve(filePath);
  }
  
  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  private async isGitRepo(dir: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: dir });
      return true;
    } catch {
      return false;
    }
  }
  
  private async getCurrentBranch(syncFolder: string): Promise<string> {
    try {
      const result = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: syncFolder });
      return result.stdout.trim();
    } catch {
      return 'unknown';
    }
  }
}