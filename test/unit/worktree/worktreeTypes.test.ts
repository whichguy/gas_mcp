/**
 * Unit tests for worktree types and utility functions
 *
 * Tests:
 * - State machine transitions
 * - Branch name sanitization
 * - File name normalization
 */

import { expect } from 'chai';
import {
  isValidTransition,
  sanitizeBranchName,
  generateBranchName,
  normalizeFileName,
  type WorktreeState
} from '../../../src/types/worktreeTypes.js';

describe('WorktreeTypes', () => {
  describe('isValidTransition', () => {
    describe('CREATING state', () => {
      it('should allow CREATING → READY', () => {
        expect(isValidTransition('CREATING', 'READY')).to.be.true;
      });

      it('should allow CREATING → FAILED', () => {
        expect(isValidTransition('CREATING', 'FAILED')).to.be.true;
      });

      it('should allow CREATING → ORPHAN_GAS_DELETED', () => {
        expect(isValidTransition('CREATING', 'ORPHAN_GAS_DELETED')).to.be.true;
      });

      it('should allow CREATING → ORPHAN_LOCAL_DELETED', () => {
        expect(isValidTransition('CREATING', 'ORPHAN_LOCAL_DELETED')).to.be.true;
      });

      it('should NOT allow CREATING → CLAIMED', () => {
        expect(isValidTransition('CREATING', 'CLAIMED')).to.be.false;
      });

      it('should NOT allow CREATING → MERGED', () => {
        expect(isValidTransition('CREATING', 'MERGED')).to.be.false;
      });
    });

    describe('READY state', () => {
      it('should allow READY → CLAIMED', () => {
        expect(isValidTransition('READY', 'CLAIMED')).to.be.true;
      });

      it('should allow READY → REMOVING', () => {
        expect(isValidTransition('READY', 'REMOVING')).to.be.true;
      });

      it('should allow READY → REMOVED', () => {
        expect(isValidTransition('READY', 'REMOVED')).to.be.true;
      });

      it('should NOT allow READY → MERGING', () => {
        expect(isValidTransition('READY', 'MERGING')).to.be.false;
      });

      it('should NOT allow READY → CREATING', () => {
        expect(isValidTransition('READY', 'CREATING')).to.be.false;
      });
    });

    describe('CLAIMED state', () => {
      it('should allow CLAIMED → READY (release)', () => {
        expect(isValidTransition('CLAIMED', 'READY')).to.be.true;
      });

      it('should allow CLAIMED → MERGING', () => {
        expect(isValidTransition('CLAIMED', 'MERGING')).to.be.true;
      });

      it('should allow CLAIMED → REMOVING', () => {
        expect(isValidTransition('CLAIMED', 'REMOVING')).to.be.true;
      });

      it('should NOT allow CLAIMED → MERGED directly', () => {
        expect(isValidTransition('CLAIMED', 'MERGED')).to.be.false;
      });
    });

    describe('MERGING state', () => {
      it('should allow MERGING → MERGED', () => {
        expect(isValidTransition('MERGING', 'MERGED')).to.be.true;
      });

      it('should allow MERGING → CLAIMED (rollback on failure)', () => {
        expect(isValidTransition('MERGING', 'CLAIMED')).to.be.true;
      });

      it('should NOT allow MERGING → READY', () => {
        expect(isValidTransition('MERGING', 'READY')).to.be.false;
      });
    });

    describe('MERGED state', () => {
      it('should allow MERGED → REMOVING', () => {
        expect(isValidTransition('MERGED', 'REMOVING')).to.be.true;
      });

      it('should allow MERGED → REMOVED', () => {
        expect(isValidTransition('MERGED', 'REMOVED')).to.be.true;
      });

      it('should NOT allow MERGED → CLAIMED', () => {
        expect(isValidTransition('MERGED', 'CLAIMED')).to.be.false;
      });
    });

    describe('FAILED state', () => {
      it('should allow FAILED → REMOVING', () => {
        expect(isValidTransition('FAILED', 'REMOVING')).to.be.true;
      });

      it('should allow FAILED → REMOVED', () => {
        expect(isValidTransition('FAILED', 'REMOVED')).to.be.true;
      });

      it('should NOT allow FAILED → READY', () => {
        expect(isValidTransition('FAILED', 'READY')).to.be.false;
      });
    });

    describe('REMOVED state', () => {
      it('should NOT allow any transitions from REMOVED', () => {
        const allStates: WorktreeState[] = [
          'CREATING', 'READY', 'CLAIMED', 'MERGING', 'MERGED',
          'FAILED', 'REMOVING', 'REMOVED', 'ORPHAN_GAS_DELETED', 'ORPHAN_LOCAL_DELETED'
        ];

        for (const state of allStates) {
          expect(isValidTransition('REMOVED', state)).to.be.false;
        }
      });
    });

    describe('ORPHAN states', () => {
      it('should allow ORPHAN_GAS_DELETED → REMOVING', () => {
        expect(isValidTransition('ORPHAN_GAS_DELETED', 'REMOVING')).to.be.true;
      });

      it('should allow ORPHAN_GAS_DELETED → REMOVED', () => {
        expect(isValidTransition('ORPHAN_GAS_DELETED', 'REMOVED')).to.be.true;
      });

      it('should allow ORPHAN_LOCAL_DELETED → REMOVING', () => {
        expect(isValidTransition('ORPHAN_LOCAL_DELETED', 'REMOVING')).to.be.true;
      });

      it('should allow ORPHAN_LOCAL_DELETED → REMOVED', () => {
        expect(isValidTransition('ORPHAN_LOCAL_DELETED', 'REMOVED')).to.be.true;
      });
    });
  });

  describe('sanitizeBranchName', () => {
    it('should convert to lowercase', () => {
      expect(sanitizeBranchName('MyFeature')).to.equal('myfeature');
    });

    it('should replace spaces with hyphens', () => {
      expect(sanitizeBranchName('my feature')).to.equal('my-feature');
    });

    it('should replace underscores with hyphens', () => {
      expect(sanitizeBranchName('my_feature')).to.equal('my-feature');
    });

    it('should remove invalid characters', () => {
      expect(sanitizeBranchName('my@feature!')).to.equal('my-feature');
    });

    it('should collapse multiple hyphens', () => {
      expect(sanitizeBranchName('my--feature')).to.equal('my-feature');
    });

    it('should trim leading/trailing hyphens', () => {
      expect(sanitizeBranchName('-feature-')).to.equal('feature');
    });

    it('should truncate long names to 50 chars', () => {
      const longName = 'a'.repeat(100);
      const result = sanitizeBranchName(longName);
      expect(result.length).to.be.at.most(50);
    });

    it('should handle empty string', () => {
      expect(sanitizeBranchName('')).to.equal('');
    });

    it('should handle all invalid characters', () => {
      expect(sanitizeBranchName('@#$%')).to.equal('');
    });
  });

  describe('generateBranchName', () => {
    it('should prefix with llm-feature-', () => {
      expect(generateBranchName('test')).to.match(/^llm-feature-/);
    });

    it('should include sanitized name', () => {
      expect(generateBranchName('My Feature')).to.match(/^llm-feature-my-feature-[a-f0-9]{8}$/);
    });

    it('should include 8-char UUID suffix', () => {
      expect(generateBranchName('test')).to.match(/-[a-f0-9]{8}$/);
    });

    it('should generate unique UUIDs for same input', () => {
      const result1 = generateBranchName('feature');
      const result2 = generateBranchName('feature');
      expect(result1).to.not.equal(result2);
    });

    it('should handle empty input', () => {
      expect(generateBranchName('')).to.match(/^llm-feature--[a-f0-9]{8}$/);
    });
  });

  describe('normalizeFileName', () => {
    it('should add .gs extension for SERVER_JS type', () => {
      expect(normalizeFileName('main', 'SERVER_JS')).to.equal('main.gs');
    });

    it('should add .html extension for HTML type', () => {
      expect(normalizeFileName('sidebar', 'HTML')).to.equal('sidebar.html');
    });

    it('should add .json extension for JSON type', () => {
      expect(normalizeFileName('config', 'JSON')).to.equal('config.json');
    });

    it('should handle appsscript special case', () => {
      expect(normalizeFileName('appsscript', 'JSON')).to.equal('appsscript.json');
    });

    it('should not double-add extension if already present', () => {
      expect(normalizeFileName('main.gs', 'SERVER_JS')).to.equal('main.gs');
      expect(normalizeFileName('sidebar.html', 'HTML')).to.equal('sidebar.html');
      expect(normalizeFileName('config.json', 'JSON')).to.equal('config.json');
    });

    it('should default to .gs for unknown types', () => {
      expect(normalizeFileName('utils', 'UNKNOWN')).to.equal('utils.gs');
    });
  });
});
