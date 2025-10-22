function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports
) {
  /**
   * common-js/__html_utils
   * HTML Utilities - CommonJS Infrastructure
   * 
   * Server-side HTML templating for Google Apps Script
   * Bootstrap file - auto-loads via __global__ detection
   */

  /**
   * Include HTML content from another file (server-side include)
   */
  function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  }

  /**
   * Include HTML with variable substitution
   * Supports {{varName}} syntax for simple templating
   */
  function includeWithVars(filename, vars) {
    let content = HtmlService.createHtmlOutputFromFile(filename).getContent();
    
    Object.keys(vars || {}).forEach(key => {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      content = content.replace(regex, String(vars[key]));
    });
    
    return content;
  }

  /**
   * Include with nested include support (recursive)
   * Max depth 10 to prevent infinite loops
   */
  function includeNested(filename, depth) {
    depth = depth || 0;
    
    if (depth > 10) {
      throw new Error(`Maximum include depth (10) exceeded at "${filename}". Check for circular includes.`);
    }
    
    let content = HtmlService.createHtmlOutputFromFile(filename).getContent();
    
    const includePattern = /<\?!=\s*include\(['"]([^'"]+)['"]\)\s*\?>/g;
    content = content.replace(includePattern, function(match, nestedFilename) {
      return includeNested(nestedFilename, depth + 1);
    });
    
    return content;
  }

  // Expose to global namespace
  globalThis.include = include;
  globalThis.includeWithVars = includeWithVars;
  globalThis.includeNested = includeNested;

  module.exports = {
    include,
    includeWithVars,
    includeNested,
    __global__: {
      include,
      includeWithVars,
      includeNested
    }
  };
}

__defineModule__(_main, null, { loadNow: true });