import { executeQuery } from '../server/db-azure';
import { writeFileSync, readFileSync } from 'fs';
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

async function generateCombinedSchema() {
  console.log('Generating combined schema (Tier1 + Tier2)...');
  
  const catalogPath = join(process.cwd(), 'docs', 'semantic', 'semantic-catalog.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));
  
  const tier1Tables = catalog.tables?.tier1 || [];
  const tier2Tables = catalog.tables?.tier2 || [];
  const allTables = [...tier1Tables, ...tier2Tables];
  
  console.log(`Fetching schemas for ${tier1Tables.length} Tier1 + ${tier2Tables.length} Tier2 tables...`);
  
  const tableFilters = allTables.map(fullName => {
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
  
  const tier1Schemas: Record<string, TableSchema> = {};
  const tier2Schemas: Record<string, TableSchema> = {};
  
  for (const row of result.recordset) {
    const fullTableName = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
    const isTier1 = tier1Tables.includes(fullTableName);
    const targetSchemas = isTier1 ? tier1Schemas : tier2Schemas;
    
    if (!targetSchemas[fullTableName]) {
      targetSchemas[fullTableName] = { tableName: fullTableName, columns: [] };
    }
    targetSchemas[fullTableName].columns.push({
      columnName: row.COLUMN_NAME,
      dataType: row.DATA_TYPE,
      isNullable: row.IS_NULLABLE === 'YES'
    });
  }
  
  const output = {
    generatedAt: new Date().toISOString(),
    description: 'Combined database schema for AI Analytics query generation. Tier1 (DASHt_*) tables are curated for user queries. Tier2 tables provide additional detail when Tier1 lacks the needed information.',
    tier1: {
      description: 'Curated DASHt_* tables - primary source for user queries',
      tableCount: Object.keys(tier1Schemas).length,
      tables: tier1Schemas
    },
    tier2: {
      description: 'Source publish tables - use when Tier1 lacks needed grain or columns',
      tableCount: Object.keys(tier2Schemas).length,
      tables: tier2Schemas
    }
  };
  
  const outputPath = join(process.cwd(), 'docs', 'semantic', 'static-schema.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  
  console.log(`Combined schema saved to ${outputPath}`);
  console.log(`Tier1: ${Object.keys(tier1Schemas).length} tables`);
  console.log(`Tier2: ${Object.keys(tier2Schemas).length} tables`);
  
  process.exit(0);
}

generateCombinedSchema().catch(err => {
  console.error('Error generating schema:', err);
  process.exit(1);
});
