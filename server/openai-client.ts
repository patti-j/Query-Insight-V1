import OpenAI from 'openai';
import { getFormattedSchemaForMode, getModeSchemaStats } from './mode-schema-cache';

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

  const { mode = 'planning', allowedTables = [] } = options;

  // Fetch mode-specific schema (trimmed to only relevant tables/columns)
  let modeSchema = '';
  let stats = { tableCount: 0, columnCount: 0 };
  
  try {
    const startTime = Date.now();
    modeSchema = await getFormattedSchemaForMode(mode);
    stats = await getModeSchemaStats(mode);
    const schemaFetchTime = Date.now() - startTime;
    
    console.log(`[openai-client] Using ${mode} mode schema: ${stats.tableCount} tables, ${stats.columnCount} columns (fetched in ${schemaFetchTime}ms)`);
  } catch (error: any) {
    console.error(`[openai-client] Failed to fetch mode schema: ${error.message}. Using fallback.`);
    // Fallback to basic table list if schema fetch fails
    if (allowedTables.length > 0) {
      modeSchema = `Tables: ${allowedTables.join(', ')}`;
    } else {
      modeSchema = 'All publish.DASHt_* tables available';
    }
  }

  const systemPrompt = `${CORE_SYSTEM_PROMPT}

MODE: ${mode.toUpperCase()}

ALLOWED TABLES AND COLUMNS FOR THIS MODE:
${modeSchema}

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
