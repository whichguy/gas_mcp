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
import { getSuccessHtmlTemplate, getErrorHtmlTemplate, verifyInfrastructureFile } from '../../project-lifecycle.js';
import { ensureManifestEntryPoints } from '../utilities/manifest-config.js';
import { fileNameMatches } from '../../../api/pathParser.js';
import { InfrastructureStatus, buildInfrastructureStatus } from '../../../types/infrastructureTypes.js';
import { computeGitSha1 } from '../../../utils/hashUtils.js';
import { INFRASTRUCTURE_REGISTRY } from '../../infrastructure-registry.js';
import { mcpLogger } from '../../../utils/mcpLogger.js';

/**
 * Sets up execution infrastructure for a Google Apps Script project
 *
 * This includes:
 * 1. Execution shim (__mcp_exec.js) - Handles code execution and logging
 * 2. HTML templates - Success and error response pages for web UI
 * 3. Manifest configuration - Ensures proper web app entry points
 * 4. HEAD deployment - Creates/updates deployment for immediate execution
 *
 * @param gasClient GAS API client instance
 * @param scriptId Script project ID
 * @param accessToken OAuth access token
 * @param sessionAuthManager Optional session manager for caching deployment URLs
 * @returns InfrastructureStatus with verification results for exec response
 */
