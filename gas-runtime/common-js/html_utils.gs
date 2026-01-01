/**
 * common-js/html_utils
 * HTML Utilities - CommonJS Infrastructure
 *
 * Server-side HTML templating for Google Apps Script
 * Bootstrap file - auto-loads via __global__ detection
 *
 * ============================================================================
 * GOOGLE APPS SCRIPT HTTP HEADER LIMITATIONS
 * ============================================================================
 *
 * ⚠️ IMPORTANT: You CANNOT set custom HTTP headers in Google Apps Script web apps
 *
 * What you CANNOT do:
 * ❌ Access-Control-Allow-Origin (CORS headers)
 * ❌ Content-Type for HtmlOutput (auto-set to text/html)
 * ❌ Cache-Control
 * ❌ Content-Security-Policy (as HTTP header)
 * ❌ Custom HTTP status codes (always 200 on success)
 * ❌ Any custom headers
 *
 * What you CAN control:
 * ✅ X-Frame-Options (ONLY HTTP header available via setXFrameOptionsMode)
 * ✅ HTML meta tags (via addMetaTag)
 * ✅ Page title, favicon (via setTitle, setFaviconUrl)
 * ✅ MIME type for non-HTML responses (via ContentService)
 *
 * Security Reason: Scripts run on google.com domain - allowing header
 * manipulation could enable cookie-based attacks.
 *
 * ============================================================================
 * DEPLOYMENT ENVIRONMENT DIFFERENCES
 * ============================================================================
 *
 * **DEV Environment** (/dev URL):
 *   - Used during development/testing
 *   - X-Frame-Options settings are NOT applied
 *   - Iframe embedding may not work as expected
 *   - URL format: https://script.google.com/macros/s/YOUR_ID/dev
 *
 * **STAGE/PROD Environments** (/exec URL):
 *   - Used for production deployments
 *   - X-Frame-Options settings ARE applied correctly
 *   - Required for iframe embedding to work
 *   - URL format: https://script.google.com/macros/s/YOUR_ID/exec
 *
 * ⚠️ CRITICAL: Always test iframe embedding with /exec URLs, not /dev
 *
 * ============================================================================
 * METHOD CHAIN ORDER
 * ============================================================================
 *
 * Correct order for HtmlTemplate → HtmlOutput:
 *
 * HtmlService.createTemplateFromFile('filename')  // Returns HtmlTemplate
 *   .evaluate()                                    // Returns HtmlOutput ✅
 *   .setXFrameOptionsMode(...)                    // Configure HtmlOutput ✅
 *   .addMetaTag(...)                              // Chain more configs ✅
 *
 * ❌ Common Mistake - Wrapping evaluate() result:
 * HtmlService.createHtmlOutput(
 *   template.evaluate().setXFrameOptionsMode(...) // Settings lost!
 * )
 *
 * ============================================================================
 * REFERENCES
 * ============================================================================
 *
 * - Official HtmlService: https://developers.google.com/apps-script/reference/html/html-service
 * - Official HtmlOutput: https://developers.google.com/apps-script/reference/html/html-output
 * - Official HtmlTemplate: https://developers.google.com/apps-script/reference/html/html-template
 * - StackOverflow - Set HTTP Headers: https://stackoverflow.com/questions/59686777/set-http-headers-in-google-apps-script
 * - StackOverflow - X-Frame-Options: https://stackoverflow.com/questions/79538928/properly-setting-the-xframeoptionsmode-for-google-apps-script-iframes
 * - StackOverflow - Read/Modify Headers: https://stackoverflow.com/questions/13848086/read-http-request-headers-and-modify-response-headers-of-an-apps-script-web-app
 */

/**
 * Default configuration for HTML output
 * @const {Object}
 */
const HTML_DEFAULTS = {
  /**
   * Default X-Frame-Options mode
   * ALLOWALL enables iframe embedding across all domains
   * Note: Only takes effect on /exec URLs (stage/prod), not /dev URLs
   */
  xFrameOptions: HtmlService.XFrameOptionsMode.ALLOWALL,

  /**
   * Default meta tags applied to all HTML output
   */
  metaTags: {
    viewport: 'width=device-width, initial-scale=1'
  }
};

