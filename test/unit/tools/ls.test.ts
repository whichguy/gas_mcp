import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { stub, restore } from 'sinon';
import { createHash } from 'crypto';
import { LsTool } from '../../../src/tools/filesystem/LsTool.js';
import { SessionAuthManager } from '../../../src/auth/sessionManager.js';
import { computeGitSha1 } from '../../../src/utils/hashUtils.js';

describe('LsTool', () => {
  let lsTool: LsTool;
  let sessionAuthManager: SessionAuthManager;

  beforeEach(function() {
    // Set test mode to prevent OAuth server conflicts
    process.env.MCP_TEST_MODE = 'true';

    // Use a shared session manager to reuse cached tokens
    // This prevents repeated OAuth prompts across unit tests
    sessionAuthManager = new SessionAuthManager();
    lsTool = new LsTool(sessionAuthManager);
  });

  afterEach(() => {
    restore();
    delete process.env.MCP_TEST_MODE;
  });

  describe('tool properties', () => {
    it('should have correct name', () => {
      expect(lsTool.name).to.equal('ls');
    });

    it('should have description', () => {
      expect(lsTool.description).to.include('List project files');
      expect(lsTool.description).to.include('[FILE:LIST]');
    });

    it('should have correct input schema with checksums parameter', () => {
      const schema = lsTool.inputSchema as any;

      expect(schema.type).to.equal('object');
      expect(schema.properties.scriptId).to.exist;
      expect(schema.properties.path).to.exist;
      expect(schema.properties.detailed).to.exist;
      expect(schema.properties.checksums).to.exist;

      // Verify checksums parameter details
      expect(schema.properties.checksums.type).to.equal('boolean');
      expect(schema.properties.checksums.default).to.equal(false);
      expect(schema.properties.checksums.description).to.include('Git-compatible SHA-1');
      expect(schema.properties.checksums.description).to.include('git hash-object');
    });
  });

  describe('Git SHA-1 checksum computation', () => {
    it('should compute correct Git-compatible SHA-1', () => {
      // Test with simple content
      const content = 'Hello World\n';

      // Compute expected Git SHA-1
      const size = Buffer.byteLength(content, 'utf8');
      const header = `blob ${size}\0`;
      const expected = createHash('sha1')
        .update(header)
        .update(content, 'utf8')
        .digest('hex');

      // Use the centralized hash utility function
      const actual = computeGitSha1(content);

      expect(actual).to.equal(expected);
      expect(actual).to.be.a('string');
      expect(actual).to.have.lengthOf(40); // SHA-1 is 40 hex characters
    });

    it('should match git hash-object for sample content', () => {
      // Known test case: echo -n "test" | git hash-object --stdin
      // Git SHA-1 for "test" = 30d74d258442c7c65512eafab474568dd706c430
      const content = 'test';

      const size = Buffer.byteLength(content, 'utf8');
      const header = `blob ${size}\0`;
      const expected = createHash('sha1')
        .update(header)
        .update(content, 'utf8')
        .digest('hex');

      const actual = computeGitSha1(content);

      expect(actual).to.equal(expected);
      expect(actual).to.equal('30d74d258442c7c65512eafab474568dd706c430');
    });

    it('should handle empty content', () => {
      // Empty file has known Git SHA-1
      const content = '';
      const expected = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'; // Git SHA-1 for empty file

      const actual = computeGitSha1(content);

      expect(actual).to.equal(expected);
    });

    it('should handle multi-line content', () => {
      const content = 'function test() {\n  return 42;\n}\n';

      // Verify it computes a valid SHA-1 hash
      const actual = computeGitSha1(content);

      expect(actual).to.be.a('string');
      expect(actual).to.have.lengthOf(40);
      expect(actual).to.match(/^[0-9a-f]{40}$/); // Hex string
    });

    it('should handle Unicode content', () => {
      const content = 'Hello 世界 🌍\n';

      // Compute with proper UTF-8 encoding
      const size = Buffer.byteLength(content, 'utf8');
      const header = `blob ${size}\0`;
      const expected = createHash('sha1')
        .update(header)
        .update(content, 'utf8')
        .digest('hex');

      const actual = computeGitSha1(content);

      expect(actual).to.equal(expected);
      expect(actual).to.be.a('string');
      expect(actual).to.have.lengthOf(40);
    });
  });

  /*
   * =========================================================================
   * INTEGRATION TEST COVERAGE NOTE
   * =========================================================================
   * The following LsTool behaviors require real GAS API responses and are
   * tested via integration tests, not unit tests:
   *
   * CHECKSUMS PARAMETER:
   * - checksums=false (default) excludes gitSha1 from response
   * - checksums=true includes Git-compatible SHA-1 for each file
   * - Hash computation uses WRAPPED content (full file as stored in GAS)
   * - Verified in: test/integration/filesystem/fileStatus.test.ts
   *
   * POSITION FIELD PRESERVATION:
   * - Original API position values are preserved (not re-indexed after filtering)
   * - Wildcard/directory filtering maintains original execution order positions
   * - Undefined positions fallback to 0
   * - Verified in: test/integration/filesystem/ls-operations.test.ts
   *
   * WHY NOT UNIT TESTS:
   * LsTool creates its own GASClient internally. Stubbing lsTool.gasClient
   * doesn't intercept the actual instance used in execute(). Proper unit
   * testing would require dependency injection refactoring.
   *
   * UNIT TESTS HERE VERIFY:
   * - Tool properties (name, description, input schema)
   * - Git SHA-1 computation algorithm (via computeGitSha1 utility)
   * - Schema documentation (llmGuidance)
   *
   * INTEGRATION TESTS VERIFY:
   * - Full execute() behavior with real API responses
   * - Checksums parameter end-to-end
   * - Position field preservation through filtering
   * =========================================================================
   */

  describe('llmGuidance documentation', () => {
    it('should have checksums examples in llmGuidance', () => {
      const schema = lsTool.inputSchema as any;

      expect(schema.llmGuidance).to.exist;
      expect(schema.llmGuidance.examples).to.be.an('array');

      // Check for checksum-related examples
      const hasChecksumExample = schema.llmGuidance.examples.some((ex: string) =>
        ex.includes('checksums'));

      expect(hasChecksumExample).to.be.true;
    });

    it('should have checksums section in llmGuidance', () => {
      const schema = lsTool.inputSchema as any;

      expect(schema.llmGuidance.checksums).to.exist;
      expect(schema.llmGuidance.checksums.whenToUse).to.include('verify file integrity');
      expect(schema.llmGuidance.checksums.format).to.include('Git-compatible');
      expect(schema.llmGuidance.checksums.verification).to.include('git hash-object');
    });
  });
});
