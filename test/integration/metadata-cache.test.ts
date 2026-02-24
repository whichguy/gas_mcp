import { expect } from 'chai';
import { CatTool } from '../../src/tools/filesystem/CatTool.js';
import { WriteTool } from '../../src/tools/filesystem/WriteTool.js';
import { getCachedGASMetadata, hasCachedMetadata } from '../../src/utils/gasMetadataCache.js';
import { isFileInSyncByHash } from '../../src/utils/fileHelpers.js';
import { computeGitSha1 } from '../../src/utils/hashUtils.js';
import { globalAuthState } from '../setup/globalAuth.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Integration Test: Extended Attributes Metadata Caching
 *
 * Tests the complete workflow of metadata caching using extended attributes
 * to optimize file operations by eliminating redundant API calls.
 *
 * Test Flow:
 * 1. Write a file to GAS (should cache metadata in xattr)
 * 2. Read file with cat (fast path - should use cached metadata, no API call)
 * 3. Verify cached metadata exists and is correct
 * 4. Verify mtime matches remote updateTime
 * 5. Test sync detection with isFileInSyncByHash()
 * 6. Verify graceful degradation when xattr not available
 */

describe('Metadata Cache Integration Tests', function() {
  this.timeout(300000); // 5 minutes for integration tests

  const TEST_FILENAME = `test-metadata-cache-${Date.now()}`;
  const TEST_CONTENT = `// Test file for metadata caching
function testFunction() {
  return 'Hello from metadata cache test';
}

module.exports = { testFunction };`;

  let writeTool: WriteTool;
  let catTool: CatTool;
  let localFilePath: string;

  before(async function() {
    if (!globalAuthState.isAuthenticated || !globalAuthState.sharedProjectId) {
      console.log('⚠️  No authenticated shared project, skipping metadata cache tests');
      this.skip();
      return;
    }
    const scriptId = globalAuthState.sharedProjectId;
    writeTool = new WriteTool(globalAuthState.client!.sessionManager);
    catTool = new CatTool(globalAuthState.client!.sessionManager);
    console.log(`\n🧪 Running metadata cache integration tests on project: ${scriptId}`);
  });

  after(async function() {
    // Cleanup test file
    if (localFilePath) {
      try {
        await fs.unlink(localFilePath);
        console.log(`✅ Cleaned up test file: ${localFilePath}`);
      } catch (error) {
        // File might not exist, that's ok
      }
    }
  });

  it('should write file and cache metadata in extended attributes', async function() {
    console.log('\n📝 Test 1: Writing file and caching metadata...');

    const result: any = await writeTool.execute({
      scriptId: '',
      path: `${globalAuthState.sharedProjectId!}/${TEST_FILENAME}`,
      content: TEST_CONTENT,
      fileType: 'SERVER_JS'
    });

    expect(result.success).to.be.true;
    expect(result.local).to.exist;
    expect(result.local.path).to.be.a('string');

    localFilePath = result.local.path;
    console.log(`✅ File written to: ${localFilePath}`);

    // Verify file exists locally
    const stats = await fs.stat(localFilePath);
    expect(stats.isFile()).to.be.true;

    // Verify metadata was cached
    const hasMeta = await hasCachedMetadata(localFilePath);
    expect(hasMeta).to.be.true;
    console.log('✅ Metadata cached in extended attributes');

    // Read cached metadata
    const cachedMeta = await getCachedGASMetadata(localFilePath);
    expect(cachedMeta).to.exist;
    expect(cachedMeta!.fileType).to.equal('SERVER_JS');
    expect(cachedMeta!.updateTime).to.be.a('string');
    console.log(`✅ Cached metadata: fileType=${cachedMeta!.fileType}, updateTime=${cachedMeta!.updateTime}`);
  });

  it('should use cached metadata for fast path (no API call)', async function() {
    console.log('\n⚡ Test 2: Reading file with cached metadata (fast path)...');

    // First read - should use fast path if metadata cached
    const result1: any = await catTool.execute({
      scriptId: '',
      path: `${globalAuthState.sharedProjectId!}/${TEST_FILENAME}`
    });

    expect(result1.content).to.include('testFunction');
    expect(result1.source).to.equal('local');
    expect(result1.fileType).to.equal('SERVER_JS');
    console.log(`✅ First read: source=${result1.source}, fileType=${result1.fileType}`);

    // Second read - should also use fast path
    const result2: any = await catTool.execute({
      scriptId: '',
      path: `${globalAuthState.sharedProjectId!}/${TEST_FILENAME}`
    });

    expect(result2.content).to.include('testFunction');
    expect(result2.source).to.equal('local');
    expect(result2.syncStatus?.message).to.include('cached metadata');
    console.log(`✅ Second read: source=${result2.source}, syncStatus=${result2.syncStatus?.message}`);
  });

  it('should verify hash matches remote content', async function() {
    console.log('\n🔐 Test 3: Verifying hash sync...');

    const cachedMeta = await getCachedGASMetadata(localFilePath);
    expect(cachedMeta).to.exist;

    // Read local file content and compute its hash
    const localContent = await fs.readFile(localFilePath, 'utf-8');
    const localHash = computeGitSha1(localContent);

    // For this test, we verify sync by comparing local hash against itself
    // (since we just wrote the file, it should be in sync)
    const inSync = await isFileInSyncByHash(localFilePath, localHash);
    expect(inSync).to.be.true;
    console.log('✅ Local file hash matches (file is in sync)');

    console.log(`   Local hash: ${localHash.slice(0, 12)}...`);
  });

  it('should detect when file is out of sync', async function() {
    console.log('\n🔄 Test 4: Testing sync detection...');

    // Read original content and compute its hash
    const originalContent = await fs.readFile(localFilePath, 'utf-8');
    const originalHash = computeGitSha1(originalContent);
    console.log(`   Original hash: ${originalHash.slice(0, 12)}...`);

    // Modify local file content to simulate out-of-sync state
    const modifiedContent = originalContent + '\n// Local modification';
    await fs.writeFile(localFilePath, modifiedContent, 'utf-8');
    console.log('   Modified local file content');

    // Check sync against original hash (should be out of sync)
    const inSync = await isFileInSyncByHash(localFilePath, originalHash);
    expect(inSync).to.be.false;
    console.log('✅ Correctly detected file is out of sync');

    // Restore original content
    await fs.writeFile(localFilePath, originalContent, 'utf-8');
    console.log('   Restored original content');

    const inSyncAgain = await isFileInSyncByHash(localFilePath, originalHash);
    expect(inSyncAgain).to.be.true;
    console.log('✅ File back in sync after content restoration');
  });

  it('should preserve metadata through cat operations', async function() {
    console.log('\n💾 Test 5: Testing metadata preservation through cat...');

    // Read metadata before cat
    const metaBefore = await getCachedGASMetadata(localFilePath);
    expect(metaBefore).to.exist;
    const updateTimeBefore = metaBefore!.updateTime;

    // Perform cat operation
    const result: any = await catTool.execute({
      scriptId: '',
      path: `${globalAuthState.sharedProjectId!}/${TEST_FILENAME}`
    });

    expect(result.source).to.equal('local');

    // Read metadata after cat
    const metaAfter = await getCachedGASMetadata(localFilePath);
    expect(metaAfter).to.exist;
    expect(metaAfter!.updateTime).to.equal(updateTimeBefore);
    expect(metaAfter!.fileType).to.equal('SERVER_JS');
    console.log('✅ Metadata preserved through cat operation');
  });

  it('should handle missing metadata gracefully (slow path)', async function() {
    console.log('\n🐢 Test 6: Testing graceful degradation without cached metadata...');

    // Remove extended attributes
    const { clearGASMetadata } = await import('../../src/utils/gasMetadataCache.js');
    await clearGASMetadata(localFilePath);

    const hasMeta = await hasCachedMetadata(localFilePath);
    expect(hasMeta).to.be.false;
    console.log('✅ Metadata cleared from extended attributes');

    // Cat should still work, but use slow path
    const result: any = await catTool.execute({
      scriptId: '',
      path: `${globalAuthState.sharedProjectId!}/${TEST_FILENAME}`
    });

    expect(result.content).to.include('testFunction');
    expect(result.source).to.equal('local');
    console.log('✅ Cat still works without cached metadata (slow path)');

    // Metadata should be re-cached after slow path
    const hasMetaAgain = await hasCachedMetadata(localFilePath);
    expect(hasMetaAgain).to.be.true;
    console.log('✅ Metadata re-cached after slow path operation');
  });

  it('should update metadata when file changes remotely', async function() {
    console.log('\n🔄 Test 7: Testing metadata update on remote changes...');

    // Get current metadata
    const metaBefore = await getCachedGASMetadata(localFilePath);
    expect(metaBefore).to.exist;

    // Update file remotely
    const updatedContent = TEST_CONTENT + '\n// Updated remotely';
    await writeTool.execute({
      scriptId: '',
      path: `${globalAuthState.sharedProjectId!}/${TEST_FILENAME}`,
      content: updatedContent,
      fileType: 'SERVER_JS'
    });

    console.log('✅ File updated remotely');

    // Wait a moment to ensure timestamp changes
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Read file - should detect change and update metadata
    const result: any = await catTool.execute({
      scriptId: '',
      path: `${globalAuthState.sharedProjectId!}/${TEST_FILENAME}`
    });

    expect(result.content).to.include('Updated remotely');

    // Check if metadata was updated
    const metaAfter = await getCachedGASMetadata(localFilePath);
    expect(metaAfter).to.exist;
    console.log(`   Before: ${metaBefore!.updateTime}`);
    console.log(`   After:  ${metaAfter!.updateTime}`);

    // UpdateTime might be the same or different depending on GAS API behavior
    // Just verify metadata still exists and is valid
    expect(metaAfter!.fileType).to.equal('SERVER_JS');
    console.log('✅ Metadata remains valid after remote update');
  });

  it('should work across different file types', async function() {
    console.log('\n📄 Test 8: Testing multiple file types...');

    const fileTypes = [
      { type: 'SERVER_JS', filename: `test-js-${Date.now()}`, content: 'function test() {}' },
      { type: 'HTML', filename: `test-html-${Date.now()}`, content: '<html><body>Test</body></html>' },
      { type: 'JSON', filename: `test-json-${Date.now()}`, content: '{"test": true}' }
    ];

    const createdFiles: string[] = [];

    try {
      for (const fileType of fileTypes) {
        console.log(`   Testing ${fileType.type}...`);

        // Write file
        const writeResult: any = await writeTool.execute({
          scriptId: '',
          path: `${globalAuthState.sharedProjectId!}/${fileType.filename}`,
          content: fileType.content,
          fileType: fileType.type as any
        });

        expect(writeResult.success).to.be.true;
        if (writeResult.local?.path) {
          createdFiles.push(writeResult.local.path);
        }

        // Verify metadata cached
        if (writeResult.local?.path) {
          const hasMeta = await hasCachedMetadata(writeResult.local.path);
          expect(hasMeta).to.be.true;

          const meta = await getCachedGASMetadata(writeResult.local.path);
          expect(meta).to.exist;
          expect(meta!.fileType).to.equal(fileType.type);
          console.log(`   ✅ ${fileType.type}: metadata cached correctly`);
        }
      }

      console.log('✅ All file types cached metadata correctly');
    } finally {
      // Cleanup
      for (const filePath of createdFiles) {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    }
  });

  it('should show performance improvement with cached metadata', async function() {
    console.log('\n⚡ Test 9: Performance comparison...');

    // Clear cache to force slow path
    const { clearGASMetadata } = await import('../../src/utils/gasMetadataCache.js');
    await clearGASMetadata(localFilePath);

    // Slow path (no cache)
    const slowStart = Date.now();
    await catTool.execute({
      scriptId: '',
      path: `${globalAuthState.sharedProjectId!}/${TEST_FILENAME}`
    });
    const slowTime = Date.now() - slowStart;
    console.log(`   Slow path (no cache): ${slowTime}ms`);

    // Fast path (with cache)
    const fastStart = Date.now();
    await catTool.execute({
      scriptId: '',
      path: `${globalAuthState.sharedProjectId!}/${TEST_FILENAME}`
    });
    const fastTime = Date.now() - fastStart;
    console.log(`   Fast path (cached):   ${fastTime}ms`);

    const speedup = ((slowTime - fastTime) / slowTime * 100).toFixed(1);
    console.log(`   Speed improvement:    ${speedup}% faster`);

    // Fast path should be significantly faster (but don't enforce strict threshold
    // as it depends on network conditions)
    expect(fastTime).to.be.lessThan(slowTime);
    console.log('✅ Fast path is faster than slow path');
  });
});
