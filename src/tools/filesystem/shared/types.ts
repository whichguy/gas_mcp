/**
 * Shared type definitions for filesystem tools
 */

import type { CompactGitHint } from '../../../utils/gitStatus.js';

/**
 * Content change detection info for cat responses.
 * Signals whether file content differs from what the LLM previously read.
 */
export interface ContentChangeInfo {
  /** Whether content has changed since last cached local version */
  changed: boolean;
  /** Hash of previously cached content (null if first read or no cache) */
  previousHash: string | null;
  /** Hash of current content being returned */
  currentHash: string;
  /** What triggered the change detection */
  source: 'fast_path_cache' | 'slow_path_sync' | 'first_read';
}

export interface FileResult {
  filename: string;
  content: string;
  size?: number;
  type?: string;
  lastModified?: string;
  commonJsInfo?: {
    moduleUnwrapped: boolean;
    originalLength: number;
    unwrappedLength: number;
    hasRequire?: boolean;
    hasModuleExports?: boolean;
    hasExports?: boolean;
  };
  /** Signals whether file content differs from last cached read */
  contentChange?: ContentChangeInfo;
  /** Git workflow hint for LLM guidance */
  git?: CompactGitHint;
}

export interface WriteResult {
  success: boolean;
  path: string;
  size?: number;
  localPath?: string;
  remotePath?: string;
  commonJsInfo?: {
    moduleWrapped: boolean;
    originalLength: number;
    wrappedLength: number;
  };
  hookValidation?: {
    hooksRan: boolean;
    filesModified: string[];
    commitHash?: string;
  };
  git?: CompactGitHint;
}

export interface ListResult {
  files: Array<{
    name: string;
    type: string;
    size?: number;
    lastModified?: string;
    isVirtual?: boolean;
  }>;
  totalFiles: number;
  path: string;
  /** Git workflow hint for LLM guidance */
  git?: CompactGitHint;
}

export interface RemoveResult {
  success: boolean;
  path: string;
  localDeleted: boolean;
  remoteDeleted: boolean;
  git?: CompactGitHint;
}

export interface MoveResult {
  status: string;
  from: string;
  to: string;
  fromProjectId: string;
  toProjectId: string;
  isCrossProject: boolean;
  totalFiles?: number;
  sourceFilesRemaining?: number;
  destFilesTotal?: number;
  message: string;
  git?: CompactGitHint;
}

export interface CopyResult {
  status: string;
  from: string;
  to: string;
  fromProjectId: string;
  toProjectId: string;
  isCrossProject: boolean;
  commonJsProcessed: boolean;
  size: number;
  totalFiles: number;
  message: string;
  /** Git SHA-1 hash of the destination file after copy (computed on unwrapped content). */
  hash?: string;
  /** Explanation of hash computation for LLM guidance. */
  hashNote?: string;
  git?: CompactGitHint;
  /** Cross-project manifest compatibility warnings */
  manifestHints?: {
    differences: string[];
    recommendation?: string;
  };
}

export interface FileParams {
  scriptId: string;
  path: string;
  workingDir?: string;
  accessToken?: string;
}

export interface CatParams extends FileParams {
  preferLocal?: boolean;
  /** Write content to this local file. Creates parent dirs. Supports ~ expansion. */
  toLocal?: string;
}

export interface WriteParams extends FileParams {
  /** Content to write. Required unless fromLocal is provided. */
  content?: string;
  /** Read content from this local file instead of content param. Supports ~ expansion. */
  fromLocal?: string;
  fileType?: 'SERVER_JS' | 'HTML' | 'JSON';
  localOnly?: boolean;
  remoteOnly?: boolean;
  moduleOptions?: {
    loadNow?: boolean | null;
    hoistedFunctions?: Array<{
      name: string;
      params: string[];
      jsdoc?: string;
    }>;
  };
  force?: boolean;
  /** Git SHA-1 hash (40 hex chars) from previous cat. If differs from remote, write fails with ConflictError. */
  expectedHash?: string;
  changeReason?: string;
  projectPath?: string;
}

export interface ListParams {
  scriptId?: string;
  path?: string;
  detailed?: boolean;
  recursive?: boolean;
  wildcardMode?: 'filename' | 'fullpath' | 'auto';
  checksums?: boolean;
  workingDir?: string;
  accessToken?: string;
}

export interface RemoveParams extends FileParams {
  changeReason?: string;
}

export interface MoveParams {
  scriptId: string;
  from: string;
  to: string;
  changeReason?: string;
  workingDir?: string;
  accessToken?: string;
}

export interface CopyParams {
  scriptId: string;
  from: string;
  to: string;
  changeReason?: string;
  /** Git SHA-1 hash (40 hex chars) of source file from previous cat. If source differs, copy fails with ConflictError. */
  expectedHash?: string;
  /** Force copy even if source file hash mismatches. Use only when intentionally copying modified source. */
  force?: boolean;
  workingDir?: string;
  accessToken?: string;
}
