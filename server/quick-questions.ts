import { log } from "./index";
import { executeQuery } from "./db-azure";

/**
 * Quick question definition with validation metadata
 */
export interface QuickQuestion {
  id: string;
  text: string;
  icon: string;
  mode: 'planning' | 'capacity' | 'dispatch';
  // Tables and columns this question requires (for validation)
  requiredSchema: {
    table: string; // e.g., "publish.DASHt_Planning"
    columns: string[]; // e.g., ["JobOnHold", "JobHoldReason"]
  }[];
}

/**
 * All quick questions with their schema requirements
 */
export const ALL_QUICK_QUESTIONS: QuickQuestion[] = [
  // PLANNING MODE
  {
    id: 'planning-overdue',
    text: 'Show jobs that are overdue',
    icon: '🔴',
    mode: 'planning',
    requiredSchema: [
      { table: 'publish.DASHt_Planning', columns: ['JobName', 'JobId', 'JobOverdue', 'JobOverdueDays', 'JobNeedDateTime'] }
    ]
  },
  {
    id: 'planning-hold',
    text: 'Show jobs on hold with hold reasons',
    icon: '⏸️',
    mode: 'planning',
    requiredSchema: [
      { table: 'publish.DASHt_Planning', columns: ['JobName', 'JobId', 'JobOnHold', 'JobHoldReason'] }
    ]
  },
  {
    id: 'planning-not-scheduled',
    text: 'List jobs that are not scheduled',
    icon: '❌',
    mode: 'planning',
    requiredSchema: [
      { table: 'publish.DASHt_Planning', columns: ['JobName', 'JobId', 'JobScheduled', 'JobNeedDateTime'] }
    ]
  },
  {
    id: 'planning-late',
    text: 'Show late jobs grouped by plant',
    icon: '🏭',
    mode: 'planning',
    requiredSchema: [
      { table: 'publish.DASHt_Planning', columns: ['JobName', 'JobId', 'JobLate', 'JobLatenessDays', 'BlockPlant'] }
    ]
  },
  {
    id: 'planning-top-qty',
    text: 'Top 10 jobs by quantity',
    icon: '📊',
    mode: 'planning',
    requiredSchema: [
      { table: 'publish.DASHt_Planning', columns: ['JobName', 'JobId', 'JobQty', 'JobProduct'] }
    ]
  },
  {
    id: 'planning-lateness',
    text: 'Jobs with highest lateness days',
    icon: '⏰',
    mode: 'planning',
    requiredSchema: [
      { table: 'publish.DASHt_Planning', columns: ['JobName', 'JobId', 'JobLatenessDays', 'JobNeedDateTime'] }
    ]
  },
  {
    id: 'planning-scheduled',
    text: 'List all scheduled jobs',
    icon: '✅',
    mode: 'planning',
    requiredSchema: [
      { table: 'publish.DASHt_Planning', columns: ['JobName', 'JobId', 'JobScheduled', 'JobScheduledStartDateTime', 'JobScheduledEndDateTime'] }
    ]
  },
  {
    id: 'planning-priority',
    text: 'Jobs by priority',
    icon: '⭐',
    mode: 'planning',
    requiredSchema: [
      { table: 'publish.DASHt_Planning', columns: ['JobName', 'JobId', 'Priority', 'JobNeedDateTime'] }
    ]
  },

  // CAPACITY MODE
  {
    id: 'capacity-demand-week',
    text: 'Show resource demand for next 7 days',
    icon: '📈',
    mode: 'capacity',
    requiredSchema: [
      { table: 'publish.DASHt_CapacityPlanning_ResourceDemand', columns: ['ResourceName', 'DemandDate', 'DemandHours', 'PlantName'] }
    ]
  },
  {
    id: 'capacity-available',
    text: 'List available capacity by resource',
    icon: '✅',
    mode: 'capacity',
    requiredSchema: [
      { table: 'publish.DASHt_CapacityPlanning_ResourceCapacity', columns: ['ResourceName', 'ShiftDate', 'NormalOnlineHours', 'OvertimeHours', 'PlantName'] }
    ]
  },
  {
    id: 'capacity-over-capacity',
    text: 'Which resources are over capacity?',
    icon: '🔴',
    mode: 'capacity',
    requiredSchema: [
      { table: 'publish.DASHt_CapacityPlanning_ResourceDemand', columns: ['ResourceName', 'DemandDate', 'DemandHours', 'ResourceId'] },
      { table: 'publish.DASHt_CapacityPlanning_ResourceCapacity', columns: ['ResourceName', 'ShiftDate', 'NormalOnlineHours', 'ResourceId'] }
    ]
  },
  {
    id: 'capacity-intervals',
    text: 'Show shift intervals by resource',
    icon: '📅',
    mode: 'capacity',
    requiredSchema: [
      { table: 'publish.DASHt_CapacityPlanning_ShiftsCombined', columns: ['ResourceName', 'IntervalName', 'StartDateTime', 'EndDateTime', 'IntervalType'] }
    ]
  },
  {
    id: 'capacity-demand-vs-capacity',
    text: 'Compare demand vs available capacity',
    icon: '📊',
    mode: 'capacity',
    requiredSchema: [
      { table: 'publish.DASHt_CapacityPlanning_ResourceDemand', columns: ['ResourceName', 'DemandDate', 'DemandHours', 'ResourceId'] },
      { table: 'publish.DASHt_CapacityPlanning_ResourceCapacity', columns: ['ResourceName', 'ShiftDate', 'NormalOnlineHours', 'ResourceId'] }
    ]
  },
  {
    id: 'capacity-bottleneck',
    text: 'Show bottleneck resources',
    icon: '⚡',
    mode: 'capacity',
    requiredSchema: [
      { table: 'publish.DASHt_Resources', columns: ['ResourceName', 'Bottleneck', 'ResourceType', 'PlantName'] }
    ]
  },

  // DISPATCH MODE
  {
    id: 'dispatch-scheduled-today',
    text: 'Operations scheduled for today',
    icon: '📌',
    mode: 'dispatch',
    requiredSchema: [
      { table: 'publish.DASHt_Planning', columns: ['JobName', 'OPName', 'BlockScheduledStart', 'BlockScheduledEnd', 'BlockResource', 'BlockScheduled'] }
    ]
  },
  {
    id: 'dispatch-in-progress',
    text: 'List operations in progress',
    icon: '⚙️',
    mode: 'dispatch',
    requiredSchema: [
      { table: 'publish.DASHt_Planning', columns: ['JobName', 'OPName', 'ActivityPercentFinished', 'BlockResource', 'BlockProductionStatus'] }
    ]
  },
  {
    id: 'dispatch-with-attributes',
    text: 'Jobs with operation attributes',
    icon: '📋',
    mode: 'dispatch',
    requiredSchema: [
      { table: 'publish.DASHt_Planning', columns: ['JobName', 'OPName', 'OPAttributesSummary'] },
      { table: 'publish.DASHt_JobOperationAttributes', columns: ['JobId', 'OperationId', 'AttributesExternalIds'] }
    ]
  },
  {
    id: 'dispatch-by-resource',
    text: 'Show operations by resource',
    icon: '🔧',
    mode: 'dispatch',
    requiredSchema: [
      { table: 'publish.DASHt_Planning', columns: ['JobName', 'OPName', 'BlockResource', 'BlockScheduledStart', 'BlockScheduledEnd'] }
    ]
  },
  {
    id: 'dispatch-products',
    text: 'List job operation products',
    icon: '📦',
    mode: 'dispatch',
    requiredSchema: [
      { table: 'publish.DASHt_JobOperationProducts', columns: ['JobId', 'OperationId', 'ProductIds', 'ProductGroups'] }
    ]
  },
  {
    id: 'dispatch-overdue',
    text: 'Show overdue operations',
    icon: '🔴',
    mode: 'dispatch',
    requiredSchema: [
      { table: 'publish.DASHt_Planning', columns: ['JobName', 'OPName', 'OPLate', 'OPNeedDate', 'BlockScheduledEnd'] }
    ]
  },
  {
    id: 'dispatch-priority',
    text: 'Jobs by priority for dispatch',
    icon: '⭐',
    mode: 'dispatch',
    requiredSchema: [
      { table: 'publish.DASHt_Planning', columns: ['JobName', 'Priority', 'BlockScheduledStart', 'BlockResource'] }
    ]
  },
  {
    id: 'dispatch-resources-work',
    text: 'Resources with scheduled work',
    icon: '🏭',
    mode: 'dispatch',
    requiredSchema: [
      { table: 'publish.DASHt_Planning', columns: ['BlockResource', 'JobName', 'OPName', 'BlockScheduledStart'] },
      { table: 'publish.DASHt_Resources', columns: ['ResourceName', 'ResourceType', 'PlantName'] }
    ]
  },
];

