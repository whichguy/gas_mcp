/**
 * ListTools Token Count Baseline Test
 *
 * Measures the total token cost of the ListTools response (tool schemas sent to the LLM).
 * Uses chars/4 as a reasonable token approximation.
 *
 * Writes results to docs/metrics/baseline-2026-02.json for tracking over time.
 */
import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Import SessionAuthManager to instantiate tools
import { SessionAuthManager } from '../../src/auth/sessionManager.js';

// Import all tool classes (same as mcpServer.ts)
import { AuthTool } from '../../src/tools/auth.js';
import {
  LsTool,
  CatTool,
  WriteTool,
  FileStatusTool,
  RmTool,
  MvTool,
  CpTool,
  CacheClearTool
} from '../../src/tools/filesystem/index.js';
import { GrepTool } from '../../src/tools/grep.js';
import { FindTool } from '../../src/tools/find.js';
import { RipgrepTool } from '../../src/tools/ripgrep.js';
import { SedTool } from '../../src/tools/sed.js';
import { EditTool } from '../../src/tools/edit.js';
import { AiderTool } from '../../src/tools/aider.js';
import { DepsTool } from '../../src/tools/gas-deps.js';
import {
  ReorderTool,
  ProjectListTool
} from '../../src/tools/project.js';
import { ExecTool, ExecApiTool } from '../../src/tools/execution.js';
import {
  ProjectCreateTool,
  ProjectInitTool
} from '../../src/tools/project-lifecycle.js';
import { DeployTool } from '../../src/tools/deployment.js';
import {
  FindDriveScriptTool,
  CreateScriptTool
} from '../../src/tools/driveContainerTools.js';
import { ProcessListTool } from '../../src/tools/processes.js';
import { ExecutionsTool } from '../../src/tools/executions.js';
import { CloudLogsTool } from '../../src/tools/cloudLogs.js';
import { TriggerTool } from '../../src/tools/triggers.js';
import { RsyncTool } from '../../src/tools/rsync/index.js';
import { GitFeatureTool } from '../../src/tools/git/GitFeatureTool.js';
import { ConfigTool } from '../../src/tools/config.js';
import { SheetSqlTool } from '../../src/tools/sheets/sheetsSql.js';
import { WorktreeTool } from '../../src/tools/worktree/index.js';
import { StatusTool } from '../../src/tools/StatusTool.js';

/**
 * Token estimation: chars / 4
 * This is a standard approximation for English text with JSON structure.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract llmGuidance from an inputSchema object (recursive).
 * Returns the stringified llmGuidance content if found.
 */
function extractLlmGuidance(schema: any): string {
  if (!schema || typeof schema !== 'object') return '';

  let guidance = '';

  // Top-level llmGuidance
  if (schema.llmGuidance) {
    guidance += JSON.stringify(schema.llmGuidance);
  }

  // Check properties for nested llmGuidance / llmHints
  if (schema.properties) {
    for (const prop of Object.values(schema.properties) as any[]) {
      if (prop?.llmGuidance) {
        guidance += JSON.stringify(prop.llmGuidance);
      }
      if (prop?.llmHints) {
        guidance += JSON.stringify(prop.llmHints);
      }
      // Check nested items
      if (prop?.items?.llmGuidance) {
        guidance += JSON.stringify(prop.items.llmGuidance);
      }
      if (prop?.items?.llmHints) {
        guidance += JSON.stringify(prop.items.llmHints);
      }
    }
  }

  return guidance;
}