/**
 * Create and configure HtmlOutput from template file
 *
 * This is a convenience wrapper around HtmlService.createTemplateFromFile()
 * that automatically:
 * - Calls evaluate() on the template
 * - Sets X-Frame-Options to ALLOWALL (enables iframe embedding)
 * - Optionally adds meta tags, title, favicon, and dimensions
 *
 * @param {string} filename - Name of the HTML file (without extension)
 * @param {Object} [properties={}] - Properties to set on the template before evaluation
 *                                   These become available as <?= propertyName ?> in the HTML
 * @param {Object} [options={}] - Configuration options for the HtmlOutput
 * @param {boolean} [options.allowIframe=true] - Set X-Frame-Options to ALLOWALL (default: true)
 * @param {string} [options.title] - Page title
 * @param {string} [options.faviconUrl] - URL to favicon
 * @param {Object} [options.metaTags] - Meta tags to add {name: content}
 * @param {number} [options.width] - Width in pixels (for dialogs)
 * @param {number} [options.height] - Height in pixels (for dialogs)
 *
 * @returns {GoogleAppsScript.HTML.HtmlOutput} Configured HtmlOutput ready to return from doGet/doPost
 *
 * @example
 * // Basic usage in doGet
 * function doGet() {
 *   return createHtmlFromTemplate('index');
 * }
 *
 * @example
 * // With template properties and full configuration
 * function doGet(e) {
 *   return createHtmlFromTemplate('index',
 *     { userName: 'John', timestamp: new Date() },
 *     {
 *       title: 'My Web App',
 *       faviconUrl: 'https://example.com/favicon.ico',
 *       metaTags: {
 *         'description': 'A sample web app',
 *         'viewport': 'width=device-width, initial-scale=1',
 *         'theme-color': '#4285f4'
 *       },
 *       width: 800,
 *       height: 600
 *     }
 *   );
 * }
 *
 * @example
 * // Disable iframe embedding (use DEFAULT instead of ALLOWALL)
 * function doGet() {
 *   return createHtmlFromTemplate('secure-page', {}, { allowIframe: false });
 * }
 */
function createHtmlFromTemplate(filename, properties, options) {
  properties = properties || {};
  options = options || {};

  // Create template and set properties
  const template = HtmlService.createTemplateFromFile(filename);
  Object.keys(properties).forEach(key => {
    template[key] = properties[key];
  });

  // Evaluate template to get HtmlOutput
  let output = template.evaluate();

  // Configure with options
  output = configureHtmlOutput(output, options);

  return output;
}

/**
 * Configure an existing HtmlOutput object with common settings
 *
 * This helper function applies standard configurations to an HtmlOutput object:
 * - Sets X-Frame-Options (defaults to ALLOWALL for iframe embedding)
 * - Adds meta tags (including default viewport meta tag)
 * - Sets title, favicon, dimensions
 *
 * ⚠️ IMPORTANT: X-Frame-Options only takes effect on /exec URLs (stage/prod).
 *               Dev deployments using /dev URLs will NOT apply these settings.
 *
 * @param {GoogleAppsScript.HTML.HtmlOutput} output - The HtmlOutput to configure
 * @param {Object} [options={}] - Configuration options
 * @param {boolean} [options.allowIframe=true] - Enable iframe embedding (ALLOWALL mode)
 *                                               Set false for SAMEORIGIN mode
 * @param {string} [options.title] - Page title
 * @param {string} [options.faviconUrl] - URL to favicon
 * @param {Object} [options.metaTags] - Meta tags to add {name: content}
 *                                      Merges with defaults (viewport)
 * @param {number} [options.width] - Width in pixels (for dialogs)
 * @param {number} [options.height] - Height in pixels (for dialogs)
 *
 * @returns {GoogleAppsScript.HTML.HtmlOutput} The configured output (for chaining)
 *
 * @example
 * // Configure existing HtmlOutput
 * function doGet() {
 *   const output = HtmlService.createHtmlOutput('<h1>Hello</h1>');
 *   return configureHtmlOutput(output, {
 *     title: 'My Page',
 *     metaTags: { 'description': 'Sample page' }
 *   });
 * }
 *
 * @example
 * // Use with template evaluation
 * function doGet() {
 *   const template = HtmlService.createTemplateFromFile('index');
 *   template.userName = 'John';
 *   const output = template.evaluate();
 *
 *   return configureHtmlOutput(output, {
 *     allowIframe: true,  // Default, enables embedding
 *     title: 'Dashboard',
 *     width: 1024,
 *     height: 768
 *   });
 * }
 */
function configureHtmlOutput(output, options) {
  options = options || {};

  // Set X-Frame-Options (default to ALLOWALL for iframe embedding)
  // Note: Only effective on /exec URLs (stage/prod), not /dev URLs
  const allowIframe = options.allowIframe !== undefined ? options.allowIframe : true;
  output.setXFrameOptionsMode(
    allowIframe
      ? HTML_DEFAULTS.xFrameOptions
      : HtmlService.XFrameOptionsMode.DEFAULT
  );

  // Merge default meta tags with provided ones
  const metaTags = Object.assign({}, HTML_DEFAULTS.metaTags, options.metaTags || {});
  Object.keys(metaTags).forEach(name => {
    output.addMetaTag(name, metaTags[name]);
  });

  // Set optional properties
  if (options.title) {
    output.setTitle(options.title);
  }

  if (options.faviconUrl) {
    output.setFaviconUrl(options.faviconUrl);
  }

  if (options.width) {
    output.setWidth(options.width);
  }

  if (options.height) {
    output.setHeight(options.height);
  }

  return output;
}

