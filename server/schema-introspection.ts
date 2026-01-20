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
