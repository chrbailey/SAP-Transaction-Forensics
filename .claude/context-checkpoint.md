# Context Checkpoint
Updated: 2026-03-26T00:15:00Z

## Task
Add Salesforce adapter to SAP-Transaction-Forensics with cross-system ERP/CRM correlation, run analysis on synthetic data, update README, push to GitHub.

## Status
Complete. Pushed to origin/main.

## Decisions Made
- SFDC adapter lives in SAP-Transaction-Forensics repo (not separate project)
- Synthetic-first approach: generator with 10 planted patterns validates pipeline before real data
- Field mapper normalizes SFDC→SAP types (lossy by design, documented)
- Entity resolver: nameThreshold=0.3 (tightened from 0.6 after code review)
- Background agents fail on permissions — use foreground only for Write/Bash tasks

## Files Modified
- 24 new files across mcp-server/src/adapters/sfdc/, mcp-server/src/cross-system/, pattern-engine/src/, synthetic-data/
- README.md — rewritten for multi-system architecture, SFDC docs, 834 test count
- .gitignore — added sfdc_output, .firecrawl, crmarena exclusions
- pattern-engine/scripts/analyze_sfdc.py — forensic analysis script

## Key Findings
- CRMArena/CRMArenaPro on HuggingFace are benchmarks (Q&A), not raw data dumps
- Kaggle `innocentmfa/crm-sales-opportunities` has real CRM data (accounts.csv, sales_pipeline.csv) — needs kaggle CLI auth
- HERB dataset is enterprise communications, not pipeline data — useful for NLP layer only
- Pre-existing test failure: conformance.test.ts "should list all models" expects 4, gets 7 (on main)

## Next Steps
1. Download Kaggle CRM dataset (need `pip install kaggle` + auth) and write CSV→JSON converter
2. Wire MCP tool registrations for cross-system tools (correlate_systems, get_unified_log, analyze_cross_system_gaps)
3. Phase 2: Live Salesforce REST API client with OAuth2
4. Consider: integrate Tech41 NLP pipeline (HERB communications) alongside structured SFDC adapter
