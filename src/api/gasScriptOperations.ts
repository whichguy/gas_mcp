/**
 * Script Operations Module
 *
 * This module handles script execution operations for Google Apps Script API:
 * - Execute functions in Apps Script projects
 *
 * Extracted from gasClient.ts for better modularity and maintainability.
 */

import { GASAuthOperations } from './gasAuthOperations.js';
import { ExecutionResponse } from './gasTypes.js';

/**
 * Script Operations class
 * Manages Google Apps Script execution operations
 */
export class GASScriptOperations {
  private authOps: GASAuthOperations;

  constructor(authOps: GASAuthOperations) {
    this.authOps = authOps;
  }

  /**
   * Execute a function in the project
   */
  async executeFunction(scriptId: string, functionName: string, parameters: any[] = [], accessToken?: string): Promise<ExecutionResponse> {
    await this.authOps.initializeClient(accessToken);

    return this.authOps.makeApiCall(async () => {
      const scriptApi = this.authOps.getScriptApi();
      const response = await scriptApi.scripts.run({
        scriptId,
        requestBody: {
          function: functionName,
          parameters,
          devMode: true // Run in development mode
        }
      });

      // Check for top-level error first (happens when script execution fails)
      // Error codes: 10=SCRIPT_TIMEOUT, 3=INVALID_ARGUMENT, 1=CANCELLED
      if (response.data.error) {
        return {
          error: {
            type: response.data.error.code === 10 ? 'SCRIPT_TIMEOUT' :
                  response.data.error.code === 3 ? 'INVALID_ARGUMENT' :
                  response.data.error.code === 1 ? 'CANCELLED' : 'UNKNOWN',
            message: response.data.error.message,
            code: response.data.error.code,
            details: response.data.error.details,
            scriptStackTraceElements: []
          }
        };
      }

      // Handle successful response - result can be array, object, string, number, boolean, null
      if (response.data.response) {
        return {
          result: response.data.response.result,
          error: response.data.response.error
        };
      }

      // Fallback for unexpected response structure
      throw new Error('Unexpected Google Apps Script API response structure: ' + JSON.stringify(response.data));
    }, accessToken);
  }
}
