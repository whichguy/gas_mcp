/**
 * Shared constants for deployment tools
 *
 * Used by both DeployConfigTool (deployment infrastructure) and
 * LibraryDeployTool (unified environment promotion).
 */

/**
 * Environment tags for deployment identification
 */
export const ENV_TAGS = {
  dev: '[DEV]',
  staging: '[STAGING]',
  prod: '[PROD]'
} as const;

/**
 * All environment types
 */
export type EnvironmentType = 'dev' | 'staging' | 'prod';

/**
 * Environments that can be promoted (excludes dev)
 */
export type LibraryEnvironment = 'staging' | 'prod';

/**
 * ConfigManager property key names for -source library script IDs
 */
export const SOURCE_CONFIG_KEYS = {
  staging: 'STAGING_SOURCE_SCRIPT_ID',
  prod: 'PROD_SOURCE_SCRIPT_ID',
} as const;

/**
 * Infrastructure property keys written by the deploy tool itself.
 * These are excluded from syncProperties to prevent overwriting
 * environment-specific infrastructure config in the target.
 */
export const MANAGED_PROPERTY_KEYS = new Set([
  // CONFIG_KEYS entries (per-environment IDs and timestamps)
  'STAGING_SOURCE_SCRIPT_ID', 'PROD_SOURCE_SCRIPT_ID',
  'STAGING_SCRIPT_ID', 'PROD_SCRIPT_ID',
  'STAGING_SPREADSHEET_URL', 'PROD_SPREADSHEET_URL',
  'STAGING_PROMOTED_AT', 'PROD_PROMOTED_AT',
  // Deployment URLs and IDs (set by setDeploymentInConfigManager)
  'DEV_URL', 'STAGING_URL', 'PROD_URL',
  'DEV_DEPLOYMENT_ID', 'STAGING_DEPLOYMENT_ID', 'PROD_DEPLOYMENT_ID',
  // Template metadata (set by setup operation)
  'TEMPLATE_SCRIPT_ID', 'USER_SYMBOL',
]);
