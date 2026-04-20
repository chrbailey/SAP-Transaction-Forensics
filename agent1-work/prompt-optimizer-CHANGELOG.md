# Changelog

All notable changes to this project are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning is
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `SECURITY.md` with scoped threat model for deterministic scoring vs LLM-backed
  commands, and explicit note that the `prompt-optimizer` npm name belongs to a
  different author.
- `CHANGELOG.md` (this file).

### Fixed
- README example scores corrected to match actual scorer output (see
  `docs/scoring.md`). The structured "Good prompt" scores 90, not 78; the
  sloppy "Bad prompt" scores 54, not 32; "Write a function to sort an array"
  scores 52, not 45.
- README no longer recommends `npm install -g prompt-optimizer`. That name on
  the npm registry is owned by a different project (Klaus Heringer's
  eval-to-improvement loop for promptfoo). This repository's package is
  install-from-source only.

### Known Limitations Still Open
- Integration tests directory exists but is empty (only unit tests run in CI).
- `optimize` and `route --quality best` paths require real provider API keys
  and are not exercised in CI.
- Model IDs baked into `src/core/agents/router-agent.ts` and related files
  reference `claude-sonnet-4-20250514` as the default; these are baseline
  values from v1.0.0 and will need refresh for newer models.

## [1.0.0] — 2026-01-24

### Added
- Deterministic 5-dimension prompt scorer: Clarity (25%), Specificity (25%),
  Structure (15%), Completeness (20%), Efficiency (15%).
- CLI commands: `evaluate`, `optimize`, `route`, `batch`, `config`.
- GitHub Action under `action/` with pre-built `dist/index.js`. Inputs:
  `path`, `threshold`, `fail-on-warning`, `annotations`, `output-format`,
  `config-file`. Outputs include `total-prompts`, `passed-prompts`,
  `average-score`, `results-json`.
- Provider adapters: Anthropic, OpenAI, Google (used by `optimize` and
  `route` flows that require API keys).
- Jest test suite covering scoring determinism, weight math, edge cases, and
  router logic. **56 tests passing** across 2 test files.
- Scoring rubric documentation (`docs/scoring.md`).
- ESLint + Prettier config, TypeScript 5.4 build.

### Architecture Notes
- Scoring is pure string analysis: no network calls, no LLM, no randomness.
- `optimize` and `route --quality best` flows are the only paths that touch
  provider APIs.

[Unreleased]: https://github.com/chrbailey/prompt-optimizer/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/chrbailey/prompt-optimizer/releases/tag/v1.0.0
