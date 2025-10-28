/**
 * Consolidated deployment management tool for Google Apps Script
 * Manages deployments across dev/staging/prod environments with version control
 */

import { BaseTool } from './base.js';
import { GASClient, EntryPointType, WebAppAccess, GASDeployment } from '../api/gasClient.js';
import { ValidationError, GASApiError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { ExecTool } from './execution.js';

/**
 * Environment tags for deployment identification
 */
const ENV_TAGS = {
  dev: '[DEV]',
  staging: '[STAGING]',
  prod: '[PROD]'
} as const;

/**
 * Consolidated deployment tool with environment-aware management
 */
export class DeployTool extends BaseTool {
  public name = 'deploy';
  public description = 'Manage deployments across dev/staging/prod environments with version control and promotion workflow';

  public inputSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['promote', 'rollback', 'status', 'reset'],
        description: 'Operation: promote=move code, rollback=revert, status=view all, reset=recreate 3 deployments.',
        llmHints: {
          promote: 'dev→staging (create version) | staging→prod (update deployment)',
          rollback: 'Revert to previous tagged version',
          status: 'View all 3 environments',
          reset: 'Recreate dev/staging/prod'
        }
      },
      environment: {
        type: 'string',
        enum: ['staging', 'prod'],
        description: 'Target env for promote/rollback. Both support rollback to previous version.',
        llmHints: {
          staging: 'Promote: HEAD→version | Rollback: previous version',
          prod: 'Promote: staging→prod | Rollback: previous version'
        }
      },
      description: {
        type: 'string',
        description: 'Version description (required for promote to staging). Auto-tagged [STAGING].',
        examples: ['v1.0 Release Candidate', 'Bug fixes for issue #123', 'New feature: user management']
      },
      toVersion: {
        type: 'number',
        description: 'Version for rollback (optional). If omitted, auto-finds previous tagged version.',
        minimum: 1
      },
      ...SchemaFragments.scriptId,
      ...SchemaFragments.accessToken
    },
    required: ['operation', 'scriptId'],
    llmGuidance: {
      workflow: 'dev (HEAD) → promote → staging (versioned) → promote → prod (versioned)',
      environments: 'dev: HEAD | staging: snapshot | prod: stable'
    }
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
    const scriptId = this.validate.scriptId(params.scriptId, 'deployment operation');
    const operation = this.validate.enum(
      params.operation,
      'operation',
      ['promote', 'rollback', 'status', 'reset'],
      'deployment operation'
    );

    try {
      switch (operation) {
        case 'promote':
          return await this.handlePromote(scriptId, params, accessToken);
        case 'rollback':
          return await this.handleRollback(scriptId, params, accessToken);
        case 'status':
          return await this.handleStatus(scriptId, accessToken);
        case 'reset':
          return await this.handleReset(scriptId, accessToken);
        default:
          throw new ValidationError('operation', operation, 'one of: promote, rollback, status, reset');
      }
    } catch (error: any) {
      throw new GASApiError(`Deployment operation failed: ${error.message}`);
    }
  }

  /**
   * Handle promote operation (dev→staging or staging→prod)
   */
  private async handlePromote(scriptId: string, params: any, accessToken?: string): Promise<any> {
    const environment = this.validate.enum(
      params.environment,
      'environment',
      ['staging', 'prod'],
      'promote operation'
    );

    const deployments = await this.findEnvironmentDeployments(scriptId, accessToken);

    if (environment === 'staging') {
      // Promote dev→staging: Create version from HEAD and update staging deployment
      if (!params.description) {
        throw new ValidationError('description', undefined, 'non-empty string when promoting to staging');
      }

      const description = this.validate.string(params.description, 'description', 'promote operation');
      const taggedDescription = `${ENV_TAGS.staging} ${description}`;

      // Step 1: Create version from HEAD
      const version = await this.gasClient.createVersion(scriptId, taggedDescription, accessToken);
      console.error(`✅ Created version ${version.versionNumber}: ${taggedDescription}`);

      // Step 2: Update staging deployment to new version
      if (!deployments.staging) {
        throw new ValidationError('staging_deployment', 'not found', 'existing staging deployment - run deploy({operation: "reset"}) to create deployments');
      }

      await this.gasClient.updateDeployment(
        scriptId,
        deployments.staging.deploymentId,
        {
          versionNumber: version.versionNumber,
          description: `${ENV_TAGS.staging} ${description} (v${version.versionNumber})`
        },
        accessToken
      );

      console.error(`✅ Deployment update requested for staging → v${version.versionNumber}`);

      // Verify deployment update propagated with polling
      const updatedStaging = await this.verifyDeploymentUpdate(
        scriptId,
        deployments.staging.deploymentId,
        version.versionNumber,
        'staging',
        accessToken
      );
      const stagingUrl = this.extractWebAppUrl(updatedStaging);

      // Store in ConfigManager
      if (stagingUrl) {
        try {
          await this.setDeploymentInConfigManager(
            scriptId,
            'staging',
            deployments.staging.deploymentId,
            stagingUrl,
            accessToken
          );
          console.error('✅ Updated staging URL in ConfigManager');
        } catch (configError: any) {
          console.error(`⚠️  Failed to update ConfigManager: ${configError.message}`);
        }
      }

      return {
        operation: 'promote',
        from: 'dev',
        to: 'staging',
        version: {
          versionNumber: version.versionNumber,
          description: taggedDescription,
          createTime: version.createTime
        },
        deployment: {
          deploymentId: deployments.staging.deploymentId,
          versionNumber: version.versionNumber,
          url: stagingUrl
        }
      };

    } else {
      // Promote staging→prod: Update prod to staging version
      if (!deployments.staging) {
        throw new ValidationError('staging_deployment', 'not found', 'existing staging deployment - run deploy({operation: "reset"}) to create deployments');
      }

      if (!deployments.prod) {
        throw new ValidationError('prod_deployment', 'not found', 'existing prod deployment - run deploy({operation: "reset"}) to create deployments');
      }

      // Get staging version
      const stagingVersion = deployments.staging.versionNumber;
      if (!stagingVersion) {
        throw new ValidationError('staging_version', 'HEAD (null)', 'versioned deployment - promote dev→staging first to create a version');
      }

      // Update prod deployment to staging version
      await this.gasClient.updateDeployment(
        scriptId,
        deployments.prod.deploymentId,
        {
          versionNumber: stagingVersion,
          description: `${ENV_TAGS.prod} v${stagingVersion} (promoted from staging)`
        },
        accessToken
      );

      console.error(`✅ Deployment update requested for prod → v${stagingVersion}`);

      // Verify deployment update propagated with polling
      const updatedProd = await this.verifyDeploymentUpdate(
        scriptId,
        deployments.prod.deploymentId,
        stagingVersion,
        'prod',
        accessToken
      );
      const prodUrl = this.extractWebAppUrl(updatedProd);

      // Store in ConfigManager
      if (prodUrl) {
        try {
          await this.setDeploymentInConfigManager(
            scriptId,
            'prod',
            deployments.prod.deploymentId,
            prodUrl,
            accessToken
          );
          console.error('✅ Updated prod URL in ConfigManager');
        } catch (configError: any) {
          console.error(`⚠️  Failed to update ConfigManager: ${configError.message}`);
        }
      }

      // Get version details
      const version = await this.gasClient.getVersion(scriptId, stagingVersion, accessToken);

      return {
        operation: 'promote',
        from: 'staging',
        to: 'prod',
        version: {
          versionNumber: stagingVersion,
          description: version.description,
          createTime: version.createTime
        },
        deployment: {
          deploymentId: deployments.prod.deploymentId,
          versionNumber: stagingVersion,
          url: prodUrl
        },
        note: 'Staging and prod now serve the same version'
      };
    }
  }

  /**
   * Handle rollback operation (staging or prod)
   * Rolls back to previous tagged version (cannot rollback FROM HEAD)
   */
  private async handleRollback(scriptId: string, params: any, accessToken?: string): Promise<any> {
    // Validate environment is provided
    if (!params.environment) {
      throw new ValidationError('environment', undefined, '"staging" or "prod" (rollback requires environment)');
    }

    const environment = this.validate.enum(
      params.environment,
      'environment',
      ['staging', 'prod'],
      'rollback operation'
    );

    const deployments = await this.findEnvironmentDeployments(scriptId, accessToken);
    const envTag = environment === 'staging' ? ENV_TAGS.staging : ENV_TAGS.prod;
    const deployment = deployments[environment];

    // Validate deployment exists
    if (!deployment) {
      throw new ValidationError(
        `${environment}_deployment`,
        'not found',
        `existing ${environment} deployment - run deploy({operation: "reset"}) to create deployments`
      );
    }

    // Validate not at HEAD (cannot rollback from HEAD)
    const currentVersion = deployment.versionNumber;
    if (!currentVersion) {
      throw new ValidationError(
        `${environment}_version`,
        'HEAD (null)',
        `versioned ${environment} deployment - cannot rollback from HEAD`
      );
    }

    let targetVersion: number;

    if (params.toVersion) {
      // Manual version specification
      targetVersion = this.validate.number(params.toVersion, 'toVersion', 'rollback operation', 1);
    } else {
      // Auto-find previous tagged version for this environment
      const response = await this.gasClient.listVersions(scriptId, 200, undefined, accessToken);
      const versions = response.versions;
      const envVersions = versions
        .filter((v: any) => v.description?.includes(envTag))
        .sort((a: any, b: any) => b.versionNumber - a.versionNumber);

      const currentIndex = envVersions.findIndex((v: any) => v.versionNumber === currentVersion);

      // Check if current version is in the tagged history
      if (currentIndex === -1) {
        throw new ValidationError(
          `current_${environment}_version`,
          `v${currentVersion}`,
          `${envTag} tagged version (current v${currentVersion} not found in ${environment} version history - may have been manually changed)`
        );
      }

      // Check if there's a previous version to roll back to
      if (currentIndex === envVersions.length - 1) {
        throw new ValidationError(
          `previous_${environment}_version`,
          'none available',
          `at least 2 ${envTag} tagged versions to enable rollback (only found v${currentVersion})`
        );
      }

      targetVersion = envVersions[currentIndex + 1].versionNumber;
    }

    // Update deployment to target version
    await this.gasClient.updateDeployment(
      scriptId,
      deployment.deploymentId,
      {
        versionNumber: targetVersion,
        description: `${envTag} v${targetVersion} (rolled back from v${currentVersion})`
      },
      accessToken
    );

    console.error(`✅ Rolled back ${environment} from v${currentVersion} to v${targetVersion}`);

    const version = await this.gasClient.getVersion(scriptId, targetVersion, accessToken);

    return {
      operation: 'rollback',
      environment: environment,
      from: {
        versionNumber: currentVersion
      },
      to: {
        versionNumber: targetVersion,
        description: version.description,
        createTime: version.createTime
      },
      deployment: {
        deploymentId: deployment.deploymentId,
        versionNumber: targetVersion,
        url: this.extractWebAppUrl(deployment)
      }
    };
  }

  /**
   * Handle status operation
   */
  private async handleStatus(scriptId: string, accessToken?: string): Promise<any> {
    const deployments = await this.findEnvironmentDeployments(scriptId, accessToken);
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
          url: this.extractWebAppUrl(deployments.dev),
          updateTime: deployments.dev.updateTime
        } : null,
        staging: deployments.staging ? {
          deploymentId: deployments.staging.deploymentId,
          versionNumber: deployments.staging.versionNumber,
          description: deployments.staging.description,
          url: this.extractWebAppUrl(deployments.staging),
          updateTime: deployments.staging.updateTime,
          canPromoteToProd: deployments.staging.versionNumber !== null &&
            deployments.staging.versionNumber !== deployments.prod?.versionNumber
        } : null,
        prod: deployments.prod ? {
          deploymentId: deployments.prod.deploymentId,
          versionNumber: deployments.prod.versionNumber,
          description: deployments.prod.description,
          url: this.extractWebAppUrl(deployments.prod),
          updateTime: deployments.prod.updateTime,
          isSynced: deployments.prod.versionNumber === highestVersion,
          stagingAvailable: deployments.staging?.versionNumber !== deployments.prod.versionNumber
        } : null
      },
      versionManagement: {
        totalVersions: versions.length,
        highestVersion,
        prodVersions: versions.filter((v: any) => v.description?.includes(ENV_TAGS.prod)).length,
        warnings: this.generateVersionWarnings(versions.length)
      }
    };
  }

  /**
   * Handle reset operation with transactional safety
   */
  private async handleReset(scriptId: string, accessToken?: string): Promise<any> {
    console.error('🔄 Resetting deployments...');

    // Step 1: List existing deployments (for cleanup later)
    const existingDeployments = await this.gasClient.listDeployments(scriptId, accessToken);

    // Step 2: Create 3 new standard deployments FIRST (before deleting old ones)
    // This ensures the project is never left without deployments if creation fails
    const created: string[] = [];
    let devDeployment, stagingDeployment, prodDeployment;
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

      // Step 2.5: Fetch deployment details to get URLs (GAS API needs time to propagate entry points)
      console.error('🔍 Fetching deployment details to extract URLs (with retry for propagation)...');
      try {
        // Helper function to retry URL fetching with delays
        const fetchUrlWithRetry = async (deploymentId: string, envName: string, maxRetries = 3): Promise<string> => {
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              if (attempt > 1) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff: 2s, 4s, 5s
                console.error(`  Retry ${attempt}/${maxRetries} for ${envName} (waiting ${delay}ms)...`);
                await new Promise(resolve => setTimeout(resolve, delay));
              }

              const details = await this.gasClient.getDeployment(scriptId, deploymentId, accessToken);
              const url = this.extractWebAppUrl(details);

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

        // Fetch all deployment URLs with retry
        devUrl = await fetchUrlWithRetry(devDeployment.deploymentId, 'Dev');
        stagingUrl = await fetchUrlWithRetry(stagingDeployment.deploymentId, 'Staging');
        prodUrl = await fetchUrlWithRetry(prodDeployment.deploymentId, 'Prod');

      } catch (urlError: any) {
        console.error(`⚠️  Failed to fetch deployment URLs: ${urlError.message}`);
      }

      // Step 2.6: Store all deployment URLs and IDs in ConfigManager
      console.error('💾 Storing deployment info in ConfigManager...');
      try {
        await this.setDeploymentInConfigManager(
          scriptId,
          'dev',
          devDeployment.deploymentId,
          devUrl,
          accessToken
        );
        await this.setDeploymentInConfigManager(
          scriptId,
          'staging',
          stagingDeployment.deploymentId,
          stagingUrl,
          accessToken
        );
        await this.setDeploymentInConfigManager(
          scriptId,
          'prod',
          prodDeployment.deploymentId,
          prodUrl,
          accessToken
        );
        console.error('✅ Deployment info stored in ConfigManager');
      } catch (configError: any) {
        // Don't fail the operation if ConfigManager fails - deployments are still created
        console.error(`⚠️  Failed to store deployment info in ConfigManager: ${configError.message}`);
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

    // Step 3: Now that new deployments are created successfully, delete old ones
    console.error('🗑️  Cleaning up old deployments...');
    const deletionFailures: string[] = [];

    for (const deployment of existingDeployments) {
      try {
        await this.gasClient.deleteDeployment(scriptId, deployment.deploymentId, accessToken);
        console.error(`🗑️  Deleted old deployment: ${deployment.deploymentId}`);
      } catch (deleteError: any) {
        // Track failures - new deployments are already created so we don't fail the operation
        deletionFailures.push(deployment.deploymentId);
        console.error(`⚠️  Failed to delete old deployment ${deployment.deploymentId}: ${deleteError.message}`);
      }
    }

    const resetStatus = deletionFailures.length > 0 ? 'partial' : 'success';
    console.error(resetStatus === 'success'
      ? '✅ Reset complete - 3 standard deployments active'
      : `⚠️  Reset partially complete - ${deletionFailures.length} old deployment(s) could not be deleted`);

    const response: any = {
      operation: 'reset',
      status: resetStatus,
      deployments: {
        dev: {
          deploymentId: devDeployment.deploymentId,
          url: devUrl,
          versionNumber: null
        },
        staging: {
          deploymentId: stagingDeployment.deploymentId,
          url: stagingUrl,
          versionNumber: null
        },
        prod: {
          deploymentId: prodDeployment.deploymentId,
          url: prodUrl,
          versionNumber: null
        }
      },
      message: 'All deployments reset. Three standard deployments created (dev/staging/prod), all pointing to HEAD.'
    };

    // Add warnings if deletion failed
    if (deletionFailures.length > 0) {
      response.warnings = [
        `Failed to delete ${deletionFailures.length} old deployment(s). Manual cleanup may be required.`,
        `Failed deployment IDs: ${deletionFailures.join(', ')}`,
        `Run deploy({operation: "status", scriptId: "${scriptId}"}) to see all deployments`
      ];
    }

    return response;
  }

  /**
   * Find environment deployments by description tags
   * Uses startsWith to prevent tag collision (e.g., "[STAGING]" should not match "OLD[STAGING]")
   */
  private async findEnvironmentDeployments(scriptId: string, accessToken?: string): Promise<any> {
    const deployments = await this.gasClient.listDeployments(scriptId, accessToken);

    return {
      dev: deployments.find((d: any) => d.description?.startsWith(ENV_TAGS.dev)),
      staging: deployments.find((d: any) => d.description?.startsWith(ENV_TAGS.staging)),
      prod: deployments.find((d: any) => d.description?.startsWith(ENV_TAGS.prod))
    };
  }

  /**
   * Verify deployment update by polling until version matches expected
   * Ensures deployment updates actually propagate before proceeding
   * @private
   */
  private async verifyDeploymentUpdate(
    scriptId: string,
    deploymentId: string,
    expectedVersion: number,
    environment: string,
    accessToken?: string,
    maxAttempts: number = 5,
    delayMs: number = 1000
  ): Promise<GASDeployment> {
    console.error(`🔍 Verifying ${environment} deployment updated to v${expectedVersion}...`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const deployment = await this.gasClient.getDeployment(scriptId, deploymentId, accessToken);

        if (deployment.versionNumber === expectedVersion) {
          console.error(`✅ ${environment} deployment verified at v${expectedVersion}`);
          return deployment;
        }

        if (attempt < maxAttempts) {
          console.error(`  ⏳ Attempt ${attempt}/${maxAttempts}: v${deployment.versionNumber || 'HEAD'}, expected v${expectedVersion}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (err: any) {
        console.error(`  ⚠️  Attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
        if (attempt === maxAttempts) {
          throw err;
        }
        // Delay before retry after API failure
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    throw new ValidationError(
      'deployment_verification',
      'timeout',
      `Deployment update verification failed after ${maxAttempts} attempts (${maxAttempts * delayMs}ms). Expected v${expectedVersion}.`
    );
  }

  /**
   * Store deployment URL and ID in ConfigManager (script scope)
   * @private
   */
  private async setDeploymentInConfigManager(
    scriptId: string,
    environment: 'dev' | 'staging' | 'prod',
    deploymentId: string,
    url: string,
    accessToken?: string
  ): Promise<void> {
    const envUpper = environment.toUpperCase();

    const js_statement = `
      const ConfigManager = require('common-js/ConfigManager');
      const config = new ConfigManager('DEPLOY');
      config.setScript('${envUpper}_URL', '${url}');
      config.setScript('${envUpper}_DEPLOYMENT_ID', '${deploymentId}');
      Logger.log('[Deploy] Stored ${environment}: ${url}');
    `;

    await this.execTool.execute({
      scriptId,
      js_statement,
      autoRedeploy: false,
      accessToken
    });
  }

  /**
   * Extract web app URL from deployment
   */
  private extractWebAppUrl(deployment: any): string | null {
    if (!deployment.entryPoints) return null;

    const webAppEntry = deployment.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
    return webAppEntry?.webApp?.url || null;
  }

  /**
   * Generate version management warnings
   */
  private generateVersionWarnings(versionCount: number): any[] {
    const warnings = [];

    if (versionCount >= 150) {
      warnings.push({
        level: versionCount >= 190 ? 'CRITICAL' : 'WARNING',
        message: `${versionCount}/200 versions used${versionCount >= 190 ? ' - LIMIT APPROACHING!' : ''}`,
        action: 'Delete old versions manually via GAS UI (Manage Versions)'
      });
    }

    return warnings;
  }
}
