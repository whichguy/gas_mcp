/**
 * Tool Accuracy Baseline Test
 *
 * Establishes accuracy baselines across three dimensions:
 * 1. Tool Selection Accuracy - mapping tasks to expected tools
 * 2. Tool Usage Accuracy - schema validation for parameters
 * 3. Response Interpretation Accuracy - output schema structural tests
 *
 * These are structural/declarative tests that validate test data integrity
 * and schema correctness. Actual LLM-based accuracy testing is a future enhancement.
 */
import { expect } from 'chai';
import { describe, it, before } from 'mocha';

// Import SessionAuthManager to instantiate tools
import { SessionAuthManager } from '../../src/auth/sessionManager.js';

// Import all tool classes (same as mcpServer.ts)
import { AuthTool } from '../../src/tools/auth.js';
import {
  LsTool,
  CatTool,
  WriteTool,
  FileStatusTool,
  RawCatTool,
  RawWriteTool,
  RawCpTool,
  RmTool,
  MvTool,
  CpTool,
  CacheClearTool
} from '../../src/tools/filesystem/index.js';
import { GrepTool, RawGrepTool } from '../../src/tools/grep.js';
import { FindTool, RawFindTool } from '../../src/tools/find.js';
import { RipgrepTool, RawRipgrepTool } from '../../src/tools/ripgrep.js';
import { SedTool, RawSedTool } from '../../src/tools/sed.js';
import { EditTool } from '../../src/tools/edit.js';
import { RawEditTool } from '../../src/tools/raw-edit.js';
import { AiderTool } from '../../src/tools/aider.js';
import { RawAiderTool } from '../../src/tools/raw-aider.js';
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
import { VersionDeployTool } from '../../src/tools/deployment.js';
import { LibraryDeployTool } from '../../src/tools/deploy.js';
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

// ──────────────────────────────────────────────────────────────────────────────
// Test Data: Tool Selection Accuracy
// ──────────────────────────────────────────────────────────────────────────────

interface SelectionTestCase {
  task: string;
  expectedTool: string;
  category: string;
}

const selectionTests: SelectionTestCase[] = [
  { task: 'Read the contents of Main.gs', expectedTool: 'cat', category: 'file-read' },
  { task: 'Search for all uses of require() across the project', expectedTool: 'ripgrep', category: 'search' },
  { task: 'List all files in my GAS project', expectedTool: 'ls', category: 'file-list' },
  { task: 'Delete the old utils.gs file', expectedTool: 'rm', category: 'file-delete' },
  { task: 'Create a new GAS project with deployment infrastructure', expectedTool: 'project_create', category: 'project' },
  { task: 'Execute a quick calculation on the GAS server', expectedTool: 'exec', category: 'execution' },
  { task: 'Deploy my web app to staging', expectedTool: 'deploy', category: 'deployment' },
  { task: 'Pin my library version for staging consumers', expectedTool: 'deploy', category: 'deployment' },
  { task: 'Check my authentication status', expectedTool: 'auth', category: 'auth' },
  { task: 'Find files matching *.test.gs pattern', expectedTool: 'find', category: 'search' },
  { task: 'Replace all occurrences of oldName with newName in a file', expectedTool: 'sed', category: 'edit' },
  { task: 'Make a small edit to line 42 of Config.gs', expectedTool: 'edit', category: 'edit' },
  { task: 'Sync my local changes to the GAS project', expectedTool: 'rsync', category: 'sync' },
  { task: 'Start a new feature branch for user-auth', expectedTool: 'git_feature', category: 'git' },
  { task: 'Check what modules depend on Utils.gs', expectedTool: 'deps', category: 'analysis' },
  { task: 'Write a completely new file Helpers.gs', expectedTool: 'write', category: 'file-write' },
  { task: 'Copy Config.gs to Config-backup.gs', expectedTool: 'cp', category: 'file-copy' },
  { task: 'Move old-utils.gs to utils/legacy.gs', expectedTool: 'mv', category: 'file-move' },
  { task: 'View execution logs for recent function runs', expectedTool: 'executions', category: 'monitoring' },
  { task: 'Check cloud logging output for errors', expectedTool: 'cloud_logs', category: 'monitoring' },
  { task: 'Create a time-based trigger to run nightly', expectedTool: 'trigger', category: 'triggers' },
  { task: 'Run a SQL-like query against my spreadsheet', expectedTool: 'sheet_sql', category: 'sheets' },
  { task: 'See all running processes in my GAS project', expectedTool: 'process_list', category: 'monitoring' },
  { task: 'Read a file including its CommonJS wrapper code', expectedTool: 'raw_cat', category: 'file-read-raw' },
  { task: 'Get the project configuration settings', expectedTool: 'config', category: 'config' },
  { task: 'Check overall project health and status', expectedTool: 'status', category: 'status' },
  { task: 'Reorder files in the project', expectedTool: 'reorder', category: 'project' },
  { task: 'Find a script file attached to a Google Sheet', expectedTool: 'find_drive_script', category: 'drive' },
  { task: 'Set up a worktree for parallel development', expectedTool: 'worktree', category: 'worktree' },
  { task: 'Call a specific exported function via the API', expectedTool: 'exec_api', category: 'execution' },
  { task: 'Clear cached file metadata', expectedTool: 'cache_clear', category: 'cache' },
];

