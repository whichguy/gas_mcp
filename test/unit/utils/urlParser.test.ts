/**
 * Unit tests for URL Parser utility
 *
 * Tests URL parsing logic for Google Apps Script web app URLs with comprehensive
 * edge case coverage including trailing slashes, domain-specific vs standard URLs,
 * exec vs dev endpoints, and malformed input handling.
 */

import { expect } from 'chai';
import { parseGasUrl, extractUrlInfo, convertToBearerCompatibleUrl } from '../../../src/utils/urlParser.js';

describe('URL Parser', () => {
  describe('parseGasUrl', () => {
    describe('standard URLs', () => {
      it('should parse standard exec URL', () => {
        const result = parseGasUrl('https://script.google.com/macros/s/ABC123/exec');

        expect(result.deploymentId).to.equal('ABC123');
        expect(result.isDomainSpecific).to.be.false;
        expect(result.domain).to.be.null;
        expect(result.endpoint).to.equal('exec');
      });

      it('should parse standard dev URL', () => {
        const result = parseGasUrl('https://script.google.com/macros/s/XYZ789/dev');

        expect(result.deploymentId).to.equal('XYZ789');
        expect(result.isDomainSpecific).to.be.false;
        expect(result.domain).to.be.null;
        expect(result.endpoint).to.equal('dev');
      });

      it('should parse standard URL with trailing slash', () => {
        const result = parseGasUrl('https://script.google.com/macros/s/ABC123/exec/');

        expect(result.deploymentId).to.equal('ABC123');
        expect(result.isDomainSpecific).to.be.false;
        expect(result.domain).to.be.null;
        expect(result.endpoint).to.equal('exec');
      });

      it('should parse standard dev URL with trailing slash', () => {
        const result = parseGasUrl('https://script.google.com/macros/s/XYZ789/dev/');

        expect(result.deploymentId).to.equal('XYZ789');
        expect(result.endpoint).to.equal('dev');
      });
    });

    describe('domain-specific URLs', () => {
      it('should parse domain-specific exec URL', () => {
        const result = parseGasUrl('https://script.google.com/a/macros/example.com/s/ABC123/exec');

        expect(result.deploymentId).to.equal('ABC123');
        expect(result.isDomainSpecific).to.be.true;
        expect(result.domain).to.equal('example.com');
        expect(result.endpoint).to.equal('exec');
      });

      it('should parse domain-specific dev URL', () => {
        const result = parseGasUrl('https://script.google.com/a/macros/company.org/s/XYZ789/dev');

        expect(result.deploymentId).to.equal('XYZ789');
        expect(result.isDomainSpecific).to.be.true;
        expect(result.domain).to.equal('company.org');
        expect(result.endpoint).to.equal('dev');
      });

      it('should parse domain-specific URL with trailing slash', () => {
        const result = parseGasUrl('https://script.google.com/a/macros/example.com/s/ABC123/exec/');

        expect(result.deploymentId).to.equal('ABC123');
        expect(result.isDomainSpecific).to.be.true;
        expect(result.domain).to.equal('example.com');
        expect(result.endpoint).to.equal('exec');
      });

      it('should parse domain with subdomain', () => {
        const result = parseGasUrl('https://script.google.com/a/macros/team.company.org/s/TEST456/exec');

        expect(result.domain).to.equal('team.company.org');
        expect(result.deploymentId).to.equal('TEST456');
      });
    });

    describe('edge cases', () => {
      it('should handle URLs with query parameters (excluded)', () => {
        const result = parseGasUrl('https://script.google.com/macros/s/ABC123/exec?foo=bar');

        // Query params should prevent match (regex requires /exec or /dev at end)
        expect(result.deploymentId).to.be.null;
        expect(result.endpoint).to.be.null;
      });

      it('should reject URLs with wrong case', () => {
        const result = parseGasUrl('https://script.google.com/macros/s/ABC123/EXEC');

        expect(result.deploymentId).to.be.null;
        expect(result.endpoint).to.be.null;
      });

      it('should handle malformed URLs gracefully', () => {
        const result = parseGasUrl('not-a-url');

        expect(result.deploymentId).to.be.null;
        expect(result.isDomainSpecific).to.be.false;
        expect(result.domain).to.be.null;
        expect(result.endpoint).to.be.null;
      });

      it('should handle null input gracefully', () => {
        const result = parseGasUrl(null as any);

        expect(result.deploymentId).to.be.null;
      });

      it('should handle undefined input gracefully', () => {
        const result = parseGasUrl(undefined as any);

        expect(result.deploymentId).to.be.null;
      });

      it('should handle empty string', () => {
        const result = parseGasUrl('');

        expect(result.deploymentId).to.be.null;
      });

      it('should reject URLs without /exec or /dev', () => {
        const result = parseGasUrl('https://script.google.com/macros/s/ABC123');

        expect(result.deploymentId).to.be.null;
      });

      it('should reject URLs with wrong path structure', () => {
        const result = parseGasUrl('https://script.google.com/wrong/path/ABC123/exec');

        expect(result.deploymentId).to.be.null;
      });
    });

    describe('real-world deployment IDs', () => {
      it('should handle long alphanumeric deployment IDs', () => {
        const realId = 'AKfycbwxLmN8pQr9StUv2WxYz3A4bCd5eF6gH7iJ8kL9mN0oP1qR2sT3uV4wX5yZ6';
        const result = parseGasUrl(`https://script.google.com/macros/s/${realId}/exec`);

        expect(result.deploymentId).to.equal(realId);
      });

      it('should handle deployment IDs with hyphens and underscores', () => {
        const result = parseGasUrl('https://script.google.com/macros/s/ABC-123_XYZ/exec');

        expect(result.deploymentId).to.equal('ABC-123_XYZ');
      });
    });
  });

  describe('extractUrlInfo', () => {
    it('should extract complete URL info for standard URL', () => {
      const result = extractUrlInfo('https://script.google.com/macros/s/ABC123/exec');

      expect(result.deploymentId).to.equal('ABC123');
      expect(result.isDomainSpecific).to.be.false;
      expect(result.domain).to.be.null;
      expect(result.standardBaseUrl).to.equal('https://script.google.com/macros/s/ABC123');
      expect(result.domainBaseUrl).to.be.null;
    });

    it('should extract complete URL info for domain-specific URL', () => {
      const result = extractUrlInfo('https://script.google.com/a/macros/example.com/s/ABC123/exec');

      expect(result.deploymentId).to.equal('ABC123');
      expect(result.isDomainSpecific).to.be.true;
      expect(result.domain).to.equal('example.com');
      expect(result.standardBaseUrl).to.equal('https://script.google.com/macros/s/ABC123');
      expect(result.domainBaseUrl).to.equal('https://script.google.com/a/macros/example.com/s/ABC123');
    });

    it('should handle dev endpoints', () => {
      const result = extractUrlInfo('https://script.google.com/macros/s/XYZ789/dev');

      expect(result.deploymentId).to.equal('XYZ789');
      expect(result.standardBaseUrl).to.equal('https://script.google.com/macros/s/XYZ789');
    });

    it('should return nulls for malformed URLs', () => {
      const result = extractUrlInfo('not-a-valid-url');

      expect(result.deploymentId).to.be.null;
      expect(result.standardBaseUrl).to.be.null;
      expect(result.domainBaseUrl).to.be.null;
    });

    it('should construct both URL formats for domain-specific URLs', () => {
      const result = extractUrlInfo('https://script.google.com/a/macros/company.org/s/TEST456/dev');

      // Should provide both standard and domain-specific base URLs
      expect(result.standardBaseUrl).to.equal('https://script.google.com/macros/s/TEST456');
      expect(result.domainBaseUrl).to.equal('https://script.google.com/a/macros/company.org/s/TEST456');
    });
  });

  describe('convertToBearerCompatibleUrl', () => {
    it('should convert domain-specific exec URL to standard dev URL', () => {
      const result = convertToBearerCompatibleUrl('https://script.google.com/a/macros/example.com/s/ABC123/exec');

      expect(result).to.equal('https://script.google.com/macros/s/ABC123/dev');
    });

    it('should convert domain-specific dev URL to standard dev URL', () => {
      const result = convertToBearerCompatibleUrl('https://script.google.com/a/macros/example.com/s/ABC123/dev');

      expect(result).to.equal('https://script.google.com/macros/s/ABC123/dev');
    });

    it('should convert standard exec URL to standard dev URL', () => {
      const result = convertToBearerCompatibleUrl('https://script.google.com/macros/s/ABC123/exec');

      expect(result).to.equal('https://script.google.com/macros/s/ABC123/dev');
    });

    it('should preserve standard dev URL unchanged', () => {
      const url = 'https://script.google.com/macros/s/ABC123/dev';
      const result = convertToBearerCompatibleUrl(url);

      expect(result).to.equal('https://script.google.com/macros/s/ABC123/dev');
    });

    it('should handle URLs with trailing slashes', () => {
      const result = convertToBearerCompatibleUrl('https://script.google.com/macros/s/ABC123/exec/');

      expect(result).to.equal('https://script.google.com/macros/s/ABC123/dev');
    });

    it('should return original URL for unparseable input', () => {
      const badUrl = 'not-a-valid-url';
      const result = convertToBearerCompatibleUrl(badUrl);

      expect(result).to.equal(badUrl);
    });

    it('should convert complex domain URLs', () => {
      const result = convertToBearerCompatibleUrl('https://script.google.com/a/macros/team.company.org/s/XYZ789/exec');

      expect(result).to.equal('https://script.google.com/macros/s/XYZ789/dev');
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete workflow: parse, extract, convert', () => {
      const originalUrl = 'https://script.google.com/a/macros/example.com/s/ABC123/exec';

      // Parse basic info
      const parsed = parseGasUrl(originalUrl);
      expect(parsed.deploymentId).to.equal('ABC123');
      expect(parsed.isDomainSpecific).to.be.true;

      // Extract complete URL info
      const extracted = extractUrlInfo(originalUrl);
      expect(extracted.standardBaseUrl).to.equal('https://script.google.com/macros/s/ABC123');
      expect(extracted.domainBaseUrl).to.equal('https://script.google.com/a/macros/example.com/s/ABC123');

      // Convert to Bearer-compatible
      const converted = convertToBearerCompatibleUrl(originalUrl);
      expect(converted).to.equal('https://script.google.com/macros/s/ABC123/dev');
    });

    it('should handle standard URL workflow', () => {
      const originalUrl = 'https://script.google.com/macros/s/XYZ789/exec/';

      const parsed = parseGasUrl(originalUrl);
      expect(parsed.deploymentId).to.equal('XYZ789');
      expect(parsed.isDomainSpecific).to.be.false;

      const extracted = extractUrlInfo(originalUrl);
      expect(extracted.domainBaseUrl).to.be.null;

      const converted = convertToBearerCompatibleUrl(originalUrl);
      expect(converted).to.equal('https://script.google.com/macros/s/XYZ789/dev');
    });
  });
});
