# 60-Second Quickstart

Go from `git clone` to Claude Code answering forensic questions about synthetic SAP data in one minute. No SAP system required.

## Prerequisites

- Node.js 18+ and npm
- Python 3.9+ (for the synthetic data generator)
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed
- `make` (macOS and most Linux ship with it)

## The 5 Commands

```bash
# 1. Clone
git clone https://github.com/chrbailey/SAP-Transaction-Forensics.git
cd SAP-Transaction-Forensics

# 2. Generate synthetic data (200 SFDC opportunities with 10 planted anomaly patterns)
make demo

# 3. Build the MCP server
cd mcp-server && npm install && npm run build && cd ..

# 4. Open Claude Code in this directory
claude

# 5. Ask a forensic question (see prompts below)
```

## Expected Output at Each Step

### Step 2 — `make demo`

```
[1/3] Installing dependencies...
[2/3] Generating synthetic SFDC data (seed=42, deterministic)...
  → 200+ opportunities with 10 planted anomaly patterns
[3/3] Running forensic analysis...
═══════════════════════════════════════
  Demo complete. Run 'make test' to verify.
═══════════════════════════════════════
```

Files written:
- `synthetic-data/sfdc_output/*.json` — 200 opportunities, stage histories, activities
- `pattern-engine/test_output/pattern_cards.md` — discovered patterns
- `synthetic-data/sample_output/*.json` — pre-committed SAP O2C/P2P data (used by the MCP server)

### Step 3 — `npm install && npm run build`

```
added 487 packages in 18s
> tsc
# (no output on success — dist/index.js is produced)
```

### Step 4 — `claude`

Claude Code reads `.mcp.json` from the repo root and auto-starts the MCP server. On first prompt you should see:

```
[MCP] transaction-forensics: connected (18 tools available)
```

Run `/mcp` inside Claude Code to list tools. You should see: `check_conformance`, `analyze_sod`, `analyze_journal_entries`, `analyze_gl_balances`, `generate_fi_assessment`, `ask_process`, `visualize_process`, `export_ocel`, `predict_outcome`, `search_doc_text`, `get_doc_text`, `get_doc_flow`, `get_sales_doc_header`, `get_sales_doc_items`, `get_delivery_timing`, `get_invoice_timing`, `get_master_stub`, `get_fi_document`, plus 9 `ps_*` governance tools.

### Step 5 — Ask a question

Try this first:

> **You:** What suspicious patterns did you find in the synthetic data?

Claude will call `analyze_journal_entries` and `analyze_sod` against the pre-loaded synthetic dataset. Expected response shape:

```
I found several anomalies by running two forensic tools:

1. Journal entry anomalies (via analyze_journal_entries):
   - 14 weekend postings (severity: medium)
   - 8 round-amount entries above $10,000 (severity: low)
   - 3 backdated entries > 15 days (severity: high)

2. Segregation-of-duties conflicts (via analyze_sod):
   - 2 post-and-reverse conflicts (same user, 24h window)
   - 1 park-and-post conflict bypassing review

Want me to drill into any finding, generate a full FI assessment
report, or check conformance against the O2C reference model?
```

## What To Ask Next

See **[scripts/demo-walkthrough.md](scripts/demo-walkthrough.md)** for five questions that each exercise a different tool, with the expected tool call and sample response.

## Beyond the Built-in Tools: Pattern Discovery

After running the built-in forensic tools, try the **learning layer** — a Worker/Critic/Ralph loop that discovers new forensic patterns from the data:

```bash
cd pattern-discovery
python3 demo_discovery.py
```

The engine proposes candidate patterns, a critic validates each against evidence, and confirmed patterns are added to a persistent pattern library. Every run grows the library. See **[pattern-discovery/README.md](pattern-discovery/README.md)** for the design.

## If Something Breaks

**`make demo` fails with "python3: command not found"** — install Python 3.9+ and retry.

**`npm run build` fails on `better-sqlite3`** — this package compiles native bindings. On macOS: `xcode-select --install`. On Linux: `sudo apt install build-essential python3`.

**Claude Code says "MCP server failed to start"** — check `mcp-server/dist/index.js` exists (step 3 must complete). Run `node mcp-server/dist/index.js < /dev/null` and look for a JSON error on stderr.

**"Tool X is not registered"** — the README mentions some tools (`generate_handoff_packet`, `detect_contradictions`, `query_provenance`) whose source exists but are not yet wired into `mcp-server/src/tools/index.ts`. The 18 SAP tools listed above are the live set.

## What's Actually Running

The synthetic adapter reads `synthetic-data/sample_output/*.json` (12 files, pre-committed). `make demo` additionally generates SFDC opportunities into `synthetic-data/sfdc_output/` for the Python pattern-engine. All SAP O2C/P2P tool calls from Claude hit the pre-committed JSON — so the MCP server works even before `make demo` finishes.
