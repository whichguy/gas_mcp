/**
 * Infrastructure Setup Manager
 *
 * Manages Google Apps Script project infrastructure setup for code execution:
 * - Execution shim deployment
 * - HTML templates (success/error pages)
 * - Manifest configuration
 * - HEAD deployment creation
 */

import { GASClient, GASFile } from '../../../api/gasClient.js';
import { SessionAuthManager } from '../../../auth/sessionManager.js';
import { CodeGenerator } from '../../../utils/codeGeneration.js';
import { getSuccessHtmlTemplate, getErrorHtmlTemplate } from '../../deployments.js';
import { ensureManifestEntryPoints } from '../utilities/manifest-config.js';

/**
 * Sets up execution infrastructure for a Google Apps Script project
 *
 * This includes:
 * 1. Execution shim (__mcp_gas_run.js) - Handles code execution and logging
 * 2. HTML templates - Success and error response pages for web UI
 * 3. Manifest configuration - Ensures proper web app entry points
 * 4. HEAD deployment - Creates/updates deployment for immediate execution
 *
 * @param gasClient GAS API client instance
 * @param scriptId Script project ID
 * @param accessToken OAuth access token
 * @param sessionAuthManager Optional session manager for caching deployment URLs
 */
export async function setupInfrastructure(
  gasClient: GASClient,
  scriptId: string,
  accessToken: string,
  sessionAuthManager?: SessionAuthManager
): Promise<void> {
  // HANGING FIX: Add timeout wrapper for all Google API calls
  const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number, operationName: string): Promise<T> => {
    return Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`${operationName} timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  };

  // Check if shim and HTML templates exist
  let shimExists = false;
  let htmlTemplatesExist = false;
  try {
    console.error('Checking if execution shim and HTML templates exist...');
    const existingFiles = await withTimeout(
      gasClient.getProjectContent(scriptId, accessToken),
      15000, // 15-second timeout
      'Get project content'
    );
    shimExists = existingFiles.some((file: GASFile) => file.name === '__mcp_gas_run');
    const hasSuccessHtml = existingFiles.some((file: GASFile) => file.name === '__mcp_gas_run_success');
    const hasErrorHtml = existingFiles.some((file: GASFile) => file.name === '__mcp_gas_run_error');
    htmlTemplatesExist = hasSuccessHtml && hasErrorHtml;
    console.error(`Shim exists: ${shimExists}, HTML templates exist: ${htmlTemplatesExist}`);
  } catch (error: any) {
    if (error.message?.includes('timeout')) {
      console.error(`Timeout checking for shim: ${error.message}`);
      throw new Error(`Setup failed: Unable to check project files - ${error.message}`);
    }
    // Assume shim doesn't exist if we can't check
    console.warn('Could not check for existing shim, assuming it does not exist');
  }

  // Add execution shim if needed
  if (!shimExists) {
    console.error('Creating execution shim...');
    const shimCode = CodeGenerator.generateProjectFiles({
      type: 'head_deployment',
      timezone: 'America/Los_Angeles',
      includeTestFunctions: true,
      mcpVersion: '1.0.0'
    });

    const shimFile = shimCode.files.find((file: GASFile) => file.name === '__mcp_gas_run');
    if (!shimFile?.source) {
      throw new Error('Failed to generate execution shim code');
    }

    try {
      await withTimeout(
        gasClient.updateFile(scriptId, '__mcp_gas_run', shimFile.source, 0, accessToken),
        20000, // 20-second timeout for file upload
        'Update shim file'
      );
      console.error('Execution shim created successfully');
    } catch (error: any) {
      if (error.message?.includes('timeout')) {
        throw new Error(`Setup failed: Unable to create execution shim - ${error.message}`);
      }
      throw error;
    }
  }

  // Deploy HTML templates if missing (independent of shim existence)
  if (!htmlTemplatesExist) {
    console.error('Deploying HTML templates...');
    try {
      const successHtml = getSuccessHtmlTemplate();
      await withTimeout(
        gasClient.updateFile(scriptId, '__mcp_gas_run_success', successHtml, 0, accessToken, 'HTML'),
        20000,
        'Update success HTML template'
      );
      console.error('Success HTML template deployed');

      const errorHtml = getErrorHtmlTemplate();
      await withTimeout(
        gasClient.updateFile(scriptId, '__mcp_gas_run_error', errorHtml, 0, accessToken, 'HTML'),
        20000,
        'Update error HTML template'
      );
      console.error('Error HTML template deployed');
    } catch (error: any) {
      console.warn(`HTML template deployment failed: ${error.message} - IDE interface may not work properly`);
      // Don't fail the whole setup if HTML templates fail - they're not critical for basic execution
    }
  } else {
    console.error('HTML templates already exist, skipping deployment');
  }

  // Update manifest
  console.error('Updating manifest entry points...');
  try {
    await withTimeout(
      ensureManifestEntryPoints(gasClient, scriptId, 'WEB_APP', 'MYSELF', accessToken),
      10000, // 10-second timeout
      'Update manifest entry points'
    );
    console.error('Manifest updated successfully');
  } catch (error: any) {
    if (error.message?.includes('timeout')) {
      console.warn(`Manifest update timeout: ${error.message} - continuing anyway`);
    } else {
      console.warn(`Manifest update failed: ${error.message} - continuing anyway`);
    }
  }

  // Brief wait for processing
  await new Promise(resolve => setTimeout(resolve, 500));

  // Create HEAD deployment
  console.error('Creating HEAD deployment...');
  const deploymentOptions = {
    entryPointType: 'WEB_APP' as const,
    webAppConfig: {
      access: 'MYSELF' as const,
      executeAs: 'USER_ACCESSING' as const
    }
  };

  try {
    await withTimeout(
      gasClient.ensureHeadDeployment(
        scriptId,
        'HEAD deployment for testing',
        deploymentOptions,
        accessToken
      ),
      30000, // 30-second timeout for deployment
      'Create HEAD deployment'
    );
    console.error('HEAD deployment created successfully');
  } catch (error: any) {
    if (error.message?.includes('timeout')) {
      throw new Error(`Setup failed: Unable to create deployment - ${error.message}`);
    }
    throw error;
  }

  // Cache the deployment URL
  console.error('Constructing deployment URL...');
  try {
    const gasRunUrl = await withTimeout(
      gasClient.constructGasRunUrl(scriptId, accessToken),
      10000, // 10-second timeout
      'Construct gas run URL'
    );

    if (sessionAuthManager && gasRunUrl) {
      await sessionAuthManager.setCachedDeploymentUrl(scriptId, gasRunUrl);
      console.error('Deployment URL cached successfully');
    }
  } catch (error: any) {
    if (error.message?.includes('timeout')) {
      console.warn(`URL construction timeout: ${error.message} - continuing anyway`);
    } else {
      console.warn(`URL construction failed: ${error.message} - continuing anyway`);
    }
  }

  console.error('Infrastructure setup completed');
}
