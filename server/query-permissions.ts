import { UserPermissions, TableAccess } from '@shared/schema';
import { getUserPermissionsByUsername, getUserPermissions } from './permissions-storage';
import { log } from './index';

export interface PermissionContext {
  userId?: string;
  username?: string;
}

export interface PermissionEnforcementResult {
  allowed: boolean;
  modifiedSql?: string;
  blockedReason?: string;
  appliedFilters?: string[];
}

const SALES_REVENUE_TABLES = [
  'DASHt_SalesOrders',
  'DASHt_SalesOrderLines',
  'DASHt_PurchaseOrders',
  'DASHt_PurchaseOrderLines',
];

const PLANNING_AREA_COLUMN = 'PlanningAreaName';
const SCENARIO_COLUMN = 'NewScenarioId';
const PLANT_COLUMN = 'PlantName';

function extractTableNames(sql: string): string[] {
  const tablePattern = /(?:FROM|JOIN)\s+\[?publish\]?\.\[?(\w+)\]?/gi;
  const tables: string[] = [];
  let match;
  while ((match = tablePattern.exec(sql)) !== null) {
    tables.push(match[1]);
  }
  return Array.from(new Set(tables));
}

function hasColumnInTables(columnName: string, tables: string[]): boolean {
  const columnsPerTable: Record<string, string[]> = {
    'DASHt_Planning': ['PlanningAreaName', 'NewScenarioId', 'PlantName', 'ScenarioType'],
    'DASHt_SalesOrders': ['PlanningAreaName', 'NewScenarioId', 'ScenarioType'],
    'DASHt_SalesOrderLines': ['PlanningAreaName', 'NewScenarioId'],
    'DASHt_CapacityPlanning': ['PlanningAreaName', 'NewScenarioId', 'PlantName'],
    'DASHt_DispatchList': ['PlanningAreaName', 'NewScenarioId', 'PlantName'],
    'DASHt_Inventories': ['PlanningAreaName', 'NewScenarioId'],
    'DASHt_ScheduleConformance': ['PlanningAreaName', 'PlantName'],
  };

  for (const table of tables) {
    const tableColumns = columnsPerTable[table];
    if (tableColumns && tableColumns.includes(columnName)) {
      return true;
    }
  }
  return false;
}

function getTableAlias(sql: string, tableName: string): string | null {
  const aliasPattern = new RegExp(
    `(?:FROM|JOIN)\\s+\\[?publish\\]?\\.\\[?${tableName}\\]?(?:\\s+(?:AS\\s+)?(\\w+))?`,
    'i'
  );
  const match = sql.match(aliasPattern);
  if (match && match[1]) {
    return match[1];
  }
  return null;
}

