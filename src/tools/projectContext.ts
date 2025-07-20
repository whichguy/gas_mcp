import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ProjectResolver, ProjectParam } from '../utils/projectResolver.js';
import { LocalFileManager } from '../utils/localFileManager.js';
import { ValidationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';

/**
 * Set current project and cache files locally
 * Leverages existing gas_info, gas_ls, and gas_cat functions
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
    const autoPull = params.autoPull !== false; // Default to true
    
    // Resolve project parameter to script ID
    const scriptId = await ProjectResolver.resolveProjectId(params.project, workingDir, accessToken);
    
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

    // Set current project using utility
    await ProjectResolver.setCurrentProject(projectName, scriptId, workingDir);

    let filesCached = 0;
    let pullMessage = '';

    if (autoPull) {
      // Cache files locally using simple copy (overwrites existing)
      const remoteFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
      const filesForLocal = remoteFiles.map((file: any) => ({
        name: file.name,
        content: file.source || '',
        type: file.type
      }));

      const copyResult = await LocalFileManager.copyRemoteToLocal(projectName, filesForLocal, workingDir);
      filesCached = copyResult.filesWritten;
      pullMessage = copyResult.filesWritten > 0 ? 
        `Cached ${copyResult.filesWritten} files locally (overwrote existing)` : 
        'No files to cache';
    } else {
      pullMessage = ' (autoPull disabled - use gas_pull to sync)';
    }

    return {
      success: true,
      projectName,
      scriptId,
      title: projectInfo.title,
      filesCached,
      autoPull,
              localPath: await LocalFileManager.getProjectDirectory(projectName, workingDir),
      message: `Set current project to '${projectName}'${pullMessage}`
    };
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