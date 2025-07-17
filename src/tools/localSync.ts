import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { LocalFileManager } from '../utils/localFileManager.js';
import { ProjectResolver } from '../utils/projectResolver.js';
import { SessionAuthManager } from '../auth/sessionManager.js';

/**
 * Detect GAS file type from content and filename for proper API submission
 */
function detectGASFileType(content: string, fileName: string): 'SERVER_JS' | 'HTML' | 'JSON' {
  // Check file extension first
  if (fileName.endsWith('.html') || fileName.endsWith('.htm')) {
    return 'HTML';
  }
  if (fileName.endsWith('.json')) {
    return 'JSON';
  }
  
  // Check content patterns
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'JSON';
  }
  if (trimmed.includes('<html>') || trimmed.includes('<!DOCTYPE')) {
    return 'HTML';
  }
  
  // Default to SERVER_JS for Apps Script code
  return 'SERVER_JS';
}

/**
 * Pull files from remote project to local project-specific directory
 * Leverages existing gas_ls and gas_cat functions via GASClient
 */
export class GASPullTool extends BaseTool {
  public name = 'gas_pull';
  public description = 'Pull files from remote Google Apps Script project to local project-specific directory';
  
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
        description: 'Working directory (defaults to current directory)'
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
    const { LocalFileManager } = await import('../utils/localFileManager.js');
    const workingDir = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    const force = params.force || false;
    
    // Resolve project parameter to script ID (uses current project if not specified)
    const scriptId = await ProjectResolver.resolveProjectId(params.project, workingDir, accessToken);
    
    // Get project name for directories
    const projectName = await ProjectResolver.getProjectNameByScriptId(scriptId, workingDir) || 
                        `project-${scriptId.substring(0, 8)}`;

    // Get remote files using EXISTING gas_ls functionality
    const remoteFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
    const remoteFilesForMerge = remoteFiles.map((file: any) => ({
      name: file.name,
      content: file.source || '',
      type: file.type
    }));

    let result;
    if (force) {
      // Force mode: overwrite all local files
      await LocalFileManager.writeProjectFiles(projectName, remoteFilesForMerge, workingDir);
      result = {
        written: remoteFilesForMerge.map(f => f.name),
        skipped: [],
        overwritten: [],
        summary: `Force pulled ${remoteFilesForMerge.length} files`
      };
    } else {
      // Merge mode: preserve local changes (default)
      result = await LocalFileManager.mergeProjectFiles(
        projectName,
        remoteFilesForMerge,
        workingDir,
        { preserveLocal: true }
      );
    }


    
    // Update MCP info in appsscript.json
    await LocalFileManager.updateMcpInfo(projectName, {
      projectId: scriptId,
      projectName,
      description: `Google Apps Script project synced from ${scriptId}`
    }, workingDir);

    const projectDir = await LocalFileManager.getProjectDirectory(projectName, workingDir);

    return {
      success: true,
      projectName,
      scriptId,
      projectDir,
      ...result,
      message: `${result.summary} to project '${projectName}'`
    };
  }
}

/**
 * Push files from local project-specific directory to remote project
 * Leverages existing gas_write functionality with proper file type detection
 */
export class GASPushTool extends BaseTool {
  public name = 'gas_push';
  public description = 'Push local project-specific files to remote Google Apps Script project';
  
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
        description: 'Working directory (defaults to current directory)'
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
    const accessToken = await this.getAuthToken(params);
    const { LocalFileManager } = await import('../utils/localFileManager.js');
    const workingDir = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    
    // Resolve project parameter to script ID (uses current project if not specified)
    const scriptId = await ProjectResolver.resolveProjectId(params.project, workingDir, accessToken);
    
    // Get project name
    const projectName = await ProjectResolver.getProjectNameByScriptId(scriptId, workingDir) || 
                        `project-${scriptId.substring(0, 8)}`;

    // Get local files from project-specific directory
    const localFiles = await LocalFileManager.getProjectFiles(projectName, workingDir);

    if (localFiles.length === 0) {
      return {
        success: true,
        projectName,
        scriptId,
        filesPushed: 0,
        errors: 0,
        message: `No files found in local project '${projectName}' to push`
      };
    }

