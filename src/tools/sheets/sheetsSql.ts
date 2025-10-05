import { BaseTool } from '../base.js';
import { SessionAuthManager } from '../../auth/sessionManager.js';
import { ValidationError, FileOperationError } from '../../errors/mcpErrors.js';

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
 */
export class SheetSqlTool extends BaseTool {
  public name = 'sheet_sql';
  public description = 'Execute SQL-style operations (SELECT, INSERT, UPDATE, DELETE) on Google Sheets using A1 notation and Google REST APIs';

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
      }
    },
    required: ['spreadsheetId', 'range', 'statement'],
    additionalProperties: false
  };

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
  }

  /**
   * Execute SQL statement on Google Sheet
   */
  async execute(params: any): Promise<any> {
    // 1. Validate inputs
    const spreadsheetId = this.extractSpreadsheetId(params.spreadsheetId);
    const statement = this.validate.string(params.statement, 'statement', 'sheet SQL operation');
    const returnMetadata = this.validate.boolean(params.returnMetadata || false, 'returnMetadata', 'sheet SQL operation');

    // 2. Validate range parameter (now required)
    const range = this.validate.string(params.range, 'range', 'sheet SQL operation');
    this.validateRange(range);

    // 3. Get authentication token
    const accessToken = await this.getAuthToken(params);

    // 4. Parse statement type
    const { operation, sql } = this.parseStatement(statement);

    // 5. Route to appropriate handler
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
          metadata: metadata.sheets?.[0]?.data?.[0]?.rowData || []
        };
      }
    }

    return {
      operation: 'SELECT',
      data: json.table
    };
  }

  /**
   * Execute INSERT VALUES statement using Sheets API append
   */
  private async executeInsert(
    spreadsheetId: string,
    range: string,
    statement: string,
    accessToken: string
  ): Promise<any> {
    // Parse: INSERT VALUES ('x', 'y', 'z') or INSERT INTO range VALUES (...)
    const valuesMatch = statement.match(/VALUES\s*\((.*)\)/i);
    if (!valuesMatch) {
      throw new ValidationError('statement', statement, 'INSERT VALUES (...) syntax');
    }

    // Parse comma-separated values with proper quote handling
    const values = this.parseValues(valuesMatch[1]);

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

    return {
      operation: 'INSERT',
      updatedRange: result.updates.updatedRange,
      updatedRows: result.updates.updatedRows,
      updatedColumns: result.updates.updatedColumns,
      updatedCells: result.updates.updatedCells
    };
  }

  /**
   * Execute UPDATE SET WHERE statement
   * Pattern: SELECT ROW() → compute updates → batch update
   */
  private async executeUpdate(
    spreadsheetId: string,
    range: string,
    statement: string,
    accessToken: string
  ): Promise<any> {
    // Parse: UPDATE SET C = 'value', D = 100 WHERE E > 50
    const setMatch = statement.match(/SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
    if (!setMatch) {
      throw new ValidationError('statement', statement, 'UPDATE SET column = value WHERE condition syntax');
    }

    const setClause = setMatch[1].trim();
    const whereClause = setMatch[2]?.trim();

    // Require WHERE clause to prevent accidental full-sheet updates
    if (!whereClause) {
      throw new ValidationError('statement', statement, 'UPDATE with WHERE clause (use WHERE true to update all rows)');
    }

    // Parse SET clause: "C = 'Premium', D = 100"
    const updates = this.parseSetClause(setClause);

    // Find matching rows using Google Viz API
    const matchingRows = await this.findMatchingRows(spreadsheetId, range, whereClause, accessToken);

    if (matchingRows.length === 0) {
      return {
        operation: 'UPDATE',
        updatedRows: 0,
        message: 'No rows matched WHERE clause'
      };
    }

    // Build batch update requests
    const batchData: any[] = [];
    for (const rowInfo of matchingRows) {
      // Build range for this specific row's cells
      const sheetName = this.extractSheetName(range);
      for (const [column, value] of Object.entries(updates)) {
        const cellRange = `${sheetName}!${column}${rowInfo.rowNumber}`;
        batchData.push({
          range: cellRange,
          values: [[value]]
        });
      }
    }

    // Execute batch update (atomic operation)
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
        data: batchData
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`UPDATE batch operation failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const result = await response.json();

    return {
      operation: 'UPDATE',
      updatedRows: matchingRows.length,
      updatedCells: result.totalUpdatedCells,
      affectedRanges: batchData.map((d: any) => d.range)
    };
  }

  /**
   * Execute DELETE WHERE statement
   * Pattern: SELECT ROW() → reverse sort → batch delete
   */
  private async executeDelete(
    spreadsheetId: string,
    range: string,
    statement: string,
    accessToken: string
  ): Promise<any> {
    // Parse: DELETE WHERE A < DATE '2020-01-01'
    const whereMatch = statement.match(/WHERE\s+(.+)$/i);
    if (!whereMatch) {
      throw new ValidationError('statement', statement, 'DELETE WHERE condition syntax (use WHERE true to delete all rows)');
    }

    const whereClause = whereMatch[1].trim();

    // Find matching rows using Google Viz API
    const matchingRows = await this.findMatchingRows(spreadsheetId, range, whereClause, accessToken);

    if (matchingRows.length === 0) {
      return {
        operation: 'DELETE',
        deletedRows: 0,
        message: 'No rows matched WHERE clause'
      };
    }

    // Get sheet ID for batch delete operations
    const sheetId = await this.getSheetId(spreadsheetId, range, accessToken);

    // Sort rows in reverse order (delete from bottom to top to preserve indices)
    const sortedRows = matchingRows.sort((a, b) => b.rowNumber - a.rowNumber);

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
      rowNumbers: sortedRows.map(r => r.rowNumber)
    };
  }

  /**
   * Find rows matching WHERE clause using Google Visualization Query API
   * Returns array of {rowNumber} objects
   */
  private async findMatchingRows(
    spreadsheetId: string,
    range: string,
    whereClause: string,
    accessToken: string
  ): Promise<Array<{ rowNumber: number }>> {
    // Use ROW() function to get row numbers without downloading data
    const query = `SELECT ROW() WHERE ${whereClause}`;

    const baseUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`;
    const params = new URLSearchParams({
      range: range,
      tq: query,
      tqx: 'out:json'
    });

    const response = await fetch(`${baseUrl}?${params}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`WHERE clause query failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const text = await response.text();
    const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\((.*)\);?$/);
    if (!jsonMatch) {
      throw new Error('Invalid response format from Google Visualization API');
    }

    const json = JSON.parse(jsonMatch[1]);

    if (json.status === 'error') {
      throw new Error(`WHERE clause error: ${json.errors?.map((e: any) => e.detailed_message || e.message).join(', ')}`);
    }

    // Extract row numbers from results
    const rows = json.table?.rows || [];
    return rows.map((row: any) => ({
      rowNumber: row.c?.[0]?.v  // ROW() returns row number in first column
    })).filter((r: any) => r.rowNumber != null);
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

    // String (already unquoted)
    return value;
  }

  /**
   * Parse SET clause into column-value map
   * Example: "C = 'Premium', D = 100" → {C: "Premium", D: 100}
   */
  private parseSetClause(setClause: string): Record<string, any> {
    const updates: Record<string, any> = {};

    // Split by commas (not inside quotes)
    const assignments: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < setClause.length; i++) {
      const char = setClause[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
        current += char;
        continue;
      }

      if (char === quoteChar && inQuotes) {
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

      // Remove quotes if present
      let value: any = valueStr;
      if ((valueStr.startsWith('"') && valueStr.endsWith('"')) ||
          (valueStr.startsWith("'") && valueStr.endsWith("'"))) {
        value = valueStr.slice(1, -1);
      } else {
        value = this.parseValue(valueStr);
      }

      updates[column] = value;
    }

    return updates;
  }
}
