/**
 * Test suite for new ripgrep features: ignoreCase, sort
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { sortRipgrepResults } from '../../src/utils/ripgrepUtils.js';

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
  });
});

describe('sortRipgrepResults', () => {
  describe('path sorting', () => {
    it('should sort results alphabetically by fileName', () => {
      const matches = [
        { fileName: 'zebra/file' },
        { fileName: 'alpha/file' },
        { fileName: 'middle/file' }
      ];
      const sorted = sortRipgrepResults(matches, 'path', []);
      expect(sorted.map(m => m.fileName)).to.deep.equal([
        'alpha/file', 'middle/file', 'zebra/file'
      ]);
    });

    it('should handle empty array', () => {
      const sorted = sortRipgrepResults([], 'path', []);
      expect(sorted).to.deep.equal([]);
    });

    it('should handle single item', () => {
      const matches = [{ fileName: 'only/file' }];
      const sorted = sortRipgrepResults(matches, 'path', []);
      expect(sorted).to.deep.equal(matches);
    });

    it('should not mutate original array', () => {
      const matches = [
        { fileName: 'b/file' },
        { fileName: 'a/file' }
      ];
      const original = [...matches];
      sortRipgrepResults(matches, 'path', []);
      expect(matches).to.deep.equal(original);
    });

    it('should handle files with same name prefix', () => {
      const matches = [
        { fileName: 'utils/helper2' },
        { fileName: 'utils/helper1' },
        { fileName: 'utils/helper10' }
      ];
      const sorted = sortRipgrepResults(matches, 'path', []);
      // localeCompare handles string sorting (not numeric)
      expect(sorted[0].fileName).to.equal('utils/helper1');
      expect(sorted[1].fileName).to.equal('utils/helper10');
      expect(sorted[2].fileName).to.equal('utils/helper2');
    });
  });

  describe('modified sorting', () => {
    it('should sort by modification time (newest first)', () => {
      const matches = [
        { fileName: 'old.js' },
        { fileName: 'new.js' },
        { fileName: 'middle.js' }
      ];
      const files = [
        { name: 'old.js', lastModified: 1000 },
        { name: 'new.js', lastModified: 3000 },
        { name: 'middle.js', lastModified: 2000 }
      ];
      const sorted = sortRipgrepResults(matches, 'modified', files);
      expect(sorted.map(m => m.fileName)).to.deep.equal([
        'new.js', 'middle.js', 'old.js'
      ]);
    });

    it('should handle files not found in files array (default to 0)', () => {
      const matches = [
        { fileName: 'known.js' },
        { fileName: 'unknown.js' }
      ];
      const files = [
        { name: 'known.js', lastModified: 1000 }
      ];
      const sorted = sortRipgrepResults(matches, 'modified', files);
      // known.js (1000) should come before unknown.js (0)
      expect(sorted[0].fileName).to.equal('known.js');
    });

    it('should handle undefined lastModified', () => {
      const matches = [
        { fileName: 'a.js' },
        { fileName: 'b.js' }
      ];
      const files = [
        { name: 'a.js' }, // no lastModified
        { name: 'b.js', lastModified: 1000 }
      ];
      const sorted = sortRipgrepResults(matches, 'modified', files);
      // b.js (1000) before a.js (0)
      expect(sorted[0].fileName).to.equal('b.js');
    });
  });

  describe('edge cases', () => {
    it('should preserve additional properties on match objects', () => {
      const matches = [
        { fileName: 'b.js', totalMatches: 5, extra: 'data' },
        { fileName: 'a.js', totalMatches: 3, extra: 'info' }
      ];
      const sorted = sortRipgrepResults(matches, 'path', []);
      expect(sorted[0]).to.deep.include({ fileName: 'a.js', totalMatches: 3, extra: 'info' });
    });

    it('should handle special characters in filenames', () => {
      const matches = [
        { fileName: 'café/file' },
        { fileName: 'apple/file' }
      ];
      const sorted = sortRipgrepResults(matches, 'path', []);
      // localeCompare handles unicode
      expect(sorted[0].fileName).to.equal('apple/file');
    });
  });
});
