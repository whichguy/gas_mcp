import { BaseTool } from './base.js';
import { GASClient, DeploymentOptions, EntryPointType, WebAppAccess, WebAppExecuteAs } from '../api/gasClient.js';
import { ValidationError, GASApiError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SCRIPT_ID_SCHEMA } from '../utils/schemaPatterns.js';
import { SHIM_TEMPLATE } from '../config/shimTemplate.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { extractUrlInfo as extractUrlInfoUtil, UrlExtractionResult } from '../utils/urlParser.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Get the __mcp_exec.js template content
 * @returns {string} The execution infrastructure template content
 */
function getExecutionTemplate(): string {
  try {
    // Get the directory of this file - when compiled, this will be in dist/src/tools/
    const currentDir = path.dirname(new URL(import.meta.url).pathname);
    
    // Determine if we're running from compiled code (dist/) or source code (src/)
    let srcDir: string;
    if (currentDir.includes('/dist/')) {
      // Running from compiled code: dist/src/tools -> go up to project root, then to src
      const projectRoot = currentDir.replace(/\/dist\/.*$/, '');
      srcDir = path.join(projectRoot, 'src');
    } else {
      // Running from source code: src/tools -> go up to src
      srcDir = path.join(currentDir, '..');
    }
    
    const templatePath = path.join(srcDir, '__mcp_exec.js');
    
    return fs.readFileSync(templatePath, 'utf8');
  } catch (error) {
    console.error('Error reading __mcp_exec.js template:', error);
    throw new Error(`Failed to read execution template: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get the appsscript.json template content
 * @returns {object} The manifest template object
 */
function getManifestTemplate(): any {
  try {
    // Get the directory of this file - when compiled, this will be in dist/src/tools/
    const currentDir = path.dirname(new URL(import.meta.url).pathname);

    // Determine if we're running from compiled code (dist/) or source code (src/)
    let srcDir: string;
    if (currentDir.includes('/dist/')) {
      // Running from compiled code: dist/src/tools -> go up to project root, then to src
      const projectRoot = currentDir.replace(/\/dist\/.*$/, '');
      srcDir = path.join(projectRoot, 'src');
    } else {
      // Running from source code: src/tools -> go up to src
      srcDir = path.join(currentDir, '..');
    }

    const templatePath = path.join(srcDir, 'appsscript.json');

    const content = fs.readFileSync(templatePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading appsscript.json template:', error);
    throw new Error(`Failed to read manifest template: ${error instanceof Error ? error.message : String(error)}`);
  }
}


/**
 * Get the __mcp_exec_success.html template content
 * @returns {string} The success HTML template content
 */
export function getSuccessHtmlTemplate(): string {
  try {
    const currentDir = path.dirname(new URL(import.meta.url).pathname);

    let srcDir: string;
    if (currentDir.includes('/dist/')) {
      const projectRoot = currentDir.replace(/\/dist\/.*$/, '');
      srcDir = path.join(projectRoot, 'src');
    } else {
      srcDir = path.join(currentDir, '..');
    }

    const templatePath = path.join(srcDir, '__mcp_exec_success.html');

    return fs.readFileSync(templatePath, 'utf8');
  } catch (error) {
    console.error('Error reading __mcp_exec_success.html template:', error);
    throw new Error(`Failed to read success HTML template: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get the __mcp_exec_error.html template content
 * @returns {string} The error HTML template content
 */
export function getErrorHtmlTemplate(): string {
  try {
    const currentDir = path.dirname(new URL(import.meta.url).pathname);

    let srcDir: string;
    if (currentDir.includes('/dist/')) {
      const projectRoot = currentDir.replace(/\/dist\/.*$/, '');
      srcDir = path.join(projectRoot, 'src');
    } else {
      srcDir = path.join(currentDir, '..');
    }

    const templatePath = path.join(srcDir, '__mcp_exec_error.html');

    return fs.readFileSync(templatePath, 'utf8');
  } catch (error) {
    console.error('Error reading __mcp_exec_error.html template:', error);
    throw new Error(`Failed to read error HTML template: ${error instanceof Error ? error.message : String(error)}`);
  }
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
    // Get infrastructure file info
    const { INFRASTRUCTURE_REGISTRY } = await import('./infrastructure-registry.js');
    const infraFile = INFRASTRUCTURE_REGISTRY[fileName];

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
 * Helper function to ensure manifest has proper entry point configuration
 */
async function ensureManifestEntryPoints(
  gasClient: GASClient, 
  scriptId: string, 
  entryPointType: EntryPointType, 
  accessLevel: WebAppAccess,
  accessToken?: string
): Promise<void> {
  try {
    // Get current project content
    const files = await gasClient.getProjectContent(scriptId, accessToken);
    
    // Find manifest file
    const manifestFile = files.find(f => f.name === 'appsscript' || f.name === 'appsscript.json');
    
    if (!manifestFile || !manifestFile.source) {
      console.error('⚠️  No manifest file found, creating one with proper entry points...');
      
      // Create new manifest with proper entry points
      const newManifest = {
        timeZone: 'America/Los_Angeles',
        dependencies: {},
        webapp: {
          access: accessLevel,
          executeAs: 'USER_DEPLOYING'
        },
        executionApi: {
          access: accessLevel
        },
        exceptionLogging: 'STACKDRIVER',
        runtimeVersion: 'V8'
      };
      
      await gasClient.updateFile(scriptId, 'appsscript', JSON.stringify(newManifest, null, 2), undefined, accessToken);
      console.error('✅ Created manifest with proper entry points');
      return;
    }
    
    // Parse existing manifest
    let manifest;
    try {
      manifest = JSON.parse(manifestFile.source);
    } catch (parseError) {
      console.warn('⚠️  Failed to parse existing manifest, recreating...');
      
      const newManifest = {
        timeZone: 'America/Los_Angeles',
        dependencies: {},
        webapp: {
          access: accessLevel,
          executeAs: 'USER_DEPLOYING'
        },
        executionApi: {
          access: accessLevel
        },
        exceptionLogging: 'STACKDRIVER',
        runtimeVersion: 'V8'
      };
      
      await gasClient.updateFile(scriptId, 'appsscript', JSON.stringify(newManifest, null, 2), undefined, accessToken);
      console.error('✅ Recreated manifest with proper entry points');
      return;
    }
    
    // Check if entry points need to be added/updated
    let needsUpdate = false;
    
    // Ensure webapp entry point exists for Web App deployments
    if (entryPointType === 'WEB_APP' || !manifest.webapp) {
      if (!manifest.webapp) {
        manifest.webapp = {
          access: accessLevel,
          executeAs: 'USER_DEPLOYING'
        };
        needsUpdate = true;
        console.error('📝 Added webapp entry point configuration');
      }
    }
    
    // Ensure executionApi entry point exists for API Executable deployments
    if (entryPointType === 'EXECUTION_API' || !manifest.executionApi) {
      if (!manifest.executionApi) {
        manifest.executionApi = {
          access: accessLevel
        };
        needsUpdate = true;
        console.error('📝 Added executionApi entry point configuration');
      }
    }
    
    // Update manifest if needed
    if (needsUpdate) {
      await gasClient.updateFile(scriptId, 'appsscript', JSON.stringify(manifest, null, 2), undefined, accessToken);
      console.error('✅ Updated manifest with proper entry points');
    } else {
      console.error('✅ Manifest already has proper entry point configuration');
    }
    
  } catch (error: any) {
    console.warn('⚠️  Failed to update manifest entry points:', error.message);
    // Don't throw error as deployment can still proceed
  }
}

/**
 * Create a new deployment of a Google Apps Script project
 */
export class DeployCreateTool extends BaseTool {
  public name = 'deploy_create';
  public description = 'Create a deployment of an Apps Script project (supports both API Executable and Web App deployments)';
  
  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      description: {
        type: 'string',
        description: 'Description of this deployment',
        default: 'API Deployment'
      },
      entryPointType: {
        type: 'string',
        enum: ['WEB_APP', 'EXECUTION_API', 'ADD_ON'],
        description: 'Type of deployment (default: EXECUTION_API)',
        default: 'EXECUTION_API'
      },
      webAppAccess: {
        type: 'string',
        enum: ['MYSELF', 'DOMAIN', 'ANYONE', 'ANYONE_ANONYMOUS'],
        description: 'Who can access the web app (for WEB_APP type)',
        default: 'ANYONE'
      },
      webAppExecuteAs: {
        type: 'string',
        enum: ['USER_ACCESSING', 'USER_DEPLOYING'],
        description: 'Who the web app runs as (for WEB_APP type)',
        default: 'USER_ACCESSING'
      },
      accessLevel: {
        type: 'string',
        enum: ['MYSELF', 'DOMAIN', 'ANYONE', 'ANYONE_ANONYMOUS'],
        description: 'Access level for API Executable (for EXECUTION_API type)',
        default: 'MYSELF'
      },
      versionNumber: {
        type: 'number',
        description: 'Version number to deploy (optional - uses HEAD if not specified)'
      },
      manifestFileName: {
        type: 'string',
        description: 'Manifest file name (default: appsscript)',
        default: 'appsscript'
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const scriptId = this.validate.scriptId(params.scriptId, 'deployment creation');
    const description = this.validate.string(params.description || 'API Deployment', 'description', 'deployment creation');
    const versionNumber = params.versionNumber ? this.validate.number(params.versionNumber, 'versionNumber', 'deployment creation') : undefined;
    const manifestFileName = this.validate.string(params.manifestFileName || 'appsscript', 'manifestFileName', 'deployment creation');
    
    // Parse deployment configuration
    const entryPointType = (params.entryPointType || 'EXECUTION_API') as EntryPointType;
    const accessLevel = (params.accessLevel || 'MYSELF') as WebAppAccess;
    const webAppAccess = (params.webAppAccess || 'ANYONE') as WebAppAccess;
    const webAppExecuteAs = (params.webAppExecuteAs || 'USER_ACCESSING') as WebAppExecuteAs;

    // Build deployment options
    const deploymentOptions: DeploymentOptions = {
      entryPointType,
      accessLevel: entryPointType === 'EXECUTION_API' ? accessLevel : undefined
    };

    // Add Web App configuration if deploying as Web App
    if (entryPointType === 'WEB_APP') {
      deploymentOptions.webAppConfig = {
        access: webAppAccess,
        executeAs: webAppExecuteAs
      };
      deploymentOptions.accessLevel = webAppAccess;
    }

    // Ensure manifest has proper entry point configuration
    await ensureManifestEntryPoints(this.gasClient, scriptId, entryPointType, accessLevel, accessToken);

    try {
      const deployment = await this.gasClient.createDeployment(scriptId, description, deploymentOptions, versionNumber, accessToken);

      const result: any = {
        status: 'deployed',
        scriptId,
        deploymentId: deployment.deploymentId,
        description: deployment.description,
        versionNumber: deployment.versionNumber,
        updateTime: deployment.updateTime,
        entryPointType,
        deploymentType: entryPointType
      };

      console.error(`🔍 Debug - entryPointType: ${entryPointType}`);
      console.error(`🔍 Debug - deployment object:`, JSON.stringify(deployment, null, 2));
      console.error(`🔍 Debug - webAppAccess: ${webAppAccess}`);
      console.error(`🔍 Debug - webAppExecuteAs: ${webAppExecuteAs}`);

      // Add specific instructions and endpoints based on deployment type
      if (entryPointType === 'WEB_APP') {
        console.error(`🌐 Processing Web App deployment configuration...`);
        result.instructions = 'Web App deployment created successfully. Use the web app URL to access your functions via HTTP.';
        result.webAppUrl = deployment.webAppUrl;
        result.webAppConfig = {
          access: webAppAccess,
          executeAs: webAppExecuteAs
        };

        // Always use exec URL format for consistency
        const webAppUrl = deployment.webAppUrl;

        result.webAppUrl = webAppUrl;
        result.usage = [
          `Access your web app: ${webAppUrl}`,
          `Call functions: ${webAppUrl}?func=functionName`,
          `Test known result: ${webAppUrl}?func=knownResultFunction`,
          `Expected result: {"operation":"addition","operands":[15,27],"result":42,"expected":42,"isCorrect":true}`,
          `\nNote: Use deploy_list for comprehensive URL information including HEAD (/dev) and versioned (/exec) deployment URLs with both standard and domain-specific formats.`
        ];
        result.testCommands = [
          `curl "${webAppUrl}?func=knownResultFunction"`,
          `curl "${webAppUrl}?func=multiplyFunction"`,
          `curl "${webAppUrl}?func=factorialFunction"`
        ];
      } else {
        console.error(`⚙️ Processing API Executable deployment configuration...`);
        result.instructions = 'API Executable deployment created successfully. Functions can now be executed via exec tool.';
        result.apiEndpoint = `https://script.googleapis.com/v1/scripts/${scriptId}:run`;
      }

             return result;
     } catch (error: any) {
       if (error.status === 403) {
        throw new GASApiError(
          `Deployment failed: Permission denied. Ensure:\n` +
          `1. Script project and calling application share the same Cloud Platform project\n` +
          `2. Apps Script API is enabled in your Cloud Platform project\n` +
          `3. You have Editor or Owner permissions on the script\n` +
          `4. OAuth scopes include 'script.deployments' and 'script.projects'\n\n` +
          `Error: ${error.message}`
        );
      }
      
      if (error.status === 404) {
        throw new GASApiError(
          `Script project not found: ${scriptId}\n` +
          `Please verify the project ID is correct and you have access.`
        );
      }

      throw new GASApiError(`Deployment creation failed: ${error.message}`);
    }
  }
}

/**
 * Create a version of a Google Apps Script project
 */
export class VersionCreateTool extends BaseTool {
  public name = 'version_create';
  public description = 'Create a version of an Apps Script project (prerequisite for deployment)';
  
  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      description: {
        type: 'string',
        description: 'Description of this version',
        default: 'Version created via MCP'
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const scriptId = this.validate.scriptId(params.scriptId, 'version creation');
    const description = this.validate.string(params.description || 'Version created via MCP', 'description', 'version creation');

         try {
       const version = await this.gasClient.createVersion(scriptId, description, accessToken);

       return {
         status: 'version_created',
         scriptId,
         versionNumber: version.versionNumber,
         description: version.description,
         createTime: version.createTime,
         instructions: 'Version created successfully. Use this version number for deployment with deploy_create.'
       };
    } catch (error: any) {
      if (error.status === 403) {
        throw new GASApiError(
          `Version creation failed: Permission denied. Ensure:\n` +
          `1. You have Editor or Owner permissions on the script\n` +
          `2. Apps Script API is enabled in your Cloud Platform project\n` +
          `3. OAuth scopes include 'script.projects'\n\n` +
          `Error: ${error.message}`
        );
      }
      
      if (error.status === 404) {
        throw new GASApiError(
          `Script project not found: ${scriptId}\n` +
          `Please verify the project ID is correct and you have access.`
        );
      }

      throw new GASApiError(`Version creation failed: ${error.message}`);
    }
  }
}

/**
 * List deployments of a Google Apps Script project
 */
export class DeployListTool extends BaseTool {
  public name = 'deploy_list';
  public description = 'List the deployments of an Apps Script project with comprehensive analysis, health assessment, and actionable recommendations. Note: For complete entry point details including web app URLs, use deploy_get_details for individual deployments.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      pageSize: {
        type: 'number',
        description: 'Maximum number of deployments to return (default: 50). Let Google Apps Script API define pagination limits.',
        default: 50
      },
      pageToken: {
        type: 'string',
        description: 'Token for pagination (optional)'
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const scriptId = this.validate.scriptId(params.scriptId, 'deployment listing');
    const pageSize = this.validate.number(params.pageSize || 50, 'pageSize', 'deployment listing');
    const pageToken = params.pageToken ? this.validate.string(params.pageToken, 'pageToken', 'deployment listing') : undefined;

    try {
      const deployments = await this.gasClient.listDeployments(scriptId, accessToken);

      // Enhanced deployment analysis
      const analysis = this.analyzeDeployments(deployments, scriptId);
      
      return {
        scriptId,
        totalCount: deployments.length,
        
        // Raw deployment data (enhanced with detailed entry points)
        deployments: this.formatDeployments(deployments, scriptId),
        
        // Enhanced categorization and analysis
        summary: {
          totalDeployments: deployments.length,
          webAppDeployments: analysis.webAppCount,
          apiExecutableDeployments: analysis.apiExecutableCount,
          headDeployments: analysis.headCount,
          versionedDeployments: analysis.versionedCount,
          deploymentsWithUrls: analysis.urlCount,
          deploymentsWithIssues: analysis.issueCount
        },
        
        // Categorized deployments
        byType: {
          webApps: analysis.webApps,
          apiExecutables: analysis.apiExecutables,
          headDeployments: analysis.headDeployments,
          versionedDeployments: analysis.versionedDeployments
        },
        
        // Health and status information
        health: {
          status: this.assessDeploymentHealth(analysis),
          issues: analysis.issues,
          recommendations: this.generateRecommendations(analysis, scriptId)
        },
        
        // Quick access URLs and commands
        quickAccess: {
          webAppUrls: analysis.webAppUrls,
          testCommands: analysis.testCommands,
          gasRunCommands: analysis.gasRunCommands
        },
        
        // Legacy compatibility
        hasApiExecutableDeployment: analysis.apiExecutableCount > 0,
        hasWebAppDeployment: analysis.webAppCount > 0,
        
        instructions: this.generateInstructions(analysis, deployments.length)
      };
    } catch (error: any) {
      throw new GASApiError(`Failed to list deployments: ${error.message}`);
    }
  }

  /**
   * Extract deployment ID and domain from a web app URL
   * Returns both standard and domain-specific URL formats
   *
   * @param webAppUrl - Full web app URL from Google Apps Script API
   * @returns URL extraction result with deployment ID, domain, and both URL formats
   *
   * @see {@link extractUrlInfoUtil} from urlParser.ts for implementation details
   */
  private extractUrlInfo(webAppUrl: string): UrlExtractionResult {
    return extractUrlInfoUtil(webAppUrl);
  }

  /**
   * Comprehensive deployment analysis
   */
  private analyzeDeployments(deployments: any[], scriptId: string): any {
    const analysis = {
      webAppCount: 0,
      apiExecutableCount: 0,
      headCount: 0,
      versionedCount: 0,
      urlCount: 0,
      issueCount: 0,
      webApps: [] as any[],
      apiExecutables: [] as any[],
      headDeployments: [] as any[],
      versionedDeployments: [] as any[],
      webAppUrls: [] as string[],
      issues: [] as string[],
      testCommands: [] as string[],
      gasRunCommands: [] as string[]
    };

    // Sort deployments by update time (newest first)
    const sortedDeployments = [...deployments].sort((a, b) => 
      new Date(b.updateTime || 0).getTime() - new Date(a.updateTime || 0).getTime()
    );

    for (const deployment of sortedDeployments) {
      const entryPoints = deployment.entryPoints || [];
      const isHead = deployment.versionNumber === null || deployment.versionNumber === undefined || deployment.versionNumber === 0;
      const hasWebApp = entryPoints.some((ep: any) => ep.entryPointType === 'WEB_APP');
      const hasApiExecutable = entryPoints.some((ep: any) => ep.entryPointType === 'EXECUTION_API');
      
      // Version categorization
      if (isHead) {
        analysis.headCount++;
        analysis.headDeployments.push({
          deploymentId: deployment.deploymentId,
          description: deployment.description,
          updateTime: deployment.updateTime,
          entryPoints: entryPoints.length,
          types: entryPoints.map((ep: any) => ep.entryPointType)
        });
      } else {
        analysis.versionedCount++;
        analysis.versionedDeployments.push({
          deploymentId: deployment.deploymentId,
          versionNumber: deployment.versionNumber,
          description: deployment.description,
          updateTime: deployment.updateTime,
          entryPoints: entryPoints.length,
          types: entryPoints.map((ep: any) => ep.entryPointType)
        });
      }

      // Web App analysis
      if (hasWebApp) {
        analysis.webAppCount++;
        const webAppEntry = entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');

        // Get original webAppUrl from entry point
        const originalUrl = webAppEntry?.webApp?.url;

        let urlInfo: any = null;
        let headDebugUrl = null;
        let versionedDebugUrl = null;
        let domainHeadUrl = null;
        let domainVersionedUrl = null;

        if (originalUrl) {
          // Extract URL information (deployment ID, domain, etc.)
          urlInfo = this.extractUrlInfo(originalUrl);

          // Build URLs based on deployment type
          if (urlInfo.deploymentId) {
            // HEAD deployment URLs (test - always reflects latest code)
            headDebugUrl = `${urlInfo.standardBaseUrl}/dev?_mcp_run=true&action=auth_ide`;
            if (urlInfo.isDomainSpecific && urlInfo.domainBaseUrl) {
              domainHeadUrl = `${urlInfo.domainBaseUrl}/dev?_mcp_run=true&action=auth_ide`;
            }

            // Versioned deployment URLs (stable - reflects specific version)
            if (!isHead) {
              versionedDebugUrl = `${urlInfo.standardBaseUrl}/exec?_mcp_run=true&action=auth_ide`;
              if (urlInfo.isDomainSpecific && urlInfo.domainBaseUrl) {
                domainVersionedUrl = `${urlInfo.domainBaseUrl}/exec?_mcp_run=true&action=auth_ide`;
              }
            }
          }
        }

        const webAppInfo = {
          deploymentId: deployment.deploymentId,
          versionNumber: deployment.versionNumber,
          description: deployment.description,
          updateTime: deployment.updateTime,

          // HEAD deployment (test - always current)
          headDeployment: {
            standardUrl: headDebugUrl,
            domainUrl: domainHeadUrl,
            note: 'HEAD deployment - always reflects latest code, requires editor access',
            domain: urlInfo?.domain || null
          },

          // Versioned deployment (stable - specific version)
          versionedDeployment: !isHead ? {
            standardUrl: versionedDebugUrl,
            domainUrl: domainVersionedUrl,
            note: `Version ${deployment.versionNumber} - stable deployment`,
            domain: urlInfo?.domain || null
          } : null,

          access: webAppEntry?.webApp?.access || 'Unknown',
          executeAs: webAppEntry?.webApp?.executeAs || 'Unknown',
          isHead: isHead,
          isDomainSpecific: urlInfo?.isDomainSpecific || false
        };

        analysis.webApps.push(webAppInfo);

        analysis.urlCount++;

        // Add HEAD deployment URLs to test commands
        if (headDebugUrl) {
          analysis.webAppUrls.push(headDebugUrl);
          analysis.testCommands.push(`# HEAD deployment (test - latest code, editor access required):\n${headDebugUrl}`);
          if (domainHeadUrl) {
            analysis.webAppUrls.push(domainHeadUrl);
            analysis.testCommands.push(`# HEAD deployment (Google Workspace domain):\n${domainHeadUrl}`);
          }
        }

        // Add versioned deployment URLs to test commands
        if (versionedDebugUrl && !isHead) {
          analysis.webAppUrls.push(versionedDebugUrl);
          analysis.testCommands.push(`# Version ${deployment.versionNumber} deployment (stable):\n${versionedDebugUrl}`);
          if (domainVersionedUrl) {
            analysis.webAppUrls.push(domainVersionedUrl);
            analysis.testCommands.push(`# Version ${deployment.versionNumber} (Google Workspace domain):\n${domainVersionedUrl}`);
          }
        }
      }

      // API Executable analysis
      if (hasApiExecutable) {
        analysis.apiExecutableCount++;
        const apiInfo = {
          deploymentId: deployment.deploymentId,
          versionNumber: deployment.versionNumber,
          description: deployment.description,
          updateTime: deployment.updateTime,
          access: entryPoints.find((ep: any) => ep.entryPointType === 'EXECUTION_API')?.executionApi?.access || 'Unknown',
          isHead: isHead
        };
        
        analysis.apiExecutables.push(apiInfo);
        analysis.gasRunCommands.push(`exec_api_exec --scriptId=${deployment.deploymentId} --functionName=myFunction`);
      }

      // Issue detection
      if (entryPoints.length === 0) {
        analysis.issues.push(`Deployment ${deployment.deploymentId} has no entry points - may not be functional`);
        analysis.issueCount++;
      }
    }

    return analysis;
  }

  /**
   * Format deployments with enhanced information
   */
  private async formatDeployments(deployments: any[], scriptId: string, accessToken?: string): Promise<any[]> {
    return Promise.all(deployments.map(async deployment => {
      const hasWebApp = (deployment.entryPoints || []).some((ep: any) => ep.entryPointType === 'WEB_APP');
      const isHead = deployment.versionNumber === null || deployment.versionNumber === undefined || deployment.versionNumber === 0;

      // Extract web app URL information
      let headDebugUrl = null;
      let versionedDebugUrl = null;
      let domainHeadUrl = null;
      let domainVersionedUrl = null;
      let urlInfo: any = null;

      if (hasWebApp && deployment.entryPoints) {
        const webAppEntry = deployment.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        const originalUrl = webAppEntry?.webApp?.url;

        if (originalUrl) {
          // Extract URL information (deployment ID, domain, etc.)
          urlInfo = this.extractUrlInfo(originalUrl);

          // Build URLs based on deployment type
          if (urlInfo.deploymentId) {
            // HEAD deployment URLs (test - always reflects latest code)
            headDebugUrl = `${urlInfo.standardBaseUrl}/dev?_mcp_run=true&action=auth_ide`;
            if (urlInfo.isDomainSpecific && urlInfo.domainBaseUrl) {
              domainHeadUrl = `${urlInfo.domainBaseUrl}/dev?_mcp_run=true&action=auth_ide`;
            }

            // Versioned deployment URLs (stable - reflects specific version)
            if (!isHead) {
              versionedDebugUrl = `${urlInfo.standardBaseUrl}/exec?_mcp_run=true&action=auth_ide`;
              if (urlInfo.isDomainSpecific && urlInfo.domainBaseUrl) {
                domainVersionedUrl = `${urlInfo.domainBaseUrl}/exec?_mcp_run=true&action=auth_ide`;
              }
            }
          }
        }
      }

      return {
        deploymentId: deployment.deploymentId,
        versionNumber: deployment.versionNumber,
        description: deployment.description,
        updateTime: deployment.updateTime,
        createTime: deployment.createTime,

        // Entry point analysis
        entryPoints: (deployment.entryPoints || []).map((ep: any) => ({
          type: ep.entryPointType,
          webApp: ep.entryPointType === 'WEB_APP' ? {
            url: ep.webApp?.url,
            access: ep.webApp?.access,
            executeAs: ep.webApp?.executeAs
          } : undefined,
          executionApi: ep.entryPointType === 'EXECUTION_API' ? {
            access: ep.executionApi?.access
          } : undefined
        })),

        // Quick identifiers
        isHead: isHead,
        hasWebApp: hasWebApp,
        hasApiExecutable: (deployment.entryPoints || []).some((ep: any) => ep.entryPointType === 'EXECUTION_API'),
        isDomainSpecific: urlInfo?.isDomainSpecific || false,

        // Debug console URLs - HEAD and versioned deployment structure
        debugUrls: hasWebApp ? {
          // HEAD deployment (test - always current)
          headDeployment: {
            standardUrl: headDebugUrl,
            domainUrl: domainHeadUrl,
            note: 'HEAD deployment - always reflects latest code, requires editor access',
            domain: urlInfo?.domain || null
          },

          // Versioned deployment (stable - specific version)
          versionedDeployment: !isHead ? {
            standardUrl: versionedDebugUrl,
            domainUrl: domainVersionedUrl,
            note: `Version ${deployment.versionNumber} - stable deployment`,
            domain: urlInfo?.domain || null
          } : null
        } : null,

        // Legacy compatibility (returns HEAD debug URL as primary for existing code)
        webAppUrl: headDebugUrl,

        // Deployment config
        deploymentConfig: deployment.deploymentConfig
      };
    }));
  }

  /**
   * Assess overall deployment health
   */
  private assessDeploymentHealth(analysis: any): string {
    if (analysis.issueCount > 0) {
      return 'WARNING';
    }
    
    if (analysis.webAppCount === 0 && analysis.apiExecutableCount === 0) {
      return 'NO_FUNCTIONAL_DEPLOYMENTS';
    }
    
    if (analysis.webAppCount > 0 || analysis.apiExecutableCount > 0) {
      return 'HEALTHY';
    }
    
    return 'UNKNOWN';
  }

  /**
   * Generate actionable recommendations
   */
  private generateRecommendations(analysis: any, scriptId: string): string[] {
    const recommendations = [];
    
    if (analysis.webAppCount === 0 && analysis.apiExecutableCount === 0) {
      recommendations.push('Create a deployment with deploy_create to enable function execution');
      recommendations.push(`Example: deploy_create --scriptId=${scriptId} --entryPointType=WEB_APP`);
    }
    
    if (analysis.headCount === 0 && analysis.versionedCount > 0) {
      recommendations.push('Consider creating a HEAD deployment for automatic latest-code serving');
      recommendations.push('HEAD deployments serve the latest code without requiring redeployment');
    }
    
    if (analysis.webAppCount > 0 && analysis.urlCount < analysis.webAppCount) {
      recommendations.push('Some web app deployments are missing URLs - check entry point configuration');
    }
    
    if (analysis.issueCount > 0) {
      recommendations.push('Review deployments with issues and consider redeploying with proper entry points');
    }
    
    if (analysis.webAppCount > 3) {
      recommendations.push('Consider cleaning up old web app deployments to reduce clutter');
    }
    
    return recommendations;
  }

  /**
   * Generate contextual instructions
   */
  private generateInstructions(analysis: any, totalCount: number): string {
    if (totalCount === 0) {
      return 'No deployments found. Create your first deployment with deploy_create to enable function execution.';
    }
    
    const instructions = [];
    
    if (analysis.webAppCount > 0) {
      instructions.push(`Found ${analysis.webAppCount} web app deployment(s) - use URLs for HTTP access`);
    }
    
    if (analysis.apiExecutableCount > 0) {
      instructions.push(`Found ${analysis.apiExecutableCount} API executable deployment(s) - use exec_api_exec for function calls`);
    }
    
    if (analysis.headCount > 0) {
      instructions.push(`Found ${analysis.headCount} HEAD deployment(s) - these serve latest code automatically`);
    }
    
    if (analysis.issueCount > 0) {
      instructions.push(`⚠️ ${analysis.issueCount} deployment(s) have issues - check health section for details`);
    }
    
    return instructions.join('. ') + '.';
  }
}

/**
 * Create a new project
 */
export class ProjectCreateTool extends BaseTool {
  public name = 'project_create';
  public description = 'Creates a new Google Apps Script project. LLM WORKFLOW: This is typically the FIRST step when building new automation or when you need a fresh project for code execution.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Human-readable title for the new project. LLM GUIDANCE: Use descriptive names that indicate the project purpose. This appears in Google Drive and Apps Script dashboard.',
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
        description: 'Google Drive folder ID to create the project in. LLM USE: Organize projects in specific Drive folders. Omit to create in root Drive folder.',
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
        description: 'Access token for stateless operation. LLM TYPICAL: Omit this - tool uses session authentication from auth.',
        pattern: '^ya29\\.[a-zA-Z0-9_-]+$',
        llmHints: {
          typical: 'Usually omitted - tool uses session authentication',
          stateless: 'Only needed for token-based operations without sessions'
        }
      }
    },
    required: ['title'],
    additionalProperties: false,
    llmWorkflowGuide: {
      typicalSequence: ['1.auth→start if needed', '2.project_create({title,localName})', '3.auto-added to local config', '4.project_set({project})→start working', '5.write({path,content})→uses current', '6.exec({js_statement})→test exec'],
      scriptTypeCompatibility: {standalone: 'Creates standalone (default)', containerBound: 'Cannot create container-bound via API→use driveContainerTools|UI', notes: 'Standalone only→container-bound: bind manually|create_script'},
      limitations: {projectType: 'standalone only (no container-bound)', quotas: 'subject to GAS quota (varies)', initialState: 'CommonJS.js (2-param) auto-deployed→ready for code'},
      returnValue: {scriptId: 'SAVE→required for all ops', localName: 'use with project_set|pull|push', webAppUrl: 'null initially→created on first deploy', driveUrl: 'direct link→Apps Script editor'},
      nextSteps: ['IMMEDIATE: save scriptId', 'OPTIONAL: project_set({project:localName})', 'ADD CODE: write({scriptId,path,content})', 'TEST: exec({scriptId,js_statement})', 'DEPLOY: deploy_create({scriptId})'],
      relatedTools: {containerBoundAlternative: 'create_script→Sheets/Docs/Forms bound', projectManagement: 'project_list|project_add', codeManagement: 'write|cat', execution: 'exec', deployment: 'version_create+deploy_create'},
      errorHandling: {AuthenticationError: 'auth→start first', PermissionError: 'check Drive perms+API access', QuotaExceeded: 'reached project creation limit'}
    }
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

      // Create the CommonJS.js file
      const shimResult = await this.create0ShimFile(project.scriptId, accessToken);

      // Git initialization removed - users must manually create .git/config.gs breadcrumb
      // See local_sync tool documentation for git workflow

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
        shimCreated: shimResult.success,
        instructions: `Project created with CommonJS module system. For git sync, manually create .git/config.gs breadcrumb in GAS and use local_sync tool. See local_sync documentation for workflow.`
      };

      // Add debug info if there were errors
      if (!shimResult.success) {
        result.shimError = shimResult.error;
        result.shimDebug = shimResult.debug;
      }

      return result;
    } catch (error: any) {
      throw new GASApiError(`Project creation failed: ${error.message}`);
    }
  }

  /**
   * Create the CommonJS.js file in a new project using RawWriteTool
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
        path: `${scriptId}/CommonJS`,
        content: SHIM_TEMPLATE,
        fileType: 'SERVER_JS' as const,
        position: 0,
        accessToken
      };
      
      const result = await rawWriteTool.execute(writeParams);

      // Verify CommonJS SHA after creation
      console.error(`🔍 [GAS_PROJECT_CREATE] Verifying CommonJS integrity...`);
      const verification = await verifyInfrastructureFile(
        scriptId,
        'CommonJS',
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
  public description = 'Initialize/update existing Google Apps Script projects with CommonJS module system and execution infrastructure. Use this to retrofit projects that were not created with project_create or are missing required infrastructure files.';
  
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
    llmWorkflowGuide: {
      whenToUse: ['exec fails "__defineModule__ not defined"|projects not via project_create|missing exec infra|require()/module.exports broken'],
      prerequisites: ['1.auth→start if needed', '2.scriptId from existing (ls)'],
      scriptTypeCompatibility: {standalone: 'Full Support', containerBound: 'Full Support', notes: 'Universal infra init'},
      shaVerification: {algorithm: 'Git SHA-1: sha1("blob "+size+"\\0"+content)', forcefalse: 'verify+warn on mismatch (no repair, preserves)', forcetrue: 'verify+auto-repair mismatch (reinstall)', warningLocation: 'verificationWarnings[] when force=false', compatibility: 'matches git hash-object'},
      limitations: {existingFiles: 'default preserve→force:true overwrite', manifestUpdates: 'updates appsscript.json', noRollback: 'partial possible→check filesInstalled+errors'},
      useCases: {basicInit: 'project_init({scriptId})', commonJSOnly: 'project_init({scriptId,includeExecutionInfrastructure:false})', executionOnly: 'project_init({scriptId,includeCommonJS:false})', verifyOnly: 'project_init({scriptId,force:false})→SHA check+warn', autoRepair: 'project_init({scriptId,force:true})→SHA auto-repair'},
      returnValue: {status: 'success|partial|failed', scriptId: 'initialized project ID', filesInstalled: 'installed/updated list', filesSkipped: 'existing skipped list', verificationWarnings: 'SHA warnings (force=false+mismatch)', errors: 'error list'},
      nextSteps: ['exec({scriptId,js_statement:"Math.PI*2"})', '__defineModule__(_main) pattern', 'require("ModuleName")']
    }
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
    const fileName = 'CommonJS';

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

      const { RawWriteTool } = await import('./filesystem/index.js');
      const rawWriteTool = new RawWriteTool(this.sessionAuthManager);

      const writeParams = {
        path: `${scriptId}/CommonJS`,
        content: SHIM_TEMPLATE,
        fileType: 'SERVER_JS' as const,
        position: 0, // Execute first
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
    const fileName = '__mcp_exec';

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

      const executionTemplate = getExecutionTemplate();

      const { RawWriteTool } = await import('./filesystem/index.js');
      const rawWriteTool = new RawWriteTool(this.sessionAuthManager);

      const writeParams = {
        path: `${scriptId}/__mcp_exec`,
        content: executionTemplate,
        fileType: 'SERVER_JS' as const,
        position: 1, // Execute after CommonJS
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
   * Install HTML templates (__mcp_exec_success.html and __mcp_exec_error.html)
   */
  private async installHtmlTemplates(scriptId: string, existingFiles: Set<string>, force: boolean, accessToken?: string): Promise<any> {
    const successFileName = '__mcp_exec_success';
    const errorFileName = '__mcp_exec_error';
    const results: any[] = [];

    // Install success template
    if (existingFiles.has(successFileName) && !force) {
      console.error(`⏭️ [GAS_PROJECT_INIT] Skipping success HTML template (already exists, use force=true to overwrite)`);
      results.push({ skipped: true, fileName: successFileName });
    } else {
      try {
        console.error(`🔧 [GAS_PROJECT_INIT] Installing success HTML template...`);

        const successTemplate = getSuccessHtmlTemplate();

        const { RawWriteTool } = await import('./filesystem/index.js');
        const rawWriteTool = new RawWriteTool(this.sessionAuthManager);

        const writeParams = {
          path: `${scriptId}/__mcp_exec_success`,
          content: successTemplate,
          fileType: 'HTML' as const,
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

        const errorTemplate = getErrorHtmlTemplate();

        const { RawWriteTool } = await import('./filesystem/index.js');
        const rawWriteTool = new RawWriteTool(this.sessionAuthManager);

        const writeParams = {
          path: `${scriptId}/__mcp_exec_error`,
          content: errorTemplate,
          fileType: 'HTML' as const,
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
      
      const manifestTemplate = getManifestTemplate();
      
      const { RawWriteTool } = await import('./filesystem/index.js');
      const rawWriteTool = new RawWriteTool(this.sessionAuthManager);
      
      const writeParams = {
        path: `${scriptId}/appsscript`,
        content: JSON.stringify(manifestTemplate, null, 2),
        fileType: 'JSON' as const,
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
}

/**
 * Get detailed information about a specific deployment
 */
export class DeployGetDetailsTool extends BaseTool {
  public name = 'deploy_get_details';
  public description = 'Gets detailed information about a specific Google Apps Script deployment, including complete entry point configuration and web app URLs that may not be returned by deploy_list.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      deploymentId: {
        type: 'string',
        description: 'The deployment ID to get details for'
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'deploymentId']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const scriptId = this.validate.scriptId(params.scriptId, 'deployment details');
    const deploymentId = this.validate.string(params.deploymentId, 'deploymentId', 'deployment details');

    try {
      const deployment = await this.gasClient.getDeployment(scriptId, deploymentId, accessToken);

      // Enhanced response with analysis
      const entryPoints = deployment.entryPoints || [];
      const hasWebApp = entryPoints.some((ep: any) => ep.entryPointType === 'WEB_APP');
      const hasApiExecutable = entryPoints.some((ep: any) => ep.entryPointType === 'EXECUTION_API');
      const isHead = deployment.versionNumber === null || deployment.versionNumber === undefined || deployment.versionNumber === 0;

      // Extract entry point details
      const webAppEntry = entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
      const apiExecutableEntry = entryPoints.find((ep: any) => ep.entryPointType === 'EXECUTION_API');

      const result = {
        status: 'success',
        scriptId,
                 deployment: {
           deploymentId: deployment.deploymentId,
           versionNumber: deployment.versionNumber,
           description: deployment.description,
           manifestFileName: deployment.manifestFileName,
           updateTime: deployment.updateTime,
           deploymentConfig: deployment.deploymentConfig,
          
          // Entry points with detailed analysis
          entryPoints: entryPoints.map((ep: any) => ({
            entryPointType: ep.entryPointType,
            webApp: ep.entryPointType === 'WEB_APP' ? {
              url: ep.webApp?.url,
              access: ep.webApp?.access,
              executeAs: ep.webApp?.executeAs
            } : undefined,
            executionApi: ep.entryPointType === 'EXECUTION_API' ? {
              access: ep.executionApi?.access
            } : undefined
          })),
          
          // Quick analysis flags
          isHead,
          hasWebApp,
          hasApiExecutable,
          webAppUrl: deployment.webAppUrl || webAppEntry?.webApp?.url,
          
          // Status assessment
          status: this.assessDeploymentStatus(entryPoints, isHead),
          functional: entryPoints.length > 0
        },
        
        // Usage information
        usage: this.generateUsageInfo(deployment, entryPoints),
        
        // API endpoint information
        apiEndpoints: {
          deploymentGet: `https://script.googleapis.com/v1/projects/${scriptId}/deployments/${deploymentId}`,
          scriptExecution: hasApiExecutable ? `https://script.googleapis.com/v1/scripts/${scriptId}:run` : undefined,
          webAppAccess: deployment.webAppUrl || webAppEntry?.webApp?.url
        },
        
        instructions: this.generateDetailedInstructions(deployment, entryPoints)
      };

      return result;
    } catch (error: any) {
      if (error.status === 404) {
        throw new GASApiError(
          `Deployment not found: ${deploymentId} in script ${scriptId}\n` +
          `Please verify the deployment ID is correct and you have access.`
        );
      }
      
      if (error.status === 403) {
        throw new GASApiError(
          `Access denied to deployment: ${deploymentId}\n` +
          `Ensure you have permissions to view this deployment.`
        );
      }

      throw new GASApiError(`Failed to get deployment details: ${error.message}`);
    }
  }

  /**
   * Assess deployment status based on entry points
   */
  private assessDeploymentStatus(entryPoints: any[], isHead: boolean): string {
    if (entryPoints.length === 0) {
      return 'NON_FUNCTIONAL';
    }
    
    const hasWebApp = entryPoints.some((ep: any) => ep.entryPointType === 'WEB_APP');
    const hasApiExecutable = entryPoints.some((ep: any) => ep.entryPointType === 'EXECUTION_API');
    
    if (hasWebApp && hasApiExecutable) {
      return 'FULLY_FUNCTIONAL';
    } else if (hasWebApp || hasApiExecutable) {
      return 'FUNCTIONAL';
    }
    
    return 'UNKNOWN';
  }

  /**
   * Generate usage information based on deployment configuration
   */
  private generateUsageInfo(deployment: any, entryPoints: any[]): any {
    const usage: any = {
      deploymentType: deployment.versionNumber ? 'versioned' : 'head',
      description: deployment.versionNumber ? 
        `Version ${deployment.versionNumber} deployment - serves specific version` :
        'HEAD deployment - serves latest saved content automatically'
    };

    const webAppEntry = entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
    const apiExecutableEntry = entryPoints.find((ep: any) => ep.entryPointType === 'EXECUTION_API');

    if (webAppEntry) {
      const webAppUrl = deployment.webAppUrl || webAppEntry.webApp?.url;
      usage.webApp = {
        access: webAppEntry.webApp?.access || 'Unknown',
        executeAs: webAppEntry.webApp?.executeAs || 'Unknown',
        url: webAppUrl,
        examples: webAppUrl ? [
          `${webAppUrl}`,
          `${webAppUrl}?func=functionName`,
          `${webAppUrl}?function_plus_args=functionName(arg1,arg2)`
        ] : ['URL not available'],
        curlExamples: webAppUrl ? [
          `curl "${webAppUrl}"`,
          `curl "${webAppUrl}?func=myFunction"`,
          `curl -X POST "${webAppUrl}" -H "Content-Type: application/json" -d '{"function_plus_args":"myFunction(123)"}'`
        ] : []
      };
    }

    if (apiExecutableEntry) {
      usage.apiExecutable = {
        access: apiExecutableEntry.executionApi?.access || 'Unknown',
        gasCommand: `exec_api_exec --scriptId=${deployment.deploymentId} --functionName=myFunction`,
        requirements: [
          'Function must be accessible via Apps Script API',
          'Proper OAuth scopes required',
          'Calling application must share same Cloud Platform project'
        ]
      };
    }

    return usage;
  }

  /**
   * Generate detailed instructions for using the deployment
   */
  private generateDetailedInstructions(deployment: any, entryPoints: any[]): string[] {
    const instructions = [];
    
    if (entryPoints.length === 0) {
      instructions.push('⚠️ This deployment has no entry points and is not functional');
      instructions.push('Redeploy with proper manifest configuration to enable access');
      return instructions;
    }

    const webAppEntry = entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
    const apiExecutableEntry = entryPoints.find((ep: any) => ep.entryPointType === 'EXECUTION_API');

    if (webAppEntry) {
      const webAppUrl = deployment.webAppUrl || webAppEntry.webApp?.url;
      if (webAppUrl) {
        instructions.push(`🌐 Web App accessible at: ${webAppUrl}`);
        instructions.push(`🔑 Access level: ${webAppEntry.webApp?.access || 'Unknown'}`);
        instructions.push(`👤 Executes as: ${webAppEntry.webApp?.executeAs || 'Unknown'}`);
        instructions.push(`📝 Call functions: ${webAppUrl}?func=functionName`);
      } else {
        instructions.push('⚠️ Web App entry point configured but URL not available');
      }
    }

    if (apiExecutableEntry) {
      instructions.push(`⚙️ API Executable available for function calls`);
      instructions.push(`🔑 Access level: ${apiExecutableEntry.executionApi?.access || 'Unknown'}`);
      instructions.push(`🔧 Use: exec_api_exec --scriptId=${deployment.scriptId} --functionName=myFunction`);
    }

    if (deployment.versionNumber) {
      instructions.push(`📌 Version ${deployment.versionNumber} - serves fixed code version`);
    } else {
      instructions.push(`🔄 HEAD deployment - automatically serves latest saved content`);
    }

    return instructions;
  }
}

/**
 * Delete a deployment of an Apps Script project
 */
export class DeployDeleteTool extends BaseTool {
  public name = 'deploy_delete';
  public description = 'Delete a deployment of an Apps Script project';
  
  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      deploymentId: {
        type: 'string',
        description: 'The deployment ID to delete'
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'deploymentId']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const scriptId = this.validate.scriptId(params.scriptId, 'deployment deletion');
    const deploymentId = this.validate.string(params.deploymentId, 'deploymentId', 'deployment deletion');

    return await this.handleApiCall(
      () => this.gasClient.deleteDeployment(scriptId, deploymentId, accessToken),
      'delete deployment',
      { scriptId, deploymentId }
    );
  }
}

/**
 * Update a deployment of an Apps Script project
 */
export class DeployUpdateTool extends BaseTool {
  public name = 'deploy_update';
  public description = 'Update a deployment of an Apps Script project';
  
  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      deploymentId: {
        type: 'string',
        description: 'The deployment ID to update'
      },
      description: {
        type: 'string',
        description: 'New description for the deployment (optional)'
      },
      entryPointType: {
        type: 'string',
        enum: ['WEB_APP', 'EXECUTION_API', 'ADD_ON'],
        description: 'Type of deployment entry point (optional)'
      },
      webAppAccess: {
        type: 'string',
        enum: ['MYSELF', 'DOMAIN', 'ANYONE', 'ANYONE_ANONYMOUS'],
        description: 'Who can access the web app (for WEB_APP type, optional)'
      },
      webAppExecuteAs: {
        type: 'string',
        enum: ['USER_ACCESSING', 'USER_DEPLOYING'],
        description: 'Who the web app runs as (for WEB_APP type, optional)'
      },
      accessLevel: {
        type: 'string',
        enum: ['MYSELF', 'DOMAIN', 'ANYONE', 'ANYONE_ANONYMOUS'],
        description: 'Access level for API Executable (for EXECUTION_API type, optional)'
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'deploymentId']
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const scriptId = this.validate.scriptId(params.scriptId, 'deployment update');
    const deploymentId = this.validate.string(params.deploymentId, 'deploymentId', 'deployment update');
    
    // Build update object with only provided parameters
    const updates: any = {};
    
    if (params.description) {
      updates.description = this.validate.string(params.description, 'description', 'deployment update');
    }
    
    if (params.entryPointType) {
      const entryPointType = this.validate.enum(params.entryPointType, 'entryPointType', ['WEB_APP', 'EXECUTION_API', 'ADD_ON'], 'deployment update');
      updates.entryPointType = entryPointType;
      
      // Add entry point specific configurations
      if (entryPointType === 'WEB_APP') {
        if (params.webAppAccess) {
          updates.webAppAccess = this.validate.enum(params.webAppAccess, 'webAppAccess', ['MYSELF', 'DOMAIN', 'ANYONE', 'ANYONE_ANONYMOUS'], 'deployment update');
        }
        if (params.webAppExecuteAs) {
          updates.webAppExecuteAs = this.validate.enum(params.webAppExecuteAs, 'webAppExecuteAs', ['USER_ACCESSING', 'USER_DEPLOYING'], 'deployment update');
        }
      } else if (entryPointType === 'EXECUTION_API') {
        if (params.accessLevel) {
          updates.accessLevel = this.validate.enum(params.accessLevel, 'accessLevel', ['MYSELF', 'DOMAIN', 'ANYONE', 'ANYONE_ANONYMOUS'], 'deployment update');
        }
      }
    }

    return await this.handleApiCall(
      () => this.gasClient.updateDeployment(scriptId, deploymentId, updates, accessToken),
      'update deployment',
      { scriptId, deploymentId, updates }
    );
  }
} 