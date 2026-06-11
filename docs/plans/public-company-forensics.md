# Plan — Public-Company Forensics (turn the engine on SEC data)

> **Status: proposal, awaiting approval.** No code written yet.

## The one-liner

Point the *same* contradiction/evidence engine at **public SEC filings** instead of
a customer's private SAP system. Anyone can run it against any ticker — no install
of trust required, no "connect me to your ERP" terror. It's the identical thesis
(*structured data says what happened; unstructured text says why; the gap is where
trouble hides*) applied to data every retail investor is legally entitled to use.

## Why this fixes the adoption problem

- **Removes the trust barrier.** Nobody connects a production ERP to a zero-star
  repo. But "run forensic scores on `TSLA` from public filings" asks for nothing.
- **Instantly shareable.** "I scored the S&P 500 for earnings-manipulation risk and
  here are the 15 reddest names" is a LinkedIn / fintwit / r/investing artifact.
  That is how a zero-star repo gets its first thousand stars.
- **Same engine, not a pivot.** Reuses the adapters, contradiction taxonomy,
  evidence ledger, finding lifecycle, and dashboard already built. It *strengthens*
  the core product story.
- **Provably legal & legitimate.** All inputs are public SEC filings; all models are
  published, peer-reviewed, public-domain formulas. This is standard forensic /
  fundamental screening — what short-sellers and audit firms do daily. Not MNPI.

## What works *today* — data sources (all free, no API key)

SEC EDGAR exposes structured + unstructured data with only a `User-Agent` header and
a 10 req/s limit:

| Source | Endpoint | Gives us |
|---|---|---|
| Filing history | `https://data.sec.gov/submissions/CIK##########.json` | every filing, form type, date, accession # |
| All XBRL facts | `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` | every financial figure a company ever filed |
| One concept over time | `https://data.sec.gov/api/xbrl/companyconcept/CIK/us-gaap/{Concept}.json` | e.g. Revenue across all periods |
| Peer frame | `https://data.sec.gov/api/xbrl/frames/us-gaap/{Concept}/USD/CY####Q#.json` | the same metric for **every** filer in a period (peer benchmarking) |
| Full-text search | `https://efts.sec.gov/LATEST/search-index?q=...` | MD&A / risk-factor / 8-K text (2001+) |
| Ticker→CIK | `https://www.sec.gov/files/company_tickers.json` | resolve `AAPL` → CIK |

**Caveat:** this sandbox's network allowlist blocks `*.sec.gov`, so live runs happen
on your machine, in CI, or in a Claude-Code-on-web trusted-network session. The
design is unaffected; I'll ship pre-baked example data so the demo works offline.

## The structured layer — published forensic scorecard

Computed purely from XBRL facts. Each becomes a new contradiction/finding type:

| Model | What it flags | Trigger |
|---|---|---|
| **Beneish M-Score** (8 ratios: DSRI, GMI, AQI, SGI, DEPI, SGAI, LVGI, TATA) | earnings manipulation likelihood | M > −2.22 |
| **Sloan accruals ratio** | low earnings quality (accruals > cash earnings) | high/rising accruals |
| **Altman Z-Score** | bankruptcy / financial distress | Z < 1.8 (distress zone) |
| **Piotroski F-Score** (0–9) | fundamental strength/weakness | ≤ 3 weak |
| **Dechow F-Score** | SEC-AAER-trained misstatement risk | > 1 elevated |
| **Days-Sales-Outstanding / Days-Inventory trend** | channel stuffing, collection problems | DSO/DI rising faster than sales |

## The signature feature — structured-vs-unstructured reality gap

This is the part that *is* the brand, and nobody else's free screener does it:

1. Pull the **numbers** (XBRL): Beneish/accruals/DSO say "deteriorating."
2. Pull the **narrative** (full-text MD&A / earnings 8-K): management says "record
   demand, strong margins, improving liquidity."
3. Emit a **REALITY_GAP** finding citing both sides — bullish text over weakening
   fundamentals — with the exact filing/figure as evidence.

Plus event-driven red flags straight from filing metadata: **restatements**
(8-K Item 4.02 "non-reliance"), **late filings** (NT 10-K / NT 10-Q), **auditor
changes** (8-K Item 4.01), **material weakness** disclosures.

## The "Secret CFO" module — peer narrative gap (what's NOT being said)

Company communications are scripted and coordinated — one voice across the 10-K,
10-Qs, 8-Ks, and press releases. That script is itself data. This module reads the
signal in **what similar companies say that this one doesn't**, and **what this one
overstates relative to peers and to its own numbers**. All of it from public
disclosures — 100% legal, above board; it's systematic analyst work.

