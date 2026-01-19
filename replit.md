# Query Insight

## Overview

Query Insight is a natural language interface for querying manufacturing planning data. Users can ask questions in plain English, and the application uses AI (OpenAI GPT) to generate safe SQL queries that run against an Azure SQL database containing manufacturing planning tables. The app displays results in formatted tables and tracks popular questions for FAQ suggestions.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight router)
- **State Management**: TanStack React Query for server state
- **UI Components**: Shadcn/UI component library built on Radix UI primitives
- **Styling**: TailwindCSS with CSS variables for theming (dark/light mode support)
- **Build Tool**: Vite with custom plugins for meta images and development tooling

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript (ESM modules)
- **API Pattern**: RESTful endpoints under `/api/*`
- **Key Endpoints**:
  - `GET /api/health` - Health check
  - `GET /api/db-check` - Database connectivity verification
  - `POST /api/ask` - Natural language query processing (accepts `mode` and `advancedMode` parameters)
  - `GET /api/popular-questions` - FAQ suggestions
  - `GET /api/validator-check` - SQL validator self-test
  - `GET /api/semantic-catalog` - Returns semantic mode catalog with table allowlists

### Data Flow
1. User submits natural language question
2. Backend sends question to OpenAI with schema context
3. OpenAI generates SQL query
4. SQL validator checks query safety (SELECT-only, no JOINs, allowed tables only)
5. Query executes against Azure SQL
6. Results return to frontend for display

### SQL Safety Layer
The `sql-validator.ts` enforces strict security:
- Only SELECT statements allowed (including CTEs with WITH clause)
- No JOIN operations permitted
- Only `[publish].[DASHt_*]` tables accessible
- Automatic TOP(100) enforcement
- Single statement only (no semicolons mid-query)
- **Semantic Mode Filtering**: Optionally restricts queries to mode-specific table allowlists (Planning, Capacity, or Dispatch)
- **Advanced Mode**: When enabled, allows any `publish.DASHt_*` table while maintaining all other security rules

### Database Schema
- **Primary Table**: `[publish].[DASHt_Planning]` - Manufacturing planning data
- **Additional Tables**: Various `DASHt_*` tables for capacity planning, inventories, materials, resources, sales orders
- Schema documentation stored in `schemas/publish/` as Markdown files
- **Semantic Catalog**: `docs/semantic/semantic-catalog.json` defines three query modes:
  - **Planning Mode** (default): Planning, job operations, materials, resources, inventory, sales/purchase orders, transaction logs
  - **Capacity Mode**: Resource demand, capacity, actuals, shift schedules
  - **Dispatch Mode**: Planning, job operations, job attributes, resources

### Authentication
- Currently no user authentication implemented
- Database diagnostics endpoint has optional token protection via `DIAGNOSTICS_TOKEN` secret

## External Dependencies

### Database
- **Azure SQL Database**: Primary data store for manufacturing planning data
- **Connection**: Uses `mssql` package with connection pooling
- **Configuration**: Supports both `DATABASE_URL` connection string or discrete secrets (`SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD`)

### AI Service
- **OpenAI API**: Powers natural language to SQL conversion
- **Configuration**: Requires `AI_INTEGRATIONS_OPENAI_API_KEY` or `OPENAI_API_KEY`
- **Optional**: `AI_INTEGRATIONS_OPENAI_BASE_URL` for custom endpoints

### Local Development Database
- **Drizzle ORM**: Configured for PostgreSQL (used for local user schema if needed)
- **Note**: The main application uses Azure SQL via `mssql`, not the Drizzle PostgreSQL connection

### Environment Variables Required
- `DATABASE_URL` or (`SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD`) - Azure SQL connection
- `AI_INTEGRATIONS_OPENAI_API_KEY` or `OPENAI_API_KEY` - OpenAI API access
- Optional: `DIAGNOSTICS_TOKEN` - Protect diagnostics endpoint in production
- Optional: `PUBLIC_BASE_URL` - Deployment URL for meta tags