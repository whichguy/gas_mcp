/**
 * Cloud Logs Tool
 *
 * Fetches historical Logger.log() output from Apps Script executions
 * via Google Cloud Logging API. Includes dynamic LLM hints for
 * navigating large log volumes efficiently.
 */

import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { ValidationError, GASApiError } from '../errors/mcpErrors.js';
import {
  getGcpProjectId,
  GcpProjectDiscoveryResult
} from '../utils/gcpProjectDiscovery.js';
import {
  gasLoggingOperations,
  ParsedLogEntry,
  LogFilterOptions,
  LogPaginationOptions
} from '../api/gasLoggingOperations.js';

/**
 * Recommendation urgency levels
 */
type Urgency = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'INFO';

/**
 * Dynamic recommendation for LLM guidance
 */
interface Recommendation {
  urgency: Urgency;
  action: string;
  reason: string;
  command: string;
  context?: string;
}

/**
 * Summary statistics for log entries
 */
interface LogSummary {
  total: number;
  showing: number;
  truncated: boolean;
  severityCounts: Record<string, number>;
  timeRange: {
    start: string;
    end: string;
    spanMinutes: number;
  };
  uniqueFunctions: string[];
}

/**
 * Pagination info in response
 */
interface PaginationInfo {
  hasMore: boolean;
  nextPageToken?: string;
  pageSize: number;
  warning?: string;
}

/**
 * Full response structure
 */
interface CloudLogsResponse {
  summary: LogSummary;
  entries: ParsedLogEntry[];
  pagination?: PaginationInfo;
  recommendations: Recommendation[];
  gcpProjectId: string;
  scriptId: string;
  cached: boolean;
  error?: string;
  fallback?: {
    action: string;
    reason: string;
    command: string;
  };
}

/**
 * Cloud Logs Tool for fetching historical GAS logs
 */
