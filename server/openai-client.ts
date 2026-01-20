import OpenAI from 'openai';

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

const SCHEMA_CONTEXT = `
You are a SQL query generator for a manufacturing database with multiple table schemas.

AVAILABLE SCHEMAS:
- Planning tables: DASHt_Planning, DASHt_JobOperationProducts, DASHt_JobOperationAttributes, DASHt_Materials, DASHt_Resources, DASHt_Inventories, etc.
- Capacity Planning tables: DASHt_CapacityPlanning_ResourceDemand, DASHt_CapacityPlanning_ResourceCapacity, DASHt_CapacityPlanning_ResourceActual, etc.
- All tables are in the [publish] schema with prefix DASHt_

Key Business Rules (Planning Tables):
- JobNeedDateTime is the primary due date field
- JobOnHold values: 'OnHold' | 'Released'
- JobScheduledStatus values: 'Scheduled' | 'Finished' | 'FailedToSchedule' | 'Template'
- OP = operation; default to job-level answers unless operations are specifically requested
- Always use TOP (100) or less to limit results
- For job-level results, use ROW_NUMBER() to deduplicate by JobId when needed

Common Columns (DASHt_Planning):
- JobNeedDateTime: Due date/need date
- JobOnHold: Hold status
- JobScheduledStatus: Scheduling status
- BlockPlant: Manufacturing plant name (use for display)
- PlantId: Plant identifier (numeric ID)
- JobName, JobId: Job identifiers (JobName is the preferred human-readable job identifier)
- MOName, MOId: Manufacturing order name and ID
- JobProduct, JobProductDescription: Job product name and description
- MOProduct: Manufacturing order product
- CustomerName: Customer name
- Priority: Job priority
- JobOverdue: Boolean (1 = overdue)
- JobOverdueDays: Days overdue
- JobLate, JobLatenessDays: Late status and days
- JobQty: Job-level quantity
- MORequiredQty: Manufacturing order required quantity
- OPRequiredFinishQty, ActivityRequiredFinishQty: Operation/activity required finish quantity
- ActivityRequiredStartQty: Activity required start quantity
- ActivityReportedGoodQty: Reported good quantity
- JobScheduledStartDateTime, JobScheduledEndDateTime: Job-level scheduled start/end dates
- BlockScheduledStart, BlockScheduledEnd: Block-level scheduled start/end dates
- OPCommitEndDate, OPNeedDate: Operation-level dates

IMPORTANT COLUMN CORRECTIONS:
- PlantCode does NOT exist. Use BlockPlant for plant name or PlantId for plant ID.
- JobNumber does NOT exist. Use JobName (preferred human-readable identifier) or JobId.
- PartNumber does NOT exist. Use JobProduct (job product name), MOProduct (MO product), or JobProductDescription (product description).
- SchedStartDate and SchedEndDate do NOT exist. Use JobScheduledStartDateTime/JobScheduledEndDateTime for job-level or BlockScheduledStart/BlockScheduledEnd for block-level.
- QtyScheduled, QtyRequired, QtyComplete, QtyRemaining do NOT exist. Use JobQty (job-level), MORequiredQty (MO-level), OPRequiredFinishQty/ActivityRequiredFinishQty (operation/activity-level), or ActivityReportedGoodQty (reported good).

Example Query (Planning Mode):
WITH ranked AS (
  SELECT
    JobName,
    JobId,
    MOName,
    CustomerName,
    BlockPlant,
    Priority,
    JobNeedDateTime,
    JobOverdue,
    JobOverdueDays,
    JobLate,
    JobLatenessDays,
    ROW_NUMBER() OVER (
      PARTITION BY JobId
      ORDER BY JobOverdueDays DESC, JobNeedDateTime ASC
    ) AS rn
  FROM [publish].[DASHt_Planning]
  WHERE JobOverdue = 1
)
SELECT TOP (5)
  JobName,
  JobId,
  MOName,
  CustomerName,
  BlockPlant,
  Priority,
  JobNeedDateTime,
  JobOverdueDays,
  JobLatenessDays
FROM ranked
WHERE rn = 1
ORDER BY JobOverdueDays DESC, Priority ASC, JobNeedDateTime ASC

Global Constraints:
- Only generate SELECT statements
- No JOIN operations allowed
- Always include TOP (100) or less
- Use only tables from the allowed list provided in the MODE context (see below)
- When user says "next" jobs, it means sorted by date (ORDER BY), NOT filtered to future dates. Do NOT add GETDATE() filters unless user explicitly asks for "future" or "upcoming" jobs
- Default to showing ALL matching jobs sorted appropriately, not just future-dated ones
- NEVER use PlantCode (it does not exist) - use BlockPlant or PlantId instead
- NEVER use JobNumber (it does not exist) - use JobName or JobId instead
- NEVER use SchedStartDate or SchedEndDate (they do not exist) - use JobScheduledStartDateTime/JobScheduledEndDateTime or BlockScheduledStart/BlockScheduledEnd instead
- NEVER use QtyScheduled, QtyRequired, QtyComplete, or QtyRemaining (they do not exist) - use JobQty, MORequiredQty, OPRequiredFinishQty, ActivityRequiredFinishQty, or ActivityReportedGoodQty instead
- NEVER use PartNumber (it does not exist) - use JobProduct, MOProduct, or JobProductDescription instead
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
      model: 'gpt-4o-mini',
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

  // Build mode-specific context
  let modeContext = '';
  if (allowedTables.length > 0) {
    const tableList = allowedTables.join(', ');
    modeContext = `\n\nMODE: ${mode.toUpperCase()}\nALLOWED TABLES for this mode:\n${tableList}\n\nYou MUST use only these tables for this query. Do not use any other tables.`;
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: SCHEMA_CONTEXT + modeContext + '\n\nGenerate only the SQL query, no explanation. Do not include markdown formatting or code blocks.'
      },
      {
        role: 'user',
        content: question
      }
    ],
    temperature: 0.3,
    max_completion_tokens: 500,
  });

  const sqlQuery = response.choices[0]?.message?.content?.trim() || '';
  
  // Remove markdown code blocks if present
  return sqlQuery
    .replace(/```sql\n?/gi, '')
    .replace(/```\n?/g, '')
    .trim();
}
