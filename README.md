# Query Insight V1

Query Insight is a lightweight web app for exploring PlanetTogether analytics data using **Azure SQL** as the backing data source, with guardrails that keep queries aligned to curated **Power BI “DASH” tables**.

---

## Tech Stack

**Frontend**
- TypeScript (React)
- Vite (build + dev server)
- HTML / CSS

**Backend**
- Node.js (TypeScript)
- Server-side SQL execution against Azure SQL
- Environment-based configuration (no credentials in repo)

**Data & Analytics**
- Azure SQL Database
- Curated analytics tables in `publish.DASHt_*`
- Power BI–aligned semantics (Planning, Capacity, Dispatch)

**DevOps / Workflow**
- GitHub — source of truth
- Replit — development & preview environment
- Azure — target deployment platform

---

## What this is
- Chat-style query UI (web)
- Server-side SQL execution against Azure SQL
- PowerBI-aligned semantics via curated tables in schema `publish`
- Three primary analysis modes:
  - **Planning** (default)
  - **Capacity**
  - **Dispatch**
 
---

## AI-Assisted Query Generation

Query Insight uses **OpenAI** to assist with translating natural-language questions into SQL.  
AI is used strictly for **query generation**, not execution, and is always governed by server-side safety controls.

### How it works
1. A user submits a natural-language question and selects a semantic mode (Planning, Capacity, Dispatch).
2. The backend constructs a system prompt that includes:
   - The selected semantic mode
   - Allowed tables (`publish.DASHt_*`)
   - SQL syntax and safety rules
   - Live schema metadata (table and column names)
3. The prompt is sent to the **OpenAI API**, which generates a candidate SQL query.
4. The backend validates the generated SQL before execution:
   - `SELECT` statements only
   - Allowlisted tables and restricted JOIN patterns
   - Row limits enforced
   - Schema validation to prevent unsafe or unsupported access
5. Valid SQL is executed against Azure SQL and results are returned to the UI.

### Trust & governance model
- AI **never executes SQL directly**
- All queries run server-side with read-only permissions
- Queries are constrained to curated analytics tables aligned with Power BI
- Invalid or unsafe queries are rejected before reaching the database

This design provides the flexibility of natural-language analytics while preserving the same data trust model used for enterprise reporting.


## Data model conventions
The database includes curated analytics tables (materialized tables) prefixed with:
- `publish.DASHt_*`

These tables are produced from other `publish.*` objects and are designed for Power BI reporting. Query Insight defaults to these curated tables to keep results consistent with reporting logic.

## Configuration
Set environment variables via **Replit Secrets**, **Azure App Service configuration**, or a local `.env`.

### Required
#### Preferred (single connection string)
- `DATABASE_URL` — Azure SQL connection string (recommended)

Use the Azure SQL connection string format from the Azure Portal. **Do not commit credentials to GitHub.**

#### Alternative (discrete secrets)
- `SQL_SERVER`
- `SQL_DATABASE`
- `SQL_USER`
- `SQL_PASSWORD`

### Optional
- `DIAGNOSTICS_TOKEN` — protects DB diagnostics endpoints if enabled

## Semantic modes
The app supports a **semantic mode** selector to keep SQL generation aligned with Power BI report logic.

### Planning (default)
- `publish.DASHt_Planning`
- `publish.DASHt_JobOperationProducts`
- `publish.DASHt_JobOperationAttributes`

### Capacity
- `publish.DASHt_CapacityPlanning_ResourceDemand`
- `publish.DASHt_CapacityPlanning_ResourceCapacity`
- `publish.DASHt_CapacityPlanning_ResourceActual`
- `publish.DASHt_CapacityPlanning_ShiftsCombined`
- `publish.DASHt_CapacityPlanning_ShiftsCombinedFromLastPublish`

### Dispatch
- `publish.DASHt_Planning`
- `publish.DASHt_JobOperationProducts`
- `publish.DASHt_JobOperationAttributes`

### Advanced mode
An optional Advanced toggle allows querying other `publish.*` tables when needed. Even in advanced mode:
- Only `SELECT` statements are allowed
- Row limits are enforced

## Diagnostics
Optional DB diagnostics can verify connectivity and table access:
- Metadata checks for `publish.DASHt_*`
- Lightweight per-table probes (`SELECT TOP (0)`)

## Notes
- `docs/_project-notes.md` — living technical log
- `docs/_todo.md` — lightweight task tracker
