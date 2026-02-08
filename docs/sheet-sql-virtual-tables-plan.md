# Custom Generator-to-Table Pattern for sheet_sql

---

## BUG FIX: String Escaping Consistency ✅ COMPLETED

### Problem
String escaping was inconsistent across SQL clauses. Only `parseSetClause` (UPDATE) handled backslash escapes (`\"`, `\n`, `\t`). Other locations only handled SQL-style doubled quotes.

### Fixed Locations

| Location | Used By | Status |
|----------|---------|--------|
| `parseSetClause()` | UPDATE SET | ✅ FIXED |
| `parseValue()` | INSERT VALUES | ✅ FIXED (added `unescapeString()` call) |
| `readString()` in tokenizer | WHERE clauses | ✅ FIXED (added backslash escape handling) |

### Escape Sequences Supported

| Escape | Result | Example |
|--------|--------|---------|
| `\"` | double quote | `WHERE val = "He said \"Hi\""` |
| `\'` | single quote | `WHERE val = 'It\'s here'` |
| `\\` | backslash | `WHERE path contains "\\"` |
| `\n` | newline | `WHERE code contains "\n"` |
| `\t` | tab | `WHERE data = "col1\tcol2"` |
| `\r` | carriage return | `WHERE text contains "\r\n"` |
| `""` | single quote (SQL-style) | `WHERE val = "say ""hi"""` |

---

## BUG FIX: Escaped Quotes in parseTableReferences() ✅ COMPLETED

### Problem
The string-stripping regex in `parseTableReferences()` doesn't handle escaped quotes (`\"`) inside strings, causing virtual table detection to fail for SQL statements with escaped quotes.

**Location:** `src/tools/sheets/sheetsSql.ts` line 2113

**Current (broken):**
```typescript
const withoutStrings = statement.replace(/'[^']*'|"[^"]*"/g, '""');
```

**Issue:** Given input `'UPDATE SET Content = "a\\tb\\nc\\"d\\\\e" FROM :data WHERE Name = "test"'`
- Regex matches `"a\\tb\\nc\\"` (stops at first unescaped-looking quote)
- Leaves `d\\\\e" FROM :data WHERE Name = "test"` partially exposed
- `:data` may be detected or not depending on the malformed remainder

### Fix: Function-Based Approach

Use a character-by-character function that mirrors the existing `readString()` pattern at line 1322. This is more maintainable, handles all escape styles, and is consistent with the codebase.

**New private method to add (after line ~2140, near other utility methods):**

```typescript
/**
 * Strip string literals from SQL statement for pattern detection
 * Handles: backslash escapes (\", \', \\, \n, \t, \r) and SQL doubled quotes ("", '')
 * Replaces string content with empty placeholder to preserve structure
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
```

**Update parseTableReferences() at line 2113:**

```typescript
// BEFORE:
const withoutStrings = statement.replace(/'[^']*'|"[^"]*"/g, '""');

// AFTER:
const withoutStrings = this.stripStringLiterals(statement);
```

### Why Function > Regex

| Aspect | Regex Approach | Function Approach |
|--------|---------------|-------------------|
| Readability | Complex regex pattern | Clear step-by-step logic |
| Maintainability | Hard to modify | Easy to add cases |
| Consistency | Different from readString() | Mirrors readString() pattern |
| Escape handling | Backslash OR doubled (pick one) | Both styles supported |
| Edge cases | Regex edge cases are subtle | Explicit handling |
| Debugging | Hard to debug | Easy to step through |

### Test Cases

```typescript
describe('stripStringLiterals helper', function() {

  it('should strip simple strings', async function() {
    const result = await client.callTool('sheet_sql', {
      statement: 'SELECT * FROM :data WHERE name = "test"',
      dataSources: { data: [['name'], ['test']] }
    });
    expect(result.success).to.be.true;
  });

  it('should handle escaped quotes in strings', async function() {
    const result = await client.callTool('sheet_sql', {
      statement: 'UPDATE SET Content = "He said \\"Hi\\"" FROM :data WHERE Name = "test"',
      dataSources: { data: [['Name', 'Content'], ['test', 'old']] }
    });
    expect(result.success).to.be.true;
    expect(result.updatedRows).to.equal(1);
    expect(result.data[1][1]).to.equal('He said "Hi"');
  });

  it('should handle SQL doubled quotes', async function() {
    const result = await client.callTool('sheet_sql', {
      statement: 'SELECT * FROM :data WHERE msg = "say ""hello"""',
      dataSources: { data: [['msg'], ['say "hello"']] }
    });
    expect(result.success).to.be.true;
    expect(result.data.rows.length).to.equal(1);
  });

  it('should NOT detect :virtual inside strings', async function() {
    // :fake should NOT be required because it's inside a string
    const result = await client.callTool('sheet_sql', {
      statement: 'SELECT * FROM :real WHERE msg = "mention :fake here"',
      dataSources: { real: [['msg'], ['test']] }
    });
    expect(result.success).to.be.true;
  });

  it('should handle mixed escapes', async function() {
    const result = await client.callTool('sheet_sql', {
      statement: 'SELECT * FROM :data WHERE path = "C:\\\\Users\\\\:notatable"',
      dataSources: { data: [['path'], ['C:\\Users\\:notatable']] }
    });
    expect(result.success).to.be.true;
  });

  it('should handle empty strings', async function() {
    const result = await client.callTool('sheet_sql', {
      statement: 'SELECT * FROM :data WHERE val = ""',
      dataSources: { data: [['val'], ['']] }
    });
    expect(result.success).to.be.true;
  });

  it('should handle string ending with escaped backslash', async function() {
    const result = await client.callTool('sheet_sql', {
      statement: 'SELECT * FROM :data WHERE path = "test\\\\"',
      dataSources: { data: [['path'], ['test\\']] }
    });
    expect(result.success).to.be.true;
  });

  it('should handle single-quoted strings', async function() {
    const result = await client.callTool('sheet_sql', {
      statement: "SELECT * FROM :data WHERE name = 'test'",
      dataSources: { data: [['name'], ['test']] }
    });
    expect(result.success).to.be.true;
  });
});
```

### Implementation Steps

1. **Add `stripStringLiterals()` method** - Insert after line ~2140 (near `parseTableReferences`)
2. **Update `parseTableReferences()`** - Replace regex at line 2113 with method call
3. **Add tests** - Add to `test/integration/sheets/sheet-sql.test.ts` in Virtual Table Operations section
4. **Remove workaround comment** - Delete lines 1551-1552 that mention the regex limitation

### Files to Modify

| File | Change |
|------|--------|
| `src/tools/sheets/sheetsSql.ts` | Add `stripStringLiterals()`, update line 2113 |
| `test/integration/sheets/sheet-sql.test.ts` | Add 8 test cases |

### Verification
```bash
npm run build
npx mocha test/integration/sheets/sheet-sql.test.ts --grep "stripStringLiterals\|escaped quotes" --timeout 60000
```

---

## Escape Character Reference Counting ✅ TESTS ADDED

### How It Works

The current implementation processes escapes **sequentially** - each backslash tries to escape the next character:

```
Input: \\\\n  (5 chars: \, \, \, \, n)
Processing:
  i=0: \ + \ → output \, skip to i=2
  i=2: \ + \ → output \, skip to i=4
  i=4: n → output n (not escape, just literal)
Result: \\n (two backslashes + literal n)
```

