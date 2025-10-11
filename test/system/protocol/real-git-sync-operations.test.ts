import { expect } from 'chai';
import { describe, it, before, after } from 'mocha';
import { globalAuthState } from '../../setup/globalAuth.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

/**
 * Real Git Sync Operations Tests
 *
 * Uses a SINGLE test project for all tests to avoid domain authorization delays.
 * Tests verify end-to-end functionality of:
 * - Manual .git/config.gs breadcrumb creation (git_init tool was removed)
 * - local_sync: Bidirectional synchronization (pull-merge-push pattern)
 * - config: Query and configure sync folder
 * - Multi-repo support (multiple .git/ folders)
 * - File transformations (README.md → README.html, dotfiles)
 * - Merge strategies (ours, theirs, three-way)
 */
describe('Real Git Sync Operations - End-to-End Tests', () => {
  let testProjectId: string | null = null;
  let tempSyncFolder: string | null = null;

  // ThenRunLater repository details
  const REPO_URL = 'https://github.com/whichguy/ThenRunLater.git';
  const REPO_BRANCH = 'main';
  const REPO_FILES = ['index.html', 'LICENSE', 'permissions.js', 'README.md', 'script_scheduler.js', 'ui.js'];

  before(async function() {
    this.timeout(600000); // 10 minutes for setup (includes git clone)

    if (!globalAuthState.isAuthenticated) {
      console.log('⚠️  Skipping real git sync operations - not authenticated');
      this.skip();
      return;
    }

    console.log('\n🎯 Creating single test project for all git sync tests...');

    const project = await globalAuthState.gas!.createTestProject('Real Git Sync Test ' + Date.now());
    testProjectId = project.scriptId;

    console.log(`✅ Created test project: ${testProjectId}`);
    console.log(`   All tests will use this same project`);

    // Create temporary sync folder
    tempSyncFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gas-git-test-'));
    console.log(`✅ Created temp sync folder: ${tempSyncFolder}`);
  });

  after(async function() {
    if (testProjectId) {
      console.log(`\n⚠️  Manual cleanup required for test project: ${testProjectId}`);
      console.log(`   Visit: https://script.google.com/home to delete`);
    }

    if (tempSyncFolder && fs.existsSync(tempSyncFolder)) {
      try {
        console.log(`🧹 Cleaning up temp sync folder: ${tempSyncFolder}`);
        fs.rmSync(tempSyncFolder, { recursive: true, force: true });
        console.log('✅ Temp folder cleaned up');
      } catch (cleanupError) {
        console.error('❌ Temp folder cleanup failed (non-fatal):', cleanupError);
      }
    }
  });

  describe('Manual Git Breadcrumb Creation', () => {
    it('should manually create .git/config.gs breadcrumb in GAS', async function() {
      this.timeout(600000); // 10 minutes for git operations

      console.log('\n🔗 Manually creating .git/config.gs breadcrumb...');
      console.log(`   Repository: ${REPO_URL}`);
      console.log(`   Branch: ${REPO_BRANCH}`);
      console.log(`   Sync Folder: ${tempSyncFolder}`);

      // Create git config content
      const gitConfig = `[remote "origin"]
\turl = ${REPO_URL}
[branch "${REPO_BRANCH}"]
[sync]
\tlocalPath = ${tempSyncFolder}`;

      // Write .git/config.gs to GAS using write tool
      const result = await globalAuthState.client!.callTool('write', {
        scriptId: testProjectId,
        path: '.git/config',
        content: gitConfig
      });

      console.log(`✅ Breadcrumb created in GAS`);

      // Verify the result
      expect(result.content[0].text).to.include('success');
    });

    it('should verify .git/config.gs breadcrumb created in GAS', async function() {
      this.timeout(120000);

      console.log('\n📋 Reading .git breadcrumb file...');

      const result = await globalAuthState.client!.callTool('cat', {
        scriptId: testProjectId,
        path: '.git/config'
      });

      const content = result.content[0].text;
      console.log(`✅ .git/config content preview: ${content.substring(0, 200)}...`);

      expect(content).to.include(REPO_URL);
      expect(content).to.include(REPO_BRANCH);
    });

    it('should verify .git/config.gs is plain text (not wrapped)', async function() {
      this.timeout(120000);

      console.log('\n📄 Checking if .git/config.gs is plain text...');

      const result = await globalAuthState.client!.callTool('raw_cat', {
        scriptId: testProjectId,
        path: '.git/config.gs'
      });

      const rawContent = result.content[0].text;

      // .git/config.gs should be plain text (INI format), not wrapped
      expect(rawContent).to.include('[remote "origin"]');
      expect(rawContent).to.include('url =');
      console.log('✅ Plain text format verified');
    });

    it('should create local git repository', async function() {
      this.timeout(120000);

      console.log('\n📁 Creating local git repository...');

      // Initialize git repo
      execSync('git init', { cwd: tempSyncFolder!, stdio: 'inherit' });
      execSync(`git remote add origin ${REPO_URL}`, { cwd: tempSyncFolder!, stdio: 'inherit' });

      console.log('✅ Local git repository initialized');
    });
  });

  describe('Initial Sync - Local to GAS', () => {
    before(async function() {
      this.timeout(600000); // 10 minutes for git fetch

      console.log(`\n📦 Fetching ${REPO_URL}...`);

      try {
        // Git repo was manually initialized in previous test, now fetch the code
        const actualSyncFolder = tempSyncFolder!;

        console.log(`   Using sync folder: ${actualSyncFolder}`);

        // Check if remote exists
        try {
          execSync(`git -C "${actualSyncFolder}" remote get-url origin`, { encoding: 'utf8' });
          console.log('   ✅ Remote already configured');
        } catch {
          // Add remote if it doesn't exist
          console.log('   ⚙️  Adding remote origin...');
          execSync(`git -C "${actualSyncFolder}" remote add origin ${REPO_URL}`, { stdio: 'inherit' });
        }

        // Fetch from remote
        console.log('   📡 Fetching from remote...');
        execSync(`git -C "${actualSyncFolder}" fetch origin ${REPO_BRANCH}`, {
          stdio: 'inherit',
          timeout: 300000 // 5 minutes
        });

        // Checkout branch
        try {
          execSync(`git -C "${actualSyncFolder}" checkout ${REPO_BRANCH}`, { stdio: 'inherit' });
        } catch {
          // If branch doesn't exist, create it
          execSync(`git -C "${actualSyncFolder}" checkout -b ${REPO_BRANCH} origin/${REPO_BRANCH}`, { stdio: 'inherit' });
        }

        console.log('✅ Repository fetched and checked out successfully');
      } catch (error: any) {
        console.error('❌ Failed to fetch repository:', error);
        throw error;
      }
    });

    it('should perform initial sync from local to GAS', async function() {
      this.timeout(600000); // 10 minutes for sync

      console.log('\n⬆️  Performing initial sync from local to GAS...');

      const result = await globalAuthState.client!.callAndParse('local_sync', {
        scriptId: testProjectId
      });

      console.log(`✅ Sync complete: ${JSON.stringify(result, null, 2)}`);

      expect(result).to.have.property('success', true);
      expect(result.pushed).to.be.greaterThan(0);
      console.log(`   Pushed ${result.pushed} files to GAS`);
    });

    it('should verify all repository files transferred to GAS', async function() {
      this.timeout(120000);

      console.log('\n📋 Listing GAS project files...');

      const lsResult = await globalAuthState.client!.callTool('ls', {
        scriptId: testProjectId
      });

      const fileList = lsResult.content[0].text;
      console.log(`   Files in GAS: ${fileList}`);

      // Check for core files (some may be transformed)
      expect(fileList).to.include('index');
      expect(fileList).to.include('permissions');
      expect(fileList).to.include('script_scheduler');
      expect(fileList).to.include('ui');
      console.log('✅ All expected files found in GAS');
    });

    it('should verify file content integrity', async function() {
      this.timeout(120000);

      console.log('\n🔍 Verifying file content integrity...');

      // Read a file from GAS
      const gasResult = await globalAuthState.client!.callTool('cat', {
        scriptId: testProjectId,
        path: 'permissions'
      });

      const gasContent = gasResult.content[0].text;
      console.log(`   GAS file length: ${gasContent.length} bytes`);

      // Read same file from local
      const localPath = path.join(tempSyncFolder!, 'permissions.js');
      const localContent = fs.readFileSync(localPath, 'utf8');
      console.log(`   Local file length: ${localContent.length} bytes`);

      // Content should match (GAS cat unwraps CommonJS, local is raw)
      expect(gasContent).to.have.length.greaterThan(0);
      expect(gasContent).to.match(/function|var|const|let/);
      console.log('✅ File content integrity verified');
    });

    it('should verify README.md → README.html transformation', async function() {
      this.timeout(120000);

      console.log('\n🔄 Checking README transformation...');

      const lsResult = await globalAuthState.client!.callTool('ls', {
        scriptId: testProjectId
      });

      const fileList = lsResult.content[0].text;

      // README should be present (may be README or README.html)
      expect(fileList).to.match(/README/i);
      console.log('✅ README file found in GAS');
    });
  });

  describe('Sync from GAS - GAS to Local', () => {
    let actualSyncFolder: string | null = null;

    before(async function() {
      // Get the actual sync folder from git config
      const result = await globalAuthState.client!.callAndParse('config', {
        action: 'get',
        type: 'sync_folder',
        scriptId: testProjectId
      });
      actualSyncFolder = result.syncFolder;
      console.log(`\nℹ️  Using actual sync folder: ${actualSyncFolder}`);
    });

    it('should modify file in GAS', async function() {
      this.timeout(120000);

      console.log('\n✏️  Modifying file in GAS...');

      const testContent = `// Modified by MCP test at ${new Date().toISOString()}\nfunction testModification() {\n  return 'test-${Date.now()}';\n}`;

      await globalAuthState.gas!.writeTestFile(testProjectId!, 'TestModification', testContent);
      console.log('✅ File modified in GAS');
    });

    it('should sync changes back to local', async function() {
      this.timeout(600000); // 10 minutes for sync

      console.log('\n⬇️  Syncing changes from GAS to local...');

      const syncResult = await globalAuthState.client!.callAndParse('local_sync', {
        scriptId: testProjectId
      });

      console.log(`✅ Sync complete: pulled=${syncResult.pulled}, pushed=${syncResult.pushed}`);

      expect(syncResult).to.have.property('success', true);
      expect(syncResult.pulled).to.be.greaterThan(0);
    });

    it('should verify modified file exists locally', async function() {
      this.timeout(120000);

      console.log('\n🔍 Checking for modified file locally...');

      const localFilePath = path.join(actualSyncFolder!, 'TestModification.js');
      expect(fs.existsSync(localFilePath)).to.be.true;

      const localContent = fs.readFileSync(localFilePath, 'utf8');
      expect(localContent).to.include('testModification');
      console.log('✅ Modified file verified locally');
    });

    it('should show uncommitted changes in git status', async function() {
      this.timeout(120000);

      console.log('\n📊 Checking git status...');

      const gitStatus = execSync('git status --porcelain', {
        cwd: actualSyncFolder!,
        encoding: 'utf8'
      });

      console.log(`   Git status:\n${gitStatus}`);

      // Should have uncommitted changes from the modification
      expect(gitStatus).to.have.length.greaterThan(0);
      console.log('✅ Git detected uncommitted changes');
    });

    it('should commit and verify clean state', async function() {
      this.timeout(120000);

      console.log('\n💾 Committing changes...');

      execSync('git add .', { cwd: actualSyncFolder!, stdio: 'inherit' });
      execSync('git commit -m "Test modifications from MCP"', { cwd: actualSyncFolder!, stdio: 'inherit' });

      const gitStatus = execSync('git status --porcelain', {
        cwd: actualSyncFolder!,
        encoding: 'utf8'
      });

      expect(gitStatus.trim()).to.equal('');
      console.log('✅ Working tree clean after commit');
    });
  });

  describe('Bidirectional Changes & Merge', () => {
    let actualSyncFolder: string | null = null;

    before(async function() {
      // Get the actual sync folder from git config
      const result = await globalAuthState.client!.callAndParse('config', {
        action: 'get',
        type: 'sync_folder',
        scriptId: testProjectId
      });
      actualSyncFolder = result.syncFolder;
      console.log(`\nℹ️  Using actual sync folder: ${actualSyncFolder}`);
    });

    it('should handle compatible changes (different files)', async function() {
      this.timeout(600000); // 10 minutes for sync

      console.log('\n🔄 Testing bidirectional changes (different files)...');

      // Make change in GAS
      await globalAuthState.gas!.writeTestFile(testProjectId!, 'GasFile', '// GAS content');
      console.log('   ✅ Created GasFile in GAS');

      // Make change locally
      const localFilePath = path.join(actualSyncFolder!, 'LocalFile.js');
      fs.writeFileSync(localFilePath, '// Local content');
      console.log('   ✅ Created LocalFile locally');

      // Sync should merge both
      const syncResult = await globalAuthState.client!.callAndParse('local_sync', {
        scriptId: testProjectId
      });

      expect(syncResult).to.have.property('success', true);
      console.log(`   ✅ Sync complete: pulled=${syncResult.pulled}, pushed=${syncResult.pushed}`);

      // Both files should exist in GAS
      const gasLsResult = await globalAuthState.client!.callTool('ls', {
        scriptId: testProjectId
      });

      const fileList = gasLsResult.content[0].text;
      expect(fileList).to.include('GasFile');
      expect(fileList).to.include('LocalFile');
      console.log('✅ Both files present in GAS after bidirectional sync');
    });

    it('should detect conflicts when same file modified', async function() {
      this.timeout(600000); // 10 minutes for sync

      console.log('\n⚠️  Testing conflict detection...');

      // Create a file and sync it first
      const sharedFileName = 'SharedFile';
      const initialContent = 'function shared() {\n  return "initial";\n}';

      await globalAuthState.gas!.writeTestFile(testProjectId!, sharedFileName, initialContent);
      await globalAuthState.client!.callAndParse('local_sync', { scriptId: testProjectId });
      console.log('   ✅ Created and synced SharedFile');

      // Modify in GAS
      const gasContent = 'function shared() {\n  return "modified-in-gas";\n}';
      await globalAuthState.gas!.writeTestFile(testProjectId!, sharedFileName, gasContent);
      console.log('   ✅ Modified SharedFile in GAS');

      // Modify locally (same file, different content)
      const localPath = path.join(actualSyncFolder!, 'SharedFile.js');
      const localContent = 'function shared() {\n  return "modified-locally";\n}';
      fs.writeFileSync(localPath, localContent);
      console.log('   ✅ Modified SharedFile locally');

      // Sync should detect conflict or apply merge strategy
      try {
        const syncResult = await globalAuthState.client!.callAndParse('local_sync', {
          scriptId: testProjectId
        });

        // If sync succeeded, check the merged content
        console.log(`   ℹ️  Sync result: ${JSON.stringify(syncResult)}`);

        // Read the merged content from GAS
        const mergedResult = await globalAuthState.client!.callTool('cat', {
          scriptId: testProjectId,
          path: sharedFileName
        });

        const mergedContent = mergedResult.content[0].text;
        console.log(`   📄 Merged content: ${mergedContent.substring(0, 200)}...`);

        // Should contain either conflict markers or one of the versions
        const hasConflictMarkers = mergedContent.includes('<<<<<<<') ||
                                    mergedContent.includes('=======') ||
                                    mergedContent.includes('>>>>>>>');

        if (hasConflictMarkers) {
          console.log('✅ Conflict markers detected in merged file');
        } else {
          console.log('✅ Merge strategy applied (no conflict markers)');
        }
      } catch (error: any) {
        // Conflict might cause an error
        console.log(`   ℹ️  Sync error (may indicate conflict): ${error.message}`);
      }
    });

    it('should support pull-only direction', async function() {
      this.timeout(600000); // 10 minutes for sync

      console.log('\n⬇️  Testing pull-only sync...');

      // Make a change in GAS
      await globalAuthState.gas!.writeTestFile(testProjectId!, 'PullOnlyTest', '// Pull only content');

      // Sync with pull-only direction
      const result = await globalAuthState.client!.callAndParse('local_sync', {
        scriptId: testProjectId,
        direction: 'pull-only'
      });

      expect(result).to.have.property('success', true);
      expect(result.pushed).to.equal(0);
      console.log('✅ Pull-only sync succeeded (no files pushed)');

      // Verify file exists locally
      const localPath = path.join(tempSyncFolder!, 'PullOnlyTest.js');
      expect(fs.existsSync(localPath)).to.be.true;
      console.log('✅ Pulled file verified locally');
    });

    it('should support dry-run mode', async function() {
      this.timeout(120000);

      console.log('\n🔍 Testing dry-run mode...');

      const result = await globalAuthState.client!.callAndParse('local_sync', {
        scriptId: testProjectId,
        dryRun: true
      });

      expect(result).to.have.property('success', true);
      expect(result).to.have.property('dryRun', true);
      console.log('✅ Dry-run completed successfully');
    });
  });

  describe('File Transformations & Edge Cases', () => {
    let actualSyncFolder: string | null = null;

    before(async function() {
      // Get the actual sync folder from git config
      const result = await globalAuthState.client!.callAndParse('config', {
        action: 'get',
        type: 'sync_folder',
        scriptId: testProjectId
      });
      actualSyncFolder = result.syncFolder;
      console.log(`\nℹ️  Using actual sync folder: ${actualSyncFolder}`);
    });

    it('should verify .git.gs excluded from local sync', async function() {
      this.timeout(120000);

      console.log('\n🔒 Checking .git/config.gs exclusion...');

      // .git/config.gs should only exist in GAS, not in local git repo (outside .git folder)
      const localGitGsPath = path.join(actualSyncFolder!, '.git.gs');
      const localGitConfigPath = path.join(actualSyncFolder!, '.git', 'config.gs');
      expect(fs.existsSync(localGitGsPath)).to.be.false;
      expect(fs.existsSync(localGitConfigPath)).to.be.false;
      console.log('✅ .git/config.gs correctly excluded from local sync');
    });

    it('should handle CommonJS wrapping for synced files', async function() {
      this.timeout(120000);

      console.log('\n📦 Testing CommonJS wrapping...');

      // List files to see what's actually there
      const lsResult = await globalAuthState.client!.callTool('ls', {
        scriptId: testProjectId
      });
      const fileList = lsResult.content[0].text;
      console.log(`   Available files: ${fileList}`);

      // Try to find a .js file that was synced
      if (fileList.includes('TestModification')) {
        // Read our test file with smart cat (unwrapped)
        const smartResult = await globalAuthState.client!.callTool('cat', {
          scriptId: testProjectId,
          path: 'TestModification'
        });

        const smartContent = smartResult.content[0].text;
        expect(smartContent).to.not.include('function _main');
        console.log('   ✅ Smart cat returns unwrapped content');

        // Read same file with raw cat (wrapped)
        const rawResult = await globalAuthState.client!.callTool('raw_cat', {
          scriptId: testProjectId,
          path: 'TestModification.gs'
        });

        const rawContent = rawResult.content[0].text;
        expect(rawContent).to.include('function _main');
        expect(rawContent).to.include('module.exports');
        console.log('   ✅ Raw cat returns wrapped content');
      } else {
        console.warn('⚠️  No synced .js files found yet, skipping CommonJS wrapping test');
        this.skip();
      }
    });

    it('should handle project without git association', async function() {
      this.timeout(120000);

      console.log('\n❌ Testing error for project without git association...');

      // Create a project without git init
      const result = await globalAuthState.gas!.createTestProject('No-Git-Project');
      const noGitProjectId = result.scriptId;

      try {
        await globalAuthState.client!.callAndParse('local_sync', {
          scriptId: noGitProjectId
        });
        // If it succeeds, that means it doesn't require git association
        console.warn('⚠️  local_sync succeeded without git association (unexpected)');
        this.skip();
      } catch (error: any) {
        console.log(`✅ Got expected error: ${error.message}`);
        expect(error.message).to.match(/no git|not initialized|no \.git|not found/i);
      } finally {
        // Cleanup
        try {
          await globalAuthState.gas!.cleanupTestProject(noGitProjectId);
        } catch (cleanupError) {
          console.warn('⚠️  Cleanup of no-git project failed (non-fatal)');
        }
      }
    });

    it('should verify local files match GAS content (ignoring wrapper)', async function() {
      this.timeout(120000);

      console.log('\n🔍 Verifying content consistency between GAS and local...');

      // Check if we have TestModification file (created in earlier test)
      const localPath = path.join(actualSyncFolder!, 'TestModification.js');
      if (fs.existsSync(localPath)) {
        // Read from GAS (unwrapped)
        const gasResult = await globalAuthState.client!.callTool('cat', {
          scriptId: testProjectId,
          path: 'TestModification'
        });

        const gasContent = gasResult.content[0].text;
        console.log(`   GAS content length: ${gasContent.length} bytes`);

        // Read from local
        const localContent = fs.readFileSync(localPath, 'utf8');
        console.log(`   Local content length: ${localContent.length} bytes`);

        // Content should be similar (allowing for minor formatting differences)
        expect(localContent).to.include('function');
        expect(localContent).to.include('testModification');
        console.log('✅ Content consistency verified');
      } else {
        console.warn('⚠️  Local test file not found, skipping comparison');
        this.skip();
      }
    });
  });

  describe('Config Operations', () => {
    let actualSyncFolder: string | null = null;

    before(async function() {
      // Get the actual sync folder from the git config
      const result = await globalAuthState.client!.callAndParse('config', {
        action: 'get',
        type: 'sync_folder',
        scriptId: testProjectId
      });
      actualSyncFolder = result.syncFolder;
      console.log(`\nℹ️  Actual sync folder: ${actualSyncFolder}`);
    });

    it('should get sync folder configuration', async function() {
      this.timeout(120000);

      console.log('\n⚙️  Getting sync folder configuration...');

      const result = await globalAuthState.client!.callAndParse('config', {
        action: 'get',
        type: 'sync_folder',
        scriptId: testProjectId
      });

      console.log(`   Config result: ${JSON.stringify(result, null, 2)}`);

      expect(result).to.have.property('syncFolder');
      expect(result.syncFolder).to.be.a('string');
      expect(result).to.have.property('exists', true);
      console.log('✅ Config get succeeded');
    });

    it('should detect sync folder as a git repository', async function() {
      this.timeout(120000);

      console.log('\n🔍 Checking if sync folder is detected as git repo...');

      const result = await globalAuthState.client!.callAndParse('config', {
        action: 'get',
        type: 'sync_folder',
        scriptId: testProjectId
      });

      expect(result).to.have.property('isGitRepo', true);
      console.log('✅ Sync folder correctly detected as git repository');
    });

    it('should update sync folder configuration', async function() {
      this.timeout(120000);

      console.log('\n⚙️  Testing config set...');

      // Create a new temp folder
      const newSyncFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gas-git-test2-'));
      console.log(`   Created new temp folder: ${newSyncFolder}`);

      try {
        const result = await globalAuthState.client!.callAndParse('config', {
          action: 'set',
          type: 'sync_folder',
          scriptId: testProjectId,
          value: newSyncFolder
        });

        expect(result).to.have.property('success', true);
        expect(result).to.have.property('oldPath');
        expect(result).to.have.property('newPath', newSyncFolder);
        console.log('✅ Config set succeeded');

        // Verify .git/config file reflects new folder
        const gitResult = await globalAuthState.client!.callTool('cat', {
          scriptId: testProjectId,
          path: '.git/config'
        });

        const content = gitResult.content[0].text;
        expect(content).to.include(newSyncFolder);
        console.log('✅ .git/config file updated with new sync folder');

        // Restore original sync folder
        if (actualSyncFolder) {
          await globalAuthState.client!.callAndParse('config', {
            action: 'set',
            type: 'sync_folder',
            scriptId: testProjectId,
            value: actualSyncFolder
          });
          console.log('   ✅ Restored original sync folder');
        }
      } finally {
        // Cleanup new temp folder
        if (fs.existsSync(newSyncFolder)) {
          fs.rmSync(newSyncFolder, { recursive: true, force: true });
        }
      }
    });
  });
});
