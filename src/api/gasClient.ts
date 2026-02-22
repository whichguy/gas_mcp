/**
 * GASClient - Facade for Google Apps Script API Operations
 *
 * This is a clean facade that delegates to specialized operation modules.
 * All business logic has been extracted into operation modules for better
 * organization and testability.
 *
 * Architecture:
 * - gasAuthOperations.ts: Authentication and token management
 * - gasProjectOperations.ts: Project CRUD operations
 * - gasFileOperations.ts: File management operations
 * - gasDeployOperations.ts: Deployment and version management
 * - gasScriptOperations.ts: Script execution operations
 * - gasProcessOperations.ts: Process monitoring and metrics
 *
 * This file maintains 100% backward compatibility with the original API.
 */

// Facade delegates to *Operations modules — see gasDeployOperations, gasProcessOperations, etc.

import { GASAuthOperations } from './gasAuthOperations.js';
import { GASProjectOperations } from './gasProjectOperations.js';
import { GASFileOperations } from './gasFileOperations.js';
import { GASDeployOperations } from './gasDeployOperations.js';
import { GASScriptOperations } from './gasScriptOperations.js';
import { GASProcessOperations } from './gasProcessOperations.js';
import { GASAuthClient } from '../auth/oauthClient.js';
import { loadOAuthConfigFromJson } from '../tools/authConfig.js';
import type { AuthConfig } from '../auth/oauthClient.js';

// Re-export all types for backward compatibility
export * from './gasTypes.js';

// Import types needed for method signatures
import type {
  GASProject,
  GASFile,
  GASDeployment,
  ExecutionResponse,
  ProcessListResponse,
  ListUserProcessesFilter,
  ListScriptProcessesFilter,
  ProjectMetrics,
  MetricsGranularity,
  MetricsFilter,
  DeploymentOptions,
  EntryPointType,
  WebAppAccess
} from './gasTypes.js';

/**
 * Main GAS API Client - Facade Pattern
 *
 * Delegates all operations to specialized modules while maintaining
 * a unified interface for consumers.
 */
export class GASClient {
  private authClient: GASAuthClient;
  private authOps: GASAuthOperations;
  private projectOps: GASProjectOperations;
  private fileOps: GASFileOperations;
  private deployOps: GASDeployOperations;
  private scriptOps: GASScriptOperations;
  private processOps: GASProcessOperations;

