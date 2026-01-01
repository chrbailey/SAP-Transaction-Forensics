# SAP Workflow Mining - System Architecture

> **Guiding principle**: Every output traces to tool-returned facts or deterministic computation. If we cannot prove it from retrieved data, we do not claim it.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Data Flow](#data-flow)
4. [Component Descriptions](#component-descriptions)
5. [Design Principles](#design-principles)
6. [Technology Choices](#technology-choices)
7. [Deployment Considerations](#deployment-considerations)

---

## System Overview

The SAP Workflow Mining system discovers latent patterns in SAP document text fields and correlates them with measurable business outcomes. It operates on a strict **facts-only** principle: all findings must trace to actual data returned by tools, with no hallucinated or fabricated patterns.

## High-Level Architecture

```
                                    SAP Workflow Mining System
                                    ==========================

    +-----------------------+         +-----------------------+         +-----------------------+
    |                       |         |                       |         |                       |
    |   Data Source Layer   |         |   Processing Layer    |         |   Output Layer        |
    |                       |         |                       |         |                       |
    +-----------------------+         +-----------------------+         +-----------------------+

          +----------+                      +----------+                      +----------+
          | Synthetic|----+                 |   MCP    |                      | Pattern  |
          |   Data   |    |                 |  Server  |                      |  Cards   |
          +----------+    |                 +----------+                      +----------+
                          |                      ^                                  ^
          +----------+    |    Adapter           |                                  |
          | ECC RFC  |----+----Interface-------->| 8 SAP Tools                      |
          | (future) |    |                      |                                  |
          +----------+    |                      v                                  |
                          |                 +----------+                            |
          +----------+    |                 |Structured|                            |
          | S4 OData |----+                 |   JSON   |------>+----------+         |
          | (future) |                      +----------+       | Pattern  |-------->+
          +----------+                           |             |  Engine  |
                                                 |             +----------+
                                                 v                  |
                                            +----------+            |
                                            |  Audit   |<-----------+
                                            |  Logs    |
                                            +----------+


    Data Flow Direction:  Left ------> Right
    Audit Trail:          All operations logged at every stage
```

## Component Descriptions

### 1. Synthetic Data Generator (`synthetic-data/`)

**Purpose**: Generate realistic SAP SD (Sales & Distribution) documents for testing and development without requiring access to real SAP systems.

**What it does**:
- Produces sales orders (VBAK/VBAP), deliveries (LIKP/LIPS), and invoices (VBRK/VBRP)
- Generates document flow relationships (VBFA)
- Embeds configurable text patterns that correlate with timing outcomes
- Creates master data stubs (customers, materials, users)

**What it does NOT do**:
- Does not connect to any real system
- Does not contain real business data
- Does not claim to perfectly replicate SAP data distributions

**Key design decisions**:
- Patterns are seeded deterministically for reproducible analysis
- Text-to-outcome correlations are deliberately planted (e.g., "CREDIT HOLD" causes delays)
- This allows validation: if the pattern engine cannot find the planted patterns, something is broken

### 2. MCP Server (`mcp-server/`)

**Purpose**: Expose SAP-shaped data through a controlled, read-only API following the Model Context Protocol (MCP).

**What it does**:
- Implements 8 domain-specific tools (not raw table access)
- Enforces row limits (max 200 per query)
- Applies redaction for shareable mode
- Logs every operation with parameters and results

**Tools provided**:

| Tool | Purpose | Returns |
|------|---------|---------|
| `search_doc_text` | Find documents by text pattern | Snippets with match scores |
| `get_doc_text` | Get all text for a document | Header/item texts |
| `get_doc_flow` | Get document chain | Order -> Delivery -> Invoice links |
| `get_sales_doc_header` | Order header details | Org keys, dates, partners |
| `get_sales_doc_items` | Order line items | Materials, quantities, values |
| `get_delivery_timing` | Requested vs actual dates | Timing analysis data |
| `get_invoice_timing` | Invoice creation/posting | Billing cycle data |
| `get_master_stub` | Safe master data | Hashed IDs, categories only |

**What it does NOT do**:
- No raw SQL or table access
- No write operations
- No FI (financial accounting) data exposure
- No HR/payroll data ever

**Key design decisions**:
- Adapter pattern allows swapping data sources (synthetic, ECC RFC, S4 OData)
- Tools return structured JSON, not raw data
- Every response includes metadata about row counts and truncation

### 3. Pattern Engine (`pattern-engine/`)

**Purpose**: Discover text patterns in documents and correlate them with measurable outcomes.

**What it does**:
- Ingests structured JSON from MCP tools
- Normalizes and preprocesses text
- Clusters similar phrases/patterns
- Correlates text patterns to outcomes (cycle times, split deliveries, etc.)
- Generates pattern cards with explicit evidence

**Pipeline stages**:

```
    +---------+     +------------+     +---------+     +-----------+     +--------+
    | Ingest  |---->| Normalize  |---->| Cluster |---->| Correlate |---->| Report |
    +---------+     +------------+     +---------+     +-----------+     +--------+
         |               |                  |               |               |
         v               v                  v               v               v
    Load tool       Clean text,        Group similar   Compute stats,   Generate
    outputs,        tokenize,          patterns,       confidence       pattern
    validate        handle lang        embed if        intervals        cards
    schema                             available
```

**What it does NOT do**:
- Does not invent patterns not present in the data
- Does not claim causation (only correlation)
- Does not access SAP directly (only consumes MCP tool output)

**Key design decisions**:
- Embeddings are optional (works with TF-IDF fallback)
- Explicit confidence intervals and sample sizes on all statistics
- Caveats are mandatory on every pattern card

### 4. Redaction Layer (within Pattern Engine)

**Purpose**: Remove personally identifiable information (PII) and business-sensitive data before output.

**What it redacts**:
- Names (detected via NER or pattern matching)
- Email addresses
- Phone numbers
- Customer-specific identifiers (when in shareable mode)
- Pricing/financial values (when in shareable mode)

**Key design decisions**:
- Redaction is ON by default
- Shareable mode applies additional restrictions
- Original data never persists in logs or output

### 5. Viewer (`viewer/`)

**Purpose**: Optional web UI for exploring pattern cards and evidence.

**What it does**:
- Displays pattern cards in readable format
- Links to supporting evidence
- Allows filtering/sorting by confidence, sample size, effect

**What it does NOT do**:
- Does not perform any analysis
- Does not connect to SAP
- Read-only presentation layer

## Data Flow Detail

```
                           Detailed Data Flow
                           ==================

    [SAP System / Synthetic]
             |
             | Raw-ish data (adapter-specific format)
             v
    +-------------------+
    |  Adapter Layer    |  <- Synthetic: JSON files
    |                   |  <- ECC: RFC calls
    |                   |  <- S4: OData requests
    +-------------------+
             |
             | Normalized internal format
             v
    +-------------------+
    |  MCP Tool Layer   |  <- Validates, limits rows, redacts
    |                   |
    | search_doc_text   |
    | get_doc_text      |
    | get_doc_flow      |
    | get_sales_doc_*   |
    | get_delivery_*    |
    | get_invoice_*     |
    | get_master_stub   |
    +-------------------+
             |
             | Structured JSON (tool responses)
             | + Audit log entry
             v
    +-------------------+
    |  Pattern Engine   |
    |                   |
    | 1. Ingest         |  <- Load JSON, validate schema
    | 2. Normalize      |  <- Text cleaning, tokenization
    | 3. Cluster        |  <- Pattern grouping
    | 4. Correlate      |  <- Statistical analysis
    | 5. Report         |  <- Pattern card generation
    | 6. Redact         |  <- PII removal (always on)
    +-------------------+
             |
             | Pattern cards (JSON)
             | + Evidence ledger
             v
    +-------------------+
    |     Output        |
    |                   |
    | - Pattern cards   |  <- Human-readable findings
    | - Evidence ledger |  <- Traceable doc references
    | - Audit logs      |  <- What was queried
    +-------------------+
```

## Key Design Decisions and Rationale

### 1. Tool-Returned Facts Principle

**Decision**: Every claim in output must trace to specific tool calls and their responses.

**Rationale**:
- LLMs can hallucinate plausible-sounding patterns
- We need human auditors to verify findings
- Traceability enables "prove it or retract it" reviews

**Implementation**:
- Pattern cards include `evidence` block with doc keys
- All statistics include sample sizes
- Audit logs capture every tool invocation

### 2. Separation of Concerns

**Decision**: Strict boundaries between data access (MCP Server), analysis (Pattern Engine), and presentation (Viewer).

**Rationale**:
- Different security profiles (MCP needs SAP access, Viewer does not)
- Different deployment models (MCP may run on-premise, Viewer in cloud)
- Easier to audit and test independently

**Implementation**:
- MCP Server knows nothing about pattern discovery
- Pattern Engine never connects to SAP directly
- Viewer is stateless presentation

### 3. Read-Only by Design

**Decision**: No component can write to SAP. Ever.

**Rationale**:
- Risk mitigation: cannot corrupt production data
- Simpler authorization model
- Clear audit story for compliance

**Implementation**:
- Adapters use read-only APIs (RFC_READ_TABLE, not BAPI_UPDATE)
- No database write connections configured
- Authorization objects require only read permissions

### 4. Row Limits Everywhere

**Decision**: Maximum 200 rows per tool call, enforced at MCP layer.

**Rationale**:
- Prevents accidental data dumps
- Forces iterative, targeted queries
- Limits performance impact on SAP systems

**Implementation**:
- MCP tools enforce limits before returning
- Response includes `truncated: true` when applicable
- Pattern engine handles sampling appropriately

### 5. Redaction Default-On

**Decision**: PII removal is enabled by default, must be explicitly disabled.

**Rationale**:
- Privacy-by-default reduces risk of accidental exposure
- Shareable reports should be safe to distribute
- Better to over-redact than under-redact

**Implementation**:
- Redaction runs as final step before output
- Different levels: basic (PII), shareable (PII + business)
- Original data never logged

### 6. Explicit Uncertainty

**Decision**: Every statistical claim includes confidence intervals, sample sizes, and caveats.

**Rationale**:
- Correlation does not imply causation
- Small samples can produce misleading patterns
- Users must be able to assess reliability

**Implementation**:
- Pattern cards have mandatory `caveats` array
- Statistics include confidence intervals
- Sample sizes displayed prominently

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| MCP Server | TypeScript | MCP SDK is TypeScript-first; type safety for tool schemas |
| Pattern Engine | Python | ML ecosystem (scikit-learn, pandas); data science standard |
| Synthetic Data | Python | Faker library; consistent with pattern engine |
| Viewer | (TBD) | Likely React or simple HTML; minimal complexity |

## Deployment Considerations

### Development Mode
- All components run locally
- Synthetic data only
- No network access required

### On-Premise Mode
- MCP Server runs inside firewall with SAP access
- Pattern Engine can run anywhere with access to MCP
- Viewer can be internal or external

### Hybrid Mode
- MCP Server on-premise (SAP access)
- Pattern Engine in cloud (more compute)
- Secure channel between (TLS, VPN, etc.)

## What Success Looks Like

1. **Pattern engine finds the planted patterns** in synthetic data
2. **No patterns appear that were not planted** (no hallucinations)
3. **Real SAP deployment** finds similar patterns (or legitimately different ones)
4. **Auditors can trace** any claim to specific tool calls and document keys
5. **Nothing breaks** when patterns do not exist (graceful "no findings" output)

## What Failure Looks Like

1. Pattern engine claims patterns that cannot be found in data
2. Real SAP deployment crashes or corrupts data
3. PII leaks into shareable reports
4. Statistics are misleading due to sampling bias
5. Performance impact makes SAP unusable

If any of these occur, the system has failed and must be fixed before production use.

---

## Enterprise Security Architecture

### Network Boundary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           YOUR NETWORK (On-Premise)                         │
│                                                                             │
│  ┌─────────────────────┐         ┌─────────────────────────────────────┐   │
│  │     SAP ECC 6.0     │         │      SAP Workflow Mining            │   │
│  │                     │   RFC   │         (Docker)                    │   │
│  │  ┌──────┐ ┌──────┐  │◄───────►│  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │  SD  │ │  MM  │  │         │  │ MCP Server  │  │   Pattern   │  │   │
│  │  └──────┘ └──────┘  │         │  │  (Node.js)  │  │   Engine    │  │   │
│  │  ┌──────┐ ┌──────┐  │         │  └─────────────┘  │  (Python)   │  │   │
│  │  │  FI  │ │  PP  │  │         │                   └─────────────┘  │   │
│  │  └──────┘ └──────┘  │         └─────────────────────────────────────┘   │
│  └─────────────────────┘                                                    │
│                                                                             │
│  ════════════════════════════════════════════════════════════════════════  │
│                           NETWORK BOUNDARY                                  │
│                     NO DATA LEAVES THIS BOUNDARY                            │
│  ════════════════════════════════════════════════════════════════════════  │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────┐
                              │   THE CLOUD     │
                              │                 │
                              │   ┌─────────┐   │
                              │   │    ❌   │   │
                              │   │ NO DATA │   │
                              │   │  SENT   │   │
                              │   └─────────┘   │
                              │                 │
                              └─────────────────┘
```

### Security Controls

| Control | Implementation | Verification |
|---------|---------------|--------------|
| **Read-Only Access** | Only read BAPIs used | Authorization object S_RFC |
| **No Cloud Egress** | Docker network: none | Network policy / firewall |
| **Audit Logging** | Every RFC call logged | Log review / SIEM |
| **Data Minimization** | 200 row limit per query | Code review |
| **PII Redaction** | Default-on redaction | Output inspection |
| **Credential Security** | Env vars, not files | Container inspection |

### Network Requirements

| Connection | Port | Direction | Required |
|------------|------|-----------|----------|
| SAP RFC | 33XX | Outbound from Docker | RFC mode only |
| Docker Internal | - | Local only | Always |
| Internet | - | **None** | Never required |

**Note**: XX = SAP system number (e.g., 3300 for system 00)

---

## Scaling Guide

| Scenario | Documents | Memory | CPU | Time |
|----------|-----------|--------|-----|------|
| Small | 1,000 | 512MB | 1 | <1 min |
| Medium | 10,000 | 2GB | 2 | 2-3 min |
| Large | 100,000 | 8GB | 4 | 15-20 min |
| Enterprise | 1,000,000 | 32GB | 8 | 2-3 hrs |
