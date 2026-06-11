# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.1] - 2026-06-11

### Fixed

- Made all test targets fail correctly instead of masking failures.
- Repaired Makefile and CLI pattern-engine invocation and removed fabricated fallback output.
- Updated the viewer for the current pattern-card schema, configurable output paths, and escaped rendered data.
- Corrected the MCP Docker build and added a reproducible viewer lockfile.
- Upgraded MCP dependencies to remove production audit vulnerabilities.

### Changed

- Added synthetic-data and viewer coverage to CI.
- Validated Node.js 20, 22, and 24 and Python 3.10, 3.11, and 3.12 in CI.
- Documented the current baseline of 2,048 passing tests and 42 skipped tests.
- Clarified that 18 analysis/data tools and 9 governance tools are live, while evidence infrastructure MCP definitions remain unregistered.
- Qualified local-only network claims for opt-in cloud LLM and SaaS integrations.

## [3.0.0] - 2026-03-26

### Added

#### Salesforce CRM Adapter
- New SFDC adapter mapping Opportunities, Accounts, StageHistory to SAP-normalized schema
- Field mapping: Opportunity.Id → VBELN, Account.Id → KUNNR, Stage transitions → VBFA
- Synthetic SFDC data generator with 10 planted anomaly patterns
- SFDC forensic analysis script (`pattern-engine/scripts/analyze_sfdc.py`)

#### Cross-System Correlation
- Entity resolver matching SFDC↔SAP records via explicit ID, proximity, and temporal sequence
- Cross-system anomaly detection: timing gaps, amount discrepancies, sequence violations, missing handoffs
- Configurable confidence scoring (0.50–0.99) based on match method

#### Evidence Infrastructure (Phases 1–4)

**Phase 1 — Provenance Graph + Extraction Registry**
- Field-level DAG tracing every finding to system/table/record/field/value/timestamp
- 19 named, versioned, deterministic extraction paths across SAP, Salesforce, and NetSuite
- SHA-256 replay hashing for independent re-verification

**Phase 2 — Contradiction Engine + Schema Validator**
- 12-category typed taxonomy for cross-system contradiction detection
- Type-specific risk scoring with severity levels (CRITICAL, HIGH, MEDIUM, LOW, INFO)
- 19-table IDES reference schema (438 fields) with pre-flight validation

**Phase 3 — Reality-Gap Detector**
- Three-way gap analysis: reference models vs documented business rules vs actual event logs
- Gap types: design gap, compliance gap, shadow process

**Phase 4 — Finding Lifecycle + Reviewer Handoff**
- 8-state machine (DETECTED → TRIAGED → INVESTIGATING → CONFIRMED → REMEDIATION → RESOLVED)
- SQLite persistence with full transition history and deduplication
- Self-contained reviewer handoff packets with 25-item checklist

#### FI/CO Forensic Tools
- `analyze_journal_entries` — Journal entry anomaly detection
- `analyze_sod` — Segregation of duties analysis
- `analyze_gl_balances` — GL account balance analysis
- `get_fi_document` — FI document detail retrieval
- `generate_fi_assessment` — FI/CO risk assessment reports

#### Evidence Infrastructure MCP Tools
- `query_provenance`, `list_extraction_paths`, `run_extraction`
- `detect_contradictions`, `validate_schema`, `analyze_reality_gaps`
- `manage_finding`, `get_finding_summary`, `generate_handoff_packet`

### Changed
- Rebranded from "SAP Workflow Mining" to "Transaction Forensics" across all files
- Test count increased from 605 to 1,639 across 70 test suites
- README updated with evidence infrastructure documentation

### Fixed
- TypeScript strict mode errors for CI
- ESLint errors across Phase 1–4 files
- Node 18 compatibility (explicit `node:crypto` import)
- Quarter-end math expectations in tests

## [2.0.0] - 2026-01-02

### Added

#### Natural Language Interface
- New `ask_process` MCP tool for querying SAP processes in plain English
- LLM abstraction layer supporting multiple providers:
  - **Ollama** - Local/private deployment (default for air-gapped environments)
  - **OpenAI** - GPT-4 integration for cloud deployments
  - **Anthropic** - Claude integration as alternative cloud option
- Context-aware responses with evidence citations and recommendations
- Configurable via `LLM_PROVIDER`, `LLM_API_KEY`, and `LLM_MODEL` environment variables

