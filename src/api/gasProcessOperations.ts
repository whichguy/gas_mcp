// Process/metrics facade — wraps processes.list, getMetrics, listScriptProcesses

/**
 * Process Operations Module
 *
 * This module handles Apps Script process monitoring and metrics operations:
 * - List user processes with optional filtering
 * - List script-specific processes
 * - Get project metrics (usage/execution statistics)
 * - Build LLM-optimized log responses from process data
 *
 * Extracted from gasClient.ts for better modularity and maintainability.
 */

import { GASAuthOperations } from './gasAuthOperations.js';
import type {
  ListUserProcessesFilter,
  ListScriptProcessesFilter,
  ProcessListResponse,
  ProjectMetrics,
  MetricsGranularity,
  MetricsFilter
} from './gasTypes.js';

/**
 * Process Operations class
 * Manages Google Apps Script process monitoring and metrics operations
 */
export class GASProcessOperations {
  private authOps: GASAuthOperations;

  constructor(authOps: GASAuthOperations) {
    this.authOps = authOps;
  }

  /**
   * List processes made by or on behalf of a user
   */
  async listProcesses(
    pageSize: number = 50,
    pageToken?: string,
    userProcessFilter?: ListUserProcessesFilter,
    accessToken?: string
  ): Promise<ProcessListResponse> {
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

    const scriptApi = this.authOps.getScriptApi();
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
    await this.authOps.initializeClient(accessToken);

    const params: any = {
      scriptId,
      pageSize
    };

    if (pageToken) params.pageToken = pageToken;
    if (scriptProcessFilter) params.scriptProcessFilter = scriptProcessFilter;

    const scriptApi = this.authOps.getScriptApi();
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
    await this.authOps.initializeClient(accessToken);

    const params: any = {
      scriptId,
      metricsGranularity
    };

    if (metricsFilter?.deploymentId) {
      params['metricsFilter.deploymentId'] = metricsFilter.deploymentId;
    }

    const scriptApi = this.authOps.getScriptApi();
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

    // Call listProcesses method
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
  buildLogResponse(result: ProcessListResponse, options: any): any {
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
}