### Escape Counting Rules

| SQL Input | JS String | After Unescape | Explanation |
|-----------|-----------|----------------|-------------|
| `\\` | `\` | `\` | One backslash (escape char escaped) |
| `\\\\` | `\\` | `\` | Still one backslash in final output |
| `\n` | newline | newline | Actual newline character |
| `\\n` | `\n` | `\n` | Backslash + literal n (NOT newline) |
| `\\\n` | `\` + newline | `\` + newline | Backslash followed by actual newline |

### Comprehensive Test Matrix for Escape Reference Counting

#### Test Categories

| # | Category | Test Purpose |
|---|----------|--------------|
| 1 | Single escapes | `\n`, `\t`, `\r`, `\"`, `\'` work correctly |
| 2 | Double backslash | `\\` → single backslash |
| 3 | Quad backslash | `\\\\` → two backslashes |
| 4 | Backslash + escape | `\\\n` → backslash + newline |
| 5 | Escaped backslash + literal | `\\n` → backslash + literal 'n' |
| 6 | Mixed sequences | Multiple different escapes in one string |
| 7 | Edge cases | Empty strings, single chars, end-of-string |
| 8 | UPDATE consistency | Same escaping rules in SET clause |
| 9 | INSERT consistency | Same escaping rules in VALUES clause |

---

#### Test 1: Single Escape Sequences

```typescript
it('should handle all single escape sequences', async function() {
  const escapeData = {
    data: [
      ['Name', 'Content'],
      ['Newline', 'line1\nline2'],          // \n
      ['Tab', 'col1\tcol2'],                 // \t
      ['CarriageReturn', 'line1\rline2'],   // \r
      ['DoubleQuote', 'say "hi"'],          // \"
      ['SingleQuote', "it's here"],         // \'
      ['Plain', 'no escapes']
    ]
  };

  // \n - newline
  const nlResult = await client.callTool('sheet_sql', {
    statement: 'SELECT Name FROM :data WHERE Content contains "\\n"',
    dataSources: escapeData
  });
  expect(nlResult.data.rows.length).to.equal(1);
  expect(nlResult.data.rows[0].c[0].v).to.equal('Newline');

  // \t - tab
  const tabResult = await client.callTool('sheet_sql', {
    statement: 'SELECT Name FROM :data WHERE Content contains "\\t"',
    dataSources: escapeData
  });
  expect(tabResult.data.rows.length).to.equal(1);
  expect(tabResult.data.rows[0].c[0].v).to.equal('Tab');

  // \r - carriage return
  const crResult = await client.callTool('sheet_sql', {
    statement: 'SELECT Name FROM :data WHERE Content contains "\\r"',
    dataSources: escapeData
  });
  expect(crResult.data.rows.length).to.equal(1);
  expect(crResult.data.rows[0].c[0].v).to.equal('CarriageReturn');

  // \" - double quote
  const dqResult = await client.callTool('sheet_sql', {
    statement: 'SELECT Name FROM :data WHERE Content contains "\\""',
    dataSources: escapeData
  });
  expect(dqResult.data.rows.length).to.equal(1);
  expect(dqResult.data.rows[0].c[0].v).to.equal('DoubleQuote');
});
```

---

#### Test 2: Double Backslash → Single Backslash

```typescript
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
});
```

---

#### Test 3: Quadruple Backslash → Two Backslashes

```typescript
it('should convert quadruple backslash to two backslashes', async function() {
  const uncData = {
    data: [
      ['Name', 'Path'],
      ['UNC', '\\\\server\\share'],         // Actual: \\server\share
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
});

it('should exact match two consecutive backslashes', async function() {
  const result = await client.callTool('sheet_sql', {
    statement: 'SELECT Name FROM :data WHERE Content = "a\\\\\\\\b"',  // SQL: a\\\\b → a\\b
    dataSources: {
      data: [
        ['Name', 'Content'],
        ['TwoBS', 'a\\\\b'],    // Actual: a\\b (two backslashes)
        ['OneBS', 'a\\b'],      // Actual: a\b (one backslash)
        ['NoBS', 'ab']
      ]
    }
  });
  expect(result.data.rows.length).to.equal(1);
  expect(result.data.rows[0].c[0].v).to.equal('TwoBS');
});
```

---

#### Test 4: Backslash + Escape Sequence

```typescript
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
});

it('should handle backslash followed by tab (\\\\\\t → \\ + tab)', async function() {
  const result = await client.callTool('sheet_sql', {
    statement: 'SELECT Name FROM :data WHERE Content contains "\\\\\\t"',  // SQL: \\\t → \ + tab
    dataSources: {
      data: [
        ['Name', 'Content'],
        ['BSTab', '\\\tmore'],
        ['JustTab', '\tmore'],
        ['JustBS', '\\more']
      ]
    }
  });
  expect(result.data.rows.length).to.equal(1);
  expect(result.data.rows[0].c[0].v).to.equal('BSTab');
});
```

---

#### Test 5: Escaped Backslash + Literal Char (NOT escape)

```typescript
it('should distinguish \\\\n (backslash + n) from \\n (newline)', async function() {
  const data = {
    data: [
      ['Name', 'Content'],
      ['LiteralBSN', '\\n'],     // Actual: backslash + letter n
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
});

it('should distinguish \\\\t (backslash + t) from \\t (tab)', async function() {
  const result = await client.callTool('sheet_sql', {
    statement: 'SELECT Name FROM :data WHERE Content = "\\\\t"',  // SQL: \\t → \t (backslash + t)
    dataSources: {
      data: [
        ['Name', 'Content'],
        ['LiteralBST', '\\t'],   // Actual: backslash + letter t
        ['ActualTab', '\t'],     // Actual tab character
      ]
    }
  });
  expect(result.data.rows.length).to.equal(1);
  expect(result.data.rows[0].c[0].v).to.equal('LiteralBST');
});
```

---

#### Test 6: Mixed Escape Sequences

```typescript
it('should handle multiple different escapes in one string', async function() {
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
});
```

---

#### Test 7: Edge Cases

```typescript
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
});
```

---

#### Test 8: UPDATE Consistency

```typescript
it('should handle escapes in UPDATE SET clause', async function() {
  const result = await client.callTool('sheet_sql', {
    statement: 'UPDATE SET Content = "line1\\nline2\\\\path" FROM :data WHERE Name = "target"',
    dataSources: {
      data: [
        ['Name', 'Content'],
        ['target', 'old']
      ]
    }
  });
  expect(result.updatedRows).to.equal(1);
  expect(result.data[1][1]).to.equal('line1\nline2\\path');
});

it('should UPDATE with all escape types', async function() {
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
});
```

---

### Test File Location

Add to: `test/integration/sheets/sheet-sql.test.ts`
In section: `describe('Virtual Table Operations', ...)`
After existing escape tests

### Verification Commands

```bash
# Run all escape reference counting tests
npm run build
npx mocha test/integration/sheets/sheet-sql.test.ts --grep "backslash|escape" --timeout 60000

# Run specific category
npx mocha test/integration/sheets/sheet-sql.test.ts --grep "quadruple|double backslash" --timeout 60000
```

### Implementation Analysis

