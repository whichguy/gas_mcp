/**
 * Tests for secure git command execution utilities
 */

import { execGitCommand, execGitCommandWithStderr } from '../../../src/utils/gitCommands.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { expect } from 'chai';

describe('gitCommands', () => {
  let tempDir: string;

  before(async () => {
    // Create a temporary git repository for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-test-'));
    await execGitCommand(['init'], tempDir);
    await execGitCommand(['config', 'user.email', 'test@test.com'], tempDir);
    await execGitCommand(['config', 'user.name', 'Test User'], tempDir);
  });

  after(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('execGitCommand', () => {
    it('should execute basic git commands', async () => {
      const result = await execGitCommand(['status'], tempDir);
      expect(result).to.include('On branch');
    });

    it('should handle arguments with spaces safely', async () => {
      // Create a file with spaces in the name
      const fileName = 'file with spaces.txt';
      await fs.writeFile(path.join(tempDir, fileName), 'content');

      // Should not break when path has spaces
      await execGitCommand(['add', fileName], tempDir);
      const status = await execGitCommand(['status', '--porcelain'], tempDir);
      expect(status).to.include(fileName);
    });

    it('should handle commit messages with special characters safely', async () => {
      // Create and stage a test file
      const testFile = 'test-special.txt';
      await fs.writeFile(path.join(tempDir, testFile), 'test content');
      await execGitCommand(['add', testFile], tempDir);

      // Commit with special characters that would break shell escaping
      const specialMessages = [
        'fix: Handle $PATH variable correctly',
        'feat: Add emoji support 🎉',
        'test: Quote "test" works',
        "fix: Apostrophe's work too",
        'feat: Backticks `code` safe',
      ];

      for (const msg of specialMessages) {
        // Update file content to ensure there's something to commit
        await fs.writeFile(path.join(tempDir, testFile), `content for: ${msg}`);
        await execGitCommand(['add', testFile], tempDir);

        // This should NOT execute any shell commands from the message
        await execGitCommand(['commit', '-m', msg], tempDir);

        // Verify the commit message was saved exactly as provided
        const log = await execGitCommand(['log', '-1', '--format=%s'], tempDir);
        expect(log.trim()).to.equal(msg);
      }
    });

    it('should prevent command injection in arguments', async () => {
      // These would be dangerous if passed to exec() with template literals
      const maliciousArgs = [
        'test"; rm -rf / #',     // Quote injection
        'test`echo pwned`',      // Backtick execution
        'test$(echo pwned)',     // Command substitution
        'test & echo pwned',     // Command chaining
        'test | echo pwned',     // Pipe injection
      ];

      for (const arg of maliciousArgs) {
        // Create file with the "malicious" name - should succeed
        const safeFilename = arg.replace(/[/\\:*?"<>|]/g, '_'); // Remove invalid filename chars
        const testFile = `injection-test-${Date.now()}.txt`;
        await fs.writeFile(path.join(tempDir, testFile), 'content');
        await execGitCommand(['add', testFile], tempDir);

        // Commit with "malicious" message - should be treated as literal string
        await execGitCommand(['commit', '-m', arg], tempDir);

        // Verify message was saved literally (no command execution)
        const log = await execGitCommand(['log', '-1', '--format=%s'], tempDir);
        expect(log.trim()).to.equal(arg);
      }
    });

    it('should throw error for invalid git command', async () => {
      try {
        await execGitCommand(['invalid-command'], tempDir);
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('not a git command');
      }
    });

    it('should throw error for invalid directory', async () => {
      try {
        await execGitCommand(['status'], '/nonexistent/directory');
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).to.be.an('Error');
      }
    });
  });

  describe('execGitCommandWithStderr', () => {
    it('should return both stdout and stderr', async () => {
      const result = await execGitCommandWithStderr(['status'], tempDir);
      expect(result).to.have.property('stdout');
      expect(result).to.have.property('stderr');
      expect(result).to.have.property('code');
      expect(result.code).to.equal(0);
    });

    it('should return non-zero code on failure', async () => {
      const result = await execGitCommandWithStderr(['invalid-command'], tempDir);
      expect(result.code).to.not.equal(0);
    });
  });
});
