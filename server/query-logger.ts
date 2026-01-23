import crypto from 'crypto';
import type { Request } from 'express';
import fs from 'fs';
import path from 'path';

const FAQ_FILE = path.join(process.cwd(), 'data', 'popular-queries.json');
const QUERY_LOG_FILE = path.join(process.cwd(), 'data', 'query-logs.json');

interface QueryFrequencyData {
  count: number;
  lastUsed: string;
  successful: boolean;
}

// Load FAQ data from file on startup
function loadFAQData(): Map<string, QueryFrequencyData> {
  try {
    if (fs.existsSync(FAQ_FILE)) {
      const data = JSON.parse(fs.readFileSync(FAQ_FILE, 'utf-8'));
      return new Map(Object.entries(data));
    }
  } catch (err) {
    console.error('Failed to load FAQ data:', err);
  }
  return new Map();
}

// Save FAQ data to file
function saveFAQData(data: Map<string, QueryFrequencyData>): void {
  try {
    const dir = path.dirname(FAQ_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(FAQ_FILE, JSON.stringify(Object.fromEntries(data), null, 2));
  } catch (err) {
    console.error('Failed to save FAQ data:', err);
  }
}

// In-memory store for tracking query frequency (for FAQ feature) - loaded from file
const queryFrequency: Map<string, QueryFrequencyData> = loadFAQData();

// In-memory store for feedback (thumbs up/down)
interface FeedbackEntry {
  question: string;
  sql: string;
  feedback: 'up' | 'down';
  timestamp: Date;
  comment?: string;
}
const feedbackStore: FeedbackEntry[] = [];

// Load query logs from file on startup
function loadQueryLogs(): QueryLogEntry[] {
  try {
    if (fs.existsSync(QUERY_LOG_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUERY_LOG_FILE, 'utf-8'));
      console.log(`[query-logger] Loaded ${data.length} query logs from file`);
      return data;
    }
  } catch (err) {
    console.error('[query-logger] Failed to load query logs:', err);
  }
  return [];
}

