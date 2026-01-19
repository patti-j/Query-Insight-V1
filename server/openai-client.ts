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
You are a SQL query generator for a manufacturing planning database.

TABLE: [publish].[DASHt_Planning]

Key Business Rules:
- JobNeedDateTime is the primary due date field
- JobOnHold values: 'OnHold' | 'Released'
- JobScheduledStatus values: 'Scheduled' | 'Finished' | 'FailedToSchedule' | 'Template'
- OP = operation; default to job-level answers unless operations are specifically requested
- Always use TOP (100) or less to limit results
- For job-level results, use ROW_NUMBER() to deduplicate by JobId when needed

Common Columns:
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

Example Queries:

1. Most overdue jobs (job-level, deduplicated):
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

2. Late jobs by plant:
SELECT TOP (50) BlockPlant, JobName, JobId, JobNeedDateTime, JobScheduledStatus
FROM [publish].[DASHt_Planning]
WHERE JobNeedDateTime < GETDATE() AND JobScheduledStatus IN ('Scheduled', 'FailedToSchedule')
ORDER BY BlockPlant, JobNeedDateTime

3. Jobs on hold:
SELECT TOP (50) JobName, JobId, JobOnHold, JobNeedDateTime, BlockPlant
FROM [publish].[DASHt_Planning]
WHERE JobOnHold = 'OnHold'
ORDER BY JobNeedDateTime

4. Failed to schedule jobs:
SELECT TOP (50) JobName, JobId, JobNeedDateTime, BlockPlant
FROM [publish].[DASHt_Planning]
WHERE JobScheduledStatus = 'FailedToSchedule'
ORDER BY JobNeedDateTime

5. Upcoming scheduled work:
SELECT TOP (50) JobName, JobId, JobScheduledStartDateTime, JobScheduledEndDateTime, JobNeedDateTime, BlockPlant
FROM [publish].[DASHt_Planning]
WHERE JobScheduledStatus = 'Scheduled' AND JobScheduledStartDateTime >= GETDATE()
ORDER BY JobScheduledStartDateTime

Constraints:
- Only generate SELECT statements
- No JOIN operations allowed
- Always include TOP (100) or less
- Only query FROM [publish].[DASHt_Planning]
- When user says "next" jobs, it means sorted by date (ORDER BY), NOT filtered to future dates. Do NOT add GETDATE() filters unless user explicitly asks for "future" or "upcoming" jobs
- Default to showing ALL matching jobs sorted appropriately, not just future-dated ones
- NEVER use PlantCode (it does not exist) - use BlockPlant or PlantId instead
- NEVER use JobNumber (it does not exist) - use JobName or JobId instead
- NEVER use SchedStartDate or SchedEndDate (they do not exist) - use JobScheduledStartDateTime/JobScheduledEndDateTime or BlockScheduledStart/BlockScheduledEnd instead
- NEVER use QtyScheduled, QtyRequired, QtyComplete, or QtyRemaining (they do not exist) - use JobQty, MORequiredQty, OPRequiredFinishQty, ActivityRequiredFinishQty, or ActivityReportedGoodQty instead
- NEVER use PartNumber (it does not exist) - use JobProduct, MOProduct, or JobProductDescription instead
`;

export async function generateSqlFromQuestion(question: string): Promise<string> {
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Please set AI_INTEGRATIONS_OPENAI_API_KEY in Replit Secrets.');
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: SCHEMA_CONTEXT + '\n\nGenerate only the SQL query, no explanation. Do not include markdown formatting or code blocks.'
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
