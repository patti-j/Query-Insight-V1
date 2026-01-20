# Query Insight V1

## Overview

Query Insight is a natural language interface for querying manufacturing planning data from PlanetTogether analytics. Users ask questions in plain English, and the system uses OpenAI to generate SQL queries against an Azure SQL database containing curated Power BI reporting tables.

The application supports three semantic modes:
- **Planning** (default) - Job scheduling, materials, resources, inventory
- **Capacity** - Resource demand, capacity, shifts, utilization
- **Dispatch** - Job operations and production execution

All queries target curated `publish.DASHt_*` tables designed for Power BI reporting consistency.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

**Frontend Stack**
- React with TypeScript
- Vite for development and builds
- Tailwind CSS v4 with shadcn/ui components
- TanStack Query for server state management
- Wouter for client-side routing

**Backend Stack**
- Node.js with Express
- TypeScript throughout
- Direct Azure SQL queries via `mssql` package
- OpenAI API for natural language to SQL translation

**Data Flow**
1. User enters natural language question
2. Backend sends question + schema context to OpenAI
3. OpenAI returns SQL query
4. SQL validator checks safety (SELECT only, allowed tables, row limits)
5. Query executes against Azure SQL
6. Results returned to frontend for display

**SQL Safety Guardrails**
- Only SELECT statements allowed
- Single statement only (no semicolons)
- No JOIN operations permitted
- Only `publish.DASHt_*` tables accessible
- Automatic TOP 100 row limiting
- Mode-specific table allowlists

**Key Design Decisions**
- Server-side SQL execution prevents credential exposure
- Semantic modes restrict available tables per use case
- Schema documentation in `schemas/publish/*.md` provides column reference
- In-memory storage for users/sessions (Drizzle schema defined but not actively used)

## External Dependencies

**Azure SQL Database**
- Primary data source for all queries
- Connection via `DATABASE_URL` environment variable (preferred)
- Fallback to discrete `SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD` variables
- Tables follow `publish.DASHt_*` naming convention

**OpenAI API**
- Powers natural language to SQL translation
- Requires `AI_INTEGRATIONS_OPENAI_API_KEY` or `OPENAI_API_KEY`
- Optional custom base URL via `AI_INTEGRATIONS_OPENAI_BASE_URL`

**PostgreSQL (Drizzle)**
- Schema defined in `shared/schema.ts` for user management
- Requires `DATABASE_URL` for Drizzle migrations
- Currently uses in-memory storage as fallback

**Environment Configuration**
All secrets managed via Replit Secrets or Azure App Service configuration:
- `DATABASE_URL` - Azure SQL connection string
- `AI_INTEGRATIONS_OPENAI_API_KEY` - OpenAI API key
- `DIAGNOSTICS_TOKEN` - Optional production diagnostics access
- `PUBLIC_BASE_URL` - Deployment URL for meta tags

## Recent Changes

**2026-01-20: Quick Questions Schema Validation**
- Implemented automatic schema validation for Quick Questions using INFORMATION_SCHEMA.COLUMNS
- Questions now automatically validated against actual Azure SQL table/column availability
- Mode-specific question sets (Planning/Capacity/Dispatch) with allowlist-table enforcement
- Schema metadata prefetched at startup and cached for 5 minutes
- Questions referencing missing columns automatically filtered out (with warning logs)
- New endpoint `/api/quick-questions/:mode` serves only validated questions
- Frontend updated to fetch mode-specific validated questions dynamically
- New file: `server/quick-questions.ts` contains question definitions and validation logic

**Previous Features:**
- All semantic mode features completed: Planning, Capacity, and Dispatch modes with enhanced SQL validator (13 passing self-checks)
- Export feature completed with CSV and Excel support using papaparse and xlsx libraries
- Feedback mechanism fully implemented with thumbs up/down buttons, /api/feedback endpoint, and in-memory storage
- "Did you mean?" AI-generated query suggestions feature integrated with OpenAI
- Query mode selector changed from dropdown to button interface with mode-specific quick questions