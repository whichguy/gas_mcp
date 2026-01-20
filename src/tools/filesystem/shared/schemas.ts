/**
 * Shared JSON schema definitions for filesystem tools
 * Eliminates duplication across 9 tool classes
 */

import { SchemaFragments } from '../../../utils/schemaFragments.js';

export const SCRIPT_ID_SCHEMA = SchemaFragments.scriptId44;

export const PATH_SCHEMA = SchemaFragments.path;

export const WORKING_DIR_SCHEMA = SchemaFragments.workingDir;

export const ACCESS_TOKEN_SCHEMA = SchemaFragments.accessToken;

export const FILE_TYPE_SCHEMA = {
  type: 'string',
  description: 'Explicit file type for Google Apps Script (optional). If not provided, auto-detected from content.',
  enum: ['SERVER_JS', 'HTML', 'JSON'],
  examples: ['SERVER_JS', 'HTML', 'JSON']
} as const;

export const MODULE_OPTIONS_SCHEMA = {
  type: 'object',
  description: 'CommonJS module configuration. ⚠️ CRITICAL: Event handlers require loadNow: true. Omit to preserve existing (~200ms overhead).',
  nullable: true,
  additionalProperties: true,
  properties: {
    loadNow: {
      type: 'boolean',
      description: 'Module loading strategy:\n  • true: Execute at script startup (REQUIRED for event handlers: doGet, doPost, onOpen, onEdit, and __events__ registration)\n  • false: Execute on first require() call (for utility modules)\n  • omit: Preserve existing setting (~200ms API overhead)\n\n⚠️ Common error: Event handlers fail silently without loadNow: true',
      examples: [true, false]
    },
    hoistedFunctions: {
      type: 'array',
      description: 'Array of {name, params, jsdoc?} for Sheets custom functions autocomplete.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Function name' },
          params: { type: 'array', items: { type: 'string' }, description: 'Parameter names' },
          jsdoc: { type: 'string', description: 'Optional JSDoc with @customfunction' }
        },
        required: ['name', 'params']
      }
    }
  }
} as const;

export const BOOLEAN_FLAG_SCHEMA = {
  type: 'boolean',
  default: false
} as const;

export const PREFER_LOCAL_SCHEMA = {
  ...BOOLEAN_FLAG_SCHEMA,
  default: true,
  description: 'Prefer local file over remote when both exist'
} as const;

export const DETAILED_SCHEMA = {
  ...BOOLEAN_FLAG_SCHEMA,
  default: true,
  description: 'Include detailed file information (size, type, position, timestamps, last modifier, etc.) - defaults to true. Position field shows actual GAS execution order (0-based), preserved even when filtering'
} as const;

export const RECURSIVE_SCHEMA = {
  ...BOOLEAN_FLAG_SCHEMA,
  default: true,
  description: 'List files with matching filename prefixes (no real directories exist in GAS)'
} as const;

export const WILDCARD_MODE_SCHEMA = {
  type: 'string',
  description: 'Wildcard matching mode: filename (match basename only), fullpath (match full path), auto (detect from pattern)',
  enum: ['filename', 'fullpath', 'auto'],
  default: 'auto'
} as const;

export const CONTENT_SCHEMA = {
  type: 'string',
  description: 'JavaScript code (auto-wrapped with CommonJS require/exports). Do not include _main() or __defineModule__.',
  examples: [
    'function add(a,b){return a+b}\\nmodule.exports={add}',
    'const utils=require("Utils");exports.process=data=>utils.clean(data)'
  ],
  llmHints: {
    toolChoice: 'write: new/large changes | edit: exact text (~10 tok) | aider: fuzzy (~10 tok) | 95%+ savings for small edits'
  }
} as const;

export const FORCE_SCHEMA = {
  type: 'boolean',
  description: '⚠️ Force write even if local and remote are out of sync (WARNING: may overwrite remote changes)',
  default: false
} as const;

export const EXPECTED_HASH_SCHEMA = {
  type: 'string',
  description: 'Git SHA-1 hash (40 hex chars) from previous cat. If provided and differs from current remote, operation fails with ConflictError. Use force:true to bypass.',
  pattern: '^[a-f0-9]{40}$',
  examples: ['a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2']
} as const;
