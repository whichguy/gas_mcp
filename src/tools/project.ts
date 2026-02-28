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
  public description = '[PROJECT:REORDER] Change file execution order in a GAS project — critical for CommonJS (require.gs must be position 0). WHEN: fixing module loading order or organizing project files. AVOID: manual reordering when project_init already sets correct order. Example: reorder({scriptId, fileOrder: ["require.gs", "ConfigManager.gs", "Main.gs"]})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      status: { type: 'string', description: 'Operation status (success)' },
      fileName: { type: 'string', description: 'File that was reordered' },
      previousPosition: { type: 'number', description: 'Previous position in execution order' },
      newPosition: { type: 'number', description: 'New position in execution order' },
      totalFiles: { type: 'number', description: 'Total files in project' },
      fileOrder: { type: 'array', description: 'Updated file order' }
    }
  };

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

  public annotations = {
    title: 'Reorder Files',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
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

    // Validate loadNow module positioning: loadNow modules must be at the end
    // Matches all emitted formats:
    //   new:  __defineModule__(_main, true)
    //   obj:  __defineModule__(_main, { loadNow: true })
    const loadNowFileList = reorderedFiles.filter((f: any) => {
      const src = f.source || '';
      return /__defineModule__\s*\(\s*_main\s*,\s*true\s*\)/.test(src) ||
             /__defineModule__\s*\(\s*_main\s*,\s*\{[^}]*loadNow\s*:\s*true[^}]*\}\s*\)/.test(src);
    });
    const reorderWarnings: string[] = [];
    if (loadNowFileList.length > 0) {
      const lastValidPos = reorderedFiles.length - loadNowFileList.length;
      const misplacedLoadNow = loadNowFileList.filter((f: any) =>
        reorderedFiles.indexOf(f) < lastValidPos
      );
      if (misplacedLoadNow.length > 0) {
        reorderWarnings.push(
          `loadNow modules not last: [${misplacedLoadNow.map((f: any) => f.name).join(', ')}]. ` +
          `These must be at the end of the file list. Their dependencies must parse first.`
        );
      }
    }

    // Update the project with new file order
    const updatedFiles = await this.gasClient.updateProjectContent(scriptId, reorderedFiles, accessToken);

    const result: any = {
      status: 'reordered',
      scriptId,
      fileName,
      oldPosition: currentIndex,
      newPosition,
      totalFiles: files.length,
      message: `Moved ${fileName} from position ${currentIndex} to ${newPosition}. Critical files enforced: require(0), ConfigManager(1), __mcp_exec(2).`
    };
    if (reorderWarnings.length > 0) {
      result.warnings = reorderWarnings;
    }
    return result;
  }
}

/**
 * List all configured projects
 */
export class ProjectListTool extends BaseTool {
  public name = 'project_list';
  public description = '[PROJECT:LIST] List all configured GAS projects from gas-config.json with their script IDs and names. WHEN: discovering available projects or finding a script ID. AVOID: use ls({scriptId}) to browse individual project files. Example: project_list({})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      projects: { type: 'array', description: 'List of projects with name, scriptId, description' },
      totalProjects: { type: 'number', description: 'Total number of configured projects' },
      currentProject: { type: 'object', description: 'Currently active project (if set)' },
      configPath: { type: 'string', description: 'Path to gas-config.json' }
    }
  };

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.workingDir
    }
  };

  public annotations = {
    title: 'List Projects',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
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