Looking at `unescapeString()` (lines 1092-1125):
```typescript
for (let i = 0; i < str.length; i++) {
  if (str[i] === '\\' && i + 1 < str.length) {
    const next = str[i + 1];
    switch (next) {
      case '\\':
        result += next;  // outputs \
        i++;             // skip next char
        break;
      case 'n':
        result += '\n';
        i++;
        break;
      // ...
    }
  } else {
    result += str[i];
  }
}
```

**Current behavior is CORRECT** - sequential processing with `i++` skip handles reference counting properly:
- Each `\\` consumes 2 input chars, outputs 1 backslash
- Remaining chars processed normally
- No issues with consecutive escapes

### Examples of Broken Behavior

```sql
-- INSERT: backslash escapes NOT working
INSERT INTO Sheet1 VALUES ("line1\nline2")  -- Stores literal \n, not newline

-- WHERE: backslash escapes NOT working
SELECT * FROM :data WHERE Code CONTAINS "\n"  -- Looks for literal \n, not newline
SELECT * FROM :data WHERE Name = "He said \"Hi\""  -- Fails to parse
```

### Fix Plan

1. **Add `unescapeString()` call to `parseValues()`** (line 978, 988)
   ```typescript
   values.push(this.unescapeString(this.parseValue(current.trim())));
   ```

2. **Update `readString()` in tokenizer** (lines 1322-1340)
   - Handle backslash escapes in addition to SQL doubled quotes
   - After reading string, apply `unescapeString()`

### Tests Needed

```typescript
// INSERT with special characters
it('should INSERT with escaped quotes and newlines', async function() {
  const result = await tool.execute({
    statement: 'INSERT INTO :data VALUES ("line1\\nline2", "He said \\"Hi\\"")',
    dataSources: { data: [['Col1', 'Col2']] }
  });
  expect(result.data[1][0]).to.include('\n');  // Actual newline
  expect(result.data[1][1]).to.include('"Hi"');  // Actual quotes
});

// WHERE with special characters
it('should WHERE match with escaped characters', async function() {
  const result = await tool.execute({
    statement: 'SELECT * FROM :data WHERE Code CONTAINS "\\n"',
    dataSources: {
      data: [
        ['Name', 'Code'],
        ['Script1', 'line1\nline2'],  // Has actual newline
        ['Script2', 'no newlines']
      ]
    }
  });
  expect(result.data.rows.length).to.equal(1);  // Only Script1
});

// WHERE with escaped quotes
it('should WHERE match escaped quotes', async function() {
  const result = await tool.execute({
    statement: 'SELECT * FROM :data WHERE Val = "He said \\"Hello\\""',
    dataSources: {
      data: [
        ['Name', 'Val'],
        ['Match', 'He said "Hello"'],
        ['NoMatch', 'He said Hello']
      ]
    }
  });
  expect(result.data.rows.length).to.equal(1);
});
```

### Verification
```bash
npm run build
npx mocha test/integration/sheets/sheet-sql.test.ts --grep "escaped" --timeout 60000
```

---

## Goal

Add support for using JavaScript generators/async iterators as virtual table sources in sheet_sql, enabling:
- Querying in-memory data with SQL syntax
- **Joining sheet data with named virtual tables using `:name` syntax**
- Streaming large datasets without loading all into memory

---

## SQL Syntax for Virtual Table References

### Named Virtual Tables (`:name` syntax)

Virtual tables are referenced using `:name` placeholders that bind to the `dataSources` parameter:

```sql
-- Single virtual table
SELECT * FROM :data WHERE Amount > 50

-- JOIN: Sheet + one virtual table
SELECT s.Name, s.Email, scores.value
FROM Sheet1!A:C s
JOIN :scores ON s.A = :scores.id

-- Multiple virtual tables
SELECT s.Name, u.email, p.score
FROM Sheet1!A:C s
JOIN :users u ON s.A = u.id
JOIN :products p ON s.B = p.sku
WHERE u.active = true

-- INSERT from virtual into sheet
INSERT INTO Sheet1!A:C SELECT * FROM :imported
```

### Parameter Binding

```javascript
sheet_sql({
  spreadsheetId: 'xxx',
  statement: `
    SELECT s.Name, u.email, p.score
    FROM Sheet1!A:C AS s
    JOIN :users AS u ON s.A = u.id
    JOIN :products AS p ON s.B = p.sku
  `,
  dataSources: {
    users: [
      ['id', 'email', 'active'],                    // Headers
      ['u1', 'alice@ex.com', true],
      ['u2', 'bob@ex.com', false]
    ],
    products: [
      ['sku', 'name', 'score'],                     // Headers
      ['SKU001', 'Widget', 95],
      ['SKU002', 'Gadget', 87]
    ]
  }
})
```

### Table Aliasing (AS Keyword)

Both sheet ranges and virtual tables support standard SQL `AS` aliasing:

```sql
-- Alias with AS keyword (recommended)
SELECT s.*, sc.value
FROM Sheet1!A:D AS s
LEFT JOIN :userScores AS sc ON s.A = sc.id
WHERE sc.value > 100

-- Alias without AS (also supported)
SELECT s.*, sc.value
FROM Sheet1!A:D s
LEFT JOIN :userScores sc ON s.A = sc.id

-- Use source name directly (when alias not needed)
SELECT s.*, :metrics.computed_value
FROM Sheet1!A:D s
LEFT JOIN :metrics ON s.A = :metrics.key
```

**Key point:** The `dataSources` key name (e.g., `userScores`) is the virtual table's identity, while the SQL alias (e.g., `sc`) is how you reference it in the query. This allows descriptive key names in code while using short aliases in SQL.

---

## Current Architecture

```
sheet_sql(statement)
    → parseStatement()
    → executeUpdate/Delete()
        → findMatchingRowsLocal()
            → FETCH ALL ROWS ← replace with generator
            → evaluateWhere(ast, row)  ← unchanged
            → sortRows() + limit       ← unchanged
        → batchUpdate/Delete()
```

**Key data structure:**
```typescript
interface MatchedRow {
  rowNumber: number;  // 1-based row index
  rowData: any[];     // Array: [colA, colB, colC, ...]
}
```

**Rows are arrays, not objects.** Column A = index 0, B = index 1, etc.

---

## Proposed Design

### New Parameter: `dataSources`

Add optional `dataSources` parameter — a map of named 2D arrays (first row = headers):

```typescript
inputSchema = {
  // existing params...
  dataSources: {
    type: 'object',
    description: 'Named virtual tables referenced as :name in SQL. Each is a 2D array where first row = headers.',
    additionalProperties: {
      type: 'array',
      items: { type: 'array' },
      description: '2D array: [[headers], [row1], [row2], ...]'
    },
    example: {
      users: [
        ['id', 'name', 'email'],              // Headers (row 0)
        ['u1', 'Alice', 'alice@ex.com'],      // Data row 1
        ['u2', 'Bob', 'bob@ex.com']           // Data row 2
      ],
      scores: [
        ['user_id', 'score'],
        ['u1', 95],
        ['u2', 87]
      ]
    }
  }
}
```

**Why 2D array?** Matches spreadsheet data format — generator output is already `[[header], [row], ...]`.

### Usage Examples