**Academic backbone (this is proven, not speculative):**
- *Lazy Prices* (Cohen, Malloy & Nguyen, **Journal of Finance 2020**): firms that
  actively *change* the language of their filings underperform; a changers-vs-
  non-changers portfolio earned up to **188 bps/month (~22%/yr)** abnormal returns.
  Changes concentrate in **MD&A**, and language about the **CEO/CFO** and
  **litigation** is the most informative. Long-stable boilerplate that suddenly
  gets rewritten *is* the signal.
- *Loughran–McDonald* finance-specific sentiment dictionary: positive / negative /
  uncertainty / litigious / weak-modal word lists built for 10-Ks (free for
  research use).

### Detectors

| Finding type | Question it answers | How |
|---|---|---|
| `PEER_OMISSION` | What are peers disclosing that this company isn't? | Build the topic universe from the peer set's risk factors + MD&A (TF-IDF/BERTopic — **reuses `herb-nlp/`**); if ≥k% of peers discuss a topic (e.g. inventory writedowns, customer concentration, covenant pressure) and this filer is silent → flag with the peer evidence |
| `DROPPED_DISCLOSURE` | What did this company *used to* say and quietly stopped saying? | YoY/QoQ diff of its own risk factors & MD&A sections (Lazy-Prices-style similarity: cosine/Jaccard); disappeared topics ranked by how long they'd been stable |
| `SCRIPT_BREAK` | When did the script change? | Change-point detection on language similarity over the filing series — **reuses `herb-nlp/temporal_analysis.py` (ruptures)**; a rewrite after N stable quarters scores high |
| `NARRATIVE_INFLATION` | What's being overstated? | Superlative/positive-tone density (Loughran–McDonald) vs. (a) the peer baseline and (b) the company's own XBRL deltas — "record demand" language over flat/declining revenue is a cross-layer contradiction |
| `EMPHASIS_ANOMALY` | What's being talked up beyond substance? | Topic word-share vs. peers vs. the matching capex/segment numbers (e.g., 10× more AI language than peers with no corresponding investment line) |
| `TONE_FUNDAMENTALS_GAP` | Does the tone trend diverge from the numbers trend? | Tone time-series vs. Beneish/accruals/DSO time-series; widening divergence compounds the structured-layer score |

### Peer set construction ("similar company, similar position, similar background")

From EDGAR alone: **SIC industry code** (submissions JSON) + **size band** (revenue/
assets via XBRL `frames` for the same period) + filer status. Optionally refine
with business-description similarity (Item 1 text). Every finding cites its peer
set so the comparison is reproducible.

### The Ralph-loop tie-in (pattern discovery on narratives)

