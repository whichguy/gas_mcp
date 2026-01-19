/**
 * Unit tests for CommonJS ordering validation
 */
import { expect } from 'chai';
import {
  validateCommonJSOrdering,
  formatCommonJSOrderingIssues
} from '../../../src/utils/validation.js';

describe('validateCommonJSOrdering', () => {
  describe('correct ordering', () => {
    it('should return valid for correctly ordered files', () => {
      const files = [
        { name: 'common-js/require.gs' },
        { name: 'common-js/ConfigManager.gs' },
        { name: 'common-js/__mcp_exec.gs' },
        { name: 'Code.gs' },
        { name: 'Utils.gs' }
      ];

      const result = validateCommonJSOrdering(files);

      expect(result.valid).to.be.true;
      expect(result.issues).to.have.length(0);
      expect(result.positions.require).to.equal(0);
      expect(result.positions.configManager).to.equal(1);
      expect(result.positions.mcpExec).to.equal(2);
    });

    it('should handle files without extensions', () => {
      const files = [
        { name: 'common-js/require' },
        { name: 'common-js/ConfigManager' },
        { name: 'common-js/__mcp_exec' },
        { name: 'Code' }
      ];

      const result = validateCommonJSOrdering(files);

      expect(result.valid).to.be.true;
      expect(result.issues).to.have.length(0);
    });
  });

  describe('incorrect ordering', () => {
    it('should detect require.gs not at position 0', () => {
      const files = [
        { name: 'Code.gs' },
        { name: 'common-js/require.gs' },
        { name: 'common-js/ConfigManager.gs' }
      ];

      const result = validateCommonJSOrdering(files);

      expect(result.valid).to.be.false;
      expect(result.issues).to.have.length.greaterThan(0);

      const requireIssue = result.issues.find(i => i.file === 'common-js/require');
      expect(requireIssue).to.exist;
      expect(requireIssue!.expected).to.equal(0);
      expect(requireIssue!.actual).to.equal(1);
      expect(requireIssue!.severity).to.equal('error');
    });

    it('should detect ConfigManager not at position 1', () => {
      const files = [
        { name: 'common-js/require.gs' },
        { name: 'Code.gs' },
        { name: 'common-js/ConfigManager.gs' }
      ];

      const result = validateCommonJSOrdering(files);

      // ConfigManager out of order is a warning, not error
      const configIssue = result.issues.find(i => i.file === 'common-js/ConfigManager');
      expect(configIssue).to.exist;
      expect(configIssue!.expected).to.equal(1);
      expect(configIssue!.actual).to.equal(2);
      expect(configIssue!.severity).to.equal('warning');
    });

    it('should detect __mcp_exec not at position 2', () => {
      const files = [
        { name: 'common-js/require.gs' },
        { name: 'common-js/ConfigManager.gs' },
        { name: 'Code.gs' },
        { name: 'common-js/__mcp_exec.gs' }
      ];

      const result = validateCommonJSOrdering(files);

      const execIssue = result.issues.find(i => i.file === 'common-js/__mcp_exec');
      expect(execIssue).to.exist;
      expect(execIssue!.expected).to.equal(2);
      expect(execIssue!.actual).to.equal(3);
    });
  });

  describe('missing files', () => {
    it('should warn when require.gs is missing', () => {
      const files = [
        { name: 'common-js/ConfigManager.gs' },
        { name: 'Code.gs' }
      ];

      const result = validateCommonJSOrdering(files);

      const requireIssue = result.issues.find(i => i.file === 'common-js/require');
      expect(requireIssue).to.exist;
      expect(requireIssue!.severity).to.equal('warning');
      expect(requireIssue!.actual).to.equal(-1);
    });

    it('should not warn when optional files are missing', () => {
      const files = [
        { name: 'common-js/require.gs' },
        { name: 'Code.gs' }
      ];

      const result = validateCommonJSOrdering(files);

      // ConfigManager and __mcp_exec are optional, no warning if missing
      expect(result.issues.filter(i => i.file === 'common-js/ConfigManager')).to.have.length(0);
      expect(result.issues.filter(i => i.file === 'common-js/__mcp_exec')).to.have.length(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty file list', () => {
      const result = validateCommonJSOrdering([]);

      // Only require.gs missing is a warning
      expect(result.issues).to.have.length(1);
      expect(result.positions.require).to.be.null;
    });

    it('should handle projects without CommonJS', () => {
      const files = [
        { name: 'Code.gs' },
        { name: 'Utils.gs' }
      ];

      const result = validateCommonJSOrdering(files);

      // Only require.gs missing is warned
      expect(result.issues).to.have.length(1);
      expect(result.issues[0].file).to.equal('common-js/require');
    });
  });
});

describe('formatCommonJSOrderingIssues', () => {
  it('should format valid result', () => {
    const result = validateCommonJSOrdering([
      { name: 'common-js/require.gs' },
      { name: 'common-js/ConfigManager.gs' },
      { name: 'common-js/__mcp_exec.gs' }
    ]);

    const formatted = formatCommonJSOrderingIssues(result);
    expect(formatted).to.include('✓');
  });

  it('should format issues with icons', () => {
    const result = validateCommonJSOrdering([
      { name: 'Code.gs' },
      { name: 'common-js/require.gs' }
    ]);

    const formatted = formatCommonJSOrderingIssues(result);
    expect(formatted).to.include('⚠️');
    expect(formatted).to.include('position');
  });

  it('should include fix suggestion', () => {
    const result = validateCommonJSOrdering([
      { name: 'Code.gs' },
      { name: 'common-js/require.gs' }
    ]);

    const formatted = formatCommonJSOrderingIssues(result);
    expect(formatted).to.include('project_init');
  });
});
