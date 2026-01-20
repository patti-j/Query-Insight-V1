# Query Insight V1 — TODO

## Open
- [ ] Repo structure audit (identify stack, entrypoints, env vars, API endpoints)
- [ ] Confirm local/dev run instructions
- [ ] Confirm deployment target and hosting model on Azure
- [ ] Test DATABASE_URL connection string approach in staging

## In progress
- [ ] Connect tooling and establish GitHub-first workflow
- [ ] Verify Secrets configuration for live SQL access

## Done
- [x] Confirm correct repository (`patti-j/Query-Insight-V1`)
- [x] Restore live SQL data access support
- [x] Document required environment variables
- [x] Implement DATABASE_URL connection string support (with backward compatibility)
- [x] Add semantic mode presets (Planning, Capacity, Dispatch)
- [x] Create semantic catalog JSON at docs/semantic/semantic-catalog.json
- [x] Wire mode-specific table allowlists into SQL validator
- [x] Add UI dropdown for mode selection and advanced toggle
- [x] Update OpenAI prompt with mode-specific table context
