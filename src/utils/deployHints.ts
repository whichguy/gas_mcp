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
  operation: 'status' | 'reset',
  result?: any
): DeployHints {
  const hints: DeployHints = {};

  switch (operation) {
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
            'Run deploy_config({operation:"reset", scriptId}) to create all 3 standard deployments'
          ];
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
        'Develop in dev, then: deploy({to:"staging", description:"v1.0", scriptId})'
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
          'Run deploy_config({operation:"status", scriptId}) to verify stored URLs'
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
      'Run deploy_config({operation:"reset", scriptId}) to create all 3 standard deployments',
      'Use deploy_config({operation:"status", scriptId}) to see existing deployments'
    ];
  }

  if (errorMessage.includes('HEAD') || errorMessage.includes('null')) {
    hints.context = 'Cannot operate on HEAD deployment';
    hints.suggestions = [
      'Promote dev→staging first to create a versioned snapshot',
      'deploy({to:"staging", description:"...", scriptId})'
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

/**
 * Generate hints for library deploy operations (file-push model)
 */
export function generateLibraryDeployHints(
  operation: 'promote' | 'status' | 'setup',
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
        hints.context = 'Pushed files from main library to staging-source';
        hints.nextSteps = [
          'Test staging spreadsheet to verify changes work correctly',
          'When ready: deploy({to:"prod", scriptId})'
        ];
        hints.workflow = [
          `Pushed ${result?.filesPromoted || '?'} files → staging-source`,
          'All staging consumers auto-resolve to new code via HEAD + developmentMode',
          'Next: promote to prod when staging testing complete'
        ];
      } else if (environment === 'prod') {
        hints.context = 'Pushed files from staging-source to prod-source';
        hints.nextSteps = [
          'Verify prod spreadsheet serves expected behavior',
          'If issues: fix forward — edit main library, re-promote staging→prod'
        ];
        hints.workflow = [
          `Pushed ${result?.filesPromoted || '?'} files → prod-source`,
          'All prod consumers auto-resolve to new code via HEAD + developmentMode',
          'Staging and prod now serve same code'
        ];
      }
      if (result?.configWarning) {
        hints.warning = result.configWarning;
        hints.suggestions = [
          ...(hints.suggestions || []),
          'Run deploy({operation:"status", scriptId}) to verify environment state'
        ];
      }
      break;

    case 'status': {
      if (result?.discrepancies?.length > 0) {
        hints.warning = 'Consumer manifest discrepancies detected';
        hints.suggestions = [
          ...(hints.suggestions || []),
          'Check that consumers reference the correct -source library with developmentMode: true'
        ];
      }
      hints.nextSteps = [
        'To promote: deploy({to:"staging", scriptId})',
        'To check a consumer: cat({path:"appsscript.json", scriptId:"<consumerScriptId>"})'
      ];
      break;
    }

    case 'setup':
      hints.context = 'Library deploy infrastructure configured';
      hints.nextSteps = [
        'Deploy workflow ready — promote to staging first',
        'deploy({to:"staging", scriptId})'
      ];
      hints.workflow = [
        '1. Develop library code in main project',
        '2. Promote to staging: deploy({to:"staging", scriptId})',
        '3. Test staging consumers',
        '4. Promote to prod: deploy({to:"prod", scriptId})'
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

  if (errorMessage.includes('consumer') && errorMessage.includes('not found')) {
    hints.context = 'Consumer project not found in configuration';
    hints.suggestions = [
      'Run setup first: deploy({operation:"setup", scriptId, templateScriptId:"..."})',
      'Ensure consumer scriptIds are correct in the configuration'
    ];
  }

  if (errorMessage.includes('staging_source') || errorMessage.includes('not configured')) {
    hints.context = 'Environment IDs not found in dev manifest';
    hints.suggestions = [
      'If staging was just deployed: deploy({to:"prod", scriptId, stagingSourceScriptId:"<sourceScriptId from staging promote response>"})',
      'Re-run staging promote — it recovers IDs from ConfigManager and retries manifest write',
    ];
  }

  if (errorMessage.includes('file') && errorMessage.includes('push')) {
    hints.context = 'File push to -source library failed';
    hints.suggestions = [
      'Retry the operation — this may be a transient GAS API error',
      'Check that the -source project is accessible'
    ];
  }

  return hints;
}
