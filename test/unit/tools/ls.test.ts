import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { stub, restore } from 'sinon';
import { createHash } from 'crypto';
import { LsTool } from '../../../src/tools/filesystem/LsTool.js';
import { SessionAuthManager } from '../../../src/auth/sessionManager.js';

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
      expect(lsTool.description).to.include('List files');
      expect(lsTool.description).to.include('Google Apps Script');
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

      // Access private method for testing
      const actual = (lsTool as any).computeGitSha1(content);

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

      const actual = (lsTool as any).computeGitSha1(content);

      expect(actual).to.equal(expected);
      expect(actual).to.equal('30d74d258442c7c65512eafab474568dd706c430');
    });

    it('should handle empty content', () => {
      // Empty file has known Git SHA-1
      const content = '';
      const expected = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'; // Git SHA-1 for empty file

      const actual = (lsTool as any).computeGitSha1(content);

      expect(actual).to.equal(expected);
    });

    it('should handle multi-line content', () => {
      const content = 'function test() {\n  return 42;\n}\n';

      // Verify it computes a valid SHA-1 hash
      const actual = (lsTool as any).computeGitSha1(content);

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

      const actual = (lsTool as any).computeGitSha1(content);

      expect(actual).to.equal(expected);
      expect(actual).to.be.a('string');
      expect(actual).to.have.lengthOf(40);
    });
  });

  describe('checksums parameter behavior', () => {
    beforeEach(() => {
      // Mock getAuthToken to bypass authentication
      stub(lsTool as any, 'getAuthToken').resolves('mock-token');

      // Mock gasClient.getProjectContent to return sample files
      stub((lsTool as any).gasClient, 'getProjectContent').resolves([
        {
          name: 'test1.gs',
          type: 'SERVER_JS',
          source: 'function test1() { return 1; }',
          createTime: '2024-01-01T00:00:00Z',
          updateTime: '2024-01-02T00:00:00Z'
        },
        {
          name: 'test2.gs',
          type: 'SERVER_JS',
          source: 'function test2() { return 2; }',
          createTime: '2024-01-01T00:00:00Z',
          updateTime: '2024-01-02T00:00:00Z'
        }
      ]);
    });

    it('should not include checksums by default', async () => {
      const result: any = await lsTool.execute({
        scriptId: 'test-script-id-12345678901234567890123456789012',
        path: '',
        detailed: true
      });

      expect(result.items).to.be.an('array');
      expect(result.items[0]).to.not.have.property('gitSha1');
    });

    it('should include checksums when explicitly enabled', async () => {
      const result: any = await lsTool.execute({
        scriptId: 'test-script-id-12345678901234567890123456789012',
        path: '',
        checksums: true
      });

      expect(result.items).to.be.an('array');
      expect(result.items).to.have.lengthOf(2);

      // Verify each file has gitSha1
      result.items.forEach((item: any) => {
        expect(item).to.have.property('gitSha1');
        expect(item.gitSha1).to.be.a('string');
        expect(item.gitSha1).to.have.lengthOf(40);
        expect(item.gitSha1).to.match(/^[0-9a-f]{40}$/);
      });
    });

    it('should compute correct checksums for file content', async () => {
      const result: any = await lsTool.execute({
        scriptId: 'test-script-id-12345678901234567890123456789012',
        path: '',
        checksums: true
      });

      expect(result.items).to.have.lengthOf(2);

      // Manually compute expected SHA-1 for first file
      const content1 = 'function test1() { return 1; }';
      const size1 = Buffer.byteLength(content1, 'utf8');
      const header1 = `blob ${size1}\0`;
      const expected1 = createHash('sha1')
        .update(header1)
        .update(content1, 'utf8')
        .digest('hex');

      expect(result.items[0].gitSha1).to.equal(expected1);
    });

    it('should work with detailed=true and checksums=true', async () => {
      const result: any = await lsTool.execute({
        scriptId: 'test-script-id-12345678901234567890123456789012',
        path: '',
        detailed: true,
        checksums: true
      });

      expect(result.items).to.have.lengthOf(2);

      result.items.forEach((item: any) => {
        // Should have both detailed fields and checksums
        expect(item).to.have.property('size');
        expect(item).to.have.property('createTime');
        expect(item).to.have.property('updateTime');
        expect(item).to.have.property('gitSha1');
        expect(item.gitSha1).to.be.a('string');
        expect(item.gitSha1).to.have.lengthOf(40);
      });
    });

    it('should handle checksums=false explicitly', async () => {
      const result: any = await lsTool.execute({
        scriptId: 'test-script-id-12345678901234567890123456789012',
        path: '',
        checksums: false
      });

      expect(result.items).to.be.an('array');
      expect(result.items[0]).to.not.have.property('gitSha1');
    });
  });

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
