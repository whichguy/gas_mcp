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

// Process Management Interfaces (per Google Apps Script API specification)
export type ProcessType = 
  | 'PROCESS_TYPE_UNSPECIFIED'
  | 'ADD_ON'
  | 'EXECUTION_API'
  | 'TIME_DRIVEN'
  | 'TRIGGER'
  | 'WEBAPP'
  | 'EDITOR'
  | 'SIMPLE_TRIGGER'
  | 'MENU'
  | 'BATCH_TASK';

export type ProcessStatus = 
  | 'PROCESS_STATUS_UNSPECIFIED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'UNKNOWN'
  | 'DELAYED';

export type UserAccessLevel = 
  | 'USER_ACCESS_LEVEL_UNSPECIFIED'
  | 'NONE'
  | 'READ'
  | 'WRITE'
  | 'OWNER';

export interface ListUserProcessesFilter {
  scriptId?: string;
  deploymentId?: string;
  projectName?: string;
  functionName?: string;
  startTime?: string; // RFC3339 UTC "Zulu" format
  endTime?: string; // RFC3339 UTC "Zulu" format
  types?: ProcessType[];
  statuses?: ProcessStatus[];
  userAccessLevels?: UserAccessLevel[];
}

export interface ListScriptProcessesFilter {
  deploymentId?: string;
  functionName?: string;
  startTime?: string; // RFC3339 UTC "Zulu" format
  endTime?: string; // RFC3339 UTC "Zulu" format
  types?: ProcessType[];
  statuses?: ProcessStatus[];
  userAccessLevels?: UserAccessLevel[];
}

export interface Process {
  projectName: string;
  functionName: string;
  processType: ProcessType;
  processStatus: ProcessStatus;
  userAccessLevel: UserAccessLevel;
  startTime: string; // RFC3339 UTC "Zulu" format
  duration: string; // Duration in seconds with up to nine fractional digits, ending with 's'
}

export interface ProcessListResponse {
  processes: Process[];
  nextPageToken?: string;
}

// Metrics Interfaces (per Google Apps Script API specification)
export type MetricsGranularity = 
  | 'UNSPECIFIED_GRANULARITY'
  | 'WEEKLY'
  | 'DAILY';

export interface MetricsFilter {
  deploymentId?: string;
}

export interface MetricsValue {
  value: string; // Number of executions counted
  startTime: string; // RFC3339 UTC "Zulu" format
  endTime: string; // RFC3339 UTC "Zulu" format
}

export interface ProjectMetrics {
  activeUsers: MetricsValue[];
  totalExecutions: MetricsValue[];
  failedExecutions: MetricsValue[];
}

/**
 * Google Apps Script API client with authentication and rate limiting
 */
