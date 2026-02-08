import { expect } from 'chai';
import { generateSyncHints, createInSyncHints } from '../../../src/utils/syncHints.js';

describe('syncHints utility', () => {
  const TEST_SCRIPT_ID = '1Y72rigcMUAwRd7bwl3CR57O6ENo5sKTn0xAl2C4HoZys75N5utGfkCUG';

  describe('generateSyncHints', () => {
    it('should return in_sync status when both local and remote updated', () => {
      const hints = generateSyncHints({
        scriptId: TEST_SCRIPT_ID,
        operation: 'write',
        affectedFiles: ['test.gs'],
        localCacheUpdated: true,
        remotePushed: true
      });

      expect(hints.status).to.equal('in_sync');
      expect(hints.localCacheUpdated).to.be.true;
      expect(hints.remotePushed).to.be.true;
      expect(hints.suggestions).to.be.empty;
    });

    it('should return partial status with cat suggestion for single file not cached', () => {
      const hints = generateSyncHints({
        scriptId: TEST_SCRIPT_ID,
        operation: 'write',
        affectedFiles: ['config.gs'],
        localCacheUpdated: false,
        remotePushed: true
      });

      expect(hints.status).to.equal('partial');
      expect(hints.localCacheUpdated).to.be.false;
      expect(hints.remotePushed).to.be.true;
      expect(hints.suggestions).to.have.length(1);
      expect(hints.suggestions[0].action).to.equal('cat_refresh');
      expect(hints.suggestions[0].command).to.equal(
        `cat({scriptId: ${JSON.stringify(TEST_SCRIPT_ID)}, path: "config.gs"})`
      );
      expect(hints.suggestions[0].reason).to.equal('Refresh local cache for this file');
    });

    it('should return partial status with rsync suggestion for multiple files not cached', () => {
      const hints = generateSyncHints({
        scriptId: TEST_SCRIPT_ID,
        operation: 'project_create',
        affectedFiles: ['appsscript.json', 'require.gs', 'exec.gs'],
        localCacheUpdated: false,
        remotePushed: true
      });

      expect(hints.status).to.equal('partial');
      expect(hints.suggestions).to.have.length(1);
      expect(hints.suggestions[0].action).to.equal('rsync_pull');
      expect(hints.suggestions[0].command).to.equal(
        `rsync({operation: "plan", scriptId: ${JSON.stringify(TEST_SCRIPT_ID)}, direction: "pull"})`
      );
      expect(hints.suggestions[0].reason).to.equal('Sync 3 files to local cache');
    });

    it('should generate cat hint for mv destination', () => {
      const hints = generateSyncHints({
        scriptId: TEST_SCRIPT_ID,
        operation: 'mv',
        affectedFiles: ['newName.gs'],
        localCacheUpdated: false,
        remotePushed: true
      });

      expect(hints.status).to.equal('partial');
      expect(hints.suggestions).to.have.length(1);
      expect(hints.suggestions[0].action).to.equal('cat_refresh');
      expect(hints.suggestions[0].command).to.include('newName.gs');
    });

    it('should return empty suggestions when no affected files', () => {
      const hints = generateSyncHints({
        scriptId: TEST_SCRIPT_ID,
        operation: 'rm',
        affectedFiles: [],
        localCacheUpdated: true,
        remotePushed: true
      });

      expect(hints.status).to.equal('in_sync');
      expect(hints.suggestions).to.be.empty;
    });

    it('should return unknown status when neither local nor remote updated', () => {
      const hints = generateSyncHints({
        scriptId: TEST_SCRIPT_ID,
        operation: 'write',
        affectedFiles: ['test.gs'],
        localCacheUpdated: false,
        remotePushed: false
      });

      expect(hints.status).to.equal('unknown');
      // Single file: cat_refresh for local + rsync_pull to verify remote
      expect(hints.suggestions).to.have.length(2);
      expect(hints.suggestions[0].action).to.equal('cat_refresh');
      expect(hints.suggestions[1].action).to.equal('rsync_pull');
    });

    it('should not duplicate rsync suggestions when both local and remote fail with multiple files', () => {
      const hints = generateSyncHints({
        scriptId: TEST_SCRIPT_ID,
        operation: 'project_create',
        affectedFiles: ['file1.gs', 'file2.gs', 'file3.gs'],
        localCacheUpdated: false,
        remotePushed: false
      });

      expect(hints.status).to.equal('unknown');
      // Should have exactly one rsync suggestion (deduplication working)
      const rsyncSuggestions = hints.suggestions.filter(s => s.action === 'rsync_pull');
      expect(rsyncSuggestions).to.have.length(1);
    });

    it('should add rsync suggestion when remote push failed', () => {
      const hints = generateSyncHints({
        scriptId: TEST_SCRIPT_ID,
        operation: 'write',
        affectedFiles: ['test.gs'],
        localCacheUpdated: true,
        remotePushed: false
      });

      expect(hints.status).to.equal('partial');
      expect(hints.suggestions).to.have.length(1);
      expect(hints.suggestions[0].action).to.equal('rsync_pull');
      expect(hints.suggestions[0].reason).to.include('Verify remote state');
    });

    it('should include actual scriptId in generated commands', () => {
      const customScriptId = 'CUSTOM_SCRIPT_ID_12345';
      const hints = generateSyncHints({
        scriptId: customScriptId,
        operation: 'write',
        affectedFiles: ['file.gs'],
        localCacheUpdated: false,
        remotePushed: true
      });

      expect(hints.suggestions[0].command).to.include(customScriptId);
    });

    it('should handle special characters in file paths', () => {
      const hints = generateSyncHints({
        scriptId: TEST_SCRIPT_ID,
        operation: 'write',
        affectedFiles: ['.git/config'],
        localCacheUpdated: false,
        remotePushed: true
      });

      expect(hints.suggestions[0].command).to.include('.git/config');
    });
  });

  describe('createInSyncHints', () => {
    it('should return in_sync status with no suggestions', () => {
      const hints = createInSyncHints();

      expect(hints.status).to.equal('in_sync');
      expect(hints.localCacheUpdated).to.be.true;
      expect(hints.remotePushed).to.be.true;
      expect(hints.suggestions).to.be.empty;
    });
  });
});