/**
 * Cache for schema validation - loaded once at startup, never refreshed
 */
let schemaCache: Map<string, Set<string>> | null = null;
let validatedQuestionsCache: { text: string; icon: string }[] | null = null;

/**
 * Fetch available columns for tier1 DASHt tables from INFORMATION_SCHEMA.COLUMNS
 * Called once at startup
 */
async function fetchSchemaColumns(): Promise<Map<string, Set<string>>> {
  const schemaMap = new Map<string, Set<string>>();

  try {
    const query = `
      SELECT 
        CONCAT(TABLE_SCHEMA, '.', TABLE_NAME) AS FullTableName,
        COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'publish' 
        AND TABLE_NAME LIKE 'DASHt_%'
      ORDER BY FullTableName, ORDINAL_POSITION
    `;

    const result = await executeQuery(query);

    for (const row of result.recordset) {
      const tableName = row.FullTableName;
      const columnName = row.COLUMN_NAME;

      if (!schemaMap.has(tableName)) {
        schemaMap.set(tableName, new Set());
      }
      schemaMap.get(tableName)!.add(columnName);
    }

    log(`Schema validation: Loaded ${schemaMap.size} tables with column metadata`, 'quick-questions');
    
  } catch (error: any) {
    log(`Failed to fetch schema columns: ${error.message}`, 'quick-questions');
  }

  return schemaMap;
}

