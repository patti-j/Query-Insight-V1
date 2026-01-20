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
- INNER/LEFT/RIGHT JOINs allowed with allowlisted tables only
- CROSS JOIN blocked for safety
- Only `publish.DASHt_*` tables accessible
- Automatic TOP 100 row limiting
- Mode-specific table allowlists enforced for all table references (FROM and JOIN clauses)
- PostgreSQL/MySQL LIMIT syntax blocked (enforces SQL Server TOP syntax)
- System procedures and external data access functions blocked (xp_*, OPENROWSET, etc.)

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

**2026-01-20: Mode-Specific Schema Optimization for LLM Performance**
- **Objective**: Reduce LLM prompt size and generation latency by trimming schema context per semantic mode
- **Implementation**: Created `server/mode-schema-cache.ts` for mode-specific schema caching
  - Planning mode: 10 tables with relevant columns only
  - Capacity mode: 6 tables with relevant columns only
  - Dispatch mode: 4 tables with relevant columns only
- **Prompt Reduction**: Replaced 113-line static SCHEMA_CONTEXT with 30-line CORE_SYSTEM_PROMPT
- **Dynamic Schema**: Only mode-relevant tables/columns injected into LLM prompt (was sending all 15 tables, 459 columns)
- **Cache Strategy**: Separate 10-minute TTL cache per mode with prefetch on startup
- **Server-Side Validation**: Still uses full authoritative schema for SQL validation (security maintained)
- **Model Upgrade**: Changed from gpt-4o-mini to gpt-4o for generateSqlFromQuestion
- **Monitoring**: Added console logging for schema stats and timing (table count, column count, fetch time, LLM time)
- **Expected Impact**: Reduced prompt size should significantly decrease ~5 second LLM generation time
- New files: `server/mode-schema-cache.ts`
- Modified files: `server/openai-client.ts`, `server/index.ts`, `server/routes.ts`

**2026-01-20: Human-Readable Date Formatting**
- **Objective**: Display date/time values in friendly local format instead of raw ISO strings
- **Auto-Detection**: Analyzes column names (date, time, datetime, timestamp, start, end, due, schedule) and values
- **Format Logic**: 
  - Date+Time: `MMM d, yyyy h:mm a` (e.g., "Jan 20, 2026 3:45 PM")
  - Date-Only: `MMM d, yyyy` (e.g., "Jan 20, 2026") when time is midnight
- **Smart Formatting**: Automatically detects if time component should be shown based on value
- **Export Preservation**: CSV/Excel exports continue using raw values for compatibility
- **Scope**: Applied consistently across all result tables, expanded views, and modes
- New files: `client/src/lib/date-formatter.ts`
- Modified files: `client/src/pages/query.tsx` (v1.2.0)

**2026-01-20: Table Scrollbar Fix for Production Consistency**
- **Fixed Issue**: Table in Results/Data Preview card now shows internal scrollbars in both dev and production
- **Root Cause**: Missing horizontal scroll container and non-optimal scroll structure
- **Solution Applied**:
  - Outer wrapper: `className="w-full overflow-x-auto border border-border/50 rounded-xl"` (horizontal scroll)
  - Inner wrapper: `className="max-h-[420px] overflow-auto"` (vertical scroll with fixed max-height)
  - Table: `className="min-w-[900px] w-full text-sm table-auto"` (minimum width triggers horizontal scroll)
- **Static Classes**: All Tailwind classes are static literals (no string concatenation) for proper production build inclusion
- **Cache Busting**: Added APP_VERSION='1.1.0' constant with footer display for deployment validation
- **Production Build**: Verified CSS includes overflow-auto and overflow-x-auto classes
- Modified files: `client/src/pages/query.tsx`

