# Changelog

All notable changes to this project are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning is
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `CHANGELOG.md` (this file).

## [0.1.0] — 2026-04-20

### Added
- MCP server `lex_server.py` exposing 11 tools (7 read, 4 write):
  `lex_search_articles`, `lex_get_briefing`, `lex_get_signals`,
  `lex_get_trending`, `lex_list_sources`, `lex_get_article`, `lex_get_status`,
  `lex_run_scrape`, `lex_run_analyze`, `lex_run_publish`, `lex_run_cycle`.
- Pipeline CLI (`lex.py`): `scrape`, `analyze`, `publish`, `cycle`,
  `status`, `search`, `patterns`, `cleanup`.
- 11 Chinese-language scrapers under `ahgen/scrapers.py`: 36Kr, Huxiu, CSDN,
  Caixin, Zhidx, Leiphone, InfoQ China, Kingdee, Yonyou, SAP China, Jiemian.
  Plus Gmail newsletter ingestion.
- Two-stage LLM pipeline:
  - Stage 1 (`prompts/stage1.md`) — translate + categorize into 13 categories
    (`funding`, `m_and_a`, `investment`, `product`, `regulation`,
    `breakthrough`, `research`, `open_source`, `partnership`, `adoption`,
    `personnel`, `market`, `other`).
  - Stage 2 (`prompts/stage2.md`) — Bloomberg-style briefing (LEAD / PATTERNS
    / SIGNALS / WATCHLIST / DATA) with historical context.
- Deduplication: exact-title match via Supabase plus semantic dedup via
  Pinecone (threshold 0.85, namespace `lex-articles` in index
  `claude-knowledge-base`).
- Publisher adapters (all optional, unconfigured platforms silently skipped):
  Dev.to, Hashnode, Blogger. LinkedIn and Medium are declared but not active
  publish paths.
- `SECURITY.md` describing threat model, secret surface, and explicit "does
  NOT do" list (no auto-publish to unconfigured platforms, no credential
  persistence, no authenticated writes against scraped outlets).
- `CONTRIBUTING.md` with change scope constraints (deduplication must not be
  removed, brief structure must not be altered silently, publisher opt-in
  must be preserved).
- GitHub Actions `tests.yml` CI matrix across Python 3.10 / 3.11 / 3.12.
- 183 pytest tests across `test_analyze.py`, `test_db.py`, `test_server.py`,
  `test_vectors.py`. All passing on current CI run.

### Known Limitations (not bugs)
- Data is daily-batched, not real-time.
- Article bodies truncated to 3,000 characters in MCP tool responses (10,000
  characters in storage).
- Relevance scores are LLM-assigned, not human-verified.
- Scrapers depend on the `AHGEN_DIR` environment variable pointing at the
  companion Ahgen scrapers project.
- Paywalled content is out of scope — public pages only.

[Unreleased]: https://github.com/chrbailey/lex-intel/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/chrbailey/lex-intel/releases/tag/v0.1.0
