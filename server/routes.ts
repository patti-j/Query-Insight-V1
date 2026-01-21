import type { Express } from "express";
import { createServer, type Server } from "http";
import { executeQuery } from "./db-azure";
import { validateAndModifySql, runValidatorSelfCheck, type ValidationOptions } from "./sql-validator";
import { generateSqlFromQuestion, generateSuggestions } from "./openai-client";
import { log } from "./index";
import {
  createQueryLogContext,
  logSuccess,
  logValidationFailure,
  logExecutionFailure,
  logGenerationFailure,
  trackQueryForFAQ,
  getPopularQuestions,
  storeFeedback,
  getFeedbackStats,
  getAnalytics,
} from "./query-logger";
import { getValidatedQuickQuestions } from "./quick-questions";
import { getSchemasForMode, formatSchemaForPrompt, TableSchema } from "./schema-introspection";
import { validateSqlColumns } from "./sql-column-validator";
import { readFileSync } from "fs";
import { join } from "path";

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

  // Submit feedback for a query result
  app.post("/api/feedback", (req, res) => {
    const { question, sql, feedback, comment } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question is required' });
    }
    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'SQL is required' });
    }
    if (!feedback || (feedback !== 'up' && feedback !== 'down')) {
      return res.status(400).json({ error: 'Feedback must be "up" or "down"' });
    }

    storeFeedback(question, sql, feedback, comment);
    log(`Feedback received: ${feedback} for question: ${question.substring(0, 50)}...`, 'feedback');

    res.json({ success: true });
  });

  // Get feedback statistics
  app.get("/api/feedback/stats", (_req, res) => {
    const stats = getFeedbackStats();
    res.json(stats);
  });

  // Get analytics data for dashboard
  app.get("/api/analytics", (req, res) => {
    const timeRange = req.query.timeRange ? parseInt(req.query.timeRange as string, 10) : 1440; // 24 hours
    const analytics = getAnalytics(timeRange);
    res.json(analytics);
  });

  // Get semantic catalog
  app.get("/api/semantic-catalog", (_req, res) => {
    try {
      const catalogPath = join(process.cwd(), 'docs', 'semantic', 'semantic-catalog.json');
      const catalogContent = readFileSync(catalogPath, 'utf-8');
      const catalog = JSON.parse(catalogContent);
      res.json(catalog);
    } catch (error: any) {
      log(`Failed to load semantic catalog: ${error.message}`, 'semantic-catalog');
      res.status(500).json({
        error: 'Failed to load semantic catalog',
      });
    }
  });

  // Get validated quick questions for a report/mode
  app.get("/api/quick-questions/:reportId", async (req, res) => {
    try {
      const reportId = req.params.reportId;
      const questions = await getValidatedQuickQuestions(reportId);
      res.json({ questions, reportId });
    } catch (error: any) {
      log(`Failed to get quick questions for report ${req.params.reportId}: ${error.message}`, 'quick-questions');
      res.status(500).json({
        error: 'Failed to load quick questions',
        questions: [] // Return empty array on error
      });
    }
  });

  // Get schema for a mode (table->columns mapping)
  app.get("/api/schema/:mode", async (req, res) => {
    try {
      const mode = req.params.mode as string;
      
      // Load semantic catalog to validate mode against catalog IDs
      const catalogPath = join(process.cwd(), 'docs', 'semantic', 'semantic-catalog.json');
      const catalogContent = readFileSync(catalogPath, 'utf-8');
      const catalog = JSON.parse(catalogContent);
      
      const modeConfig = catalog.modes.find((m: any) => m.id === mode);
      if (!modeConfig) {
        const validModes = catalog.modes.map((m: any) => m.id).join(', ');
        return res.status(404).json({ 
          error: `Mode '${mode}' not found in semantic catalog. Valid modes: ${validModes}` 
        });
      }

      const allowedTables = modeConfig.tables as string[];
      const schemas = await getSchemasForMode(mode, allowedTables);
      
      // Convert Map to plain object for JSON serialization
      const schemasObj: Record<string, TableSchema> = {};
      for (const [tableName, schema] of Array.from(schemas)) {
        schemasObj[tableName] = schema;
      }
      
      res.json({ 
        mode, 
        tables: schemasObj,
        tableCount: schemas.size,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      log(`Failed to get schema for mode ${req.params.mode}: ${error.message}`, 'schema');
      res.status(500).json({
        error: 'Failed to load schema',
        tables: {}
      });
    }
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
    const { question, mode = 'production-planning', advancedMode = false } = req.body;

    // Validate question parameter
    if (!question || typeof question !== 'string') {
      return res.status(400).json({
        error: 'Question is required and must be a string',
      });
    }

    // Load semantic catalog to get allowed tables for the mode
    let allowedTables: string[] = [];
    try {
      const catalogPath = join(process.cwd(), 'docs', 'semantic', 'semantic-catalog.json');
      const catalogContent = readFileSync(catalogPath, 'utf-8');
      const catalog = JSON.parse(catalogContent);
      
      const selectedMode = catalog.modes.find((m: any) => m.id === mode);
      if (selectedMode) {
        allowedTables = selectedMode.tables;
      }
    } catch (error: any) {
      log(`Failed to load semantic catalog: ${error.message}`, 'ask');
      // Continue with empty allowedTables - will fall back to any DASHt_* table
    }

    // Create query log context
    const logContext = createQueryLogContext(req, question);
    log(`Processing question: ${question} (mode: ${mode}, advancedMode: ${advancedMode})`, 'ask');

    let generatedSql: string | undefined;
    let llmStartTime: number | undefined;
    let llmMs: number | undefined;

    try {
      // Generate SQL from natural language with mode context
      // Mode-specific schema cache handles table filtering automatically
      // Pass allowedTables as fallback in case schema fetch fails
      llmStartTime = Date.now();
      generatedSql = await generateSqlFromQuestion(question, { mode, allowedTables });
      llmMs = Date.now() - llmStartTime;
      log(`Generated SQL: ${generatedSql}`, 'ask');

      // Validate and modify SQL if needed, passing mode-specific options
      const validationOptions: ValidationOptions = {
        allowedTables: allowedTables.length > 0 ? allowedTables : undefined,
        advancedMode,
      };
      const validation = validateAndModifySql(generatedSql, validationOptions);
      
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
      
      // Validate column references against schema
      const columnValidation = await validateSqlColumns(finalSql, allowedTables);
      if (!columnValidation.valid) {
        log(`🔴 COLUMN VALIDATION FAILED: ${columnValidation.errors.length} errors found`, 'ask');
        
        for (const error of columnValidation.errors) {
          log(`  - ${error.message}`, 'ask');
        }
        
        // Log validation failure
        logValidationFailure(
          logContext,
          finalSql,
          `Column validation failed: ${columnValidation.errors.map(e => e.message).join('; ')}`,
          llmMs
        );
        
        // Detect scope-mismatch: capacity-related question in Production & Planning mode
        const capacityTerms = [
          'demand', 'capacity', 'utilization', 'resource load', 'bottleneck',
          'throughput', 'workload', 'available capacity', 'overload', 'underutilized',
          'shift', 'planning area'
        ];
        const planningTerms = [
          'job', 'work order', 'operation', 'due date', 'priority', 
          'manufacturing order', 'scheduled', 'product', 'material', 'bom'
        ];
        const questionLower = question.toLowerCase();
        const hasCapacityTerms = capacityTerms.some(term => questionLower.includes(term));
        const hasPlanningTerms = planningTerms.some(term => questionLower.includes(term));
        
        if (mode === 'production-planning' && hasCapacityTerms) {
          // User asking capacity-style question in wrong mode
          const firstError = columnValidation.errors[0];
          let errorMessage = `This question looks like it's about capacity planning, but you're currently in "Production & Planning" mode which doesn't have capacity columns.\n\n`;
          errorMessage += `💡 Try switching to "Capacity Plan" in the Power BI report dropdown and ask again.\n\n`;
          errorMessage += `Error details: ${firstError.message}`;
          
          if (firstError.availableColumns && firstError.availableColumns.length > 0) {
            errorMessage += `\n\nDid you mean one of these columns? ${firstError.availableColumns.join(', ')}`;
          }
          
          return res.status(400).json({
            error: errorMessage,
            sql: finalSql,
            isMock: false,
            schemaError: true,
            invalidColumns: columnValidation.errors.map(e => e.column),
            suggestMode: 'capacity-plan',
          });
        } else if (mode === 'capacity-plan' && hasPlanningTerms) {
          // User asking planning-style question in wrong mode
          const firstError = columnValidation.errors[0];
          let errorMessage = `This question looks like it's about production planning, but you're currently in "Capacity Plan" mode which focuses on resource capacity.\n\n`;
          errorMessage += `💡 Try switching to "Production & Planning" in the Power BI report dropdown and ask again.\n\n`;
          errorMessage += `Error details: ${firstError.message}`;
          
          if (firstError.availableColumns && firstError.availableColumns.length > 0) {
            errorMessage += `\n\nDid you mean one of these columns? ${firstError.availableColumns.join(', ')}`;
          }
          
          return res.status(400).json({
            error: errorMessage,
            sql: finalSql,
            isMock: false,
            schemaError: true,
            invalidColumns: columnValidation.errors.map(e => e.column),
            suggestMode: 'production-planning',
          });
        }
        
        // Build helpful error message with fuzzy suggestions
        const firstError = columnValidation.errors[0];
        let errorMessage = firstError.message;
        if (firstError.availableColumns && firstError.availableColumns.length > 0) {
          errorMessage += `\n\nDid you mean one of these? ${firstError.availableColumns.join(', ')}`;
        }
        
        return res.status(400).json({
          error: errorMessage,
          sql: finalSql,
          isMock: false,
          schemaError: true,
          invalidColumns: columnValidation.errors.map(e => e.column),
        });
      }
      
      // Log column mapping suggestions if any
      if (columnValidation.warnings.length > 0) {
        log(`Column mapping suggestions:`, 'ask');
        for (const warning of columnValidation.warnings) {
          log(`  ${warning.originalColumn} → ${warning.suggestedColumn} (${warning.table})`, 'ask');
        }
      }
      
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

      // Generate "did you mean?" suggestions asynchronously
      const suggestions = await generateSuggestions(question);

      res.json({
        answer: `Query executed successfully. Retrieved ${result.recordset.length} row(s).`,
        sql: finalSql,
        rows: result.recordset,
        rowCount: result.recordset.length,
        isMock: false,
        suggestions: suggestions.length > 0 ? suggestions : undefined,
      });

    } catch (error: any) {
      log(`Error in /api/ask: ${error.message}`, 'ask');

      // Determine error stage and log appropriately
      if (generatedSql) {
        // Error during SQL execution (use validated SQL if available)
        const validationOptions: ValidationOptions = {
          allowedTables: allowedTables.length > 0 ? allowedTables : undefined,
          advancedMode,
        };
        const validation = validateAndModifySql(generatedSql, validationOptions);
        const failedSql = validation.modifiedSql || generatedSql;
        
        // Detect invalid column name errors (schema mismatch)
        const invalidColumnMatch = error.message?.match(/Invalid column name '([^']+)'/i);
        if (invalidColumnMatch) {
          const invalidColumn = invalidColumnMatch[1];
          log(`🔴 SCHEMA MISMATCH: OpenAI generated SQL with invalid column '${invalidColumn}'`, 'ask');
          log(`Generated SQL with invalid column: ${failedSql}`, 'ask');
          log(`Question: ${question}`, 'ask');
          log(`Mode: ${mode}`, 'ask');
          
          // Return helpful error message to user
          return res.status(500).json({
            error: `Schema mismatch: Column '${invalidColumn}' does not exist in the database. This is an AI generation error.`,
            sql: failedSql,
            isMock: false,
            schemaError: true,
            invalidColumn,
          });
        }
        
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
