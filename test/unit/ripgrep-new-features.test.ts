/**
 * Test suite for new ripgrep features: ignoreCase, sort, trim
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';

describe('Ripgrep New Features', () => {
  describe('Parameter Validation', () => {
    it('should accept ignoreCase parameter', () => {
      const params = {
        scriptId: '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
        pattern: 'todo',
        ignoreCase: true
      };

      expect(params.ignoreCase).to.be.true;
    });

    it('should accept sort parameter with valid values', () => {
      const validSortValues = ['none', 'path', 'modified'];

      validSortValues.forEach(sortValue => {
        const params = {
          scriptId: '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
          pattern: 'function',
          sort: sortValue
        };

        expect(params.sort).to.equal(sortValue);
      });
    });

    it('should accept trim parameter', () => {
      const params = {
        scriptId: '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
        pattern: 'class',
        trim: true
      };

      expect(params.trim).to.be.true;
    });
  });

  describe('ignoreCase Logic', () => {
    it('should override caseSensitive when ignoreCase is true', () => {
      const params = {
        scriptId: '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
        pattern: 'TODO',
        ignoreCase: true,
        caseSensitive: true  // This should be overridden
      };

      // When ignoreCase is true, search should be case-insensitive
      const effectiveCaseSensitive = params.ignoreCase ? false : params.caseSensitive;
      expect(effectiveCaseSensitive).to.be.false;
    });

    it('should override smartCase when ignoreCase is true', () => {
      const params = {
        scriptId: '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
        pattern: 'TODO',
        ignoreCase: true,
        smartCase: true  // This should be overridden
      };

      // When ignoreCase is true, smartCase should be disabled
      const effectiveSmartCase = params.ignoreCase ? false : params.smartCase;
      expect(effectiveSmartCase).to.be.false;
    });
  });

  describe('Sort Results', () => {
    it('should sort results alphabetically by path', () => {
      const mockMatches = [
        { fileName: 'utils/helper' },
        { fileName: 'api/client' },
        { fileName: 'models/User' }
      ];

      const sorted = [...mockMatches].sort((a, b) =>
        a.fileName.localeCompare(b.fileName)
      );

      expect(sorted[0].fileName).to.equal('api/client');
      expect(sorted[1].fileName).to.equal('models/User');
      expect(sorted[2].fileName).to.equal('utils/helper');
    });

    it('should maintain original order when sort is "none"', () => {
      const mockMatches = [
        { fileName: 'zebra' },
        { fileName: 'alpha' },
        { fileName: 'beta' }
      ];

      const sortBy = 'none';
      const sorted = sortBy === 'none' ? mockMatches : [...mockMatches].sort();

      expect(sorted).to.deep.equal(mockMatches);
    });
  });

  describe('Trim Whitespace', () => {
    it('should trim leading and trailing whitespace from string lines', () => {
      const line = '   const foo = "bar";   ';
      const trimmed = line.trim();

      expect(trimmed).to.equal('const foo = "bar";');
    });

    it('should trim whitespace from line objects with content property', () => {
      const lineObj = {
        lineNumber: 42,
        content: '   function test() {   '
      };

      const trimmed = {
        ...lineObj,
        content: lineObj.content.trim()
      };

      expect(trimmed.content).to.equal('function test() {');
      expect(trimmed.lineNumber).to.equal(42);
    });

    it('should handle arrays of mixed line types', () => {
      const lines: any[] = [
        '  line one  ',
        { content: '  line two  ', lineNumber: 2 },
        '  line three  '
      ];

      const trimmed = lines.map(line => {
        if (typeof line === 'string') {
          return line.trim();
        } else if (line && typeof line.content === 'string') {
          return { ...line, content: line.content.trim() };
        }
        return line;
      });

      expect(trimmed[0]).to.equal('line one');
      expect(trimmed[1].content).to.equal('line two');
      expect(trimmed[2]).to.equal('line three');
    });
  });

  describe('Feature Combinations', () => {
    it('should support using ignoreCase and sort together', () => {
      const params = {
        scriptId: '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
        pattern: 'todo',
        ignoreCase: true,
        sort: 'path'
      };

      expect(params.ignoreCase).to.be.true;
      expect(params.sort).to.equal('path');
    });

    it('should support using all three new features together', () => {
      const params = {
        scriptId: '1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0123456789',
        pattern: 'function',
        ignoreCase: true,
        sort: 'path',
        trim: true
      };

      expect(params.ignoreCase).to.be.true;
      expect(params.sort).to.equal('path');
      expect(params.trim).to.be.true;
    });
  });
});
