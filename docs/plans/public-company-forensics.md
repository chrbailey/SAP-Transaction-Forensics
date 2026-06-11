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
  benchmarking via `frames`.
- **Phase 3:** universe screening (S&P 500 watchlist), ranked leaderboard, scheduled
  re-runs / CI-published snapshots.

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
