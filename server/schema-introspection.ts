import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
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

// Static schema loaded from pre-compiled JSON file
let staticSchema: Map<string, TableSchema> | null = null;

/**
 * Load static schema from pre-compiled JSON file
 */
function loadStaticSchema(): Map<string, TableSchema> {
  if (staticSchema) {
    return staticSchema;
  }
  
  const schemaPath = join(process.cwd(), 'docs', 'semantic', 'static-schema.json');
  
  if (!existsSync(schemaPath)) {
    log('schema-introspection', `Static schema file not found at ${schemaPath}. Run 'npx tsx scripts/generate-schema.ts' to generate it.`);
    return new Map();
  }
  
  try {
    const content = readFileSync(schemaPath, 'utf-8');
    const data = JSON.parse(content);
    
    staticSchema = new Map<string, TableSchema>();
    for (const [tableName, schema] of Object.entries(data.tables)) {
      staticSchema.set(tableName, schema as TableSchema);
    }
    
    log('schema-introspection', `Loaded static schema: ${staticSchema.size} tables from ${schemaPath}`);
    return staticSchema;
  } catch (error) {
    log('schema-introspection', `Error loading static schema: ${error}`);
    return new Map();
  }
}

/**
 * Get schema for the given tables from static file
 */
export async function getTableSchemas(tableNames: string[]): Promise<Map<string, TableSchema>> {
  const allSchemas = loadStaticSchema();
  
  // Filter to only requested tables
  const filteredSchemas = new Map<string, TableSchema>();
  for (const tableName of tableNames) {
    const schema = allSchemas.get(tableName);
    if (schema) {
      filteredSchemas.set(tableName, schema);
    }
  }
  
  return filteredSchemas;
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
  staticSchema = null;
  log('schema-introspection', 'Schema cache cleared');
}

/**
 * Load static schemas on startup (no database fetch needed)
 */
export async function prefetchAllModeSchemas(_catalogPath: string): Promise<void> {
  const schemas = loadStaticSchema();
  log('schema-introspection', `Static schema loaded: ${schemas.size} tables`);
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
 * Find top N closest matching column names in a table's schema
 * Returns array of column names sorted by match quality (best first)
 */
export function findClosestColumns(
  targetColumn: string,
  tableName: string,
  schemas: Map<string, TableSchema>,
  topN: number = 5,
  threshold: number = 5
): string[] {
  const tableSchema = schemas.get(tableName);
  if (!tableSchema) {
    return [];
  }

  const targetLower = targetColumn.toLowerCase();
  const matches: Array<{ column: string; distance: number }> = [];

  for (const col of tableSchema.columns) {
    const colLower = col.columnName.toLowerCase();
    
    // Exact match (case-insensitive)
    if (colLower === targetLower) {
      return [col.columnName]; // Return immediately for exact match
    }
    
    // Starts-with match gets priority (lower distance)
    if (colLower.startsWith(targetLower) || targetLower.startsWith(colLower)) {
      const distance = Math.abs(colLower.length - targetLower.length);
      matches.push({ column: col.columnName, distance });
      continue;
    }
    
    // Levenshtein distance match
    const distance = levenshteinDistance(targetLower, colLower);
    if (distance <= threshold) {
      matches.push({ column: col.columnName, distance });
    }
  }

  // Sort by distance (best matches first) and return top N
  matches.sort((a, b) => a.distance - b.distance);
  return matches.slice(0, topN).map(m => m.column);
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
