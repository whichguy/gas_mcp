import { BaseTool } from '../base.js';
import { SessionAuthManager } from '../../auth/sessionManager.js';
import { ValidationError, FileOperationError } from '../../errors/mcpErrors.js';
import { SchemaFragments } from '../../utils/schemaFragments.js';
import { GASClient } from '../../api/gasClient.js';

/**
 * LLM Guidance hints for sheet_sql operations
 * Provides contextual hints to help LLM understand results and take appropriate action
 */
interface SheetSqlHints {
  context?: string;
  suggestions?: string[];
  warning?: string;
  nextSteps?: string[];
}

/**
 * Token types for WHERE clause lexer
 */
type TokenType =
  | 'COLUMN'      // Column letter (A, B, AA) or resolved identifier
  | 'STRING'      // 'value' or "value"
  | 'NUMBER'      // 123, -45.67
  | 'BOOLEAN'     // true, false
  | 'NULL'        // null
  | 'DATE'        // DATE "2025-01-15" or DATE '2025-01-15'
  | 'OPERATOR'    // =, <>, !=, <, <=, >, >=
  | 'STRING_OP'   // contains, starts with, ends with
  | 'AND'         // AND
  | 'OR'          // OR
  | 'IS'          // IS
  | 'NOT'         // NOT
  | 'LPAREN'      // (
  | 'RPAREN'      // )
  | 'EOF';        // End of input

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

/**
 * AST node types for WHERE clause parser
 */
type ASTNode =
  | { type: 'comparison'; column: string; operator: string; value: any }
  | { type: 'null_check'; column: string; isNull: boolean }
  | { type: 'and'; left: ASTNode; right: ASTNode }
  | { type: 'or'; left: ASTNode; right: ASTNode };

/**
 * Parsed UPDATE statement components
 */
interface ParsedUpdateStatement {
  setClause: string;
  whereClause: string;
  orderByClause?: string;
  limit?: number;
}

/**
 * Parsed DELETE statement components
 */
interface ParsedDeleteStatement {
  whereClause: string;
  orderByClause?: string;
  limit?: number;
}

/**
 * ORDER BY term
 */
interface OrderByTerm {
  column: string;
  direction: 'ASC' | 'DESC';
}

/**
 * Matched row info with row number and data
 */
interface MatchedRow {
  rowNumber: number;  // 1-based sheet row number
  rowData: any[];     // Row data array
}

/**
 * Table reference parsed from SQL statement
 */
interface TableReference {
  type: 'sheet' | 'virtual';
  name: string | null;     // Virtual table name from dataSources (without : prefix)
  source: string;          // Original text: "Sheet1!A:C" or ":users"
  alias?: string;          // Optional alias (s, u, etc.)
}

/**
 * JOIN clause parsed from SQL statement
 */
interface JoinClause {
  type: 'JOIN' | 'LEFT JOIN' | 'RIGHT JOIN';
  table: TableReference;
  on: string;              // ON condition: "s.A = :users.id"
}

/**
 * Loaded table data (headers + rows)
 */
interface TableData {
  headers: string[];
  rows: any[][];
}

/**
 * Range parsing result
 */
interface ParsedRange {
  sheetName: string;
  startCol: string;
  startRow: number;
  endCol?: string;
  endRow?: number;
}

/**
 * Generate contextual hints for SELECT operations
 */
function generateSelectHints(rowCount: number, statement: string): SheetSqlHints {
  const hints: SheetSqlHints = {};

  if (rowCount === 0) {
    hints.context = 'Query returned no results';
    hints.suggestions = [
      'Verify the WHERE clause matches existing data',
      'Use SELECT * LIMIT 5 to see sample data and column values',
      'Check column names match actual sheet headers (case-sensitive)',
      'If filtering by text, try using "contains" instead of exact match'
    ];
  } else if (rowCount > 1000) {
    hints.warning = `Large result set (${rowCount} rows) may impact performance`;
    hints.suggestions = [
      'Add LIMIT clause for pagination: LIMIT 100 OFFSET 0',
      'Use GROUP BY with aggregates for summaries',
      'Add WHERE clause to filter data'
    ];
  } else if (rowCount > 100 && !statement.toUpperCase().includes('LIMIT')) {
    hints.suggestions = [
      `Consider adding LIMIT clause (returned ${rowCount} rows)`,
      'For large datasets, use OFFSET for pagination'
    ];
  }

  // Check for common query optimization opportunities
  if (statement.toUpperCase().includes('SELECT *') && rowCount > 50) {
    hints.suggestions = hints.suggestions || [];
    hints.suggestions.push('SELECT only needed columns instead of * for better performance');
  }

  return hints;
}

/**
 * Generate contextual hints for INSERT operations
 */
function generateInsertHints(updatedRange: string, updatedRows: number): SheetSqlHints {
  return {
    context: `Inserted ${updatedRows} row(s) at ${updatedRange}`,
    nextSteps: [
      `Verify with: SELECT * WHERE <column> = '<inserted_value>' LIMIT 1`,
      'Note: Inserted data appears at end of used range'
    ]
  };
}

/**
 * Generate hints for mutation operations
 */
function generateMutationHints(operation: 'UPDATE' | 'DELETE', affectedRows: number, hasLimit: boolean, hasOrderBy: boolean): SheetSqlHints {
  const hints: SheetSqlHints = {};

  if (affectedRows === 0) {
    hints.context = `No rows matched the WHERE clause`;
    hints.suggestions = [
      'Verify the WHERE clause matches existing data',
      'Use SELECT * WHERE <same_condition> LIMIT 5 to test the condition'
    ];
  } else if (affectedRows > 100) {
    hints.warning = `Large ${operation.toLowerCase()} operation: ${affectedRows} rows affected`;
    hints.suggestions = ['Consider adding LIMIT to process in batches'];
  }

  if (hasLimit && !hasOrderBy) {
    hints.warning = (hints.warning ? hints.warning + '. ' : '') +
      'LIMIT without ORDER BY uses natural row order (first rows first)';
    hints.suggestions = hints.suggestions || [];
    hints.suggestions.push('Add ORDER BY for predictable results');
  }

  return hints;
}

/**
 * Execute SQL-style operations on Google Sheets using Google's REST APIs
 *
 * Provides unified SQL interface for SELECT, INSERT, UPDATE, DELETE operations on Google Sheets.
 * Leverages Google Visualization Query API for SELECT and Google Sheets API v4 for mutations.
 *
 * ## Architecture:
 * - SELECT: Direct passthrough to Google Visualization Query API (server-side execution)
 * - INSERT: Parse VALUES clause + Sheets API append
 * - UPDATE: SELECT ROW() + compute + batch update (retrieve-filter-update pattern)
 * - DELETE: SELECT ROW() + reverse sort + batch delete
 *
 * ## Range Handling:
 * - Required range parameter in A1 notation
 * - Must include sheet name: "Transactions!A:Z", "Sheet1!A1:Z1000"
 * - Google auto-trims to used data when open ranges used (e.g., "A:Z")
 *
 * ## KNOWN BUG: UPDATE and DELETE operations are broken
 * The findMatchingRows() method uses `SELECT ROW() WHERE ...` but ROW() is NOT
 * a valid Google Visualization Query API function. This causes a parse error:
 * "PARSE_ERROR: Encountered \" \"(\" \"( \"\" at line 1, column 11"
 *
 * FIX REQUIRED: Replace ROW() with alternative approach:
 * 1. Download all rows with `SELECT * WHERE {whereClause}`
 * 2. Track row indices locally during iteration
 * 3. Use those indices for update/delete operations
 *
 * Reference: https://developers.google.com/chart/interactive/docs/querylanguage
 * (ROW() is not listed in the supported functions)
 */
export class SheetSqlTool extends BaseTool {
  public name = 'sheet_sql';
  public description = '[SHEETS:SQL] Query Google Sheets data using SQL-like syntax — SELECT, WHERE, ORDER BY, JOIN across sheets. WHEN: reading or analyzing spreadsheet data with filtering and sorting. Example: sheet_sql({spreadsheetId: "...", query: "SELECT A, B WHERE C > 100"})';

