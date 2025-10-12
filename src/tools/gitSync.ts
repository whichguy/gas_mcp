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
import { SchemaFragments } from '../utils/schemaFragments.js';
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

// git_init tool removed - user must manually create .git/config.gs breadcrumb in GAS

/**
 * Sync entire GAS project to local filesystem with git-aware organization
 *
 * REQUIRES: .git/config.gs breadcrumb must already exist in GAS project
 *
 * WORKFLOW:
 * 1. Manually create .git/config.gs in GAS with git metadata
 * 2. Create local git repo: git init && git remote add origin <url>
 * 3. Run local_sync: Syncs files between GAS and local
 * 4. Standard git: git add, commit, push
 */
export class LocalSyncTool extends BaseTool {
  public name = 'local_sync';
  public description = 'Sync GAS project with local git repo. REQUIRES .git/config.gs breadcrumb in GAS. ALWAYS pulls from GAS first, merges intelligently, then pushes back. Does NOT auto-create breadcrumbs.';

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
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
      model: '.git/config.gs REQUIRED in GAS | NO auto-bootstrap | Multi-repo supported',
      setup: ['1. write .git/config.gs in GAS', '2. mkdir+git init+remote', '3. local_sync', '4. git add+commit+push'],
      usage: 'firstTime: .git/config.gs→git init→local_sync | after GAS edit: local_sync | directions: sync|pull-only|push-only',
      behavior: 'ALWAYS pull first | merge intelligently | push only if merge succeeds | stop on conflicts',
      conflicts: '.git-gas/ folder | manual edit | local_sync again | forceOverwrite (dangerous)'
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
        throw new ValidationError('git-link', scriptId,
          'No .git/config.gs breadcrumb found in GAS project.\n' +
          'You must manually create .git/config.gs in GAS first.\n' +
          'Example: write({scriptId, fileName: ".git/config.gs", content: "[remote \\"origin\\"]\\nurl = https://github.com/user/repo\\n[branch \\"main\\"]"})'
        );
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
            .map(r => `local_sync({scriptId: '${scriptId}', projectPath: '${r.projectPath === '(root)' ? '' : r.projectPath}'})`)
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

    // REQUIRE breadcrumb - no auto-bootstrap
    if (!gitConfig) {
      throw new ValidationError('git-link', `${projectPath || 'root'}`,
        `No .git/config.gs breadcrumb found in GAS project at path: ${projectPath || 'root'}.\n` +
        'You must manually create .git/config.gs in GAS first.\n' +
        'Example: write({scriptId, fileName: ".git/config.gs", content: "[remote \\"origin\\"]\\nurl = https://github.com/user/repo\\n[branch \\"main\\"]"})'
      );
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
          `local_sync({scriptId: '...'})`
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

