/**
 * WorktreeAddOperation - Creates a new worktree with GAS project + git branch
 *
 * Steps:
 * 1. Validate parent exists and get project info
 * 2. Generate sanitized branch name with UUID suffix
 * 3. Determine container type (standalone vs bound)
 * 4. Create new GAS project (standalone or copy container)
 * 5. Initialize parent git repo if needed
 * 6. Create git worktree with new branch
 * 7. Copy files from parent to worktree
 * 8. Push files to new GAS project
 * 9. Record entry in gas-config.json
 * 10. Optionally claim for calling agent
 */

import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { GASClient, GASFile } from '../../../api/gasClient.js';
import { WorktreeLockManager } from '../WorktreeLockManager.js';
import { WorktreeStateManager } from '../WorktreeStateManager.js';
import { McpGasConfigManager } from '../../../config/mcpGasConfig.js';
import {
  WorktreeAddInput,
  WorktreeAddResult,
  WorktreeError,
  WorktreeEntry,
  WorktreeInfo,
  ContainerType,
  generateBranchName,
  sanitizeBranchName
} from '../../../types/worktreeTypes.js';
import { computeGitSha1 } from '../../../utils/hashUtils.js';
import { LocalFileManager } from '../../../utils/localFileManager.js';

/**
 * Execute git command safely using spawn with array arguments
 */