/**
 * Include HTML content from another file (server-side include)
 *
 * This function enables server-side HTML composition by loading content from
 * separate HTML files. This pattern is essential for:
 * - Avoiding CORS issues with external CSS/JS files
 * - Code organization and reusability
 * - Embedding styles and scripts inline
 *
 * Usage in HTML files:
 * <?!= include('filename') ?>
 *
 * The "!" after "<?" forces immediate evaluation on the server side.
 *
 * RECOMMENDED PATTERN for CSS/JS:
 * Instead of external files that trigger CORS errors, use include:
 *
 * <!-- Instead of: <link rel="stylesheet" href="external.css"> -->
 * <?!= include('Stylesheet') ?>
 *
 * <!-- Instead of: <script src="external.js"></script> -->
 * <?!= include('JavaScript') ?>
 *
 * @param {string} filename - Name of the HTML file to include (without extension)
 *
 * @returns {string} The HTML content from the file
 *
 * @example
 * // Code.gs
 * function doGet() {
 *   return HtmlService.createTemplateFromFile('Page').evaluate();
 * }
 *
 * // Page.html
 * <!DOCTYPE html>
 * <html>
 *   <head>
 *     <base target="_top">
 *     <?!= include('Stylesheet') ?>
 *   </head>
 *   <body>
 *     <h1>Welcome</h1>
 *     <?!= include('JavaScript') ?>
 *   </body>
 * </html>
 *
 * // Stylesheet.html
 * <style>
 *   body { font-family: Arial, sans-serif; }
 *   h1 { color: #4285f4; }
 * </style>
 *
 * // JavaScript.html
 * <script>
 *   console.log('Page loaded');
 *   // Your JavaScript here
 * </script>
 *
 * @see https://stackoverflow.com/questions/59686777/set-http-headers-in-google-apps-script
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Include HTML with variable substitution
 *
 * Supports {{varName}} syntax for simple templating in included files.
 * Useful for including HTML fragments that need dynamic values.
 *
 * Note: For complex templating, prefer using createTemplateFromFile with
 * the standard <?= varName ?> syntax.
 *
 * @param {string} filename - Name of the HTML file to include (without extension)
 * @param {Object} vars - Variables for substitution {varName: value}
 *                        Each {{varName}} in the file will be replaced with value
 *
 * @returns {string} The HTML content with variables substituted
 *
 * @example
 * // In your HTML template
 * <?!= includeWithVars('Alert', {message: 'Hello!', type: 'success'}) ?>
 *
 * // Alert.html
 * <div class="alert alert-{{type}}">
 *   {{message}}
 * </div>
 *
 * // Results in:
 * // <div class="alert alert-success">Hello!</div>
 *
 * @example
 * // Dynamic navigation with current page
 * <?!= includeWithVars('Navigation', {currentPage: 'dashboard', userName: 'John'}) ?>
 *
 * // Navigation.html
 * <nav>
 *   <span>Welcome, {{userName}}</span>
 *   <a class="{{currentPage == 'dashboard' ? 'active' : ''}}">Dashboard</a>
 * </nav>
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
 *
 * Allows HTML files to include other HTML files recursively using:
 * <?!= include('filename') ?>
 *
 * Maximum depth of 10 levels to prevent infinite loops.
 *
 * ⚠️ WARNING: Use with caution. Circular includes will throw an error.
 * For most cases, standard include() is sufficient.
 *
 * @param {string} filename - Name of the HTML file to include (without extension)
 * @param {number} [depth=0] - Current recursion depth (internal use)
 *
 * @returns {string} The HTML content with all nested includes resolved
 *
 * @throws {Error} If maximum include depth (10) is exceeded
 *
 * @example
 * // Page.html
 * <!DOCTYPE html>
 * <html>
 *   <body>
 *     <?!= includeNested('Layout') ?>
 *   </body>
 * </html>
 *
 * // Layout.html
 * <div class="container">
 *   <?!= include('Header') ?>
 *   <main>Content</main>
 *   <?!= include('Footer') ?>
 * </div>
 *
 * // Header.html
 * <header>
 *   <?!= include('Logo') ?>
 *   <?!= include('Navigation') ?>
 * </header>
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
globalThis.createHtmlFromTemplate = createHtmlFromTemplate;
globalThis.configureHtmlOutput = configureHtmlOutput;

module.exports = {
  include,
  includeWithVars,
  includeNested,
  createHtmlFromTemplate,
  configureHtmlOutput,
  HTML_DEFAULTS,
  __global__: {
    include,
    includeWithVars,
    includeNested,
    createHtmlFromTemplate,
    configureHtmlOutput
  }
};
