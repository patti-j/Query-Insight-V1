import OpenAI from 'openai';
import { getFormattedSchemaForMode, getModeSchemaStats, getFormattedSchemaForTables } from './mode-schema-cache';
import { selectRelevantTables } from './table-relevance';

// Gracefully handle missing OpenAI credentials
const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.warn('⚠️  WARNING: OpenAI API key not found. AI query generation will not work.');
  console.warn('   Set AI_INTEGRATIONS_OPENAI_API_KEY or OPENAI_API_KEY in Replit Secrets.');
}

export const openai = new OpenAI({
  apiKey: apiKey || 'dummy-key-for-graceful-startup',
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const CORE_SYSTEM_PROMPT = `
You are a SQL query generator for a manufacturing database.

DATABASE: Microsoft SQL Server (Azure SQL Database) - T-SQL dialect
- Use SELECT TOP (N) for row limiting - NEVER use LIMIT, OFFSET, or FETCH
- Use square brackets for identifiers: [schema].[table]
- All queries MUST be SELECT only (no INSERT, UPDATE, DELETE, DROP)
- INNER JOIN, LEFT JOIN, and RIGHT JOIN are allowed
- NEVER use CROSS JOIN

CRITICAL RULES:
- Always include TOP (100) or less in your final SELECT
- Use ONLY the columns listed in the schema below for each table
- DO NOT invent or hallucinate column names
- When user says "next" jobs, sort by date (ORDER BY), don't filter to future dates unless explicitly requested
- For job-level results, use ROW_NUMBER() to deduplicate by JobId when needed

COMMON COLUMN MAPPINGS (if present in schema):
- Plant: Use BlockPlant (name) or PlantId (ID) - NOT PlantCode
- Job: Use JobName (readable ID) or JobId - NOT JobNumber
- Product: Use JobProduct, MOProduct, or JobProductDescription - NOT PartNumber
- Dates: Use JobScheduledStartDateTime/JobScheduledEndDateTime - NOT SchedStartDate/SchedEndDate
- Quantity: Use JobQty, MORequiredQty, OPRequiredFinishQty - NOT QtyScheduled/QtyRequired

BUSINESS CONTEXT:
- JobOnHold: 'OnHold' | 'Released'
- JobScheduledStatus: 'Scheduled' | 'Finished' | 'FailedToSchedule' | 'Template'
- JobNeedDateTime: Primary due date field
- JobOverdue: Boolean (1 = overdue)
`;

interface GenerateOptions {
  mode?: string;
  allowedTables?: string[];
  publishDate?: string; // The effective "today" date for date-relative queries
}

interface GenerateResult {
  sql: string;
  suggestions?: string[];
}

const SUGGESTION_PROMPT = `
You are a query suggestion assistant for a manufacturing database. Given a user's natural language question, generate 2-3 alternative phrasings or related questions that might help clarify or expand their query.

Rules:
- Suggest variations that are more specific or clearer
- Suggest related queries they might also be interested in
- Keep suggestions concise (under 15 words each)
- Return ONLY a JSON array of strings, no other text
- If the question is already very clear, return fewer suggestions

Example input: "show jobs"
Example output: ["Show all overdue jobs", "Show jobs by plant", "Show jobs scheduled for today"]
`;

export async function generateSuggestions(question: string): Promise<string[]> {
  if (!apiKey) {
    return [];
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: SUGGESTION_PROMPT },
        { role: 'user', content: question }
      ],
      temperature: 0.7,
      max_completion_tokens: 200,
    });

    const content = response.choices[0]?.message?.content?.trim() || '[]';
    const suggestions = JSON.parse(content);
    return Array.isArray(suggestions) ? suggestions.slice(0, 3) : [];
  } catch (error) {
    return [];
  }
}

