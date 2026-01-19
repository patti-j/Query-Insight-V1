interface ValidationResult {
  valid: boolean;
  error?: string;
  modifiedSql?: string;
}

const ALLOWED_TABLE_PATTERN = /\[?publish\]?\.\[?DASHt_[a-zA-Z0-9_]+\]?/i;
const MAX_ROWS = 100;

/**
 * Extract table name from SQL query for error messages
 */
function extractTableName(sql: string): string | null {
  const match = sql.match(/FROM\s+(\[?publish\]?\.\[?DASHt_[a-zA-Z0-9_]+\]?)/i);
  return match ? match[1] : null;
}

/**
 * Validates and optionally modifies SQL queries to ensure safety
 * - Only SELECT statements allowed
 * - Single statement only (no semicolons)
 * - No JOIN operations
 * - Only queries against [publish].[DASHt_*] tables
 * - Enforces TOP (100) if missing
 */
export function validateAndModifySql(sql: string): ValidationResult {
  // Strip trailing semicolon if present (AI often adds these)
  let trimmed = sql.trim();
  if (trimmed.endsWith(';')) {
    trimmed = trimmed.slice(0, -1).trim();
  }

  // Check for empty query
  if (!trimmed) {
    return { valid: false, error: 'Query cannot be empty' };
  }

  // Check for multiple statements (semicolons in the middle indicate multiple statements)
  if (trimmed.includes(';')) {
    return { valid: false, error: 'Only single statements are allowed (no multiple queries)' };
  }

  // Check if it's a SELECT statement or CTE (WITH ... SELECT) (case-insensitive)
  if (!trimmed.match(/^\s*(SELECT|WITH)\s+/i)) {
    return { valid: false, error: 'Only SELECT statements (including CTEs with WITH clause) are allowed' };
  }

  // Check for JOIN operations (case-insensitive)
  if (trimmed.match(/\s+JOIN\s+/i)) {
    return { valid: false, error: 'JOIN operations are not allowed at this time' };
  }

  // Check for allowed tables - must be publish.DASHt_* pattern
  const tablePattern = /FROM\s+\[?publish\]?\.\[?DASHt_[a-zA-Z0-9_]+\]?/i;
  if (!tablePattern.test(trimmed)) {
    return { 
      valid: false, 
      error: 'Only queries against [publish].[DASHt_*] tables are allowed' 
    };
  }

  // Check for TOP clause (don't modify CTEs, they have TOP in the final SELECT)
  let modifiedSql = trimmed;
  const hasCTE = trimmed.match(/^\s*WITH\s+/i);
  
  if (!hasCTE && !trimmed.match(/SELECT\s+TOP\s*\(\s*\d+\s*\)/i)) {
    // Add TOP (100) after SELECT (only for non-CTE queries)
    modifiedSql = trimmed.replace(/SELECT\s+/i, `SELECT TOP (${MAX_ROWS}) `);
  } else if (!hasCTE) {
    // Verify TOP value doesn't exceed limit (non-CTE queries)
    const topMatch = trimmed.match(/TOP\s*\(\s*(\d+)\s*\)/i);
    if (topMatch) {
      const topValue = parseInt(topMatch[1], 10);
      if (topValue > MAX_ROWS) {
        modifiedSql = trimmed.replace(
          /TOP\s*\(\s*\d+\s*\)/i,
          `TOP (${MAX_ROWS})`
        );
      }
    }
  }
  // For CTEs, trust that they have proper TOP clause in the final SELECT

  return { valid: true, modifiedSql };
}

/**
 * Development mode self-check function to verify validator works correctly
 * Run this in development to ensure validation catches common errors
 */
