/**
 * Mode-Specific Schema Cache
 * 
 * Maintains separate schema caches for each semantic mode (Planning, Capacity, Dispatch)
 * to minimize LLM prompt size and improve generation latency.
 */

import { getTableSchemas, TableSchema, formatSchemaForPrompt } from './schema-introspection';
import { log } from './index';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getRelevantColumns } from './matrix-classifier';

interface ModeConfig {
  id: string;
  name: string;
  description: string;
  tables: string[];
}

interface SemanticCatalog {
  modes: ModeConfig[];
  version: string;
  lastUpdated: string;
}

/**
 * Mode-specific schema cache entry
 */
interface ModeSchemaCacheEntry {
  schemas: Map<string, TableSchema>;
  formattedPrompt: string;
  tableCount: number;
  columnCount: number;
  timestamp: number;
}

// Cache for each mode with 10-minute TTL
const MODE_SCHEMA_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const modeSchemaCache = new Map<string, ModeSchemaCacheEntry>();

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
 * Get tables allowed for a specific mode
 */
export function getTablesForMode(mode: string): string[] {
  const catalog = loadSemanticCatalog();
  const modeConfig = catalog.modes.find(m => m.id === mode);
  
  if (!modeConfig) {
    throw new Error(`Unknown semantic mode: ${mode}`);
  }
  
  return modeConfig.tables;
}

/**
 * Get cached schema for a mode, or fetch if cache is expired
 */
export async function getModeSchema(mode: string): Promise<ModeSchemaCacheEntry> {
  const now = Date.now();
  const cached = modeSchemaCache.get(mode);
  
  // Return cached entry if valid
  if (cached && (now - cached.timestamp) < MODE_SCHEMA_CACHE_TTL_MS) {
    const age = Math.round((now - cached.timestamp) / 1000);
    log('mode-schema-cache', `Using cached schema for mode '${mode}' (age: ${age}s, ${cached.tableCount} tables, ${cached.columnCount} columns)`);
    return cached;
  }
  
  // Fetch fresh schema for this mode's tables
  const tables = getTablesForMode(mode);
  log('mode-schema-cache', `Fetching schema for mode '${mode}' (${tables.length} tables)...`);
  
  const allSchemas = await getTableSchemas(tables);
  
  // Filter to only include requested tables (schema-introspection may return more from cache)
  const schemas = new Map<string, TableSchema>();
  for (const tableName of tables) {
    const schema = allSchemas.get(tableName);
    if (schema) {
      schemas.set(tableName, schema);
    }
  }
  
  const formattedPrompt = formatSchemaForPrompt(schemas);
  
  // Count total columns from mode-specific tables only
  let columnCount = 0;
  for (const schema of Array.from(schemas.values())) {
    columnCount += schema.columns.length;
  }
  
  const entry: ModeSchemaCacheEntry = {
    schemas,
    formattedPrompt,
    tableCount: tables.length,
    columnCount,
    timestamp: now
  };
  
  modeSchemaCache.set(mode, entry);
  log('mode-schema-cache', `Cached schema for mode '${mode}': ${entry.tableCount} tables, ${entry.columnCount} columns`);
  
  return entry;
}

/**
 * Prefetch schemas for all modes on startup
 */
export async function prefetchAllModeSchemas(): Promise<void> {
  const catalog = loadSemanticCatalog();
  
  log('mode-schema-cache', `Prefetching schemas for ${catalog.modes.length} modes...`);
  
  for (const mode of catalog.modes) {
    try {
      await getModeSchema(mode.id);
    } catch (error: any) {
      log('mode-schema-cache', `Failed to prefetch schema for mode '${mode.id}': ${error.message}`);
    }
  }
  
  log('mode-schema-cache', `Schema prefetch completed for all modes`);
}

/**
 * Get formatted schema prompt for a specific mode
 */
export async function getFormattedSchemaForMode(mode: string): Promise<string> {
  const entry = await getModeSchema(mode);
  return entry.formattedPrompt;
}

/**
 * Get schema statistics for a mode (useful for monitoring)
 */
export async function getModeSchemaStats(mode: string): Promise<{ tableCount: number; columnCount: number }> {
  const entry = await getModeSchema(mode);
  return {
    tableCount: entry.tableCount,
    columnCount: entry.columnCount
  };
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
  
  log('mode-schema-cache', `Column slimming: ${totalOriginalColumns} → ${totalSlimmedColumns} columns (${Math.round((1 - totalSlimmedColumns/totalOriginalColumns) * 100)}% reduction)`);
  
  return lines.join('\n');
}

/**
 * Clear mode schema cache (useful for testing)
 */
export function clearModeSchemaCache(mode?: string): void {
  if (mode) {
    modeSchemaCache.delete(mode);
    log('mode-schema-cache', `Cleared cache for mode '${mode}'`);
  } else {
    modeSchemaCache.clear();
    log('mode-schema-cache', `Cleared all mode schema caches`);
  }
}