function buildFilterClause(
  permissions: UserPermissions,
  tables: string[],
  sql: string
): { clause: string; appliedFilters: string[] } {
  const conditions: string[] = [];
  const appliedFilters: string[] = [];

  if (permissions.allowedPlanningAreas && permissions.allowedPlanningAreas.length > 0) {
    if (hasColumnInTables(PLANNING_AREA_COLUMN, tables)) {
      const values = permissions.allowedPlanningAreas.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
      const mainTable = tables.find(t => 
        ['DASHt_Planning', 'DASHt_CapacityPlanning', 'DASHt_SalesOrders', 'DASHt_DispatchList', 'DASHt_Inventories', 'DASHt_ScheduleConformance'].includes(t)
      );
      if (mainTable) {
        const alias = getTableAlias(sql, mainTable);
        const prefix = alias || `[publish].[${mainTable}]`;
        conditions.push(`${prefix}.${PLANNING_AREA_COLUMN} IN (${values})`);
        appliedFilters.push(`PlanningArea: ${permissions.allowedPlanningAreas.join(', ')}`);
      }
    }
  }

  if (permissions.allowedScenarios && permissions.allowedScenarios.length > 0) {
    if (hasColumnInTables(SCENARIO_COLUMN, tables)) {
      const values = permissions.allowedScenarios.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
      const mainTable = tables.find(t => 
        ['DASHt_Planning', 'DASHt_CapacityPlanning', 'DASHt_SalesOrders', 'DASHt_SalesOrderLines', 'DASHt_DispatchList', 'DASHt_Inventories'].includes(t)
      );
      if (mainTable) {
        const alias = getTableAlias(sql, mainTable);
        const prefix = alias || `[publish].[${mainTable}]`;
        conditions.push(`${prefix}.${SCENARIO_COLUMN} IN (${values})`);
        appliedFilters.push(`Scenario: ${permissions.allowedScenarios.join(', ')}`);
      }
    }
  }

  if (permissions.allowedPlants && permissions.allowedPlants.length > 0) {
    if (hasColumnInTables(PLANT_COLUMN, tables)) {
      const values = permissions.allowedPlants.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
      const mainTable = tables.find(t => 
        ['DASHt_Planning', 'DASHt_CapacityPlanning', 'DASHt_DispatchList', 'DASHt_ScheduleConformance'].includes(t)
      );
      if (mainTable) {
        const alias = getTableAlias(sql, mainTable);
        const prefix = alias || `[publish].[${mainTable}]`;
        conditions.push(`${prefix}.${PLANT_COLUMN} IN (${values})`);
        appliedFilters.push(`Plant: ${permissions.allowedPlants.join(', ')}`);
      }
    }
  }

  return {
    clause: conditions.length > 0 ? conditions.join(' AND ') : '',
    appliedFilters,
  };
}

function injectWhereClause(sql: string, filterClause: string): string {
  if (!filterClause) return sql;

  const upperSql = sql.toUpperCase();
  const whereIndex = upperSql.indexOf(' WHERE ');
  const groupByIndex = upperSql.indexOf(' GROUP BY ');
  const orderByIndex = upperSql.indexOf(' ORDER BY ');
  const havingIndex = upperSql.indexOf(' HAVING ');

  if (whereIndex !== -1) {
    const insertPosition = whereIndex + 7;
    return sql.slice(0, insertPosition) + `(${filterClause}) AND ` + sql.slice(insertPosition);
  }

  let insertBefore = sql.length;
  if (groupByIndex !== -1) insertBefore = Math.min(insertBefore, groupByIndex);
  if (orderByIndex !== -1) insertBefore = Math.min(insertBefore, orderByIndex);
  if (havingIndex !== -1) insertBefore = Math.min(insertBefore, havingIndex);

  const insertPosition = sql.length === insertBefore 
    ? sql.length 
    : sql.toLowerCase().indexOf(sql.substring(insertBefore).toLowerCase());
  
  return sql.slice(0, insertBefore) + ` WHERE ${filterClause}` + sql.slice(insertBefore);
}

export function checkTableAccess(
  permissions: UserPermissions | null,
  tables: string[]
): { allowed: boolean; blockedTable?: string } {
  if (!permissions) {
    return { allowed: true };
  }

  if (permissions.isAdmin) {
    return { allowed: true };
  }

  if (permissions.allowedTableAccess === null) {
    return { allowed: true };
  }

  const salesRevenueTablesInQuery = tables.filter(t => 
    SALES_REVENUE_TABLES.some(srt => srt.toLowerCase() === t.toLowerCase())
  );

  if (salesRevenueTablesInQuery.length === 0) {
    return { allowed: true };
  }

  const hasSalesAccess = permissions.allowedTableAccess.includes('Sales');
  const hasRevenueAccess = permissions.allowedTableAccess.includes('Revenue');

  if (!hasSalesAccess && !hasRevenueAccess) {
    return { 
      allowed: false, 
      blockedTable: salesRevenueTablesInQuery[0] 
    };
  }

  return { allowed: true };
}

