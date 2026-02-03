import { log } from './index';
import { getTableSchemas, getTableColumns, columnExists, findClosestColumn, findClosestColumns, TableSchema } from './schema-introspection';

export interface ColumnValidationResult {
  valid: boolean;
  errors: ColumnValidationError[];
  warnings: ColumnMappingSuggestion[];
}

export interface ColumnValidationError {
  column: string;
  table?: string;
  message: string;
  availableColumns?: string[];
}

export interface ColumnMappingSuggestion {
  originalColumn: string;
  suggestedColumn: string;
  table: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Extract aliases defined in SELECT clause
 * These should not be validated against table columns
 * Handles: explicit AS aliases, implicit aliases, bracketed names
 */
function extractSelectAliases(sql: string): Set<string> {
  const aliases = new Set<string>();
  
  // Remove comments
  let cleanSql = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Extract SELECT clause (use [\s\S] instead of . with s flag for ES2017 compat)
  const selectRegex = /SELECT\s+(TOP\s+\(\d+\)\s+)?([\s\S]*?)\s+FROM/i;
  const selectMatch = cleanSql.match(selectRegex);
  if (selectMatch) {
    const selectClause = selectMatch[2];
    
    // Find explicit "AS AliasName" patterns (with optional brackets/quotes)
    const explicitAliasRegex = /\bAS\s+\[?\"?(\w+)\"?\]?/gi;
    let match;
    while ((match = explicitAliasRegex.exec(selectClause)) !== null) {
      aliases.add(match[1].toLowerCase());
    }
    
    // Find implicit aliases: expression followed by identifier at end of select item
    // Pattern: after closing paren, optional spaces, then identifier (not a keyword)
    const items = selectClause.split(/,(?![^()]*\))/);
    for (const item of items) {
      const trimmed = item.trim();
      // Match: ) followed by space and identifier (implicit alias)
      const implicitMatch = trimmed.match(/\)\s+([a-zA-Z_]\w*)$/);
      if (implicitMatch && !isKeyword(implicitMatch[1])) {
        aliases.add(implicitMatch[1].toLowerCase());
      }
    }
  }
  
  return aliases;
}

/**
 * Extract column references from inside aggregate/function expressions
 */
function extractColumnsFromExpression(expr: string): string[] {
  const columns: string[] = [];
  // Match column names inside functions: SUM([Column]) or AVG(table.Column)
  const columnInFuncRegex = /\[\[?(\w+)\]?\]|\b(?:[\w]+\.)?(\w+)\b/g;
  let match;
  while ((match = columnInFuncRegex.exec(expr)) !== null) {
    const col = match[1] || match[2];
    if (col && !isKeyword(col) && !col.match(/^\d+$/)) {
      columns.push(col);
    }
  }
  return columns;
}

/**
 * Extract column references from SQL
 * This is a simplified parser - handles common patterns
 */
