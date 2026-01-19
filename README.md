# Query Insight

A natural language interface for querying manufacturing planning data with AI-powered SQL generation.

## Features

- **Natural Language Queries**: Ask questions in plain English about your manufacturing data
- **AI-Powered SQL Generation**: Automatically generates safe SQL queries using GPT-5.1
- **Safety Validations**: Enforces SELECT-only queries, no JOINs, and table restrictions
- **Azure SQL Integration**: Connects to `[publish].[DASHt_Planning]` table
- **Real-time Results**: View query results with formatted tables

## Architecture

### Backend

- **Express.js** server with TypeScript
- **Azure SQL** connection via `mssql` package
- **OpenAI Integration** for natural language to SQL conversion (via Replit AI Integrations)
- **SQL Validator** to enforce security constraints

### Frontend

- **React** with TypeScript
- **Wouter** for routing
- **Shadcn/UI** components
- **TailwindCSS** for styling

## API Endpoints

### GET /api/health
Returns server health status.

**Response:**
```json
{
  "ok": true
}
```

### GET /api/db-check
Checks database connectivity by running a simple query.

**Response:**
```json
{
  "ok": true,
  "rowCount": 1,
  "sample": { /* first row data */ }
}
```

### POST /api/ask
Accepts a natural language question and returns SQL query results.

**Request:**
```json
{
  "question": "Show me the most overdue jobs"
}
```

**Response:**
```json
{
  "answer": "Query executed successfully. Retrieved 10 row(s).",
  "sql": "SELECT TOP (10) JobName, PartNumber, JobNeedDateTime FROM [publish].[DASHt_Planning] ...",
  "rows": [ /* query results */ ],
  "rowCount": 10,
  "isMock": false
}
```

## SQL Validation Rules

The application enforces the following safety rules:

1. **SELECT-only**: Only SELECT statements are allowed
2. **Single statement**: No semicolons or multiple queries
3. **No JOINs**: JOIN operations are not permitted (for now)
4. **Table restriction**: Only queries against `[publish].[DASHt_Planning]` are allowed
5. **Row limit**: Automatically enforces `TOP (100)` if not specified

## Environment Variables

Create a `.env` file or use Replit Secrets with the following variables:

### Azure SQL Connection (Required)
```bash
# Option 1: SQL_* prefix
SQL_SERVER=your-server.database.windows.net
SQL_DATABASE=your-database-name
SQL_USER=your-username
SQL_PASSWORD=your-password

# Option 2: AZURE_SQL_* prefix
AZURE_SQL_SERVER=your-server.database.windows.net
AZURE_SQL_DATABASE=your-database-name
AZURE_SQL_USER=your-username
AZURE_SQL_PASSWORD=your-password
```

### OpenAI API (Auto-configured)
If using Replit AI Integrations, these are automatically set:
```bash
AI_INTEGRATIONS_OPENAI_API_KEY=auto-configured
AI_INTEGRATIONS_OPENAI_BASE_URL=auto-configured
```

### Query Logging (Optional)
Control structured audit logging of all query requests:

```bash
# Enable/disable query logging (default: true)
ENABLE_QUERY_LOGGING=true

# Log full SQL text vs hash only (default: true in dev, false in prod)
LOG_SQL_TEXT=true
```

#### What is Logged

Each query request to `/api/ask` generates a structured JSON log entry containing:

- **Request metadata**: timestamp, requestId (UUID), route
- **User context**: question text, optional tenant/user/customer IDs from headers
- **Client info**: hashed client IP (privacy-preserving)
- **Query execution**: generated SQL (or SHA-256 hash), validation outcome, row count
- **Performance timings**: LLM generation time, SQL execution time, total time
- **Errors**: stage (generation/validation/execution) and message (no stack traces in production)

