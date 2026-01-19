import crypto from 'crypto';
import type { Request } from 'express';

// In-memory store for tracking query frequency (for FAQ feature)
const queryFrequency: Map<string, { count: number; lastUsed: Date; successful: boolean }> = new Map();

// Normalize question for comparison (lowercase, trim, remove extra spaces)
function normalizeQuestion(question: string): string {
  return question.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Track a query for FAQ frequency analysis
 */
export function trackQueryForFAQ(question: string, successful: boolean): void {
  const normalized = normalizeQuestion(question);
  const existing = queryFrequency.get(normalized);
  
  if (existing) {
    existing.count += 1;
    existing.lastUsed = new Date();
    if (successful) existing.successful = true;
  } else {
    queryFrequency.set(normalized, {
      count: 1,
      lastUsed: new Date(),
      successful,
    });
  }
}

/**
 * Get the most popular successful queries for FAQ display
 */
export function getPopularQuestions(limit: number = 10): { question: string; count: number }[] {
  const entries = Array.from(queryFrequency.entries())
    .filter(([_, data]) => data.successful && data.count >= 1)
    .map(([question, data]) => ({
      question: question.charAt(0).toUpperCase() + question.slice(1), // Capitalize first letter
      count: data.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  
  return entries;
}

interface QueryLogEntry {
  timestamp: string;
  requestId: string;
  route: string;
  question: string;
  tenantId?: string;
  userId?: string;
  customerId?: string;
  clientIpHash?: string;
  isMock: boolean;
  generatedSql: string | null;
  sqlHash?: string;
  validationOutcome: {
    ok: boolean;
    reason?: string;
  };
  rowCount: number | null;
  timings: {
    llmMs: number | null;
    sqlMs: number | null;
    totalMs: number;
  };
  error?: {
    stage: string;
    message: string;
  };
}

interface QueryLogContext {
  req: Request;
  question: string;
  startTime: number;
  requestId: string;
}

interface QueryLogResult {
  generatedSql?: string;
  validationOk: boolean;
  validationReason?: string;
  rowCount?: number;
  llmMs?: number;
  sqlMs?: number;
  isMock?: boolean;
  error?: {
    stage: string;
    message: string;
  };
}

/**
 * Generate a unique request ID (UUID v4)
 */
function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Hash sensitive data (like IP addresses) using SHA-256
 */
function hashSensitiveData(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

/**
 * Hash SQL query for privacy when LOG_SQL_TEXT is disabled
 */
function hashSql(sql: string): string {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

/**
 * Extract tenant/user context from request headers
 */
function extractContext(req: Request): {
  tenantId?: string;
  userId?: string;
  customerId?: string;
  clientIpHash?: string;
} {
  const context: {
    tenantId?: string;
    userId?: string;
    customerId?: string;
    clientIpHash?: string;
  } = {};

  // Extract optional headers
  if (req.headers['x-tenant-id']) {
    context.tenantId = req.headers['x-tenant-id'] as string;
  }
  if (req.headers['x-user-id']) {
    context.userId = req.headers['x-user-id'] as string;
  }
  if (req.headers['x-customer-id']) {
    context.customerId = req.headers['x-customer-id'] as string;
  }

  // Hash client IP for privacy (avoid storing full IP)
  const clientIp = req.ip || req.socket.remoteAddress;
  if (clientIp) {
    context.clientIpHash = hashSensitiveData(clientIp);
  }

  return context;
}

/**
 * Check if query logging is enabled
 */
function isLoggingEnabled(): boolean {
  const enableLogging = process.env.ENABLE_QUERY_LOGGING;
  
  // Default to true unless explicitly disabled
  if (enableLogging === undefined) {
    return true;
  }
  
  return enableLogging.toLowerCase() !== 'false';
}

/**
 * Check if SQL text should be logged (vs hash only)
 */
function shouldLogSqlText(): boolean {
  const logSqlText = process.env.LOG_SQL_TEXT;
  
  // Default: true in development, false in production
  if (logSqlText === undefined) {
    return process.env.NODE_ENV !== 'production';
  }
  
  return logSqlText.toLowerCase() === 'true';
}

/**
 * Create initial query log context at the start of a request
 * Generates a unique requestId that persists for the entire request lifecycle
 */
export function createQueryLogContext(req: Request, question: string): QueryLogContext {
  return {
    req,
    question,
    startTime: Date.now(),
    requestId: generateRequestId(),
  };
}

/**
 * Log a query execution (success or failure)
 */
export function logQuery(context: QueryLogContext, result: QueryLogResult): void {
  if (!isLoggingEnabled()) {
    return;
  }

  const totalMs = Date.now() - context.startTime;
  const userContext = extractContext(context.req);
  const logSqlText = shouldLogSqlText();

  const logEntry: QueryLogEntry = {
    timestamp: new Date().toISOString(),
    requestId: context.requestId, // Use persistent requestId from context
    route: '/api/ask',
    question: context.question,
    ...userContext,
    isMock: result.isMock || false,
    generatedSql: null,
    validationOutcome: {
      ok: result.validationOk,
      reason: result.validationReason,
    },
    rowCount: result.rowCount !== undefined ? result.rowCount : null,
    timings: {
      llmMs: result.llmMs !== undefined ? result.llmMs : null,
      sqlMs: result.sqlMs !== undefined ? result.sqlMs : null,
      totalMs,
    },
  };

  // Handle SQL logging based on LOG_SQL_TEXT setting
  if (result.generatedSql) {
    if (logSqlText) {
      // In development or when enabled, log full SQL text
      logEntry.generatedSql = result.generatedSql;
    } else {
      // In production or when disabled, log only hash
      logEntry.generatedSql = null;
      logEntry.sqlHash = hashSql(result.generatedSql);
    }
  }

  // Add error information if present
  if (result.error) {
    logEntry.error = {
      stage: result.error.stage,
      message: result.error.message,
    };
  }

  // Output as single-line JSON for easy parsing
  console.log(JSON.stringify(logEntry));
}

/**
 * Log a query validation failure
 */
export function logValidationFailure(
  context: QueryLogContext,
  generatedSql: string,
  validationError: string,
  llmMs?: number
): void {
  logQuery(context, {
    generatedSql,
    validationOk: false,
    validationReason: validationError,
    rowCount: 0,
    llmMs,
    isMock: false,
    error: {
      stage: 'validation',
      message: validationError,
    },
  });
}

/**
 * Log a query generation failure (LLM error)
 */
export function logGenerationFailure(
  context: QueryLogContext,
  errorMessage: string
): void {
  logQuery(context, {
    validationOk: false,
    rowCount: 0,
    isMock: false,
    error: {
      stage: 'generation',
      message: errorMessage,
    },
  });
}

/**
 * Log a query execution failure (database error)
 */
export function logExecutionFailure(
  context: QueryLogContext,
  generatedSql: string,
  errorMessage: string,
  llmMs?: number
): void {
  logQuery(context, {
    generatedSql,
    validationOk: true,
    rowCount: 0,
    llmMs,
    isMock: false,
    error: {
      stage: 'execution',
      message: errorMessage,
    },
  });
}

/**
 * Log a successful query execution
 */
export function logSuccess(
  context: QueryLogContext,
  generatedSql: string,
  rowCount: number,
  llmMs: number,
  sqlMs: number
): void {
  logQuery(context, {
    generatedSql,
    validationOk: true,
    rowCount,
    llmMs,
    sqlMs,
    isMock: false,
  });
}
