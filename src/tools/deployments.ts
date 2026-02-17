import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { GASApiError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SHIM_TEMPLATE } from '../config/shimTemplate.js';
import { fileNameMatches } from '../api/pathParser.js';
import { loadTemplate, loadJsonTemplate } from '../utils/templateLoader.js';
import { LocalFileManager } from '../utils/localFileManager.js';
import { updateCachedContentHash } from '../utils/gasMetadataCache.js';
import { computeGitSha1 } from '../utils/hashUtils.js';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Get the __mcp_exec.js template content
 * Uses centralized template loader utility.
 */
function getExecutionTemplate(): string {
  return loadTemplate('__mcp_exec.js');
}

/**
 * Get the appsscript.json template content
 * Uses centralized template loader utility.
 */
function getManifestTemplate(): any {
  return loadJsonTemplate('appsscript.json');
}

/**
 * Get the __mcp_exec_success.html template content
 * Uses centralized template loader utility.
 */
export function getSuccessHtmlTemplate(): string {
  return loadTemplate('__mcp_exec_success.html');
}

/**
 * Get the __mcp_exec_error.html template content
 * Uses centralized template loader utility.
 */
export function getErrorHtmlTemplate(): string {
  return loadTemplate('__mcp_exec_error.html');
}


/**
 * Verify infrastructure file integrity using SHA-1 checksums
 *
 * @param scriptId - GAS project ID
 * @param fileName - Infrastructure file name to verify
 * @param sessionAuthManager - Session auth manager for FileStatusTool
 * @param accessToken - Optional access token
 * @returns Verification result with SHA comparison
 */
export async function verifyInfrastructureFile(
  scriptId: string,
  fileName: string,
  sessionAuthManager: SessionAuthManager | undefined,
  accessToken?: string
): Promise<import('./infrastructure-registry.js').VerificationResult> {
  try {
    // Get infrastructure file info (supports with or without extension)
    const { getInfrastructureFile } = await import('./infrastructure-registry.js');
    const infraFile = getInfrastructureFile(fileName);

    if (!infraFile) {
      return { verified: false, error: `Unknown infrastructure file: ${fileName}` };
    }

    // Get actual file SHA using FileStatusTool
    const { FileStatusTool } = await import('./filesystem/index.js');
    const statusTool = new FileStatusTool(sessionAuthManager);

    const result = await statusTool.execute({
      scriptId,
      path: fileName,
      hashTypes: ['git-sha1'],
      includeMetadata: false,
      accessToken
    });

    const actualSHA = result.files?.[0]?.hashes?.['git-sha1'];
    const expectedSHA = infraFile.computeSHA();

    return {
      verified: actualSHA === expectedSHA,
      expectedSHA,
      actualSHA
    };
  } catch (error: any) {
    return {
      verified: false,
      error: `Failed to verify ${fileName}: ${error.message}`
    };
  }
}


/**
 * Create a new project
 */
