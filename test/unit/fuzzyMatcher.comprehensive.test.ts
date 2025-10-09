/**
 * Comprehensive unit tests for FuzzyMatcher
 *
 * Tests all phases of the fuzzy matching algorithm:
 * - Phase 1: Exact match
 * - Phase 2: Normalized exact match with position mapping
 * - Phase 3: Length-based filtering
 * - Phase 4: Character-set filtering
 * - Phase 5: Full Levenshtein fuzzy matching
 *
 * Focus: Correctness, performance, and edge cases
 */

import { expect } from 'chai';
import { FuzzyMatcher } from '../../src/utils/fuzzyMatcher.js';

describe('FuzzyMatcher - Comprehensive Tests', () => {
  let matcher: FuzzyMatcher;

  beforeEach(() => {
    matcher = new FuzzyMatcher(false);
  });

  describe('Phase 1: Exact Match', () => {
    it('should find exact matches instantly', () => {
      const content = 'The quick brown fox jumps over the lazy dog';
      const search = 'quick brown fox';

      const startTime = Date.now();
      const match = matcher.findFuzzyMatch(content, search, 0.8);
      const elapsed = Date.now() - startTime;

      expect(match).to.not.be.null;
      expect(match!.similarity).to.equal(1.0);
      expect(match!.position).to.equal(4);
      expect(elapsed).to.be.lessThan(5); // Should be instant
    });

    it('should handle exact match at start of content', () => {
      const content = 'hello world';
      const search = 'hello';

      const match = matcher.findFuzzyMatch(content, search, 0.8);

      expect(match).to.not.be.null;
      expect(match!.position).to.equal(0);
      expect(match!.text).to.equal('hello');
    });

    it('should handle exact match at end of content', () => {
      const content = 'hello world';
      const search = 'world';

      const match = matcher.findFuzzyMatch(content, search, 0.8);

      expect(match).to.not.be.null;
      expect(match!.position).to.equal(6);
      expect(match!.text).to.equal('world');
    });
  });

  describe('Phase 2: Normalized Exact Match with Position Mapping', () => {
    describe('Position Mapping Correctness', () => {
      it('should correctly map positions for CRLF line endings', () => {
        const content = 'line1\r\nline2\r\nline3';
        const search = 'line2';

        const match = matcher.findFuzzyMatch(content, search, 0.8);

        expect(match).to.not.be.null;
        expect(match!.similarity).to.equal(1.0);

        // Verify extracted text matches search
        const extracted = content.substring(match!.position, match!.endPosition);
        expect(extracted).to.equal('line2');
      });

      it('should correctly map positions for tab characters', () => {
        const content = 'hello\t\tworld';
        const search = 'world';

        const match = matcher.findFuzzyMatch(content, search, 0.8);

        expect(match).to.not.be.null;
        const extracted = content.substring(match!.position, match!.endPosition);
        expect(extracted).to.equal('world');
      });

      it('should correctly map positions for multiple spaces', () => {
        const content = 'hello     world';
        const search = 'world';

        const match = matcher.findFuzzyMatch(content, search, 0.8);

        expect(match).to.not.be.null;
        const extracted = content.substring(match!.position, match!.endPosition);
        expect(extracted).to.equal('world');
      });

      it('should correctly map positions for mixed whitespace', () => {
        const content = 'hello\r\n\t  world\r\n';
        const search = 'world';

        const match = matcher.findFuzzyMatch(content, search, 0.8);

        expect(match).to.not.be.null;
        const extracted = content.substring(match!.position, match!.endPosition);
        expect(extracted).to.equal('world');
      });
    });

    describe('Whitespace-Only Variations', () => {
      it('should handle extra spaces in content (user reported case)', () => {
        const search = 'function renderStateItem(container, key, value, depth) { const item = document.createElement("div");';
        const content = 'function   renderStateItem(container,   key,   value,   depth)   {   const   item   =   document.createElement("div");';

        const startTime = Date.now();
        const match = matcher.findFuzzyMatch(content, search, 0.8);
        const elapsed = Date.now() - startTime;

        expect(match).to.not.be.null;
        expect(match!.similarity).to.be.greaterThan(0.95); // Very high similarity
        expect(elapsed).to.be.lessThan(100); // Should be fast (normalized exact or quick fuzzy)
      });

      it('should handle CRLF vs LF differences', () => {
        const search = 'line1\nline2\nline3';
        const content = 'line1\r\nline2\r\nline3';

        const match = matcher.findFuzzyMatch(content, search, 0.8);

        expect(match).to.not.be.null;
        expect(match!.similarity).to.equal(1.0);
      });

      it('should handle tabs vs spaces', () => {
        const search = 'function test() {  return 42; }';
        const content = 'function test() {\t\treturn 42; }';

        const match = matcher.findFuzzyMatch(content, search, 0.8);

        expect(match).to.not.be.null;
        expect(match!.similarity).to.be.greaterThan(0.9);
      });
    });

    describe('Performance Verification', () => {
      it('should handle whitespace variations in <100ms', () => {
        const search = 'a'.repeat(100);
        const content = 'x'.repeat(1000) + 'a  '.repeat(50).trim() + 'y'.repeat(1000);

        const startTime = Date.now();
        const match = matcher.findFuzzyMatch(content, search, 0.8);
        const elapsed = Date.now() - startTime;

        expect(elapsed).to.be.lessThan(100);
      });
    });
  });

  describe('Phase 3: Length-Based Filtering', () => {
    it('should quickly reject candidates that are too short', () => {
      const search = 'a'.repeat(100);
      const content = 'x'.repeat(5000) + 'b'.repeat(50) + 'y'.repeat(5000); // Only 50-char string

      const startTime = Date.now();
      const match = matcher.findFuzzyMatch(content, search, 0.8);
      const elapsed = Date.now() - startTime;

      expect(match).to.be.null; // Should not match
      expect(elapsed).to.be.lessThan(1000); // Should be fast due to length filter
    });

    it('should quickly reject candidates that are too long', () => {
      const search = 'abc';
      const content = 'x'.repeat(5000) + 'a'.repeat(100) + 'y'.repeat(5000); // 100-char string

      const startTime = Date.now();
      const match = matcher.findFuzzyMatch(content, search, 0.8);
      const elapsed = Date.now() - startTime;

      expect(match).to.be.null;
      expect(elapsed).to.be.lessThan(1000);
    });
  });

  describe('Phase 4: Character-Set Filtering', () => {
    it('should quickly reject candidates missing required characters', () => {
      const search = 'xyz123abc';
      const content = 'a'.repeat(10000) + 'def456ghi' + 'b'.repeat(10000);

      const startTime = Date.now();
      const match = matcher.findFuzzyMatch(content, search, 0.8);
      const elapsed = Date.now() - startTime;

      expect(match).to.be.null;
      expect(elapsed).to.be.lessThan(200); // Character-set filter should make this fast
    });

    it('should not reject candidates that have all required characters', () => {
      const search = 'abc123';
      const content = 'xyz 123abc xyz';

      const match = matcher.findFuzzyMatch(content, search, 0.7);

      expect(match).to.not.be.null; // Should find something
    });
  });

  describe('Phase 5: Full Fuzzy Matching (Levenshtein)', () => {
    it('should find fuzzy matches with character differences', () => {
      const search = 'hello world';
      const content = 'helo wrld'; // Missing chars

      const match = matcher.findFuzzyMatch(content, search, 0.7);

      expect(match).to.not.be.null;
      expect(match!.similarity).to.be.lessThan(1.0);
      expect(match!.similarity).to.be.greaterThan(0.7);
    });

    it('should respect similarity threshold', () => {
      const search = 'completely different';
      const content = 'nothing like it';

      const match = matcher.findFuzzyMatch(content, search, 0.8);

      expect(match).to.be.null; // Too different
    });

    it('should find best match among multiple candidates', () => {
      const search = 'test';
      const content = 'tast tost test tezt';

      const match = matcher.findFuzzyMatch(content, search, 0.7);

      expect(match).to.not.be.null;
      expect(match!.similarity).to.equal(1.0); // Should find exact match
      expect(match!.text).to.equal('test');
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('should handle empty content', () => {
      const match = matcher.findFuzzyMatch('', 'test', 0.8);
      expect(match).to.be.null;
    });

    it('should throw on empty search text', () => {
      expect(() => matcher.findFuzzyMatch('content', '', 0.8)).to.throw('searchText cannot be empty');
    });

    it('should handle single character strings', () => {
      const match = matcher.findFuzzyMatch('x', 'x', 0.8);
      expect(match).to.not.be.null;
      expect(match!.similarity).to.equal(1.0);
    });

    it('should handle very long strings (near 1000 char limit)', () => {
      const search = 'x'.repeat(990);
      const content = 'y'.repeat(5000) + 'x'.repeat(990) + 'z'.repeat(5000);

      const startTime = Date.now();
      const match = matcher.findFuzzyMatch(content, search, 0.8);
      const elapsed = Date.now() - startTime;

      expect(match).to.not.be.null;
      expect(elapsed).to.be.lessThan(5000); // Should complete in reasonable time
    });

    it('should handle unicode and special characters', () => {
      const search = 'hello → world 🚀';
      const content = 'prefix hello  →  world  🚀 suffix';

      const match = matcher.findFuzzyMatch(content, search, 0.8);

      expect(match).to.not.be.null;
      const extracted = content.substring(match!.position, match!.endPosition);
      expect(extracted).to.include('🚀');
    });

    it('should handle content with only whitespace', () => {
      const match = matcher.findFuzzyMatch('   \n\n\t\t   ', 'test', 0.8);
      expect(match).to.be.null;
    });

    it('should handle search text with leading/trailing whitespace', () => {
      const search = '   hello   ';
      const content = 'hello world';

      const match = matcher.findFuzzyMatch(content, search, 0.8);

      expect(match).to.not.be.null;
      expect(match!.similarity).to.be.greaterThan(0.8);
    });
  });

  describe('Data Corruption Prevention', () => {
    it('should never return positions outside content bounds', () => {
      const testCases = [
        { content: 'abc', search: 'abc' },
        { content: 'a\r\n\r\nb', search: 'b' },
        { content: 'a\t\tb', search: 'b' },
        { content: 'a     b', search: 'b' },
      ];

      testCases.forEach(({ content, search }) => {
        const match = matcher.findFuzzyMatch(content, search, 0.8);
        if (match) {
          expect(match.position).to.be.at.least(0);
          expect(match.position).to.be.lessThan(content.length);
          expect(match.endPosition).to.be.at.most(content.length);
          expect(match.endPosition).to.be.greaterThan(match.position);

          // Verify extraction is valid
          const extracted = content.substring(match.position, match.endPosition);
          expect(extracted.length).to.be.greaterThan(0);
        }
      });
    });

    it('should return positions that extract meaningful text', () => {
      const content = 'BEFORE\r\n\r\nTARGET\r\n\r\nAFTER';
      const search = 'TARGET';

      const match = matcher.findFuzzyMatch(content, search, 0.8);

      expect(match).to.not.be.null;
      const extracted = content.substring(match!.position, match!.endPosition);
      expect(extracted).to.equal('TARGET');
    });
  });

  describe('Multiple Edits (findAllMatches)', () => {
    it('should find all matches correctly', () => {
      const content = 'first second third';
      const edits = [
        { searchText: 'first', replaceText: 'FIRST', similarityThreshold: 0.8 },
        { searchText: 'third', replaceText: 'THIRD', similarityThreshold: 0.8 }
      ];

      const result = matcher.findAllMatches(content, edits);

      expect(result).to.have.length(2);
      expect(result[0].match).to.not.be.undefined;
      expect(result[1].match).to.not.be.undefined;

      expect(result[0].match!.text).to.equal('first');
      expect(result[1].match!.text).to.equal('third');
    });

    it('should detect overlapping edits', () => {
      const content = 'AAABBBCCC';
      const edits = [
        { searchText: 'AAABBB', replaceText: 'X', similarityThreshold: 0.8 },
        { searchText: 'BBBCCC', replaceText: 'Y', similarityThreshold: 0.8 }
      ];

      expect(() => matcher.findAllMatches(content, edits)).to.throw(/overlap/i);
    });

    it('should handle non-matching edits gracefully', () => {
      const content = 'hello world';
      const edits = [
        { searchText: 'hello', replaceText: 'HELLO', similarityThreshold: 0.8 },
        { searchText: 'notfound', replaceText: 'X', similarityThreshold: 0.8 }
      ];

      const result = matcher.findAllMatches(content, edits);

      expect(result).to.have.length(2);
      expect(result[0].match).to.not.be.undefined;
      expect(result[1].match).to.be.undefined;
    });
  });

  describe('Performance Regression Tests', () => {
    it('should complete user reported case in <100ms', () => {
      const search = '    function renderStateItem(container, key, value, depth) {\n      const item = document.createElement(\'div\');\n      item.className = \'state-item\';';
      const content = 'x'.repeat(2000) + '    function   renderStateItem(container,   key,   value,   depth)   {\n      const   item   =   document.createElement(\'div\');\n      item.className   =   \'state-item\';' + 'y'.repeat(2000);

      const startTime = Date.now();
      const match = matcher.findFuzzyMatch(content, search, 0.8);
      const elapsed = Date.now() - startTime;

      expect(match).to.not.be.null;
      expect(elapsed).to.be.lessThan(100); // Should be blazing fast
    });

    it('should not hang on large files', () => {
      const search = 'function test() { return 42; }';
      const largeContent = 'x'.repeat(50000);

      const startTime = Date.now();
      const match = matcher.findFuzzyMatch(largeContent, search, 0.8);
      const elapsed = Date.now() - startTime;

      expect(elapsed).to.be.lessThan(5000); // Should complete reasonably fast
    });
  });
});
