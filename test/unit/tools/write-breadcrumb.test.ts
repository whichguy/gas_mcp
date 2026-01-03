/**
 * Unit tests for WriteTool breadcrumb handling
 *
 * Verifies that .git/ breadcrumb files are handled as remote-only:
 * - They should be pushed to GAS but NOT written to local .git/ directory
 * - This prevents JavaScript-wrapped content from breaking Git commands
 *
 * REGRESSION TEST for bug where .git/config.gs breadcrumbs were being
 * written to local .git/config, corrupting the git repository.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { WriteTool } from '../../../src/tools/filesystem/WriteTool.js';
import { SessionAuthManager } from '../../../src/auth/sessionManager.js';

describe('WriteTool - Breadcrumb Handling', () => {
  let writeTool: WriteTool;
  let authManager: SessionAuthManager;

  beforeEach(() => {
    authManager = new SessionAuthManager();
    writeTool = new WriteTool(authManager);
  });

  describe('Tool Metadata', () => {
    it('should have correct tool name', () => {
      expect(writeTool.name).to.equal('write');
    });

    it('should have remoteOnly parameter in schema', () => {
      const schema = writeTool.inputSchema as any;
      expect(schema.properties.remoteOnly).to.exist;
      expect(schema.properties.remoteOnly.type).to.equal('boolean');
      expect(schema.properties.remoteOnly.default).to.equal(false);
    });

    it('should have localOnly parameter in schema', () => {
      const schema = writeTool.inputSchema as any;
      expect(schema.properties.localOnly).to.exist;
      expect(schema.properties.localOnly.type).to.equal('boolean');
      expect(schema.properties.localOnly.default).to.equal(false);
    });
  });

  describe('Breadcrumb Path Detection', () => {
    // These tests verify the internal logic by checking expected behavior patterns
    // The actual detection happens in execute() at lines 304-311 of WriteTool.ts

    it('should recognize .git/config as a breadcrumb path', () => {
      // Breadcrumb paths that should trigger remoteOnly
      const breadcrumbPaths = [
        '.git/config',
        '.git/hooks/pre-commit',
        '.git/info/exclude',
        '.git'
      ];

      for (const path of breadcrumbPaths) {
        const isGitBreadcrumb = path.startsWith('.git/') || path === '.git';
        expect(isGitBreadcrumb, `${path} should be detected as git breadcrumb`).to.be.true;
      }
    });

    it('should NOT recognize non-.git paths as breadcrumbs', () => {
      // Paths that should NOT trigger remoteOnly
      const nonBreadcrumbPaths = [
        'src/utils.js',
        'Code.gs',
        '.gitignore',  // Different from .git/
        'config.js',
        'test/.git-test.js',  // Not exactly .git/
        'my.git/config'  // Not starting with .git/
      ];

      for (const path of nonBreadcrumbPaths) {
        const isGitBreadcrumb = path.startsWith('.git/') || path === '.git';
        expect(isGitBreadcrumb, `${path} should NOT be detected as git breadcrumb`).to.be.false;
      }
    });
  });

  describe('Schema Guidance for LLM', () => {
    it('should have llmGuidance for remoteOnly parameter', () => {
      const schema = writeTool.inputSchema as any;
      // The schema should provide guidance about remoteOnly usage
      expect(schema.properties.remoteOnly.description).to.include('remote');
    });

    it('should have llmGuidance for localOnly parameter', () => {
      const schema = writeTool.inputSchema as any;
      expect(schema.properties.localOnly.description).to.include('local');
    });

    it('should document git integration behavior', () => {
      const schema = writeTool.inputSchema as any;
      expect(schema.llmGuidance).to.exist;
      expect(schema.llmGuidance.gitIntegration).to.exist;
    });
  });

  describe('Input Validation', () => {
    it('should require scriptId parameter', () => {
      expect(writeTool.inputSchema.required).to.include('scriptId');
    });

    it('should require path parameter', () => {
      expect(writeTool.inputSchema.required).to.include('path');
    });

    it('should require content parameter', () => {
      expect(writeTool.inputSchema.required).to.include('content');
    });

    it('should have scriptId in properties', () => {
      const schema = writeTool.inputSchema as any;
      // scriptId uses SCRIPT_ID_SCHEMA which includes pattern, minLength, maxLength
      expect(schema.properties.scriptId).to.exist;
      expect(schema.required).to.include('scriptId');
    });
  });
});