export class ProjectCreateTool extends BaseTool {
  public name = 'project_create';
  public description = '[PROJECT:CREATE] Create a new GAS project with full infrastructure — sets up dev/staging/prod deployments, git repo, and CommonJS module system. WHEN: starting a new GAS project from scratch. AVOID: use project_init for existing projects; project_create for brand-new projects only. Example: project_create({title: "My App"})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      status: { type: 'string', description: 'Creation status (created)' },
      scriptId: { type: 'string', description: 'New project script ID' },
      title: { type: 'string', description: 'Project title' },
      localName: { type: 'string', description: 'Local config name' },
      addedToLocalConfig: { type: 'boolean', description: 'Whether added to gas-config.json' },
      createTime: { type: 'string', description: 'Project creation timestamp' },
      infrastructure: { type: 'object', description: 'Infrastructure install status (require, exec, configManager)' },
      deployments: { type: 'object', description: 'Deployment URLs (dev, staging, prod)' },
      deploymentsCreated: { type: 'boolean', description: 'Whether deployments were created' },
      instructions: { type: 'string', description: 'Next steps for the user' }
    }
  };

  public inputSchema = {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Human-readable title for the new project. Use descriptive names that indicate the project purpose. This appears in Google Drive and Apps Script dashboard.',
        minLength: 1,
        examples: [
          'Fibonacci Calculator',
          'Spreadsheet Automation Tool',
          'Gmail Email Processor',
          'Data Analysis Scripts',
          'Custom Functions Library'
        ],
        llmHints: {
          naming: 'Use clear, descriptive names for easy identification',
          visibility: 'This title appears in Google Drive and Apps Script editor',
          purpose: 'Include the main function or use case in the title'
        }
      },
      repository: {
        type: 'string',
        description: 'Optional git repository URL. If not provided, creates local-only git repo.',
        examples: ['https://github.com/owner/repo.git', 'local']
      },
      parentId: {
        type: 'string',
        description: 'Google Drive folder ID to create the project in. Organize projects in specific Drive folders. Omit to create in root Drive folder.',
        pattern: '^[a-zA-Z0-9_-]{25,50}$',
        llmHints: {
          organization: 'Use to organize related projects in specific Drive folders',
          optional: 'Omit to create in root Drive folder (most common)',
          obtaining: 'Get folder IDs from Google Drive URL or Drive API calls',
          sharing: 'Project inherits sharing permissions from parent folder'
        }
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation. Omit this - tool uses session authentication from auth.',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$',
        llmHints: {
          typical: 'Usually omitted - tool uses session authentication',
          stateless: 'Only needed for token-based operations without sessions'
        }
      }
    },
    required: ['title'],
    additionalProperties: false,
    llmGuidance: {
      workflow: 'auth → project_create → write code → exec test → deploy_create',
      critical: '⚠️ SAVE scriptId from response for all subsequent operations',
      limitation: 'Standalone scripts only (container-bound: use create_script tool)'
    }
  };

  public annotations = {
    title: 'Create Project',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);

    const title = this.validate.string(params.title, 'title', 'project creation');
    const parentId = params.parentId ? this.validate.string(params.parentId, 'parentId', 'project creation') : undefined;
    const addToLocalConfig = params.addToLocalConfig !== false; // Default to true
    const localName = params.localName || this.generateLocalName(title);
    
    // Use workspace detection instead of process.cwd()
    const { LocalFileManager } = await import('../utils/localFileManager.js');
    const workingDir = params.workingDir || LocalFileManager.getResolvedWorkingDirectory();

    // Debug logging to stderr
    console.error(`🔍 [GAS_PROJECT_CREATE] Debug info:`);
    console.error(`   - params.workingDir: ${params.workingDir}`);
    console.error(`   - process.cwd(): ${process.cwd()}`);
    console.error(`   - detected workingDir: ${workingDir}`);

    try {
      const project = await this.gasClient.createProject(title, parentId, accessToken);

      // Install full CommonJS infrastructure (require + exec + ConfigManager)
      console.error('📦 [GAS_PROJECT_CREATE] Installing CommonJS infrastructure...');
      const infrastructureResults: any = {
        require: null,
        exec: null,
        configManager: null
      };

      try {
        // 1. Install require.js
        infrastructureResults.require = await this.create0ShimFile(project.scriptId, accessToken);

        // 2. Get existing files for subsequent installations
        const existingFiles = await this.gasClient.getProjectContent(project.scriptId, accessToken);
        const existingFileNames = new Set(existingFiles.map((f: any) => f.name));

        // 3. Install __mcp_exec.gs
        const initTool = new ProjectInitTool(this.sessionAuthManager);
        infrastructureResults.exec = await initTool['installExecutionInfrastructure'](
          project.scriptId,
          existingFileNames,
          false,  // force=false
          accessToken
        );

        // 4. Install ConfigManager
        infrastructureResults.configManager = await initTool['installConfigManager'](
          project.scriptId,
          existingFileNames,
          false,  // force=false
          accessToken
        );

        console.error('✅ [GAS_PROJECT_CREATE] Full CommonJS infrastructure installed');
      } catch (infraError: any) {
        console.error(`⚠️  [GAS_PROJECT_CREATE] Infrastructure installation partial: ${infraError.message}`);
      }

      // 5. Create deployments with ConfigManager storage
      let deploymentResult: any = null;
      try {
        console.error('🚀 [GAS_PROJECT_CREATE] Creating default deployments (dev/staging/prod)...');
        const { VersionDeployTool } = await import('./deployment.js');
        const deployTool = new VersionDeployTool(this.sessionAuthManager);
        deploymentResult = await deployTool.execute({
          operation: 'reset',
          scriptId: project.scriptId,
          accessToken
        });
        console.error('✅ [GAS_PROJECT_CREATE] Default deployments created with ConfigManager storage');
      } catch (deployError: any) {
        console.error(`⚠️  [GAS_PROJECT_CREATE] Failed to create deployments: ${deployError.message}`);
        console.error('    Run version_deploy({operation: "reset"}) manually to create deployments');
      }

      // Git initialization removed - users must manually create .git/config breadcrumb
      // See rsync tool documentation for git workflow

      // Add to local configuration
      let localConfigResult = false;
      const localName = params.localName || this.generateLocalName(title);
      try {
        const { ProjectResolver } = await import('../utils/projectResolver.js');
        await ProjectResolver.addProject(localName, project.scriptId, `Created: ${new Date().toLocaleDateString()}`, workingDir);
        localConfigResult = true;
      } catch (error: any) {
        console.error(`⚠️ [GAS_PROJECT_CREATE] Failed to add to local config: ${error.message}`);
      }

      const result: any = {
        status: 'created',
        scriptId: project.scriptId,
        title: project.title,
        localName,
        addedToLocalConfig: localConfigResult,
        createTime: project.createTime,
        updateTime: project.updateTime,
        parentId: project.parentId,
        infrastructure: {
          require: { installed: infrastructureResults.require?.success || false },
          exec: { installed: infrastructureResults.exec?.success || false },
          configManager: { installed: infrastructureResults.configManager?.success || false }
        },
        deployments: deploymentResult?.deployments ? {
          dev: deploymentResult.deployments.dev,
          staging: deploymentResult.deployments.staging,
          prod: deploymentResult.deployments.prod
        } : null,
        deploymentsCreated: deploymentResult !== null,
        instructions: `Project created with full CommonJS infrastructure and deployments. For git sync, manually create .git/config breadcrumb in GAS and use rsync tool.`
      };

      // Add debug info if there were errors
      if (!infrastructureResults.require?.success) {
        result.infraErrors = result.infraErrors || [];
        result.infraErrors.push(`require.js: ${infrastructureResults.require?.error || 'Installation failed'}`);
      }
      if (!infrastructureResults.exec?.success) {
        result.infraErrors = result.infraErrors || [];
        result.infraErrors.push(`__mcp_exec.gs: ${infrastructureResults.exec?.error || 'Installation failed'}`);
      }
      if (!infrastructureResults.configManager?.success) {
        result.infraErrors = result.infraErrors || [];
        result.infraErrors.push(`ConfigManager: ${infrastructureResults.configManager?.error || 'Installation failed'}`);
      }

      return result;
    } catch (error: any) {
      throw new GASApiError(`Project creation failed: ${error.message}`);
    }
  }

  /**
   * Create the require.js file in a new project using RawWriteTool
   * @param scriptId - The script ID of the project
   * @param accessToken - Access token for API calls
   * @returns Promise with success status and any error details
   */
  private async create0ShimFile(scriptId: string, accessToken?: string): Promise<{ success: boolean; error?: string; debug?: any }> {
    try {
      const debugInfo: any = {
        scriptId,
        shimContentLength: SHIM_TEMPLATE.length
      };
      
      console.error(`🔍 [GAS_PROJECT_CREATE] Debug shim creation:`, debugInfo);
      console.error(`   - shimContent length: ${SHIM_TEMPLATE.length} characters`);
      console.error(`   - Using RawWriteTool to create file...`);
      
      // Use RawWriteTool to create the file (position 0 to execute first)
      const { RawWriteTool } = await import('./filesystem/index.js');
      const rawWriteTool = new RawWriteTool(this.sessionAuthManager);
      
      const writeParams = {
        path: `${scriptId}/common-js/require.gs`,
        content: SHIM_TEMPLATE,
        fileType: 'SERVER_JS' as const,
        position: 0,
        skipSyncCheck: true,
        accessToken
      };

      const result = await rawWriteTool.execute(writeParams);

      // Verify CommonJS SHA after creation
      console.error(`🔍 [GAS_PROJECT_CREATE] Verifying CommonJS integrity...`);
      const verification = await verifyInfrastructureFile(
        scriptId,
        'common-js/require.gs',
        this.sessionAuthManager,
        accessToken
      );

      if (!verification.verified) {
        const verifyError = `CommonJS created but verification failed: ${verification.error || 'SHA mismatch'}`;
        console.error(`⚠️ [GAS_PROJECT_CREATE] ${verifyError}`);
        console.error(`   - Expected SHA: ${verification.expectedSHA}`);
        console.error(`   - Actual SHA: ${verification.actualSHA}`);
        return {
          success: false,
          error: verifyError,
          debug: { ...debugInfo, verification, writeResult: result }
        };
      }

      console.error(`✅ [GAS_PROJECT_CREATE] CommonJS verified (SHA: ${verification.actualSHA})`);
      return { success: true, debug: { ...debugInfo, verification, writeResult: result } };
    } catch (error: any) {
              const errorMessage = `Failed to add CommonJS: ${error.message}`;
      console.error(`⚠️ [GAS_PROJECT_CREATE] ${errorMessage}`);
      console.error(`   - Error stack: ${error.stack}`);
      return { success: false, error: errorMessage, debug: { error: error.message, stack: error.stack } };
    }
  }

  private generateLocalName(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-')         // Replace spaces with hyphens
      .replace(/-+/g, '-')          // Collapse multiple hyphens
      .replace(/^-|-$/g, '')        // Remove leading/trailing hyphens
      .substring(0, 30);            // Limit length
  }
}