function extractColumnReferences(sql: string): Array<{ column: string; context: string; isAlias?: boolean }> {
  const references: Array<{ column: string; context: string; isAlias?: boolean }> = [];
  
  // Remove comments
  let cleanSql = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Get aliases so we can skip validating them
  const selectAliases = extractSelectAliases(sql);
  
  // Extract columns from SELECT clause (use [\s\S] instead of . with s flag for ES2017 compat)
  const selectRegex = /SELECT\s+(TOP\s+\(\d+\)\s+)?([\s\S]*?)\s+FROM/i;
  const selectMatch = cleanSql.match(selectRegex);
  if (selectMatch) {
    const selectClause = selectMatch[2];
    // Split by comma (outside parentheses)
    const columns = selectClause.split(/,(?![^()]*\))/);
    for (const col of columns) {
      const trimmed = col.trim();
      // Skip if this is an aggregate function or expression with alias
      if (trimmed.match(/^\s*(SUM|COUNT|AVG|MAX|MIN|COALESCE|ISNULL|CASE)\s*\(/i)) {
        continue; // Skip aggregates - they create aliases, not column refs
      }
      // Handle 3-part bracketed notation: [schema].[table].[Column]
      const threePartMatch = trimmed.match(/\[\w+\]\.\[\w+\]\.\[(\w+)\]/i);
      if (threePartMatch && threePartMatch[1] && !isKeyword(threePartMatch[1])) {
        references.push({ column: threePartMatch[1], context: 'SELECT' });
        continue;
      }
      // Handle 3-part mixed notation: [schema].[table].ColumnName (brackets for schema/table, none for column)
      const threePartMixedMatch = trimmed.match(/\[\w+\]\.\[\w+\]\.(\w+)(?:\s+AS\s+\w+)?$/i);
      if (threePartMixedMatch && threePartMixedMatch[1] && !isKeyword(threePartMixedMatch[1])) {
        references.push({ column: threePartMixedMatch[1], context: 'SELECT' });
        continue;
      }
      // Handle 2-part bracketed notation: [alias].[Column] or [Column]
      const bracketMatch = trimmed.match(/(?:\[\w+\]\.)?\[(\w+)\]/i);
      if (bracketMatch && bracketMatch[1] && !isKeyword(bracketMatch[1])) {
        references.push({ column: bracketMatch[1], context: 'SELECT' });
        continue;
      }
      // Handle 3-part dot notation: schema.table.column
      const threePartDotMatch = trimmed.match(/\w+\.\w+\.(\w+)(?:\s+AS\s+\w+)?/i);
      if (threePartDotMatch && threePartDotMatch[1] && !isKeyword(threePartDotMatch[1])) {
        references.push({ column: threePartDotMatch[1], context: 'SELECT' });
        continue;
      }
      // Handle "table.column" or "alias.column" or just "column"
      const match = trimmed.match(/(?:[\w]+\.)?(\w+)(?:\s+AS\s+\w+)?/i);
      if (match && match[1] && !isKeyword(match[1])) {
        references.push({ column: match[1], context: 'SELECT' });
      }
    }
  }
  
  // Extract columns from WHERE clause
  const whereRegex = /WHERE\s+(.*?)(?:ORDER BY|GROUP BY|$)/i;
  const whereMatch = cleanSql.match(whereRegex);
  if (whereMatch) {
    const whereClause = whereMatch[1];
    // Handle 3-part bracketed names: [schema].[table].[column]
    const threePartBracketRegex = /\[\w+\]\.\[\w+\]\.\[(\w+)\]\s*[=<>!]/g;
    let threePartMatch;
    while ((threePartMatch = threePartBracketRegex.exec(whereClause)) !== null) {
      if (threePartMatch[1] && !isKeyword(threePartMatch[1])) {
        references.push({ column: threePartMatch[1], context: 'WHERE' });
      }
    }
    // Handle 3-part mixed notation: [schema].[table].column (brackets for schema/table, none for column)
    const threePartMixedRegex = /\[\w+\]\.\[\w+\]\.(\w+)\s*[=<>!]/g;
    let threePartMixedMatch;
    while ((threePartMixedMatch = threePartMixedRegex.exec(whereClause)) !== null) {
      if (threePartMixedMatch[1] && !isKeyword(threePartMixedMatch[1])) {
        references.push({ column: threePartMixedMatch[1], context: 'WHERE' });
      }
    }
    // Handle 3-part dot notation: schema.table.column
    const threePartDotRegex = /\w+\.\w+\.(\w+)\s*[=<>!]/g;
    let threePartDotMatch;
    while ((threePartDotMatch = threePartDotRegex.exec(whereClause)) !== null) {
      if (threePartDotMatch[1] && !isKeyword(threePartDotMatch[1])) {
        references.push({ column: threePartDotMatch[1], context: 'WHERE' });
      }
    }
    // Match optional table prefix (table.) followed by column name, then comparison operator
    // Skip if already matched by 3-part patterns above
    const columnRegex = /(?<!\.\w+)(?:(\w+)\.)?(\w+)\s*[=<>!]/g;
    let match;
    while ((match = columnRegex.exec(whereClause)) !== null) {
      const columnName = match[2]; // Column name is now in group 2
      if (columnName && !isKeyword(columnName)) {
        // Skip if this looks like a table name (has another dot after)
        references.push({ column: columnName, context: 'WHERE' });
      }
    }
  }
  
  // Extract columns from GROUP BY
  const groupByRegex = /GROUP BY\s+(.*?)(?:ORDER BY|HAVING|$)/i;
  const groupByMatch = cleanSql.match(groupByRegex);
  if (groupByMatch) {
    const groupByClause = groupByMatch[1];
    const columns = groupByClause.split(',');
    for (const col of columns) {
      const trimmed = col.trim();
      // Handle 3-part bracketed notation: [schema].[table].[Column]
      const threePartBracketMatch = trimmed.match(/\[\w+\]\.\[\w+\]\.\[(\w+)\]/i);
      if (threePartBracketMatch && threePartBracketMatch[1] && !isKeyword(threePartBracketMatch[1])) {
        references.push({ column: threePartBracketMatch[1], context: 'GROUP BY' });
        continue;
      }
      // Handle 3-part mixed notation: [schema].[table].ColumnName
      const threePartMixedMatch = trimmed.match(/\[\w+\]\.\[\w+\]\.(\w+)/i);
      if (threePartMixedMatch && threePartMixedMatch[1] && !isKeyword(threePartMixedMatch[1])) {
        references.push({ column: threePartMixedMatch[1], context: 'GROUP BY' });
        continue;
      }
      // Handle 2-part bracketed notation: [alias].[Column]
      const bracketMatch = trimmed.match(/(?:\[\w+\]\.)?\[(\w+)\]/i);
      if (bracketMatch && bracketMatch[1] && !isKeyword(bracketMatch[1])) {
        references.push({ column: bracketMatch[1], context: 'GROUP BY' });
        continue;
      }
      // Handle 3-part dot notation: schema.table.column
      const threePartDotMatch = trimmed.match(/\w+\.\w+\.(\w+)/i);
      if (threePartDotMatch && threePartDotMatch[1] && !isKeyword(threePartDotMatch[1])) {
        references.push({ column: threePartDotMatch[1], context: 'GROUP BY' });
        continue;
      }
      // Handle 2-part dot notation: table.column or just column
      const match = trimmed.match(/(?:[\w]+\.)?(\w+)/i);
      if (match && match[1] && !isKeyword(match[1])) {
        references.push({ column: match[1], context: 'GROUP BY' });
      }
    }
  }
  
  // Extract columns from ORDER BY (skip aliases defined in SELECT)
  const orderByRegex = /ORDER BY\s+(.*?)$/i;
  const orderByMatch = cleanSql.match(orderByRegex);
  if (orderByMatch) {
    const orderByClause = orderByMatch[1];
    const columns = orderByClause.split(',');
    for (const col of columns) {
      const trimmed = col.trim();
      // Handle 3-part bracketed notation: [schema].[table].[Column]
      const threePartBracketMatch = trimmed.match(/\[\w+\]\.\[\w+\]\.\[(\w+)\]/i);
      if (threePartBracketMatch && threePartBracketMatch[1] && !isKeyword(threePartBracketMatch[1])) {
        if (!selectAliases.has(threePartBracketMatch[1].toLowerCase())) {
          references.push({ column: threePartBracketMatch[1], context: 'ORDER BY' });
        }
        continue;
      }
      // Handle 3-part mixed notation: [schema].[table].ColumnName
      const threePartMixedMatch = trimmed.match(/\[\w+\]\.\[\w+\]\.(\w+)(?:\s+(?:ASC|DESC))?$/i);
      if (threePartMixedMatch && threePartMixedMatch[1] && !isKeyword(threePartMixedMatch[1])) {
        if (!selectAliases.has(threePartMixedMatch[1].toLowerCase())) {
          references.push({ column: threePartMixedMatch[1], context: 'ORDER BY' });
        }
        continue;
      }
      // Handle 2-part bracketed notation: [alias].[Column]
      const bracketMatch = trimmed.match(/(?:\[\w+\]\.)?\[(\w+)\]/i);
      if (bracketMatch && bracketMatch[1] && !isKeyword(bracketMatch[1])) {
        if (!selectAliases.has(bracketMatch[1].toLowerCase())) {
          references.push({ column: bracketMatch[1], context: 'ORDER BY' });
        }
        continue;
      }
      // Handle 3-part dot notation: schema.table.column
      const threePartDotMatch = trimmed.match(/\w+\.\w+\.(\w+)(?:\s+(?:ASC|DESC))?$/i);
      if (threePartDotMatch && threePartDotMatch[1] && !isKeyword(threePartDotMatch[1])) {
        if (!selectAliases.has(threePartDotMatch[1].toLowerCase())) {
          references.push({ column: threePartDotMatch[1], context: 'ORDER BY' });
        }
        continue;
      }
      const match = trimmed.match(/(?:[\w]+\.)?(\w+)(?:\s+(?:ASC|DESC))?/i);
      if (match && match[1] && !isKeyword(match[1])) {
        // Skip if this is a SELECT alias
        if (selectAliases.has(match[1].toLowerCase())) {
          continue;
        }
        references.push({ column: match[1], context: 'ORDER BY' });
      }
    }
  }
  
  // Extract columns from JOIN ON conditions
  const joinRegex = /JOIN\s+[\w\[\]\.]+\s+(?:AS\s+)?[\w]*\s*ON\s+(.*?)(?:WHERE|JOIN|GROUP BY|ORDER BY|$)/gi;
  let joinMatch;
  while ((joinMatch = joinRegex.exec(cleanSql)) !== null) {
    const onClause = joinMatch[1];
    // Handle 3-part bracketed names: [schema].[table].[column]
    const threePartBracketRegex = /\[\w+\]\.\[\w+\]\.\[(\w+)\]/g;
    let threePartMatch;
    while ((threePartMatch = threePartBracketRegex.exec(onClause)) !== null) {
      if (threePartMatch[1] && !isKeyword(threePartMatch[1])) {
        references.push({ column: threePartMatch[1], context: 'JOIN ON' });
      }
    }
    // Handle 3-part mixed notation: [schema].[table].column (brackets for schema/table, none for column)
    const threePartMixedRegex = /\[\w+\]\.\[\w+\]\.(\w+)/g;
    let threePartMixedMatch;
    while ((threePartMixedMatch = threePartMixedRegex.exec(onClause)) !== null) {
      if (threePartMixedMatch[1] && !isKeyword(threePartMixedMatch[1])) {
        references.push({ column: threePartMixedMatch[1], context: 'JOIN ON' });
      }
    }
    // Handle 3-part dot notation: schema.table.column
    const threePartDotRegex = /\w+\.\w+\.(\w+)/g;
    let threePartDotMatch;
    while ((threePartDotMatch = threePartDotRegex.exec(onClause)) !== null) {
      if (threePartDotMatch[1] && !isKeyword(threePartDotMatch[1])) {
        references.push({ column: threePartDotMatch[1], context: 'JOIN ON' });
      }
    }
    // Handle 2-part notation: table.column
    const columnRegex = /(?<!\w\.)\b(\w+)\.(\w+)\b(?!\.\w)/g;
    let colMatch;
    while ((colMatch = columnRegex.exec(onClause)) !== null) {
      if (colMatch[2] && !isKeyword(colMatch[2])) {
        references.push({ column: colMatch[2], context: 'JOIN ON' });
      }
    }
  }
  
  return references;
}