    // Show dry run results if requested
    if (params.dryRun) {
      return {
        dryRun: true,
        projectName,
        scriptId,
        filesToPush: localFiles.map(f => ({
          name: f.name, // ✅ Now properly includes directory structure (utils/helper)
          path: f.relativePath, // Local path (utils/helper.js)
          size: f.content.length,
          type: detectGASFileType(f.content, f.name)
        })),
        message: `Would push ${localFiles.length} files to '${projectName}'`
      };
    }

    // ✅ REUSE EXISTING FUNCTIONALITY: Leverage gas_raw_write for each file
    // This approach reuses existing tested code paths instead of duplicating API logic
    const results = [];
    const { GASRawWriteTool } = await import('./filesystem.js');
    const gasRawWriteTool = new GASRawWriteTool(this.sessionAuthManager);
    
    for (const file of localFiles) {
      try {
        // Use existing gas_raw_write functionality with proper path formatting
        const gasPath = `${scriptId}/${file.name}`; // ✅ file.name now includes directory structure
        const fileType = detectGASFileType(file.content, file.name); // ✅ Determine file type explicitly
        
        await gasRawWriteTool.execute({
          path: gasPath,
          content: file.content,
          fileType, // ✅ Pass required fileType parameter
          accessToken // Pass through auth token
        });
        
        results.push({ 
          name: file.name, 
          localPath: file.relativePath,
          status: 'success', 
          type: fileType 
        });
      } catch (error: any) {
        results.push({ 
          name: file.name, 
          localPath: file.relativePath,
          status: 'error', 
          error: error.message 
        });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    // Update MCP info in appsscript.json with last sync time
    await LocalFileManager.updateMcpInfo(projectName, {
      lastSync: new Date().toISOString()
    }, workingDir);

    return {
      success: errorCount === 0,
      projectName,
      scriptId,
      filesPushed: successCount,
      errors: errorCount,
      results: results.filter(r => r.status === 'error'), // Only show errors in summary
      allResults: results, // Full results for debugging
      message: errorCount === 0 
        ? `✅ Successfully pushed ${successCount} files to '${projectName}' with preserved directory structure`
        : `⚠️ Pushed ${successCount} files, ${errorCount} errors. See results for details.`
    };
  }
}

/**
 * Show status/diff between local project-specific files and remote files
 * Leverages existing gas_ls and gas_cat functions
 */
export class GASStatusTool extends BaseTool {
  public name = 'gas_status';
  public description = 'Show status and differences between local project-specific files and remote files';
  
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
        description: 'Working directory (defaults to current directory)'
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
    const { LocalFileManager } = await import('../utils/localFileManager.js');
    const workingDir = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();
    
    // Resolve project parameter to script ID (uses current project if not specified)
    const scriptId = await ProjectResolver.resolveProjectId(params.project, workingDir, accessToken);
    
    // Get project name
    const projectName = await ProjectResolver.getProjectNameByScriptId(scriptId, workingDir) || 
                        `project-${scriptId.substring(0, 8)}`;

    // Get local files from project-specific directory
    const localFiles = await LocalFileManager.getProjectFiles(projectName, workingDir);
    
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

    const response: any = {
      projectName,
      scriptId,
      overallStatus,
      summary,
      localFiles: localFiles.length,
      remoteFiles: remoteFiles.length,
      projectDir: await LocalFileManager.getProjectDirectory(projectName, workingDir)
    };

    // Add file details if requested
    if (params.detailed) {
      response.fileComparisons = fileComparisons;
    } else {
      // Just show files that need attention
      const changedFiles = fileComparisons.filter(f => f.status !== 'same');
      if (changedFiles.length > 0) {
        response.changedFiles = changedFiles.map(f => ({
          name: f.name,
          status: f.status,
          localSize: f.localSize,
          remoteSize: f.remoteSize
        }));
      }
    }

    // Generate status message
    let message: string;
    if (overallStatus === 'in-sync') {
      message = `Project '${projectName}' is in sync with remote`;
    } else {
      const changes = [];
      if (summary.different > 0) changes.push(`${summary.different} modified`);
      if (summary.localOnly > 0) changes.push(`${summary.localOnly} local only`);
      if (summary.remoteOnly > 0) changes.push(`${summary.remoteOnly} remote only`);
      message = `Project '${projectName}' has changes: ${changes.join(', ')}`;
    }

    response.message = message;
    return response;
  }
} 