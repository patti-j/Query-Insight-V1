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
