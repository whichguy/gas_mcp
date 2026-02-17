import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Tests for GitOperationManager.stageFiles() — verifies it uses the provided
 * localPath (cwd) rather than hardcoded ~/gas-repos/.
 *
 * These tests create real temporary git repos to validate actual git staging behavior.
 * This is the core fix: session worktrees at ~/.mcp-gas/worktrees/ must work,
 * not just ~/gas-repos/project-{id}/.
 */
describe('GitOperationManager - stageFiles path correctness', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary git repo at an arbitrary path (simulating a worktree)
    tempDir = mkdtempSync(join(tmpdir(), 'git-op-manager-test-'));
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' });

    // Create an initial commit so diff --cached works
    writeFileSync(join(tempDir, '.gitkeep'), '');
    execSync('git add .gitkeep && git commit -m "init"', { cwd: tempDir, stdio: 'ignore' });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should stage files using the provided localPath, not ~/gas-repos/', async () => {
    // Write a new file to the temp repo (simulating STEP 1 of GitOperationManager)
    writeFileSync(join(tempDir, 'test-file.gs'), 'function hello() {}');

    // Import the class and construct it with minimal mocks
    const { GitOperationManager } = await import(
      '../../../../src/core/git/GitOperationManager.js'
    );

    const manager = new GitOperationManager(
      {} as any, // pathResolver (not used by stageFiles)
      {} as any, // syncFactory (not used by stageFiles)
      {} as any  // gasClient (not used by stageFiles)
    );

    // Access private method via bracket notation
    const result = await (manager as any).stageFiles(
      tempDir,
      ['test-file.gs'],
      'edit'
    );

    expect(result.staged).to.be.true;
    expect(result.stagedFiles).to.include('test-file.gs');
    expect(result.message).to.include('Staged');
  });

  it('should return staged:false when file content is unchanged', async () => {
    // Create, commit, then re-add the same file — no diff to stage
    writeFileSync(join(tempDir, 'unchanged.gs'), 'function same() {}');
    execSync('git add unchanged.gs && git commit -m "add"', { cwd: tempDir, stdio: 'ignore' });

    const { GitOperationManager } = await import(
      '../../../../src/core/git/GitOperationManager.js'
    );

    const manager = new GitOperationManager({} as any, {} as any, {} as any);

    const result = await (manager as any).stageFiles(
      tempDir,
      ['unchanged.gs'],
      'edit'
    );

    expect(result.staged).to.be.false;
    expect(result.stagedFiles).to.deep.equal([]);
    expect(result.message).to.equal('No changes to stage');
  });

  it('should stage only the specified files, not all changes', async () => {
    // Write two files but only stage one
    writeFileSync(join(tempDir, 'target.gs'), 'function target() {}');
    writeFileSync(join(tempDir, 'other.gs'), 'function other() {}');

    const { GitOperationManager } = await import(
      '../../../../src/core/git/GitOperationManager.js'
    );

    const manager = new GitOperationManager({} as any, {} as any, {} as any);

    const result = await (manager as any).stageFiles(
      tempDir,
      ['target.gs'],
      'edit'
    );

    expect(result.staged).to.be.true;
    expect(result.stagedFiles).to.include('target.gs');
    expect(result.stagedFiles).to.not.include('other.gs');
  });

  it('should work with paths containing subdirectories', async () => {
    // Simulate a nested file path (like common-js/utils.gs)
    mkdirSync(join(tempDir, 'common-js'), { recursive: true });
    writeFileSync(join(tempDir, 'common-js', 'utils.gs'), 'module.exports = {}');

    const { GitOperationManager } = await import(
      '../../../../src/core/git/GitOperationManager.js'
    );

    const manager = new GitOperationManager({} as any, {} as any, {} as any);

    const result = await (manager as any).stageFiles(
      tempDir,
      ['common-js/utils.gs'],
      'edit'
    );

    expect(result.staged).to.be.true;
    expect(result.stagedFiles).to.include('common-js/utils.gs');
  });

  it('should handle file deletions (staging removed files)', async () => {
    // Create and commit a file, then delete it
    writeFileSync(join(tempDir, 'to-delete.gs'), 'function old() {}');
    execSync('git add to-delete.gs && git commit -m "add file"', { cwd: tempDir, stdio: 'ignore' });
    rmSync(join(tempDir, 'to-delete.gs'));

    const { GitOperationManager } = await import(
      '../../../../src/core/git/GitOperationManager.js'
    );

    const manager = new GitOperationManager({} as any, {} as any, {} as any);

    const result = await (manager as any).stageFiles(
      tempDir,
      ['to-delete.gs'],
      'delete'
    );

    expect(result.staged).to.be.true;
    expect(result.stagedFiles).to.include('to-delete.gs');
  });
});
