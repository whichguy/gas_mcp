import { BaseTool } from './base.js';
import { GASClient, DeploymentOptions, EntryPointType, WebAppAccess, WebAppExecuteAs } from '../api/gasClient.js';
import { ValidationError, GASApiError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SCRIPT_ID_SCHEMA } from '../utils/schemaPatterns.js';

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
export class GASDeployCreateTool extends BaseTool {
  public name = 'gas_deploy_create';
  public description = 'Create a deployment of an Apps Script project (supports both API Executable and Web App deployments)';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: SCRIPT_ID_SCHEMA,
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
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
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
        
        // Always use gas_run URL format for consistency
        const webAppUrl = deployment.webAppUrl;
        
        result.webAppUrl = webAppUrl;
        result.usage = [
          `Access your web app: ${webAppUrl}`,
          `Call functions: ${webAppUrl}?func=functionName`,
          `Test known result: ${webAppUrl}?func=knownResultFunction`,
          `Expected result: {"operation":"addition","operands":[15,27],"result":42,"expected":42,"isCorrect":true}`
        ];
        result.testCommands = [
          `curl "${webAppUrl}?func=knownResultFunction"`,
          `curl "${webAppUrl}?func=multiplyFunction"`,
          `curl "${webAppUrl}?func=factorialFunction"`
        ];
      } else {
        console.error(`⚙️ Processing API Executable deployment configuration...`);
        result.instructions = 'API Executable deployment created successfully. Functions can now be executed via gas_run tool.';
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
export class GASVersionCreateTool extends BaseTool {
  public name = 'gas_version_create';
  public description = 'Create a version of an Apps Script project (prerequisite for deployment)';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: SCRIPT_ID_SCHEMA,
      description: {
        type: 'string',
        description: 'Description of this version',
        default: 'Version created via MCP'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
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
         instructions: 'Version created successfully. Use this version number for deployment with gas_deploy_create.'
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
export class GASDeployListTool extends BaseTool {
  public name = 'gas_deploy_list';
  public description = 'List the deployments of an Apps Script project with comprehensive analysis, health assessment, and actionable recommendations. Note: For complete entry point details including web app URLs, use gas_deploy_get_details for individual deployments.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: SCRIPT_ID_SCHEMA,
      pageSize: {
        type: 'number',
        description: 'Maximum number of deployments to return (default: 50)',
        default: 50
      },
      pageToken: {
        type: 'string',
        description: 'Token for pagination (optional)'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
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
        // Get webAppUrl from entry point and convert to gas_run format if available
        let webAppUrl = `https://script.google.com/macros/s/${scriptId}/dev`; // fallback
        if (webAppEntry?.webApp?.url) {
          webAppUrl = this.gasClient.constructGasRunUrlFromWebApp(webAppEntry.webApp.url);
        }
        
        const webAppInfo = {
          deploymentId: deployment.deploymentId,
          versionNumber: deployment.versionNumber,
          description: deployment.description,
          updateTime: deployment.updateTime,
          url: webAppUrl,
          access: webAppEntry?.webApp?.access || 'Unknown',
          executeAs: webAppEntry?.webApp?.executeAs || 'Unknown',
          isHead: isHead
        };
        
        analysis.webApps.push(webAppInfo);
        
        analysis.urlCount++;
        analysis.webAppUrls.push(webAppUrl);
        analysis.testCommands.push(`curl "${webAppUrl}?func=myFunction"`);
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
        analysis.gasRunCommands.push(`gas_run_api_exec --scriptId=${deployment.deploymentId} --functionName=myFunction`);
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
        isHead: deployment.versionNumber === null || deployment.versionNumber === undefined || deployment.versionNumber === 0,
        hasWebApp: hasWebApp,
        hasApiExecutable: (deployment.entryPoints || []).some((ep: any) => ep.entryPointType === 'EXECUTION_API'),
        webAppUrl: hasWebApp && deployment.entryPoints ? 
          (deployment.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP')?.webApp?.url ? 
            this.gasClient.constructGasRunUrlFromWebApp(deployment.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP').webApp.url) : 
            deployment.webAppUrl) : 
          deployment.webAppUrl,
        
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
      recommendations.push('Create a deployment with gas_deploy_create to enable function execution');
      recommendations.push(`Example: gas_deploy_create --scriptId=${scriptId} --entryPointType=WEB_APP`);
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
      return 'No deployments found. Create your first deployment with gas_deploy_create to enable function execution.';
    }
    
    const instructions = [];
    
    if (analysis.webAppCount > 0) {
      instructions.push(`Found ${analysis.webAppCount} web app deployment(s) - use URLs for HTTP access`);
    }
    
    if (analysis.apiExecutableCount > 0) {
      instructions.push(`Found ${analysis.apiExecutableCount} API executable deployment(s) - use gas_run_api_exec for function calls`);
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
export class GASProjectCreateTool extends BaseTool {
  public name = 'gas_project_create';
  public description = 'Creates a new Google Apps Script project. LLM WORKFLOW: This is typically the FIRST step when building new automation or when you need a fresh project for code execution.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Human-readable title for the new project. LLM GUIDANCE: Use descriptive names that indicate the project purpose. This appears in Google Drive and Apps Script dashboard.',
        minLength: 1,
        maxLength: 100,
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
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation. LLM TYPICAL: Omit this - tool uses session authentication from gas_auth.',
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
      typicalSequence: [
        '1. Authenticate: gas_auth({mode: "status"}) → gas_auth({mode: "start"}) if needed',
        '2. Create project: gas_project_create({title: "My Project"})',
        '3. Get scriptId from response for subsequent operations',
        '4. Add code: gas_write({path: "scriptId/fileName", content: "..."})',
        '5. Execute: gas_run({scriptId: "...", js_statement: "..."})'
      ],
      returnValue: {
        scriptId: 'Save this ID - required for all subsequent operations on this project',
        webAppUrl: 'Initially null - created when first deployment is made',
        driveUrl: 'Direct link to edit project in Apps Script editor'
      },
      nextSteps: [
        'Use gas_write to add JavaScript code files',
        'Use gas_run to execute code in the project',
        'Use gas_deploy_create for web app or API deployments'
      ],
      errorHandling: {
        'AuthenticationError': 'Run gas_auth to authenticate first',
        'PermissionError': 'Check Google Drive permissions and API access',
        'QuotaExceeded': 'You may have reached project creation limits'
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
    
    const title = this.validate.string(params.title, 'title', 'project creation');
    const parentId = params.parentId ? this.validate.string(params.parentId, 'parentId', 'project creation') : undefined;

         try {
       const project = await this.gasClient.createProject(title, parentId, accessToken);

       return {
         status: 'created',
         scriptId: project.scriptId,
         title: project.title,
         createTime: project.createTime,
         updateTime: project.updateTime,
         parentId: project.parentId,
         instructions: 'Project created successfully. Add files with gas_write, then deploy with gas_deploy_create.'
       };
    } catch (error: any) {
      throw new GASApiError(`Project creation failed: ${error.message}`);
    }
  }
}

/**
 * Get detailed information about a specific deployment
 */
export class GASDeployGetDetailsTool extends BaseTool {
  public name = 'gas_deploy_get_details';
  public description = 'Gets detailed information about a specific Google Apps Script deployment, including complete entry point configuration and web app URLs that may not be returned by gas_deploy_list.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: SCRIPT_ID_SCHEMA,
      deploymentId: {
        type: 'string',
        description: 'The deployment ID to get details for'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
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
        gasCommand: `gas_run_api_exec --scriptId=${deployment.deploymentId} --functionName=myFunction`,
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
      instructions.push(`🔧 Use: gas_run_api_exec --scriptId=${deployment.scriptId} --functionName=myFunction`);
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
export class GASDeployDeleteTool extends BaseTool {
  public name = 'gas_deploy_delete';
  public description = 'Delete a deployment of an Apps Script project';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: SCRIPT_ID_SCHEMA,
      deploymentId: {
        type: 'string',
        description: 'The deployment ID to delete'
      },
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
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
export class GASDeployUpdateTool extends BaseTool {
  public name = 'gas_deploy_update';
  public description = 'Update a deployment of an Apps Script project';
  
  public inputSchema = {
    type: 'object',
    properties: {
      scriptId: SCRIPT_ID_SCHEMA,
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
      accessToken: {
        type: 'string',
        description: 'Access token for stateless operation (optional)'
      }
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