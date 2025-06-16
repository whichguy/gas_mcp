import { google } from 'googleapis';
import { GASAuthClient } from '../auth/oauthClient.js';
import { rateLimiter } from './rateLimiter.js';
import { GASApiError } from '../errors/mcpErrors.js';
import { getFileType, sortFilesForExecution } from './pathParser.js';
import { AuthConfig } from '../auth/oauthClient.js';

/**
 * Google Apps Script project information
 */
export interface GASProject {
  scriptId: string;
  title: string;
  parentId?: string;
  createTime?: string;
  updateTime?: string;
}

/**
 * Google Apps Script file information
 */
export interface GASFile {
  name: string;
  type: 'SERVER_JS' | 'HTML' | 'JSON';
  source?: string;
  functionSet?: {
    values: Array<{
      name: string;
    }>;
  };
}

/**
 * Google Apps Script deployment information
 */
export interface GASDeployment {
  deploymentId: string;
  versionNumber: number;
  description?: string;
  manifestFileName?: string;
  updateTime?: string;
  webAppUrl?: string;
  deploymentConfig?: {
    scriptId: string;
    description: string;
    manifestFileName: string;
    versionNumber: number;
  };
  entryPoints?: EntryPoint[];
}

/**
 * Deployment entry point types
 */
export type EntryPointType = 'WEB_APP' | 'EXECUTION_API' | 'ADD_ON';

/**
 * Web App access levels
 */
export type WebAppAccess = 'MYSELF' | 'DOMAIN' | 'ANYONE' | 'ANYONE_ANONYMOUS';

/**
 * Web App execution context
 */
export type WebAppExecuteAs = 'USER_ACCESSING' | 'USER_DEPLOYING';

/**
 * Web App configuration
 */
export interface WebAppConfig {
  access: WebAppAccess;
  executeAs: WebAppExecuteAs;
}

/**
 * Web App entry point
 */
export interface WebAppEntryPoint {
  url?: string;
  entryPointConfig: WebAppConfig;
}

/**
 * API Executable entry point
 */
export interface ExecutionApiEntryPoint {
  entryPointConfig: {
    access: WebAppAccess;
  };
}

/**
 * Deployment entry point
 */
export interface EntryPoint {
  entryPointType: EntryPointType;
  webApp?: WebAppEntryPoint;
  executionApi?: ExecutionApiEntryPoint;
}

/**
 * Deployment configuration options
 */
export interface DeploymentOptions {
  entryPointType?: EntryPointType;
  webAppConfig?: WebAppConfig;
  accessLevel?: WebAppAccess;
}

/**
 * Execution request parameters
 */
export interface ExecutionRequest {
  function: string;
  parameters?: any[];
  devMode?: boolean;
}

/**
 * Execution response
 */
export interface ExecutionResponse {
  result?: any;
  error?: {
    type: string;
    message: string;
    scriptStackTraceElements?: Array<{
      function: string;
      lineNumber: number;
    }>;
  };
}

/**
 * Google Apps Script API client with authentication and rate limiting
 */
export class GASClient {
  private authClient: GASAuthClient;
  private scriptApi: any;
  private driveApi: any;

  constructor() {
    // Use simplified OAuth configuration from JSON file only
    try {
      const { loadOAuthConfigFromJson } = require('../tools/auth.js');
      const config = loadOAuthConfigFromJson();
      this.authClient = new GASAuthClient(config);
    } catch (error) {
      // If config loading fails, create a minimal client that will fail fast
      console.warn('⚠️  GASClient: Failed to load OAuth config, using minimal fallback');
      const minimalConfig: AuthConfig = {
        client_id: 'gas-client-no-config',
        client_secret: undefined,
        type: 'uwp',
        redirect_uris: ['http://127.0.0.1/*', 'http://localhost/*'],
        scopes: []
      };
      this.authClient = new GASAuthClient(minimalConfig);
    }
  }

