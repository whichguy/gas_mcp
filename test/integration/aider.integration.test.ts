/**
 * Integration tests for aider tool with fuzzyMatcher
 *
 * Tests the integration between the aider MCP tool and the fuzzyMatcher utility:
 * - findAllMatches correctly processes multiple edits
 * - applyEdits applies changes in reverse order
 * - Overlap detection prevents conflicting edits
 * - Whitespace variations handled by Phase 2
 * - Performance regression prevention (user's reported 30s → <100ms case)
 */

import { expect } from 'chai';
import { FuzzyMatcher } from '../../src/utils/fuzzyMatcher.js';

describe('Aider Tool Integration Tests', () => {
  let matcher: FuzzyMatcher;

  beforeEach(() => {
    matcher = new FuzzyMatcher(false);
  });

  describe('findAllMatches - Multiple Edits', () => {
    it('should correctly identify all edits', () => {
      const content = 'function first() { return 1; }\nfunction second() { return 2; }\nfunction third() { return 3; }';
      const edits = [
        { searchText: 'return 1', replaceText: 'return 10', similarityThreshold: 0.8 },
        { searchText: 'return 3', replaceText: 'return 30', similarityThreshold: 0.8 }
      ];

      const result = matcher.findAllMatches(content, edits);

      expect(result).to.have.length(2);
      expect(result[0].match).to.not.be.undefined;
      expect(result[1].match).to.not.be.undefined;
      expect(result[0].match!.text).to.equal('return 1');
      expect(result[1].match!.text).to.equal('return 3');
    });

    it('should handle unsuccessful matches gracefully', () => {
      const content = 'hello world';
      const edits = [
        { searchText: 'hello world', replaceText: 'FOUND', similarityThreshold: 0.8 },
        { searchText: 'not found text', replaceText: 'NOT FOUND', similarityThreshold: 0.8 }
      ];

      const result = matcher.findAllMatches(content, edits);

      expect(result).to.have.length(2);
      expect(result[0].match).to.not.be.undefined;
      expect(result[1].match).to.be.undefined;
    });
  });

  describe('applyEdits - Reverse Order Application', () => {
    it('should correctly apply edits in reverse order', () => {
      const content = 'first second third';
      const edits = [
        {
          searchText: 'first',
          replaceText: 'FIRST',
          match: { position: 0, endPosition: 5, text: 'first', similarity: 1.0 }
        },
        {
          searchText: 'third',
          replaceText: 'THIRD',
          match: { position: 13, endPosition: 18, text: 'third', similarity: 1.0 }
        }
      ];

      const { content: modifiedContent, editsApplied } = matcher.applyEdits(content, edits);

      expect(modifiedContent).to.equal('FIRST second THIRD');
      expect(editsApplied).to.equal(2);
    });

    it('should prevent position shifts by applying in reverse order', () => {
      const content = 'AAA BBB CCC';
      const edits = [
        {
          searchText: 'AAA',
          replaceText: 'A',
          match: { position: 0, endPosition: 3, text: 'AAA', similarity: 1.0 }
        },
        {
          searchText: 'CCC',
          replaceText: 'C',
          match: { position: 8, endPosition: 11, text: 'CCC', similarity: 1.0 }
        }
      ];

      const { content: modifiedContent } = matcher.applyEdits(content, edits);

      // If applied in forward order, the second edit's position would be invalidated
      // Reverse order prevents this
      expect(modifiedContent).to.equal('A BBB C');
    });
  });

  describe('Overlap Detection', () => {
    it('should detect and reject overlapping edits', () => {
      const content = 'AAABBBCCC';
      const edits = [
        { searchText: 'AAABBB', replaceText: 'X', similarityThreshold: 0.8 },
        { searchText: 'BBBCCC', replaceText: 'Y', similarityThreshold: 0.8 }
      ];

      expect(() => matcher.findAllMatches(content, edits)).to.throw(/overlap/i);
    });

    it('should allow non-overlapping edits', () => {
      const content = 'AAA BBB CCC';
      const edits = [
        { searchText: 'AAA', replaceText: 'X', similarityThreshold: 0.8 },
        { searchText: 'CCC', replaceText: 'Y', similarityThreshold: 0.8 }
      ];

      const result = matcher.findAllMatches(content, edits);

      expect(result).to.have.length(2);
      expect(result[0].match).to.not.be.undefined;
      expect(result[1].match).to.not.be.undefined;
    });
  });

  describe('Whitespace Variation Handling (Phase 2)', () => {
    it('should handle whitespace variations with high similarity', () => {
      const content = 'function   test(x,   y,   z)   {   return   x+y+z;   }';
      const edits = [
        {
          searchText: 'function test(x, y, z) { return x+y+z; }',
          replaceText: 'const test = (x, y, z) => x+y+z;',
          similarityThreshold: 0.8
        }
      ];

      const result = matcher.findAllMatches(content, edits);

      expect(result[0].match).to.not.be.undefined;
      expect(result[0].match!.similarity).to.be.greaterThan(0.95);
    });

    it('should handle whitespace variations quickly (<100ms)', () => {
      const content = 'function   test(x,   y,   z)   {   return   x+y+z;   }';
      const edits = [
        {
          searchText: 'function test(x, y, z) { return x+y+z; }',
          replaceText: 'const test = (x, y, z) => x+y+z;',
          similarityThreshold: 0.8
        }
      ];

      const start = Date.now();
      const result = matcher.findAllMatches(content, edits);
      const elapsed = Date.now() - start;

      expect(result[0].match).to.not.be.undefined;
      expect(elapsed).to.be.lessThan(100);
    });
  });

  describe('Performance Regression Prevention', () => {
    it('should handle user reported case (147 chars) in <100ms (was 30s)', () => {
      const search = 'function renderStateItem(container, key, value, depth) { const item = document.createElement("div");';
      const content = 'function   renderStateItem(container,   key,   value,   depth)   {   const   item   =   document.createElement("div");';
      const edits = [
        { searchText: search, replaceText: 'REPLACED', similarityThreshold: 0.8 }
      ];

      const start = Date.now();
      const result = matcher.findAllMatches(content, edits);
      const elapsed = Date.now() - start;

      expect(result[0].match).to.not.be.undefined;
      expect(elapsed).to.be.lessThan(100);
    });
  });

  describe('End-to-End Workflow', () => {
    it('should correctly process find → validate → apply workflow', () => {
      const content = 'hello world, hello universe';
      const edits = [
        { searchText: 'hello', replaceText: 'HELLO', similarityThreshold: 0.8 },
        { searchText: 'world', replaceText: 'WORLD', similarityThreshold: 0.8 }
      ];

      // Step 1: Find all matches
      const foundEdits = matcher.findAllMatches(content, edits);
      expect(foundEdits).to.have.length(2);
      expect(foundEdits[0].match).to.not.be.undefined;
      expect(foundEdits[1].match).to.not.be.undefined;

      // Step 2: Validate no overlaps (already done in findAllMatches)
      // If we got here, no overlaps were detected

      // Step 3: Apply edits
      const { content: modifiedContent, editsApplied } = matcher.applyEdits(content, foundEdits);
      expect(modifiedContent).to.equal('HELLO WORLD, HELLO universe');
      expect(editsApplied).to.equal(2);
    });

    it('should handle mixed success/failure in workflow', () => {
      const content = 'found1 found2';
      const edits = [
        { searchText: 'found1', replaceText: 'FOUND1', similarityThreshold: 0.8 },
        { searchText: 'notfound', replaceText: 'NOT', similarityThreshold: 0.8 },
        { searchText: 'found2', replaceText: 'FOUND2', similarityThreshold: 0.8 }
      ];

      const foundEdits = matcher.findAllMatches(content, edits);
      expect(foundEdits).to.have.length(3);
      expect(foundEdits[0].match).to.not.be.undefined;
      expect(foundEdits[1].match).to.be.undefined;
      expect(foundEdits[2].match).to.not.be.undefined;

      const { content: modifiedContent, editsApplied } = matcher.applyEdits(content, foundEdits);
      expect(modifiedContent).to.equal('FOUND1 FOUND2');
      expect(editsApplied).to.equal(2); // Only successful matches applied
    });
  });
});
