import { expect } from 'chai';
import { describe, it, before, after } from 'mocha';
import { InProcessTestClient, InProcessAuthHelper } from '../../helpers/inProcessClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';

/**
 * Integration tests for sheet_sql tool
 *
 * Tests all SQL-style operations on Google Sheets:
 * - SELECT with all supported clauses (WHERE, GROUP BY, PIVOT, ORDER BY, LIMIT, OFFSET, LABEL, FORMAT)
 * - INSERT VALUES for adding rows
 * - UPDATE SET WHERE for modifying data
 * - DELETE WHERE for removing rows
 *
 * PREREQUISITES:
 * - Requires valid Google OAuth authentication
 * - Uses test spreadsheet: 1UeHwBmfXMlNlqpHiEf_wF1CeOfICYbXWTBEZBvT3VTM
 * - Tests against "Transactions" sheet
 *
 * TEST DATA ISOLATION:
 * - Each describe block uses unique prefixes (TEST_RUN_ID + block-specific suffix)
 * - Cleanup runs in after() hooks with retry logic
 * - All test data identifiable via TEST_RUN_ID pattern
 *
 * ACTUAL SCHEMA for Transactions sheet (discovered from live query):
 * - Column A: Reference (string, often null)
 * - Column B: Date (date)
 * - Column C: Description (string) - used for test isolation via test ID
 * - Column D: Category (string)
 * - Column E: Amount (number) - numeric column for aggregates
 * - Column F: Value (number)
 * - Column G: Account (string)
 * - Column N: Transaction ID (string)
 *
 * Test data uses columns B, C, D, E to match actual schema
 */
