/**
 * Library version pinning deployment tool for Google Apps Script
 *
 * Manages library versions and consumer spreadsheet environment pins.
 * One library project (dev workspace) with staging/prod consumer spreadsheets
 * that pin to specific library versions via appsscript.json.
 *
 * Architecture:
 *   Library Project (standalone, edit via MCP GAS)
 *     ├── HEAD (current dev code)
 *     ├── v3 ← staging pins here
 *     └── v2 ← prod pins here
 *
 *   Staging Sheet (container-bound thin shim → library @ v3)
 *   Prod Sheet (container-bound thin shim → library @ v2)
 *   Template Sheet (container-bound thin shim → library @ HEAD, developmentMode: true)
 *
 * Note: For web app deployment management, see VersionDeployTool in deployment.ts
 */

import { BaseTool } from './base.js';
import { GASClient, GASFile } from '../api/gasClient.js';
import { ValidationError, GASApiError } from '../errors/mcpErrors.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';
import { LockManager } from '../utils/lockManager.js';
import { McpGasConfigManager } from '../config/mcpGasConfig.js';
import { generateLibraryDeployHints, generateLibraryDeployErrorHints, DeployHints } from '../utils/deployHints.js';
import { mcpLogger } from '../utils/mcpLogger.js';
import { ENV_TAGS, LibraryEnvironment } from '../utils/deployConstants.js';

/**
 * ConfigManager property keys per environment
 */
const CONFIG_KEYS = {
  staging: {
    version: 'STAGING_VERSION',
    previousVersion: 'STAGING_PREVIOUS_VERSION',
    promotedAt: 'STAGING_PROMOTED_AT',
    scriptId: 'STAGING_SCRIPT_ID',
    spreadsheetUrl: 'STAGING_SPREADSHEET_URL',
  },
  prod: {
    version: 'PROD_VERSION',
    previousVersion: 'PROD_PREVIOUS_VERSION',
    promotedAt: 'PROD_PROMOTED_AT',
    scriptId: 'PROD_SCRIPT_ID',
    spreadsheetUrl: 'PROD_SPREADSHEET_URL',
  },
} as const;

/**
 * Library version pinning deployment tool
 */
