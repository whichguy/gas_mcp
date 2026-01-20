import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { parsePath, fileNameMatches, stripExtension } from '../api/pathParser.js';
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
    const targetFile = files.find((f: any) => fileNameMatches(f.name, fileName));
    if (!targetFile) {
      throw new FileOperationError('reorder', fileName, 'file not found');
    }

    // Validate new position
    if (newPosition >= files.length) {
      throw new ValidationError('newPosition', newPosition, `position between 0 and ${files.length - 1}`);
    }

    // Get current position of the file being moved (handle with/without extension)
    const currentIndex = files.findIndex((f: any) => fileNameMatches(f.name, fileName));

    // CRITICAL: Prevent moving critical infrastructure files from their required positions
    const criticalFileBaseNames = [
      'common-js/require',
      'common-js/ConfigManager',
      'common-js/__mcp_exec'
    ];
    const criticalFilePositions: Record<string, number> = {
      'common-js/require': 0,
      'common-js/ConfigManager': 1,
      'common-js/__mcp_exec': 2
    };

    // Check if the requested file is a critical file (normalize for comparison)
    const normalizedFileName = stripExtension(fileName);
    const isCriticalFile = criticalFileBaseNames.includes(normalizedFileName);

    if (isCriticalFile) {
      const requiredPosition = criticalFilePositions[normalizedFileName];
      if (currentIndex === requiredPosition && newPosition !== requiredPosition) {
        throw new ValidationError(
          'newPosition',
          newPosition,
          `${fileName} must always remain at position ${requiredPosition}. This is a critical infrastructure file that cannot be moved.`
        );
      }
      // Allow moving it back to required position if it's currently out of place
      if (currentIndex !== requiredPosition && newPosition !== requiredPosition) {
        throw new ValidationError(
          'newPosition',
          newPosition,
          `${fileName} can only be moved to position ${requiredPosition}. To fix file order, set newPosition to ${requiredPosition}.`
        );
      }
    }

    // Create new file order
    let reorderedFiles = [...files];

    // Remove file from current position
    const [movedFile] = reorderedFiles.splice(currentIndex, 1);

    // Insert at new position
    reorderedFiles.splice(newPosition, 0, movedFile);

    // Enforce critical file ordering using extract-and-insert pattern
    // Position 0: common-js/require (module system)
    // Position 1: common-js/ConfigManager (configuration)
    // Position 2: common-js/__mcp_exec (execution infrastructure)
    // Extract critical files in order (match with or without extension)
    const extractedCriticalFiles: any[] = [];
    criticalFileBaseNames.forEach(baseName => {
      const file = reorderedFiles.find((f: any) => fileNameMatches(f.name, baseName));
      if (file) extractedCriticalFiles.push(file);
    });

    // Remove critical files from array (using actual file names)
    const criticalActualNames = new Set(extractedCriticalFiles.map(f => f.name));
    const nonCriticalFiles = reorderedFiles.filter(
      (f: any) => !criticalActualNames.has(f.name)
    );

    // Rebuild: critical files first, then others
    reorderedFiles = [...extractedCriticalFiles, ...nonCriticalFiles];

    // Update the project with new file order
    const updatedFiles = await this.gasClient.updateProjectContent(scriptId, reorderedFiles, accessToken);

    // ✅ Sync local cache with updated remote content hashes
    // Also update mtimes for user convenience (file explorer sorting)
    try {
      const { LocalFileManager } = await import('../utils/localFileManager.js');
      const { setFileMtimeToRemote } = await import('../utils/fileHelpers.js');
      const { updateCachedContentHash } = await import('../utils/gasMetadataCache.js');
      const { computeGitSha1 } = await import('../utils/hashUtils.js');
      const { join } = await import('path');

      const localRoot = await LocalFileManager.getProjectDirectory(scriptId);

      if (localRoot) {
        // Update hash cache and mtimes for all files since reordering changes content for all files
        for (const file of updatedFiles) {
          const fileExtension = LocalFileManager.getFileExtensionFromName(file.name);
          const localPath = join(localRoot, file.name + fileExtension);
          try {
            // Update hash cache with WRAPPED content hash (primary sync mechanism)
            if (file.source) {
              const contentHash = computeGitSha1(file.source);
              await updateCachedContentHash(localPath, contentHash);
            }
            // Update mtime for user convenience (informational only, not for sync)
            if (file.updateTime) {
              await setFileMtimeToRemote(localPath, file.updateTime, file.type);
            }
          } catch (cacheError) {
            // File might not exist locally - that's okay
          }
        }
        console.error(`🔄 [SYNC] Updated local hash cache after reorder operation`);
      }
    } catch (syncError) {
      // Don't fail the operation if local sync fails - remote update succeeded
      console.error(`⚠️ [SYNC] Failed to update local cache after reorder: ${syncError}`);
    }

    return {
      status: 'reordered',
      scriptId,
      fileName,
      oldPosition: currentIndex,
      newPosition,
      totalFiles: files.length,
      message: `Moved ${fileName} from position ${currentIndex} to ${newPosition}. Critical files enforced: require(0), ConfigManager(1), __mcp_exec(2).`
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
