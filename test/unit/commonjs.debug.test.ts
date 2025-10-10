/**
 * Unit tests for CommonJS debug flag implementation
 *
 * Verifies that the CommonJS.js module system has proper debug flag control:
 * - Global DEBUG_COMMONJS flag exists and defaults to false
 * - debugLog() function correctly wraps Logger.log
 * - All Logger.log calls have been replaced with debugLog
 * - Documentation explains the debug flag usage
 */

import { expect } from 'chai';
import { promises as fs } from 'fs';

describe('CommonJS Debug Flag', () => {
  let commonJsContent: string;

  before(async () => {
    commonJsContent = await fs.readFile('./dist/src/CommonJS.js', 'utf-8');
  });

  describe('Global Flag Implementation', () => {
    it('should have globalThis.DEBUG_COMMONJS flag defined', () => {
      expect(commonJsContent).to.include('globalThis.DEBUG_COMMONJS');
    });

    it('should default DEBUG_COMMONJS to false', () => {
      // Check for default false assignment (could be various formats)
      const hasDefault =
        commonJsContent.includes('DEBUG_COMMONJS = false') ||
        commonJsContent.includes('DEBUG_COMMONJS ?? false') ||
        commonJsContent.match(/DEBUG_COMMONJS\s*=\s*globalThis\.DEBUG_COMMONJS\s*\?\?\s*false/);

      expect(hasDefault).to.be.true;
    });
  });

  describe('debugLog Function', () => {
    it('should have debugLog function defined', () => {
      expect(commonJsContent).to.include('function debugLog');
    });

    it('should check DEBUG_COMMONJS flag before logging', () => {
      const debugLogMatch = commonJsContent.match(/function debugLog\([^)]*\)\s*\{[^}]+\}/);
      expect(debugLogMatch).to.not.be.null;

      const impl = debugLogMatch![0];
      expect(impl).to.include('if (globalThis.DEBUG_COMMONJS)');
    });

    it('should call Logger.log (not be recursive)', () => {
      const debugLogMatch = commonJsContent.match(/function debugLog\([^)]*\)\s*\{[^}]+\}/);
      expect(debugLogMatch).to.not.be.null;

      const impl = debugLogMatch![0];
      expect(impl).to.include('Logger.log');

      // Should not call debugLog recursively
      const bodyAfterIfStatement = impl.split('if (globalThis.DEBUG_COMMONJS)')[1];
      expect(bodyAfterIfStatement).to.not.include('debugLog(');
    });
  });

  describe('Logger.log Replacement', () => {
    it('should have replaced Logger.log calls with debugLog', () => {
      const loggerLogMatches = commonJsContent.match(/Logger\.log\([^)]*\)/g) || [];
      const debugLogDefMatch = commonJsContent.match(/function debugLog[\s\S]*?^}/m);

      let directLoggerCalls = 0;
      for (const match of loggerLogMatches) {
        // Check if this is inside the debugLog function (which is expected)
        if (debugLogDefMatch && debugLogDefMatch[0].includes(match)) {
          continue; // This is the Logger.log inside debugLog - expected
        }
        directLoggerCalls++;
      }

      expect(directLoggerCalls).to.equal(0, 'Should have no direct Logger.log calls outside debugLog function');
    });

    it('should have significant debugLog usage', () => {
      const debugLogUsages = (commonJsContent.match(/debugLog\(/g) || []).length;

      // Should have replaced many Logger.log calls (expect 30+ based on implementation)
      expect(debugLogUsages).to.be.greaterThan(30);
    });

    it('should have more debugLog calls than Logger.log calls', () => {
      const debugLogUsages = (commonJsContent.match(/debugLog\(/g) || []).length;
      const loggerLogUsages = (commonJsContent.match(/Logger\.log\(/g) || []).length;

      // debugLog should be called many times, Logger.log only once (inside debugLog)
      expect(debugLogUsages).to.be.greaterThan(loggerLogUsages);
    });
  });

  describe('Documentation', () => {
    it('should mention DEBUG_COMMONJS in comments', () => {
      expect(commonJsContent).to.include('DEBUG_COMMONJS');
    });

    it('should document debug logging feature', () => {
      const hasDebugDoc =
        commonJsContent.includes('debug logging') ||
        commonJsContent.includes('Debug Mode') ||
        commonJsContent.includes('debugging');

      expect(hasDebugDoc).to.be.true;
    });

    it('should explain how to enable debug mode', () => {
      // Should explain setting the flag to true
      const hasEnableInstruction =
        commonJsContent.match(/DEBUG_COMMONJS\s*=\s*true/) ||
        commonJsContent.includes('set:') ||
        commonJsContent.includes('enable');

      expect(hasEnableInstruction).to.be.true;
    });
  });

  describe('Integration Verification', () => {
    it('should have complete debug flag implementation', () => {
      // Summary test: all key components present
      const hasFlag = commonJsContent.includes('globalThis.DEBUG_COMMONJS');
      const hasDebugLog = commonJsContent.includes('function debugLog');
      const hasUsages = (commonJsContent.match(/debugLog\(/g) || []).length > 30;

      expect(hasFlag, 'Missing DEBUG_COMMONJS flag').to.be.true;
      expect(hasDebugLog, 'Missing debugLog function').to.be.true;
      expect(hasUsages, 'Insufficient debugLog usage').to.be.true;
    });

    it('should eliminate production logging noise by default', () => {
      // Verify that default is false (no logging in production)
      const defaultIsFalse =
        commonJsContent.includes('DEBUG_COMMONJS = false') ||
        commonJsContent.includes('DEBUG_COMMONJS ?? false');

      expect(defaultIsFalse, 'Debug flag should default to false for production').to.be.true;
    });
  });
});
