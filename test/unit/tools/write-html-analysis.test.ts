/**
 * Unit tests for WriteTool HTML analysis
 *
 * Verifies that HTML files are analyzed for common issues:
 * - include()/includeNested() in comments (which still execute in GAS!)
 * - google.script.run usage (recommend gas_client pattern)
 * - fetch/XHR patterns (warn about GAS sandbox)
 * - Template literals with URLs (cause "Unexpected end of input" errors)
 * - CommonJS patterns in HTML (wrong file type)
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { analyzeHtmlContent, determineFileType } from '../../../src/utils/contentAnalyzer.js';

describe('WriteTool - HTML Analysis', () => {
  // Use the shared utility directly
  const getAnalyzeHtmlContent = () => {
    return analyzeHtmlContent;
  };

  describe('include() in Comments Detection', () => {
    it('should warn about include() in HTML comments', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<!-- <?!= include("config") ?> -->';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
      expect(analysis.warnings[0]).to.include('CRITICAL');
      expect(analysis.warnings[0]).to.include('include()');
      expect(analysis.warnings[0]).to.include('comment');
    });

    it('should warn about include() in JS single-line comments', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>// <?!= include("helper") ?></script>';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
      expect(analysis.warnings[0]).to.include('CRITICAL');
    });

    it('should warn about include() in JS multi-line comments', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>/* <?!= include("template") ?> */</script>';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
      expect(analysis.warnings[0]).to.include('CRITICAL');
    });

    it('should warn about includeNested() in comments', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<!-- <?= includeNested("nested-template") ?> -->';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
      expect(analysis.warnings[0]).to.include('includeNested()');
    });

    it('should warn about include() with single quotes', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = "<!-- <?!= include('styles') ?> -->";
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
    });

    it('should warn about include() with whitespace variations', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<!-- <?!=   include( "config" )  ?> -->';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
    });

    it('should NOT warn about include() outside comments', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<?!= include("styles") ?>';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(0);
    });

    it('should NOT warn about include() in body text', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<div><?!= include("content") ?></div>';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(0);
    });

    it('should only produce one warning even with multiple occurrences', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = `
        <!-- <?!= include("one") ?> -->
        <!-- <?!= include("two") ?> -->
        // <?!= include("three") ?>
      `;
      const analysis = analyze(content);

      // Should only produce one warning to avoid noise
      expect(analysis.warnings).to.have.length(1);
    });

    it('should handle multi-line HTML comments with include()', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = `
        <!--
          TODO: Re-enable this later
          <?!= include("deprecated-feature") ?>
        -->
      `;
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
    });

    it('should warn about include() with multi-line arguments in comment', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = `<!-- <?!= include(
        "template"
      ) ?> -->`;
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
    });
  });

  describe('gas_client Pattern Recommendations', () => {
    it('should recommend gas_client when google.script.run is used', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>google.script.run.myFunction()</script>';
      const analysis = analyze(content);

      expect(analysis.hints).to.have.length(1);
      expect(analysis.hints[0]).to.include('gas_client');
      expect(analysis.hints[0]).to.include('Promise-based');
    });

    it('should recommend gas_client for withSuccessHandler pattern', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = `
        <script>
          google.script.run
            .withSuccessHandler(callback)
            .withFailureHandler(errorCallback)
            .myFunction();
        </script>
      `;
      const analysis = analyze(content);

      expect(analysis.hints).to.have.length(1);
      expect(analysis.hints[0]).to.include('window.server');
    });

    it('should NOT recommend gas_client when window.server is already used', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>window.server.exec_api(null, "M", "f", [])</script>';
      const analysis = analyze(content);

      expect(analysis.hints).to.have.length(0);
    });

    it('should NOT add hints for static HTML without JS', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<html><body><h1>Hello World</h1></body></html>';
      const analysis = analyze(content);

      expect(analysis.hints).to.have.length(0);
    });
  });

  describe('fetch/XHR Pattern Detection', () => {
    it('should warn about fetch() in GAS HTML', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>fetch("/api/data").then(r => r.json())</script>';
      const analysis = analyze(content);

      expect(analysis.hints).to.have.length(1);
      expect(analysis.hints[0]).to.include('fetch');
      expect(analysis.hints[0]).to.include('sandboxed');
    });

    it('should warn about XMLHttpRequest in GAS HTML', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>var xhr = new XMLHttpRequest();</script>';
      const analysis = analyze(content);

      expect(analysis.hints).to.have.length(1);
      expect(analysis.hints[0]).to.include('XHR');
    });

    it('should warn about axios in GAS HTML', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>axios.get("/api/data")</script>';
      const analysis = analyze(content);

      expect(analysis.hints).to.have.length(1);
    });

    it('should warn about jQuery ajax in GAS HTML', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>$.ajax({ url: "/api" })</script>';
      const analysis = analyze(content);

      expect(analysis.hints).to.have.length(1);
    });

    it('should NOT warn about fetch if google.script.run is also used', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = `
        <script>
          // Using proper GAS pattern
          google.script.run.getData();
          // This fetch is probably for external API
          fetch("https://external-api.com");
        </script>
      `;
      const analysis = analyze(content);

      // Should only get the gas_client recommendation, not the fetch warning
      expect(analysis.hints).to.have.length(1);
      expect(analysis.hints[0]).to.include('gas_client');
    });

    it('should NOT warn about fetch if window.server is used', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = `
        <script>
          window.server.exec_api(null, "M", "f", []);
          fetch("https://external-api.com");
        </script>
      `;
      const analysis = analyze(content);

      expect(analysis.hints).to.have.length(0);
    });
  });

  describe('Combined Scenarios', () => {
    it('should detect both include() in comment AND google.script.run', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = `
        <!-- <?!= include("old-styles") ?> -->
        <script>
          google.script.run.getData();
        </script>
      `;
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
      expect(analysis.hints).to.have.length(1);
    });

    it('should handle empty HTML content', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(0);
      expect(analysis.hints).to.have.length(0);
    });

    it('should handle HTML with only CSS (no script)', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>body { color: red; }</style>
        </head>
        <body></body>
        </html>
      `;
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(0);
      expect(analysis.hints).to.have.length(0);
    });

    it('should handle real-world GAS sidebar HTML', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = `
        <!DOCTYPE html>
        <html>
        <head>
          <base target="_top">
          <?!= include("css") ?>
        </head>
        <body>
          <div id="app"></div>
          <?!= include("javascript") ?>
          <script>
            google.script.run
              .withSuccessHandler(init)
              .withFailureHandler(showError)
              .getInitialData();
          </script>
        </body>
        </html>
      `;
      const analysis = analyze(content);

      // Should recommend gas_client (includes are outside comments so no warning)
      expect(analysis.warnings).to.have.length(0);
      expect(analysis.hints).to.have.length(1);
      expect(analysis.hints[0]).to.include('gas_client');
    });
  });

  describe('Template Literal URL Detection', () => {
    it('should warn about template literals containing URLs', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>const url = `https://api.example.com/data`;</script>';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
      expect(analysis.warnings[0]).to.include('Template literal');
      expect(analysis.warnings[0]).to.include('://');
      expect(analysis.warnings[0]).to.include('Unexpected end of input');
    });

    it('should warn about template literals with http://', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>const link = `http://example.com`;</script>';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
      expect(analysis.warnings[0]).to.include('://');
    });

    it('should warn about template literals with ftp://', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>const ftpUrl = `ftp://server.com/file`;</script>';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
    });

    it('should warn about template literals with interpolation containing URL', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>const url = `https://${domain}/api`;</script>';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
    });

    it('should NOT warn about regular strings with URLs', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>const url = "https://api.example.com/data";</script>';
      const analysis = analyze(content);

      // Should not have template literal warning
      const templateWarnings = analysis.warnings.filter((w: string) => w.includes('Template literal'));
      expect(templateWarnings).to.have.length(0);
    });

    it('should NOT warn about template literals without URLs', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>const msg = `Hello ${name}`;</script>';
      const analysis = analyze(content);

      const templateWarnings = analysis.warnings.filter((w: string) => w.includes('Template literal'));
      expect(templateWarnings).to.have.length(0);
    });

    it('should NOT warn about :// outside template literals', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>// Comment about https:// urls</script>';
      const analysis = analyze(content);

      const templateWarnings = analysis.warnings.filter((w: string) => w.includes('Template literal'));
      expect(templateWarnings).to.have.length(0);
    });
  });

  describe('CommonJS Patterns in HTML Detection', () => {
    it('should warn about require() in HTML files', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>const utils = require("Utils");</script>';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
      expect(analysis.warnings[0]).to.include('CommonJS');
      expect(analysis.warnings[0]).to.include('require');
      expect(analysis.warnings[0]).to.include('HTML');
    });

    it('should warn about module.exports in HTML files', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>module.exports = { init: init };</script>';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
      expect(analysis.warnings[0]).to.include('CommonJS');
      expect(analysis.warnings[0]).to.include('module.exports');
    });

    it('should warn about module.exports.property in HTML files', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>module.exports.helper = function() {};</script>';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
      expect(analysis.warnings[0]).to.include('CommonJS');
    });

    it('should warn about require with single quotes', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = "<script>const lib = require('Library');</script>";
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
      expect(analysis.warnings[0]).to.include('CommonJS');
    });

    it('should NOT warn about require mentioned in comments', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>// Note: require() is not used in HTML</script>';
      const analysis = analyze(content);

      // The word "require" appears but not as require("...")
      const commonjsWarnings = analysis.warnings.filter((w: string) => w.includes('CommonJS'));
      expect(commonjsWarnings).to.have.length(0);
    });

    it('should NOT warn about require without parentheses', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>// This does not require any setup</script>';
      const analysis = analyze(content);

      const commonjsWarnings = analysis.warnings.filter((w: string) => w.includes('CommonJS'));
      expect(commonjsWarnings).to.have.length(0);
    });

    it('should suggest window.server.exec_api() alternative', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = '<script>const data = require("DataModule").getData();</script>';
      const analysis = analyze(content);

      expect(analysis.warnings).to.have.length(1);
      expect(analysis.warnings[0]).to.include('window.server.exec_api()');
    });

    it('should handle both require and module.exports in same file', () => {
      const analyze = getAnalyzeHtmlContent();
      const content = `
        <script>
          const utils = require("Utils");
          module.exports = { process: utils.process };
        </script>
      `;
      const analysis = analyze(content);

      // Should only produce one warning (not two)
      const commonjsWarnings = analysis.warnings.filter((w: string) => w.includes('CommonJS'));
      expect(commonjsWarnings).to.have.length(1);
    });
  });

  describe('File Type Detection Integration', () => {
    // These tests verify the determineFileType method works correctly for HTML

    it('should detect HTML from DOCTYPE', () => {
      const content = '<!DOCTYPE html><html></html>';
      expect(determineFileType('sidebar', content)).to.equal('HTML');
    });

    it('should detect HTML from <html> tag', () => {
      const content = '<html><body></body></html>';
      expect(determineFileType('page', content)).to.equal('HTML');
    });

    it('should detect SERVER_JS for non-HTML content', () => {
      const content = 'function main() { return 42; }';
      expect(determineFileType('code', content)).to.equal('SERVER_JS');
    });

    it('should detect JSON for appsscript', () => {
      const content = '{}';
      expect(determineFileType('appsscript', content)).to.equal('JSON');
    });
  });
});
