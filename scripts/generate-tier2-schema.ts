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

async function generateTier2Schema() {
  console.log('Fetching Tier2 database schemas...');
  
  const tables = [
    'publish.CapacityIntervalResourceAssignments',
    'publish.CapacityIntervals',
    'publish.Customers',
    'publish.Departments',
    'publish.ForecastShipmentInventoryAdjustments',
    'publish.Inventories',
    'publish.Items',
    'publish.JobActivities',
    'publish.JobActivityInventoryAdjustments',
    'publish.JobMaterialSupplyingActivities',
    'publish.JobMaterials',
    'publish.JobOperationAttributes',
    'publish.JobOperations',
    'publish.JobPathNodes',
    'publish.JobProducts',
    'publish.JobResourceBlockIntervals',
    'publish.JobResourceBlocks',
    'publish.JobResources',
    'publish.Jobs',
    'publish.KPIs',
    'publish.ManufacturingOrders',
    'publish.Plants',
    'publish.PlantWarehouses',
    'publish.PurchaseToStockDeletedDemands',
    'publish.PurchaseToStockForecastDemands',
    'publish.PurchaseToStockInventoryAdjustments',
    'publish.PurchaseToStockSafetyStockDemands',
    'publish.PurchaseToStockSalesOrderDemands',
    'publish.PurchaseToStockTransferOrderDemands',
    'publish.PurchasesToStock',
    'publish.RecurringCapacityIntervalRecurrences',
    'publish.RecurringCapacityIntervalResourceAssignments',
    'publish.RecurringCapacityIntervals',
    'publish.ReportBlocks',
    'publish.Resources',
    'publish.SalesOrderDistributionInventoryAdjustments',
    'publish.SalesOrderLineDistributions',
    'publish.SalesOrderLines',
    'publish.SalesOrders',
    'publish.Schedules',
    'publish.StorageAreas',
    'publish.TransferOrderDistributionInventoryAdjustments',
    'publish.Warehouse',
    'publish.Warehouses',
    'publish.metrics'
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
    description: 'Pre-compiled Tier2 database schema for Advanced Mode query generation',
    tables: schemas
  };
  
  const outputPath = join(process.cwd(), 'docs', 'semantic', 'tier2-schema.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  
  console.log(`Tier2 schema saved to ${outputPath}`);
  console.log(`Generated schemas for ${Object.keys(schemas).length} tables`);
  
  process.exit(0);
}

generateTier2Schema().catch(err => {
  console.error('Error generating Tier2 schema:', err);
  process.exit(1);
});
