/**
 * Integration tests for FuzzyMatcher edge cases
 * Tests various whitespace scenarios to ensure correct position mapping
 */

import { expect } from 'chai';
import { FuzzyMatcher } from '../../src/utils/fuzzyMatcher.js';

describe('FuzzyMatcher - Edge Cases', () => {
  let matcher: FuzzyMatcher;

  beforeEach(() => {
    matcher = new FuzzyMatcher(false);
  });

  describe('Whitespace Edge Cases', () => {
    it('should handle CRLF line endings correctly', () => {
      const content = 'function test() {\r\n  return 42;\r\n}';
      const searchText = 'return 42';

      const match = matcher.findFuzzyMatch(content, searchText, 0.8);

      expect(match).to.not.be.null;
      if (match) {
        // Verify we found the right text in the original content
        const actualText = content.substring(match.position, match.endPosition);
        expect(actualText).to.equal('return 42');
      }
    });

    it('should handle tab characters correctly', () => {
      const content = 'function test() {\n\t\treturn 42;\n}';
      const searchText = 'return 42';

      const match = matcher.findFuzzyMatch(content, searchText, 0.8);

      expect(match).to.not.be.null;
      if (match) {
        const actualText = content.substring(match.position, match.endPosition);
        expect(actualText).to.equal('return 42');
      }
    });

    it('should handle multiple spaces correctly', () => {
      const content = 'function    test()    {    return    42;    }';
      const searchText = 'return 42';

      const match = matcher.findFuzzyMatch(content, searchText, 0.8);

      expect(match).to.not.be.null;
      if (match) {
        const actualText = content.substring(match.position, match.endPosition);
        // Should find "return    42" (with multiple spaces)
        expect(actualText).to.include('return');
        expect(actualText).to.include('42');
      }
    });

    it('should handle mixed whitespace (tabs, spaces, CRLF)', () => {
      const content = 'function test() {\r\n\t  return   42;\r\n\t}';
      const searchText = 'return 42';

      const match = matcher.findFuzzyMatch(content, searchText, 0.8);

      expect(match).to.not.be.null;
      if (match) {
        const actualText = content.substring(match.position, match.endPosition);
        expect(actualText).to.include('return');
        expect(actualText).to.include('42');
      }
    });
  });

  describe('Exact Match Edge Cases', () => {
    it('should find exact match even with different whitespace in content', () => {
      const content = 'hello\r\n\tworld\r\n\tfoo\r\nbar';
      const searchText = 'foo';

      const match = matcher.findFuzzyMatch(content, searchText, 0.8);

      expect(match).to.not.be.null;
      if (match) {
        expect(match.similarity).to.equal(1.0);
        expect(match.text).to.equal('foo');
        // Verify position is correct
        const actualText = content.substring(match.position, match.endPosition);
        expect(actualText).to.equal('foo');
      }
    });

    it('should not return wrong positions with whitespace variations', () => {
      const content = 'const x = 1;\r\nconst y = 2;\r\nconst z = 3;';
      const searchText = 'const z = 3';

      const match = matcher.findFuzzyMatch(content, searchText, 0.8);

      expect(match).to.not.be.null;
      if (match) {
        // Verify the match is at the correct position
        const actualText = content.substring(match.position, match.endPosition);
        expect(actualText).to.equal('const z = 3');
        // Should NOT match "const x = 1" or "const y = 2"
        expect(actualText).to.not.include('x');
        expect(actualText).to.not.include('y');
      }
    });
  });

  describe('Fuzzy Match with Whitespace Variations', () => {
    it('should find fuzzy match despite whitespace differences', () => {
      const content = 'function\ttest(){\nreturn\n42;\n}';
      const searchText = 'function test() { return 42; }';

      const match = matcher.findFuzzyMatch(content, searchText, 0.7);

      expect(match).to.not.be.null;
      if (match) {
        expect(match.similarity).to.be.greaterThan(0.7);
        // Verify positions are in original content
        const actualText = content.substring(match.position, match.endPosition);
        expect(actualText).to.include('function');
        expect(actualText).to.include('test');
        expect(actualText).to.include('42');
      }
    });
  });

  describe('Position Integrity', () => {
    it('should return positions that are valid in original content', () => {
      const content = 'line1\r\nline2\r\nline3\r\nline4';
      const searchText = 'line3';

      const match = matcher.findFuzzyMatch(content, searchText, 0.8);

      expect(match).to.not.be.null;
      if (match) {
        // Positions should be within bounds
        expect(match.position).to.be.at.least(0);
        expect(match.position).to.be.lessThan(content.length);
        expect(match.endPosition).to.be.at.most(content.length);
        expect(match.endPosition).to.be.greaterThan(match.position);

        // Extracted text should match what's actually in content
        const extracted = content.substring(match.position, match.endPosition);
        expect(extracted).to.equal('line3');
      }
    });

    it('should maintain position integrity across multiple edits', () => {
      const content = 'first\r\nsecond\r\nthird\r\nfourth';
      const edits = [
        { searchText: 'first', replaceText: 'FIRST', similarityThreshold: 0.8 },
        { searchText: 'third', replaceText: 'THIRD', similarityThreshold: 0.8 }
      ];

      const editsWithMatches = matcher.findAllMatches(content, edits);

      // Both should find matches
      expect(editsWithMatches[0].match).to.not.be.undefined;
      expect(editsWithMatches[1].match).to.not.be.undefined;

      // Verify both positions are correct
      if (editsWithMatches[0].match && editsWithMatches[1].match) {
        const firstMatch = content.substring(
          editsWithMatches[0].match.position,
          editsWithMatches[0].match.endPosition
        );
        const thirdMatch = content.substring(
          editsWithMatches[1].match.position,
          editsWithMatches[1].match.endPosition
        );

        expect(firstMatch).to.equal('first');
        expect(thirdMatch).to.equal('third');
      }
    });
  });

  describe('Timeout Behavior', () => {
    it('should timeout after specified duration for pathological cases', () => {
      // Create a very long content with 1MB of repeated text
      const content = 'x'.repeat(1000000);
      const searchText = 'y'.repeat(1000); // Won't be found, will search entire space

      const shortTimeoutMatcher = new FuzzyMatcher(false, 1000); // 1 second timeout

      let error: Error | null = null;
      try {
        shortTimeoutMatcher.findFuzzyMatch(content, searchText, 0.8);
      } catch (e: any) {
        error = e;
      }

      expect(error).to.not.be.null;
      if (error) {
        expect(error.message).to.include('timeout');
        expect(error.message).to.include('1.');
      }
    });
  });
});