#### OCEL 2.0 Export
- New `export_ocel` MCP tool for Object-Centric Event Log export
- Full compliance with [OCEL 2.0 standard](https://www.ocel-standard.org/)
- Object types: order, item, delivery, invoice
- Event types: order_created, delivery_created, goods_issued, invoice_created
- Relationship tracking between SAP document objects
- Export formats: JSON (default), XML, SQLite
- Compatible with PM4Py, Celonis, and other OCEL-compliant tools

#### Conformance Checking
- New `check_conformance` MCP tool for process conformance analysis
- Compare actual SAP processes against expected Order-to-Cash models
- Pre-built O2C reference models:
  - Simple model: Order → Delivery → Goods Issue → Invoice
  - Detailed model: Includes optional steps (credit check, picking, packing, payment)
- Deviation detection:
  - Skipped activities (e.g., delivery without order)
  - Wrong order (e.g., invoice before delivery)
  - Unexpected activities
  - Missing mandatory activities
  - Duplicate activities
- Severity scoring: Critical / Major / Minor / Info
- Conformance rate calculation (0-100%)
- Based on van der Aalst's conformance checking algorithms

#### Visual Process Maps
- New `visualize_process` MCP tool for process flow diagrams
- Output formats:
  - **Mermaid** - Markdown-compatible flowcharts
  - **GraphViz DOT** - For complex process graphs
  - **SVG** - Direct visual output
- Bottleneck highlighting with color-coded severity:
  - Green: Fast (normal processing time)
  - Yellow: Medium (approaching threshold)
  - Red: Slow (bottleneck detected)
- Timing annotations between process steps
- Human-readable duration formatting (30m, 4.5h, 2d)

#### Predictive Monitoring
- New `predict_outcome` MCP tool for ML-based predictions
- Prediction types:
  - **Late Delivery** - Probability of delivery delays
  - **Credit Hold** - Likelihood of credit blocks
  - **Completion Time** - Estimated days to complete O2C cycle
- Feature extraction (29 features):
  - Temporal: duration, time since start, activity durations
  - Count: event count, unique activities, order changes
  - Pattern: credit blocks, rework, backward flows
  - State: current stage, completion percentage, blocked status
- ML model types: Random Forest, Gradient Boosting, Ensemble
- Risk scoring with configurable alert thresholds
- Batch prediction support (up to 100 documents)

#### Python Modules
- `pattern-engine/src/ocel/` - OCEL 2.0 export module
- `pattern-engine/src/conformance/` - Conformance checking engine
- `pattern-engine/src/visualization/` - Diagram generation
- `pattern-engine/src/prediction/` - ML prediction and alerting

#### Testing
- 391 new tests for v2.0 features
- Total test count: 605 (314 TypeScript + 291 Python)
- Comprehensive coverage for all new modules

### Changed

- Updated MCP Tools Reference in README with new Process Mining Tools section
- Added LLM Configuration section to README
- Added version badges to README

### Statistics

- **31 files added**
- **11,643 lines of code**
- **5 new MCP tools**
- **4 new Python modules**

---

## [1.0.0] - 2026-01-02

### Added

#### Core Features
- MCP server for SAP ECC 6.0 integration
- Read-only access via standard SAP BAPIs
- Pattern Engine for text analysis and clustering

#### SAP Data Tools
- `search_doc_text` - Find documents by text pattern
- `get_doc_text` - Get all text fields for a document
- `get_doc_flow` - Get order-delivery-invoice chain
- `get_sales_doc_header` - Order header details
- `get_sales_doc_items` - Order line items
- `get_delivery_timing` - Requested vs actual delivery
- `get_invoice_timing` - Invoice creation/posting
- `get_master_stub` - Safe master data attributes (no PII)

#### Governance (PromptSpeak Integration)
- PromptSpeak symbolic frame validation
- Pre-execution blocking for sensitive operations
- Human-in-the-loop approval workflows
- Circuit breaker for agent control
- Hold triggers: broad date ranges, high row limits, sensitive patterns
- Governance tools:
  - `ps_precheck` - Dry-run operation check
  - `ps_list_holds` - List pending approvals
  - `ps_approve_hold` / `ps_reject_hold` - Hold management
  - `ps_agent_status` - Check agent state
  - `ps_halt_agent` / `ps_resume_agent` - Emergency controls
  - `ps_stats` - Governance statistics
  - `ps_frame_docs` - PromptSpeak reference

#### Data Adapters
- **RFC Adapter** - Production ECC 6.0 connection via node-rfc
  - Connection pooling with health checks
  - Configurable retry and timeout handling
  - SAP-specific error mapping
- **CSV Adapter** - Load SAP data from SE16 exports
  - Automatic delimiter and encoding detection
  - Field name normalization
- **Synthetic Adapter** - Demo mode with generated data

#### Security
- PII redaction enabled by default
- Audit logging for all operations
- Row limits (default 200, max 1000)
- Read-only BAPI access only

#### Documentation
- Comprehensive README with quickstart
- Adapter configuration guide
- SAP authorization requirements
- Security and threat model documentation
- Architecture diagrams

#### CI/CD
- GitHub Actions workflow for automated testing
- TypeScript and Python test suites

---

## Links

- [v2.0.0 Release](https://github.com/chrbailey/transaction-forensics/releases/tag/v2.0.0)
- [v1.0.0 Release](https://github.com/chrbailey/transaction-forensics/releases/tag/v1.0.0)
- [Full Changelog](https://github.com/chrbailey/transaction-forensics/compare/v1.0.0...v2.0.0)
