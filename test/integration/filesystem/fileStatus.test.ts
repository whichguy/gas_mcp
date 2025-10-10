import { expect } from 'chai';
import { describe, it, before, after, beforeEach } from 'mocha';
import { createHash } from 'crypto';
import { MCPTestClient, AuthTestHelper, GASTestHelper } from '../../helpers/mcpClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';

describe('MCP Server File Status and Checksum Integration', () => {
  let client: MCPTestClient;
  let auth: AuthTestHelper;
  let gas: GASTestHelper;
  let testProjectId: string | null = null;

  before(function() {
    // Use the shared global client and auth helper to maintain sessionId
    if (!globalAuthState.client || !globalAuthState.auth) {
      this.skip(); // Skip if global client/auth not available
    }
    client = globalAuthState.client!;
    auth = globalAuthState.auth!;  // Reuse global auth with sessionId
    gas = new GASTestHelper(client);
    console.log('🔗 Using shared global MCP client and auth session for file status tests');
  });

  after(async () => {
    // Cleanup test project if created
    if (testProjectId) {
      try {
        await gas.cleanupTestProject(testProjectId);
      } catch (error) {
        console.warn('Failed to cleanup test project:', error);
      }
    }
  });

  /**
   * Helper function to compute Git-compatible SHA-1 checksum
   * This matches the implementation in LsTool and FileStatusTool
   */
  function computeGitSha1(content: string): string {
    const size = Buffer.byteLength(content, 'utf8');
    const header = `blob ${size}\0`;
    return createHash('sha1')
      .update(header)
      .update(content, 'utf8')
      .digest('hex');
  }

  describe('Tool Availability', () => {
    it('should have ls tool with checksums parameter', async () => {
      const tools = await client.listTools();
      const lsTool = tools.find(tool => tool.name === 'ls');

      expect(lsTool).to.exist;
      expect(lsTool?.inputSchema?.properties?.checksums).to.exist;
      const checksumsSchema = lsTool?.inputSchema?.properties?.checksums as any;
      expect(checksumsSchema?.type).to.equal('boolean');
      expect(checksumsSchema?.default).to.equal(false);

      console.log('✅ ls tool available with checksums parameter');
    });

    it('should have file_status tool', async () => {
      const tools = await client.listTools();
      const fileStatusTool = tools.find(tool => tool.name === 'file_status');

      expect(fileStatusTool).to.exist;
      expect(fileStatusTool?.inputSchema?.properties?.path).to.exist;
      expect(fileStatusTool?.inputSchema?.properties?.hashTypes).to.exist;
      expect(fileStatusTool?.inputSchema?.properties?.includeMetadata).to.exist;

      console.log('✅ file_status tool available with comprehensive features');
    });
  });

  describe('LS Tool Checksums Feature', () => {
    before(async function() {
      this.timeout(120000);

      const authStatus = await auth.getAuthStatus();
      if (!authStatus.authenticated) {
        console.log('⚠️  Skipping authenticated ls checksum tests - no authentication');
        this.skip();
      }

      // Create test project if needed
      if (!testProjectId) {
        const projectName = `File Status Test ${Date.now()}`;
        const result = await gas.createTestProject(projectName);
        testProjectId = result.scriptId;
        console.log(`Created test project: ${testProjectId}`);

        // Upload test files with known content
        await gas.writeTestFile(testProjectId!, 'test1.gs', 'function test1() { return 1; }');
        await gas.writeTestFile(testProjectId!, 'test2.gs', 'function test2() { return 2; }');
        console.log('✅ Uploaded test files');
      }
    });

    it('should not include checksums by default', async function() {
      this.timeout(15000);

      const result: any = await client.callTool('ls', {
        scriptId: testProjectId,
        path: '',
        detailed: true
      });

      expect(result.items).to.be.an('array');
      expect(result.items.length).to.be.greaterThan(0);

      // Verify gitSha1 is NOT included by default
      const hasGitSha1 = result.items.some((item: any) => item.gitSha1);
      expect(hasGitSha1).to.be.false;

      console.log('✅ ls without checksums flag does not include gitSha1');
    });

    it('should include Git SHA-1 checksums when enabled', async function() {
      this.timeout(15000);

      const result: any = await client.callTool('ls', {
        scriptId: testProjectId,
        path: '',
        checksums: true
      });

      expect(result.items).to.be.an('array');
      expect(result.items.length).to.be.greaterThan(0);

      // Verify all files have gitSha1
      result.items.forEach((item: any) => {
        expect(item).to.have.property('gitSha1');
        expect(item.gitSha1).to.be.a('string');
        expect(item.gitSha1).to.have.lengthOf(40); // SHA-1 is 40 hex characters
        expect(item.gitSha1).to.match(/^[0-9a-f]{40}$/); // Hex string
      });

      console.log(`✅ ls with checksums=true includes gitSha1 for ${result.items.length} files`);
    });

    it('should compute correct Git-compatible SHA-1', async function() {
      this.timeout(15000);

      // Get file list with checksums
      const lsResult: any = await client.callTool('ls', {
        scriptId: testProjectId,
        path: '',
        checksums: true
      });

      // Find test1.gs
      const test1File = lsResult.items.find((item: any) => item.name === 'test1.gs');
      expect(test1File).to.exist;
      expect(test1File.gitSha1).to.exist;

      // Read the actual content
      const catResult: any = await client.callTool('cat', {
        scriptId: testProjectId,
        path: 'test1.gs'
      });

      const content = catResult.content;

      // Compute expected Git SHA-1
      const expectedSha1 = computeGitSha1(content);

      // Verify they match
      expect(test1File.gitSha1).to.equal(expectedSha1);

      console.log(`✅ Git SHA-1 matches for test1.gs: ${test1File.gitSha1.substring(0, 8)}...`);
    });

    it('should work with detailed flag and checksums together', async function() {
      this.timeout(15000);

      const result: any = await client.callTool('ls', {
        scriptId: testProjectId,
        path: '',
        detailed: true,
        checksums: true
      });

      expect(result.items).to.be.an('array');
      expect(result.items.length).to.be.greaterThan(0);

      result.items.forEach((item: any) => {
        // Should have detailed fields
        expect(item).to.have.property('size');
        expect(item).to.have.property('createTime');
        expect(item).to.have.property('updateTime');

        // Should also have checksums
        expect(item).to.have.property('gitSha1');
        expect(item.gitSha1).to.be.a('string');
        expect(item.gitSha1).to.have.lengthOf(40);
      });

      console.log('✅ ls with detailed=true and checksums=true works correctly');
    });
  });

  describe('File Status Tool', () => {
    before(async function() {
      this.timeout(120000);

      const authStatus = await auth.getAuthStatus();
      if (!authStatus.authenticated) {
        console.log('⚠️  Skipping authenticated file_status tests - no authentication');
        this.skip();
      }

      // Use existing test project or create one
      if (!testProjectId) {
        const projectName = `File Status Test ${Date.now()}`;
        const result = await gas.createTestProject(projectName);
        testProjectId = result.scriptId;
        console.log(`Created test project: ${testProjectId}`);
      }

      // Upload test files with known content
      await gas.writeTestFile(testProjectId!, 'utils/helper.gs', 'function helper() { return "help"; }');
      await gas.writeTestFile(testProjectId!, 'utils/formatter.gs', 'function format(text) { return text.toUpperCase(); }');
      await gas.writeTestFile(testProjectId!, 'main.gs', 'function main() { return helper(); }');
      console.log('✅ Uploaded test files for file_status tests');
    });

    it('should get status for single file with default hash', async function() {
      this.timeout(15000);

      const result: any = await client.callTool('file_status', {
        scriptId: testProjectId,
        path: 'main.gs'
      });

      expect(result).to.have.property('status', 'success');
      expect(result).to.have.property('files');
      expect(result.files).to.be.an('array');
      expect(result.files).to.have.lengthOf(1);

      const fileStatus = result.files[0];
      expect(fileStatus).to.have.property('name', 'main.gs');
      expect(fileStatus).to.have.property('type');
      expect(fileStatus).to.have.property('hashes');
      expect(fileStatus.hashes).to.have.property('git-sha1');
      expect(fileStatus.hashes['git-sha1']).to.match(/^[0-9a-f]{40}$/);

      console.log(`✅ file_status for single file: ${fileStatus.name} with git-sha1: ${fileStatus.hashes['git-sha1'].substring(0, 8)}...`);
    });

    it('should support wildcard pattern matching', async function() {
      this.timeout(15000);

      const result: any = await client.callTool('file_status', {
        scriptId: testProjectId,
        path: 'utils/*'
      });

      expect(result).to.have.property('status', 'success');
      expect(result).to.have.property('isPattern', true);
      expect(result).to.have.property('files');
      expect(result.files).to.be.an('array');
      expect(result.files.length).to.be.greaterThan(1);

      // Verify all matched files are in utils/
      result.files.forEach((file: any) => {
        expect(file.name).to.match(/^utils\//);
        expect(file.hashes).to.have.property('git-sha1');
      });

      console.log(`✅ file_status with wildcard matched ${result.files.length} files in utils/`);
    });

    it('should compute multiple hash types', async function() {
      this.timeout(15000);

      const result: any = await client.callTool('file_status', {
        scriptId: testProjectId,
        path: 'main.gs',
        hashTypes: ['git-sha1', 'sha256', 'md5']
      });

      expect(result).to.have.property('status', 'success');
      expect(result.files).to.have.lengthOf(1);

      const fileStatus = result.files[0];
      expect(fileStatus.hashes).to.have.property('git-sha1');
      expect(fileStatus.hashes).to.have.property('sha256');
      expect(fileStatus.hashes).to.have.property('md5');

      // Verify hash formats
      expect(fileStatus.hashes['git-sha1']).to.match(/^[0-9a-f]{40}$/); // 40 chars
      expect(fileStatus.hashes['sha256']).to.match(/^[0-9a-f]{64}$/); // 64 chars
      expect(fileStatus.hashes['md5']).to.match(/^[0-9a-f]{32}$/); // 32 chars

      console.log(`✅ file_status computed multiple hashes:`);
      console.log(`   git-sha1: ${fileStatus.hashes['git-sha1'].substring(0, 8)}...`);
      console.log(`   sha256:   ${fileStatus.hashes['sha256'].substring(0, 8)}...`);
      console.log(`   md5:      ${fileStatus.hashes['md5'].substring(0, 8)}...`);
    });

    it('should include rich metadata by default', async function() {
      this.timeout(15000);

      const result: any = await client.callTool('file_status', {
        scriptId: testProjectId,
        path: 'main.gs'
      });

      expect(result.files).to.have.lengthOf(1);

      const fileStatus = result.files[0];
      expect(fileStatus).to.have.property('metadata');
      expect(fileStatus.metadata).to.have.property('size');
      expect(fileStatus.metadata).to.have.property('lines');
      expect(fileStatus.metadata).to.have.property('encoding', 'UTF-8');

      expect(fileStatus.metadata.size).to.be.a('number');
      expect(fileStatus.metadata.lines).to.be.a('number');

      console.log(`✅ file_status includes metadata: ${fileStatus.metadata.size} bytes, ${fileStatus.metadata.lines} lines`);
    });

    it('should optionally exclude metadata', async function() {
      this.timeout(15000);

      const result: any = await client.callTool('file_status', {
        scriptId: testProjectId,
        path: 'main.gs',
        includeMetadata: false
      });

      expect(result.files).to.have.lengthOf(1);

      const fileStatus = result.files[0];
      expect(fileStatus).to.not.have.property('metadata');
      expect(fileStatus).to.have.property('hashes');

      console.log('✅ file_status without metadata works correctly');
    });

    it('should respect maxFiles limit', async function() {
      this.timeout(15000);

      const result: any = await client.callTool('file_status', {
        scriptId: testProjectId,
        path: '*',
        maxFiles: 2
      });

      expect(result).to.have.property('files');
      expect(result.files.length).to.be.at.most(2);
      expect(result).to.have.property('matchedFiles');

      console.log(`✅ file_status respects maxFiles limit: ${result.files.length} files returned`);
    });

    it('should verify Git SHA-1 matches manual calculation', async function() {
      this.timeout(15000);

      // Get file status with Git SHA-1
      const statusResult: any = await client.callTool('file_status', {
        scriptId: testProjectId,
        path: 'main.gs'
      });

      const gitSha1FromTool = statusResult.files[0].hashes['git-sha1'];

      // Read file content
      const catResult: any = await client.callTool('cat', {
        scriptId: testProjectId,
        path: 'main.gs'
      });

      // Manually compute Git SHA-1
      const expectedGitSha1 = computeGitSha1(catResult.content);

      // Verify they match
      expect(gitSha1FromTool).to.equal(expectedGitSha1);

      console.log(`✅ Git SHA-1 verified: ${gitSha1FromTool.substring(0, 16)}...`);
    });

    it('should handle known test content with expected SHA-1', async function() {
      this.timeout(15000);

      // Upload file with known content
      const knownContent = 'test';
      const knownSha1 = '9daeafb9864cf43055ae93beb0afd6c7d144bfa4'; // Known Git SHA-1 for "test"

      await gas.writeTestFile(testProjectId!, 'known.gs', knownContent);

      // Get file status
      const result: any = await client.callTool('file_status', {
        scriptId: testProjectId,
        path: 'known.gs'
      });

      const gitSha1 = result.files[0].hashes['git-sha1'];

      // Verify against known SHA-1
      expect(gitSha1).to.equal(knownSha1);

      console.log(`✅ Known content "test" has expected SHA-1: ${gitSha1}`);
    });
  });

  describe('Git Integration Scenarios', () => {
    before(async function() {
      const authStatus = await auth.getAuthStatus();
      if (!authStatus.authenticated) {
        console.log('⚠️  Skipping Git integration scenarios - no authentication');
        this.skip();
      }
    });

    it('should detect file changes using checksums', async function() {
      this.timeout(20000);

      const filename = `change_detect_${Date.now()}.gs`;
      const originalContent = 'function original() { return 1; }';
      const modifiedContent = 'function modified() { return 2; }';

      // Upload original file
      await gas.writeTestFile(testProjectId!, filename, originalContent);

      // Get initial checksum
      const initialResult: any = await client.callTool('file_status', {
        scriptId: testProjectId,
        path: filename
      });
      const initialSha1 = initialResult.files[0].hashes['git-sha1'];

      // Modify file
      await gas.writeTestFile(testProjectId!, filename, modifiedContent);

      // Get new checksum
      const modifiedResult: any = await client.callTool('file_status', {
        scriptId: testProjectId,
        path: filename
      });
      const modifiedSha1 = modifiedResult.files[0].hashes['git-sha1'];

      // Verify checksums are different
      expect(initialSha1).to.not.equal(modifiedSha1);

      console.log(`✅ Change detection works:`);
      console.log(`   Original:  ${initialSha1.substring(0, 8)}...`);
      console.log(`   Modified:  ${modifiedSha1.substring(0, 8)}...`);
    });

    it('should verify identical content has same checksum', async function() {
      this.timeout(20000);

      const content = 'function identical() { return "same"; }';
      const file1 = `identical1_${Date.now()}.gs`;
      const file2 = `identical2_${Date.now()}.gs`;

      // Upload same content to two different files
      await gas.writeTestFile(testProjectId!, file1, content);
      await gas.writeTestFile(testProjectId!, file2, content);

      // Get checksums for both
      const result: any = await client.callTool('file_status', {
        scriptId: testProjectId,
        path: `identical*`
      });

      expect(result.files).to.have.lengthOf(2);

      const sha1_file1 = result.files.find((f: any) => f.name === file1).hashes['git-sha1'];
      const sha1_file2 = result.files.find((f: any) => f.name === file2).hashes['git-sha1'];

      // Verify they have the same checksum
      expect(sha1_file1).to.equal(sha1_file2);

      console.log(`✅ Identical content has same checksum: ${sha1_file1.substring(0, 8)}...`);
    });
  });

  describe('Performance and Limits', () => {
    before(async function() {
      const authStatus = await auth.getAuthStatus();
      if (!authStatus.authenticated) {
        console.log('⚠️  Skipping performance tests - no authentication');
        this.skip();
      }
    });

    it('should handle wildcards efficiently', async function() {
      this.timeout(30000);

      const start = Date.now();

      const result: any = await client.callTool('file_status', {
        scriptId: testProjectId,
        path: '*'
      });

      const duration = Date.now() - start;

      expect(result).to.have.property('files');
      expect(result.files.length).to.be.greaterThan(0);

      console.log(`✅ Wildcard file_status processed ${result.files.length} files in ${duration}ms`);
    });

    it('should handle maxFiles parameter correctly', async function() {
      this.timeout(15000);

      // Test with maxFiles=1
      const result1: any = await client.callTool('file_status', {
        scriptId: testProjectId,
        path: '*',
        maxFiles: 1
      });

      expect(result1.files).to.have.lengthOf(1);
      expect(result1.matchedFiles).to.equal(1);

      // Test with maxFiles=3
      const result3: any = await client.callTool('file_status', {
        scriptId: testProjectId,
        path: '*',
        maxFiles: 3
      });

      expect(result3.files.length).to.be.at.most(3);

      console.log(`✅ maxFiles parameter works: 1 file, then ${result3.files.length} files`);
    });
  });
});
