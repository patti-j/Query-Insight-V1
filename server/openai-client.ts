import OpenAI from 'openai';
import { getFormattedSchemaForTables } from './mode-schema-cache';
import { classifyQuestionWithMatrix, getBusinessTermContext } from './matrix-classifier';

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
  allowedTables?: string[];
  publishDate?: string; // The effective "today" date for date-relative queries
}

interface GenerateResult {
  sql: string;
  suggestions?: string[];
  selectedTables?: string[];
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

export async function generateSqlFromQuestion(question: string, options: GenerateOptions = {}): Promise<{ sql: string; selectedTables: string[]; confidence: 'high' | 'medium' | 'low' | 'none' }> {
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Please set AI_INTEGRATIONS_OPENAI_API_KEY in Replit Secrets.');
  }

  const { allowedTables = [], publishDate } = options;

  // Use matrix-driven table selection (3-4 tables default, max 6)
  const classification = classifyQuestionWithMatrix(question);
  
  // Get business term context if any terms matched
  const businessTermContext = getBusinessTermContext(classification.matchedTerms);
  
  // Get context hints from matrix matches
  const contextHintsText = classification.contextHints.length > 0
    ? `\nTABLE SELECTION GUIDANCE:\n${classification.contextHints.join('\n')}\n`
    : '';
  
  // Filter selected tables to only those that exist in allowedTables (if provided)
  let relevantTables = classification.selectedTables;
  if (allowedTables.length > 0) {
    relevantTables = classification.selectedTables.filter(t => 
      allowedTables.some(allowed => allowed.toLowerCase() === t.toLowerCase())
    );
    // If no tables match, use the matrix selection as-is (they might be Tier 1 tables)
    if (relevantTables.length === 0) {
      relevantTables = classification.selectedTables;
    }
  }
  
  // Fetch schema for relevant tables only
  let modeSchema = '';
  let stats = { tableCount: 0, columnCount: 0 };
  
  try {
    const startTime = Date.now();
    
    // Fetch schema for matrix-selected tables with column slimming
    if (relevantTables.length > 0) {
      modeSchema = await getFormattedSchemaForTables(relevantTables, question);
      stats = { tableCount: relevantTables.length, columnCount: 0 };
    } else if (allowedTables.length > 0) {
      // Fall back to allowed tables schema
      modeSchema = await getFormattedSchemaForTables(allowedTables, question);
      stats = { tableCount: allowedTables.length, columnCount: 0 };
    } else {
      modeSchema = 'All publish.DASHt_* tables available';
    }
    
    const schemaFetchTime = Date.now() - startTime;
    console.log(`[openai-client] Matrix-selected ${stats.tableCount} tables (fetched in ${schemaFetchTime}ms)`);
  } catch (error: any) {
    console.error(`[openai-client] Failed to fetch schema: ${error.message}. Using fallback.`);
    if (allowedTables.length > 0) {
      modeSchema = `Tables: ${allowedTables.join(', ')}`;
    } else {
      modeSchema = 'All publish.DASHt_* tables available';
    }
  }

  // Consolidated guidance for all table types
  const tableGuidance = `

CRITICAL TABLE RULES:

CAPACITY PLANNING TABLES:
- DASHt_CapacityPlanning_ResourceCapacity: Has capacity data (NormalOnlineHours, OvertimeHours, etc.)
- DASHt_CapacityPlanning_ResourceDemand: Has demand data (DemandHours, LoadedHours, etc.)
- DASHt_CapacityPlanning_ShiftsCombined: Has shift data (ShiftName, StartTime, EndTime, etc.)
- DASHt_Resources: Has resource metadata ONLY (ResourceName, WorkcenterName, DepartmentName, PlantName) - NO demand or capacity columns
- For demand/capacity analysis: JOIN DASHt_Resources with DASHt_CapacityPlanning_ResourceDemand or DASHt_CapacityPlanning_ResourceCapacity

PRODUCTION PLANNING TABLES:
- DASHt_Planning: Main planning table with job/operation data
- JobScheduledStatus values: 'Scheduled', 'FailedToSchedule', 'Finished', 'Unscheduled'
- When user asks for "scheduled jobs": ALWAYS add WHERE JobScheduledStatus = 'Scheduled'
- When user asks for "unscheduled jobs": use WHERE JobScheduledStatus IN ('FailedToSchedule', 'Unscheduled')
- Jobs with sentinel dates (9000-01-01, 1800-01-01) are UNSCHEDULED - filter them out

FINANCE/SCENARIO-AWARE TABLES (DASHt_SalesOrders):
- If user does NOT mention scenario, ALWAYS add: WHERE ScenarioType = 'Production'
- If user mentions "what-if", "scenario", "copy", "simulation" → allow ScenarioType = 'What-If'
- NEVER mix Production and What-If unless user explicitly asks for comparison

BEST PRACTICES:
- DO NOT invent or hallucinate aggregate columns - compute them via SUM(), COUNT(), AVG()
- When listing items, use SELECT DISTINCT to avoid duplicate rows
- When grouping, always GROUP BY the appropriate columns
- ONLY use columns explicitly listed in the schema below for each table
`;

