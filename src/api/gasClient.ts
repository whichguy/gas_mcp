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
 *
 * This file maintains 100% backward compatibility with the original API.
 */

import { GASAuthOperations } from './gasAuthOperations.js';
import { GASProjectOperations } from './gasProjectOperations.js';
import { GASFileOperations } from './gasFileOperations.js';
import { GASDeployOperations } from './gasDeployOperations.js';
import { GASScriptOperations } from './gasScriptOperations.js';
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
    explicitType?: 'SERVER_JS' | 'HTML' | 'JSON'
  ): Promise<GASFile[]> {
    return this.fileOps.updateFile(
      scriptId,
      fileName,
      content,
      position,
      accessToken,
      explicitType,
      this.getProjectContent.bind(this)
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
    // TODO: Extract to gasDeployOperations when created
    await this.authOps.initializeClient(accessToken);

    const scriptApi = (this.authOps as any).scriptApi;
    await scriptApi.projects.deployments.delete({
      scriptId,
      deploymentId
    });

    console.error(`✅ Deployment ${deploymentId} deleted successfully`);
    return { success: true, deploymentId };
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
    // TODO: Extract to gasDeployOperations when created
    await this.authOps.initializeClient(accessToken);

    console.error(`🔄 Updating deployment ${deploymentId} in script ${scriptId}`);
    console.error(`   Updates:`, JSON.stringify(updates, null, 2));

    // Build the update request body
    const requestBody: any = {
      deploymentId
    };

    if (updates.description) {
      requestBody.description = updates.description;
    }

    if (updates.entryPointType) {
      if (updates.entryPointType === 'WEB_APP') {
        requestBody.deploymentConfig = {
          entryPoints: [{
            entryPointType: 'WEB_APP',
            webApp: {
              access: updates.accessLevel || 'MYSELF',
              executeAs: 'USER_DEPLOYING'
            }
          }]
        };
      }
    }

    const scriptApi = (this.authOps as any).scriptApi;
    const response = await scriptApi.projects.deployments.update({
      scriptId,
      deploymentId,
      requestBody
    });

    // Extract web app URL if present
    let webAppUrl: string | undefined;
    if (response.data.entryPoints) {
      const webAppEntry = response.data.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
      if (webAppEntry?.webApp?.url) {
        webAppUrl = webAppEntry.webApp.url;
      }
    }

    console.error(`✅ Deployment updated successfully`);

    return {
      deploymentId: response.data.deploymentId,
      versionNumber: response.data.versionNumber,
      description: response.data.description,
      updateTime: response.data.updateTime,
      webAppUrl
    };
  }

  /**
   * Get details for a specific version
   */
  async getVersion(scriptId: string, versionNumber: number, accessToken?: string): Promise<any> {
    // TODO: Extract to gasDeployOperations when created
    await this.authOps.initializeClient(accessToken);

    console.error(`📋 Getting version ${versionNumber} details for script ${scriptId}`);

    const scriptApi = (this.authOps as any).scriptApi;
    const response = await scriptApi.projects.versions.get({
      scriptId,
      versionNumber
    });

    console.error(`✅ Retrieved version ${versionNumber} details`);
    return response.data;
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
    // TODO: Extract to gasDeployOperations when created
    await this.authOps.initializeClient(accessToken);

    const params: any = {
      scriptId,
      pageSize
    };

    if (pageToken) {
      params.pageToken = pageToken;
    }

    console.error(`📋 Listing versions for script ${scriptId}`);

    const scriptApi = (this.authOps as any).scriptApi;
    const response = await scriptApi.projects.versions.list(params);

    console.error(`✅ Found ${response.data.versions?.length || 0} versions`);

    return {
      versions: response.data.versions || [],
      nextPageToken: response.data.nextPageToken
    };
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
  // NOTE: These methods are still in gasClient.ts and haven't been extracted yet
  // They will be delegated once gasLoggingOperations.ts is created

  /**
   * List processes made by or on behalf of a user
   */
  async listProcesses(
    pageSize: number = 50,
    pageToken?: string,
    userProcessFilter?: ListUserProcessesFilter,
    accessToken?: string
  ): Promise<ProcessListResponse> {
    // TODO: Extract to gasLoggingOperations when created
    // For now, delegate to authOps which has the makeApiCall infrastructure
    await this.authOps.initializeClient(accessToken);

    const params: any = { pageSize };
    if (pageToken) params.pageToken = pageToken;

    if (userProcessFilter) {
      if (userProcessFilter.scriptId) params['userProcessFilter.scriptId'] = userProcessFilter.scriptId;
      if (userProcessFilter.deploymentId) params['userProcessFilter.deploymentId'] = userProcessFilter.deploymentId;
      if (userProcessFilter.projectName) params['userProcessFilter.projectName'] = userProcessFilter.projectName;
      if (userProcessFilter.functionName) params['userProcessFilter.functionName'] = userProcessFilter.functionName;
      if (userProcessFilter.startTime) params['userProcessFilter.startTime'] = userProcessFilter.startTime;
      if (userProcessFilter.endTime) params['userProcessFilter.endTime'] = userProcessFilter.endTime;
      if (userProcessFilter.types) params['userProcessFilter.types'] = userProcessFilter.types;
      if (userProcessFilter.statuses) params['userProcessFilter.statuses'] = userProcessFilter.statuses;
      if (userProcessFilter.userAccessLevels) params['userProcessFilter.userAccessLevels'] = userProcessFilter.userAccessLevels;
    }

    const scriptApi = (this.authOps as any).scriptApi;
    const response = await scriptApi.processes.list(params);

    return {
      processes: response.data.processes || [],
      nextPageToken: response.data.nextPageToken
    };
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
    // TODO: Extract to gasLoggingOperations when created
    await this.authOps.initializeClient(accessToken);

    const params: any = {
      scriptId,
      pageSize
    };

    if (pageToken) params.pageToken = pageToken;
    if (scriptProcessFilter) params.scriptProcessFilter = scriptProcessFilter;

    const scriptApi = (this.authOps as any).scriptApi;
    const response = await scriptApi.processes.listScriptProcesses(params);

    return {
      scriptId,
      processes: response.data.processes || [],
      nextPageToken: response.data.nextPageToken
    };
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
    // TODO: Extract to gasLoggingOperations when created
    await this.authOps.initializeClient(accessToken);

    const params: any = {
      scriptId,
      metricsGranularity
    };

    if (metricsFilter?.deploymentId) {
      params['metricsFilter.deploymentId'] = metricsFilter.deploymentId;
    }

    const scriptApi = (this.authOps as any).scriptApi;
    const response = await scriptApi.projects.getMetrics(params);

    return {
      scriptId,
      metricsGranularity,
      activeUsers: response.data.activeUsers || [],
      totalExecutions: response.data.totalExecutions || [],
      failedExecutions: response.data.failedExecutions || []
    };
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
    // Build filter for Processes API
    const userProcessFilter: ListUserProcessesFilter = {
      scriptId,
      startTime: options.startTime,
      endTime: options.endTime,
    };

    if (options.functionName) {
      userProcessFilter.functionName = options.functionName;
    }

    if (options.statusFilter && options.statusFilter !== 'ALL') {
      userProcessFilter.statuses = [options.statusFilter as any];
    }

    // Call existing listProcesses method
    const result = await this.listProcesses(
      options.pageSize || 10,
      options.pageToken,
      userProcessFilter,
      accessToken
    );

    // Build LLM-optimized response
    return this.buildLogResponse(result, options);
  }

  /**
   * Build LLM-optimized response from process list
   */
  private buildLogResponse(result: ProcessListResponse, options: any): any {
    // Normalize function names and build process list
    const processes = (result.processes || []).map((p: any) => ({
      processId: p.processId || `${p.functionName}-${p.startTime}`,
      functionName: this.normalizeFunctionName(p.functionName),
      status: p.processStatus,
      duration: p.duration,
      startTime: p.startTime,
      ...(p.processStatus === 'FAILED' ? { errorPreview: this.formatErrorPreview(p.error) } : {})
    }));

    const statusCounts = {
      completed: processes.filter((p: any) => p.status === 'COMPLETED').length,
      failed: processes.filter((p: any) => p.status === 'FAILED').length,
      timedOut: processes.filter((p: any) => p.status === 'TIMED_OUT').length,
      running: processes.filter((p: any) => p.status === 'RUNNING').length
    };

    const response: any = {
      summary: {
        total: processes.length,
        statusCounts,
        truncated: !!result.nextPageToken
      },
      processes,
      limitations: 'Detailed logs require exec() - this provides execution metadata only'
    };

    // Add recommendations (max 3, prioritized by urgency)
    const recommendations = this.generateRecommendations(processes, statusCounts, result, options);
    if (recommendations.length > 0) {
      response.recommendations = recommendations;
    }

    // Add pagination if more results
    if (result.nextPageToken) {
      response.pagination = {
        hasMore: true,
        nextPageToken: result.nextPageToken
      };
    }

    return response;
  }

  /**
   * Normalize function names for readability
   */
  private normalizeFunctionName(name: string | undefined): string {
    if (!name) return '[unknown]';
    if (name.startsWith('__GS_INTERNAL_')) return `[internal] ${name.replace('__GS_INTERNAL_', '')}`;
    return name;
  }

  /**
   * Format error preview (80 chars, newlines stripped)
   */
  private formatErrorPreview(error: any): string | undefined {
    if (!error) return undefined;
    const msg = String(error.message || error)
      .replace(/\n/g, ' ')
      .slice(0, 80)
      .trim();
    return msg.length < String(error.message || error).length ? msg + '...' : msg;
  }

  /**
   * Generate contextual recommendations for debugging
   */
  private generateRecommendations(
    processes: any[],
    statusCounts: any,
    result: ProcessListResponse,
    options: any
  ): any[] {
    const recommendations: any[] = [];
    const total = statusCounts.completed + statusCounts.failed + statusCounts.timedOut + statusCounts.running;
    const minutes = options.minutes || 10;

    // SCENARIO 1: Recent Failure Detection (most common debugging use case)
    if (statusCounts.failed > 0 && !options.statusFilter) {
      // Find most recent failure for get_failure_details
      const recentFailure = processes.find((p: any) => p.status === 'FAILED');
      if (recentFailure) {
        recommendations.push({
          urgency: 'CRITICAL',
          action: 'get_failure_details',
          reason: `${statusCounts.failed} failed execution(s) - get error details`,
          params: { operation: 'get', processId: recentFailure.processId },
          context: `Function: ${recentFailure.functionName}`
        });
      }

      // If multiple failures from same function, suggest filtering
      const failedFunctions = processes
        .filter((p: any) => p.status === 'FAILED')
        .map((p: any) => p.functionName);
      const dominantFailure = this.findDominantFunction(failedFunctions);
      if (dominantFailure && statusCounts.failed > 1) {
        recommendations.push({
          urgency: 'HIGH',
          action: 'filter_by_function',
          reason: `${dominantFailure.count} failures from same function`,
          params: { functionName: dominantFailure.name, statusFilter: 'FAILED' }
        });
      }
    }

    // SCENARIO 2: No Results - Progressive widening
    if (total === 0) {
      const nextMinutes = this.getNextTimeRange(minutes);
      recommendations.push({
        urgency: minutes <= 10 ? 'HIGH' : 'NORMAL',
        action: 'widen_timerange',
        reason: `No executions in last ${minutes} minutes`,
        params: { minutes: nextMinutes },
        context: nextMinutes > 60 ? 'Consider checking trigger configuration' : undefined
      });
    }

    // SCENARIO 3: All Running
    if (statusCounts.running === total && total > 0) {
      recommendations.push({
        urgency: 'NORMAL',
        action: 'wait_and_retry',
        reason: 'All processes currently running',
        params: { delaySeconds: 30 }
      });
    }

    // SCENARIO 4: Pagination (lower priority than failures)
    if (result.nextPageToken) {
      recommendations.push({
        urgency: statusCounts.failed > 0 ? 'INFO' : 'NORMAL',
        action: 'paginate',
        reason: 'More results available',
        params: { pageToken: result.nextPageToken },
        context: 'Warning: Results may become stale across pages'
      });
    }

    // SCENARIO 5: Duration analysis (for performance debugging)
    const slowProcess = processes.find((p: any) => this.parseDuration(p.duration) > 30);
    if (slowProcess && !statusCounts.failed) {
      recommendations.push({
        urgency: 'HIGH',
        action: 'investigate_slow',
        reason: `Slow execution detected (${slowProcess.duration})`,
        params: { operation: 'get', processId: slowProcess.processId },
        context: `Function: ${slowProcess.functionName}`
      });
    }

    // Return max 3 recommendations, sorted by urgency
    return this.selectTopRecommendations(recommendations, 3);
  }

  /**
   * Get next time range for progressive widening
   */
  private getNextTimeRange(current: number): number {
    // Progressive widening: 10 → 60 → 240 → 1440 → 10080
    if (current <= 10) return 60;
    if (current <= 60) return 240;
    if (current <= 240) return 1440;
    return 10080;
  }

  /**
   * Find dominant function in a list (for filter recommendations)
   */
  private findDominantFunction(functions: string[]): { name: string; count: number } | null {
    const counts: Record<string, number> = {};
    functions.forEach(f => counts[f] = (counts[f] || 0) + 1);
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted.length > 0 && sorted[0][1] > 1
      ? { name: sorted[0][0], count: sorted[0][1] }
      : null;
  }

  /**
   * Parse duration string (e.g., "12.345s" → 12.345)
   */
  private parseDuration(duration: string): number {
    const match = duration?.match(/^([\d.]+)s$/);
    return match ? parseFloat(match[1]) : 0;
  }

  /**
   * Select top N recommendations by urgency
   */
  private selectTopRecommendations(all: any[], max: number): any[] {
    const urgencyOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, INFO: 3 };
    return all
      .sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency])
      .slice(0, max);
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
