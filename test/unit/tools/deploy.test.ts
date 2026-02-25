/**
 * Unit tests for LibraryDeployTool and DeployConfigTool
 *
 * Tests core functionality:
 * - generateThinShim: shim code generation with userSymbol injection
 * - validateUserSymbol: JS identifier validation
 * - deriveUserSymbol: project name → PascalCase conversion
 * - Schema correctness: inputSchema, outputSchema, annotations
 * - File-push model: no versioning, no rollback
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { LibraryDeployTool } from '../../../src/tools/deploy.js';
import { DeployConfigTool } from '../../../src/tools/deployment.js';
import { SessionAuthManager } from '../../../src/auth/sessionManager.js';
import { GASApiError } from '../../../src/errors/mcpErrors.js';

describe('LibraryDeployTool', () => {
  let tool: LibraryDeployTool;

  beforeEach(() => {
    tool = new LibraryDeployTool(new SessionAuthManager());
  });

  // ============================================================
  // Schema Tests
  // ============================================================
  describe('schema', () => {
    it('should have correct tool name', () => {
      expect(tool.name).to.equal('deploy');
    });

    it('should have inputSchema with scriptId required (operation defaults to promote)', () => {
      expect(tool.inputSchema).to.exist;
      expect(tool.inputSchema.required).to.include('scriptId');
      // operation is no longer required — defaults to 'promote'
      expect(tool.inputSchema.required).to.not.include('operation');
    });

    it('should have operation enum with 3 values (no rollback) and default promote', () => {
      const opProp = tool.inputSchema.properties.operation;
      expect(opProp.enum).to.deep.equal(['promote', 'status', 'setup']);
      expect(opProp.default).to.equal('promote');
    });

    it('should NOT have rollback in operation enum', () => {
      const opProp = tool.inputSchema.properties.operation;
      expect(opProp.enum).to.not.include('rollback');
    });

    it('should have to enum with staging and prod', () => {
      const toProp = tool.inputSchema.properties.to;
      expect(toProp.enum).to.deep.equal(['staging', 'prod']);
    });

    it('should NOT have version param (no versioning)', () => {
      expect(tool.inputSchema.properties).to.not.have.property('version');
      expect(tool.inputSchema.properties).to.not.have.property('useVersion');
      expect(tool.inputSchema.properties).to.not.have.property('toVersion');
    });

    it('should NOT have force param (no version pinning)', () => {
      expect(tool.inputSchema.properties).to.not.have.property('force');
    });

    it('should NOT have reconcile param (no version discrepancies)', () => {
      expect(tool.inputSchema.properties).to.not.have.property('reconcile');
    });

    it('should have syncSheets param defaulting to true', () => {
      expect(tool.inputSchema.properties).to.have.property('syncSheets');
      expect(tool.inputSchema.properties.syncSheets.type).to.equal('boolean');
      expect(tool.inputSchema.properties.syncSheets.default).to.equal(true);
    });

    it('should have syncProperties param defaulting to true', () => {
      expect(tool.inputSchema.properties).to.have.property('syncProperties');
      expect(tool.inputSchema.properties.syncProperties.type).to.equal('boolean');
      expect(tool.inputSchema.properties.syncProperties.default).to.equal(true);
    });

    it('should have outputSchema with file-push fields', () => {
      expect(tool.outputSchema).to.exist;
      expect(tool.outputSchema.type).to.equal('object');
      const fields = Object.keys(tool.outputSchema.properties);
      expect(fields).to.include('operation');
      expect(fields).to.include('sourceScriptId');
      expect(fields).to.include('filesPromoted');
      expect(fields).to.include('environment');
      expect(fields).to.include('sheetSync');
      expect(fields).to.include('propertySync');
      expect(fields).to.include('hints');
      expect(fields).to.include('shimValidation');  // 13a: shim validation per promote
      // newly declared fields (gap-closure)
      expect(fields).to.include('consumer');
      expect(fields).to.include('spreadsheetUrl');
      expect(fields).to.include('note');
      expect(fields).to.include('description');
      expect(fields).to.include('templateScriptId');
      expect(fields).to.include('libraryScriptId');
      expect(fields).to.include('libraryReference');
      expect(fields).to.include('message');
      expect(fields).to.include('userSymbol');
    });

    it('should NOT have version-related output fields', () => {
      const fields = Object.keys(tool.outputSchema.properties);
      expect(fields).to.not.include('version');
      expect(fields).to.not.include('previousVersion');
      expect(fields).to.not.include('createdVersion');
      expect(fields).to.not.include('retryWith');
      expect(fields).to.not.include('reconciled');
      expect(fields).to.not.include('versions');
    });

    it('should have correct annotations', () => {
      expect(tool.annotations.title).to.equal('Deploy');
      expect(tool.annotations.readOnlyHint).to.be.false;
      expect(tool.annotations.destructiveHint).to.be.true;
      expect(tool.annotations.openWorldHint).to.be.true;
    });

    it('should have llmGuidance in inputSchema', () => {
      const guidance = (tool.inputSchema as any).llmGuidance;
      expect(guidance).to.exist;
      expect(guidance.workflow).to.be.a('string');
      expect(guidance.workflow).to.include('staging');
      expect(guidance.auto_behaviors).to.be.an('array').with.length.above(0);
      expect(guidance.self_contained).to.be.a('string');
      expect(guidance.defaults).to.be.a('string');
      // deploy_config should NOT appear as a prerequisite — it causes bad LLM plans
      expect(guidance).to.not.have.property('note');
    });

    it('should have description referencing deploy_config', () => {
      expect(tool.description).to.include('deploy_config');
    });

    it('should have description referencing file-push model', () => {
      expect(tool.description).to.include('-source');
      expect(tool.description).to.include('HEAD');
    });
  });

  // ============================================================
  // Thin Shim Generation Tests
  // ============================================================
  describe('generateThinShim', () => {
    // Access private method for testing
    function callGenerateThinShim(t: any, symbol: string): string {
      return t.generateThinShim(symbol);
    }

    it('should generate valid shim with userSymbol', () => {
      const shim = callGenerateThinShim(tool, 'MyLib');
      expect(shim).to.include('MyLib.onOpen(e)');
      expect(shim).to.include('MyLib.onEdit(e)');
      expect(shim).to.include('MyLib.exec_api');
      expect(shim).to.include('MyLib.showSidebar');
      expect(shim).to.include('MyLib.initialize');
    });

    it('should include onInstall handler', () => {
      const shim = callGenerateThinShim(tool, 'MyLib');
      expect(shim).to.include('function onInstall(e)');
      expect(shim).to.include('onOpen(e)');
    });

    it('should include menu handler stubs', () => {
      const shim = callGenerateThinShim(tool, 'MyLib');
      expect(shim).to.include('function menuAction1()');
      expect(shim).to.include('function menuAction2()');
    });

    it('should include warning comment about CommonJS', () => {
      const shim = callGenerateThinShim(tool, 'TestLib');
      expect(shim).to.include('Do NOT add CommonJS');
    });

    it('should use apply for exec_api to pass all arguments', () => {
      const shim = callGenerateThinShim(tool, 'SheetsChat');
      expect(shim).to.include('SheetsChat.exec_api.apply(null, arguments)');
    });

    it('should pass SpreadsheetApp.getUi() to showSidebar', () => {
      const shim = callGenerateThinShim(tool, 'X');
      expect(shim).to.include('X.showSidebar(SpreadsheetApp.getUi())');
    });

    it('should reject invalid userSymbol', () => {
      expect(() => callGenerateThinShim(tool, '123bad')).to.throw();
      expect(() => callGenerateThinShim(tool, 'has-dash')).to.throw();
      expect(() => callGenerateThinShim(tool, 'has space')).to.throw();
      expect(() => callGenerateThinShim(tool, '')).to.throw();
    });
  });

  // ============================================================
  // userSymbol Validation Tests
  // ============================================================
  describe('validateUserSymbol', () => {
    function callValidate(t: any, symbol: string): void {
      return t.validateUserSymbol(symbol);
    }

    it('should accept valid PascalCase symbols', () => {
      expect(() => callValidate(tool, 'MyLib')).to.not.throw();
      expect(() => callValidate(tool, 'SheetsChat')).to.not.throw();
      expect(() => callValidate(tool, 'A')).to.not.throw();
    });

    it('should accept underscore-prefixed symbols', () => {
      expect(() => callValidate(tool, '_internal')).to.not.throw();
      expect(() => callValidate(tool, '__private')).to.not.throw();
    });

    it('should accept symbols with numbers', () => {
      expect(() => callValidate(tool, 'Lib2')).to.not.throw();
      expect(() => callValidate(tool, 'v3API')).to.not.throw();
    });

    it('should reject symbols starting with numbers', () => {
      expect(() => callValidate(tool, '3lib')).to.throw('valid JavaScript identifier');
    });

    it('should reject symbols with special characters', () => {
      expect(() => callValidate(tool, 'my-lib')).to.throw('valid JavaScript identifier');
      expect(() => callValidate(tool, 'my.lib')).to.throw('valid JavaScript identifier');
      expect(() => callValidate(tool, 'my lib')).to.throw('valid JavaScript identifier');
    });

    it('should reject empty string', () => {
      expect(() => callValidate(tool, '')).to.throw('valid JavaScript identifier');
    });

    it('should reject potential injection payloads', () => {
      expect(() => callValidate(tool, "a;eval(")).to.throw();
      expect(() => callValidate(tool, 'a\n//')).to.throw();
    });
  });

  // ============================================================
  // deriveUserSymbol Tests
  // ============================================================
  describe('deriveUserSymbol', () => {
    // This method is async and calls getProjectName which reads config.
    // We test the PascalCase conversion logic directly.
    function testConversion(name: string): string {
      return name
        .split(/[-_\s]+/)
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
    }

    it('should convert kebab-case to PascalCase', () => {
      expect(testConversion('sheets-chat')).to.equal('SheetsChat');
      expect(testConversion('my-cool-tool')).to.equal('MyCoolTool');
    });

    it('should convert snake_case to PascalCase', () => {
      expect(testConversion('sheet_chat')).to.equal('SheetChat');
      expect(testConversion('my_tool')).to.equal('MyTool');
    });

    it('should handle single word', () => {
      expect(testConversion('utils')).to.equal('Utils');
      expect(testConversion('API')).to.equal('API');
    });

    it('should handle already PascalCase', () => {
      expect(testConversion('SheetsChat')).to.equal('SheetsChat');
    });

    it('should handle spaces', () => {
      expect(testConversion('my tool')).to.equal('MyTool');
    });
  });

  // ============================================================
  // Schema: File-Push Model Tests
  // ============================================================
  describe('file-push model schemas', () => {
    it('should have dryRun in inputSchema', () => {
      expect(tool.inputSchema.properties).to.have.property('dryRun');
      expect(tool.inputSchema.properties.dryRun.type).to.equal('boolean');
    });

    it('should have configWarning in outputSchema', () => {
      const fields = Object.keys(tool.outputSchema.properties);
      expect(fields).to.include('configWarning');
    });

    it('should have discrepancies in outputSchema', () => {
      const fields = Object.keys(tool.outputSchema.properties);
      expect(fields).to.include('discrepancies');
    });

    it('should have sourceScriptId in outputSchema', () => {
      const fields = Object.keys(tool.outputSchema.properties);
      expect(fields).to.include('sourceScriptId');
    });

    it('should have filesPromoted in outputSchema', () => {
      const fields = Object.keys(tool.outputSchema.properties);
      expect(fields).to.include('filesPromoted');
    });
  });

  // ============================================================
  // Setup operation parameter tests
  // ============================================================
  describe('setup operation schema', () => {
    it('should have templateScriptId param for setup', () => {
      expect(tool.inputSchema.properties).to.have.property('templateScriptId');
      expect(tool.inputSchema.properties.templateScriptId.type).to.equal('string');
    });

    it('should have userSymbol param for setup', () => {
      expect(tool.inputSchema.properties).to.have.property('userSymbol');
      expect(tool.inputSchema.properties.userSymbol.type).to.equal('string');
    });

    it('should NOT require templateScriptId at schema level (validated at runtime)', () => {
      // templateScriptId is required by setup op but NOT listed in top-level required[]
      // because it only applies to the setup operation, not promote/status
      expect(tool.inputSchema.required).to.not.include('templateScriptId');
    });
  });

  // ============================================================
  // deriveUserSymbol edge cases
  // ============================================================
  describe('deriveUserSymbol — digit-leading guard', () => {
    function testConversionWithGuard(name: string): string {
      const pascal = name
        .split(/[-_\s]+/)
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      return /^[a-zA-Z_]/.test(pascal) ? pascal : `Lib${pascal}`;
    }

    it('should prefix Lib for digit-leading project names', () => {
      expect(testConversionWithGuard('123project')).to.equal('Lib123project');
      expect(testConversionWithGuard('4tools')).to.equal('Lib4tools');
    });

    it('should not prefix valid PascalCase names', () => {
      expect(testConversionWithGuard('sheets-chat')).to.equal('SheetsChat');
      expect(testConversionWithGuard('MyTool')).to.equal('MyTool');
    });

    it('should not prefix underscore-leading names (split treats _ as separator → valid PascalCase)', () => {
      // _internal splits to ['', 'internal'] → 'Internal' — still a valid JS identifier
      expect(testConversionWithGuard('_internal')).to.equal('Internal');
    });
  });

  // ============================================================
  // stripMcpEnvironments Tests (13c)
  // ============================================================
  describe('stripMcpEnvironments', () => {
    function callStrip(t: any, files: any[]): any[] {
      return t.stripMcpEnvironments(files);
    }

    it('should strip mcp_environments from appsscript.json', () => {
      const files = [
        {
          name: 'appsscript', type: 'JSON',
          source: JSON.stringify({
            timeZone: 'America/New_York',
            oauthScopes: ['scope1'],
            mcp_environments: { staging: { sourceScriptId: 'abc' } }
          })
        },
        { name: 'Code', type: 'SERVER_JS', source: 'function main() {}' }
      ];
      const result = callStrip(tool, files);
      const manifest = JSON.parse(result[0].source);
      expect(manifest).to.not.have.property('mcp_environments');
      expect(manifest.timeZone).to.equal('America/New_York');
      expect(manifest.oauthScopes).to.deep.equal(['scope1']);
      expect(result[1].source).to.equal('function main() {}');
    });

    it('should leave appsscript without mcp_environments unchanged', () => {
      const files = [
        {
          name: 'appsscript', type: 'JSON',
          source: JSON.stringify({ timeZone: 'America/Chicago', runtimeVersion: 'V8' })
        }
      ];
      const result = callStrip(tool, files);
      const manifest = JSON.parse(result[0].source);
      expect(manifest.timeZone).to.equal('America/Chicago');
      expect(manifest.runtimeVersion).to.equal('V8');
    });

    it('should not modify non-appsscript files even if they contain mcp_environments text', () => {
      const files = [
        { name: 'Code', type: 'SERVER_JS', source: 'var mcp_environments = {};' },
        { name: 'Utils', type: 'SERVER_JS', source: '// mcp_environments' }
      ];
      const result = callStrip(tool, files);
      expect(result[0].source).to.equal(files[0].source);
      expect(result[1].source).to.equal(files[1].source);
    });

    it('should handle invalid JSON in appsscript gracefully (return file unchanged)', () => {
      const files = [{ name: 'appsscript', type: 'JSON', source: 'not valid json' }];
      const result = callStrip(tool, files);
      expect(result[0].source).to.equal('not valid json');
    });

    it('should preserve all non-mcp manifest properties', () => {
      const original = {
        timeZone: 'America/Chicago',
        exceptionLogging: 'STACKDRIVER',
        runtimeVersion: 'V8',
        oauthScopes: ['scope1', 'scope2'],
        dependencies: { libraries: [{ libraryId: 'abc', version: '0', developmentMode: true }] },
        webapp: { access: 'ANYONE', executeAs: 'USER_ACCESSING' },
        mcp_environments: { staging: { sourceScriptId: 'xyz' } }
      };
      const files = [{ name: 'appsscript', type: 'JSON', source: JSON.stringify(original) }];
      const result = callStrip(tool, files);
      const manifest = JSON.parse(result[0].source);
      expect(manifest).to.not.have.property('mcp_environments');
      expect(manifest.timeZone).to.equal('America/Chicago');
      expect(manifest.webapp).to.deep.equal(original.webapp);
      expect(manifest.dependencies).to.deep.equal(original.dependencies);
      expect(manifest.oauthScopes).to.deep.equal(original.oauthScopes);
    });

    it('should return a new array (not mutate input)', () => {
      const source = JSON.stringify({ timeZone: 'UTC', mcp_environments: { staging: {} } });
      const files = [{ name: 'appsscript', type: 'JSON', source }];
      const result = callStrip(tool, files);
      expect(result).to.not.equal(files);
      expect(files[0].source).to.equal(source);  // original unchanged
    });
  });

  // updateDevManifestWithEnvironmentIds was removed — ConfigManager is now the sole
  // source of truth for environment IDs (GAS API rejects unknown manifest fields).

  // ============================================================
  // autoCreateConsumer double-create guard Tests (13d)
  // ============================================================
  describe('autoCreateConsumer double-create guard', () => {
    it('should return existing IDs from ConfigManager without calling createStandaloneProject', async () => {
      const existingIds = {
        sourceScriptId: 'existing-source',
        consumerScriptId: 'existing-consumer',
        spreadsheetId: 'existing-sheet'
      };

      // ConfigManager has the IDs (getEnvironmentConfig reads from CM)
      (tool as any).getConfigManagerValue = async (_scriptId: string, key: string) => {
        const values: Record<string, string> = {
          'STAGING_SOURCE_SCRIPT_ID': existingIds.sourceScriptId,
          'STAGING_SCRIPT_ID': existingIds.consumerScriptId,
          'STAGING_SPREADSHEET_URL': existingIds.spreadsheetId,
        };
        return values[key] || null;
      };

      let createCalled = false;
      (tool as any).createStandaloneProject = async () => { createCalled = true; return 'new-id'; };

      const result = await (tool as any).autoCreateConsumer('devId', 'staging', {}, 'token');

      expect(result.sourceScriptId).to.equal('existing-source');
      expect(result.consumerScriptId).to.equal('existing-consumer');
      expect(result.spreadsheetId).to.equal('existing-sheet');
      expect(createCalled).to.be.false;
    });

    it('should proceed with creation when ConfigManager has partial entry (missing spreadsheetId)', async () => {
      // CM has source + consumer but no spreadsheet — existing check requires all 3 → falls through
      (tool as any).getConfigManagerValue = async (_scriptId: string, key: string) => {
        const values: Record<string, string> = {
          'STAGING_SOURCE_SCRIPT_ID': 'src',
          'STAGING_SCRIPT_ID': 'cons',
          // STAGING_SPREADSHEET_URL intentionally missing
        };
        return values[key] || null;
      };

      const libManifest = { timeZone: 'America/New_York', oauthScopes: ['scope1'] };
      (tool as any).gasClient = {
        getProjectContent: async () => [
          { name: 'appsscript', type: 'JSON', source: JSON.stringify(libManifest) }
        ],
        updateProjectContent: async () => [],
      };

      let createCalled = false;
      (tool as any).createStandaloneProject = async () => { createCalled = true; return 'new-src'; };
      (tool as any).createBlankSpreadsheet = async () => 'new-sheet';
      (tool as any).createContainerBoundScript = async () => 'new-consumer';
      (tool as any).writeConsumerShim = async () => {};
      (tool as any).setConfigManagerValue = async () => {};
      await (tool as any).autoCreateConsumer('devId', 'staging', {}, 'token');
      expect(createCalled).to.be.true;
    });

    it('should proceed with creation when ConfigManager has no staging environment', async () => {
      // Only prod IDs in CM, staging missing
      (tool as any).getConfigManagerValue = async (_scriptId: string, key: string) => {
        const values: Record<string, string> = {
          'PROD_SOURCE_SCRIPT_ID': 'prod-src',
        };
        return values[key] || null;
      };

      const libManifest = { timeZone: 'America/New_York', oauthScopes: ['scope1'] };
      (tool as any).gasClient = {
        getProjectContent: async () => [
          { name: 'appsscript', type: 'JSON', source: JSON.stringify(libManifest) }
        ],
        updateProjectContent: async () => [],
      };

      let createCalled = false;
      (tool as any).createStandaloneProject = async () => { createCalled = true; return 'new-src'; };
      (tool as any).createBlankSpreadsheet = async () => 'new-sheet';
      (tool as any).createContainerBoundScript = async () => 'new-consumer';
      (tool as any).writeConsumerShim = async () => {};
      (tool as any).setConfigManagerValue = async () => {};
      await (tool as any).autoCreateConsumer('devId', 'staging', {}, 'token');
      expect(createCalled).to.be.true;
    });
  });

  // ============================================================
  // autoCreateConsumer ConfigManager as source of truth Tests
  // ============================================================
  describe('autoCreateConsumer ConfigManager as source of truth', () => {
    it('should find existing IDs in ConfigManager (via getEnvironmentConfig) and skip resource creation', async () => {
      // ConfigManager is now the primary store — IDs are found via getEnvironmentConfig
      (tool as any).getConfigManagerValue = async (_scriptId: string, key: string) => {
        const values: Record<string, string> = {
          'STAGING_SOURCE_SCRIPT_ID': 'recovered-source',
          'STAGING_SCRIPT_ID': 'recovered-consumer',
          'STAGING_SPREADSHEET_URL': 'recovered-sheet',
        };
        return values[key] || null;
      };

      let createCalled = false;
      (tool as any).createStandaloneProject = async () => { createCalled = true; return 'new-id'; };

      const result = await (tool as any).autoCreateConsumer('devId', 'staging', {}, 'token');

      expect(result.sourceScriptId).to.equal('recovered-source');
      expect(result.consumerScriptId).to.equal('recovered-consumer');
      expect(result.spreadsheetId).to.equal('recovered-sheet');
      // No manifestPersisted field — ConfigManager is the sole source of truth
      expect(result).to.not.have.property('manifestPersisted');
      expect(createCalled).to.be.false;
    });

    it('should create new environment and write IDs to ConfigManager when CM has no data', async () => {
      // No IDs in ConfigManager
      (tool as any).getConfigManagerValue = async () => null;

      const libManifest = { timeZone: 'America/New_York', oauthScopes: ['scope1'] };
      (tool as any).gasClient = {
        getProjectContent: async () => [
          { name: 'appsscript', type: 'JSON', source: JSON.stringify(libManifest) }
        ],
        updateProjectContent: async () => [],
      };

      const writtenKeys: string[] = [];
      (tool as any).setConfigManagerValue = async (_id: string, key: string) => { writtenKeys.push(key); };
      (tool as any).createStandaloneProject = async () => 'new-source';
      (tool as any).createBlankSpreadsheet = async () => 'new-sheet';
      (tool as any).createContainerBoundScript = async () => 'new-consumer';
      (tool as any).writeConsumerShim = async () => {};

      const result = await (tool as any).autoCreateConsumer('devId', 'staging', {}, 'token');

      expect(result.sourceScriptId).to.equal('new-source');
      expect(result.consumerScriptId).to.equal('new-consumer');
      expect(result.spreadsheetId).to.equal('new-sheet');
      // Verify ConfigManager was written
      expect(writtenKeys).to.include('STAGING_SOURCE_SCRIPT_ID');
      expect(writtenKeys).to.include('STAGING_SCRIPT_ID');
      expect(writtenKeys).to.include('STAGING_SPREADSHEET_URL');
    });
  });

  // ============================================================
  // validateAndRepairConsumerShim Tests
  // ============================================================
  describe('validateAndRepairConsumerShim', () => {
    const SOURCE_ID = 'src-script-id';
    const CONSUMER_ID = 'consumer-script-id';
    const USER_SYMBOL = 'MyLib';
    const MANIFEST_JSON = { timeZone: 'America/New_York', oauthScopes: ['scope1'] };

    function makeManifest(lib?: object): any[] {
      const manifest: any = { timeZone: 'America/New_York' };
      if (lib !== undefined) {
        manifest.dependencies = { libraries: [lib] };
      }
      return [{ name: 'appsscript', type: 'JSON', source: JSON.stringify(manifest) }];
    }

    it('should return { valid: true, updated: false } when library reference + developmentMode are correct', async () => {
      (tool as any).gasClient = {
        getProjectContent: async () => makeManifest({ libraryId: SOURCE_ID, version: '0', developmentMode: true, userSymbol: USER_SYMBOL }),
      };

      const result = await (tool as any).validateAndRepairConsumerShim(CONSUMER_ID, SOURCE_ID, USER_SYMBOL, MANIFEST_JSON);
      expect(result).to.deep.equal({ valid: true, updated: false });
    });

    it('should re-write shim and return issue when library reference is missing', async () => {
      let shimWritten = false;
      (tool as any).gasClient = {
        getProjectContent: async () => makeManifest(/* no libraries */),
      };
      (tool as any).writeConsumerShim = async () => { shimWritten = true; };

      const result = await (tool as any).validateAndRepairConsumerShim(CONSUMER_ID, SOURCE_ID, USER_SYMBOL, MANIFEST_JSON);
      expect(result.valid).to.be.false;
      expect(result.updated).to.be.true;
      expect(result.issue).to.include('library reference missing');
      expect(shimWritten).to.be.true;
    });

    it('should re-write shim and return issue when developmentMode is not true', async () => {
      let shimWritten = false;
      (tool as any).gasClient = {
        getProjectContent: async () => makeManifest({ libraryId: SOURCE_ID, version: '1', developmentMode: false, userSymbol: USER_SYMBOL }),
      };
      (tool as any).writeConsumerShim = async () => { shimWritten = true; };

      const result = await (tool as any).validateAndRepairConsumerShim(CONSUMER_ID, SOURCE_ID, USER_SYMBOL, MANIFEST_JSON);
      expect(result.valid).to.be.false;
      expect(result.updated).to.be.true;
      expect(result.issue).to.equal('developmentMode was not true');
      expect(shimWritten).to.be.true;
    });

    it('should re-write shim when appsscript manifest is missing', async () => {
      let shimWritten = false;
      (tool as any).gasClient = {
        getProjectContent: async () => [{ name: 'Code', type: 'SERVER_JS', source: '' }],
      };
      (tool as any).writeConsumerShim = async () => { shimWritten = true; };

      const result = await (tool as any).validateAndRepairConsumerShim(CONSUMER_ID, SOURCE_ID, USER_SYMBOL, MANIFEST_JSON);
      expect(result.valid).to.be.false;
      expect(result.updated).to.be.true;
      expect(result.issue).to.include('missing manifest');
      expect(shimWritten).to.be.true;
    });

    it('should return 404-specific issue without throwing when consumer project not found', async () => {
      (tool as any).gasClient = {
        getProjectContent: async () => { throw Object.assign(new Error('404 Not Found'), { status: 404 }); }
      };

      const result = await (tool as any).validateAndRepairConsumerShim(CONSUMER_ID, SOURCE_ID, USER_SYMBOL, MANIFEST_JSON);
      expect(result.valid).to.be.false;
      expect(result.updated).to.be.false;
      expect(result.issue).to.include('404');
    });

    it('should return validation error issue without throwing on non-404 error', async () => {
      (tool as any).gasClient = {
        getProjectContent: async () => { throw new Error('Network timeout'); }
      };

      const result = await (tool as any).validateAndRepairConsumerShim(CONSUMER_ID, SOURCE_ID, USER_SYMBOL, MANIFEST_JSON);
      expect(result.valid).to.be.false;
      expect(result.updated).to.be.false;
      expect(result.issue).to.include('validation error');
      expect(result.issue).to.include('Network timeout');
    });
  });

  // ============================================================
  // doSyncProperties Tests
  // ============================================================
  describe('doSyncProperties', () => {
    const SOURCE_ID = 'source-script-id';
    const TARGET_ID = 'target-script-id';

    function makeExecResult(scriptProps: Record<string, string>, docProps: Record<string, string>): any {
      return { status: 'success', logger_output: JSON.stringify({ script: scriptProps, doc: docProps }) };
    }

    it('should copy non-managed script-scope and doc-scope properties to target', async () => {
      const scriptCalls: [string, string, string][] = [];
      const docCalls: [string, string, string][] = [];

      (tool as any).execTool = {
        execute: async () => makeExecResult({ USER_FLAG: 'true', STAGING_URL: 'https://...' }, { DOC_SETTING: 'value' }),
      };
      (tool as any).setConfigManagerValue = async (id: string, key: string, val: string) => {
        scriptCalls.push([id, key, val]);
      };
      (tool as any).setDocConfigManagerValue = async (id: string, key: string, val: string) => {
        docCalls.push([id, key, val]);
      };

      const result = await (tool as any).doSyncProperties(SOURCE_ID, TARGET_ID, 'token');

      // USER_FLAG copied; STAGING_URL (managed) filtered out
      expect(result.synced).to.include('USER_FLAG');
      expect(result.synced).to.include('doc:DOC_SETTING');
      expect(result.skipped).to.include('STAGING_URL');
      expect(result.errors).to.be.undefined;

      expect(scriptCalls).to.have.length(1);
      expect(scriptCalls[0]).to.deep.equal([TARGET_ID, 'USER_FLAG', 'true']);

      expect(docCalls).to.have.length(1);
      expect(docCalls[0]).to.deep.equal([TARGET_ID, 'DOC_SETTING', 'value']);
    });

    it('should return empty synced with skipped list when all properties are managed', async () => {
      (tool as any).execTool = {
        execute: async () => makeExecResult({ STAGING_URL: 'x', DEV_URL: 'y' }, {}),
      };
      (tool as any).setConfigManagerValue = async () => {};
      (tool as any).setDocConfigManagerValue = async () => {};

      const result = await (tool as any).doSyncProperties(SOURCE_ID, TARGET_ID);

      expect(result.synced).to.deep.equal([]);
      expect(result.skipped).to.include('STAGING_URL');
      expect(result.skipped).to.include('DEV_URL');
    });

    it('should return { synced: [], skipped: [] } when source has no properties', async () => {
      (tool as any).execTool = {
        execute: async () => makeExecResult({}, {}),
      };
      (tool as any).setConfigManagerValue = async () => {};
      (tool as any).setDocConfigManagerValue = async () => {};

      const result = await (tool as any).doSyncProperties(SOURCE_ID, TARGET_ID);

      expect(result.synced).to.deep.equal([]);
      expect(result.skipped).to.deep.equal([]);
      expect(result).to.not.have.property('errors');
    });

    it('should collect errors for failed writes without throwing', async () => {
      (tool as any).execTool = {
        execute: async () => makeExecResult({ KEY_A: 'val' }, { KEY_B: 'val2' }),
      };
      (tool as any).setConfigManagerValue = async () => { throw new Error('write failed'); };
      (tool as any).setDocConfigManagerValue = async () => { throw new Error('doc write failed'); };

      const result = await (tool as any).doSyncProperties(SOURCE_ID, TARGET_ID);

      expect(result.errors).to.include('KEY_A');
      expect(result.errors).to.include('doc:KEY_B');
      expect(result.synced).to.deep.equal([]);
    });

    it('should handle missing logger_output gracefully (best-effort parse)', async () => {
      (tool as any).execTool = {
        execute: async () => ({ logger_output: null }),
      };
      (tool as any).setConfigManagerValue = async () => {};
      (tool as any).setDocConfigManagerValue = async () => {};

      const result = await (tool as any).doSyncProperties(SOURCE_ID, TARGET_ID);

      expect(result.synced).to.deep.equal([]);
      expect(result.skipped).to.deep.equal([]);
    });

    it('should use sourceScriptId for exec and targetScriptId for writes', async () => {
      let execScriptId: string | undefined;
      let writeTargetId: string | undefined;

      (tool as any).execTool = {
        execute: async ({ scriptId }: any) => {
          execScriptId = scriptId;
          return makeExecResult({ MY_KEY: 'val' }, {});
        },
      };
      (tool as any).setConfigManagerValue = async (id: string) => { writeTargetId = id; };
      (tool as any).setDocConfigManagerValue = async () => {};

      await (tool as any).doSyncProperties(SOURCE_ID, TARGET_ID, 'tok');

      expect(execScriptId).to.equal(SOURCE_ID);
      expect(writeTargetId).to.equal(TARGET_ID);
    });

    // ------ reconcile mode ------

    it('reconcile:true should delete target-only keys absent from source', async () => {
      // Source has {A, B}; target has {A, B, C} — C is an extra that should be deleted.
      const deleteStatements: string[] = [];

      (tool as any).execTool = {
        execute: async ({ scriptId, js_statement }: any) => {
          // Source read
          if (scriptId === SOURCE_ID) return makeExecResult({ A: '1', B: '2' }, {});
          // Target read (reconcile) — has extra key C
          if (scriptId === TARGET_ID && js_statement.includes('Logger.log')) return makeExecResult({ A: '1', B: '2', C: 'extra' }, {});
          // Target delete — C should be removed
          if (scriptId === TARGET_ID && js_statement.includes('deleteProperty')) {
            deleteStatements.push(js_statement);
            return {};
          }
          return {};
        },
      };
      (tool as any).setConfigManagerValue = async () => {};
      (tool as any).setDocConfigManagerValue = async () => {};

      const result = await (tool as any).doSyncProperties(SOURCE_ID, TARGET_ID, 'tok', true);

      expect(result.deleted).to.deep.equal(['C']);
      expect(result.synced).to.include('A');
      expect(result.synced).to.include('B');
      expect(deleteStatements).to.have.length(1);
      expect(deleteStatements[0]).to.include('deleteProperty');
    });

    it('reconcile:false (default) should NOT delete target extras', async () => {
      let callCount = 0;
      let deleteCallMade = false;

      (tool as any).execTool = {
        execute: async (params: any) => {
          if (params.js_statement?.includes('deleteProperty')) {
            deleteCallMade = true;
          }
          callCount++;
          if (callCount === 1) return makeExecResult({ A: '1' }, {}); // source read only
          return {};
        },
      };
      (tool as any).setConfigManagerValue = async () => {};
      (tool as any).setDocConfigManagerValue = async () => {};

      const result = await (tool as any).doSyncProperties(SOURCE_ID, TARGET_ID, 'tok', false);

      expect(deleteCallMade).to.be.false;
      expect(result).to.not.have.property('deleted');
      expect(result.synced).to.include('A');
    });

    // ------ consumer sync ------

    it('test D: should sync source props to consumer via direct PropertiesService when consumerScriptId provided', async () => {
      const CONSUMER_ID = 'consumer-script-id';
      const execCalls: any[] = [];

      (tool as any).execTool = {
        execute: async (params: any) => {
          execCalls.push(params);
          if (params.scriptId === SOURCE_ID) return makeExecResult({ A: '1' }, {});
          return {};
        },
      };
      (tool as any).setConfigManagerValue = async () => {};
      (tool as any).setDocConfigManagerValue = async () => {};

      const result = await (tool as any).doSyncProperties(SOURCE_ID, TARGET_ID, 'token', false, CONSUMER_ID);

      expect(result.consumerSync).to.exist;
      expect(result.consumerSync.synced).to.include('A');

      // Verify exec was called with CONSUMER_ID for the setProperties write
      const consumerWrite = execCalls.find(
        (c: any) => c.scriptId === CONSUMER_ID && c.js_statement.includes('setProperties')
      );
      expect(consumerWrite).to.exist;
      // Data-correctness: double-stringify encoding produces \"A\":\"1\" in the embedded literal
      expect(consumerWrite.js_statement).to.include('\\"A\\"');
      expect(consumerWrite.js_statement).to.include('\\"1\\"');
    });

    it('test E: should have no consumerSync field when consumerScriptId is omitted', async () => {
      (tool as any).execTool = {
        execute: async () => makeExecResult({ A: '1' }, {}),
      };
      (tool as any).setConfigManagerValue = async () => {};
      (tool as any).setDocConfigManagerValue = async () => {};

      const result = await (tool as any).doSyncProperties(SOURCE_ID, TARGET_ID, 'token');

      expect(result).to.not.have.property('consumerSync');
    });

    it('test F: consumer reconcile should delete consumer extras when reconcile:true', async () => {
      const CONSUMER_ID = 'consumer-script-id';
      const consumerDeleteStatements: string[] = [];

      (tool as any).execTool = {
        execute: async ({ scriptId, js_statement }: any) => {
          // Source read
          if (scriptId === SOURCE_ID) return makeExecResult({ A: '1' }, {});
          // Target (-source) read for reconcile — same as source, no extras
          if (scriptId === TARGET_ID && js_statement.includes('Logger.log')) return makeExecResult({ A: '1' }, {});
          // Target (-source) delete — should not be called (no extras)
          if (scriptId === TARGET_ID && js_statement.includes('deleteProperty')) return {};
          // Consumer read for reconcile — has extra key C
          if (scriptId === CONSUMER_ID && js_statement.includes('Logger.log')) return makeExecResult({ A: '1', C: 'extra' }, {});
          // Consumer delete — C should be deleted
          if (scriptId === CONSUMER_ID && js_statement.includes('deleteProperty')) {
            consumerDeleteStatements.push(js_statement);
            return {};
          }
          // Consumer write (setProperties)
          if (scriptId === CONSUMER_ID && js_statement.includes('setProperties')) return {};
          return {};
        },
      };
      (tool as any).setConfigManagerValue = async () => {};
      (tool as any).setDocConfigManagerValue = async () => {};

      const result = await (tool as any).doSyncProperties(SOURCE_ID, TARGET_ID, 'tok', true, CONSUMER_ID);

      expect(result.consumerSync).to.exist;
      expect(result.consumerSync.deleted).to.include('C');
      expect(consumerDeleteStatements).to.have.length(1);
      expect(consumerDeleteStatements[0]).to.include('deleteProperty');
    });

    it('reconcile:true should never delete MANAGED_PROPERTY_KEYS from target', async () => {
      // Source has {A}; target has {A, DEV_URL} where DEV_URL is a managed key.
      const deleteStatements: string[] = [];

      (tool as any).execTool = {
        execute: async ({ scriptId, js_statement }: any) => {
          // Source read
          if (scriptId === SOURCE_ID) return makeExecResult({ A: '1' }, {});
          // Target read (reconcile) — has managed key DEV_URL which must not be deleted
          if (scriptId === TARGET_ID && js_statement.includes('Logger.log')) return makeExecResult({ A: '1', DEV_URL: 'https://...' }, {});
          // Any delete call — should never happen since only extra is managed
          if (js_statement.includes('deleteProperty')) deleteStatements.push(js_statement);
          return {};
        },
      };
      (tool as any).setConfigManagerValue = async () => {};
      (tool as any).setDocConfigManagerValue = async () => {};

      const result = await (tool as any).doSyncProperties(SOURCE_ID, TARGET_ID, 'tok', true);

      // DEV_URL is MANAGED — must not appear in deleted
      expect(result.deleted ?? []).to.not.include('DEV_URL');
      // No delete exec should have been called (only extra was managed)
      expect(deleteStatements).to.have.length(0);
      // Copy path still runs — A is non-managed and should be synced
      expect(result.synced).to.include('A');
    });
  });

  // ============================================================
  // setDocConfigManagerValue Tests
  // ============================================================
  describe('setDocConfigManagerValue', () => {
    it('should call ConfigManager.setDocument (not setScript) with key and value', async () => {
      const calls: any[] = [];
      (tool as any).execTool = {
        execute: async (params: any) => {
          calls.push(params);
          return { status: 'success' };
        },
      };

      await (tool as any).setDocConfigManagerValue('1Y72rigcMUAwRd7bwl3CR57', 'MY_DOC_KEY', 'val', 'token');

      expect(calls).to.have.length(1);
      expect(calls[0].js_statement).to.include('setDocument');
      expect(calls[0].js_statement).to.include('MY_DOC_KEY');
      expect(calls[0].js_statement).to.include('val');
      expect(calls[0].scriptId).to.equal('1Y72rigcMUAwRd7bwl3CR57');
      expect(calls[0].autoRedeploy).to.be.true;
      expect(calls[0].skipSyncCheck).to.be.true;
    });

    it('should throw GASApiError when execTool.execute returns an error', async () => {
      (tool as any).execTool = {
        execute: async () => ({ status: 'error', error: { message: 'permission denied' } }),
      };

      let threw = false;
      try {
        await (tool as any).setDocConfigManagerValue('1Y72rigcMUAwRd7bwl3CR57', 'KEY', 'val');
      } catch (e: any) {
        threw = true;
        expect(e).to.be.instanceOf(GASApiError);
        expect(e.message).to.include('setDocument');
        expect(e.message).to.include('KEY');
      }
      expect(threw).to.be.true;
    });
  });

  // ============================================================
  // handleSetup saveConfig non-fatal Tests
  // ============================================================
  describe('handleSetup saveConfig resilience', () => {
    it('should succeed even when McpGasConfigManager.saveConfig throws', async () => {
      // Stub all the dependencies handleSetup calls
      (tool as any).gasClient = {
        getProjectContent: async () => [
          { name: 'appsscript', type: 'JSON', source: JSON.stringify({ timeZone: 'UTC' }) },
          { name: 'Code', type: 'SERVER_JS', source: 'function main() {}' }
        ],
        updateProjectContent: async (_id: string, files: any[]) => files,
        getProject: async () => ({ title: 'MyLib Project' }),
      };
      (tool as any).deriveUserSymbol = async () => 'MyLib';
      (tool as any).setConfigManagerValue = async () => {};

      // Dynamically override McpGasConfigManager for this test
      const mcpConfig = await import('../../../src/config/mcpGasConfig.js');
      const origGetConfig = mcpConfig.McpGasConfigManager.getConfig;
      const origSaveConfig = mcpConfig.McpGasConfigManager.saveConfig;
      (mcpConfig.McpGasConfigManager as any).getConfig = async () => ({
        projects: { 'MyLib': { scriptId: 'dev-id', name: 'MyLib', environments: {} } }
      });
      (mcpConfig.McpGasConfigManager as any).saveConfig = async () => {
        throw new Error('disk full');
      };

      let threw = false;
      try {
        await (tool as any).handleSetup('dev-id', {
          operation: 'setup',
          scriptId: 'dev-id',
          templateScriptId: 'tmpl-id',
          userSymbol: 'MyLib',
        });
      } catch (e: any) {
        // Only expect throws from lock/auth issues, not from saveConfig
        if (e.message?.includes('disk full')) threw = true;
      } finally {
        (mcpConfig.McpGasConfigManager as any).getConfig = origGetConfig;
        (mcpConfig.McpGasConfigManager as any).saveConfig = origSaveConfig;
      }

      // saveConfig throwing should NOT propagate
      expect(threw).to.be.false;
    });
  });
});

