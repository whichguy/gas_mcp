/**
 * Per-environment library deployment tool for Google Apps Script
 *
 * File-push model: each environment has a standalone -source library and
 * thin-shim consumers that reference it at HEAD with developmentMode: true.
 * Promote = push files between -source libraries. All consumer copies
 * auto-update via HEAD resolution.
 *
 * Architecture:
 *   Main Library = dev-source (development, all source + CommonJS infra)
 *     └── Dev consumers (thin shim → main library @ HEAD, developmentMode: true)
 *
 *   stage-source (standalone) ← files pushed from main library
 *     └── Stage consumers (thin shim → stage-source @ HEAD, developmentMode: true)
 *
 *   prod-source (standalone) ← files pushed from stage-source
 *     └── Prod consumers (thin shim → prod-source @ HEAD, developmentMode: true)
 *
 * No versioning. No rollback. Fix-forward if something breaks.
 *
 * Note: For deployment infrastructure reset, see DeployConfigTool in deployment.ts
 */

import { BaseTool } from './base.js';
import { GASClient, GASFile } from '../api/gasClient.js';
import { ValidationError, GASApiError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { LockManager } from '../utils/lockManager.js';
import { McpGasConfigManager } from '../config/mcpGasConfig.js';
import { generateLibraryDeployHints, generateLibraryDeployErrorHints } from '../utils/deployHints.js';
import { mcpLogger } from '../utils/mcpLogger.js';
import { LibraryEnvironment, SOURCE_CONFIG_KEYS, MANAGED_PROPERTY_KEYS } from '../utils/deployConstants.js';
import { ExecTool } from './execution.js';

/**
 * ConfigManager property keys per environment
 */
const CONFIG_KEYS = {
  staging: {
    sourceScriptId: SOURCE_CONFIG_KEYS.staging,
    scriptId: 'STAGING_SCRIPT_ID',
    spreadsheetUrl: 'STAGING_SPREADSHEET_URL',
    promotedAt: 'STAGING_PROMOTED_AT',
  },
  prod: {
    sourceScriptId: SOURCE_CONFIG_KEYS.prod,
    scriptId: 'PROD_SCRIPT_ID',
    spreadsheetUrl: 'PROD_SPREADSHEET_URL',
    promotedAt: 'PROD_PROMOTED_AT',
  },
} as const;

/**
 * Per-environment file-push deployment tool
 */
export class LibraryDeployTool extends BaseTool {
  public name = 'deploy';
  public description = 'Deploy to staging/prod — pushes files to per-environment -source library, consumers auto-update via HEAD. For deployment infrastructure reset, use deploy_config().';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      operation:        { type: 'string', description: 'promote | status | setup' },
      environment:      { type: 'string', description: 'Target environment (promote): staging | prod' },
      sourceScriptId:   { type: 'string', description: '-source library that received pushed files (promote)' },
      filesPromoted:    { type: 'number', description: 'Files pushed to -source library (promote)' },
      description:      { type: 'string', description: 'Promotion description (promote)' },
      consumer:         { type: 'object', description: 'Consumer shim info (promote): { scriptId } — container-bound script pointing to -source @HEAD' },
      spreadsheetUrl:   { type: 'string', description: 'Direct link to the environment spreadsheet — open to access the sidebar. Present on promote + status.' },
      note:             { type: 'string', description: 'Additional context (prod promote)' },
      // setup fields
      templateScriptId: { type: 'string', description: 'Container-bound script wired as dev consumer (setup)' },
      libraryScriptId:  { type: 'string', description: 'Library that was configured (setup)' },
      userSymbol:       { type: 'string', description: 'Library namespace symbol (setup + status)' },
      libraryReference: { type: 'object', description: 'Library ref written to template: { version, developmentMode } (setup)' },
      message:          { type: 'string', description: 'Next-step guidance (setup)' },
      // status fields
      dev:     { type: 'object', description: 'Dev environment (status): { scriptId }' },
      staging: { type: 'object', description: 'Staging environment (status): { sourceScriptId, consumerScriptId, spreadsheetId, spreadsheetUrl, lastPromotedAt } | { configured: false }' },
      prod:    { type: 'object', description: 'Prod environment (status): { sourceScriptId, consumerScriptId, spreadsheetId, spreadsheetUrl, lastPromotedAt } | { configured: false }' },
      discrepancies:  { type: 'array',  description: 'Consumer manifest issues detected (status)' },
      shimValidation: { type: 'object', description: 'Shim validation result (promote): { valid, updated, issue? }' },
      sheetSync:      { type: 'object', description: 'Sheet sync results (promote): { source, target, synced[], added[], skipped[] }. Sheets are synced via copyTo() — copies structure + template data only. Application or user data not present in the source spreadsheet is NOT migrated.' },
      propertySync:   { type: 'object', description: 'Property sync results (promote, when syncProperties:true): { source, target, synced[], skipped[], deleted[]?, errors[]?, consumerSync? }. synced = keys copied; skipped = infra keys excluded; deleted = keys removed from target absent in source (reconcileProperties:true only); errors = keys that failed. consumerSync = same result shape for the consumer shim script (written via direct PropertiesService, not ConfigManager).' },
      configWarning:  { type: 'string', description: 'Non-fatal ConfigManager write failures (deployment still succeeded)' },
      hints:          { type: 'object', description: 'Context-aware next-step hints' },
    },
  };

  public inputSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['promote', 'status', 'setup'],
        default: 'promote',
        description:
          'promote (default): push files to target -source library. status: show all envs. setup: wire template.',
      },
      to: {
        type: 'string',
        enum: ['staging', 'prod'],
        description:
          'Target environment. staging: push files from main library → staging-source. prod: push files from staging-source → prod-source.',
      },
      description: {
        type: 'string',
        description: 'Promotion description (contextual note).',
      },
      syncSheets: {
        type: 'boolean',
        description: 'Sync spreadsheet sheets from source to target environment during promote. Default: true. '
          + 'Copies sheets (structure, formulas, formatting, and template data) from the upstream environment\'s '
          + 'spreadsheet. Does NOT handle application/user data migration — if target environments need seeded '
          + 'data (reference tables, config sheets, live data not present in the template), that must be handled '
          + 'separately via exec() or manual copy.',
        default: true,
      },
      syncProperties: {
        type: 'boolean',
        description: 'Sync ConfigManager-managed properties (script + doc scopes) from source to target during promote. '
          + 'Default: true. Copies user-set config (feature flags, API keys, default settings) stored '
          + 'via ConfigManager.setScript() or ConfigManager.setDocument(). User-scoped properties '
          + '(setUser, setUserDoc) are never synced — they are per-user and not portable across environments. '
          + 'Infrastructure keys managed by the deploy tool (URLs, script IDs, deployment IDs) are automatically excluded. '
          + 'Set to false if environments need distinct secrets that should not travel with the deploy.',
        default: true,
      },
      reconcileProperties: {
        type: 'boolean',
        description: 'Delete properties from the target that do not exist in source (reconcile mode). '
          + 'Default: false. When true, the target becomes an exact mirror of the source for '
          + 'user-managed properties — extras in the target that are absent from the source are removed. '
          + 'MANAGED_PROPERTY_KEYS (infrastructure: URLs, IDs, timestamps) and user/userDoc scopes are never deleted. '
          + 'Only applies when syncProperties is not false. Safe to enable — infrastructure keys are always protected.',
        default: false,
      },
      userSymbol: {
        type: 'string',
        description: 'Library namespace symbol in consumer scripts (e.g., "SheetsChat"). Defaults to project-specific config.',
      },
      templateScriptId: {
        type: 'string',
        description: 'Container-bound script ID of the dev/template spreadsheet (for setup operation).',
      },
      stagingSourceScriptId: {
        type: 'string',
        pattern: '^[a-zA-Z0-9_-]{25,60}$',
        minLength: 25,
        maxLength: 60,
        description: 'Staging-source script ID override for prod promote. '
          + 'Use when staging was deployed but mcp_environments was not persisted to dev manifest '
          + '(deploy status shows staging: {configured: false}). '
          + 'Value: sourceScriptId from the prior staging promote response.',
      },
      ...SchemaFragments.dryRun,
      ...SchemaFragments.scriptId,
      ...SchemaFragments.accessToken,
    },
    required: ['scriptId'],
    llmGuidance: {
      workflow: 'setup (once, optional) → promote to staging → test → promote to prod',
      auto_behaviors: [
        'First promote auto-creates staging/prod -source library + consumer spreadsheet if not yet configured',
        'Every promote validates consumer shim (rewrites if stale or developmentMode missing)',
        'syncSheets:true (default) copies sheets (structure + template data) from source spreadsheet to target — does NOT migrate application/user data',
        'spreadsheetUrl always returned — share with user to access the environment',
      ],
      self_contained: 'deploy handles all environment setup automatically — no prerequisite tool calls needed',
      defaults: 'dryRun:false | syncSheets:true | syncProperties:true | reconcileProperties:false | userSymbol: derived from project name',
      limitations: [
        'syncSheets copies sheet tabs via copyTo() — only data already in the source template spreadsheet travels with the deploy',
        'Application data, user records, and reference tables not present in the source spreadsheet must be seeded/copied separately',
        'To seed data post-deploy: use exec() with SpreadsheetApp to write to the target spreadsheet, or open the spreadsheetUrl and edit manually',
        'syncProperties (default true) syncs ConfigManager script + doc scopes only (never user/userDoc scopes); infrastructure keys are always excluded — set false to keep environment properties isolated',
      ],
    },
  };

  public annotations = {
    title: 'Deploy',
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
    const scriptId = this.validate.scriptId(params.scriptId, 'deploy');

    // Default operation to 'promote'
    const operation = this.validate.enum(
      params.operation || 'promote',
      'operation',
      ['promote', 'status', 'setup'],
      'deploy'
    );

    // Normalize 'environment' → 'to' for backward compat
    if (params.environment && !params.to) {
      params.to = params.environment;
    }

    mcpLogger.info('deploy', { event: 'operation_start', operation, scriptId, to: params.to });

    try {
      let result: any;
      switch (operation) {
        case 'promote':
          result = await this.handlePromote(scriptId, params, accessToken);
          break;
        case 'status':
          result = await this.handleStatus(scriptId, params, accessToken);
          break;
        case 'setup':
          result = await this.handleSetup(scriptId, params, accessToken);
          break;
        default:
          throw new ValidationError('operation', operation, 'one of: promote, status, setup');
      }

      const hints = generateLibraryDeployHints(
        operation as 'promote' | 'status' | 'setup',
        params.to,
        result
      );
      if (Object.keys(hints).length > 0) {
        result.hints = hints;
      }

      mcpLogger.info('deploy', { event: 'operation_complete', operation, scriptId });
      return result;
    } catch (error: any) {
      mcpLogger.error('deploy', { event: 'operation_error', operation, scriptId, error: error.message });

      const errorHints = generateLibraryDeployErrorHints(operation, error.message);
      const wrappedError = new GASApiError(`Library deploy failed: ${error.message}`);
      if (Object.keys(errorHints).length > 0) {
        (wrappedError as any).hints = errorHints;
      }
      throw wrappedError;
    }
  }

  // ---------------------------------------------------------------------------
  // Promote
  // ---------------------------------------------------------------------------

  private async handlePromote(scriptId: string, params: any, accessToken?: string): Promise<any> {
    const to = this.validate.enum(params.to, 'to', ['staging', 'prod'], 'promote operation') as LibraryEnvironment;

    const lockManager = LockManager.getInstance();
    await lockManager.acquireLock(scriptId, `deploy-promote-${to}`);

    try {
      if (to === 'staging') {
        return await this.promoteToStaging(scriptId, params, accessToken);
      } else {
        return await this.promoteToProd(scriptId, params, accessToken);
      }
    } finally {
      await lockManager.releaseLock(scriptId);
    }
  }

  private async promoteToStaging(scriptId: string, params: any, accessToken?: string): Promise<any> {
    const dryRun = !!params.dryRun;
    const envConfig = await this.getEnvironmentConfig(scriptId, accessToken);

    let stagingSourceScriptId = envConfig?.staging?.sourceScriptId;
    let stagingConsumerScriptId = envConfig?.staging?.consumerScriptId;
    let stagingSpreadsheetId = envConfig?.staging?.spreadsheetId;
    let stagingManifestWriteFailed = false;

    // Auto-create environment if missing
    if (!stagingSourceScriptId || !stagingConsumerScriptId) {
      if (dryRun) {
        return {
          operation: 'promote',
          environment: 'staging',
          dryRun: true,
          wouldCreate: 'staging -source library + consumer (not yet configured)',
          note: 'Cannot fully preview — staging environment does not exist yet. Run without dryRun to auto-create.',
        };
      }
      console.error('🔧 Creating staging environment...');
      const consumer = await this.autoCreateConsumer(scriptId, 'staging', envConfig, accessToken);
      stagingSourceScriptId = consumer.sourceScriptId;
      stagingConsumerScriptId = consumer.consumerScriptId;
      stagingSpreadsheetId = consumer.spreadsheetId;
      if (!consumer.manifestPersisted) stagingManifestWriteFailed = true;
      console.error(`✅ Created staging: source=${stagingSourceScriptId}, consumer=${stagingConsumerScriptId}`);
    }

    // Read all files from main library
    const libraryFiles = await this.gasClient.getProjectContent(scriptId, accessToken);

    if (dryRun) {
      return {
        operation: 'promote',
        environment: 'staging',
        dryRun: true,
        sourceScriptId: stagingSourceScriptId,
        wouldPush: `${libraryFiles.length} files from main library → staging-source`,
        description: params.description || null,
      };
    }

    // Push all files to staging-source (strip mcp_environments — that's dev-only tracking metadata)
    const filesToPush = this.stripMcpEnvironments(libraryFiles);
    await this.gasClient.updateProjectContent(stagingSourceScriptId!, filesToPush, accessToken);
    console.error(`✅ Pushed ${libraryFiles.length} files to staging-source`);

    // Store promote timestamp (non-fatal)
    const storeResult = await this.storePromoteTimestamp(scriptId, 'staging', accessToken);

    // Validate/repair staging consumer shim (catches config drift between promotes)
    // libraryFiles is the dev library content — manifest is used for scopes/timezone reference
    const devManifestForShim = libraryFiles.find((f: GASFile) => f.name === 'appsscript');
    const devManifestJsonForShim = devManifestForShim?.source ? JSON.parse(devManifestForShim.source) : {};
    // userSymbol: params takes precedence, then manifest-primary path (template.userSymbol),
    // then gas-config.json fallback path (top-level userSymbol), then derive from project name
    const userSymbol = params.userSymbol || envConfig?.template?.userSymbol || envConfig?.userSymbol || await this.deriveUserSymbol(scriptId);
    if (!params.userSymbol && !envConfig?.template?.userSymbol && !envConfig?.userSymbol) {
      console.error(`⚠️  [shim validation] userSymbol not found in config — derived "${userSymbol}" from project name. Verify this matches the library's intended namespace.`);
    }
    let shimValidation: any;
    if (stagingConsumerScriptId) {
      shimValidation = await this.validateAndRepairConsumerShim(
        stagingConsumerScriptId, stagingSourceScriptId!, userSymbol, devManifestJsonForShim, accessToken
      );
    }

    // Sheet sync: template → staging
    let sheetSync: any = undefined;
    if (params.syncSheets !== false) {
      const sourceSpreadsheetId = envConfig?.templateSpreadsheetId;
      const targetSpreadsheetId = envConfig?.staging?.spreadsheetId;
      if (sourceSpreadsheetId && targetSpreadsheetId) {
        try {
          sheetSync = await this.syncSheets(sourceSpreadsheetId, targetSpreadsheetId, scriptId, accessToken);
        } catch (syncError: any) {
          console.error(`⚠️  Sheet sync failed: ${syncError.message}`);
          sheetSync = { error: syncError.message };
        }
      }
    }

    // Property sync: dev → staging (opt-in)
    let propertySync: any = undefined;
    if (params.syncProperties !== false) {
      try {
        propertySync = await this.doSyncProperties(
          scriptId, stagingSourceScriptId!, accessToken,
          params.reconcileProperties === true,
          stagingConsumerScriptId ?? undefined
        );
      } catch (syncError: any) {
        console.error(`⚠️  Property sync failed: ${syncError.message}`);
        propertySync = { error: syncError.message };
      }
    }

    const stagingSpreadsheetUrl = stagingSpreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${stagingSpreadsheetId}`
      : null;

    return {
      operation: 'promote',
      environment: 'staging',
      sourceScriptId: stagingSourceScriptId,
      filesPromoted: libraryFiles.length,
      description: params.description || null,
      consumer: { scriptId: stagingConsumerScriptId },
      ...(stagingSpreadsheetUrl ? { spreadsheetUrl: stagingSpreadsheetUrl } : {}),
      shimValidation: shimValidation ?? { valid: null, updated: false, issue: 'shim validation not performed' },
      ...(sheetSync ? { sheetSync } : {}),
      ...(propertySync ? { propertySync } : {}),
      ...(stagingManifestWriteFailed ? {
        configWarning: `Staging environment IDs not persisted to dev manifest — prod promote will fail without override. `
          + `To promote to prod: deploy({to:"prod", scriptId, stagingSourceScriptId:"${stagingSourceScriptId}"})`
      } : storeResult.failures.length > 0 ? {
        configWarning: `ConfigManager failed for: ${storeResult.failures.join(', ')}.`
      } : {}),
    };
  }

  private async promoteToProd(scriptId: string, params: any, accessToken?: string): Promise<any> {
    const dryRun = !!params.dryRun;
    const envConfig = await this.getEnvironmentConfig(scriptId, accessToken);

    // Need staging source to read from — accept override for when manifest write failed
    const stagingSourceScriptId = params.stagingSourceScriptId || envConfig?.staging?.sourceScriptId;
    if (!stagingSourceScriptId) {
      throw new ValidationError('staging_source', 'not configured',
        'existing staging-source library — promote to staging first, '
        + 'or pass stagingSourceScriptId=<sourceScriptId from prior staging promote response>');
    }
    const usingOverride = !!params.stagingSourceScriptId && !envConfig?.staging?.sourceScriptId;

    let prodSourceScriptId = envConfig?.prod?.sourceScriptId;
    let prodConsumerScriptId = envConfig?.prod?.consumerScriptId;
    let prodSpreadsheetId = envConfig?.prod?.spreadsheetId;
    let prodManifestWriteFailed = false;

    // Auto-create prod environment if missing
    if (!prodSourceScriptId || !prodConsumerScriptId) {
      if (dryRun) {
        return {
          operation: 'promote',
          environment: 'prod',
          dryRun: true,
          wouldCreate: 'prod -source library + consumer (not yet configured)',
          note: 'Cannot fully preview — prod environment does not exist yet. Run without dryRun to auto-create.',
        };
      }
      console.error('🔧 Creating prod environment...');
      const consumer = await this.autoCreateConsumer(scriptId, 'prod', envConfig, accessToken);
      prodSourceScriptId = consumer.sourceScriptId;
      prodConsumerScriptId = consumer.consumerScriptId;
      prodSpreadsheetId = consumer.spreadsheetId;
      if (!consumer.manifestPersisted) prodManifestWriteFailed = true;
      console.error(`✅ Created prod: source=${prodSourceScriptId}, consumer=${prodConsumerScriptId}`);
    }

    // Read all files from staging-source
    const stagingFiles = await this.gasClient.getProjectContent(stagingSourceScriptId, accessToken);

    if (dryRun) {
      return {
        operation: 'promote',
        environment: 'prod',
        dryRun: true,
        sourceScriptId: prodSourceScriptId,
        wouldPush: `${stagingFiles.length} files from staging-source → prod-source`,
      };
    }

    // Push all files to prod-source (strip mcp_environments defensively — staging-source should not have it, but guard anyway)
    const prodFilesToPush = this.stripMcpEnvironments(stagingFiles);
    await this.gasClient.updateProjectContent(prodSourceScriptId!, prodFilesToPush, accessToken);
    console.error(`✅ Pushed ${stagingFiles.length} files to prod-source`);

    // Store promote timestamp (non-fatal)
    const storeResult = await this.storePromoteTimestamp(scriptId, 'prod', accessToken);

    // Validate/repair prod consumer shim — use staging-source manifest for scopes/timezone reference
    const stagingSourceManifestForShim = stagingFiles.find((f: GASFile) => f.name === 'appsscript');
    const stagingSourceManifestJsonForShim = stagingSourceManifestForShim?.source ? JSON.parse(stagingSourceManifestForShim.source) : {};
    // userSymbol: params takes precedence, then manifest-primary path (template.userSymbol),
    // then gas-config.json fallback path (top-level userSymbol), then derive from project name
    const prodUserSymbol = params.userSymbol || envConfig?.template?.userSymbol || envConfig?.userSymbol || await this.deriveUserSymbol(scriptId);
    if (!params.userSymbol && !envConfig?.template?.userSymbol && !envConfig?.userSymbol) {
      console.error(`⚠️  [shim validation] userSymbol not found in config — derived "${prodUserSymbol}" from project name. Verify this matches the library's intended namespace.`);
    }
    let shimValidation: any;
    if (prodConsumerScriptId) {
      shimValidation = await this.validateAndRepairConsumerShim(
        prodConsumerScriptId, prodSourceScriptId!, prodUserSymbol, stagingSourceManifestJsonForShim, accessToken
      );
    }

    // Sheet sync: staging → prod
    let sheetSync: any = undefined;
    if (params.syncSheets !== false) {
      const stagingSpreadsheetId = envConfig?.staging?.spreadsheetId;
      if (stagingSpreadsheetId && prodSpreadsheetId) {
        try {
          sheetSync = await this.syncSheets(stagingSpreadsheetId, prodSpreadsheetId, scriptId, accessToken);
        } catch (syncError: any) {
          console.error(`⚠️  Sheet sync failed: ${syncError.message}`);
          sheetSync = { error: syncError.message };
        }
      }
    }

    // Property sync: staging-source → prod-source (opt-in)
    let propertySync: any = undefined;
    if (params.syncProperties !== false) {
      try {
        propertySync = await this.doSyncProperties(
          stagingSourceScriptId, prodSourceScriptId!, accessToken,
          params.reconcileProperties === true,
          prodConsumerScriptId ?? undefined
        );
      } catch (syncError: any) {
        console.error(`⚠️  Property sync failed: ${syncError.message}`);
        propertySync = { error: syncError.message };
      }
    }

    const prodSpreadsheetUrl = prodSpreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${prodSpreadsheetId}`
      : null;

    return {
      operation: 'promote',
      environment: 'prod',
      sourceScriptId: prodSourceScriptId,
      filesPromoted: stagingFiles.length,
      description: params.description || null,
      consumer: { scriptId: prodConsumerScriptId },
      ...(prodSpreadsheetUrl ? { spreadsheetUrl: prodSpreadsheetUrl } : {}),
      note: 'Prod-source now has same code as staging-source',
      shimValidation: shimValidation ?? { valid: null, updated: false, issue: 'shim validation not performed' },
      ...(sheetSync ? { sheetSync } : {}),
      ...(propertySync ? { propertySync } : {}),
      ...(usingOverride && !sheetSync ? { sheetSyncSkipped: 'staging spreadsheet ID unknown (override mode)' } : {}),
      ...(prodManifestWriteFailed ? {
        configWarning: `Prod environment IDs not persisted to dev manifest. `
          + `Run deploy({operation:"status", scriptId}) to verify environment state.`
      } : storeResult.failures.length > 0 ? {
        configWarning: `ConfigManager failed for: ${storeResult.failures.join(', ')}.`
      } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  private async handleStatus(scriptId: string, params: any, accessToken?: string): Promise<any> {
    const envConfig = await this.getEnvironmentConfig(scriptId, accessToken);

    // Read promote timestamps from ConfigManager
    const stagingPromotedAt = await this.getConfigManagerValue(scriptId, CONFIG_KEYS.staging.promotedAt, accessToken).catch(() => null);
    const prodPromotedAt = await this.getConfigManagerValue(scriptId, CONFIG_KEYS.prod.promotedAt, accessToken).catch(() => null);

    // Verify consumer manifests reference correct -source libraries
    const discrepancies: string[] = [];

    for (const env of ['staging', 'prod'] as const) {
      const sourceScriptId = envConfig?.[env]?.sourceScriptId;
      const consumerScriptId = envConfig?.[env]?.consumerScriptId;
      if (sourceScriptId && consumerScriptId) {
        try {
          const files = await this.gasClient.getProjectContent(consumerScriptId, accessToken);
          const manifest = files.find((f: GASFile) => f.name === 'appsscript');
          if (manifest?.source) {
            const manifestJson = JSON.parse(manifest.source);
            const lib = manifestJson.dependencies?.libraries?.find(
              (l: any) => l.libraryId === sourceScriptId
            );
            if (!lib) {
              discrepancies.push(`${env}: consumer does not reference ${env}-source library ${sourceScriptId}`);
            } else if (!lib.developmentMode) {
              discrepancies.push(`${env}: consumer library reference missing developmentMode: true`);
            }
          }
        } catch (error: any) {
          console.error(`⚠️  Could not verify ${env} consumer: ${error.message}`);
        }
      }
    }

    return {
      operation: 'status',
      dev: { scriptId, description: 'Main library — all source code lives here' },
      staging: envConfig?.staging?.sourceScriptId
        ? {
            sourceScriptId: envConfig.staging.sourceScriptId,
            consumerScriptId: envConfig.staging.consumerScriptId,
            spreadsheetId: envConfig.staging.spreadsheetId,
            spreadsheetUrl: envConfig.staging.spreadsheetId
              ? `https://docs.google.com/spreadsheets/d/${envConfig.staging.spreadsheetId}`
              : null,
            lastPromotedAt: stagingPromotedAt || null,
          }
        : { configured: false },
      prod: envConfig?.prod?.sourceScriptId
        ? {
            sourceScriptId: envConfig.prod.sourceScriptId,
            consumerScriptId: envConfig.prod.consumerScriptId,
            spreadsheetId: envConfig.prod.spreadsheetId,
            spreadsheetUrl: envConfig.prod.spreadsheetId
              ? `https://docs.google.com/spreadsheets/d/${envConfig.prod.spreadsheetId}`
              : null,
            lastPromotedAt: prodPromotedAt || null,
          }
        : { configured: false },
      ...(discrepancies.length > 0 ? { discrepancies } : {}),
      // manifest-primary path stores userSymbol at template.userSymbol; gas-config.json path at top-level
      userSymbol: envConfig?.template?.userSymbol || envConfig?.userSymbol || null,
    };
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  private async handleSetup(scriptId: string, params: any, accessToken?: string): Promise<any> {
    const userSymbol = params.userSymbol || await this.deriveUserSymbol(scriptId);
    const templateScriptId = params.templateScriptId;

    if (!templateScriptId) {
      throw new ValidationError('templateScriptId', undefined, 'container-bound script ID of the dev/template spreadsheet');
    }

    if (templateScriptId === scriptId) {
      throw new ValidationError('templateScriptId', templateScriptId, 'a different project than the library scriptId — a project cannot be its own library dependency');
    }

    const lockManager = LockManager.getInstance();
    await lockManager.acquireLock(templateScriptId, 'deploy-setup');
    try {

    // Read template's current manifest
    const templateFiles = await this.gasClient.getProjectContent(templateScriptId, accessToken);
    const manifest = templateFiles.find((f: GASFile) => f.name === 'appsscript');
    if (!manifest?.source) {
      throw new GASApiError('Could not read template appsscript.json');
    }

    const manifestJson = JSON.parse(manifest.source);

    // Add/update library reference: version "0", developmentMode: true
    if (!manifestJson.dependencies) {
      manifestJson.dependencies = {};
    }
    if (!manifestJson.dependencies.libraries) {
      manifestJson.dependencies.libraries = [];
    }

    const existingLib = manifestJson.dependencies.libraries.find(
      (lib: any) => lib.libraryId === scriptId
    );
    if (existingLib) {
      existingLib.version = '0';
      existingLib.developmentMode = true;
      existingLib.userSymbol = userSymbol;
    } else {
      manifestJson.dependencies.libraries.push({
        userSymbol,
        libraryId: scriptId,
        version: '0',
        developmentMode: true,
      });
    }

    // Build updated file list — apply manifest update and add Code.gs shim if absent
    const hasCodeGs = templateFiles.some((f: GASFile) => f.name === 'Code');
    const updatedFiles: GASFile[] = [
      ...templateFiles.map((f: GASFile) =>
        f.name === 'appsscript' ? { ...f, source: JSON.stringify(manifestJson, null, 2) } : f
      ),
      ...(hasCodeGs ? [] : [{ name: 'Code', type: 'SERVER_JS' as const, source: this.generateThinShim(userSymbol) }]),
    ];

    // Single write: manifest + optional shim together
    await this.gasClient.updateProjectContent(templateScriptId, updatedFiles, accessToken);
    console.error(`✅ Template updated — library @ HEAD with userSymbol "${userSymbol}"${hasCodeGs ? '' : ' + thin shim Code.gs added'}`);

    // Save config
    const config = await McpGasConfigManager.getConfig();
    const projectEntry = this.findProjectByScriptId(config, scriptId);
    if (projectEntry) {
      if (!projectEntry.environments) {
        projectEntry.environments = {};
      }
      projectEntry.environments.templateScriptId = templateScriptId;
      projectEntry.environments.userSymbol = userSymbol;
      try {
        await McpGasConfigManager.saveConfig(config);
        console.error('✅ Saved template config to gas-config.json');
      } catch (saveError: any) {
        console.error(`⚠️  [handleSetup] Failed to save to gas-config.json: ${saveError.message} — continuing (mcp_environments manifest write is authoritative)`);
      }
    }

    // Persist template info to dev project's appsscript.json under mcp_environments.template
    try {
      const devFiles = await this.gasClient.getProjectContent(scriptId, accessToken);
      const devManifest = devFiles.find((f: GASFile) => f.name === 'appsscript');
      if (devManifest?.source) {
        const devJson = JSON.parse(devManifest.source);
        if (!devJson.mcp_environments) devJson.mcp_environments = {};
        devJson.mcp_environments.template = { scriptId: templateScriptId, userSymbol };
        const updatedDevFiles = devFiles.map((f: GASFile) =>
          f.name === 'appsscript' ? { ...f, source: JSON.stringify(devJson, null, 2) } : f
        );
        await this.gasClient.updateProjectContent(scriptId, updatedDevFiles, accessToken);
        console.error(`✅ Written mcp_environments.template to dev project manifest`);
      }
    } catch (e: any) {
      console.error(`⚠️  Failed to write mcp_environments.template to dev manifest: ${e.message}`);
    }

    // Store in ConfigManager (non-fatal — setup succeeded even if this fails)
    const configFailures: string[] = [];
    try {
      await this.setConfigManagerValue(scriptId, 'TEMPLATE_SCRIPT_ID', templateScriptId, accessToken);
    } catch (error: any) {
      console.error(`⚠️  Failed to store TEMPLATE_SCRIPT_ID: ${error.message}`);
      configFailures.push('TEMPLATE_SCRIPT_ID');
    }
    try {
      await this.setConfigManagerValue(scriptId, 'USER_SYMBOL', userSymbol, accessToken);
    } catch (error: any) {
      console.error(`⚠️  Failed to store USER_SYMBOL: ${error.message}`);
      configFailures.push('USER_SYMBOL');
    }

    return {
      operation: 'setup',
      templateScriptId,
      userSymbol,
      libraryScriptId: scriptId,
      libraryReference: { version: '0', developmentMode: true },
      message: `Template wired to library @ HEAD. Next: deploy({to:"staging", scriptId:"${scriptId}"})`,
      ...(configFailures.length > 0 ? {
        configWarning: `ConfigManager failed for: ${configFailures.join(', ')}. Setup succeeded but remote config may be incomplete.`
      } : {}),
    };

    } finally {
      await lockManager.releaseLock(templateScriptId);
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-create environment (-source library + consumer)
  // ---------------------------------------------------------------------------

  private async autoCreateConsumer(
    libraryScriptId: string,
    environment: LibraryEnvironment,
    envConfig: any,
    accessToken?: string
  ): Promise<{ consumerScriptId: string; spreadsheetId: string; sourceScriptId: string; manifestPersisted: boolean }> {
    // Re-check manifest in case IDs were written between config read and this call
    const latestConfig = await this.getEnvironmentConfig(libraryScriptId, accessToken);
    const existing = latestConfig?.[environment];
    if (existing?.sourceScriptId && existing?.consumerScriptId && existing?.spreadsheetId) {
      console.error(`✅ ${environment} environment already exists in manifest — skipping creation`);
      return {
        sourceScriptId: existing.sourceScriptId,
        consumerScriptId: existing.consumerScriptId,
        spreadsheetId: existing.spreadsheetId,
        manifestPersisted: true,
      };
    }

    // ConfigManager fallback — IDs may have been stored there despite manifest write failing
    const cmSourceId = await this.getConfigManagerValue(
      libraryScriptId, CONFIG_KEYS[environment].sourceScriptId, accessToken);
    const cmConsumerId = await this.getConfigManagerValue(
      libraryScriptId, CONFIG_KEYS[environment].scriptId, accessToken);
    const cmSpreadsheetId = await this.getConfigManagerValue(
      libraryScriptId, CONFIG_KEYS[environment].spreadsheetUrl, accessToken);

    if (cmSourceId && cmConsumerId) {
      console.error(`ℹ️  [autoCreateConsumer] Recovering ${environment} IDs from ConfigManager (skipping new creation)`);
      const recoveredIds = { sourceScriptId: cmSourceId, consumerScriptId: cmConsumerId, spreadsheetId: cmSpreadsheetId || '' };
      let manifestPersisted = false;
      try {
        await this.updateDevManifestWithEnvironmentIds(libraryScriptId, environment, recoveredIds, accessToken);
        console.error(`✅ Healed mcp_environments.${environment} in dev manifest from ConfigManager`);
        manifestPersisted = true;
      } catch (e: any) {
        console.error(`⚠️  Could not heal manifest from ConfigManager: ${e.message}`);
      }
      return { ...recoveredIds, manifestPersisted };
    }

    // manifest-primary path stores userSymbol at template.userSymbol; gas-config.json path at top-level
    const userSymbol = envConfig?.template?.userSymbol || envConfig?.userSymbol
      || latestConfig?.template?.userSymbol || latestConfig?.userSymbol
      || await this.deriveUserSymbol(libraryScriptId);
    const tag = environment === 'staging' ? 'STAGING' : 'PROD';
    const projectName = await this.getProjectName(libraryScriptId);

    // 1. Read main library manifest once (used for consumer scopes/timezone)
    //    Do NOT push files here — the caller's promote flow handles the file push.
    const libraryFiles = await this.gasClient.getProjectContent(libraryScriptId, accessToken);
    const libraryManifest = libraryFiles.find((f: GASFile) => f.name === 'appsscript');
    const libraryManifestJson = libraryManifest?.source ? JSON.parse(libraryManifest.source) : {};

    // 2. Create standalone -source library (empty — caller will push files)
    const sourceTitle = `${projectName} [${tag}-SOURCE]`;
    const sourceScriptId = await this.createStandaloneProject(sourceTitle, accessToken);
    console.error(`✅ Created ${tag}-source library: ${sourceScriptId}`);

    // 3. Create blank spreadsheet for consumer
    const sheetTitle = `${projectName} [${tag}]`;
    const spreadsheetId = await this.createBlankSpreadsheet(sheetTitle, accessToken);

    // 4. Create container-bound script in spreadsheet
    const consumerScriptId = await this.createContainerBoundScript(spreadsheetId, sheetTitle, accessToken);

    // 5. Write thin shim to consumer referencing -source library (no CommonJS — consumers are thin shims)
    //    Use main library manifest for scopes/timezone since -source is empty at this point.
    await this.writeConsumerShim(consumerScriptId, sourceScriptId, userSymbol, libraryManifestJson, accessToken);
    console.error(`✅ Consumer shim written for ${environment}`);

    // 6. Save to local config (migration bridge + no-token fallback)
    //    The authoritative store is the dev project's appsscript.json (step 8 below).
    //    This write keeps gas-config.json usable as a local cache for the legacy fallback
    //    path in getEnvironmentConfig() when no accessToken is available.
    const config = await McpGasConfigManager.getConfig();
    const projectEntry = this.findProjectByScriptId(config, libraryScriptId);
    if (projectEntry) {
      if (!projectEntry.environments) projectEntry.environments = {};
      projectEntry.environments[environment] = {
        consumerScriptId,
        spreadsheetId,
        sourceScriptId,
      };
      try {
        await McpGasConfigManager.saveConfig(config);
      } catch (saveError: any) {
        // Non-fatal: manifest is the authoritative store (step 8); gas-config.json is a local cache
        console.error(`⚠️  [autoCreateConsumer] Failed to save environment to gas-config.json: ${saveError.message} — continuing (manifest write at step 8 is authoritative)`);
      }
    }

    // 7. Store in ConfigManager (non-fatal — environment already created)
    const configKeys: Array<[string, string]> = [
      [CONFIG_KEYS[environment].scriptId, consumerScriptId],
      [CONFIG_KEYS[environment].sourceScriptId, sourceScriptId],
      [CONFIG_KEYS[environment].spreadsheetUrl, spreadsheetId],
    ];
    for (const [key, value] of configKeys) {
      try {
        await this.setConfigManagerValue(libraryScriptId, key, value, accessToken);
      } catch (error: any) {
        console.error(`⚠️  Failed to store ${key} in ConfigManager: ${error.message}`);
      }
    }

    // 8. Persist IDs to dev project's appsscript.json (sole source of truth for environment IDs)
    let manifestPersisted = false;
    try {
      await this.updateDevManifestWithEnvironmentIds(
        libraryScriptId, environment, { sourceScriptId, consumerScriptId, spreadsheetId }, accessToken
      );
      console.error(`✅ Written mcp_environments.${environment} to dev project manifest`);
      manifestPersisted = true;
    } catch (e: any) {
      console.error(`⚠️  Failed to write mcp_environments to dev manifest: ${e.message}`);
    }

    return { consumerScriptId, spreadsheetId, sourceScriptId, manifestPersisted };
  }

  private async createStandaloneProject(
    title: string,
    accessToken?: string
  ): Promise<string> {
    const token = accessToken || await this.getAuthTokenFallback();
    const createResponse = await fetch('https://script.googleapis.com/v1/projects', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new GASApiError(`Failed to create standalone project: ${createResponse.status} ${errorText}`);
    }

    const project = await createResponse.json();
    console.error(`✅ Created standalone project: ${project.scriptId} (${title})`);
    return project.scriptId;
  }

  private async createBlankSpreadsheet(
    title: string,
    accessToken?: string
  ): Promise<string> {
    const token = accessToken || await this.getAuthTokenFallback();
    const createResponse = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { title },
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new GASApiError(`Failed to create spreadsheet via Sheets API: ${createResponse.status} ${errorText}`);
    }

    const spreadsheet = await createResponse.json();
    console.error(`✅ Created spreadsheet: ${spreadsheet.spreadsheetId} (${title})`);
    return spreadsheet.spreadsheetId;
  }

  private async createContainerBoundScript(
    spreadsheetId: string,
    title: string,
    accessToken?: string
  ): Promise<string> {
    const token = accessToken || await this.getAuthTokenFallback();
    const createResponse = await fetch('https://script.googleapis.com/v1/projects', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: `${title} Script`,
        parentId: spreadsheetId,
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new GASApiError(`Failed to create container-bound script: ${createResponse.status} ${errorText}`);
    }

    const project = await createResponse.json();
    console.error(`✅ Created container-bound script: ${project.scriptId}`);
    return project.scriptId;
  }

  /**
   * Write thin shim and manifest to a consumer project.
   * Always uses developmentMode: true — consumer resolves to -source library at HEAD.
   *
   * @param sourceManifestJson - Pre-fetched manifest from the source library (for scopes/timezone).
   *   Pass the main library manifest when creating a new environment (avoids re-reading empty -source).
   */
  private async writeConsumerShim(
    consumerScriptId: string,
    sourceScriptId: string,
    userSymbol: string,
    sourceManifestJson: Record<string, any>,
    accessToken?: string
  ): Promise<void> {
    this.validateUserSymbol(userSymbol);

    // Build consumer manifest — always developmentMode: true
    const consumerManifest = {
      timeZone: sourceManifestJson.timeZone || 'America/New_York',
      dependencies: {
        libraries: [
          {
            userSymbol,
            libraryId: sourceScriptId,
            version: '0',
            developmentMode: true,
          },
        ],
      },
      exceptionLogging: 'STACKDRIVER',
      runtimeVersion: 'V8',
      // Copy OAuth scopes from source library
      ...(sourceManifestJson.oauthScopes ? { oauthScopes: sourceManifestJson.oauthScopes } : {}),
    };

    const shimSource = this.generateThinShim(userSymbol);

    const files: GASFile[] = [
      { name: 'appsscript', type: 'JSON' as const, source: JSON.stringify(consumerManifest, null, 2) },
      { name: 'Code', type: 'SERVER_JS' as const, source: shimSource },
    ];

    await this.gasClient.updateProjectContent(consumerScriptId, files, accessToken);
  }

  // ---------------------------------------------------------------------------
  // Thin shim generation
  // ---------------------------------------------------------------------------

  private validateUserSymbol(userSymbol: string): void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(userSymbol)) {
      throw new ValidationError('userSymbol', userSymbol, 'valid JavaScript identifier (letters, numbers, underscores only)');
    }
  }

  private generateThinShim(userSymbol: string): string {
    this.validateUserSymbol(userSymbol);
    return `// Thin shim — delegates all events to library via ${userSymbol}
// Do NOT add CommonJS or require() here — library handles modules internally

function onOpen(e) {
  ${userSymbol}.onOpen(e);
}

function onInstall(e) {
  onOpen(e);
}

function onEdit(e) {
  ${userSymbol}.onEdit(e);
}

function exec_api(options, moduleName, functionName) {
  return ${userSymbol}.exec_api.apply(null, arguments);
}

function showSidebar() {
  ${userSymbol}.showSidebar(SpreadsheetApp.getUi());
}

function initialize() {
  ${userSymbol}.initialize();
}

// Menu handler stubs — add more as needed
function menuAction1() { ${userSymbol}.menuAction1(); }
function menuAction2() { ${userSymbol}.menuAction2(); }
`;
  }

  // ---------------------------------------------------------------------------
  // Sheet Sync
  // ---------------------------------------------------------------------------

  /**
   * Sync spreadsheet sheets from source to target.
   *
   * Strategy (match by sheet name):
   *   1. Source sheet matches target → replace (copy fresh, delete old, rename)
   *   2. Source sheet no match → copy to target
   *   3. Target sheet no match → leave untouched
   *
   * Uses sheet.copyTo(target) to preserve formulas, formatting, data validation,
   * and conditional formatting.
   */
  private async syncSheets(
    sourceSpreadsheetId: string,
    targetSpreadsheetId: string,
    scriptId: string,
    accessToken?: string
  ): Promise<any> {
    // Validate IDs before embedding in GAS script string to prevent injection
    const SPREADSHEET_ID_RE = /^[A-Za-z0-9_-]{25,60}$/;
    if (!SPREADSHEET_ID_RE.test(sourceSpreadsheetId) || !SPREADSHEET_ID_RE.test(targetSpreadsheetId)) {
      throw new ValidationError('spreadsheetId', `${sourceSpreadsheetId}|${targetSpreadsheetId}`, 'valid Sheets ID (alphanumeric, hyphens, underscores, 25-60 chars)');
    }

    console.error(`🔄 Syncing sheets: ${sourceSpreadsheetId} → ${targetSpreadsheetId}`);

    // Execute via GAS — copyTo preserves formulas, formatting, data validation
    const js_statement = `
      var source = SpreadsheetApp.openById('${sourceSpreadsheetId}');
      var target = SpreadsheetApp.openById('${targetSpreadsheetId}');
      var sourceSheets = source.getSheets();
      var targetSheets = target.getSheets();
      var targetNames = targetSheets.map(function(s) { return s.getName(); });
      var synced = [], added = [], skipped = [];

      for (var i = 0; i < sourceSheets.length; i++) {
        var srcSheet = sourceSheets[i];
        var name = srcSheet.getName();
        var copied = srcSheet.copyTo(target);

        var targetIdx = targetNames.indexOf(name);
        if (targetIdx !== -1) {
          // Replace: delete old, rename copy
          target.deleteSheet(targetSheets[targetIdx]);
          copied.setName(name);
          synced.push(name);
        } else {
          // New sheet
          copied.setName(name);
          added.push(name);
        }
      }

      // Collect names of target sheets not in source (left untouched)
      var sourceNames = sourceSheets.map(function(s) { return s.getName(); });
      for (var j = 0; j < targetNames.length; j++) {
        if (sourceNames.indexOf(targetNames[j]) === -1) {
          skipped.push(targetNames[j]);
        }
      }

      Logger.log(JSON.stringify({ synced: synced, added: added, skipped: skipped }));
    `;

    const result = await this.execTool.execute({
      scriptId,
      js_statement,
      autoRedeploy: false,
      accessToken,
    });

    // Parse the sync result from Logger output
    let syncResult: any = { source: sourceSpreadsheetId, target: targetSpreadsheetId };
    try {
      if (result?.logger_output) {
        const parsed = JSON.parse(result.logger_output);
        syncResult = { ...syncResult, ...parsed };
      }
    } catch {
      // Best-effort parsing
    }

    console.error(`✅ Sheet sync complete: ${syncResult.synced?.length || 0} synced, ${syncResult.added?.length || 0} added, ${syncResult.skipped?.length || 0} skipped`);
    return syncResult;
  }

  // ---------------------------------------------------------------------------
  // Property Sync
  // ---------------------------------------------------------------------------

  /**
   * Sync ConfigManager-managed properties (script + doc scopes) from source to target.
   *
   * Reads only PropertiesService.getScriptProperties() and getDocumentProperties()
   * — the two backing stores for ConfigManager's non-user scopes. User properties
   * (getUserProperties, which backs ConfigManager's 'user' and 'userDoc' scopes) are
   * intentionally excluded: they are per-user and should never travel with a deployment.
   *
   * Infrastructure keys in MANAGED_PROPERTY_KEYS are excluded to avoid overwriting
   * environment-specific config in the target.
   *
   * Non-fatal: per-key failures are collected and returned, never thrown.
   */
  private async doSyncProperties(
    sourceScriptId: string,
    targetScriptId: string,
    accessToken?: string,
    reconcile: boolean = false,
    consumerScriptId?: string
  ): Promise<{
    source: string; target: string;
    synced: string[]; skipped: string[]; deleted?: string[]; errors?: string[];
    consumerSync?: { synced: string[]; skipped: string[]; deleted?: string[]; errors?: string[] };
  }> {
    // Read script-scope and doc-scope properties from source.
    // Explicitly excludes getUserProperties (user + userDoc scopes) — per-user, not portable.
    const readResult = await this.execTool.execute({
      scriptId: sourceScriptId,
      js_statement: `
        var scriptProps = PropertiesService.getScriptProperties().getProperties() || {};
        var docPropsService = PropertiesService.getDocumentProperties();
        var docProps = docPropsService ? (docPropsService.getProperties() || {}) : {};
        Logger.log(JSON.stringify({ script: scriptProps, doc: docProps }));
      `,
      autoRedeploy: false,
      accessToken,
    });

    let scriptProps: Record<string, string> = {};
    let docProps: Record<string, string> = {};
    try {
      if (readResult?.logger_output) {
        const parsed = JSON.parse(readResult.logger_output);
        scriptProps = parsed.script || {};
        docProps = parsed.doc || {};
      }
    } catch { /* best-effort */ }

    const scriptEntries = Object.entries(scriptProps).filter(([k]) => !MANAGED_PROPERTY_KEYS.has(k));
    const docEntries    = Object.entries(docProps).filter(([k]) => !MANAGED_PROPERTY_KEYS.has(k));
    const skipped = [
      ...Object.keys(scriptProps).filter(k => MANAGED_PROPERTY_KEYS.has(k)),
      ...Object.keys(docProps).filter(k => MANAGED_PROPERTY_KEYS.has(k)),
    ];

    const synced: string[] = [];
    const errors: string[] = [];
    const deleted: string[] = [];
    // Consumer sync tracking (populated by reconcile block + write block below)
    const consumerSynced: string[] = [];
    const consumerDeleted: string[] = [];
    const consumerErrors: string[] = [];

    // Reconcile: delete target-only keys not present in source and not managed infrastructure.
    // Makes target an exact mirror of source for user-managed properties.
    if (reconcile) {
      const targetReadResult = await this.execTool.execute({
        scriptId: targetScriptId,
        js_statement: `
          var scriptProps = PropertiesService.getScriptProperties().getProperties() || {};
          var docPropsService = PropertiesService.getDocumentProperties();
          var docProps = docPropsService ? (docPropsService.getProperties() || {}) : {};
          Logger.log(JSON.stringify({ script: scriptProps, doc: docProps }));
        `,
        autoRedeploy: false,
        accessToken,
      });

      let targetScriptProps: Record<string, string> = {};
      let targetDocProps: Record<string, string> = {};
      try {
        if (targetReadResult?.logger_output) {
          const parsed = JSON.parse(targetReadResult.logger_output);
          targetScriptProps = parsed.script || {};
          targetDocProps = parsed.doc || {};
        }
      } catch { /* best-effort */ }

      const sourceScriptKeys = new Set(Object.keys(scriptProps));
      const sourceDocKeys = new Set(Object.keys(docProps));

      const scriptExtras = Object.keys(targetScriptProps).filter(
        k => !sourceScriptKeys.has(k) && !MANAGED_PROPERTY_KEYS.has(k)
      );
      const docExtras = Object.keys(targetDocProps).filter(
        k => !sourceDocKeys.has(k) && !MANAGED_PROPERTY_KEYS.has(k)
      );

      if (scriptExtras.length > 0) {
        try {
          // Double-encode: outer JSON.stringify makes this a safe JS string literal
          // embedded in source code; GAS does JSON.parse twice to recover the array.
          const keysJson = JSON.stringify(JSON.stringify(scriptExtras));
          await this.execTool.execute({
            scriptId: targetScriptId,
            js_statement: `
              var keys = JSON.parse(JSON.parse(${keysJson}));
              var sp = PropertiesService.getScriptProperties();
              keys.forEach(function(k) { sp.deleteProperty(k); });
            `,
            autoRedeploy: false,
            accessToken,
          });
          deleted.push(...scriptExtras);
        } catch (err: any) {
          console.error(`⚠️  syncProperties reconcile: failed to delete script extras: ${err.message}`);
          errors.push(...scriptExtras.map(k => `delete:${k}`));
        }
      }

      if (docExtras.length > 0) {
        try {
          const keysJson = JSON.stringify(JSON.stringify(docExtras));
          await this.execTool.execute({
            scriptId: targetScriptId,
            js_statement: `
              var keys = JSON.parse(JSON.parse(${keysJson}));
              var dp = PropertiesService.getDocumentProperties();
              if (dp) { keys.forEach(function(k) { dp.deleteProperty(k); }); }
            `,
            autoRedeploy: false,
            accessToken,
          });
          deleted.push(...docExtras.map(k => `doc:${k}`));
        } catch (err: any) {
          console.error(`⚠️  syncProperties reconcile: failed to delete doc extras: ${err.message}`);
          errors.push(...docExtras.map(k => `delete:doc:${k}`));
        }
      }

      // Consumer reconcile — delete consumer-only extras not present in source (non-fatal)
      if (consumerScriptId) {
        try {
          const consumerReadResult = await this.execTool.execute({
            scriptId: consumerScriptId,
            js_statement: `
              var scriptProps = PropertiesService.getScriptProperties().getProperties() || {};
              var docPropsService = PropertiesService.getDocumentProperties();
              var docProps = docPropsService ? (docPropsService.getProperties() || {}) : {};
              Logger.log(JSON.stringify({ script: scriptProps, doc: docProps }));
            `,
            autoRedeploy: false,
            accessToken,
          });

          let consumerScriptProps: Record<string, string> = {};
          let consumerDocProps: Record<string, string> = {};
          try {
            if (consumerReadResult?.logger_output) {
              const parsed = JSON.parse(consumerReadResult.logger_output);
              consumerScriptProps = parsed.script || {};
              consumerDocProps = parsed.doc || {};
            }
          } catch { /* best-effort */ }

          const sourceScriptKeys = new Set(Object.keys(scriptProps));
          const sourceDocKeys = new Set(Object.keys(docProps));

          const consumerScriptExtras = Object.keys(consumerScriptProps).filter(
            k => !sourceScriptKeys.has(k) && !MANAGED_PROPERTY_KEYS.has(k)
          );
          const consumerDocExtras = Object.keys(consumerDocProps).filter(
            k => !sourceDocKeys.has(k) && !MANAGED_PROPERTY_KEYS.has(k)
          );

          if (consumerScriptExtras.length > 0) {
            try {
              const keysJson = JSON.stringify(JSON.stringify(consumerScriptExtras));
              await this.execTool.execute({
                scriptId: consumerScriptId,
                js_statement: `
                  var keys = JSON.parse(JSON.parse(${keysJson}));
                  var sp = PropertiesService.getScriptProperties();
                  keys.forEach(function(k) { sp.deleteProperty(k); });
                `,
                autoRedeploy: false,
                accessToken,
              });
              consumerDeleted.push(...consumerScriptExtras);
            } catch (err: any) {
              console.error(`⚠️  consumer syncProperties reconcile: failed to delete script extras: ${err.message}`);
              consumerErrors.push(...consumerScriptExtras.map(k => `delete:${k}`));
            }
          }

          if (consumerDocExtras.length > 0) {
            try {
              const keysJson = JSON.stringify(JSON.stringify(consumerDocExtras));
              await this.execTool.execute({
                scriptId: consumerScriptId,
                js_statement: `
                  var keys = JSON.parse(JSON.parse(${keysJson}));
                  var dp = PropertiesService.getDocumentProperties();
                  if (dp) { keys.forEach(function(k) { dp.deleteProperty(k); }); }
                `,
                autoRedeploy: false,
                accessToken,
              });
              consumerDeleted.push(...consumerDocExtras.map(k => `doc:${k}`));
            } catch (err: any) {
              console.error(`⚠️  consumer syncProperties reconcile: failed to delete doc extras: ${err.message}`);
              consumerErrors.push(...consumerDocExtras.map(k => `delete:doc:${k}`));
            }
          }
        } catch (err: any) {
          console.error(`⚠️  consumer syncProperties reconcile: failed to read consumer props: ${err.message}`);
          consumerErrors.push('reconcile:read-failed');
        }
      }
    }

    if (scriptEntries.length === 0 && docEntries.length === 0) {
      console.error(`✅ Property sync: 0 copied, ${skipped.length} skipped (managed), ${deleted.length} deleted, ${errors.length} errors`);
      const earlyConsumerSync = consumerScriptId ? {
        synced: consumerSynced,
        skipped: [...skipped],
        ...(consumerDeleted.length ? { deleted: consumerDeleted } : {}),
        ...(consumerErrors.length ? { errors: consumerErrors } : {}),
      } : undefined;
      return {
        source: sourceScriptId, target: targetScriptId, synced: [], skipped,
        ...(deleted.length ? { deleted } : {}),
        ...(errors.length ? { errors } : {}),
        ...(earlyConsumerSync ? { consumerSync: earlyConsumerSync } : {}),
      };
    }

    // Write script-scope properties via ConfigManager.setScript
    for (const [key, value] of scriptEntries) {
      try {
        await this.setConfigManagerValue(targetScriptId, key, value, accessToken);
        synced.push(key);
      } catch (err: any) {
        console.error(`⚠️  syncProperties: failed to copy script.${key}: ${err.message}`);
        errors.push(key);
      }
    }

    // Write doc-scope properties via ConfigManager.setDocument
    for (const [key, value] of docEntries) {
      try {
        await this.setDocConfigManagerValue(targetScriptId, key, value, accessToken);
        synced.push(`doc:${key}`);
      } catch (err: any) {
        console.error(`⚠️  syncProperties: failed to copy doc.${key}: ${err.message}`);
        errors.push(`doc:${key}`);
      }
    }

    // Sync to consumer (direct PropertiesService — consumer has no ConfigManager installed)
    if (consumerScriptId) {
      // Write script-scope properties to consumer in a single batch
      if (scriptEntries.length > 0) {
        try {
          const propsToSet = Object.fromEntries(scriptEntries);
          const propsJson = JSON.stringify(JSON.stringify(propsToSet));
          await this.execTool.execute({
            scriptId: consumerScriptId,
            js_statement: `
              var props = JSON.parse(JSON.parse(${propsJson}));
              PropertiesService.getScriptProperties().setProperties(props, false);
            `,
            autoRedeploy: false,
            accessToken,
          });
          consumerSynced.push(...scriptEntries.map(([k]) => k));
        } catch (err: any) {
          console.error(`⚠️  consumer syncProperties: failed to write script props: ${err.message}`);
          consumerErrors.push(...scriptEntries.map(([k]) => k));
        }
      }

      // Write doc-scope properties to consumer
      if (docEntries.length > 0) {
        try {
          const docPropsToSet = Object.fromEntries(docEntries);
          const docPropsJson = JSON.stringify(JSON.stringify(docPropsToSet));
          await this.execTool.execute({
            scriptId: consumerScriptId,
            js_statement: `
              var dp = PropertiesService.getDocumentProperties();
              if (dp) {
                var props = JSON.parse(JSON.parse(${docPropsJson}));
                dp.setProperties(props, false);
              }
            `,
            autoRedeploy: false,
            accessToken,
          });
          consumerSynced.push(...docEntries.map(([k]) => `doc:${k}`));
        } catch (err: any) {
          console.error(`⚠️  consumer syncProperties: failed to write doc props: ${err.message}`);
          consumerErrors.push(...docEntries.map(([k]) => `doc:${k}`));
        }
      }
    }

    const finalConsumerSync = consumerScriptId ? {
      synced: consumerSynced,
      skipped: [...skipped],
      ...(consumerDeleted.length ? { deleted: consumerDeleted } : {}),
      ...(consumerErrors.length ? { errors: consumerErrors } : {}),
    } : undefined;

    console.error(`✅ Property sync: ${synced.length} copied, ${skipped.length} skipped (managed), ${deleted.length} deleted, ${errors.length} errors`);
    return {
      source: sourceScriptId, target: targetScriptId, synced, skipped,
      ...(deleted.length ? { deleted } : {}),
      ...(errors.length ? { errors } : {}),
      ...(finalConsumerSync ? { consumerSync: finalConsumerSync } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // ConfigManager operations (via GAS exec)
  // ---------------------------------------------------------------------------

  private async getConfigManagerValue(
    scriptId: string,
    key: string,
    accessToken?: string
  ): Promise<string | null> {
    try {
      const result = await this.gasClient.executeFunction(
        scriptId,
        'exec_api',
        [null, 'ConfigManager', 'getScript', key],
        accessToken
      );
      if (result.error) return null;
      const response = result.result;
      return response?.success ? response.result : null;
    } catch {
      return null;
    }
  }

  private async setConfigManagerValue(
    scriptId: string,
    key: string,
    value: string,
    accessToken?: string
  ): Promise<void> {
    const result = await this.gasClient.executeFunction(
      scriptId,
      'exec_api',
      [null, 'ConfigManager', 'setScript', key, value],
      accessToken
    );
    if (result.error) {
      throw new GASApiError(`ConfigManager.setScript('${key}') failed: ${result.error}`);
    }
  }

  private async setDocConfigManagerValue(
    scriptId: string,
    key: string,
    value: string,
    accessToken?: string
  ): Promise<void> {
    const result = await this.gasClient.executeFunction(
      scriptId,
      'exec_api',
      [null, 'ConfigManager', 'setDocument', key, value],
      accessToken
    );
    if (result.error) {
      throw new GASApiError(`ConfigManager.setDocument('${key}') failed: ${result.error}`);
    }
  }

  private async storePromoteTimestamp(
    scriptId: string,
    environment: LibraryEnvironment,
    accessToken?: string
  ): Promise<{ failures: string[] }> {
    const keys = CONFIG_KEYS[environment];
    const failures: string[] = [];

    try {
      await this.setConfigManagerValue(scriptId, keys.promotedAt, new Date().toISOString(), accessToken);
    } catch (error: any) {
      console.error(`⚠️  Failed to store ${keys.promotedAt}: ${error.message}`);
      failures.push(keys.promotedAt);
    }

    return { failures };
  }

  // ---------------------------------------------------------------------------
  // Config helpers
  // ---------------------------------------------------------------------------

  /**
   * Write environment IDs into the dev project's appsscript.json under mcp_environments.
   * This is the sole source of truth for environment IDs — portable across machines/git clones.
   */
  private async updateDevManifestWithEnvironmentIds(
    devScriptId: string,
    environment: LibraryEnvironment,
    ids: { sourceScriptId: string; consumerScriptId: string; spreadsheetId: string },
    accessToken?: string
  ): Promise<void> {
    const files = await this.gasClient.getProjectContent(devScriptId, accessToken);
    const manifest = files.find((f: GASFile) => f.name === 'appsscript');
    if (!manifest?.source) {
      throw new Error('dev project appsscript.json not found — cannot persist environment IDs');
    }

    const json = JSON.parse(manifest.source);
    if (!json.mcp_environments) json.mcp_environments = {};
    json.mcp_environments[environment] = ids;

    const updated = files.map((f: GASFile) =>
      f.name === 'appsscript' ? { ...f, source: JSON.stringify(json, null, 2) } : f
    );
    await this.gasClient.updateProjectContent(devScriptId, updated, accessToken);
  }

  /**
   * Strip mcp_environments from appsscript.json before pushing to -source libraries.
   * All other manifest properties (oauthScopes, timeZone, runtimeVersion, etc.) are preserved.
   */
  private stripMcpEnvironments(files: GASFile[]): GASFile[] {
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
   * Validate a consumer shim and re-write it if stale.
   * Called on every promote to catch config drift between promotes.
   */
  private async validateAndRepairConsumerShim(
    consumerScriptId: string,
    sourceScriptId: string,
    userSymbol: string,
    sourceManifestJson: Record<string, any>,
    accessToken?: string
  ): Promise<{ valid: boolean; updated: boolean; issue?: string }> {
    try {
      const files = await this.gasClient.getProjectContent(consumerScriptId, accessToken);
      const manifest = files.find((f: GASFile) => f.name === 'appsscript');
      if (!manifest?.source) {
        await this.writeConsumerShim(consumerScriptId, sourceScriptId, userSymbol, sourceManifestJson, accessToken);
        return { valid: false, updated: true, issue: 'missing manifest — re-wrote shim' };
      }

      const json = JSON.parse(manifest.source);
      const lib = json.dependencies?.libraries?.find((l: any) => l.libraryId === sourceScriptId);
      if (lib && lib.developmentMode === true) {
        return { valid: true, updated: false };
      }

      // Stale — re-write shim
      await this.writeConsumerShim(consumerScriptId, sourceScriptId, userSymbol, sourceManifestJson, accessToken);
      const issue = !lib
        ? `library reference missing (expected ${sourceScriptId})`
        : 'developmentMode was not true';
      return { valid: false, updated: true, issue };
    } catch (e: any) {
      // Distinguish 404 (consumer deleted) from transient errors — both are non-fatal but
      // a deleted consumer means files are being pushed to a -source with no active consumer
      const is404 = e.message?.includes('404') || e.status === 404 || e.code === 404;
      const issue = is404
        ? `consumer project not found (404) — run deploy setup to recreate it`
        : `validation error: ${e.message}`;
      return { valid: false, updated: false, issue };
    }
  }

  private async getEnvironmentConfig(scriptId: string, accessToken?: string): Promise<any> {
    // Primary: read mcp_environments from dev project's appsscript.json
    if (!accessToken) {
      console.error('⚠️  [getEnvironmentConfig] No accessToken provided — skipping manifest read, using gas-config.json fallback');
    }
    if (accessToken) {
      try {
        const files = await this.gasClient.getProjectContent(scriptId, accessToken);
        const manifest = files.find((f: GASFile) => f.name === 'appsscript');
        if (manifest?.source) {
          const json = JSON.parse(manifest.source);
          if (json.mcp_environments) {
            return json.mcp_environments;
          }
        }
      } catch (e: any) {
        console.error(`⚠️  [getEnvironmentConfig] Could not read mcp_environments from dev manifest: ${e.message} — falling back to gas-config.json`);
      }
    }

    // Legacy fallback: gas-config.json (for projects not yet migrated to manifest-based tracking,
    // or when accessToken is unavailable)
    try {
      const config = await McpGasConfigManager.getConfig();
      const project = this.findProjectByScriptId(config, scriptId);
      if (project?.environments?.staging?.sourceScriptId) {
        console.error(`ℹ️  [getEnvironmentConfig] Using gas-config.json fallback for environment config (mcp_environments not found in dev manifest)`);
        return project.environments;
      }
    } catch { /* fall through */ }

    return null;
  }

  private findProjectByScriptId(config: any, scriptId: string): any {
    for (const key of Object.keys(config.projects || {})) {
      if (config.projects[key].scriptId === scriptId) {
        return config.projects[key];
      }
    }
    return null;
  }

  private async getProjectName(scriptId: string): Promise<string> {
    try {
      const config = await McpGasConfigManager.getConfig();
      const project = this.findProjectByScriptId(config, scriptId);
      return project?.name || 'GAS-Project';
    } catch {
      return 'GAS-Project';
    }
  }

  private async deriveUserSymbol(scriptId: string): Promise<string> {
    const name = await this.getProjectName(scriptId);
    // Convert kebab-case or snake_case to PascalCase
    const pascal = name
      .split(/[-_\s]+/)
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
    // Ensure valid JS identifier — prefix with 'Lib' if result starts with a digit
    return /^[a-zA-Z_]/.test(pascal) ? pascal : `Lib${pascal}`;
  }

  private async getAuthTokenFallback(): Promise<string> {
    // Use BaseTool's standard getAuthToken which handles session auth + refresh
    return this.getAuthToken({});
  }
}
