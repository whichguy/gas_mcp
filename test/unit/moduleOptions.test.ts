import { expect } from 'chai';
import {
  wrapModuleContent,
  unwrapModuleContent
} from '../../src/utils/moduleWrapper.js';

describe('ModuleOptions Feature', () => {
  describe('wrapModuleContent with moduleOptions', () => {
    it('should generate __defineModule__(_main) when options is null', () => {
      const content = 'function helper() { return 42; }';
      const moduleName = 'test/Helper';

      const wrapped = wrapModuleContent(content, moduleName, null);

      expect(wrapped).to.include('__defineModule__(_main);');
      expect(wrapped).to.not.include('loadNow');
    });

    it('should generate __defineModule__(_main) when options is empty object', () => {
      const content = 'function helper() { return 42; }';
      const moduleName = 'test/Helper';

      const wrapped = wrapModuleContent(content, moduleName, {});

      expect(wrapped).to.include('__defineModule__(_main);');
      expect(wrapped).to.not.include('loadNow');
    });

    it('should generate __defineModule__ with loadNow=true when specified', () => {
      const content = 'function doGet() {}';
      const moduleName = 'WebApp';

      const wrapped = wrapModuleContent(content, moduleName, { loadNow: true });

      expect(wrapped).to.include('__defineModule__(_main, null, { loadNow: true });');
    });

    it('should generate __defineModule__ with loadNow=false when specified', () => {
      const content = 'function helper() {}';
      const moduleName = 'Helper';

      const wrapped = wrapModuleContent(content, moduleName, { loadNow: false });

      expect(wrapped).to.include('__defineModule__(_main, null, { loadNow: false });');
    });

    it('should generate __defineModule__(_main) when options is undefined', () => {
      const content = 'function helper() { return 42; }';
      const moduleName = 'test/Helper';

      const wrapped = wrapModuleContent(content, moduleName);

      expect(wrapped).to.include('__defineModule__(_main);');
      expect(wrapped).to.not.include('loadNow');
    });

    it('should properly indent user code', () => {
      const content = 'function helper() {\n  return 42;\n}';
      const moduleName = 'Helper';

      const wrapped = wrapModuleContent(content, moduleName);

      expect(wrapped).to.include('  function helper() {');
      expect(wrapped).to.include('    return 42;');
    });
  });

  describe('unwrapModuleContent', () => {
    it('should unwrap content without options', () => {
      const wrappedContent = `function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  function helper() {}
}

__defineModule__(_main);`;

      const { unwrappedContent, existingOptions } = unwrapModuleContent(wrappedContent);

      expect(unwrappedContent.trim()).to.equal('function helper() {}');
      expect(existingOptions).to.be.null;
    });

    it('should unwrap content with loadNow=true options', () => {
      const wrappedContent = `function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  function doGet() {}
}

__defineModule__(_main, null, { loadNow: true });`;

      const { unwrappedContent, existingOptions } = unwrapModuleContent(wrappedContent);

      expect(unwrappedContent.trim()).to.equal('function doGet() {}');
      expect(existingOptions).to.not.be.null;
      expect(existingOptions?.loadNow).to.be.true;
    });

    it('should unwrap content with loadNow=false options', () => {
      const wrappedContent = `function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  function helper() {}
}

__defineModule__(_main, null, { loadNow: false });`;

      const { unwrappedContent, existingOptions } = unwrapModuleContent(wrappedContent);

      expect(unwrappedContent.trim()).to.equal('function helper() {}');
      expect(existingOptions).to.not.be.null;
      expect(existingOptions?.loadNow).to.be.false;
    });

    it('should handle content without wrapper', () => {
      const content = 'function helper() { return 42; }';

      const { unwrappedContent, existingOptions } = unwrapModuleContent(content);

      expect(unwrappedContent).to.equal(content);
      expect(existingOptions).to.be.null;
    });
  });

  describe('Integration: Round-trip wrap/unwrap with options', () => {
    it('should preserve content through wrap/unwrap cycle with loadNow=true', () => {
      const originalContent = 'function doGet() {}';
      const moduleName = 'WebApp';

      // Wrap with loadNow=true
      const wrapped = wrapModuleContent(originalContent, moduleName, { loadNow: true });

      // Verify it includes the options in __defineModule__
      expect(wrapped).to.include('__defineModule__(_main, null, { loadNow: true });');

      // Unwrap
      const { unwrappedContent } = unwrapModuleContent(wrapped);

      expect(unwrappedContent.trim()).to.equal(originalContent);
    });

    it('should preserve content through wrap/unwrap cycle with loadNow=false', () => {
      const originalContent = 'function helper() { return 42; }';
      const moduleName = 'Helper';

      // Wrap with loadNow=false
      const wrapped = wrapModuleContent(originalContent, moduleName, { loadNow: false });

      // Verify it includes the options in __defineModule__
      expect(wrapped).to.include('__defineModule__(_main, null, { loadNow: false });');

      // Unwrap
      const { unwrappedContent } = unwrapModuleContent(wrapped);

      expect(unwrappedContent.trim()).to.equal(originalContent);
    });

    it('should preserve content through wrap/unwrap cycle with no options', () => {
      const originalContent = 'function helper() { return 42; }';
      const moduleName = 'Helper';

      // Wrap with null options
      const wrapped = wrapModuleContent(originalContent, moduleName, null);

      // Verify it does NOT include options in __defineModule__
      expect(wrapped).to.include('__defineModule__(_main);');
      expect(wrapped).to.not.include('loadNow');

      // Unwrap
      const { unwrappedContent } = unwrapModuleContent(wrapped);

      expect(unwrappedContent.trim()).to.equal(originalContent);
    });
  });

  describe('Edge Cases', () => {
    it('should handle options object without loadNow property', () => {
      const content = 'function helper() { return 42; }';
      const moduleName = 'Helper';

      // Pass empty options object (no loadNow specified)
      const wrapped = wrapModuleContent(content, moduleName, {});

      // Should generate default __defineModule__(_main)
      expect(wrapped).to.include('__defineModule__(_main);');
      expect(wrapped).to.not.include('loadNow');
    });

    it('should handle undefined options parameter', () => {
      const content = 'function helper() { return 42; }';
      const moduleName = 'Helper';

      // Pass undefined (omit parameter)
      const wrapped = wrapModuleContent(content, moduleName, undefined);

      // Should generate default __defineModule__(_main)
      expect(wrapped).to.include('__defineModule__(_main);');
      expect(wrapped).to.not.include('loadNow');
    });
  });

  describe('Pass-through Behavior', () => {
    it('should pass explicit null directly (use default)', () => {
      const content = 'function doGet() {}';
      const moduleName = 'WebApp';

      const wrapped = wrapModuleContent(content, moduleName, null);

      // Explicit null → use default
      expect(wrapped).to.include('__defineModule__(_main);');
      expect(wrapped).to.not.include('loadNow');
    });

    it('should pass explicit { loadNow: true } directly', () => {
      const content = 'function helper() {}'; // No special handlers, but user wants loadNow=true
      const moduleName = 'Helper';

      const wrapped = wrapModuleContent(content, moduleName, { loadNow: true });

      // Should pass through user's explicit choice
      expect(wrapped).to.include('__defineModule__(_main, null, { loadNow: true });');
    });

    it('should pass explicit { loadNow: false } directly', () => {
      const content = 'function doGet() {}'; // Has doGet, but user wants loadNow=false
      const moduleName = 'WebApp';

      const wrapped = wrapModuleContent(content, moduleName, { loadNow: false });

      // Should pass through user's explicit choice
      expect(wrapped).to.include('__defineModule__(_main, null, { loadNow: false });');
    });
  });
});