describe('ListTools Token Count Baseline', function () {
  this.timeout(30000);

  // All tool classes in registration order (mirrors mcpServer.ts)
  const toolClasses = [
    AuthTool,
    LsTool, FileStatusTool, CatTool, WriteTool,
    GrepTool, RipgrepTool, SedTool, EditTool, AiderTool,
    FindTool, DepsTool, RmTool, MvTool, CpTool, CacheClearTool,
    ReorderTool, ProjectCreateTool, ProjectInitTool, ProjectListTool,
    ExecTool, ExecApiTool,
    DeployTool,
    FindDriveScriptTool, CreateScriptTool,
    ProcessListTool, ExecutionsTool, CloudLogsTool,
    TriggerTool,
    RsyncTool, GitFeatureTool, ConfigTool,
    SheetSqlTool,
    WorktreeTool,
    StatusTool,
  ];

  let tools: any[];
  let toolSchemas: any[];

  before(function () {
    // Instantiate all tools with a dummy SessionAuthManager
    const authManager = new SessionAuthManager();
    tools = toolClasses.map(ToolClass => new ToolClass(authManager));

    // Build the same schema array that ListTools returns
    toolSchemas = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...((tool as any).annotations ? { annotations: (tool as any).annotations } : {}),
      ...((tool as any).outputSchema ? { outputSchema: (tool as any).outputSchema } : {}),
    }));
  });

  it('should have the expected number of registered tools', function () {
    expect(toolSchemas.length).to.be.greaterThanOrEqual(40);
    expect(toolSchemas.length).to.be.lessThanOrEqual(55);
    console.log(`  Tool count: ${toolSchemas.length}`);
  });

  it('should measure total ListTools token cost within expected range', function () {
    const fullJson = JSON.stringify(toolSchemas);
    const totalTokens = estimateTokens(fullJson);

    console.log(`  Total ListTools JSON length: ${fullJson.length} chars`);
    console.log(`  Estimated total tokens: ${totalTokens}`);

    // Expect between 30k and 60k tokens (baseline measured at ~37k)
    expect(totalTokens).to.be.greaterThanOrEqual(30000);
    expect(totalTokens).to.be.lessThanOrEqual(60000);
  });

  it('should produce per-tool token breakdown', function () {
    const perTool: Record<string, {
      description: number;
      inputSchema: number;
      llmGuidance: number;
      outputSchema: number;
      annotations: number;
      total: number;
    }> = {};

    let totalDescriptionTokens = 0;
    let totalInputSchemaTokens = 0;
    let totalLlmGuidanceTokens = 0;
    let totalOutputSchemaTokens = 0;
    let totalAnnotationsTokens = 0;

    for (const schema of toolSchemas) {
      const descStr = schema.description || '';
      const descTokens = estimateTokens(descStr);

      // Extract llmGuidance from inputSchema before measuring inputSchema
      const llmGuidanceStr = extractLlmGuidance(schema.inputSchema);
      const llmGuidanceTokens = estimateTokens(llmGuidanceStr);

      const inputSchemaStr = JSON.stringify(schema.inputSchema || {});
      const inputSchemaTokens = estimateTokens(inputSchemaStr);

      const outputSchemaStr = schema.outputSchema ? JSON.stringify(schema.outputSchema) : '';
      const outputSchemaTokens = estimateTokens(outputSchemaStr);

      const annotationsStr = schema.annotations ? JSON.stringify(schema.annotations) : '';
      const annotationsTokens = estimateTokens(annotationsStr);

      const toolTotal = estimateTokens(JSON.stringify(schema));

      perTool[schema.name] = {
        description: descTokens,
        inputSchema: inputSchemaTokens,
        llmGuidance: llmGuidanceTokens,
        outputSchema: outputSchemaTokens,
        annotations: annotationsTokens,
        total: toolTotal,
      };

      totalDescriptionTokens += descTokens;
      totalInputSchemaTokens += inputSchemaTokens;
      totalLlmGuidanceTokens += llmGuidanceTokens;
      totalOutputSchemaTokens += outputSchemaTokens;
      totalAnnotationsTokens += annotationsTokens;
    }

    console.log(`\n  Token Breakdown by Category:`);
    console.log(`    Descriptions:   ${totalDescriptionTokens} tokens`);
    console.log(`    Input Schemas:  ${totalInputSchemaTokens} tokens`);
    console.log(`    LLM Guidance:   ${totalLlmGuidanceTokens} tokens (subset of inputSchemas)`);
    console.log(`    Output Schemas: ${totalOutputSchemaTokens} tokens`);
    console.log(`    Annotations:    ${totalAnnotationsTokens} tokens`);

    // Top 10 tools by token count
    const sorted = Object.entries(perTool)
      .sort(([, a], [, b]) => b.total - a.total);

    console.log(`\n  Top 10 Tools by Token Cost:`);
    for (const [name, breakdown] of sorted.slice(0, 10)) {
      console.log(`    ${name}: ${breakdown.total} tokens (desc=${breakdown.description}, schema=${breakdown.inputSchema}, guidance=${breakdown.llmGuidance})`);
    }

    // Every tool should have a description and input schema
    for (const schema of toolSchemas) {
      expect(perTool[schema.name].description).to.be.greaterThan(0, `${schema.name} missing description`);
      expect(perTool[schema.name].inputSchema).to.be.greaterThan(0, `${schema.name} missing inputSchema`);
    }
  });

  it('should write baseline metrics to docs/metrics/baseline-2026-02.json', async function () {
    const perTool: Record<string, {
      description: number;
      inputSchema: number;
      llmGuidance: number;
      outputSchema: number;
      annotations: number;
      total: number;
    }> = {};

    let totalDescriptionTokens = 0;
    let totalInputSchemaTokens = 0;
    let totalLlmGuidanceTokens = 0;
    let totalOutputSchemaTokens = 0;
    let totalAnnotationsTokens = 0;

    for (const schema of toolSchemas) {
      const descStr = schema.description || '';
      const descTokens = estimateTokens(descStr);

      const llmGuidanceStr = extractLlmGuidance(schema.inputSchema);
      const llmGuidanceTokens = estimateTokens(llmGuidanceStr);

      const inputSchemaStr = JSON.stringify(schema.inputSchema || {});
      const inputSchemaTokens = estimateTokens(inputSchemaStr);

      const outputSchemaStr = schema.outputSchema ? JSON.stringify(schema.outputSchema) : '';
      const outputSchemaTokens = estimateTokens(outputSchemaStr);

      const annotationsStr = schema.annotations ? JSON.stringify(schema.annotations) : '';
      const annotationsTokens = estimateTokens(annotationsStr);

      const toolTotal = estimateTokens(JSON.stringify(schema));

      perTool[schema.name] = {
        description: descTokens,
        inputSchema: inputSchemaTokens,
        llmGuidance: llmGuidanceTokens,
        outputSchema: outputSchemaTokens,
        annotations: annotationsTokens,
        total: toolTotal,
      };

      totalDescriptionTokens += descTokens;
      totalInputSchemaTokens += inputSchemaTokens;
      totalLlmGuidanceTokens += llmGuidanceTokens;
      totalOutputSchemaTokens += outputSchemaTokens;
      totalAnnotationsTokens += annotationsTokens;
    }

    const fullJson = JSON.stringify(toolSchemas);
    const totalTokens = estimateTokens(fullJson);

    const baseline = {
      timestamp: new Date().toISOString(),
      totalTokens,
      toolCount: toolSchemas.length,
      breakdown: {
        descriptions: totalDescriptionTokens,
        inputSchemas: totalInputSchemaTokens,
        llmGuidance: totalLlmGuidanceTokens,
        outputSchemas: totalOutputSchemaTokens,
        annotations: totalAnnotationsTokens,
      },
      perTool,
    };

    const outputPath = join(process.cwd(), 'docs', 'metrics', 'baseline-2026-02.json');
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(baseline, null, 2), 'utf-8');

    console.log(`\n  Baseline written to: ${outputPath}`);
    console.log(`  Total tokens: ${totalTokens}`);
    console.log(`  Tool count: ${toolSchemas.length}`);

    // Verify the file was written
    const { readFile } = await import('fs/promises');
    const written = JSON.parse(await readFile(outputPath, 'utf-8'));
    expect(written.totalTokens).to.equal(totalTokens);
    expect(written.toolCount).to.equal(toolSchemas.length);
    expect(Object.keys(written.perTool)).to.have.lengthOf(toolSchemas.length);
  });
});