/**
 * Check if a word is an SQL keyword
 */
function isKeyword(word: string): boolean {
  const keywords = new Set([
    'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'ON', 'AS',
    'GROUP', 'BY', 'ORDER', 'ASC', 'DESC', 'AND', 'OR', 'NOT', 'IN', 'IS',
    'NULL', 'LIKE', 'BETWEEN', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'CAST', 'CONVERT', 'SUM', 'COUNT', 'AVG', 'MAX', 'MIN', 'DISTINCT', 'TOP',
    'OVER', 'PARTITION', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'WITH', 'CTE',
    // SQL date/time functions
    'DATEPART', 'DATEDIFF', 'DATEADD', 'GETDATE', 'GETUTCDATE', 'SYSDATETIME',
    'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'FORMAT',
    // Other common SQL functions
    'COALESCE', 'ISNULL', 'NULLIF', 'IIF', 'LEN', 'CHARINDEX', 'SUBSTRING',
    'UPPER', 'LOWER', 'TRIM', 'LTRIM', 'RTRIM', 'REPLACE', 'CONCAT', 'ABS', 'ROUND'
  ]);
  return keywords.has(word.toUpperCase());
}

/**
 * Extract table names referenced in SQL
 */
function extractTableReferences(sql: string): string[] {
  const tables: string[] = [];
  
  // FROM clause
  const fromRegex = /FROM\s+\[?(\w+)\]?\.\[?(\w+)\]?/gi;
  let fromMatch;
  while ((fromMatch = fromRegex.exec(sql)) !== null) {
    tables.push(`${fromMatch[1]}.${fromMatch[2]}`);
  }
  
  // JOIN clauses
  const joinRegex = /JOIN\s+\[?(\w+)\]?\.\[?(\w+)\]?/gi;
  let joinMatch;
  while ((joinMatch = joinRegex.exec(sql)) !== null) {
    tables.push(`${joinMatch[1]}.${joinMatch[2]}`);
  }
  
  // Deduplicate
  return Array.from(new Set(tables));
}