export async function generateSqlFromQuestion(question: string, options: GenerateOptions = {}): Promise<string> {
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Please set AI_INTEGRATIONS_OPENAI_API_KEY in Replit Secrets.');
  }

  const { mode = 'production-planning', allowedTables = [], publishDate } = options;

  // Select 2-4 most relevant tables based on question keywords (prompt slimming)
  const { tables: relevantTables, reasoning } = selectRelevantTables(question, allowedTables.length > 0 ? allowedTables : []);
  
  // Fetch schema for relevant tables only
  let modeSchema = '';
  let stats = { tableCount: 0, columnCount: 0 };
  
  try {
    const startTime = Date.now();
    
    // If we have relevant tables, fetch only those schemas
    if (relevantTables.length > 0 && relevantTables.length < allowedTables.length) {
      modeSchema = await getFormattedSchemaForTables(relevantTables);
      stats = { tableCount: relevantTables.length, columnCount: 0 };
      console.log(`[openai-client] Prompt slimming: ${reasoning}`);
    } else {
      // Fall back to full mode schema
      modeSchema = await getFormattedSchemaForMode(mode);
      stats = await getModeSchemaStats(mode);
    }
    
    const schemaFetchTime = Date.now() - startTime;
    console.log(`[openai-client] Using ${mode} mode schema: ${stats.tableCount} tables (fetched in ${schemaFetchTime}ms)`);
  } catch (error: any) {
    console.error(`[openai-client] Failed to fetch mode schema: ${error.message}. Using fallback.`);
    if (allowedTables.length > 0) {
      modeSchema = `Tables: ${allowedTables.join(', ')}`;
    } else {
      modeSchema = 'All publish.DASHt_* tables available';
    }
  }

  // Mode-specific guidance
  let modeGuidance = '';
  if (mode === 'capacity-plan') {
    modeGuidance = `

CAPACITY PLAN MODE - CRITICAL TABLE RULES:

TABLE-SPECIFIC COLUMNS (only use columns from the correct table):
- DASHt_CapacityPlanning_ResourceCapacity: Has capacity data (NormalOnlineHours, OvertimeHours, etc.)
- DASHt_CapacityPlanning_ResourceDemand: Has demand data (DemandHours, LoadedHours, etc.)
- DASHt_CapacityPlanning_ShiftsCombined: Has shift data (ShiftName, StartTime, EndTime, etc.)
- DASHt_CapacityPlanning_ShiftsCombinedFromLastPublish: Has previous publish shift data for comparison
- DASHt_Resources: Has resource metadata ONLY (ResourceName, WorkcenterName, DepartmentName, PlantName) - NO demand or capacity columns

COMMON MISTAKES TO AVOID:
- DO NOT use DemandHours, Capacity, or LoadedHours on DASHt_Resources - these columns do not exist there
- For demand/capacity analysis: JOIN DASHt_Resources with DASHt_CapacityPlanning_ResourceDemand or DASHt_CapacityPlanning_ResourceCapacity
- For shift comparisons: JOIN DASHt_CapacityPlanning_ShiftsCombined with DASHt_CapacityPlanning_ShiftsCombinedFromLastPublish

BEST PRACTICES:
- When listing resources, use SELECT DISTINCT to avoid duplicate rows
- When grouping by resource, always GROUP BY ResourceName (and other relevant columns)

EXAMPLE QUERIES:

Q: "Which resources are the busiest next week?"
SQL:
SELECT TOP (100) rd.DemandDate, rd.ResourceName, rd.PlantName, rd.DepartmentName, SUM(rd.DemandHours) AS TotalDemandHours
FROM publish.DASHt_CapacityPlanning_ResourceDemand rd
WHERE rd.DemandDate >= '2025-01-06' AND rd.DemandDate < '2025-01-13'
GROUP BY rd.DemandDate, rd.ResourceName, rd.PlantName, rd.DepartmentName
ORDER BY TotalDemandHours DESC

Q: "Show capacity utilization by resource"
SQL:
SELECT TOP (100) rc.ResourceName, rc.PlantName, rc.DepartmentName, 
  SUM(rc.NormalOnlineHours) AS TotalCapacityHours, 
  SUM(rd.DemandHours) AS TotalDemandHours
FROM publish.DASHt_CapacityPlanning_ResourceCapacity rc
LEFT JOIN publish.DASHt_CapacityPlanning_ResourceDemand rd 
  ON rc.ResourceName = rd.ResourceName AND rc.CapacityDate = rd.DemandDate
GROUP BY rc.ResourceName, rc.PlantName, rc.DepartmentName
ORDER BY TotalDemandHours DESC

ONLY use columns explicitly listed in the schema above for each table.`;
  } else if (mode === 'production-planning') {
    modeGuidance = `

PRODUCTION & PLANNING MODE - CRITICAL RULES:
- DO NOT invent or hallucinate aggregate columns like "TotalResourceDemandHours", "TotalDemand", "UtilizationPercentage", etc.
- If totals or aggregates are needed, compute them via SUM(), COUNT(), AVG(), etc. over existing numeric columns listed in the schema above
- If no suitable numeric columns exist in the schema for the requested calculation, DO NOT guess - instead return an error message
- For capacity, demand, or resource utilization questions: This mode does NOT have capacity planning columns - suggest user switch to "Capacity Plan" report
- ONLY use columns explicitly listed in the schema above for tables: DASHt_Planning, DASHt_JobOperationProducts, DASHt_JobOperationAttributes, DASHt_PredecessorOPIds, DASHt_RecentPublishedScenariosArchive

SCHEDULED vs UNSCHEDULED JOBS (CRITICAL):
- JobScheduledStatus column contains: 'Scheduled', 'FailedToSchedule', 'Finished', 'Unscheduled', etc.
- When user asks for "scheduled jobs": ALWAYS add WHERE JobScheduledStatus = 'Scheduled'
- When user asks for "unscheduled jobs": use WHERE JobScheduledStatus IN ('FailedToSchedule', 'Unscheduled')
- Jobs with sentinel dates (9000-01-01, 1800-01-01) are UNSCHEDULED - these should be filtered out
- DO NOT show jobs with JobScheduledStatus = 'FailedToSchedule' when user asks for scheduled jobs

BEST PRACTICES:
- When listing jobs or resources, use SELECT DISTINCT to avoid duplicate rows
- When grouping, always GROUP BY the appropriate columns`;
  } else if (mode === 'finance') {
    modeGuidance = `

FINANCE MODE - SCENARIO-AWARE RULES FOR DASHt_SalesOrders:

SCENARIO CONTROL (CRITICAL):
- If user does NOT mention scenario, ALWAYS add: WHERE ScenarioType = 'Production'
- If user mentions "what-if", "scenario", "copy", "simulation" → allow ScenarioType = 'What-If'
- NEVER mix Production and What-If unless user explicitly asks for comparison
- For comparisons, GROUP BY ScenarioType and/or ScenarioName

EXACT METRIC FORMULAS (use these column names):
- Order Count: COUNT(DISTINCT SalesOrderName)
- Total Demand: SUM(QtyOrdered)
- Shipped Quantity: SUM(QtyShipped)
- Open Quantity: SUM(QtyOrdered - QtyShipped)
- Overdue Orders: RequiredAvailableDate < CAST(GETDATE() AS DATE) AND (QtyOrdered - QtyShipped) > 0
- Revenue: SUM(SalesAmount) - if NULL or zero-heavy, explain limitation

KEY COLUMNS FOR DASHt_SalesOrders:
- Identity: PlanningAreaName, SalesOrderName, SalesOrderId, SalesOrderLineId, LineNumber
- Customer: CustomerName, CustomerExternalId
- Item: ItemName, ItemType, ItemId, LineDescription
- Quantities: QtyOrdered, QtyShipped
- Dates: RequiredAvailableDate, ExpirationDate, PublishDate
- Financial: UnitPrice, SalesAmount
- Status: Cancelled, Hold, HoldReason, Priority
- Scenario: ScenarioId, NewScenarioId, ScenarioName, ScenarioType

BEST PRACTICES:
- When listing orders, customers, or items, use SELECT DISTINCT to avoid duplicate rows
- When grouping, always GROUP BY the appropriate columns

ONLY use columns explicitly listed in the schema above.`;
  }

  // Build the effective "today" date context
  const todayContext = publishDate 
    ? `\nTODAY'S DATE: ${publishDate}\nWhen the user asks about "today", "this week", "next week", "tomorrow", etc., use ${publishDate} as the reference date (not the actual current date).`
    : '';

  const systemPrompt = `${CORE_SYSTEM_PROMPT}

MODE: ${mode.toUpperCase()}${todayContext}

ALLOWED TABLES AND COLUMNS FOR THIS MODE:
${modeSchema}${modeGuidance}

Generate only the SQL query, no explanation. Do not include markdown formatting or code blocks.`;

  const llmStartTime = Date.now();
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: question
      }
    ],
    temperature: 0.3,
    max_completion_tokens: 500,
  });
  const llmTime = Date.now() - llmStartTime;
  
  console.log(`[openai-client] LLM generation completed in ${llmTime}ms`);

  const sqlQuery = response.choices[0]?.message?.content?.trim() || '';
  
  // Remove markdown code blocks if present
  return sqlQuery
    .replace(/```sql\n?/gi, '')
    .replace(/```\n?/g, '')
    .trim();
}

