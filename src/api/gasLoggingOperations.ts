/**
 * Cloud Logging Operations Module
 *
 * Provides access to Google Cloud Logging API for fetching historical
 * Apps Script execution logs. Works with the GCP project associated
 * with an Apps Script project.
 */

import { google, logging_v2 } from 'googleapis';
import { rateLimiter } from './rateLimiter.js';
import { GASApiError } from '../errors/mcpErrors.js';

/**
 * Log entry parsed from Cloud Logging
 */
export interface ParsedLogEntry {
  timestamp: string;
  severity: string;
  message: string;
  functionName?: string;
  executionId?: string;
  insertId?: string;
  labels?: Record<string, string>;
}

/**
 * Filter options for log queries
 */
export interface LogFilterOptions {
  startTime?: string;      // ISO 8601 or relative (-10m, -1h)
  endTime?: string;        // ISO 8601 or relative
  severity?: string;       // Minimum severity level
  functionName?: string;   // Filter to specific function
  textFilter?: string;     // Regex pattern for message content
}

/**
 * Pagination options
 */
export interface LogPaginationOptions {
  pageSize?: number;
  pageToken?: string;
  orderBy?: 'timestamp asc' | 'timestamp desc';
}

/**
 * Result from listing log entries
 */
export interface LogListResult {
  entries: ParsedLogEntry[];
  nextPageToken?: string;
  totalSize?: number;
}

/**
 * Cloud Logging Operations class
 */
export class GASLoggingOperations {
  private loggingApi: logging_v2.Logging | null = null;
  private clientCache = new Map<string, { api: logging_v2.Logging; expires: number }>();
  private readonly CLIENT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  /**
   * Initialize Cloud Logging API client
   */
  private async initializeClient(accessToken: string): Promise<logging_v2.Logging> {
    // Check cache first
    const tokenHash = accessToken.substring(0, 20);
    const cached = this.clientCache.get(tokenHash);

    if (cached && Date.now() < cached.expires) {
      return cached.api;
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const loggingApi = google.logging({ version: 'v2', auth });

    // Cache the client
    this.clientCache.set(tokenHash, {
      api: loggingApi,
      expires: Date.now() + this.CLIENT_CACHE_TTL
    });

    return loggingApi;
  }

  /**
   * Parse a relative time string (-10m, -1h, -1d) to ISO timestamp
   */
  private parseRelativeTime(relativeTime: string): string {
    const now = new Date();
    const match = relativeTime.match(/^-(\d+)([mhd])$/);

    if (!match) {
      // Assume it's already ISO format
      return relativeTime;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 'm':
        now.setMinutes(now.getMinutes() - value);
        break;
      case 'h':
        now.setHours(now.getHours() - value);
        break;
      case 'd':
        now.setDate(now.getDate() - value);
        break;
    }

    return now.toISOString();
  }

  /**
   * Build Cloud Logging filter string for Apps Script logs
   */
  private buildFilter(gcpProjectId: string, options: LogFilterOptions): string {
    const filters: string[] = [
      // Filter to Apps Script logs
      'resource.type="api"',
      'resource.labels.service="script.googleapis.com"'
    ];

    // Time range
    if (options.startTime) {
      const startTimestamp = this.parseRelativeTime(options.startTime);
      filters.push(`timestamp >= "${startTimestamp}"`);
    }

    if (options.endTime) {
      const endTimestamp = this.parseRelativeTime(options.endTime);
      filters.push(`timestamp <= "${endTimestamp}"`);
    }

    // Severity filter
    if (options.severity) {
      filters.push(`severity >= "${options.severity.toUpperCase()}"`);
    }

    // Function name filter (in labels)
    if (options.functionName) {
      filters.push(`labels.function_name="${options.functionName}"`);
    }

    // Text content filter
    if (options.textFilter) {
      // Use textPayload for simple logs, jsonPayload.message for structured
      filters.push(`(textPayload=~"${options.textFilter}" OR jsonPayload.message=~"${options.textFilter}")`);
    }

    return filters.join('\n');
  }

  /**
   * Parse a raw Cloud Logging entry into our simplified format
   */
  private parseLogEntry(entry: logging_v2.Schema$LogEntry): ParsedLogEntry {
    // Extract message from textPayload or jsonPayload
    let message = '';
    if (entry.textPayload) {
      message = entry.textPayload;
    } else if (entry.jsonPayload) {
      const payload = entry.jsonPayload as Record<string, any>;
      message = payload.message || payload.text || JSON.stringify(payload);
    }

    // Truncate long messages
    const MAX_MESSAGE_LENGTH = 200;
    if (message.length > MAX_MESSAGE_LENGTH) {
      message = message.substring(0, MAX_MESSAGE_LENGTH) + '...';
    }

    return {
      timestamp: entry.timestamp || new Date().toISOString(),
      severity: entry.severity || 'DEFAULT',
      message,
      functionName: entry.labels?.function_name,
      executionId: entry.labels?.execution_id,
      insertId: entry.insertId || undefined,
      labels: entry.labels || undefined
    };
  }

  /**
   * List log entries from Cloud Logging
   *
   * @param gcpProjectId - GCP project ID/number
   * @param filterOptions - Filter options (time range, severity, etc.)
   * @param paginationOptions - Pagination options
   * @param accessToken - OAuth access token
   * @returns Parsed log entries with pagination info
   */
  async listLogEntries(
    gcpProjectId: string,
    filterOptions: LogFilterOptions = {},
    paginationOptions: LogPaginationOptions = {},
    accessToken: string
  ): Promise<LogListResult> {
    await rateLimiter.checkLimit();

    const loggingApi = await this.initializeClient(accessToken);

    // Build the filter
    const filter = this.buildFilter(gcpProjectId, filterOptions);

    // Set defaults
    const pageSize = Math.min(paginationOptions.pageSize || 20, 1000);
    const orderBy = paginationOptions.orderBy || 'timestamp desc';

    try {
      const response = await loggingApi.entries.list({
        requestBody: {
          resourceNames: [`projects/${gcpProjectId}`],
          filter,
          orderBy,
          pageSize,
          pageToken: paginationOptions.pageToken
        }
      });

      const entries = (response.data.entries || []).map(entry => this.parseLogEntry(entry));

      return {
        entries,
        nextPageToken: response.data.nextPageToken || undefined
      };
    } catch (error: any) {
      // Handle specific Cloud Logging errors
      const status = error.code || error.response?.status;
      const message = error.message || 'Unknown Cloud Logging error';

      // DEBUG: Log full error details
      console.error('[CLOUD_LOGGING] Error:', JSON.stringify({
        code: error.code,
        status: error.response?.status,
        message: error.message,
        errors: error.errors,
        response: error.response?.data
      }, null, 2));

      if (status === 403) {
        throw new GASApiError(
          `Cloud Logging access denied: ${message}. The GCP project may not be accessible or Cloud Logging API may need to be enabled.`,
          403,
          'PERMISSION_DENIED'
        );
      }

      if (status === 404) {
        throw new GASApiError(
          `GCP project ${gcpProjectId} not found or not accessible.`,
          404,
          'NOT_FOUND'
        );
      }

      throw new GASApiError(
        `Cloud Logging API error: ${message}`,
        status || 500,
        'LOGGING_ERROR'
      );
    }
  }
}

/**
 * Singleton instance for reuse
 */
export const gasLoggingOperations = new GASLoggingOperations();
