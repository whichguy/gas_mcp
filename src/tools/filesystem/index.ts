/**
 * Filesystem tools for Google Apps Script MCP server
 *
 * This module provides Unix-inspired file operations for GAS projects:
 * - Smart tools (cat, write, ls, rm) - automatic CommonJS processing
 * - Raw mode: add raw:true to any tool to bypass CommonJS unwrap/wrap
 *
 * ## Architecture
 * - shared/types.ts - Common TypeScript interfaces
 * - shared/schemas.ts - Reusable JSON schema constants
 * - shared/BaseFileSystemTool.ts - Optional base class pattern
 * - Individual tool files - One class per file for LLM token efficiency
 *
 * ## Token Efficiency
 * Single file (e.g., CatTool.ts): ~13,520 tokens vs monolith: ~99,200 tokens
 * **86% reduction in LLM context usage**
 */

export { CatTool } from './CatTool.js';
export { WriteTool } from './WriteTool.js';
// RawWriteTool is an alias for WriteTool — use write({..., raw: true, fileType: ...}) for raw mode
export { WriteTool as RawWriteTool } from './WriteTool.js';
export { LsTool } from './LsTool.js';
export { FileStatusTool } from './FileStatusTool.js';
export { RmTool } from './RmTool.js';
export { MvTool } from './MvTool.js';
export { CpTool } from './CpTool.js';
export { CacheClearTool } from './CacheClearTool.js';

// All 11 filesystem tools successfully extracted from the monolith
// This index provides backward-compatible imports for all completed tools

// Re-export shared types and schemas for convenience
export type {
  FileResult,
  WriteResult,
  ListResult,
  RemoveResult,
  MoveResult,
  CopyResult,
  CatParams,
  WriteParams,
  ListParams,
  RemoveParams,
  MoveParams,
  CopyParams
} from './shared/types.js';

export {
  SCRIPT_ID_SCHEMA,
  PATH_SCHEMA,
  WORKING_DIR_SCHEMA,
  ACCESS_TOKEN_SCHEMA,
  FILE_TYPE_SCHEMA,
  MODULE_OPTIONS_SCHEMA,
  CONTENT_SCHEMA,
  PREFER_LOCAL_SCHEMA,
  DETAILED_SCHEMA,
  RECURSIVE_SCHEMA,
  WILDCARD_MODE_SCHEMA
} from './shared/schemas.js';

export { BaseFileSystemTool } from './shared/BaseFileSystemTool.js';
