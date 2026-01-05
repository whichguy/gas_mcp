/**
 * Unit tests for WriteTool CommonJS analysis
 *
 * Verifies that CommonJS/SERVER_JS files are analyzed for common issues:
 * - Event handlers without loadNow: true (silently fail to register)
 * - Missing __events__ registration for handler functions
 * - Duplicate _main() functions (nested wrappers)
 * - __defineModule__ inside _main() (wrong placement)
 * - Direct globalThis assignment instead of __global__ pattern
 * - console.log() usage (silently discarded in GAS)
 * - Hardcoded API keys (security risk)
 * - JSON.parse without try-catch
 * - ConfigManager sensitive keys in script-wide scope
 * - Direct PropertiesService usage (suggest ConfigManager)
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { analyzeCommonJsContent, determineFileType } from '../../../src/utils/contentAnalyzer.js';

describe('WriteTool - CommonJS Analysis', () => {
  // Use the shared utility directly
  const getAnalyzeCommonJsContent = () => {
    return analyzeCommonJsContent;
  };

  describe('Missing loadNow for Event Handlers', () => {
    it('should warn about doGet without loadNow: true', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function doGet(e) {
          return HtmlService.createHtmlOutput('Hello');
        }
        module.exports.__events__ = { doGet: 'doGet' };
      `;
      const analysis = analyze(content, undefined);

      expect(analysis.warnings).to.have.length.at.least(1);
      expect(analysis.warnings[0]).to.include('CRITICAL');
      expect(analysis.warnings[0]).to.include('loadNow');
    });

    it('should warn about onOpen without loadNow: true', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function onOpen(e) {
          SpreadsheetApp.getUi().createMenu('Test').addToUi();
        }
        module.exports.__events__ = { onOpen: 'onOpen' };
      `;
      const analysis = analyze(content, undefined);

      expect(analysis.warnings).to.have.length.at.least(1);
      expect(analysis.warnings[0]).to.include('loadNow');
    });

    it('should warn about __events__ export without loadNow: true', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        module.exports.__events__ = { onEdit: 'handleEdit' };
      `;
      const analysis = analyze(content, undefined);

      expect(analysis.warnings).to.have.length.at.least(1);
      expect(analysis.warnings[0]).to.include('__events__');
    });

    it('should NOT warn when loadNow: true is set', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function doGet(e) {
          return HtmlService.createHtmlOutput('Hello');
        }
        module.exports.__events__ = { doGet: 'doGet' };
      `;
      const analysis = analyze(content, { loadNow: true });

      // Should not have the loadNow warning
      const loadNowWarnings = analysis.warnings.filter((w: string) => w.includes('loadNow'));
      expect(loadNowWarnings).to.have.length(0);
    });

    it('should detect const-style event handlers', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        const doPost = (e) => {
          return ContentService.createTextOutput('OK');
        };
      `;
      const analysis = analyze(content, undefined);

      expect(analysis.warnings).to.have.length.at.least(1);
      expect(analysis.warnings.some((w: string) => w.includes('doPost'))).to.be.true;
    });
  });

  describe('Missing __events__ Registration', () => {
    it('should warn about doGet without __events__ registration', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function doGet(e) {
          return HtmlService.createHtmlOutput('Hello');
        }
        module.exports = { doGet };
      `;
      const analysis = analyze(content, { loadNow: true });

      expect(analysis.warnings).to.have.length.at.least(1);
      expect(analysis.warnings.some((w: string) =>
        w.includes('not registered') && w.includes('__events__')
      )).to.be.true;
    });

    it('should warn about multiple handlers without registration', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function doGet(e) { return null; }
        function onOpen(e) { }
        function onEdit(e) { }
      `;
      const analysis = analyze(content, { loadNow: true });

      const registrationWarning = analysis.warnings.find((w: string) =>
        w.includes('not registered')
      );
      expect(registrationWarning).to.exist;
      expect(registrationWarning).to.include('doGet');
      expect(registrationWarning).to.include('onOpen');
      expect(registrationWarning).to.include('onEdit');
    });

    it('should NOT warn when __events__ is properly registered', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function doGet(e) {
          return HtmlService.createHtmlOutput('Hello');
        }
        module.exports.__events__ = { doGet: 'doGet' };
      `;
      const analysis = analyze(content, { loadNow: true });

      const registrationWarnings = analysis.warnings.filter((w: string) =>
        w.includes('not registered')
      );
      expect(registrationWarnings).to.have.length(0);
    });

    it('should detect __events__ in object literal style', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function doGet(e) { return null; }
        module.exports = {
          doGet,
          __events__: { doGet: 'doGet' }
        };
      `;
      const analysis = analyze(content, { loadNow: true });

      const registrationWarnings = analysis.warnings.filter((w: string) =>
        w.includes('not registered')
      );
      expect(registrationWarnings).to.have.length(0);
    });
  });

  describe('Duplicate _main() Functions', () => {
    it('should warn about duplicate _main() functions', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function _main(module, exports, log) {
          function _main(module, exports, log) {
            // Inner code - never runs!
          }
        }
      `;
      const analysis = analyze(content, undefined);

      expect(analysis.warnings).to.have.length.at.least(1);
      expect(analysis.warnings.some((w: string) =>
        w.includes('Multiple _main()') || w.includes('double-wrapped')
      )).to.be.true;
    });

    it('should report the count of _main() occurrences', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function _main(m, e, l) {
          function _main(m, e, l) {
            function _main(m, e, l) {
            }
          }
        }
      `;
      const analysis = analyze(content, undefined);

      const mainWarning = analysis.warnings.find((w: string) =>
        w.includes('_main()')
      );
      expect(mainWarning).to.include('3');
    });

    it('should NOT warn about single _main() function', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function _main(module, exports, log) {
          function helper() {
            return 42;
          }
          module.exports = { helper };
        }
      `;
      const analysis = analyze(content, undefined);

      const mainWarnings = analysis.warnings.filter((w: string) =>
        w.includes('Multiple _main()')
      );
      expect(mainWarnings).to.have.length(0);
    });
  });

  describe('__defineModule__ Inside _main()', () => {
    it('should warn about __defineModule__ inside _main()', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
function _main(module, exports, log) {
  function helper() { return 42; }
  module.exports = { helper };
  __defineModule__('test', _main, module);
}
`;
      const analysis = analyze(content, undefined);

      expect(analysis.warnings).to.have.length.at.least(1);
      expect(analysis.warnings.some((w: string) =>
        w.includes('__defineModule__') && w.includes('inside _main()')
      )).to.be.true;
    });

    it('should NOT warn when __defineModule__ is at root level', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
function _main(module, exports, log) {
  function helper() { return 42; }
  module.exports = { helper };
}

__defineModule__('test', _main, module);
`;
      const analysis = analyze(content, undefined);

      const defineModuleWarnings = analysis.warnings.filter((w: string) =>
        w.includes('__defineModule__') && w.includes('inside _main()')
      );
      expect(defineModuleWarnings).to.have.length(0);
    });
  });

  describe('Direct globalThis Assignment', () => {
    it('should hint about direct globalThis assignment', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function _main(module, exports, log) {
          globalThis.myGlobalFunc = function() { return 42; };
        }
      `;
      const analysis = analyze(content, undefined);

      expect(analysis.hints).to.have.length.at.least(1);
      expect(analysis.hints.some((h: string) =>
        h.includes('globalThis') && h.includes('__global__')
      )).to.be.true;
    });

    it('should NOT hint when __global__ is already used', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function _main(module, exports, log) {
          function myFunc() { return 42; }
          module.exports.__global__ = { myFunc };
        }
      `;
      const analysis = analyze(content, undefined);

      const globalThisHints = analysis.hints.filter((h: string) =>
        h.includes('globalThis')
      );
      expect(globalThisHints).to.have.length(0);
    });

    it('should NOT hint for system files (common-js)', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        globalThis.__defineModule__ = function() { };
      `;
      // Now uses filename-based detection instead of content comment
      const analysis = analyze(content, undefined, 'common-js/require');

      const globalThisHints = analysis.hints.filter((h: string) =>
        h.includes('globalThis')
      );
      expect(globalThisHints).to.have.length(0);
    });
  });

  describe('Combined Scenarios', () => {
    it('should detect multiple issues in same file', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function doGet(e) {
          return HtmlService.createHtmlOutput('Hello');
        }
        // Missing __events__ registration
        // Missing loadNow: true
      `;
      const analysis = analyze(content, undefined);

      // Should have warning about loadNow AND missing __events__
      expect(analysis.warnings).to.have.length.at.least(2);
    });

    it('should handle empty content', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = '';
      const analysis = analyze(content, undefined);

      expect(analysis.warnings).to.have.length(0);
      expect(analysis.hints).to.have.length(0);
    });

    it('should handle utility module without event handlers', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function _main(module, exports, log) {
          function add(a, b) { return a + b; }
          function multiply(a, b) { return a * b; }
          module.exports = { add, multiply };
        }
      `;
      const analysis = analyze(content, undefined);

      // Utility modules should have no warnings
      expect(analysis.warnings).to.have.length(0);
    });

    it('should handle real-world event handler module', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
function _main(module, exports, log) {
  function doGet(e) {
    const template = HtmlService.createTemplateFromFile('Index');
    return template.evaluate()
      .setTitle('My App')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  function doPost(e) {
    const data = JSON.parse(e.postData.contents);
    return ContentService.createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  module.exports = {
    doGet,
    doPost,
    __events__: {
      doGet: 'doGet',
      doPost: 'doPost'
    }
  };
}
`;
      const analysis = analyze(content, { loadNow: true });

      // Should have no warnings when properly configured
      expect(analysis.warnings).to.have.length(0);
    });
  });

  describe('Improved Pattern Detection (Edge Cases)', () => {
    it('should detect arrow functions without space before =', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = 'const doGet=(e)=>{return null};';
      const analysis = analyze(content, undefined);

      expect(analysis.warnings).to.have.length.at.least(1);
      expect(analysis.warnings.some((w: string) => w.includes('doGet'))).to.be.true;
    });

    it('should detect let and var style event handlers', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        let doPost = (e) => { return null; };
        var onOpen = function(e) { };
      `;
      const analysis = analyze(content, undefined);

      expect(analysis.warnings).to.have.length.at.least(1);
      const handlerWarning = analysis.warnings.find((w: string) => w.includes('doPost'));
      expect(handlerWarning).to.exist;
    });

    it('should NOT detect handlers in comments (JSDoc examples)', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        /**
         * Example: function doGet(e) { return null; }
         * @example
         * const doPost = (e) => ContentService.createTextOutput('OK');
         */
        function myUtilityFunction() {
          return 42;
        }
        module.exports = { myUtilityFunction };
      `;
      const analysis = analyze(content, { loadNow: true });

      // Should NOT have warnings about doGet or doPost since they're in comments
      const handlerWarnings = analysis.warnings.filter((w: string) =>
        w.includes('doGet') || w.includes('doPost')
      );
      expect(handlerWarnings).to.have.length(0);
    });

    it('should NOT detect handlers in single-line comments', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        // TODO: Add function doGet(e) for web app
        // const doPost = (e) => response
        function helper() { return 42; }
      `;
      const analysis = analyze(content, { loadNow: true });

      const handlerWarnings = analysis.warnings.filter((w: string) =>
        w.includes('doGet') || w.includes('doPost')
      );
      expect(handlerWarnings).to.have.length(0);
    });

    it('should detect exports.__events__ variant', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function doGet(e) { return null; }
        exports.__events__ = { doGet: "doGet" };
      `;
      const analysis = analyze(content, undefined);

      // Should have loadNow warning but NOT missing __events__ warning
      const loadNowWarnings = analysis.warnings.filter((w: string) => w.includes('loadNow'));
      const registrationWarnings = analysis.warnings.filter((w: string) => w.includes('not registered'));
      expect(loadNowWarnings).to.have.length(1);
      expect(registrationWarnings).to.have.length(0);
    });

    it('should detect __defineModule__ inside _main with trailing code', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function _main(m, e, r) {
          function helper() { return 42; }
          __defineModule__('test', _main);
        }
        const other = 42;
      `;
      const analysis = analyze(content, undefined);

      expect(analysis.warnings.some((w: string) =>
        w.includes('__defineModule__') && w.includes('inside _main')
      )).to.be.true;
    });

    it('should NOT warn about globalThis in system files', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        globalThis.__defineModule__ = function() { };
        globalThis.__require__ = function() { };
      `;
      // Pass filename to identify as system file
      const analysis = analyze(content, undefined, 'common-js/require');

      const globalThisHints = analysis.hints.filter((h: string) => h.includes('globalThis'));
      expect(globalThisHints).to.have.length(0);
    });

    it('should NOT warn about globalThis in require.gs', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        globalThis.module = { exports: {} };
      `;
      const analysis = analyze(content, undefined, 'require.gs');

      const globalThisHints = analysis.hints.filter((h: string) => h.includes('globalThis'));
      expect(globalThisHints).to.have.length(0);
    });
  });

  describe('console.log() Detection', () => {
    it('should hint about console.log usage', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function myFunc() {
          console.log('debug message');
          return 42;
        }
      `;
      const analysis = analyze(content, undefined);

      const consoleHints = analysis.hints.filter((h: string) => h.includes('console'));
      expect(consoleHints).to.have.length(1);
      expect(consoleHints[0]).to.include('Logger.log()');
    });

    it('should hint about console.error and console.warn', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        console.error('Error occurred');
        console.warn('Warning');
      `;
      const analysis = analyze(content, undefined);

      expect(analysis.hints.some((h: string) => h.includes('console'))).to.be.true;
    });

    it('should NOT hint about console in comments', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        // console.log('this is commented out');
        /* console.error('also commented') */
        function myFunc() { return 42; }
      `;
      const analysis = analyze(content, undefined);

      const consoleHints = analysis.hints.filter((h: string) => h.includes('console'));
      expect(consoleHints).to.have.length(0);
    });
  });

  describe('Hardcoded API Key Detection', () => {
    it('should hint about Anthropic API key', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        const API_KEY = 'sk-ant-api03-2vE9O3Lf0G6CfGigCXoaMN0x6xNZMjwGfcE4dw6f9H54';
      `;
      const analysis = analyze(content, undefined);

      expect(analysis.hints.some((h: string) => h.includes('API key'))).to.be.true;
    });

    it('should hint about OpenAI API key', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        const OPENAI_KEY = 'sk-proj-42iwXvErUzZxzMyqOty0bqLFI1xhZbmpx1uI4oNL';
      `;
      const analysis = analyze(content, undefined);

      expect(analysis.hints.some((h: string) => h.includes('API key'))).to.be.true;
    });

    it('should hint about Google API key', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        const GOOGLE_KEY = 'AIzaSyBabcdefghijklmnopqrstuvwxyz123456';
      `;
      const analysis = analyze(content, undefined);

      expect(analysis.hints.some((h: string) => h.includes('API key'))).to.be.true;
    });

    it('should NOT hint about short strings that look like partial keys', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        const prefix = 'sk-ant-api'; // Just the prefix, not a full key
      `;
      const analysis = analyze(content, undefined);

      const apiKeyHints = analysis.hints.filter((h: string) => h.includes('API key'));
      expect(apiKeyHints).to.have.length(0);
    });
  });

  describe('JSON.parse Detection', () => {
    it('should hint about JSON.parse without try-catch', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function loadData() {
          const data = JSON.parse(storedValue);
          return data;
        }
      `;
      const analysis = analyze(content, undefined);

      expect(analysis.hints.some((h: string) => h.includes('JSON.parse'))).to.be.true;
    });

    it('should NOT hint about JSON.parse inside try-catch', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function loadData() {
          try {
            const data = JSON.parse(storedValue);
            return data;
          } catch (e) {
            return null;
          }
        }
      `;
      const analysis = analyze(content, undefined);

      const jsonHints = analysis.hints.filter((h: string) => h.includes('JSON.parse'));
      expect(jsonHints).to.have.length(0);
    });
  });

  describe('ConfigManager Sensitive Key Scope Detection', () => {
    it('should hint about API_KEY with script-wide scope', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        const config = new ConfigManager('APP');
        config.set('API_KEY', apiKeyValue);
      `;
      const analysis = analyze(content, undefined);

      expect(analysis.hints.some((h: string) => h.includes('Sensitive key'))).to.be.true;
    });

    it('should hint about setScript with TOKEN', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        config.setScript('TOKEN', tokenValue);
      `;
      const analysis = analyze(content, undefined);

      expect(analysis.hints.some((h: string) => h.includes('Sensitive key'))).to.be.true;
    });

    it('should NOT hint about setUser with sensitive keys', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        config.setUser('API_KEY', apiKeyValue);
      `;
      const analysis = analyze(content, undefined);

      const sensitiveHints = analysis.hints.filter((h: string) => h.includes('Sensitive key'));
      expect(sensitiveHints).to.have.length(0);
    });

    it('should NOT hint about non-sensitive keys with config.set', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        config.set('THEME', 'dark');
        config.set('FONT_SIZE', 12);
      `;
      const analysis = analyze(content, undefined);

      const sensitiveHints = analysis.hints.filter((h: string) => h.includes('Sensitive key'));
      expect(sensitiveHints).to.have.length(0);
    });
  });

  describe('File Type Detection Integration', () => {
    it('should detect SERVER_JS for module code', () => {
      const content = 'function _main(module, exports, log) { }';
      expect(determineFileType('Utils', content)).to.equal('SERVER_JS');
    });

    it('should detect SERVER_JS for plain functions', () => {
      const content = 'function doGet(e) { return null; }';
      expect(determineFileType('Code', content)).to.equal('SERVER_JS');
    });
  });

  describe('Direct PropertiesService Usage Detection', () => {
    it('should hint about PropertiesService.getScriptProperties() in regular files', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function getConfig() {
          return PropertiesService.getScriptProperties().getProperty('MY_KEY');
        }
      `;
      const analysis = analyze(content, undefined, 'utils');

      expect(analysis.hints.some((h: string) => h.includes('PropertiesService'))).to.be.true;
      expect(analysis.hints.some((h: string) => h.includes('ConfigManager'))).to.be.true;
    });

    it('should hint about PropertiesService.getUserProperties() in regular files', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function savePreference(key, value) {
          PropertiesService.getUserProperties().setProperty(key, value);
        }
      `;
      const analysis = analyze(content, undefined, 'preferences');

      expect(analysis.hints.some((h: string) => h.includes('PropertiesService'))).to.be.true;
    });

    it('should hint about PropertiesService.getDocumentProperties() in regular files', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        function getDocConfig() {
          return PropertiesService.getDocumentProperties().getProperties();
        }
      `;
      const analysis = analyze(content, undefined, 'docConfig');

      expect(analysis.hints.some((h: string) => h.includes('PropertiesService'))).to.be.true;
    });

    it('should mention standalone scripts as valid use case', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        const props = PropertiesService.getScriptProperties();
      `;
      const analysis = analyze(content, undefined, 'utils');

      expect(analysis.hints.some((h: string) =>
        h.includes('standalone scripts') || h.includes('templates')
      )).to.be.true;
    });

    it('should NOT hint for files in common-js/ folder', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        // This is ConfigManager internal implementation
        this.scriptProps = PropertiesService.getScriptProperties();
      `;
      const analysis = analyze(content, undefined, 'common-js/ConfigManager');

      const propsHints = analysis.hints.filter((h: string) => h.includes('PropertiesService'));
      expect(propsHints).to.have.length(0);
    });

    it('should NOT hint for ConfigManager files', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        this.userProps = PropertiesService.getUserProperties();
      `;
      const analysis = analyze(content, undefined, 'ConfigManager');

      const propsHints = analysis.hints.filter((h: string) => h.includes('PropertiesService'));
      expect(propsHints).to.have.length(0);
    });

    it('should NOT hint for require infrastructure files', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        // Module loader infrastructure
        const props = PropertiesService.getScriptProperties();
      `;
      const analysis = analyze(content, undefined, 'require.gs');

      const propsHints = analysis.hints.filter((h: string) => h.includes('PropertiesService'));
      expect(propsHints).to.have.length(0);
    });

    it('should NOT hint when PropertiesService is in comments', () => {
      const analyze = getAnalyzeCommonJsContent();
      const content = `
        // Note: PropertiesService.getScriptProperties() is used internally
        function doSomething() {
          return 42;
        }
      `;
      const analysis = analyze(content, undefined, 'utils');

      const propsHints = analysis.hints.filter((h: string) => h.includes('PropertiesService'));
      expect(propsHints).to.have.length(0);
    });
  });
});