export class LibraryDeployTool extends BaseTool {
  public name = 'deploy';
  public description = '[DEPLOY] Deployment tool (recommended) — promote library versions to staging/prod consumer spreadsheets, rollback version pins, check environment status, or setup template wiring. Standard tool for all deployment workflows. For low-level web app deployment control, use version_deploy. Example: deploy({scriptId, operation: "promote", to: "staging", description: "v1.0"})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      operation: { type: 'string', description: 'Operation performed: promote, rollback, status, or setup' },
      version: { type: 'number', description: 'Library version number (promote/rollback)' },
      environment: { type: 'string', description: 'Target environment: staging or prod' },
      previousVersion: { type: 'number', description: 'Previous version before this operation' },
      dev: { type: 'object', description: 'Dev environment info (status): always HEAD' },
      staging: { type: 'object', description: 'Staging environment info (status): version pin + consumer details' },
      prod: { type: 'object', description: 'Prod environment info (status): version pin + consumer details' },
      versions: { type: 'object', description: 'Version management info (status): total, cleanup candidates' },
      createdVersion: { type: 'number', description: 'Version created before failure (error recovery)' },
      retryWith: { type: 'string', description: 'Suggested retry command with useVersion (error recovery)' },
      hints: { type: 'object', description: 'Context-aware next-step hints' },
    },
  };

  public inputSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['promote', 'rollback', 'status', 'setup'],
        description:
          'promote: create library version + pin consumer | rollback: toggle to previous version | status: show all environment pins | setup: wire template to library @ HEAD',
      },
      to: {
        type: 'string',
        enum: ['staging', 'prod'],
        description:
          'Target environment. staging: create version from HEAD + pin staging consumer. prod: copy staging version pin to prod consumer.',
      },
      description: {
        type: 'string',
        description: 'Version description (required for promote to staging). Auto-tagged [STAGING].',
      },
      toVersion: {
        type: 'number',
        description: 'Override rollback target version (optional). If omitted, uses stored previous version.',
        minimum: 1,
      },
      useVersion: {
        type: 'number',
        description: 'Reuse existing version number (for retry after partial promote failure). Skips version creation.',
        minimum: 1,
      },
      userSymbol: {
        type: 'string',
        description: 'Library namespace symbol in consumer scripts (e.g., "SheetsChat"). Defaults to project-specific config.',
      },
      templateScriptId: {
        type: 'string',
        description: 'Container-bound script ID of the dev/template spreadsheet (for setup operation).',
      },
      force: {
        type: 'boolean',
        description: 'Skip library reference validation on consumer manifests.',
      },
      ...SchemaFragments.scriptId,
      ...SchemaFragments.accessToken,
    },
    required: ['operation', 'scriptId'],
    llmGuidance: {
      workflow: 'setup → promote staging → test → promote prod | rollback toggles between last two versions',
      environments: 'template: HEAD (dev mode) | staging: pinned version | prod: pinned version',
    },
  };

  public annotations = {
    title: 'Library Deploy',
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    const scriptId = this.validate.scriptId(params.scriptId, 'library deploy');
    const operation = this.validate.enum(
      params.operation,
      'operation',
      ['promote', 'rollback', 'status', 'setup'],
      'library deploy'
    );

    mcpLogger.info('deploy', { event: 'operation_start', operation, scriptId, to: params.to });

    try {
      let result: any;
      switch (operation) {
        case 'promote':
          result = await this.handlePromote(scriptId, params, accessToken);
          break;
        case 'rollback':
          result = await this.handleRollback(scriptId, params, accessToken);
          break;
        case 'status':
          result = await this.handleStatus(scriptId, accessToken);
          break;
        case 'setup':
          result = await this.handleSetup(scriptId, params, accessToken);
          break;
        default:
          throw new ValidationError('operation', operation, 'one of: promote, rollback, status, setup');
      }

      const hints = generateLibraryDeployHints(
        operation as 'promote' | 'rollback' | 'status' | 'setup',
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
    // Look up staging consumer
    const envConfig = await this.getEnvironmentConfig(scriptId);
    let stagingScriptId = envConfig?.staging?.consumerScriptId;

    // Auto-create consumer if missing
    if (!stagingScriptId) {
      console.error('🔧 Creating staging consumer project...');
      const consumer = await this.autoCreateConsumer(scriptId, 'staging', envConfig, accessToken);
      stagingScriptId = consumer.consumerScriptId;
      console.error(`✅ Created staging consumer: ${stagingScriptId}`);
    }

    // Create version (or reuse)
    let versionNumber: number;
    let versionDescription: string;
    if (params.useVersion) {
      versionNumber = params.useVersion;
      versionDescription = `[reused] v${versionNumber}`;
      console.error(`♻️  Reusing existing version ${versionNumber}`);
    } else {
      if (!params.description) {
        throw new ValidationError('description', undefined, 'non-empty string when promoting to staging');
      }
      const description = this.validate.string(params.description, 'description', 'promote');
      versionDescription = `${ENV_TAGS.staging} ${description}`;
      const version = await this.gasClient.createVersion(scriptId, versionDescription, accessToken);
      versionNumber = version.versionNumber;
      console.error(`✅ Created version ${versionNumber}: ${versionDescription}`);
    }

    // Update consumer's library version pin
    try {
      const previousVersion = await this.updateConsumerLibraryPin(
        stagingScriptId,
        scriptId,
        versionNumber,
        params.force,
        accessToken
      );
      console.error(`✅ Staging pinned to v${versionNumber} (was v${previousVersion || 'none'})`);

      // Store in ConfigManager
      await this.storeEnvironmentState(scriptId, 'staging', versionNumber, previousVersion, accessToken);

      // Update local config cache
      await this.updateLocalConfig(scriptId, 'staging', versionNumber);

      // Advisory cleanup check
      const cleanup = await this.checkVersionCleanup(scriptId, accessToken);

      return {
        operation: 'promote',
        environment: 'staging',
        version: versionNumber,
        description: versionDescription,
        previousVersion: previousVersion || null,
        consumer: { scriptId: stagingScriptId },
        ...(cleanup.candidates > 0 ? { cleanup } : {}),
      };
    } catch (pinError: any) {
      // Version was created but pin failed — provide recovery info
      if (!params.useVersion) {
        throw Object.assign(new GASApiError(`Pin update failed after version creation: ${pinError.message}`), {
          createdVersion: versionNumber,
          retryWith: `deploy({operation:"promote", to:"staging", scriptId:"${scriptId}", useVersion:${versionNumber}})`,
        });
      }
      throw pinError;
    }
  }

  private async promoteToProd(scriptId: string, params: any, accessToken?: string): Promise<any> {
    const envConfig = await this.getEnvironmentConfig(scriptId);

    // Read staging's current pin (source of truth)
    const stagingScriptId = envConfig?.staging?.consumerScriptId;
    if (!stagingScriptId) {
      throw new ValidationError('staging_consumer', 'not configured', 'existing staging consumer — promote to staging first or run setup');
    }

    const stagingVersion = await this.readConsumerLibraryVersion(stagingScriptId, scriptId, accessToken);
    if (!stagingVersion) {
      throw new ValidationError('staging_version', 'not pinned', 'staging consumer pinned to a version — promote to staging first');
    }

    // Auto-create prod consumer if missing
    let prodScriptId = envConfig?.prod?.consumerScriptId;
    if (!prodScriptId) {
      console.error('🔧 Creating prod consumer project...');
      const consumer = await this.autoCreateConsumer(scriptId, 'prod', envConfig, accessToken);
      prodScriptId = consumer.consumerScriptId;
      console.error(`✅ Created prod consumer: ${prodScriptId}`);
    }

    // Update prod's library version pin to staging's version
    const previousVersion = await this.updateConsumerLibraryPin(
      prodScriptId,
      scriptId,
      stagingVersion,
      params.force,
      accessToken
    );
    console.error(`✅ Prod pinned to v${stagingVersion} (was v${previousVersion || 'none'})`);

    // Store in ConfigManager
    await this.storeEnvironmentState(scriptId, 'prod', stagingVersion, previousVersion, accessToken);

    // Update local config cache
    await this.updateLocalConfig(scriptId, 'prod', stagingVersion);

    // Advisory cleanup check
    const cleanup = await this.checkVersionCleanup(scriptId, accessToken);

    return {
      operation: 'promote',
      environment: 'prod',
      version: stagingVersion,
      previousVersion: previousVersion || null,
      consumer: { scriptId: prodScriptId },
      note: 'Prod now serves same library version as staging',
      ...(cleanup.candidates > 0 ? { cleanup } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // Rollback
  // ---------------------------------------------------------------------------

  private async handleRollback(scriptId: string, params: any, accessToken?: string): Promise<any> {
    if (!params.to) {
      throw new ValidationError('to', undefined, '"staging" or "prod" (rollback requires target environment)');
    }
    const to = this.validate.enum(params.to, 'to', ['staging', 'prod'], 'rollback') as LibraryEnvironment;

    const lockManager = LockManager.getInstance();
    await lockManager.acquireLock(scriptId, `deploy-rollback-${to}`);

    try {
      const envConfig = await this.getEnvironmentConfig(scriptId);
      const consumerScriptId = envConfig?.[to]?.consumerScriptId;

      if (!consumerScriptId) {
        throw new ValidationError(`${to}_consumer`, 'not configured', `existing ${to} consumer — run setup or promote first`);
      }

      // Determine target version
      let targetVersion: number;
      if (params.toVersion) {
        targetVersion = this.validate.number(params.toVersion, 'toVersion', 'rollback', 1);
      } else {
        // Read previous version from ConfigManager
        const previousVersion = await this.getConfigManagerValue(scriptId, CONFIG_KEYS[to].previousVersion, accessToken);
        if (!previousVersion) {
          throw new ValidationError(`${to}_previous_version`, 'none stored', `at least one prior promote to enable rollback`);
        }
        targetVersion = parseInt(previousVersion, 10);
      }

      // Read current version for swap
      const currentVersion = await this.readConsumerLibraryVersion(consumerScriptId, scriptId, accessToken);

      // Update pin
      await this.updateConsumerLibraryPin(consumerScriptId, scriptId, targetVersion, params.force, accessToken);
      console.error(`✅ Rolled back ${to} from v${currentVersion} to v${targetVersion}`);

      // Toggle: current becomes previous, target becomes current
      await this.storeEnvironmentState(scriptId, to, targetVersion, currentVersion, accessToken);
      await this.updateLocalConfig(scriptId, to, targetVersion);

      return {
        operation: 'rollback',
        environment: to,
        version: targetVersion,
        rolledBackFrom: currentVersion,
        consumer: { scriptId: consumerScriptId },
        note: 'Rollback is a toggle — a second rollback undoes this one',
      };
    } finally {
      await lockManager.releaseLock(scriptId);
    }
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  private async handleStatus(scriptId: string, accessToken?: string): Promise<any> {
    const envConfig = await this.getEnvironmentConfig(scriptId);

    // Read actual version pins from consumer manifests (source of truth)
    const stagingVersion = envConfig?.staging?.consumerScriptId
      ? await this.readConsumerLibraryVersion(envConfig.staging.consumerScriptId, scriptId, accessToken).catch(() => null)
      : null;
    const prodVersion = envConfig?.prod?.consumerScriptId
      ? await this.readConsumerLibraryVersion(envConfig.prod.consumerScriptId, scriptId, accessToken).catch(() => null)
      : null;

    // List all library versions
    const versionsResponse = await this.gasClient.listVersions(scriptId, 200, undefined, accessToken);
    const versions = versionsResponse.versions || [];

    // Compute keep set
    const keepSet = new Set<number>();
    if (stagingVersion) keepSet.add(stagingVersion);
    if (prodVersion) keepSet.add(prodVersion);

    // Cross-check with ConfigManager stored values
    const storedStagingPrev = await this.getConfigManagerValue(scriptId, CONFIG_KEYS.staging.previousVersion, accessToken).catch(() => null);
    const storedProdPrev = await this.getConfigManagerValue(scriptId, CONFIG_KEYS.prod.previousVersion, accessToken).catch(() => null);
    if (storedStagingPrev) keepSet.add(parseInt(storedStagingPrev, 10));
    if (storedProdPrev) keepSet.add(parseInt(storedProdPrev, 10));

    const cleanupCandidates = versions.filter((v: any) => !keepSet.has(v.versionNumber));
    const warnings = this.generateVersionWarnings(versions.length);

    // Cross-check local config vs remote
    const discrepancies: string[] = [];
    if (envConfig?.staging?.libraryVersion && stagingVersion && envConfig.staging.libraryVersion !== stagingVersion) {
      discrepancies.push(`Staging: local config says v${envConfig.staging.libraryVersion}, actual pin is v${stagingVersion}`);
    }
    if (envConfig?.prod?.libraryVersion && prodVersion && envConfig.prod.libraryVersion !== prodVersion) {
      discrepancies.push(`Prod: local config says v${envConfig.prod.libraryVersion}, actual pin is v${prodVersion}`);
    }

    return {
      operation: 'status',
      dev: { version: 'HEAD', description: 'Always at latest code' },
      staging: envConfig?.staging?.consumerScriptId
        ? {
            version: stagingVersion,
            consumerScriptId: envConfig.staging.consumerScriptId,
            spreadsheetId: envConfig.staging.spreadsheetId,
          }
        : { configured: false },
      prod: envConfig?.prod?.consumerScriptId
        ? {
            version: prodVersion,
            consumerScriptId: envConfig.prod.consumerScriptId,
            spreadsheetId: envConfig.prod.spreadsheetId,
          }
        : { configured: false },
      versionGap: stagingVersion && prodVersion ? stagingVersion - prodVersion : null,
      versions: {
        total: versions.length,
        keepSet: Array.from(keepSet),
        cleanupCandidates: cleanupCandidates.length,
        warnings,
      },
      ...(discrepancies.length > 0 ? { discrepancies } : {}),
      userSymbol: envConfig?.userSymbol || null,
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

    // Write updated manifest
    await this.gasClient.updateProjectContent(
      templateScriptId,
      templateFiles.map((f: GASFile) =>
        f.name === 'appsscript' ? { ...f, source: JSON.stringify(manifestJson, null, 2) } : f
      ),
      accessToken
    );
    console.error(`✅ Template manifest updated — library @ HEAD with userSymbol "${userSymbol}"`);

    // Write thin shim Code.gs if not already present
    const hasCodeGs = templateFiles.some((f: GASFile) => f.name === 'Code');
    if (!hasCodeGs) {
      const shimSource = this.generateThinShim(userSymbol);
      const updatedFiles = [
        ...templateFiles.map((f: GASFile) =>
          f.name === 'appsscript' ? { ...f, source: JSON.stringify(manifestJson, null, 2) } : f
        ),
        { name: 'Code', type: 'SERVER_JS' as const, source: shimSource },
      ];
      await this.gasClient.updateProjectContent(templateScriptId, updatedFiles, accessToken);
      console.error('✅ Thin shim Code.gs written to template');
    }

    // Save config
    const config = await McpGasConfigManager.getConfig();
    const projectEntry = this.findProjectByScriptId(config, scriptId);
    if (projectEntry) {
      if (!projectEntry.environments) {
        projectEntry.environments = {};
      }
      projectEntry.environments.templateScriptId = templateScriptId;
      projectEntry.environments.userSymbol = userSymbol;
      await McpGasConfigManager.saveConfig(config);
      console.error('✅ Saved template config to gas-config.json');
    }

    // Store in ConfigManager
    await this.setConfigManagerValue(scriptId, 'TEMPLATE_SCRIPT_ID', templateScriptId, accessToken);
    await this.setConfigManagerValue(scriptId, 'USER_SYMBOL', userSymbol, accessToken);

    return {
      operation: 'setup',
      templateScriptId,
      userSymbol,
      libraryScriptId: scriptId,
      libraryReference: { version: '0', developmentMode: true },
      message: `Template wired to library @ HEAD. Next: deploy({operation:"promote", to:"staging", scriptId:"${scriptId}", description:"v1.0"})`,
    };

    } finally {
      await lockManager.releaseLock(templateScriptId);
    }
  }

  // ---------------------------------------------------------------------------
  // Consumer manifest operations
  // ---------------------------------------------------------------------------

  /**
   * Read the library version pin from a consumer's appsscript.json
   */
  private async readConsumerLibraryVersion(
    consumerScriptId: string,
    libraryScriptId: string,
    accessToken?: string
  ): Promise<number | null> {
    const files = await this.gasClient.getProjectContent(consumerScriptId, accessToken);
    const manifest = files.find((f: GASFile) => f.name === 'appsscript');
    if (!manifest?.source) return null;

    const manifestJson = JSON.parse(manifest.source);
    const lib = manifestJson.dependencies?.libraries?.find(
      (l: any) => l.libraryId === libraryScriptId
    );
    if (!lib?.version) return null;

    const version = parseInt(lib.version, 10);
    return isNaN(version) || version === 0 ? null : version;
  }

  /**
   * Update a consumer's library version pin in appsscript.json
   * Returns the previous version number (or null if none)
   */
  private async updateConsumerLibraryPin(
    consumerScriptId: string,
    libraryScriptId: string,
    newVersion: number,
    force?: boolean,
    accessToken?: string
  ): Promise<number | null> {
    const files = await this.gasClient.getProjectContent(consumerScriptId, accessToken);
    const manifest = files.find((f: GASFile) => f.name === 'appsscript');
    if (!manifest?.source) {
      throw new GASApiError(`Consumer ${consumerScriptId} has no appsscript.json`);
    }

    const manifestJson = JSON.parse(manifest.source);
    const libraries = manifestJson.dependencies?.libraries || [];
    const lib = libraries.find((l: any) => l.libraryId === libraryScriptId);

    if (!lib && !force) {
      throw new ValidationError(
        'library_reference',
        `not found in consumer ${consumerScriptId}`,
        `consumer manifest to reference library ${libraryScriptId} — run setup or use force:true`
      );
    }

    const previousVersion = lib ? parseInt(lib.version, 10) || null : null;

    if (lib) {
      lib.version = String(newVersion);
      // Ensure developmentMode is off for pinned versions
      delete lib.developmentMode;
    } else {
      // force mode: add the library reference with derived userSymbol
      const symbol = await this.deriveUserSymbol(libraryScriptId);
      if (!manifestJson.dependencies) manifestJson.dependencies = {};
      if (!manifestJson.dependencies.libraries) manifestJson.dependencies.libraries = [];
      manifestJson.dependencies.libraries.push({
        userSymbol: symbol,
        libraryId: libraryScriptId,
        version: String(newVersion),
      });
    }

    // Write ONLY the manifest back (surgical update)
    const updatedFiles = files.map((f: GASFile) =>
      f.name === 'appsscript' ? { ...f, source: JSON.stringify(manifestJson, null, 2) } : f
    );
    await this.gasClient.updateProjectContent(consumerScriptId, updatedFiles, accessToken);

    return previousVersion;
  }

  // ---------------------------------------------------------------------------
  // Auto-create consumer projects
  // ---------------------------------------------------------------------------

  private async autoCreateConsumer(
    libraryScriptId: string,
    environment: LibraryEnvironment,
    envConfig: any,
    accessToken?: string
  ): Promise<{ consumerScriptId: string; spreadsheetId: string }> {
    const userSymbol = envConfig?.userSymbol || await this.deriveUserSymbol(libraryScriptId);
    const tag = environment === 'staging' ? 'STAGING' : 'PROD';
    const projectName = await this.getProjectName(libraryScriptId);
    const sheetTitle = `${projectName} [${tag}]`;

    let spreadsheetId: string;
    let consumerScriptId: string;

    const templateSpreadsheetId = envConfig?.templateSpreadsheetId;

    // TODO: Path A (copy from template) requires DriveApp.getFileById(id).makeCopy(title)
    // via exec_api — implement when template copy is needed. For now, always create blank.
    if (templateSpreadsheetId) {
      console.error(`⚠️  Template copy not yet implemented — creating blank spreadsheet for ${environment}`);
    } else {
      console.error(`📄 Creating blank spreadsheet for ${environment}...`);
    }
    spreadsheetId = await this.createBlankSpreadsheet(sheetTitle, accessToken);
    consumerScriptId = await this.createContainerBoundScript(spreadsheetId, sheetTitle, accessToken);

    // Write thin shim + manifest to consumer
    await this.writeConsumerShim(consumerScriptId, libraryScriptId, userSymbol, null, accessToken);
    console.error(`✅ Consumer shim written for ${environment}`);

    // Save to local config
    const config = await McpGasConfigManager.getConfig();
    const projectEntry = this.findProjectByScriptId(config, libraryScriptId);
    if (projectEntry) {
      if (!projectEntry.environments) projectEntry.environments = {};
      projectEntry.environments[environment] = {
        consumerScriptId,
        spreadsheetId,
        libraryVersion: 0,
      };
      await McpGasConfigManager.saveConfig(config);
    }

    // Store in ConfigManager
    await this.setConfigManagerValue(
      libraryScriptId,
      CONFIG_KEYS[environment].scriptId,
      consumerScriptId,
      accessToken
    );

    return { consumerScriptId, spreadsheetId };
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
   * Write thin shim and manifest to a consumer project
   */
  private async writeConsumerShim(
    consumerScriptId: string,
    libraryScriptId: string,
    userSymbol: string,
    version: number | null,
    accessToken?: string
  ): Promise<void> {
    this.validateUserSymbol(userSymbol);

    // Read existing files to get manifest scopes
    const libraryFiles = await this.gasClient.getProjectContent(libraryScriptId, accessToken);
    const libraryManifest = libraryFiles.find((f: GASFile) => f.name === 'appsscript');
    const libraryManifestJson = libraryManifest?.source ? JSON.parse(libraryManifest.source) : {};

    // Build consumer manifest
    const consumerManifest = {
      timeZone: libraryManifestJson.timeZone || 'America/New_York',
      dependencies: {
        libraries: [
          {
            userSymbol,
            libraryId: libraryScriptId,
            version: version !== null ? String(version) : '0',
            ...(version === null ? { developmentMode: true } : {}),
          },
        ],
      },
      exceptionLogging: 'STACKDRIVER',
      runtimeVersion: 'V8',
      // Copy OAuth scopes from library
      ...(libraryManifestJson.oauthScopes ? { oauthScopes: libraryManifestJson.oauthScopes } : {}),
    };

    const shimSource = this.generateThinShim(userSymbol);

    const files: GASFile[] = [
      { name: 'appsscript', type: 'JSON' as any, source: JSON.stringify(consumerManifest, null, 2) },
      { name: 'Code', type: 'SERVER_JS' as any, source: shimSource },
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
    try {
      await this.gasClient.executeFunction(
        scriptId,
        'exec_api',
        [null, 'ConfigManager', 'setScript', key, value],
        accessToken
      );
    } catch (error: any) {
      console.error(`⚠️  Failed to store ConfigManager ${key}: ${error.message}`);
    }
  }

  private async storeEnvironmentState(
    scriptId: string,
    environment: LibraryEnvironment,
    version: number,
    previousVersion: number | null,
    accessToken?: string
  ): Promise<void> {
    const keys = CONFIG_KEYS[environment];
    await this.setConfigManagerValue(scriptId, keys.version, String(version), accessToken);
    if (previousVersion !== null) {
      await this.setConfigManagerValue(scriptId, keys.previousVersion, String(previousVersion), accessToken);
    }
    await this.setConfigManagerValue(scriptId, keys.promotedAt, new Date().toISOString(), accessToken);
  }

  // ---------------------------------------------------------------------------
  // Version cleanup (advisory only — GAS API cannot delete versions)
  // ---------------------------------------------------------------------------

  private async checkVersionCleanup(scriptId: string, accessToken?: string): Promise<any> {
    try {
      const response = await this.gasClient.listVersions(scriptId, 200, undefined, accessToken);
      const versions = response.versions || [];
      const total = versions.length;

      // Build keep set from ConfigManager
      const keepSet = new Set<number>();
      for (const env of ['staging', 'prod'] as const) {
        const current = await this.getConfigManagerValue(scriptId, CONFIG_KEYS[env].version, accessToken);
        const prev = await this.getConfigManagerValue(scriptId, CONFIG_KEYS[env].previousVersion, accessToken);
        if (current) keepSet.add(parseInt(current, 10));
        if (prev) keepSet.add(parseInt(prev, 10));
      }

      const candidates = versions.filter((v: any) => !keepSet.has(v.versionNumber)).length;
      const warnings = this.generateVersionWarnings(total);

      return { total, candidates, keepSet: Array.from(keepSet), warnings };
    } catch {
      return { total: 0, candidates: 0, keepSet: [], warnings: [] };
    }
  }

  private generateVersionWarnings(versionCount: number): any[] {
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

  // ---------------------------------------------------------------------------
  // Config helpers
  // ---------------------------------------------------------------------------

  private async getEnvironmentConfig(scriptId: string): Promise<any> {
    try {
      const config = await McpGasConfigManager.getConfig();
      const project = this.findProjectByScriptId(config, scriptId);
      return project?.environments || null;
    } catch {
      return null;
    }
  }

  private findProjectByScriptId(config: any, scriptId: string): any {
    for (const key of Object.keys(config.projects || {})) {
      if (config.projects[key].scriptId === scriptId) {
        return config.projects[key];
      }
    }
    return null;
  }

  private async updateLocalConfig(scriptId: string, environment: LibraryEnvironment, version: number): Promise<void> {
    try {
      const config = await McpGasConfigManager.getConfig();
      const project = this.findProjectByScriptId(config, scriptId);
      if (project?.environments?.[environment]) {
        project.environments[environment].libraryVersion = version;
        await McpGasConfigManager.saveConfig(config);
      }
    } catch (error: any) {
      console.error(`⚠️  Failed to update local config: ${error.message}`);
    }
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
    return name
      .split(/[-_\s]+/)
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }

  private async getAuthTokenFallback(): Promise<string> {
    // Use BaseTool's standard getAuthToken which handles session auth + refresh
    return this.getAuthToken({});
  }
}
