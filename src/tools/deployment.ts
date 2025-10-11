/**
 * Consolidated deployment management tool for Google Apps Script
 * Manages deployments across dev/staging/prod environments with version control
 */

import { BaseTool } from './base.js';
import { GASClient, EntryPointType, WebAppAccess } from '../api/gasClient.js';
import { ValidationError, GASApiError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';

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
  public name = 'gas_deploy';
  public description = 'Manage deployments across dev/staging/prod environments with version control and promotion workflow';

  public inputSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['promote', 'rollback', 'status', 'reset'],
        description: 'Operation to perform. promote: Move code between environments. rollback: Revert prod to previous version. status: View all environments. reset: Recreate 3 standard deployments.',
        llmHints: {
          promote: 'Create version snapshot (dev→staging) or update deployment to staging version (staging→prod)',
          rollback: 'Update prod deployment to previous [PROD] tagged version',
          status: 'Show current state of all three environments',
          reset: 'Delete all deployments and recreate standard dev/staging/prod setup'
        }
      },
      environment: {
        type: 'string',
        enum: ['staging', 'prod'],
        description: 'Target environment for promote/rollback operations. staging: promote dev→staging. prod: promote staging→prod or rollback.',
        llmHints: {
          staging: 'Creates version from HEAD and updates staging deployment',
          prod: 'Updates prod deployment to staging version (promote) or previous version (rollback)'
        }
      },
      description: {
        type: 'string',
        description: 'Version description (required for promote to staging). Tagged with [STAGING] automatically.',
        examples: ['v1.0 Release Candidate', 'Bug fixes for issue #123', 'New feature: user management']
      },
      toVersion: {
        type: 'number',
        description: 'Target version number for rollback (optional). If omitted, automatically finds previous [PROD] version.',
        minimum: 1
      },
      ...SchemaFragments.scriptId,
      ...SchemaFragments.accessToken
    },
    required: ['operation', 'scriptId'],
    llmWorkflowGuide: {
      typicalSequence: [
        '1. Create project with 3 deployments: gas_project({ action: "create" })',
        '2. Develop on HEAD (dev auto-serves latest code)',
        '3. Promote to staging: gas_deploy({ environment: "staging", operation: "promote", description: "v1.0" })',
        '4. Test staging deployment',
        '5. Promote to prod: gas_deploy({ environment: "prod", operation: "promote" })',
        '6. If issues: gas_deploy({ environment: "prod", operation: "rollback" })'
      ],
      environmentModel: {
        dev: 'Always HEAD (deployment.versionNumber = null, latest code)',
        staging: 'Highest version number (latest snapshot)',
        prod: 'Deployed version (deployment.versionNumber)',
        note: 'After staging→prod promotion: staging === prod (same version)'
      },
      promotionFlow: {
        devToStaging: 'Creates version from HEAD, updates staging deployment',
        stagingToProd: 'Updates prod deployment to staging version (highest)',
        rollback: 'Updates prod deployment to previous [PROD] version'
      }
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
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
        throw new ValidationError('staging_deployment', 'not found', 'existing staging deployment - run gas_deploy({operation: "reset"}) to create deployments');
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

      console.error(`✅ Updated staging deployment to version ${version.versionNumber}`);

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
          url: this.extractWebAppUrl(deployments.staging)
        }
      };

    } else {
      // Promote staging→prod: Update prod to staging version
      if (!deployments.staging) {
        throw new ValidationError('staging_deployment', 'not found', 'existing staging deployment - run gas_deploy({operation: "reset"}) to create deployments');
      }

      if (!deployments.prod) {
        throw new ValidationError('prod_deployment', 'not found', 'existing prod deployment - run gas_deploy({operation: "reset"}) to create deployments');
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

      console.error(`✅ Updated production deployment to version ${stagingVersion}`);

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
          url: this.extractWebAppUrl(deployments.prod)
        },
        note: 'Staging and prod now serve the same version'
      };
    }
  }

  /**
   * Handle rollback operation (prod only)
   */
  private async handleRollback(scriptId: string, params: any, accessToken?: string): Promise<any> {
    // Validate environment is provided and is 'prod'
    if (!params.environment) {
      throw new ValidationError('environment', undefined, '"prod" (rollback only supports production)');
    }

    const environment = this.validate.enum(
      params.environment,
      'environment',
      ['prod'],
      'rollback operation'
    );

    const deployments = await this.findEnvironmentDeployments(scriptId, accessToken);

    if (!deployments.prod) {
      throw new ValidationError('prod_deployment', 'not found', 'existing prod deployment - run gas_deploy({operation: "reset"}) to create deployments');
    }

    const currentVersion = deployments.prod.versionNumber;
    if (!currentVersion) {
      throw new ValidationError('prod_version', 'HEAD (null)', 'versioned production deployment - cannot rollback from HEAD');
    }

    let targetVersion: number;

    if (params.toVersion) {
      targetVersion = this.validate.number(params.toVersion, 'toVersion', 'rollback operation', 1);
    } else {
      // Auto-find previous [PROD] version
      const versions = await this.gasClient.listVersions(scriptId, 200, undefined, accessToken);
      const prodVersions = versions
        .filter((v: any) => v.description?.includes(ENV_TAGS.prod))
        .sort((a: any, b: any) => b.versionNumber - a.versionNumber);

      const currentIndex = prodVersions.findIndex((v: any) => v.versionNumber === currentVersion);

      if (currentIndex === -1) {
        throw new ValidationError(
          'current_prod_version',
          `v${currentVersion}`,
          `[PROD] tagged version (current v${currentVersion} not found in prod version history - may have been manually changed)`
        );
      }

      if (currentIndex === prodVersions.length - 1) {
        throw new ValidationError(
          'previous_prod_version',
          'none available',
          `at least 2 [PROD] tagged versions to enable rollback (only found v${currentVersion})`
        );
      }

      targetVersion = prodVersions[currentIndex + 1].versionNumber;
    }

    // Update prod deployment to target version
    await this.gasClient.updateDeployment(
      scriptId,
      deployments.prod.deploymentId,
      {
        versionNumber: targetVersion,
        description: `${ENV_TAGS.prod} v${targetVersion} (rolled back from v${currentVersion})`
      },
      accessToken
    );

    console.error(`✅ Rolled back production from v${currentVersion} to v${targetVersion}`);

    const version = await this.gasClient.getVersion(scriptId, targetVersion, accessToken);

    return {
      operation: 'rollback',
      environment: 'prod',
      from: {
        versionNumber: currentVersion
      },
      to: {
        versionNumber: targetVersion,
        description: version.description,
        createTime: version.createTime
      },
      deployment: {
        deploymentId: deployments.prod.deploymentId,
        versionNumber: targetVersion,
        url: this.extractWebAppUrl(deployments.prod)
      }
    };
  }

  /**
   * Handle status operation
   */
  private async handleStatus(scriptId: string, accessToken?: string): Promise<any> {
    const deployments = await this.findEnvironmentDeployments(scriptId, accessToken);
    const versions = await this.gasClient.listVersions(scriptId, 200, undefined, accessToken);

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
    for (const deployment of existingDeployments) {
      try {
        await this.gasClient.deleteDeployment(scriptId, deployment.deploymentId, accessToken);
        console.error(`🗑️  Deleted old deployment: ${deployment.deploymentId}`);
      } catch (deleteError: any) {
        // Log but don't fail - new deployments are already created
        console.error(`⚠️  Failed to delete old deployment ${deployment.deploymentId}: ${deleteError.message}`);
      }
    }

    console.error('✅ Reset complete - 3 standard deployments active');

    return {
      operation: 'reset',
      status: 'success',
      deployments: {
        dev: {
          deploymentId: devDeployment.deploymentId,
          url: devDeployment.webAppUrl,
          versionNumber: null
        },
        staging: {
          deploymentId: stagingDeployment.deploymentId,
          url: stagingDeployment.webAppUrl,
          versionNumber: null
        },
        prod: {
          deploymentId: prodDeployment.deploymentId,
          url: prodDeployment.webAppUrl,
          versionNumber: null
        }
      },
      message: 'All deployments reset. Three standard deployments created (dev/staging/prod), all pointing to HEAD.'
    };
  }

  /**
   * Find environment deployments by description tags
   */
  private async findEnvironmentDeployments(scriptId: string, accessToken?: string): Promise<any> {
    const deployments = await this.gasClient.listDeployments(scriptId, accessToken);

    return {
      dev: deployments.find((d: any) => d.description?.includes(ENV_TAGS.dev)),
      staging: deployments.find((d: any) => d.description?.includes(ENV_TAGS.staging)),
      prod: deployments.find((d: any) => d.description?.includes(ENV_TAGS.prod))
    };
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