const QUESTION_CLASSIFIER_PROMPT = `
You are a question classifier for a manufacturing analytics system.

Classify the user's question into one of these categories:
- "data_query" - Questions that require fetching data from the database. This includes:
  * Questions with numbers, counts, totals, sums (e.g., "How many hours of backlog?", "What's our total demand?")
  * Questions about specific resources, jobs, workcenters (e.g., "Which resources are busiest?", "Show overdue jobs")
  * Questions with time frames (e.g., "next week", "today", "this month")
  * Questions starting with "Show me", "List", "What are the", "How many", "Which"
  * Any question that implies looking at actual production/planning data
  
- "general" - ONLY questions about concepts, definitions, or system help that don't reference any actual data. Examples:
  * "What is utilization?" (asking for a definition)
  * "How do I use this system?" (asking for help)
  * "What does on-hold mean?" (asking for a term definition)
  * "Explain capacity planning" (asking for a concept explanation)

IMPORTANT: If the question could be answered with data from the database, classify as "data_query".
Only use "general" for pure definitions, concepts, or system help questions.

Return ONLY the category string, nothing else.
`;

export async function classifyQuestion(question: string): Promise<'data_query' | 'general'> {
  if (!apiKey) {
    return 'data_query'; // Default to data query if no API key
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: QUESTION_CLASSIFIER_PROMPT },
        { role: 'user', content: question }
      ],
      temperature: 0,
      max_completion_tokens: 20,
    });

    const result = response.choices[0]?.message?.content?.trim().toLowerCase() || '';
    return result.includes('general') ? 'general' : 'data_query';
  } catch (error) {
    console.error('[openai-client] Question classification failed:', error);
    return 'data_query'; // Default to data query on error
  }
}