export class CloudLogsTool extends BaseTool {
  public name = 'cloud_logs';
  public description = '[MONITOR] Fetch historical Logger.log() output from Apps Script executions via Cloud Logging API. Auto-discovers GCP project ID. Returns paginated results with dynamic LLM hints.';

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      gcpProjectId: {
        type: 'string',
        description: 'GCP project ID/number (optional - auto-discovered & cached if omitted)'
      },
      // Time filtering
      startTime: {
        type: 'string',
        description: 'ISO 8601 or relative (-10m, -1h, -1d). Default: -10m',
        default: '-10m'
      },
      endTime: {
        type: 'string',
        description: 'ISO 8601 or relative. Default: now'
      },
      // Content filtering
      functionName: {
        type: 'string',
        description: 'Filter to specific function (improves performance)'
      },
      severity: {
        type: 'string',
        enum: ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'],
        description: 'Minimum severity level'
      },
      textFilter: {
        type: 'string',
        description: 'Regex pattern to filter log message content'
      },
      // Pagination
      pageSize: {
        type: 'number',
        default: 20,
        maximum: 100,
        minimum: 1,
        description: 'Entries per page. Default 20 (token-safe). Max 100.'
      },
      pageToken: {
        type: 'string',
        description: 'Token from previous response for pagination'
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId'],
    additionalProperties: false,
    llmGuidance: {
      whenToUse: 'Fetch historical Logger.log() output | Debug past executions | Analyze patterns',
      limitation: 'Requires accessible GCP project. Default GCP projects may not be API-accessible.',
      workflow: 'cloud_logs({scriptId}) → check recommendations → filter/paginate as needed',
      tokenSafety: 'Default pageSize=20 prevents context overflow. Increase cautiously.',
      examples: [
        'Recent logs: cloud_logs({scriptId})',
        'Errors only: cloud_logs({scriptId, severity:"ERROR"})',
        'Specific function: cloud_logs({scriptId, functionName:"doGet", startTime:"-1h"})'
      ]
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<CloudLogsResponse> {
    const accessToken = await this.getAuthToken(params);

    // Validate inputs
    const scriptId = this.validate.scriptId(params.scriptId, 'cloud logs');
    const pageSize = params.pageSize
      ? this.validate.number(params.pageSize, 'pageSize', 'cloud logs', 1, 100)
      : 20;

    // Step 1: Get GCP project ID (auto-discover or use provided)
    let gcpProjectId = params.gcpProjectId;
    let cached = false;

    if (!gcpProjectId) {
      const discovery = await this.discoverProject(scriptId, accessToken);

      if (!discovery.projectId) {
        return this.buildFallbackResponse(scriptId, discovery.error || 'Could not discover GCP project');
      }

      gcpProjectId = discovery.projectId;
      cached = discovery.cached;
    }

    // Step 2: Build filter options
    const filterOptions: LogFilterOptions = {
      startTime: params.startTime || '-10m',
      endTime: params.endTime,
      severity: params.severity,
      functionName: params.functionName,
      textFilter: params.textFilter
    };

    // Step 3: Build pagination options
    const paginationOptions: LogPaginationOptions = {
      pageSize,
      pageToken: params.pageToken,
      orderBy: 'timestamp desc'
    };

    // Step 4: Fetch logs
    try {
      const result = await gasLoggingOperations.listLogEntries(
        gcpProjectId,
        filterOptions,
        paginationOptions,
        accessToken
      );

      // Step 5: Build response with dynamic hints
      return this.buildResponse(
        scriptId,
        gcpProjectId,
        cached,
        result.entries,
        result.nextPageToken,
        filterOptions,
        pageSize
      );
    } catch (error: any) {
      if (error instanceof GASApiError) {
        return this.buildFallbackResponse(scriptId, error.message, gcpProjectId, cached);
      }
      throw error;
    }
  }

  /**
   * Discover GCP project ID for the script
   */
  private async discoverProject(
    scriptId: string,
    accessToken: string
  ): Promise<GcpProjectDiscoveryResult> {
    try {
      return await getGcpProjectId(scriptId, this.gasClient, accessToken);
    } catch (error: any) {
      return {
        projectId: null,
        cached: false,
        error: error.message || 'Discovery failed'
      };
    }
  }

  /**
   * Build a fallback response when Cloud Logging isn't available
   */
  private buildFallbackResponse(
    scriptId: string,
    error: string,
    gcpProjectId?: string,
    cached: boolean = false
  ): CloudLogsResponse {
    return {
      summary: {
        total: 0,
        showing: 0,
        truncated: false,
        severityCounts: {},
        timeRange: {
          start: new Date().toISOString(),
          end: new Date().toISOString(),
          spanMinutes: 0
        },
        uniqueFunctions: []
      },
      entries: [],
      recommendations: [],
      gcpProjectId: gcpProjectId || 'unknown',
      scriptId,
      cached,
      error,
      fallback: {
        action: 'use_exec',
        reason: 'exec() captures Logger.log() directly during execution',
        command: `exec({scriptId: "${scriptId}", js_statement: "require('Module').function()"})`
      }
    };
  }

  /**
   * Build the full response with dynamic LLM hints
   */
  private buildResponse(
    scriptId: string,
    gcpProjectId: string,
    cached: boolean,
    entries: ParsedLogEntry[],
    nextPageToken: string | undefined,
    filterOptions: LogFilterOptions,
    pageSize: number
  ): CloudLogsResponse {
    // Calculate summary statistics
    const summary = this.buildSummary(entries, filterOptions, nextPageToken);

    // Generate dynamic recommendations
    const recommendations = this.generateRecommendations(
      scriptId,
      entries,
      summary,
      filterOptions,
      nextPageToken
    );

    // Sort entries by severity (errors first), then by time
    const sortedEntries = this.sortEntriesBySeverity(entries);

    // Apply volume-based shaping
    const shapedEntries = this.shapeEntriesByVolume(sortedEntries, summary.total);

    // Build pagination info
    const pagination: PaginationInfo | undefined = nextPageToken
      ? {
          hasMore: true,
          nextPageToken,
          pageSize,
          warning: 'Results may shift if new logs arrive during pagination'
        }
      : undefined;

    return {
      summary,
      entries: shapedEntries,
      pagination,
      recommendations,
      gcpProjectId,
      scriptId,
      cached
    };
  }

  /**
   * Build summary statistics from log entries
   */
  private buildSummary(
    entries: ParsedLogEntry[],
    filterOptions: LogFilterOptions,
    nextPageToken?: string
  ): LogSummary {
    // Count by severity
    const severityCounts: Record<string, number> = {};
    const functionSet = new Set<string>();

    for (const entry of entries) {
      // Severity counts
      const sev = entry.severity || 'DEFAULT';
      severityCounts[sev] = (severityCounts[sev] || 0) + 1;

      // Collect unique functions
      if (entry.functionName) {
        functionSet.add(entry.functionName);
      }
    }

    // Calculate time range from entries
    let startTime = new Date().toISOString();
    let endTime = new Date().toISOString();

    if (entries.length > 0) {
      const timestamps = entries.map(e => new Date(e.timestamp).getTime());
      startTime = new Date(Math.min(...timestamps)).toISOString();
      endTime = new Date(Math.max(...timestamps)).toISOString();
    }

    const spanMs = new Date(endTime).getTime() - new Date(startTime).getTime();
    const spanMinutes = Math.round(spanMs / 60000);

    return {
      total: entries.length,
      showing: entries.length,
      truncated: !!nextPageToken,
      severityCounts,
      timeRange: {
        start: startTime,
        end: endTime,
        spanMinutes
      },
      uniqueFunctions: Array.from(functionSet)
    };
  }

  /**
   * Generate dynamic recommendations based on log analysis
   */
  private generateRecommendations(
    scriptId: string,
    entries: ParsedLogEntry[],
    summary: LogSummary,
    filterOptions: LogFilterOptions,
    nextPageToken?: string
  ): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // Priority 1: Errors found
    const errorCount = (summary.severityCounts['ERROR'] || 0) +
                       (summary.severityCounts['CRITICAL'] || 0);

    if (errorCount > 0 && !filterOptions.severity) {
      const recentError = entries.find(e =>
        e.severity === 'ERROR' || e.severity === 'CRITICAL'
      );

      recommendations.push({
        urgency: 'CRITICAL',
        action: 'filter_errors',
        reason: `${errorCount} error(s) found - investigate immediately`,
        command: `cloud_logs({scriptId: "${scriptId}", severity: "ERROR"})`,
        context: recentError
          ? `Most recent: ${recentError.message.substring(0, 150)}...`
          : undefined
      });
    }

    // Priority 2: Too many results
    if (summary.total >= 100 && !filterOptions.functionName) {
      recommendations.push({
        urgency: 'HIGH',
        action: 'narrow_scope',
        reason: `${summary.total}+ entries - consider narrowing search`,
        command: `cloud_logs({scriptId: "${scriptId}", startTime: "-5m"})`
      });
    }

    // Priority 3: Multiple functions
    if (summary.uniqueFunctions.length > 2 && !filterOptions.functionName) {
      recommendations.push({
        urgency: 'NORMAL',
        action: 'filter_function',
        reason: `${summary.uniqueFunctions.length} functions logged - focus investigation`,
        command: `cloud_logs({scriptId: "${scriptId}", functionName: "${summary.uniqueFunctions[0]}"})`,
        context: `Functions: ${summary.uniqueFunctions.slice(0, 3).join(', ')}`
      });
    }

    // Priority 4: No results - suggest widening
    if (summary.total === 0) {
      const currentStart = filterOptions.startTime || '-10m';
      const suggestedStart = this.suggestWiderTimeRange(currentStart);

      recommendations.push({
        urgency: 'HIGH',
        action: 'widen_timerange',
        reason: 'No logs found in current time range',
        command: `cloud_logs({scriptId: "${scriptId}", startTime: "${suggestedStart}"})`
      });
    }

    // Priority 5: Pagination available
    if (nextPageToken) {
      recommendations.push({
        urgency: 'INFO',
        action: 'paginate',
        reason: 'More results available',
        command: `cloud_logs({scriptId: "${scriptId}", pageToken: "${nextPageToken}"})`,
        context: 'Results may shift if new logs arrive'
      });
    }

    // Sort by urgency and limit to 3
    const urgencyOrder: Record<Urgency, number> = {
      'CRITICAL': 0,
      'HIGH': 1,
      'NORMAL': 2,
      'INFO': 3
    };

    return recommendations
      .sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency])
      .slice(0, 3);
  }

  /**
   * Suggest a wider time range based on current setting
   */
  private suggestWiderTimeRange(current: string): string {
    const widening: Record<string, string> = {
      '-5m': '-30m',
      '-10m': '-1h',
      '-30m': '-2h',
      '-1h': '-6h',
      '-2h': '-12h',
      '-6h': '-1d',
      '-12h': '-1d',
      '-1d': '-7d'
    };

    return widening[current] || '-1h';
  }

  /**
   * Sort entries with errors first, then by timestamp
   */
  private sortEntriesBySeverity(entries: ParsedLogEntry[]): ParsedLogEntry[] {
    const severityOrder: Record<string, number> = {
      'CRITICAL': 0,
      'ERROR': 1,
      'WARNING': 2,
      'INFO': 3,
      'DEBUG': 4,
      'DEFAULT': 5
    };

    return [...entries].sort((a, b) => {
      const sevA = severityOrder[a.severity] ?? 5;
      const sevB = severityOrder[b.severity] ?? 5;

      if (sevA !== sevB) {
        return sevA - sevB;
      }

      // Same severity: sort by timestamp descending
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }

  /**
   * Apply volume-based shaping to limit response size
   */
  private shapeEntriesByVolume(entries: ParsedLogEntry[], total: number): ParsedLogEntry[] {
    // Small volume: return all
    if (total <= 100) {
      return entries;
    }

    // Medium volume: return first 100
    if (total <= 300) {
      return entries.slice(0, 100);
    }

    // Large volume: prioritize errors, limit to 100
    const errors = entries.filter(e =>
      e.severity === 'ERROR' || e.severity === 'CRITICAL'
    );

    if (errors.length >= 100) {
      return errors.slice(0, 100);
    }

    // Fill remaining with other entries
    const others = entries.filter(e =>
      e.severity !== 'ERROR' && e.severity !== 'CRITICAL'
    );

    return [...errors, ...others].slice(0, 100);
  }
}
