/**
 * Shared deployment utilities used by both deploy (LibraryDeployTool)
 * and deploy_config (DeployConfigTool).
 */

import { GASClient } from '../api/gasClient.js';
import { GASFile } from '../api/gasTypes.js';
import { fileNameMatches } from '../api/pathParser.js';
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
  const urlKey = `${envUpper}_URL`;
  const idKey = `${envUpper}_DEPLOYMENT_ID`;

  const js_statement = `
    const ConfigManager = require('common-js/ConfigManager');
    const config = new ConfigManager('DEPLOY');
    config.setScript(${JSON.stringify(urlKey)}, ${JSON.stringify(url)});
    config.setScript(${JSON.stringify(idKey)}, ${JSON.stringify(deploymentId)});
    Logger.log('[Deploy] Stored ${environment}: ' + ${JSON.stringify(url)});
  `;

  await execTool.execute({
    scriptId,
    js_statement,
    autoRedeploy: false,
    accessToken,
  });
}

/**
 * Critical common-js files that must appear first, in this exact order.
 * common-js/require must be at position 0 — it bootstraps the module system.
 */
const DEPLOY_CRITICAL_ORDER = [
  'common-js/require',
  'common-js/ConfigManager',
  'common-js/__mcp_exec',
] as const;

/**
 * Strip mcp_environments from appsscript.json before pushing to -source libraries.
 * All other manifest properties (oauthScopes, timeZone, runtimeVersion, etc.) are preserved.
 * mcp_environments is dev-only tracking metadata that must not reach staging/prod.
 */
export function stripMcpEnvironments(files: GASFile[]): GASFile[] {
  return files.map((f: GASFile) => {
    if (f.name !== 'appsscript' || !f.source) return f;
    try {
      const json = JSON.parse(f.source);
      if (!json.mcp_environments) return f;
      const { mcp_environments: _mcp_environments, ...rest } = json;
      return { ...f, source: JSON.stringify(rest, null, 2) };
    } catch { return f; }
  });
}

/**
 * Enforce common-js file ordering before pushing to staging/prod.
 * Guarantees:
 *   [0] common-js/require       — bootstraps the module system
 *   [1] common-js/ConfigManager — available to all modules at load time
 *   [2] common-js/__mcp_exec    — MCP exec infrastructure
 *   [3..] remaining common-js/* in API order
 *   [n..] non-common-js files   in API order
 *
 * Throws if any critical file is absent — a missing file would silently deploy
 * a broken CommonJS module system without this guard.
 */
export function enforceDeployFileOrder(files: GASFile[]): GASFile[] {
  const criticalFiles = DEPLOY_CRITICAL_ORDER.map(baseName => {
    const file = files.find(f => fileNameMatches(f.name, baseName));
    if (!file) {
      throw new Error(
        `[enforceDeployFileOrder] Required file "${baseName}" is missing from source project. ` +
        `Cannot deploy without the CommonJS module system.`
      );
    }
    return file;
  });

  const criticalActualNames = new Set(criticalFiles.map(f => f.name));

  const otherCommonJs = files.filter(
    f => f.name.startsWith('common-js/') && !criticalActualNames.has(f.name)
  );
  const nonCommonJs = files.filter(f => !f.name.startsWith('common-js/'));

  // Assert no common-js files were lost between input and output
  const inputCommonJsCount = files.filter(f => f.name.startsWith('common-js/')).length;
  const outputCommonJsCount = criticalFiles.length + otherCommonJs.length;
  if (inputCommonJsCount !== outputCommonJsCount) {
    throw new Error(
      `[enforceDeployFileOrder] BUG: ${inputCommonJsCount} common-js files in input but ` +
      `${outputCommonJsCount} in output — ${inputCommonJsCount - outputCommonJsCount} lost`
    );
  }

  return [...criticalFiles, ...otherCommonJs, ...nonCommonJs];
}

/**
 * Prepare source files for cross-project deploy:
 * 1. Strip mcp_environments from appsscript.json (dev-only tracking metadata)
 * 2. Enforce critical common-js ordering (require first, ConfigManager second, __mcp_exec third)
 * 3. Assert all common-js files are present (throws on missing critical file)
 */
export function prepareFilesForDeploy(files: GASFile[]): GASFile[] {
  return enforceDeployFileOrder(stripMcpEnvironments(files));
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
