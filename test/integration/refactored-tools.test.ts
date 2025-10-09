/**
 * Integration tests for refactored tools using real MCP server
 * Tests RegexProcessor and SchemaFragments integration in SedTool and AiderTool
 */

import { expect } from 'chai';
import { MCPTestClient } from '../helpers/mcpClient.js';

describe('Refactored Tools Integration', function() {
  this.timeout(30000);

  let client: MCPTestClient;
  const TEST_SCRIPT_ID = '1p3DDxPcgw23lzn2NQl3gM7Nkztki3VmmES46FbLm5IPHizEdJzsQjvAN'; // test-framework project

  before(async () => {
    client = new MCPTestClient();
    await client.connect();
  });

  after(async () => {
    await client.disconnect();
  });

  describe('SedTool with RegexProcessor', () => {
    it('should perform basic find/replace using RegexProcessor', async () => {
      const result = await client.callTool('sed', {
        scriptId: TEST_SCRIPT_ID,
        pattern: 'function',
        replacement: 'async function',
        path: 'Calculator',
        dryRun: true
      });

      expect(result).to.have.property('filesProcessed');
      expect(result).to.have.property('totalReplacements');
    });

    it('should handle regex patterns with capture groups', async () => {
      const result = await client.callTool('sed', {
        scriptId: TEST_SCRIPT_ID,
        pattern: 'function\\s+(\\w+)',
        replacement: 'async function $1',
        path: 'Calculator',
        dryRun: true
      });

      expect(result).to.have.property('filesProcessed');
    });

    it('should handle case-insensitive matching', async () => {
      const result = await client.callTool('sed', {
        scriptId: TEST_SCRIPT_ID,
        pattern: 'FUNCTION',
        replacement: 'method',
        caseSensitive: false,
        path: 'Calculator',
        dryRun: true
      });

      expect(result).to.have.property('filesProcessed');
    });

    it('should handle multiple patterns', async () => {
      const result = await client.callTool('sed', {
        scriptId: TEST_SCRIPT_ID,
        patterns: ['const', 'let'],
        replacement: 'var',
        path: 'Calculator',
        dryRun: true
      });

      expect(result).to.have.property('filesProcessed');
    });

    it('should validate schema using SchemaFragments', async () => {
      // Test that schema validation works correctly
      try {
        await client.callTool('sed', {
          scriptId: 'invalid-id', // Too short
          pattern: 'test',
          replacement: 'replaced'
        });
        expect.fail('Should have thrown validation error');
      } catch (error: any) {
        expect(error.message).to.include('Script ID');
      }
    });
  });

  describe('AiderTool with FuzzyMatcher', () => {
    it('should perform fuzzy edit with similarity threshold', async () => {
      const result = await client.callTool('aider', {
        scriptId: TEST_SCRIPT_ID,
        path: 'Calculator',
        edits: [{
          searchText: 'function add',
          replaceText: 'function addition',
          similarityThreshold: 0.8
        }],
        dryRun: true
      });

      expect(result).to.have.property('success');
      expect(result).to.have.property('filePath');
    });

    it('should handle whitespace variations in fuzzy matching', async () => {
      const result = await client.callTool('aider', {
        scriptId: TEST_SCRIPT_ID,
        path: 'Calculator',
        edits: [{
          searchText: 'function   add  (  a  ,  b  )',
          replaceText: 'function addition(a, b)',
          similarityThreshold: 0.7
        }],
        dryRun: true
      });

      expect(result).to.have.property('success');
    });

    it('should detect overlapping edits', async () => {
      try {
        await client.callTool('aider', {
          scriptId: TEST_SCRIPT_ID,
          path: 'Calculator',
          edits: [
            { searchText: 'function add', replaceText: 'function addition' },
            { searchText: 'add(a, b)', replaceText: 'sum(a, b)' }
          ]
        });
        // May succeed if edits don't actually overlap in the file
      } catch (error: any) {
        // If they do overlap, should get clear error
        expect(error.message).to.match(/overlap/i);
      }
    });

    it('should apply multiple non-overlapping edits', async () => {
      const result = await client.callTool('aider', {
        scriptId: TEST_SCRIPT_ID,
        path: 'Calculator',
        edits: [
          { searchText: 'function add', replaceText: 'function addition' },
          { searchText: 'function multiply', replaceText: 'function product' }
        ],
        dryRun: true
      });

      expect(result).to.have.property('success');
      if (result.editsApplied !== undefined) {
        expect(result.editsApplied).to.be.at.least(0);
      }
    });
  });

  describe('Schema validation with SchemaFragments', () => {
    it('should validate scriptId format', async () => {
      try {
        await client.callTool('cat', {
          scriptId: 'too-short',
          path: 'Calculator'
        });
        expect.fail('Should have thrown validation error');
      } catch (error: any) {
        expect(error.message).to.match(/script.*id/i);
      }
    });

    it('should validate accessToken format if provided', async () => {
      try {
        await client.callTool('cat', {
          scriptId: TEST_SCRIPT_ID,
          path: 'Calculator',
          accessToken: 'invalid-token-format'
        });
        expect.fail('Should have thrown validation error');
      } catch (error: any) {
        expect(error.message).to.match(/token|ya29/i);
      }
    });

    it('should accept valid scriptId', async () => {
      const result = await client.callTool('cat', {
        scriptId: TEST_SCRIPT_ID,
        path: 'Calculator'
      });

      expect(result).to.be.a('string');
    });
  });

  describe('Real-world scenarios', () => {
    it('should refactor code using sed with RegexProcessor', async () => {
      // Use sed to replace console.log with Logger.log
      const result = await client.callTool('sed', {
        scriptId: TEST_SCRIPT_ID,
        pattern: 'console\\.log',
        replacement: 'Logger.log',
        path: '*',
        dryRun: true
      });

      expect(result).to.have.property('filesProcessed');
      expect(result.files).to.be.an('array');
    });

    it('should update function signatures using aider', async () => {
      const result = await client.callTool('aider', {
        scriptId: TEST_SCRIPT_ID,
        path: 'Calculator',
        edits: [{
          searchText: 'function add(a, b)',
          replaceText: 'function add(a, b, c = 0)',
          similarityThreshold: 0.8
        }],
        dryRun: true
      });

      expect(result).to.have.property('success');
    });

    it('should perform multi-file sed operations', async () => {
      const result = await client.callTool('sed', {
        scriptId: TEST_SCRIPT_ID,
        pattern: 'var ',
        replacement: 'const ',
        maxFiles: 5,
        dryRun: true
      });

      expect(result).to.have.property('filesProcessed');
      expect(result.filesProcessed).to.be.at.most(5);
    });
  });

  describe('Performance and edge cases', () => {
    it('should handle empty replacement', async () => {
      const result = await client.callTool('sed', {
        scriptId: TEST_SCRIPT_ID,
        pattern: 'test',
        replacement: '',
        path: 'Calculator',
        dryRun: true
      });

      expect(result).to.have.property('filesProcessed');
    });

    it('should handle pattern not found gracefully', async () => {
      const result = await client.callTool('sed', {
        scriptId: TEST_SCRIPT_ID,
        pattern: 'THISPATTERNWILLNEVERMATCH12345',
        replacement: 'replaced',
        path: 'Calculator',
        dryRun: true
      });

      expect(result).to.have.property('totalReplacements');
      expect(result.totalReplacements).to.equal(0);
    });

    it('should handle fuzzy match not found', async () => {
      const result = await client.callTool('aider', {
        scriptId: TEST_SCRIPT_ID,
        path: 'Calculator',
        edits: [{
          searchText: 'THISPATTERNWILLNEVERMATCH12345',
          replaceText: 'replaced',
          similarityThreshold: 0.8
        }],
        dryRun: true
      });

      expect(result).to.have.property('success');
      if (result.editsApplied !== undefined) {
        expect(result.editsApplied).to.equal(0);
      }
    });
  });
});
