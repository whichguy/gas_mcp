/**
 * Generic Configuration Tool
 *
 * Provides unified interface for managing MCP Gas configuration including
 * sync folder locations and other project settings.
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ValidationError, FileOperationError } from '../errors/mcpErrors.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { GitProjectManager } from '../utils/GitProjectManager.js';
import { serializeINI } from '../utils/iniParser.js';

const execFileAsync = promisify(execFile);

/**
 * Unified configuration tool for MCP Gas settings
 */
export class ConfigTool extends BaseTool {
  public name = 'config';
  public description = 'Generic configuration tool for managing MCP Gas settings including sync folder locations, project settings, and other configuration options.';

  public inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['get', 'set'],
        description: 'Configuration action to perform',
        examples: ['get', 'set']
      },
      type: {
        type: 'string',
        enum: ['sync_folder'],
        description: 'Type of configuration to manage',
        default: 'sync_folder',
        examples: ['sync_folder']
      },
      ...SchemaFragments.scriptId,
      // Parameters for 'set' action
      value: {
        type: 'string',
        description: 'Configuration value (for set action). For sync_folder: the new local path',
        examples: [
          '~/projects/my-gas-app',
          './gas-project',
          '/Users/me/dev/gas',
          '../sibling-folder/project'
        ]
      },
      moveExisting: {
        type: 'boolean',
        description: 'For sync_folder: physically move existing git repo to new location (preserves history)',
        default: false,
        examples: [true, false]
      }
    },
    required: ['action', 'scriptId'],
    additionalProperties: false,
    llmGuidance: {
      actions: 'get: query sync_folder path | set: update sync_folder location',
      moveExisting: 'physically moves git repo preserving history + updates .git/config.gs',
      workflow: 'before move: git status/stash | after: cd <path> + local_sync'
    }
  };

  async execute(params: any): Promise<any> {
    const action = params.action;
    const type = params.type || 'sync_folder';
    const scriptId = this.validate.scriptId(params.scriptId, 'config operation');

    if (type === 'sync_folder') {
      if (action === 'get') {
        return this.getSyncFolder(scriptId, params);
      } else if (action === 'set') {
        if (!params.value) {
          throw new ValidationError('value', params.value, 'value is required for set action');
        }
        return this.setSyncFolder(scriptId, params.value, params.moveExisting === true, params);
      } else {
        throw new ValidationError('action', action, 'Must be "get" or "set"');
      }
    } else {
      throw new ValidationError('type', type, 'Currently only "sync_folder" is supported');
    }
  }

  /**
   * Get sync folder configuration
   */
  private async getSyncFolder(scriptId: string, params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);

    try {
      const gitProjectManager = new GitProjectManager();
      const projects = await gitProjectManager.listGitProjects(scriptId, accessToken);

      if (projects.length === 0) {
        return {
          hasGitLink: false,
          message: 'Project is not git-linked',
          recommendedActions: {
            primary: 'Create .git/config.gs breadcrumb manually',
            gasCommands: [
              `write({scriptId: '${scriptId}', fileName: '.git/config.gs', content: '[remote "origin"]\\n\\turl = https://github.com/owner/repo.git\\n[branch "main"]'})`
            ],
            description: 'Manually create .git/config.gs breadcrumb in GAS first, then create local git repo'
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
        repository: gitConfig.repository,
        branch: gitConfig.branch,
        gitStatus: null,
        recommendedActions: null
      };

      // Check git status if it's a repo
      if (response.exists && await this.isGitRepo(syncFolder)) {
        response.isGitRepo = true;

        const branch = await this.getCurrentBranch(syncFolder);
        const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: syncFolder });
        const statusLines = status.stdout.trim().split('\n').filter(line => line.trim());
        const clean = statusLines.length === 0;

        // Count modified and untracked files
        let modified = 0;
        let untracked = 0;
        for (const line of statusLines) {
          if (line.startsWith('??')) {
            untracked++;
          } else {
            modified++;
          }
        }

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
          modified: modified,
          untracked: untracked
        };

        // Add recommended actions based on state
        if (!clean) {
          response.recommendedActions = {
            primary: 'Commit changes locally',
            gitCommands: [
              `git -C "${syncFolder}" status`,
              `git -C "${syncFolder}" add -A`,
              `git -C "${syncFolder}" commit -m "Update from GAS"`,
              `git -C "${syncFolder}" push origin ${branch}`
            ]
          };
        } else {
          response.recommendedActions = {
            primary: 'Sync with GAS or work with git',
            alternatives: [
              'Run local_sync to pull latest from GAS',
              'Make changes and commit to git',
              'Push changes to GitHub'
            ],
            gitCommands: [
              `cd "${syncFolder}"`,
              `git log --oneline -5`,
              `git push origin ${branch}`
            ],
            gasCommands: [
              `local_sync({scriptId: '${scriptId}'})`
            ]
          };
        }
      } else if (!response.exists) {
        response.recommendedActions = {
          primary: 'Run local_sync to create folder',
          gasCommands: [
            `local_sync({scriptId: '${scriptId}'})`
          ]
        };
      } else if (!response.isGitRepo) {
        response.recommendedActions = {
          primary: 'Initialize git repo or clone from remote',
          gitCommands: response.repository && response.repository !== 'local' ? [
            `git clone ${response.repository} "${syncFolder}"`
          ] : [
            `git -C "${syncFolder}" init`,
            `git -C "${syncFolder}" checkout -b ${response.branch}`
          ]
        };
      }

      return response;

    } catch (error: any) {
      throw new FileOperationError('get-sync-folder', scriptId, error.message || 'Failed to get sync folder');
    }
  }

  /**
   * Set sync folder configuration
   */
  private async setSyncFolder(scriptId: string, newPath: string, moveExisting: boolean, params: any): Promise<any> {
    const expandedPath = this.expandPath(newPath);
    const accessToken = await this.getAuthToken(params);

    try {
      // Get current git config using GitProjectManager
      const gitProjectManager = new GitProjectManager();
      const config = await gitProjectManager.getProjectConfig(scriptId, accessToken, '');

      if (!config) {
        throw new ValidationError('git-link', scriptId,
          'Project must have .git/config.gs file.\n' +
          'Manually create breadcrumb: write({scriptId, fileName: ".git/config.gs", content: "[remote \\"origin\\"]\\nurl = https://github.com/user/repo.git"})'
        );
      }

      // Get current path from config
      const oldPath = this.expandPath((config as any).sync?.localPath || '');

      // Move existing repo if requested
      if (moveExisting && oldPath !== expandedPath) {
        if (await this.pathExists(oldPath)) {
          // Create parent directory
          await fs.mkdir(path.dirname(expandedPath), { recursive: true });
          // Move the directory
          await fs.rename(oldPath, expandedPath);
        }
      } else if (!await this.pathExists(expandedPath)) {
        // Create new directory
        await fs.mkdir(expandedPath, { recursive: true });
      }

      // Update git config in GAS
      const updatedConfig = {
        ...config,
        sync: {
          ...(config as any).sync,
          localPath: newPath
        }
      };

      await gitProjectManager.saveGitFile(scriptId, accessToken, '', 'config', serializeINI(updatedConfig));

      return {
        success: true,
        type: 'sync_folder',
        oldPath: oldPath,
        newPath: expandedPath,
        moved: moveExisting && oldPath !== expandedPath,
        recommendedActions: {
          primary: 'Sync to ensure everything is connected',
          gasCommands: [
            `local_sync({scriptId: '${scriptId}'})`
          ]
        }
      };

    } catch (error: any) {
      throw new FileOperationError('set-sync-folder', scriptId, error.message || 'Failed to set sync folder');
    }
  }

  // Utility methods

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
