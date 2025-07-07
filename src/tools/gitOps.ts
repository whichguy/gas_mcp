import { BaseTool } from './base.js';
import { LocalFileManager } from '../utils/localFileManager.js';
import { spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';

const execAsync = promisify(spawn);

/**
 * Tool for basic git operations on currently synced GAS project files
 */
export class GASGitCommitTool extends BaseTool {
  public name = 'gas_git_commit';
  public description = 'Add and commit currently synced Google Apps Script project files to git';
  
  public inputSchema = {
    type: 'object' as const,
    properties: {
      message: {
        type: 'string',
        description: 'Commit message for the git commit',
        examples: ['Update GAS project files', 'Sync changes from Google Apps Script', 'Add new functions']
      },
      addAll: {
        type: 'boolean',
        default: false,
        description: 'Add all modified files (git add -A) instead of just the current project files'
      },
      dryRun: {
        type: 'boolean',
        default: false,
        description: 'Show what would be committed without actually committing'
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      }
    },
    required: ['message']
  };

  async execute(args: any): Promise<any> {
    const { message, addAll = false, dryRun = false, workingDir } = args;
    
    try {
      const workingDirectory = LocalFileManager.getResolvedWorkingDirectory(workingDir);
      
      console.error(`🔄 Git operations in: ${workingDirectory}`);
      
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
          message: 'No changes to commit - working tree clean',
          changes: []
        };
      }
      
      // Parse git status to show what would be committed
      const changes = this.parseGitStatus(statusOutput);
      
      if (dryRun) {
        return {
          success: true,
          message: 'Dry run - showing what would be committed',
          changes,
          command: addAll ? 'git add -A && git commit' : 'git add <project-files> && git commit'
        };
      }
      
      // Add files
      if (addAll) {
        await this.runGitCommand(['add', '-A'], workingDirectory);
        console.error('✅ Added all modified files');
      } else {
        // Add only files in the current project directory structure
        const projectFiles = await this.getCurrentProjectFiles(workingDirectory);
        if (projectFiles.length > 0) {
          await this.runGitCommand(['add', ...projectFiles], workingDirectory);
          console.error(`✅ Added ${projectFiles.length} project files`);
        } else {
          console.error('ℹ️ No current project files found to add');
        }
      }
      
      // Commit
      await this.runGitCommand(['commit', '-m', message], workingDirectory);
      console.error('✅ Committed changes');
      
      // Get commit hash
      const commitHash = await this.runGitCommand(['rev-parse', 'HEAD'], workingDirectory);
      
      return {
        success: true,
        message: `Successfully committed changes`,
        commitHash: commitHash.trim(),
        changes,
        filesAdded: addAll ? 'all modified files' : 'current project files only'
      };
      
    } catch (error) {
      console.error('❌ Git commit failed:', error);
      throw new Error(`Git commit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  
  private parseGitStatus(statusOutput: string): Array<{file: string, status: string}> {
    return statusOutput
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const status = line.substring(0, 2);
        const file = line.substring(3);
        return {
          file,
          status: this.getStatusDescription(status)
        };
      });
  }
  
  private getStatusDescription(status: string): string {
    const statusMap: Record<string, string> = {
      'M ': 'modified',
      'A ': 'added',
      'D ': 'deleted',
      'R ': 'renamed',
      'C ': 'copied',
      '??': 'untracked',
      'AM': 'added, modified',
      'MM': 'modified, modified'
    };
    return statusMap[status] || status;
  }
  
  private async getCurrentProjectFiles(workingDirectory: string): Promise<string[]> {
    const files: string[] = [];
    
    // Look for common GAS project file patterns
    const patterns = [
      'src/**/*.gs',
      'src/**/*.js', 
      'src/**/*.html',
      'src/**/*.json',
      'gas-projects/**/*',
      'mcp-gas-config.json',
      '.gas-*'
    ];
    
    // For now, just return files that exist in common project locations
    const commonPaths = [
      'src',
      'gas-projects', 
      'mcp-gas-config.json'
    ];
    
    for (const pathToCheck of commonPaths) {
      const fullPath = path.join(workingDirectory, pathToCheck);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isFile() || stat.isDirectory()) {
          files.push(pathToCheck);
        }
      } catch (error) {
        // File doesn't exist, skip
      }
    }
    
    return files;
  }
}

/**
 * Tool to show git status of the current project
 */
export class GASGitStatusTool extends BaseTool {
  public name = 'gas_git_status';
  public description = 'Show git status of the current Google Apps Script project workspace';
  
  public inputSchema = {
    type: 'object' as const,
    properties: {
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      }
    },
    required: []
  };

  async execute(args: any): Promise<any> {
    const { workingDir } = args;
    
    try {
      const workingDirectory = LocalFileManager.getResolvedWorkingDirectory(workingDir);
      
      // Check if we're in a git repository
      try {
        await this.runGitCommand(['rev-parse', '--git-dir'], workingDirectory);
      } catch (error) {
        throw new Error('Not in a git repository. Initialize git first with: git init');
      }
      
      // Get git status
      const statusOutput = await this.runGitCommand(['status', '--porcelain'], workingDirectory);
      const branchOutput = await this.runGitCommand(['branch', '--show-current'], workingDirectory);
      
      const changes = statusOutput
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const status = line.substring(0, 2);
          const file = line.substring(3);
          return {
            file,
            status: this.getStatusDescription(status)
          };
        });
      
      return {
        success: true,
        branch: branchOutput.trim(),
        workingDirectory,
        changes,
        hasChanges: changes.length > 0,
        summary: changes.length === 0 
          ? 'Working tree clean' 
          : `${changes.length} file(s) with changes`
      };
      
    } catch (error) {
      console.error('❌ Git status failed:', error);
      throw new Error(`Git status failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  
  private getStatusDescription(status: string): string {
    const statusMap: Record<string, string> = {
      'M ': 'modified',
      'A ': 'added',
      'D ': 'deleted',
      'R ': 'renamed',
      'C ': 'copied',
      '??': 'untracked',
      'AM': 'added, modified',
      'MM': 'modified, modified'
    };
    return statusMap[status] || status;
  }
} 