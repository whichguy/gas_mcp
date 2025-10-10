/**
 * URL Parsing Utilities for Google Apps Script Web App URLs
 *
 * Provides centralized URL parsing logic for GAS web app URLs, supporting both
 * domain-specific (Google Workspace) and standard (consumer) URL formats.
 *
 * **Consolidates URL parsing** from:
 * - `deployments.ts:extractUrlInfo()` - Deployment URL analysis
 * - `gasClient.ts:constructGasRunUrlFromWebApp()` - Bearer token URL conversion
 *
 * **Benefits:**
 * - Single source of truth for URL parsing logic
 * - Consistent regex patterns across codebase
 * - Centralized edge case handling
 * - Easier maintenance and testing
 */

/**
 * Basic URL information extracted from GAS web app URLs
 *
 * Used by gasClient.ts for URL conversion operations
 */
export interface GasUrlInfo {
  /** Deployment ID extracted from URL path */
  deploymentId: string | null;

  /** True if URL uses domain-specific format (/a/macros/DOMAIN/...) */
  isDomainSpecific: boolean;

  /** Google Workspace domain (if domain-specific URL) */
  domain: string | null;

  /** Endpoint type: 'exec' (versioned) or 'dev' (HEAD) */
  endpoint: 'exec' | 'dev' | null;
}

/**
 * Comprehensive URL extraction result with both URL formats
 *
 * Used by deployments.ts for complete deployment URL analysis
 */
export interface UrlExtractionResult {
  /** Deployment ID extracted from URL path */
  deploymentId: string | null;

  /** True if URL uses domain-specific format (/a/macros/DOMAIN/...) */
  isDomainSpecific: boolean;

  /** Google Workspace domain (if domain-specific URL) */
  domain: string | null;

  /** Standard format base URL (works with Bearer tokens) */
  standardBaseUrl: string | null;

  /** Domain-specific base URL (requires Workspace authentication) */
  domainBaseUrl: string | null;
}

/**
 * Parse Google Apps Script web app URL and extract deployment information
 *
 * **Supported URL Formats:**
 * - Standard: `https://script.google.com/macros/s/[ID]/exec`
 * - Standard HEAD: `https://script.google.com/macros/s/[ID]/dev`
 * - Domain: `https://script.google.com/a/macros/[DOMAIN]/s/[ID]/exec`
 * - Domain HEAD: `https://script.google.com/a/macros/[DOMAIN]/s/[ID]/dev`
 *
 * **Edge Cases:**
 * - ✅ Trailing slashes: Supported (e.g., `/exec/` or `/dev/`)
 * - ❌ Query parameters: Excluded (must end with /exec or /dev)
 * - ❌ Case sensitivity: Requires lowercase 'exec' or 'dev'
 * - ✅ Null/undefined: Returns null values without throwing
 * - ✅ Malformed URLs: Returns null values without throwing
 *
 * **URL Component Meanings:**
 * - `/exec` - Versioned deployment (stable snapshot of specific version)
 * - `/dev` - HEAD deployment (always reflects latest saved code)
 * - `/a/macros/[DOMAIN]/` - Google Workspace domain-specific URL
 * - `/macros/s/` - Standard consumer Google account URL
 *
 * @param webAppUrl - Full web app URL from Google Apps Script API
 * @returns Basic URL info (deployment ID, domain, endpoint type)
 *
 * @example
 * ```typescript
 * // Standard URL
 * const info = parseGasUrl('https://script.google.com/macros/s/ABC123/exec');
 * // => { deploymentId: 'ABC123', isDomainSpecific: false, domain: null, endpoint: 'exec' }
 *
 * // Domain-specific URL
 * const info = parseGasUrl('https://script.google.com/a/macros/example.com/s/XYZ789/dev');
 * // => { deploymentId: 'XYZ789', isDomainSpecific: true, domain: 'example.com', endpoint: 'dev' }
 *
 * // With trailing slash (supported)
 * const info = parseGasUrl('https://script.google.com/macros/s/ABC123/exec/');
 * // => { deploymentId: 'ABC123', isDomainSpecific: false, domain: null, endpoint: 'exec' }
 * ```
 */
