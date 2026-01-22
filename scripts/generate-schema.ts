import { executeQuery } from '../server/db-azure';
import { writeFileSync } from 'fs';
import { join } from 'path';

interface ColumnMetadata {
  columnName: string;
  dataType: string;
  isNullable: boolean;
}

interface TableSchema {
  tableName: string;
  columns: ColumnMetadata[];
}

async function generateStaticSchema() {
  console.log('Fetching database schemas...');
  
  const tables = [
    'publish.DASHt_CapacityPlanning_ResourceActual',
    'publish.DASHt_CapacityPlanning_ResourceCapacity',
    'publish.DASHt_CapacityPlanning_ResourceDemand',
    'publish.DASHt_CapacityPlanning_ShiftsCombined',
    'publish.DASHt_CapacityPlanning_ShiftsCombinedFromLastPublish',
    'publish.DASHt_Resources',
    'publish.DASHt_Planning',
    'publish.DASHt_JobOperationAttributes',
    'publish.DASHt_JobOperationProducts',
    'publish.DASHt_PredecessorOPIds',
    'publish.DASHt_RecentPublishedScenariosArchive',
    'publish.DASHt_SalesOrders',
    'publish.DASHt_PurchaseOrders',
    'publish.DASHt_Inventories',
    'publish.DASHt_InventoryAdjustments',
    'publish.DASHt_NetInventoryBalance',
    'publish.DASHt_Materials',
    'publish.DASHt_HistoricalKPIs',
    'publish.DASHt_TranLog'
  ];
  
  const tableFilters = tables.map(fullName => {
    const parts = fullName.split('.');
    return { schema: parts[0], table: parts[1], fullName };
  });
  
  const whereConditions = tableFilters.map(t => 
    `(TABLE_SCHEMA = '${t.schema}' AND TABLE_NAME = '${t.table}')`
  ).join(' OR ');
  
  const query = `
    SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE ${whereConditions} 
    ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
  `;
  
  const result = await executeQuery(query);
  
  const schemas: Record<string, TableSchema> = {};
  for (const row of result.recordset) {
    const fullTableName = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
    if (!schemas[fullTableName]) {
      schemas[fullTableName] = { tableName: fullTableName, columns: [] };
    }
    schemas[fullTableName].columns.push({
      columnName: row.COLUMN_NAME,
      dataType: row.DATA_TYPE,
      isNullable: row.IS_NULLABLE === 'YES'
    });
  }
  
  const output = {
    generatedAt: new Date().toISOString(),
    description: 'Pre-compiled database schema for AI Analytics query generation',
    tables: schemas
  };
  
  const outputPath = join(process.cwd(), 'docs', 'semantic', 'static-schema.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  
  console.log(`Schema saved to ${outputPath}`);
  console.log(`Generated schemas for ${Object.keys(schemas).length} tables`);
  
  process.exit(0);
}

generateStaticSchema().catch(err => {
  console.error('Error generating schema:', err);
  process.exit(1);
});
