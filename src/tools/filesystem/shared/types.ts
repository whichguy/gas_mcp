/**
 * Shared type definitions for filesystem tools
 */

/**
 * Git hints returned from write operations for LLM guidance.
 * Used to signal that explicit commit is needed.
 */
export interface GitHints {
  detected: boolean;
  branch?: string;
  staged?: boolean;
  uncommittedChanges?: {
    count: number;
    files: string[];
    hasMore?: boolean;
    thisFile?: boolean;
  };
  recommendation?: {
    urgency: 'CRITICAL' | 'HIGH' | 'NORMAL';
    action: 'commit';
    command: string;
    reason: string;
  };
  taskCompletionBlocked?: boolean;
}

/**
 * Next action hint for workflow completion
 */
export interface NextActionHint {
  hint: string;
  required: boolean;
  /** Rsync command to sync local git with GAS. Always included when git.detected is true. */
  rsync?: string;
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
  git?: GitHints;
  nextAction?: NextActionHint;
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
}

export interface RemoveResult {
  success: boolean;
  path: string;
  localDeleted: boolean;
  remoteDeleted: boolean;
  git?: GitHints;
  nextAction?: NextActionHint;
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
  git?: GitHints;
  nextAction?: NextActionHint;
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
  git?: GitHints;
  nextAction?: NextActionHint;
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
  workingDir?: string;
  accessToken?: string;
}
