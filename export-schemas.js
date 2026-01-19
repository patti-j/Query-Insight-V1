// export-schemas.js
// Usage: node export-schemas.js
// Uses existing SQL_* or AZURE_SQL_* environment variables

import fs from "fs";
import path from "path";
import sql from "mssql";

const OUT_DIR = path.resolve("schemas", "publish");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function mkMdHeader(tableFullName) {
  return `# ${tableFullName}\n\nGenerated: ${new Date().toISOString()}\n\n| # | Column | Type | MaxLen | Nullable | Default |\n|---:|---|---|---:|---:|---|\n`;
}

async function run() {
  // Use existing environment variables (same pattern as db-azure.ts)
  const server = process.env.AZURE_SQL_SERVER || process.env.SQL_SERVER;
  const database = process.env.AZURE_SQL_DATABASE || process.env.SQL_DATABASE;
  const user = process.env.AZURE_SQL_USER || process.env.SQL_USER;
  const password = process.env.AZURE_SQL_PASSWORD || process.env.SQL_PASSWORD;

  if (!server || !database || !user || !password) {
    console.error("ERROR: Set SQL_SERVER, SQL_DATABASE, SQL_USER, SQL_PASSWORD environment variables.");
    process.exit(1);
  }

  const config = {
    server,
    database,
    user,
    password,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
  };

  console.log("Connecting to DB...");
  const pool = await sql.connect(config);

  try {
    ensureDir(OUT_DIR);

    // Get DASHt_* tables in publish schema
    const tablesRes = await pool.request()
      .query(`
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = 'publish' AND TABLE_NAME LIKE 'DASHt[_]%'
        ORDER BY TABLE_NAME;
      `);

    const tables = tablesRes.recordset;
    if (!tables.length) {
      console.warn("No publish.DASHt_* tables found.");
    }

    for (const t of tables) {
      const schema = t.TABLE_SCHEMA;
      const table = t.TABLE_NAME;
      console.log("Exporting", `${schema}.${table}`);

      const colsRes = await pool.request()
        .input("schema", sql.NVarChar, schema)
        .input("table", sql.NVarChar, table)
        .query(`
          SELECT 
            ORDINAL_POSITION,
            COLUMN_NAME,
            DATA_TYPE,
            COALESCE(CHARACTER_MAXIMUM_LENGTH, '') AS MAX_LENGTH,
            IS_NULLABLE,
            COALESCE(COLUMN_DEFAULT, '') AS COLUMN_DEFAULT
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
          ORDER BY ORDINAL_POSITION;
        `);

      const mdPath = path.join(OUT_DIR, `${table}.md`);
      let out = mkMdHeader(`${schema}.${table}`);
      for (const c of colsRes.recordset) {
        const line = `| ${c.ORDINAL_POSITION} | ${c.COLUMN_NAME} | ${c.DATA_TYPE} | ${c.MAX_LENGTH} | ${c.IS_NULLABLE} | ${c.COLUMN_DEFAULT} |\n`;
        out += line;
      }
      fs.writeFileSync(mdPath, out, "utf8");
      console.log("Wrote", mdPath);
    }

    console.log("\nAll done. Commit the files under schemas/publish/ to your GitHub repo.");
  } catch (err) {
    console.error("ERROR:", err.message || err);
    console.error(err);
  } finally {
    await pool.close();
  }
}

run();