**Example 1: Query single virtual table (no sheet)**
```javascript
sheet_sql({
  statement: 'SELECT * FROM :data WHERE Amount > 50 ORDER BY Name',
  dataSources: {
    data: [
      ['Name', 'Amount', 'Status'],     // Headers
      ['Alice', 100, 'active'],
      ['Bob', 30, 'pending'],
      ['Carol', 75, 'active']
    ]
  }
})
// Returns: Alice(100), Carol(75) - sorted by name
```

**Example 2: UPDATE virtual table**
```javascript
sheet_sql({
  statement: 'UPDATE :data SET Status = "done" WHERE Name contains "Al"',
  dataSources: {
    data: generatedRows  // 2D array from your generator: [[headers], [row1], ...]
  }
})
// Returns modified dataset with Alice's status = "done"
```

**Example 3: JOIN sheet with virtual table**
```javascript
sheet_sql({
  spreadsheetId: 'xxx',
  statement: `
    SELECT s.Name, s.Email, sc.value
    FROM Sheet1!A:C AS s
    JOIN :scores AS sc ON s.A = sc.id
  `,
  dataSources: {
    scores: [
      ['id', 'value'],
      ['user1', 95],
      ['user2', 87],
      ['user3', 92]
    ]
  }
})
```

**Example 4: Multiple virtual tables**
```javascript
sheet_sql({
  spreadsheetId: 'xxx',
  statement: `
    SELECT s.Name, u.email, p.rating
    FROM Sheet1!A:C AS s
    JOIN :users AS u ON s.A = u.id
    LEFT JOIN :products AS p ON s.B = p.sku
    WHERE u.active = true
  `,
  dataSources: {
    users: userGenerator(),      // Returns [[headers], [row], ...]
    products: productGenerator()
  }
})
```

---

## Implementation Plan

### Phase 1: Core Virtual Table Support

**File: `src/tools/sheets/sheetsSql.ts`**

#### 1.1 Add `dataSources` to input schema (lines ~120-165)

```typescript
dataSources: {
  type: 'object',
  additionalProperties: {
    type: 'array',
    items: { type: 'array' },
    description: '2D array where first row = headers'
  },
  description: 'Named virtual tables referenced as :name in SQL. Each is a 2D array [[headers], [row1], ...]'
}
```

#### 1.2 Update `execute()` to detect hybrid mode (lines ~295-340)

```typescript
async execute(params: any): Promise<any> {
  const { statement, dataSources, spreadsheetId } = params;

  // Parse FROM clause to detect table references
  const tableRefs = this.parseTableReferences(statement);

  // Pure virtual query (no sheet references)
  if (!spreadsheetId && tableRefs.every(t => t.type === 'virtual')) {
    return this.executeVirtualOnly(params, tableRefs);
  }

  // Hybrid query (sheet + virtual tables via JOIN)
  if (dataSources && tableRefs.some(t => t.type === 'virtual')) {
    return this.executeHybridQuery(params, tableRefs);
  }

  // Existing sheet-only logic...
}
```

#### 1.3 Parse `:name` references from SQL

```typescript
private parseTableReferences(statement: string): TableReference[] {
  const refs: TableReference[] = [];

  // Match :name patterns (virtual tables)
  const virtualPattern = /:(\w+)/g;
  let match;
  while ((match = virtualPattern.exec(statement)) !== null) {
    refs.push({
      type: 'virtual',
      name: match[1],          // "users", "scores", etc.
      source: match[0],        // ":users", ":scores"
      alias: null              // Will be parsed from JOIN clause
    });
  }

  // Match sheet ranges (SheetName!A:Z or just A:Z)
  const sheetPattern = /FROM\s+(['"]?[\w\s]+['"]?!)?([A-Z]+:[A-Z]+|\$[A-Z]+:\$[A-Z]+)/gi;
  while ((match = sheetPattern.exec(statement)) !== null) {
    refs.push({
      type: 'sheet',
      name: null,
      source: match[0].replace(/^FROM\s+/i, ''),
      alias: null
    });
  }

  return refs;
}
```

#### 1.4 Add `executeVirtualOnly()` method

```typescript
private async executeVirtualOnly(
  params: any,
  tableRefs: TableReference[]
): Promise<any> {
  const { statement, dataSources } = params;

  // For single virtual table queries
  if (tableRefs.length === 1) {
    const ref = tableRefs[0];
    const source = dataSources[ref.name];  // 2D array

    if (!source || !Array.isArray(source) || source.length === 0) {
      throw new ValidationError('dataSources', ref.name, 'not found or empty');
    }

    const headers = source[0];       // First row = headers
    const rows = source.slice(1);    // Rest = data rows
    const columnMap = this.buildColumnMap(headers);
    const { operation } = this.parseStatement(statement);

    switch (operation) {
      case 'SELECT':
        return this.executeVirtualSelect(headers, rows, statement, columnMap);
      case 'UPDATE':
        return this.executeVirtualUpdate(headers, rows, statement, columnMap);
      case 'DELETE':
        return this.executeVirtualDelete(headers, rows, statement, columnMap);
    }
  }

  // Multiple virtual tables = JOIN between them
  return this.executeHybridQuery(params, tableRefs);
}
```

#### 1.4 Add `executeVirtualSelect()`

```typescript
private executeVirtualSelect(
  headers: string[],
  rows: any[][],
  statement: string,
  columnMap: Map<string, string>
): any {
  // Parse WHERE clause if present
  const whereMatch = statement.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/i);
  const orderMatch = statement.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|$)/i);
  const limitMatch = statement.match(/LIMIT\s+(\d+)/i);

  let matched: MatchedRow[] = [];

  // Filter rows
  if (whereMatch) {
    const resolvedWhere = this.resolveColumnNames(whereMatch[1], columnMap);
    const ast = this.parseWhereClause(resolvedWhere);

    rows.forEach((row, idx) => {
      if (this.evaluateWhere(ast, row, columnMap)) {
        matched.push({ rowNumber: idx + 1, rowData: row });
      }
    });
  } else {
    matched = rows.map((row, idx) => ({ rowNumber: idx + 1, rowData: row }));
  }

  // Sort
  if (orderMatch) {
    const orderBy = this.parseOrderByClause(orderMatch[1], columnMap);
    this.sortRows(matched, orderBy);
  }

  // Limit
  const limit = limitMatch ? parseInt(limitMatch[1]) : undefined;
  if (limit) matched = matched.slice(0, limit);

  // Format response (match Google Viz format)
  return {
    operation: 'SELECT',
    data: {
      cols: headers.map((h, i) => ({
        id: this.indexToColumn(i),
        label: h,
        type: 'string'
      })),
      rows: matched.map(m => ({
        c: m.rowData.map(v => ({ v }))
      }))
    }
  };
}
```

#### 1.5 Add `executeVirtualUpdate()` and `executeVirtualDelete()`

