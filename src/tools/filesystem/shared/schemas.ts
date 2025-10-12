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
  description: 'CommonJS module config: loadNow (eager/lazy loading), hoistedFunctions (Sheets autocomplete). Omit to preserve existing (~200ms overhead).',
  nullable: true,
  additionalProperties: true,
  properties: {
    loadNow: {
      type: 'boolean',
      description: 'true=execute at startup (doGet/doPost/triggers), false=lazy on first require() (utils/libs). Omit=preserve existing.',
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
  description: 'Include detailed file information (size, type, timestamps, last modifier, etc.) - defaults to true'
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