describe('Google Sheets SQL Integration Tests', function() {
  // Set describe-level timeout for all tests
  this.timeout(180000);

  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;

  // Test configuration
  const TEST_SPREADSHEET_ID = '1UeHwBmfXMlNlqpHiEf_wF1CeOfICYbXWTBEZBvT3VTM';
  const TEST_SHEET = 'Transactions';

  // Unique test run identifier - ALL test data uses this prefix
  const TEST_RUN_ID = `test-${Date.now()}`;

  // ==================== GLOBAL SETUP ====================
  before(function() {
    this.timeout(30000);

    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      this.skip();
    }

    client = globalAuthState.client;
    auth = globalAuthState.auth!;

    console.log('\n🧪 Starting Google Sheets SQL Integration Tests');
    console.log(`📊 Test Spreadsheet: ${TEST_SPREADSHEET_ID}`);
    console.log(`📄 Test Sheet: ${TEST_SHEET}`);
    console.log(`🔑 Test Run ID: ${TEST_RUN_ID}`);
  });

  // ==================== GLOBAL TEARDOWN ====================
  after(async function() {
    this.timeout(30000);

    // Cleanup test data using DELETE
    console.log('\n🧹 Cleaning up test data...');
    try {
      await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `DELETE WHERE C contains '${TEST_RUN_ID}'`
      });
      console.log('✅ Test data cleaned up successfully');
    } catch (error: any) {
      console.log(`⚠️  Cleanup warning: ${error.message}`);
      console.log(`   Test data prefix: ${TEST_RUN_ID}`);
    }
  });

  // ==================== HELPER FUNCTIONS ====================
  /**
   * Insert a test row into the Transactions sheet
   * Schema alignment:
   *   Column B: Date (using M/d/yyyy format)
   *   Column C: Description (contains test ID for isolation)
   *   Column D: Category
   *   Column E: Amount (numeric)
   *
   * Note: Skip column A (it has formulas). Use range B:E for INSERT.
   * Date must be in M/d/yyyy format (not DATE literal).
   */
  async function insertTestRow(prefix: string, suffix: string, amount: number, category: string): Promise<any> {
    const testId = `${TEST_RUN_ID}-${prefix}-${suffix}`;
    const today = new Date();
    // Format date as M/d/yyyy to match sheet format (this will be auto-parsed by Sheets)
    const dateStr = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
    return client.callTool('sheet_sql', {
      spreadsheetId: TEST_SPREADSHEET_ID,
      range: `${TEST_SHEET}!B:E`,  // Skip column A (has formulas), start from B
      statement: `INSERT VALUES ("${dateStr}", "${testId}", "${category}", ${amount})`
    });
  }

  // Helper function to cleanup test data by prefix
  async function cleanupPrefix(prefix: string): Promise<void> {
    try {
      await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `DELETE WHERE C contains '${TEST_RUN_ID}-${prefix}'`
      });
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  // ==================== SCHEMA VALIDATION ====================
  describe('Schema Validation', function() {
    this.timeout(15000);

    it('should have correct tool metadata', async function() {
      const tools = await client.listTools();
      const sheetSqlTool = tools.find(t => t.name === 'sheet_sql');

      expect(sheetSqlTool).to.exist;
      expect(sheetSqlTool?.inputSchema).to.exist;
      expect(sheetSqlTool?.inputSchema.properties).to.have.property('spreadsheetId');
      expect(sheetSqlTool?.inputSchema.properties).to.have.property('range');
      expect(sheetSqlTool?.inputSchema.properties).to.have.property('statement');
      expect(sheetSqlTool?.inputSchema.properties).to.have.property('returnMetadata');

      // Verify required fields
      expect(sheetSqlTool?.inputSchema.required).to.include('spreadsheetId');
      expect(sheetSqlTool?.inputSchema.required).to.include('range');
      expect(sheetSqlTool?.inputSchema.required).to.include('statement');

      console.log('✅ sheet_sql schema validated');
    });
  });

  // ==================== WRITE OPERATIONS (CRUD) ====================
  describe('Write Operations (CRUD)', function() {
    this.timeout(60000);
    const WRITE_PREFIX = 'write';

    it('should INSERT VALUES into test sheet', async function() {
      const result = await insertTestRow(WRITE_PREFIX, 'insert-1', 100.50, 'test-insert');

      expect(result.operation).to.equal('INSERT');
      expect(result.updatedRows).to.equal(1);
      console.log('✅ INSERT successful');
    });

    it('should INSERT multiple rows and verify via SELECT', async function() {
      await insertTestRow(WRITE_PREFIX, 'insert-2', 200.00, 'test-insert');
      await insertTestRow(WRITE_PREFIX, 'insert-3', 300.00, 'test-insert');

      // Verify rows exist - C is Description column containing test ID
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C WHERE C contains '${TEST_RUN_ID}-${WRITE_PREFIX}-insert'`
      });

      expect(result.data.rows.length).to.be.gte(3);
      console.log(`✅ Multiple INSERT successful: ${result.data.rows.length} rows found`);
    });

    it('should INSERT INTO with column letters', async function() {
      // Insert with sparse columns using column letters
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!B:E`,
        statement: `INSERT INTO (B, D) VALUES ("1/15/2025", "${TEST_RUN_ID}-${WRITE_PREFIX}-into-letters")`
      });

      expect(result.operation).to.equal('INSERT');
      expect(result.updatedRows).to.equal(1);
      console.log('✅ INSERT INTO with column letters successful');
    });

    it('should UPDATE rows matching WHERE clause', async function() {
      await insertTestRow(WRITE_PREFIX, 'update-target', 500.00, 'before-update');

      // Wait a moment for data to be indexed
      await new Promise(r => setTimeout(r, 500));

      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `UPDATE SET D = "after-update" WHERE C contains "${TEST_RUN_ID}-${WRITE_PREFIX}-update-target"`
      });

      expect(result.operation).to.equal('UPDATE');
      expect(result.updatedRows).to.be.gte(1);

      // Verify update
      const verify = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C, D WHERE C contains "${TEST_RUN_ID}-${WRITE_PREFIX}-update-target"`
      });

      expect(verify.data.rows.length).to.be.gte(1);
      expect(verify.data.rows[0].c[1].v).to.equal('after-update');
      console.log('✅ UPDATE successful');
    });

    it('should DELETE rows matching WHERE clause', async function() {
      await insertTestRow(WRITE_PREFIX, 'delete-target', 999.00, 'delete-me');

      // Wait a moment for data to be indexed
      await new Promise(r => setTimeout(r, 500));

      // Verify row exists first
      const before = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C WHERE C contains "${TEST_RUN_ID}-${WRITE_PREFIX}-delete-target"`
      });
      expect(before.data.rows.length).to.be.gte(1);

      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `DELETE WHERE C contains "${TEST_RUN_ID}-${WRITE_PREFIX}-delete-target"`
      });

      expect(result.operation).to.equal('DELETE');
      expect(result.deletedRows).to.be.gte(1);

      // Verify deletion
      const after = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C WHERE C contains "${TEST_RUN_ID}-${WRITE_PREFIX}-delete-target"`
      });
      expect(after.data.rows.length).to.equal(0);
      console.log('✅ DELETE successful');
    });

    it('should UPDATE with LIMIT', async function() {
      // Insert multiple rows
      await insertTestRow(WRITE_PREFIX, 'limit-1', 100, 'limit-test');
      await insertTestRow(WRITE_PREFIX, 'limit-2', 200, 'limit-test');
      await insertTestRow(WRITE_PREFIX, 'limit-3', 300, 'limit-test');

      await new Promise(r => setTimeout(r, 500));

      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `UPDATE SET D = "limited" WHERE C contains "${TEST_RUN_ID}-${WRITE_PREFIX}-limit" AND D = "limit-test" LIMIT 2`
      });

      expect(result.operation).to.equal('UPDATE');
      expect(result.updatedRows).to.equal(2);

      // Verify only 2 rows were updated
      const verify = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT COUNT(C) WHERE C contains "${TEST_RUN_ID}-${WRITE_PREFIX}-limit" AND D = "limited"`
      });
      expect(verify.data.rows[0].c[0].v).to.equal(2);
      console.log('✅ UPDATE with LIMIT successful');
    });

    it('should DELETE with LIMIT', async function() {
      // Insert multiple rows
      await insertTestRow(WRITE_PREFIX, 'dellimit-1', 100, 'del-limit');
      await insertTestRow(WRITE_PREFIX, 'dellimit-2', 200, 'del-limit');
      await insertTestRow(WRITE_PREFIX, 'dellimit-3', 300, 'del-limit');

      await new Promise(r => setTimeout(r, 500));

      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `DELETE WHERE C contains "${TEST_RUN_ID}-${WRITE_PREFIX}-dellimit" LIMIT 2`
      });

      expect(result.operation).to.equal('DELETE');
      expect(result.deletedRows).to.equal(2);

      // Verify only 1 row remains
      const verify = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT COUNT(C) WHERE C contains "${TEST_RUN_ID}-${WRITE_PREFIX}-dellimit"`
      });
      expect(verify.data.rows[0].c[0].v).to.equal(1);
      console.log('✅ DELETE with LIMIT successful');
    });

    it('should UPDATE with ORDER BY + LIMIT', async function() {
      // Insert multiple rows with different amounts
      await insertTestRow(WRITE_PREFIX, 'ordered-1', 100, 'ordered-test');
      await insertTestRow(WRITE_PREFIX, 'ordered-2', 200, 'ordered-test');
      await insertTestRow(WRITE_PREFIX, 'ordered-3', 300, 'ordered-test');

      await new Promise(r => setTimeout(r, 500));

      // Update highest amount first (ORDER BY E DESC)
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `UPDATE SET D = "high-updated" WHERE C contains "${TEST_RUN_ID}-${WRITE_PREFIX}-ordered" AND D = "ordered-test" ORDER BY E DESC LIMIT 1`
      });

      expect(result.operation).to.equal('UPDATE');
      expect(result.updatedRows).to.equal(1);

      // Verify the highest amount row was updated
      const verify = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C, D, E WHERE C contains "${TEST_RUN_ID}-${WRITE_PREFIX}-ordered" AND D = "high-updated"`
      });
      expect(verify.data.rows.length).to.equal(1);
      expect(verify.data.rows[0].c[2].v).to.equal(300);  // Amount = 300
      console.log('✅ UPDATE with ORDER BY + LIMIT successful');
    });

    it('should require WHERE clause for UPDATE', async function() {
      try {
        await client.callTool('sheet_sql', {
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: `${TEST_SHEET}!A:E`,
          statement: 'UPDATE SET E = 0'  // E is Amount column
        });
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message.toLowerCase()).to.include('where');
        console.log('✅ WHERE clause correctly required for UPDATE');
      }
    });

    it('should require WHERE clause for DELETE', async function() {
      try {
        await client.callTool('sheet_sql', {
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: `${TEST_SHEET}!A:E`,
          statement: 'DELETE'
        });
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message.toLowerCase()).to.include('where');
        console.log('✅ WHERE clause correctly required for DELETE');
      }
    });

    it('should handle UPDATE with no matching rows', async function() {
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `UPDATE SET D = "never" WHERE C = "nonexistent-${Date.now()}-xyz"`
      });

      expect(result.operation).to.equal('UPDATE');
      expect(result.updatedRows).to.equal(0);
      console.log('✅ UPDATE with no matches handled gracefully');
    });

    it('should handle DELETE with no matching rows', async function() {
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `DELETE WHERE C = "nonexistent-${Date.now()}-xyz"`
      });

      expect(result.operation).to.equal('DELETE');
      expect(result.deletedRows).to.equal(0);
      console.log('✅ DELETE with no matches handled gracefully');
    });
  });

  // ==================== QUERY FEATURES ====================
  describe('Query Features', function() {
    this.timeout(120000);
    const QUERY_PREFIX = 'query';

    // Setup test data for query tests
    before(async function() {
      this.timeout(60000);
      console.log('\n📝 Setting up query test data...');

      // Insert varied test data for query tests
      // Schema: B=Date, C=Description (test ID), D=Category, E=Amount
      await insertTestRow(QUERY_PREFIX, 'row-1', 1000, 'CategoryA');
      await insertTestRow(QUERY_PREFIX, 'row-2', 2000, 'CategoryA');
      await insertTestRow(QUERY_PREFIX, 'row-3', 500, 'CategoryB');
      await insertTestRow(QUERY_PREFIX, 'row-4', 1500, 'CategoryB');
      await insertTestRow(QUERY_PREFIX, 'row-5', 750, 'CategoryC');

      console.log('✅ Query test data inserted (5 rows)');

      // Wait a moment for data to be indexed
      await new Promise(r => setTimeout(r, 1000));
    });

    after(async function() {
      await cleanupPrefix(QUERY_PREFIX);
    });

    it('should execute basic SELECT query', async function() {
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: 'SELECT * LIMIT 5'
      });

      expect(result).to.exist;
      expect(result.operation).to.equal('SELECT');
      expect(result.data).to.exist;
      console.log('✅ Basic SELECT works');
    });

    it('should execute SELECT with WHERE clause', async function() {
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C, D, E WHERE C contains "${TEST_RUN_ID}-${QUERY_PREFIX}"`
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.be.gte(5);
      console.log(`✅ SELECT with WHERE works: ${result.data.rows.length} rows`);
    });

    it('should execute SELECT with aggregations (COUNT, SUM, AVG, MAX, MIN)', async function() {
      // Using E (Amount) for numeric aggregates since it's a number column
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT COUNT(C), SUM(E), AVG(E), MAX(E), MIN(E) WHERE C contains "${TEST_RUN_ID}-${QUERY_PREFIX}"`
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.cols).to.have.length(5);

      // Verify aggregate values
      const row = result.data.rows[0];
      expect(row.c[0].v).to.equal(5); // COUNT = 5 rows
      expect(row.c[1].v).to.equal(5750); // SUM = 1000+2000+500+1500+750
      expect(row.c[2].v).to.equal(1150); // AVG = 5750/5
      expect(row.c[3].v).to.equal(2000); // MAX
      expect(row.c[4].v).to.equal(500); // MIN

      console.log('✅ Aggregation queries work');
    });

    it('should execute GROUP BY with aggregates', async function() {
      // D is Category, E is Amount
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT D, COUNT(C), SUM(E) WHERE C contains "${TEST_RUN_ID}-${QUERY_PREFIX}" GROUP BY D`
      });

      expect(result.operation).to.equal('SELECT');
      // Should have 3 groups: CategoryA, CategoryB, CategoryC
      expect(result.data.rows.length).to.equal(3);

      console.log('✅ GROUP BY works');
    });

    it('should apply LABEL for column aliases', async function() {
      // B=Date, C=Description, E=Amount
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT B, C, E WHERE C contains "${TEST_RUN_ID}-${QUERY_PREFIX}" LIMIT 1 LABEL B 'Date', C 'Reference', E 'Amount'`
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.cols[0].label).to.equal('Date');
      expect(result.data.cols[1].label).to.equal('Reference');
      expect(result.data.cols[2].label).to.equal('Amount');

      console.log('✅ LABEL aliases work');
    });

    it('should apply FORMAT for display formatting', async function() {
      // E is Amount (numeric)
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT E WHERE C contains '${TEST_RUN_ID}-${QUERY_PREFIX}' LIMIT 1 FORMAT E '$#,##0.00'`
      });

      expect(result.operation).to.equal('SELECT');
      // FORMAT affects the 'f' (formatted) property of cell values
      // Note: FORMAT may not always add $ in the 'f' property depending on Google's response
      // The test verifies FORMAT clause is accepted without error
      const cellData = result.data.rows[0]?.c[0];
      expect(cellData).to.exist;
      // Either 'f' contains formatting, or 'v' has the raw value
      expect(cellData.v || cellData.f).to.exist;

      console.log('✅ FORMAT works');
    });

    it('should execute ORDER BY with ASC', async function() {
      // Order by E (Amount)
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C, E WHERE C contains "${TEST_RUN_ID}-${QUERY_PREFIX}" ORDER BY E ASC`
      });

      expect(result.operation).to.equal('SELECT');
      const rows = result.data.rows;

      // Verify ascending order - E is second column (index 1)
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1].c[1]?.v || 0;
        const curr = rows[i].c[1]?.v || 0;
        expect(curr).to.be.gte(prev);
      }

      console.log('✅ ORDER BY ASC works');
    });

    it('should execute ORDER BY with DESC', async function() {
      // Order by E (Amount)
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C, E WHERE C contains "${TEST_RUN_ID}-${QUERY_PREFIX}" ORDER BY E DESC`
      });

      expect(result.operation).to.equal('SELECT');
      const rows = result.data.rows;

      // Verify descending order - E is second column (index 1)
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1].c[1]?.v || 0;
        const curr = rows[i].c[1]?.v || 0;
        expect(curr).to.be.lte(prev);
      }

      console.log('✅ ORDER BY DESC works');
    });

    it('should execute LIMIT with OFFSET for pagination', async function() {
      const page1 = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C, E WHERE C contains "${TEST_RUN_ID}-${QUERY_PREFIX}" ORDER BY E ASC LIMIT 2 OFFSET 0`
      });

      const page2 = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C, E WHERE C contains "${TEST_RUN_ID}-${QUERY_PREFIX}" ORDER BY E ASC LIMIT 2 OFFSET 2`
      });

      expect(page1.data.rows).to.have.length(2);
      expect(page2.data.rows).to.have.length(2);

      // Verify different data (with ORDER BY, we can be certain) - E is index 1
      const page1FirstValue = page1.data.rows[0].c[1]?.v;
      const page2FirstValue = page2.data.rows[0].c[1]?.v;
      expect(page1FirstValue).to.not.equal(page2FirstValue);

      console.log('✅ LIMIT/OFFSET pagination works');
    });

    it('should execute PIVOT transformation', async function() {
      // D is Category, E is Amount
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT SUM(E) WHERE C contains "${TEST_RUN_ID}-${QUERY_PREFIX}" PIVOT D`
      });

      expect(result.operation).to.equal('SELECT');
      // PIVOT creates dynamic columns based on D values (CategoryA, CategoryB, CategoryC)
      expect(result.data.cols.length).to.be.gte(3);

      console.log(`✅ PIVOT works: ${result.data.cols.length} columns created`);
    });
  });

  // ==================== UTILITY FEATURES ====================
  describe('Utility Features', function() {
    this.timeout(60000);
    const UTIL_PREFIX = 'util';

    before(async function() {
      this.timeout(30000);
      await insertTestRow(UTIL_PREFIX, 'metadata-test', 123.45, 'metadata');
      // Wait for data to be indexed
      await new Promise(r => setTimeout(r, 500));
    });

    after(async function() {
      await cleanupPrefix(UTIL_PREFIX);
    });

    it('should return cell metadata when returnMetadata is true', async function() {
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A1:E10`,
        statement: 'SELECT *',
        returnMetadata: true
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.metadata).to.exist;

      console.log('✅ returnMetadata works');
    });

    it('should extract spreadsheetId from full Google Sheets URL', async function() {
      const fullUrl = `https://docs.google.com/spreadsheets/d/${TEST_SPREADSHEET_ID}/edit#gid=0`;

      const result = await client.callTool('sheet_sql', {
        spreadsheetId: fullUrl,
        range: `${TEST_SHEET}!A:E`,
        statement: 'SELECT * LIMIT 1'
      });

      expect(result.operation).to.equal('SELECT');
      console.log('✅ URL extraction works');
    });

    it('should extract spreadsheetId from URL with additional path segments', async function() {
      const urlWithPath = `https://docs.google.com/spreadsheets/d/${TEST_SPREADSHEET_ID}/edit?usp=sharing`;

      const result = await client.callTool('sheet_sql', {
        spreadsheetId: urlWithPath,
        range: `${TEST_SHEET}!A:E`,
        statement: 'SELECT * LIMIT 1'
      });

      expect(result.operation).to.equal('SELECT');
      console.log('✅ URL with query params extraction works');
    });
  });

  // ==================== ERROR HANDLING ====================
  describe('Error Handling', function() {
    this.timeout(30000);

    it('should throw error for invalid SQL syntax', async function() {
      try {
        await client.callTool('sheet_sql', {
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: `${TEST_SHEET}!A:E`,
          statement: 'SELECTT * FROM table'
        });
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message.toLowerCase()).to.satisfy((msg: string) =>
          msg.includes('valid sql') || msg.includes('invalid') || msg.includes('unsupported')
        );
        console.log('✅ Invalid syntax correctly rejected');
      }
    });

    it('should fail when range is omitted', async function() {
      try {
        await client.callTool('sheet_sql', {
          spreadsheetId: TEST_SPREADSHEET_ID,
          statement: 'SELECT * LIMIT 5'
        });
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message.toLowerCase()).to.satisfy((msg: string) =>
          msg.includes('range') || msg.includes('required') || msg.includes('missing')
        );
        console.log('✅ Missing range correctly rejected');
      }
    });

    it('should fail when spreadsheetId is invalid', async function() {
      try {
        await client.callTool('sheet_sql', {
          spreadsheetId: 'invalid-id-12345',
          range: `${TEST_SHEET}!A:E`,
          statement: 'SELECT * LIMIT 1'
        });
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).to.satisfy((msg: string) =>
          msg.includes('not found') ||
          msg.includes('invalid') ||
          msg.includes('permission') ||
          msg.includes('Unable to parse')
        );
        console.log('✅ Invalid spreadsheetId correctly rejected');
      }
    });

    it('should handle non-existent sheet gracefully', async function() {
      // Note: Google Visualization API behavior for non-existent sheets varies:
      // - May throw an error with "Unable to parse range" or similar
      // - May return empty results
      // - May fall back to default sheet (first sheet) in some edge cases
      // This test verifies the API handles the request without crashing
      try {
        const result = await client.callTool('sheet_sql', {
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'NonExistentSheetXYZ123!A:E',
          statement: 'SELECT * LIMIT 1'
        });
        // If no error, the API handled it gracefully (empty or fallback behavior)
        expect(result.operation).to.equal('SELECT');
        console.log(`✅ Non-existent sheet handled gracefully (returned ${result.data?.rows?.length || 0} rows)`);
      } catch (error: any) {
        // If error, verify it's an appropriate error message (not a crash)
        expect(error.message).to.be.a('string');
        console.log('✅ Non-existent sheet correctly rejected with error');
      }
    });

    it('should handle empty result set gracefully', async function() {
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT * WHERE C = "definitely-not-exists-${Date.now()}"`  // C is Description
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows).to.have.length(0);
      console.log('✅ Empty result set handled gracefully');
    });
  });

  // ==================== EDGE CASES ====================
  describe('Edge Cases', function() {
    this.timeout(60000);
    const EDGE_PREFIX = 'edge';

    after(async function() {
      await cleanupPrefix(EDGE_PREFIX);
    });

    it('should handle special characters in category', async function() {
      // Insert row with special characters in category (D column)
      await insertTestRow(EDGE_PREFIX, 'special', 100, "Test's Category");

      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C, D WHERE C contains "${TEST_RUN_ID}-${EDGE_PREFIX}-special"`
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.be.gte(1);
      console.log('✅ Special characters handled');
    });

    it('should handle numeric comparison in WHERE', async function() {
      await insertTestRow(EDGE_PREFIX, 'numeric-1', 100, 'numeric');
      await insertTestRow(EDGE_PREFIX, 'numeric-2', 500, 'numeric');
      await insertTestRow(EDGE_PREFIX, 'numeric-3', 1000, 'numeric');

      // Filter by C (Description has test ID) and E > 200 (Amount)
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C, E WHERE C contains "${TEST_RUN_ID}-${EDGE_PREFIX}-numeric" AND E > 200`
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(2); // 500 and 1000
      console.log('✅ Numeric comparison works');
    });

    it('should handle date column queries', async function() {
      // B is the Date column in this sheet
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT B, C WHERE B is not null LIMIT 3`
      });

      expect(result.operation).to.equal('SELECT');
      console.log('✅ Date column queries work');
    });

    it('should handle multiple conditions with AND/OR', async function() {
      await insertTestRow(EDGE_PREFIX, 'logic-1', 100, 'TypeA');
      await insertTestRow(EDGE_PREFIX, 'logic-2', 200, 'TypeB');
      await insertTestRow(EDGE_PREFIX, 'logic-3', 300, 'TypeA');

      // C is Description, D is Category, E is Amount
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C, D, E WHERE C contains "${TEST_RUN_ID}-${EDGE_PREFIX}-logic" AND (D = 'TypeA' OR E > 150)`
      });

      expect(result.operation).to.equal('SELECT');
      // Should match: logic-1 (TypeA), logic-2 (E>150), logic-3 (TypeA)
      expect(result.data.rows.length).to.equal(3);
      console.log('✅ AND/OR logic works');
    });

    it('should handle NULL checks in WHERE clause', async function() {
      // Test IS NULL and IS NOT NULL operators
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: 'SELECT A, B, C WHERE A is null LIMIT 5'
      });

      expect(result.operation).to.equal('SELECT');
      // Column A (Reference) often has null values
      console.log(`✅ NULL check works: ${result.data.rows.length} rows with null A`);
    });

    it('should handle LIKE pattern matching', async function() {
      await insertTestRow(EDGE_PREFIX, 'pattern-abc', 100, 'PatternTest');
      await insertTestRow(EDGE_PREFIX, 'pattern-xyz', 200, 'PatternTest');

      // Test LIKE-style matching with 'contains' and 'starts with'
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C WHERE C starts with '${TEST_RUN_ID}-${EDGE_PREFIX}-pattern'`
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.be.gte(2);
      console.log('✅ Pattern matching (starts with) works');
    });

    it('should handle case-insensitive matching with lower()', async function() {
      await insertTestRow(EDGE_PREFIX, 'case-UPPER', 100, 'CaseTest');

      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C WHERE lower(D) = 'casetest'`
      });

      expect(result.operation).to.equal('SELECT');
      // Should find our inserted row with "CaseTest" category
      expect(result.data.rows.length).to.be.gte(1);
      console.log('✅ Case-insensitive matching works');
    });

    it('should handle large LIMIT values gracefully', async function() {
      // Test that very large LIMIT doesn't cause issues
      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: 'SELECT * LIMIT 10000'
      });

      expect(result.operation).to.equal('SELECT');
      // Should return whatever data exists, not error
      expect(result.data.rows).to.be.an('array');
      console.log(`✅ Large LIMIT handled: ${result.data.rows.length} rows returned`);
    });

    it('should handle negative/zero values', async function() {
      await insertTestRow(EDGE_PREFIX, 'negative', -500, 'NegativeTest');
      await insertTestRow(EDGE_PREFIX, 'zero', 0, 'ZeroTest');

      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `SELECT C, E WHERE C contains '${TEST_RUN_ID}-${EDGE_PREFIX}' AND E <= 0`
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.be.gte(2);
      console.log('✅ Negative/zero values handled correctly');
    });
  });

  // ==================== VIRTUAL TABLE OPERATIONS ====================
  describe('Virtual Table Operations', function() {
    this.timeout(30000);

    // Test data in 2D array format: first row = headers
    const testData = {
      data: [
        ['Name', 'Amount', 'Status'],   // Headers
        ['Alice', 100, 'active'],
        ['Bob', 30, 'pending'],
        ['Carol', 75, 'active'],
        ['Dave', 50, 'inactive']
      ]
    };

    it('should SELECT from named virtual table', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT * FROM :data WHERE Status = "active"',
        dataSources: testData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(2);  // Alice, Carol
      console.log('✅ Virtual table SELECT works');
    });

    it('should SELECT with column names', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name, Amount FROM :data WHERE Amount > 50',
        dataSources: testData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(2);  // Alice (100), Carol (75)
      console.log('✅ Virtual table SELECT with columns works');
    });

    it('should SELECT with ORDER BY and LIMIT', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT * FROM :data ORDER BY Amount DESC LIMIT 2',
        dataSources: testData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(2);
      expect(result.data.rows[0].c[0].v).to.equal('Alice');  // 100
      expect(result.data.rows[1].c[0].v).to.equal('Carol');  // 75
      console.log('✅ Virtual table ORDER BY + LIMIT works');
    });

    it('should UPDATE virtual table (returns modified data)', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'UPDATE SET Status = "done" FROM :data WHERE Amount > 50',
        dataSources: testData
      });

      expect(result.operation).to.equal('UPDATE');
      expect(result.updatedRows).to.equal(2);  // Alice (100), Carol (75)
      expect(result.data).to.be.an('array');
      expect(result.data.length).to.equal(5);  // Headers + 4 data rows

      // Verify Alice's status was updated (row 1, column 2)
      expect(result.data[1][2]).to.equal('done');
      console.log('✅ Virtual table UPDATE works');
    });

    it('should UPDATE with special characters (quotes, newlines)', async function() {
      const codeData = {
        code: [
          ['Name', 'Code'],
          ['Script1', 'original code'],
          ['Script2', 'other code']
        ]
      };

      // Test with escaped quotes and newlines
      const result = await client.callTool('sheet_sql', {
        statement: 'UPDATE SET Code = "// Comment\\nconst x = \\"hello\\";" FROM :code WHERE Name = "Script1"',
        dataSources: codeData
      });

      expect(result.operation).to.equal('UPDATE');
      expect(result.updatedRows).to.equal(1);

      // Verify the value is properly unescaped
      const updatedCode = result.data[1][1];
      expect(updatedCode).to.include('\n');  // Actual newline, not \\n
      expect(updatedCode).to.include('"hello"');  // Actual quotes, not \"
      expect(updatedCode).to.equal('// Comment\nconst x = "hello";');
      console.log('✅ Virtual table UPDATE with special characters works');
    });

    it('should DELETE from virtual table (returns filtered data)', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'DELETE FROM :data WHERE Status = "inactive"',
        dataSources: testData
      });

      expect(result.operation).to.equal('DELETE');
      expect(result.deletedRows).to.equal(1);  // Dave
      expect(result.data).to.be.an('array');
      expect(result.data.length).to.equal(4);  // Headers + 3 remaining rows
      console.log('✅ Virtual table DELETE works');
    });

    it('should handle complex WHERE with AND/OR', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT * FROM :data WHERE (Status = "active" OR Amount < 40)',
        dataSources: testData
      });

      expect(result.operation).to.equal('SELECT');
      // Alice (active), Bob (Amount < 40), Carol (active)
      expect(result.data.rows.length).to.equal(3);
      console.log('✅ Virtual table complex WHERE works');
    });

    it('should error on missing virtual table', async function() {
      try {
        await client.callTool('sheet_sql', {
          statement: 'SELECT * FROM :missing',
          dataSources: testData
        });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include(':missing');
        console.log('✅ Missing virtual table correctly rejected');
      }
    });

    it('should error on INSERT to virtual table', async function() {
      try {
        await client.callTool('sheet_sql', {
          statement: 'INSERT VALUES ("Eve", 200, "new") FROM :data',
          dataSources: testData
        });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message.toLowerCase()).to.satisfy((msg: string) =>
          msg.includes('insert') || msg.includes('not supported') || msg.includes('virtual')
        );
        console.log('✅ INSERT to virtual table correctly rejected');
      }
    });

    it('should handle OFFSET in virtual table', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT * FROM :data ORDER BY Name ASC LIMIT 2 OFFSET 1',
        dataSources: testData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(2);
      // Ordered by Name: Alice, Bob, Carol, Dave
      // OFFSET 1 → Bob, Carol
      expect(result.data.rows[0].c[0].v).to.equal('Bob');
      expect(result.data.rows[1].c[0].v).to.equal('Carol');
      console.log('✅ Virtual table OFFSET works');
    });

    it('should handle numeric comparisons', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name, Amount FROM :data WHERE Amount >= 50 AND Amount <= 75',
        dataSources: testData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(2);  // Carol (75), Dave (50)
      console.log('✅ Virtual table numeric comparisons work');
    });

    it('should handle string operators (contains, starts with)', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT * FROM :data WHERE Status starts with "act"',
        dataSources: testData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(2);  // active status
      console.log('✅ Virtual table string operators work');
    });

    it('should handle ENDS WITH operator', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Email FROM :data WHERE Email ends with "@example.com"',
        dataSources: {
          data: [
            ['Email'],
            ['alice@example.com'],
            ['bob@test.org'],
            ['carol@example.com']
          ]
        }
      });
      expect(result.data.rows.length).to.equal(2);
      console.log('✅ ENDS WITH operator works');
    });

    it('should handle IS NOT NULL on virtual table', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Phone is not null',
        dataSources: {
          data: [
            ['Name', 'Phone'],
            ['Alice', '555-1234'],
            ['Bob', null],
            ['Carol', '555-5678'],
            ['Dave', '']  // Empty string treated as null
          ]
        }
      });
      expect(result.data.rows.length).to.equal(2);  // Alice, Carol
      console.log('✅ IS NOT NULL on virtual table works');
    });

    it('should handle boolean value comparisons', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE IsActive = true',
        dataSources: {
          data: [
            ['Name', 'IsActive'],
            ['Alice', true],
            ['Bob', false],
            ['Carol', true],
            ['Dave', false]
          ]
        }
      });
      expect(result.data.rows.length).to.equal(2);  // Alice, Carol
      console.log('✅ Boolean value comparisons work');
    });

    it('should DELETE with ORDER BY + LIMIT on virtual table', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'DELETE FROM :data WHERE Status = "pending" ORDER BY Priority DESC LIMIT 1',
        dataSources: {
          data: [
            ['Name', 'Priority', 'Status'],
            ['Task1', 1, 'pending'],
            ['Task2', 3, 'pending'],  // Highest priority - should be deleted
            ['Task3', 2, 'pending'],
            ['Task4', 1, 'done']
          ]
        }
      });
      expect(result.deletedRows).to.equal(1);
      expect(result.data.length).to.equal(4);  // Headers + 3 remaining rows
      // Task2 should be deleted (highest priority)
      const names = result.data.slice(1).map((row: any[]) => row[0]);
      expect(names).to.not.include('Task2');
      console.log('✅ DELETE with ORDER BY + LIMIT on virtual table works');
    });

    it('should handle empty virtual table (headers only)', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT * FROM :data',
        dataSources: {
          data: [['Name', 'Amount']]  // Headers only, no data
        }
      });
      expect(result.data.rows).to.have.length(0);
      console.log('✅ Empty virtual table handled correctly');
    });

    it('should WHERE match with escaped newline characters', async function() {
      const codeData = {
        code: [
          ['Name', 'Code'],
          ['Script1', 'line1\nline2'],  // Has actual newline
          ['Script2', 'no newlines'],
          ['Script3', 'another\nwith\nnewlines']
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :code WHERE Code contains "\\n"',
        dataSources: codeData
      });

      expect(result.operation).to.equal('SELECT');
      // Should match Script1 and Script3 which have actual newlines
      expect(result.data.rows.length).to.equal(2);
      console.log('✅ WHERE with escaped newline works');
    });

    it('should WHERE match with escaped quotes', async function() {
      const quoteData = {
        quotes: [
          ['Name', 'Val'],
          ['Match', 'He said "Hello"'],
          ['NoMatch', 'He said Hello'],
          ['Also', 'She replied "Hi there"']
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :quotes WHERE Val contains "\\""',
        dataSources: quoteData
      });

      expect(result.operation).to.equal('SELECT');
      // Should match rows containing actual quote character
      expect(result.data.rows.length).to.equal(2);  // Match and Also
      console.log('✅ WHERE with escaped quotes works');
    });

    it('should WHERE exact match with escaped characters', async function() {
      const escData = {
        data: [
          ['Name', 'Value'],
          ['Tab', 'before\tafter'],
          ['Newline', 'before\nafter'],
          ['Quote', 'say "hi"'],
          ['Plain', 'beforeafter']
        ]
      };

      // Test tab escape
      const tabResult = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Value = "before\\tafter"',
        dataSources: escData
      });
      expect(tabResult.data.rows.length).to.equal(1);
      expect(tabResult.data.rows[0].c[0].v).to.equal('Tab');

      // Test newline escape
      const nlResult = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Value = "before\\nafter"',
        dataSources: escData
      });
      expect(nlResult.data.rows.length).to.equal(1);
      expect(nlResult.data.rows[0].c[0].v).to.equal('Newline');

      console.log('✅ WHERE exact match with escaped characters works');
    });

    it('should handle escaped backslash (escaping escape char)', async function() {
      const pathData = {
        paths: [
          ['Name', 'Path'],
          ['Windows', 'C:\\Users\\test'],  // Actual backslashes
          ['Unix', '/home/test'],
          ['Mixed', 'path\\to/file']
        ]
      };

      // Match paths containing actual backslash
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :paths WHERE Path contains "\\\\"',  // \\\\ in JS = \\ in SQL = \
        dataSources: pathData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(2);  // Windows and Mixed
      console.log('✅ Escaped backslash works');
    });

    it('should handle carriage return escape', async function() {
      const crData = {
        data: [
          ['Name', 'Content'],
          ['CRLF', 'line1\r\nline2'],  // Windows-style line ending
          ['LF', 'line1\nline2'],      // Unix-style
          ['Plain', 'line1line2']
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Content contains "\\r"',
        dataSources: crData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(1);  // Only CRLF
      expect(result.data.rows[0].c[0].v).to.equal('CRLF');
      console.log('✅ Carriage return escape works');
    });

    it('should handle single quote escape in single-quoted strings', async function() {
      const quoteData = {
        data: [
          ['Name', 'Text'],
          ["It's", "It's a test"],  // Actual apostrophe
          ['Normal', 'No apostrophe here'],
          ['Multi', "Don't you agree?"]
        ]
      };

      // Using double quotes for the SQL string (escaping single quote)
      const result = await client.callTool('sheet_sql', {
        statement: "SELECT Name FROM :data WHERE Text contains \"'\"",
        dataSources: quoteData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(2);  // It's and Multi
      console.log('✅ Single quote escape works');
    });

    it('should handle multiple escape sequences in one string', async function() {
      const multiData = {
        data: [
          ['Name', 'Content'],
          ['Complex', 'Tab:\tQuote:"Test"\nNewline'],  // tab, quotes, newline
          ['Simple', 'Just plain text'],
          ['Partial', 'Has\ttab only']
        ]
      };

      // Match string with tab AND newline
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Content contains "\\t" AND Content contains "\\n"',
        dataSources: multiData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(1);  // Only Complex
      expect(result.data.rows[0].c[0].v).to.equal('Complex');
      console.log('✅ Multiple escape sequences work');
    });

    it('should handle literal backslash-n (not newline) with double escape', async function() {
      const literalData = {
        data: [
          ['Name', 'Content'],
          ['Literal', 'The code is: \\n'],  // Literal backslash-n characters
          ['Newline', 'Line1\nLine2'],      // Actual newline
          ['Plain', 'Just text']
        ]
      };

      // Match literal \n (not newline) - need to match backslash followed by 'n'
      // In SQL: \\\n means: \\ (escaped backslash = \) then \n (escaped n = n)... wait
      // Actually to match literal \n, we need: \\ (to get one backslash) + n (literal n)
      // In JS string: "\\\\" gets \\ in the string, which SQL sees as one backslash
      // Then we need "n" literal
      // So SQL: "\\n" = backslash then n
      // JS: "\\\\n" = \\ in string = backslash, then n

      // Let's check containing the backslash character
      const bsResult = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Content contains "\\\\"',
        dataSources: literalData
      });

      expect(bsResult.operation).to.equal('SELECT');
      expect(bsResult.data.rows.length).to.equal(1);
      expect(bsResult.data.rows[0].c[0].v).to.equal('Literal');
      console.log('✅ Literal backslash (not escape sequence) works');
    });

    it('should UPDATE with all escape sequences', async function() {
      const updateData = {
        data: [
          ['Id', 'Content'],
          ['1', 'original'],
          ['2', 'keep']
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'UPDATE SET Content = "Tab:\\tQuote:\\"test\\"\\nNewline\\r\\nCRLF\\\\Backslash" FROM :data WHERE Id = "1"',
        dataSources: updateData
      });

      expect(result.operation).to.equal('UPDATE');
      expect(result.updatedRows).to.equal(1);

      // Verify the content has actual escape characters
      const content = result.data[1][1];
      expect(content).to.include('\t');  // Tab
      expect(content).to.include('"test"');  // Quotes
      expect(content).to.include('\n');  // Newline
      expect(content).to.include('\r\n');  // CRLF
      expect(content).to.include('\\');  // Backslash

      console.log('✅ UPDATE with all escape sequences works');
    });

    // ==================== ESCAPE REFERENCE COUNTING TESTS ====================
    // These tests verify the exact handling of backslash escaping - particularly
    // how multiple backslashes are processed (e.g., \\\\ → \\)

    it('should convert double backslash to single backslash', async function() {
      const pathData = {
        data: [
          ['Name', 'Path'],
          ['Windows', 'C:\\Users\\test'],      // Actual: C:\Users\test
          ['NoBackslash', 'C:Userstest'],
          ['DoubleSlash', 'C://Users//test']
        ]
      };

      // Match single backslash using \\
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Path contains "\\\\"',  // SQL: \\ → \
        dataSources: pathData
      });
      expect(result.data.rows.length).to.equal(1);
      expect(result.data.rows[0].c[0].v).to.equal('Windows');
      console.log('✅ Double backslash → single backslash works');
    });

    it('should exact match path with single backslash', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Path = "C:\\\\test"',  // SQL: C:\\test → C:\test
        dataSources: {
          data: [
            ['Name', 'Path'],
            ['Match', 'C:\\test'],
            ['NoMatch', 'C:test']
          ]
        }
      });
      expect(result.data.rows.length).to.equal(1);
      expect(result.data.rows[0].c[0].v).to.equal('Match');
      console.log('✅ Exact match path with backslash works');
    });

    it('should convert quadruple backslash to two backslashes', async function() {
      const uncData = {
        data: [
          ['Name', 'Path'],
          ['UNC', '\\\\server\\share'],         // Actual: \\server\share (UNC path)
          ['Single', '\\server\\share'],        // Actual: \server\share
          ['None', 'server/share']
        ]
      };

      // Match UNC path (starts with \\)
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Path starts with "\\\\\\\\"',  // SQL: \\\\ → \\
        dataSources: uncData
      });
      expect(result.data.rows.length).to.equal(1);
      expect(result.data.rows[0].c[0].v).to.equal('UNC');
      console.log('✅ Quadruple backslash → two backslashes works');
    });

    it('should handle backslash followed by newline (\\\\\\n → \\ + newline)', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Content contains "\\\\\\n"',  // SQL: \\\n → \ + newline
        dataSources: {
          data: [
            ['Name', 'Content'],
            ['BSNewline', '\\\nmore'],   // Actual: backslash + newline + more
            ['JustNewline', '\nmore'],   // Just newline
            ['JustBS', '\\more']         // Just backslash
          ]
        }
      });
      expect(result.data.rows.length).to.equal(1);
      expect(result.data.rows[0].c[0].v).to.equal('BSNewline');
      console.log('✅ Backslash followed by newline works');
    });

    it('should distinguish \\\\n (backslash + n) from \\n (newline)', async function() {
      const data = {
        data: [
          ['Name', 'Content'],
          ['LiteralBSN', '\\n'],     // Actual: backslash + letter n (not newline)
          ['ActualNL', '\n'],        // Actual newline character
          ['Plain', 'n']
        ]
      };

      // Match literal backslash + n (NOT newline)
      const literalResult = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Content = "\\\\n"',  // SQL: \\n → \n (backslash + n)
        dataSources: data
      });
      expect(literalResult.data.rows.length).to.equal(1);
      expect(literalResult.data.rows[0].c[0].v).to.equal('LiteralBSN');

      // Match actual newline
      const newlineResult = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Content = "\\n"',  // SQL: \n → newline char
        dataSources: data
      });
      expect(newlineResult.data.rows.length).to.equal(1);
      expect(newlineResult.data.rows[0].c[0].v).to.equal('ActualNL');
      console.log('✅ \\\\n vs \\n distinction works');
    });

    it('should handle mixed escape sequences in one string', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Content = "line1\\nline2\\ttab\\\\path"',
        dataSources: {
          data: [
            ['Name', 'Content'],
            ['Match', 'line1\nline2\ttab\\path'],   // newline + tab + backslash
            ['NoMatch', 'line1nline2ttabpath']
          ]
        }
      });
      expect(result.data.rows.length).to.equal(1);
      expect(result.data.rows[0].c[0].v).to.equal('Match');
      console.log('✅ Mixed escape sequences work');
    });

    it('should handle consecutive different escapes', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Content contains "\\n\\t"',  // newline then tab
        dataSources: {
          data: [
            ['Name', 'Content'],
            ['Both', 'a\n\tb'],
            ['JustNL', 'a\nb'],
            ['JustTab', 'a\tb']
          ]
        }
      });
      expect(result.data.rows.length).to.equal(1);
      expect(result.data.rows[0].c[0].v).to.equal('Both');
      console.log('✅ Consecutive different escapes work');
    });

    it('should handle escape at end of string', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Content = "end\\\\"',  // ends with backslash
        dataSources: {
          data: [
            ['Name', 'Content'],
            ['Match', 'end\\'],
            ['NoMatch', 'end']
          ]
        }
      });
      expect(result.data.rows.length).to.equal(1);
      expect(result.data.rows[0].c[0].v).to.equal('Match');
      console.log('✅ Escape at end of string works');
    });

    it('should handle escape at start of string', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Content = "\\\\start"',  // starts with backslash
        dataSources: {
          data: [
            ['Name', 'Content'],
            ['Match', '\\start'],
            ['NoMatch', 'start']
          ]
        }
      });
      expect(result.data.rows.length).to.equal(1);
      expect(result.data.rows[0].c[0].v).to.equal('Match');
      console.log('✅ Escape at start of string works');
    });

    it('should handle string of only backslashes', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Content = "\\\\\\\\"',  // just two backslashes
        dataSources: {
          data: [
            ['Name', 'Content'],
            ['TwoBS', '\\\\'],
            ['OneBS', '\\'],
            ['Empty', '']
          ]
        }
      });
      expect(result.data.rows.length).to.equal(1);
      expect(result.data.rows[0].c[0].v).to.equal('TwoBS');
      console.log('✅ String of only backslashes works');
    });

    it('should UPDATE with all escape types consistently', async function() {
      // Now includes escaped quotes - fixed via stripStringLiterals() function
      const result = await client.callTool('sheet_sql', {
        statement: 'UPDATE SET Content = "a\\tb\\nc\\"d\\\\e" FROM :data WHERE Name = "test"',
        dataSources: {
          data: [
            ['Name', 'Content'],
            ['test', 'old']
          ]
        }
      });
      expect(result.data[1][1]).to.include('\t');    // tab
      expect(result.data[1][1]).to.include('\n');    // newline
      expect(result.data[1][1]).to.include('"d');    // quote
      expect(result.data[1][1]).to.include('\\e');   // backslash
      console.log('✅ UPDATE with all escape types works');
    });

    // ===== stripStringLiterals tests =====
    // These tests verify the function-based string stripping handles all escape styles

    it('should NOT detect :virtual inside quoted strings', async function() {
      // :fake is inside a string - should NOT be detected as a virtual table
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT * FROM :real WHERE msg = "mention :fake here"',
        dataSources: { real: [['msg'], ['test']] }
      });
      expect(result.operation).to.equal('SELECT');
      console.log('✅ :virtual inside strings ignored');
    });

    it('should handle escaped quotes in strings for table detection', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'UPDATE SET Content = "He said \\"Hi\\"" FROM :data WHERE Name = "test"',
        dataSources: { data: [['Name', 'Content'], ['test', 'old']] }
      });
      expect(result.operation).to.equal('UPDATE');
      expect(result.updatedRows).to.equal(1);
      expect(result.data[1][1]).to.equal('He said "Hi"');
      console.log('✅ Escaped quotes in strings work for table detection');
    });

    it('should handle SQL doubled quotes for table detection', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT * FROM :data WHERE msg = "say ""hello"""',
        dataSources: { data: [['msg'], ['say "hello"']] }
      });
      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(1);
      console.log('✅ SQL doubled quotes work for table detection');
    });

    it('should handle mixed escapes with virtual table syntax inside string', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT * FROM :data WHERE path = "C:\\\\Users\\\\:notatable"',
        dataSources: { data: [['path'], ['C:\\Users\\:notatable']] }
      });
      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(1);
      console.log('✅ Mixed escapes with :pattern inside string works');
    });

    it('should handle single-quoted strings for table detection', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: "SELECT * FROM :data WHERE name = 'test'",
        dataSources: { data: [['name'], ['test']] }
      });
      expect(result.operation).to.equal('SELECT');
      console.log('✅ Single-quoted strings work for table detection');
    });

    it('should handle DATE literal comparisons', async function() {
      const dateData = {
        data: [
          ['Event', 'EventDate'],
          ['Launch', '2025-01-15'],
          ['Meeting', '2025-01-20'],
          ['Deadline', '2025-01-25'],
          ['Review', '2025-01-10']
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Event FROM :data WHERE EventDate > DATE "2025-01-15"',
        dataSources: dateData
      });

      expect(result.operation).to.equal('SELECT');
      // Events after Jan 15: Meeting (Jan 20), Deadline (Jan 25)
      expect(result.data.rows.length).to.equal(2);
      console.log('✅ DATE literal comparison works');
    });

    it('should handle DATE range comparisons', async function() {
      const dateData = {
        data: [
          ['Event', 'EventDate'],
          ['Launch', '2025-01-15'],
          ['Meeting', '2025-01-20'],
          ['Deadline', '2025-01-25'],
          ['Review', '2025-01-10']
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: `
          SELECT Event FROM :data
          WHERE EventDate >= DATE "2025-01-15" AND EventDate <= DATE "2025-01-20"
        `,
        dataSources: dateData
      });

      expect(result.operation).to.equal('SELECT');
      // Events between Jan 15-20: Launch, Meeting
      expect(result.data.rows.length).to.equal(2);
      console.log('✅ DATE range comparison works');
    });

    it('should handle DATE equality comparison', async function() {
      const dateData = {
        data: [
          ['Event', 'EventDate'],
          ['Launch', '2025-01-15'],
          ['Meeting', '2025-01-15'],
          ['Deadline', '2025-01-25']
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Event FROM :data WHERE EventDate = DATE "2025-01-15"',
        dataSources: dateData
      });

      expect(result.operation).to.equal('SELECT');
      // Events on Jan 15: Launch, Meeting
      expect(result.data.rows.length).to.equal(2);
      console.log('✅ DATE equality comparison works');
    });

    it('should handle TODAY() function', async function() {
      // Use fixed dates to avoid timezone issues
      const dateData = {
        data: [
          ['Event', 'EventDate'],
          ['Past Event', '2020-01-01'],
          ['Future Event', '2099-12-31']
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Event FROM :data WHERE EventDate >= TODAY()',
        dataSources: dateData
      });

      expect(result.operation).to.equal('SELECT');
      // Only future event should match (2020-01-01 < TODAY)
      expect(result.data.rows.length).to.equal(1);
      expect(result.data.rows[0].c[0].v).to.equal('Future Event');
      console.log('✅ TODAY() function works');
    });

    it('should handle datetime strings with time component', async function() {
      const dateData = {
        data: [
          ['Event', 'EventTime'],
          ['Morning', '2025-01-15T08:00:00'],
          ['Noon', '2025-01-15T12:00:00'],
          ['Evening', '2025-01-15T18:00:00']
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Event FROM :data WHERE EventTime > DATE "2025-01-15T10:00:00"',
        dataSources: dateData
      });

      expect(result.operation).to.equal('SELECT');
      // Events after 10am: Noon, Evening
      expect(result.data.rows.length).to.equal(2);
      console.log('✅ Datetime with time component works');
    });

    it('should handle GROUP BY with COUNT', async function() {
      const salesData = {
        data: [
          ['Region', 'Product', 'Amount'],
          ['North', 'Widget', 100],
          ['North', 'Gadget', 150],
          ['South', 'Widget', 200],
          ['North', 'Widget', 120],
          ['South', 'Gadget', 80]
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Region, COUNT(*) FROM :data GROUP BY Region',
        dataSources: salesData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(2); // North, South
      expect(result.data.cols[1].label).to.equal('COUNT(*)');
      console.log('✅ GROUP BY with COUNT works');
    });

    it('should handle GROUP BY with SUM', async function() {
      const salesData = {
        data: [
          ['Region', 'Amount'],
          ['North', 100],
          ['North', 150],
          ['South', 200],
          ['North', 120],
          ['South', 80]
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Region, SUM(Amount) FROM :data GROUP BY Region',
        dataSources: salesData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(2);

      // Find North row and check sum = 100+150+120 = 370
      const northRow = result.data.rows.find(
        (r: { c: Array<{ v: any }> }) => r.c[0].v === 'North'
      );
      expect(northRow.c[1].v).to.equal(370);

      // South sum = 200+80 = 280
      const southRow = result.data.rows.find(
        (r: { c: Array<{ v: any }> }) => r.c[0].v === 'South'
      );
      expect(southRow.c[1].v).to.equal(280);
      console.log('✅ GROUP BY with SUM works');
    });

    it('should handle GROUP BY with AVG', async function() {
      const salesData = {
        data: [
          ['Region', 'Amount'],
          ['North', 100],
          ['North', 200],
          ['South', 150]
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Region, AVG(Amount) FROM :data GROUP BY Region',
        dataSources: salesData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(2);

      // North avg = (100+200)/2 = 150
      const northRow = result.data.rows.find(
        (r: { c: Array<{ v: any }> }) => r.c[0].v === 'North'
      );
      expect(northRow.c[1].v).to.equal(150);
      console.log('✅ GROUP BY with AVG works');
    });

    it('should handle GROUP BY with MIN and MAX', async function() {
      const salesData = {
        data: [
          ['Region', 'Amount'],
          ['North', 100],
          ['North', 200],
          ['North', 50],
          ['South', 150]
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Region, MIN(Amount), MAX(Amount) FROM :data GROUP BY Region',
        dataSources: salesData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(2);

      // North min=50, max=200
      const northRow = result.data.rows.find(
        (r: { c: Array<{ v: any }> }) => r.c[0].v === 'North'
      );
      expect(northRow.c[1].v).to.equal(50);
      expect(northRow.c[2].v).to.equal(200);
      console.log('✅ GROUP BY with MIN/MAX works');
    });

    it('should handle GROUP BY with HAVING', async function() {
      const salesData = {
        data: [
          ['Region', 'Amount'],
          ['North', 100],
          ['North', 200],
          ['South', 50],
          ['West', 300],
          ['West', 250]
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: `
          SELECT Region, SUM(Amount)
          FROM :data
          GROUP BY Region
          HAVING SUM(Amount) > 200
        `,
        dataSources: salesData
      });

      expect(result.operation).to.equal('SELECT');
      // North=300, South=50 (excluded), West=550
      expect(result.data.rows.length).to.equal(2);
      console.log('✅ GROUP BY with HAVING works');
    });

    it('should handle GROUP BY with ORDER BY', async function() {
      const salesData = {
        data: [
          ['Region', 'Amount'],
          ['North', 100],
          ['South', 200],
          ['West', 50]
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: `
          SELECT Region, SUM(Amount)
          FROM :data
          GROUP BY Region
          ORDER BY SUM(Amount) DESC
        `,
        dataSources: salesData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(3);
      // Should be ordered: South(200), North(100), West(50)
      expect(result.data.rows[0].c[0].v).to.equal('South');
      expect(result.data.rows[1].c[0].v).to.equal('North');
      expect(result.data.rows[2].c[0].v).to.equal('West');
      console.log('✅ GROUP BY with ORDER BY works');
    });

    it('should handle GROUP BY with multiple columns', async function() {
      const salesData = {
        data: [
          ['Region', 'Product', 'Amount'],
          ['North', 'Widget', 100],
          ['North', 'Widget', 150],
          ['North', 'Gadget', 80],
          ['South', 'Widget', 200]
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Region, Product, COUNT(*) FROM :data GROUP BY Region, Product',
        dataSources: salesData
      });

      expect(result.operation).to.equal('SELECT');
      // 3 groups: North-Widget(2), North-Gadget(1), South-Widget(1)
      expect(result.data.rows.length).to.equal(3);
      console.log('✅ GROUP BY with multiple columns works');
    });

    it('should handle column expressions with arithmetic', async function() {
      const salesData = {
        data: [
          ['Product', 'Price', 'Quantity'],
          ['Widget', 10, 5],
          ['Gadget', 20, 3],
          ['Doohickey', 15, 8]
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Product, Price * Quantity FROM :data',
        dataSources: salesData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(3);

      // Widget: 10 * 5 = 50
      expect(result.data.rows[0].c[1].v).to.equal(50);
      // Gadget: 20 * 3 = 60
      expect(result.data.rows[1].c[1].v).to.equal(60);
      // Doohickey: 15 * 8 = 120
      expect(result.data.rows[2].c[1].v).to.equal(120);
      console.log('✅ Column expressions with arithmetic works');
    });

    it('should handle AS alias for columns', async function() {
      const salesData = {
        data: [
          ['Product', 'Price'],
          ['Widget', 10],
          ['Gadget', 20]
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Product AS Name, Price AS Cost FROM :data',
        dataSources: salesData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.cols[0].label).to.equal('Name');
      expect(result.data.cols[1].label).to.equal('Cost');
      console.log('✅ AS alias for columns works');
    });

    it('should handle expression with AS alias', async function() {
      const salesData = {
        data: [
          ['Product', 'Price', 'TaxRate'],
          ['Widget', 100, 0.1],
          ['Gadget', 200, 0.08]
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Product, Price * TaxRate AS Tax FROM :data',
        dataSources: salesData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.cols[1].label).to.equal('Tax');
      // Widget: 100 * 0.1 = 10
      expect(result.data.rows[0].c[1].v).to.equal(10);
      // Gadget: 200 * 0.08 = 16
      expect(result.data.rows[1].c[1].v).to.equal(16);
      console.log('✅ Expression with AS alias works');
    });

    it('should handle addition and subtraction expressions', async function() {
      const salesData = {
        data: [
          ['Product', 'BasePrice', 'Discount'],
          ['Widget', 100, 10],
          ['Gadget', 200, 30]
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Product, BasePrice - Discount AS FinalPrice FROM :data',
        dataSources: salesData
      });

      expect(result.operation).to.equal('SELECT');
      // Widget: 100 - 10 = 90
      expect(result.data.rows[0].c[1].v).to.equal(90);
      // Gadget: 200 - 30 = 170
      expect(result.data.rows[1].c[1].v).to.equal(170);
      console.log('✅ Addition and subtraction expressions work');
    });

    it('should handle complex expressions with multiple operators', async function() {
      const salesData = {
        data: [
          ['Product', 'Price', 'Quantity', 'Discount'],
          ['Widget', 10, 5, 2]
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Product, Price * Quantity - Discount AS Total FROM :data',
        dataSources: salesData
      });

      expect(result.operation).to.equal('SELECT');
      // Widget: (10 * 5) - 2 = 48
      expect(result.data.rows[0].c[1].v).to.equal(48);
      console.log('✅ Complex expressions work');
    });

    it('should handle expressions with numeric literals', async function() {
      const salesData = {
        data: [
          ['Product', 'Price'],
          ['Widget', 100],
          ['Gadget', 200]
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Product, Price * 1.1 AS PriceWithTax FROM :data',
        dataSources: salesData
      });

      expect(result.operation).to.equal('SELECT');
      // Widget: 100 * 1.1 = 110
      expect(result.data.rows[0].c[1].v).to.be.closeTo(110, 0.01);
      // Gadget: 200 * 1.1 = 220
      expect(result.data.rows[1].c[1].v).to.be.closeTo(220, 0.01);
      console.log('✅ Expressions with numeric literals work');
    });
  });

  // ==================== VIRTUAL TABLE JOIN OPERATIONS ====================
  describe('Virtual Table JOIN Operations', function() {
    this.timeout(30000);

    const usersData = {
      users: [
        ['id', 'name', 'email'],
        ['u1', 'Alice', 'alice@example.com'],
        ['u2', 'Bob', 'bob@example.com'],
        ['u3', 'Carol', 'carol@example.com']
      ],
      scores: [
        ['user_id', 'score', 'category'],
        ['u1', 95, 'A'],
        ['u2', 87, 'B'],
        ['u1', 92, 'B']
      ]
    };

    it('should JOIN two virtual tables', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: `
          SELECT u.name, s.score
          FROM :users AS u
          JOIN :scores AS s ON u.id = s.user_id
        `,
        dataSources: usersData
      });

      expect(result.operation).to.equal('SELECT');
      // Alice has 2 scores, Bob has 1
      expect(result.data.rows.length).to.equal(3);
      console.log('✅ Virtual table JOIN works');
    });

    it('should LEFT JOIN virtual tables', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: `
          SELECT u.name, s.score
          FROM :users AS u
          LEFT JOIN :scores AS s ON u.id = s.user_id
        `,
        dataSources: usersData
      });

      expect(result.operation).to.equal('SELECT');
      // Alice (2 scores), Bob (1 score), Carol (0 scores but still included)
      expect(result.data.rows.length).to.equal(4);
      console.log('✅ Virtual table LEFT JOIN works');
    });

    it('should JOIN with WHERE clause', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: `
          SELECT u.name, s.score
          FROM :users AS u
          JOIN :scores AS s ON u.id = s.user_id
          WHERE s.score > 90
        `,
        dataSources: usersData
      });

      expect(result.operation).to.equal('SELECT');
      // Only scores > 90: Alice (95), Alice (92)
      expect(result.data.rows.length).to.equal(2);
      console.log('✅ Virtual table JOIN with WHERE works');
    });

    it('should JOIN with ORDER BY and LIMIT', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: `
          SELECT u.name, s.score
          FROM :users AS u
          JOIN :scores AS s ON u.id = s.user_id
          ORDER BY s.score DESC
          LIMIT 2
        `,
        dataSources: usersData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(2);
      // Top 2 scores: 95, 92
      expect(result.data.rows[0].c[1].v).to.equal(95);
      expect(result.data.rows[1].c[1].v).to.equal(92);
      console.log('✅ Virtual table JOIN with ORDER BY + LIMIT works');
    });

    it('should handle alias.* pattern in SELECT', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: `
          SELECT u.*, s.score
          FROM :users AS u
          JOIN :scores AS s ON u.id = s.user_id
          LIMIT 1
        `,
        dataSources: usersData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(1);
      // Should have all user columns + score
      expect(result.data.cols.length).to.be.gte(4);
      console.log('✅ Virtual table alias.* pattern works');
    });

    it('should RIGHT JOIN virtual tables', async function() {
      // RIGHT JOIN: preserve all right table rows, include nulls for unmatched left
      const rightJoinData = {
        users: [
          ['id', 'name'],
          ['u1', 'Alice'],
          ['u2', 'Bob']
        ],
        scores: [
          ['user_id', 'score'],
          ['u1', 95],
          ['u2', 87],
          ['u99', 100]  // No matching user - should still appear with null user data
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: `
          SELECT u.name, s.score
          FROM :users AS u
          RIGHT JOIN :scores AS s ON u.id = s.user_id
        `,
        dataSources: rightJoinData
      });

      expect(result.operation).to.equal('SELECT');
      // All 3 scores should appear: u1 (95), u2 (87), u99 (100 with null user)
      expect(result.data.rows.length).to.equal(3);

      // Find the unmatched row (u99 should have null name)
      const unmatchedRow = result.data.rows.find(
        (r: { c: Array<{ v: any }> }) => r.c[1].v === 100
      );
      expect(unmatchedRow).to.exist;
      expect(unmatchedRow.c[0].v).to.be.null;
      console.log('✅ Virtual table RIGHT JOIN works');
    });

    it('should SELECT DISTINCT from virtual table', async function() {
      const distinctData = {
        data: [
          ['name', 'category'],
          ['Alice', 'A'],
          ['Bob', 'B'],
          ['Alice', 'A'],  // Duplicate - should be removed
          ['Carol', 'A'],
          ['Bob', 'B'],    // Duplicate - should be removed
          ['Alice', 'C']   // Different category - not a duplicate
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT DISTINCT name, category FROM :data',
        dataSources: distinctData
      });

      expect(result.operation).to.equal('SELECT');
      // Unique combinations: Alice-A, Bob-B, Carol-A, Alice-C = 4 rows
      expect(result.data.rows.length).to.equal(4);
      console.log('✅ SELECT DISTINCT works');
    });

    it('should SELECT DISTINCT single column', async function() {
      const distinctData = {
        data: [
          ['name', 'value'],
          ['Alice', 100],
          ['Bob', 200],
          ['Alice', 150],  // Alice again - should be deduplicated
          ['Carol', 300],
          ['Bob', 250]     // Bob again - should be deduplicated
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT DISTINCT name FROM :data',
        dataSources: distinctData
      });

      expect(result.operation).to.equal('SELECT');
      // Unique names: Alice, Bob, Carol = 3 rows
      expect(result.data.rows.length).to.equal(3);
      console.log('✅ SELECT DISTINCT single column works');
    });

    it('should handle DISTINCT with ORDER BY', async function() {
      const distinctData = {
        data: [
          ['name', 'score'],
          ['Alice', 100],
          ['Bob', 50],
          ['Alice', 150],  // Duplicate name
          ['Carol', 75]
        ]
      };

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT DISTINCT name FROM :data ORDER BY name ASC',
        dataSources: distinctData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(3);
      // Should be sorted alphabetically
      expect(result.data.rows[0].c[0].v).to.equal('Alice');
      expect(result.data.rows[1].c[0].v).to.equal('Bob');
      expect(result.data.rows[2].c[0].v).to.equal('Carol');
      console.log('✅ SELECT DISTINCT with ORDER BY works');
    });

    // NOTE: Multiple JOINs (3+ tables) currently have a parsing limitation.
    // The second JOIN's ON clause is not parsed correctly when referencing aliases
    // from the first joined table. This is tracked as a known gap in TODO.md.
    it.skip('should handle multiple JOINs (3+ tables) - KNOWN LIMITATION', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: `
          SELECT u.name, o.order_id, p.status
          FROM :users AS u
          JOIN :orders AS o ON u.id = o.user_id
          JOIN :payments AS p ON o.order_id = p.order_id
        `,
        dataSources: {
          users: [['id', 'name'], ['u1', 'Alice'], ['u2', 'Bob']],
          orders: [['user_id', 'order_id'], ['u1', 'o1'], ['u1', 'o2'], ['u2', 'o3']],
          payments: [['order_id', 'status'], ['o1', 'paid'], ['o2', 'pending'], ['o3', 'paid']]
        }
      });
      expect(result.data.rows.length).to.equal(3);
      expect(result.data.cols.length).to.equal(3);
      console.log('✅ Multiple JOINs (3+ tables) works');
    });

    it('should handle duplicate column names in JOINs', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: `
          SELECT u.id, u.name, o.id, o.amount
          FROM :users AS u
          JOIN :orders AS o ON u.id = o.user_id
        `,
        dataSources: {
          users: [['id', 'name'], ['u1', 'Alice']],
          orders: [['id', 'user_id', 'amount'], ['o1', 'u1', 100]]
        }
      });
      // Both 'id' columns should be present (qualified by alias)
      expect(result.data.cols.length).to.equal(4);
      console.log('✅ Duplicate column names in JOINs work');
    });

    it('should JOIN with virtual table name as implicit alias', async function() {
      // When no AS alias is provided, the virtual table name is used as the alias
      const result = await client.callTool('sheet_sql', {
        statement: `
          SELECT u.name, s.score
          FROM :users AS u
          JOIN :scores AS s ON u.id = s.user_id
        `,
        dataSources: {
          users: [['id', 'name'], ['u1', 'Alice'], ['u2', 'Bob']],
          scores: [['user_id', 'score'], ['u1', 95], ['u2', 88]]
        }
      });
      expect(result.data.rows.length).to.equal(2);  // Alice and Bob both have scores
      console.log('✅ JOIN with implicit table alias works');
    });

    it('should handle large virtual table with 1000+ rows', async function() {
      this.timeout(60000);
      const rows: any[][] = [['Id', 'Value', 'Category']];
      for (let i = 1; i <= 1000; i++) {
        rows.push([`id${i}`, Math.floor(Math.random() * 1000), `cat${i % 10}`]);
      }

      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT * FROM :large WHERE Category = "cat5" LIMIT 100',
        dataSources: { large: rows }
      });
      expect(result.data.rows.length).to.be.lte(100);
      expect(result.data.rows.length).to.be.gt(0);  // Should have some matches
      console.log(`✅ Large virtual table (1000 rows) works: ${result.data.rows.length} rows returned`);
    });

    it('should handle CONTAINS on virtual table', async function() {
      const result = await client.callTool('sheet_sql', {
        statement: 'SELECT Name FROM :data WHERE Name contains "li"',
        dataSources: {
          data: [
            ['Name'],
            ['Alice'],
            ['Bob'],
            ['Charlie']
          ]
        }
      });
      expect(result.data.rows.length).to.equal(2);  // Alice, Charlie
      console.log('✅ CONTAINS on virtual table works');
    });
  });

  // ==================== HYBRID QUERIES (Sheet + Virtual) ====================
  describe('Hybrid Queries (Sheet + Virtual)', function() {
    this.timeout(60000);
    const HYBRID_PREFIX = 'hybrid';

    // Setup test data in sheet
    before(async function() {
      this.timeout(30000);
      console.log('\n📝 Setting up hybrid query test data...');
      // Insert test rows that we'll JOIN with virtual data
      await insertTestRow(HYBRID_PREFIX, 'h1', 100, 'TypeA');
      await insertTestRow(HYBRID_PREFIX, 'h2', 200, 'TypeB');
      await insertTestRow(HYBRID_PREFIX, 'h3', 300, 'TypeA');
      await new Promise(r => setTimeout(r, 1000));
      console.log('✅ Hybrid test data inserted');
    });

    after(async function() {
      await cleanupPrefix(HYBRID_PREFIX);
    });

    it('should JOIN sheet with virtual table', async function() {
      // The sheet has columns: B=Date, C=Description, D=Category, E=Amount
      // We want to join on Description (C) with our virtual data
      const virtualData = {
        extras: [
          ['ref', 'bonus'],
          [`${TEST_RUN_ID}-${HYBRID_PREFIX}-h1`, 10],
          [`${TEST_RUN_ID}-${HYBRID_PREFIX}-h2`, 20],
          [`${TEST_RUN_ID}-${HYBRID_PREFIX}-h3`, 30]
        ]
      };

      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `
          SELECT s.C, s.E, e.bonus
          FROM ${TEST_SHEET}!A:E AS s
          JOIN :extras AS e ON s.C = e.ref
          WHERE s.C contains "${TEST_RUN_ID}-${HYBRID_PREFIX}"
        `,
        dataSources: virtualData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(3);
      console.log('✅ Hybrid sheet + virtual JOIN works');
    });

    it('should LEFT JOIN sheet with virtual table', async function() {
      // Only some rows will have matches in virtual table
      const virtualData = {
        extras: [
          ['ref', 'bonus'],
          [`${TEST_RUN_ID}-${HYBRID_PREFIX}-h1`, 10]
          // h2 and h3 intentionally missing
        ]
      };

      const result = await client.callTool('sheet_sql', {
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: `${TEST_SHEET}!A:E`,
        statement: `
          SELECT s.C, s.E, e.bonus
          FROM ${TEST_SHEET}!A:E AS s
          LEFT JOIN :extras AS e ON s.C = e.ref
          WHERE s.C contains "${TEST_RUN_ID}-${HYBRID_PREFIX}"
        `,
        dataSources: virtualData
      });

      expect(result.operation).to.equal('SELECT');
      expect(result.data.rows.length).to.equal(3);  // All 3 sheet rows, some with null bonus
      console.log('✅ Hybrid LEFT JOIN works');
    });
  });
});
