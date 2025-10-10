/**
 * Performance tests for FuzzyMatcher
 *
 * Validates performance claims documented in aider.ts (lines 209-216):
 * - Phase 1 (Exact): <1ms (50% of cases)
 * - Phase 2 (Normalized): <5ms (45% of cases)
 * - Phase 3+4 (Filters): <500ms (4% of cases)
 * - Phase 5 (Fuzzy): 1-30s (1% of truly different text)
 *
 * Also validates the critical fix: user's reported case (30s → <100ms)
 */

import { expect } from 'chai';
import { FuzzyMatcher } from '../../src/utils/fuzzyMatcher.js';

describe('FuzzyMatcher - Performance Tests', () => {
  let matcher: FuzzyMatcher;

  beforeEach(() => {
    matcher = new FuzzyMatcher(false);
  });

  /**
   * Helper function to benchmark a search operation
   * Runs 10 iterations and returns average time
   */
  function benchmark(fn: () => void, iterations = 10): number {
    const times: number[] = [];

    // Warmup
    fn();

    // Actual benchmarks
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      fn();
      times.push(Date.now() - start);
    }

    return times.reduce((a, b) => a + b, 0) / iterations;
  }

  describe('Phase 1: Exact Match Performance', () => {
    it('should find exact match in small string in <1ms', () => {
      const search = 'function test() { return 1; }';
      const content = 'prefix ' + search + ' suffix';

      const avgTime = benchmark(() => {
        matcher.findFuzzyMatch(content, search, 0.8);
      });

      expect(avgTime).to.be.lessThan(1);
    });

    it('should find exact match in medium string (150 chars) in <1ms', () => {
      const search = 'a'.repeat(150);
      const content = 'x'.repeat(1000) + search + 'y'.repeat(1000);

      const avgTime = benchmark(() => {
        matcher.findFuzzyMatch(content, search, 0.8);
      });

      expect(avgTime).to.be.lessThan(1);
    });

    it('should find exact match at start of file in <1ms', () => {
      const search = 'hello world';
      const content = search + ' more text here';

      const avgTime = benchmark(() => {
        matcher.findFuzzyMatch(content, search, 0.8);
      });

      expect(avgTime).to.be.lessThan(1);
    });
  });

  describe('Phase 2: Normalized Exact Match Performance', () => {
    it('should handle whitespace variations (147 chars) in <5ms', () => {
      const search = 'function renderStateItem(container, key, value, depth) { const item = document.createElement("div");';
      const content = 'function   renderStateItem(container,   key,   value,   depth)   {   const   item   =   document.createElement("div");';

      const avgTime = benchmark(() => {
        matcher.findFuzzyMatch(content, search, 0.8);
      });

      expect(avgTime).to.be.lessThan(5);
    });

    it('should handle CRLF variations in <5ms', () => {
      const search = 'line1\nline2\nline3';
      const content = 'prefix\r\n\r\nline1\r\nline2\r\nline3\r\n\r\nsuffix';

      const avgTime = benchmark(() => {
        matcher.findFuzzyMatch(content, search, 0.8);
      });

      expect(avgTime).to.be.lessThan(5);
    });

    it('should handle tab/space variations in <5ms', () => {
      const search = 'function test() {  return 42; }';
      const content = 'prefix\t\tfunction\ttest()\t{\t\treturn\t42;\t}\t\tsuffix';

      const avgTime = benchmark(() => {
        matcher.findFuzzyMatch(content, search, 0.8);
      });

      expect(avgTime).to.be.lessThan(5);
    });
  });

  describe('Phase 3 & 4: Filter Performance (Quick Rejection)', () => {
    it('should reject with length filter in <500ms', () => {
      const search = 'a'.repeat(100);
      const content = 'x'.repeat(5000) + 'b'.repeat(50) + 'y'.repeat(5000);

      const avgTime = benchmark(() => {
        matcher.findFuzzyMatch(content, search, 0.8);
      });

      expect(avgTime).to.be.lessThan(500);
    });

    it('should reject with character-set filter in <500ms', () => {
      const search = 'xyz123abc';
      const content = 'a'.repeat(10000) + 'def456ghi' + 'b'.repeat(10000);

      const avgTime = benchmark(() => {
        matcher.findFuzzyMatch(content, search, 0.8);
      });

      expect(avgTime).to.be.lessThan(500);
    });

    it('should handle combined filters on large file in <500ms', () => {
      const search = 'specific function name';
      const content = 'x'.repeat(25000) + 'completely different text' + 'y'.repeat(25000);

      const avgTime = benchmark(() => {
        matcher.findFuzzyMatch(content, search, 0.8);
      });

      expect(avgTime).to.be.lessThan(500);
    });
  });

  describe('Phase 5: Full Fuzzy Matching Performance', () => {
    it('should find fuzzy match with minor differences in <500ms', () => {
      const search = 'hello world test';
      const content = 'x'.repeat(1000) + 'helo wrld tst' + 'y'.repeat(1000);

      const avgTime = benchmark(() => {
        matcher.findFuzzyMatch(content, search, 0.7);
      });

      expect(avgTime).to.be.lessThan(500);
    });

    it('should find best match among multiple candidates in <500ms', () => {
      const search = 'test';
      const content = 'tast tost test tezt';

      const avgTime = benchmark(() => {
        matcher.findFuzzyMatch(content, search, 0.7);
      });

      expect(avgTime).to.be.lessThan(500);
    });
  });

  describe('Regression Prevention: User Reported Case', () => {
    it('should handle 147-char string with whitespace variations in <100ms (was 30s)', () => {
      const search = '    function renderStateItem(container, key, value, depth) {\n      const item = document.createElement(\'div\');\n      item.className = \'state-item\';';
      const content = 'x'.repeat(2000) + '    function   renderStateItem(container,   key,   value,   depth)   {\n      const   item   =   document.createElement(\'div\');\n      item.className   =   \'state-item\';' + 'y'.repeat(2000);

      const avgTime = benchmark(() => {
        const match = matcher.findFuzzyMatch(content, search, 0.8);
        expect(match).to.not.be.null;
      });

      // This was 30,000ms before the fix, should now be <100ms
      expect(avgTime).to.be.lessThan(100);
    });

    it('should not hang on large files', () => {
      const search = 'function test() { return 42; }';
      const largeContent = 'x'.repeat(50000);

      const avgTime = benchmark(() => {
        matcher.findFuzzyMatch(largeContent, search, 0.8);
      }, 3); // Fewer iterations for large content

      expect(avgTime).to.be.lessThan(5000);
    });
  });

  describe('Documentation Claims Verification', () => {
    it('should meet all documented performance targets', () => {
      // Run all test categories and collect averages
      const results = {
        phase1: [] as number[],
        phase2: [] as number[],
        filters: [] as number[],
        fuzzy: [] as number[],
        userCase: 0
      };

      // Phase 1 tests
      results.phase1.push(benchmark(() => {
        const search = 'function test() { return 1; }';
        const content = 'prefix ' + search + ' suffix';
        matcher.findFuzzyMatch(content, search, 0.8);
      }));

      // Phase 2 tests
      results.phase2.push(benchmark(() => {
        const search = 'function renderStateItem(container, key, value, depth) { const item = document.createElement("div");';
        const content = 'function   renderStateItem(container,   key,   value,   depth)   {   const   item   =   document.createElement("div");';
        matcher.findFuzzyMatch(content, search, 0.8);
      }));

      // Filter tests
      results.filters.push(benchmark(() => {
        const search = 'xyz123abc';
        const content = 'a'.repeat(10000) + 'def456ghi' + 'b'.repeat(10000);
        matcher.findFuzzyMatch(content, search, 0.8);
      }));

      // Fuzzy tests
      results.fuzzy.push(benchmark(() => {
        const search = 'hello world test';
        const content = 'x'.repeat(1000) + 'helo wrld tst' + 'y'.repeat(1000);
        matcher.findFuzzyMatch(content, search, 0.7);
      }));

      // User case
      results.userCase = benchmark(() => {
        const search = '    function renderStateItem(container, key, value, depth) {\n      const item = document.createElement(\'div\');\n      item.className = \'state-item\';';
        const content = 'x'.repeat(2000) + '    function   renderStateItem(container,   key,   value,   depth)   {\n      const   item   =   document.createElement(\'div\');\n      item.className   =   \'state-item\';' + 'y'.repeat(2000);
        matcher.findFuzzyMatch(content, search, 0.8);
      });

      // Calculate averages
      const phase1Avg = results.phase1.reduce((a, b) => a + b, 0) / results.phase1.length;
      const phase2Avg = results.phase2.reduce((a, b) => a + b, 0) / results.phase2.length;
      const filterAvg = results.filters.reduce((a, b) => a + b, 0) / results.filters.length;
      const fuzzyAvg = results.fuzzy.reduce((a, b) => a + b, 0) / results.fuzzy.length;

      // Verify all claims
      expect(phase1Avg, 'Phase 1 (Exact) should be <1ms').to.be.lessThan(1);
      expect(phase2Avg, 'Phase 2 (Normalized) should be <5ms').to.be.lessThan(5);
      expect(filterAvg, 'Phase 3+4 (Filters) should be <500ms').to.be.lessThan(500);
      expect(fuzzyAvg, 'Phase 5 (Fuzzy) should be <500ms').to.be.lessThan(500);
      expect(results.userCase, 'User case should be <100ms').to.be.lessThan(100);

      // Log summary (useful for manual review)
      console.log('\n  Performance Summary:');
      console.log(`    Phase 1 avg: ${phase1Avg.toFixed(2)}ms (budget: 1ms)`);
      console.log(`    Phase 2 avg: ${phase2Avg.toFixed(2)}ms (budget: 5ms)`);
      console.log(`    Filters avg: ${filterAvg.toFixed(2)}ms (budget: 500ms)`);
      console.log(`    Fuzzy avg: ${fuzzyAvg.toFixed(2)}ms (budget: 500ms)`);
      console.log(`    User case: ${results.userCase.toFixed(2)}ms (was 30,000ms)`);
      if (results.userCase > 0) {
        console.log(`    Speedup: ${(30000 / results.userCase).toFixed(0)}x improvement\n`);
      }
    });
  });
});
