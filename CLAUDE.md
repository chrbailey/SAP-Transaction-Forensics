# SAP Workflow Mining

## Overview

Extract process mining insights from SAP ECC 6.0 without S/4HANA migration. Zero risk (read-only), zero cost (MIT license), zero migration required.

**Key Features:**
- Natural language interface for process questions
- OCEL 2.0 export for PM4Py/Celonis
- Conformance checking against O2C/P2P reference models
- Visual process maps with bottleneck highlighting
- ML-based predictive monitoring

---

## Quick Commands

```bash
# Demo mode (no SAP required)
docker-compose up --build

# Analyze CSV exports
docker-compose run pattern-engine --input-dir /app/input-data --output-dir /app/output

# Live RFC connection
cp .env.rfc.example .env.rfc
docker-compose --profile rfc up mcp-server-rfc

# Development
cd mcp-server && npm install && npm run dev

# Run tests
cd mcp-server && npm test
```

---

## Architecture

```
SAP Workflow Mining/
├── mcp-server/           # MCP server with TypeScript
│   ├── src/
│   │   ├── index.ts              # Entry point
│   │   ├── adapters/             # SAP connection adapters
│   │   ├── conformance/          # Process conformance checking
│   │   ├── governance/           # PromptSpeak integration
│   │   ├── llm/                  # Natural language interface
│   │   ├── ocel/                 # OCEL 2.0 export
│   │   ├── policies/             # Business rules
│   │   ├── prediction/           # ML predictions
│   │   ├── tools/                # MCP tool definitions
│   │   └── visualization/        # Process maps
├── pattern-engine/       # Pattern discovery engine
├── viewer/               # Web-based result viewer
├── synthetic-data/       # Demo data generation
├── demos/                # Example scripts
└── docs/                 # Documentation
```

---

## Connection Methods

| Method | Use Case | Configuration |
|--------|----------|---------------|
| CSV Import | One-time analysis | Place files in `./input-data/` |
| SQLite | Demo/testing | Included IDES dump |
| RFC | Live connection | `.env.rfc` with SAP credentials |

**Required SAP Tables (CSV Export):**
- `VBAK`, `VBAP` - Sales documents
- `LIKP`, `LIPS` - Deliveries
- `VBRK`, `VBRP` - Billing
- `STXH`, `STXL` - Text headers/lines

---

## MCP Tools

| Tool | Purpose |
|------|---------|
| `analyze_process` | Run process analysis on dataset |
| `query_natural_language` | Ask questions in plain English |
| `export_ocel` | Export to OCEL 2.0 format |
| `check_conformance` | Compare against reference models |
| `generate_visualization` | Create process maps |
| `predict_outcome` | ML-based predictions |

---

## PromptSpeak Integration

This project uses PromptSpeak for governance:

```
⊕◐▶  = strict operational execute
⊘◈▲  = neutral technical analyze
```

Governance features in `/src/governance/`:
- Pre-execution validation
- Drift detection for LLM queries
- Human-in-the-loop for sensitive operations

---

## Key Concepts

### Pattern Discovery
```
Finding: Orders with 'CREDIT HOLD' in notes have 3.2x longer fulfillment cycles
Occurrence: 234 orders (4.7% of dataset)
Confidence: HIGH (p < 0.001)
Caveat: Correlation only - does not imply causation
```

### Conformance Checking
```
Deviations Detected:
├── CRITICAL: Invoice before Goods Issue (23 cases)
├── MAJOR: Skipped Delivery step (187 cases)
└── MINOR: Duplicate Order Created (78 cases)
```

### OCEL 2.0 Export
Object-centric event logs capturing multi-object relationships:
- Order → Items → Deliveries → Invoices
- Compatible with PM4Py, Celonis

---

## Development Guidelines

1. **Always run tests** after changes: `cd mcp-server && npm test`
2. **Privacy by default** - PII redaction enabled, shareable output mode available
3. **Evidence-based** - Every pattern links to specific documents
4. **Read-only** - Never modify SAP data

### Adding a New Pattern
1. Add pattern definition in `pattern-engine/patterns/`
2. Implement extraction logic
3. Add test cases with expected output
4. Update documentation

---

## Environment Variables

```bash
# LLM providers (choose one)
OLLAMA_BASE_URL=http://localhost:11434  # Local, private
OPENAI_API_KEY=sk-...                    # Cloud option
ANTHROPIC_API_KEY=sk-ant-...             # Cloud option

# SAP RFC (optional)
SAP_HOST=...
SAP_SYSNR=...
SAP_CLIENT=...
SAP_USER=...
SAP_PASSWORD=...
```

---

## Related Projects

- **PromptSpeak:** `/Volumes/OWC drive/Dev/promptspeak/` - Governance framework
- **sap-extractor:** `/Volumes/OWC drive/Dev/sap-extractor/` - PADS extraction tool
