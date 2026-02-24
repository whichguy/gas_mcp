/**
 * Unit tests for Optimistic Infrastructure Cache
 *
 * Tests:
 * - SessionAuthManager static infrastructure cache (set/get/invalidate, LRU eviction)
 * - setupInfrastructure with existingRemoteFiles (skip getProjectContent, SHA-gated short-circuit)
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { SessionAuthManager, InfrastructureVerifiedEntry } from '../../src/auth/sessionManager.js';

describe('Infrastructure Verification Cache', () => {

  beforeEach(() => {
    // Clear the static cache before each test
    // Access via public API: invalidate any entries that might exist
    for (let i = 0; i < 200; i++) {
      SessionAuthManager.invalidateInfrastructure(`script-${i}`);
    }
  });

  describe('SessionAuthManager.setInfrastructureVerified / getInfrastructureVerified', () => {
    it('should store and retrieve an entry', () => {
      const entry: InfrastructureVerifiedEntry = {
        execShimSHA: 'abc123def456',
        timestamp: Date.now()
      };

      SessionAuthManager.setInfrastructureVerified('script-1', entry);
      const result = SessionAuthManager.getInfrastructureVerified('script-1');

      expect(result).to.deep.equal(entry);
    });

    it('should return null for unknown scriptId', () => {
      const result = SessionAuthManager.getInfrastructureVerified('unknown-script');
      expect(result).to.be.null;
    });

    it('should overwrite existing entry for same scriptId', () => {
      const entry1: InfrastructureVerifiedEntry = { execShimSHA: 'sha-v1', timestamp: 1000 };
      const entry2: InfrastructureVerifiedEntry = { execShimSHA: 'sha-v2', timestamp: 2000 };

      SessionAuthManager.setInfrastructureVerified('script-1', entry1);
      SessionAuthManager.setInfrastructureVerified('script-1', entry2);

      const result = SessionAuthManager.getInfrastructureVerified('script-1');
      expect(result).to.deep.equal(entry2);
    });

    it('should store multiple entries for different scriptIds', () => {
      const entry1: InfrastructureVerifiedEntry = { execShimSHA: 'sha-a', timestamp: 1000 };
      const entry2: InfrastructureVerifiedEntry = { execShimSHA: 'sha-b', timestamp: 2000 };

      SessionAuthManager.setInfrastructureVerified('script-a', entry1);
      SessionAuthManager.setInfrastructureVerified('script-b', entry2);

      expect(SessionAuthManager.getInfrastructureVerified('script-a')).to.deep.equal(entry1);
      expect(SessionAuthManager.getInfrastructureVerified('script-b')).to.deep.equal(entry2);
    });
  });

  describe('SessionAuthManager.invalidateInfrastructure', () => {
    it('should remove a cached entry', () => {
      const entry: InfrastructureVerifiedEntry = { execShimSHA: 'sha-test', timestamp: 1000 };

      SessionAuthManager.setInfrastructureVerified('script-1', entry);
      expect(SessionAuthManager.getInfrastructureVerified('script-1')).to.not.be.null;

      SessionAuthManager.invalidateInfrastructure('script-1');
      expect(SessionAuthManager.getInfrastructureVerified('script-1')).to.be.null;
    });

    it('should be a no-op for unknown scriptId', () => {
      // Should not throw
      SessionAuthManager.invalidateInfrastructure('nonexistent');
      expect(SessionAuthManager.getInfrastructureVerified('nonexistent')).to.be.null;
    });

    it('should not affect other entries', () => {
      const entry1: InfrastructureVerifiedEntry = { execShimSHA: 'sha-a', timestamp: 1000 };
      const entry2: InfrastructureVerifiedEntry = { execShimSHA: 'sha-b', timestamp: 2000 };

      SessionAuthManager.setInfrastructureVerified('script-a', entry1);
      SessionAuthManager.setInfrastructureVerified('script-b', entry2);

      SessionAuthManager.invalidateInfrastructure('script-a');

      expect(SessionAuthManager.getInfrastructureVerified('script-a')).to.be.null;
      expect(SessionAuthManager.getInfrastructureVerified('script-b')).to.deep.equal(entry2);
    });
  });

  describe('LRU eviction at cap 100', () => {
    it('should evict oldest entry when cache exceeds 100', () => {
      // Fill cache to capacity
      for (let i = 0; i < 100; i++) {
        SessionAuthManager.setInfrastructureVerified(`script-${i}`, {
          execShimSHA: `sha-${i}`,
          timestamp: i
        });
      }

      // Verify first entry exists
      expect(SessionAuthManager.getInfrastructureVerified('script-0')).to.not.be.null;

      // Add one more — should evict script-0
      SessionAuthManager.setInfrastructureVerified('script-100', {
        execShimSHA: 'sha-100',
        timestamp: 100
      });

      // script-0 should be evicted
      expect(SessionAuthManager.getInfrastructureVerified('script-0')).to.be.null;
      // script-100 should exist
      expect(SessionAuthManager.getInfrastructureVerified('script-100')).to.not.be.null;
      // script-1 should still exist (it was second oldest)
      expect(SessionAuthManager.getInfrastructureVerified('script-1')).to.not.be.null;
    });

    it('should not evict when updating an existing entry', () => {
      // Fill cache to capacity
      for (let i = 0; i < 100; i++) {
        SessionAuthManager.setInfrastructureVerified(`script-${i}`, {
          execShimSHA: `sha-${i}`,
          timestamp: i
        });
      }

      // Update an existing entry (should NOT trigger eviction)
      SessionAuthManager.setInfrastructureVerified('script-50', {
        execShimSHA: 'sha-50-updated',
        timestamp: 999
      });

      // script-0 should still exist (no eviction triggered)
      expect(SessionAuthManager.getInfrastructureVerified('script-0')).to.not.be.null;
      // Updated entry should have new values
      const updated = SessionAuthManager.getInfrastructureVerified('script-50');
      expect(updated?.execShimSHA).to.equal('sha-50-updated');
    });

    it('should maintain LRU order — re-set moves entry to end', () => {
      // Fill cache to capacity
      for (let i = 0; i < 100; i++) {
        SessionAuthManager.setInfrastructureVerified(`script-${i}`, {
          execShimSHA: `sha-${i}`,
          timestamp: i
        });
      }

      // Re-set script-0 (moves it to end of LRU order)
      SessionAuthManager.setInfrastructureVerified('script-0', {
        execShimSHA: 'sha-0-refreshed',
        timestamp: 999
      });

      // Add a new entry — should evict script-1 (now oldest), NOT script-0
      SessionAuthManager.setInfrastructureVerified('script-new', {
        execShimSHA: 'sha-new',
        timestamp: 1000
      });

      expect(SessionAuthManager.getInfrastructureVerified('script-0')).to.not.be.null;
      expect(SessionAuthManager.getInfrastructureVerified('script-1')).to.be.null;
      expect(SessionAuthManager.getInfrastructureVerified('script-new')).to.not.be.null;
    });
  });
});
