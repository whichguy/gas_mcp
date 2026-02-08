/**
 * @fileoverview Centralized response hint formatter for file-modifying tools
 *
 * Enriches tool responses with consistent hints:
 * 1. Sync hints (recovery commands when local/remote drift)
 * 2. Batch workflow hints (when local git mirror exists)
 * 3. Next action hints (commit/finish guidance)
 *
 * Additive only: never overwrites existing hints.
 */

import { generateSyncHints, type GenerateSyncHintsParams } from '../../../utils/syncHints.js';
import type { ResponseHints } from './types.js';

/**
 * Context needed to generate response hints
 */
export interface HintContext {
  /** GAS project script ID */
  scriptId: string;
  /** Files affected by the operation */
  affectedFiles: string[];
  /** Type of operation performed (for sync hints and commit message defaults) */
  operationType: GenerateSyncHintsParams['operation'];
  /** Whether local xattr cache was updated */
  localCacheUpdated: boolean;
  /** Whether remote GAS was updated */
  remotePushed: boolean;
}

/**
 * Enrich a tool response with consistent hints.
 *
 * This function is additive -- it only adds hints that are not already present.
 * Safe to call on results that already have partial hints.
 *
 * Works with any result object that has optional git/nextAction/syncHints/responseHints fields.
 * Uses duck typing via `any` cast to avoid tight coupling to specific result interfaces.
 *
 * @param result - The tool result to enrich (mutated in place and returned)
 * @param context - Context about the operation for generating hints
 * @returns The same result object with hints added
 */
export function enrichResponseWithHints<T>(result: T, context: HintContext): T {
  const r = result as any;

  // 1. Add sync hints if not already present
  if (!r.syncHints) {
    r.syncHints = generateSyncHints({
      scriptId: context.scriptId,
      operation: context.operationType,
      affectedFiles: context.affectedFiles,
      localCacheUpdated: context.localCacheUpdated,
      remotePushed: context.remotePushed,
    });
  }

  // 2. Add batch workflow hint when local git mirror exists
  const git = r.git;
  const syncFolder = git?.syncFolder;
  const gitDetected = git?.detected || git?.localGitDetected;

  if (gitDetected && syncFolder) {
    const existing = r.responseHints as ResponseHints | undefined;

    if (!existing?.batchWorkflow) {
      // Detect multi-file pattern: uncommitted count or multiple affected files
      const uncommittedCount = git?.uncommittedChanges?.count ?? 0;
      const isMultiFile = uncommittedCount >= 2 || context.affectedFiles.length >= 2;

      r.responseHints = {
        ...(existing || {}),
        batchWorkflow: {
          urgency: isMultiFile ? 'HIGH' as const : 'NORMAL' as const,
          when: 'Modifying 3+ files',
          workflow: [
            `Edit files locally at ${syncFolder}/ using Claude Code native Read/Write/Edit tools`,
            `rsync({operation:"plan", scriptId:"${context.scriptId}", direction:"push"}) to preview`,
            `rsync({operation:"execute", planId:"<from plan>", scriptId:"${context.scriptId}"}) to push all at once`,
          ],
          benefit: '2 API calls for N files vs 2N for sequential writes',
        },
      };
    }
  }

  // 3. Ensure nextAction hint is present when git is detected with uncommitted changes
  if (!r.nextAction && gitDetected) {
    const hasUncommitted =
      git?.uncommittedChanges?.count != null &&
      git.uncommittedChanges.count > 0;

    if (hasUncommitted) {
      r.nextAction = {
        hint: `Commit changes: git_feature({operation:"commit", scriptId:"${context.scriptId}", message:"${context.operationType}: ${context.affectedFiles[0] || 'files'}"})`,
        required: true,
      };
    }
  }

  return result;
}
