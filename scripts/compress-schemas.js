#!/usr/bin/env node

/**
 * Schema Compression Script for MCP-Gas
 *
 * This script automatically compresses tool schemas by:
 * 1. Shortening descriptions to max 10 words
 * 2. Removing llmHints, llmGuidance, llmWorkflowGuide objects
 * 3. Simplifying examples arrays (max 2, no duplicates of enums)
 * 4. Preserving removed content as comments
 *
 * Target: Reduce schema tokens from ~57k to ~25k
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

// Configuration
const TOOLS_DIR = path.join(__dirname, '../src/tools');
const MAX_DESCRIPTION_WORDS = 10;
const MAX_PARAM_DESC_WORDS = 8;
const MAX_EXAMPLES = 2;

// Track statistics
let stats = {
  filesProcessed: 0,
  descriptionsCompressed: 0,
  llmHintsRemoved: 0,
  llmGuidanceRemoved: 0,
  llmWorkflowGuideRemoved: 0,
  examplesSimplified: 0,
  totalLinesRemoved: 0,
  totalCharsSaved: 0
};

/**
 * Compress a description string to max words
 */
function compressDescription(desc, maxWords = MAX_DESCRIPTION_WORDS) {
  if (!desc) return desc;

  // Common verbose patterns to replace
  const replacements = [
    [/^This tool allows you to\s+/i, ''],
    [/^Tool for\s+/i, ''],
    [/^Use this tool to\s+/i, ''],
    [/\s+with detailed\s+\S+/gi, ''],
    [/\s+including\s+[^.]+/gi, ''],
    [/\s+such as\s+[^.]+/gi, ''],
    [/\s+for example[^.]+/gi, ''],
    [/Google Apps Script/g, 'GAS'],
    [/authentication/gi, 'auth'],
    [/configuration/gi, 'config'],
    [/information/gi, 'info'],
    [/synchronization/gi, 'sync'],
    [/application/gi, 'app'],
    [/automatically/gi, 'auto'],
  ];

  let compressed = desc;
  for (const [pattern, replacement] of replacements) {
    compressed = compressed.replace(pattern, replacement);
  }

  // Truncate to max words
  const words = compressed.split(/\s+/);
  if (words.length > maxWords) {
    compressed = words.slice(0, maxWords).join(' ');
    if (!compressed.endsWith('.')) compressed += '.';
  }

  stats.totalCharsSaved += desc.length - compressed.length;
  return compressed;
}

/**
 * Process a TypeScript file to compress schemas
 */
