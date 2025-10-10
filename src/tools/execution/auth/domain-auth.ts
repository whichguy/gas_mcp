/**
 * Domain Authorization for Cookie-Based Authentication
 *
 * Handles browser-based domain authorization flow for Google Apps Script web apps
 * restricted to specific domains (DOMAIN access level).
 *
 * Flow:
 * 1. Test web app URL for authorization status
 * 2. If unauthorized, launch browser for user consent
 * 3. Poll for authorization completion
 * 4. Return when domain is authorized
 */

import { GASClient } from '../../../api/gasClient.js';
import open from 'open';

/**
 * Initiates and completes domain authorization for a script
 *
 * Tests if the script web app requires cookie-based domain authorization.
 * If required, launches browser for user consent and polls for completion.
 *
 * @param gasClient GAS API client instance
 * @param scriptId Script project ID
 * @param accessToken OAuth access token
 */
export async function performDomainAuth(
  gasClient: GASClient,
  scriptId: string,
  accessToken: string
): Promise<void> {
  console.error(`[GAS_RUN_AUTH] Starting domain authorization for script: ${scriptId}`);

  try {
    // Get the base deployment URL
    const baseUrl = await gasClient.constructGasRunUrl(scriptId, accessToken);

    // Ensure it ends with /dev for the test request
    const testUrl = baseUrl.replace('/exec', '/dev');

    console.error(`[GAS_RUN_AUTH] Testing domain authorization with URL: ${testUrl}`);

    // Make a test request without any func parameter
    const response = await fetch(testUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'MCP-GAS-Server/1.0.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      redirect: 'follow'
    });

    const contentType = response.headers.get('content-type') || '';

    console.error(`[GAS_RUN_AUTH] Test response: HTTP ${response.status}, Content-Type: ${contentType}`);

    // Check if we need cookie authentication
    if ((response.status === 302 || response.status === 200) && !contentType.includes('application/json')) {
      console.error(`[GAS_RUN_AUTH] Cookie authentication required - launching browser and polling`);

      const authInfo = {
        httpStatus: `HTTP ${response.status} ${response.statusText}`,
        finalUrl: response.url,
        contentType: contentType,
        authAction: 'Launching browser for domain authorization',
        pollingStrategy: 'Will poll for JSON response with test function'
      };

      console.error(`[GAS_RUN_AUTH] Browser authentication details:\n${JSON.stringify(authInfo, null, 2)}`);

      // Create browser URL with auth IDE action (shows IDE interface after auth)
      const browserUrl = `${response.url}${response.url.includes('?') ? '&' : '?'}_mcp_run=true&action=auth_ide`;

      // Launch browser with the auth IDE URL
      console.error(`[GAS_RUN_AUTH] Opening browser for domain authorization: ${browserUrl}`);
      await open(browserUrl);

      // Poll for successful authorization
      await pollForDomainAuthorization(testUrl, accessToken);

    } else if (response.status === 200 && contentType.includes('application/json')) {
      console.error(`[GAS_RUN_AUTH] Domain already authorized - JSON response received`);
    } else {
      console.error(`[GAS_RUN_AUTH] Unexpected response: HTTP ${response.status}, continuing anyway`);
    }

  } catch (error: any) {
    console.error(`[GAS_RUN_AUTH] Domain authorization test failed: ${error.message}`);
    throw new Error(`Domain authorization failed: ${error.message}`);
  }
}

/**
 * Poll for domain authorization completion using action=auth_check
 * Makes requests to /dev?action=auth_check&format=json until authorized status received
 * Browser uses action=auth_ide to show IDE interface after auth
 *
 * @param baseUrl Base web app URL (ends with /dev)
 * @param accessToken OAuth access token
 */
async function pollForDomainAuthorization(baseUrl: string, accessToken: string): Promise<void> {
  const maxPollDuration = 60000; // 60 seconds total
  const pollInterval = 3000; // 3 seconds between polls
  const startTime = Date.now();

  // Poll with lightweight auth check action (no execution)
  const testUrl = `${baseUrl}?_mcp_run=true&action=auth_check&format=json`;

  console.error(`[DOMAIN_AUTH_POLL] Starting authorization polling`);
  console.error(`   Test URL: ${baseUrl}?action=auth_check&format=json`);
  console.error(`   Max duration: ${maxPollDuration}ms`);
  console.error(`   Poll interval: ${pollInterval}ms`);

  let pollCount = 0;

  while (Date.now() - startTime < maxPollDuration) {
    pollCount++;
    const elapsedTime = Date.now() - startTime;

    try {
      console.error(`[DOMAIN_AUTH_POLL] Poll #${pollCount} (${elapsedTime}ms elapsed)`);

      const pollResponse = await fetch(testUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'MCP-GAS-Server/1.0.0',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        redirect: 'follow'
      });

      const pollContentType = pollResponse.headers.get('content-type') || '';

      console.error(`[DOMAIN_AUTH_POLL] Poll #${pollCount} response: HTTP ${pollResponse.status}, Content-Type: ${pollContentType}`);

      // Check for successful JSON response
      if (pollResponse.status === 200 && pollContentType.includes('application/json')) {
        try {
          const pollResult = await pollResponse.json();

          // Check for authorized status from auth_check action
          if (pollResult.status === 'authorized') {
            console.error(`[DOMAIN_AUTH_POLL] Success! Domain authorization completed in ${elapsedTime}ms`);
            console.error(`   Poll result: ${JSON.stringify(pollResult)}`);
            return;
          } else {
            console.error(`[DOMAIN_AUTH_POLL] Got JSON but unexpected result: ${JSON.stringify(pollResult)}`);
          }
        } catch (jsonError) {
          console.error(`[DOMAIN_AUTH_POLL] Failed to parse JSON response: ${jsonError}`);
        }
      } else if (pollResponse.status === 200) {
        // Got 200 but not JSON - still need auth
        console.error(`[DOMAIN_AUTH_POLL] HTTP 200 but non-JSON (${pollContentType}) - auth still needed`);
      } else if (pollResponse.status === 302) {
        // Still getting redirects - auth not complete
        console.error(`[DOMAIN_AUTH_POLL] HTTP 302 redirect - auth still needed`);
      } else {
        // Other status codes
        console.error(`[DOMAIN_AUTH_POLL] HTTP ${pollResponse.status} - continuing to poll`);
      }

    } catch (pollError: any) {
      console.error(`[DOMAIN_AUTH_POLL] Poll #${pollCount} failed: ${pollError.message}`);
    }

    // Wait before next poll (unless we're close to timeout)
    if (Date.now() - startTime + pollInterval < maxPollDuration) {
      console.error(`[DOMAIN_AUTH_POLL] Waiting ${pollInterval}ms before next poll...`);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  // Timeout reached
  const finalElapsedTime = Date.now() - startTime;
  console.error(`[DOMAIN_AUTH_POLL] Timeout reached after ${finalElapsedTime}ms (${pollCount} polls)`);
  throw new Error(`Domain authorization timeout: No successful JSON response after ${finalElapsedTime}ms and ${pollCount} polling attempts`);
}
