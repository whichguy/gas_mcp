/**
 * Shared type definitions for Google Apps Script API
 *
 * This module contains all interface and type definitions used across
 * GAS API modules. Extracted from gasClient.ts for better organization.
 */

/**
 * Google Apps Script project information
 */
export interface GASProject {
  scriptId: string;
  title: string;
  parentId?: string;
  createTime?: string;
  updateTime?: string;
}

/**
 * Google Apps Script file information
 */
export interface GASFile {
  name: string;
  type: 'SERVER_JS' | 'HTML' | 'JSON';
  source?: string;
  createTime?: string;          // ✅ Creation timestamp from API
  updateTime?: string;          // ✅ Last modified timestamp from API
  lastModifyUser?: {            // ✅ Last user who modified the file
    name?: string;
    email?: string;
  };
  functionSet?: {
    values: Array<{
      name: string;
    }>;
  };
}

/**
 * Google Apps Script deployment information
 */
export interface GASDeployment {
  deploymentId: string;
  versionNumber: number;
  description?: string;
  manifestFileName?: string;
  updateTime?: string;
  webAppUrl?: string;
  deploymentConfig?: {
    scriptId: string;
    description: string;
    manifestFileName: string;
    versionNumber: number;
  };
  entryPoints?: EntryPoint[];
}

/**
 * Deployment entry point types
 */
export type EntryPointType = 'WEB_APP' | 'EXECUTION_API' | 'ADD_ON';

/**
 * Web App access levels
 */
export type WebAppAccess = 'MYSELF' | 'DOMAIN' | 'ANYONE' | 'ANYONE_ANONYMOUS';

/**
 * Web App execution context
 */
export type WebAppExecuteAs = 'USER_ACCESSING' | 'USER_DEPLOYING';

/**
 * Web App configuration
 */
export interface WebAppConfig {
  access: WebAppAccess;
  executeAs: WebAppExecuteAs;
}

/**
 * Web App entry point
 */
export interface WebAppEntryPoint {
  url?: string;
  entryPointConfig: WebAppConfig;
}

/**
 * API Executable entry point
 */
export interface ExecutionApiEntryPoint {
  entryPointConfig: {
    access: WebAppAccess;
  };
}

/**
 * Deployment entry point
 */
export interface EntryPoint {
  entryPointType: EntryPointType;
  webApp?: WebAppEntryPoint;
  executionApi?: ExecutionApiEntryPoint;
}

/**
 * Deployment configuration options
 */
export interface DeploymentOptions {
  entryPointType?: EntryPointType;
  webAppConfig?: WebAppConfig;
  accessLevel?: WebAppAccess;
}

/**
 * Execution request parameters
 */
export interface ExecutionRequest {
  function: string;
  parameters?: any[];
  devMode?: boolean;
}

/**
 * Execution response
 */
export interface ExecutionResponse {
  result?: any;
  error?: {
    type: string;
    message: string;
    scriptStackTraceElements?: Array<{
      function: string;
      lineNumber: number;
    }>;
  };
}

// Process Management Interfaces (per Google Apps Script API specification)
export type ProcessType =
  | 'PROCESS_TYPE_UNSPECIFIED'
  | 'ADD_ON'
  | 'EXECUTION_API'
  | 'TIME_DRIVEN'
  | 'TRIGGER'
  | 'WEBAPP'
  | 'EDITOR'
  | 'SIMPLE_TRIGGER'
  | 'MENU'
  | 'BATCH_TASK';

export type ProcessStatus =
  | 'PROCESS_STATUS_UNSPECIFIED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'UNKNOWN'
  | 'DELAYED';

export type UserAccessLevel =
  | 'USER_ACCESS_LEVEL_UNSPECIFIED'
  | 'NONE'
  | 'READ'
  | 'WRITE'
  | 'OWNER';

export interface ListUserProcessesFilter {
  scriptId?: string;
  deploymentId?: string;
  projectName?: string;
  functionName?: string;
  startTime?: string; // RFC3339 UTC "Zulu" format
  endTime?: string; // RFC3339 UTC "Zulu" format
  types?: ProcessType[];
  statuses?: ProcessStatus[];
  userAccessLevels?: UserAccessLevel[];
}

export interface ListScriptProcessesFilter {
  deploymentId?: string;
  functionName?: string;
  startTime?: string; // RFC3339 UTC "Zulu" format
  endTime?: string; // RFC3339 UTC "Zulu" format
  types?: ProcessType[];
  statuses?: ProcessStatus[];
  userAccessLevels?: UserAccessLevel[];
}

export interface Process {
  projectName: string;
  functionName: string;
  processType: ProcessType;
  processStatus: ProcessStatus;
  userAccessLevel: UserAccessLevel;
  startTime: string; // RFC3339 UTC "Zulu" format
  duration: string; // Duration in seconds with up to nine fractional digits, ending with 's'
}

export interface ProcessListResponse {
  processes: Process[];
  nextPageToken?: string;
}

// Metrics Interfaces (per Google Apps Script API specification)
export type MetricsGranularity =
  | 'UNSPECIFIED_GRANULARITY'
  | 'WEEKLY'
  | 'DAILY';

export interface MetricsFilter {
  deploymentId?: string;
}

export interface MetricsValue {
  value: string; // Number of executions counted
  startTime: string; // RFC3339 UTC "Zulu" format
  endTime: string; // RFC3339 UTC "Zulu" format
}

export interface ProjectMetrics {
  activeUsers: MetricsValue[];
  totalExecutions: MetricsValue[];
  failedExecutions: MetricsValue[];
}

/**
 * Execution status type for additional metadata
 */
export type ExecutionStatus = 'SUCCESS' | 'ERROR' | 'TIMEOUT';
