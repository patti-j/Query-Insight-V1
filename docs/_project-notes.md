# Query Insight V1 — Project Notes

> Living technical log for the Query Insight chatbot project.

## 2026-01-19

### Context
- Repository confirmed as source-of-truth: `patti-j/Query-Insight-V1` (branch: `main`).
- Objective: build, automate, and deploy a single chatbot web app efficiently.

### Observations
- Recent commits indicate a Node.js + TypeScript + Vite-based build.
- Deployment uses `PUBLIC_BASE_URL`, normalized during build.
- Repo has prior Replit-based development activity.
- **Secrets Management**: The app uses environment variables (via Replit Secrets) for database credentials.
  - **Recommended**: Use `DATABASE_URL` connection string for simplicity.
  - **Alternative**: Use discrete secrets (`SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD`).
  - Required: `AI_INTEGRATIONS_OPENAI_API_KEY` for AI-powered query generation.
  - See `.env.example` for full configuration details.

### Decisions
- GitHub is the canonical system of record.
- Replit used as primary dev environment.
- Azure planned as deployment target.
- **Data Access**: Live SQL access via Replit Secrets with automatic fallback to mock data when secrets are missing.
- **Connection String Approach**: Prefer `DATABASE_URL` for cleaner secret management; backward compatible with discrete secrets.

### Security
- No credentials are logged or committed to the repository.
- All sensitive values managed via Replit Secrets or Azure Key Vault (production).
- Mock data fallback is UI-only and does not affect production data paths.

### Database Diagnostics
- **Endpoint**: `GET /api/db/diagnostics`
- **Purpose**: Validate access to all `publish.DASHt_*` tables in Azure SQL database
- **Security**: 
  - Available in development without authentication
  - In production, requires `DIAGNOSTICS_TOKEN` secret and `X-Diagnostics-Token` header
- **Usage**:
  ```bash
  # Development (no token needed)
  curl http://localhost:5000/api/db/diagnostics
  
  # Production (requires token)
  curl -H "X-Diagnostics-Token: your_token" https://your-app.com/api/db/diagnostics
  ```
- **Response**: JSON with table count, accessibility status, and per-table validation results
- **Configuration**: Set `DIAGNOSTICS_TOKEN` in Replit Secrets to enable in production (optional)

### Semantic Mode Presets
- **Feature**: Query mode selector with curated table allowlists
- **Purpose**: Focus queries on relevant tables based on report context (Planning, Capacity, or Dispatch)
- **Catalog**: `docs/semantic/semantic-catalog.json` defines available modes and their table allowlists
- **Modes**:
  - **Planning** (default): Manufacturing planning, job operations, materials, resources, inventory, sales/purchase orders
  - **Capacity**: Resource capacity planning, demand, actuals, shift schedules
  - **Dispatch**: Production dispatch and job operation execution
- **Endpoints**:
  - `GET /api/semantic-catalog`: Returns the full semantic catalog
  - `POST /api/ask`: Accepts `mode` and `advancedMode` parameters
- **Validation**: 
  - By default, queries are restricted to mode-specific tables
  - "Advanced mode" toggle allows querying any `publish.DASHt_*` table while still enforcing SELECT-only and TOP limits
  - All queries remain subject to security validation (SELECT-only, no JOINs, TOP enforcement)
- **UI**: Mode selector dropdown and advanced toggle in query form
- **OpenAI Integration**: Mode-specific table context injected into SQL generation prompt

### Next Steps
- Complete repo structure audit.
- Define runtime architecture (frontend/backend split if any).
- Lock CI/CD flow (GitHub → Azure).