/**
 * Get cached schema (must call prefetchSchema at startup first)
 */
function getSchemaColumns(): Map<string, Set<string>> {
  if (!schemaCache) {
    log('Warning: Schema not prefetched, returning empty map', 'quick-questions');
    return new Map();
  }
  return schemaCache;
}

/**
 * Validate a single question against the current schema
 */
function validateQuestion(question: QuickQuestion, schema: Map<string, Set<string>>): boolean {
  for (const requirement of question.requiredSchema) {
    const tableName = requirement.table;
    const availableColumns = schema.get(tableName);

    if (!availableColumns) {
      log(`Quick question '${question.id}' requires missing table: ${tableName}`, 'quick-questions');
      return false;
    }

    for (const requiredColumn of requirement.columns) {
      if (!availableColumns.has(requiredColumn)) {
        log(`Quick question '${question.id}' requires missing column: ${tableName}.${requiredColumn}`, 'quick-questions');
        return false;
      }
    }
  }

  return true;
}

/**
 * Get validated quick questions from cache (must call prefetchSchema at startup first)
 */
export function getValidatedQuickQuestions(_reportId?: string): { text: string; icon: string }[] {
  if (validatedQuestionsCache) {
    return validatedQuestionsCache;
  }
  
  // Fallback: validate now if cache not ready (shouldn't happen after startup)
  const schema = getSchemaColumns();
  return ALL_QUICK_QUESTIONS
    .filter(q => validateQuestion(q, schema))
    .map(q => ({ text: q.text, icon: q.icon }));
}

/**
 * Prefetch schema and validate questions on startup (called once, cached forever)
 */
export async function prefetchSchema(): Promise<void> {
  try {
    // Fetch and cache schema
    schemaCache = await fetchSchemaColumns();
    
    // Validate and cache quick questions
    validatedQuestionsCache = ALL_QUICK_QUESTIONS
      .filter(q => validateQuestion(q, schemaCache!))
      .map(q => ({ text: q.text, icon: q.icon }));
    
    log(`Validated quick questions: ${validatedQuestionsCache.length}/${ALL_QUICK_QUESTIONS.length} passed schema validation`, 'quick-questions');
    log('Schema prefetch completed successfully', 'quick-questions');
  } catch (error: any) {
    log(`Schema prefetch failed: ${error.message}`, 'quick-questions');
  }
}