  public inputSchema = {
    type: 'object',
    properties: {
      spreadsheetId: {
        type: 'string',
        description: 'Google Sheets spreadsheet ID or full URL',
        examples: [
          '1abc2def3ghi4jkl5mno6pqr7stu8vwx',
          'https://docs.google.com/spreadsheets/d/1abc2def3ghi4jkl5mno6pqr7stu8vwx'
        ]
      },
      scriptId: {
        type: 'string',
        pattern: '^[a-zA-Z0-9_-]{30,60}$',
        description: 'Google Apps Script project ID. If provided, resolves to container-bound spreadsheet. Use this OR spreadsheetId.',
        examples: ['1Y72rigcMUAwRd7bwl3CR57O6ENo5sKTn0xAl2C4HoZys75N5utGfkCUG']
      },
      range: {
        type: 'string',
        description: 'Sheet and cell range in A1 notation (required). Must include sheet name for multi-sheet workbooks. Examples: "Transactions!A:Z", "Sheet1!A1:Z1000", "Sales!A:F"',
        pattern: '^([A-Za-z0-9_\\s]+!)?[A-Z]+[0-9]*(:[A-Z]+[0-9]*)?$',
        examples: [
          'Transactions!A:Z',
          'Sheet1!A1:Z1000',
          'Sales!A:F',
          'Customers!A1:D100'
        ]
      },
      statement: {
        type: 'string',
        description: 'SQL statement using column letters (A, B, C) instead of column names. Supported operations: SELECT (with WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, OFFSET, aggregates), INSERT VALUES, UPDATE SET WHERE, DELETE WHERE',
        examples: [
          'SELECT A, B, COUNT(C) WHERE D > 1000 GROUP BY A, B ORDER BY COUNT(C) DESC',
          'SELECT * WHERE B contains "Premium" LIMIT 100',
          'INSERT VALUES ("John", "Doe", 30, "Premium")',
          'UPDATE SET C = "Premium", D = 100 WHERE E > 50',
          'DELETE WHERE A < DATE "2020-01-01"'
        ]
      },
      returnMetadata: {
        type: 'boolean',
        default: false,
        description: 'For SELECT queries: return cell metadata (formulas, formatting) in addition to values'
      },
      dataSources: {
        type: 'object',
        additionalProperties: {
          type: 'array',
          items: { type: 'array' },
          description: '2D array where first row = headers'
        },
        description: 'Named virtual tables referenced as :name in SQL. Each is a 2D array [[headers], [row1], ...]. Example: { users: [["id","name"], ["u1","Alice"], ["u2","Bob"]] }'
      }
    },
    required: ['statement'],  // range and spreadsheetId/scriptId validated at runtime based on query type
    additionalProperties: false,
    llmGuidance: {
      operationSupport: {
        SELECT: 'Fully supported - uses Google Visualization Query API for sheets, local execution for virtual tables',
        INSERT: 'Fully supported for sheets - uses Google Sheets API v4 append. Supports INSERT INTO (columns) VALUES (...) with header names',
        UPDATE: 'Fully supported - local WHERE parsing with ORDER BY + LIMIT support. For virtual tables, returns modified data.',
        DELETE: 'Fully supported - local WHERE parsing with ORDER BY + LIMIT support. For virtual tables, returns filtered data.'
      },
      virtualTables: {
        description: 'Reference in-memory data using :name syntax. Perfect for JOINing sheet data with external data.',
        syntax: 'SELECT * FROM :tableName WHERE condition',
        joinSyntax: 'SELECT s.*, v.col FROM Sheet1!A:C AS s JOIN :virtualTable AS v ON s.A = v.id',
        dataFormat: '2D array where first row = headers: [[\"id\",\"name\"], [\"u1\",\"Alice\"], [\"u2\",\"Bob\"]]',
        supportedOps: ['SELECT', 'UPDATE (returns modified data)', 'DELETE (returns filtered data)'],
        limitations: ['No INSERT to virtual tables', 'No persistence - returns modified data for caller to handle']
      },
      responseHints: {
        description: 'Responses include contextual "hints" object with suggestions',
        emptyResults: 'hints.suggestions will provide debugging steps for empty result sets',
        largeResults: 'hints.warning when >1000 rows, suggests pagination',
        insert: 'hints.nextSteps will suggest verification query after INSERT'
      },
      queryLanguageFeatures: {
        supported: ['SELECT', 'WHERE', 'GROUP BY', 'PIVOT', 'ORDER BY', 'LIMIT', 'OFFSET', 'LABEL', 'FORMAT'],
        aggregates: ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'],
        operators: ['=', '<', '>', '<=', '>=', '<>', 'contains', 'starts with', 'ends with', 'matches', 'like'],
        functions: ['lower', 'upper', 'year', 'month', 'day', 'hour', 'minute', 'second', 'now', 'dateDiff'],
        notSupported: ['ROW()', 'JOIN', 'UNION', 'Subqueries']
      },
      bestPractices: [
        'Always include sheet name in range for multi-sheet workbooks',
        'Use LIMIT for large datasets to avoid timeout',
        'For filtering text, use "contains" for partial match, "=" for exact',
        'After INSERT, verify with SELECT WHERE <column> = <inserted_value>'
      ]
    }
  };

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
  }

  /**
   * Execute SQL statement on Google Sheet or virtual tables
   */
  async execute(params: any): Promise<any> {
    const statement = this.validate.string(params.statement, 'statement', 'sheet SQL operation');
    const { operation, sql } = this.parseStatement(statement);
    const returnMetadata = this.validate.boolean(params.returnMetadata || false, 'returnMetadata', 'sheet SQL operation');
    const dataSources = params.dataSources;

    // Parse table references to detect virtual tables
    const tableRefs = this.parseTableReferences(statement);
    const hasVirtualTables = tableRefs.some(t => t.type === 'virtual');
    const hasSheetTables = tableRefs.some(t => t.type === 'sheet');

    // Pure virtual query (no sheet references, no spreadsheetId needed)
    if (hasVirtualTables && !hasSheetTables && !params.spreadsheetId && !params.scriptId) {
      if (!dataSources) {
        throw new ValidationError('dataSources', 'undefined',
          'dataSources parameter when using virtual tables (:name syntax)');
      }
      return this.executeVirtualOnly(params, tableRefs, operation);
    }

    // Hybrid query or pure sheet query - need spreadsheet access
    // 1. Get auth token FIRST (needed for scriptId resolution)
    const accessToken = await this.getAuthToken(params);

    // 2. Resolve spreadsheetId from scriptId OR use directly
    let spreadsheetId: string;
    if (params.scriptId) {
      if (params.spreadsheetId) {
        console.error('[sheet_sql] Both scriptId and spreadsheetId provided, using scriptId');
      }
      spreadsheetId = await this.resolveScriptIdToSpreadsheet(params.scriptId, accessToken);
    } else if (params.spreadsheetId) {
      spreadsheetId = this.extractSpreadsheetId(params.spreadsheetId);
    } else {
      throw new ValidationError('spreadsheetId or scriptId', 'undefined',
        'either spreadsheetId or scriptId parameter');
    }

    // 3. Validate and normalize range with smart defaults
    const rawRange = this.validate.string(params.range, 'range', 'sheet SQL operation');
    const range = this.normalizeRange(rawRange);
    this.validateRange(range);

    // Hybrid query (sheet + virtual tables via JOIN)
    if (hasVirtualTables && dataSources) {
      return this.executeHybridQuery(params, tableRefs, operation, spreadsheetId, range, accessToken);
    }

    // 4. Pure sheet query - route to appropriate handler
    switch (operation) {
      case 'SELECT':
        return await this.executeSelect(spreadsheetId, range, sql, returnMetadata, accessToken);
      case 'INSERT':
        return await this.executeInsert(spreadsheetId, range, sql, accessToken);
      case 'UPDATE':
        return await this.executeUpdate(spreadsheetId, range, sql, accessToken);
      case 'DELETE':
        return await this.executeDelete(spreadsheetId, range, sql, accessToken);
      default:
        throw new ValidationError('statement', statement, 'valid SQL operation (SELECT/INSERT/UPDATE/DELETE)');
    }
  }

  /**
   * Extract spreadsheet ID from URL or return as-is if already an ID
   */
  private extractSpreadsheetId(input: string): string {
    // Match Google Sheets URL pattern
    const urlMatch = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) {
      return urlMatch[1];
    }

    // Validate as spreadsheet ID
    if (!/^[a-zA-Z0-9_-]{20,60}$/.test(input)) {
      throw new ValidationError('spreadsheetId', input, 'valid Google Sheets ID or URL');
    }

    return input;
  }

  /**
   * Resolve GAS scriptId to its container-bound spreadsheet ID
   */
  private async resolveScriptIdToSpreadsheet(scriptId: string, accessToken: string): Promise<string> {
    const gasClient = new GASClient();
    try {
      const project = await gasClient.getProject(scriptId, accessToken);
      if (!project.parentId) {
        throw new ValidationError('scriptId', scriptId,
          'container-bound script. This script is standalone and not bound to any spreadsheet.');
      }
      return project.parentId;
    } catch (error: any) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError('scriptId', scriptId,
        `resolvable script. ${error.message || 'Script not found or access denied.'}`);
    }
  }

  /**
   * Normalize range with smart defaults:
   * - "Sheet1!" → "Sheet1!A1"
   * - "Sheet1!B" → "Sheet1!B1"
   * - "B" → "B1"
   * - "" or undefined → "A1"
   */
  private normalizeRange(range?: string): string {
    if (!range || range.trim() === '') {
      return 'A1';  // Default: column A, row 1
    }

    let normalized = range.trim();

    // Handle "Sheet1!" with no column → add A1
    if (normalized.endsWith('!')) {
      return normalized + 'A1';
    }

    // Handle sheet!col or just col without row number
    const match = normalized.match(/^(([A-Za-z0-9_\s]+)!)?([A-Z]+)$/i);
    if (match) {
      const sheetPart = match[1] || '';
      const colPart = match[3].toUpperCase();
      return sheetPart + colPart + '1';  // Add row 1
    }

    return normalized;  // Already complete
  }

  /**
   * Validate A1 notation range format
   */
  private validateRange(range: string): void {
    // Valid patterns: "Sheet1!A1:Z1000", "A:F", "A1:D100"
    const rangePattern = /^([A-Za-z0-9_\s]+!)?[A-Z]+[0-9]*(:[A-Z]+[0-9]*)?$/;
    if (!rangePattern.test(range)) {
      throw new ValidationError('range', range, 'valid A1 notation (e.g., "Sheet1!A1:Z1000" or "A:F")');
    }
  }

  /**
   * Parse SQL statement to determine operation type
   */
  private parseStatement(statement: string): { operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'; sql: string } {
    const upperStmt = statement.trim().toUpperCase();

    if (upperStmt.startsWith('SELECT')) {
      return { operation: 'SELECT', sql: statement.trim() };
    }
    if (upperStmt.startsWith('INSERT')) {
      return { operation: 'INSERT', sql: statement.trim() };
    }
    if (upperStmt.startsWith('UPDATE')) {
      return { operation: 'UPDATE', sql: statement.trim() };
    }
    if (upperStmt.startsWith('DELETE')) {
      return { operation: 'DELETE', sql: statement.trim() };
    }

    throw new ValidationError('statement', statement, 'valid SQL operation (SELECT/INSERT/UPDATE/DELETE)');
  }

  /**
   * Execute SELECT query using Google Visualization Query API
   */
  private async executeSelect(
    spreadsheetId: string,
    range: string,
    statement: string,
    returnMetadata: boolean,
    accessToken: string
  ): Promise<any> {
    // Build Google Visualization Query URL
    const baseUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`;
    const params = new URLSearchParams({
      range: range,
      tq: statement,
      tqx: 'out:json'
    });

    const response = await fetch(`${baseUrl}?${params}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip'  // Performance: 60-70% smaller payloads
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SELECT query failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const text = await response.text();

    // Parse Google's JSONP response: google.visualization.Query.setResponse({...})
    const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\((.*)\);?$/);
    if (!jsonMatch) {
      throw new Error('Invalid response format from Google Visualization API');
    }

    const json = JSON.parse(jsonMatch[1]);

    if (json.status === 'error') {
      throw new Error(`Query error: ${json.errors?.map((e: any) => e.detailed_message || e.message).join(', ')}`);
    }

    // Generate contextual hints for LLM
    const rowCount = json.table?.rows?.length || 0;
    const hints = generateSelectHints(rowCount, statement);

    // Fetch metadata if requested
    if (returnMetadata) {
      const metadataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?ranges=${encodeURIComponent(range)}&includeGridData=true&fields=sheets(data(rowData(values(formattedValue,userEnteredValue,effectiveFormat))))`;

      const metaResponse = await fetch(metadataUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (metaResponse.ok) {
        const metadata = await metaResponse.json();
        return {
          operation: 'SELECT',
          data: json.table,
          metadata: metadata.sheets?.[0]?.data?.[0]?.rowData || [],
          ...(Object.keys(hints).length > 0 ? { hints } : {})
        };
      }
    }

    return {
      operation: 'SELECT',
      data: json.table,
      ...(Object.keys(hints).length > 0 ? { hints } : {})
    };
  }

  /**
   * Execute INSERT statement using Sheets API append
   * Supports:
   *   - INSERT VALUES ('x', 'y', 'z')
   *   - INSERT INTO (A, C, E) VALUES ('x', 'y', 'z')
   *   - INSERT INTO (Name, Amount) VALUES ('x', 100)  -- with column aliasing
   */
  private async executeInsert(
    spreadsheetId: string,
    range: string,
    statement: string,
    accessToken: string
  ): Promise<any> {
    // Try INSERT INTO (columns) VALUES (...) first
    const intoMatch = statement.match(/INTO\s*\(([^)]+)\)\s*VALUES\s*\((.*)\)/i);

    if (intoMatch) {
      // INSERT INTO with column specification
      const columnSpecs = intoMatch[1].split(',').map(c => c.trim());
      const values = this.parseValues(intoMatch[2]);

      // Validate count
      if (columnSpecs.length !== values.length) {
        throw new ValidationError('INSERT INTO', statement,
          `column/value count mismatch: ${columnSpecs.length} columns, ${values.length} values`);
      }

      // Fetch header row for aliasing (only 1 row)
      const headers = await this.getHeaderRow(spreadsheetId, range, accessToken);
      const columnMap = this.buildColumnMap(headers);

      // Resolve column names to letters
      const columns: string[] = [];
      for (const spec of columnSpecs) {
        // Remove quotes if present
        let colName = spec.replace(/^["'`]|["'`]$/g, '').trim();
        const resolved = columnMap.get(colName.toLowerCase());

        if (resolved) {
          columns.push(resolved);
        } else if (/^[A-Z]+$/i.test(colName)) {
          // Already a valid column letter
          columns.push(colName.toUpperCase());
        } else {
          throw new ValidationError('INSERT INTO', colName,
            `valid column name or letter. Available headers: ${headers.filter(h => h).join(', ')}`);
        }
      }

      // Build sparse row
      const maxColIndex = Math.max(...columns.map(c => this.columnToIndex(c)));
      const row = new Array(maxColIndex + 1).fill('');
      columns.forEach((col, i) => {
        row[this.columnToIndex(col)] = values[i] === null ? '' : values[i];
      });

      // Append via Sheets API
      return this.appendRow(spreadsheetId, range, row, accessToken);
    }

    // Fall back to INSERT VALUES (...) - original behavior
    const valuesMatch = statement.match(/VALUES\s*\((.*)\)/i);
    if (!valuesMatch) {
      throw new ValidationError('statement', statement, 'INSERT VALUES (...) or INSERT INTO (columns) VALUES (...) syntax');
    }

    // Parse comma-separated values with proper quote handling
    const values = this.parseValues(valuesMatch[1]);

    return this.appendRow(spreadsheetId, range, values, accessToken);
  }

  /**
   * Append a row to the sheet
   */
  private async appendRow(
    spreadsheetId: string,
    range: string,
    values: any[],
    accessToken: string
  ): Promise<any> {
    // Google Sheets API append
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip'
      },
      body: JSON.stringify({
        values: [values]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`INSERT failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const result = await response.json();

    // Generate hints for INSERT operation
    const hints = generateInsertHints(
      result.updates.updatedRange,
      result.updates.updatedRows
    );

    return {
      operation: 'INSERT',
      updatedRange: result.updates.updatedRange,
      updatedRows: result.updates.updatedRows,
      updatedColumns: result.updates.updatedColumns,
      updatedCells: result.updates.updatedCells,
      hints
    };
  }

  /**
   * Execute UPDATE SET WHERE statement
   * Now uses local WHERE parsing instead of broken ROW() function
   */
  private async executeUpdate(
    spreadsheetId: string,
    range: string,
    statement: string,
    accessToken: string
  ): Promise<any> {
    // Parse UPDATE statement with all clauses
    const parsed = this.parseUpdateStatement(statement);

    // Get headers for column aliasing
    const headers = await this.getHeaderRow(spreadsheetId, range, accessToken);
    const columnMap = this.buildColumnMap(headers);

    // Parse ORDER BY if present
    let orderBy: OrderByTerm[] | undefined;
    if (parsed.orderByClause) {
      orderBy = this.parseOrderByClause(parsed.orderByClause, columnMap);
    }

    // Find matching rows using local filtering
    const matchingRows = await this.findMatchingRowsLocal(
      spreadsheetId,
      range,
      parsed.whereClause,
      accessToken,
      orderBy,
      parsed.limit
    );

    // Generate hints
    const hints = generateMutationHints(
      'UPDATE',
      matchingRows.length,
      parsed.limit !== undefined,
      parsed.orderByClause !== undefined
    );

    if (matchingRows.length === 0) {
      return {
        operation: 'UPDATE',
        updatedRows: 0,
        message: 'No rows matched WHERE clause',
        ...(Object.keys(hints).length > 0 ? { hints } : {})
      };
    }

    // Resolve column names in SET clause
    const resolvedSetClause = this.resolveColumnNames(parsed.setClause, columnMap);

    // Parse SET clause with resolved columns
    const updates = this.parseSetClause(resolvedSetClause);

    // Build batch update requests
    const batchData: any[] = [];
    const sheetName = this.extractSheetName(range);
    const sheetPrefix = sheetName ? `${sheetName}!` : '';

    for (const rowInfo of matchingRows) {
      for (const [column, value] of Object.entries(updates)) {
        const cellRange = `${sheetPrefix}${column}${rowInfo.rowNumber}`;
        batchData.push({
          range: cellRange,
          values: [[value === null ? '' : value]]
        });
      }
    }

    // Chunk large batch updates
    const CELLS_PER_BATCH = 50000;
    let totalUpdatedCells = 0;

    const chunks: any[][] = [];
    for (let i = 0; i < batchData.length; i += CELLS_PER_BATCH) {
      chunks.push(batchData.slice(i, i + CELLS_PER_BATCH));
    }

    for (const chunk of chunks) {
      const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;

      const response = await fetch(batchUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip'
        },
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: chunk
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`UPDATE batch operation failed: ${response.status} ${response.statusText}\n${errorText}`);
      }

      const result = await response.json();
      totalUpdatedCells += result.totalUpdatedCells || 0;
    }

    return {
      operation: 'UPDATE',
      updatedRows: matchingRows.length,
      updatedCells: totalUpdatedCells,
      ...(Object.keys(hints).length > 0 ? { hints } : {})
    };
  }

  /**
   * Execute DELETE WHERE statement
   * Now uses local WHERE parsing instead of broken ROW() function
   */
  private async executeDelete(
    spreadsheetId: string,
    range: string,
    statement: string,
    accessToken: string
  ): Promise<any> {
    // Parse DELETE statement with all clauses
    const parsed = this.parseDeleteStatement(statement);

    // Get headers for column aliasing
    const headers = await this.getHeaderRow(spreadsheetId, range, accessToken);
    const columnMap = this.buildColumnMap(headers);

    // Parse ORDER BY if present
    let orderBy: OrderByTerm[] | undefined;
    if (parsed.orderByClause) {
      orderBy = this.parseOrderByClause(parsed.orderByClause, columnMap);
    }

    // Find matching rows using local filtering
    const matchingRows = await this.findMatchingRowsLocal(
      spreadsheetId,
      range,
      parsed.whereClause,
      accessToken,
      orderBy,
      parsed.limit
    );

    // Generate hints
    const hints = generateMutationHints(
      'DELETE',
      matchingRows.length,
      parsed.limit !== undefined,
      parsed.orderByClause !== undefined
    );

    if (matchingRows.length === 0) {
      return {
        operation: 'DELETE',
        deletedRows: 0,
        message: 'No rows matched WHERE clause',
        ...(Object.keys(hints).length > 0 ? { hints } : {})
      };
    }

    // Get sheet ID for batch delete operations
    const sheetId = await this.getSheetId(spreadsheetId, range, accessToken);

    // Sort rows in reverse order (delete from bottom to top to preserve indices)
    const sortedRows = [...matchingRows].sort((a, b) => b.rowNumber - a.rowNumber);

    // Build batch delete requests
    const requests = sortedRows.map(rowInfo => ({
      deleteDimension: {
        range: {
          sheetId: sheetId,
          dimension: 'ROWS',
          startIndex: rowInfo.rowNumber - 1,  // 0-indexed
          endIndex: rowInfo.rowNumber         // Exclusive
        }
      }
    }));

    // Execute batch delete (atomic operation)
    const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;

    const response = await fetch(batchUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip'
      },
      body: JSON.stringify({ requests })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DELETE batch operation failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    return {
      operation: 'DELETE',
      deletedRows: matchingRows.length,
      rowNumbers: sortedRows.map(r => r.rowNumber),
      ...(Object.keys(hints).length > 0 ? { hints } : {})
    };
  }


  /**
   * Get sheet ID (numeric) from spreadsheet and range
   */
  private async getSheetId(spreadsheetId: string, range: string, accessToken: string): Promise<number> {
    const sheetName = this.extractSheetName(range);

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(title,sheetId))`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get sheet ID: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    const sheet = data.sheets?.find((s: any) => s.properties.title === sheetName);
    if (!sheet) {
      // If no sheet name specified, use first sheet
      if (!sheetName && data.sheets && data.sheets.length > 0) {
        return data.sheets[0].properties.sheetId;
      }
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    return sheet.properties.sheetId;
  }

  /**
   * Extract sheet name from A1 range notation
   * Examples: "Sheet1!A1:Z" → "Sheet1", "A1:Z" → "" (first sheet)
   */
  private extractSheetName(range: string): string {
    if (!range) {
      return '';
    }
    const parts = range.split('!');
    return parts.length > 1 ? parts[0] : '';
  }

  /**
   * Parse comma-separated values with proper quote handling
   * Example: '"John", "Doe", 30, "Premium"' → ["John", "Doe", 30, "Premium"]
   */
  private parseValues(valuesStr: string): any[] {
    const values: any[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < valuesStr.length; i++) {
      const char = valuesStr[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
        continue;
      }

      if (char === quoteChar && inQuotes) {
        // Check for escaped quote
        if (valuesStr[i + 1] === quoteChar) {
          current += char;
          i++; // Skip next quote
          continue;
        }
        inQuotes = false;
        continue;
      }

      if (char === ',' && !inQuotes) {
        values.push(this.parseValue(current.trim()));
        current = '';
        continue;
      }

      current += char;
    }

    // Add last value
    if (current.trim()) {
      values.push(this.parseValue(current.trim()));
    }

    return values;
  }

  /**
   * Parse single value (number, boolean, date, or string)
   */
  private parseValue(value: string): any {
    // Number
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      return parseFloat(value);
    }

    // Boolean
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    // Null
    if (value.toLowerCase() === 'null') return null;

    // Date (ISO format)
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value;  // Let Google Sheets parse as date
    }

    // String (already unquoted) - unescape backslash sequences (\n, \t, \", etc.)
    return this.unescapeString(value);
  }

  /**
   * Parse SET clause into column-value map
   * Example: "C = 'Premium', D = 100" → {C: "Premium", D: 100}
   */
  private parseSetClause(setClause: string): Record<string, any> {
    const updates: Record<string, any> = {};

    // Split by commas (not inside quotes, accounting for escaped quotes)
    const assignments: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < setClause.length; i++) {
      const char = setClause[i];
      const prevChar = i > 0 ? setClause[i - 1] : '';

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
        current += char;
        continue;
      }

      // Check for unescaped closing quote (not preceded by backslash)
      if (char === quoteChar && inQuotes && prevChar !== '\\') {
        inQuotes = false;
        current += char;
        continue;
      }

      if (char === ',' && !inQuotes) {
        assignments.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim()) {
      assignments.push(current.trim());
    }

    // Parse each assignment: "C = 'Premium'"
    for (const assignment of assignments) {
      const match = assignment.match(/^([A-Z]+)\s*=\s*(.+)$/);
      if (!match) {
        throw new ValidationError('SET clause', assignment, 'column = value format');
      }

      const column = match[1];
      const valueStr = match[2].trim();

      // Remove quotes if present and unescape internal characters
      let value: any = valueStr;
      if ((valueStr.startsWith('"') && valueStr.endsWith('"')) ||
          (valueStr.startsWith("'") && valueStr.endsWith("'"))) {
        value = this.unescapeString(valueStr.slice(1, -1));
      } else {
        value = this.parseValue(valueStr);
      }

      updates[column] = value;
    }

    return updates;
  }

  /**
   * Unescape string literals from SQL
   * Handles: \" → ", \' → ', \\ → \, \n → newline, \t → tab, \r → carriage return
   */
  private unescapeString(str: string): string {
    let result = '';
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '\\' && i + 1 < str.length) {
        const next = str[i + 1];
        switch (next) {
          case '"':
          case "'":
          case '\\':
            result += next;
            i++;
            break;
          case 'n':
            result += '\n';
            i++;
            break;
          case 't':
            result += '\t';
            i++;
            break;
          case 'r':
            result += '\r';
            i++;
            break;
          default:
            // Unknown escape, keep as-is
            result += str[i];
        }
      } else {
        result += str[i];
      }
    }
    return result;
  }

  // ==================== COLUMN UTILITIES ====================

  /**
   * Convert column letter to 0-based index
   * A=0, B=1, ..., Z=25, AA=26, AB=27, ...
   */
  private columnToIndex(col: string): number {
    let index = 0;
    const upper = col.toUpperCase();
    for (let i = 0; i < upper.length; i++) {
      index = index * 26 + (upper.charCodeAt(i) - 64);
    }
    return index - 1;
  }

  /**
   * Convert 0-based index to column letter
   * 0=A, 1=B, ..., 25=Z, 26=AA, 27=AB, ...
   */
  private indexToColumn(index: number): string {
    let result = '';
    let i = index + 1;  // Convert to 1-based
    while (i > 0) {
      i--;
      result = String.fromCharCode(65 + (i % 26)) + result;
      i = Math.floor(i / 26);
    }
    return result;
  }

  // ==================== RANGE PARSING ====================

  /**
   * Parse A1 notation range into components
   * Examples:
   *   "Sheet1!A1:Z100" → {sheetName: 'Sheet1', startCol: 'A', startRow: 1, endCol: 'Z', endRow: 100}
   *   "A:Z" → {sheetName: '', startCol: 'A', startRow: 1, endCol: 'Z'}
   */
  private parseRange(range: string): ParsedRange {
    let sheetName = '';
    let cellPart = range;

    // Extract sheet name if present
    const sheetMatch = range.match(/^([^!]+)!/);
    if (sheetMatch) {
      sheetName = sheetMatch[1];
      cellPart = range.slice(sheetMatch[0].length);
    }

    // Parse cell range: "A1:Z100" or "A:Z" or "A1"
    const rangeMatch = cellPart.match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/i);
    if (!rangeMatch) {
      return { sheetName, startCol: 'A', startRow: 1 };
    }

    return {
      sheetName,
      startCol: rangeMatch[1].toUpperCase(),
      startRow: rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 1,
      endCol: rangeMatch[3]?.toUpperCase(),
      endRow: rangeMatch[4] ? parseInt(rangeMatch[4], 10) : undefined
    };
  }

  /**
   * Get header range (first row only) from full range
   */
  private getHeaderRange(range: string): string {
    const parsed = this.parseRange(range);
    const prefix = parsed.sheetName ? `${parsed.sheetName}!` : '';

    if (parsed.endCol) {
      return `${prefix}${parsed.startCol}${parsed.startRow}:${parsed.endCol}${parsed.startRow}`;
    }
    // Open range like "A:Z" - get row 1
    return `${prefix}${parsed.startCol}1:${parsed.endCol || 'ZZ'}1`;
  }

  // ==================== HEADER/ALIASING ====================

  /**
   * Fetch header row from sheet
   */
  private async getHeaderRow(spreadsheetId: string, range: string, accessToken: string): Promise<string[]> {
    const headerRange = this.getHeaderRange(range);

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(headerRange)}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch headers: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return data.values?.[0] || [];
  }

  /**
   * Build bidirectional column map: header names → column letters, column letters → column letters
   * Case-insensitive for header names
   */
  private buildColumnMap(headers: string[]): Map<string, string> {
    const map = new Map<string, string>();

    // First, map all column letters to themselves (takes priority)
    headers.forEach((_, i) => {
      const letter = this.indexToColumn(i);
      map.set(letter.toLowerCase(), letter);
      map.set(letter, letter);  // Also uppercase
    });

    // Then map header names (won't overwrite column letters)
    headers.forEach((name, i) => {
      if (name && typeof name === 'string') {
        const letter = this.indexToColumn(i);
        const lower = name.toLowerCase().trim();
        if (!map.has(lower)) {
          map.set(lower, letter);
        }
      }
    });

    return map;
  }

  /**
   * Resolve column names in a clause to column letters
   * Handles quoted identifiers: "Column Name" or `Column Name`
   */
  private resolveColumnNames(clause: string, columnMap: Map<string, string>): string {
    // Reserved words that should NOT be resolved as column names
    const reserved = new Set([
      'and', 'or', 'where', 'is', 'not', 'null', 'true', 'false',
      'order', 'by', 'limit', 'asc', 'desc', 'set', 'contains',
      'starts', 'with', 'ends', 'like', 'in', 'between'
    ]);

    // Step 1: Extract and resolve quoted identifiers
    const quotedPlaceholders: Map<string, string> = new Map();
    let placeholderCount = 0;
    let processed = clause;

    // Match quoted identifiers followed by operators or string ops
    const quotedPattern = /["'`]([^"'`]+)["'`](?=\s*(?:[=<>!]|contains|starts|ends|is))/gi;
    processed = processed.replace(quotedPattern, (match, name) => {
      const placeholder = `__QUOTED_${placeholderCount++}__`;
      const resolved = columnMap.get(name.toLowerCase().trim());
      if (resolved) {
        quotedPlaceholders.set(placeholder, resolved);
      } else {
        // Keep original if not found - will error later
        quotedPlaceholders.set(placeholder, name);
      }
      return placeholder;
    });

    // Step 2: Resolve unquoted identifiers
    // Match word characters followed by operators (with optional whitespace)
    const identPattern = /\b([A-Za-z_][A-Za-z0-9_]*)\b(?=\s*(?:[=<>!]|contains|starts|ends|is\s))/gi;
    processed = processed.replace(identPattern, (match) => {
      const lower = match.toLowerCase();
      if (reserved.has(lower)) {
        return match;  // Don't resolve reserved words
      }
      return columnMap.get(lower) || match;
    });

    // Step 3: Restore quoted placeholders with resolved values
    for (const [placeholder, resolved] of quotedPlaceholders) {
      processed = processed.replace(placeholder, resolved);
    }

    return processed;
  }

  // ==================== WHERE CLAUSE TOKENIZER ====================

  /**
   * Tokenize WHERE clause into tokens
   */
  private tokenizeWhere(clause: string): Token[] {
    const tokens: Token[] = [];
    let pos = 0;

    const skipWhitespace = () => {
      while (pos < clause.length && /\s/.test(clause[pos])) pos++;
    };

    const readString = (quote: string): string => {
      let value = '';
      pos++;  // Skip opening quote
      while (pos < clause.length) {
        const char = clause[pos];

        // Check for backslash escapes (\", \', \\, \n, \t, \r)
        if (char === '\\' && pos + 1 < clause.length) {
          const next = clause[pos + 1];
          switch (next) {
            case '"':
            case "'":
            case '\\':
              value += next;
              pos += 2;
              continue;
            case 'n':
              value += '\n';
              pos += 2;
              continue;
            case 't':
              value += '\t';
              pos += 2;
              continue;
            case 'r':
              value += '\r';
              pos += 2;
              continue;
          }
        }

        if (char === quote) {
          if (clause[pos + 1] === quote) {
            // Escaped quote (SQL-style doubled quote)
            value += quote;
            pos += 2;
          } else {
            pos++;  // Skip closing quote
            break;
          }
        } else {
          value += clause[pos++];
        }
      }
      return value;
    };

    const readNumber = (): string => {
      let value = '';
      if (clause[pos] === '-') {
        value += clause[pos++];
      }
      while (pos < clause.length && /[\d.]/.test(clause[pos])) {
        value += clause[pos++];
      }
      return value;
    };

    const readWord = (): string => {
      let value = '';
      while (pos < clause.length && /[A-Za-z_0-9]/.test(clause[pos])) {
        value += clause[pos++];
      }
      return value;
    };

    while (pos < clause.length) {
      skipWhitespace();
      if (pos >= clause.length) break;

      const startPos = pos;
      const char = clause[pos];

      // String literals
      if (char === "'" || char === '"') {
        tokens.push({ type: 'STRING', value: readString(char), position: startPos });
        continue;
      }

      // Numbers (including negative)
      if (/\d/.test(char) || (char === '-' && /\d/.test(clause[pos + 1]))) {
        tokens.push({ type: 'NUMBER', value: readNumber(), position: startPos });
        continue;
      }

      // Parentheses
      if (char === '(') {
        tokens.push({ type: 'LPAREN', value: '(', position: startPos });
        pos++;
        continue;
      }
      if (char === ')') {
        tokens.push({ type: 'RPAREN', value: ')', position: startPos });
        pos++;
        continue;
      }

      // Operators
      if (char === '=' && clause[pos + 1] !== '=') {
        tokens.push({ type: 'OPERATOR', value: '=', position: startPos });
        pos++;
        continue;
      }
      if (char === '<') {
        if (clause[pos + 1] === '>') {
          tokens.push({ type: 'OPERATOR', value: '<>', position: startPos });
          pos += 2;
        } else if (clause[pos + 1] === '=') {
          tokens.push({ type: 'OPERATOR', value: '<=', position: startPos });
          pos += 2;
        } else {
          tokens.push({ type: 'OPERATOR', value: '<', position: startPos });
          pos++;
        }
        continue;
      }
      if (char === '>') {
        if (clause[pos + 1] === '=') {
          tokens.push({ type: 'OPERATOR', value: '>=', position: startPos });
          pos += 2;
        } else {
          tokens.push({ type: 'OPERATOR', value: '>', position: startPos });
          pos++;
        }
        continue;
      }
      if (char === '!' && clause[pos + 1] === '=') {
        tokens.push({ type: 'OPERATOR', value: '!=', position: startPos });
        pos += 2;
        continue;
      }

      // Words (keywords, column names, etc.)
      if (/[A-Za-z_]/.test(char)) {
        const word = readWord();
        const upper = word.toUpperCase();

        // Keywords
        if (upper === 'AND') {
          tokens.push({ type: 'AND', value: 'AND', position: startPos });
        } else if (upper === 'OR') {
          tokens.push({ type: 'OR', value: 'OR', position: startPos });
        } else if (upper === 'IS') {
          tokens.push({ type: 'IS', value: 'IS', position: startPos });
        } else if (upper === 'NOT') {
          tokens.push({ type: 'NOT', value: 'NOT', position: startPos });
        } else if (upper === 'NULL') {
          tokens.push({ type: 'NULL', value: 'null', position: startPos });
        } else if (upper === 'TRUE') {
          tokens.push({ type: 'BOOLEAN', value: 'true', position: startPos });
        } else if (upper === 'FALSE') {
          tokens.push({ type: 'BOOLEAN', value: 'false', position: startPos });
        } else if (upper === 'CONTAINS') {
          tokens.push({ type: 'STRING_OP', value: 'contains', position: startPos });
        } else if (upper === 'STARTS') {
          // Check for "STARTS WITH"
          skipWhitespace();
          const next = readWord();
          if (next.toUpperCase() === 'WITH') {
            tokens.push({ type: 'STRING_OP', value: 'starts with', position: startPos });
          } else {
            throw new ValidationError('WHERE clause', clause, `'WITH' after 'STARTS' at position ${pos}`);
          }
        } else if (upper === 'ENDS') {
          // Check for "ENDS WITH"
          skipWhitespace();
          const next = readWord();
          if (next.toUpperCase() === 'WITH') {
            tokens.push({ type: 'STRING_OP', value: 'ends with', position: startPos });
          } else {
            throw new ValidationError('WHERE clause', clause, `'WITH' after 'ENDS' at position ${pos}`);
          }
        } else if (upper === 'DATE') {
          // DATE literal: DATE "YYYY-MM-DD" or DATE 'YYYY-MM-DD'
          skipWhitespace();
          const dateChar = clause[pos];
          if (dateChar === '"' || dateChar === "'") {
            const dateStr = readString(dateChar);
            tokens.push({ type: 'DATE', value: dateStr, position: startPos });
          } else {
            throw new ValidationError('WHERE clause', clause, `expected date string after DATE keyword at position ${pos}`);
          }
        } else if (upper === 'NOW' || upper === 'TODAY') {
          // NOW() and TODAY() functions - return current date/time
          skipWhitespace();
          if (clause[pos] === '(' && clause[pos + 1] === ')') {
            pos += 2; // Skip ()
            const now = new Date();
            if (upper === 'TODAY') {
              // TODAY() returns just the date portion in local timezone (YYYY-MM-DD)
              const year = now.getFullYear();
              const month = String(now.getMonth() + 1).padStart(2, '0');
              const day = String(now.getDate()).padStart(2, '0');
              tokens.push({ type: 'DATE', value: `${year}-${month}-${day}`, position: startPos });
            } else {
              // NOW() returns full datetime in ISO format
              tokens.push({ type: 'DATE', value: now.toISOString(), position: startPos });
            }
          } else {
            // Treat as column name if no parentheses
            tokens.push({ type: 'COLUMN', value: word.toUpperCase(), position: startPos });
          }
        } else {
          // Column name (already resolved to letter at this point)
          tokens.push({ type: 'COLUMN', value: word.toUpperCase(), position: startPos });
        }
        continue;
      }

      // Unknown character - skip
      pos++;
    }

    tokens.push({ type: 'EOF', value: '', position: pos });
    return tokens;
  }

  // ==================== WHERE CLAUSE PARSER ====================

  /**
   * Parse WHERE clause into AST using recursive descent parser
   * Grammar:
   *   orExpr  ::= andExpr ('OR' andExpr)*
   *   andExpr ::= term ('AND' term)*
   *   term    ::= '(' orExpr ')' | comparison | nullCheck
   */
  private parseWhereClause(clause: string): ASTNode {
    const tokens = this.tokenizeWhere(clause);
    let pos = 0;

    const current = (): Token => tokens[pos] || { type: 'EOF', value: '', position: -1 };
    const peek = (offset: number = 0): Token => tokens[pos + offset] || { type: 'EOF', value: '', position: -1 };
    const advance = (): Token => tokens[pos++];
    const expect = (type: TokenType): Token => {
      const tok = current();
      if (tok.type !== type) {
        throw new ValidationError('WHERE clause', clause, `expected ${type} but got ${tok.type} at position ${tok.position}`);
      }
      return advance();
    };

    const parseValue = (): any => {
      const tok = current();
      switch (tok.type) {
        case 'STRING':
          advance();
          return tok.value;
        case 'NUMBER':
          advance();
          return parseFloat(tok.value);
        case 'BOOLEAN':
          advance();
          return tok.value === 'true';
        case 'NULL':
          advance();
          return null;
        case 'DATE':
          advance();
          // Return as Date object for proper comparison
          return new Date(tok.value);
        default:
          throw new ValidationError('WHERE clause', clause, `expected value but got ${tok.type} at position ${tok.position}`);
      }
    };

    const parseTerm = (): ASTNode => {
      const tok = current();

      // Parenthesized expression
      if (tok.type === 'LPAREN') {
        advance();
        const expr = parseOrExpr();
        expect('RPAREN');
        return expr;
      }

      // Column comparison or null check
      if (tok.type === 'COLUMN') {
        const column = advance().value;

        // Check for IS NULL / IS NOT NULL
        if (current().type === 'IS') {
          advance();
          if (current().type === 'NOT') {
            advance();
            expect('NULL');
            return { type: 'null_check', column, isNull: false };
          }
          expect('NULL');
          return { type: 'null_check', column, isNull: true };
        }

        // Comparison operators
        const opTok = current();
        if (opTok.type === 'OPERATOR' || opTok.type === 'STRING_OP') {
          const operator = advance().value;
          const value = parseValue();
          return { type: 'comparison', column, operator, value };
        }

        throw new ValidationError('WHERE clause', clause, `expected operator after column ${column} at position ${opTok.position}`);
      }

      throw new ValidationError('WHERE clause', clause, `unexpected token ${tok.type} at position ${tok.position}`);
    };

    const parseAndExpr = (): ASTNode => {
      let left = parseTerm();
      while (current().type === 'AND') {
        advance();
        const right = parseTerm();
        left = { type: 'and', left, right };
      }
      return left;
    };

    const parseOrExpr = (): ASTNode => {
      let left = parseAndExpr();
      while (current().type === 'OR') {
        advance();
        const right = parseAndExpr();
        left = { type: 'or', left, right };
      }
      return left;
    };

    const ast = parseOrExpr();

    // Ensure we consumed all tokens
    if (current().type !== 'EOF') {
      throw new ValidationError('WHERE clause', clause, `unexpected token ${current().value} at position ${current().position}`);
    }

    return ast;
  }

  /**
   * Evaluate WHERE clause AST against a row
   */
  private evaluateWhere(ast: ASTNode, row: any[], columnMap: Map<string, string>): boolean {
    const getColumnValue = (column: string): any => {
      // Column should already be a letter (A, B, AA, etc.)
      const index = this.columnToIndex(column);
      if (index < 0 || index >= row.length) return null;
      const val = row[index];
      // Treat empty strings and undefined as null
      if (val === undefined || val === '') return null;
      return val;
    };

    const compareValues = (cellValue: any, operator: string, targetValue: any): boolean => {
      // Null handling
      if (cellValue === null) {
        return operator === '=' ? targetValue === null : false;
      }
      if (targetValue === null) {
        return operator === '=' ? cellValue === null : false;
      }

      // Date comparison if target is a Date object
      if (targetValue instanceof Date) {
        // Try to parse cell value as date
        let cellDate: Date | null = null;

        if (cellValue instanceof Date) {
          cellDate = cellValue;
        } else if (typeof cellValue === 'string') {
          // Check for ISO date format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
          const isoMatch = cellValue.match(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/);
          if (isoMatch) {
            cellDate = new Date(cellValue);
          } else {
            // Try general date parsing
            const parsed = new Date(cellValue);
            if (!isNaN(parsed.getTime())) {
              cellDate = parsed;
            }
          }
        } else if (typeof cellValue === 'number') {
          // Could be a timestamp
          cellDate = new Date(cellValue);
        }

        if (cellDate && !isNaN(cellDate.getTime())) {
          const cellTime = cellDate.getTime();
          const targetTime = targetValue.getTime();

          switch (operator) {
            case '=':  return cellTime === targetTime;
            case '<>':
            case '!=': return cellTime !== targetTime;
            case '<':  return cellTime < targetTime;
            case '<=': return cellTime <= targetTime;
            case '>':  return cellTime > targetTime;
            case '>=': return cellTime >= targetTime;
            default:   return false;
          }
        }
        // If cell value cannot be parsed as date, fall through to string comparison
      }

      // Numeric comparison if both can be numbers
      const cellNum = Number(cellValue);
      const targetNum = Number(targetValue);
      if (!isNaN(cellNum) && !isNaN(targetNum) && typeof targetValue === 'number') {
        switch (operator) {
          case '=':  return cellNum === targetNum;
          case '<>':
          case '!=': return cellNum !== targetNum;
          case '<':  return cellNum < targetNum;
          case '<=': return cellNum <= targetNum;
          case '>':  return cellNum > targetNum;
          case '>=': return cellNum >= targetNum;
          default:   return false;
        }
      }

      // String comparison (case-sensitive to match Google Viz)
      const cellStr = String(cellValue);
      const targetStr = String(targetValue);

      switch (operator) {
        case '=':  return cellStr === targetStr;
        case '<>':
        case '!=': return cellStr !== targetStr;
        case '<':  return cellStr < targetStr;
        case '<=': return cellStr <= targetStr;
        case '>':  return cellStr > targetStr;
        case '>=': return cellStr >= targetStr;
        case 'contains':    return cellStr.includes(targetStr);
        case 'starts with': return cellStr.startsWith(targetStr);
        case 'ends with':   return cellStr.endsWith(targetStr);
        default:   return false;
      }
    };

    const evaluate = (node: ASTNode): boolean => {
      switch (node.type) {
        case 'comparison': {
          const cellValue = getColumnValue(node.column);
          return compareValues(cellValue, node.operator, node.value);
        }
        case 'null_check': {
          const cellValue = getColumnValue(node.column);
          return node.isNull ? (cellValue === null) : (cellValue !== null);
        }
        case 'and': {
          return evaluate(node.left) && evaluate(node.right);
        }
        case 'or': {
          return evaluate(node.left) || evaluate(node.right);
        }
      }
    };

    return evaluate(ast);
  }

  // ==================== ORDER BY / LIMIT PARSERS ====================

  /**
   * Parse ORDER BY clause
   * Example: "A ASC, B DESC" → [{column: 'A', direction: 'ASC'}, {column: 'B', direction: 'DESC'}]
   * Also handles: "s.score DESC, u.name ASC" for aliased columns
   */
  private parseOrderByClause(clause: string, columnMap: Map<string, string>): OrderByTerm[] {
    const terms: OrderByTerm[] = [];
    const parts = clause.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Match column (including alias.column and :table.column formats) and optional direction
      const match = trimmed.match(/^(:?[\w.]+)(?:\s+(ASC|DESC))?$/i);
      if (!match) {
        throw new ValidationError('ORDER BY clause', clause, `valid syntax: column [ASC|DESC]`);
      }

      let column = match[1];
      // Resolve column name if needed (handles alias.column format)
      const resolved = columnMap.get(column.toLowerCase());
      if (resolved) {
        column = resolved;
      } else if (column.includes('.')) {
        // Try resolving alias.column or :table.column format
        const cleanColumn = column.replace(/^:/, '');  // Remove leading : if present
        const [alias, colName] = cleanColumn.split('.');
        const qualifiedKey = `${alias}.${colName}`.toLowerCase();
        const qualifiedResolved = columnMap.get(qualifiedKey);
        if (qualifiedResolved) {
          column = qualifiedResolved;
        } else {
          // Try just the column name
          const colOnlyResolved = columnMap.get(colName.toLowerCase());
          if (colOnlyResolved) {
            column = colOnlyResolved;
          } else {
            throw new ValidationError('ORDER BY clause', column, 'valid column name or letter');
          }
        }
      } else if (!/^[A-Z]+$/i.test(column)) {
        throw new ValidationError('ORDER BY clause', column, 'valid column name or letter');
      }

      const direction = (match[2]?.toUpperCase() as 'ASC' | 'DESC') || 'ASC';
      terms.push({ column: column.toUpperCase(), direction });
    }

    return terms;
  }

  /**
   * Parse LIMIT clause
   */
  private parseLimitClause(clause: string): number {
    const match = clause.match(/^\s*(\d+)\s*$/);
    if (!match) {
      throw new ValidationError('LIMIT clause', clause, 'positive integer');
    }
    return parseInt(match[1], 10);
  }

  /**
   * Sort rows by ORDER BY terms
   */
  private sortRows(rows: MatchedRow[], orderBy: OrderByTerm[]): void {
    rows.sort((a, b) => {
      for (const term of orderBy) {
        const colIndex = this.columnToIndex(term.column);
        const aVal = a.rowData[colIndex];
        const bVal = b.rowData[colIndex];

        // Handle nulls - null values sort last
        if (aVal === null || aVal === undefined || aVal === '') {
          if (bVal === null || bVal === undefined || bVal === '') return 0;
          return term.direction === 'ASC' ? 1 : -1;
        }
        if (bVal === null || bVal === undefined || bVal === '') {
          return term.direction === 'ASC' ? -1 : 1;
        }

        // Numeric comparison if both are numbers
        const aNum = Number(aVal);
        const bNum = Number(bVal);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          if (aNum !== bNum) {
            return term.direction === 'ASC' ? aNum - bNum : bNum - aNum;
          }
        } else {
          // String comparison
          const cmp = String(aVal).localeCompare(String(bVal));
          if (cmp !== 0) {
            return term.direction === 'ASC' ? cmp : -cmp;
          }
        }
      }
      return 0;
    });
  }

  // ==================== STATEMENT PARSERS ====================

  /**
   * Parse UPDATE statement to extract clauses
   * Syntax: UPDATE SET col = val [, col = val] [FROM :table] WHERE condition [ORDER BY col [ASC|DESC]] [LIMIT n]
   * For virtual tables: UPDATE SET col = val FROM :table WHERE condition
   */
  private parseUpdateStatement(statement: string): ParsedUpdateStatement {
    const upper = statement.toUpperCase();

    // Find SET
    const setIdx = upper.indexOf('SET');
    if (setIdx === -1) {
      throw new ValidationError('UPDATE statement', statement, 'UPDATE SET ... WHERE ... syntax');
    }

    // Find FROM (for virtual tables) and WHERE
    const fromIdx = upper.indexOf(' FROM ');
    const whereIdx = upper.indexOf('WHERE');
    if (whereIdx === -1) {
      throw new ValidationError('UPDATE statement', statement, 'WHERE clause (use WHERE true to update all rows)');
    }

    // SET clause ends at FROM or WHERE, whichever comes first
    let setEnd = whereIdx;
    if (fromIdx !== -1 && fromIdx > setIdx && fromIdx < whereIdx) {
      setEnd = fromIdx;
    }

    // Find ORDER BY and LIMIT (after WHERE)
    const afterWhere = statement.slice(whereIdx + 5);
    const orderByMatch = afterWhere.match(/\s+ORDER\s+BY\s+/i);
    const limitMatch = afterWhere.match(/\s+LIMIT\s+/i);

    let whereEnd = afterWhere.length;
    let orderByClause: string | undefined;
    let limit: number | undefined;

    if (orderByMatch) {
      const orderByStart = orderByMatch.index!;
      whereEnd = Math.min(whereEnd, orderByStart);

      // Extract ORDER BY clause
      let orderByEnd = afterWhere.length;
      if (limitMatch && limitMatch.index! > orderByStart) {
        orderByEnd = limitMatch.index!;
      }
      orderByClause = afterWhere.slice(orderByStart + orderByMatch[0].length, orderByEnd).trim();
    }

    if (limitMatch) {
      if (!orderByMatch || limitMatch.index! > orderByMatch.index!) {
        whereEnd = Math.min(whereEnd, limitMatch.index!);
      }
      const limitStr = afterWhere.slice(limitMatch.index! + limitMatch[0].length).trim().split(/\s/)[0];
      limit = this.parseLimitClause(limitStr);
    }

    return {
      setClause: statement.slice(setIdx + 3, setEnd).trim(),
      whereClause: afterWhere.slice(0, whereEnd).trim(),
      orderByClause,
      limit
    };
  }

  /**
   * Parse DELETE statement to extract clauses
   * Syntax: DELETE WHERE condition [ORDER BY col [ASC|DESC]] [LIMIT n]
   */
  private parseDeleteStatement(statement: string): ParsedDeleteStatement {
    const upper = statement.toUpperCase();

    // Find WHERE
    const whereIdx = upper.indexOf('WHERE');
    if (whereIdx === -1) {
      throw new ValidationError('DELETE statement', statement, 'WHERE clause (use WHERE true to delete all rows)');
    }

    // Find ORDER BY and LIMIT (after WHERE)
    const afterWhere = statement.slice(whereIdx + 5);
    const orderByMatch = afterWhere.match(/\s+ORDER\s+BY\s+/i);
    const limitMatch = afterWhere.match(/\s+LIMIT\s+/i);

    let whereEnd = afterWhere.length;
    let orderByClause: string | undefined;
    let limit: number | undefined;

    if (orderByMatch) {
      const orderByStart = orderByMatch.index!;
      whereEnd = Math.min(whereEnd, orderByStart);

      // Extract ORDER BY clause
      let orderByEnd = afterWhere.length;
      if (limitMatch && limitMatch.index! > orderByStart) {
        orderByEnd = limitMatch.index!;
      }
      orderByClause = afterWhere.slice(orderByStart + orderByMatch[0].length, orderByEnd).trim();
    }

    if (limitMatch) {
      if (!orderByMatch || limitMatch.index! > orderByMatch.index!) {
        whereEnd = Math.min(whereEnd, limitMatch.index!);
      }
      const limitStr = afterWhere.slice(limitMatch.index! + limitMatch[0].length).trim().split(/\s/)[0];
      limit = this.parseLimitClause(limitStr);
    }

    return {
      whereClause: afterWhere.slice(0, whereEnd).trim(),
      orderByClause,
      limit
    };
  }

  // ==================== LOCAL ROW MATCHING ====================

  /**
   * Fetch all rows from sheet and find matching ones locally
   * This replaces the broken ROW() approach
   */
  private async findMatchingRowsLocal(
    spreadsheetId: string,
    range: string,
    whereClause: string,
    accessToken: string,
    orderBy?: OrderByTerm[],
    limit?: number
  ): Promise<MatchedRow[]> {
    // Fetch all data
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch rows: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const allRows: any[][] = data.values || [];

    if (allRows.length <= 1) {
      // Only header or empty - no data rows
      return [];
    }

    // Get headers and build column map
    const headers = allRows[0];
    const columnMap = this.buildColumnMap(headers);

    // Parse range to get start row
    const parsedRange = this.parseRange(range);
    const dataStartRow = parsedRange.startRow + 1;  // Data starts after header

    // Resolve column names in WHERE clause
    const resolvedWhere = this.resolveColumnNames(whereClause, columnMap);

    // Parse WHERE clause
    let ast: ASTNode | null = null;
    // Handle special case: WHERE true (select all)
    if (resolvedWhere.trim().toLowerCase() === 'true') {
      // Match all data rows
      const matched: MatchedRow[] = [];
      for (let i = 1; i < allRows.length; i++) {
        matched.push({
          rowNumber: parsedRange.startRow + i,  // Sheet row number
          rowData: allRows[i]
        });
      }

      // Apply ORDER BY
      if (orderBy && orderBy.length > 0) {
        this.sortRows(matched, orderBy);
      }

      // Apply LIMIT
      if (limit !== undefined && limit < matched.length) {
        return matched.slice(0, limit);
      }

      return matched;
    }

    // Parse and evaluate WHERE clause
    ast = this.parseWhereClause(resolvedWhere);

    // Filter rows
    const matched: MatchedRow[] = [];
    for (let i = 1; i < allRows.length; i++) {
      const row = allRows[i];
      if (this.evaluateWhere(ast, row, columnMap)) {
        matched.push({
          rowNumber: parsedRange.startRow + i,  // Sheet row number
          rowData: row
        });
      }
    }

    // Apply ORDER BY
    if (orderBy && orderBy.length > 0) {
      this.sortRows(matched, orderBy);
    }

    // Apply LIMIT
    if (limit !== undefined && limit < matched.length) {
      return matched.slice(0, limit);
    }

    return matched;
  }

  // ==================== VIRTUAL TABLE SUPPORT ====================

  /**
   * Parse table references from SQL statement
   * Detects both :name virtual table references and sheet range references
   */
  private parseTableReferences(statement: string): TableReference[] {
    const refs: TableReference[] = [];
    const upperStmt = statement.toUpperCase();

    // Match :name patterns (virtual tables) - only in FROM/JOIN context, not in string literals
    // Remove string literals first to avoid false matches (handles escaped quotes and SQL doubled quotes)
    const withoutStrings = this.stripStringLiterals(statement);
    const virtualPattern = /:(\w+)/g;
    let match;
    while ((match = virtualPattern.exec(withoutStrings)) !== null) {
      refs.push({
        type: 'virtual',
        name: match[1],          // "users", "scores", etc.
        source: match[0],        // ":users", ":scores"
        alias: undefined
      });
    }

    // If no virtual tables found, check for sheet range in FROM clause
    if (refs.length === 0) {
      // Match sheet ranges (SheetName!A:Z or just A:Z) in FROM clause
      const fromMatch = statement.match(/FROM\s+(['"]?[\w\s]+['"]?!)?([A-Z]+[0-9]*:[A-Z]+[0-9]*|\$?[A-Z]+:\$?[A-Z]+)/i);
      if (fromMatch) {
        refs.push({
          type: 'sheet',
          name: null,
          source: fromMatch[0].replace(/^FROM\s+/i, '').trim(),
          alias: undefined
        });
      }
    }

    return refs;
  }

  /**
   * Strip string literals from SQL statement for pattern detection.
   * Handles: backslash escapes (\", \', \\, \n, \t, \r) and SQL doubled quotes ("", '')
   * Replaces string content with empty placeholder to preserve structure.
   *
   * @param statement - SQL statement to process
   * @returns Statement with all string literals replaced with ""
   */
  private stripStringLiterals(statement: string): string {
    let result = '';
    let pos = 0;

    while (pos < statement.length) {
      const char = statement[pos];

      // Check for string start
      if (char === '"' || char === "'") {
        const quote = char;
        result += '""';  // Placeholder for stripped string
        pos++;  // Skip opening quote

        // Skip string content
        while (pos < statement.length) {
          const c = statement[pos];

          // Backslash escape - skip next char
          if (c === '\\' && pos + 1 < statement.length) {
            pos += 2;  // Skip \ and escaped char
            continue;
          }

          // Quote character
          if (c === quote) {
            // SQL doubled quote ('' or "") - skip both
            if (statement[pos + 1] === quote) {
              pos += 2;
              continue;
            }
            // Closing quote - done with string
            pos++;
            break;
          }

          pos++;  // Regular char
        }
      } else {
        result += char;
        pos++;
      }
    }

    return result;
  }

  /**
   * Parse FROM clause with support for :name references and aliases
   * Supports: FROM :table AS alias, FROM Sheet1!A:C AS s JOIN :virtual AS v ON condition
   */
  private parseFromClause(statement: string): {
    mainTable: TableReference;
    joins: JoinClause[];
  } {
    // Match FROM clause: FROM <table> [AS] [alias]
    const fromMatch = statement.match(
      /FROM\s+(:?\w+(?:![A-Z]+[0-9]*:[A-Z]+[0-9]*)?|\w+![A-Z]+:[A-Z]+)(?:\s+(?:AS\s+)?(\w+))?/i
    );

    if (!fromMatch) {
      throw new ValidationError('statement', statement, 'valid FROM clause');
    }

    const mainSource = fromMatch[1];
    const mainAlias = fromMatch[2];

    const isVirtual = (src: string) => src.startsWith(':');
    const getVirtualName = (src: string) => src.startsWith(':') ? src.slice(1) : null;

    const mainTable: TableReference = {
      type: isVirtual(mainSource) ? 'virtual' : 'sheet',
      name: getVirtualName(mainSource),
      source: mainSource,
      alias: mainAlias
    };

    // Parse JOINs - lookahead handles whitespace/newlines before keywords or end of string
    const joins: JoinClause[] = [];
    const joinRegex = /(LEFT\s+|RIGHT\s+)?JOIN\s+(:?\w+(?:![A-Z]+[0-9]*:[A-Z]+[0-9]*)?)(?:\s+(?:AS\s+)?(\w+))?\s+ON\s+(.+?)(?=\s*(?:(?:LEFT\s+|RIGHT\s+)?JOIN|WHERE|ORDER|LIMIT|GROUP)|\s*$)/gi;

    // Get the part of statement after FROM for JOIN parsing
    const afterFrom = statement.slice(fromMatch.index! + fromMatch[0].length);
    let joinMatch;

    while ((joinMatch = joinRegex.exec(afterFrom)) !== null) {
      const joinType = joinMatch[1]?.trim().toUpperCase() || '';
      const joinSource = joinMatch[2];
      const joinAlias = joinMatch[3];
      const onCondition = joinMatch[4].trim();

      joins.push({
        type: (joinType ? `${joinType} JOIN` : 'JOIN') as 'JOIN' | 'LEFT JOIN' | 'RIGHT JOIN',
        table: {
          type: isVirtual(joinSource) ? 'virtual' : 'sheet',
          name: getVirtualName(joinSource),
          source: joinSource,
          alias: joinAlias
        },
        on: onCondition
      });
    }

    return { mainTable, joins };
  }

  /**
   * Execute pure virtual table query (no sheet involvement)
   */
  private executeVirtualOnly(
    params: any,
    tableRefs: TableReference[],
    operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'
  ): any {
    const { statement, dataSources } = params;

    // Parse FROM clause to get main table and aliases
    const { mainTable, joins } = this.parseFromClause(statement);

    // Validate main table exists in dataSources
    if (mainTable.type === 'virtual') {
      const source = dataSources[mainTable.name!];
      if (!source || !Array.isArray(source) || source.length === 0) {
        throw new ValidationError('dataSources', mainTable.name!,
          `Virtual table :${mainTable.name} not found or empty in dataSources`);
      }
    }

    // For single virtual table queries without JOINs
    if (joins.length === 0 && mainTable.type === 'virtual') {
      const source = dataSources[mainTable.name!];
      const headers = source[0] as string[];
      const rows = source.slice(1) as any[][];
      const columnMap = this.buildColumnMap(headers);

      switch (operation) {
        case 'SELECT':
          return this.executeVirtualSelect(headers, rows, statement, columnMap, mainTable.alias);
        case 'UPDATE':
          return this.executeVirtualUpdate(headers, rows, statement, columnMap);
        case 'DELETE':
          return this.executeVirtualDelete(headers, rows, statement, columnMap);
        case 'INSERT':
          throw new ValidationError('statement', statement,
            'INSERT not supported for virtual tables. Virtual tables are read-only.');
        default:
          throw new ValidationError('statement', statement, 'valid SQL operation');
      }
    }

    // Multiple tables = JOIN operation
    return this.executeVirtualJoin(params, mainTable, joins, operation);
  }

  /**
   * Execute hybrid query (sheet + virtual tables via JOIN)
   */
  private async executeHybridQuery(
    params: any,
    tableRefs: TableReference[],
    operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE',
    spreadsheetId: string,
    range: string,
    accessToken: string
  ): Promise<any> {
    const { statement, dataSources } = params;

    // Parse FROM clause
    const { mainTable, joins } = this.parseFromClause(statement);

    // Build combined data from all tables
    const allTableData = new Map<string, TableData>();
    let combinedHeaders: string[] = [];
    let combinedRows: any[][] = [];

    // Load main table
    const mainData = await this.loadTableData(
      mainTable,
      dataSources,
      spreadsheetId,
      range,
      accessToken
    );
    const mainAlias = mainTable.alias || '_main';
    allTableData.set(mainAlias, mainData);
    combinedHeaders = mainData.headers.map(h => `${mainAlias}.${h}`);
    combinedRows = mainData.rows.map(row => [...row]);

    // Process JOINs
    for (const join of joins) {
      const joinData = await this.loadTableData(
        join.table,
        dataSources,
        spreadsheetId,
        range,
        accessToken
      );
      const joinAlias = join.table.alias || join.table.name || '_join';
      allTableData.set(joinAlias, joinData);

      // Add join table headers
      const joinHeaders = joinData.headers.map(h => `${joinAlias}.${h}`);

      // Perform the JOIN
      combinedRows = this.performJoin(
        combinedRows,
        combinedHeaders,
        joinData,
        join.on,
        join.type,
        mainAlias,
        joinAlias,
        allTableData
      );

      combinedHeaders = [...combinedHeaders, ...joinHeaders];
    }

    // Build column map for combined headers
    const columnMap = this.buildCombinedColumnMap(combinedHeaders, allTableData);

    // Execute operation on combined data
    switch (operation) {
      case 'SELECT':
        return this.executeVirtualSelect(combinedHeaders, combinedRows, statement, columnMap);
      case 'UPDATE':
        return this.executeVirtualUpdate(combinedHeaders, combinedRows, statement, columnMap);
      case 'DELETE':
        return this.executeVirtualDelete(combinedHeaders, combinedRows, statement, columnMap);
      case 'INSERT':
        throw new ValidationError('statement', statement,
          'INSERT not supported for hybrid queries with virtual tables');
      default:
        throw new ValidationError('statement', statement, 'valid SQL operation');
    }
  }

  /**
   * Load table data from either virtual source or sheet
   */
  private async loadTableData(
    table: TableReference,
    dataSources: Record<string, any[][]> | undefined,
    spreadsheetId?: string,
    range?: string,
    accessToken?: string
  ): Promise<TableData> {
    if (table.type === 'virtual') {
      if (!dataSources) {
        throw new ValidationError('dataSources', 'undefined',
          `dataSources parameter for virtual table :${table.name}`);
      }
      const source = dataSources[table.name!];
      if (!source || !Array.isArray(source) || source.length === 0) {
        throw new ValidationError('dataSources', table.name!,
          `Virtual table :${table.name} not found or empty in dataSources`);
      }
      return {
        headers: source[0] as string[],
        rows: source.slice(1) as any[][]
      };
    } else {
      // Load from sheet
      if (!spreadsheetId || !accessToken) {
        throw new ValidationError('spreadsheetId', 'undefined',
          'spreadsheetId for sheet table reference');
      }
      const sheetRange = table.source || range!;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetRange)}`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch sheet data: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const allRows: any[][] = data.values || [];

      return {
        headers: allRows[0] || [],
        rows: allRows.slice(1)
      };
    }
  }

  /**
   * Perform JOIN operation between left rows and right table
   */
  private performJoin(
    leftRows: any[][],
    leftHeaders: string[],
    rightTable: TableData,
    onCondition: string,
    joinType: 'JOIN' | 'LEFT JOIN' | 'RIGHT JOIN',
    leftAlias: string,
    rightAlias: string,
    allTableData: Map<string, TableData>
  ): any[][] {
    // Parse ON condition: "left.A = right.id" or "s.A = :users.id"
    const onMatch = onCondition.match(/(\w+)\.(\w+)\s*=\s*:?(\w+)\.(\w+)/);
    if (!onMatch) {
      throw new ValidationError('ON condition', onCondition, 'format: alias.column = alias.column');
    }

    const [, leftTableRef, leftCol, rightTableRef, rightCol] = onMatch;

    // Resolve column indices
    const leftColIndex = this.resolveJoinColumnIndex(leftTableRef, leftCol, leftHeaders, allTableData);
    const rightColIndex = rightTable.headers.findIndex(
      h => h.toLowerCase() === rightCol.toLowerCase()
    );

    if (rightColIndex === -1) {
      // Try as column letter
      if (/^[A-Z]+$/i.test(rightCol)) {
        const idx = this.columnToIndex(rightCol);
        if (idx < rightTable.headers.length) {
          return this.performJoinWithIndices(leftRows, rightTable, leftColIndex, idx, joinType);
        }
      }
      throw new ValidationError('ON condition', rightCol, `valid column in :${rightAlias}`);
    }

    return this.performJoinWithIndices(leftRows, rightTable, leftColIndex, rightColIndex, joinType);
  }

  /**
   * Perform JOIN with resolved column indices
   */
  private performJoinWithIndices(
    leftRows: any[][],
    rightTable: TableData,
    leftColIndex: number,
    rightColIndex: number,
    joinType: 'JOIN' | 'LEFT JOIN' | 'RIGHT JOIN'
  ): any[][] {
    const results: any[][] = [];

    // RIGHT JOIN: iterate right table first, preserve unmatched right rows
    if (joinType === 'RIGHT JOIN') {
      const leftColCount = leftRows.length > 0 ? leftRows[0].length : 0;

      for (const rightRow of rightTable.rows) {
        const rightValue = rightRow[rightColIndex];
        let matched = false;

        for (const leftRow of leftRows) {
          const leftValue = leftRow[leftColIndex];

          if (this.valuesEqual(leftValue, rightValue)) {
            matched = true;
            results.push([...leftRow, ...rightRow]);
          }
        }

        // Include unmatched right rows with nulls for left columns
        if (!matched) {
          const nullRow = new Array(leftColCount).fill(null);
          results.push([...nullRow, ...rightRow]);
        }
      }

      return results;
    }

    // INNER JOIN and LEFT JOIN: iterate left table first
    for (const leftRow of leftRows) {
      const leftValue = leftRow[leftColIndex];
      let matched = false;

      for (const rightRow of rightTable.rows) {
        const rightValue = rightRow[rightColIndex];

        // Compare values (handle type coercion)
        if (this.valuesEqual(leftValue, rightValue)) {
          matched = true;
          results.push([...leftRow, ...rightRow]);
        }
      }

      // LEFT JOIN: include unmatched left rows with nulls
      if (!matched && joinType === 'LEFT JOIN') {
        const nullRow = new Array(rightTable.headers.length).fill(null);
        results.push([...leftRow, ...nullRow]);
      }
    }

    return results;
  }

  /**
   * Compare values for JOIN condition (with type coercion)
   */
  private valuesEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a === null || a === undefined || a === '') {
      return b === null || b === undefined || b === '';
    }
    if (b === null || b === undefined || b === '') {
      return false;
    }
    // String comparison
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  /**
   * Resolve column index for JOIN condition
   */
  private resolveJoinColumnIndex(
    tableRef: string,
    columnRef: string,
    combinedHeaders: string[],
    allTableData: Map<string, TableData>
  ): number {
    // Try alias.column format
    const qualifiedName = `${tableRef}.${columnRef}`;
    let index = combinedHeaders.findIndex(
      h => h.toLowerCase() === qualifiedName.toLowerCase()
    );
    if (index !== -1) return index;

    // Try to find table and resolve column within it
    const tableData = allTableData.get(tableRef);
    if (tableData) {
      const colIndex = tableData.headers.findIndex(
        h => h.toLowerCase() === columnRef.toLowerCase()
      );
      if (colIndex !== -1) {
        // Find where this table's columns start in combined headers
        let offset = 0;
        for (const [alias, data] of allTableData) {
          if (alias === tableRef) break;
          offset += data.headers.length;
        }
        return offset + colIndex;
      }

      // Try as column letter
      if (/^[A-Z]+$/i.test(columnRef)) {
        const letterIndex = this.columnToIndex(columnRef);
        if (letterIndex < tableData.headers.length) {
          let offset = 0;
          for (const [alias, data] of allTableData) {
            if (alias === tableRef) break;
            offset += data.headers.length;
          }
          return offset + letterIndex;
        }
      }
    }

    throw new ValidationError('ON condition', `${tableRef}.${columnRef}`, 'valid column reference');
  }

  /**
   * Build column map for combined headers from multiple tables
   */
  private buildCombinedColumnMap(
    combinedHeaders: string[],
    allTableData: Map<string, TableData>
  ): Map<string, string> {
    const map = new Map<string, string>();

    // Map each combined header to its column letter
    combinedHeaders.forEach((header, index) => {
      const colLetter = this.indexToColumn(index);

      // Map the full qualified name (alias.column)
      map.set(header.toLowerCase(), colLetter);

      // Extract just the column name part
      const dotIndex = header.indexOf('.');
      if (dotIndex !== -1) {
        const colName = header.slice(dotIndex + 1);
        // Only set if not already set (first table takes precedence)
        if (!map.has(colName.toLowerCase())) {
          map.set(colName.toLowerCase(), colLetter);
        }
      }
    });

    // Also map column letters to themselves
    combinedHeaders.forEach((_, index) => {
      const letter = this.indexToColumn(index);
      map.set(letter.toLowerCase(), letter);
      map.set(letter, letter);
    });

    return map;
  }

  /**
   * Execute virtual JOIN between multiple virtual tables
   */
  private executeVirtualJoin(
    params: any,
    mainTable: TableReference,
    joins: JoinClause[],
    operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'
  ): any {
    const { statement, dataSources } = params;

    // Build combined data from all virtual tables
    const allTableData = new Map<string, TableData>();
    let combinedHeaders: string[] = [];
    let combinedRows: any[][] = [];

    // Load main table
    const mainSource = dataSources[mainTable.name!];
    if (!mainSource || !Array.isArray(mainSource) || mainSource.length === 0) {
      throw new ValidationError('dataSources', mainTable.name!,
        `Virtual table :${mainTable.name} not found or empty`);
    }

    const mainData: TableData = {
      headers: mainSource[0] as string[],
      rows: mainSource.slice(1) as any[][]
    };
    const mainAlias = mainTable.alias || mainTable.name || '_main';
    allTableData.set(mainAlias, mainData);
    combinedHeaders = mainData.headers.map(h => `${mainAlias}.${h}`);
    combinedRows = mainData.rows.map(row => [...row]);

    // Process JOINs
    for (const join of joins) {
      if (join.table.type !== 'virtual') {
        throw new ValidationError('statement', statement,
          'Pure virtual queries cannot reference sheet tables');
      }

      const joinSource = dataSources[join.table.name!];
      if (!joinSource || !Array.isArray(joinSource) || joinSource.length === 0) {
        throw new ValidationError('dataSources', join.table.name!,
          `Virtual table :${join.table.name} not found or empty`);
      }

      const joinData: TableData = {
        headers: joinSource[0] as string[],
        rows: joinSource.slice(1) as any[][]
      };
      const joinAlias = join.table.alias || join.table.name || '_join';
      allTableData.set(joinAlias, joinData);

      // Add join table headers
      const joinHeaders = joinData.headers.map(h => `${joinAlias}.${h}`);

      // Perform the JOIN
      combinedRows = this.performJoin(
        combinedRows,
        combinedHeaders,
        joinData,
        join.on,
        join.type,
        mainAlias,
        joinAlias,
        allTableData
      );

      combinedHeaders = [...combinedHeaders, ...joinHeaders];
    }

    // Build column map for combined headers
    const columnMap = this.buildCombinedColumnMap(combinedHeaders, allTableData);

    // Execute operation on combined data
    switch (operation) {
      case 'SELECT':
        return this.executeVirtualSelect(combinedHeaders, combinedRows, statement, columnMap);
      case 'UPDATE':
        return this.executeVirtualUpdate(combinedHeaders, combinedRows, statement, columnMap);
      case 'DELETE':
        return this.executeVirtualDelete(combinedHeaders, combinedRows, statement, columnMap);
      case 'INSERT':
        throw new ValidationError('statement', statement,
          'INSERT not supported for virtual table JOINs');
      default:
        throw new ValidationError('statement', statement, 'valid SQL operation');
    }
  }

  /**
   * Execute SELECT on virtual table data
   */
  private executeVirtualSelect(
    headers: string[],
    rows: any[][],
    statement: string,
    columnMap: Map<string, string>,
    tableAlias?: string
  ): any {
    // Check for DISTINCT keyword
    const isDistinct = /SELECT\s+DISTINCT\s+/i.test(statement);

    // Parse clauses (use [\s\S] instead of . to match newlines in multiline statements)
    const whereMatch = statement.match(/WHERE\s+([\s\S]+?)(?:\s+ORDER\s+BY|\s+GROUP\s+BY|\s+HAVING|\s+LIMIT|$)/i);
    const groupByMatch = statement.match(/GROUP\s+BY\s+([\s\S]+?)(?:\s+HAVING|\s+ORDER\s+BY|\s+LIMIT|$)/i);
    const havingMatch = statement.match(/HAVING\s+([\s\S]+?)(?:\s+ORDER\s+BY|\s+LIMIT|$)/i);
    const orderMatch = statement.match(/ORDER\s+BY\s+([\s\S]+?)(?:\s+LIMIT|$)/i);
    const limitMatch = statement.match(/LIMIT\s+(\d+)/i);
    const offsetMatch = statement.match(/OFFSET\s+(\d+)/i);

    let matched: MatchedRow[] = [];

    // Filter rows with WHERE clause
    if (whereMatch) {
      const whereClause = whereMatch[1].trim();
      const resolvedWhere = this.resolveVirtualColumnNames(whereClause, columnMap, tableAlias);
      const ast = this.parseWhereClause(resolvedWhere);

      rows.forEach((row, idx) => {
        if (this.evaluateWhere(ast, row, columnMap)) {
          matched.push({ rowNumber: idx + 1, rowData: row });
        }
      });
    } else {
      matched = rows.map((row, idx) => ({ rowNumber: idx + 1, rowData: row }));
    }

    // Handle GROUP BY with aggregates
    if (groupByMatch) {
      return this.executeGroupBy(
        headers,
        matched,
        statement,
        columnMap,
        groupByMatch[1],
        havingMatch?.[1],
        orderMatch?.[1],
        limitMatch ? parseInt(limitMatch[1]) : undefined,
        offsetMatch ? parseInt(offsetMatch[1]) : undefined,
        tableAlias
      );
    }

    // Sort with ORDER BY
    if (orderMatch) {
      const orderBy = this.parseOrderByClause(orderMatch[1], columnMap);
      this.sortRows(matched, orderBy);
    }

    // Apply OFFSET
    const offset = offsetMatch ? parseInt(offsetMatch[1]) : 0;
    if (offset > 0) {
      matched = matched.slice(offset);
    }

    // Apply LIMIT
    const limit = limitMatch ? parseInt(limitMatch[1]) : undefined;
    if (limit !== undefined) {
      matched = matched.slice(0, limit);
    }

    // Parse SELECT columns (strip DISTINCT keyword for column parsing)
    let selectStatement = isDistinct
      ? statement.replace(/SELECT\s+DISTINCT\s+/i, 'SELECT ')
      : statement;

    // Extract SELECT clause for expression parsing
    const selectMatch = selectStatement.match(/SELECT\s+([\s\S]+?)\s+FROM/i);
    const selectOnlyMatch = selectStatement.match(/SELECT\s+([\s\S]+?)(?:\s+WHERE|\s+GROUP\s+BY|\s+ORDER|\s+LIMIT|$)/i);
    const selectClause = selectMatch?.[1] || selectOnlyMatch?.[1] || '*';

    // Check if any expressions or column aliases are present (in SELECT clause only)
    const hasExpressions = this.isExpression(selectClause) || /\s+AS\s+\w+\s*(?:,|$)/i.test(selectClause);

    if (hasExpressions) {
      // Use enhanced parser for expressions and aliases
      const selectItems = this.parseAggregateSelectClause(selectClause, headers, columnMap, tableAlias);

      // Apply DISTINCT
      if (isDistinct) {
        const seenRows = new Set<string>();
        matched = matched.filter(m => {
          const rowSignature = selectItems
            .map(item => {
              if (item.type === 'expression' && item.expression) {
                return JSON.stringify(this.evaluateExpression(item.expression, m.rowData));
              }
              return JSON.stringify(m.rowData[item.columnIndex]);
            })
            .join('|');
          if (seenRows.has(rowSignature)) {
            return false;
          }
          seenRows.add(rowSignature);
          return true;
        });
      }

      // Build response with expressions evaluated
      return {
        operation: 'SELECT',
        data: {
          cols: selectItems.map((item, i) => ({
            id: this.indexToColumn(i),
            label: item.label,
            type: item.type === 'expression' ? 'number' : this.inferColumnType(
              matched.map(m => m.rowData[item.columnIndex])
            )
          })),
          rows: matched.map(m => ({
            c: selectItems.map(item => ({
              v: item.type === 'expression' && item.expression
                ? this.evaluateExpression(item.expression, m.rowData)
                : m.rowData[item.columnIndex]
            }))
          }))
        }
      };
    }

    // Simple columns - use faster path
    const selectCols = this.parseSelectColumns(selectStatement, headers, columnMap);

    // Apply DISTINCT - remove duplicate rows based on selected columns
    if (isDistinct) {
      const seenRows = new Set<string>();
      matched = matched.filter(m => {
        const rowSignature = selectCols
          .map(col => JSON.stringify(m.rowData[col.index]))
          .join('|');
        if (seenRows.has(rowSignature)) {
          return false;
        }
        seenRows.add(rowSignature);
        return true;
      });
    }

    // Build response in Google Viz format
    return {
      operation: 'SELECT',
      data: {
        cols: selectCols.map((col, i) => ({
          id: this.indexToColumn(i),
          label: col.label,
          type: this.inferColumnType(matched.map(m => m.rowData[col.index]))
        })),
        rows: matched.map(m => ({
          c: selectCols.map(col => ({
            v: m.rowData[col.index]
          }))
        }))
      }
    };
  }

  /**
   * Execute GROUP BY with aggregate functions
   */
  private executeGroupBy(
    headers: string[],
    matched: MatchedRow[],
    statement: string,
    columnMap: Map<string, string>,
    groupByClause: string,
    havingClause: string | undefined,
    orderByClause: string | undefined,
    limit: number | undefined,
    offset: number | undefined,
    tableAlias?: string
  ): any {
    // Parse GROUP BY columns
    const groupByColNames = groupByClause.split(',').map(c => c.trim());
    const groupByIndices: number[] = [];

    for (const colName of groupByColNames) {
      const resolved = this.resolveVirtualColumnNames(colName, columnMap, tableAlias);
      const index = this.columnToIndex(resolved);
      if (index < headers.length) {
        groupByIndices.push(index);
      } else {
        // Try finding by header name
        const idx = headers.findIndex(h =>
          h.toLowerCase() === colName.toLowerCase() ||
          h.toLowerCase().endsWith(`.${colName.toLowerCase()}`)
        );
        if (idx !== -1) {
          groupByIndices.push(idx);
        }
      }
    }

    // Group rows by key
    const groups = new Map<string, MatchedRow[]>();
    for (const row of matched) {
      const key = groupByIndices.map(i => JSON.stringify(row.rowData[i])).join('|');
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(row);
    }

    // Parse SELECT clause for aggregates
    const selectMatch = statement.match(/SELECT\s+([\s\S]+?)\s+FROM/i);
    const selectClause = selectMatch ? selectMatch[1].trim() : '*';

    // Parse each SELECT item - could be column name or aggregate function
    const selectItems = this.parseAggregateSelectClause(selectClause, headers, columnMap, tableAlias);

    // Build result rows from groups
    let resultRows: Array<{ values: any[] }> = [];

    for (const [_key, groupRows] of groups) {
      const rowValues: any[] = [];

      for (const item of selectItems) {
        if (item.type === 'column') {
          // Use first row's value for grouped column
          rowValues.push(groupRows[0].rowData[item.columnIndex]);
        } else if (item.type === 'aggregate') {
          // Calculate aggregate
          const values = groupRows.map(r => r.rowData[item.columnIndex]);
          rowValues.push(this.calculateAggregate(item.function, values));
        } else if (item.type === 'expression' && item.expression) {
          // Evaluate expression on first row (for grouped queries)
          rowValues.push(this.evaluateExpression(item.expression, groupRows[0].rowData));
        }
      }

      resultRows.push({ values: rowValues });
    }

    // Apply HAVING filter
    if (havingClause) {
      resultRows = this.applyHavingFilter(resultRows, selectItems, havingClause, columnMap);
    }

    // Apply ORDER BY
    if (orderByClause) {
      resultRows = this.sortGroupedResults(resultRows, selectItems, orderByClause, columnMap);
    }

    // Apply OFFSET
    if (offset && offset > 0) {
      resultRows = resultRows.slice(offset);
    }

    // Apply LIMIT
    if (limit !== undefined) {
      resultRows = resultRows.slice(0, limit);
    }

    // Build column labels
    const colLabels = selectItems.map(item => item.label);

    // Build response
    return {
      operation: 'SELECT',
      data: {
        cols: colLabels.map((label, i) => ({
          id: this.indexToColumn(i),
          label,
          type: this.inferColumnType(resultRows.map(r => r.values[i]))
        })),
        rows: resultRows.map(r => ({
          c: r.values.map(v => ({ v }))
        }))
      }
    };
  }

  /**
   * Parse SELECT clause looking for aggregate functions, expressions, and aliases
   */
  private parseAggregateSelectClause(
    selectClause: string,
    headers: string[],
    columnMap: Map<string, string>,
    tableAlias?: string
  ): Array<{
    type: 'column' | 'aggregate' | 'expression';
    label: string;
    index: number;
    columnIndex: number;
    function: string;
    expression?: string;
    expressionColumns?: number[];
  }> {
    const items: Array<{
      type: 'column' | 'aggregate' | 'expression';
      label: string;
      index: number;
      columnIndex: number;
      function: string;
      expression?: string;
      expressionColumns?: number[];
    }> = [];

    // Split by comma, but respect parentheses
    const parts = this.splitSelectClause(selectClause);

    for (const part of parts) {
      let trimmed = part.trim();
      if (!trimmed) continue;

      // Check for AS alias: "expression AS alias" or "column AS alias"
      let alias: string | null = null;
      const aliasMatch = trimmed.match(/^(.+?)\s+AS\s+(\w+)$/i);
      if (aliasMatch) {
        trimmed = aliasMatch[1].trim();
        alias = aliasMatch[2];
      }

      // Check for aggregate function: COUNT(*), SUM(col), AVG(col), MIN(col), MAX(col)
      const aggMatch = trimmed.match(/^(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*(\*|[\w.]+)\s*\)$/i);

      if (aggMatch) {
        const func = aggMatch[1].toUpperCase();
        const colRef = aggMatch[2];
        let columnIndex = 0;

        if (colRef !== '*') {
          const resolved = this.resolveVirtualColumnNames(colRef, columnMap, tableAlias);
          columnIndex = this.columnToIndex(resolved);
          if (columnIndex >= headers.length) {
            // Try finding by header name
            const idx = headers.findIndex(h =>
              h.toLowerCase() === colRef.toLowerCase() ||
              h.toLowerCase().endsWith(`.${colRef.toLowerCase()}`)
            );
            if (idx !== -1) columnIndex = idx;
          }
        }

        items.push({
          type: 'aggregate',
          label: alias || trimmed,
          index: items.length,
          columnIndex,
          function: func
        });
      } else if (this.isExpression(trimmed)) {
        // Expression with arithmetic operators
        const { expression, columns } = this.parseExpression(trimmed, headers, columnMap, tableAlias);
        items.push({
          type: 'expression',
          label: alias || trimmed,
          index: items.length,
          columnIndex: -1,
          function: '',
          expression,
          expressionColumns: columns
        });
      } else {
        // Regular column
        const resolved = this.resolveVirtualColumnNames(trimmed, columnMap, tableAlias);
        let index = this.columnToIndex(resolved);

        if (index >= headers.length) {
          // Try finding by header name
          const idx = headers.findIndex(h =>
            h.toLowerCase() === trimmed.toLowerCase() ||
            h.toLowerCase().endsWith(`.${trimmed.toLowerCase()}`)
          );
          if (idx !== -1) index = idx;
        }

        items.push({
          type: 'column',
          label: alias || (index < headers.length ? headers[index] : trimmed),
          index: items.length,
          columnIndex: index,
          function: ''
        });
      }
    }

    return items;
  }

  /**
   * Check if a select item contains an arithmetic expression
   */
  private isExpression(item: string): boolean {
    // Check each comma-separated part of the select clause
    const parts = this.splitSelectClause(item);

    for (const part of parts) {
      const trimmed = part.trim();

      // Remove AS alias for checking
      const withoutAlias = trimmed.replace(/\s+AS\s+\w+$/i, '').trim();

      // Skip wildcard patterns like s.* or *
      if (withoutAlias === '*' || /^\w+\.\*$/.test(withoutAlias)) {
        continue;
      }

      // Skip aggregate functions
      if (/^(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(withoutAlias)) {
        continue;
      }

      // Skip simple column references (word characters and dots only)
      if (/^[\w.]+$/.test(withoutAlias)) {
        continue;
      }

      // Must contain arithmetic operator not inside a function call
      // Check for: number operator column, column operator number, column operator column
      let depth = 0;
      for (let i = 0; i < withoutAlias.length; i++) {
        const char = withoutAlias[i];
        if (char === '(') depth++;
        else if (char === ')') depth--;
        else if (depth === 0 && ['+', '-', '*', '/'].includes(char)) {
          // Check context: must be between operands (not leading minus)
          const before = withoutAlias.substring(0, i).trim();
          const after = withoutAlias.substring(i + 1).trim();

          // Exclude if before ends with . (wildcard pattern like "alias.*")
          if (before.endsWith('.')) continue;

          // Exclude if no valid operand before (leading minus/operator)
          if (!before) continue;

          // Must have something after the operator
          if (!after) continue;

          // Valid expression detected
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Parse an arithmetic expression and resolve column references
   */
  private parseExpression(
    expr: string,
    headers: string[],
    columnMap: Map<string, string>,
    tableAlias?: string
  ): { expression: string; columns: number[] } {
    const columns: number[] = [];

    // Replace column references with placeholder pattern ${index}
    let resolvedExpr = expr;

    // Match column names (word characters and dots for aliases)
    const colPattern = /([a-zA-Z_][\w.]*)/g;
    let match;
    const replacements: Array<{ original: string; index: number; start: number }> = [];

    while ((match = colPattern.exec(expr)) !== null) {
      const colRef = match[1];
      // Skip if it's a number or already processed
      if (/^\d+$/.test(colRef)) continue;

      const resolved = this.resolveVirtualColumnNames(colRef, columnMap, tableAlias);
      let colIndex = this.columnToIndex(resolved);

      if (colIndex >= headers.length) {
        // Try finding by header name
        const idx = headers.findIndex(h =>
          h.toLowerCase() === colRef.toLowerCase() ||
          h.toLowerCase().endsWith(`.${colRef.toLowerCase()}`)
        );
        if (idx !== -1) colIndex = idx;
      }

      if (colIndex < headers.length) {
        columns.push(colIndex);
        replacements.push({ original: colRef, index: colIndex, start: match.index });
      }
    }

    // Replace in reverse order to preserve positions
    replacements.sort((a, b) => b.start - a.start);
    for (const r of replacements) {
      resolvedExpr = resolvedExpr.substring(0, r.start) +
        `\${row[${r.index}]}` +
        resolvedExpr.substring(r.start + r.original.length);
    }

    return { expression: resolvedExpr, columns };
  }

  /**
   * Evaluate an arithmetic expression for a row
   */
  private evaluateExpression(expression: string, row: any[]): any {
    try {
      // Replace ${row[n]} with actual values
      const evaluated = expression.replace(/\$\{row\[(\d+)\]\}/g, (_, idx) => {
        const val = row[parseInt(idx)];
        if (val === null || val === undefined || val === '') return '0';
        const num = Number(val);
        return isNaN(num) ? '0' : String(num);
      });

      // Safely evaluate the arithmetic expression
      // Only allow numbers, operators, parentheses, and whitespace
      if (!/^[\d\s+\-*/().]+$/.test(evaluated)) {
        return null;
      }

      // Use Function constructor for safe evaluation (no variable access)
      return new Function(`return (${evaluated})`)();
    } catch {
      return null;
    }
  }

  /**
   * Split SELECT clause by comma, respecting parentheses
   */
  private splitSelectClause(clause: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of clause) {
      if (char === '(') {
        depth++;
        current += char;
      } else if (char === ')') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  /**
   * Calculate aggregate function value
   */
  private calculateAggregate(func: string, values: any[]): any {
    // Filter out nulls for most aggregates
    const nonNullValues = values.filter(v => v !== null && v !== undefined && v !== '');

    switch (func) {
      case 'COUNT':
        return values.length; // COUNT(*) counts all rows including nulls

      case 'SUM': {
        const nums = nonNullValues.map(v => Number(v)).filter(n => !isNaN(n));
        return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : null;
      }

      case 'AVG': {
        const nums = nonNullValues.map(v => Number(v)).filter(n => !isNaN(n));
        return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
      }

      case 'MIN': {
        if (nonNullValues.length === 0) return null;
        const nums = nonNullValues.map(v => Number(v)).filter(n => !isNaN(n));
        if (nums.length > 0) {
          return Math.min(...nums);
        }
        // String comparison
        return nonNullValues.sort()[0];
      }

      case 'MAX': {
        if (nonNullValues.length === 0) return null;
        const nums = nonNullValues.map(v => Number(v)).filter(n => !isNaN(n));
        if (nums.length > 0) {
          return Math.max(...nums);
        }
        // String comparison
        return nonNullValues.sort().reverse()[0];
      }

      default:
        return null;
    }
  }

  /**
   * Apply HAVING filter to grouped results
   */
  private applyHavingFilter(
    rows: Array<{ values: any[] }>,
    selectItems: Array<{ type: string; label: string; index: number; columnIndex: number; function: string }>,
    havingClause: string,
    columnMap: Map<string, string>
  ): Array<{ values: any[] }> {
    // Build a column map for the result columns (by label)
    const resultColumnMap = new Map<string, string>();
    selectItems.forEach((item, i) => {
      const colLetter = this.indexToColumn(i);
      resultColumnMap.set(item.label.toLowerCase(), colLetter);
      // Also map function aliases like "COUNT(*)" -> A
      if (item.type === 'aggregate') {
        resultColumnMap.set(item.label.toLowerCase().replace(/\s+/g, ''), colLetter);
      }
    });

    // Replace aggregate function references in HAVING clause with column letters
    let resolvedHaving = havingClause;
    selectItems.forEach((item, i) => {
      if (item.type === 'aggregate') {
        const colLetter = this.indexToColumn(i);
        // Escape special regex characters in the function expression
        const pattern = item.label.replace(/[()]/g, '\\$&').replace(/\*/g, '\\*');
        const regex = new RegExp(pattern, 'gi');
        resolvedHaving = resolvedHaving.replace(regex, colLetter);
      }
    });

    // Parse HAVING clause
    resolvedHaving = this.resolveVirtualColumnNames(resolvedHaving, resultColumnMap);
    const ast = this.parseWhereClause(resolvedHaving);

    return rows.filter(row => {
      return this.evaluateWhere(ast, row.values, resultColumnMap);
    });
  }

  /**
   * Sort grouped results by ORDER BY clause
   */
  private sortGroupedResults(
    rows: Array<{ values: any[] }>,
    selectItems: Array<{ type: string; label: string; index: number; columnIndex: number; function: string }>,
    orderByClause: string,
    columnMap: Map<string, string>
  ): Array<{ values: any[] }> {
    // Build a column map for the result columns
    const resultColumnMap = new Map<string, string>();
    selectItems.forEach((item, i) => {
      const colLetter = this.indexToColumn(i);
      resultColumnMap.set(item.label.toLowerCase(), colLetter);
      if (item.type === 'aggregate') {
        resultColumnMap.set(item.label.toLowerCase().replace(/\s+/g, ''), colLetter);
      }
    });

    // Replace aggregate function references in ORDER BY clause with column letters
    let resolvedOrderBy = orderByClause;
    selectItems.forEach((item, i) => {
      if (item.type === 'aggregate') {
        const colLetter = this.indexToColumn(i);
        // Escape special regex characters in the function expression
        const pattern = item.label.replace(/[()]/g, '\\$&').replace(/\*/g, '\\*');
        const regex = new RegExp(pattern, 'gi');
        resolvedOrderBy = resolvedOrderBy.replace(regex, colLetter);
      }
    });

    const orderBy = this.parseOrderByClause(resolvedOrderBy, resultColumnMap);

    return [...rows].sort((a, b) => {
      for (const term of orderBy) {
        const colIndex = this.columnToIndex(term.column);
        const aVal = a.values[colIndex];
        const bVal = b.values[colIndex];

        // Handle nulls
        if (aVal === null && bVal === null) continue;
        if (aVal === null) return term.direction === 'ASC' ? -1 : 1;
        if (bVal === null) return term.direction === 'ASC' ? 1 : -1;

        // Numeric comparison
        const aNum = Number(aVal);
        const bNum = Number(bVal);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          const cmp = aNum - bNum;
          if (cmp !== 0) return term.direction === 'ASC' ? cmp : -cmp;
          continue;
        }

        // String comparison
        const cmp = String(aVal).localeCompare(String(bVal));
        if (cmp !== 0) return term.direction === 'ASC' ? cmp : -cmp;
      }
      return 0;
    });
  }

  /**
   * Parse SELECT column list
   */
  private parseSelectColumns(
    statement: string,
    headers: string[],
    columnMap: Map<string, string>
  ): Array<{ index: number; label: string }> {
    const selectMatch = statement.match(/SELECT\s+([\s\S]+?)\s+FROM/i);
    if (!selectMatch) {
      // No FROM clause - must be simple virtual query
      const selectOnlyMatch = statement.match(/SELECT\s+([\s\S]+?)(?:\s+WHERE|\s+ORDER|\s+LIMIT|$)/i);
      if (!selectOnlyMatch) {
        // Default to all columns
        return headers.map((h, i) => ({ index: i, label: h }));
      }
      return this.resolveSelectColumns(selectOnlyMatch[1], headers, columnMap);
    }
    return this.resolveSelectColumns(selectMatch[1], headers, columnMap);
  }

  /**
   * Resolve SELECT column references to indices
   */
  private resolveSelectColumns(
    selectClause: string,
    headers: string[],
    columnMap: Map<string, string>
  ): Array<{ index: number; label: string }> {
    const trimmed = selectClause.trim();

    // SELECT * - return all columns
    if (trimmed === '*') {
      return headers.map((h, i) => ({ index: i, label: h }));
    }

    // Parse individual columns
    const columns: Array<{ index: number; label: string }> = [];
    const parts = trimmed.split(',');

    for (const part of parts) {
      const col = part.trim();
      if (!col) continue;

      // Handle alias.* pattern (e.g., s.*)
      const wildcardMatch = col.match(/^(\w+)\.\*$/);
      if (wildcardMatch) {
        const alias = wildcardMatch[1];
        headers.forEach((h, i) => {
          if (h.toLowerCase().startsWith(`${alias.toLowerCase()}.`)) {
            columns.push({ index: i, label: h });
          }
        });
        continue;
      }

      // Try to resolve column name
      const resolved = columnMap.get(col.toLowerCase());
      if (resolved) {
        const index = this.columnToIndex(resolved);
        if (index < headers.length) {
          columns.push({ index, label: headers[index] });
        }
      } else if (/^[A-Z]+$/i.test(col)) {
        // Column letter
        const index = this.columnToIndex(col);
        if (index < headers.length) {
          columns.push({ index, label: headers[index] });
        }
      } else {
        // Try finding by header name
        const index = headers.findIndex(h =>
          h.toLowerCase() === col.toLowerCase() ||
          h.toLowerCase().endsWith(`.${col.toLowerCase()}`)
        );
        if (index !== -1) {
          columns.push({ index, label: headers[index] });
        }
      }
    }

    return columns.length > 0 ? columns : headers.map((h, i) => ({ index: i, label: h }));
  }

  /**
   * Resolve column names for virtual table queries
   * Handles alias.column patterns (e.g., s.Name, :users.id)
   */
  private resolveVirtualColumnNames(
    clause: string,
    columnMap: Map<string, string>,
    tableAlias?: string
  ): string {
    // First, resolve aliased references (e.g., s.Name, v.id, :users.col)
    let resolved = clause.replace(/:?(\w+)\.(\w+)/g, (match, alias, col) => {
      const qualifiedKey = `${alias}.${col}`.toLowerCase();
      const found = columnMap.get(qualifiedKey);
      if (found) return found;

      // Try just the column name
      const colOnly = columnMap.get(col.toLowerCase());
      if (colOnly) return colOnly;

      return match;
    });

    // Then resolve unqualified column names
    resolved = this.resolveColumnNames(resolved, columnMap);

    return resolved;
  }

  /**
   * Infer column type from values
   */
  private inferColumnType(values: any[]): string {
    for (const v of values) {
      if (v === null || v === undefined || v === '') continue;
      if (typeof v === 'number') return 'number';
      if (typeof v === 'boolean') return 'boolean';
      if (v instanceof Date) return 'datetime';
      // Check if string looks like a date
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return 'date';
    }
    return 'string';
  }

  /**
   * Execute UPDATE on virtual table data (returns modified data)
   */
  private executeVirtualUpdate(
    headers: string[],
    rows: any[][],
    statement: string,
    columnMap: Map<string, string>
  ): any {
    const parsed = this.parseUpdateStatement(statement);
    const resolvedWhere = this.resolveVirtualColumnNames(parsed.whereClause, columnMap);

    let ast: ASTNode | null = null;
    if (resolvedWhere.trim().toLowerCase() !== 'true') {
      ast = this.parseWhereClause(resolvedWhere);
    }

    // Parse SET clause
    const resolvedSet = this.resolveVirtualColumnNames(parsed.setClause, columnMap);
    const updates = this.parseSetClause(resolvedSet);

    // Track which rows to update
    let matched: MatchedRow[] = [];
    rows.forEach((row, idx) => {
      const matches = ast === null || this.evaluateWhere(ast, row, columnMap);
      if (matches) {
        matched.push({ rowNumber: idx, rowData: row });
      }
    });

    // Apply ORDER BY if present
    if (parsed.orderByClause) {
      const orderBy = this.parseOrderByClause(parsed.orderByClause, columnMap);
      this.sortRows(matched, orderBy);
    }

    // Apply LIMIT
    if (parsed.limit !== undefined && parsed.limit < matched.length) {
      matched = matched.slice(0, parsed.limit);
    }

    // Create modified rows
    const modifiedRows = rows.map((row, idx) => {
      const isMatched = matched.some(m => m.rowNumber === idx);
      if (isMatched) {
        const newRow = [...row];
        for (const [col, val] of Object.entries(updates)) {
          const colIndex = this.columnToIndex(col);
          if (colIndex < newRow.length) {
            newRow[colIndex] = val;
          }
        }
        return newRow;
      }
      return row;
    });

    return {
      operation: 'UPDATE',
      updatedRows: matched.length,
      data: [headers, ...modifiedRows]  // Return as 2D array with headers
    };
  }

  /**
   * Execute DELETE on virtual table data (returns filtered data)
   */
  private executeVirtualDelete(
    headers: string[],
    rows: any[][],
    statement: string,
    columnMap: Map<string, string>
  ): any {
    const parsed = this.parseDeleteStatement(statement);
    const resolvedWhere = this.resolveVirtualColumnNames(parsed.whereClause, columnMap);

    let ast: ASTNode | null = null;
    if (resolvedWhere.trim().toLowerCase() !== 'true') {
      ast = this.parseWhereClause(resolvedWhere);
    }

    // Track which rows to delete
    let toDelete: MatchedRow[] = [];
    rows.forEach((row, idx) => {
      const matches = ast === null || this.evaluateWhere(ast, row, columnMap);
      if (matches) {
        toDelete.push({ rowNumber: idx, rowData: row });
      }
    });

    // Apply ORDER BY if present
    if (parsed.orderByClause) {
      const orderBy = this.parseOrderByClause(parsed.orderByClause, columnMap);
      this.sortRows(toDelete, orderBy);
    }

    // Apply LIMIT
    if (parsed.limit !== undefined && parsed.limit < toDelete.length) {
      toDelete = toDelete.slice(0, parsed.limit);
    }

    // Create set of indices to delete
    const deleteIndices = new Set(toDelete.map(d => d.rowNumber));

    // Filter out deleted rows
    const remainingRows = rows.filter((_, idx) => !deleteIndices.has(idx));

    return {
      operation: 'DELETE',
      deletedRows: toDelete.length,
      data: [headers, ...remainingRows]  // Return as 2D array with headers
    };
  }
}