For UPDATE - return modified rows (in-memory, no persistence):
```typescript
private executeVirtualUpdate(headers, rows, statement, columnMap): any {
  const parsed = this.parseUpdateStatement(statement);
  const resolvedWhere = this.resolveColumnNames(parsed.whereClause, columnMap);
  const ast = this.parseWhereClause(resolvedWhere);

  // Find and update matching rows
  const updates = this.parseSetClause(
    this.resolveColumnNames(parsed.setClause, columnMap)
  );

  let updatedCount = 0;
  const modifiedRows = rows.map((row, idx) => {
    if (this.evaluateWhere(ast, row, columnMap)) {
      updatedCount++;
      const newRow = [...row];
      for (const [col, val] of Object.entries(updates)) {
        newRow[this.columnToIndex(col)] = val;
      }
      return newRow;
    }
    return row;
  });

  return {
    operation: 'UPDATE',
    updatedRows: updatedCount,
    data: { headers, rows: modifiedRows }  // Return modified dataset
  };
}
```

For DELETE - return filtered rows:
```typescript
private executeVirtualDelete(headers, rows, statement, columnMap): any {
  const parsed = this.parseDeleteStatement(statement);
  const resolvedWhere = this.resolveColumnNames(parsed.whereClause, columnMap);
  const ast = this.parseWhereClause(resolvedWhere);

  const remaining = rows.filter((row) => !this.evaluateWhere(ast, row, columnMap));

  return {
    operation: 'DELETE',
    deletedRows: rows.length - remaining.length,
    data: { headers, rows: remaining }  // Return filtered dataset
  };
}
```

---

### Phase 2: FROM Clause Parsing + JOIN Support

#### 2.1 Parse FROM Clause with `:name` References

```typescript
interface TableReference {
  type: 'sheet' | 'virtual';
  name: string | null;   // Virtual table name from dataSources
  source: string;        // Original text: "Sheet1!A:C" or ":users"
  alias?: string;        // Optional alias (s, u, etc.)
}

interface JoinClause {
  type: 'JOIN' | 'LEFT JOIN' | 'RIGHT JOIN';
  table: TableReference;
  on: string;            // ON condition: "s.A = :users.id"
}

private parseFromClause(statement: string): {
  mainTable: TableReference;
  joins: JoinClause[];
} {
  // Match: FROM <table> [AS] [alias] [JOIN <table> [AS] [alias] ON <condition>]...
  // Supports both "FROM Sheet1!A:C AS s" and "FROM Sheet1!A:C s"
  const fromMatch = statement.match(
    /FROM\s+(\S+)(?:\s+(?:AS\s+)?(\w+))?\s*((?:(?:LEFT\s+|RIGHT\s+)?JOIN\s+\S+.*?(?=WHERE|ORDER|LIMIT|$))*)/i
  );

  if (!fromMatch) {
    throw new ValidationError('statement', statement, 'requires FROM clause');
  }

  const mainSource = fromMatch[1];
  const mainAlias = fromMatch[2];
  const joinsPart = fromMatch[3];

  // Detect if source is virtual (:name) or sheet (range)
  const isVirtual = (src: string) => src.startsWith(':');
  const getVirtualName = (src: string) => src.startsWith(':') ? src.slice(1) : null;

  const mainTable: TableReference = {
    type: isVirtual(mainSource) ? 'virtual' : 'sheet',
    name: getVirtualName(mainSource),
    source: mainSource,
    alias: mainAlias
  };

  // Parse JOINs - supports "JOIN :table AS alias" or "JOIN :table alias"
  const joins: JoinClause[] = [];
  const joinRegex = /(LEFT\s+|RIGHT\s+)?JOIN\s+(:?\w+(?:![A-Z]+:[A-Z]+)?)(?:\s+(?:AS\s+)?(\w+))?\s+ON\s+(.+?)(?=(?:LEFT\s+|RIGHT\s+)?JOIN|WHERE|ORDER|LIMIT|$)/gi;
  let joinMatch;

  while ((joinMatch = joinRegex.exec(joinsPart)) !== null) {
    const joinType = joinMatch[1]?.trim().toUpperCase() || '';
    const joinSource = joinMatch[2];

    joins.push({
      type: `${joinType}JOIN`.replace(/\s+/g, ' ').trim() as any,
      table: {
        type: isVirtual(joinSource) ? 'virtual' : 'sheet',
        name: getVirtualName(joinSource),
        source: joinSource,
        alias: joinMatch[3]
      },
      on: joinMatch[4].trim()
    });
  }

  return { mainTable, joins };
}
```

#### 2.2 Execute JOIN

```typescript
private async executeJoin(
  params: any,
  mainTable: TableReference,
  joins: JoinClause[]
): Promise<any> {
  // Load main table data
  const mainData = await this.loadTableData(params, mainTable);

  // Process each JOIN
  let resultRows = mainData.rows.map(row => ({
    sources: { [mainTable.alias || 'main']: row },
    combined: [...row]
  }));

  for (const join of joins) {
    const joinData = await this.loadTableData(params, join.table);
    const alias = join.table.alias || 'joined';

    resultRows = this.performJoin(
      resultRows,
      joinData,
      join.on,
      join.type,
      alias
    );
  }

  return resultRows;
}

private performJoin(
  leftRows: any[],
  rightTable: { headers: string[]; rows: any[][] },
  onCondition: string,
  joinType: string,
  rightAlias: string
): any[] {
  // Parse ON condition: "s.A = v.id"
  const [leftRef, rightRef] = onCondition.split('=').map(s => s.trim());

  const results: any[] = [];

  for (const leftRow of leftRows) {
    let matched = false;

    for (const rightRow of rightTable.rows) {
      if (this.evaluateJoinCondition(leftRow, rightRow, leftRef, rightRef, rightAlias)) {
        matched = true;
        results.push({
          sources: { ...leftRow.sources, [rightAlias]: rightRow },
          combined: [...leftRow.combined, ...rightRow]
        });
      }
    }

    // LEFT JOIN: include unmatched left rows with nulls
    if (!matched && joinType === 'LEFT JOIN') {
      results.push({
        sources: { ...leftRow.sources, [rightAlias]: null },
        combined: [...leftRow.combined, ...new Array(rightTable.headers.length).fill(null)]
      });
    }
  }

  return results;
}

private async loadTableData(
  params: any,
  table: TableReference
): Promise<{ headers: string[]; rows: any[][] }> {
  if (table.type === 'virtual') {
    // Load from dataSources by name - 2D array format
    const source = params.dataSources?.[table.name];
    if (!source || !Array.isArray(source) || source.length === 0) {
      throw new ValidationError(
        'dataSources',
        table.name,
        `Virtual table :${table.name} not found or empty in dataSources`
      );
    }
    // First row = headers, rest = data
    return {
      headers: source[0],
      rows: source.slice(1)
    };
  } else {
    // Load from Google Sheets using existing getDataRange logic
    const range = table.source;
    const data = await this.fetchSheetData(params.spreadsheetId, range);
    return {
      headers: data[0],           // First row = headers
      rows: data.slice(1)         // Remaining rows = data
    };
  }
}
```

#### 2.3 Column Reference Resolution with Aliases

```typescript
// Resolve "s.Name" or "v.score" to actual column index
private resolveAliasedColumn(
  ref: string,
  tableAliases: Map<string, { headers: string[]; startIndex: number }>
): number {
  const [alias, column] = ref.includes('.')
    ? ref.split('.')
    : [null, ref];

  if (alias) {
    const table = tableAliases.get(alias);
    if (!table) throw new Error(`Unknown table alias: ${alias}`);

    const colIndex = table.headers.findIndex(
      h => h.toLowerCase() === column.toLowerCase()
    );
    if (colIndex === -1) {
      // Try column letter (A, B, C...)
      return table.startIndex + this.columnToIndex(column);
    }
    return table.startIndex + colIndex;
  }

  // No alias - search all tables
  // ...
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/tools/sheets/sheetsSql.ts` | Add `dataSources` param, `:name` parsing, FROM clause parsing, JOIN execution, virtual SELECT/UPDATE/DELETE |
| `test/integration/sheets/sheet-sql.test.ts` | Add virtual table tests, JOIN tests, multi-table tests |

