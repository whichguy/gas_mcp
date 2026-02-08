/**
 * Secure git command execution utilities
 *
 * SECURITY: Uses spawn() with array arguments to prevent shell injection.
 * This is critical for any git command that includes user input.
 *
 * @example
 * // SECURE - Array arguments prevent injection
 * await execGitCommand(['commit', '-m', userMessage], cwd);
 *
 * // INSECURE - Never do this!
 * await execAsync(`git commit -m "${userMessage}"`, { cwd });
 *
 * WHY:
 * - exec() spawns a shell that interprets special characters ($, `, ;, |, etc.)
 * - spawn() with array args directly executes without shell interpretation
 * - Special characters become literal strings, not commands
 * - 2-3x faster (no shell spawn overhead) + more secure
 */

import { spawn } from 'child_process';

/**
 * Execute a git command securely using spawn with array arguments
 *
 * @param args - Git command arguments as an array (NOT a string)
 * @param cwd - Working directory for git command
 * @returns Promise resolving to stdout
 * @throws Error with stderr message if command fails
 *
 * @example
 * // Safe with user input
 * await execGitCommand(['add', relativePath], repoPath);
 * await execGitCommand(['commit', '-m', commitMessage], repoPath);
 * await execGitCommand(['checkout', '-b', branchName], projectPath);
 */
export function execGitCommand(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    git.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    git.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    git.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const errorMsg = stderr || `Git command failed with code ${code}`;
        reject(new Error(errorMsg));
      }
    });

    git.on('error', (error: Error) => {
      reject(error);
    });
  });
}

/**
 * Execute a git command and return both stdout and stderr
 * Useful for commands like git merge-file that may output to both
 *
 * @param args - Git command arguments as an array
 * @param cwd - Working directory for git command
 * @returns Promise resolving to { stdout, stderr, code }
 */
export function execGitCommandWithStderr(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    git.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    git.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    git.on('close', (code: number | null) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    git.on('error', (error: Error) => {
      reject(error);
    });
  });
}