export async function setupInfrastructure(
  gasClient: GASClient,
  scriptId: string,
  accessToken: string,
  sessionAuthManager?: SessionAuthManager,
  existingRemoteFiles?: GASFile[]
): Promise<InfrastructureStatus> {
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

  // Track infrastructure verification status for response
  let infrastructureVerification: { verified: boolean; expectedSHA?: string; actualSHA?: string; error?: string } = {
    verified: true // Assume success unless verification fails
  };
  let shimWasCreated = false;

  // Check if shim, require module, and HTML templates exist
  let shimExists = false;
  let requireExists = false;
  let htmlTemplatesExist = false;
  let existingFiles: GASFile[] | null = existingRemoteFiles ?? null;
  try {
    if (!existingFiles) {
      console.error('Checking if execution shim and HTML templates exist...');
      existingFiles = await withTimeout(
        gasClient.getProjectContent(scriptId, accessToken),
        15000, // 15-second timeout
        'Get project content'
      );
    } else {
      console.error('Using pre-fetched remoteFiles for infrastructure check (skipping API call)');
    }
    shimExists = existingFiles.some((file: GASFile) => fileNameMatches(file.name, 'common-js/__mcp_exec'));
    requireExists = existingFiles.some((file: GASFile) => fileNameMatches(file.name, 'common-js/require'));
    const hasSuccessHtml = existingFiles.some((file: GASFile) => fileNameMatches(file.name, 'common-js/__mcp_exec_success'));
    const hasErrorHtml = existingFiles.some((file: GASFile) => fileNameMatches(file.name, 'common-js/__mcp_exec_error'));
    htmlTemplatesExist = hasSuccessHtml && hasErrorHtml;
    console.error(`Shim exists: ${shimExists}, Require module exists: ${requireExists}, HTML templates exist: ${htmlTemplatesExist}`);
  } catch (error: any) {
    if (error.message?.includes('timeout')) {
      console.error(`Timeout checking for shim: ${error.message}`);
      throw new Error(`Setup failed: Unable to check project files - ${error.message}`);
    }
    // Assume shim doesn't exist if we can't check
    mcpLogger.warning('exec', { message: 'Could not check for existing shim, assuming it does not exist' });
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

    const shimFile = shimCode.files.find((file: GASFile) => fileNameMatches(file.name, 'common-js/__mcp_exec'));
    if (!shimFile?.source) {
      throw new Error('Failed to generate execution shim code');
    }

    try {
      await withTimeout(
        gasClient.updateFile(scriptId, 'common-js/__mcp_exec', shimFile.source, 0, accessToken),
        20000, // 20-second timeout for file upload
        'Update shim file'
      );
      console.error('Execution shim created successfully');
      shimWasCreated = true;
      SessionAuthManager.invalidateInfrastructure(scriptId);

      // BEST-EFFORT SHA VERIFICATION: Verify after creation (warn but don't block execution)
      console.error('🔍 [GAS_RUN] Verifying execution infrastructure integrity (best-effort)...');
      try {
        const verification = await verifyInfrastructureFile(
          scriptId,
          'common-js/__mcp_exec',
          sessionAuthManager,
          accessToken
        );

        // Capture verification result for response
        infrastructureVerification = verification;

        if (verification.verified) {
          console.error(`✅ [GAS_RUN] Execution infrastructure verified (SHA: ${verification.actualSHA})`);
        } else {
          // WARNING ONLY - don't block execution
          console.error(`⚠️  [GAS_RUN] Execution infrastructure SHA mismatch (non-blocking warning):`);
          console.error(`   - Expected SHA: ${verification.expectedSHA}`);
          console.error(`   - Actual SHA: ${verification.actualSHA}`);
          console.error(`   - Error: ${verification.error || 'SHA mismatch detected'}`);
          console.error(`   ℹ️  Execution will continue - this is informational only`);
        }
      } catch (verifyError: any) {
        // BEST-EFFORT: Log but don't fail
        console.error(`⚠️  [GAS_RUN] Infrastructure verification failed (non-blocking): ${verifyError.message}`);
        console.error(`   ℹ️  Execution will continue - verification is best-effort only`);
        infrastructureVerification = { verified: false, error: verifyError.message };
      }
    } catch (error: any) {
      if (error.message?.includes('timeout')) {
        throw new Error(`Setup failed: Unable to create execution shim - ${error.message}`);
      }
      throw error;
    }
  } else {
    // SHA-GATED VERIFICATION: Use in-memory SHA from remoteFiles when available, avoid API call
    console.error('🔍 [GAS_RUN] Verifying existing execution infrastructure...');
    const shimFile = existingFiles?.find((f: GASFile) => fileNameMatches(f.name, 'common-js/__mcp_exec'));
    const expectedSHA = INFRASTRUCTURE_REGISTRY['common-js/__mcp_exec.gs'].computeSHA();

    if (shimFile && shimFile.source) {
      const remoteSHA = computeGitSha1(shimFile.source);
      infrastructureVerification = {
        verified: remoteSHA === expectedSHA,
        expectedSHA,
        actualSHA: remoteSHA
      };

      if (remoteSHA === expectedSHA) {
        console.error(`✅ [GAS_RUN] Execution infrastructure verified via in-memory SHA (${remoteSHA.substring(0, 8)}...)`);

        // SHA-gated short-circuit: shim verified + HTML present + require module present → skip manifest & HEAD deployment
        if (htmlTemplatesExist && requireExists) {
          console.error(`⚡ [SHA SHORT-CIRCUIT] Shim verified + HTML present — skipping manifest & HEAD deployment`);

          // Cache the deployment URL and return early
          try {
            const gasRunUrl = await withTimeout(
              gasClient.constructGasRunUrl(scriptId, accessToken),
              10000,
              'Construct gas run URL'
            );
            if (sessionAuthManager && gasRunUrl) {
              await sessionAuthManager.setCachedDeploymentUrl(scriptId, gasRunUrl);
            }
          } catch (urlError: any) {
            mcpLogger.warning('exec', { message: `URL construction failed during short-circuit: ${urlError.message}` });
          }

          // Cache infrastructure as verified
          SessionAuthManager.setInfrastructureVerified(scriptId, {
            execShimSHA: remoteSHA,
            timestamp: Date.now()
          });

          return buildInfrastructureStatus(infrastructureVerification, shimWasCreated);
        }
      } else {
        // SHA mismatch — auto-repair: re-deploy the shim with correct content
        console.error(`⚠️  [GAS_RUN] Execution infrastructure SHA mismatch — auto-repairing:`);
        console.error(`   - Expected SHA: ${expectedSHA.substring(0, 8)}...`);
        console.error(`   - Actual SHA: ${remoteSHA.substring(0, 8)}...`);

        const shimCode = CodeGenerator.generateProjectFiles({
          type: 'head_deployment',
          timezone: 'America/Los_Angeles',
          includeTestFunctions: true,
          mcpVersion: '1.0.0'
        });
        const newShimFile = shimCode.files.find((file: GASFile) => fileNameMatches(file.name, 'common-js/__mcp_exec'));
        if (newShimFile?.source) {
          try {
            await withTimeout(
              gasClient.updateFile(scriptId, 'common-js/__mcp_exec', newShimFile.source, 0, accessToken),
              20000,
              'Auto-repair stale shim'
            );
            console.error('✅ [GAS_RUN] Stale shim auto-repaired successfully');
            shimWasCreated = true;
            SessionAuthManager.invalidateInfrastructure(scriptId);
            infrastructureVerification = { verified: true, expectedSHA, actualSHA: expectedSHA };
          } catch (repairError: any) {
            mcpLogger.warning('exec', { message: `Auto-repair failed: ${repairError.message} — continuing with stale shim` });
          }
        }
      }
    } else {
      // Fallback to API-based verification if remoteFiles didn't have the shim
      try {
        const verification = await verifyInfrastructureFile(
          scriptId,
          'common-js/__mcp_exec',
          sessionAuthManager,
          accessToken
        );
        infrastructureVerification = verification;
        if (verification.verified) {
          console.error(`✅ [GAS_RUN] Execution infrastructure verified via API (SHA: ${verification.actualSHA})`);
        } else {
          console.error(`⚠️  [GAS_RUN] SHA mismatch via API (non-blocking): expected=${verification.expectedSHA}, actual=${verification.actualSHA}`);
        }
      } catch (verifyError: any) {
        console.error(`⚠️  [GAS_RUN] Infrastructure verification failed (non-blocking): ${verifyError.message}`);
        infrastructureVerification = { verified: false, error: verifyError.message };
      }
    }
  }

  // Install CommonJS require module if missing (required by __mcp_exec for __defineModule__)
  // This handles thin-shim consumers that reference the CommonJS system via a library
  // rather than having require.gs directly in their project files.
  if (!requireExists) {
    console.error('Installing CommonJS require module (required by __mcp_exec)...');
    const requireGeneratedFiles = CodeGenerator.generateProjectFiles({
      type: 'head_deployment',
      timezone: 'America/Los_Angeles',
      includeTestFunctions: true,
      mcpVersion: '1.0.0'
    });
    const requireFile = requireGeneratedFiles.files.find((file: GASFile) => fileNameMatches(file.name, 'common-js/require'));
    if (requireFile?.source) {
      try {
        await withTimeout(
          gasClient.updateFile(scriptId, 'common-js/require', requireFile.source, 0, accessToken),
          20000,
          'Install CommonJS require module'
        );
        console.error('CommonJS require module installed successfully');
      } catch (error: any) {
        mcpLogger.warning('exec', { message: `CommonJS require module installation failed: ${error.message}` });
      }
    }
  }

  // Deploy HTML templates if missing (independent of shim existence)
  if (!htmlTemplatesExist) {
    console.error('Deploying HTML templates...');
    try {
      const successHtml = getSuccessHtmlTemplate();
      await withTimeout(
        gasClient.updateFile(scriptId, 'common-js/__mcp_exec_success', successHtml, 0, accessToken, 'HTML'),
        20000,
        'Update success HTML template'
      );
      console.error('Success HTML template deployed');

      const errorHtml = getErrorHtmlTemplate();
      await withTimeout(
        gasClient.updateFile(scriptId, 'common-js/__mcp_exec_error', errorHtml, 0, accessToken, 'HTML'),
        20000,
        'Update error HTML template'
      );
      console.error('Error HTML template deployed');
    } catch (error: any) {
      mcpLogger.warning('exec', { message: `HTML template deployment failed: ${error.message} - IDE interface may not work properly` });
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
      mcpLogger.warning('exec', { message: `Manifest update timeout: ${error.message} - continuing anyway` });
    } else {
      mcpLogger.warning('exec', { message: `Manifest update failed: ${error.message} - continuing anyway` });
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
      mcpLogger.warning('exec', { message: `URL construction timeout: ${error.message} - continuing anyway` });
    } else {
      mcpLogger.warning('exec', { message: `URL construction failed: ${error.message} - continuing anyway` });
    }
  }

  console.error('Infrastructure setup completed');

  // Return infrastructure status for inclusion in exec response
  return buildInfrastructureStatus(infrastructureVerification, shimWasCreated);
}
