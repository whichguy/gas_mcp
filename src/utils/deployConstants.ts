/**
 * Shared constants for deployment tools
 *
 * Used by both VersionDeployTool (web app deployments) and
 * LibraryDeployTool (library version pinning).
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
 * Environments that can be promoted/rolled back (excludes dev)
 */
export type LibraryEnvironment = 'staging' | 'prod';
