import { expect } from 'chai';
import { describe, it } from 'mocha';
import { TestAssertionHelpers } from '../utils/testAssertions.js';

describe('Path Validation Tests', () => {
  let client: any;

  before(async function() {
    this.timeout(10000);
    const { createTestClient } = await import('../system/mcpClient.js');
    client = await createTestClient();
  });

  describe('Valid Path Acceptance', () => {
    const validPaths = [
      'project123/Code.gs',
      'my-project/src/main.gs',
      'project_name/utils/helper.gs',
      'Project.123/file-name.gs',
      'project/subfolder/deeply/nested/file.gs'
    ];

    validPaths.forEach(validPath => {
      it(`should accept valid path: ${validPath}`, async () => {
        // This should fail with authentication error, not path validation error
        await TestAssertionHelpers.expectAuthenticationRequired(
          () => client.callTool('gas_cat', { path: validPath })
        );
      });
    });
  });

  describe('Path Length and Format Validation', () => {
    it('should reject paths exceeding maximum length', async () => {
      const longPath = 'project/' + 'a'.repeat(500) + '.gs';
      
      await TestAssertionHelpers.expectValidationError(
        () => client.callTool('gas_cat', { path: longPath }),
        'path'
      );
    });

    it('should validate project ID format', async () => {
      const invalidProjectIds = [
        '',
        ' ',
        'project with spaces',
        'project-with-special-chars!@#',
        '123', // too short
        'a'.repeat(100) // too long
      ];

      for (const projectId of invalidProjectIds) {
        await TestAssertionHelpers.expectValidationError(
          () => client.callTool('gas_cat', { path: `${projectId}/file.gs` }),
          'path'
        );
      }
    });
  });
}); 