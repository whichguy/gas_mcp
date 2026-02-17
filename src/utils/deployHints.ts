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
          'When ready: version_deploy({operation:"promote", environment:"prod", scriptId})'
        ];
        hints.workflow = [
          'Current: dev (HEAD) → staging (v' + (result?.version?.versionNumber || 'N') + ')',
          'Next: promote staging→prod when testing complete'
        ];
      } else if (environment === 'prod') {
        hints.context = 'Production now serves staging version';
        hints.nextSteps = [
          'Verify prod URL serves expected content',
          'If issues: version_deploy({operation:"rollback", environment:"prod", scriptId})'
        ];
        hints.workflow = [
          'Complete: staging (v' + (result?.version?.versionNumber || 'N') + ') → prod',
          'Both environments now serve same version'
        ];
      }
      if (result?.configWarning) {
        hints.warning = result.configWarning;
        hints.suggestions = [
          ...(hints.suggestions || []),
          'Run version_deploy({operation:"status", scriptId}) to verify deployment state'
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
        'Use version_deploy({operation:"status", scriptId}) to see current state',
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
            'Run version_deploy({operation:"reset", scriptId}) to create all 3 standard deployments'
          ];
        }

        // Promotion available
        if (envs.staging?.canPromoteToProd) {
          hints.nextSteps = hints.nextSteps || [];
          hints.nextSteps.push(
            `Staging v${envs.staging.versionNumber} ready to promote to prod`,
            'version_deploy({operation:"promote", environment:"prod", scriptId})'
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
        'Develop in dev, then: version_deploy({operation:"promote", environment:"staging", description:"v1.0", scriptId})'
      ];
      hints.workflow = [
        '1. Develop and test in dev (auto-updates to HEAD)',
        '2. Promote dev→staging when feature complete',
        '3. Test staging, then promote staging→prod'
      ];

      // ConfigManager warnings
      if (result?.configWarning) {
        hints.warning = hints.warning
          ? `${hints.warning}; ${result.configWarning}`
          : result.configWarning;
        hints.suggestions = [
          ...(hints.suggestions || []),
          'Run version_deploy({operation:"status", scriptId}) to verify stored URLs'
        ];
      }
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
      'Run version_deploy({operation:"reset", scriptId}) to create all 3 standard deployments',
      'Use version_deploy({operation:"status", scriptId}) to see existing deployments'
    ];
  }

  if (errorMessage.includes('HEAD') || errorMessage.includes('null')) {
    hints.context = 'Cannot operate on HEAD deployment';
    hints.suggestions = [
      'Promote dev→staging first to create a versioned snapshot',
      'version_deploy({operation:"promote", environment:"staging", description:"...", scriptId})'
    ];
  }

  if (errorMessage.includes('description')) {
    hints.context = 'Description required for staging promotion';
    hints.suggestions = [
      'Add description parameter: version_deploy({..., description:"v1.0 Feature X"})',
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

/**
 * Generate hints for library deploy operations (version pinning)
 */
export function generateLibraryDeployHints(
  operation: 'promote' | 'rollback' | 'status' | 'setup',
  environment?: 'staging' | 'prod',
  result?: any
): DeployHints {
  const hints: DeployHints = {};

  switch (operation) {
    case 'promote':
      if (result?.dryRun) {
        hints.context = 'Dry-run preview — no changes made';
        hints.nextSteps = [
          'To execute: remove dryRun parameter and run again'
        ];
        break;
      }
      if (environment === 'staging') {
        hints.context = 'Pinned staging consumers to new library version';
        hints.nextSteps = [
          'Test staging spreadsheet to verify library changes work correctly',
          'When ready: deploy({operation:"promote", to:"prod", scriptId})'
        ];
        hints.workflow = [
          'Current: library v' + (result?.version?.versionNumber || result?.version || 'N') + ' → staging consumers updated',
          'Next: promote to prod when staging testing complete'
        ];
      } else if (environment === 'prod') {
        hints.context = 'Pinned prod consumers to staging library version';
        hints.nextSteps = [
          'Verify prod spreadsheet serves expected behavior',
          'If issues: deploy({operation:"rollback", to:"prod", scriptId})'
        ];
        hints.workflow = [
          'Complete: library v' + (result?.version?.versionNumber || result?.version || 'N') + ' → prod consumers updated',
          'Staging and prod consumers now use same library version'
        ];
      }
      if (result?.configWarning) {
        hints.warning = result.configWarning;
        hints.suggestions = [
          ...(hints.suggestions || []),
          'Run deploy({operation:"status", scriptId, reconcile:true}) to fix ConfigManager state',
          'Use toVersion parameter for rollback if automatic rollback fails'
        ];
      }
      break;

    case 'rollback':
      if (result?.dryRun) {
        hints.context = 'Dry-run preview — no changes made';
        hints.nextSteps = [
          'To execute: remove dryRun parameter and run again'
        ];
        break;
      }
      hints.context = `Reverted ${environment || 'staging'} consumers to previous library version`;
      hints.nextSteps = [
        `Verify ${environment || 'staging'} spreadsheet uses expected library version`,
        'Fix issues in library, then re-promote when ready'
      ];
      hints.suggestions = [
        'Use deploy({operation:"status", scriptId}) to see current version pinning',
        'Note: a second rollback undoes the first (toggle behavior)'
      ];
      if (result?.configWarning) {
        hints.warning = result.configWarning;
        hints.suggestions.push('Run deploy({operation:"status", scriptId, reconcile:true}) to fix ConfigManager state');
      }
      break;

    case 'status': {
      const versionCount = result?.versions?.length || result?.versionCount || 0;
      if (versionCount > 150) {
        hints.warning = `${versionCount}/200 versions used — approaching GAS limit`;
        hints.suggestions = [
          'Delete old versions via GAS UI (Manage Versions) to free capacity'
        ];
      }
      if (result?.discrepancies?.length > 0 && !result?.reconciled) {
        hints.suggestions = [
          ...(hints.suggestions || []),
          'Discrepancies found — run deploy({operation:"status", scriptId, reconcile:true}) to auto-fix'
        ];
      }
      if (result?.reconciled?.length > 0) {
        hints.context = `Reconciled ${result.reconciled.length} value(s) using consumer manifests as source of truth`;
      }
      hints.nextSteps = [
        'To promote: deploy({operation:"promote", to:"staging", scriptId, description:"..."})',
        'To rollback: deploy({operation:"rollback", to:"staging", scriptId})'
      ];
      break;
    }

    case 'setup':
      hints.context = 'Library deploy infrastructure configured';
      hints.nextSteps = [
        'Deploy workflow ready — promote to staging first',
        'deploy({operation:"promote", to:"staging", scriptId, description:"Initial staging setup"})'
      ];
      hints.workflow = [
        '1. Develop library code',
        '2. Promote to staging: deploy({operation:"promote", to:"staging", scriptId, description:"..."})',
        '3. Test staging consumers',
        '4. Promote to prod: deploy({operation:"promote", to:"prod", scriptId})'
      ];
      break;
  }

  return hints;
}

/**
 * Generate hints for library deploy errors
 */
export function generateLibraryDeployErrorHints(
  operation: string,
  errorMessage: string
): DeployHints {
  const hints: DeployHints = {};

  if (errorMessage.includes('library reference') || errorMessage.includes('library mismatch')) {
    hints.context = 'Library reference mismatch detected';
    hints.suggestions = [
      'Use force: true to override: deploy({operation:"' + operation + '", ..., force: true})',
      'Or check configuration with deploy({operation:"status", scriptId})'
    ];
  }

  if (errorMessage.includes('consumer') && errorMessage.includes('not found')) {
    hints.context = 'Consumer project not found in configuration';
    hints.suggestions = [
      'Run setup first: deploy({operation:"setup", scriptId, templateScriptId:"..."})',
      'Ensure consumer scriptIds are correct in the configuration'
    ];
  }

  if (errorMessage.includes('version') && (errorMessage.includes('create') || errorMessage.includes('failed'))) {
    hints.context = 'Library version creation failed';
    hints.suggestions = [
      'Retry the operation — this may be a transient GAS API error',
      'Check that the library project is accessible and not at the 200 version limit'
    ];
  }

  if (errorMessage.includes('pin verification failed') || errorMessage.includes('Pin verification failed')) {
    hints.context = 'Consumer pin write did not persist — manifest may have reverted';
    hints.suggestions = [
      'Retry the operation — this may be a transient GAS API write failure',
      'Check consumer manifest manually with cat({path:"appsscript.json", scriptId:"<consumer>"})',
      'Use deploy({operation:"status", scriptId}) to compare expected vs actual pins'
    ];
  }

  if (errorMessage.includes('partial') && errorMessage.includes('createdVersion')) {
    hints.context = 'Partial failure — library version was created but consumer update failed';
    hints.suggestions = [
      'Use the useVersion parameter to retry with the already-created version',
      'deploy({operation:"' + operation + '", scriptId, useVersion: <versionNumber>})'
    ];
  }

  return hints;
}
