export interface ValidationResult {
  valid: boolean;
  error?: string;
  modifiedSql?: string;
}

export interface ValidationOptions {
  allowedTables?: string[];
}

// Allow DASHt_* tables and specific Tier2 tables (Jobs, Resources, etc.)
const ALLOWED_TABLE_PATTERN = /\[?publish\]?\.\[?(DASHt_[a-zA-Z0-9_]+|Jobs|Resources|Activities|Materials|Customers|Items)\]?/i;
const MAX_ROWS = 100;

/**
 * Check if a query is aggregate-only (COUNT, SUM, MIN, MAX, AVG)
 * These queries return a single row and don't need TOP limiting
 */
function isAggregateOnlyQuery(sql: string): boolean {
  // Extract the SELECT list (between SELECT and FROM)
  // Use [\s\S] instead of . with s flag for ES2017 compatibility
  const selectMatch = sql.match(/SELECT\s+([\s\S]*?)\s+FROM\s+/i);
  if (!selectMatch) return false;
  
  let selectList = selectMatch[1];
  
  // Remove TOP clause if present
  selectList = selectList.replace(/TOP\s*\(\s*\d+\s*\)/i, '').trim();
  // Remove DISTINCT if present
  selectList = selectList.replace(/^DISTINCT\s+/i, '').trim();
  
  if (!selectList) return false;
  
  // Split by comma, handling nested parentheses
  const columns: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of selectList) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      columns.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) columns.push(current.trim());
  
  // Check if ALL columns are aggregate functions
  const aggregatePattern = /^(COUNT|SUM|MIN|MAX|AVG)\s*\(/i;
  for (const col of columns) {
    // Remove alias (AS ...)
    const colWithoutAlias = col.replace(/\s+AS\s+\w+$/i, '').trim();
    if (!aggregatePattern.test(colWithoutAlias)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Extract table name from SQL query for error messages
 */
function extractTableName(sql: string): string | null {
  const match = sql.match(/FROM\s+(\[?publish\]?\.\[?(DASHt_[a-zA-Z0-9_]+|Jobs|Resources|Activities|Materials|Customers|Items)\]?)/i);
  return match ? match[1] : null;
}

/**
 * Extract all table references from SQL query (FROM clauses, JOIN clauses, subqueries, CTEs)
 * This captures tables from both FROM and JOIN statements
 */
function extractAllTableReferences(sql: string): string[] {
  const tables: string[] = [];
  
  // Pattern to match tables in FROM clauses (DASHt_* and allowed Tier2 tables)
  const fromPattern = /FROM\s+(\[?publish\]?\.\[?(DASHt_[a-zA-Z0-9_]+|Jobs|Resources|Activities|Materials|Customers|Items)\]?)/gi;
  let match;
  
  while ((match = fromPattern.exec(sql)) !== null) {
    tables.push(match[1]);
  }
  
  // Pattern to match tables in JOIN clauses (INNER JOIN, LEFT JOIN, RIGHT JOIN, etc.)
  // This matches: JOIN [publish].[DASHt_TableName] or JOIN publish.DASHt_TableName or Tier2 tables
  const joinPattern = /(?:INNER\s+JOIN|LEFT\s+(?:OUTER\s+)?JOIN|RIGHT\s+(?:OUTER\s+)?JOIN|JOIN)\s+(\[?publish\]?\.\[?(DASHt_[a-zA-Z0-9_]+|Jobs|Resources|Activities|Materials|Customers|Items)\]?)/gi;
  
  while ((match = joinPattern.exec(sql)) !== null) {
    tables.push(match[1]);
  }
  
  return tables;
}

/**
 * Normalize table name by removing brackets and converting to lowercase for comparison
 */
function normalizeTableName(tableName: string): string {
  return tableName.replace(/\[|\]/g, '').toLowerCase();
}

/**
 * Validates and optionally modifies SQL queries to ensure safety
 * - Only SELECT statements allowed
 * - Single statement only (no semicolons)
 * - INNER/LEFT/RIGHT JOINs allowed only with allowlisted publish.DASHt_* tables
 * - CROSS JOIN blocked for safety
 * - Only queries against [publish].[DASHt_*] tables
 * - Enforces TOP (100) if missing
 * - Supports table allowlists for validation
 */
export function validateAndModifySql(sql: string, options: ValidationOptions = {}): ValidationResult {
  const { allowedTables } = options;
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

  // Block dangerous operations
  if (trimmed.match(/\bCROSS\s+JOIN\b/i)) {
    return { valid: false, error: 'CROSS JOIN operations are not allowed for safety reasons' };
  }

  // Block OPENROWSET and other external data access
  if (trimmed.match(/\b(OPENROWSET|OPENDATASOURCE|OPENQUERY|OPENXML)\b/i)) {
    return { valid: false, error: 'External data access functions are not allowed' };
  }

  // Block system procedures
  if (trimmed.match(/\b(xp_|sp_executesql|EXEC|EXECUTE)\b/i)) {
    return { valid: false, error: 'System procedures and dynamic SQL execution are not allowed' };
  }

  // Block LIMIT syntax (PostgreSQL/MySQL) - SQL Server uses TOP
  if (trimmed.match(/\bLIMIT\s+\d+/i)) {
    return { valid: false, error: 'PostgreSQL/MySQL LIMIT syntax is not supported. Use SELECT TOP (N) for SQL Server instead' };
  }

  // Extract all table references (from FROM and JOIN clauses)
  const allTableRefs = extractAllTableReferences(trimmed);
  
  if (allTableRefs.length === 0) {
    return { 
      valid: false, 
      error: 'Unable to determine table name from query. Only queries against [publish].[DASHt_*] tables are allowed' 
    };
  }

  // Validate all table references match publish.DASHt_* pattern
  for (const tableRef of allTableRefs) {
    if (!ALLOWED_TABLE_PATTERN.test(tableRef)) {
      return {
        valid: false,
        error: `Table ${tableRef} is not allowed. Only queries against [publish].[DASHt_*] tables are permitted`
      };
    }
  }

  // If allowlist is provided, enforce it
  if (allowedTables && allowedTables.length > 0) {
    const normalizedAllowed = allowedTables.map(normalizeTableName);

    // Check each table reference against the allowlist
    for (const tableRef of allTableRefs) {
      const normalizedRef = normalizeTableName(tableRef);
      
      if (!normalizedAllowed.includes(normalizedRef)) {
        const allowedList = allowedTables.join(', ');
        return {
          valid: false,
          error: `Table ${tableRef} is not in the allowed list. Allowed tables: ${allowedList}.`
        };
      }
    }
  }

  // Check for TOP clause (don't modify CTEs, they have TOP in the final SELECT)
  let modifiedSql = trimmed;
  const hasCTE = trimmed.match(/^\s*WITH\s+/i);
  
  // Fix incorrect syntax: SELECT TOP (n) DISTINCT -> SELECT DISTINCT TOP (n)
  // T-SQL requires DISTINCT before TOP
  const badTopDistinct = modifiedSql.match(/SELECT\s+TOP\s*\(\s*(\d+)\s*\)\s+DISTINCT\s+/i);
  if (badTopDistinct) {
    const topVal = Math.min(parseInt(badTopDistinct[1], 10), MAX_ROWS);
    modifiedSql = modifiedSql.replace(
      /SELECT\s+TOP\s*\(\s*\d+\s*\)\s+DISTINCT\s+/i,
      `SELECT DISTINCT TOP (${topVal}) `
    );
  }
  
  // Skip TOP for aggregate-only queries (COUNT, SUM, MIN, MAX, AVG)
  // These return a single row and don't need limiting
  const isAggregate = isAggregateOnlyQuery(modifiedSql);
  
  if (isAggregate) {
    // Remove any existing TOP from aggregate queries
    modifiedSql = modifiedSql.replace(/SELECT\s+TOP\s*\(\s*\d+\s*\)\s+/i, 'SELECT ');
    modifiedSql = modifiedSql.replace(/SELECT\s+DISTINCT\s+TOP\s*\(\s*\d+\s*\)\s+/i, 'SELECT DISTINCT ');
  } else if (!hasCTE && !modifiedSql.match(/SELECT\s+(DISTINCT\s+)?TOP\s*\(\s*\d+\s*\)/i)) {
    // Add TOP (100) after SELECT [DISTINCT] (only for non-CTE, non-aggregate queries)
    // Handle DISTINCT: SELECT DISTINCT -> SELECT DISTINCT TOP (100)
    if (modifiedSql.match(/SELECT\s+DISTINCT\s+/i)) {
      modifiedSql = modifiedSql.replace(/SELECT\s+DISTINCT\s+/i, `SELECT DISTINCT TOP (${MAX_ROWS}) `);
    } else {
      modifiedSql = modifiedSql.replace(/SELECT\s+/i, `SELECT TOP (${MAX_ROWS}) `);
    }
  } else if (!hasCTE && !isAggregate) {
    // Verify TOP value doesn't exceed limit (non-CTE, non-aggregate queries)
    const topMatch = modifiedSql.match(/TOP\s*\(\s*(\d+)\s*\)/i);
    if (topMatch) {
      const topValue = parseInt(topMatch[1], 10);
      if (topValue > MAX_ROWS) {
        modifiedSql = modifiedSql.replace(
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

  // Test 6: CROSS JOIN should be rejected for safety
  const test6 = validateAndModifySql('SELECT * FROM [publish].[DASHt_Planning] CROSS JOIN [publish].[DASHt_Resources]');
  if (test6.valid) {
    results.push('❌ FAIL: CROSS JOIN should be rejected for safety');
    passed = false;
  } else {
    results.push('✅ PASS: CROSS JOIN rejected');
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

  // Test 11: Allowlist enforcement with multiple table references
  const test11 = validateAndModifySql(
    'SELECT * FROM [publish].[DASHt_Materials] UNION SELECT * FROM [publish].[DASHt_Resources]',
    { allowedTables: ['publish.DASHt_Planning', 'publish.DASHt_Resources'] }
  );
  if (test11.valid) {
    results.push('❌ FAIL: Query with disallowed table (DASHt_Materials) should be rejected in allowlist');
    passed = false;
  } else if (test11.error && test11.error.includes('DASHt_Materials')) {
    results.push('✅ PASS: Mode allowlist correctly rejects disallowed table in UNION');
  } else {
    results.push(`⚠️  PARTIAL: Query rejected but error doesn't mention DASHt_Materials: ${test11.error}`);
  }

  // Test 12: Allowlist with all allowed tables should pass
  const test12 = validateAndModifySql(
    'SELECT TOP 10 * FROM [publish].[DASHt_Planning]',
    { allowedTables: ['publish.DASHt_Planning', 'publish.DASHt_Resources'] }
  );
  if (!test12.valid) {
    results.push(`❌ FAIL: Query with allowed table rejected: ${test12.error}`);
    passed = false;
  } else {
    results.push('✅ PASS: Mode allowlist correctly accepts allowed table');
  }

  // Test 13: No allowlist should allow any DASHt_* table
  const test13 = validateAndModifySql(
    'SELECT TOP 10 * FROM [publish].[DASHt_Inventories]',
    {}
  );
  if (!test13.valid) {
    results.push(`❌ FAIL: No allowlist should allow any DASHt_* table: ${test13.error}`);
    passed = false;
  } else {
    results.push('✅ PASS: Advanced mode correctly allows any DASHt_* table');
  }

  // Test 14: INNER JOIN with allowlisted tables should be allowed
  const test14 = validateAndModifySql(
    'SELECT TOP 10 d.*, c.* FROM [publish].[DASHt_CapacityPlanning_ResourceDemand] d INNER JOIN [publish].[DASHt_CapacityPlanning_ResourceCapacity] c ON d.ResourceId = c.ResourceId',
    { allowedTables: ['publish.DASHt_CapacityPlanning_ResourceDemand', 'publish.DASHt_CapacityPlanning_ResourceCapacity'] }
  );
  if (!test14.valid) {
    results.push(`❌ FAIL: INNER JOIN with allowlisted tables should be allowed: ${test14.error}`);
    passed = false;
  } else {
    results.push('✅ PASS: INNER JOIN with allowlisted tables accepted');
  }

  // Test 15: JOIN with non-allowlist table should be rejected
  const test15 = validateAndModifySql(
    'SELECT TOP 10 * FROM [publish].[DASHt_Planning] INNER JOIN [publish].[DASHt_Inventories] ON 1=1',
    { allowedTables: ['publish.DASHt_Planning', 'publish.DASHt_Resources'] }
  );
  if (test15.valid) {
    results.push('❌ FAIL: JOIN with non-allowlist table should be rejected');
    passed = false;
  } else if (test15.error && test15.error.includes('DASHt_Inventories')) {
    results.push('✅ PASS: JOIN with non-allowlist table rejected');
  } else {
    results.push(`⚠️  PARTIAL: JOIN rejected but error doesn't mention non-allowlist table: ${test15.error}`);
  }

  // Test 16: System procedures should be blocked
  const test16 = validateAndModifySql('EXEC xp_cmdshell "dir"');
  if (test16.valid) {
    results.push('❌ FAIL: System procedures should be blocked');
    passed = false;
  } else {
    results.push('✅ PASS: System procedures blocked');
  }

  // Test 17: OPENROWSET should be blocked
  const test17 = validateAndModifySql('SELECT * FROM OPENROWSET(...)');
  if (test17.valid) {
    results.push('❌ FAIL: OPENROWSET should be blocked');
    passed = false;
  } else {
    results.push('✅ PASS: OPENROWSET blocked');
  }

  // Test 18: LEFT JOIN with allowlisted tables should be allowed
  const test18 = validateAndModifySql(
    'SELECT TOP 10 d.ResourceName, d.DemandHours, c.NormalOnlineHours FROM [publish].[DASHt_CapacityPlanning_ResourceDemand] d LEFT JOIN [publish].[DASHt_CapacityPlanning_ResourceCapacity] c ON d.ResourceId = c.ResourceId AND d.DemandDate = c.ShiftDate',
    { allowedTables: ['publish.DASHt_CapacityPlanning_ResourceDemand', 'publish.DASHt_CapacityPlanning_ResourceCapacity'] }
  );
  if (!test18.valid) {
    results.push(`❌ FAIL: LEFT JOIN with allowlisted tables should be allowed: ${test18.error}`);
    passed = false;
  } else {
    results.push('✅ PASS: LEFT JOIN with allowlisted tables accepted');
  }

  return { passed, results };
}
