import { BaseTool } from './base.js';
import { spawn } from 'child_process';
import { LocalFileManager, GitInfo } from '../utils/localFileManager.js';
import { ProjectResolver } from '../utils/projectResolver.js';
import { SessionAuthManager } from '../auth/sessionManager.js';

/**
 * Enhanced git commit tool for Google Apps Script projects
 * Integrates with appsscript.json for git information storage
 */
export class GASGitCommitTool extends BaseTool {
  public name = 'gas_git_commit';
  public description = 'Add and commit currently synced Google Apps Script project files to git with appsscript.json integration';
  
  public inputSchema = {
    type: 'object',
    properties: {
      project: {
        oneOf: [
          {
            type: 'string',
            description: 'Local project name (from .gas-projects.json) OR direct remote script ID (44 chars). If not provided, uses current project from local configuration.'
          },
          {
            type: 'object',
            properties: {
              dev: { type: 'boolean', description: 'Use development environment from local config' },
              staging: { type: 'boolean', description: 'Use staging environment from local config' }, 
              prod: { type: 'boolean', description: 'Use production environment from local config' },
              production: { type: 'boolean', description: 'Use production environment from local config' }
            },
            description: 'Environment shortcut from local configuration (.gas-projects.json)'
          }
        ],
        description: 'Local project reference to commit (defaults to current project if not specified)'
      },
      message: {
        type: 'string',
        description: 'Commit message for the git commit',
        examples: ['Update GAS project files', 'Sync changes from Google Apps Script', 'Add new functions']
      },
      addAll: {
        type: 'boolean',
        description: 'Add all modified files (git add -A) instead of just the current project files',
        default: false
      },
      dryRun: {
        type: 'boolean',
        description: 'Show what would be committed without actually committing',
        default: false
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      }
    },
    required: ['message']
  };

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
  }

  async execute(params: any): Promise<any> {
    const workingDirectory = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    
    // Resolve project parameter to script ID first, then get project name
    const scriptId = await ProjectResolver.resolveProjectId(params.project, workingDirectory);
    const projectName = await ProjectResolver.getProjectNameByScriptId(scriptId, workingDirectory) || 
                        `project-${scriptId.substring(0, 8)}`;
    
    console.error(`🔄 Git operations for project '${projectName}' in: ${workingDirectory}`);

    // Check if we're in a git repository
    try {
      await this.runGitCommand(['rev-parse', '--git-dir'], workingDirectory);
    } catch (error) {
      throw new Error('Not in a git repository. Initialize git first with: git init');
    }

    // Get current git status
    const statusOutput = await this.runGitCommand(['status', '--porcelain'], workingDirectory);
    
    if (!statusOutput.trim()) {
      return {
        success: true,
        projectName,
        message: 'No changes to commit',
        filesChanged: 0
      };
    }

    // Parse git status to show what would be committed
    const changes = this.parseGitStatus(statusOutput);
    const projectFiles = changes.filter(change => 
      change.file.includes(projectName) || change.file.startsWith('gas-projects/')
    );

    if (params.dryRun) {
      return {
        dryRun: true,
        projectName,
        allChanges: changes,
        projectFiles,
        command: params.addAll ? 'git add -A && git commit' : 'git add <project-files> && git commit',
        message: `Would commit ${params.addAll ? changes.length : projectFiles.length} files`
      };
    }

    // Add files to git
    if (params.addAll) {
      await this.runGitCommand(['add', '-A'], workingDirectory);
    } else {
      // Add only project-specific files
      const projectFilePaths = projectFiles.map(change => change.file);
      if (projectFilePaths.length > 0) {
        await this.runGitCommand(['add', ...projectFilePaths], workingDirectory);
      }
    }

    // Commit the changes
    await this.runGitCommand(['commit', '-m', params.message], workingDirectory);
    
    // Get the commit hash
    const commitHash = await this.runGitCommand(['rev-parse', 'HEAD'], workingDirectory);
    
    // Get current branch
    const branchOutput = await this.runGitCommand(['branch', '--show-current'], workingDirectory);
    const branch = branchOutput.trim();

    // Update git information in appsscript.json
    const gitInfo: GitInfo = {
      repository: await this.getGitRemoteUrl(workingDirectory),
      branch: branch,
      commit: commitHash.trim(),
      lastSync: new Date().toISOString(),
      remote: 'origin',
      status: 'clean'
    };

    try {
      await LocalFileManager.updateGitInfo(projectName, gitInfo, workingDirectory);
    } catch (error) {
      console.error('⚠️ Could not update git info in appsscript.json:', error);
    }

    return {
      success: true,
      projectName,
      commitHash: commitHash.trim(),
      branch,
      filesCommitted: params.addAll ? changes.length : projectFiles.length,
      message: `Successfully committed ${params.addAll ? changes.length : projectFiles.length} files to git`,
      gitInfo
    };
  }

  private async runGitCommand(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const git = spawn('git', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      git.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      git.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      git.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Git command failed (exit code ${code}): ${stderr || stdout}`));
        }
      });

      git.on('error', (error) => {
        reject(new Error(`Failed to execute git command: ${error.message}`));
      });
    });
  }

  private async getGitRemoteUrl(cwd: string): Promise<string | undefined> {
    try {
      const remoteUrl = await this.runGitCommand(['config', '--get', 'remote.origin.url'], cwd);
      return remoteUrl.trim();
    } catch (error) {
      return undefined;
    }
  }

  private parseGitStatus(statusOutput: string): Array<{file: string, status: string}> {
    const changes: Array<{file: string, status: string}> = [];
    
    for (const line of statusOutput.trim().split('\n')) {
      if (line.trim()) {
        const status = line.substring(0, 2).trim();
        const file = line.substring(3);
        
        let statusText = '';
        switch (status) {
          case 'M': statusText = 'modified'; break;
          case 'A': statusText = 'added'; break;
          case 'D': statusText = 'deleted'; break;
          case 'R': statusText = 'renamed'; break;
          case 'C': statusText = 'copied'; break;
          case 'U': statusText = 'unmerged'; break;
          case '??': statusText = 'untracked'; break;
          default: statusText = 'unknown'; break;
        }
        
        changes.push({ file, status: statusText });
      }
    }
    
    return changes;
  }
}

/**
 * Enhanced git status tool for Google Apps Script projects
 * Shows git status and integrates with appsscript.json git information
 */
export class GASGitStatusTool extends BaseTool {
  public name = 'gas_git_status';
  public description = 'Show git status of the current Google Apps Script project workspace with appsscript.json integration';
  
  public inputSchema = {
    type: 'object',
    properties: {
      project: {
        oneOf: [
          {
            type: 'string',
            description: 'Local project name (from .gas-projects.json) OR direct remote script ID (44 chars). If not provided, uses current project from local configuration.'
          },
          {
            type: 'object',
            properties: {
              dev: { type: 'boolean', description: 'Use development environment from local config' },
              staging: { type: 'boolean', description: 'Use staging environment from local config' }, 
              prod: { type: 'boolean', description: 'Use production environment from local config' },
              production: { type: 'boolean', description: 'Use production environment from local config' }
            },
            description: 'Environment shortcut from local configuration (.gas-projects.json)'
          }
        ],
        description: 'Local project reference to check status (defaults to current project if not specified)'
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      }
    }
  };

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
  }

  async execute(params: any): Promise<any> {
    const workingDirectory = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    
    // Resolve project parameter to script ID first, then get project name
    const scriptId = await ProjectResolver.resolveProjectId(params.project, workingDirectory);
    const projectName = await ProjectResolver.getProjectNameByScriptId(scriptId, workingDirectory) || 
                        `project-${scriptId.substring(0, 8)}`;

    // Check if we're in a git repository
    try {
      await this.runGitCommand(['rev-parse', '--git-dir'], workingDirectory);
    } catch (error) {
      throw new Error('Not in a git repository. Initialize git first with: git init');
    }

    // Get git status
    const statusOutput = await this.runGitCommand(['status', '--porcelain'], workingDirectory);
    const branchOutput = await this.runGitCommand(['branch', '--show-current'], workingDirectory);
    const branch = branchOutput.trim();

    // Parse git status
    const changes = this.parseGitStatus(statusOutput);
    const projectFiles = changes.filter(change => 
      change.file.includes(projectName) || change.file.startsWith('gas-projects/')
    );

    // Get git information from appsscript.json
    let gitInfo: GitInfo | null = null;
    try {
      gitInfo = await LocalFileManager.getGitInfo(projectName, workingDirectory);
    } catch (error) {
      console.error('⚠️ Could not read git info from appsscript.json:', error);
    }

    // Get remote URL
    let remoteUrl: string | undefined;
    try {
      remoteUrl = await this.getGitRemoteUrl(workingDirectory);
    } catch (error) {
      // No remote configured
    }

    return {
      projectName,
      branch,
      remoteUrl,
      allChanges: changes,
      projectFiles,
      totalChanges: changes.length,
      projectChanges: projectFiles.length,
      gitInfo,
      status: changes.length === 0 ? 'clean' : 'dirty',
      message: `Git status for project '${projectName}': ${changes.length} total changes, ${projectFiles.length} project-specific changes`
    };
  }

  private async runGitCommand(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const git = spawn('git', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      git.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      git.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      git.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Git command failed (exit code ${code}): ${stderr || stdout}`));
        }
      });

      git.on('error', (error) => {
        reject(new Error(`Failed to execute git command: ${error.message}`));
      });
    });
  }

  private async getGitRemoteUrl(cwd: string): Promise<string | undefined> {
    try {
      const remoteUrl = await this.runGitCommand(['config', '--get', 'remote.origin.url'], cwd);
      return remoteUrl.trim();
    } catch (error) {
      return undefined;
    }
  }

  private parseGitStatus(statusOutput: string): Array<{file: string, status: string}> {
    const changes: Array<{file: string, status: string}> = [];
    
    for (const line of statusOutput.trim().split('\n')) {
      if (line.trim()) {
        const status = line.substring(0, 2).trim();
        const file = line.substring(3);
        
        let statusText = '';
        switch (status) {
          case 'M': statusText = 'modified'; break;
          case 'A': statusText = 'added'; break;
          case 'D': statusText = 'deleted'; break;
          case 'R': statusText = 'renamed'; break;
          case 'C': statusText = 'copied'; break;
          case 'U': statusText = 'unmerged'; break;
          case '??': statusText = 'untracked'; break;
          default: statusText = 'unknown'; break;
        }
        
        changes.push({ file, status: statusText });
      }
    }
    
    return changes;
  }
} 