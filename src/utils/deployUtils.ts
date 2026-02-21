/**
 * Shared deployment utilities used by both deploy (LibraryDeployTool)
 * and deploy_config (DeployConfigTool).
 */

import { GASClient } from '../api/gasClient.js';
import { ExecTool } from '../tools/execution.js';
import { ENV_TAGS } from './deployConstants.js';

/**
 * Find environment deployments by description tags.
 * Uses startsWith to prevent tag collision (e.g., "[STAGING]" should not match "OLD[STAGING]")
 */
export async function findEnvironmentDeployments(
  gasClient: GASClient,
  scriptId: string,
  accessToken?: string
): Promise<{ dev: any; staging: any; prod: any }> {
  const deployments = await gasClient.listDeployments(scriptId, accessToken);

  return {
    dev: deployments.find((d: any) => d.description?.startsWith(ENV_TAGS.dev)),
    staging: deployments.find((d: any) => d.description?.startsWith(ENV_TAGS.staging)),
    prod: deployments.find((d: any) => d.description?.startsWith(ENV_TAGS.prod)),
  };
}

/**
 * Extract web app URL from deployment entry points.
 */
export function extractWebAppUrl(deployment: any): string | null {
  if (!deployment?.entryPoints) return null;

  const webAppEntry = deployment.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
  return webAppEntry?.webApp?.url || null;
}

/**
 * Store deployment URL and ID in ConfigManager (script scope) via exec.
 */
export async function setDeploymentInConfigManager(
  execTool: ExecTool,
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

  await execTool.execute({
    scriptId,
    js_statement,
    autoRedeploy: false,
    accessToken,
  });
}

/**
 * Generate version management warnings based on version count.
 */
export function generateVersionWarnings(versionCount: number): any[] {
  const warnings: any[] = [];
  if (versionCount >= 150) {
    warnings.push({
      level: versionCount >= 190 ? 'CRITICAL' : versionCount >= 180 ? 'HIGH' : 'WARNING',
      message: `${versionCount}/200 versions used${versionCount >= 190 ? ' — LIMIT APPROACHING!' : ''}`,
      action: 'Delete old versions manually via Apps Script UI > Project History',
    });
  }
  return warnings;
}
