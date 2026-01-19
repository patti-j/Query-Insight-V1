import sql from 'mssql';

// Azure SQL connection configuration
// Supports both SQL_* and AZURE_SQL_* environment variable prefixes
export const config: sql.config = {
  server: process.env.SQL_SERVER || process.env.AZURE_SQL_SERVER || '',
  database: process.env.SQL_DATABASE || process.env.AZURE_SQL_DATABASE || '',
  user: process.env.SQL_USER || process.env.AZURE_SQL_USER || '',
  password: process.env.SQL_PASSWORD || process.env.AZURE_SQL_PASSWORD || '',
  options: {
    encrypt: true,
    trustServerCertificate: false,
    connectTimeout: 30000,
    requestTimeout: 30000,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) {
    return pool;
  }

  pool = await new sql.ConnectionPool(config).connect();
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

export async function executeQuery(query: string): Promise<sql.IResult<any>> {
  const connection = await getPool();
  const result = await connection.request().query(query);
  return result;
}