const GENERAL_ANSWER_PROMPT = `
You are a helpful assistant for a manufacturing analytics system called Query Insight. This system helps users query planning data from PlanetTogether APS (Advanced Planning and Scheduling).

Answer the user's question in a helpful, conversational way. Keep your response concise (2-4 sentences typically).

MANUFACTURING CONTEXT:
- Resources: Machines, equipment, or labor that perform operations
- Workcenters: Groups of similar resources in a manufacturing facility
- Jobs/Work Orders: Production tasks that need to be scheduled
- Utilization: Percentage of time a resource is being used (demand vs capacity)
- Capacity: The available production time/capability of a resource
- Demand: Work that needs to be done, expressed in hours
- Bottleneck: A resource that limits overall production throughput
- On Hold: Jobs that are paused and not being scheduled
- Scheduled: Jobs that have been assigned times and resources
- Overdue: Jobs past their due date (NeedDateTime)
- Dispatch List: Prioritized list of operations for shop floor execution

SYSTEM CAPABILITIES:
- Users can ask questions in plain English to query manufacturing data
- The system supports three scopes: Capacity Plan (resource planning), Production & Planning (jobs/orders), and Finance (financial analysis)
- Results can be exported to CSV or Excel
- Quick questions provide pre-built common queries

If you don't know something specific to their data, suggest they ask a data query instead.
`;

export async function answerGeneralQuestion(question: string): Promise<string> {
  if (!apiKey) {
    return "I'm unable to answer questions at the moment. Please check that the OpenAI API is configured.";
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: GENERAL_ANSWER_PROMPT },
        { role: 'user', content: question }
      ],
      temperature: 0.7,
      max_completion_tokens: 300,
    });

    return response.choices[0]?.message?.content?.trim() || "I'm not sure how to answer that. Try asking a question about your data instead.";
  } catch (error) {
    console.error('[openai-client] General question answering failed:', error);
    return "I encountered an error trying to answer your question. Please try again.";
  }
}