// Save query logs to file
function saveQueryLogs(logs: QueryLogEntry[]): void {
  try {
    const dir = path.dirname(QUERY_LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(QUERY_LOG_FILE, JSON.stringify(logs, null, 2));
  } catch (err) {
    console.error('[query-logger] Failed to save query logs:', err);
  }
}

// In-memory store for detailed query logs (for analytics dashboard) - loaded from file
const queryLogs: QueryLogEntry[] = loadQueryLogs();
const MAX_LOG_ENTRIES = 500; // Keep last 500 entries

/**
 * Store feedback for a query result
 */
export function storeFeedback(
  question: string,
  sql: string,
  feedback: 'up' | 'down',
  comment?: string
): void {
  feedbackStore.push({
    question,
    sql,
    feedback,
    timestamp: new Date(),
    comment,
  });
}

/**
 * Get recent feedback entries
 */
export function getRecentFeedback(limit: number = 50): FeedbackEntry[] {
  return feedbackStore.slice(-limit).reverse();
}

/**
 * Get feedback statistics
 */
export function getFeedbackStats(): { total: number; positive: number; negative: number } {
  const positive = feedbackStore.filter(f => f.feedback === 'up').length;
  const negative = feedbackStore.filter(f => f.feedback === 'down').length;
  return {
    total: feedbackStore.length,
    positive,
    negative,
  };
}

// Normalize question for comparison (lowercase, trim, remove extra spaces)
function normalizeQuestion(question: string): string {
  return question.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Track a query for FAQ frequency analysis
 * Only tracks queries that returned results (rowCount > 0)
 */
export function trackQueryForFAQ(question: string, rowCount: number): void {
  // Only track queries that returned actual results
  if (rowCount <= 0) {
    return;
  }
  
  const normalized = normalizeQuestion(question);
  const existing = queryFrequency.get(normalized);
  
  if (existing) {
    existing.count += 1;
    existing.lastUsed = new Date().toISOString();
    existing.successful = true;
  } else {
    queryFrequency.set(normalized, {
      count: 1,
      lastUsed: new Date().toISOString(),
      successful: true,
    });
  }
  
  // Persist to file
  saveFAQData(queryFrequency);
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
  
  // Store in memory for analytics (keep last MAX_LOG_ENTRIES)
  queryLogs.push(logEntry);
  if (queryLogs.length > MAX_LOG_ENTRIES) {
    queryLogs.shift(); // Remove oldest entry
  }
  
  // Persist to file
  saveQueryLogs(queryLogs);
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

/**
 * Get analytics data for dashboard
 */
export function getAnalytics(timeRangeMinutes: number = 60): {
  summary: {
    totalQueries: number;
    successfulQueries: number;
    failedQueries: number;
    averageLatency: number;
    averageLlmMs: number;
    averageSqlMs: number;
  };
  errorBreakdown: Array<{ stage: string; count: number; percentage: number }>;
  performanceOverTime: Array<{ timestamp: string; latency: number; llmMs: number; sqlMs: number }>;
  topErrors: Array<{ message: string; count: number; lastOccurred: string }>;
  recentQueries: Array<{
    timestamp: string;
    question: string;
    success: boolean;
    latency: number;
    rowCount: number | null;
    error?: string;
  }>;
} {
  const cutoffTime = new Date(Date.now() - timeRangeMinutes * 60 * 1000);
  const recentLogs = queryLogs.filter(log => new Date(log.timestamp) >= cutoffTime);

  // Summary statistics
  const totalQueries = recentLogs.length;
  const successfulQueries = recentLogs.filter(log => !log.error).length;
  const failedQueries = totalQueries - successfulQueries;
  
  const latencies = recentLogs.map(log => log.timings.totalMs);
  const averageLatency = latencies.length > 0 
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length 
    : 0;
  
  const llmTimes = recentLogs.map(log => log.timings.llmMs).filter((ms): ms is number => ms !== null);
  const averageLlmMs = llmTimes.length > 0
    ? llmTimes.reduce((a, b) => a + b, 0) / llmTimes.length
    : 0;
  
  const sqlTimes = recentLogs.map(log => log.timings.sqlMs).filter((ms): ms is number => ms !== null);
  const averageSqlMs = sqlTimes.length > 0
    ? sqlTimes.reduce((a, b) => a + b, 0) / sqlTimes.length
    : 0;

  // Error breakdown by stage
  const errorsByStage = new Map<string, number>();
  recentLogs.filter(log => log.error).forEach(log => {
    const stage = log.error!.stage;
    errorsByStage.set(stage, (errorsByStage.get(stage) || 0) + 1);
  });
  
  const errorBreakdown = Array.from(errorsByStage.entries()).map(([stage, count]) => ({
    stage,
    count,
    percentage: (count / Math.max(failedQueries, 1)) * 100,
  }));

  // Performance over time (sample every minute or every 10 queries)
  const performanceOverTime = recentLogs
    .filter(log => !log.error)
    .slice(-50) // Last 50 successful queries
    .map(log => ({
      timestamp: log.timestamp,
      latency: log.timings.totalMs,
      llmMs: log.timings.llmMs || 0,
      sqlMs: log.timings.sqlMs || 0,
    }));

  // Top errors
  const errorMessages = new Map<string, { count: number; lastOccurred: string }>();
  recentLogs.filter(log => log.error).forEach(log => {
    const message = log.error!.message.substring(0, 100); // Truncate long messages
    const existing = errorMessages.get(message);
    if (existing) {
      existing.count++;
      if (log.timestamp > existing.lastOccurred) {
        existing.lastOccurred = log.timestamp;
      }
    } else {
      errorMessages.set(message, { count: 1, lastOccurred: log.timestamp });
    }
  });
  
  const topErrors = Array.from(errorMessages.entries())
    .map(([message, data]) => ({
      message,
      count: data.count,
      lastOccurred: data.lastOccurred,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Recent queries
  const recentQueries = recentLogs.slice(-20).reverse().map(log => ({
    timestamp: log.timestamp,
    question: log.question,
    success: !log.error,
    latency: log.timings.totalMs,
    rowCount: log.rowCount,
    error: log.error?.message,
  }));

  return {
    summary: {
      totalQueries,
      successfulQueries,
      failedQueries,
      averageLatency: Math.round(averageLatency),
      averageLlmMs: Math.round(averageLlmMs),
      averageSqlMs: Math.round(averageSqlMs),
    },
    errorBreakdown,
    performanceOverTime,
    topErrors,
    recentQueries,
  };
}

/**
 * Get failed queries for analysis (includes full SQL and error details)
 */
export function getFailedQueries(limit: number = 50): Array<{
  timestamp: string;
  question: string;
  generatedSql: string | null;
  errorStage: string;
  errorMessage: string;
  llmMs: number | null;
}> {
  return queryLogs
    .filter(log => log.error)
    .slice(-limit)
    .reverse()
    .map(log => ({
      timestamp: log.timestamp,
      question: log.question,
      generatedSql: log.generatedSql,
      errorStage: log.error!.stage,
      errorMessage: log.error!.message,
      llmMs: log.timings.llmMs,
    }));
}
