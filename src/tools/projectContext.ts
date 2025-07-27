import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ProjectResolver, ProjectParam } from '../utils/projectResolver.js';
import { LocalFileManager } from '../utils/localFileManager.js';
import { ValidationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';

/**
 * Set current project and cache files locally with enhanced sync capabilities
 * Leverages existing gas_info, gas_ls, and gas_cat functions with comprehensive auto-sync
 */
export class GASProjectSetTool extends BaseTool {
  public name = 'gas_project_set';
  public description = 'Set current project and cache files locally for editing';
  
  public inputSchema = {
    type: 'object',
    properties: {
      project: {
        oneOf: [
          {
            type: 'string',
            description: 'Local project name (from .gas-projects.json) or direct script ID (44 chars)'
          },
          {
            type: 'object',
            properties: {
              dev: { type: 'boolean', description: 'Use development environment' },
              staging: { type: 'boolean', description: 'Use staging environment' }, 
              prod: { type: 'boolean', description: 'Use production environment' },
              production: { type: 'boolean', description: 'Use production environment' }
            },
            description: 'Environment shortcut from local configuration'
          }
        ],
        description: 'Local project reference to set as current (name, script ID, or environment)'
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      },
      autoPull: {
        type: 'boolean',
        description: 'Automatically pull remote files to ./src/ after setting project',
        default: true
      },
      syncStrategy: {
        type: 'string',
        description: 'How to handle sync conflicts and missing files',
        enum: ['conservative', 'force', 'manual'],
        default: 'conservative'
      },
      createGitRepo: {
        type: 'boolean', 
        description: 'Initialize git repository for version control if not exists',
        default: true
      },
      syncOnConflict: {
        type: 'string',
        description: 'How to handle sync conflicts',
        enum: ['ask', 'warn', 'abort'],
        default: 'warn'
      },
      pullMissingFiles: {
        type: 'boolean',
        description: 'Automatically pull files that exist remotely but not locally',
        default: true
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    },
    required: ['project']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    const { LocalFileManager } = await import('../utils/localFileManager.js');
    const workingDir = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    
    // Enhanced parameters with defaults
    const autoPull = params.autoPull !== false; // Default to true
    const syncStrategy = params.syncStrategy || 'conservative';
    const createGitRepo = params.createGitRepo !== false; // Default to true
    const syncOnConflict = params.syncOnConflict || 'warn';
    const pullMissingFiles = params.pullMissingFiles !== false; // Default to true
    
    console.error(`🎯 [GAS_PROJECT_SET] Starting enhanced project setup with ${syncStrategy} sync strategy`);
    
    // Resolve project parameter to script ID
    const scriptId = await ProjectResolver.resolveScriptId(params.project, workingDir, accessToken);
    
    // Get project info using EXISTING gas_info functionality
    const projectInfo = await this.gasClient.getProject(scriptId, accessToken);
    
    // Determine project name for local storage
    let projectName: string;
    if (typeof params.project === 'string' && params.project.length !== 44) {
      // Use provided name if it's not a script ID
      projectName = params.project;
    } else {
      // Try to find existing name or use project title
      projectName = await ProjectResolver.getProjectNameByScriptId(scriptId, workingDir) || 
                   projectInfo.title || 
                   `project-${scriptId.substring(0, 8)}`;
    }

    console.error(`🎯 [GAS_PROJECT_SET] Setting project: ${projectName} (${scriptId})`);

    // Set current project using utility
    await ProjectResolver.setCurrentProject(projectName, scriptId, workingDir);

    // 🎯 ENHANCED WORKFLOW: Step 1 - Initialize Git Repository
    let gitStatus: any = null;
    if (createGitRepo) {
      console.error(`🔧 [GAS_PROJECT_SET] Ensuring git repository for version control...`);
      gitStatus = await LocalFileManager.ensureProjectGitRepo(projectName, workingDir);
      
      if (gitStatus.isNewRepo) {
        console.error(`✅ [GAS_PROJECT_SET] Initialized new git repository: ${gitStatus.repoPath}`);
      } else {
        console.error(`✅ [GAS_PROJECT_SET] Using existing git repository: ${gitStatus.repoPath}`);
      }
    }

    // 🔍 ENHANCED WORKFLOW: Step 2 - Comprehensive Sync Status Analysis
    let syncStatus: {
      inSync: boolean;
      differences: {
        onlyLocal: string[];
        onlyRemote: string[];
        contentDiffers: string[];
      };
      summary: string;
    } | null = null;
    let remoteFiles: any[] = [];
    let syncActions = {
      pulled: [] as string[],
      skipped: [] as string[],
      conflicts: [] as string[]
    };
    let gitCommitResult: any = null;
    
    if (autoPull) {
      try {
        console.error(`🔍 [GAS_PROJECT_SET] Analyzing sync status with remote...`);
        
        // Get remote files
        remoteFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
        const remoteFilesForComparison = remoteFiles.map((file: any) => ({
          name: file.name,
          content: file.source || '',
          type: file.type
        }));
        
        // Verify sync status using existing logic
        syncStatus = await LocalFileManager.verifySyncStatus(projectName, remoteFilesForComparison, workingDir);
        console.error(`📊 [GAS_PROJECT_SET] Sync Analysis: ${syncStatus.summary}`);
        
        // 🎯 SMART AUTO-SYNC: Use proven decision logic from gas_cat/gas_write
        const shouldAutoSync = this.shouldAutoSync(syncStatus, remoteFiles.length, syncStrategy);
        
        if (shouldAutoSync.pull) {
          console.error(`🔄 [GAS_PROJECT_SET] ${shouldAutoSync.reason} - Auto-pulling files...`);
          
          try {
            let filesToPull = remoteFilesForComparison;
            
            // In conservative mode, only pull missing files if pullMissingFiles is true
            if (syncStrategy === 'conservative' && pullMissingFiles) {
              filesToPull = remoteFilesForComparison.filter(file => 
                syncStatus!.differences.onlyRemote.includes(file.name)
              );
              
              if (filesToPull.length < remoteFilesForComparison.length) {
                console.error(`🛡️ [GAS_PROJECT_SET] Conservative mode: pulling only ${filesToPull.length} missing files (preserving ${remoteFilesForComparison.length - filesToPull.length} local files)`);
              }
            }
            
            const pullResult = await LocalFileManager.copyRemoteToLocal(projectName, filesToPull, workingDir);
            console.error(`✅ [GAS_PROJECT_SET] Successfully pulled ${pullResult.filesWritten} files`);
            
            syncActions.pulled = pullResult.filesList;
            
            // Create git commit for sync operation
            if (gitStatus?.gitInitialized && pullResult.filesWritten > 0) {
              const commitMessage = syncStatus!.differences.onlyLocal.length === 0 && 
                                  syncStatus!.differences.contentDiffers.length === 0
                ? `Initial sync: pulled ${pullResult.filesWritten} files from remote`
                : `Sync update: pulled ${pullResult.filesWritten} missing files from remote`;
              
              gitCommitResult = await LocalFileManager.autoCommitChanges(
                projectName,
                pullResult.filesList,
                commitMessage,
                workingDir
              );
              
              if (gitCommitResult.committed) {
                console.error(`🎯 [GAS_PROJECT_SET] Created sync commit: ${gitCommitResult.commitHash}`);
              }
            }
            
            // Re-verify sync status after pull
            const updatedRemoteFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
            const updatedRemoteFilesForComparison = updatedRemoteFiles.map((file: any) => ({
              name: file.name,
              content: file.source || '',
              type: file.type
            }));
            syncStatus = await LocalFileManager.verifySyncStatus(projectName, updatedRemoteFilesForComparison, workingDir);
            console.error(`📊 [GAS_PROJECT_SET] After sync: ${syncStatus.summary}`);
            
          } catch (pullError: any) {
            console.error(`⚠️ [GAS_PROJECT_SET] Auto-pull failed: ${pullError.message}`);
            syncActions.skipped.push(`Pull failed: ${pullError.message}`);
          }
        } else {
          console.error(`ℹ️ [GAS_PROJECT_SET] ${shouldAutoSync.reason} - skipping auto-pull`);
          
          // Identify conflicts based on strategy
          if (syncStatus.differences.onlyLocal.length > 0) {
            syncActions.conflicts.push(...syncStatus.differences.onlyLocal.map(f => `${f} (local-only)`));
          }
          if (syncStatus.differences.contentDiffers.length > 0) {
            syncActions.conflicts.push(...syncStatus.differences.contentDiffers.map(f => `${f} (content differs)`));
          }
          
          if (syncOnConflict === 'warn' && syncActions.conflicts.length > 0) {
            console.error(`⚠️ [GAS_PROJECT_SET] Sync conflicts detected: ${syncActions.conflicts.length} files need manual resolution`);
          }
        }
        
      } catch (syncError: any) {
        console.error(`❌ [GAS_PROJECT_SET] Sync analysis failed: ${syncError.message} - proceeding without sync`);
        syncActions.skipped.push(`Sync analysis failed: ${syncError.message}`);
      }
    } else {
      console.error(`ℹ️ [GAS_PROJECT_SET] Auto-pull disabled - project set without file sync`);
    }

    // 📊 ENHANCED RESPONSE: Comprehensive project setup information
    const localPath = await LocalFileManager.getProjectDirectory(projectName, workingDir);
    const localFiles = await LocalFileManager.getProjectFiles(projectName, workingDir);
    
    const recommendations = [];
    if (syncActions.conflicts.length > 0) {
      recommendations.push("Run 'gas_status' to see detailed file differences");
      if (syncStrategy === 'conservative') {
        recommendations.push("Use 'gas_pull --force' to overwrite local files with remote versions");
      }
    }
    if (syncActions.pulled.length === 0 && remoteFiles.length > 0 && !autoPull) {
      recommendations.push("Run 'gas_pull' to sync remote files locally");
    }
    if (gitStatus?.isNewRepo) {
      recommendations.push("Git repository created - your changes will be automatically tracked");
    }

    return {
      success: true,
      projectName,
      scriptId,
      title: projectInfo.title,
      syncStatus: syncStatus ? {
        strategy: syncStrategy,
        inSync: syncStatus.inSync,
        filesFound: {
          local: localFiles.length,
          remote: remoteFiles.length
        },
        differences: syncStatus.differences,
        syncActions,
        gitCommit: gitCommitResult ? {
          created: gitCommitResult.committed,
          hash: gitCommitResult.commitHash,
          message: gitCommitResult.message || 'No commit created'
        } : null
      } : null,
      localPath,
      gitRepository: gitStatus ? {
        initialized: gitStatus.gitInitialized,
        path: gitStatus.repoPath,
        isNewRepo: gitStatus.isNewRepo
      } : null,
      recommendations,
      message: this.generateStatusMessage(projectName, syncActions, syncStatus, gitCommitResult)
    };
  }

  /**
   * Smart auto-sync decision logic (extracted from gas_cat/gas_write)
   * Determines when it's safe to automatically pull remote files
   */
  private shouldAutoSync(syncStatus: {
    inSync: boolean;
    differences: {
      onlyLocal: string[];
      onlyRemote: string[];
      contentDiffers: string[];
    };
    summary: string;
  } | null, totalRemoteFiles: number, syncStrategy: string): { pull: boolean; reason: string } {
    if (!syncStatus) {
      return { pull: false, reason: 'No sync status available' };
    }

    // Force strategy always pulls
    if (syncStrategy === 'force') {
      return { pull: true, reason: 'Force strategy enabled - pulling all remote files' };
    }

    // Manual strategy never auto-pulls
    if (syncStrategy === 'manual') {
      return { pull: false, reason: 'Manual strategy - user must explicitly sync' };
    }

    // Conservative strategy (default) - smart decision making
    
    // Check for first-time access: no local files but remote files exist
    const hasNoLocalFiles = syncStatus.differences.onlyLocal.length === 0 && 
                            syncStatus.differences.contentDiffers.length === 0;
    const hasRemoteFiles = syncStatus.differences.onlyRemote.length > 0;
    
    if (hasNoLocalFiles && hasRemoteFiles) {
      return { pull: true, reason: 'First-time project access (no local files)' };
    }

    // Check for major out of sync: many remote-only files
    if (syncStatus.differences.onlyRemote.length >= 3) {
      // Only auto-pull if no local changes that could be lost
      if (syncStatus.differences.onlyLocal.length === 0 && syncStatus.differences.contentDiffers.length === 0) {
        return { pull: true, reason: `Missing ${syncStatus.differences.onlyRemote.length} remote files locally` };
      } else {
        return { pull: false, reason: `${syncStatus.differences.onlyRemote.length} missing remote files, but local changes detected - manual sync required` };
      }
    }

    // Don't auto-pull if there are local changes that could be lost
    if (syncStatus.differences.onlyLocal.length > 0 || syncStatus.differences.contentDiffers.length > 0) {
      return { pull: false, reason: 'Local changes detected - manual sync required to avoid data loss' };
    }

    // Only minor differences - safe to proceed without pulling
    if (syncStatus.differences.onlyRemote.length > 0) {
      return { pull: true, reason: `Pulling ${syncStatus.differences.onlyRemote.length} missing remote files (safe - no local conflicts)` };
    }

    return { pull: false, reason: 'Already in sync' };
  }

  /**
   * Generate user-friendly status message
   */
  private generateStatusMessage(projectName: string, syncActions: any, syncStatus: any, gitCommitResult: any): string {
    let message = `✅ Set current project to '${projectName}'`;
    
    if (syncActions.pulled.length > 0) {
      message += ` and pulled ${syncActions.pulled.length} files`;
      if (gitCommitResult?.committed) {
        message += ` (committed to git)`;
      }
    } else if (syncActions.conflicts.length > 0) {
      message += ` with ${syncActions.conflicts.length} sync conflicts detected`;
    } else if (syncStatus?.inSync) {
      message += ` (already in sync)`;
    } else {
      message += ` (sync analysis completed)`;
    }
    
    return message;
  }
}

/**
 * Get current project information  
 * Leverages existing gas_info function
 */
export class GASProjectGetTool extends BaseTool {
  public name = 'gas_project_get';
  public description = 'Get current project information and status';
  
  public inputSchema = {
    type: 'object',
    properties: {
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      },
      detailed: {
        type: 'boolean',
        description: 'Include detailed project info and file comparison',
        default: false
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const { LocalFileManager } = await import('../utils/localFileManager.js');
    const workingDir = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    
    try {
      // Get current project info
      const currentProject = await ProjectResolver.getCurrentProject(workingDir);
      
      if (params.detailed) {
        const accessToken = await this.getAuthToken(params);
        
        // Get remote project info using EXISTING gas_info functionality
        const remoteInfo = await this.gasClient.getProject(currentProject.scriptId, accessToken);
        
        // Get local files for comparison using project-specific directory
        const localFiles = await LocalFileManager.getProjectFiles(currentProject.projectName, workingDir);
        
        // Get remote files using EXISTING gas_ls functionality
        const remoteFiles = await this.gasClient.getProjectContent(currentProject.scriptId, accessToken);
        const remoteFilesForComparison = remoteFiles.map((file: any) => ({
          name: file.name,
          content: file.source || '',
          type: file.type
        }));
        
        // Compare files
        const fileComparisons = await LocalFileManager.compareFiles(localFiles, remoteFilesForComparison);
        
        return {
          currentProject,
          remoteInfo: {
            title: remoteInfo.title,
            createTime: remoteInfo.createTime,
            updateTime: remoteInfo.updateTime,
            parentId: remoteInfo.parentId
          },
          localFiles: localFiles.length,
          remoteFiles: remoteFiles.length,
          fileComparisons,
          syncStatus: this.getSyncStatus(fileComparisons),
          localPath: await LocalFileManager.getProjectDirectory(currentProject.projectName, workingDir)
        };
      } else {
        return {
          currentProject,
          localPath: await LocalFileManager.getProjectDirectory(currentProject.projectName, workingDir),
          hasLocalFiles: (await LocalFileManager.getProjectFiles(currentProject.projectName, workingDir)).length > 0
        };
      }
    } catch (error: any) {
      if (error.message.includes('not set')) {
        return {
          currentProject: null,
          message: 'No current project set. Use gas_project_set to set a current project.'
        };
      }
      throw error;
    }
  }

  private getSyncStatus(comparisons: Array<{status: string}>): string {
    const counts = {
      same: 0,
      different: 0,
      localOnly: 0,
      remoteOnly: 0
    };

    for (const comp of comparisons) {
      switch (comp.status) {
        case 'same': counts.same++; break;
        case 'different': counts.different++; break;
        case 'local-only': counts.localOnly++; break;
        case 'remote-only': counts.remoteOnly++; break;
      }
    }

    if (counts.different === 0 && counts.localOnly === 0 && counts.remoteOnly === 0) {
      return 'in-sync';
    } else if (counts.different > 0) {
      return 'modified';
    } else {
      return 'files-added-or-removed';
    }
  }
}

/**
 * Add a project to the configuration
 */
export class GASProjectAddTool extends BaseTool {
  public name = 'gas_project_add';
  public description = 'Add a project to the local configuration';
  
  public inputSchema = {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Project name (used as identifier)',
        minLength: 1,
        // Let Google Apps Script API define project name limits
      },
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID (44 characters)',
        pattern: '^[a-zA-Z0-9_-]{44}$'
      },
      description: {
        type: 'string',
        description: 'Optional project description'
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      }
    },
    required: ['name', 'scriptId']
  };

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
  }

  async execute(params: any): Promise<any> {
    const { LocalFileManager } = await import('../utils/localFileManager.js');
    const workingDir = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    
    // Validate script ID format
    const scriptId = this.validate.scriptId(params.scriptId, 'project addition');
    const name = params.name.trim();
    
    if (!name) {
      throw new ValidationError('name', params.name, 'non-empty project name');
    }

    // Add project using utility
    await ProjectResolver.addProject(name, scriptId, params.description, workingDir);

    return {
      success: true,
      name,
      scriptId,
      description: params.description,
      message: `Added project '${name}' to configuration`
    };
  }
}

/**
 * List all configured projects
 */
export class GASProjectListTool extends BaseTool {
  public name = 'gas_project_list';
  public description = 'List all configured projects';
  
  public inputSchema = {
    type: 'object',
    properties: {
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
    const { LocalFileManager } = await import('../utils/localFileManager.js');
    const workingDir = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    
    // Get projects using utility
    const projects = await ProjectResolver.listProjects(workingDir);
    
    // Get current project if set
    let currentProject;
    try {
      currentProject = await ProjectResolver.getCurrentProject(workingDir);
    } catch (error) {
      currentProject = null;
    }

    return {
      projects,
      currentProject,
      totalProjects: projects.length,
      configPath: workingDir
    };
  }
} 