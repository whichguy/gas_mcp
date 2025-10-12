#!/usr/bin/env node

/**
 * Measure token usage of MCP tool schemas
 */

const fs = require('fs');
const path = require('path');

// Simple token estimation: ~4 characters per token
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// Load all tool files
const toolsDir = path.join(__dirname, '../src/tools');

function getAllTools() {
  const tools = [];

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        const content = fs.readFileSync(fullPath, 'utf8');

        // Extract tool class names
        const classMatches = content.matchAll(/export class (\w+Tool) extends BaseTool/g);

        for (const match of classMatches) {
          const className = match[1];

          // Find inputSchema
          const schemaMatch = content.match(/public inputSchema = \{[\s\S]*?\n  \};/);
          if (schemaMatch) {
            const schemaText = schemaMatch[0];
            const tokens = estimateTokens(schemaText);

            tools.push({
              name: className,
              file: path.relative(toolsDir, fullPath),
              tokens,
              size: schemaText.length
            });
          }
        }
      }
    }
  }

  scanDir(toolsDir);
  return tools;
}

// Main execution
console.log('=== MCP Gas Tools Token Measurement ===\n');

const tools = getAllTools();

// Sort by tokens descending
tools.sort((a, b) => b.tokens - a.tokens);

console.log('Top 15 Largest Tool Schemas:\n');
for (let i = 0; i < Math.min(15, tools.length); i++) {
  const tool = tools[i];
  console.log(`  ${(i+1).toString().padStart(2)}. ${tool.name.padEnd(35)} ${tool.tokens.toString().padStart(6)} tokens  (${tool.size.toLocaleString()} chars)`);
}

const totalTokens = tools.reduce((sum, tool) => sum + tool.tokens, 0);
const totalChars = tools.reduce((sum, tool) => sum + tool.size, 0);

console.log(`\n${'='.repeat(70)}`);
console.log(`Total Tools: ${tools.length}`);
console.log(`Total Estimated Tokens: ${totalTokens.toLocaleString()}`);
console.log(`Total Characters: ${totalChars.toLocaleString()}`);
console.log(`Average per Tool: ${Math.round(totalTokens / tools.length)} tokens`);
console.log(`\nContext Budget: 200,000 tokens`);
console.log(`Tool Schemas Usage: ${totalTokens.toLocaleString()} tokens (${((totalTokens / 200000) * 100).toFixed(1)}%)`);
console.log(`Remaining Budget: ${(200000 - totalTokens).toLocaleString()} tokens`);
