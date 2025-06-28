import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { ProjectResolver, ProjectParam } from '../utils/projectResolver.js';
import { LocalFileManager } from '../utils/localFileManager.js';
import { SessionAuthManager } from '../auth/sessionManager.js';

/**
 * Detect Google Apps Script file type from content
 * Similar to LocalFileManager.getFileExtension but returns GAS API file types
 */
function detectGASFileType(content: string, fileName: string): 'SERVER_JS' | 'HTML' | 'JSON' {
  // Special handling for Google Apps Script manifest files
  if (fileName === 'appsscript') {
    return 'JSON';
  }
  
  // Auto-detect from content
  const trimmed = content.trim();
  
  // JSON files - check for JSON structure
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'JSON';
  }
  
  // HTML files - check for HTML tags
  if (trimmed.includes('<html>') || trimmed.includes('<!DOCTYPE') || 
      trimmed.includes('<head>') || trimmed.includes('<body>') ||
      /^<\s*!DOCTYPE\s+html/i.test(trimmed)) {
    return 'HTML';
  }
  
  // Default to SERVER_JS for JavaScript/Apps Script code
  return 'SERVER_JS';
}

/**
 * Pull files from remote project to local src directory
 * Leverages existing gas_ls and gas_cat functions
 */
export class GASPullTool extends BaseTool {
  public name = 'gas_pull';
  public description = 'Pull files from remote Google Apps Script project to local src directory';
  
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
        description: 'Local project reference to pull from (defaults to current project if not specified)'
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)',
        default: process.cwd()
      },
      force: {
        type: 'boolean', 
        description: 'Force overwrite local files (default: false = merge mode preserves local changes)',
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
    const accessToken = await this.getAuthToken(params);
    const workingDir = params.workingDir || process.cwd();
    
    // Resolve project parameter to script ID (uses current project if not specified)
    const scriptId = await ProjectResolver.resolveProjectId(params.project, workingDir);
    
    // Get project files using EXISTING gas_ls functionality
    const remoteFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
    
    // Convert remote files to format expected by LocalFileManager
    const remoteFilesToMerge = remoteFiles.map((file: any) => ({
      name: file.name,
      content: file.source || '',
      type: file.type
    }));

    let mergeResult;
    
    if (params.force) {
      // Force mode: overwrite all files (original behavior)
      await LocalFileManager.writeLocalFiles(remoteFilesToMerge, workingDir);
      mergeResult = {
        written: remoteFilesToMerge.map(f => f.name),
        skipped: [],
        overwritten: [],
        summary: `Force pulled ${remoteFilesToMerge.length} files (overwrote local)`
      };
    } else {
      // Merge mode: preserve local files, only add new or identical remote files
      mergeResult = await LocalFileManager.mergeRemoteFiles(remoteFilesToMerge, workingDir, {
        preserveLocal: true,
        overwriteModified: false
      });
    }

    // Get project name for response
    const projectName = await ProjectResolver.getProjectNameByScriptId(scriptId, workingDir) || 
                        `project-${scriptId.substring(0, 8)}`;

    return {
      success: true,
      projectName,
      scriptId,
      totalRemoteFiles: remoteFiles.length,
      newFiles: mergeResult.written.length,
      skippedFiles: mergeResult.skipped.length,
      overwrittenFiles: mergeResult.overwritten.length,
      mergeDetails: {
        written: mergeResult.written,
        skipped: mergeResult.skipped,
        overwritten: mergeResult.overwritten
      },
      localPath: LocalFileManager.getSrcDirectory(workingDir),
      message: params.force 
        ? `Force pulled ${remoteFiles.length} files from '${projectName}' (overwrote local)`
        : `${mergeResult.summary} from '${projectName}'`
    };
  }
}

/**
 * Push local src files to remote project
 * Leverages existing gas_write function
 */