function processFile(filePath) {
  console.log(`Processing: ${path.basename(filePath)}`);

  const content = fs.readFileSync(filePath, 'utf8');
  const originalLength = content.length;
  let modified = content;

  // Pattern 1: Compress tool description
  modified = modified.replace(
    /public\s+description\s*=\s*['"`]([^'"`]+)['"`]/g,
    (match, desc) => {
      stats.descriptionsCompressed++;
      const compressed = compressDescription(desc);
      return `public description = '${compressed}'`;
    }
  );

  // Pattern 2: Remove llmWorkflowGuide from inputSchema
  modified = modified.replace(
    /,?\s*llmWorkflowGuide\s*:\s*\{[^}]*(?:\{[^}]*\}[^}]*)?\}/g,
    (match) => {
      stats.llmWorkflowGuideRemoved++;
      const comment = match.replace(/\n/g, '\n    // ');
      return `\n    /* REMOVED FOR TOKEN OPTIMIZATION:\n    // ${comment}\n    */`;
    }
  );

  // Pattern 3: Remove llmGuidance from inputSchema
  modified = modified.replace(
    /,?\s*llmGuidance\s*:\s*\{[^}]*(?:\{[^}]*\}[^}]*)?\}/g,
    (match) => {
      stats.llmGuidanceRemoved++;
      const comment = match.replace(/\n/g, '\n    // ');
      return `\n    /* REMOVED FOR TOKEN OPTIMIZATION:\n    // ${comment}\n    */`;
    }
  );

  // Pattern 4: Remove llmHints from properties
  modified = modified.replace(
    /,?\s*llmHints\s*:\s*\{[^}]*(?:\{[^}]*\}[^}]*)?\}/g,
    (match) => {
      stats.llmHintsRemoved++;
      return ''; // Remove completely from properties
    }
  );

  // Pattern 5: Compress parameter descriptions
  modified = modified.replace(
    /description:\s*['"`]([^'"`]{50,})['"`]/g,
    (match, desc) => {
      const compressed = compressDescription(desc, MAX_PARAM_DESC_WORDS);
      if (compressed !== desc) {
        stats.descriptionsCompressed++;
      }
      return `description: '${compressed}'`;
    }
  );

  // Pattern 6: Simplify examples arrays
  modified = modified.replace(
    /examples:\s*\[[^\]]+\]/g,
    (match) => {
      // Extract the array content
      const arrayMatch = match.match(/\[([^\]]+)\]/);
      if (!arrayMatch) return match;

      const items = arrayMatch[1]
        .split(',')
        .map(item => item.trim())
        .filter(item => item && item !== '');

      if (items.length > MAX_EXAMPLES) {
        stats.examplesSimplified++;
        const simplified = items.slice(0, MAX_EXAMPLES).join(', ');
        return `examples: [${simplified}]`;
      }

      return match;
    }
  );

  // Pattern 7: Remove duplicate examples that match enums
  // This is more complex and requires parsing context, so simplified approach:
  modified = modified.replace(
    /enum:\s*\[([^\]]+)\],\s*examples:\s*\[([^\]]+)\]/g,
    (match, enumValues, exampleValues) => {
      // If they're essentially the same, remove examples
      if (enumValues.replace(/['"` ]/g, '') === exampleValues.replace(/['"` ]/g, '')) {
        stats.examplesSimplified++;
        return `enum: [${enumValues}]`;
      }
      return match;
    }
  );

  if (modified !== content) {
    fs.writeFileSync(filePath, modified);
    stats.filesProcessed++;
    stats.totalCharsSaved += originalLength - modified.length;
    console.log(`  ✓ Saved ${originalLength - modified.length} characters`);
  } else {
    console.log(`  - No changes needed`);
  }
}

/**
 * Process all tool files
 */
function processAllTools() {
  console.log('Starting schema compression...\n');

  // Get all TypeScript files in tools directory
  const files = [];

  function findFiles(dir) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip test directories
        if (!item.includes('test') && !item.includes('__tests__')) {
          findFiles(fullPath);
        }
      } else if (item.endsWith('.ts')) {
        // Skip test files and non-tool files
        if (!item.includes('.test.') &&
            !item.includes('.spec.') &&
            item !== 'index.ts' &&
            item !== 'types.ts' &&
            item !== 'schemas.ts') {
          files.push(fullPath);
        }
      }
    }
  }

  findFiles(TOOLS_DIR);

  console.log(`Found ${files.length} tool files to process\n`);

  // Process each file
  for (const file of files) {
    try {
      processFile(file);
    } catch (error) {
      console.error(`  ✗ Error processing ${path.basename(file)}: ${error.message}`);
    }
  }

  // Report statistics
  console.log('\n' + '='.repeat(60));
  console.log('COMPRESSION COMPLETE');
  console.log('='.repeat(60));
  console.log(`Files processed: ${stats.filesProcessed}`);
  console.log(`Descriptions compressed: ${stats.descriptionsCompressed}`);
  console.log(`llmHints removed: ${stats.llmHintsRemoved}`);
  console.log(`llmGuidance removed: ${stats.llmGuidanceRemoved}`);
  console.log(`llmWorkflowGuide removed: ${stats.llmWorkflowGuideRemoved}`);
  console.log(`Examples simplified: ${stats.examplesSimplified}`);
  console.log(`Total characters saved: ${stats.totalCharsSaved.toLocaleString()}`);
  console.log(`Estimated tokens saved: ~${Math.round(stats.totalCharsSaved / 4).toLocaleString()}`);
  console.log('='.repeat(60));
  console.log('\nNext steps:');
  console.log('1. Run: npm run build');
  console.log('2. Restart Claude Code or use /mcp reconnect');
  console.log('3. Check token reduction with /context');
}

// Run the script
if (require.main === module) {
  processAllTools();
}

module.exports = { compressDescription, processFile };