  /**
   * Initialize the Google APIs client
   */
  private async initializeClient(accessToken?: string): Promise<void> {
    // accessToken must be provided for API calls since GASAuthClient doesn't manage tokens directly
    if (!accessToken) {
      throw new Error('Access token is required for API initialization');
    }
    
    const token = accessToken;
    
    console.log(`🔧 Initializing GAS client with token: ${token.substring(0, 20)}...`);
    
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: token });
    
    this.scriptApi = google.script({ version: 'v1', auth });
    this.driveApi = google.drive({ version: 'v3', auth });
    
    console.log(`✅ GAS client initialized`);
    console.log(`   scriptApi available: ${!!this.scriptApi}`);
    console.log(`   driveApi available: ${!!this.driveApi}`);
  }

  /**
   * Make rate-limited API call with error handling
   */
  private async makeApiCall<T>(apiCall: () => Promise<T>, accessToken?: string): Promise<T> {
    console.log(`🚀 makeApiCall called with accessToken: ${accessToken ? accessToken.substring(0, 20) + '...' : 'undefined'}`);
    
    await rateLimiter.checkLimit();
    
    try {
      // Initialize client before making the API call
      console.log(`🔧 About to initialize client...`);
      await this.initializeClient(accessToken);
      console.log(`✅ Client initialized, calling API...`);
      return await apiCall();
    } catch (error: any) {
      console.error(`❌ API call failed:`, error);
      const statusCode = error.response?.status || error.code;
      const message = error.response?.data?.error?.message || error.message;
      
      throw new GASApiError(
        `Apps Script API error: ${message}`,
        statusCode,
        error
      );
    }
  }

  /**
   * List all accessible projects
   */
  async listProjects(pageSize: number = 10, accessToken?: string): Promise<GASProject[]> {
    return this.makeApiCall(async () => {
      console.log(`📋 Listing Apps Script projects via Drive API...`);
      
      // Apps Script projects are Drive files with MIME type 'application/vnd.google-apps.script'
      const response = await this.driveApi.files.list({
        q: "mimeType='application/vnd.google-apps.script' and trashed=false",
        pageSize,
        fields: 'files(id,name,createdTime,modifiedTime,parents)'
      });
      
      const files = response.data.files || [];
      console.log(`📊 Found ${files.length} Apps Script projects`);
      
      return files.map((file: any) => ({
        scriptId: file.id,
        title: file.name,
        parentId: file.parents?.[0],
        createTime: file.createdTime,
        updateTime: file.modifiedTime
      }));
    }, accessToken);
  }

  /**
   * Get project details
   */
  async getProject(scriptId: string, accessToken?: string): Promise<GASProject> {
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      const response = await this.scriptApi.projects.get({
        scriptId
      });
      
      return {
        scriptId: response.data.scriptId,
        title: response.data.title,
        parentId: response.data.parentId,
        createTime: response.data.createTime,
        updateTime: response.data.updateTime
      };
    }, accessToken);
  }

  /**
   * Get project content (files)
   */
  async getProjectContent(scriptId: string, accessToken?: string): Promise<GASFile[]> {
    return this.makeApiCall(async () => {
      const response = await this.scriptApi.projects.getContent({
        scriptId
      });
      
      const files: GASFile[] = (response.data.files || []).map((file: any) => ({
        name: file.name,
        type: file.type,
        source: file.source,
        functionSet: file.functionSet
      }));

      // Sort files by execution order
      return sortFilesForExecution(files);
    }, accessToken);
  }

  /**
   * Create new project
   */
  async createProject(title: string, parentId?: string, accessToken?: string): Promise<GASProject> {
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      const response = await this.scriptApi.projects.create({
        requestBody: {
          title,
          parentId
        }
      });
      
      return {
        scriptId: response.data.scriptId,
        title: response.data.title,
        parentId: response.data.parentId,
        createTime: response.data.createTime,
        updateTime: response.data.updateTime
      };
    }, accessToken);
  }

  /**
   * Update project content
   */
  async updateProjectContent(scriptId: string, files: GASFile[], accessToken?: string): Promise<GASFile[]> {
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      // Validate file constraints
      if (files.length > 20) {
        throw new GASApiError('Project cannot have more than 20 files', 400);
      }

      // Calculate total size
      const totalSize = files.reduce((sum, file) => sum + (file.source?.length || 0), 0);
      if (totalSize > 50 * 1024 * 1024) { // 50MB
        throw new GASApiError('Project size cannot exceed 50MB', 400);
      }

      // Check individual file sizes
      for (const file of files) {
        if ((file.source?.length || 0) > 50 * 1024) { // 50KB
          throw new GASApiError(`File ${file.name} cannot exceed 50KB`, 400);
        }
      }

      const response = await this.scriptApi.projects.updateContent({
        scriptId,
        requestBody: {
          files: files.map(file => ({
            name: file.name,
            type: file.type,
            source: file.source
          }))
        }
      });
      
      return response.data.files || [];
    }, accessToken);
  }

  /**
   * Create or update a single file
   */
  async updateFile(scriptId: string, fileName: string, content: string, position?: number, accessToken?: string): Promise<GASFile[]> {
    // Get current project content
    const currentFiles = await this.getProjectContent(scriptId, accessToken);
    
    // ✅ SIMPLIFIED: Use exact fileName as provided with no manipulation
    const fileType = getFileType(fileName);
    
    // Find existing file by exact name match ONLY
    const existingIndex = currentFiles.findIndex(f => f.name === fileName);
    
    const newFile: GASFile = {
      name: fileName, // ✅ Use exact fileName as provided
      type: fileType as any,
      source: content
    };

    let updatedFiles: GASFile[];
    
    if (existingIndex >= 0) {
      // Update existing file
      updatedFiles = [...currentFiles];
      updatedFiles[existingIndex] = newFile;
    } else {
      // Add new file
      updatedFiles = [...currentFiles];
      
      // Insert at specified position or append
      if (position !== undefined && position >= 0 && position < updatedFiles.length) {
        updatedFiles.splice(position, 0, newFile);
      } else {
        updatedFiles.push(newFile);
      }
    }

    // Update project with new file list
    return this.updateProjectContent(scriptId, updatedFiles, accessToken);
  }

  /**
   * Delete a file
   */
  async deleteFile(scriptId: string, fileName: string, accessToken?: string): Promise<GASFile[]> {
    const currentFiles = await this.getProjectContent(scriptId, accessToken);
    const updatedFiles = currentFiles.filter(f => f.name !== fileName);
    
    if (updatedFiles.length === currentFiles.length) {
      throw new GASApiError(`File ${fileName} not found`, 404);
    }
    
    return this.updateProjectContent(scriptId, updatedFiles, accessToken);
  }

  /**
   * Reorder files for execution
   */
  async reorderFiles(scriptId: string, fileOrder: string[], accessToken?: string): Promise<GASFile[]> {
    const currentFiles = await this.getProjectContent(scriptId, accessToken);
    
    // Validate all files exist
    for (const fileName of fileOrder) {
      if (!currentFiles.find(f => f.name === fileName)) {
        throw new GASApiError(`File ${fileName} not found`, 404);
      }
    }

    // Reorder files according to specified order
    const orderedFiles: GASFile[] = [];
    
    // Add files in specified order
    for (const fileName of fileOrder) {
      const file = currentFiles.find(f => f.name === fileName)!;
      orderedFiles.push(file);
    }
    
    // Add any remaining files not in the order list
    for (const file of currentFiles) {
      if (!fileOrder.includes(file.name)) {
        orderedFiles.push(file);
      }
    }

    return this.updateProjectContent(scriptId, orderedFiles, accessToken);
  }

  /**
   * Execute a function in the project
   */
  async executeFunction(scriptId: string, functionName: string, parameters: any[] = [], accessToken?: string): Promise<ExecutionResponse> {
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      const response = await this.scriptApi.scripts.run({
        scriptId,
        requestBody: {
          function: functionName,
          parameters,
          devMode: true // Run in development mode
        }
      });
      
      return {
        result: response.data.response?.result,
        error: response.data.response?.error
      };
    }, accessToken);
  }

  /**
   * List deployments for a project with enriched details
   * Automatically calls getDeployment for each deployment to include full entry points
   */
  async listDeployments(scriptId: string, accessToken?: string): Promise<GASDeployment[]> {
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      console.log(`📋 Listing deployments for script: ${scriptId}`);
      
      // Get basic deployment list
      const response = await this.scriptApi.projects.deployments.list({
        scriptId
      });
      
      const basicDeployments = response.data.deployments || [];
      console.log(`🔍 Found ${basicDeployments.length} deployments, enriching with detailed information...`);
      
      // Enrich each deployment with detailed information
      const enrichedDeployments: GASDeployment[] = [];
      
      for (const basicDeployment of basicDeployments) {
        try {
          console.log(`🔍 Enriching deployment ${basicDeployment.deploymentId}...`);
          
          // Get detailed deployment info including entry points
          const detailedDeployment = await this.getDeployment(
            scriptId, 
            basicDeployment.deploymentId, 
            accessToken
          );
          
          enrichedDeployments.push(detailedDeployment);
          
        } catch (enrichError: any) {
          console.log(`⚠️  Failed to enrich deployment ${basicDeployment.deploymentId}: ${enrichError.message}`);
          
          // Fallback to basic deployment info if detailed fetch fails
          enrichedDeployments.push({
            deploymentId: basicDeployment.deploymentId,
            versionNumber: basicDeployment.versionNumber,
            description: basicDeployment.description,
            manifestFileName: basicDeployment.manifestFileName,
            updateTime: basicDeployment.updateTime,
            deploymentConfig: basicDeployment.deploymentConfig,
            entryPoints: basicDeployment.entryPoints  // Will likely be undefined/empty
          });
        }
      }
      
      console.log(`✅ Enriched ${enrichedDeployments.length} deployments with detailed information`);
      
      // Log summary of web app URLs found
      const webAppCount = enrichedDeployments.filter(d => 
        d.entryPoints?.some(ep => ep.entryPointType === 'WEB_APP' && (ep as any).webApp?.url)
      ).length;
      console.log(`🌐 Found ${webAppCount} deployments with web app URLs`);
      
      return enrichedDeployments;
    }, accessToken);
  }

  /**
   * Get detailed information about a specific deployment
   * This includes full entry points with web app URLs that are not returned by listDeployments
   */
  async getDeployment(scriptId: string, deploymentId: string, accessToken?: string): Promise<GASDeployment> {
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      console.log(`🔍 Fetching deployment details: ${deploymentId}`);
      
      const response = await this.scriptApi.projects.deployments.get({
        scriptId,
        deploymentId
      });
      
      console.log(`📦 Deployment details response:`, JSON.stringify(response.data, null, 2));
      
      const deployment: GASDeployment = {
        deploymentId: response.data.deploymentId,
        versionNumber: response.data.versionNumber,
        description: response.data.description,
        manifestFileName: response.data.manifestFileName,
        updateTime: response.data.updateTime,
        deploymentConfig: response.data.deploymentConfig,
        entryPoints: response.data.entryPoints
      };

      // Always use gas_run URL format for consistency
      if (response.data.entryPoints) {
        console.log(`🔍 Entry points found in deployment:`, JSON.stringify(response.data.entryPoints, null, 2));
        
        const webAppEntry = response.data.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        if (webAppEntry?.webApp?.url) {
          console.log(`🌐 Web App URL found from API: ${webAppEntry.webApp.url}`);
          console.log(`🔧 Converting to gas_run URL format...`);
          deployment.webAppUrl = await this.constructGasRunUrl(scriptId, accessToken);
          console.log(`✅ Using gas_run URL format: ${deployment.webAppUrl}`);
        } else if (webAppEntry) {
          console.log(`🔧 Web App entry point found, using gas_run URL format`);
          deployment.webAppUrl = await this.constructGasRunUrl(scriptId, accessToken);
          console.log(`✅ Gas_run URL: ${deployment.webAppUrl}`);
        } else {
          console.log(`⚠️  No Web App entry point found`);
        }
      } else {
        console.log(`⚠️  No entry points found in deployment response`);
      }

      return deployment;
    }, accessToken);
  }

  /**
   * Create a version of the project
   */
  async createVersion(scriptId: string, description?: string, accessToken?: string): Promise<any> {
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      const response = await this.scriptApi.projects.versions.create({
        scriptId,
        requestBody: {
          description: description || 'Version created for deployment'
        }
      });
      
      return {
        scriptId: response.data.scriptId,
        versionNumber: response.data.versionNumber,
        description: response.data.description,
        createTime: response.data.createTime
      };
    }, accessToken);
  }

  /**
   * Create a deployment
   */
  async createDeployment(
    scriptId: string, 
    description: string, 
    options: DeploymentOptions = {},
    versionNumber?: number,
    accessToken?: string
  ): Promise<GASDeployment> {
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      // If no version number provided, create a new version
      let targetVersion = versionNumber;
      if (!targetVersion) {
        console.log('📦 No version specified, creating new version...');
        const version = await this.createVersion(scriptId, `Version for ${description}`, accessToken);
        targetVersion = version.versionNumber;
        console.log(`✅ Created version ${targetVersion}`);
      }

      // Default to API Executable if no entry point type specified
      const entryPointType = options.entryPointType || 'EXECUTION_API';
      const accessLevel = options.accessLevel || 'MYSELF';

      // Build deployment request according to DeploymentConfig schema
      const requestBody: any = {
        versionNumber: targetVersion,
        description,
        manifestFileName: 'appsscript'
      };

      // Log deployment type for debugging
      if (entryPointType === 'WEB_APP') {
        const webAppConfig = options.webAppConfig || {
          access: accessLevel,
          executeAs: 'USER_DEPLOYING'
        };
        console.log(`🌐 Creating Web App deployment with access: ${webAppConfig.access}, executeAs: ${webAppConfig.executeAs}`);
      } else if (entryPointType === 'EXECUTION_API') {
        console.log(`⚙️ Creating API Executable deployment with access: ${accessLevel}`);
      }

      // Note: Entry points are configured automatically by the API based on the app manifest
      // and cannot be specified directly in the deployment creation request

      console.log(`🔧 Creating ${entryPointType} deployment`);
      console.log(`📋 Request body:`, JSON.stringify(requestBody, null, 2));

      const response = await this.scriptApi.projects.deployments.create({
        scriptId,
        requestBody
      });
      
      console.log(`📦 Full API Response:`, JSON.stringify(response, null, 2));
      console.log(`📦 Response Data:`, JSON.stringify(response.data, null, 2));
      console.log(`📦 Response Status:`, response.status);
      console.log(`📦 Response Headers:`, JSON.stringify(response.headers, null, 2));

      const deployment: GASDeployment = {
        deploymentId: response.data.deploymentId,
        versionNumber: response.data.versionNumber || targetVersion,
        description: response.data.description,
        manifestFileName: response.data.manifestFileName,
        updateTime: response.data.updateTime,
        deploymentConfig: response.data.deploymentConfig,
        entryPoints: response.data.entryPoints
      };

      // Always use gas_run URL format for consistency
      if (response.data.entryPoints) {
        console.log(`🔍 Entry points found:`, JSON.stringify(response.data.entryPoints, null, 2));
        
        const webAppEntry = response.data.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        if (webAppEntry?.webApp?.url) {
          console.log(`🌐 Web App URL detected from API: ${webAppEntry.webApp.url}`);
          console.log(`🔧 Converting to gas_run URL format...`);
          deployment.webAppUrl = await this.constructGasRunUrl(scriptId, accessToken);
          console.log(`✅ Using gas_run URL format: ${deployment.webAppUrl}`);
        } else if (webAppEntry) {
          console.log(`🔧 Web App entry point found, using gas_run URL format`);
          deployment.webAppUrl = await this.constructGasRunUrl(scriptId, accessToken);
          console.log(`✅ Gas_run URL: ${deployment.webAppUrl}`);
        }
      }

      return deployment;
    }, accessToken);
  }

  /**
   * Construct web app URL based on deployment type
   * HEAD deployments (versionNumber=null/0) use /dev
   * Versioned deployments use /exec
   */
  constructWebAppUrl(deploymentId: string, isHeadDeployment: boolean = false): string {
    const urlSuffix = isHeadDeployment ? 'dev' : 'exec';
    return `https://script.google.com/macros/s/${deploymentId}/${urlSuffix}`;
  }

  /**
   * Construct gas_run URL - Checks deployments to determine if domain format is needed
   * If deployments use domain format (like fortifiedstrength.org), uses that with /dev
   * Otherwise uses standard format: https://script.google.com/macros/s/SCRIPT_ID/dev
   */
  async constructGasRunUrl(scriptId: string, accessToken?: string): Promise<string> {
    try {
      // Check existing deployments to see if they use domain format
      const deployments = await this.listDeployments(scriptId, accessToken);
      
      // Look for a WEB_APP deployment with a domain URL
      for (const deployment of deployments) {
        if (deployment.entryPoints) {
          const webAppEntry = deployment.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
          if (webAppEntry?.webApp?.url) {
            const originalUrl = webAppEntry.webApp.url;
            console.log(`🔍 Found WEB_APP URL: ${originalUrl}`);
            
            // Check if it uses domain format (contains /a/macros/)
            if (originalUrl.includes('/a/macros/')) {
              // Replace /exec with /dev in the domain format URL
              const gasRunUrl = originalUrl.replace('/exec', '/dev');
              console.log(`🌐 Using domain format gas_run URL: ${gasRunUrl}`);
              return gasRunUrl;
            }
          }
        }
      }
      
      // Fallback to standard format if no domain deployments found
      console.log(`📋 No domain format deployments found, using standard format`);
      return `https://script.google.com/macros/s/${scriptId}/dev`;
      
    } catch (error: any) {
      console.log(`⚠️ Could not check deployments for domain format: ${error.message}`);
      console.log(`📋 Falling back to standard gas_run URL format`);
      return `https://script.google.com/macros/s/${scriptId}/dev`;
    }
  }

  /**
   * Construct gas_run URL from existing web app URL - synchronous version
   * Takes a web app URL and converts it to gas_run format by replacing /exec with /dev
   */
  constructGasRunUrlFromWebApp(webAppUrl: string): string {
    if (webAppUrl.includes('/exec')) {
      return webAppUrl.replace('/exec', '/dev');
    }
    // If it's already /dev or unknown format, return as-is
    return webAppUrl;
  }

  /**
   * Check if a deployment is a HEAD deployment
   * HEAD deployments have versionNumber=null, undefined, or 0
   */
  isHeadDeployment(deployment: GASDeployment): boolean {
    return deployment.versionNumber === null || 
           deployment.versionNumber === undefined || 
           deployment.versionNumber === 0;
  }

  /**
   * Check for existing HEAD deployment (versionNumber is null/undefined)
   * HEAD deployments automatically serve the latest saved content
   */
  async findHeadDeployment(scriptId: string, accessToken?: string): Promise<GASDeployment | null> {
    console.log(`🔍 Checking for existing HEAD deployment in script: ${scriptId}`);
    
    const deployments = await this.listDeployments(scriptId, accessToken);
    
    // Find deployment with null/undefined versionNumber (HEAD deployment)
    const headDeployment = deployments.find(deployment => 
      deployment.versionNumber === null || 
      deployment.versionNumber === undefined ||
      deployment.versionNumber === 0
    );
    
    if (headDeployment) {
      console.log(`✅ Found existing HEAD deployment: ${headDeployment.deploymentId}`);
      console.log(`   Description: ${headDeployment.description}`);
      console.log(`   Updated: ${headDeployment.updateTime}`);
      return headDeployment;
    } else {
      console.log(`📭 No HEAD deployment found`);
      return null;
    }
  }

  /**
   * Create a HEAD deployment (serves latest content automatically)
   * HEAD deployments have versionNumber=null and use /dev URLs
   */
  async createHeadDeployment(
    scriptId: string,
    description: string = 'HEAD deployment - serves latest content',
    options: DeploymentOptions = {},
    accessToken?: string
  ): Promise<GASDeployment> {
    console.log(`🚀 Creating HEAD deployment for script: ${scriptId}`);
    
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      // Default to Web App for HEAD deployments
      const entryPointType = options.entryPointType || 'WEB_APP';
      const accessLevel = options.accessLevel || 'MYSELF';

      // Build HEAD deployment request (NO versionNumber = HEAD deployment)
      const requestBody: any = {
        description,
        manifestFileName: 'appsscript'
        // Note: Omitting versionNumber makes this a HEAD deployment
      };

      // Log deployment configuration
      if (entryPointType === 'WEB_APP') {
        const webAppConfig = options.webAppConfig || {
          access: accessLevel,
          executeAs: 'USER_ACCESSING'
        };
        console.log(`🌐 Creating HEAD Web App deployment`);
        console.log(`   Access: ${webAppConfig.access}`);
        console.log(`   Execute As: ${webAppConfig.executeAs}`);
        console.log(`   Serves: Latest saved content automatically (no redeployment needed)`);
        console.log(`   URL Type: /dev (testing endpoint)`);
      }

      console.log(`🔧 Creating HEAD deployment (versionNumber=null for latest content)`);
      console.log(`📋 Request body:`, JSON.stringify(requestBody, null, 2));

      const response = await this.scriptApi.projects.deployments.create({
        scriptId,
        requestBody
      });
      
      console.log(`📦 HEAD deployment created successfully`);
      console.log(`📦 Response Data:`, JSON.stringify(response.data, null, 2));

      const deployment: GASDeployment = {
        deploymentId: response.data.deploymentId,
        versionNumber: response.data.versionNumber, // Should be null for HEAD
        description: response.data.description,
        manifestFileName: response.data.manifestFileName,
        updateTime: response.data.updateTime,
        deploymentConfig: response.data.deploymentConfig,
        entryPoints: response.data.entryPoints
      };

      // Always use gas_run URL format for HEAD deployments
      if (response.data.entryPoints) {
        console.log(`🔍 HEAD deployment entry points:`, JSON.stringify(response.data.entryPoints, null, 2));
        
        const webAppEntry = response.data.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        if (webAppEntry?.webApp?.url) {
          console.log(`🌐 HEAD Web App URL from API: ${webAppEntry.webApp.url}`);
          console.log(`🔧 Converting to gas_run URL format for HEAD deployment...`);
          deployment.webAppUrl = await this.constructGasRunUrl(scriptId, accessToken);
          console.log(`✅ Using gas_run URL format: ${deployment.webAppUrl}`);
        } else if (webAppEntry) {
          console.log(`🔧 Web App entry point found, using gas_run URL format`);
          deployment.webAppUrl = await this.constructGasRunUrl(scriptId, accessToken);
          console.log(`✅ Gas_run URL for HEAD: ${deployment.webAppUrl}`);
        }
        console.log(`🔄 This URL will serve the latest content automatically`);
      }

      return deployment;
    }, accessToken);
  }

  /**
   * Ensure HEAD deployment exists - check for existing, create if needed
   * Returns the HEAD deployment with a constant URL for development
   */
  async ensureHeadDeployment(
    scriptId: string,
    description: string = 'Development HEAD deployment',
    options: DeploymentOptions = {},
    accessToken?: string
  ): Promise<{ deployment: GASDeployment; wasCreated: boolean; webAppUrl?: string }> {
    console.log(`🎯 Ensuring HEAD deployment exists for script: ${scriptId}`);
    
    // Check for existing HEAD deployment
    const existingHead = await this.findHeadDeployment(scriptId, accessToken);
    
    if (existingHead) {
      console.log(`✅ Using existing HEAD deployment: ${existingHead.deploymentId}`);
      
      // Always use gas_run URL format for HEAD deployments
      let webAppUrl = existingHead.webAppUrl;
      if (existingHead.entryPoints) {
        const webAppEntry = existingHead.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        if (webAppEntry) {
          // Always use gas_run URL format for consistency
          webAppUrl = await this.constructGasRunUrl(scriptId, accessToken);
          console.log(`🔧 Using gas_run URL format for HEAD: ${webAppUrl}`);
        }
      }
      
      return {
        deployment: existingHead,
        wasCreated: false,
        webAppUrl
      };
    }

    // Create new HEAD deployment
    console.log(`🚀 Creating new HEAD deployment...`);
    const newHeadDeployment = await this.createHeadDeployment(scriptId, description, options, accessToken);
    
    console.log(`✅ HEAD deployment created successfully`);
    console.log(`🌐 Constant URL: ${newHeadDeployment.webAppUrl}`);
    console.log(`🔄 Updates: Use updateProjectContent() to push code changes`);
    
    return {
      deployment: newHeadDeployment,
      wasCreated: true,
      webAppUrl: newHeadDeployment.webAppUrl
    };
  }

  /**
   * Update script content for HEAD deployment
   * This is optimized for frequent updates during development
   */
  async updateContentForHeadDeployment(
    scriptId: string,
    files: GASFile[],
    accessToken?: string
  ): Promise<{ 
    files: GASFile[]; 
    headDeploymentUrl?: string;
    message: string;
  }> {
    console.log(`📝 Updating content for HEAD deployment in script: ${scriptId}`);
    console.log(`📊 Files to update: ${files.length}`);
    
    // Update the script content
    const updatedFiles = await this.updateProjectContent(scriptId, files, accessToken);
    
    // Check if HEAD deployment exists to get the URL
    const headDeployment = await this.findHeadDeployment(scriptId, accessToken);
    let headDeploymentUrl = headDeployment?.webAppUrl;
    
    if (headDeployment && !headDeploymentUrl && headDeployment.entryPoints) {
      const webAppEntry = headDeployment.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
      if (webAppEntry?.webApp?.url) {
        headDeploymentUrl = webAppEntry.webApp.url;
      }
    }
    
    const message = headDeployment 
      ? `Content updated successfully. HEAD deployment will serve new content automatically at: ${headDeploymentUrl}`
      : `Content updated successfully. No HEAD deployment found - create one with ensureHeadDeployment()`;
    
    console.log(`✅ ${message}`);
    
    return {
      files: updatedFiles,
      headDeploymentUrl,
      message
    };
  }

  // Legacy code generation methods removed - use GASCodeGenerator from utils/codeGeneration.ts instead
  // This maintains clean separation between API client and code generation logic
} 