Exactly like the existing Worker/Critic/Ralph loop in `pattern-discovery/`, but the
pattern space is *narrative behavior*:
- **Worker** proposes candidate signals ("companies that drop segment-guidance
  language within 2 quarters of a miss", "litigation-word spikes preceding 8-K
  4.02 non-reliance filings").
- **Critic** validates each candidate against the historical filing corpus and
  subsequent outcomes (restatements, NT filings, auditor changes — all in EDGAR
  metadata), demands evidence citations, and rejects overfit patterns.
- Validated patterns join the **persistent pattern library** and run automatically
  against new filings.

This makes the narrative layer a *learning system* — the repo's existing tagline —
instead of a fixed dictionary.

### Honest constraints

- **Earnings-call transcripts** aren't on EDGAR (third-party licensed). Phase 2 uses
  the 8-K prepared remarks / press-release exhibits (EX-99.1) that *are* on EDGAR;
  full call transcripts are a later, optional source.
- Omission analysis needs a decent peer set (≥6–8 comparable filers) to avoid
  flagging idiosyncratic-but-legitimate silence; small/unique companies get wider
  confidence intervals and softer language.

## Architecture reuse map (your existing modules)

| Need | Reuse | New |
|---|---|---|
| Data ingestion | `mcp-server/src/adapters/` adapter pattern | `SecEdgarAdapter` |
| Contradiction detection | `mcp-server/src/contradiction/` 12-type engine | + financial-forensic types |
| Reference model | `mcp-server/src/conformance/` | "healthy-filer" reference ratios |
| Reality gap | `mcp-server/src/reality-gap/` three-way diff | numbers-vs-narrative wiring |
| Evidence/provenance | `mcp-server/src/evidence/` + extraction registry | EDGAR extraction paths (CIK/accession/concept/value + SEC URL, SHA-256 replay) |
| Findings | `mcp-server/src/finding-lifecycle/` 8-state + SQLite | as-is |
| Handoff packet | `mcp-server/src/handoff/` | as-is |
| Scoring engine | `pattern-engine/` (Python) | `sec_forensics/` models |
| Demo surface | `demo/` dashboard | "Public Company Forensics" tab |

## New MCP tools

- `analyze_public_company` — ticker/CIK → full scorecard + findings + evidence
- `screen_universe` — a watchlist/index → ranked risk leaderboard
- `compare_to_peers` — one metric vs. all same-period filers (frames API)
- `get_filing_evidence` — the source filing + exact XBRL figures behind a finding

## Distribution play (the actual goal: traction)

- Pre-bake scorecards for **famous historical cases** (companies with known,
  now-public restatements/failures) so the demo proves the engine catches what it
  should — zero setup, like the SFDC demo.
- Add a **"Public Company Forensics" tab** to the live dashboard with a sortable
  risk leaderboard and per-company evidence drill-down.
- A one-command `analyze_public_company TSLA` CLI that prints the scorecard + the
  filing citations.

## Phasing

- **Phase 1 (shippable now, no new heavy deps):** `SecEdgarAdapter` (companyfacts +
  submissions), the 5 scoring models, evidence linking with SEC URLs + replay hash,
  the `analyze_public_company` CLI/tool, pre-baked example data for ~5 tickers, and
  the dashboard tab.
- **Phase 2:** full-text MD&A retrieval + the numbers-vs-narrative REALITY_GAP, peer
  benchmarking via `frames`, and the first Secret-CFO detectors that need only the
  company's own filing series: `DROPPED_DISCLOSURE` and `SCRIPT_BREAK`
  (Lazy-Prices-style language diffs — highest evidence-to-effort ratio).
- **Phase 3:** the peer-relative detectors (`PEER_OMISSION`, `NARRATIVE_INFLATION`,
  `EMPHASIS_ANOMALY`, `TONE_FUNDAMENTALS_GAP`) over constructed peer sets; universe
  screening (S&P 500 watchlist), ranked leaderboard, CI-published snapshots.
- **Phase 4:** the narrative Ralph loop — Worker/Critic pattern discovery over the
  filing corpus with outcome back-testing, growing the persistent pattern library.

## Build approach — mirror the pattern that already worked

The SFDC demo that's now live is a **Python pipeline** (`pattern-engine/scripts/analyze_sfdc.py`
→ `findings.json` → dashboard tab). It shipped fast and works with zero install.
SEC forensics should follow the **same proven shape**, not force financial data
through the SAP-document-shaped `IDataAdapter` (whose 8 methods are orders/
deliveries/invoices — a poor fit for XBRL financials).

- **Phase 1 = a Python `sec_forensics/` pipeline** (`analyze_company.py --ticker TSLA
  --json demo/sec-findings.json`) that reuses the *concepts* — extraction registry
  (CIK/accession/concept/value + SEC URL + replay hash), the contradiction taxonomy,
  the finding schema, and the dashboard — exactly as the SFDC path does.
- **Phase 2+ = the TypeScript MCP surface** (`SecEdgarAdapter` + `analyze_public_company`
  tool) for Claude-Code users, once the Python models are validated against fixtures.

This keeps Phase 1 shippable in one pass and de-risked by the existing demo pattern.

## Guardrails (non-negotiable)

- Frame every output as **"risk signal warranting review,"** never an accusation of
  fraud. Beneish/Altman have real false-positive rates (legit high-growth firms trip
  them). Hedged, sourced language only — avoids defamation and is just accurate.
- Prominent **"educational/research, not investment advice"** disclaimer.
- Scope the manipulation/distress models to **non-financial** filers first (banks/
  insurers don't fit Beneish/Altman); detect and skip/relabel financial SICs.
- Every figure carries a **source citation** (filing URL + accession + concept tag).

## "Will it actually work today?" — honest risks

- **XBRL tag variance:** companies tag concepts slightly differently; need synonym/
  fallback maps per ratio input. Solid coverage for 10-K/10-Q since ~2009.
- **Rate limit & UA:** 10 req/s, required UA; cache aggressively (one companyfacts
  call covers most ratios for a company).
- **Sandbox egress:** SEC is blocked *here*; live verification runs on your machine
  or CI. I'll build against recorded fixtures and you (or CI) confirm live.