---

## Test Cases

```typescript
describe('Virtual Table Operations', function() {
  // 2D array format: first row = headers
  const testData = {
    data: [
      ['Name', 'Amount', 'Status'],   // Headers
      ['Alice', 100, 'active'],
      ['Bob', 30, 'pending'],
      ['Carol', 75, 'active'],
      ['Dave', 50, 'inactive']
    ]
  };

  it('should SELECT from named virtual table', async () => {
    const result = await client.callTool('sheet_sql', {
      statement: 'SELECT * FROM :data WHERE Status = "active"',
      dataSources: testData
    });
    expect(result.data.rows.length).to.equal(2);  // Alice, Carol
  });

  it('should SELECT with ORDER BY and LIMIT', async () => {
    const result = await client.callTool('sheet_sql', {
      statement: 'SELECT * FROM :data ORDER BY Amount DESC LIMIT 2',
      dataSources: testData
    });
    expect(result.data.rows[0].c[0].v).to.equal('Alice');  // 100
    expect(result.data.rows[1].c[0].v).to.equal('Carol');  // 75
  });

  it('should UPDATE virtual table (returns modified data)', async () => {
    const result = await client.callTool('sheet_sql', {
      statement: 'UPDATE :data SET Status = "done" WHERE Amount > 50',
      dataSources: testData
    });
    expect(result.updatedRows).to.equal(2);  // Alice(100), Carol(75)
    expect(result.data[1][2]).to.equal('done');  // 2D array result
  });

  it('should DELETE from virtual table (returns filtered data)', async () => {
    const result = await client.callTool('sheet_sql', {
      statement: 'DELETE FROM :data WHERE Status = "inactive"',
      dataSources: testData
    });
    expect(result.deletedRows).to.equal(1);  // Dave
    expect(result.data.length).to.equal(4);  // Headers + 3 remaining rows
  });

  it('should error on missing virtual table', async () => {
    try {
      await client.callTool('sheet_sql', {
        statement: 'SELECT * FROM :missing',
        dataSources: testData
      });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.message).to.include(':missing not found');
    }
  });
});

describe('JOIN Operations', function() {
  it('should JOIN sheet with virtual table using AS alias', async () => {
    const result = await client.callTool('sheet_sql', {
      spreadsheetId: TEST_SPREADSHEET_ID,
      statement: `
        SELECT s.Name, s.Email, sc.value
        FROM Sheet1!A:C AS s
        JOIN :scores AS sc ON s.A = sc.id
      `,
      dataSources: {
        scores: [
          ['id', 'value'],
          ['id1', 95],
          ['id2', 87]
        ]
      }
    });
    expect(result.data.rows.length).to.be.greaterThan(0);
  });

  it('should LEFT JOIN preserving unmatched rows', async () => {
    const result = await client.callTool('sheet_sql', {
      spreadsheetId: TEST_SPREADSHEET_ID,
      statement: `
        SELECT s.*, ex.bonus
        FROM Sheet1!A:C AS s
        LEFT JOIN :extra AS ex ON s.A = ex.id
      `,
      dataSources: {
        extra: [
          ['id', 'bonus'],
          ['id1', 100]   // Only matches one row
        ]
      }
    });
    // Should have all sheet rows, with null bonus for unmatched
  });

  it('should JOIN multiple virtual tables', async () => {
    const result = await client.callTool('sheet_sql', {
      spreadsheetId: TEST_SPREADSHEET_ID,
      statement: `
        SELECT s.Name, u.email, p.rating
        FROM Sheet1!A:C AS s
        JOIN :users AS u ON s.A = u.id
        JOIN :products AS p ON s.B = p.sku
      `,
      dataSources: {
        users: [
          ['id', 'email'],
          ['u1', 'alice@ex.com'],
          ['u2', 'bob@ex.com']
        ],
        products: [
          ['sku', 'rating'],
          ['SKU1', 5],
          ['SKU2', 4]
        ]
      }
    });
    expect(result.data.rows).to.be.an('array');
  });
});
```

---

## Verification

1. **Build**: `npm run build`

2. **Unit tests**:
   ```bash
   npm test -- --grep "Virtual Table"
   npm test -- --grep "JOIN"
   ```

3. **Manual test - Pure virtual query**:
   ```javascript
   sheet_sql({
     statement: 'SELECT * FROM :data WHERE Amount > 50 ORDER BY Name',
     dataSources: {
       data: [
         ['Name', 'Amount'],        // Headers
         ['Alice', 100],
         ['Bob', 30],
         ['Carol', 75]
       ]
     }
   })
   // Expected: Alice(100), Carol(75)
   ```

4. **Manual test - JOIN sheet with virtual**:
   ```javascript
   sheet_sql({
     spreadsheetId: '<test-sheet-id>',
     statement: `
       SELECT s.Name, sc.value
       FROM Sheet1!A:C AS s
       JOIN :scores AS sc ON s.A = sc.id
     `,
     dataSources: {
       scores: [
         ['id', 'value'],
         ['row1', 95],
         ['row2', 87]
       ]
     }
   })
   ```

5. **Manual test - Multiple virtual tables**:
   ```javascript
   sheet_sql({
     statement: `
       SELECT u.name, p.rating
       FROM :users AS u
       JOIN :products AS p ON u.sku = p.sku
     `,
     dataSources: {
       users: [['name', 'sku'], ['Alice', 'SKU1']],
       products: [['sku', 'rating'], ['SKU1', 5]]
     }
   })
   ```

---

## Complexity Estimate

| Component | Lines | Risk |
|-----------|-------|------|
| Schema update (`dataSources`) | ~25 | Low |
| `parseTableReferences()` | ~40 | Low |
| `parseFromClause()` | ~60 | Medium |
| `executeVirtualOnly()` | ~40 | Low |
| `executeHybridQuery()` | ~50 | Medium |
| `executeJoin()` + `performJoin()` | ~80 | Medium |
| `loadTableData()` | ~30 | Low |
| `resolveAliasedColumn()` | ~40 | Medium |
| `executeVirtualSelect/Update/Delete()` | ~100 | Low |
| Tests | ~150 | Low |
| **Total** | **~615** | **Medium** |

**Reuses existing:** `parseWhereClause`, `evaluateWhere`, `sortRows`, `parseOrderByClause`, `columnToIndex`, `buildColumnMap`, `fetchSheetData`

**New complexity:** JOIN logic with multi-table column resolution

---

## Missing Test Cases (Test Coverage Gap Analysis)

### Critical Gaps (Fundamental Features)

