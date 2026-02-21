/**
 * writeHints - Build post-write workflow steps for LLM guidance.
 *
 * Surfaces a compact `workflow` array on the CompactGitHint when git.blocked is true,
 * sequencing: review → commit → push/finish, with conditional additions for
 * batching (3+ uncommitted files) and branching (currently on main/master).
 */
import type { CompactGitHint } from './gitStatus.js';

/**
 * Build compact workflow steps for post-write LLM guidance.
 * Only returns steps when git.blocked is true.
 *
 * Conditions:
 *   review + commit + push/finish steps: always when blocked (and not detached HEAD)
 *   "finish" vs "push": branch.startsWith('llm-feature-')
 *   batching tip: uncommitted >= 3
 *   branch tip: branch === 'main' || branch === 'master'
 *   detached HEAD (branch === 'HEAD' || branch === 'unknown'): special guidance only
 *
 * @param gitHint - CompactGitHint from buildCompactGitHint
 * @param scriptId - GAS script ID for constructing tool calls in hints
 * @returns Array of workflow step strings, or [] if not blocked
 */
export function buildWriteWorkflowHints(gitHint: CompactGitHint, scriptId: string): string[] {
  if (!gitHint.blocked) return [];

  const branch = gitHint.branch;

  // Detached HEAD — don't recommend push/finish, suggest fixing state first.
  // Guard covers: 'HEAD' (rev-parse output via buildCompactGitHint),
  // 'unknown' (error fallback), and 'HEAD (detached)' (buildGitHint verbose form).
  if (branch === 'HEAD' || branch === 'unknown' || branch.startsWith('HEAD (')) {
    return [
      `⚠ Detached HEAD — fix: git_feature({operation:"start",scriptId:"${scriptId}",featureName:"fix"})`,
      `Then commit: git_feature({operation:"commit",scriptId:"${scriptId}",message:"feat:..."})`,
    ];
  }

  const isFeature = branch.startsWith('llm-feature-');
  const steps: string[] = [
    '1. Review: /review-fix',
    `2. Commit: git_feature({operation:"commit",scriptId:"${scriptId}",message:"feat:..."})`,
    isFeature
      ? `3. Finish: git_feature({operation:"finish",scriptId:"${scriptId}",pushToRemote:true})`
      : `3. Push: git_feature({operation:"push",scriptId:"${scriptId}"})`,
  ];

  if (gitHint.uncommitted >= 3) {
    steps.push(
      `Batch tip: edit ~/gas-repos/project-${scriptId}/ locally → rsync({operation:"push",scriptId:"${scriptId}"}) — ${gitHint.uncommitted} files in 2 API calls`
    );
  }

  if (branch === 'main' || branch === 'master') {
    steps.push(
      `Branch tip: git_feature({operation:"start",scriptId:"${scriptId}",featureName:"my-feature"}) before next session`
    );
  }

  return steps;
}