**2026-01-20: Analytics Dashboard for Query Performance Monitoring**
- **Dashboard Page**: New `/dashboard` route showing comprehensive query analytics
- **Real-time Metrics**: Auto-refreshes every 10 seconds to show current system health
- **Summary Cards**: Total queries, success rate, average latency, failed queries
- **Performance Breakdown**: Visual breakdown of LLM generation vs SQL execution time
- **Error Analytics**: Error breakdown by stage (validation, generation, execution)
- **Recent Activity**: Last 20 queries with status, latency, row count, and error details
- **Top Errors**: Most common error messages by frequency with timestamps
- **Performance Timeline**: Last 50 successful queries with visual latency breakdown
- **Backend Analytics**: `/api/analytics` endpoint with configurable time range (default 60 minutes)
- **In-Memory Storage**: Query logs stored with MAX_LOG_ENTRIES limit (1000 entries)
- **Navigation**: Dashboard link added to query page header with BarChart3 icon
- New files: `client/src/pages/dashboard.tsx`
- Modified files: `server/query-logger.ts`, `server/routes.ts`, `client/src/App.tsx`, `client/src/pages/query.tsx`

**2026-01-20: Comprehensive Schema Grounding with Column Validation**
- **Schema Prefetch on Startup**: All mode schemas now prefetched during server initialization (blocking) before accepting requests
- **Column Normalizer with Fuzzy Matching**: Added Levenshtein distance matching to map similar column names (e.g., "EndDateTime" → "EndDate")
- **SQL Column Validator**: Parses SQL and validates all column references against cached schema before execution
  - Extracts columns from SELECT, WHERE, GROUP BY, ORDER BY, and JOIN ON clauses
  - Detects invented columns and provides helpful error messages with available columns
  - Suggests close matches for typos or similar column names
- **Enhanced Error Messages**: Column validation errors now include:
  - Specific invalid columns
  - Available columns in the table (limited to first 5)
  - Suggestions for close matches
  - No mock data fallback - always shows schema mismatch details
- **Server-Side Logging**: All column validation errors logged with 🔴 COLUMN VALIDATION FAILED marker
- New files: `server/sql-column-validator.ts`
- Modified files: `server/index.ts`, `server/routes.ts`, `server/schema-introspection.ts`

**2026-01-20: Schema Introspection to Eliminate Column Name Hallucination**
- Created schema introspection utility (`server/schema-introspection.ts`) that queries `INFORMATION_SCHEMA.COLUMNS` with 10-minute in-memory cache
- Added GET `/api/schema/:mode` endpoint exposing discovered table→columns map for each semantic mode
- Updated OpenAI prompt to include exact column lists from live schema cache with hard instruction not to invent columns
- Improved error handling: detects "Invalid column name" errors, logs schema mismatches server-side (🔴 SCHEMA MISMATCH), returns helpful user messages
- OpenAI now generates SQL using actual Azure SQL column names (e.g., `DemandHours`, `NormalOnlineHours`) instead of hallucinated names
- Capacity mode queries now execute successfully with JOINs and correct column references
- Schema metadata prefetched at startup and refreshed every 10 minutes automatically
- New files: `server/schema-introspection.ts`
- Modified files: `server/routes.ts`, `server/openai-client.ts`

**2026-01-20: JOIN Support for Capacity Analysis**
- Updated SQL validator to allow safe INNER/LEFT/RIGHT JOINs with allowlist table validation
- All table references in FROM and JOIN clauses now validated against mode allowlist
- Added 6 new validator tests for JOIN safety (18 total tests, all passing)
- CROSS JOIN blocked for safety
- PostgreSQL/MySQL LIMIT syntax blocked; enforces SQL Server TOP syntax
- Enhanced security: blocked OPENROWSET, xp_*, sp_executesql, EXEC commands
- Updated OpenAI prompt to emphasize Microsoft SQL Server syntax and JOIN support
- Added capacity quick questions requiring JOINs: "Which resources are over capacity?" and "Compare demand vs available capacity"
- Validator now extracts and validates tables from both FROM and JOIN clauses
- Modified files: `server/sql-validator.ts`, `server/openai-client.ts`, `server/quick-questions.ts`

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