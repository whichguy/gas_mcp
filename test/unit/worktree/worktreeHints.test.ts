/**
 * Unit tests for worktree hints generation
 *
 * Tests:
 * - Operation hints for all 10 operations
 * - Error hints for all error codes
 * - Context-aware hint generation
 */

import { expect } from 'chai';
import {
  generateWorktreeHints,
  generateWorktreeErrorHints,
  type WorktreeHints
} from '../../../src/utils/worktreeHints.js';

describe('WorktreeHints', () => {
  describe('generateWorktreeHints', () => {
    describe('add operation', () => {
      it('should generate hints for successful add', () => {
        const result = { worktree: { scriptId: 'abc123', state: 'READY' } };
        const hints = generateWorktreeHints('add', result, { parentScriptId: 'parent123' });

        expect(hints.context).to.include('Created isolated worktree');
        expect(hints.nextSteps).to.be.an('array');
        expect(hints.nextSteps!.some(s => s.includes('abc123'))).to.be.true;
        expect(hints.workflow).to.be.an('array');
      });

      it('should indicate CLAIMED state in context', () => {
        const result = { worktree: { scriptId: 'abc123', state: 'CLAIMED' } };
        const hints = generateWorktreeHints('add', result, {});

        expect(hints.context).to.include('claimed');
      });

      it('should include localPath in context when available', () => {
        const result = { worktree: { scriptId: 'abc123', state: 'READY', localPath: '/Users/test/gas-repos/project-abc123' } };
        const hints = generateWorktreeHints('add', result, { parentScriptId: 'parent123' });

        expect(hints.context).to.include('Local git folder:');
        expect(hints.context).to.include('/Users/test/gas-repos/project-abc123');
      });
    });

    describe('claim operation', () => {
      it('should indicate when new worktree was created', () => {
        const result = { created: true, worktree: { scriptId: 'abc123' } };
        const hints = generateWorktreeHints('claim', result, {});

        expect(hints.context).to.include('Created and claimed new');
      });

      it('should indicate when existing worktree was claimed', () => {
        const result = { created: false, worktree: { scriptId: 'abc123' } };
        const hints = generateWorktreeHints('claim', result, {});

        expect(hints.context).to.include('Claimed existing READY');
      });

      it('should include release and merge next steps', () => {
        const result = { worktree: { scriptId: 'abc123' } };
        const hints = generateWorktreeHints('claim', result, { parentScriptId: 'parent123' });

        expect(hints.nextSteps).to.be.an('array');
        expect(hints.nextSteps!.some(s => s.includes('release'))).to.be.true;
        expect(hints.nextSteps!.some(s => s.includes('merge'))).to.be.true;
      });

      it('should include localPath in context when available', () => {
        const result = { created: false, worktree: { scriptId: 'abc123', localPath: '/Users/test/gas-repos/worktree-xyz' } };
        const hints = generateWorktreeHints('claim', result, {});

        expect(hints.context).to.include('Local git folder:');
        expect(hints.context).to.include('/Users/test/gas-repos/worktree-xyz');
      });
    });

    describe('release operation', () => {
      it('should indicate worktree returned to READY', () => {
        const result = { state: 'READY' };
        const hints = generateWorktreeHints('release', result, { parentScriptId: 'parent123', worktreeScriptId: 'wt123' });

        expect(hints.context).to.include('READY state');
      });

      it('should include warnings if present', () => {
        const result = { state: 'READY', warnings: ['Some warning'] };
        const hints = generateWorktreeHints('release', result, {});

        expect(hints.warning).to.include('Some warning');
      });
    });

    describe('merge operation', () => {
      it('should generate hints for dry run preview', () => {
        const result = { preview: { conflicts: [], mergeable: true } };
        const hints = generateWorktreeHints('merge', result, { worktreeScriptId: 'wt123' });

        expect(hints.context).to.include('Preview');
        expect(hints.nextSteps).to.be.an('array');
      });

      it('should warn about conflicts in preview', () => {
        const result = { preview: { conflicts: ['file1.gs', 'file2.gs'], mergeable: false } };
        const hints = generateWorktreeHints('merge', result, {});

        expect(hints.warning).to.include('2 conflict');
        expect(hints.suggestions).to.be.an('array');
      });

      it('should generate hints for actual merge', () => {
        const result = { merged: true, filesChanged: 5, pushedToRemote: true, worktreeState: 'MERGED' };
        const hints = generateWorktreeHints('merge', result, { worktreeScriptId: 'wt123' });

        expect(hints.context).to.include('5 files');
        expect(hints.nextSteps).to.be.an('array');
      });

      it('should warn if not pushed to remote', () => {
        const result = { merged: true, filesChanged: 3, pushedToRemote: false };
        const hints = generateWorktreeHints('merge', result, {});

        expect(hints.warning).to.include('NOT pushed to remote');
      });
    });

    describe('remove operation', () => {
      it('should confirm worktree deleted', () => {
        const result = { removed: true };
        const hints = generateWorktreeHints('remove', result, {});

        expect(hints.context).to.include('deleted');
      });

      it('should include warnings if present', () => {
        const result = { removed: true, warnings: ['Branch not found'] };
        const hints = generateWorktreeHints('remove', result, {});

        expect(hints.warning).to.include('Branch not found');
      });
    });

    describe('list operation', () => {
      it('should summarize worktree counts', () => {
        const result = {
          worktrees: [
            { state: 'READY', isOrphan: false },
            { state: 'READY', isOrphan: false },
            { state: 'CLAIMED', isOrphan: false }
          ]
        };
        const hints = generateWorktreeHints('list', result, { parentScriptId: 'parent123' });

        expect(hints.context).to.include('3 worktree');
        expect(hints.context).to.include('2 READY');
        expect(hints.context).to.include('1 CLAIMED');
      });

      it('should warn about orphans', () => {
        const result = {
          worktrees: [
            { state: 'CLAIMED', isOrphan: true }
          ]
        };
        const hints = generateWorktreeHints('list', result, { parentScriptId: 'parent123' });

        expect(hints.warning).to.include('orphaned');
        expect(hints.suggestions).to.be.an('array');
      });

      it('should suggest claim when READY worktrees exist', () => {
        const result = {
          worktrees: [{ state: 'READY', isOrphan: false }]
        };
        const hints = generateWorktreeHints('list', result, { parentScriptId: 'parent123' });

        expect(hints.nextSteps).to.be.an('array');
        expect(hints.nextSteps!.some(s => s.includes('claim'))).to.be.true;
      });

      it('should suggest add when no worktrees exist', () => {
        const result = { worktrees: [] };
        const hints = generateWorktreeHints('list', result, { parentScriptId: 'parent123' });

        expect(hints.nextSteps).to.be.an('array');
        expect(hints.nextSteps!.some(s => s.includes('add'))).to.be.true;
      });
    });

    describe('status operation', () => {
      it('should summarize divergence', () => {
        const result = {
          divergence: {
            filesOnlyInWorktree: ['new.gs'],
            filesModifiedInWorktree: ['mod.gs'],
            filesOnlyInParent: [],
            filesModifiedInParent: [],
            conflicts: []
          },
          mergeable: true
        };
        const hints = generateWorktreeHints('status', result, { worktreeScriptId: 'wt123' });

        expect(hints.context).to.include('2 file difference');
      });

      it('should warn about conflicts', () => {
        const result = {
          divergence: { conflicts: ['conflict.gs'] },
          mergeable: false
        };
        const hints = generateWorktreeHints('status', result, {});

        expect(hints.warning).to.include('conflict');
        expect(hints.suggestions).to.be.an('array');
      });

      it('should suggest merge when mergeable', () => {
        const result = {
          divergence: { conflicts: [] },
          mergeable: true
        };
        const hints = generateWorktreeHints('status', result, { worktreeScriptId: 'wt123' });

        expect(hints.nextSteps).to.be.an('array');
        expect(hints.nextSteps!.some(s => s.includes('merge'))).to.be.true;
      });

      it('should warn about uncommitted git changes', () => {
        const result = {
          gitStatus: { uncommittedChanges: 3 }
        };
        const hints = generateWorktreeHints('status', result, {});

        expect(hints.warning).to.include('uncommitted');
      });

      it('should include localPath in context when available', () => {
        const result = {
          localPath: '/Users/test/gas-repos/project-wt123',
          divergence: { conflicts: [] },
          mergeable: true
        };
        const hints = generateWorktreeHints('status', result, { worktreeScriptId: 'wt123' });

        expect(hints.context).to.include('Local git folder:');
        expect(hints.context).to.include('/Users/test/gas-repos/project-wt123');
      });

      it('should include localPath from worktree if not at top level', () => {
        const result = {
          worktree: { localPath: '/Users/test/gas-repos/project-nested' },
          divergence: { conflicts: [] }
        };
        const hints = generateWorktreeHints('status', result, {});

        expect(hints.context).to.include('Local git folder:');
        expect(hints.context).to.include('/Users/test/gas-repos/project-nested');
      });
    });

    describe('sync operation', () => {
      it('should report synced files count', () => {
        const result = { synced: ['a.gs', 'b.gs'], conflicts: [], skipped: [] };
        const hints = generateWorktreeHints('sync', result, {});

        expect(hints.context).to.include('2 file');
      });

      it('should warn about conflicts', () => {
        const result = { synced: [], conflicts: ['conflict.gs'], skipped: [] };
        const hints = generateWorktreeHints('sync', result, {});

        expect(hints.warning).to.include('conflict');
        expect(hints.suggestions).to.be.an('array');
      });

      it('should mention skipped files', () => {
        const result = { synced: [], conflicts: [], skipped: ['deleted.gs'] };
        const hints = generateWorktreeHints('sync', result, {});

        expect(hints.context).to.include('skipped');
      });
    });

    describe('batch-add operation', () => {
      it('should report creation counts', () => {
        const result = { created: 3, total: 3, worktrees: [{}, {}, {}] };
        const hints = generateWorktreeHints('batch-add', result, { parentScriptId: 'parent123' });

        expect(hints.context).to.include('3 of 3');
      });

      it('should warn about failures', () => {
        const result = { created: 2, total: 3, failedCount: 1, worktrees: [{}, {}] };
        const hints = generateWorktreeHints('batch-add', result, {});

        expect(hints.warning).to.include('failed');
      });

      it('should include workflow guidance', () => {
        const result = { worktrees: [{}] };
        const hints = generateWorktreeHints('batch-add', result, { parentScriptId: 'parent123' });

        expect(hints.workflow).to.be.an('array');
      });

      it('should include parent directory in context when localPath available', () => {
        const result = {
          created: 2,
          total: 2,
          worktrees: [
            { localPath: '/Users/test/gas-repos/project-parent/worktrees/feature-a' },
            { localPath: '/Users/test/gas-repos/project-parent/worktrees/feature-b' }
          ]
        };
        const hints = generateWorktreeHints('batch-add', result, { parentScriptId: 'parent123' });

        expect(hints.context).to.include('Worktrees created in:');
        expect(hints.context).to.include('/Users/test/gas-repos/project-parent/worktrees/');
      });
    });

    describe('cleanup operation', () => {
      it('should report cleanup results', () => {
        const result = { cleaned: 2, kept: 1 };
        const hints = generateWorktreeHints('cleanup', result, {});

        expect(hints.context).to.include('2 orphaned');
      });

      it('should warn about kept worktrees', () => {
        const result = { cleaned: 1, kept: 2 };
        const hints = generateWorktreeHints('cleanup', result, {});

        expect(hints.warning).to.include('2 worktree');
      });

      it('should report dry run preview', () => {
        const result = { orphans: [{ scriptId: 'a' }, { scriptId: 'b' }] };
        const hints = generateWorktreeHints('cleanup', result, { parentScriptId: 'parent123' });

        expect(hints.context).to.include('2 candidate');
        expect(hints.nextSteps).to.be.an('array');
      });
    });
  });

  describe('generateWorktreeErrorHints', () => {
    it('should generate hints for WORKTREE_NOT_FOUND', () => {
      const hints = generateWorktreeErrorHints('status', 'WORKTREE_NOT_FOUND');

      expect(hints.context).to.include('does not exist');
      expect(hints.suggestions).to.be.an('array');
      expect(hints.suggestions!.some(s => s.includes('list'))).to.be.true;
    });

    it('should generate hints for PARENT_NOT_FOUND', () => {
      const hints = generateWorktreeErrorHints('add', 'PARENT_NOT_FOUND');

      expect(hints.context).to.include('not accessible');
      expect(hints.suggestions).to.be.an('array');
    });

    it('should generate hints for INVALID_STATE_TRANSITION', () => {
      const hints = generateWorktreeErrorHints('release', 'INVALID_STATE_TRANSITION');

      expect(hints.context).to.include('not allowed');
      expect(hints.suggestions).to.be.an('array');
      expect(hints.suggestions!.some(s => s.includes('state machine'))).to.be.true;
    });

    it('should generate hints for UNCOMMITTED_CHANGES', () => {
      const hints = generateWorktreeErrorHints('release', 'UNCOMMITTED_CHANGES');

      expect(hints.context).to.include('uncommitted');
      expect(hints.suggestions!.some(s => s.includes('force'))).to.be.true;
    });

    it('should generate hints for MERGE_CONFLICT', () => {
      const hints = generateWorktreeErrorHints('merge', 'MERGE_CONFLICT');

      expect(hints.context).to.include('conflicts');
      expect(hints.suggestions).to.be.an('array');
    });

    it('should generate hints for NO_AVAILABLE_WORKTREES', () => {
      const hints = generateWorktreeErrorHints('claim', 'NO_AVAILABLE_WORKTREES');

      expect(hints.context).to.include('No READY');
      expect(hints.suggestions!.some(s => s.includes('add'))).to.be.true;
    });

    it('should generate hints for LOCK_TIMEOUT', () => {
      const hints = generateWorktreeErrorHints('add', 'LOCK_TIMEOUT');

      expect(hints.context).to.include('in progress');
      expect(hints.suggestions!.some(s => s.includes('retry'))).to.be.true;
    });

    it('should generate hints for SYNC_FAILED', () => {
      const hints = generateWorktreeErrorHints('sync', 'SYNC_FAILED');

      expect(hints.context).to.include('push');
      expect(hints.suggestions).to.be.an('array');
    });

    it('should generate hints for CONTAINER_COPY_FAILED', () => {
      const hints = generateWorktreeErrorHints('add', 'CONTAINER_COPY_FAILED');

      expect(hints.context).to.include('copy');
      expect(hints.suggestions).to.be.an('array');
    });

    it('should generate hints for BRANCH_NAME_REQUIRED', () => {
      const hints = generateWorktreeErrorHints('add', 'BRANCH_NAME_REQUIRED');

      expect(hints.context).to.include('required');
      expect(hints.suggestions).to.be.an('array');
    });

    it('should generate hints for BRANCH_EXISTS', () => {
      const hints = generateWorktreeErrorHints('add', 'BRANCH_EXISTS');

      expect(hints.context).to.include('already exists');
      expect(hints.suggestions).to.be.an('array');
    });

    it('should generate hints for API_ERROR', () => {
      const hints = generateWorktreeErrorHints('add', 'API_ERROR');

      expect(hints.context).to.include('API');
      expect(hints.suggestions).to.be.an('array');
    });

    it('should generate hints for GIT_ERROR', () => {
      const hints = generateWorktreeErrorHints('merge', 'GIT_ERROR');

      expect(hints.context).to.include('Git');
      expect(hints.suggestions).to.be.an('array');
    });

    it('should generate hints for DRIVE_QUOTA', () => {
      const hints = generateWorktreeErrorHints('add', 'DRIVE_QUOTA');

      expect(hints.context).to.include('quota');
      expect(hints.suggestions).to.be.an('array');
    });

    it('should generate hints for REMOTE_PUSH_PENDING', () => {
      const hints = generateWorktreeErrorHints('merge', 'REMOTE_PUSH_PENDING');

      expect(hints.context).to.include('push');
      expect(hints.suggestions).to.be.an('array');
    });

    it('should generate hints for GAS_PROJECT_DELETED', () => {
      const hints = generateWorktreeErrorHints('status', 'GAS_PROJECT_DELETED');

      expect(hints.context).to.include('deleted');
      expect(hints.suggestions!.some(s => s.includes('cleanup'))).to.be.true;
    });

    it('should generate hints for PARENT_DELETED', () => {
      const hints = generateWorktreeErrorHints('list', 'PARENT_DELETED');

      expect(hints.context).to.include('no longer exists');
    });

    it('should generate hints for LOCAL_DELETED', () => {
      const hints = generateWorktreeErrorHints('status', 'LOCAL_DELETED');

      expect(hints.context).to.include('local');
      expect(hints.suggestions).to.be.an('array');
    });

    it('should generate hints for RSYNC_PUSH_FAILED', () => {
      const hints = generateWorktreeErrorHints('sync', 'RSYNC_PUSH_FAILED');

      expect(hints.context).to.include('sync');
      expect(hints.suggestions).to.be.an('array');
    });

    it('should return empty hints for unknown error codes', () => {
      const hints = generateWorktreeErrorHints('add', 'UNKNOWN_ERROR');

      expect(hints.context).to.be.undefined;
      expect(hints.suggestions).to.be.undefined;
    });
  });
});
