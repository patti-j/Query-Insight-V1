/**
 * Table Discovery Module
 * Discovers existing DASHt_% tables from Azure SQL and builds dynamic scope allowlists
 */

import { executeQuery } from "./db-azure";
import { log } from "./index";
import { readFileSync } from "fs";
import { join } from "path";

export interface DiscoveredTable {
  name: string;
  fullName: string;
  accessible: boolean;
}

export interface ScopeAvailability {
  id: string;
  name: string;
  available: boolean;
  tablesFound: number;
  tablesExpected: number;
  missingTables: string[];
  availableTables: string[];
  warning?: string;
}

interface SemanticMode {
  id: string;
  name: string;
  tables: string[];
  tier2Tables?: string[];
}

interface SemanticCatalog {
  modes: SemanticMode[];
}

let discoveredTables: Map<string, DiscoveredTable> = new Map();
let scopeAvailability: Map<string, ScopeAvailability> = new Map();
let lastDiscoveryTime: Date | null = null;
let discoveryInProgress = false;

/**
 * Query Azure SQL to discover all existing DASHt_% tables
 */
async function discoverDashTables(): Promise<DiscoveredTable[]> {
  const query = `
    SELECT 
      t.name as table_name,
      s.name as schema_name
    FROM sys.tables t
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'publish' 
      AND t.name LIKE 'DASHt[_]%' ESCAPE '\\'
    ORDER BY t.name
  `;

  try {
    const result = await executeQuery(query);
    return result.recordset.map(row => ({
      name: row.table_name,
      fullName: `publish.${row.table_name}`,
      accessible: true, // Assume accessible if we can see it in sys.tables
    }));
  } catch (error: any) {
    log(`Failed to discover tables: ${error.message}`, 'table-discovery');
    return [];
  }
}

/**
 * Build scope availability from discovered tables and semantic catalog
 */
function buildScopeAvailability(
  tables: DiscoveredTable[],
  catalog: SemanticCatalog
): Map<string, ScopeAvailability> {
  const availability = new Map<string, ScopeAvailability>();
  const tableSet = new Set(tables.map(t => t.fullName.toLowerCase()));

  for (const mode of catalog.modes) {
    const expectedTables = mode.tables || [];
    const availableTables: string[] = [];
    const missingTables: string[] = [];

    for (const table of expectedTables) {
      if (tableSet.has(table.toLowerCase())) {
        availableTables.push(table);
      } else {
        missingTables.push(table);
      }
    }

    const isAvailable = availableTables.length > 0;
    let warning: string | undefined;

    if (missingTables.length === expectedTables.length) {
      warning = `${mode.name} tables not available in this environment yet`;
    } else if (missingTables.length > 0) {
      warning = `Some ${mode.name} tables are not available: ${missingTables.length} of ${expectedTables.length} missing`;
    }

    availability.set(mode.id, {
      id: mode.id,
      name: mode.name,
      available: isAvailable,
      tablesFound: availableTables.length,
      tablesExpected: expectedTables.length,
      missingTables,
      availableTables,
      warning,
    });
  }

  return availability;
}

/**
 * Run table discovery and update caches
 */
export async function runTableDiscovery(): Promise<void> {
  if (discoveryInProgress) {
    log('Table discovery already in progress, skipping...', 'table-discovery');
    return;
  }

  discoveryInProgress = true;
  log('Starting table discovery...', 'table-discovery');

  try {
    // Discover tables from database
    const tables = await discoverDashTables();
    log(`Discovered ${tables.length} DASHt tables`, 'table-discovery');

    // Update cache
    discoveredTables.clear();
    for (const table of tables) {
      discoveredTables.set(table.fullName.toLowerCase(), table);
    }

    // Load semantic catalog
    const catalogPath = join(process.cwd(), 'docs', 'semantic', 'semantic-catalog.json');
    const catalogContent = readFileSync(catalogPath, 'utf-8');
    const catalog: SemanticCatalog = JSON.parse(catalogContent);

    // Build scope availability
    scopeAvailability = buildScopeAvailability(tables, catalog);

    // Log scope availability
    for (const [scopeId, availability] of Array.from(scopeAvailability)) {
      if (availability.warning) {
        log(`Scope ${scopeId}: ${availability.warning}`, 'table-discovery');
      } else {
        log(`Scope ${scopeId}: ${availability.tablesFound}/${availability.tablesExpected} tables available`, 'table-discovery');
      }
    }

    lastDiscoveryTime = new Date();
    log('Table discovery complete', 'table-discovery');

  } catch (error: any) {
    log(`Table discovery failed: ${error.message}`, 'table-discovery');
  } finally {
    discoveryInProgress = false;
  }
}

/**
 * Get all discovered tables
 */
export function getDiscoveredTables(): DiscoveredTable[] {
  return Array.from(discoveredTables.values());
}

/**
 * Check if a specific table exists
 */
export function tableExists(tableName: string): boolean {
  return discoveredTables.has(tableName.toLowerCase());
}

/**
 * Get scope availability information
 */
export function getScopeAvailability(scopeId?: string): ScopeAvailability | ScopeAvailability[] | null {
  if (scopeId) {
    return scopeAvailability.get(scopeId) || null;
  }
  return Array.from(scopeAvailability.values());
}

/**
 * Check if a scope is available (has at least one table)
 */
export function isScopeAvailable(scopeId: string): boolean {
  const availability = scopeAvailability.get(scopeId);
  return availability ? availability.available : false;
}

/**
 * Get only available tables for a scope (filters catalog against discovered tables)
 */
export function getAvailableTablesForScope(scopeId: string): string[] {
  const availability = scopeAvailability.get(scopeId);
  return availability ? availability.availableTables : [];
}

/**
 * Get last discovery timestamp
 */
export function getLastDiscoveryTime(): Date | null {
  return lastDiscoveryTime;
}

/**
 * Get discovery status for API response
 */
export function getDiscoveryStatus() {
  return {
    lastDiscovery: lastDiscoveryTime?.toISOString() || null,
    totalTablesDiscovered: discoveredTables.size,
    scopes: Array.from(scopeAvailability.values()),
  };
}