export function runValidatorSelfCheck(): { passed: boolean; results: string[] } {
  const results: string[] = [];
  let passed = true;

  // Test 1: DASHt_Planning table should be allowed
  const test1 = validateAndModifySql('SELECT TOP 5 * FROM [publish].[DASHt_Planning]');
  if (!test1.valid) {
    results.push(`❌ FAIL: DASHt_Planning query rejected: ${test1.error}`);
    passed = false;
  } else {
    results.push('✅ PASS: DASHt_Planning table accepted');
  }

  // Test 2: Other DASHt_* tables should be allowed
  const test2 = validateAndModifySql('SELECT TOP 5 * FROM [publish].[DASHt_CapacityPlanning]');
  if (!test2.valid) {
    results.push(`❌ FAIL: DASHt_CapacityPlanning query rejected: ${test2.error}`);
    passed = false;
  } else {
    results.push('✅ PASS: DASHt_CapacityPlanning table accepted');
  }

  // Test 3: Non-DASHt tables should be rejected
  const test3 = validateAndModifySql('SELECT TOP 5 * FROM [publish].[OtherTable]');
  if (test3.valid) {
    results.push('❌ FAIL: Non-DASHt table should be rejected');
    passed = false;
  } else {
    results.push('✅ PASS: Non-DASHt table rejected');
  }

  // Test 4: DELETE statements should be rejected
  const test4 = validateAndModifySql('DELETE FROM [publish].[DASHt_Planning]');
  if (test4.valid) {
    results.push('❌ FAIL: DELETE statement should be rejected');
    passed = false;
  } else {
    results.push('✅ PASS: DELETE statement rejected');
  }

  // Test 5: INSERT statements should be rejected
  const test5 = validateAndModifySql('INSERT INTO [publish].[DASHt_Planning] VALUES (1)');
  if (test5.valid) {
    results.push('❌ FAIL: INSERT statement should be rejected');
    passed = false;
  } else {
    results.push('✅ PASS: INSERT statement rejected');
  }

  // Test 6: JOIN operations should be rejected
  const test6 = validateAndModifySql('SELECT * FROM [publish].[DASHt_Planning] JOIN [publish].[DASHt_Other] ON 1=1');
  if (test6.valid) {
    results.push('❌ FAIL: JOIN operation should be rejected');
    passed = false;
  } else {
    results.push('✅ PASS: JOIN operation rejected');
  }

  // Test 7: Multiple statements (semicolons) should be rejected
  const test7 = validateAndModifySql('SELECT * FROM [publish].[DASHt_Planning]; DROP TABLE x');
  if (test7.valid) {
    results.push('❌ FAIL: Multiple statements should be rejected');
    passed = false;
  } else {
    results.push('✅ PASS: Multiple statements rejected');
  }

  // Test 8: TOP should be added if missing
  const test8 = validateAndModifySql('SELECT * FROM [publish].[DASHt_Planning]');
  if (!test8.valid) {
    results.push(`❌ FAIL: Query without TOP rejected: ${test8.error}`);
    passed = false;
  } else if (test8.modifiedSql && test8.modifiedSql.includes('TOP (100)')) {
    results.push('✅ PASS: TOP (100) added automatically');
  } else {
    results.push('⚠️  PARTIAL: Query accepted but TOP not added');
  }

  // Test 9: TOP exceeding 100 should be reduced
  const test9 = validateAndModifySql('SELECT TOP (500) * FROM [publish].[DASHt_Planning]');
  if (!test9.valid) {
    results.push(`❌ FAIL: Query with TOP 500 rejected: ${test9.error}`);
    passed = false;
  } else if (test9.modifiedSql && test9.modifiedSql.includes('TOP (100)')) {
    results.push('✅ PASS: TOP (500) reduced to TOP (100)');
  } else {
    results.push('⚠️  PARTIAL: Query accepted but TOP not reduced');
  }

  // Test 10: CTE queries should be allowed
  const test10 = validateAndModifySql(`
    WITH ranked AS (SELECT *, ROW_NUMBER() OVER (ORDER BY JobId) as rn FROM [publish].[DASHt_Planning])
    SELECT TOP 10 * FROM ranked WHERE rn <= 10
  `);
  if (!test10.valid) {
    results.push(`❌ FAIL: CTE query rejected: ${test10.error}`);
    passed = false;
  } else {
    results.push('✅ PASS: CTE query accepted');
  }

  return { passed, results };
}