**1. RIGHT JOIN - Not implemented (test should verify behavior)**
```typescript
it('should handle RIGHT JOIN (currently behaves as INNER JOIN)', async function() {
  // NOTE: RIGHT JOIN is parsed but NOT implemented - it behaves as INNER JOIN
  const result = await client.callTool('sheet_sql', {
    statement: `
      SELECT u.name, s.score
      FROM :users AS u
      RIGHT JOIN :scores AS s ON u.id = s.user_id
    `,
    dataSources: {
      users: [['id', 'name'], ['u1', 'Alice'], ['u2', 'Bob']],
      scores: [['user_id', 'score'], ['u1', 95], ['u2', 87], ['u4', 92]]  // u4 unknown
    }
  });
  // Currently returns 2 rows (INNER JOIN behavior) - u4 is excluded
  expect(result.data.rows.length).to.equal(2);
  console.log('⚠️ RIGHT JOIN behaves as INNER JOIN (not fully implemented)');
});
```

**2. Multiple JOINs (3+ tables) - Not tested**
```typescript
it('should handle multiple JOINs (3+ tables)', async function() {
  const result = await client.callTool('sheet_sql', {
    statement: `
      SELECT u.name, o.order_id, p.status
      FROM :users AS u
      JOIN :orders AS o ON u.id = o.user_id
      JOIN :payments AS p ON o.order_id = p.order_id
    `,
    dataSources: {
      users: [['id', 'name'], ['u1', 'Alice']],
      orders: [['user_id', 'order_id'], ['u1', 'o1']],
      payments: [['order_id', 'status'], ['o1', 'paid']]
    }
  });
  expect(result.data.rows.length).to.equal(1);
  expect(result.data.cols.length).to.equal(3);
});
```

**3. Boolean comparisons - Not tested**
```typescript
it('should handle boolean value comparisons', async function() {
  const result = await client.callTool('sheet_sql', {
    statement: 'SELECT Name FROM :data WHERE IsActive = true',
    dataSources: {
      data: [
        ['Name', 'IsActive'],
        ['Alice', true],
        ['Bob', false],
        ['Carol', true]
      ]
    }
  });
  expect(result.data.rows.length).to.equal(2);  // Alice, Carol
});
```

**4. Duplicate column names in JOINs - Not tested**
```typescript
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
});
```

### High Priority Gaps

**5. ENDS WITH operator - Not tested**
```typescript
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
});
```

**6. IS NOT NULL - Not tested**
```typescript
it('should handle IS NOT NULL on virtual table', async function() {
  const result = await client.callTool('sheet_sql', {
    statement: 'SELECT Name FROM :data WHERE Phone is not null',
    dataSources: {
      data: [
        ['Name', 'Phone'],
        ['Alice', '555-1234'],
        ['Bob', null],
        ['Carol', '555-5678']
      ]
    }
  });
  expect(result.data.rows.length).to.equal(2);  // Alice, Carol
});
```

**7. DELETE with ORDER BY + LIMIT on virtual table - Not tested**
```typescript
it('should DELETE with ORDER BY + LIMIT on virtual table', async function() {
  const result = await client.callTool('sheet_sql', {
    statement: 'DELETE FROM :data WHERE Status = "pending" ORDER BY Priority DESC LIMIT 1',
    dataSources: {
      data: [
        ['Name', 'Priority', 'Status'],
        ['Task1', 1, 'pending'],
        ['Task2', 3, 'pending'],  // Highest priority - deleted
        ['Task3', 2, 'pending']
      ]
    }
  });
  expect(result.deletedRows).to.equal(1);
  expect(result.data.length).to.equal(3);  // Headers + 2 remaining
});
```

**8. Large datasets (1000+ rows) - Not stress tested**
```typescript
it('should handle large virtual table with 1000+ rows', async function() {
  this.timeout(30000);
  const rows = [['Id', 'Value', 'Category']];
  for (let i = 1; i <= 1000; i++) {
    rows.push([`id${i}`, Math.random() * 1000, `cat${i % 10}`]);
  }

  const result = await client.callTool('sheet_sql', {
    statement: 'SELECT * FROM :large WHERE Category = "cat5" LIMIT 100',
    dataSources: { large: rows }
  });
  expect(result.data.rows.length).to.be.lte(100);
});
```

### Medium Priority Gaps

**9. JOIN without alias (using :tablename directly)**
```typescript
it('should JOIN without table alias', async function() {
  const result = await client.callTool('sheet_sql', {
    statement: `
      SELECT :users.name, :scores.score
      FROM :users
      JOIN :scores ON :users.id = :scores.user_id
    `,
    dataSources: {
      users: [['id', 'name'], ['u1', 'Alice']],
      scores: [['user_id', 'score'], ['u1', 95]]
    }
  });
  expect(result.data.rows.length).to.equal(1);
});
```

**10. CONTAINS on virtual tables - Not tested**
```typescript
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
});
```

**11. Empty virtual table (headers only)**
```typescript
it('should handle empty virtual table', async function() {
  const result = await client.callTool('sheet_sql', {
    statement: 'SELECT * FROM :data',
    dataSources: {
      data: [['Name', 'Amount']]  // Headers only, no data
    }
  });
  expect(result.data.rows).to.have.length(0);
});
```

### Test Coverage Summary

| Category | Current | Missing | Notes |
|----------|---------|---------|-------|
| RIGHT JOIN | 0% | 1 test | Not implemented - verify INNER JOIN fallback |
| Multiple JOINs (3+) | 0% | 1 test | Important for complex queries |
| Boolean comparisons | 0% | 1 test | Implemented but untested |
| Duplicate columns | 0% | 1 test | Important for JOINs |
| ENDS WITH | 0% | 1 test | Implemented but untested |
| IS NOT NULL | 0% | 1 test | Implemented but untested |
| DELETE ORDER BY+LIMIT | 0% | 1 test | On virtual tables |
| Large datasets | 20% | 1 test | Performance validation |
| JOIN without alias | 0% | 1 test | Edge case |
| CONTAINS (virtual) | 0% | 1 test | Tested on sheets, not virtual |
| Empty table | 50% | 1 test | Edge case |
| **TOTAL** | - | **11 tests** | |

### Verification Commands

```bash
# Run all virtual table tests
npx mocha test/integration/sheets/sheet-sql.test.ts --grep "Virtual Table" --timeout 60000

# Run specific new tests (after adding)
npx mocha test/integration/sheets/sheet-sql.test.ts --grep "RIGHT JOIN|Multiple JOINs|boolean|duplicate" --timeout 60000
```

---

## TODO (Future Enhancements)

### 1. GROUP BY + Aggregators
**Priority:** High | **Complexity:** Medium

Add support for grouping and aggregate functions:
```sql
SELECT Category, COUNT(*), SUM(Amount), AVG(Amount), MIN(Amount), MAX(Amount)
FROM :data
GROUP BY Category
HAVING COUNT(*) > 5
```

**Implementation:**
- Parse GROUP BY clause after WHERE
- Parse HAVING clause for post-aggregation filtering
- Implement aggregator functions: `COUNT()`, `SUM()`, `AVG()`, `MIN()`, `MAX()`, `COUNT(DISTINCT)`
- Group rows by specified columns
- Apply aggregators to each group
- Support `GROUP BY` with JOINs

**Use Cases:**
- Sales summaries by region/product
- User statistics (avg order value, total purchases)
- Data profiling (distinct counts, ranges)

---

### 2. RIGHT JOIN Implementation
**Priority:** Medium | **Complexity:** Low

