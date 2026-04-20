# Dossier — Automated SaaS Due Diligence + Signal Curation

[![tests](https://github.com/chrbailey/dossier/actions/workflows/tests.yml/badge.svg)](https://github.com/chrbailey/dossier/actions/workflows/tests.yml)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

> **Status: `corrections/calibrated-v1` branch is the default.** This repo was re-calibrated from earlier work — the branch name records that. 330 pytest tests passing on CI. Treat as v0.1 — useful, opinionated, single-author. See [CHANGELOG.md](CHANGELOG.md).

**What it does:** Two Claude Code-native research loops that share the same architectural pattern (prompt-as-program, PROGRESS.md as state, DAG of sub-agents):

1. **SaaS due diligence pipeline** — given a domain, produces a 7-phase dossier: discovery, market, technical, claims vs reality, academic footprint, replication cost, unified report.
2. **Signal curation loop** — given a contract (`contracts/*.json`), continuously curates the most important voices, signals, and absences on a topic. Uses DSPy for compiled prompt programs under `dspy/`.

**When to use the due diligence pipeline:** You are evaluating a SaaS company for acquisition, investment, partnership, or competitive intelligence. You want more than a landing page review but less than a $200K consulting engagement.

**When to use the signal curation loop:** You want an agent that monitors a named source universe (Karpathy, Amodei, Altman, Hassabis, etc.) and reports on pattern shifts and meaningful silences, on a schedule.

**How both work:** Claude Code is the execution engine. Sub-agents have direct access to WebSearch, WebFetch, `gh` CLI, file I/O. The "program" is a set of prompt files + contract files. The "database" is `PROGRESS.md` or an append-only evidence store. The "scheduler" is Ralph Loop (for dossier) or a contract-driven loop harness (for signal curation).

## What This Is NOT

- **Not a hosted service.** You clone the repo, configure `target.env` (for dossier) or a `contracts/*.json` (for signal), and run it locally against your own Claude Code harness.
- **Not a browser automation tool.** WebSearch + WebFetch only. Sites that block those (LinkedIn, Glassdoor) will have partial coverage.
- **Not a financial data provider.** The valuation phase estimates from public signals only — no Crunchbase, PitchBook, or S&P integrations.
- **Not a replacement for a human analyst.** The output is a starting point for human judgment, not a verdict.
- **Not API-key-hungry.** All LLM calls go through your local Claude Code harness — Dossier does not hold or use an Anthropic API key directly.

---

## Quick Start — Due Diligence Pipeline

```bash
git clone https://github.com/chrbailey/dossier.git
cd dossier

# 1. Set target
echo "DOMAIN=example.com" > target.env

# 2. Install helper dependencies (one-time)
python3 -m venv scripts/.venv
scripts/.venv/bin/pip install -r scripts/requirements.txt

# 3. Run the pipeline (Ralph Loop, inside Claude Code)
# /ralph-loop --max-iterations 20 --completion-promise "DOSSIER_COMPLETE"
# (paste contents of ralph-prompt.md when prompted)

# 4. Read results
cat output/example.com/executive-summary.md
cat output/example.com/07-report.md
```

## Quick Start — Signal Curation Loop

```bash
# 1. Pick a contract
ls contracts/                       # signal-curation.json, signal-monitor.json

# 2. Install DSPy pipeline deps
pip install -r dspy/requirements.txt

# 3. Run the loop (inside Claude Code)
# Use /dossier-loop or run the harness directly:
python -m dspy.__main__ contracts/signal-curation.json
```

---

## What You Get — Due Diligence

A complete dossier in `output/{domain}/`:

| File | Contents |
|------|----------|
| `executive-summary.md` | 2-page overview: strengths, risks, recommendation |
| `07-report.md` | Full PRD-format report with all sections |
| `01-discovery.md` | Company identity, digital footprint, tech signals |
| `02-market.md` | TAM/SAM/SOM, competitors, SWOT, positioning matrix |
| `03-technical.md` | GitHub analysis, architecture, code quality, dependencies |
| `04-claims.md` | Marketing vs reality — with shadow prediction market |
| `05-academic.md` | Papers, patents, open-source alternatives |
| `06-valuation.md` | SaaS metrics, replication cost, agent swarm build plan |
| `raw/*.json` | WHOIS, website content, GitHub repos, arXiv papers |

---

## The 7 Phases

```
P1 Discovery ──┬──→ P2 Market ────────┐
               ├──→ P3 Technical ──┐  │
               └──→ P5 Academic    │  │
                                   ▼  │
               P4 Claims (P1+P3) ──┤  │
                                   ▼  ▼
               P6 Valuation (all) ────┤
                                      ▼
               P7 Report (all) → DONE
```

| Phase | What It Does | Tools Used |
|-------|-------------|------------|
| **P1 Discovery** | Domain → company identity, digital footprint | WebSearch, WebFetch, WHOIS script, dig |
| **P2 Market** | Market size, competitors, SWOT, Gartner-style positioning | WebSearch, WebFetch |
| **P3 Technical** | GitHub org analysis, architecture, dependencies, quality signals | `gh` CLI, WebFetch |
| **P4 Claims** | Marketing claims vs evidence + shadow prediction market from internal signals | WebSearch (11 source types), prior phase outputs |
| **P5 Academic** | arXiv papers, patents, open-source alternatives | arXiv script, `gh search`, WebSearch |
| **P6 Valuation** | SaaS metrics, replication assessment, agent swarm build plan | All prior phases |
| **P7 Report** | Unified PRD + executive summary + confidence matrix | All prior phases |

### Phase 4: The Shadow Prediction Market

The most differentiated phase. Instead of taking marketing claims at face value, P4 triangulates **internal signals** from 11 source types — Glassdoor, Blind, Reddit, HN, LinkedIn, layoff trackers, arXiv, Twitter/X, job boards, Product Hunt, and review sites.

The core method: collect 3+ independent data points for each quantitative claim. The **spread** across sources becomes the confidence interval. When the company's claim falls outside the triangulated range, that's a material gap. When employee signals contradict marketing, the employee signals get higher weight.

Output includes an "AI Reality Score" (1-5): is their AI genuine research-grade ML, or a rules engine with a marketing department?

---

## Signal Curation Loop

The `contracts/` directory defines contract-driven research loops. `signal-curation.json` names a source universe (Karpathy, Amodei, Altman, Hassabis, Sutskever, etc.) with tier, trust weight, freshness horizon, and domains. The loop monitors those sources for signal shifts, emerging patterns, and meaningful silences.

Under `dspy/`, a compiled DSPy pipeline handles the LLM calls. A custom `ClaudeAgentLM` adapter (`dspy/lm.py`) routes those calls through the host Claude Code harness instead of calling the Anthropic API directly.

`contracts/schema.md` documents the contract format.

---

## Architecture

### Why Claude Code Native?

Traditional approach: build a Python CLI that wraps Claude API → manage keys, handle rate limits, parse responses, maintain code.

This approach: Claude Code **is** the execution engine. Sub-agents have direct access to WebSearch, WebFetch, `gh` CLI, file I/O. The "program" is prompt files + contract files. The "database" is `PROGRESS.md` or the evidence store. The "scheduler" is Ralph Loop or the contract loop harness.

**Result:** ~120 LOC of hand-written Python helper scripts + a compact DSPy pipeline + ~1,300 lines of structured prompts. Full SaaS due diligence and signal curation pipelines, with 330 passing tests.

### State Machine

```
target.env → PROGRESS.md (state) → ralph-prompt.md (scheduler)
                ↕                        ↕
        output/{domain}/          prompts/p{N}-*.md
        (phase outputs)           (sub-agent instructions)
```

Ralph Loop reads `PROGRESS.md` each iteration, identifies unblocked phases, dispatches sub-agents, updates state, and repeats until all phases complete or max iterations reached.

### Helper Scripts

Only a small set of Python scripts — for tasks Claude Code can't do natively:

| Script | Purpose | Input → Output |
|--------|---------|---------------|
| `scripts/whois_lookup.py` | WHOIS records | domain → JSON |
| `scripts/arxiv_search.py` | Academic papers | query → JSON array |
| `scripts/circuit_breaker.py` | Halt loop on consecutive LLM failures | — |
| `scripts/evidence_store.py` | Append-only evidence store with guards | — |

### DSPy Pipeline

`dspy/` contains a compiled DSPy program used by the signal curation loop:
`signatures.py` (I/O shapes), `modules.py` (composable units), `loader.py`
(dataset ingestion), `metrics.py` (scoring), `compile.py` (program
compilation), `export.py` (compiled-program export), `lm.py` (ClaudeAgentLM
backend), `__main__.py` (entry point). The `tests/test_*` files cover each
of these components plus integration.

---

## Testing

```bash
pip install -r scripts/requirements.txt
pip install -r dspy/requirements.txt
pip install pytest pytest-asyncio

python -m pytest tests/ -v
```

Current suite: **330 tests passing** on CI (Python 3.10 / 3.11 / 3.12). Test areas include circuit breaker, contract integration, DSPy compile/export/loader/signatures/modules, evidence store (guards, insert/query, promotion, signal extraction), metrics, LM backend, and integration tests.

---

## For Agent Builders

### Patterns You Can Reuse

1. **Prompt-as-program:** Each phase is a markdown file that fully specifies a sub-agent's behavior. No code generation framework needed — the prompts ARE the code.

2. **PROGRESS.md as state machine:** A human-readable markdown file tracks completion state. Any agent can read it, any agent can update it. No database, no API.

3. **DAG via dependency rules:** Phase dependencies are declared in `ralph-prompt.md` as simple rules (`P1 + P3 → unlocks P4`). Ralph Loop interprets these each iteration. Adding a phase means adding one rule.

4. **Signal triangulation:** The Phase 4 methodology — collect 3+ independent sources, derive confidence from convergence — is reusable for any verification task.

5. **Materiality tiers:** CRITICAL / NOTABLE / MINOR classification with explicit trigger conditions. Prevents false alarms from minor discrepancies.

6. **Contract-driven research loops:** `contracts/*.json` declare source universe, trust weights, freshness horizons, and loop phases. The same harness runs different research contracts.

### Extending Dossier

**Add a new phase:**
1. Create `prompts/p{N}-{name}.md` with goal, steps, output format
2. Add dependency rule to `ralph-prompt.md`
3. Add to `templates/progress-template.md`

**Add a new data source:**
1. If it needs a library: add script to `scripts/`, update `requirements.txt`
2. If WebSearch/WebFetch suffices: just add instructions to the relevant phase prompt

**Run against a different domain:**
1. Edit `target.env`
2. Run Ralph Loop — each domain gets its own `output/{domain}/` directory

**Write a new research contract:**
1. See `contracts/schema.md` for the format
2. Add JSON under `contracts/`
3. Point the loop harness at the contract file

---

## Project Structure

```
dossier/
├── README.md / ARCHITECTURE.md / CLAUDE.md / llm.md / SECURITY.md
├── CONTRIBUTING.md / CHANGELOG.md / LICENSE
├── target.env                   # DOMAIN=example.com
├── ralph-prompt.md              # Ralph Loop orchestration prompt
├── pyproject.toml
│
├── scripts/                     # Python helpers (JSON stdout)
│   ├── whois_lookup.py
│   ├── arxiv_search.py
│   ├── circuit_breaker.py
│   ├── evidence_store.py
│   └── requirements.txt
│
├── prompts/                     # Sub-agent phase instructions
│   ├── p1-discovery.md … p7-report.md
│
├── templates/                   # Report structure templates
│   ├── progress-template.md
│   ├── prd-template.md
│   ├── swot-template.md
│   └── magic-quadrant-template.md
│
├── contracts/                   # Research loop contracts
│   ├── schema.md
│   ├── signal-curation.json
│   └── signal-monitor.json
│
├── dspy/                        # Compiled DSPy pipeline
│   ├── signatures.py / modules.py / loader.py
│   ├── metrics.py / compile.py / export.py
│   ├── lm.py (ClaudeAgentLM) / __main__.py
│   └── requirements.txt
│
├── loop/                        # Generic Ralph-loop template
│   ├── ralph-prompt-loop.md
│   ├── prompts/ / templates/
│
├── viewer/                      # Static HTML report viewer
│
├── tests/                       # 330 pytest tests
│
└── output/                      # Generated reports (gitignored)
    └── {domain}/
        ├── PROGRESS.md
        ├── 01-discovery.md … 07-report.md
        ├── executive-summary.md
        └── raw/*.json
```

---

## Limitations (v0.1)

- **No browser automation** — WebSearch/WebFetch only. Some sites (LinkedIn, Glassdoor) may limit what's accessible.
- **No financial APIs** — SaaS metrics are estimated from public signals, not Crunchbase/PitchBook data.
- **No deep code analysis** — GitHub repos are analyzed via `gh` CLI and file inspection, not cloned + run through static analysis.
- **Single domain per run** — no side-by-side comparison mode.
- **`gh` token identity exposure** — running Dossier against a competitor reveals your `gh`-authenticated identity in their API logs.

See the V2 roadmap in `ARCHITECTURE.md`.

---

## Inspiration

The idea for automated SaaS due diligence was sparked by [Charmaine Wilson](https://www.linkedin.com/in/charmaine-wilson-deloitte) (Deloitte Consulting Principal) and [Ayo Odusote](https://www.linkedin.com/in/ayoodusote/) (Deloitte Principal, Software & Platforms Leader) in the context of Taryn Plumb's CIO.com article ["SaaS isn't dead, the market is just becoming more hybrid"](https://www.cio.com/article/4131904/saas-isnt-dead-the-market-is-just-becoming-more-hybrid.html). Their insight — that enterprises will balance traditional SaaS with AI-native alternatives, and that a new governance layer will emerge to orchestrate AI agents — is exactly the landscape where automated due diligence becomes essential.

---

## License

MIT