**Privacy & Security:**
- SQL credentials, access tokens, and full row data are **never** logged
- Client IPs are hashed using SHA-256 (only first 16 chars stored)
- In production (when `LOG_SQL_TEXT=false`), only SQL hashes are logged, not full SQL text
- Tenant/user/customer context is captured from optional headers (`x-tenant-id`, `x-user-id`, `x-customer-id`)

#### Example Log Output

**Successful query (with LOG_SQL_TEXT=true):**
```json
{
  "timestamp": "2026-01-15T23:30:45.123Z",
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "route": "/api/ask",
  "question": "Show the 5 most overdue jobs",
  "clientIpHash": "a3f2e1d9c8b7a6f5",
  "isMock": false,
  "generatedSql": "WITH ranked AS (...) SELECT TOP (5) ...",
  "validationOutcome": {"ok": true},
  "rowCount": 5,
  "timings": {"llmMs": 1234, "sqlMs": 56, "totalMs": 1290}
}
```

**Successful query (with LOG_SQL_TEXT=false, production mode):**
```json
{
  "timestamp": "2026-01-15T23:30:45.123Z",
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "route": "/api/ask",
  "question": "Show the 5 most overdue jobs",
  "clientIpHash": "a3f2e1d9c8b7a6f5",
  "isMock": false,
  "generatedSql": null,
  "sqlHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "validationOutcome": {"ok": true},
  "rowCount": 5,
  "timings": {"llmMs": 1234, "sqlMs": 56, "totalMs": 1290}
}
```

**Validation failure:**
```json
{
  "timestamp": "2026-01-15T23:31:12.456Z",
  "requestId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "route": "/api/ask",
  "question": "SELECT JobName, PlantCode FROM table",
  "clientIpHash": "b4g3f2e1d0c9b8a7",
  "isMock": false,
  "generatedSql": "SELECT TOP (100) JobName, PlantCode FROM [publish].[DASHt_Planning]",
  "validationOutcome": {
    "ok": false,
    "reason": "Column \"PlantCode\" does not exist. Use \"BlockPlant\" for plant name..."
  },
  "rowCount": 0,
  "timings": {"llmMs": 987, "sqlMs": null, "totalMs": 995},
  "error": {"stage": "validation", "message": "Column \"PlantCode\" does not exist..."}
}
```

**Execution failure:**
```json
{
  "timestamp": "2026-01-15T23:32:30.789Z",
  "requestId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
  "route": "/api/ask",
  "question": "Show jobs for invalid table",
  "clientIpHash": "c5h4g3f2e1d0c9b8",
  "isMock": false,
  "generatedSql": "SELECT TOP (100) JobName FROM [publish].[InvalidTable]",
  "validationOutcome": {"ok": false, "reason": "Only queries against [publish].[DASHt_Planning] are allowed"},
  "rowCount": 0,
  "timings": {"llmMs": 876, "sqlMs": null, "totalMs": 890},
  "error": {"stage": "execution", "message": "Invalid object name 'publish.InvalidTable'"}
}
```

#### Disabling Query Logging

To disable logging completely:
```bash
ENABLE_QUERY_LOGGING=false
```

To log only SQL hashes (not full SQL text):
```bash
LOG_SQL_TEXT=false
```

## Running Locally in Replit

1. **Set Environment Variables**: Add your Azure SQL credentials to Replit Secrets
   - Navigate to "Tools" → "Secrets"
   - Add: `SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD`

2. **Run the Application**:
   ```bash
   npm run dev
   ```

3. **Access the App**: The app will be available at `https://your-repl-url.replit.dev`

## Database Schema Context

The application queries the `[publish].[DASHt_Planning]` table with the following key fields:

### Key Columns
- `JobNeedDateTime`: Primary due date
- `JobOnHold`: Values: 'OnHold' | 'Released'
- `JobScheduledStatus`: Values: 'Scheduled' | 'Finished' | 'FailedToSchedule' | 'Template'
- `JobName`, `JobId`: Job identifiers (JobName is preferred human-readable identifier)
- `MOName`, `MOId`: Manufacturing order name and ID
- `JobProduct`, `JobProductDescription`: Job product name and description
- `MOProduct`: Manufacturing order product
- `BlockPlant`: Manufacturing plant name (use for display)
- `PlantId`: Plant identifier (numeric ID)
- `CustomerName`: Customer name
- `Priority`: Job priority
- `JobOverdue`: Boolean (1 = overdue)
- `JobOverdueDays`: Days overdue
- `JobLate`, `JobLatenessDays`: Late status and days
- `JobQty`: Job-level quantity
- `MORequiredQty`: Manufacturing order required quantity
- `OPRequiredFinishQty`, `ActivityRequiredFinishQty`: Operation/activity required finish quantity
- `ActivityReportedGoodQty`: Reported good quantity
- `JobScheduledStartDateTime`, `JobScheduledEndDateTime`: Job-level scheduled start/end dates
- `BlockScheduledStart`, `BlockScheduledEnd`: Block-level scheduled start/end dates

**Important Column Corrections:**
- `PlantCode` does NOT exist. Use `BlockPlant` for plant name or `PlantId` for plant ID.
- `JobNumber` does NOT exist. Use `JobName` (preferred human-readable identifier) or `JobId` (numeric ID).
- `PartNumber` does NOT exist. Use `JobProduct` (job product), `MOProduct` (MO product), or `JobProductDescription` (product description).
- `SchedEndDate` and `SchedStartDate` do NOT exist. Use `JobScheduledEndDateTime`/`JobScheduledStartDateTime` for job-level scheduled dates, or `BlockScheduledEnd`/`BlockScheduledStart` for block-level scheduled dates.
- `QtyScheduled`, `QtyRequired`, `QtyComplete`, `QtyRemaining` do NOT exist. Use `JobQty` (job-level), `MORequiredQty` (MO-level), `OPRequiredFinishQty`/`ActivityRequiredFinishQty` (operation/activity-level), or `ActivityReportedGoodQty` (reported good quantity).

### Example Questions
- "Show me the most overdue jobs"
- "Which jobs are on hold?"
- "List jobs that failed to schedule"
- "What work is scheduled for next week?"
- "Show late jobs by plant"

## File Structure

```
├── server/
│   ├── index.ts                    # Express server entry point
│   ├── routes.ts                   # API route handlers
│   ├── db-azure.ts                 # Azure SQL connection pool
│   ├── sql-validator.ts            # SQL safety validation
│   ├── openai-client.ts            # OpenAI integration for SQL generation
│   ├── query-logger.ts             # Structured audit logging
│   └── dasht-planning-schema.ts    # Column allowlist validation
├── client/
│   └── src/
│       ├── App.tsx           # React app entry
│       └── pages/
│           └── query.tsx     # Main query interface
├── shared/
│   └── schema.ts             # Shared TypeScript types
└── package.json
```

## Development

### Building for Production
```bash
npm run build
```

### Type Checking
```bash
npm run check
```

### Database Migrations
```bash
npm run db:push
```

## Modified Files

**Backend:**
- `server/routes.ts` - API endpoints implementation
- `server/db-azure.ts` - Azure SQL connection utility
- `server/sql-validator.ts` - SQL safety validator
- `server/openai-client.ts` - Natural language to SQL generator

**Frontend:**
- `client/src/pages/query.tsx` - Query interface page
- `client/src/App.tsx` - Added routing to query page
- `client/index.html` - Updated meta tags and title

**Configuration:**
- `package.json` - Added mssql and OpenAI dependencies
- `.env.example` - Environment variable template

## Security Notes

- SQL queries are validated before execution
- Only SELECT statements are permitted
- Database credentials are stored in environment variables (never logged)
- Row limits are enforced to prevent excessive data retrieval
- Table access is restricted to `[publish].[DASHt_Planning]` only