function execGitCommand(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    git.stdout.on('data', (data) => { stdout += data.toString(); });
    git.stderr.on('data', (data) => { stderr += data.toString(); });

    git.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Git command failed with exit code ${code}`));
      }
    });

    git.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Check if directory exists
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Get local git repo path for a script
 */
function getLocalGitPath(scriptId: string): string {
  return LocalFileManager.resolveProjectPath(scriptId);
}

/**
 * WorktreeAddOperation class
 */
export class WorktreeAddOperation {
  private gasClient: GASClient;
  private lockManager: WorktreeLockManager;
  private stateManager: WorktreeStateManager;

  constructor(gasClient: GASClient) {
    this.gasClient = gasClient;
    this.lockManager = WorktreeLockManager.getInstance();
    this.stateManager = WorktreeStateManager.getInstance();
  }

  /**
   * Execute the add operation
   */
  async execute(
    params: WorktreeAddInput,
    accessToken: string
  ): Promise<WorktreeAddResult | WorktreeError> {
    const { parentScriptId, branchName, claimImmediately = true, agentId } = params;

    console.error(`🔧 [WORKTREE-ADD] Starting add operation for parent ${parentScriptId}`);

    // Initialize the API client to enable Drive API access
    await this.gasClient.initializeClient(accessToken);

    return this.lockManager.withLock('worktree:add', async () => {
      // Step 1: Validate parent project exists
      const parentProject = await this.getParentProject(parentScriptId, accessToken);
      if ('error' in parentProject) {
        return parentProject;
      }

      // Step 2: Generate branch name
      const fullBranchName = generateBranchName(branchName);
      console.error(`🔧 [WORKTREE-ADD] Generated branch name: ${fullBranchName}`);

      // Step 3: Determine container type
      const containerInfo = await this.getContainerInfo(parentProject, accessToken);

      // Step 4: Create new GAS project
      const newProject = await this.createWorktreeProject(
        parentProject,
        containerInfo,
        fullBranchName,
        accessToken
      );
      if ('error' in newProject) {
        return newProject;
      }

      console.error(`🔧 [WORKTREE-ADD] Created new GAS project: ${newProject.scriptId}`);

      // Step 5: Initialize parent git repo if needed
      const parentGitPath = getLocalGitPath(parentScriptId);
      const parentGitInitialized = await this.ensureParentGitInitialized(
        parentScriptId,
        parentGitPath,
        accessToken
      );
      if ('error' in parentGitInitialized) {
        // Cleanup: delete created GAS project
        await this.cleanupFailedWorktree(newProject.scriptId, accessToken);
        return parentGitInitialized;
      }

      // Step 6: Create git worktree
      const worktreePath = getLocalGitPath(newProject.scriptId);
      const worktreeCreated = await this.createGitWorktree(
        parentGitPath,
        worktreePath,
        fullBranchName
      );
      if ('error' in worktreeCreated) {
        await this.cleanupFailedWorktree(newProject.scriptId, accessToken);
        return worktreeCreated;
      }

      console.error(`🔧 [WORKTREE-ADD] Created git worktree at: ${worktreePath}`);

      // Step 7: Copy files from parent git to worktree (already done by git worktree add)
      // The worktree inherits files from the branch point

      // Step 8: Push files to new GAS project
      const filesPushed = await this.pushFilesToWorktree(
        newProject.scriptId,
        worktreePath,
        accessToken
      );
      if ('error' in filesPushed) {
        await this.cleanupFailedWorktree(newProject.scriptId, accessToken, worktreePath, fullBranchName, parentGitPath);
        return filesPushed;
      }

      // Step 9: Compute base hashes for conflict detection
      const baseHashes = await this.computeBaseHashes(worktreePath);

      // Step 10: Record entry in config
      const entry: WorktreeEntry = {
        scriptId: newProject.scriptId,
        parentScriptId,
        containerId: containerInfo.containerId,
        parentContainerId: containerInfo.parentContainerId,
        containerType: containerInfo.containerType,
        branch: fullBranchName,
        localPath: worktreePath,
        state: claimImmediately ? 'CLAIMED' : 'READY',
        claimedBy: claimImmediately ? (agentId || `agent-${Date.now()}`) : undefined,
        claimedAt: claimImmediately ? new Date().toISOString() : undefined,
        createdAt: new Date().toISOString(),
        baseHashes,
        baseHashesUpdatedAt: new Date().toISOString()
      };

      try {
        await this.lockManager.addWorktreeEntry(entry);
      } catch (error: any) {
        // Config write failed - cleanup all created resources
        console.error(`⚠️  [WORKTREE-ADD] Config write failed, cleaning up:`, error);
        await this.cleanupFailedWorktree(
          newProject.scriptId,
          accessToken,
          worktreePath,
          fullBranchName,
          parentGitPath,
          containerInfo.containerId
        );
        return {
          success: false,
          error: 'API_ERROR',
          message: `Failed to save worktree config: ${error.message}`
        };
      }

      console.error(`✅ [WORKTREE-ADD] Successfully created worktree ${newProject.scriptId}`);

      // Return result
      const worktreeInfo: WorktreeInfo = {
        scriptId: entry.scriptId,
        parentScriptId: entry.parentScriptId,
        branch: entry.branch,
        localPath: entry.localPath,
        state: entry.state,
        containerId: entry.containerId,
        containerType: entry.containerType,
        claimedBy: entry.claimedBy,
        claimedAt: entry.claimedAt,
        createdAt: entry.createdAt
      };

      return {
        success: true,
        worktree: worktreeInfo
      };
    });
  }

  /**
   * Get parent project details
   */
  private async getParentProject(
    scriptId: string,
    accessToken: string
  ): Promise<{ scriptId: string; title: string; parentId?: string } | WorktreeError> {
    try {
      const project = await this.gasClient.getProject(scriptId, accessToken);
      return {
        scriptId: project.scriptId,
        title: project.title,
        parentId: project.parentId
      };
    } catch (error: any) {
      return {
        success: false,
        error: 'PARENT_NOT_FOUND',
        message: `Failed to access parent project ${scriptId}: ${error.message}`
      };
    }
  }

  /**
   * Get container information for the parent project
   */
  private async getContainerInfo(
    parentProject: { scriptId: string; title: string; parentId?: string },
    accessToken: string
  ): Promise<{ containerType: ContainerType; containerId?: string; parentContainerId?: string }> {
    if (!parentProject.parentId) {
      // Standalone project
      return { containerType: 'STANDALONE' };
    }

    // Container-bound - determine type by querying Drive
    try {
      const driveApi = this.gasClient.getDriveApi();
      const response = await driveApi.files.get({
        fileId: parentProject.parentId,
        fields: 'mimeType'
      });

      const mimeType = response.data.mimeType;
      let containerType: ContainerType = 'STANDALONE';

      if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        containerType = 'SHEETS';
      } else if (mimeType === 'application/vnd.google-apps.document') {
        containerType = 'DOCS';
      } else if (mimeType === 'application/vnd.google-apps.form') {
        containerType = 'FORMS';
      } else if (mimeType === 'application/vnd.google-apps.presentation') {
        containerType = 'SLIDES';
      }

      return {
        containerType,
        parentContainerId: parentProject.parentId
      };
    } catch (error) {
      console.error(`⚠️  [WORKTREE-ADD] Failed to determine container type, defaulting to STANDALONE`);
      return { containerType: 'STANDALONE' };
    }
  }

  /**
   * Create the worktree GAS project
   *
   * For standalone: Create new project
   * For container-bound: Copy the container (which includes bound script)
   */
  private async createWorktreeProject(
    parentProject: { scriptId: string; title: string; parentId?: string },
    containerInfo: { containerType: ContainerType; containerId?: string; parentContainerId?: string },
    branchName: string,
    accessToken: string
  ): Promise<{ scriptId: string; containerId?: string } | WorktreeError> {
    const worktreeTitle = `[WT] ${parentProject.title} - ${branchName.substring(0, 30)}`;

    if (containerInfo.containerType === 'STANDALONE') {
      // Create standalone project
      try {
        const newProject = await this.gasClient.createProject(worktreeTitle, undefined, accessToken);
        return { scriptId: newProject.scriptId };
      } catch (error: any) {
        return {
          success: false,
          error: 'API_ERROR',
          message: `Failed to create standalone project: ${error.message}`
        };
      }
    }

    // Container-bound: Copy the container using Drive API
    try {
      const driveApi = this.gasClient.getDriveApi();

      // Copy the container (this also copies the bound script)
      const copyResponse = await driveApi.files.copy({
        fileId: containerInfo.parentContainerId,
        requestBody: {
          name: worktreeTitle
        }
      });

      const newContainerId = copyResponse.data.id;
      console.error(`🔧 [WORKTREE-ADD] Copied container: ${newContainerId}`);

      // Find the script bound to the new container
      const scriptResponse = await driveApi.files.list({
        q: `'${newContainerId}' in parents and mimeType='application/vnd.google-apps.script'`,
        fields: 'files(id)'
      });

      const scripts = scriptResponse.data.files || [];
      if (scripts.length === 0) {
        // No script found - container might not have had a bound script
        // Cleanup and fail
        await driveApi.files.delete({ fileId: newContainerId! });
        return {
          success: false,
          error: 'CONTAINER_COPY_FAILED',
          message: 'Copied container but no bound script found'
        };
      }

      return {
        scriptId: scripts[0].id!,
        containerId: newContainerId!
      };
    } catch (error: any) {
      return {
        success: false,
        error: 'CONTAINER_COPY_FAILED',
        message: `Failed to copy container: ${error.message}`
      };
    }
  }

  /**
   * Ensure parent git repo is initialized
   */
  private async ensureParentGitInitialized(
    parentScriptId: string,
    parentGitPath: string,
    accessToken: string
  ): Promise<{ initialized: true } | WorktreeError> {
    const gitExists = await directoryExists(path.join(parentGitPath, '.git'));

    if (gitExists) {
      console.error(`🔧 [WORKTREE-ADD] Parent git repo exists at: ${parentGitPath}`);
      return { initialized: true };
    }

    // Initialize git repo
    console.error(`🔧 [WORKTREE-ADD] Initializing parent git repo at: ${parentGitPath}`);

    try {
      // Create directory
      await fs.mkdir(parentGitPath, { recursive: true });

      // Initialize git
      await execGitCommand(['init'], parentGitPath);

      // Set git config defaults if no global config
      try {
        await execGitCommand(['config', 'user.name'], parentGitPath);
      } catch {
        await execGitCommand(['config', 'user.name', 'MCP Gas'], parentGitPath);
        await execGitCommand(['config', 'user.email', 'mcp@gas.local'], parentGitPath);
      }

      // Pull files from GAS project
      const files = await this.gasClient.getProjectContent(parentScriptId, accessToken);
      await this.writeFilesToLocal(parentGitPath, files);

      // Initial commit
      await execGitCommand(['add', '-A'], parentGitPath);
      await execGitCommand(['commit', '-m', 'Initial sync from GAS'], parentGitPath);

      console.error(`✅ [WORKTREE-ADD] Initialized parent git repo`);
      return { initialized: true };
    } catch (error: any) {
      return {
        success: false,
        error: 'GIT_ERROR',
        message: `Failed to initialize parent git: ${error.message}`
      };
    }
  }

  /**
   * Create git worktree for the new branch
   */
  private async createGitWorktree(
    parentGitPath: string,
    worktreePath: string,
    branchName: string
  ): Promise<{ created: true } | WorktreeError> {
    try {
      // Check if branch already exists
      try {
        await execGitCommand(['rev-parse', '--verify', branchName], parentGitPath);
        // Branch exists - delete it first if not a worktree
        console.error(`⚠️  [WORKTREE-ADD] Branch ${branchName} already exists, deleting...`);
        await execGitCommand(['branch', '-D', branchName], parentGitPath);
      } catch {
        // Branch doesn't exist - good
      }

      // Create worktree with new branch
      // git worktree add <path> -b <branch>
      await execGitCommand(['worktree', 'add', worktreePath, '-b', branchName], parentGitPath);

      return { created: true };
    } catch (error: any) {
      return {
        success: false,
        error: 'GIT_ERROR',
        message: `Failed to create git worktree: ${error.message}`
      };
    }
  }

  /**
   * Push files to the new worktree GAS project
   */
  private async pushFilesToWorktree(
    scriptId: string,
    worktreePath: string,
    accessToken: string
  ): Promise<{ pushed: true } | WorktreeError> {
    try {
      // Read files from local worktree
      const files = await this.readFilesFromLocal(worktreePath);

      if (files.length === 0) {
        return {
          success: false,
          error: 'SYNC_FAILED',
          message: 'No files found in worktree to push'
        };
      }

      // Push to GAS
      await this.gasClient.updateProjectContent(scriptId, files, accessToken);

      console.error(`✅ [WORKTREE-ADD] Pushed ${files.length} files to worktree GAS`);
      return { pushed: true };
    } catch (error: any) {
      return {
        success: false,
        error: 'RSYNC_PUSH_FAILED',
        message: `Failed to push files to worktree: ${error.message}`
      };
    }
  }

  /**
   * Compute base hashes for all files (for conflict detection)
   */
  private async computeBaseHashes(localPath: string): Promise<Record<string, string>> {
    const hashes: Record<string, string> = {};

    try {
      const entries = await fs.readdir(localPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && (entry.name.endsWith('.gs') || entry.name.endsWith('.html') || entry.name === 'appsscript.json')) {
          const filePath = path.join(localPath, entry.name);
          const content = await fs.readFile(filePath, 'utf-8');
          hashes[entry.name] = computeGitSha1(content);
        }
      }
    } catch (error) {
      console.error(`⚠️  [WORKTREE-ADD] Failed to compute base hashes:`, error);
    }

    return hashes;
  }

  /**
   * Write GAS files to local directory
   */
  private async writeFilesToLocal(localPath: string, files: GASFile[]): Promise<void> {
    for (const file of files) {
      const extension = file.type === 'HTML' ? '.html' : '.gs';
      const fileName = file.name.endsWith(extension) ? file.name : `${file.name}${extension}`;
      const filePath = path.join(localPath, fileName);
      await fs.writeFile(filePath, file.source || '', 'utf-8');
    }
  }

  /**
   * Read local files as GASFile format
   */
  private async readFilesFromLocal(localPath: string): Promise<GASFile[]> {
    const files: GASFile[] = [];
    const entries = await fs.readdir(localPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name);
      if (!['.gs', '.html', '.json'].includes(ext)) continue;
      if (entry.name.startsWith('.')) continue; // Skip hidden files

      const filePath = path.join(localPath, entry.name);
      const content = await fs.readFile(filePath, 'utf-8');

      // Determine file type
      let type: 'SERVER_JS' | 'HTML' | 'JSON' = 'SERVER_JS';
      if (ext === '.html') {
        type = 'HTML';
      } else if (ext === '.json') {
        type = 'JSON';
      }

      // Remove extension for GAS file name (except .json for appsscript.json)
      const name = entry.name === 'appsscript.json'
        ? 'appsscript'
        : entry.name.replace(/\.(gs|html)$/, '');

      files.push({
        name,
        type,
        source: content
      });
    }

    return files;
  }

  /**
   * Cleanup failed worktree creation
   */
  private async cleanupFailedWorktree(
    scriptId: string,
    accessToken: string,
    worktreePath?: string,
    branchName?: string,
    parentGitPath?: string,
    containerId?: string
  ): Promise<void> {
    console.error(`🧹 [WORKTREE-ADD] Cleaning up failed worktree: ${scriptId}`);

    const driveApi = this.gasClient.getDriveApi();

    // Try to trash the GAS project
    try {
      await driveApi.files.update({
        fileId: scriptId,
        requestBody: { trashed: true }
      });
      console.error(`🧹 [WORKTREE-ADD] Trashed GAS project`);
    } catch (error) {
      console.error(`⚠️  [WORKTREE-ADD] Failed to trash GAS project:`, error);
    }

    // Trash container if created (for container-bound projects)
    if (containerId) {
      try {
        await driveApi.files.update({
          fileId: containerId,
          requestBody: { trashed: true }
        });
        console.error(`🧹 [WORKTREE-ADD] Trashed container`);
      } catch (error) {
        console.error(`⚠️  [WORKTREE-ADD] Failed to trash container:`, error);
      }
    }

    // Remove git worktree if created
    if (worktreePath && parentGitPath) {
      try {
        await execGitCommand(['worktree', 'remove', '--force', worktreePath], parentGitPath);
        console.error(`🧹 [WORKTREE-ADD] Removed git worktree`);
      } catch (error) {
        console.error(`⚠️  [WORKTREE-ADD] Failed to remove git worktree:`, error);
      }
    }

    // Delete branch if created
    if (branchName && parentGitPath) {
      try {
        await execGitCommand(['branch', '-D', branchName], parentGitPath);
        console.error(`🧹 [WORKTREE-ADD] Deleted branch`);
      } catch (error) {
        console.error(`⚠️  [WORKTREE-ADD] Failed to delete branch:`, error);
      }
    }
  }
}
