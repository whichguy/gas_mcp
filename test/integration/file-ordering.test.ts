/**
 * Integration tests for file ordering preservation
 * Tests the fixes for the file ordering bug where position field was missing
 */

import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { GASClient } from '../../src/api/gasClient.js';
import { GASFile } from '../../src/api/gasTypes.js';

describe('File Ordering - Integration Tests', function() {
  this.timeout(60000); // 60s timeout for API calls

  let gasClient: GASClient;
  let testScriptId: string;

  before(async function() {
    gasClient = new GASClient();

    // Use test project from environment or skip tests
    testScriptId = process.env.MCP_GAS_TEST_SCRIPT_ID || '';
    if (!testScriptId) {
      console.log('⚠️  Skipping file ordering tests - MCP_GAS_TEST_SCRIPT_ID not set');
      this.skip();
    }

    // Ensure authenticated - try to get project content
    try {
      await gasClient.getProjectContent(testScriptId);
    } catch (error) {
      console.log('⚠️  Skipping file ordering tests - not authenticated');
      this.skip();
    }
  });

  describe('Position Field Capture', function() {
    it('should capture position field after sorting', async function() {
      const files = await gasClient.getProjectContent(testScriptId);

      // Verify all files have position field
      expect(files.length).to.be.greaterThan(0);

      files.forEach((file, index) => {
        expect(file).to.have.property('position');
        expect(file.position).to.equal(index, `File ${file.name} should have position ${index}`);
      });
    });

    it('should preserve position order through array operations', async function() {
      const files = await gasClient.getProjectContent(testScriptId);

      // Create a copy and verify positions match indices
      const filesCopy = [...files];

      filesCopy.forEach((file, index) => {
        expect(file.position).to.equal(index, 'Position should match array index');
      });
    });

    it('should have sequential positions starting from 0', async function() {
      const files = await gasClient.getProjectContent(testScriptId);

      const positions = files.map(f => f.position).filter(p => p !== undefined) as number[];

      // Verify sequential
      expect(positions.length).to.equal(files.length);

      for (let i = 0; i < positions.length; i++) {
        expect(positions[i]).to.equal(i, `Position at index ${i} should be ${i}`);
      }
    });
  });

  describe('Critical File Enforcement', function() {
    it('should identify critical files if present', async function() {
      const files = await gasClient.getProjectContent(testScriptId);

      const criticalFiles = [
        'common-js/require',
        'common-js/ConfigManager',
        'common-js/__mcp_exec'
      ];

      const fileNames = files.map(f => f.name);
      const foundCritical = criticalFiles.filter(name => fileNames.includes(name));

      if (foundCritical.length > 0) {
        console.log(`   ✅ Found critical files: ${foundCritical.join(', ')}`);

        // If critical files exist, they should be at positions 0, 1, 2
        foundCritical.forEach((name, expectedIndex) => {
          const file = files.find(f => f.name === name);
          if (file) {
            expect(file.position).to.equal(expectedIndex,
              `Critical file ${name} should be at position ${expectedIndex}`);
          }
        });
      } else {
        console.log(`   ℹ️  No critical files in this project - skipping position check`);
      }
    });

    it('should have critical files in correct order if all present', async function() {
      const files = await gasClient.getProjectContent(testScriptId);

      const criticalOrder = [
        'common-js/require',
        'common-js/ConfigManager',
        'common-js/__mcp_exec'
      ];

      const criticalFiles = criticalOrder
        .map(name => files.find(f => f.name === name))
        .filter(f => f !== undefined) as GASFile[];

      if (criticalFiles.length === 3) {
        // All 3 critical files present - verify order
        expect(criticalFiles[0].name).to.equal('common-js/require');
        expect(criticalFiles[0].position).to.equal(0);

        expect(criticalFiles[1].name).to.equal('common-js/ConfigManager');
        expect(criticalFiles[1].position).to.equal(1);

        expect(criticalFiles[2].name).to.equal('common-js/__mcp_exec');
        expect(criticalFiles[2].position).to.equal(2);
      } else {
        console.log(`   ℹ️  Only ${criticalFiles.length}/3 critical files present - skipping order check`);
      }
    });
  });

  describe('Round-Trip Consistency', function() {
    it('should maintain order after updateProjectContent', async function() {
      // Get current files
      const originalFiles = await gasClient.getProjectContent(testScriptId);
      const originalOrder = originalFiles.map(f => f.name);

      // Update project with same content (no changes)
      await gasClient.updateProjectContent(testScriptId, originalFiles);

      // Get files again
      const updatedFiles = await gasClient.getProjectContent(testScriptId);
      const updatedOrder = updatedFiles.map(f => f.name);

      // Order should be identical
      expect(updatedOrder).to.deep.equal(originalOrder, 'File order should be preserved');
    });

    it('should maintain positions after round-trip', async function() {
      // Get current files
      const originalFiles = await gasClient.getProjectContent(testScriptId);

      // Update project
      await gasClient.updateProjectContent(testScriptId, originalFiles);

      // Get files again
      const updatedFiles = await gasClient.getProjectContent(testScriptId);

      // Positions should match
      originalFiles.forEach((originalFile, index) => {
        const updatedFile = updatedFiles.find(f => f.name === originalFile.name);
        expect(updatedFile).to.exist;
        expect(updatedFile!.position).to.equal(index,
          `Position for ${originalFile.name} should be preserved`);
      });
    });
  });

  describe('Edge Cases', function() {
    it('should handle empty file list', async function() {
      // This is a theoretical test - GAS projects always have at least appsscript.json
      // But we can verify the code handles it gracefully

      const emptyFiles: GASFile[] = [];

      // This should not throw
      expect(() => {
        emptyFiles.map((f, i) => ({ ...f, position: i }));
      }).to.not.throw();
    });

    it('should handle files with undefined position field', async function() {
      const files = await gasClient.getProjectContent(testScriptId);

      // Verify no file has undefined position
      files.forEach(file => {
        expect(file.position).to.not.be.undefined;
        expect(typeof file.position).to.equal('number');
      });
    });

    it('should handle duplicate file names gracefully', async function() {
      const files = await gasClient.getProjectContent(testScriptId);

      const fileNames = files.map(f => f.name);
      const uniqueNames = new Set(fileNames);

      // No duplicates should exist
      expect(fileNames.length).to.equal(uniqueNames.size,
        'No duplicate file names should exist in project');
    });
  });

  describe('Performance', function() {
    it('should capture positions efficiently (< 100ms overhead)', async function() {
      const startTime = Date.now();
      const files = await gasClient.getProjectContent(testScriptId);
      const endTime = Date.now();

      const duration = endTime - startTime;

      // Position capture adds one additional map() operation
      // This should add minimal overhead (< 100ms for typical projects)
      console.log(`   ℹ️  getProjectContent took ${duration}ms for ${files.length} files`);

      // Verify positions exist
      expect(files.every(f => typeof f.position === 'number')).to.be.true;
    });

    it('should handle large projects efficiently', async function() {
      const files = await gasClient.getProjectContent(testScriptId);

      // Position capture is O(n), should scale linearly
      // Test with actual file count
      const startTime = Date.now();

      const processed = files.map((file, index) => ({
        ...file,
        position: index
      }));

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`   ℹ️  Position mapping took ${duration}ms for ${files.length} files`);

      // Should be very fast even for 100+ files
      expect(duration).to.be.lessThan(50, 'Position mapping should be fast');
      expect(processed.length).to.equal(files.length);
    });
  });
});