  constructor() {
    // Initialize auth client
    try {
      const config = loadOAuthConfigFromJson();
      this.authClient = new GASAuthClient(config);
    } catch (error) {
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

    // Initialize all operation modules
    this.authOps = new GASAuthOperations(this.authClient);
    this.projectOps = new GASProjectOperations(this.authOps);
    this.fileOps = new GASFileOperations(this.authOps);
    this.deployOps = new GASDeployOperations(this.authOps);
    this.scriptOps = new GASScriptOperations(this.authOps);
    this.processOps = new GASProcessOperations(this.authOps);
  }

  // ============================================================================
  // Authentication Operations
  // ============================================================================

  /**
   * Revoke OAuth tokens for the current user
   */
  async revokeTokens(accessToken?: string): Promise<boolean> {
    return this.authOps.revokeTokens(accessToken);
  }

  /**
   * Get the Drive API instance for direct Drive operations
   * Must call initializeClient first to ensure API is ready
   */
  getDriveApi(): any {
    return this.authOps.getDriveApi();
  }

  /**
   * Initialize the API client with an access token
   * Required before using getDriveApi() for direct operations
   */
  async initializeClient(accessToken: string): Promise<void> {
    await this.authOps.initializeClient(accessToken);
  }

  // ============================================================================
  // Project Operations
  // ============================================================================

  /**
   * List all Apps Script projects accessible by the user
   */
  async listProjects(pageSize: number = 10, accessToken?: string): Promise<GASProject[]> {
    return this.projectOps.listProjects(pageSize, accessToken);
  }

  /**
   * Get details for a specific Apps Script project
   */
  async getProject(scriptId: string, accessToken?: string): Promise<GASProject> {
    return this.projectOps.getProject(scriptId, accessToken);
  }

  /**
   * Get the full content of all files in a project
   */
  async getProjectContent(scriptId: string, accessToken?: string): Promise<GASFile[]> {
    return this.projectOps.getProjectContent(scriptId, accessToken);
  }

  /**
   * Get metadata (without source) for all files in a project
   */
  async getProjectMetadata(scriptId: string, accessToken?: string): Promise<GASFile[]> {
    return this.projectOps.getProjectMetadata(scriptId, accessToken);
  }

  /**
   * Create a new Apps Script project
   */
  async createProject(title: string, parentId?: string, accessToken?: string): Promise<GASProject> {
    return this.projectOps.createProject(title, parentId, accessToken);
  }

  // ============================================================================
  // File Operations
  // ============================================================================

  /**
   * Update the complete file content for a project
   */
  async updateProjectContent(scriptId: string, files: GASFile[], accessToken?: string): Promise<GASFile[]> {
    return this.fileOps.updateProjectContent(scriptId, files, accessToken);
  }

  /**
   * Update or create a single file in a project
   */
  async updateFile(
    scriptId: string,
    fileName: string,
    content: string,
    position?: number,
    accessToken?: string,
    explicitType?: 'SERVER_JS' | 'HTML' | 'JSON',
    cachedFiles?: GASFile[]
  ): Promise<GASFile[]> {
    const getContentFn = cachedFiles
      ? (_sid: string, _tok?: string) => Promise.resolve(cachedFiles)
      : this.getProjectContent.bind(this);
    return this.fileOps.updateFile(
      scriptId,
      fileName,
      content,
      position,
      accessToken,
      explicitType,
      getContentFn
    );
  }

  /**
   * Delete a file from a project
   */
  async deleteFile(scriptId: string, fileName: string, accessToken?: string): Promise<GASFile[]> {
    return this.fileOps.deleteFile(scriptId, fileName, accessToken, this.getProjectContent.bind(this));
  }

  /**
   * Reorder files in a project (affects execution order)
   */
  async reorderFiles(scriptId: string, fileOrder: string[], accessToken?: string): Promise<GASFile[]> {
    return this.fileOps.reorderFiles(scriptId, fileOrder, accessToken, this.getProjectContent.bind(this));
  }

  // ============================================================================
  // Script Execution Operations
  // ============================================================================

  /**
   * Execute a function in an Apps Script project
   */
  async executeFunction(
    scriptId: string,
    functionName: string,
    parameters: any[] = [],
    accessToken?: string
  ): Promise<ExecutionResponse> {
    return this.scriptOps.executeFunction(scriptId, functionName, parameters, accessToken);
  }

  // ============================================================================
  // Deployment Operations
  // ============================================================================

  /**
   * List all deployments for a project
   */
  async listDeployments(scriptId: string, accessToken?: string): Promise<GASDeployment[]> {
    return this.deployOps.listDeployments(scriptId, accessToken);
  }

  /**
   * Get details for a specific deployment
   */
  async getDeployment(scriptId: string, deploymentId: string, accessToken?: string): Promise<GASDeployment> {
    return this.deployOps.getDeployment(scriptId, deploymentId, accessToken);
  }

  /**
   * Create a new version snapshot of the project
   */
  async createVersion(scriptId: string, description?: string, accessToken?: string): Promise<any> {
    return this.deployOps.createVersion(scriptId, description, accessToken);
  }

  /**
   * Create a new deployment from a version
   */
  async createDeployment(
    scriptId: string,
    description: string,
    options: DeploymentOptions = {},
    versionNumber?: number,
    accessToken?: string
  ): Promise<GASDeployment> {
    return this.deployOps.createDeployment(
      scriptId,
      description,
      options,
      versionNumber,
      accessToken
    );
  }

  /**
   * Delete a deployment
   */
  async deleteDeployment(scriptId: string, deploymentId: string, accessToken?: string): Promise<any> {
    return this.deployOps.deleteDeployment(scriptId, deploymentId, accessToken);
  }

  /**
   * Update an existing deployment
   */
  async updateDeployment(
    scriptId: string,
    deploymentId: string,
    updates: any,
    accessToken?: string
  ): Promise<GASDeployment> {
    return this.deployOps.updateDeployment(scriptId, deploymentId, updates, accessToken);
  }

  /**
   * Get details for a specific version
   */
  async getVersion(scriptId: string, versionNumber: number, accessToken?: string): Promise<any> {
    return this.deployOps.getVersion(scriptId, versionNumber, accessToken);
  }

  /**
   * List all versions for a project
   */
  async listVersions(
    scriptId: string,
    pageSize: number = 50,
    pageToken?: string,
    accessToken?: string
  ): Promise<any> {
    return this.deployOps.listVersions(scriptId, pageSize, pageToken, accessToken);
  }

  // ============================================================================
  // HEAD Deployment Operations
  // ============================================================================

  /**
   * Find the @HEAD deployment (test deployment) for a project
   */
  async findHeadDeployment(scriptId: string, accessToken?: string): Promise<GASDeployment | null> {
    return this.deployOps.findHeadDeployment(scriptId, accessToken);
  }

  /**
   * Create a @HEAD deployment for a project
   */
  async createHeadDeployment(
    scriptId: string,
    description: string = 'HEAD deployment - serves latest content',
    options: DeploymentOptions = {},
    accessToken?: string
  ): Promise<GASDeployment> {
    return this.deployOps.createHeadDeployment(scriptId, description, options, accessToken);
  }

  /**
   * Ensure a @HEAD deployment exists, creating if necessary
   */
  async ensureHeadDeployment(
    scriptId: string,
    description: string = 'Development HEAD deployment',
    options: DeploymentOptions = {},
    accessToken?: string
  ): Promise<{ deployment: GASDeployment; wasCreated: boolean; webAppUrl?: string }> {
    return this.deployOps.ensureHeadDeployment(scriptId, description, options, accessToken);
  }

  /**
   * Update content and ensure HEAD deployment is accessible
   */
  async updateContentForHeadDeployment(
    scriptId: string,
    files: GASFile[],
    accessToken?: string,
    updateProjectContentFn?: (scriptId: string, files: GASFile[], accessToken?: string) => Promise<GASFile[]>
  ): Promise<{
    files: GASFile[];
    headDeploymentUrl?: string;
    message: string;
  }> {
    return this.deployOps.updateContentForHeadDeployment(scriptId, files, accessToken, updateProjectContentFn);
  }

  // ============================================================================
  // URL Construction Utilities
  // ============================================================================

  /**
   * Construct web app URL from deployment ID
   */
  constructWebAppUrl(deploymentId: string, isHeadDeployment: boolean = false): string {
    return this.deployOps.constructWebAppUrl(deploymentId, isHeadDeployment);
  }

  /**
   * Construct gas.run URL by finding HEAD deployment
   */
  async constructGasRunUrl(scriptId: string, accessToken?: string): Promise<string> {
    return this.deployOps.constructGasRunUrl(scriptId, accessToken);
  }

  /**
   * Convert script.google.com URL to gas.run URL
   */
  constructGasRunUrlFromWebApp(webAppUrl: string): string {
    return this.deployOps.constructGasRunUrlFromWebApp(webAppUrl);
  }

  /**
   * Check if a deployment is a HEAD deployment
   */
  isHeadDeployment(deployment: GASDeployment): boolean {
    return this.deployOps.isHeadDeployment(deployment);
  }

  // ============================================================================
  // Process and Logging Operations
  // ============================================================================

  /**
   * List processes made by or on behalf of a user
   */
  async listProcesses(
    pageSize: number = 50,
    pageToken?: string,
    userProcessFilter?: ListUserProcessesFilter,
    accessToken?: string
  ): Promise<ProcessListResponse> {
    return this.processOps.listProcesses(pageSize, pageToken, userProcessFilter, accessToken);
  }

  /**
   * List processes for a specific script
   */
  async listScriptProcesses(
    scriptId: string,
    pageSize: number = 50,
    pageToken?: string,
    scriptProcessFilter?: ListScriptProcessesFilter,
    accessToken?: string
  ): Promise<ProcessListResponse & { scriptId: string }> {
    return this.processOps.listScriptProcesses(scriptId, pageSize, pageToken, scriptProcessFilter, accessToken);
  }

  /**
   * Get metrics for a project
   */
  async getProjectMetrics(
    scriptId: string,
    metricsGranularity: MetricsGranularity = 'WEEKLY',
    metricsFilter?: MetricsFilter,
    accessToken?: string
  ): Promise<ProjectMetrics & { scriptId: string; metricsGranularity: MetricsGranularity }> {
    return this.processOps.getProjectMetrics(scriptId, metricsGranularity, metricsFilter, accessToken);
  }

  /**
   * List execution logs with LLM-optimized response
   *
   * Uses the Processes API (Cloud Logging requires a standard GCP project
   * which most scripts don't have). Returns execution metadata with
   * intelligent recommendations for debugging.
   */
  async listLogsWithCloudLogging(
    scriptId: string,
    options: {
      functionName?: string;
      startTime: string;
      endTime: string;
      statusFilter?: string;
      pageSize?: number;
      pageToken?: string;
      minutes?: number;  // For recommendation logic
    },
    accessToken?: string
  ): Promise<any> {
    return this.processOps.listLogsWithCloudLogging(scriptId, options, accessToken);
  }

  /**
   * Get process logs/metadata for a specific process
   *
   * Note: Without Cloud Logging access (requires standard GCP project),
   * we can only provide limited metadata. The Processes API doesn't support
   * filtering by processId directly.
   */
  async getProcessLogs(
    scriptId: string,
    processId: string,
    includeMetadata: boolean = true,
    accessToken?: string
  ): Promise<any> {
    // Without Cloud Logging access, we can only provide what the Processes API gives us
    // The Processes API doesn't return detailed logs, just metadata
    // Note: Google's processes.list doesn't support filtering by processId

    return {
      limitation: 'Detailed logs require a standard GCP project linked to your Apps Script. ' +
                  'Default GCP projects are not accessible via API.',
      recommendation: 'Use exec() tool which captures Logger.log() output directly.',
      scriptId,
      processId,
      includeMetadata,
      suggestion: {
        action: 'use_exec',
        reason: 'exec() tool captures Logger.log() output in real-time',
        example: 'exec({scriptId, js_statement: "require(\'ModuleName\').functionToDebug()"})'
      }
    };
  }
}