Currently RIGHT JOIN is parsed but behaves as INNER JOIN. Full implementation needed.

```sql
SELECT u.name, s.score
FROM :users AS u
RIGHT JOIN :scores AS s ON u.id = s.user_id
-- Preserves all scores, even for unknown users
```

**Implementation:**
- Modify `performJoinWithIndices()` to iterate right table first for RIGHT JOIN
- Include unmatched right rows with null left columns
- Similar logic to LEFT JOIN but reversed

---

### 3. INSERT INTO Virtual Table
**Priority:** Low | **Complexity:** Low

Allow appending rows to virtual tables (in-memory modification):
```sql
INSERT INTO :data (Name, Amount) VALUES ('Eve', 200)
-- Returns modified dataset with new row appended
```

**Implementation:**
- Parse INSERT statement for virtual table target
- Validate column names against headers
- Append new row to data array
- Return modified dataset (like UPDATE/DELETE)

**Use Cases:**
- Building datasets programmatically
- Combining data from multiple sources
- Test data generation

---

### 4. Streaming Async Generator Support
**Priority:** Medium | **Complexity:** High

Support async iterators for large datasets without loading all into memory:
```javascript
sheet_sql({
  statement: 'SELECT * FROM :data WHERE Amount > 100',
  dataSources: {
    data: async function* () {
      for await (const batch of fetchDataInBatches()) {
        yield* batch;  // Yield rows one at a time
      }
    }
  }
})
```

**Implementation:**
- Detect generator/async iterator in dataSources
- Stream rows through WHERE filter
- Buffer for ORDER BY (requires full scan)
- Early termination for LIMIT without ORDER BY
- Memory-efficient processing for large datasets

**Use Cases:**
- Processing millions of rows
- Real-time data streams
- Paginated API responses

---

### 5. Persist Virtual Table Updates
**Priority:** Low | **Complexity:** Medium

Option to write UPDATE/DELETE results back to a sheet:
```javascript
sheet_sql({
  statement: 'UPDATE SET Status = "processed" FROM :data WHERE Status = "pending"',
  dataSources: { data: generatedRows },
  persistTo: {
    spreadsheetId: 'xxx',
    range: 'Results!A:D'
  }
})
```

**Implementation:**
- Add `persistTo` parameter with spreadsheet target
- After virtual operation, write results to sheet
- Handle header row (skip or overwrite)
- Batch write for efficiency

**Use Cases:**
- ETL pipelines
- Data transformation and storage
- Batch processing results

---

### 6. Subqueries in WHERE Clause
**Priority:** Low | **Complexity:** High

Support nested SELECT in WHERE conditions:
```sql
SELECT * FROM :orders
WHERE customer_id IN (
  SELECT id FROM :customers WHERE status = 'premium'
)

SELECT * FROM :products
WHERE price > (SELECT AVG(price) FROM :products)
```

**Implementation:**
- Parse subquery in WHERE clause
- Execute inner query first
- Use result in outer query comparison
- Support `IN`, `NOT IN`, `EXISTS`, `NOT EXISTS`
- Support scalar subqueries for comparisons

**Use Cases:**
- Complex filtering based on related data
- Correlated queries
- Dynamic thresholds (avg, max comparisons)

---

### 7. Date Comparison Support
**Priority:** High | **Complexity:** Medium

Full date literal and comparison support:
```sql
SELECT * FROM :data
WHERE TransactionDate > DATE "2025-01-15"
AND TransactionDate <= DATE "2025-01-31"
```

**Implementation:**
- Parse `DATE "YYYY-MM-DD"` literal in tokenizer
- Convert to Date object for comparison
- Handle string dates (ISO format auto-detection)
- Support date functions: `NOW()`, `TODAY()`

**Use Cases:**
- Transaction filtering by date range
- Report generation for specific periods
- Age/duration calculations

---

### 8. DISTINCT Keyword
**Priority:** Medium | **Complexity:** Low

Remove duplicate rows from results:
```sql
SELECT DISTINCT Category FROM :data
SELECT DISTINCT u.name, s.category FROM :users u JOIN :scores s ON ...
```

**Implementation:**
- Parse DISTINCT after SELECT
- Track seen row signatures (hash of selected columns)
- Skip duplicate rows in output

---

### 9. UNION / UNION ALL
**Priority:** Low | **Complexity:** Medium

Combine results from multiple queries:
```sql
SELECT Name, 'Customer' as Type FROM :customers
UNION ALL
SELECT Name, 'Vendor' as Type FROM :vendors
```

**Implementation:**
- Parse UNION/UNION ALL between statements
- Execute each query separately
- Combine results (UNION removes duplicates, UNION ALL keeps all)
- Validate column count matches

---

### 10. Column Expressions and Aliases
**Priority:** Medium | **Complexity:** Medium

Support computed columns and proper aliasing:
```sql
SELECT
  Name,
  Amount * 1.1 AS AmountWithTax,
  UPPER(Status) AS StatusUpper,
  Amount + Bonus AS Total
FROM :data
```

**Implementation:**
- Parse expressions in SELECT clause
- Support basic arithmetic: `+`, `-`, `*`, `/`
- Support string functions: `UPPER()`, `LOWER()`, `CONCAT()`
- Apply AS aliases to output columns

---

### Priority Matrix

| Enhancement | Priority | Complexity | Dependencies | Status |
|-------------|----------|------------|--------------|--------|
| GROUP BY + Aggregators | High | Medium | None | **TO IMPLEMENT** |
| Date Comparisons | High | Medium | None | **TO IMPLEMENT** |
| RIGHT JOIN | Medium | Low | None | **TO IMPLEMENT** |
| DISTINCT | Medium | Low | None | **TO IMPLEMENT** |
| Column Expressions | Medium | Medium | None | **TO IMPLEMENT** |
| Streaming Generators | Medium | High | None | **TO IMPLEMENT** |
| INSERT INTO Virtual | Low | Low | None | Deferred |
| Persist Updates | Low | Medium | None | Deferred |
| Subqueries | Low | High | None | Deferred |
| UNION | Low | Medium | None | Deferred |

---

## Implementation Plan (High + Medium Priority)

### Phase 1: Quick Wins (Low Complexity)
1. **RIGHT JOIN** - Add right table iteration in `performJoinWithIndices()`
2. **DISTINCT** - Add duplicate tracking in `executeVirtualSelect()`

### Phase 2: Date Support (Medium Complexity)
3. **Date Comparisons** - Add DATE literal tokenizer, date parsing, comparison logic

### Phase 3: Aggregations (Medium Complexity)
4. **GROUP BY + Aggregators** - Add GROUP BY parsing, aggregator functions, HAVING clause

### Phase 4: Expressions (Medium Complexity)
5. **Column Expressions** - Add expression parser for SELECT, arithmetic/string functions

### Phase 5: Streaming (High Complexity)
6. **Async Generators** - Add iterator detection, streaming evaluation, memory management

### Files to Modify
- `src/tools/sheets/sheetsSql.ts` - Main implementation
- `test/integration/sheets/sheet-sql.test.ts` - Tests for each feature

### Verification
```bash
# After each phase, run tests
npm run build
npx mocha test/integration/sheets/sheet-sql.test.ts --grep "Virtual Table" --timeout 60000
```
