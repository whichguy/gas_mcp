#!/usr/bin/env node
/**
 * Experimental Test: defer_loading and Tool Search API
 *
 * Purpose: Verify if Claude API respects defer_loading when tools are passed
 * with this field set, enabling on-demand tool discovery.
 *
 * Test scenarios:
 * 1. Pass tools with defer_loading: true + tool_search_tool
 * 2. Ask Claude to perform a task requiring the deferred tool
 * 3. Observe if Claude uses tool_search to discover it
 *
 * Run: node test/experiments/defer-loading-test.mjs
 *
 * Requires: ANTHROPIC_API_KEY environment variable
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// Define a simple calculator tool with defer_loading
const DEFERRED_TOOLS = [
  {
    name: "calculate_sum",
    description: "Adds two numbers together and returns the result",
    input_schema: {
      type: "object",
      properties: {
        a: { type: "number", description: "First number" },
        b: { type: "number", description: "Second number" }
      },
      required: ["a", "b"]
    },
    // EXPERIMENTAL: defer_loading flag
    defer_loading: true
  },
  {
    name: "calculate_product",
    description: "Multiplies two numbers together and returns the result",
    input_schema: {
      type: "object",
      properties: {
        a: { type: "number", description: "First number" },
        b: { type: "number", description: "Second number" }
      },
      required: ["a", "b"]
    },
    // EXPERIMENTAL: defer_loading flag
    defer_loading: true
  }
];

// Regular tool (not deferred) for comparison
const REGULAR_TOOLS = [
  {
    name: "get_current_time",
    description: "Returns the current time",
    input_schema: {
      type: "object",
      properties: {},
      required: []
    }
  }
];

async function runTest(testName, tools, betas, prompt) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${testName}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Tools passed: ${tools.map(t => t.name).join(', ')}`);
  console.log(`Betas: ${betas?.join(', ') || 'none'}`);
  console.log(`Prompt: "${prompt}"`);
  console.log('-'.repeat(60));

  try {
    const requestBody = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      tools: tools,
      messages: [{ role: "user", content: prompt }]
    };

    // Add betas if specified
    const options = betas ? { headers: { 'anthropic-beta': betas.join(',') } } : {};

    const response = await client.messages.create(requestBody, options);

    console.log(`\nResponse:`);
    console.log(`  Stop reason: ${response.stop_reason}`);
    console.log(`  Usage: input=${response.usage.input_tokens}, output=${response.usage.output_tokens}`);

    // Check for tool use
    const toolUses = response.content.filter(c => c.type === 'tool_use');
    if (toolUses.length > 0) {
      console.log(`  Tool calls:`);
      toolUses.forEach(tu => {
        console.log(`    - ${tu.name}(${JSON.stringify(tu.input)})`);
      });
    }

    // Show text responses
    const textBlocks = response.content.filter(c => c.type === 'text');
    if (textBlocks.length > 0) {
      console.log(`  Text response:`);
      textBlocks.forEach(tb => {
        console.log(`    "${tb.text.substring(0, 200)}${tb.text.length > 200 ? '...' : ''}"`);
      });
    }

    return response;
  } catch (error) {
    console.log(`\nERROR: ${error.message}`);
    if (error.status) console.log(`  Status: ${error.status}`);
    if (error.error?.error?.message) console.log(`  API Error: ${error.error.error.message}`);
    return null;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  EXPERIMENTAL: defer_loading and Tool Search API Test      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\nERROR: ANTHROPIC_API_KEY environment variable not set');
    console.error('Set it with: export ANTHROPIC_API_KEY=sk-ant-...');
    process.exit(1);
  }

  // Test 1: Baseline - Regular tools (no defer_loading)
  await runTest(
    "1. Baseline - Regular tools",
    REGULAR_TOOLS,
    null,
    "What time is it?"
  );

  // Test 2: Tools with defer_loading but NO beta header
  await runTest(
    "2. defer_loading WITHOUT beta header",
    DEFERRED_TOOLS,
    null,
    "What is 5 + 3?"
  );

  // Test 3: Tools with defer_loading WITH advanced-tool-use beta
  // FIXED: Need at least one non-deferred tool!
  const MIXED_TOOLS = [
    ...REGULAR_TOOLS,  // At least one non-deferred
    ...DEFERRED_TOOLS  // Deferred tools
  ];

  await runTest(
    "3. FIXED: defer_loading WITH one non-deferred tool",
    MIXED_TOOLS,
    ['advanced-tool-use-2025-11-20'],
    "What is 5 + 3?"
  );

  // Test 4: Combined - tool_search_tool + deferred tools
  // FIXED: Correct tool_search_tool format
  const TOOL_SEARCH_TOOL = {
    type: "tool_search_tool_bm25_20251119",
    name: "tool_search_tool_bm25",  // FIXED: Must be exactly this name
    max_results: 5
  };

  await runTest(
    "4. FIXED: tool_search_tool + defer_loading tools",
    [TOOL_SEARCH_TOOL, ...DEFERRED_TOOLS],
    ['advanced-tool-use-2025-11-20'],
    "I need to add 5 and 3 together. Can you help me find the right tool and use it?"
  );

  // Test 5: MCP-style annotations.priority instead of defer_loading
  const TOOLS_WITH_PRIORITY = DEFERRED_TOOLS.map(tool => ({
    ...tool,
    defer_loading: undefined, // Remove defer_loading
    annotations: {
      priority: 0.1 // Low priority = should be deferred
    }
  }));

  await runTest(
    "5. MCP annotations.priority (0.1) WITHOUT beta",
    TOOLS_WITH_PRIORITY,
    null,
    "What is 5 + 3?"
  );

  await runTest(
    "6. MCP annotations.priority (0.1) WITH beta",
    TOOLS_WITH_PRIORITY,
    ['advanced-tool-use-2025-11-20'],
    "What is 5 + 3?"
  );

  // Test 7: High tool count simulation (would this trigger auto-defer?)
  // FIXED: Need at least one non-deferred tool
  const MANY_TOOLS = Array.from({ length: 50 }, (_, i) => ({
    name: `utility_function_${i}`,
    description: `Utility function number ${i} that does something specific`,
    input_schema: {
      type: "object",
      properties: { input: { type: "string" } },
      required: ["input"]
    },
    defer_loading: true
  }));

  // Add our actual tools at the end, with one non-deferred
  const ALL_TOOLS = [...REGULAR_TOOLS, ...MANY_TOOLS, ...DEFERRED_TOOLS];

  await runTest(
    "7. FIXED: High tool count (53 tools, 52 deferred + 1 regular)",
    ALL_TOOLS,
    ['advanced-tool-use-2025-11-20'],
    "I need to calculate 5 + 3. Find the appropriate tool."
  );

  console.log('\n' + '='.repeat(60));
  console.log('EXPERIMENTS COMPLETE');
  console.log('='.repeat(60));
  console.log('\nKey observations to look for:');
  console.log('  1. Does defer_loading reduce input token count?');
  console.log('  2. Does tool_search_tool get called before deferred tools?');
  console.log('  3. Does annotations.priority have any effect?');
  console.log('  4. Are there any API errors for unknown fields?');
}

main().catch(console.error);
