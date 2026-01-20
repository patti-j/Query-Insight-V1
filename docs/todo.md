## Current Priorities (2026-01-20)

### In Progress
- **Merge branch reconciliation PR**
  - PR: `integrate/main-sync` → `main`
  - Resolve remaining conflicts if any and merge via GitHub UI.
- **Azure deployment workflow stabilization**
  - Fix publish profile secret correctness (right repo, right secret name, correct XML including Kudu `publishUrl`).
  - Confirm SCM basic auth publishing is enabled on App Service.
  - (Preferred) Plan OIDC migration to remove publish profile dependency.

### Next Up
- **Capacity mode reliability**
  - Implement schema introspection cache (INFORMATION_SCHEMA.COLUMNS) per mode.
  - Add column-level validation to block invented fields before execution.
  - Convert Capacity Quick Questions to deterministic templates (no LLM).
  - Remove mock-data fallback for Quick Questions; show actionable errors.
- **SQL validator improvements**
  - Allow safe JOIN subset (INNER/LEFT) only on allowlisted `publish.DASHt_*` tables.
  - Explicitly block CROSS JOIN, UNION, dynamic SQL, multi-statement batches.
  - Add unit tests for validator behavior.
- **UI parity (Replit vs Azure)**
  - Fix results card scrolling with static Tailwind classes:
    - `overflow-x-auto` wrapper + `max-h[...] overflow-auto` inner.
  - Add Tailwind safelist for overflow/max-h/min-w classes if any are generated dynamically.
  - Add optional `APP_VERSION`/commit SHA footer for environment verification.

### Done / Recently Completed
- Generated updated PDF collateral:
  - Full README PDF
  - Power BI comparison explainer
  - “Why smart without AI” one-pager
  - “Today vs With AI” roadmap page (formatting fixed; AI benefits expanded)
- Identified root causes of Capacity query failures:
  - JOIN blocked by validator
  - AI inventing columns (schema mismatch)
- Identified root cause of Azure deploy failures:
  - publish profile auth/format mismatch (401 / missing kudu URL)