  // Build the effective "today" date context
  const todayContext = publishDate 
    ? `\nTODAY'S DATE: ${publishDate}\nWhen the user asks about "today", "this week", "next week", "tomorrow", etc., use ${publishDate} as the reference date (not the actual current date).`
    : '';

  const systemPrompt = `${CORE_SYSTEM_PROMPT}
${todayContext}
${businessTermContext}${contextHintsText}
AVAILABLE TABLES AND COLUMNS:
${modeSchema}
${tableGuidance}
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
  const cleanedSql = sqlQuery
    .replace(/```sql\n?/gi, '')
    .replace(/```\n?/g, '')
    .trim();
  
  return {
    sql: cleanedSql,
    selectedTables: relevantTables,
    confidence: classification.confidence
  };
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

const NATURAL_LANGUAGE_RESPONSE_PROMPT = `
You are an AI assistant that summarizes database query results in natural, conversational language.

Given a user's question and the query results, provide a clear, human-readable answer.

FORMATTING RULES:
- Use bullet points (•) when listing multiple items
- Keep responses concise but complete
- Use natural language, not technical jargon
- Format numbers with commas for readability (e.g., 1,234 not 1234)
- Round decimals to 2 places maximum
- IMPORTANT: If the user asked for a specific number (e.g., "top 10", "first 20"), list ALL of those items, not just a subset
- If there are more than 15 items and user didn't specify a count, summarize the top 10 and mention how many total
- If no results, say so clearly and suggest why (e.g., "No data found for this date range")

EXAMPLES:
Question: "Which resources are busiest next week?"
Results: [{"ResourceName": "CNC1", "TotalHours": 45}, {"ResourceName": "Mill 2", "TotalHours": 38}]
Response: "The busiest resources next week are:
• CNC1 with 45 hours of scheduled work
• Mill 2 with 38 hours of scheduled work"

Question: "How many jobs are overdue?"
Results: [{"OverdueCount": 12}]
Response: "There are 12 overdue jobs that need attention."

Question: "List unassigned resources in Plant A"
Results: [{"ResourceName": "Lathe 1"}, {"ResourceName": "Drill 2"}, {"ResourceName": "Press 3"}]
Response: "Unassigned resources in Plant A are:
• Lathe 1
• Drill 2
• Press 3"

Respond with ONLY the natural language answer, no preamble or explanation.
`;

export async function generateNaturalLanguageResponse(
  question: string, 
  results: any[], 
  rowCount: number,
  actualTotalCount?: number
): Promise<string> {
  if (!apiKey) {
    return `Found ${rowCount} result(s).`;
  }

  // If no results, return a simple message
  if (rowCount === 0) {
    return "No matching data was found for your query. Try adjusting the date range or criteria.";
  }

  // Limit results sent to LLM to avoid token overflow
  const limitedResults = results.slice(0, 20);
  const hasMore = rowCount > 20;
  
  // Determine if results were truncated by TOP 100
  const wasLimited = actualTotalCount && actualTotalCount > rowCount;
  const totalToReport = actualTotalCount || rowCount;

  try {
    const limitNote = wasLimited 
      ? `\nIMPORTANT: Results are limited to first ${rowCount} rows. The actual total is ${actualTotalCount}. Mention this in your response, e.g. "Here are the first 100 of ${actualTotalCount} total..."`
      : '';
      
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: NATURAL_LANGUAGE_RESPONSE_PROMPT },
        { 
          role: 'user', 
          content: `Question: "${question}"
Results (${rowCount} returned${wasLimited ? `, ${actualTotalCount} total in database` : ''}${hasMore ? ', showing first 20 for summary' : ''}):
${JSON.stringify(limitedResults, null, 2)}${limitNote}

Provide a natural language summary of these results.`
        }
      ],
      temperature: 0.3,
      max_completion_tokens: 800,
    });

    let answer = response.choices[0]?.message?.content?.trim() || `Found ${totalToReport} result(s).`;
    
    // Add note about additional results if truncated
    if (hasMore && !wasLimited) {
      answer += `\n\n(Showing summary of ${rowCount} total results. Click "Show Data" to see all.)`;
    }
    
    return answer;
  } catch (error) {
    console.error('[openai-client] Natural language response generation failed:', error);
    return wasLimited 
      ? `Found ${actualTotalCount} total results (showing first ${rowCount}). Click "Show Data" to view the details.`
      : `Found ${rowCount} result(s). Click "Show Data" to view the details.`;
  }
}
