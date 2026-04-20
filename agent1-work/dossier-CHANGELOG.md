# Changelog

All notable changes to this project are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning is
[Semantic Versioning](https://semver.org/).

The default branch is `corrections/calibrated-v1`. That name records that the
current state of the tree is a corrected, calibrated re-base of earlier work
rather than a clean slate.

## [Unreleased]

### Added
- `CHANGELOG.md` (this file).

## [0.1.0-corrections] — 2026-04-20

### Added
- **7-phase SaaS due diligence pipeline** orchestrated by Ralph Loop:
  Discovery, Market, Technical, Claims, Academic, Valuation, Report. Driven
  by prompt files in `prompts/p{N}-*.md` and templates in `templates/`.
- **Phase 4 shadow prediction market** methodology: 11 internal signal source
  types (Glassdoor, Blind, Reddit, HN, LinkedIn, layoff trackers, arXiv,
  Twitter/X, job boards, Product Hunt, review sites). 3+ independent sources
  required per quantitative claim; the cross-source spread is the confidence
  interval.
- **Signal curation loop** (`contracts/signal-curation.json`,
  `contracts/signal-monitor.json`): contract-driven research loop with
  trusted source universe (Karpathy, Amodei, Altman, Hassabis, Sutskever,
  etc.), trust weights, and freshness horizons. Run via `dspy/__main__.py`
  with `scripts/run_loop.py` harness.
- **DSPy compilation pipeline** (`dspy/`): signatures, modules, loaders,
  metrics, compiler, export. Uses `dspy-ai` under the hood and a custom
  `ClaudeAgentLM` backend so LLM calls go through the local Claude Code
  harness rather than a direct Anthropic API client.
- **Circuit breaker** (`scripts/circuit_breaker.py` and related) for
  safe repeated LLM invocations — halts the loop on consecutive failures.
- **Evidence store** (`scripts/evidence_store.py` and related): append-only
  evidence capture with insert/query/promotion/signal extraction tested
  separately.
- **Output viewer** (`viewer/`): static HTML viewer for generated reports.
- Helper scripts (Python 3.9+ compat): `whois_lookup.py`, `arxiv_search.py`.
- `CLAUDE.md` project rules, `ARCHITECTURE.md` design doc, `llm.md` agent
  integration guide.
- `SECURITY.md` with threat model: read-only research, no authenticated
  writes against third parties, public sources only, no Anthropic API keys
  held by the project (all LLM calls go through the host Claude Code
  harness).
- `CONTRIBUTING.md` with scope constraints: no API-wrapping CLI replacement
  of the sub-agent architecture, no required paid data sources, no
  softening of Phase 4 methodology, no scoring of raw evidence captures.
- GitHub Actions `tests.yml` CI matrix across Python 3.10 / 3.11 / 3.12,
  triggered on `main` and all `corrections/**` branches.

### Tests
- **330 pytest tests passing** across 15 test files (verified from the
  2026-04-20 CI run on `corrections/calibrated-v1`, commit 6638f2c). Test
  areas: circuit breaker, contract integration, DSPy compile/export/loader,
  evidence store (guards, insert/query, promotion, signals), metrics,
  modules, signatures, LM backend, integration.

### Known Limitations
- No browser automation — WebSearch / WebFetch only. Some target sites
  (LinkedIn, Glassdoor) restrict what the pipeline can retrieve.
- No financial data APIs — SaaS metrics are estimated from public signals,
  not Crunchbase / PitchBook / S&P.
- No deep static analysis of target code — repos are analyzed via `gh`
  CLI and file inspection only.
- Single-domain runs; no side-by-side comparison mode.
- Running against a competitor with a corporate-identity `gh` token exposes
  that identity to the target in GitHub API logs — see `SECURITY.md`.

[Unreleased]: https://github.com/chrbailey/dossier/compare/v0.1.0-corrections...HEAD
[0.1.0-corrections]: https://github.com/chrbailey/dossier/tree/corrections/calibrated-v1
