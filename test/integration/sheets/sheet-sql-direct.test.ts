import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { SheetSqlTool } from '../../../src/tools/sheets/sheetsSql.js';

/**
 * Direct integration tests for SheetSqlTool
 *
 * Tests the tool directly without MCP server infrastructure.
 * Requires manual authentication via the running MCP server.
 *
 * PREREQUISITES:
 * - Claude Code must be running with authenticated MCP session
 * - Uses test spreadsheet: 1UeHwBmfXMlNlqpHiEf_wF1CeOfICYbXWTBEZBvT3VTM
 * - Tests against "Transactions" sheet
 */
describe('SheetSqlTool Direct Integration Tests', () => {
  let tool: SheetSqlTool;

  // Test spreadsheet with Transactions sheet
  const TEST_SPREADSHEET_ID = '1UeHwBmfXMlNlqpHiEf_wF1CeOfICYbXWTBEZBvT3VTM';
  const TEST_SHEET = 'Transactions';

  before(function() {
    console.log('\n🧪 Starting Direct SheetSqlTool Integration Tests');
    console.log(`📊 Test Spreadsheet: ${TEST_SPREADSHEET_ID}`);
    console.log(`📄 Test Sheet: ${TEST_SHEET}`);

    // Create tool instance (no session manager needed for schema tests)
    tool = new SheetSqlTool();
  });

  it('should have correct tool metadata', function() {
    expect(tool.name).to.equal('sheet_sql');
    expect(tool.description).to.include('SQL-style operations');
    expect(tool.inputSchema).to.exist;
  });

  it('should require spreadsheetId, range, and statement parameters', function() {
    expect(tool.inputSchema.required).to.deep.equal(['spreadsheetId', 'range', 'statement']);
  });

  it('should have range parameter with correct description', function() {
    const rangeProperty = tool.inputSchema.properties.range;
    expect(rangeProperty).to.exist;
    expect(rangeProperty.type).to.equal('string');
    expect(rangeProperty.description).to.include('required');
    expect(rangeProperty.description).to.include('sheet name');
  });

  it('should have correct example ranges in schema', function() {
    const rangeProperty = tool.inputSchema.properties.range;
    expect(rangeProperty.examples).to.include('Transactions!A:Z');
    expect(rangeProperty.examples).to.include('Sheet1!A1:Z1000');
    expect(rangeProperty.examples).to.include('Sales!A:F');
  });

  it('should support SELECT, INSERT, UPDATE, DELETE statements', function() {
    const statementProperty = tool.inputSchema.properties.statement;
    expect(statementProperty).to.exist;
    expect(statementProperty.examples).to.have.length.greaterThan(0);

    const exampleStatements = statementProperty.examples;
    const hasSelect = exampleStatements.some((ex: string) => ex.startsWith('SELECT'));
    const hasInsert = exampleStatements.some((ex: string) => ex.startsWith('INSERT'));
    const hasUpdate = exampleStatements.some((ex: string) => ex.startsWith('UPDATE'));
    const hasDelete = exampleStatements.some((ex: string) => ex.startsWith('DELETE'));

    expect(hasSelect).to.be.true;
    expect(hasInsert).to.be.true;
    expect(hasUpdate).to.be.true;
    expect(hasDelete).to.be.true;
  });

  it('should have returnMetadata parameter with boolean type', function() {
    const metadataProperty = tool.inputSchema.properties.returnMetadata;
    expect(metadataProperty).to.exist;
    expect(metadataProperty.type).to.equal('boolean');
    expect(metadataProperty.default).to.equal(false);
  });

  it('should not allow additional properties', function() {
    expect(tool.inputSchema.additionalProperties).to.equal(false);
  });

  // Note: Actual execution tests require authentication and are skipped
  // Use the running MCP server in Claude Code to test actual execution
  it.skip('should execute SELECT query on Transactions sheet (requires auth)', async function() {
    this.timeout(30000);

    // This test requires a valid access token from the authenticated session
    // Run via Claude Code's MCP connection instead
    const result = await tool.execute({
      spreadsheetId: TEST_SPREADSHEET_ID,
      range: `${TEST_SHEET}!A:Z`,
      statement: 'SELECT * LIMIT 5'
    });

    expect(result).to.exist;
  });

  console.log('\n✅ Schema validation tests complete');
  console.log('ℹ️  For execution tests, use the running MCP server via Claude Code');
});
