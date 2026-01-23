/**
 * Schema Cache
 * 
 * Maintains schema caches to minimize LLM prompt size and improve generation latency.
 */

import { getTableSchemas, TableSchema, formatSchemaForPrompt } from './schema-introspection';
import { log } from './index';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getRelevantColumns } from './matrix-classifier';

interface SemanticCatalog {
  tables: {
    tier1: string[];
    tier2: string[];
  };
  version: string;
  lastUpdated: string;
}

interface SchemaCacheEntry {
  schemas: Map<string, TableSchema>;
  formattedPrompt: string;
  tableCount: number;
  columnCount: number;
  timestamp: number;
}

// Cache with 10-minute TTL
const SCHEMA_CACHE_TTL_MS = 10 * 60 * 1000;
const schemaCache = new Map<string, SchemaCacheEntry>();

// Catalog cache (loaded once)
let catalogCache: SemanticCatalog | null = null;

/**
 * Load semantic catalog from file
 */
function loadSemanticCatalog(): SemanticCatalog {
  if (catalogCache) {
    return catalogCache;
  }
  
  const catalogPath = join(process.cwd(), 'docs', 'semantic', 'semantic-catalog.json');
  const catalogContent = readFileSync(catalogPath, 'utf-8');
  catalogCache = JSON.parse(catalogContent);
  
  return catalogCache!;
}

/**
 * Get all tier1 tables
 */
export function getTier1Tables(): string[] {
  const catalog = loadSemanticCatalog();
  return catalog.tables?.tier1 || [];
}

/**
 * Get all tables (tier1 + tier2)
 */
export function getAllTables(): string[] {
  const catalog = loadSemanticCatalog();
  return [
    ...(catalog.tables?.tier1 || []),
    ...(catalog.tables?.tier2 || [])
  ];
}

/**
 * Prefetch schemas for tier1 tables on startup
 */
export async function prefetchAllModeSchemas(): Promise<void> {
  const tables = getTier1Tables();
  
  if (tables.length === 0) {
    log('schema-cache', 'No tier1 tables found in catalog, skipping prefetch');
    return;
  }
  
  log('schema-cache', `Prefetching schemas for ${tables.length} tier1 tables...`);
  
  try {
    await getTableSchemas(tables);
    log('schema-cache', `Schema prefetch completed for ${tables.length} tables`);
  } catch (error: any) {
    log('schema-cache', `Failed to prefetch schemas: ${error.message}`);
  }
}

/**
 * Get formatted schema for specific tables (used for prompt slimming)
 */
export async function getFormattedSchemaForTables(tableNames: string[], question?: string): Promise<string> {
  const schemas = await getTableSchemas(tableNames);
  
  const filteredSchemas = new Map<string, TableSchema>();
  for (const tableName of tableNames) {
    const schema = schemas.get(tableName);
    if (schema) {
      filteredSchemas.set(tableName, schema);
    }
  }
  
  if (question) {
    return formatSchemaWithColumnSlimming(filteredSchemas, question);
  }
  
  return formatSchemaForPrompt(filteredSchemas);
}

/**
 * Format schema with column slimming based on question relevance
 */
function formatSchemaWithColumnSlimming(schemas: Map<string, TableSchema>, question: string): string {
  const lines: string[] = [];
  let totalOriginalColumns = 0;
  let totalSlimmedColumns = 0;
  
  for (const [tableName, schema] of Array.from(schemas)) {
    const allColumnNames = schema.columns.map(c => c.columnName);
    totalOriginalColumns += allColumnNames.length;
    
    const relevantColumns = getRelevantColumns(question, tableName, allColumnNames);
    totalSlimmedColumns += relevantColumns.length;
    
    lines.push(`\n${tableName}:`);
    lines.push(`  Columns: ${relevantColumns.join(', ')}`);
  }
  
  if (totalOriginalColumns > 0) {
    log('schema-cache', `Column slimming: ${totalOriginalColumns} → ${totalSlimmedColumns} columns (${Math.round((1 - totalSlimmedColumns/totalOriginalColumns) * 100)}% reduction)`);
  }
  
  return lines.join('\n');
}

/**
 * Clear schema cache
 */
export function clearModeSchemaCache(key?: string): void {
  if (key) {
    schemaCache.delete(key);
    log('schema-cache', `Cleared cache for '${key}'`);
  } else {
    schemaCache.clear();
    log('schema-cache', `Cleared all schema caches`);
  }
}
