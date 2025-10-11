import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { InProcessTestClient, InProcessAuthHelper } from '../../helpers/inProcessClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';

/**
 * Integration tests for sheet_sql tool
 *
 * Tests SQL-style operations on Google Sheets including:
 * - SELECT with WHERE clauses and aggregations
 * - INSERT VALUES for adding rows
 * - UPDATE SET WHERE for modifying data
 * - DELETE WHERE for removing rows
 * - Multi-sheet workbook support
 *
 * PREREQUISITES:
 * - Requires valid Google OAuth authentication
 * - Uses test spreadsheet: 1UeHwBmfXMlNlqpHiEf_wF1CeOfICYbXWTBEZBvT3VTM
 * - Tests against "Transactions" sheet
 */
describe('Google Sheets SQL Integration Tests', () => {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;

  // Test spreadsheet with Transactions sheet
  const TEST_SPREADSHEET_ID = '1UeHwBmfXMlNlqpHiEf_wF1CeOfICYbXWTBEZBvT3VTM';
  const TEST_SHEET = 'Transactions';

  before(function() {
    this.timeout(30000);

    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      this.skip(); // Skip if global auth not available
    }

    client = globalAuthState.client;
    auth = globalAuthState.auth!;  // Reuse global auth with sessionId

    console.log('\n🧪 Starting Google Sheets SQL Integration Tests');
    console.log(`📊 Test Spreadsheet: ${TEST_SPREADSHEET_ID}`);
    console.log(`📄 Test Sheet: ${TEST_SHEET}`);
  });

  it('should validate schema for sheet_sql tool', async function() {
    this.timeout(10000);

    const tools = await client.listTools();
    const sheetSqlTool = tools.find(t => t.name === 'sheet_sql');

    expect(sheetSqlTool).to.exist;
    expect(sheetSqlTool?.inputSchema).to.exist;
    expect(sheetSqlTool?.inputSchema.properties).to.have.property('spreadsheetId');
    expect(sheetSqlTool?.inputSchema.properties).to.have.property('range');
    expect(sheetSqlTool?.inputSchema.properties).to.have.property('statement');
    expect(sheetSqlTool?.inputSchema.properties).to.have.property('returnMetadata');

    // Verify range is NOW REQUIRED
    expect(sheetSqlTool?.inputSchema.required).to.include('spreadsheetId');
    expect(sheetSqlTool?.inputSchema.required).to.include('range');
    expect(sheetSqlTool?.inputSchema.required).to.include('statement');

    console.log('✅ sheet_sql schema validated - range is required for multi-sheet support');
  });

  it('should execute SELECT query on Transactions sheet', async function() {
    this.timeout(30000);

    // Verify authentication
    const authStatus = await auth.getAuthStatus();
    if (!authStatus.authenticated) {
      console.log('⚠️  Skipping test - authentication required');
      this.skip();
    }

    console.log('\n📋 Testing SELECT query on Transactions sheet');

    try {
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:Z`,
        statement: 'SELECT * LIMIT 5'
      });

      expect(result).to.exist;
      expect(result.operation).to.equal('SELECT');
      expect(result.data).to.exist;

      console.log('✅ SELECT query executed successfully');
      console.log(`   Returned data structure: ${JSON.stringify(Object.keys(result.data)).substring(0, 100)}...`);
    } catch (error: any) {
      console.log(`❌ SELECT query failed: ${error.message}`);
      throw error;
    }
  });

  it('should execute SELECT with WHERE clause on Transactions sheet', async function() {
    this.timeout(30000);

    const authStatus = await auth.getAuthStatus();
    if (!authStatus.authenticated) {
      this.skip();
    }

    console.log('\n📋 Testing SELECT with WHERE clause');

    try {
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:Z`,
        statement: 'SELECT A, B, C WHERE A is not null LIMIT 10'
      });

      expect(result).to.exist;
      expect(result.operation).to.equal('SELECT');
      expect(result.data).to.exist;

      console.log('✅ SELECT with WHERE clause executed successfully');
    } catch (error: any) {
      console.log(`❌ SELECT with WHERE failed: ${error.message}`);
      throw error;
    }
  });

  it('should fail gracefully when range is omitted', async function() {
    this.timeout(10000);

    const authStatus = await auth.getAuthStatus();
    if (!authStatus.authenticated) {
      this.skip();
    }

    console.log('\n📋 Testing validation error when range is omitted');

    try {
      await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        // range omitted - should fail validation
        statement: 'SELECT * LIMIT 5'
      });

      expect.fail('Should have thrown validation error for missing range');
    } catch (error: any) {
      // Expected to fail - range is required
      expect(error.message).to.satisfy((msg: string) =>
        msg.includes('range') || msg.includes('required') || msg.includes('Missing')
      );
      console.log('✅ Validation error correctly thrown for missing range');
    }
  });

  // TODO: Add more comprehensive tests:
  // - INSERT VALUES to add test data (requires write permissions)
  // - SELECT with aggregations (COUNT, SUM, AVG)
  // - UPDATE SET WHERE (requires write permissions)
  // - DELETE WHERE (requires write permissions)
  // - Test metadata retrieval with returnMetadata: true
  // - Test different sheet names in multi-sheet workbook
});