export class GASClient {
  private authClient: GASAuthClient;
  private scriptApi: any;
  private driveApi: any;
  // PERFORMANCE OPTIMIZATION: Cache initialized clients by token
  private clientCache = new Map<string, { scriptApi: any; driveApi: any; expires: number }>();
  private readonly CLIENT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

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
   * Initialize the Google APIs client with caching
   * PERFORMANCE OPTIMIZED: Reuses clients for same token
   */
  private async initializeClient(accessToken?: string): Promise<void> {
    // accessToken must be provided for API calls since GASAuthClient doesn't manage tokens directly
    if (!accessToken) {
      throw new Error('Access token is required for API initialization');
    }
    
    const token = accessToken;
    
    // OPTIMIZATION: Check cache first
    const tokenHash = token.substring(0, 20); // Use first 20 chars as cache key
    const cached = this.clientCache.get(tokenHash);
    
    if (cached && Date.now() < cached.expires) {
      console.error(`🚀 Using cached API clients for token: ${tokenHash}...`);
      this.scriptApi = cached.scriptApi;
      this.driveApi = cached.driveApi;
      return;
    }
    
    console.error(`🔧 Initializing new API clients for token: ${tokenHash}...`);
    
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: token });
    
    this.scriptApi = google.script({ version: 'v1', auth });
    this.driveApi = google.drive({ version: 'v3', auth });
    
    // Cache the clients
    this.clientCache.set(tokenHash, {
      scriptApi: this.scriptApi,
      driveApi: this.driveApi,
      expires: Date.now() + this.CLIENT_CACHE_TTL
    });
    
    console.error(`✅ API clients initialized and cached`);
    console.error(`   scriptApi available: ${!!this.scriptApi}`);
    console.error(`   driveApi available: ${!!this.driveApi}`);
  }

  /**
   * Make rate-limited API call with error handling
   */
  private async makeApiCall<T>(apiCall: () => Promise<T>, accessToken?: string): Promise<T> {
    console.error(`🚀 makeApiCall called with accessToken: ${accessToken ? accessToken.substring(0, 20) + '...' : 'undefined'}`);
    
    await rateLimiter.checkLimit();
    
    const startTime = Date.now();
    let operationName = 'Unknown Google API Call';
    let apiEndpoint = 'Unknown endpoint';
    
    try {
      // Initialize client before making the API call
      console.error(`🔧 About to initialize client...`);
      await this.initializeClient(accessToken);
      console.error(`✅ Client initialized, calling API...`);
      
      // Extract operation context from stack trace for better logging
      const stack = new Error().stack;
      const callerMatch = stack?.match(/at GASClient\.(\w+)/);
      operationName = callerMatch ? callerMatch[1] : 'Unknown operation';
      
      console.error(`📡 [GOOGLE API REQUEST] Starting: ${operationName}`);
      console.error(`   ⏰ Timestamp: ${new Date().toISOString()}`);
      console.error(`   🔑 Auth: ${accessToken ? 'Token present (' + accessToken.substring(0, 10) + '...)' : 'No token'}`);
      
      const result = await apiCall();
      
      const duration = Date.now() - startTime;
      console.error(`✅ [GOOGLE API SUCCESS] Completed: ${operationName}`);
      console.error(`   ⏱️  Duration: ${duration}ms`);
      console.error(`   📊 Result type: ${typeof result}`);
      console.error(`   📏 Result size: ${JSON.stringify(result).length} characters`);
      
      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`❌ [GOOGLE API ERROR] Failed: ${operationName} after ${duration}ms`);
      console.error(`   ⏰ Timestamp: ${new Date().toISOString()}`);
      console.error(`   🔍 Error type: ${error.constructor?.name || 'Unknown'}`);
      console.error(`   📍 API endpoint: ${error.config?.url || apiEndpoint}`);
      console.error(`   🔢 Status code: ${error.response?.status || error.status || error.statusCode || 'Unknown'}`);
      console.error(`   💬 Error message: ${error.message}`);
      console.error(`   📋 Full error:`, error);
      
      // Enhanced error information extraction
      const statusCode = error.response?.status || 
                         error.status || 
                         error.statusCode || 
                         error.code;
      
      const message = error.response?.data?.error?.message || 
                     error.response?.data?.message ||
                     error.response?.statusText ||
                     error.message ||
                     'Unknown API error';
      
      // Create comprehensive error object with all available information
      const enhancedError = new GASApiError(
        `Apps Script API error: ${message}`,
        statusCode,
        {
          originalError: error,
          response: error.response,
          config: error.config,
          request: error.request,
          statusCode: statusCode,
          errorData: error.response?.data,
          headers: error.response?.headers,
          operationName: operationName,
          duration: duration,
          timestamp: new Date().toISOString()
        }
      );
      
      throw enhancedError;
    }
  }

  /**
   * List all accessible projects
   */
  async listProjects(pageSize: number = 10, accessToken?: string): Promise<GASProject[]> {
    return this.makeApiCall(async () => {
      console.error(`📋 Listing Apps Script projects via Drive API...`);
      
      // Apps Script projects are Drive files with MIME type 'application/vnd.google-apps.script'
      const response = await this.driveApi.files.list({
        q: "mimeType='application/vnd.google-apps.script' and trashed=false",
        pageSize,
        fields: 'files(id,name,createdTime,modifiedTime,parents)'
      });
      
      const files = response.data.files || [];
      console.error(`📊 Found ${files.length} Apps Script projects`);
      
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
      // Let Google Apps Script API be the authority for validation
      // Remove arbitrary client-side limits and let the API return its own errors
      
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
  async updateFile(scriptId: string, fileName: string, content: string, position?: number, accessToken?: string, explicitType?: 'SERVER_JS' | 'HTML' | 'JSON'): Promise<GASFile[]> {
    // Get current project content
    const currentFiles = await this.getProjectContent(scriptId, accessToken);
    
    // ✅ PRIORITY SYSTEM: 1) Explicit type, 2) Existing file type, 3) Extension detection
    let fileType: string;
    if (explicitType) {
      fileType = explicitType;
    } else {
      // Check if file already exists and preserve its type
      const existingFile = currentFiles.find(f => f.name === fileName);
      if (existingFile?.type) {
        fileType = existingFile.type;
      } else {
        // Fall back to extension detection
        fileType = getFileType(fileName);
      }
    }
    
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
      console.error(`📋 Listing deployments for script: ${scriptId}`);
      
      // Get basic deployment list
      const response = await this.scriptApi.projects.deployments.list({
        scriptId
      });
      
      const basicDeployments = response.data.deployments || [];
      console.error(`🔍 Found ${basicDeployments.length} deployments, enriching with detailed information...`);
      
      // Enrich each deployment with detailed information
      const enrichedDeployments: GASDeployment[] = [];
      
      for (const basicDeployment of basicDeployments) {
        try {
          console.error(`🔍 Enriching deployment ${basicDeployment.deploymentId}...`);
          
          // Get detailed deployment info including entry points
          const detailedDeployment = await this.getDeployment(
            scriptId, 
            basicDeployment.deploymentId, 
            accessToken
          );
          
          enrichedDeployments.push(detailedDeployment);
          
        } catch (enrichError: any) {
          console.error(`⚠️  Failed to enrich deployment ${basicDeployment.deploymentId}: ${enrichError.message}`);
          
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
      
      console.error(`✅ Enriched ${enrichedDeployments.length} deployments with detailed information`);
      
      // Log summary of web app URLs found
      const webAppCount = enrichedDeployments.filter(d => 
        d.entryPoints?.some(ep => ep.entryPointType === 'WEB_APP' && (ep as any).webApp?.url)
      ).length;
      console.error(`🌐 Found ${webAppCount} deployments with web app URLs`);
      
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
      console.error(`🔍 Fetching deployment details: ${deploymentId}`);
      
      const response = await this.scriptApi.projects.deployments.get({
        scriptId,
        deploymentId
      });
      
      console.error(`📦 Deployment details response:`, JSON.stringify(response.data, null, 2));
      
      const deployment: GASDeployment = {
        deploymentId: response.data.deploymentId,
        versionNumber: response.data.versionNumber,
        description: response.data.description,
        manifestFileName: response.data.manifestFileName,
        updateTime: response.data.updateTime,
        deploymentConfig: response.data.deploymentConfig,
        entryPoints: response.data.entryPoints
      };

      // Convert web app URL to gas_run format if present
      if (response.data.entryPoints) {
        console.error(`🔍 Entry points found in deployment:`, JSON.stringify(response.data.entryPoints, null, 2));
        
        const webAppEntry = response.data.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        if (webAppEntry?.webApp?.url) {
          const originalUrl = webAppEntry.webApp.url;
          console.error(`🌐 Web App URL found from API: ${originalUrl}`);
          console.error(`🔧 Converting to gas_run URL format...`);
          deployment.webAppUrl = this.constructGasRunUrlFromWebApp(originalUrl);
          console.error(`✅ Using gas_run URL format: ${deployment.webAppUrl}`);
        } else if (webAppEntry) {
          console.error(`🔧 Web App entry point found but no URL`);
        } else {
          console.error(`⚠️  No Web App entry point found`);
        }
      } else {
        console.error(`⚠️  No entry points found in deployment response`);
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
        console.error('📦 No version specified, creating new version...');
        const version = await this.createVersion(scriptId, `Version for ${description}`, accessToken);
        targetVersion = version.versionNumber;
        console.error(`✅ Created version ${targetVersion}`);
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
        console.error(`🌐 Creating Web App deployment with access: ${webAppConfig.access}, executeAs: ${webAppConfig.executeAs}`);
      } else if (entryPointType === 'EXECUTION_API') {
        console.error(`⚙️ Creating API Executable deployment with access: ${accessLevel}`);
      }

      // Note: Entry points are configured automatically by the API based on the app manifest
      // and cannot be specified directly in the deployment creation request

      console.error(`🔧 Creating ${entryPointType} deployment`);
      console.error(`📋 Request body:`, JSON.stringify(requestBody, null, 2));

      const response = await this.scriptApi.projects.deployments.create({
        scriptId,
        requestBody
      });
      
      console.error(`📦 Full API Response:`, JSON.stringify(response, null, 2));
      console.error(`📦 Response Data:`, JSON.stringify(response.data, null, 2));
      console.error(`📦 Response Status:`, response.status);
      console.error(`📦 Response Headers:`, JSON.stringify(response.headers, null, 2));

      const deployment: GASDeployment = {
        deploymentId: response.data.deploymentId,
        versionNumber: response.data.versionNumber || targetVersion,
        description: response.data.description,
        manifestFileName: response.data.manifestFileName,
        updateTime: response.data.updateTime,
        deploymentConfig: response.data.deploymentConfig,
        entryPoints: response.data.entryPoints
      };

      // Convert web app URL to gas_run format if present  
      if (response.data.entryPoints) {
        console.error(`🔍 Entry points found:`, JSON.stringify(response.data.entryPoints, null, 2));
        
        const webAppEntry = response.data.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        if (webAppEntry?.webApp?.url) {
          const originalUrl = webAppEntry.webApp.url;
          console.error(`🌐 Web App URL detected from API: ${originalUrl}`);
          console.error(`🔧 Converting to gas_run URL format...`);
          deployment.webAppUrl = this.constructGasRunUrlFromWebApp(originalUrl);
          console.error(`✅ Using gas_run URL format: ${deployment.webAppUrl}`);
        } else if (webAppEntry) {
          console.error(`🔧 Web App entry point found but no URL`);
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
   * Construct gas_run URL following explicit flow:
   * 1. Get deployment details via API
   * 2. Find the web app entry point
   * 3. Get the actual URL endpoint from that web app
   * 4. Swap /exec to /dev
   */
  async constructGasRunUrl(scriptId: string, accessToken?: string): Promise<string> {
    const startTime = Date.now();
    console.error(`\n🚀 [GAS_URL_CONSTRUCTION] Starting URL construction for script: ${scriptId}`);
    console.error(`   ⏰ Timestamp: ${new Date().toISOString()}`);
    console.error(`   🔑 Auth Token: ${accessToken ? `Present (${accessToken.substring(0, 10)}...)` : 'Not provided'}`);
    
    try {
      // ========== STEP 1: GET BASIC DEPLOYMENT LIST ==========
      console.error(`\n📋 [STEP 1] Getting basic deployment list for script: ${scriptId}`);
      const step1StartTime = Date.now();
      
      await this.initializeClient(accessToken);
      console.error(`   ✅ API client initialized successfully`);
      
      const response = await this.scriptApi.projects.deployments.list({
        scriptId
      });
      
      const basicDeployments = response.data.deployments || [];
      const step1Duration = Date.now() - step1StartTime;
      
      console.error(`   📊 API Response received in ${step1Duration}ms`);
      console.error(`   📦 Found ${basicDeployments.length} total deployments`);
      
      if (basicDeployments.length === 0) {
        console.error(`   ⚠️  No deployments found - will use fallback URL`);
      } else {
        console.error(`   📋 Deployment IDs found:`);
                 basicDeployments.forEach((dep: any, index: number) => {
           console.error(`      ${index + 1}. ${dep.deploymentId} (version: ${dep.versionNumber || 'HEAD'})`);
         });
      }
      
      // ========== STEP 2 & 3: GET DETAILED DEPLOYMENT INFO AND FIND WEB APP ==========
      console.error(`\n🔍 [STEP 2+3] Checking each deployment for web app entry points`);
      
      for (let i = 0; i < basicDeployments.length; i++) {
        const basicDeployment = basicDeployments[i];
        const step2StartTime = Date.now();
        
        console.error(`\n   📦 [DEPLOYMENT ${i + 1}/${basicDeployments.length}] Examining: ${basicDeployment.deploymentId}`);
        console.error(`      📋 Description: ${basicDeployment.description || 'No description'}`);
        console.error(`      🔢 Version: ${basicDeployment.versionNumber || 'HEAD'}`);
        console.error(`      📅 Updated: ${basicDeployment.updateTime || 'Unknown'}`);
        
        try {
          console.error(`      🌐 Getting detailed deployment information...`);
          
          // Get detailed deployment info including entry points
          const detailResponse = await this.scriptApi.projects.deployments.get({
            scriptId,
            deploymentId: basicDeployment.deploymentId
          });
          
          const step2Duration = Date.now() - step2StartTime;
          console.error(`      ✅ Deployment details retrieved in ${step2Duration}ms`);
          
          // Step 3: Find the web app entry point
          if (detailResponse.data.entryPoints) {
            const entryPoints = detailResponse.data.entryPoints;
            console.error(`      📋 Found ${entryPoints.length} entry point(s):`);
            
                         entryPoints.forEach((ep: any, epIndex: number) => {
               console.error(`         ${epIndex + 1}. Type: ${ep.entryPointType}`);
               if (ep.entryPointType === 'WEB_APP' && (ep as any).webApp?.url) {
                 console.error(`            🌐 Web App URL: ${(ep as any).webApp.url}`);
               }
             });
            
            const webAppEntry = entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
            
            if (webAppEntry?.webApp?.url) {
              const originalUrl = webAppEntry.webApp.url;
              console.error(`      ✅ [SUCCESS] Found WEB_APP entry point with URL!`);
              console.error(`         📍 Original URL: ${originalUrl}`);
              
              // ========== STEP 4: SWAP /exec TO /dev ==========
              console.error(`\n🔧 [STEP 4] Converting URL for gas_run format`);
              console.error(`   📝 Rule: Replace '/exec' with '/dev' for development endpoint`);
              
              const gasRunUrl = originalUrl.replace('/exec', '/dev');
              const totalDuration = Date.now() - startTime;
              
              if (gasRunUrl !== originalUrl) {
                console.error(`   ✅ [SUCCESS] URL conversion completed`);
                console.error(`      📍 Original:  ${originalUrl}`);
                console.error(`      🔄 Converted: ${gasRunUrl}`);
                console.error(`      🎯 Change: Replaced '/exec' → '/dev'`);
              } else {
                console.error(`   ℹ️  URL already in correct format (no /exec found)`);
                console.error(`      📍 Final URL: ${gasRunUrl}`);
              }
              
              console.error(`\n🎉 [CONSTRUCTION_COMPLETE] Gas_run URL ready!`);
              console.error(`   🔗 Final URL: ${gasRunUrl}`);
              console.error(`   ⏱️  Total time: ${totalDuration}ms`);
              console.error(`   📊 Deployments checked: ${i + 1}/${basicDeployments.length}`);
              console.error(`   🎯 Source: Deployment ${basicDeployment.deploymentId}`);
              
              return gasRunUrl;
              
            } else if (webAppEntry) {
              console.error(`      ⚠️  WEB_APP entry point found but missing URL property`);
              console.error(`         🔍 Entry point data:`, JSON.stringify(webAppEntry, null, 10));
            } else {
              console.error(`      ❌ No WEB_APP entry point found in this deployment`);
                             console.error(`         📋 Available types: ${entryPoints.map((ep: any) => ep.entryPointType).join(', ')}`);
            }
          } else {
            console.error(`      ❌ No entry points found in deployment response`);
            console.error(`         📋 Response structure:`, JSON.stringify(detailResponse.data, null, 6));
          }
          
        } catch (detailError: any) {
          const step2Duration = Date.now() - step2StartTime;
          console.error(`      ❌ Failed to get deployment details (${step2Duration}ms)`);
          console.error(`         💬 Error: ${detailError.message}`);
          console.error(`         🔍 Error type: ${detailError.name || 'Unknown'}`);
          if (detailError.code) {
            console.error(`         🔢 Error code: ${detailError.code}`);
          }
        }
        
        console.error(`      ⏭️  Moving to next deployment...`);
      }
      
      // ========== FALLBACK: STANDARD FORMAT ==========
      console.error(`\n📋 [FALLBACK] No web app deployments found with URLs`);
      console.error(`   📊 Summary: Checked ${basicDeployments.length} deployments, none had web app URLs`);
      console.error(`   🔄 Using standard gas_run URL format as fallback`);
      
      const fallbackUrl = `https://script.google.com/macros/s/${scriptId}/dev`;
      const totalDuration = Date.now() - startTime;
      
      console.error(`\n🎯 [FALLBACK_COMPLETE] Standard format gas_run URL ready!`);
      console.error(`   🔗 Fallback URL: ${fallbackUrl}`);
      console.error(`   ⏱️  Total time: ${totalDuration}ms`);
      console.error(`   📝 Note: This uses scriptId directly (no custom domain)`);
      
      return fallbackUrl;
      
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;
      console.error(`\n❌ [CONSTRUCTION_ERROR] URL construction failed`);
      console.error(`   ⏱️  Duration: ${totalDuration}ms`);
      console.error(`   💬 Error message: ${error.message}`);
      console.error(`   🔍 Error type: ${error.name || 'Unknown'}`);
      console.error(`   📋 Error details:`, error);
      
      if (error.code) {
        console.error(`   🔢 Error code: ${error.code}`);
      }
      if (error.status) {
        console.error(`   📊 HTTP status: ${error.status}`);
      }
      
      console.error(`\n🛡️  [ERROR_FALLBACK] Using emergency fallback URL`);
      const fallbackUrl = `https://script.google.com/macros/s/${scriptId}/dev`;
      
      console.error(`\n🎯 [ERROR_FALLBACK_COMPLETE] Emergency gas_run URL ready!`);
      console.error(`   🔗 Emergency URL: ${fallbackUrl}`);
      console.error(`   ⏱️  Total time: ${totalDuration}ms`);
      console.error(`   📝 Note: Error fallback - uses scriptId directly`);
      
      return fallbackUrl;
    }
  }

  /**
   * Construct gas_run URL from existing web app URL - synchronous version
   * 
   * CRITICAL FIX: Converts domain-specific URLs to standard format to avoid authentication issues
   * 
   * Converts from: https://script.google.com/a/macros/[DOMAIN]/s/[DEPLOYMENT_ID]/exec
   * To:           https://script.google.com/macros/s/[DEPLOYMENT_ID]/dev
   * 
   * Domain-specific URLs (/a/macros/[DOMAIN]/) trigger Google Workspace authentication
   * that doesn't accept Bearer tokens from programmatic requests. Standard URLs work
   * with OAuth Bearer token authentication.
   */
  constructGasRunUrlFromWebApp(webAppUrl: string): string {
    console.error(`🔧 [URL_CONVERSION] Converting web app URL: ${webAppUrl}`);
    
    try {
      const url = new URL(webAppUrl);
      
      // Extract deployment ID from the URL path
      // Path formats:
      // Domain-specific: /a/macros/[DOMAIN]/s/[DEPLOYMENT_ID]/exec
      // Standard:        /macros/s/[DEPLOYMENT_ID]/exec
      const pathMatch = url.pathname.match(/\/(?:a\/macros\/[^\/]+\/)?s\/([^\/]+)\/(?:exec|dev)$/);
      
      if (!pathMatch) {
        console.error(`⚠️ [URL_CONVERSION] Unexpected URL format, returning as-is: ${webAppUrl}`);
        return webAppUrl;
      }
      
      const deploymentId = pathMatch[1];
      
      // Construct standard format URL that works with Bearer token authentication
      const standardUrl = `https://script.google.com/macros/s/${deploymentId}/dev`;
      
      const conversionInfo = {
        originalUrl: webAppUrl,
        convertedUrl: standardUrl,
        deploymentId: deploymentId,
        conversionType: webAppUrl.includes('/a/macros/') ? 'Domain-specific → Standard' : 'Standard → Standard',
        authenticationCompatible: true,
        bearerTokenSupported: true
      };
      
      console.error(`✅ [URL_CONVERSION] Conversion details:\n${JSON.stringify(conversionInfo, null, 2)}`);
      
      return standardUrl;
      
    } catch (error: any) {
      console.error(`❌ [URL_CONVERSION] Failed to parse URL: ${error.message}`);
      console.error(`🔧 [URL_CONVERSION] Falling back to simple /exec → /dev replacement`);
      
      // Fallback: simple replacement
      if (webAppUrl.includes('/exec')) {
        return webAppUrl.replace('/exec', '/dev');
      }
      return webAppUrl;
    }
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
    console.error(`🔍 Checking for existing HEAD deployment in script: ${scriptId}`);
    
    const deployments = await this.listDeployments(scriptId, accessToken);
    
    // Find deployment with null/undefined versionNumber (HEAD deployment)
    const headDeployment = deployments.find(deployment => 
      deployment.versionNumber === null || 
      deployment.versionNumber === undefined ||
      deployment.versionNumber === 0
    );
    
    if (headDeployment) {
      console.error(`✅ Found existing HEAD deployment: ${headDeployment.deploymentId}`);
      console.error(`   Description: ${headDeployment.description}`);
      console.error(`   Updated: ${headDeployment.updateTime}`);
      return headDeployment;
    } else {
      console.error(`📭 No HEAD deployment found`);
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
    console.error(`🚀 Creating HEAD deployment for script: ${scriptId}`);
    
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
        console.error(`🌐 Creating HEAD Web App deployment`);
        console.error(`   Access: ${webAppConfig.access}`);
        console.error(`   Execute As: ${webAppConfig.executeAs}`);
        console.error(`   Serves: Latest saved content automatically (no redeployment needed)`);
        console.error(`   URL Type: /dev (testing endpoint)`);
      }

      console.error(`🔧 Creating HEAD deployment (versionNumber=null for latest content)`);
      console.error(`📋 Request body:`, JSON.stringify(requestBody, null, 2));

      const response = await this.scriptApi.projects.deployments.create({
        scriptId,
        requestBody
      });
      
      console.error(`📦 HEAD deployment created successfully`);
      console.error(`📦 Response Data:`, JSON.stringify(response.data, null, 2));

      const deployment: GASDeployment = {
        deploymentId: response.data.deploymentId,
        versionNumber: response.data.versionNumber, // Should be null for HEAD
        description: response.data.description,
        manifestFileName: response.data.manifestFileName,
        updateTime: response.data.updateTime,
        deploymentConfig: response.data.deploymentConfig,
        entryPoints: response.data.entryPoints
      };

      // Convert web app URL to gas_run format for HEAD deployments
      if (response.data.entryPoints) {
        console.error(`🔍 HEAD deployment entry points:`, JSON.stringify(response.data.entryPoints, null, 2));
        
        const webAppEntry = response.data.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        if (webAppEntry?.webApp?.url) {
          const originalUrl = webAppEntry.webApp.url;
          console.error(`🌐 HEAD Web App URL from API: ${originalUrl}`);
          console.error(`🔧 Converting to gas_run URL format for HEAD deployment...`);
          deployment.webAppUrl = this.constructGasRunUrlFromWebApp(originalUrl);
          console.error(`✅ Using gas_run URL format: ${deployment.webAppUrl}`);
        } else if (webAppEntry) {
          console.error(`🔧 Web App entry point found but no URL`);
        }
        console.error(`🔄 This URL will serve the latest content automatically`);
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
    console.error(`🎯 Ensuring HEAD deployment exists for script: ${scriptId}`);
    
    // Check for existing HEAD deployment
    const existingHead = await this.findHeadDeployment(scriptId, accessToken);
    
    if (existingHead) {
      console.error(`✅ Using existing HEAD deployment: ${existingHead.deploymentId}`);
      
      // Convert web app URL to gas_run format for HEAD deployments
      let webAppUrl = existingHead.webAppUrl;
      if (existingHead.entryPoints) {
        const webAppEntry = existingHead.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        if (webAppEntry?.webApp?.url) {
          // Convert existing URL to gas_run format
          webAppUrl = this.constructGasRunUrlFromWebApp(webAppEntry.webApp.url);
          console.error(`🔧 Using gas_run URL format for HEAD: ${webAppUrl}`);
        }
      }
      
      return {
        deployment: existingHead,
        wasCreated: false,
        webAppUrl
      };
    }

    // Create new HEAD deployment
    console.error(`🚀 Creating new HEAD deployment...`);
    const newHeadDeployment = await this.createHeadDeployment(scriptId, description, options, accessToken);
    
    console.error(`✅ HEAD deployment created successfully`);
    console.error(`🌐 Constant URL: ${newHeadDeployment.webAppUrl}`);
    console.error(`🔄 Updates: Use updateProjectContent() to push code changes`);
    
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
    console.error(`📝 Updating content for HEAD deployment in script: ${scriptId}`);
    console.error(`📊 Files to update: ${files.length}`);
    
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
    
    console.error(`✅ ${message}`);
    
    return {
      files: updatedFiles,
      headDeploymentUrl,
      message
    };
  }

  /**
   * List information about processes made by or on behalf of a user
   */
  async listProcesses(
    pageSize: number = 50,
    pageToken?: string,
    userProcessFilter?: ListUserProcessesFilter,
    accessToken?: string
  ): Promise<ProcessListResponse> {
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      const params: any = {
        pageSize
      };
      
      if (pageToken) {
        params.pageToken = pageToken;
      }
      
      if (userProcessFilter) {
        params.userProcessFilter = userProcessFilter;
      }
      
      console.error(`🔍 Listing user processes (pageSize: ${pageSize})`);
      if (userProcessFilter) {
        console.error(`   Filter:`, JSON.stringify(userProcessFilter, null, 2));
      }
      
      const response = await this.scriptApi.processes.list(params);
      
      console.error(`📋 Found ${response.data.processes?.length || 0} processes`);
      
      return {
        processes: response.data.processes || [],
        nextPageToken: response.data.nextPageToken
      };
    }, accessToken);
  }

  /**
   * List information about a script's executed processes
   */
  async listScriptProcesses(
    scriptId: string,
    pageSize: number = 50,
    pageToken?: string,
    scriptProcessFilter?: ListScriptProcessesFilter,
    accessToken?: string
  ): Promise<ProcessListResponse & { scriptId: string }> {
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      const params: any = {
        scriptId,
        pageSize
      };
      
      if (pageToken) {
        params.pageToken = pageToken;
      }
      
      if (scriptProcessFilter) {
        params.scriptProcessFilter = scriptProcessFilter;
      }
      
      console.error(`🔍 Listing script processes for ${scriptId} (pageSize: ${pageSize})`);
      if (scriptProcessFilter) {
        console.error(`   Filter:`, JSON.stringify(scriptProcessFilter, null, 2));
      }
      
      const response = await this.scriptApi.processes.listScriptProcesses(params);
      
      console.error(`📋 Found ${response.data.processes?.length || 0} script processes`);
      
      return {
        scriptId,
        processes: response.data.processes || [],
        nextPageToken: response.data.nextPageToken
      };
    }, accessToken);
  }

  /**
   * Get metrics data for scripts, such as number of executions and active users
   */
  async getProjectMetrics(
    scriptId: string,
    metricsGranularity: MetricsGranularity = 'WEEKLY',
    metricsFilter?: MetricsFilter,
    accessToken?: string
  ): Promise<ProjectMetrics & { scriptId: string; metricsGranularity: MetricsGranularity }> {
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      const params: any = {
        scriptId,
        metricsGranularity
      };
      
      if (metricsFilter) {
        params.metricsFilter = metricsFilter;
      }
      
      console.error(`📊 Getting project metrics for ${scriptId} (granularity: ${metricsGranularity})`);
      if (metricsFilter) {
        console.error(`   Filter:`, JSON.stringify(metricsFilter, null, 2));
      }
      
      const response = await this.scriptApi.projects.getMetrics(params);
      
      console.error(`📈 Retrieved metrics data for ${scriptId}`);
      console.error(`   Active users: ${response.data.activeUsers?.length || 0} data points`);
      console.error(`   Total executions: ${response.data.totalExecutions?.length || 0} data points`);
      console.error(`   Failed executions: ${response.data.failedExecutions?.length || 0} data points`);
      
      return {
        scriptId,
        metricsGranularity,
        activeUsers: response.data.activeUsers || [],
        totalExecutions: response.data.totalExecutions || [],
        failedExecutions: response.data.failedExecutions || []
      };
    }, accessToken);
  }

  /**
   * Delete a deployment of an Apps Script project
   */
  async deleteDeployment(
    scriptId: string,
    deploymentId: string,
    accessToken?: string
  ): Promise<any> {
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      console.error(`🗑️ Deleting deployment ${deploymentId} from script ${scriptId}`);
      
      await this.scriptApi.projects.deployments.delete({
        scriptId,
        deploymentId
      });
      
      console.error(`✅ Deployment ${deploymentId} deleted successfully`);
      
      return {
        status: 'deleted',
        scriptId,
        deploymentId,
        message: `Deployment ${deploymentId} has been deleted successfully`
      };
    }, accessToken);
  }

  /**
   * Update a deployment of an Apps Script project
   */
  async updateDeployment(
    scriptId: string,
    deploymentId: string,
    updates: any,
    accessToken?: string
  ): Promise<GASDeployment> {
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      console.error(`🔄 Updating deployment ${deploymentId} in script ${scriptId}`);
      console.error(`   Updates:`, JSON.stringify(updates, null, 2));
      
      // Build the update request body
      const requestBody: any = {
        deploymentId
      };
      
      if (updates.description) {
        requestBody.description = updates.description;
      }
      
      // Handle entry point configurations
      if (updates.entryPointType) {
        if (updates.entryPointType === 'WEB_APP') {
          requestBody.entryPointType = 'WEB_APP';
          requestBody.webAppConfig = {
            access: updates.webAppAccess || 'ANYONE',
            executeAs: updates.webAppExecuteAs || 'USER_ACCESSING'
          };
        } else if (updates.entryPointType === 'EXECUTION_API') {
          requestBody.entryPointType = 'EXECUTION_API';
          requestBody.accessLevel = updates.accessLevel || 'MYSELF';
        } else if (updates.entryPointType === 'ADD_ON') {
          requestBody.entryPointType = 'ADD_ON';
        }
      }
      
      const response = await this.scriptApi.projects.deployments.update({
        scriptId,
        deploymentId,
        requestBody
      });
      
      console.error(`✅ Deployment ${deploymentId} updated successfully`);
      
      const updatedDeployment: GASDeployment = {
        deploymentId: response.data.deploymentId,
        versionNumber: response.data.versionNumber,
        description: response.data.description,
        manifestFileName: response.data.manifestFileName,
        updateTime: response.data.updateTime,
        deploymentConfig: response.data.deploymentConfig,
        entryPoints: response.data.entryPoints
      };
      
      // Extract web app URL if available
      if (response.data.entryPoints) {
        const webAppEntry = response.data.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        if (webAppEntry?.webApp?.url) {
          updatedDeployment.webAppUrl = webAppEntry.webApp.url;
        }
      }
      
      return updatedDeployment;
    }, accessToken);
  }

  /**
   * Get details of a specific version of a script project
   */
  async getVersion(
    scriptId: string,
    versionNumber: number,
    accessToken?: string
  ): Promise<any> {
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      console.error(`📋 Getting version ${versionNumber} details for script ${scriptId}`);
      
      const response = await this.scriptApi.projects.versions.get({
        scriptId,
        versionNumber
      });
      
      console.error(`✅ Retrieved version ${versionNumber} details`);
      
      return {
        scriptId,
        versionNumber: response.data.versionNumber,
        description: response.data.description,
        createTime: response.data.createTime,
        ...response.data
      };
    }, accessToken);
  }

  /**
   * List all versions of a script project
   */
  async listVersions(
    scriptId: string,
    pageSize: number = 50,
    pageToken?: string,
    accessToken?: string
  ): Promise<any> {
    await this.initializeClient(accessToken);
    
    return this.makeApiCall(async () => {
      const params: any = {
        scriptId,
        pageSize
      };
      
      if (pageToken) {
        params.pageToken = pageToken;
      }
      
      console.error(`📋 Listing versions for script ${scriptId} (pageSize: ${pageSize})`);
      const response = await this.scriptApi.projects.versions.list(params);
      
      console.error(`📚 Found ${response.data.versions?.length || 0} versions`);
      
      return {
        scriptId,
        versions: response.data.versions || [],
        nextPageToken: response.data.nextPageToken
      };
    }, accessToken);
  }

  // Legacy code generation methods removed - use GASCodeGenerator from utils/codeGeneration.ts instead
  // This maintains clean separation between API client and code generation logic
} 