/**
 * Validate that all column references in SQL exist in the schema
 */
export async function validateSqlColumns(
  sql: string,
  allowedTables: string[]
): Promise<ColumnValidationResult> {
  const errors: ColumnValidationError[] = [];
  const warnings: ColumnMappingSuggestion[] = [];
  
  try {
    // Get schemas for allowed tables
    const schemas = await getTableSchemas(allowedTables);
    
    // Extract table and column references
    const tableRefs = extractTableReferences(sql);
    const columnRefs = extractColumnReferences(sql);
    
    // Create a map of all available columns across all tables
    const allColumns = new Map<string, string[]>(); // table -> columns
    for (const [tableName, schema] of Array.from(schemas)) {
      allColumns.set(tableName, schema.columns.map(c => c.columnName));
    }
    
    // Validate each column reference
    const checkedColumns = new Set<string>();
    for (const ref of columnRefs) {
      const colKey = `${ref.column}_${ref.context}`;
      if (checkedColumns.has(colKey)) {
        continue; // Skip duplicates
      }
      checkedColumns.add(colKey);
      
      let found = false;
      let foundInTable: string | null = null;
      
      // Check if column exists in any of the referenced tables
      for (const table of tableRefs) {
        if (columnExists(table, ref.column, schemas)) {
          found = true;
          foundInTable = table;
          break;
        }
      }
      
      if (!found) {
        // Column not found - try to find top 5 closest matches via fuzzy matching
        let closestMatches: string[] = [];
        let matchTable: string | null = null;
        
        for (const table of tableRefs) {
          const matches = findClosestColumns(ref.column, table, schemas, 5, 5);
          if (matches.length > 0) {
            closestMatches = matches;
            matchTable = table;
            break;
          }
        }
        
        if (closestMatches.length > 0 && matchTable) {
          // Found close matches - add error with fuzzy suggestions
          errors.push({
            column: ref.column,
            table: matchTable,
            message: `Column '${ref.column}' does not exist in table ${matchTable}`,
            availableColumns: closestMatches
          });
        } else {
          // No close fuzzy match - add error with first 5 columns from table(s)
          const availableColumns: string[] = [];
          for (const table of tableRefs) {
            const cols = getTableColumns(table, schemas);
            if (cols.length > 0) {
              availableColumns.push(...cols);
            }
          }
          
          // Deduplicate and limit to top 5
          const uniqueColumns = Array.from(new Set(availableColumns)).slice(0, 5);
          
          errors.push({
            column: ref.column,
            table: tableRefs.length === 1 ? tableRefs[0] : undefined,
            message: `Column '${ref.column}' does not exist in ${tableRefs.length === 1 ? 'table ' + tableRefs[0] : 'any referenced table'}`,
            availableColumns: uniqueColumns.length > 0 ? uniqueColumns : undefined
          });
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  } catch (error: any) {
    log('sql-column-validator', `Error validating SQL columns: ${error.message}`);
    // If schema fetch fails, allow the query (don't block on validation failure)
    return {
      valid: true,
      errors: [],
      warnings: []
    };
  }
}
