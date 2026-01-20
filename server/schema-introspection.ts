import { executeQuery } from './db-azure';
import { log } from './index';

/**
 * Schema metadata for a single table
 */
export interface TableSchema {
  tableName: string;
  columns: ColumnMetadata[];
}

export interface ColumnMetadata {
  columnName: string;
  dataType: string;
  isNullable: boolean;
}

/**
 * Schema cache entry with TTL
 */
interface SchemaCacheEntry {
  data: Map<string, TableSchema>;
  timestamp: number;
}

// In-memory cache with 10-minute TTL
const SCHEMA_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let schemaCache: SchemaCacheEntry | null = null;

/**
 * Query INFORMATION_SCHEMA.COLUMNS for the given tables
 */
async function fetchSchemaFromDatabase(tableNames: string[]): Promise<Map<string, TableSchema>> {
  const tableSchemas = new Map<string, TableSchema>();
  
  if (tableNames.length === 0) {
    return tableSchemas;
  }

  // Parse schema and table names
  const tableFilters = tableNames.map(fullName => {
    const parts = fullName.split('.');
    if (parts.length !== 2) {
      throw new Error(`Invalid table name format: ${fullName}. Expected format: schema.table`);
    }
    return {
      schema: parts[0],
      table: parts[1],
      fullName
    };
  });

  // Build WHERE clause for multiple tables
  const whereConditions = tableFilters.map(t => 
    `(TABLE_SCHEMA = '${t.schema}' AND TABLE_NAME = '${t.table}')`
  ).join(' OR ');

  const query = `
    SELECT 
      TABLE_SCHEMA,
      TABLE_NAME,
      COLUMN_NAME,
      DATA_TYPE,
      IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE ${whereConditions}
    ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
  `;

  try {
    const result = await executeQuery(query);
    
    // Group columns by table
    for (const row of result.recordset) {
      const fullTableName = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
      
      if (!tableSchemas.has(fullTableName)) {
        tableSchemas.set(fullTableName, {
          tableName: fullTableName,
          columns: []
        });
      }
      
      tableSchemas.get(fullTableName)!.columns.push({
        columnName: row.COLUMN_NAME,
        dataType: row.DATA_TYPE,
        isNullable: row.IS_NULLABLE === 'YES'
      });
    }

    // Log results
    log('schema-introspection', `Fetched schema for ${tableSchemas.size} tables with ${result.recordset.length} total columns`);
    
    return tableSchemas;
  } catch (error) {
    log('schema-introspection', `Error fetching schema: ${error}`);
    throw error;
  }
}

/**
 * Get schema for the given tables, using cache if available
 */
export async function getTableSchemas(tableNames: string[]): Promise<Map<string, TableSchema>> {
  const now = Date.now();
  
  // Check if cache is valid
  if (schemaCache && (now - schemaCache.timestamp) < SCHEMA_CACHE_TTL_MS) {
    log('schema-introspection', `Using cached schema (age: ${Math.round((now - schemaCache.timestamp) / 1000)}s)`);
    return schemaCache.data;
  }

  // Fetch fresh data
  log('schema-introspection', `Cache miss or expired. Fetching schema for ${tableNames.length} tables...`);
  const schemas = await fetchSchemaFromDatabase(tableNames);
  
  // Update cache
  schemaCache = {
    data: schemas,
    timestamp: now
  };
  
  return schemas;
}

/**
 * Get schemas for all tables in a given mode
 */
export async function getSchemasForMode(mode: string, allowedTables: string[]): Promise<Map<string, TableSchema>> {
  return getTableSchemas(allowedTables);
}

/**
 * Format schema as a human-readable string for OpenAI prompts
 */
export function formatSchemaForPrompt(schemas: Map<string, TableSchema>): string {
  const lines: string[] = [];
  
  for (const [tableName, schema] of Array.from(schemas)) {
    lines.push(`\n${tableName}:`);
    const columnList = schema.columns.map((c: ColumnMetadata) => c.columnName).join(', ');
    lines.push(`  Columns: ${columnList}`);
  }
  
  return lines.join('\n');
}

/**
 * Clear the schema cache (useful for testing)
 */
export function clearSchemaCache(): void {
  schemaCache = null;
  log('schema-introspection', 'Schema cache cleared');
}

/**
 * Prefetch schemas for all modes on startup
 */
export async function prefetchAllModeSchemas(catalogPath: string): Promise<void> {
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  
  try {
    const catalogContent = readFileSync(catalogPath, 'utf-8');
    const catalog = JSON.parse(catalogContent);
    
    const allTables = new Set<string>();
    for (const mode of catalog.modes) {
      for (const table of mode.tables) {
        allTables.add(table);
      }
    }
    
    const tableList = Array.from(allTables);
    log('schema-introspection', `Prefetching schemas for ${tableList.length} unique tables across all modes...`);
    
    await getTableSchemas(tableList);
    log('schema-introspection', `Schema prefetch completed successfully`);
  } catch (error: any) {
    log('schema-introspection', `Schema prefetch failed: ${error.message}`);
    throw error;
  }
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Find closest matching column name in a table's schema
 * Returns null if no good match found (distance > threshold)
 */
export function findClosestColumn(
  targetColumn: string,
  tableName: string,
  schemas: Map<string, TableSchema>,
  threshold: number = 3
): string | null {
  const tableSchema = schemas.get(tableName);
  if (!tableSchema) {
    return null;
  }

  const targetLower = targetColumn.toLowerCase();
  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const col of tableSchema.columns) {
    const colLower = col.columnName.toLowerCase();
    
    // Exact match (case-insensitive)
    if (colLower === targetLower) {
      return col.columnName;
    }
    
    // Starts-with match (e.g., "EndDateTime" matches "EndDate")
    if (colLower.startsWith(targetLower) || targetLower.startsWith(colLower)) {
      const distance = Math.abs(colLower.length - targetLower.length);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = col.columnName;
      }
    }
    
    // Levenshtein distance match
    const distance = levenshteinDistance(targetLower, colLower);
    if (distance <= threshold && distance < bestDistance) {
      bestDistance = distance;
      bestMatch = col.columnName;
    }
  }

  return bestMatch;
}

/**
 * Get all column names for a table
 */
export function getTableColumns(tableName: string, schemas: Map<string, TableSchema>): string[] {
  const tableSchema = schemas.get(tableName);
  if (!tableSchema) {
    return [];
  }
  return tableSchema.columns.map(c => c.columnName);
}

/**
 * Check if a column exists in a table
 */
export function columnExists(tableName: string, columnName: string, schemas: Map<string, TableSchema>): boolean {
  const tableSchema = schemas.get(tableName);
  if (!tableSchema) {
    return false;
  }
  return tableSchema.columns.some(c => c.columnName.toLowerCase() === columnName.toLowerCase());
}