export function parseGasUrl(webAppUrl: string): GasUrlInfo {
  try {
    const url = new URL(webAppUrl);

    // Combined regex with optional domain section and optional trailing slash
    // Captures: [1] = domain (optional), [2] = deployment ID, [3] = endpoint type
    // Pattern: /a/macros/[DOMAIN]/s/[ID]/exec or /macros/s/[ID]/dev with optional trailing slash
    const match = url.pathname.match(/\/(?:a\/macros\/([^\/]+)\/)?s\/([^\/]+)\/(exec|dev)\/?$/);

    if (!match) {
      return {
        deploymentId: null,
        isDomainSpecific: false,
        domain: null,
        endpoint: null
      };
    }

    return {
      deploymentId: match[2],
      isDomainSpecific: !!match[1],
      domain: match[1] || null,
      endpoint: match[3] as 'exec' | 'dev'
    };
  } catch (error) {
    // URL parsing failed - return null values
    return {
      deploymentId: null,
      isDomainSpecific: false,
      domain: null,
      endpoint: null
    };
  }
}

/**
 * Extract comprehensive URL information with both standard and domain-specific formats
 *
 * **Extends `parseGasUrl()`** with additional URL construction for deployment tools.
 *
 * **Use Cases:**
 * - Deployment URL analysis in deploy_list
 * - Displaying both URL formats to users
 * - Providing authentication guidance (Bearer vs Workspace)
 *
 * @param webAppUrl - Full web app URL from Google Apps Script API
 * @returns Complete URL extraction with both formats
 *
 * @example
 * ```typescript
 * const result = extractUrlInfo('https://script.google.com/a/macros/example.com/s/ABC123/exec');
 * // => {
 * //   deploymentId: 'ABC123',
 * //   isDomainSpecific: true,
 * //   domain: 'example.com',
 * //   standardBaseUrl: 'https://script.google.com/macros/s/ABC123',
 * //   domainBaseUrl: 'https://script.google.com/a/macros/example.com/s/ABC123'
 * // }
 * ```
 */
export function extractUrlInfo(webAppUrl: string): UrlExtractionResult {
  const basicInfo = parseGasUrl(webAppUrl);

  // If parsing failed, return all nulls
  if (!basicInfo.deploymentId) {
    return {
      deploymentId: null,
      isDomainSpecific: false,
      domain: null,
      standardBaseUrl: null,
      domainBaseUrl: null
    };
  }

  // Construct base URLs without endpoint (/exec or /dev)
  const standardBaseUrl = `https://script.google.com/macros/s/${basicInfo.deploymentId}`;
  const domainBaseUrl = basicInfo.isDomainSpecific && basicInfo.domain
    ? `https://script.google.com/a/macros/${basicInfo.domain}/s/${basicInfo.deploymentId}`
    : null;

  return {
    deploymentId: basicInfo.deploymentId,
    isDomainSpecific: basicInfo.isDomainSpecific,
    domain: basicInfo.domain,
    standardBaseUrl,
    domainBaseUrl
  };
}

/**
 * Convert GAS web app URL to Bearer token-compatible standard format
 *
 * **Conversion Rules:**
 * - Domain-specific → Standard format (Bearer token compatible)
 * - `/exec` → `/dev` (HEAD deployment for testing)
 * - Preserves deployment ID
 *
 * **Why Conversion is Needed:**
 * - Domain-specific URLs require Google Workspace authentication
 * - Standard URLs work with Bearer token authentication
 * - MCP server uses Bearer tokens for API access
 *
 * @param webAppUrl - Original web app URL (any format)
 * @returns Standard format URL with /dev endpoint
 *
 * @example
 * ```typescript
 * // Domain → Standard
 * convertToBearerCompatibleUrl('https://script.google.com/a/macros/example.com/s/ABC/exec');
 * // => 'https://script.google.com/macros/s/ABC/dev'
 *
 * // Standard exec → Standard dev
 * convertToBearerCompatibleUrl('https://script.google.com/macros/s/ABC/exec');
 * // => 'https://script.google.com/macros/s/ABC/dev'
 * ```
 */
export function convertToBearerCompatibleUrl(webAppUrl: string): string {
  const urlInfo = parseGasUrl(webAppUrl);

  // If parsing failed, return original URL
  if (!urlInfo.deploymentId) {
    return webAppUrl;
  }

  // Construct standard format URL with /dev endpoint
  return `https://script.google.com/macros/s/${urlInfo.deploymentId}/dev`;
}
