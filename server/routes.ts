import type { Express } from "express";
import { createServer, type Server } from "http";
import { executeQuery } from "./db-azure";
import { validateAndModifySql, runValidatorSelfCheck } from "./sql-validator";
import { generateSqlFromQuestion } from "./openai-client";
import { log } from "./index";
import {
  createQueryLogContext,
  logSuccess,
  logValidationFailure,
  logExecutionFailure,
  logGenerationFailure,
  trackQueryForFAQ,
  getPopularQuestions,
} from "./query-logger";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Health check endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Validator self-check endpoint (development only)
  app.get("/api/validator-check", (_req, res) => {
    const { passed, results } = runValidatorSelfCheck();
    res.json({
      passed,
      results,
      timestamp: new Date().toISOString(),
    });
  });

  // Get popular questions for FAQ
  app.get("/api/popular-questions", (_req, res) => {
    const questions = getPopularQuestions(10);
    res.json({ questions });
  });

  // Database connectivity check
  app.get("/api/db-check", async (_req, res) => {
    try {
      const result = await executeQuery(
        'SELECT TOP (1) * FROM [publish].[DASHt_Planning]'
      );
      
      res.json({
        ok: true,
        rowCount: result.recordset.length,
        sample: result.recordset[0] || null,
      });
    } catch (error: any) {
      log(`Database check failed: ${error.message}`, 'db-check');
      res.status(500).json({
        ok: false,
        error: error.message || 'Database connection failed',
      });
    }
  });

  // Get latest publish date from DASHt_Planning
  app.get("/api/last-update", async (_req, res) => {
    try {
      const result = await executeQuery(
        'SELECT TOP (1) MAX(PublishDate) as lastUpdate FROM [publish].[DASHt_Planning]'
      );
      
      const lastUpdate = result.recordset[0]?.lastUpdate || null;
      
      res.json({
        ok: true,
        lastUpdate,
      });
    } catch (error: any) {
      log(`Last update fetch failed: ${error.message}`, 'last-update');
      res.status(500).json({
        ok: false,
        error: 'Failed to fetch last update date',
      });
    }
  });

  // Database diagnostics endpoint - lists and validates access to publish.DASHt_* tables
  app.get("/api/db/diagnostics", async (req, res) => {
    // Security: Only allow in development or with valid DIAGNOSTICS_TOKEN
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const diagnosticsToken = process.env.DIAGNOSTICS_TOKEN;
    const providedToken = req.headers['x-diagnostics-token'];

    if (!isDevelopment && (!diagnosticsToken || providedToken !== diagnosticsToken)) {
      return res.status(403).json({
        error: 'Forbidden: Diagnostics endpoint is only available in development or with valid DIAGNOSTICS_TOKEN header',
      });
    }

    log('Running database diagnostics...', 'db-diagnostics');

    try {
      // Step 1: Query sys.tables to find all publish.DASHt_* tables
      const tablesQuery = `
        SELECT t.name
        FROM sys.tables t
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE s.name = 'publish' 
          AND t.name LIKE 'DASHt[_]%' ESCAPE '\\'
        ORDER BY t.name
      `;

      const tablesResult = await executeQuery(tablesQuery);
      const tableNames = tablesResult.recordset.map(row => row.name);

      log(`Found ${tableNames.length} DASHt tables`, 'db-diagnostics');

      // Step 2: Test access to each table
      const tableResults = await Promise.all(
        tableNames.map(async (tableName) => {
          try {
            // Use SELECT TOP (0) to avoid reading any actual data
            const testQuery = `SELECT TOP (0) * FROM [publish].[${tableName}]`;
            await executeQuery(testQuery);
            
            return {
              table: tableName,
              accessible: true,
              error: null,
            };
          } catch (error: any) {
            // Log detailed error server-side, but return sanitized message to client
            log(`Failed to access table ${tableName}: ${error.message}`, 'db-diagnostics');
            
            // Sanitize error message - don't expose internal DB details
            let sanitizedError = 'Access denied';
            if (error.message?.toLowerCase().includes('invalid object name')) {
              sanitizedError = 'Table not found';
            } else if (error.message?.toLowerCase().includes('permission')) {
              sanitizedError = 'Permission denied';
            }
            
            return {
              table: tableName,
              accessible: false,
              error: sanitizedError,
            };
          }
        })
      );

      // Step 3: Compile results
      const accessibleCount = tableResults.filter(r => r.accessible).length;
      const failedCount = tableResults.filter(r => !r.accessible).length;

      const response = {
        timestamp: new Date().toISOString(),
        totalTables: tableNames.length,
        accessible: accessibleCount,
        failed: failedCount,
        tables: tableResults,
      };

      log(`Diagnostics complete: ${accessibleCount}/${tableNames.length} tables accessible`, 'db-diagnostics');

      res.json(response);

    } catch (error: any) {
      // Log detailed error server-side only
      log(`Diagnostics failed: ${error.message}`, 'db-diagnostics');
      
      // Return sanitized error to client - don't expose internal DB details
      res.status(500).json({
        error: 'Failed to run diagnostics. Check database connectivity and permissions.',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Natural language to SQL query endpoint
  app.post("/api/ask", async (req, res) => {
    const { question } = req.body;

    // Validate question parameter
    if (!question || typeof question !== 'string') {
      return res.status(400).json({
        error: 'Question is required and must be a string',
      });
    }

    // Create query log context
    const logContext = createQueryLogContext(req, question);
    log(`Processing question: ${question}`, 'ask');

    let generatedSql: string | undefined;
    let llmStartTime: number | undefined;
    let llmMs: number | undefined;

    try {
      // Generate SQL from natural language
      llmStartTime = Date.now();
      generatedSql = await generateSqlFromQuestion(question);
      llmMs = Date.now() - llmStartTime;
      log(`Generated SQL: ${generatedSql}`, 'ask');

      // Validate and modify SQL if needed
      const validation = validateAndModifySql(generatedSql);
      
      if (!validation.valid) {
        log(`SQL validation failed: ${validation.error}`, 'ask');
        
        // Log validation failure
        logValidationFailure(
          logContext,
          generatedSql,
          validation.error || 'Unknown validation error',
          llmMs
        );

        return res.status(400).json({
          error: `SQL validation failed: ${validation.error}`,
          sql: generatedSql,
          isMock: false,
        });
      }

      const finalSql = validation.modifiedSql || generatedSql;
      log(`Executing SQL: ${finalSql}`, 'ask');

      // Execute the query
      const sqlStartTime = Date.now();
      const result = await executeQuery(finalSql);
      const sqlMs = Date.now() - sqlStartTime;

      // Log successful execution (use finalSql which is the validated/modified SQL)
      logSuccess(
        logContext,
        finalSql,
        result.recordset.length,
        llmMs,
        sqlMs
      );

      // Track for FAQ popularity
      trackQueryForFAQ(question, true);

      res.json({
        answer: `Query executed successfully. Retrieved ${result.recordset.length} row(s).`,
        sql: finalSql,
        rows: result.recordset,
        rowCount: result.recordset.length,
        isMock: false,
      });

    } catch (error: any) {
      log(`Error in /api/ask: ${error.message}`, 'ask');

      // Determine error stage and log appropriately
      if (generatedSql) {
        // Error during SQL execution (use validated SQL if available)
        const validation = validateAndModifySql(generatedSql);
        const failedSql = validation.modifiedSql || generatedSql;
        logExecutionFailure(
          logContext,
          failedSql,
          error.message || 'Failed to execute query',
          llmMs
        );
      } else {
        // Error during SQL generation
        logGenerationFailure(
          logContext,
          error.message || 'Failed to generate SQL'
        );
      }

      res.status(500).json({
        error: error.message || 'Failed to process query',
        isMock: false,
      });
    }
  });

  // Run validator self-check on startup in development mode
  if (process.env.NODE_ENV !== 'production') {
    log('Running validator self-check...', 'startup');
    const { passed, results } = runValidatorSelfCheck();
    results.forEach(result => log(result, 'validator-check'));
    if (!passed) {
      log('⚠️  WARNING: Validator self-check failed!', 'validator-check');
    } else {
      log('✅ Validator self-check passed', 'validator-check');
    }
  }

  return httpServer;
}
