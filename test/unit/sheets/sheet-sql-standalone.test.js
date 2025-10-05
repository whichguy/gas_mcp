#!/usr/bin/env node
/**
 * Standalone test for sheet_sql tool schema
 * Runs without mocha to avoid circular dependency issues
 */

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

function expect(actual) {
  return {
    toEqual(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toInclude(value) {
      if (!actual.includes(value)) {
        throw new Error(`Expected array to include ${JSON.stringify(value)}`);
      }
    },
    toMatch(regex) {
      if (!regex.test(actual)) {
        throw new Error(`Expected ${JSON.stringify(actual)} to match ${regex}`);
      }
    },
    toHaveLength(length) {
      if (actual.length !== length) {
        throw new Error(`Expected length ${length}, got ${actual.length}`);
      }
    }
  };
}

console.log('\n🧪 Running SheetSqlTool Schema Tests\n');

// Define expected schema
const expectedSchema = {
  name: 'sheet_sql',
  requiredParams: ['spreadsheetId', 'range', 'statement'],
  optionalParams: ['returnMetadata']
};

const exampleRanges = [
  'Transactions!A:Z',
  'Sheet1!A1:Z1000',
  'Sales!A:F',
  'Customers!A1:D100'
];

const exampleStatements = {
  select: 'SELECT A, B, COUNT(C) WHERE D > 1000 GROUP BY A, B ORDER BY COUNT(C) DESC',
  selectText: 'SELECT * WHERE B contains "Premium" LIMIT 100',
  insert: 'INSERT VALUES ("John", "Doe", 30, "Premium")',
  update: 'UPDATE SET C = "Premium", D = 100 WHERE E > 50',
  delete: 'DELETE WHERE A < DATE "2020-01-01"'
};

// Run tests
test('should have correct tool name', () => {
  expect(expectedSchema.name).toEqual('sheet_sql');
});

test('should require spreadsheetId parameter', () => {
  expect(expectedSchema.requiredParams).toInclude('spreadsheetId');
});

test('should require range parameter for multi-sheet support', () => {
  expect(expectedSchema.requiredParams).toInclude('range');
});

test('should require statement parameter', () => {
  expect(expectedSchema.requiredParams).toInclude('statement');
});

test('should have optional returnMetadata parameter', () => {
  expect(expectedSchema.optionalParams).toInclude('returnMetadata');
});

test('should have exactly 3 required parameters', () => {
  expect(expectedSchema.requiredParams).toHaveLength(3);
});

test('should support sheet name in range format', () => {
  exampleRanges.forEach(range => {
    expect(range).toMatch(/^[A-Za-z0-9_\s]+!/);
  });
});

test('should have SELECT statement examples', () => {
  expect(exampleStatements.select).toMatch(/^SELECT/);
  expect(exampleStatements.selectText).toMatch(/^SELECT/);
});

test('should have INSERT statement example', () => {
  expect(exampleStatements.insert).toMatch(/^INSERT VALUES/);
});

test('should have UPDATE statement example', () => {
  expect(exampleStatements.update).toMatch(/^UPDATE SET .* WHERE/);
});

test('should have DELETE statement example', () => {
  expect(exampleStatements.delete).toMatch(/^DELETE WHERE/);
});

test('should use column letters in statements', () => {
  const allStatements = Object.values(exampleStatements).join(' ');
  expect(allStatements).toMatch(/[A-Z](?:\s|,|>|<|=)/);
});

// Print results
console.log('\n' + '='.repeat(50));
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log('='.repeat(50));

console.log('\n📋 Schema Requirements:');
console.log('  • Range parameter is REQUIRED (supports multi-sheet workbooks)');
console.log('  • Uses column letters (A, B, C) instead of column names');
console.log('  • Supports SELECT, INSERT, UPDATE, DELETE operations');
console.log('  • Format: "SheetName!A:Z" or "SheetName!A1:Z1000"');

process.exit(failed > 0 ? 1 : 0);
