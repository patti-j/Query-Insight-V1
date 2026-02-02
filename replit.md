# Query Insight

## Overview

Query Insight is a natural language interface designed to query manufacturing planning data from PlanetTogether analytics. It translates plain English questions into SQL queries against an Azure SQL database using OpenAI. The system targets curated Power BI reporting tables, providing insights across various contexts such as Production & Planning, Capacity Plan, Dispatch List, Inventories, Sales Orders, Schedule Conformance, and AuditLog. Its core purpose is to democratize access to complex manufacturing planning data through an intuitive conversational interface, enhancing data accessibility and decision-making.

## User Preferences

Preferred communication style: Simple, everyday language.
Code quality expectation: Production-ready, clean code suitable for dev team code review.
Cleanup approach: Clean up incrementally as features are built, not in large batches at the end.

## System Architecture

**Frontend:** The application uses React with TypeScript, Vite, Tailwind CSS v4, and shadcn/ui components for UI/UX. TanStack Query manages server state, and Wouter handles client-side routing.

**Backend:** Built with Node.js and TypeScript, the backend queries Azure SQL databases using the `mssql` package and integrates with the OpenAI API for natural language to SQL translation.

**Data Flow:** User natural language input is sent to the backend, which forwards it to OpenAI with schema context. OpenAI generates an SQL query that undergoes validation for safety (e.g., SELECT statements only, allowed tables, row limits) before execution against Azure SQL. Results are returned to the frontend with human-readable date formatting.

**Key Design Decisions & Features:**
- **Unified Query Experience:** A matrix classifier automatically selects relevant tables based on keywords in the user's question, enabling cross-domain queries without mode selection.
- **SQL Safety Guardrails:** Strict validation ensures only safe `SELECT` statements and allowlisted `INNER`/`LEFT`/`RIGHT` `JOIN`s are executed, blocking malicious or inefficient queries. All queries are limited to `TOP 100` rows and target `publish.DASHt_*` tables.
- **Dynamic Table Discovery & Curated Architecture:** The system discovers `DASHt_*` tables from Azure SQL at startup and primarily uses these curated Power BI tables for user queries, with Tier2 source tables available for fallback.
- **Matrix-Driven Table Selection & Column Slimming:** Keyword matching selects 2-4 most relevant tables, and schema context is dynamically trimmed to relevant columns (30-column cap per table) to optimize LLM prompt size.
- **Comprehensive Schema Grounding:** Database schemas are prefetched and cached. A SQL Column Validator validates all column references in generated SQL against the cached schema.
- **JOIN Support:** The SQL validator supports safe `INNER`/`LEFT`/`RIGHT` `JOIN`s with validated table references.
- **Schema Introspection:** `INFORMATION_SCHEMA.COLUMNS` is used to provide OpenAI with exact column lists, preventing hallucination.
- **Query Performance Monitoring:** An analytics dashboard (`/dashboard`) provides metrics on query performance, success rates, latency, and error analytics.
- **User Permissions Enforcement:** Server-side enforcement injects WHERE clauses based on user permissions (`Planning Areas`, `Scenarios`, `Plants`) and restricts access to sensitive tables like `DASHt_SalesOrders` for non-admin users.
- **Pinned Dashboard:** Users can pin favorite queries to a personal dashboard for quick access, storing up to 20 items locally with cached results.
- **User Permissions Admin Page:** An admin-only page (`/admin/permissions`) allows managing user access restrictions based on Planning Area, Scenario, Plant, and Table Access, stored in `data/user-permissions.json`.
- **Global Filters:** Three dropdown filters (Planning Area, Scenario, Plant) are available in the UI, applied to all queries.
- **SSE Streaming:** Full SSE streaming support (`/api/ask/stream`) with typing effects and a stop button is available, auto-enabled in Azure deployments.
- **ScenarioType Filtering:** `DASHt_Planning` and `DASHt_SalesOrders` queries default to `ScenarioType = 'Production'` unless a "what-if" scenario is explicitly requested.
- **Invalid Filter Validation:** The system provides helpful messages and valid alternatives when a query returns 0 results due to non-existent filter values.
- **Simulated Today:** An anchor date can be configured (e.g., `VITE_DEV_FIXED_TODAY` or `SIMULATED_TODAY`) for all date-relative queries.

## External Dependencies

- **Azure SQL Database:** The primary data source, configured via `DATABASE_URL` or discrete environment variables. Tables follow the `publish.DASHt_*` naming convention.
- **OpenAI API:** Used for natural language to SQL translation, requiring `AI_INTEGRATIONS_OPENAI_API_KEY` or `OPENAI_API_KEY`.
- **Environment Configuration:** Secrets and configurations like `DATABASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `DIAGNOSTICS_TOKEN`, and `PUBLIC_BASE_URL` are managed via Replit Secrets or Azure App Service configuration.