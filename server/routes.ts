import type { Express } from "express";
import { createServer, type Server } from "http";
import { executeQuery } from "./db-azure";
import { validateAndModifySql, runValidatorSelfCheck, type ValidationOptions } from "./sql-validator";
import { generateSqlFromQuestion, generateSuggestions, classifyQuestion, answerGeneralQuestion, generateNaturalLanguageResponse, cacheSuccessfulSql } from "./openai-client";
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
  getFailedQueries,
} from "./query-logger";
import { getValidatedQuickQuestions } from "./quick-questions";
import { getSchemasForMode, formatSchemaForPrompt, TableSchema } from "./schema-introspection";
import { validateSqlColumns } from "./sql-column-validator";
import { readFileSync } from "fs";
import { join } from "path";
import { 
  getDiscoveryStatus, 
  runTableDiscovery 
} from "./table-discovery";

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

  // Get failed queries for analysis (includes full SQL and error details)
  app.get("/api/analytics/failed-queries", (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const failedQueries = getFailedQueries(limit);
    res.json(failedQueries);
  });

  // Get semantic catalog with availability info
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

  // Table discovery endpoint - lists discovered tables and scope availability
  app.get("/api/discovered-tables", async (_req, res) => {
    try {
      const status = getDiscoveryStatus();
      res.json(status);
    } catch (error: any) {
      log(`Failed to get discovery status: ${error.message}`, 'discovered-tables');
      res.status(500).json({
        error: 'Failed to get discovery status',
      });
    }
  });

  // Trigger table re-discovery (admin endpoint)
  app.post("/api/discovered-tables/refresh", async (req, res) => {
    // Security: Only allow in development or with valid DIAGNOSTICS_TOKEN
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const diagnosticsToken = process.env.DIAGNOSTICS_TOKEN;
    const providedToken = req.headers['x-diagnostics-token'];

    if (!isDevelopment && (!diagnosticsToken || providedToken !== diagnosticsToken)) {
      return res.status(403).json({
        error: 'Forbidden: Refresh endpoint requires DIAGNOSTICS_TOKEN in production',
      });
    }

    try {
      await runTableDiscovery();
      const status = getDiscoveryStatus();
      res.json({ success: true, ...status });
    } catch (error: any) {
      log(`Failed to refresh table discovery: ${error.message}`, 'discovered-tables');
      res.status(500).json({
        error: 'Failed to refresh table discovery',
      });
    }
  });

  // Get validated quick questions for a report/mode
  // Popular queries (with results) are shown first, then static questions fill remaining slots
  app.get("/api/quick-questions/:reportId", async (req, res) => {
    try {
      const reportId = req.params.reportId;
      const maxQuestions = 5;
      
      // Get popular questions (queries run multiple times with results)
      const popularQueries = getPopularQuestions(maxQuestions);
      const variedIcons = ['📊', '📈', '🔍', '💡', '⚡', '🎯', '📋', '✨'];
      const popularAsQuestions = popularQueries.map((q, idx) => ({
        text: q.question,
        icon: idx === 0 ? '🔥' : variedIcons[(idx - 1) % variedIcons.length],
        isPopular: true,
        runCount: q.count
      }));
      
      // Get static quick questions from cache (validated at startup)
      const staticQuestions = getValidatedQuickQuestions(reportId);
      
      // Merge: popular first, then fill with static (avoiding duplicates)
      const popularTexts = new Set(popularQueries.map(q => q.question.toLowerCase()));
      const filteredStatic = staticQuestions.filter(
        q => !popularTexts.has(q.text.toLowerCase())
      );
      
      // Combine: popular queries first, then static to fill remaining slots
      const combined = [
        ...popularAsQuestions,
        ...filteredStatic.slice(0, maxQuestions - popularAsQuestions.length)
      ].slice(0, maxQuestions);
      
      log(`Quick questions for ${reportId}: ${popularAsQuestions.length} popular + ${combined.length - popularAsQuestions.length} static`, 'quick-questions');
      res.json({ questions: combined, reportId });
    } catch (error: any) {
      log(`Failed to get quick questions for report ${req.params.reportId}: ${error.message}`, 'quick-questions');
      res.status(500).json({
        error: 'Failed to load quick questions',
        questions: [] // Return empty array on error
      });
    }
  });

  // Get schema for tables (table->columns mapping)
  app.get("/api/schema/:tier", async (req, res) => {
    try {
      const tier = req.params.tier as string;
      
      // Load semantic catalog to get tables
      const catalogPath = join(process.cwd(), 'docs', 'semantic', 'semantic-catalog.json');
      const catalogContent = readFileSync(catalogPath, 'utf-8');
      const catalog = JSON.parse(catalogContent);
      
      // Get tables based on tier (default to tier1)
      let tables = catalog.tables?.tier1 || [];
      if (tier === 'tier2' || tier === 'all') {
        tables = [...tables, ...(catalog.tables?.tier2 || [])];
      }

      const schemas = await getSchemasForMode(tier, tables);
      
      // Convert Map to plain object for JSON serialization
      const schemasObj: Record<string, TableSchema> = {};
      for (const [tableName, schema] of Array.from(schemas)) {
        schemasObj[tableName] = schema;
      }
      
      res.json({ 
        tier, 
        tables: schemasObj,
        tableCount: schemas.size,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      log(`Failed to get schema for tier ${req.params.tier}: ${error.message}`, 'schema');
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
      log(`PublishDate from database: ${lastUpdate}`, 'last-update');
      
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
    const { question, publishDate } = req.body;

    // Validate question parameter
    if (!question || typeof question !== 'string') {
      return res.status(400).json({
        error: 'Question is required and must be a string',
      });
    }

    // Classify the question: is it a data query or a general/help question?
    const questionType = await classifyQuestion(question);
    
    if (questionType === 'general') {
      log(`General question detected: ${question}`, 'ask');
      const answer = await answerGeneralQuestion(question);
      return res.json({
        isGeneralAnswer: true,
        answer,
        question,
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
      // Matrix classifier selects relevant tables dynamically
      llmStartTime = Date.now();
      const sqlGenResult = await generateSqlFromQuestion(question, { publishDate });
      generatedSql = sqlGenResult.sql;
      const selectedTables = sqlGenResult.selectedTables;
      const confidence = sqlGenResult.confidence;
      llmMs = Date.now() - llmStartTime;
      log(`Generated SQL: ${generatedSql}`, 'ask');
      log(`Matrix-selected tables: ${selectedTables.join(', ')} (confidence: ${confidence})`, 'ask');

      // Handle out-of-scope questions with low/no confidence
      if (confidence === 'none') {
        return res.json({
          isOutOfScope: true,
          answer: `I couldn't find data matching your question in the available PowerBI reports. The system covers:\n\n` +
            `- **Capacity**: Resource utilization, demand vs capacity, shifts, overtime\n` +
            `- **Production**: Jobs, operations, schedules, due dates, lateness, priorities\n` +
            `- **Finance**: Sales orders, purchase orders, inventory levels, materials\n\n` +
            `Try rephrasing your question using terms like: jobs, resources, capacity, demand, orders, inventory, schedule, due date, or lateness.`,
          question,
        });
      }

      // Validate and modify SQL if needed (no table allowlist - all publish.* tables are allowed)
      const validationOptions: ValidationOptions = {};
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
      
      // Validate column references against schema (use matrix-selected tables)
      const columnValidation = await validateSqlColumns(finalSql, selectedTables);
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
        
        // Detect scope-mismatch using semantic catalog keywords
        const questionLower = question.toLowerCase();
        
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

      // Track for FAQ popularity (only queries with results)
      trackQueryForFAQ(question, result.recordset.length);

      // Generate "did you mean?" suggestions asynchronously
      const suggestions = await generateSuggestions(question);

      // Get actual total count if results were limited to 100
      let actualTotalCount: number | undefined;
      if (result.recordset.length === 100) {
        try {
          // Build a count query from the original SQL
          // Extract the FROM clause and everything after it
          const fromIndex = finalSql.toUpperCase().indexOf(' FROM ');
          if (fromIndex > -1) {
            let countSql = 'SELECT COUNT(*) AS TotalCount' + finalSql.substring(fromIndex);
            // Remove ORDER BY clause for count query
            countSql = countSql.replace(/ORDER\s+BY\s+[^;]+/i, '');
            const countResult = await executeQuery(countSql);
            actualTotalCount = countResult.recordset[0]?.TotalCount;
            log(`Actual total count: ${actualTotalCount} (showing first 100)`, 'ask');
          }
        } catch (countError: any) {
          log(`Failed to get total count: ${countError.message}`, 'ask');
        }
      }

      // Check for empty results and find nearest dates if applicable
      let nearestDates: { before: string | null; after: string | null } | undefined;
      if (result.recordset.length === 0) {
        // Check if the query involves date filtering - look for common date columns
        const dateColumns = ['DemandDate', 'CapacityDate', 'ShiftDate', 'JobScheduledStartDateTime', 'PublishDate', 'RequiredAvailableDate'];
        const tableMatch = finalSql.match(/FROM\s+(\[?publish\]?\.\[?\w+\]?)/i);
        
        // Find which date column is used in the query
        let detectedDateColumn: string | null = null;
        for (const col of dateColumns) {
          if (finalSql.toLowerCase().includes(col.toLowerCase())) {
            detectedDateColumn = col;
            break;
          }
        }
        
        if (detectedDateColumn && tableMatch) {
          const tableName = tableMatch[1].replace(/\[/g, '').replace(/\]/g, '');
          
          try {
            // Get the overall date range available in the table (excluding sentinel dates)
            const rangeQuery = `SELECT MIN(${detectedDateColumn}) AS MinDate, MAX(CASE WHEN ${detectedDateColumn} < '2100-01-01' THEN ${detectedDateColumn} ELSE NULL END) AS MaxDate FROM ${tableName} WHERE ${detectedDateColumn} > '1900-01-01'`;
            const rangeResult = await executeQuery(rangeQuery);
            
            const minDate = rangeResult.recordset[0]?.MinDate;
            const maxDate = rangeResult.recordset[0]?.MaxDate;
            
            if (minDate || maxDate) {
              nearestDates = {
                before: minDate ? new Date(minDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : null,
                after: maxDate ? new Date(maxDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : null,
              };
              log(`No data found. Earliest: ${nearestDates.before}, Latest: ${nearestDates.after}`, 'ask');
            }
          } catch (nearestError: any) {
            log(`Failed to find available date range: ${nearestError.message}`, 'ask');
          }
        }
      }

      // Generate natural language response from results
      const naturalAnswer = await generateNaturalLanguageResponse(
        question, 
        result.recordset, 
        result.recordset.length,
        actualTotalCount
      );

      // Cache successful SQL for consistent results on repeat queries
      cacheSuccessfulSql(question, finalSql, selectedTables);

      res.json({
        answer: naturalAnswer,
        sql: finalSql,
        rows: result.recordset,
        rowCount: result.recordset.length,
        actualTotalCount,
        isMock: false,
        suggestions: suggestions.length > 0 ? suggestions : undefined,
        nearestDates,
      });

    } catch (error: any) {
      log(`Error in /api/ask: ${error.message}`, 'ask');

      // Determine error stage and log appropriately
      if (generatedSql) {
        // Error during SQL execution (use validated SQL if available)
        const validationOptions: ValidationOptions = {};
        const validation = validateAndModifySql(generatedSql, validationOptions);
        const failedSql = validation.modifiedSql || generatedSql;
        
        // Detect invalid column name errors (schema mismatch)
        const invalidColumnMatch = error.message?.match(/Invalid column name '([^']+)'/i);
        if (invalidColumnMatch) {
          const invalidColumn = invalidColumnMatch[1];
          log(`🔴 SCHEMA MISMATCH: OpenAI generated SQL with invalid column '${invalidColumn}'`, 'ask');
          log(`Generated SQL with invalid column: ${failedSql}`, 'ask');
          log(`Question: ${question}`, 'ask');
          
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
