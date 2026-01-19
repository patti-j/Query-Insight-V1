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
- **Secrets Management**: The app uses `dotenv` (via Replit Secrets) for database credentials.
  - Required secrets: `SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD`, `AI_INTEGRATIONS_OPENAI_API_KEY`.
  - See `.env.example` for details.

### Decisions
- GitHub is the canonical system of record.
- Replit used as primary dev environment.
- Azure planned as deployment target.
- **Data Access**: Switched back to live SQL access via Replit Secrets. Mock data retained as fallback in frontend only.

### Next Steps
- Complete repo structure audit.
- Define runtime architecture (frontend/backend split if any).
- Lock CI/CD flow (GitHub → Azure).
