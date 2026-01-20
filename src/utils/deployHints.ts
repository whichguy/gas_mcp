/**
 * Context-aware hint generators for deployment operations
 *
 * Following the sheet_sql pattern of generating hints based on actual results
 * to provide LLM-friendly guidance for next steps and troubleshooting.
 */

export interface DeployHints {
  context?: string;
  suggestions?: string[];
  warning?: string;
  nextSteps?: string[];
  workflow?: string[];
}

/**
 * Generate hints based on deployment operation results
 */
export function generateDeployHints(
  operation: 'promote' | 'rollback' | 'status' | 'reset',
  environment?: 'staging' | 'prod',
  result?: any
): DeployHints {
  const hints: DeployHints = {};

  switch (operation) {
    case 'promote':
      if (environment === 'staging') {
        hints.context = 'Created versioned snapshot from HEAD';
        hints.nextSteps = [
          'Test staging URL to verify changes',
          'When ready: deploy({operation:"promote", environment:"prod", scriptId})'
        ];
        hints.workflow = [
          'Current: dev (HEAD) → staging (v' + (result?.version?.versionNumber || 'N') + ')',
          'Next: promote staging→prod when testing complete'
        ];
      } else if (environment === 'prod') {
        hints.context = 'Production now serves staging version';
        hints.nextSteps = [
          'Verify prod URL serves expected content',
          'If issues: deploy({operation:"rollback", environment:"prod", scriptId})'
        ];
        hints.workflow = [
          'Complete: staging (v' + (result?.version?.versionNumber || 'N') + ') → prod',
          'Both environments now serve same version'
        ];
      }
      break;

    case 'rollback':
      hints.context = `Reverted ${environment} to previous version`;
      hints.nextSteps = [
        `Verify ${environment} URL serves expected content`,
        'Fix issues in dev, then re-promote when ready'
      ];
      hints.suggestions = [
        'Use deploy({operation:"status", scriptId}) to see current state',
        'To specify exact version: toVersion parameter'
      ];
      break;

    case 'status':
      // Check for any issues in the status result
      const envs = result?.environments;
      if (envs) {
        // Missing deployments
        const missing = [];
        if (!envs.dev) missing.push('dev');
        if (!envs.staging) missing.push('staging');
        if (!envs.prod) missing.push('prod');

        if (missing.length > 0) {
          hints.warning = `Missing deployments: ${missing.join(', ')}`;
          hints.suggestions = [
            'Run deploy({operation:"reset", scriptId}) to create all 3 standard deployments'
          ];
        }

        // Promotion available
        if (envs.staging?.canPromoteToProd) {
          hints.nextSteps = hints.nextSteps || [];
          hints.nextSteps.push(
            `Staging v${envs.staging.versionNumber} ready to promote to prod`,
            'deploy({operation:"promote", environment:"prod", scriptId})'
          );
        }

        // Prod out of sync
        if (envs.prod && !envs.prod.isSynced) {
          hints.context = 'Prod is not at latest version';
          hints.suggestions = hints.suggestions || [];
          hints.suggestions.push(
            'Consider promoting staging→prod to update production'
          );
        }

        // Version warnings
        const versionWarnings = result?.versionManagement?.warnings;
        if (versionWarnings && versionWarnings.length > 0) {
          const critical = versionWarnings.find((w: any) => w.level === 'CRITICAL');
          if (critical) {
            hints.warning = critical.message;
            hints.suggestions = hints.suggestions || [];
            hints.suggestions.push('Delete old versions via GAS UI (Manage Versions)');
          }
        }
      }
      break;

    case 'reset':
      hints.context = 'Created fresh dev/staging/prod deployments';
      hints.nextSteps = [
        'All deployments point to HEAD (no versioned snapshots yet)',
        'Develop in dev, then: deploy({operation:"promote", environment:"staging", description:"v1.0", scriptId})'
      ];
      hints.workflow = [
        '1. Develop and test in dev (auto-updates to HEAD)',
        '2. Promote dev→staging when feature complete',
        '3. Test staging, then promote staging→prod'
      ];

      // Partial success
      if (result?.status === 'partial') {
        hints.warning = 'Some old deployments could not be deleted';
        hints.suggestions = [
          'Manual cleanup may be required',
          'Use status operation to see all deployments'
        ];
      }
      break;
  }

  return hints;
}

/**
 * Generate hints for deployment errors
 */
export function generateDeployErrorHints(
  operation: string,
  errorMessage: string
): DeployHints {
  const hints: DeployHints = {};

  if (errorMessage.includes('not found')) {
    hints.context = 'Required deployment not found';
    hints.suggestions = [
      'Run deploy({operation:"reset", scriptId}) to create all 3 standard deployments',
      'Use deploy({operation:"status", scriptId}) to see existing deployments'
    ];
  }

  if (errorMessage.includes('HEAD') || errorMessage.includes('null')) {
    hints.context = 'Cannot operate on HEAD deployment';
    hints.suggestions = [
      'Promote dev→staging first to create a versioned snapshot',
      'deploy({operation:"promote", environment:"staging", description:"...", scriptId})'
    ];
  }

  if (errorMessage.includes('description')) {
    hints.context = 'Description required for staging promotion';
    hints.suggestions = [
      'Add description parameter: deploy({..., description:"v1.0 Feature X"})',
      'Description is auto-tagged with [STAGING] prefix'
    ];
  }

  if (errorMessage.includes('version') && errorMessage.includes('history')) {
    hints.context = 'Version not found in environment history';
    hints.suggestions = [
      'Current deployment may have been manually changed',
      'Use status operation to check current state',
      'Consider using reset to recreate clean deployments'
    ];
  }

  return hints;
}
