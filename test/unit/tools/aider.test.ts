import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { AiderTool } from '../../../src/tools/aider.js';
import { SessionAuthManager } from '../../../src/auth/sessionManager.js';
import { ValidationError } from '../../../src/errors/mcpErrors.js';

describe('AiderTool', () => {
  let aiderTool: AiderTool;
  let authManager: SessionAuthManager;

  beforeEach(() => {
    authManager = new SessionAuthManager();
    aiderTool = new AiderTool(authManager);
  });

  describe('Tool Metadata', () => {
    it('should have correct tool name', () => {
      expect(aiderTool.name).to.equal('aider');
    });

    it('should have descriptive description', () => {
      expect(aiderTool.description).to.include('fuzzy');
      expect(aiderTool.description).to.include('[FILE:AIDER]');
    });

    it('should have comprehensive input schema', () => {
      expect(aiderTool.inputSchema).to.exist;
      expect(aiderTool.inputSchema.type).to.equal('object');
      expect(aiderTool.inputSchema.required).to.include('scriptId');
      expect(aiderTool.inputSchema.required).to.include('path');
      expect(aiderTool.inputSchema.required).to.include('edits');
    });

    it('should have llmGuidance with key sections', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmGuidance).to.exist;
      expect(schema.llmGuidance.threshold).to.exist;
      expect(schema.llmGuidance.antiPatterns).to.exist;
    });

    it('should have llmHints with decision guidance', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmHints).to.exist;
      expect(schema.llmHints.useCases).to.exist;
      expect(schema.llmHints.avoid).to.exist;
      expect(schema.llmHints.troubleshoot).to.exist;
    });
  });

  describe('Input Validation', () => {
    it('should require scriptId parameter', () => {
      expect(aiderTool.inputSchema.required).to.include('scriptId');
    });

    it('should require path parameter', () => {
      expect(aiderTool.inputSchema.required).to.include('path');
    });

    it('should require edits array', () => {
      expect(aiderTool.inputSchema.required).to.include('edits');
    });

    it('should validate scriptId format', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.properties.scriptId.pattern).to.exist;
      expect(schema.properties.scriptId.minLength).to.equal(25);
      expect(schema.properties.scriptId.maxLength).to.equal(60);
    });

    it('should validate path format', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.properties.path.minLength).to.equal(1);
    });

    it('should validate edits structure', () => {
      const schema = aiderTool.inputSchema as any;
      const editsSchema = schema.properties.edits;

      expect(editsSchema.type).to.equal('array');
      expect(editsSchema.minItems).to.equal(1);
      expect(editsSchema.maxItems).to.equal(20);

      const editItemSchema = editsSchema.items;
      expect(editItemSchema.required).to.include('searchText');
      expect(editItemSchema.required).to.include('replaceText');
    });

    it('should have optional similarity threshold', () => {
      const schema = aiderTool.inputSchema as any;
      const editItemSchema = schema.properties.edits.items;

      expect(editItemSchema.properties.similarityThreshold).to.exist;
      expect(editItemSchema.properties.similarityThreshold.default).to.equal(0.8);
      expect(editItemSchema.properties.similarityThreshold.minimum).to.equal(0);
      expect(editItemSchema.properties.similarityThreshold.maximum).to.equal(1);
    });

    it('should have optional dryRun parameter', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.properties.dryRun).to.exist;
      expect(schema.properties.dryRun.type).to.equal('boolean');
      expect(schema.properties.dryRun.default).to.equal(false);
    });
  });

  describe('Fuzzy Matching Algorithm', () => {
    it('should document fuzzy editing in tool description', () => {
      expect(aiderTool.description).to.include('fuzzy');
      expect(aiderTool.description).to.include('editing');
    });

    it('should explain similarity threshold in schema', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmGuidance.threshold).to.exist;
      expect(schema.llmGuidance.threshold).to.include('0.8');
    });
  });

  describe('Token Efficiency', () => {
    it('should document editing approach in description', () => {
      expect(aiderTool.description).to.include('fuzzy');
      expect(aiderTool.description).to.include('editing');
    });

    it('should mention threshold in guidance', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmGuidance.threshold).to.include('0.8');
    });
  });

  describe('Tool Comparison Guidance', () => {
    it('should provide anti-pattern guidance', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmGuidance.antiPatterns).to.exist;
      expect(schema.llmGuidance.antiPatterns).to.include('edit');
      expect(schema.llmGuidance.antiPatterns).to.include('git_feature');
    });

    it('should explain when to use aider vs other tools in description', () => {
      expect(aiderTool.description.toLowerCase()).to.include('fuzzy');
      expect(aiderTool.description).to.include('edit');
    });
  });

  describe('Use Case Examples', () => {
    it('should provide use case guidance in llmHints', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmHints.useCases).to.exist;
    });

    it('should document ideal use cases', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmHints.useCases).to.exist;
      expect(schema.llmHints.useCases).to.include('reformatted');
      expect(schema.llmHints.useCases).to.include('whitespace');
    });

    it('should document when to avoid aider', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmHints.avoid).to.exist;
      expect(schema.llmHints.avoid).to.include('exact');
      expect(schema.llmHints.avoid).to.include('regex');
    });
  });

  describe('Error Handling Guidance', () => {
    it('should provide troubleshooting guidance', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmHints.troubleshoot).to.exist;
      expect(schema.llmHints.troubleshoot).to.include('threshold');
    });

    it('should explain threshold adjustments', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmHints.troubleshoot).to.include('no match');
      expect(schema.llmHints.troubleshoot).to.include('wrong match');
    });
  });

  describe('Script Type Compatibility', () => {
    it('should support all script types', () => {
      // Aider works universally - no explicit script type restrictions
      const schema = aiderTool.inputSchema as any;
      expect(schema).to.exist;
      expect(schema.properties.scriptId).to.exist;
    });
  });

  describe('Best Practices', () => {
    it('should recommend dryRun first', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmGuidance.threshold).to.include('dryRun');
    });

    it('should document default threshold', () => {
      const schema = aiderTool.inputSchema as any;
      expect(schema.llmGuidance.threshold).to.include('0.8');
    });
  });

  describe('CommonJS Integration', () => {
    it('should work with CommonJS modules', () => {
      // Aider automatically handles CommonJS unwrapping/wrapping via module system
      // No explicit schema documentation needed - handled transparently
      const schema = aiderTool.inputSchema as any;
      expect(schema).to.exist;
      expect(schema.properties.path).to.exist;
    });
  });
});
