/**
 * Deployment configuration tool for Google Apps Script
 *
 * Infrastructure-level tool for inspecting raw deployment state or resetting
 * deployment slots. For deploying code to environments, use deploy() instead.
 */

import { BaseTool } from './base.js';
import { GASClient, EntryPointType } from '../api/gasClient.js';
import { ValidationError, GASApiError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { LockManager } from '../utils/lockManager.js';
import { ExecTool } from './execution.js';
import { generateDeployHints, generateDeployErrorHints } from '../utils/deployHints.js';
import { mcpLogger } from '../utils/mcpLogger.js';
import { ENV_TAGS } from '../utils/deployConstants.js';
import {
  findEnvironmentDeployments,
  extractWebAppUrl,
  setDeploymentInConfigManager,
  generateVersionWarnings,
} from '../utils/deployUtils.js';

/**
 * Deployment infrastructure tool — inspect raw state or reset deployment slots
 */
export class DeployConfigTool extends BaseTool {
  public name = 'deploy_config';
  public description = 'Deployment infrastructure — inspect raw deployment state or reset deployment slots. For deploying code, use deploy().';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      operation: { type: 'string', description: 'Operation performed: status or reset' },
      // status fields
      environments: { type: 'object', description: 'Environment details (status): {dev, staging, prod} each with deploymentId, versionNumber, url, updateTime' },
      versionManagement: { type: 'object', description: 'Version stats (status): {totalVersions, highestVersion, prodVersions, warnings}' },
      // reset fields
      status: { type: 'string', description: 'Reset outcome: "success" or "partial"' },
      deployments: { type: 'object', description: 'New deployments (reset): {dev, staging, prod} each with deploymentId, url, versionNumber' },
      message: { type: 'string', description: 'Summary message (reset)' },
      warnings: { type: 'array', description: 'Warning messages (reset partial failures)' },
      configWarning: { type: 'string', description: 'Warning when ConfigManager writes failed (deployment still succeeded)' },
      // common
      hints: { type: 'object', description: 'Context-aware next-step hints' },
    },
  };

  public inputSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['status', 'reset'],
        description: 'status: view raw deployment state for all 3 envs | reset: recreate deployment slots',
      },
      ...SchemaFragments.scriptId,
      ...SchemaFragments.accessToken,
    },
    required: ['operation', 'scriptId'],
    llmGuidance: {
      note: 'Infrastructure only. Use deploy() for all promotion/rollback.',
    },
  };

  public annotations = {
    title: 'Deploy Config',
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  };

  private gasClient: GASClient;
  private execTool: ExecTool;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
    this.execTool = new ExecTool(sessionAuthManager);
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    const scriptId = this.validate.scriptId(params.scriptId, 'deploy_config');
    const operation = this.validate.enum(
      params.operation,
      'operation',
      ['status', 'reset'],
      'deploy_config'
    );

    mcpLogger.info('deploy_config', { event: 'operation_start', operation, scriptId });

    try {
      let result: any;
      switch (operation) {
        case 'status':
          result = await this.handleStatus(scriptId, accessToken);
          break;
        case 'reset':
          result = await this.handleReset(scriptId, accessToken);
          break;
        default:
          throw new ValidationError('operation', operation, 'one of: status, reset');
      }

      // Generate context-aware hints
      const hints = generateDeployHints(
        operation as 'status' | 'reset',
        result
      );
      if (Object.keys(hints).length > 0) {
        result.hints = hints;
      }

      mcpLogger.info('deploy_config', { event: 'operation_complete', operation, scriptId });
      return result;
    } catch (error: any) {
      mcpLogger.error('deploy_config', { event: 'operation_error', operation, scriptId, error: error.message });

      const errorHints = generateDeployErrorHints(operation, error.message);
      const wrappedError = new GASApiError(`Deploy config operation failed: ${error.message}`);
      if (Object.keys(errorHints).length > 0) {
        (wrappedError as any).hints = errorHints;
      }
      throw wrappedError;
    }
  }

  /**
   * Handle status operation — raw deployment state
   */
  private async handleStatus(scriptId: string, accessToken?: string): Promise<any> {
    const deployments = await findEnvironmentDeployments(this.gasClient, scriptId, accessToken);
    const response = await this.gasClient.listVersions(scriptId, 200, undefined, accessToken);
    const versions = response.versions;

    const highestVersion = versions.length > 0
      ? Math.max(...versions.map((v: any) => v.versionNumber))
      : null;

    return {
      operation: 'status',
      environments: {
        dev: deployments.dev ? {
          deploymentId: deployments.dev.deploymentId,
          versionNumber: null,
          description: 'HEAD (latest code)',
          url: extractWebAppUrl(deployments.dev),
          updateTime: deployments.dev.updateTime,
        } : null,
        staging: deployments.staging ? {
          deploymentId: deployments.staging.deploymentId,
          versionNumber: deployments.staging.versionNumber,
          description: deployments.staging.description,
          url: extractWebAppUrl(deployments.staging),
          updateTime: deployments.staging.updateTime,
        } : null,
        prod: deployments.prod ? {
          deploymentId: deployments.prod.deploymentId,
          versionNumber: deployments.prod.versionNumber,
          description: deployments.prod.description,
          url: extractWebAppUrl(deployments.prod),
          updateTime: deployments.prod.updateTime,
        } : null,
      },
      versionManagement: {
        totalVersions: versions.length,
        highestVersion,
        prodVersions: versions.filter((v: any) => v.description?.includes(ENV_TAGS.prod)).length,
        warnings: generateVersionWarnings(versions.length),
      },
    };
  }

  /**
   * Handle reset operation with transactional safety
   */
  private async handleReset(scriptId: string, accessToken?: string): Promise<any> {
    const lockManager = LockManager.getInstance();
    await lockManager.acquireLock(scriptId, 'deploy-config-reset');

    try {
      console.error('🔄 Resetting deployments...');

      // Step 1: List existing deployments (for cleanup later)
      const existingDeployments = await this.gasClient.listDeployments(scriptId, accessToken);

      // Step 2: Create 3 new standard deployments FIRST (before deleting old ones)
      const created: string[] = [];
      const configFailures: string[] = [];
      let devDeployment: any, stagingDeployment: any, prodDeployment: any;
      let devUrl = '', stagingUrl = '', prodUrl = '';

      try {
        devDeployment = await this.gasClient.createDeployment(
          scriptId,
          `${ENV_TAGS.dev} Development environment`,
          { entryPointType: 'WEB_APP' as EntryPointType },
          undefined,
          accessToken
        );
        created.push(devDeployment.deploymentId);
        console.error(`✅ Created dev deployment: ${devDeployment.deploymentId}`);

        stagingDeployment = await this.gasClient.createDeployment(
          scriptId,
          `${ENV_TAGS.staging} Staging environment`,
          { entryPointType: 'WEB_APP' as EntryPointType },
          undefined,
          accessToken
        );
        created.push(stagingDeployment.deploymentId);
        console.error(`✅ Created staging deployment: ${stagingDeployment.deploymentId}`);

        prodDeployment = await this.gasClient.createDeployment(
          scriptId,
          `${ENV_TAGS.prod} Production environment`,
          { entryPointType: 'WEB_APP' as EntryPointType },
          undefined,
          accessToken
        );
        created.push(prodDeployment.deploymentId);
        console.error(`✅ Created prod deployment: ${prodDeployment.deploymentId}`);

        console.error('✅ All 3 standard deployments created successfully');

        // Fetch deployment details to get URLs (with retry for propagation)
        console.error('🔍 Fetching deployment details to extract URLs...');
        try {
          const fetchUrlWithRetry = async (deploymentId: string, envName: string, maxRetries = 3): Promise<string> => {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                if (attempt > 1) {
                  const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                  console.error(`  Retry ${attempt}/${maxRetries} for ${envName} (waiting ${delay}ms)...`);
                  await new Promise(resolve => setTimeout(resolve, delay));
                }
                const details = await this.gasClient.getDeployment(scriptId, deploymentId, accessToken);
                const url = extractWebAppUrl(details);
                if (url) {
                  console.error(`  ✅ ${envName} URL: ${url}`);
                  return url;
                }
                if (attempt < maxRetries) {
                  console.error(`  ⏳ ${envName} URL not ready yet, will retry...`);
                }
              } catch (err: any) {
                console.error(`  ⚠️  Error fetching ${envName} deployment: ${err.message}`);
              }
            }
            console.error(`  ⚠️  ${envName} URL not available after ${maxRetries} attempts`);
            return '';
          };

          devUrl = await fetchUrlWithRetry(devDeployment.deploymentId, 'Dev');
          stagingUrl = await fetchUrlWithRetry(stagingDeployment.deploymentId, 'Staging');
          prodUrl = await fetchUrlWithRetry(prodDeployment.deploymentId, 'Prod');
        } catch (urlError: any) {
          console.error(`⚠️  Failed to fetch deployment URLs: ${urlError.message}`);
        }

        // Store deployment info in ConfigManager
        console.error('💾 Storing deployment info in ConfigManager...');
        for (const [env, deplId, url] of [
          ['dev', devDeployment.deploymentId, devUrl],
          ['staging', stagingDeployment.deploymentId, stagingUrl],
          ['prod', prodDeployment.deploymentId, prodUrl],
        ] as const) {
          try {
            await setDeploymentInConfigManager(this.execTool, scriptId, env, deplId, url, accessToken);
          } catch (configError: any) {
            console.error(`⚠️  Failed to store ${env} deployment info: ${configError.message}`);
            configFailures.push(env);
          }
        }
        if (configFailures.length === 0) {
          console.error('✅ Deployment info stored in ConfigManager');
        }
      } catch (error: any) {
        // Rollback: Delete any deployments we created
        console.error(`❌ Failed to create all deployments: ${error.message}`);
        console.error('🔄 Rolling back newly created deployments...');

        for (const deploymentId of created) {
          try {
            await this.gasClient.deleteDeployment(scriptId, deploymentId, accessToken);
            console.error(`🗑️  Rolled back deployment: ${deploymentId}`);
          } catch (cleanupError: any) {
            console.error(`⚠️  Failed to cleanup deployment ${deploymentId}: ${cleanupError.message}`);
          }
        }

        throw new GASApiError(`Failed to create new deployments: ${error.message}. Rollback completed - project left in original state.`);
      }

      // Step 3: Delete old deployments
      console.error('🗑️  Cleaning up old deployments...');
      const deletionFailures: string[] = [];

      for (const deployment of existingDeployments) {
        try {
          await this.gasClient.deleteDeployment(scriptId, deployment.deploymentId, accessToken);
          console.error(`🗑️  Deleted old deployment: ${deployment.deploymentId}`);
        } catch (deleteError: any) {
          deletionFailures.push(deployment.deploymentId);
          console.error(`⚠️  Failed to delete old deployment ${deployment.deploymentId}: ${deleteError.message}`);
        }
      }

      const resetStatus = deletionFailures.length > 0 ? 'partial' : 'success';
      console.error(resetStatus === 'success'
        ? '✅ Reset complete - 3 standard deployments active'
        : `⚠️  Reset partially complete - ${deletionFailures.length} old deployment(s) could not be deleted`);

      const result: any = {
        operation: 'reset',
        status: resetStatus,
        deployments: {
          dev: { deploymentId: devDeployment.deploymentId, url: devUrl, versionNumber: null },
          staging: { deploymentId: stagingDeployment.deploymentId, url: stagingUrl, versionNumber: null },
          prod: { deploymentId: prodDeployment.deploymentId, url: prodUrl, versionNumber: null },
        },
        message: 'All deployments reset. Three standard deployments created (dev/staging/prod), all pointing to HEAD.',
        ...(configFailures.length > 0 ? {
          configWarning: `ConfigManager write failed for: ${configFailures.join(', ')}. URLs may not be stored.`,
        } : {}),
      };

      if (deletionFailures.length > 0) {
        result.warnings = [
          `Failed to delete ${deletionFailures.length} old deployment(s). Manual cleanup may be required.`,
          `Failed deployment IDs: ${deletionFailures.join(', ')}`,
          `Run deploy_config({operation: "status", scriptId: "${scriptId}"}) to see all deployments`,
        ];
      }

      return result;
    } finally {
      await lockManager.releaseLock(scriptId);
    }
  }
}
