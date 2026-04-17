# Pattern Discovery — The Learning Layer

> Worker / Critic / Ralph loop for discovering new forensic patterns from ERP transaction data.

## What This Is

The 23 MCP tools in this repo implement **hardcoded detection** — they check for known patterns (SoD conflicts, weekend postings, backdated entries, conformance deviations).

This module is the **learning layer**. It proposes *new* patterns from the data, validates them through a critic, and grows a persistent library.

## How It Differs From Rule Engines

| Hardcoded rule engine | Pattern discovery (this module) |
|-----------------------|--------------------------------|
| Ships with N known rules | Starts with zero, learns from data |
| Rules written by vendor | Patterns discovered in YOUR data |
| Silent on novel patterns | Proposes candidates + validates them |
| Static — same output forever | Library grows with every run |
| No negative examples | Rejected candidates are training data |

## The Loop

```
┌─────────────────────────────────────────────────────┐
│  1. WORKER                                           │
│     Input:  transaction data + prior patterns        │
│     Output: candidate patterns (JSON)                │
│             - name, description, category            │
│             - detection_signature (SQL-like)         │
│             - supporting_transaction_ids             │
│             - confidence_basis                       │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│  2. CRITIC                                           │
│     Input:  data + candidates                        │
│     Output: per-candidate PASS/FAIL + findings       │
│             Checks: signature match, evidence        │
│                     strength, flattery, thin-ev,     │
│                     category correctness             │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│  3. RALPH                                            │
│     Routes candidates:                               │
│     - CONFIRMED  → patterns_db (positive training)   │
│     - REJECTED   → patterns_db (negative training)   │
│     - UNCERTAIN  → flagged for human review          │
└─────────────────────────────────────────────────────┘
```

## The Pattern Library

Stored in `patterns.db` (SQLite). Two tables matter:

- **`patterns`** — one row per named pattern, with status (pending/confirmed/rejected), evidence count, rejection count, and lifecycle timestamps. Can be updated as patterns get re-confirmed or demoted.
- **`pattern_observations`** — **append-only** (enforced by SQLite triggers). Each row links a pattern to a specific transaction ID at a point in time. This is the immutable evidence trail.

Every discovery run appends to `discovery_runs` for audit.

## Running It

```bash
# From repo root, after running `make demo` to generate synthetic data
cd pattern-discovery
python3 demo_discovery.py
```

Requires `ANTHROPIC_API_KEY` in `.env` or environment.

Second run against the same data will show the prior patterns to the Worker as baselines — candidates can be flagged as `known_pattern_new_instances` (adds evidence to existing) or `novel_candidate` (genuinely new).

## Design Principles

**Anti-flattery:** Worker prompt bans superlatives. Critic prompt verifies every claim against evidence. Same pattern that the [sniperscope](../../sniperscope/) project uses for talent analysis.

**Anti-manipulation:** `pattern_observations` cannot be UPDATEd or DELETEd. SQLite triggers enforce this. Every evidence point has a source run_id and timestamp.

**Anti-speculation:** Worker must cite supporting_transaction_ids that actually exist in the data. Critic verifies them. If a candidate has fewer than 3 supporting instances, it must declare `confidence_basis: "thin_evidence"`.

**No scoring or ranking:** Categorical severity only (none/low/medium/high). No risk scores, no percentages, no "severity: 8/10". Those are easy to game.

## Files

| File | Purpose |
|------|---------|
| `pattern_discovery.py` | Main entry: `discover_patterns(data_path, db_path)` |
| `patterns_db.py` | SQLite wrapper with append-only triggers |
| `prompts.py` | Constant Worker/Critic prompts (not dynamically generated) |
| `demo_discovery.py` | Runs against `synthetic-data/sfdc_output/` |
| `tests/test_pattern_discovery.py` | Unit + integration tests with mocked Claude |

## Testing

```bash
cd pattern-discovery
python3 -m pytest tests/ -v
```

Tests mock the Anthropic API — no API key required, no API calls made.

## Where This Fits

- **Detection layer** (this repo's 23 MCP tools) — finds things you KNOW to look for
- **Discovery layer** (this module) — finds things you DIDN'T know to look for
- **Governance layer** ([PromptSpeak](https://github.com/chrbailey/promptspeak-mcp-server)) — controls what agents can DO once patterns are detected

Three layers, separate concerns, separate processes.
