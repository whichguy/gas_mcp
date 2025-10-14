import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { parsePath } from '../api/pathParser.js';
import { ValidationError, FileOperationError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { ProjectResolver } from '../utils/projectResolver.js';

/**
 * Reorder files in a Google Apps Script project
 */
export class ReorderTool extends BaseTool {
  public name = 'reorder';
  public description = 'Change the execution order of files in a Google Apps Script project';
  
  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      fileName: {
        type: 'string',
        description: 'Name of the file to reorder'
      },
      newPosition: {
        type: 'number',
        description: 'New position in the execution order (0-based)'
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'fileName', 'newPosition']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);

    const scriptId = this.validate.scriptId(params.scriptId, 'project operation');
    const fileName = this.validate.string(params.fileName, 'fileName', 'project operation');
    const newPosition = this.validate.number(params.newPosition, 'newPosition', 'project operation', 0);

    // Get current files
    const files = await this.gasClient.getProjectContent(scriptId, accessToken);

    // Find the target file
    const targetFile = files.find((f: any) => f.name === fileName);
    if (!targetFile) {
      throw new FileOperationError('reorder', fileName, 'file not found');
    }

    // Validate new position
    if (newPosition >= files.length) {
      throw new ValidationError('newPosition', newPosition, `position between 0 and ${files.length - 1}`);
    }

    // Get current position of the file being moved
    const currentIndex = files.findIndex((f: any) => f.name === fileName);

    // CRITICAL: Prevent moving common-js/require.gs away from position 0
    // Only allow moving it TO position 0 if it's currently out of place
    if (fileName === 'common-js/require.gs') {
      if (currentIndex === 0 && newPosition !== 0) {
        throw new ValidationError(
          'newPosition',
          newPosition,
          'common-js/require.gs must always remain at position 0 (first file). It cannot be moved to any other position.'
        );
      }
      // Allow moving it back to position 0 if it's currently elsewhere
      if (currentIndex !== 0 && newPosition !== 0) {
        throw new ValidationError(
          'newPosition',
          newPosition,
          'common-js/require.gs can only be moved to position 0. To fix file order, set newPosition to 0.'
        );
      }
    }

    // Create new file order
    const reorderedFiles = [...files];

    // Remove file from current position
    const [movedFile] = reorderedFiles.splice(currentIndex, 1);

    // Insert at new position
    reorderedFiles.splice(newPosition, 0, movedFile);

    // Enforce critical file ordering:
    // Position 0: common-js/require (always first)
    // Position 1: common-js/__mcp_exec (always second, right after require)
    // ✅ FIX: File names in GAS API don't have extensions
    const commonJsIndex = reorderedFiles.findIndex((f: any) => f.name === 'common-js/require');
    const mcpRunIndex = reorderedFiles.findIndex((f: any) => f.name === 'common-js/__mcp_exec');

    // Move common-js/require to position 0 if not already there
    if (commonJsIndex !== -1 && commonJsIndex !== 0) {
      const [commonJsFile] = reorderedFiles.splice(commonJsIndex, 1);
      reorderedFiles.unshift(commonJsFile);
    }

    // Move common-js/__mcp_exec to position 1 if not already there (right after require)
    const updatedMcpRunIndex = reorderedFiles.findIndex((f: any) => f.name === 'common-js/__mcp_exec');
    if (updatedMcpRunIndex !== -1 && updatedMcpRunIndex !== 1) {
      const [mcpRunFile] = reorderedFiles.splice(updatedMcpRunIndex, 1);
      reorderedFiles.splice(1, 0, mcpRunFile);
    }

    // Update the project with new file order
    await this.gasClient.updateProjectContent(scriptId, reorderedFiles, accessToken);

    return {
      status: 'reordered',
      scriptId,
      fileName,
      oldPosition: currentIndex,
      newPosition,
      totalFiles: files.length,
      message: `Moved ${fileName} from position ${currentIndex} to ${newPosition}. common-js/require.gs enforced at position 0, common-js/__mcp_exec.gs at position 1.`
    };
  }
}

/**
 * List all configured projects
 */
export class ProjectListTool extends BaseTool {
  public name = 'project_list';
  public description = 'List all configured projects';

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.workingDir
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
