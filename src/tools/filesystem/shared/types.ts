/**
 * Shared type definitions for filesystem tools
 */

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
}

export interface FileParams {
  scriptId: string;
  path: string;
  workingDir?: string;
  accessToken?: string;
}

export interface CatParams extends FileParams {
  preferLocal?: boolean;
}

export interface WriteParams extends FileParams {
  content: string;
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

export interface RemoveParams extends FileParams {}

export interface MoveParams {
  scriptId: string;
  from: string;
  to: string;
  workingDir?: string;
  accessToken?: string;
}

export interface CopyParams {
  scriptId: string;
  from: string;
  to: string;
  workingDir?: string;
  accessToken?: string;
}
