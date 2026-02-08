/**
 * @fileoverview Server-Side Execution Helper
 *
 * Lightweight utility for executing JavaScript code on GAS server
 * Used by tools that need to run server-side code without full exec tool overhead
 */

import { GASClient } from '../api/gasClient.js';

export interface ServerExecResult {
  success: boolean;
  result?: any;
  message?: string;
  error?: string;
  logger_output?: string;
}

/**
 * Default timeout for server-side execution (30 seconds)
 */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Execute JavaScript code on GAS server via /dev deployment
 *
 * Uses the __mcp_exec infrastructure's doGet/doPost endpoints
 * Simpler than full exec tool - no sync check, no deployment management
 *
 * @param gasClient - GAS client instance
 * @param scriptId - Script ID to execute on
 * @param js_statement - JavaScript code to execute
 * @param accessToken - Optional access token
 * @param timeoutMs - Optional timeout in milliseconds (default: 30s)
 * @returns Execution result
 */
export async function executeServerCode(
  gasClient: GASClient,
  scriptId: string,
  js_statement: string,
  accessToken?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ServerExecResult> {
  // Set up abort controller for timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Get the execution URL
    const executionUrl = await gasClient.constructGasRunUrl(scriptId, accessToken);

    // Make POST request with JavaScript statement
    const response = await fetch(executionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ func: js_statement }),
      redirect: 'follow',
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        success: false,
        message: `HTTP ${response.status}: ${response.statusText}`,
        error: `Server returned HTTP ${response.status}`
      };
    }

    const data = await response.json();

    // Check if execution was successful
    if (data.success === false || data.error) {
      return {
        success: false,
        message: data.message || data.error || 'Unknown error',
        error: data.error || data.message,
        logger_output: data.logger_output
      };
    }

    return {
      success: true,
      result: data.result,
      logger_output: data.logger_output
    };
  } catch (error: any) {
    clearTimeout(timeout);

    // Handle abort/timeout specifically
    if (error.name === 'AbortError') {
      return {
        success: false,
        message: `Request timed out after ${timeoutMs}ms`,
        error: 'TIMEOUT'
      };
    }

    return {
      success: false,
      message: `Execution failed: ${error.message}`,
      error: error.toString()
    };
  }
}
