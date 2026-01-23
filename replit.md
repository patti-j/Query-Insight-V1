# Query Insight V1

## Overview

Query Insight is a natural language interface designed to query manufacturing planning data from PlanetTogether analytics. It allows users to ask questions in plain English, which are then translated into SQL queries against an Azure SQL database using OpenAI. The system targets curated Power BI reporting tables, providing insights across various contexts such as Production & Planning, Capacity Plan, Dispatch List, Inventories, Sales Orders, Schedule Conformance, and AuditLog, with additional contexts planned for future releases. The core purpose is to democratize access to complex manufacturing planning data through an intuitive conversational interface, enhancing data accessibility and decision-making.

## User Preferences

Preferred communication style: Simple, everyday language.
Code quality expectation: Production-ready, clean code suitable for dev team code review.
Cleanup approach: Clean up incrementally as features are built, not in large batches at the end.

## System Architecture

**Frontend:** The application utilizes React with TypeScript, Vite for efficient development and builds, and Tailwind CSS v4 alongside shadcn/ui components for a modern UI/UX. TanStack Query manages server state, and Wouter handles client-side routing.

**Backend:** Built with Node.js and TypeScript, the backend directly queries Azure SQL databases using the `mssql` package. It integrates with the OpenAI API for natural language to SQL translation.

**Data Flow:**
1. User input (natural language question) is sent to the backend.
2. The backend forwards the question and relevant schema context to OpenAI.
3. OpenAI generates an SQL query.
4. A robust SQL validator performs safety checks (e.g., SELECT statements only, allowed tables, row limits) to prevent malicious or inefficient queries.
5. The validated SQL query is executed against Azure SQL.
6. Results are returned to the frontend for display, with human-readable date formatting applied.

**Key Design Decisions & Features:**
- **Unified Query Experience:** No mode selection required - the matrix classifier automatically selects relevant tables based on keywords in the user's question. This simplifies the UX and allows cross-domain queries.
- **SQL Safety Guardrails:** Strict validation ensures only `SELECT` statements, single statements, and allowlisted `INNER`/`LEFT`/`RIGHT` `JOIN`s are executed. `CROSS JOIN`s, system procedures, and external data access functions are blocked. All queries are limited to `TOP 100` rows and target `publish.DASHt_*` tables.
- **Dynamic Table Discovery:** At startup, the system queries Azure SQL (sys.tables + sys.schemas) to discover which DASHt_* tables actually exist.
- **Curated Table Architecture:** Uses Tier1 tables (DASHt_* curated tables from Power BI dashboards) for user queries. Tier2 source tables are available in the schema for fallback when Tier1 lacks needed detail.
- **Matrix-Driven Table Selection:** For each question, 2-4 most relevant tables are selected based on keyword matching to minimize LLM prompt size and improve SQL generation quality.
- **Column Slimming:** Schema context is dynamically trimmed to include only relevant columns (30-column cap per table) based on question keywords.
- **Comprehensive Schema Grounding:** The system prefetches and caches database schemas on startup. A SQL Column Validator parses and validates all column references in generated SQL against the cached schema, providing helpful error messages and suggestions for typos.
- **JOIN Support:** The SQL validator fully supports safe `INNER`/`LEFT`/`RIGHT` `JOIN`s, with all table references validated against allowlists.
- **Schema Introspection:** A utility queries `INFORMATION_SCHEMA.COLUMNS` to provide OpenAI with exact column lists, preventing hallucination of non-existent columns.
- **Query Performance Monitoring:** A dedicated analytics dashboard (`/dashboard`) provides real-time metrics on query performance, success rates, latency breakdown (LLM generation vs. SQL execution), error analytics, and recent activity.
- **Human-Readable Date Formatting:** Date and time values are automatically formatted for display in a user-friendly local format.
- **Export Functionality:** Results can be exported in CSV and Excel formats.
- **Feedback Mechanism:** Users can provide feedback on query results (thumbs up/down).
- **Popular Queries FAQ:** Queries with results are tracked and shown as quick suggestions (flame icon for top query).
- **Finance Scenario Awareness:** DASHt_SalesOrders queries default to ScenarioType='Production' unless user mentions what-if scenarios.

## Project Structure

```
├── client/              # React frontend (Vite + TypeScript)
│   ├── src/pages/       # Page components (query.tsx, dashboard.tsx)
│   ├── src/components/  # Reusable UI components (shadcn/ui)
│   └── public/          # Static assets (favicon)
├── server/              # Express backend
│   ├── openai-client.ts # LLM integration for SQL generation
│   ├── matrix-classifier.ts # Keyword-based table selection
│   ├── sql-validator.ts # SQL safety validation
│   ├── routes.ts        # API endpoints
│   └── schema-introspection.ts # Database schema handling
├── docs/semantic/       # Semantic catalog and static schema
├── src/config/          # Configuration files (analytics_reference.json)
├── scripts/             # Utility scripts (generate-schema.ts)
├── script/              # Build scripts (build.ts) - referenced by package.json
├── schemas/publish/     # Table documentation (markdown files)
└── shared/              # Shared types (schema.ts - placeholder for future auth)
```

**Notes for Dev Team:**
- `shared/schema.ts` contains placeholder user schema for future auth integration with Blazor app
- `script/` vs `scripts/`: Both folders exist due to package.json constraints; `script/build.ts` is the production build, `scripts/` contains utilities
- Future auth will pass credentials from parent Blazor app; permissions will be mode-based with potential executive-only table restrictions

## External Dependencies

- **Azure SQL Database:** The primary data source, configured via `DATABASE_URL` or discrete environment variables (`SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD`). Tables follow the `publish.DASHt_*` naming convention.
- **OpenAI API:** Utilized for natural language to SQL translation, requiring `AI_INTEGRATIONS_OPENAI_API_KEY` or `OPENAI_API_KEY`. Custom base URLs are supported.
- **PostgreSQL (Drizzle):** While a Drizzle schema for user management is defined, the system currently defaults to in-memory storage.
- **Environment Configuration:** Secrets and configurations like `DATABASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `DIAGNOSTICS_TOKEN`, and `PUBLIC_BASE_URL` are managed via Replit Secrets or Azure App Service configuration.