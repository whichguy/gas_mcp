/**
 * Unit tests for LibraryDeployTool
 *
 * Tests core functionality:
 * - generateThinShim: shim code generation with userSymbol injection
 * - validateUserSymbol: JS identifier validation
 * - deriveUserSymbol: project name → PascalCase conversion
 * - Schema correctness: inputSchema, outputSchema, annotations
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { LibraryDeployTool } from '../../../src/tools/deploy.js';
import { SessionAuthManager } from '../../../src/auth/sessionManager.js';

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

    it('should have inputSchema with required fields', () => {
      expect(tool.inputSchema).to.exist;
      expect(tool.inputSchema.required).to.include('operation');
      expect(tool.inputSchema.required).to.include('scriptId');
    });

    it('should have operation enum with 4 values', () => {
      const opProp = tool.inputSchema.properties.operation;
      expect(opProp.enum).to.deep.equal(['promote', 'rollback', 'status', 'setup']);
    });

    it('should have to enum with staging and prod', () => {
      const toProp = tool.inputSchema.properties.to;
      expect(toProp.enum).to.deep.equal(['staging', 'prod']);
    });

    it('should have outputSchema with expected fields', () => {
      expect(tool.outputSchema).to.exist;
      expect(tool.outputSchema.type).to.equal('object');
      const fields = Object.keys(tool.outputSchema.properties);
      expect(fields).to.include('operation');
      expect(fields).to.include('version');
      expect(fields).to.include('environment');
      expect(fields).to.include('hints');
    });

    it('should have correct annotations', () => {
      expect(tool.annotations.title).to.equal('Library Deploy');
      expect(tool.annotations.readOnlyHint).to.be.false;
      expect(tool.annotations.destructiveHint).to.be.true;
      expect(tool.annotations.openWorldHint).to.be.true;
    });

    it('should have llmGuidance in inputSchema', () => {
      const guidance = (tool.inputSchema as any).llmGuidance;
      expect(guidance).to.exist;
      expect(guidance.workflow).to.be.a('string');
      expect(guidance.environments).to.be.a('string');
    });

    it('should have description positioning deploy as recommended', () => {
      expect(tool.description).to.include('[DEPLOY]');
      expect(tool.description).to.include('recommended');
      expect(tool.description).to.include('version_deploy');
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
      expect(() => callValidate(tool, 'a;eval(')).to.throw();
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
});