/**
 * Initialize existing GAS projects with CommonJS and execution infrastructure
 */
export class ProjectInitTool extends BaseTool {
  public name = 'project_init';
  public description = '[PROJECT:INIT] Initialize an existing GAS project with CommonJS infrastructure — installs require.gs, ConfigManager, and __mcp_exec. WHEN: adding module system to an existing project or fixing file ordering. AVOID: use project_create for new projects; project_init for adding CommonJS to existing GAS projects. Example: project_init({scriptId})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      status: { type: 'string', description: 'Overall status (success, partial, failed)' },
      scriptId: { type: 'string', description: 'Project script ID' },
      filesInstalled: { type: 'array', description: 'Infrastructure files installed' },
      filesSkipped: { type: 'array', description: 'Files skipped (already exist)' },
      errors: { type: 'array', description: 'Installation errors' },
      verificationWarnings: { type: 'array', description: 'SHA verification warnings' },
      deploymentsCreated: { type: 'boolean', description: 'Whether deployments were created' },
      deployments: { type: 'object', description: 'Deployment info (dev, staging, prod)' },
      message: { type: 'string', description: 'Summary status message' }
    }
  };

  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Google Apps Script project ID to initialize/update',
        pattern: '^[a-zA-Z0-9_-]{44}$',
        minLength: 44,
        maxLength: 44
      },
      includeCommonJS: {
        type: 'boolean',
        description: 'Install/update CommonJS module system (default: true)',
        default: true
      },
      includeExecutionInfrastructure: {
        type: 'boolean',
        description: 'Install/update __mcp_exec execution infrastructure (default: true)',
        default: true
      },
      updateManifest: {
        type: 'boolean',
        description: 'Update appsscript.json manifest with standard configuration (default: true)',
        default: true
      },
      force: {
        type: 'boolean',
        description: 'SHA verification behavior (default: false). When false: warns on SHA mismatch without repair. When true: auto-repairs SHA mismatches.',
        default: false,
        llmHints: {
          defaultBehavior: 'force=false warns on SHA mismatch, preserves existing files',
          autoRepair: 'force=true auto-repairs SHA mismatches by reinstalling infrastructure',
          verification: 'Uses Git-compatible SHA-1 checksums to verify file integrity'
        }
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$'
      }
    },
    required: ['scriptId'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Retrofit existing projects | exec fails with __defineModule__ error | missing infrastructure',
      verification: 'Git SHA-1 checksums | force=false: warn only | force=true: auto-repair mismatches',
      workflow: 'project_init({scriptId}) → verify infrastructure → exec test',
      fileOrdering: 'Automatically enforces: require at position 0 (module system), ConfigManager at position 1 (configuration), __mcp_exec at position 2 (execution infrastructure). Reorder tool prevents manual changes that break this ordering.'
    }
  };

  public annotations = {
    title: 'Initialize Project',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);

    const scriptId = this.validate.scriptId(params.scriptId, 'project initialization');
    const includeCommonJS = params.includeCommonJS !== false; // Default to true
    const includeExecutionInfrastructure = params.includeExecutionInfrastructure !== false; // Default to true
    const updateManifest = params.updateManifest !== false; // Default to true
    const force = params.force === true; // Default to false

    console.error(`🔧 [GAS_PROJECT_INIT] Initializing project ${scriptId}`);
    console.error(`   - includeCommonJS: ${includeCommonJS}`);
    console.error(`   - includeExecutionInfrastructure: ${includeExecutionInfrastructure}`);
    console.error(`   - updateManifest: ${updateManifest}`);
    console.error(`   - force: ${force}`);

    const result: any = {
      status: 'success',
      scriptId,
      filesInstalled: [],
      filesSkipped: [],
      errors: [],
      verificationWarnings: []
    };

    try {
      // Get existing project files to check what's already there
      const existingFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
      const existingFileNames = new Set(existingFiles.map((f: any) => f.name));

      console.error(`📋 [GAS_PROJECT_INIT] Found ${existingFiles.length} existing files: ${Array.from(existingFileNames).join(', ')}`);

      // Install CommonJS module system
      if (includeCommonJS) {
        const commonJSResult = await this.installCommonJS(scriptId, existingFileNames, force, accessToken);
        if (commonJSResult.success) {
          result.filesInstalled.push(commonJSResult.fileName);
        } else if (commonJSResult.skipped) {
          result.filesSkipped.push(commonJSResult.fileName);
          // Collect verification warnings when force=false and SHA mismatch detected
          if (commonJSResult.warning) {
            result.verificationWarnings.push(commonJSResult.warning);
          }
        } else {
          result.errors.push(commonJSResult.error);
        }

        // Install ConfigManager with CommonJS infrastructure
        const configManagerResult = await this.installConfigManager(scriptId, existingFileNames, force, accessToken);
        if (configManagerResult.success) {
          result.filesInstalled.push(configManagerResult.fileName);
        } else if (configManagerResult.skipped) {
          result.filesSkipped.push(configManagerResult.fileName);
          if (configManagerResult.warning) {
            result.verificationWarnings.push(configManagerResult.warning);
          }
        } else {
          result.errors.push(configManagerResult.error || 'ConfigManager installation failed');
        }
      }

      // Install execution infrastructure
      if (includeExecutionInfrastructure) {
        const executionResult = await this.installExecutionInfrastructure(scriptId, existingFileNames, force, accessToken);
        if (executionResult.success) {
          result.filesInstalled.push(executionResult.fileName);
        } else if (executionResult.skipped) {
          result.filesSkipped.push(executionResult.fileName);
          // Collect verification warnings when force=false and SHA mismatch detected
          if (executionResult.warning) {
            result.verificationWarnings.push(executionResult.warning);
          }
        } else {
          result.errors.push(executionResult.error);
        }

        // Install HTML templates alongside execution infrastructure
        const htmlResults = await this.installHtmlTemplates(scriptId, existingFileNames, force, accessToken);
        for (const htmlResult of htmlResults) {
          if (htmlResult.success) {
            result.filesInstalled.push(htmlResult.fileName);
          } else if (htmlResult.skipped) {
            result.filesSkipped.push(htmlResult.fileName);
          } else {
            result.errors.push(htmlResult.error);
          }
        }
      }

      // Update manifest
      if (updateManifest) {
        const manifestResult = await this.updateProjectManifest(scriptId, existingFileNames, force, accessToken);
        if (manifestResult.success) {
          result.filesInstalled.push(manifestResult.fileName);
        } else if (manifestResult.skipped) {
          result.filesSkipped.push(manifestResult.fileName);
        } else {
          result.errors.push(manifestResult.error);
        }
      }

      // Enforce file ordering: require.gs MUST be at position 0, __mcp_exec.gs at position 1
      console.error(`🔧 [GAS_PROJECT_INIT] Enforcing file order: require.gs at position 0, __mcp_exec.gs at position 1...`);
      await this.enforceFileOrdering(scriptId, accessToken);

      // Create default deployments if missing
      try {
        console.error('🔍 [GAS_PROJECT_INIT] Checking for existing deployments...');
        const { VersionDeployTool } = await import('./deployment.js');
        const deployTool = new VersionDeployTool(this.sessionAuthManager);

        // Check status first
        const statusResult = await deployTool.execute({
          operation: 'status',
          scriptId,
          accessToken
        });

        const hasAllDeployments = statusResult?.environments?.dev &&
                                   statusResult?.environments?.staging &&
                                   statusResult?.environments?.prod;

        if (!hasAllDeployments) {
          console.error('📦 [GAS_PROJECT_INIT] Creating default deployments (dev/staging/prod)...');
          const deploymentResult = await deployTool.execute({
            operation: 'reset',
            scriptId,
            accessToken
          });
          console.error('✅ [GAS_PROJECT_INIT] Default deployments created with ConfigManager storage');

          result.deploymentsCreated = true;
          result.deployments = deploymentResult?.deployments ? {
            dev: deploymentResult.deployments.dev,
            staging: deploymentResult.deployments.staging,
            prod: deploymentResult.deployments.prod
          } : null;
        } else {
          console.error('✅ [GAS_PROJECT_INIT] Deployments already exist, skipping creation');
          result.deploymentsCreated = false;
          result.deployments = 'already_exist';
        }
      } catch (deployError: any) {
        console.error(`⚠️  [GAS_PROJECT_INIT] Failed to check/create deployments: ${deployError.message}`);
        console.error('    Run version_deploy({operation: "reset"}) manually to create deployments');
        result.deploymentWarning = deployError.message;
      }

      // Determine overall status
      if (result.errors.length > 0) {
        result.status = result.filesInstalled.length > 0 ? 'partial' : 'failed';
      }

      result.message = this.generateStatusMessage(result);

      console.error(`✅ [GAS_PROJECT_INIT] Initialization complete: ${result.message}`);
      return result;

    } catch (error: any) {
      console.error(`❌ [GAS_PROJECT_INIT] Initialization failed: ${error.message}`);
      throw new GASApiError(`Project initialization failed: ${error.message}`);
    }
  }

  /**
   * Install CommonJS module system
   */
  private async installCommonJS(scriptId: string, existingFiles: Set<string>, force: boolean, accessToken?: string): Promise<any> {
    const fileName = 'common-js/require.gs';

    // Check if file exists and verify if needed
    if (existingFiles.has(fileName)) {
      // File exists - verify SHA
      console.error(`🔍 [GAS_PROJECT_INIT] CommonJS already exists, verifying integrity...`);
      const verification = await verifyInfrastructureFile(
        scriptId,
        fileName,
        this.sessionAuthManager,
        accessToken
      );

      if (verification.verified) {
        console.error(`✅ [GAS_PROJECT_INIT] CommonJS verified (SHA: ${verification.actualSHA})`);
        return { skipped: true, fileName, verification };
      }

      // SHA mismatch detected
      if (!force) {
        // force=false: WARN only, don't repair
        const warning = `CommonJS SHA mismatch detected but not repaired (use force=true to auto-repair). Expected: ${verification.expectedSHA}, Actual: ${verification.actualSHA}`;
        console.error(`⚠️ [GAS_PROJECT_INIT] ${warning}`);
        return {
          skipped: true,
          fileName,
          verification,
          warning
        };
      }

      // force=true: Auto-repair
      console.error(`🔧 [GAS_PROJECT_INIT] CommonJS SHA mismatch, auto-repairing (force=true)...`);
      console.error(`   - Expected SHA: ${verification.expectedSHA}`);
      console.error(`   - Actual SHA: ${verification.actualSHA}`);
      // Fall through to reinstall
    }

    try {
      console.error(`🔧 [GAS_PROJECT_INIT] Installing CommonJS module system...`);

      // Sync cache by reading file first (prevents "file out of sync" errors)
      if (existingFiles.has(fileName)) {
        console.error(`🔄 [GAS_PROJECT_INIT] Syncing cache for ${fileName}...`);
        const { CatTool } = await import('./filesystem/index.js');
        const catTool = new CatTool(this.sessionAuthManager);
        try {
          await catTool.execute({
            scriptId,
            path: 'common-js/require',
            accessToken
          });
        } catch (error: any) {
          console.error(`⚠️ [GAS_PROJECT_INIT] Cache sync warning: ${error.message}`);
          // Continue anyway - write will handle this
        }
      }

      const { RawWriteTool } = await import('./filesystem/index.js');
      const rawWriteTool = new RawWriteTool(this.sessionAuthManager);

      const writeParams = {
        path: `${scriptId}/common-js/require.gs`,
        content: SHIM_TEMPLATE,
        fileType: 'SERVER_JS' as const,
        position: 0, // Execute first
        skipSyncCheck: true,
        accessToken
      };

      await rawWriteTool.execute(writeParams);

      // Verify after installation
      console.error(`🔍 [GAS_PROJECT_INIT] Verifying CommonJS after installation...`);
      const verification = await verifyInfrastructureFile(
        scriptId,
        fileName,
        this.sessionAuthManager,
        accessToken
      );

      if (!verification.verified) {
        const verifyError = `CommonJS installed but verification failed: ${verification.error || 'SHA mismatch'}`;
        console.error(`⚠️ [GAS_PROJECT_INIT] ${verifyError}`);
        return { error: verifyError, fileName, verification };
      }

      console.error(`✅ [GAS_PROJECT_INIT] CommonJS module system installed and verified (SHA: ${verification.actualSHA})`);
      return { success: true, fileName, verification };
    } catch (error: any) {
      const errorMessage = `Failed to install CommonJS: ${error.message}`;
      console.error(`❌ [GAS_PROJECT_INIT] ${errorMessage}`);
      return { error: errorMessage, fileName };
    }
  }

  /**
   * Install execution infrastructure (__mcp_exec.js)
   */
  private async installExecutionInfrastructure(scriptId: string, existingFiles: Set<string>, force: boolean, accessToken?: string): Promise<any> {
    const fileName = 'common-js/__mcp_exec.gs';

    // Check if file exists and verify if needed
    if (existingFiles.has(fileName)) {
      // File exists - verify SHA
      console.error(`🔍 [GAS_PROJECT_INIT] Execution infrastructure already exists, verifying integrity...`);
      const verification = await verifyInfrastructureFile(
        scriptId,
        fileName,
        this.sessionAuthManager,
        accessToken
      );

      if (verification.verified) {
        console.error(`✅ [GAS_PROJECT_INIT] Execution infrastructure verified (SHA: ${verification.actualSHA})`);
        return { skipped: true, fileName, verification };
      }

      // SHA mismatch detected
      if (!force) {
        // force=false: WARN only, don't repair
        const warning = `Execution infrastructure SHA mismatch detected but not repaired (use force=true to auto-repair). Expected: ${verification.expectedSHA}, Actual: ${verification.actualSHA}`;
        console.error(`⚠️ [GAS_PROJECT_INIT] ${warning}`);
        return {
          skipped: true,
          fileName,
          verification,
          warning
        };
      }

      // force=true: Auto-repair
      console.error(`🔧 [GAS_PROJECT_INIT] Execution infrastructure SHA mismatch, auto-repairing (force=true)...`);
      console.error(`   - Expected SHA: ${verification.expectedSHA}`);
      console.error(`   - Actual SHA: ${verification.actualSHA}`);
      // Fall through to reinstall
    }

    try {
      console.error(`🔧 [GAS_PROJECT_INIT] Installing execution infrastructure...`);

      // Sync cache by reading file first (prevents "file out of sync" errors)
      if (existingFiles.has(fileName)) {
        console.error(`🔄 [GAS_PROJECT_INIT] Syncing cache for ${fileName}...`);
        const { CatTool } = await import('./filesystem/index.js');
        const catTool = new CatTool(this.sessionAuthManager);
        try {
          await catTool.execute({
            scriptId,
            path: 'common-js/__mcp_exec',
            accessToken
          });
        } catch (error: any) {
          console.error(`⚠️ [GAS_PROJECT_INIT] Cache sync warning: ${error.message}`);
          // Continue anyway - write will handle this
        }
      }

      const executionTemplate = getExecutionTemplate();

      const { RawWriteTool } = await import('./filesystem/index.js');
      const rawWriteTool = new RawWriteTool(this.sessionAuthManager);

      const writeParams = {
        path: `${scriptId}/common-js/__mcp_exec.gs`,
        content: executionTemplate,
        fileType: 'SERVER_JS' as const,
        position: 2, // Execute after require (0) and ConfigManager (1)
        skipSyncCheck: true,
        accessToken
      };

      await rawWriteTool.execute(writeParams);

      // Verify after installation
      console.error(`🔍 [GAS_PROJECT_INIT] Verifying execution infrastructure after installation...`);
      const verification = await verifyInfrastructureFile(
        scriptId,
        fileName,
        this.sessionAuthManager,
        accessToken
      );

      if (!verification.verified) {
        const verifyError = `Execution infrastructure installed but verification failed: ${verification.error || 'SHA mismatch'}`;
        console.error(`⚠️ [GAS_PROJECT_INIT] ${verifyError}`);
        return { error: verifyError, fileName, verification };
      }

      console.error(`✅ [GAS_PROJECT_INIT] Execution infrastructure installed and verified (SHA: ${verification.actualSHA})`);
      return { success: true, fileName, verification };
    } catch (error: any) {
      const errorMessage = `Failed to install execution infrastructure: ${error.message}`;
      console.error(`❌ [GAS_PROJECT_INIT] ${errorMessage}`);
      return { error: errorMessage, fileName };
    }
  }

  /**
   * Install ConfigManager infrastructure
   */
  private async installConfigManager(
    scriptId: string,
    existingFiles: Set<string>,
    force: boolean,
    accessToken?: string
  ): Promise<any> {
    const fileName = 'common-js/ConfigManager';

    // Check if file exists and verify if needed
    if (existingFiles.has(fileName)) {
      console.error(`🔍 [GAS_PROJECT_INIT] ConfigManager already exists, verifying integrity...`);
      const verification = await verifyInfrastructureFile(
        scriptId,
        fileName,
        this.sessionAuthManager,
        accessToken
      );

      if (verification.verified) {
        console.error(`✅ [GAS_PROJECT_INIT] ConfigManager verified (SHA: ${verification.actualSHA})`);
        return { skipped: true, fileName, verification };
      }

      // SHA mismatch detected
      if (!force) {
        const warning = `ConfigManager SHA mismatch detected but not repaired (use force=true to auto-repair). Expected: ${verification.expectedSHA}, Actual: ${verification.actualSHA}`;
        console.error(`⚠️  [GAS_PROJECT_INIT] ${warning}`);
        return {
          skipped: true,
          fileName,
          verification,
          warning
        };
      }

      // force=true: Auto-repair
      console.error(`🔧 [GAS_PROJECT_INIT] ConfigManager SHA mismatch, auto-repairing (force=true)...`);
      console.error(`   - Expected SHA: ${verification.expectedSHA}`);
      console.error(`   - Actual SHA: ${verification.actualSHA}`);
      // Fall through to reinstall
    }

    try {
      console.error(`🔧 [GAS_PROJECT_INIT] Installing ConfigManager...`);

      // Sync cache by reading file first (prevents "file out of sync" errors)
      if (existingFiles.has(fileName)) {
        console.error(`🔄 [GAS_PROJECT_INIT] Syncing cache for ${fileName}...`);
        const { CatTool } = await import('./filesystem/index.js');
        const catTool = new CatTool(this.sessionAuthManager);
        try {
          await catTool.execute({
            scriptId,
            path: 'common-js/ConfigManager',
            accessToken
          });
        } catch (error: any) {
          console.error(`⚠️  [GAS_PROJECT_INIT] Cache sync warning: ${error.message}`);
          // Continue anyway - write will handle this
        }
      }

      // Read template using centralized loader
      const content = loadTemplate('templates/ConfigManager.template.js');

      const { RawWriteTool } = await import('./filesystem/index.js');
      const rawWriteTool = new RawWriteTool(this.sessionAuthManager);

      const writeParams = {
        path: `${scriptId}/common-js/ConfigManager`,
        content,
        fileType: 'SERVER_JS' as const,
        position: 1, // Execute after require (position 0)
        skipSyncCheck: true,
        accessToken
      };

      await rawWriteTool.execute(writeParams);

      // Verify after installation
      console.error(`🔍 [GAS_PROJECT_INIT] Verifying ConfigManager after installation...`);
      const verification = await verifyInfrastructureFile(
        scriptId,
        fileName,
        this.sessionAuthManager,
        accessToken
      );

      if (!verification.verified) {
        const verifyError = `ConfigManager installed but verification failed: ${verification.error || 'SHA mismatch'}`;
        console.error(`⚠️  [GAS_PROJECT_INIT] ${verifyError}`);
        return { error: verifyError, fileName, verification };
      }

      console.error(`✅ [GAS_PROJECT_INIT] ConfigManager installed and verified (SHA: ${verification.actualSHA})`);
      return { success: true, fileName, verification };
    } catch (error: any) {
      const errorMessage = `Failed to install ConfigManager: ${error.message}`;
      console.error(`❌ [GAS_PROJECT_INIT] ${errorMessage}`);
      return { error: errorMessage, fileName };
    }
  }

  /**
   * Install HTML templates (__mcp_exec_success.html and __mcp_exec_error.html)
   */
  private async installHtmlTemplates(scriptId: string, existingFiles: Set<string>, force: boolean, accessToken?: string): Promise<any> {
    const successFileName = 'common-js/__mcp_exec_success.html';
    const errorFileName = 'common-js/__mcp_exec_error.html';
    const results: any[] = [];

    // Install success template
    if (existingFiles.has(successFileName) && !force) {
      console.error(`⏭️ [GAS_PROJECT_INIT] Skipping success HTML template (already exists, use force=true to overwrite)`);
      results.push({ skipped: true, fileName: successFileName });
    } else {
      try {
        console.error(`🔧 [GAS_PROJECT_INIT] Installing success HTML template...`);

        // Sync cache by reading file first (prevents "file out of sync" errors)
        if (existingFiles.has(successFileName)) {
          console.error(`🔄 [GAS_PROJECT_INIT] Syncing cache for ${successFileName}...`);
          const { CatTool } = await import('./filesystem/index.js');
          const catTool = new CatTool(this.sessionAuthManager);
          try {
            await catTool.execute({
              scriptId,
              path: 'common-js/__mcp_exec_success',
              accessToken
            });
          } catch (error: any) {
            console.error(`⚠️ [GAS_PROJECT_INIT] Cache sync warning: ${error.message}`);
            // Continue anyway - write will handle this
          }
        }

        const successTemplate = getSuccessHtmlTemplate();

        const { RawWriteTool } = await import('./filesystem/index.js');
        const rawWriteTool = new RawWriteTool(this.sessionAuthManager);

        const writeParams = {
          path: `${scriptId}/common-js/__mcp_exec_success.html`,
          content: successTemplate,
          fileType: 'HTML' as const,
          skipSyncCheck: true,
          accessToken
        };

        await rawWriteTool.execute(writeParams);

        console.error(`✅ [GAS_PROJECT_INIT] Success HTML template installed`);
        results.push({ success: true, fileName: successFileName });
      } catch (error: any) {
        const errorMessage = `Failed to install success HTML template: ${error.message}`;
        console.error(`❌ [GAS_PROJECT_INIT] ${errorMessage}`);
        results.push({ error: errorMessage, fileName: successFileName });
      }
    }

    // Install error template
    if (existingFiles.has(errorFileName) && !force) {
      console.error(`⏭️ [GAS_PROJECT_INIT] Skipping error HTML template (already exists, use force=true to overwrite)`);
      results.push({ skipped: true, fileName: errorFileName });
    } else {
      try {
        console.error(`🔧 [GAS_PROJECT_INIT] Installing error HTML template...`);

        // Sync cache by reading file first (prevents "file out of sync" errors)
        if (existingFiles.has(errorFileName)) {
          console.error(`🔄 [GAS_PROJECT_INIT] Syncing cache for ${errorFileName}...`);
          const { CatTool } = await import('./filesystem/index.js');
          const catTool = new CatTool(this.sessionAuthManager);
          try {
            await catTool.execute({
              scriptId,
              path: 'common-js/__mcp_exec_error',
              accessToken
            });
          } catch (error: any) {
            console.error(`⚠️ [GAS_PROJECT_INIT] Cache sync warning: ${error.message}`);
            // Continue anyway - write will handle this
          }
        }

        const errorTemplate = getErrorHtmlTemplate();

        const { RawWriteTool } = await import('./filesystem/index.js');
        const rawWriteTool = new RawWriteTool(this.sessionAuthManager);

        const writeParams = {
          path: `${scriptId}/common-js/__mcp_exec_error.html`,
          content: errorTemplate,
          fileType: 'HTML' as const,
          skipSyncCheck: true,
          accessToken
        };

        await rawWriteTool.execute(writeParams);

        console.error(`✅ [GAS_PROJECT_INIT] Error HTML template installed`);
        results.push({ success: true, fileName: errorFileName });
      } catch (error: any) {
        const errorMessage = `Failed to install error HTML template: ${error.message}`;
        console.error(`❌ [GAS_PROJECT_INIT] ${errorMessage}`);
        results.push({ error: errorMessage, fileName: errorFileName });
      }
    }

    return results;
  }


  /**
   * Update project manifest (appsscript.json)
   */
  private async updateProjectManifest(scriptId: string, existingFiles: Set<string>, force: boolean, accessToken?: string): Promise<any> {
    const fileName = 'appsscript';

    if (existingFiles.has(fileName) && !force) {
      console.error(`⏭️ [GAS_PROJECT_INIT] Skipping manifest update (already exists, use force=true to overwrite)`);
      return { skipped: true, fileName };
    }

    try {
      console.error(`🔧 [GAS_PROJECT_INIT] Updating project manifest...`);

      // Sync cache by reading file first (prevents "file out of sync" errors)
      if (existingFiles.has(fileName)) {
        console.error(`🔄 [GAS_PROJECT_INIT] Syncing cache for ${fileName}...`);
        const { CatTool } = await import('./filesystem/index.js');
        const catTool = new CatTool(this.sessionAuthManager);
        try {
          await catTool.execute({
            scriptId,
            path: 'appsscript',
            accessToken
          });
        } catch (error: any) {
          console.error(`⚠️ [GAS_PROJECT_INIT] Cache sync warning: ${error.message}`);
          // Continue anyway - write will handle this
        }
      }

      const manifestTemplate = getManifestTemplate();

      const { RawWriteTool } = await import('./filesystem/index.js');
      const rawWriteTool = new RawWriteTool(this.sessionAuthManager);

      const writeParams = {
        path: `${scriptId}/appsscript`,
        content: JSON.stringify(manifestTemplate, null, 2),
        fileType: 'JSON' as const,
        skipSyncCheck: true,
        accessToken
      };

      await rawWriteTool.execute(writeParams);
      
      console.error(`✅ [GAS_PROJECT_INIT] Project manifest updated`);
      return { success: true, fileName };
    } catch (error: any) {
      const errorMessage = `Failed to update manifest: ${error.message}`;
      console.error(`❌ [GAS_PROJECT_INIT] ${errorMessage}`);
      return { error: errorMessage, fileName };
    }
  }

  /**
   * Generate status message
   */
  private generateStatusMessage(result: any): string {
    const installed = result.filesInstalled.length;
    const skipped = result.filesSkipped.length;
    const errors = result.errors.length;

    let message = `Project initialization ${result.status}`;

    if (installed > 0) {
      message += ` - installed ${installed} file(s): ${result.filesInstalled.join(', ')}`;
    }

    if (skipped > 0) {
      message += ` - skipped ${skipped} existing file(s): ${result.filesSkipped.join(', ')}`;
    }

    if (errors > 0) {
      message += ` - ${errors} error(s) occurred`;
    }

    if (result.status === 'success') {
      message += '. Project is now ready for exec execution and CommonJS modules.';
    } else if (result.status === 'partial') {
      message += '. Some files were installed but errors occurred.';
    } else {
      message += '. Initialization failed.';
    }

    return message;
  }

  /**
   * Enforce critical file ordering after installation
   * Ensures common-js/require.gs is always at position 0
   * Ensures common-js/__mcp_exec.gs is always at position 1
   */
  private async enforceFileOrdering(scriptId: string, accessToken?: string): Promise<void> {
    try {
      // Get current files
      const files = await this.gasClient.getProjectContent(scriptId, accessToken);

      // Find infrastructure files (may have .gs extension)
      const requireIndex = files.findIndex((f: any) => fileNameMatches(f.name, 'common-js/require'));
      const configManagerIndex = files.findIndex((f: any) => fileNameMatches(f.name, 'common-js/ConfigManager'));
      const execIndex = files.findIndex((f: any) => fileNameMatches(f.name, 'common-js/__mcp_exec'));

      // Check if reordering is needed (critical files: require(0), ConfigManager(1), __mcp_exec(2))
      if ((requireIndex !== -1 && requireIndex !== 0) ||
          (configManagerIndex !== -1 && configManagerIndex !== 1) ||
          (execIndex !== -1 && execIndex !== 2)) {

        // Enforce critical file ordering using extract-and-insert pattern
        // This avoids position shifting issues when moving multiple files
        const criticalFileBaseNames = [
          'common-js/require',        // Position 0: Module system
          'common-js/ConfigManager',  // Position 1: Configuration
          'common-js/__mcp_exec'      // Position 2: Execution infrastructure
        ];

        // Extract critical files in order (match with or without extension)
        const criticalFiles: any[] = [];
        criticalFileBaseNames.forEach(baseName => {
          const file = files.find((f: any) => fileNameMatches(f.name, baseName));
          if (file) criticalFiles.push(file);
        });

        // Remove critical files from array (using actual file names)
        const criticalActualNames = new Set(criticalFiles.map(f => f.name));
        const nonCriticalFiles = files.filter(
          (f: any) => !criticalActualNames.has(f.name)
        );

        // Rebuild: critical files first, then others
        const reorderedFiles = [...criticalFiles, ...nonCriticalFiles];

        // Update project with new order
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
            // Update hash cache and mtimes for all files since reordering changes content
            for (const file of updatedFiles) {
              const fileExtension = LocalFileManager.getFileExtensionFromName(file.name);
              const localPath = join(localRoot, file.name + fileExtension);
              try {
                // Update mtime FIRST so updateCachedContentHash captures correct mtime
                if (file.updateTime) {
                  await setFileMtimeToRemote(localPath, file.updateTime, file.type);
                }
                // Then update hash cache with WRAPPED content hash (primary sync mechanism)
                if (file.source) {
                  const contentHash = computeGitSha1(file.source);
                  await updateCachedContentHash(localPath, contentHash);
                }
              } catch (cacheError) {
                // File might not exist locally - that's okay
              }
            }
            console.error(`🔄 [SYNC] Updated local hash cache after file reordering`);
          }
        } catch (syncError) {
          // Don't fail the operation if local sync fails - remote update succeeded
        }

        console.error(`✅ [GAS_PROJECT_INIT] File order enforced: require(0), ConfigManager(1), __mcp_exec(2)`);
      } else {
        console.error(`✅ [GAS_PROJECT_INIT] File order already correct`);
      }
    } catch (error: any) {
      console.error(`⚠️ [GAS_PROJECT_INIT] Failed to enforce file ordering: ${error.message}`);
      // Don't throw - this is a best-effort operation
    }
  }
}

