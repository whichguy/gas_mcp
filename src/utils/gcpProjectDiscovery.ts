/**
 * GCP Project Discovery Utility
 *
 * Discovers the GCP project number associated with an Apps Script project.
 * Uses a creative technique: calling the Apps Script API from within GAS
 * triggers an error that reveals the GCP project number in containerInfo.
 */

import { GASClient } from '../api/gasClient.js';

/**
 * In-memory cache for GCP project IDs (session-scoped)
 * Project IDs don't change, so 24-hour TTL is safe.
 */
interface CacheEntry {
  projectId: string;
  discoveredAt: Date;
}

const gcpProjectCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Discovery result with metadata
 */
export interface GcpProjectDiscoveryResult {
  projectId: string | null;
  cached: boolean;
  error?: string;
}

/**
 * Get the GCP project ID for a script, using cache when available.
 *
 * @param scriptId - Apps Script project ID
 * @param gasClient - GASClient instance for execution
 * @param accessToken - OAuth access token
 * @returns Discovery result with project ID and cache status
 */
export async function getGcpProjectId(
  scriptId: string,
  gasClient: GASClient,
  accessToken: string
): Promise<GcpProjectDiscoveryResult> {
  // Check cache first
  const cached = gcpProjectCache.get(scriptId);
  if (cached && Date.now() - cached.discoveredAt.getTime() < CACHE_TTL_MS) {
    return {
      projectId: cached.projectId,
      cached: true
    };
  }

  // Discover via exec
  const result = await discoverGcpProjectId(scriptId, gasClient, accessToken);

  if (result.projectId) {
    // Cache the result
    gcpProjectCache.set(scriptId, {
      projectId: result.projectId,
      discoveredAt: new Date()
    });
  }

  return {
    ...result,
    cached: false
  };
}

/**
 * Discover GCP project number for a script using web app execution.
 *
 * This works by making an API call from within GAS that returns an error
 * containing the GCP project number in the containerInfo field.
 *
 * @param scriptId - Apps Script project ID
 * @param gasClient - GASClient instance for URL construction
 * @param accessToken - OAuth access token
 * @returns Discovery result
 */
export async function discoverGcpProjectId(
  scriptId: string,
  gasClient: GASClient,
  accessToken: string
): Promise<GcpProjectDiscoveryResult> {
  // This JavaScript runs inside GAS and triggers an error that reveals
  // the GCP project number in the error details
  const discoveryCode = `
    (function() {
      try {
        var response = UrlFetchApp.fetch(
          'https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId(),
          {
            headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
            muteHttpExceptions: true
          }
        );
        var data = JSON.parse(response.getContentText());

        // The error response contains the GCP project number
        if (data.error && data.error.details) {
          var detail = data.error.details.find(function(d) {
            return d.metadata && d.metadata.containerInfo;
          });
          if (detail) {
            return detail.metadata.containerInfo;
          }
        }

        // If we got a successful response (unlikely), try to extract from it
        if (data.scriptId) {
          // No direct way to get GCP project from success response
          return null;
        }

        return null;
      } catch (e) {
        return { error: e.toString() };
      }
    })()
  `;

  try {
    // Get the web app URL for this script
    const executionUrl = await gasClient.constructGasRunUrl(scriptId, accessToken);

    // Build the execution URL with the JavaScript code
    const separator = executionUrl.includes('?') ? '&' : '?';
    const encodedCode = encodeURIComponent(discoveryCode);
    const finalUrl = `${executionUrl}${separator}_mcp_run=true&func=${encodedCode}`;

    // Execute via HTTP request to the web app
    const response = await fetch(finalUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      return {
        projectId: null,
        cached: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    // Parse the JSON response from __mcp_exec
    // Response structure is now consistent:
    //   Success: { success: true, result: <value>, execution_type: "...", ... }
    //   Error:   { success: false, error: true, message: "...", execution_type: "...", ... }
    const result = await response.json();

    // Check success field (always present after fix)
    if (result.success === false) {
      return {
        projectId: null,
        cached: false,
        error: result.message || 'Execution error'
      };
    }

    if (result.success === true && result.result !== undefined) {
      // Check if it's an error object from the inner try/catch in discovery code
      if (typeof result.result === 'object' && result.result !== null && result.result.error) {
        return {
          projectId: null,
          cached: false,
          error: `Discovery failed: ${result.result.error}`
        };
      }

      // Should be a string (the GCP project number)
      if (typeof result.result === 'string') {
        return {
          projectId: result.result,
          cached: false
        };
      }
    }

    return {
      projectId: null,
      cached: false,
      error: result.message || 'Unknown discovery error'
    };
  } catch (error: any) {
    return {
      projectId: null,
      cached: false,
      error: error.message || 'Discovery execution failed'
    };
  }
}

/**
 * Clear the GCP project cache (for testing or forced refresh)
 */
export function clearGcpProjectCache(): void {
  gcpProjectCache.clear();
}

/**
 * Get cache statistics (for debugging)
 */
export function getGcpProjectCacheStats(): { size: number; entries: string[] } {
  return {
    size: gcpProjectCache.size,
    entries: Array.from(gcpProjectCache.keys())
  };
}