export class GASPushTool extends BaseTool {
  public name = 'gas_push';
  public description = 'Push local src files to remote Google Apps Script project';
  
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
        description: 'Local project reference to push to (defaults to current project if not specified)'
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)',
        default: process.cwd()
      },
      dryRun: {
        type: 'boolean',
        description: 'Show what would be pushed without actually pushing',
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
    const workingDir = params.workingDir || process.cwd();
    
    // Get local files
    const localFiles = await LocalFileManager.getLocalFiles(workingDir);
    
    if (localFiles.length === 0) {
      return {
        success: false,
        message: 'No local files found in ./src/ directory. Use gas_pull to get files first.',
        localPath: LocalFileManager.getSrcDirectory(workingDir)
      };
    }

    // Resolve project parameter to script ID (uses current project if not specified)
    const scriptId = await ProjectResolver.resolveProjectId(params.project, workingDir);
    
    if (params.dryRun) {
      // Just show what would be pushed
      const projectName = await ProjectResolver.getProjectNameByScriptId(scriptId, workingDir) || 
                          `project-${scriptId.substring(0, 8)}`;
      
      return {
        dryRun: true,
        projectName,
        scriptId,
        filesToPush: localFiles.map(f => ({
          name: f.name,
          size: f.size,
          relativePath: f.relativePath
        })),
        totalFiles: localFiles.length,
        message: `Would push ${localFiles.length} files to '${projectName}'`
      };
    }

    const accessToken = await this.getAuthToken(params);

    // Push each file using EXISTING gas_write functionality with proper file type detection
    const results = [];
    for (const file of localFiles) {
      try {
        // Detect proper file type from content
        const fileType = detectGASFileType(file.content, file.name);
        
        // Use updateProjectContent with proper file type instead of updateFile
        const currentFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
        const existingIndex = currentFiles.findIndex(f => f.name === file.name);
        
        const newFile = {
          name: file.name,
          type: fileType,
          source: file.content
        };
        
        let updatedFiles;
        if (existingIndex >= 0) {
          // Update existing file
          updatedFiles = [...currentFiles];
          updatedFiles[existingIndex] = newFile;
        } else {
          // Add new file
          updatedFiles = [...currentFiles, newFile];
        }
        
        await this.gasClient.updateProjectContent(scriptId, updatedFiles, accessToken);
        results.push({ name: file.name, status: 'success', type: fileType });
      } catch (error: any) {
        results.push({ name: file.name, status: 'error', error: error.message });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    // Get project name for response
    const projectName = await ProjectResolver.getProjectNameByScriptId(scriptId, workingDir) || 
                        `project-${scriptId.substring(0, 8)}`;

    return {
      success: errorCount === 0,
      projectName,
      scriptId,
      filesPushed: successCount,
      errors: errorCount,
      results: results.filter(r => r.status === 'error'), // Only show errors
      message: errorCount === 0 
        ? `Successfully pushed ${successCount} files to '${projectName}'`
        : `Pushed ${successCount} files, ${errorCount} errors. See results for details.`
    };
  }
}

/**
 * Show status/diff between local and remote files
 * Leverages existing gas_ls and gas_cat functions
 */
export class GASStatusTool extends BaseTool {
  public name = 'gas_status';
  public description = 'Show status and differences between local and remote files';
  
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
        description: 'Local project reference to compare (defaults to current project if not specified)'
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)',
        default: process.cwd()
      },
      detailed: {
        type: 'boolean',
        description: 'Include detailed file-by-file comparison',
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
    const accessToken = await this.getAuthToken(params);
    const workingDir = params.workingDir || process.cwd();
    
    // Resolve project parameter to script ID (uses current project if not specified)
    const scriptId = await ProjectResolver.resolveProjectId(params.project, workingDir);
    
    // Get local files
    const localFiles = await LocalFileManager.getLocalFiles(workingDir);
    
    // Get remote files using EXISTING gas_ls functionality
    const remoteFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
    const remoteFilesForComparison = remoteFiles.map((file: any) => ({
      name: file.name,
      content: file.source || '',
      type: file.type
    }));

    // Compare files using utility
    const fileComparisons = await LocalFileManager.compareFiles(localFiles, remoteFilesForComparison);

    // Calculate summary statistics
    const summary = {
      same: fileComparisons.filter(f => f.status === 'same').length,
      different: fileComparisons.filter(f => f.status === 'different').length,
      localOnly: fileComparisons.filter(f => f.status === 'local-only').length,
      remoteOnly: fileComparisons.filter(f => f.status === 'remote-only').length
    };

    // Determine overall status
    let overallStatus: string;
    if (summary.different === 0 && summary.localOnly === 0 && summary.remoteOnly === 0) {
      overallStatus = 'in-sync';
    } else if (summary.different > 0) {
      overallStatus = 'modified';
    } else {
      overallStatus = 'files-added-or-removed';
    }

    // Get project name for response
    const projectName = await ProjectResolver.getProjectNameByScriptId(scriptId, workingDir) || 
                        `project-${scriptId.substring(0, 8)}`;

    const response: any = {
      projectName,
      scriptId,
      overallStatus,
      summary,
      localFiles: localFiles.length,
      remoteFiles: remoteFiles.length,
      localPath: LocalFileManager.getSrcDirectory(workingDir)
    };

    if (params.detailed) {
      response.fileComparisons = fileComparisons;
    } else {
      // Just show files that need attention
      const needsAttention = fileComparisons.filter(f => f.status !== 'same');
      if (needsAttention.length > 0) {
        response.needsAttention = needsAttention.map(f => ({
          name: f.name,
          status: f.status
        }));
      }
    }

    // Add helpful messages
    if (overallStatus === 'in-sync') {
      response.message = 'Local and remote files are in sync';
    } else {
      const suggestions = [];
      if (summary.different > 0) {
        suggestions.push(`${summary.different} files modified locally`);
      }
      if (summary.localOnly > 0) {
        suggestions.push(`${summary.localOnly} files only exist locally`);
      }
      if (summary.remoteOnly > 0) {
        suggestions.push(`${summary.remoteOnly} files only exist remotely`);
      }
      response.message = suggestions.join(', ');
      response.suggestions = {
        toPush: summary.different + summary.localOnly > 0 ? 'Use gas_push() to upload local changes' : null,
        toPull: summary.remoteOnly > 0 ? 'Use gas_pull({force: true}) to download remote files' : null
      };
    }

    return response;
  }
} 