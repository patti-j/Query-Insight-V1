import { log } from './index';
import { getTableSchemas, getTableColumns, columnExists, findClosestColumn, TableSchema } from './schema-introspection';

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
 * Extract column references from SQL
 * This is a simplified parser - handles common patterns
 */
function extractColumnReferences(sql: string): Array<{ column: string; context: string }> {
  const references: Array<{ column: string; context: string }> = [];
  
  // Remove comments
  let cleanSql = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Extract columns from SELECT clause
  const selectRegex = /SELECT\s+(TOP\s+\(\d+\)\s+)?(.*?)\s+FROM/i;
  const selectMatch = cleanSql.match(selectRegex);
  if (selectMatch) {
    const selectClause = selectMatch[2];
    // Split by comma (outside parentheses)
    const columns = selectClause.split(/,(?![^()]*\))/);
    for (const col of columns) {
      const trimmed = col.trim();
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
    const columnRegex = /[\w]+\.?(\w+)\s*[=<>!]/g;
    let match;
    while ((match = columnRegex.exec(whereClause)) !== null) {
      if (match[1] && !isKeyword(match[1])) {
        references.push({ column: match[1], context: 'WHERE' });
      }
    }
  }
  
  // Extract columns from GROUP BY
  const groupByRegex = /GROUP BY\s+(.*?)(?:ORDER BY|$)/i;
  const groupByMatch = cleanSql.match(groupByRegex);
  if (groupByMatch) {
    const groupByClause = groupByMatch[1];
    const columns = groupByClause.split(',');
    for (const col of columns) {
      const trimmed = col.trim();
      const match = trimmed.match(/(?:[\w]+\.)?(\w+)/i);
      if (match && match[1] && !isKeyword(match[1])) {
        references.push({ column: match[1], context: 'GROUP BY' });
      }
    }
  }
  
  // Extract columns from ORDER BY
  const orderByRegex = /ORDER BY\s+(.*?)$/i;
  const orderByMatch = cleanSql.match(orderByRegex);
  if (orderByMatch) {
    const orderByClause = orderByMatch[1];
    const columns = orderByClause.split(',');
    for (const col of columns) {
      const trimmed = col.trim();
      const match = trimmed.match(/(?:[\w]+\.)?(\w+)(?:\s+(?:ASC|DESC))?/i);
      if (match && match[1] && !isKeyword(match[1])) {
        references.push({ column: match[1], context: 'ORDER BY' });
      }
    }
  }
  
  // Extract columns from JOIN ON conditions
  const joinRegex = /JOIN\s+[\w\[\]\.]+\s+(?:AS\s+)?[\w]+\s+ON\s+(.*?)(?:WHERE|JOIN|GROUP BY|ORDER BY|$)/gi;
  let joinMatch;
  while ((joinMatch = joinRegex.exec(cleanSql)) !== null) {
    const onClause = joinMatch[1];
    const columnRegex = /[\w]+\.?(\w+)\s*=/g;
    let colMatch;
    while ((colMatch = columnRegex.exec(onClause)) !== null) {
      if (colMatch[1] && !isKeyword(colMatch[1])) {
        references.push({ column: colMatch[1], context: 'JOIN ON' });
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
    'OVER', 'PARTITION', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'WITH', 'CTE'
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
        // Column not found - try to find a close match
        let bestMatch: string | null = null;
        let matchTable: string | null = null;
        
        for (const table of tableRefs) {
          const match = findClosestColumn(ref.column, table, schemas, 3);
          if (match) {
            bestMatch = match;
            matchTable = table;
            break;
          }
        }
        
        if (bestMatch && matchTable) {
          // Found a close match - suggest it
          warnings.push({
            originalColumn: ref.column,
            suggestedColumn: bestMatch,
            table: matchTable,
            confidence: 'medium'
          });
        } else {
          // No close match - this is an error
          const availableColumns: string[] = [];
          for (const table of tableRefs) {
            const cols = getTableColumns(table, schemas);
            if (cols.length > 0) {
              availableColumns.push(...cols);
            }
          }
          
          // Deduplicate and limit
          const uniqueColumns = Array.from(new Set(availableColumns)).slice(0, 10);
          
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