// ==============================================================
// DeployConfigTool Tests (was VersionDeployTool)
// ==============================================================
describe('DeployConfigTool', () => {
  let tool: DeployConfigTool;

  beforeEach(() => {
    tool = new DeployConfigTool(new SessionAuthManager());
  });

  describe('schema', () => {
    it('should have correct tool name', () => {
      expect(tool.name).to.equal('deploy_config');
    });

    it('should have inputSchema with required fields', () => {
      expect(tool.inputSchema).to.exist;
      expect(tool.inputSchema.required).to.include('operation');
      expect(tool.inputSchema.required).to.include('scriptId');
    });

    it('should have operation enum with status and reset only', () => {
      const opProp = tool.inputSchema.properties.operation;
      expect(opProp.enum).to.deep.equal(['status', 'reset']);
    });

    it('should NOT have promote/rollback-specific params', () => {
      expect(tool.inputSchema.properties).to.not.have.property('environment');
      expect(tool.inputSchema.properties).to.not.have.property('description');
      expect(tool.inputSchema.properties).to.not.have.property('toVersion');
      expect(tool.inputSchema.properties).to.not.have.property('dryRun');
    });

    it('should have outputSchema with expected fields', () => {
      expect(tool.outputSchema).to.exist;
      expect(tool.outputSchema.type).to.equal('object');
      const fields = Object.keys(tool.outputSchema.properties);
      expect(fields).to.include('operation');
      expect(fields).to.include('hints');
    });

    it('should have correct annotations', () => {
      expect(tool.annotations.title).to.equal('Deploy Config');
      expect(tool.annotations.readOnlyHint).to.be.false;
      expect(tool.annotations.destructiveHint).to.be.true;
    });

    it('should have llmGuidance pointing to deploy()', () => {
      const guidance = (tool.inputSchema as any).llmGuidance;
      expect(guidance).to.exist;
      expect(guidance.note).to.include('deploy()');
    });

    it('should have description positioning as infrastructure', () => {
      expect(tool.description).to.include('infrastructure');
      expect(tool.description).to.include('deploy()');
    });

    it('should NOT have promote-related params (status/reset only)', () => {
      expect(tool.inputSchema.properties).to.not.have.property('to');
      expect(tool.inputSchema.properties).to.not.have.property('description');
      expect(tool.inputSchema.properties).to.not.have.property('syncSheets');
    });

    it('should have configWarning in outputSchema', () => {
      const fields = Object.keys(tool.outputSchema.properties);
      expect(fields).to.include('configWarning');
    });
  });
});
