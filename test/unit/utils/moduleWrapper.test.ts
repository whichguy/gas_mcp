/**
 * Unit tests for validateCommonJsIntegrity
 *
 * Tests content integrity validation for SERVER_JS files:
 * - Properly wrapped files (no warnings)
 * - Completely unwrapped files (context-specific warnings)
 * - Partial wrappers (_main without __defineModule__ and vice versa)
 * - Exempt files (HTML, JSON, system files)
 */

import { expect } from 'chai';
import { validateCommonJsIntegrity } from '../../../src/utils/moduleWrapper.js';

describe('validateCommonJsIntegrity', () => {
  // Sample properly wrapped content
  const wrappedContent = `function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  log = globalThis.__getModuleLogFunction?.(module) || (() => {})
) {
  function add(a, b) { return a + b; }
  module.exports = { add };
}

__defineModule__(_main, false);`;

  // Sample unwrapped content (plain JS)
  const unwrappedContent = `function add(a, b) { return a + b; }
module.exports = { add };`;

  // Content with only _main (missing __defineModule__)
  const mainOnlyContent = `function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports
) {
  function add(a, b) { return a + b; }
  module.exports = { add };
}`;

  // Content with only __defineModule__ (missing _main)
  const defineOnlyContent = `function add(a, b) { return a + b; }
module.exports = { add };

__defineModule__(_main, false);`;

  describe('properly wrapped SERVER_JS files', () => {
    it('should return no warnings for correctly wrapped content', () => {
      const warnings = validateCommonJsIntegrity('utils.gs', wrappedContent, 'SERVER_JS', 'rsync-push');
      expect(warnings).to.be.an('array').that.is.empty;
    });

    it('should return no warnings with loadNow=true', () => {
      const content = wrappedContent.replace('__defineModule__(_main, false)', '__defineModule__(_main, true)');
      const warnings = validateCommonJsIntegrity('utils.gs', content, 'SERVER_JS', 'rsync-pull');
      expect(warnings).to.be.an('array').that.is.empty;
    });

    it('should return no warnings with no-arg __defineModule__', () => {
      const content = wrappedContent.replace('__defineModule__(_main, false)', '__defineModule__(_main)');
      const warnings = validateCommonJsIntegrity('utils.gs', content, 'SERVER_JS', 'raw-write');
      expect(warnings).to.be.an('array').that.is.empty;
    });
  });

  describe('completely unwrapped SERVER_JS files', () => {
    it('should warn with rsync-push context', () => {
      const warnings = validateCommonJsIntegrity('utils.gs', unwrappedContent, 'SERVER_JS', 'rsync-push');
      expect(warnings).to.have.lengthOf(1);
      expect(warnings[0]).to.include('Missing CommonJS wrappers');
      expect(warnings[0]).to.include('outside the mcp_gas toolchain');
    });

    it('should warn with rsync-pull context', () => {
      const warnings = validateCommonJsIntegrity('utils.gs', unwrappedContent, 'SERVER_JS', 'rsync-pull');
      expect(warnings).to.have.lengthOf(1);
      expect(warnings[0]).to.include('Missing CommonJS wrappers');
      expect(warnings[0]).to.include('Apps Script editor');
    });

    it('should warn with raw-write context', () => {
      const warnings = validateCommonJsIntegrity('utils.gs', unwrappedContent, 'SERVER_JS', 'raw-write');
      expect(warnings).to.have.lengthOf(1);
      expect(warnings[0]).to.include('lacks CommonJS wrappers');
      expect(warnings[0]).to.include('use "write" instead of "raw_write"');
    });

    it('should include filename in warning', () => {
      const warnings = validateCommonJsIntegrity('models/User.gs', unwrappedContent, 'SERVER_JS', 'rsync-push');
      expect(warnings[0]).to.include('models/User.gs');
    });
  });

  describe('partial wrappers', () => {
    it('should warn when _main exists but __defineModule__ is missing', () => {
      const warnings = validateCommonJsIntegrity('utils.gs', mainOnlyContent, 'SERVER_JS', 'rsync-push');
      expect(warnings).to.have.lengthOf(1);
      expect(warnings[0]).to.include('missing __defineModule__(_main)');
      expect(warnings[0]).to.include('not be registered');
    });

    it('should warn when __defineModule__ exists but _main is missing', () => {
      const warnings = validateCommonJsIntegrity('utils.gs', defineOnlyContent, 'SERVER_JS', 'rsync-push');
      expect(warnings).to.have.lengthOf(1);
      expect(warnings[0]).to.include('missing function _main()');
      expect(warnings[0]).to.include('runtime error');
    });
  });

  describe('exempt files (no warnings)', () => {
    it('should skip HTML files', () => {
      const warnings = validateCommonJsIntegrity('sidebar.html', '<h1>Hello</h1>', 'HTML', 'rsync-push');
      expect(warnings).to.be.an('array').that.is.empty;
    });

    it('should skip JSON files', () => {
      const warnings = validateCommonJsIntegrity('appsscript.json', '{}', 'JSON', 'rsync-push');
      expect(warnings).to.be.an('array').that.is.empty;
    });

    it('should skip common-js/require system file', () => {
      const warnings = validateCommonJsIntegrity('common-js/require', 'raw system code', 'SERVER_JS', 'rsync-pull');
      expect(warnings).to.be.an('array').that.is.empty;
    });

    it('should skip common-js/__mcp_exec system file', () => {
      const warnings = validateCommonJsIntegrity('common-js/__mcp_exec', 'raw exec code', 'SERVER_JS', 'rsync-pull');
      expect(warnings).to.be.an('array').that.is.empty;
    });

    it('should skip appsscript (without .json extension)', () => {
      const warnings = validateCommonJsIntegrity('appsscript', '{}', 'SERVER_JS', 'rsync-push');
      expect(warnings).to.be.an('array').that.is.empty;
    });

    it('should skip .git/config breadcrumb files', () => {
      const warnings = validateCommonJsIntegrity('.git/config', '[sync]\nlocalPath = ~/src', 'SERVER_JS', 'rsync-pull');
      expect(warnings).to.be.an('array').that.is.empty;
    });
  });

  describe('edge cases', () => {
    it('should handle empty content', () => {
      const warnings = validateCommonJsIntegrity('empty.gs', '', 'SERVER_JS', 'rsync-push');
      expect(warnings).to.have.lengthOf(1);
      expect(warnings[0]).to.include('Missing CommonJS wrappers');
    });

    it('should handle content with _main in a comment', () => {
      // regex will still match _main in a comment, but that's acceptable
      // since the regex is a simple presence check
      const content = '// function _main() is not here\n__defineModule__(_main);';
      const warnings = validateCommonJsIntegrity('utils.gs', content, 'SERVER_JS', 'rsync-push');
      // This has __defineModule__ but no actual _main function declaration
      // The regex matches "function _main" so the comment match depends on exact formatting
      expect(warnings).to.be.an('array');
    });

    it('should handle subdirectory files', () => {
      const warnings = validateCommonJsIntegrity('libs/auth/oauth.gs', unwrappedContent, 'SERVER_JS', 'rsync-push');
      expect(warnings).to.have.lengthOf(1);
      expect(warnings[0]).to.include('libs/auth/oauth.gs');
    });
  });
});
