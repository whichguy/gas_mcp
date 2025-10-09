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
  description: 'Optional CommonJS module loading configuration. Controls how/when module is loaded. If not specified, preserved from existing file or uses default for new files (~200-500ms overhead for preservation). For bulk operations or large projects, provide explicit options to skip preservation.',
  nullable: true,
  additionalProperties: true,
  properties: {
    loadNow: {
      type: 'boolean',
      description: 'Load module immediately at startup (true), defer until first require() (false/undefined). When rewriting existing files, previous loadNow value is preserved unless explicitly overridden. For new files, undefined uses default lazy loading (executes on first require).',
      examples: [true, false],
      llmHints: {
        whenTrue: 'Set loadNow=true for: (1) Web app handlers: doGet(), doPost() - must be available at HTTP request time, (2) Trigger functions: onOpen(), onEdit(), onInstall() - called by GAS automatically, (3) Global functions: any function that needs to be callable immediately without require(), (4) Event registrations: modules that export __events__ object',
        whenFalse: 'Set loadNow=false for utility libraries and helper modules that are only loaded via require() calls',
        whenOmit: 'RECOMMENDED: Omit moduleOptions entirely to preserve existing setting when rewriting files. For new files, omitting creates default behavior (no loadNow, equivalent to lazy loading)',
        preservation: 'When moduleOptions parameter is omitted/undefined, system reads existing remote file and preserves current loadNow setting (~200-500ms API call overhead). For new files, uses default (null = lazy load on first require)',
        performance: 'For bulk operations on multiple files, provide explicit loadNow value to skip preservation API lookup',
        commonJsContext: 'In CommonJS, loadNow=true means module._main() executes at script startup, loadNow=false/null means it executes on first require() call'
      }
    },
    hoistedFunctions: {
      type: 'array',
      description: 'Functions to hoist as top-level declarations for Google Sheets autocomplete. These create thin bridge functions that delegate to the module implementation.',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Function name to hoist'
          },
          params: {
            type: 'array',
            items: { type: 'string' },
            description: 'Parameter names for the function'
          },
          jsdoc: {
            type: 'string',
            description: 'Optional JSDoc comment with @customfunction tag. If omitted, a default comment is generated.'
          }
        },
        required: ['name', 'params']
      },
      llmHints: {
        whenToUse: 'Use for Google Sheets custom functions that need autocomplete. The hoisted bridge delegates to the module implementation.',
        placement: 'Bridge functions are placed after _main() and before __defineModule__(), visible at parse time for Sheets autocomplete.',
        pattern: 'Bridge function calls require("moduleName").functionName(params) to delegate to the wrapped implementation.',
        example: 'hoistedFunctions: [{ name: "ASK_CLAUDE", params: ["prompt", "range"], jsdoc: "/** @customfunction */" }]'
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
  description: 'Raw user JavaScript content. The CommonJS module system will automatically wrap your code in a _main() function, making the require() function, module object, and exports object available to all your code. Do NOT manually include _main() function or __defineModule__ calls - they are generated automatically by the CommonJS system (see CommonJS.js for implementation details).',
  examples: [
    'function calculateTax(amount) { return amount * 0.08; }\\nreturn { calculateTax };',
    'const utils = require("Utils");\\nfunction process(data) { return utils.clean(data); }\\nmodule.exports = { process };',
    'const config = require("Config");\\nexports.apiKey = config.getKey();'
  ],
  llmHints: {
    gas_write: 'Use gas_write when: (1) Creating new files from scratch, (2) Making large changes affecting multiple sections, (3) Refactoring entire file structure',
    gas_edit: 'Use gas_edit for small exact-text changes (outputs ~10 tokens vs ~4,500 tokens for gas_write) when you know the exact text to replace',
    gas_aider: 'Use gas_aider for small changes with formatting variations (fuzzy matching + 95%+ token savings) when text might have whitespace/formatting differences',
    tokenEfficiency: '⚠️ IMPORTANT: For small changes to existing files, consider using gas_edit or gas_aider instead for 95%+ token savings',
    decisionTree: {
      'Creating new file?': 'Use gas_write (file creation)',
      'Small change to existing file?': 'Use gas_edit (exact match) or gas_aider (fuzzy match) for 95%+ token savings',
      'Large changes or refactoring?': 'Use gas_write (entire file replacement)'
    }
  }
} as const;
