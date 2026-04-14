# Transaction Forensics

## Overview
Cross-system process forensics for SAP ERP, Salesforce CRM, and NetSuite.
Zero risk (read-only), zero cost (MIT license), zero migration required.

## Key Features:
- **Evidence-grade forensics** — Field-level provenance, SHA-256 replay hashing, self-contained handoff packets
- **Cross-system analysis** — SAP, Salesforce, NetSuite correlation with entity resolution
- **Natural language interface** for process questions
- **OCEL 2.0 export** for PM4Py/Celonis
- **Conformance checking** against O2C/P2P reference models
- **Visual process maps** with bottleneck highlighting
- **ML-based predictive monitoring**
- **FI/CO forensic analysis** — Journal entries, segregation of duties, GL balances

## Quick Commands
```bash
# Demo mode (no SAP required)
docker-compose up --build

# One-command deterministic demo
make demo

# Analyze CSV exports
docker-compose run pattern-engine --input-dir /app/input-data --output-dir /app/output

# Live RFC connection
cp .env.rfc.example .env.rfc
docker-compose --profile rfc up mcp-server-rfc

# SFDC analysis
cd synthetic-data && python3 src/generate_sfdc.py --count 200 --accounts 50 --output sfdc_output/ --seed 42
cd ../pattern-engine && python3 scripts/analyze_sfdc.py

# Development
cd mcp-server && npm install && npm run dev

# Run tests
cd mcp-server && npm test
cd pattern-engine && pytest tests/ -v
```

## Architecture
```
transaction-forensics/
├── mcp-server/                 # MCP server with TypeScript
│   ├── src/
│   │   ├── index.ts            # Entry point
│   │   ├── adapters/           # SAP, SFDC, NetSuite, SALT, BPI, CSV adapters
│   │   ├── conformance/        # Process conformance checking
│   │   ├── evidence/           # Provenance graph, extraction registry
│   │   ├── contradiction/      # Cross-system contradiction engine
│   │   ├── schema/             # Schema validator (IDES reference)
│   │   ├── reality-gap/        # Three-way gap analysis
│   │   ├── finding-lifecycle/  # 8-state finding manager + SQLite
│   │   ├── handoff/            # Reviewer handoff packet generator
│   │   ├── fi-co/              # FI/CO forensic analysis tools
│   │   ├── governance/         # PromptSpeak integration
│   │   ├── llm/                # Natural language interface
│   │   ├── ocel/               # OCEL 2.0 export
│   │   ├── policies/           # Business rules
│   │   ├── prediction/         # ML predictions
│   │   ├── tools/              # MCP tool definitions
│   │   └── visualization/      # Process maps
├── pattern-engine/             # Pattern discovery engine (Python)
│   ├── scripts/                # analyze_sfdc.py, etc.
│   └── src/
├── viewer/                     # Web-based result viewer
├── synthetic-data/             # SAP + SFDC demo data generation
├── demos/                      # Example scripts (13 demos)
├── docs/                       # Documentation
│   ├── analysis/               # Analysis results
│   ├── plans/                  # Implementation plans
│   └── superpowers/            # Feature specs
├── scripts/                    # Utility scripts (BPI converter, SALT downloader)
└── data/                       # Real data adapters (SALT, BPI)
```

## Connection Methods
| Method | Use Case | Configuration |
|---|---|---|
| CSV Import | One-time analysis | Place files in `./input-data/` |
| SQLite | Demo/testing | Included IDES dump |
| RFC | Live SAP connection | `.env.rfc` with SAP credentials |
| SFDC | Salesforce data | SFDC adapter with synthetic or real data |
| SALT | Real SAP data | HuggingFace SALT dataset |
| BPI 2019 | Real P2P data | BPI Challenge 2019 dataset |

## MCP Tools (Full List)

### SAP Data Tools
| Tool | Purpose |
|---|---|
| `search_doc_text` | Find documents by text pattern |
| `get_doc_text` | Get all text fields for a document |
| `get_doc_flow` | Get order-delivery-invoice chain |
| `get_sales_doc_header` | Order header details |
| `get_sales_doc_items` | Order line items |
| `get_delivery_timing` | Requested vs actual delivery |
| `get_invoice_timing` | Invoice creation/posting |
| `get_master_stub` | Safe master data attributes (no PII) |

### Process Mining Tools
| Tool | Purpose |
|---|---|
| `ask_process` | Natural language queries |
| `export_ocel` | Export to OCEL 2.0 format |
| `check_conformance` | Compare against O2C model |
| `visualize_process` | Generate process diagrams |
| `predict_outcome` | ML-based outcome prediction |

### FI/CO Forensic Tools
| Tool | Purpose |
|---|---|
| `analyze_journal_entries` | Journal entry anomaly detection |
| `analyze_sod` | Segregation of duties analysis |
| `analyze_gl_balances` | GL account balance analysis |
| `get_fi_document` | FI document details |
| `generate_fi_assessment` | FI/CO risk assessment report |

### Evidence Infrastructure Tools
| Tool | Purpose |
|---|---|
| `query_provenance` | Trace evidence chain for a finding |
| `list_extraction_paths` | List available extraction paths |
| `run_extraction` | Execute a named extraction path |
| `detect_contradictions` | Cross-system contradiction detection |
| `validate_schema` | Pre-flight schema validation |
| `analyze_reality_gaps` | Three-way gap analysis |
| `manage_finding` | Create/transition/query findings |
| `get_finding_summary` | Aggregated finding statistics |
| `generate_handoff_packet` | Produce reviewer handoff packet |

### Governance Tools
| Tool | Purpose |
|---|---|
| `ps_precheck` | Dry-run operation check |
| `ps_list_holds` | List pending holds |
| `ps_approve_hold` / `ps_reject_hold` | Hold management |
| `ps_agent_status` | Check agent state |
| `ps_halt_agent` / `ps_resume_agent` | Emergency controls |
| `ps_stats` | Governance statistics |
| `ps_frame_docs` | PromptSpeak reference |

## Development Guidelines
- Always run tests after changes: `cd mcp-server && npm test`
- Privacy by default — PII redaction enabled, shareable output mode available
- Evidence-based — Every pattern links to specific documents with field-level provenance
- Read-only — Never modify SAP/SFDC/NetSuite data

## Environment Variables
```bash
# LLM providers (choose one)
OLLAMA_BASE_URL=http://localhost:11434  # Local, private
OPENAI_API_KEY=sk-...                   # Cloud option
ANTHROPIC_API_KEY=sk-ant-...            # Cloud option

# SAP RFC (optional)
SAP_HOST=...
SAP_SYSNR=...
SAP_CLIENT=...
SAP_USER=...
SAP_PASSWORD=...
```