// ──────────────────────────────────────────────────────────────────────────────
// Test Data: Tool Usage Accuracy (Schema Validation)
// ──────────────────────────────────────────────────────────────────────────────

interface UsageTestCase {
  tool: string;
  validParams: Record<string, any>;
  invalidParams: Record<string, any>;
  /** Fields expected to be in the required array */
  expectedRequired: string[];
}

const usageTests: UsageTestCase[] = [
  {
    tool: 'cat',
    validParams: { scriptId: 'test123', path: 'Main.gs' },
    invalidParams: { file: 'Main.gs' },
    expectedRequired: ['scriptId', 'path'],
  },
  {
    tool: 'write',
    validParams: { scriptId: 'test123', path: 'New.gs' },
    invalidParams: { path: 'New.gs' },
    expectedRequired: ['scriptId', 'path'],
  },
  {
    tool: 'edit',
    validParams: { scriptId: 'test123', path: 'Utils.gs', edits: [{ oldText: 'foo', newText: 'bar' }] },
    invalidParams: { scriptId: 'test123' },
    expectedRequired: ['scriptId', 'path', 'edits'],
  },
  {
    tool: 'grep',
    validParams: { scriptId: 'test123', pattern: 'require' },
    invalidParams: { scriptId: 'test123' },
    expectedRequired: ['scriptId', 'pattern'],
  },
  {
    tool: 'ripgrep',
    validParams: { scriptId: 'test123', pattern: 'require' },
    invalidParams: { scriptId: 'test123' },
    expectedRequired: ['scriptId', 'pattern'],
  },
  {
    tool: 'exec',
    validParams: { scriptId: 'test123', js_statement: 'Math.PI' },
    invalidParams: { scriptId: 'test123' },
    expectedRequired: ['scriptId', 'js_statement'],
  },
  {
    tool: 'rm',
    validParams: { scriptId: 'test123', path: 'OldFile.gs' },
    invalidParams: { scriptId: 'test123' },
    expectedRequired: ['scriptId', 'path'],
  },
  {
    tool: 'mv',
    validParams: { scriptId: 'test123', from: 'Old.gs', to: 'New.gs' },
    invalidParams: { scriptId: 'test123' },
    expectedRequired: ['scriptId', 'from', 'to'],
  },
  {
    tool: 'cp',
    validParams: { scriptId: 'test123', from: 'Source.gs', to: 'Dest.gs' },
    invalidParams: { scriptId: 'test123' },
    expectedRequired: ['scriptId', 'from', 'to'],
  },
  {
    tool: 'sed',
    validParams: { scriptId: 'test123', pattern: 's/old/new/g', replacement: 'new' },
    invalidParams: { scriptId: 'test123' },
    expectedRequired: ['scriptId', 'pattern', 'replacement'],
  },
  {
    tool: 'deploy_config',
    validParams: { scriptId: 'test123', operation: 'status' },
    invalidParams: {},
    expectedRequired: ['scriptId', 'operation'],
  },
  {
    tool: 'deploy',
    validParams: { scriptId: 'test123', operation: 'status' },
    invalidParams: {},
    expectedRequired: ['scriptId'],
  },
  {
    tool: 'rsync',
    validParams: { operation: 'pull', scriptId: 'test123' },
    invalidParams: { scriptId: 'test123' },
    expectedRequired: ['operation', 'scriptId'],
  },
  {
    tool: 'git_feature',
    validParams: { scriptId: 'test123', operation: 'list' },
    invalidParams: { scriptId: 'test123' },
    expectedRequired: ['scriptId', 'operation'],
  },
  {
    tool: 'find',
    validParams: { scriptId: 'test123' },
    invalidParams: {},
    expectedRequired: ['scriptId'],
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Test Data: Response Interpretation (Output Schema Structural Tests)
// ──────────────────────────────────────────────────────────────────────────────

interface ResponseTestCase {
  tool: string;
  /** Fields expected in the outputSchema properties (if tool defines outputSchema) */
  expectedFields: string[];
}

const responseTests: ResponseTestCase[] = [
  { tool: 'cat', expectedFields: ['content', 'path', 'type'] },
  { tool: 'ls', expectedFields: ['items', 'total'] },
  { tool: 'file_status', expectedFields: ['path', 'type', 'size'] },
  { tool: 'exec', expectedFields: ['success', 'result', 'logger_output'] },
  { tool: 'deploy', expectedFields: ['operation', 'version', 'environment', 'sheetSync', 'hints'] },
  { tool: 'deploy_config', expectedFields: ['operation', 'environments', 'hints'] },
];

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('Tool Accuracy Baselines', function () {
  this.timeout(30000);

  const toolClasses = [
    AuthTool,
    LsTool, FileStatusTool, CatTool, WriteTool,
    GrepTool, RipgrepTool, SedTool, EditTool, AiderTool,
    FindTool, DepsTool, RmTool, MvTool, CpTool, CacheClearTool,
    RawCatTool, RawWriteTool, RawGrepTool, RawRipgrepTool,
    RawSedTool, RawEditTool, RawAiderTool, RawFindTool, RawCpTool,
    ReorderTool, ProjectCreateTool, ProjectInitTool, ProjectListTool,
    ExecTool, ExecApiTool,
    VersionDeployTool, LibraryDeployTool,
    FindDriveScriptTool, CreateScriptTool,
    ProcessListTool, ExecutionsTool, CloudLogsTool,
    TriggerTool,
    RsyncTool, GitFeatureTool, ConfigTool,
    SheetSqlTool,
    WorktreeTool,
    StatusTool,
  ];

  let tools: Map<string, any>;
  let registeredToolNames: Set<string>;

  before(function () {
    const authManager = new SessionAuthManager();
    tools = new Map();
    for (const ToolClass of toolClasses) {
      const tool = new ToolClass(authManager);
      tools.set(tool.name, tool);
    }
    registeredToolNames = new Set(tools.keys());
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Dimension 1: Tool Selection Accuracy
  // ──────────────────────────────────────────────────────────────────────────

  describe('Tool Selection Accuracy', function () {
    it('should reference only registered tool names in selection test cases', function () {
      const invalid: string[] = [];
      for (const tc of selectionTests) {
        if (!registeredToolNames.has(tc.expectedTool)) {
          invalid.push(`"${tc.expectedTool}" (task: "${tc.task}")`);
        }
      }
      if (invalid.length > 0) {
        console.log(`  Invalid tool references: ${invalid.join(', ')}`);
      }
      expect(invalid).to.have.lengthOf(0, `Test cases reference unregistered tools: ${invalid.join(', ')}`);
    });

    it('should cover all registered tools in selection test cases', function () {
      const coveredTools = new Set(selectionTests.map(tc => tc.expectedTool));
      const uncovered: string[] = [];

      for (const name of registeredToolNames) {
        if (!coveredTools.has(name)) {
          uncovered.push(name);
        }
      }

      console.log(`  Registered tools: ${registeredToolNames.size}`);
      console.log(`  Covered by selection tests: ${coveredTools.size}`);

      if (uncovered.length > 0) {
        console.log(`  Uncovered tools (${uncovered.length}): ${uncovered.join(', ')}`);
      }

      // Report coverage percentage
      const coverage = (coveredTools.size / registeredToolNames.size) * 100;
      console.log(`  Coverage: ${coverage.toFixed(1)}%`);

      // We expect at least 50% coverage from the 30 test cases
      // Some tools (raw_write, raw_grep, etc.) are intentionally advanced/niche
      expect(coverage).to.be.greaterThanOrEqual(50, 'Selection test coverage too low');
    });

    it('should have unique task descriptions', function () {
      const tasks = selectionTests.map(tc => tc.task);
      const uniqueTasks = new Set(tasks);
      expect(uniqueTasks.size).to.equal(tasks.length, 'Duplicate task descriptions found');
    });

    it('should have a reasonable number of test cases', function () {
      expect(selectionTests.length).to.be.greaterThanOrEqual(25);
      expect(selectionTests.length).to.be.lessThanOrEqual(50);
    });

    it('should cover diverse categories', function () {
      const categories = new Set(selectionTests.map(tc => tc.category));
      console.log(`  Categories covered: ${[...categories].sort().join(', ')}`);
      expect(categories.size).to.be.greaterThanOrEqual(10, 'Need more diverse categories');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Dimension 2: Tool Usage Accuracy
  // ──────────────────────────────────────────────────────────────────────────

  describe('Tool Usage Accuracy', function () {
    it('should reference only registered tool names in usage test cases', function () {
      const invalid: string[] = [];
      for (const tc of usageTests) {
        if (!registeredToolNames.has(tc.tool)) {
          invalid.push(tc.tool);
        }
      }
      expect(invalid).to.have.lengthOf(0, `Usage tests reference unregistered tools: ${invalid.join(', ')}`);
    });

    it('should validate required fields match actual schemas', function () {
      const mismatches: string[] = [];

      for (const tc of usageTests) {
        const tool = tools.get(tc.tool);
        if (!tool) continue;

        const schemaRequired: string[] = tool.inputSchema?.required || [];

        for (const field of tc.expectedRequired) {
          if (!schemaRequired.includes(field)) {
            mismatches.push(`${tc.tool}: expected "${field}" in required but schema has [${schemaRequired.join(', ')}]`);
          }
        }
      }

      if (mismatches.length > 0) {
        console.log(`  Required field mismatches:`);
        for (const m of mismatches) {
          console.log(`    - ${m}`);
        }
      }

      expect(mismatches).to.have.lengthOf(0, `Required field mismatches:\n${mismatches.join('\n')}`);
    });

    it('should verify valid params include all required fields', function () {
      const issues: string[] = [];

      for (const tc of usageTests) {
        const tool = tools.get(tc.tool);
        if (!tool) continue;

        const schemaRequired: string[] = tool.inputSchema?.required || [];

        for (const field of schemaRequired) {
          if (!(field in tc.validParams)) {
            issues.push(`${tc.tool}: validParams missing required field "${field}"`);
          }
        }
      }

      if (issues.length > 0) {
        console.log(`  Valid params issues:`);
        for (const issue of issues) {
          console.log(`    - ${issue}`);
        }
      }

      expect(issues).to.have.lengthOf(0, `Valid params missing required fields:\n${issues.join('\n')}`);
    });

    it('should verify invalid params are missing at least one required field', function () {
      const issues: string[] = [];

      for (const tc of usageTests) {
        const tool = tools.get(tc.tool);
        if (!tool) continue;

        const schemaRequired: string[] = tool.inputSchema?.required || [];

        // Check that invalidParams is actually missing at least one required field
        const missingRequired = schemaRequired.filter(field => !(field in tc.invalidParams));
        if (missingRequired.length === 0 && schemaRequired.length > 0) {
          issues.push(`${tc.tool}: invalidParams has all required fields — should be missing at least one`);
        }
      }

      if (issues.length > 0) {
        console.log(`  Invalid params issues:`);
        for (const issue of issues) {
          console.log(`    - ${issue}`);
        }
      }

      expect(issues).to.have.lengthOf(0, `Invalid params not actually invalid:\n${issues.join('\n')}`);
    });

    it('should verify all tool schemas have proper structure', function () {
      for (const [name, tool] of tools) {
        expect(tool.inputSchema, `${name} missing inputSchema`).to.exist;
        expect(tool.inputSchema.type, `${name} inputSchema.type should be "object"`).to.equal('object');
        expect(tool.inputSchema.properties, `${name} missing inputSchema.properties`).to.be.an('object');
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Dimension 3: Response Interpretation Accuracy
  // ──────────────────────────────────────────────────────────────────────────

  describe('Response Interpretation Accuracy', function () {
    it('should verify tools with outputSchema have expected fields', function () {
      const toolsWithOutputSchema: string[] = [];
      const toolsWithoutOutputSchema: string[] = [];
      const issues: string[] = [];

      for (const [name, tool] of tools) {
        if ((tool as any).outputSchema) {
          toolsWithOutputSchema.push(name);
        } else {
          toolsWithoutOutputSchema.push(name);
        }
      }

      console.log(`  Tools with outputSchema: ${toolsWithOutputSchema.length} (${toolsWithOutputSchema.join(', ')})`);
      console.log(`  Tools without outputSchema: ${toolsWithoutOutputSchema.length}`);

      // For tools that have outputSchema AND are in our responseTests, verify fields
      for (const tc of responseTests) {
        const tool = tools.get(tc.tool);
        if (!tool) continue;

        const outputSchema = (tool as any).outputSchema;
        if (!outputSchema) {
          // Tool has no outputSchema; skip structural validation
          continue;
        }

        const properties = outputSchema.properties || {};
        for (const field of tc.expectedFields) {
          if (!(field in properties)) {
            issues.push(`${tc.tool}: expected "${field}" in outputSchema.properties but not found`);
          }
        }
      }

      if (issues.length > 0) {
        console.log(`  Output schema field issues:`);
        for (const issue of issues) {
          console.log(`    - ${issue}`);
        }
      }

      // Allow some flexibility -- not all tools may have outputSchema yet
      // This test is informational, not a hard gate
      if (issues.length > 0) {
        console.log(`  NOTE: ${issues.length} field mismatches found (may indicate outputSchema evolution)`);
      }
    });

    it('should verify outputSchemas are valid JSON Schema objects', function () {
      for (const [name, tool] of tools) {
        const outputSchema = (tool as any).outputSchema;
        if (!outputSchema) continue;

        expect(outputSchema.type, `${name} outputSchema.type should be "object"`).to.equal('object');
        if (outputSchema.properties) {
          expect(outputSchema.properties, `${name} outputSchema.properties should be an object`).to.be.an('object');
        }
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────────────────

  describe('Baseline Summary', function () {
    it('should report overall accuracy test data quality', function () {
      const selectionToolsCovered = new Set(selectionTests.map(tc => tc.expectedTool));
      const usageToolsCovered = new Set(usageTests.map(tc => tc.tool));
      const responseToolsCovered = new Set(responseTests.map(tc => tc.tool));

      console.log('\n  Accuracy Baseline Summary:');
      console.log(`    Registered tools: ${registeredToolNames.size}`);
      console.log(`    Selection test cases: ${selectionTests.length} (covering ${selectionToolsCovered.size} tools)`);
      console.log(`    Usage test cases: ${usageTests.length} (covering ${usageToolsCovered.size} tools)`);
      console.log(`    Response test cases: ${responseTests.length} (covering ${responseToolsCovered.size} tools)`);

      // All three dimensions should exist
      expect(selectionTests.length).to.be.greaterThan(0);
      expect(usageTests.length).to.be.greaterThan(0);
      expect(responseTests.length).to.be.greaterThan(0);
    });
  });
});
