/**
 * Table Discovery Module
 * Discovers existing DASHt_% tables from Azure SQL
 */

import { executeQuery } from "./db-azure";
import { log } from "./index";

export interface DiscoveredTable {
  name: string;
  fullName: string;
  accessible: boolean;
}

let discoveredTables: Map<string, DiscoveredTable> = new Map();
let lastDiscoveryTime: Date | null = null;
let discoveryInProgress = false;

/**
 * Query Azure SQL to discover all existing DASHt_% tables
 */
async function discoverDashTables(): Promise<DiscoveredTable[]> {
  try {
    const dbNameQuery = `SELECT DB_NAME() as current_database, @@SERVERNAME as server_name`;
    const dbResult = await executeQuery(dbNameQuery);
    log(`Connected to: ${JSON.stringify(dbResult.recordset[0])}`, 'table-discovery');
  } catch (e: any) {
    log(`Debug query failed: ${e.message}`, 'table-discovery');
  }

  const query = `
    SELECT 
      o.name as table_name,
      s.name as schema_name
    FROM sys.objects o
    INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
    WHERE s.name = 'publish' 
      AND o.name LIKE 'DASHt[_]%' ESCAPE '\\'
      AND o.type IN ('U', 'V')
    ORDER BY o.name
  `;

  try {
    const result = await executeQuery(query);
    return result.recordset.map(row => ({
      name: row.table_name,
      fullName: `publish.${row.table_name}`,
      accessible: true,
    }));
  } catch (error: any) {
    log(`Failed to discover tables: ${error.message}`, 'table-discovery');
    return [];
  }
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
    const tables = await discoverDashTables();
    log(`Discovered ${tables.length} DASHt tables`, 'table-discovery');

    discoveredTables.clear();
    for (const table of tables) {
      discoveredTables.set(table.fullName.toLowerCase(), table);
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
    tables: Array.from(discoveredTables.values()).map(t => t.name),
  };
}