export function enforcePermissions(
  sql: string,
  context: PermissionContext
): PermissionEnforcementResult {
  let permissions: UserPermissions | undefined;

  if (context.userId) {
    permissions = getUserPermissions(context.userId);
  } else if (context.username) {
    permissions = getUserPermissionsByUsername(context.username);
  }

  if (!permissions) {
    log(`[permissions] No permissions found for context, allowing query`, 'permissions');
    return { allowed: true, modifiedSql: sql, appliedFilters: [] };
  }

  if (permissions.isAdmin) {
    log(`[permissions] Admin user ${permissions.username}, skipping enforcement`, 'permissions');
    return { allowed: true, modifiedSql: sql, appliedFilters: [] };
  }

  const tables = extractTableNames(sql);
  log(`[permissions] Tables in query: ${tables.join(', ')}`, 'permissions');

  const tableAccess = checkTableAccess(permissions, tables);
  if (!tableAccess.allowed) {
    log(`[permissions] User ${permissions.username} blocked from table ${tableAccess.blockedTable}`, 'permissions');
    return {
      allowed: false,
      blockedReason: `You don't have access to sales/revenue data. Please contact your administrator.`,
    };
  }

  const { clause, appliedFilters } = buildFilterClause(permissions, tables, sql);
  
  if (clause) {
    const modifiedSql = injectWhereClause(sql, clause);
    log(`[permissions] Applied filters for ${permissions.username}: ${appliedFilters.join('; ')}`, 'permissions');
    log(`[permissions] Modified SQL: ${modifiedSql}`, 'permissions');
    return { allowed: true, modifiedSql, appliedFilters };
  }

  return { allowed: true, modifiedSql: sql, appliedFilters: [] };
}

export function getPermissionsForRequest(req: any): PermissionContext {
  const userId = req.headers['x-user-id'] as string | undefined || req.query?.userId as string | undefined;
  const username = req.headers['x-username'] as string | undefined || req.query?.username as string | undefined;
  
  return { userId, username };
}

export interface GlobalFilters {
  planningArea?: string | null;
  scenario?: string | null;
  scenarioId?: string | null;
  plant?: string | null;
}

export function applyGlobalFilters(
  sql: string,
  filters: GlobalFilters
): { modifiedSql: string; appliedFilters: string[] } {
  const tables = extractTableNames(sql);
  const conditions: string[] = [];
  const appliedFilters: string[] = [];

  if (filters.planningArea && filters.planningArea !== 'All Planning Areas') {
    if (hasColumnInTables(PLANNING_AREA_COLUMN, tables)) {
      const value = filters.planningArea.replace(/'/g, "''");
      conditions.push(`${PLANNING_AREA_COLUMN} = '${value}'`);
      appliedFilters.push(`Planning Area: ${filters.planningArea}`);
    }
  }

  if (filters.scenarioId) {
    if (hasColumnInTables(SCENARIO_COLUMN, tables)) {
      const value = filters.scenarioId.replace(/'/g, "''");
      conditions.push(`${SCENARIO_COLUMN} = '${value}'`);
      appliedFilters.push(`Scenario ID: ${filters.scenarioId}`);
    }
  }

  if (filters.plant && filters.plant !== 'All Plants') {
    if (hasColumnInTables(PLANT_COLUMN, tables)) {
      const value = filters.plant.replace(/'/g, "''");
      conditions.push(`${PLANT_COLUMN} = '${value}'`);
      appliedFilters.push(`Plant: ${filters.plant}`);
    }
  }

  if (conditions.length === 0) {
    return { modifiedSql: sql, appliedFilters: [] };
  }

  const filterClause = conditions.join(' AND ');
  const modifiedSql = injectWhereClause(sql, filterClause);
  
  log(`[global-filters] Applied: ${appliedFilters.join('; ')}`, 'permissions');
  log(`[global-filters] Modified SQL: ${modifiedSql}`, 'permissions');
  
  return { modifiedSql, appliedFilters };
}
