# Query Insight V1

Query Insight is a lightweight web app for exploring PlanetTogether analytics data using **Azure SQL** as the backing data source, with guardrails that keep queries aligned to curated **Power BI “DASH” tables**.

## What this is
- Chat-style query UI (web)
- Server-side SQL execution against Azure SQL
- PowerBI-aligned semantics via curated tables in schema `publish` (notably `publish.DASHt_*`)
- Three primary analysis modes:
  - Planning (default)
  - Capacity
  - Dispatch

## Data model conventions
The database includes curated analytics tables (materialized tables) prefixed with:
- `publish.DASHt_*`

These tables are produced from other `publish.*` objects and are designed for Power BI reporting. Query Insight defaults to these curated tables to keep results consistent with reporting logic.

## Configuration
Set environment variables via **Replit Secrets**, **Azure App Service configuration**, or a local `.env`.

### Required
#### Preferred (single connection string)
- `DATABASE_URL` — Azure SQL connection string (recommended)

Use the Azure SQL connection string format (see Azure Portal for the exact template for your server/db). Do not commit credentials to GitHub.

#### Alternative (discrete secrets)
If you prefer split values, the app can fall back to:
- `SQL_SERVER`
- `SQL_DATABASE`
- `SQL_USER`
- `SQL_PASSWORD`

### Optional
- `DIAGNOSTICS_TOKEN` — if set, database diagnostics endpoints require this token via a request header.

## Semantic modes
The app supports a **semantic mode** selector to keep SQL generation/validation aligned with the relevant Power BI report area.

### Planning (default)
Primary curated tables:
- `publish.DASHt_Planning`
- `publish.DASHt_JobOperationProducts`
- `publish.DASHt_JobOperationAttributes`

Common supporting curated tables may include:
- `publish.DASHt_Materials`, `publish.DASHt_Resources`, `publish.DASHt_Inventories`, `publish.DASHt_NetInventoryBalance`, `publish.DASHt_SalesOrders`, `publish.DASHt_PurchaseOrders`, `publish.DASHt_TranLog`

### Capacity
Primary curated tables:
- `publish.DASHt_CapacityPlanning_ResourceDemand`
- `publish.DASHt_CapacityPlanning_ResourceCapacity`
- `publish.DASHt_CapacityPlanning_ResourceActual`
- `publish.DASHt_CapacityPlanning_ShiftsCombined`
- `publish.DASHt_CapacityPlanning_ShiftsCombinedFromLastPublish`

### Dispatch
Primary curated tables:
- `publish.DASHt_Planning`
- `publish.DASHt_JobOperationProducts`
- `publish.DASHt_JobOperationAttributes`

### Advanced mode
An optional Advanced toggle can allow querying other `publish.*` tables when needed. Even in advanced mode, the app should:
- block non-`SELECT` statements
- enforce row limits (`TOP`/pagination)

## Diagnostics
A DB diagnostics feature can be enabled to verify connectivity and permissions.
- Metadata query: lists `publish.DASHt_*` objects
- Per-table probe: uses lightweight `SELECT TOP (0)` checks

If `DIAGNOSTICS_TOKEN` is set, requests must include a matching header.

## Development workflow
- GitHub is the source of truth.
- Replit is used for fast iteration and preview.
- Azure is the target deployment platform.

## Notes
See:
- `docs/_project-notes.md` — living technical log
- `docs/_todo.md` — lightweight task tracker
