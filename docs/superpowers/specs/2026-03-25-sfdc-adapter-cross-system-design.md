# SFDC Adapter + Cross-System Correlation — Design Spec

**Date:** 2026-03-25
**Status:** Approved
**Scope:** Add Salesforce adapter to SAP-Transaction-Forensics, enable cross-system ERP/CRM correlation

---

## 1. Problem Statement

The SAP-Transaction-Forensics project analyzes ERP transaction data through an adapter-based MCP server (6 adapters) and a Python pattern engine (conformance checking, clustering, temporal analysis, outcome correlation). All analysis is SAP-only.

Salesforce CRM data contains complementary process signals — Opportunity pipeline behavior, Activity patterns, stage transition timing — that reveal process anomalies invisible to ERP-only analysis. When correlated across systems, CRM+ERP data exposes the highest-value findings: deals closed in SFDC but never ordered in SAP, timing gaps between CRM commitment and ERP execution, and discrepancies between forecast amounts and actual order values.

No existing tool performs cross-system process forensics at this level. Celonis and Signavio analyze SAP in isolation. Einstein Analytics analyzes SFDC in isolation. This design bridges the gap.

## 2. Goals

1. **SFDC Adapter**: Implement `IDataAdapter` for Salesforce data, starting with synthetic data and extensible to live REST API
2. **Analysis Parity**: Ensure the pattern engine produces equivalent-quality insights on SFDC data as it does on SAP data
3. **Cross-System Correlation**: Match SFDC records to SAP records and produce unified event logs for combined analysis
4. **Testability**: 10 planted anomaly patterns in synthetic data, ~90 tests across all layers
5. **Extensibility**: Architecture supports adding more systems (NetSuite, Dynamics, etc.) via the same adapter pattern

## 3. Non-Goals

- Live Salesforce REST API client (Phase 2 — stub only in this phase)
- Salesforce authentication / Connected App setup
- UI/dashboard for cross-system visualization
- Real-time streaming / CDC integration
- Modifying existing SAP adapters or pattern engine core

## 4. Architecture Overview

```
                    ┌─────────────────────────────────────────────────┐
                    │               MCP Server (TypeScript)           │
                    │                                                 │
                    │  adapters/                                      │
                    │    synthetic/ ── existing SAP synthetic         │
                    │    bpi/       ── existing BPI 2019              │
                    │    csv/       ── existing CSV loader            │
                    │    ecc_rfc/   ── existing RFC (stub)            │
                    │    s4_odata/  ── existing OData (stub)          │
                    │    salt/      ── existing SALT                  │
                    │    sfdc/      ── NEW: Salesforce adapter        │
                    │                                                 │
                    │  cross-system/                                  │
                    │    entity-resolver.ts   ── entity matching      │
                    │    unified-log.ts       ── merged event log     │
                    │    index.ts             ── MCP tools            │
                    └──────────────────┬──────────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────────────────┐
                    │            Pattern Engine (Python)              │
                    │                                                 │
                    │  ingest/                                        │
                    │    sfdc_adapter.py      ── NEW: SFDC ingestion  │
                    │                                                 │
                    │  conformance/templates/                         │
                    │    opportunity_pipeline.py ── NEW: SFDC models  │
                    │                                                 │
                    │  correlate/                                     │
                    │    cross_system.py      ── NEW: cross-system    │
                    │    outcome_analyzer.py  ── existing (unchanged) │
                    │                                                 │
                    │  cluster/  ── existing (unchanged)              │
                    │  prediction/  ── existing (unchanged)           │
                    └─────────────────────────────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────────────────┐
                    │          Synthetic Data (Python)                │
                    │                                                 │
                    │  generate_sfdc.py       ── NEW: SFDC generator  │
                    │  sfdc_templates/        ── NEW: JSON schemas    │
                    └─────────────────────────────────────────────────┘
```

## 5. Component Specifications

### 5.1 Synthetic SFDC Data Generator

**Location:** `synthetic-data/src/generate_sfdc.py`
**Language:** Python 3.9+
**Purpose:** Generate realistic Salesforce Opportunity lifecycle data with planted anomaly patterns

#### Data Model

**Accounts** (`sfdc_templates/account.json`):
```json
{
  "account_id": "001xx000001xyz",
  "name": "Acme Corporation",
  "industry": "Manufacturing",
  "billing_state": "CA",
  "billing_country": "US",
  "type": "Customer",
  "number_of_employees": 5000,
  "annual_revenue": 50000000,
  "sap_customer_number": "0000045678"
}
```

**Opportunities** (`sfdc_templates/opportunity.json`):
```json
{
  "opportunity_id": "006xx000001abc",
  "name": "Acme Corp - Enterprise License Q3",
  "account_id": "001xx000001xyz",
  "record_type": "New Business",
  "stage_name": "Closed Won",
  "amount": 125000.00,
  "currency_iso_code": "USD",
  "owner_id": "005xx000001def",
  "created_date": "2025-06-15T10:30:00Z",
  "close_date": "2025-09-30",
  "type": "New Business",
  "lead_source": "Web",
  "probability": 100,
  "forecast_category": "Closed",
  "sap_order_number": "0000012345",
  "is_closed": true,
  "is_won": true
}
```

**Stage History** (`sfdc_templates/stage_history.json`):
```json
{
  "id": "017xx000001abc",
  "opportunity_id": "006xx000001abc",
  "stage_name": "Qualification",
  "previous_stage": null,
  "created_date": "2025-06-15T10:30:00Z",
  "amount": 100000.00,
  "probability": 20,
  "expected_revenue": 20000.00,
  "close_date": "2025-09-30",
  "duration_days": 15,
  "changed_by": "005xx000001def"
}
```

**Line Items** (`sfdc_templates/line_item.json`):
```json
{
  "line_item_id": "00kxx000001abc",
  "opportunity_id": "006xx000001abc",
  "product_id": "01txx000001abc",
  "product_code": "ENT-LIC-001",
  "product_name": "Enterprise License",
  "product_family": "Software",
  "quantity": 100,
  "unit_price": 1250.00,
  "total_price": 125000.00,
  "sort_order": 1,
  "service_date": "2025-10-01",
  "description": "Annual enterprise license - 100 seats"
}
```

**Activities** (`sfdc_templates/activity.json`):
```json
{
  "activity_id": "00Txx000001abc",
  "type": "Task",
  "subject": "Follow up call with procurement",
  "status": "Completed",
  "priority": "Normal",
  "activity_date": "2025-06-20",
  "owner_id": "005xx000001def",
  "what_id": "006xx000001abc",
  "who_id": "003xx000001ghi",
  "description": "Discussed pricing terms and timeline for Q3 delivery"
}
```

#### Generation Parameters

| Parameter | Default | Description |
|---|---|---|
| `n_accounts` | 50 | Number of unique Accounts |
| `n_opportunities` | 200 | Total Opportunities across all Accounts |
| `n_users` | 20 | Number of sales rep Owner IDs |
| `n_products` | 15 | Product catalog size |
| `sap_link_rate` | 0.60 | Fraction with matching SAP records |
| `date_range_start` | 2024-01-01 | Earliest Created Date |
| `date_range_end` | 2025-12-31 | Latest Created Date |
| `win_rate` | 0.35 | Fraction that reach Closed Won |
| `seed` | 42 | Random seed for reproducibility |

#### Planted Anomaly Patterns

Each pattern has a fixed incidence rate and a `_pattern_flags` field on affected records listing which patterns apply (for test validation).

| # | Pattern Name | Incidence | Implementation | Detection Target |
|---|---|---|---|---|
| 1 | `STAGE_SKIP` | 5% of Opps | Remove 1-2 intermediate stages from history | Conformance: SKIPPED_ACTIVITY |
| 2 | `QUARTER_END_COMPRESSION` | 40% of Closed Won | CloseDate in last 5 days of quarter | Temporal: period-end clustering |
| 3 | `GHOST_PIPELINE` | 10% of late-stage Opps | Stage >= Proposal, 0 Activities | Correlation: activity density outlier |
| 4 | `STAGE_REGRESSION` | 3% of Opps | One backward stage move in history | Conformance: WRONG_ORDER |
| 5 | `AMOUNT_INFLATION` | 8% of Opps | Amount increases >50% in final stage transition | Correlation: amount delta outlier |
| 6 | `SPLIT_DEAL` | 6% of Opps | Two Opps on same Account within 7 days, combined amount matches a larger single deal | Cross-entity: Account+date clustering |
| 7 | `SPEED_ANOMALY` | 5% of Opps | Created to Closed Won in <3 days | Temporal: duration outlier |
| 8 | `STALE_PIPELINE` | 15% of open Opps | No stage change or activity for >90 days | Temporal: inactivity detection |
| 9 | `OWNER_SWAP_AT_CLOSE` | 4% of Closed Won | OwnerId changes in final stage transition | Conformance: unexpected actor change |
| 10 | `CROSS_SYSTEM_GAP` | 6% of SAP-linked Opps | >30 day gap between SFDC CloseDate and SAP ERDAT | Cross-system: timing correlation |

#### SAP Record Generation

For Opportunities with `sap_link_rate` probability, the generator also outputs matching SAP synthetic records:
- `sap_orders.json`: Sales orders with VBELN matching `sap_order_number`
- `sap_deliveries.json`: Delivery docs for Won orders
- `sap_invoices.json`: Invoice docs for delivered orders
- `sap_doc_flows.json`: Document flow entries linking the chain
- `sap_customers.json`: Customer master stubs with `sap_customer_number` matching Account

These use the same JSON schema as the existing SAP synthetic generator in `synthetic-data/sample_output/`.

### 5.2 SFDC Adapter (TypeScript)

**Location:** `mcp-server/src/adapters/sfdc/`
**Implements:** `IDataAdapter` (8 tool methods)

#### Files

**`sfdc-types.ts`** — Native Salesforce type definitions (Opportunity, Account, StageHistory, LineItem, Activity). These represent the data as Salesforce returns it, before normalization.

**`field-mapper.ts`** — Bidirectional mapping between SFDC native types and SAP types (`SalesDocHeader`, `SalesDocItem`, `DocFlowResult`, etc.). This is the core normalization layer.

Complete field mapping:

**Opportunity → SalesDocHeader:**
| SAP Field | SFDC Field | Notes |
|---|---|---|
| `VBELN` | `opportunity_id` | Padded/formatted to 10 chars |
| `AUART` | `record_type` | Mapped to 4-char code: "New Business"→"ZNEW", "Renewal"→"ZREN", etc. |
| `VKORG` | `owner_division` or "SFDC" | Falls back to "SFDC" if no division field |
| `VTWEG` | `lead_source` or "00" | Lossy: no direct SFDC equivalent |
| `SPART` | `product_family` (from first line item) or "00" | Lossy |
| `KUNNR` | `account_id` | Padded to 10 chars |
| `KUNWE` | `account_id` | Same as KUNNR (no ship-to in SFDC) |
| `AUDAT` | `created_date` | Formatted YYYYMMDD |
| `VDATU` | `close_date` | Formatted YYYYMMDD |
| `ERNAM` | `owner_id` | |
| `ERDAT` | `created_date` | Formatted YYYYMMDD |
| `ERZET` | `created_date` | Time portion HHMMSS |
| `GBSTK` | derived from `stage_name` + `is_closed` + `is_won` | "C"=Closed Won, "A"=Open, "B"=In Progress |
| `NETWR` | `amount` | |
| `WAERK` | `currency_iso_code` | |
| `BSTNK` | `sap_order_number` | Cross-system reference |

**OpportunityLineItem → SalesDocItem:**
| SAP Field | SFDC Field |
|---|---|
| `VBELN` | `opportunity_id` |
| `POSNR` | `sort_order` (formatted to 6 chars) |
| `MATNR` | `product_code` (padded to 18 chars) |
| `ARKTX` | `product_name` |
| `WERKS` | "SFDC" (no plant concept) |
| `KWMENG` | `quantity` |
| `VRKME` | "EA" (each, default) |
| `NETWR` | `total_price` |
| `WAERK` | inherited from Opportunity |
| `PSTYV` | derived from `product_family` |

**StageHistory → DocFlowResult:**
Each stage transition becomes a document flow entry:
| SAP Field | SFDC Field |
|---|---|
| `VBELV` (preceding doc) | `opportunity_id` |
| `POSNV` | "000000" |
| `VBELN` (subsequent doc) | `opportunity_id` + stage index |
| `VBTYP` | stage code derived from `stage_name` |
| `ERDAT` | `created_date` of transition |
| `RFMNG` | `amount` at this stage |
| `PLMIN` | `duration_days` |

**Activity → DocTextResult:**
Activities map to document texts:
| SAP Field | SFDC Field |
|---|---|
| `VBELN` | `what_id` (Opportunity ID) |
| `TDID` | "TASK" or "EVNT" based on Activity type |
| `TEXT` | `subject` + "\n" + `description` |
| `AEDAT` | `activity_date` |

**`process-models.ts`** — Defines SFDC-specific process models for conformance checking:

```typescript
interface SFDCProcessModel {
  recordType: string;
  stages: string[];           // Ordered stage names
  terminalStages: string[];   // Closed Won, Closed Lost
  allowedRegressions: string[][]; // Pairs of [from, to] that are OK
}

const STANDARD_PIPELINES: SFDCProcessModel[] = [
  {
    recordType: "New Business",
    stages: ["Prospecting", "Qualification", "Needs Analysis",
             "Value Proposition", "Id. Decision Makers",
             "Perception Analysis", "Proposal/Price Quote",
             "Negotiation/Review", "Closed Won"],
    terminalStages: ["Closed Won", "Closed Lost"],
    allowedRegressions: []
  },
  {
    recordType: "Renewal",
    stages: ["Qualification", "Proposal", "Closed Won"],
    terminalStages: ["Closed Won", "Closed Lost"],
    allowedRegressions: []
  },
  {
    recordType: "Upsell",
    stages: ["Discovery", "Proposal", "Negotiation", "Closed Won"],
    terminalStages: ["Closed Won", "Closed Lost"],
    allowedRegressions: []
  }
];
```

For the synthetic adapter, these are hardcoded. For the future REST adapter, they would be discovered via `SELECT StageName, SortOrder FROM OpportunityStage`.

**`index.ts`** — `SFDCSyntheticAdapter` class:

```typescript
export class SFDCSyntheticAdapter extends BaseDataAdapter {
  readonly name = 'sfdc';
  private opportunities: SFDCOpportunity[] = [];
  private accounts: SFDCAccount[] = [];
  private stageHistories: Map<string, SFDCStageHistory[]> = new Map();
  private lineItems: Map<string, SFDCLineItem[]> = new Map();
  private activities: Map<string, SFDCActivity[]> = new Map();
  private mapper: SFDCFieldMapper;

  constructor(private dataDir?: string) {
    super();
    this.mapper = new SFDCFieldMapper();
  }

  protected async doInitialize(): Promise<void> {
    // Load synthetic JSON files from dataDir
    // Build indexes by opportunity_id, account_id
  }

  // Each tool method: load SFDC data → normalize via mapper → return SAP types
  async getSalesDocHeader(params): Promise<SalesDocHeader | null> {
    const opp = this.findOpportunity(params.vbeln);
    return opp ? this.mapper.opportunityToSalesDocHeader(opp) : null;
  }
  // ... (all 8 methods)
}

registerAdapter('sfdc', () => new SFDCSyntheticAdapter());
```

### 5.3 Cross-System Correlation (TypeScript + Python)

#### 5.3.1 Entity Resolver (`mcp-server/src/cross-system/entity-resolver.ts`)

Three matching strategies, each producing `MatchCandidate` objects with confidence scores:

**Strategy 1: Explicit ID Match** (confidence: 0.99)
```typescript
interface ExplicitMatch {
  strategy: 'explicit_id';
  sfdc_opportunity_id: string;
  sap_vbeln: string;
  confidence: 0.99;
  match_field: 'sap_order_number';
}
```
Match condition: `Opportunity.sap_order_number === VBAK.VBELN`

**Strategy 2: Account + Amount + Date Proximity** (confidence: 0.50-0.95)
```typescript
interface ProximityMatch {
  strategy: 'proximity';
  sfdc_opportunity_id: string;
  sap_vbeln: string;
  confidence: number; // 0.50-0.95 based on composite score
  account_similarity: number;  // Levenshtein normalized
  amount_similarity: number;   // 1 - |diff| / max
  date_proximity_days: number; // |CloseDate - ERDAT|
}
```
Match condition (all must pass):
- `levenshtein(Account.name, KNA1.NAME1) / max(len) < 0.3`
- `|Amount - NETWR| / max(Amount, NETWR) < 0.10` (10% tolerance)
- `|CloseDate - ERDAT| <= 45 days`

Confidence = weighted average: 0.4 * account_sim + 0.3 * amount_sim + 0.3 * date_sim

**Strategy 3: Temporal Sequence** (confidence: 0.30-0.80)
Given known Account mapping, find SFDC and SAP events forming plausible O2C chain:
```
SFDC Created → SFDC Stages → SFDC Closed Won → SAP Order → SAP Delivery → SAP Invoice
```
Confidence increases with: monotonic timestamps, consistent amounts, complete chain.

**Resolution algorithm:**
1. Run all three strategies
2. For each SFDC record, keep highest-confidence match
3. Apply deduplication (each SAP record matches at most one SFDC record)
4. Return matches above threshold (default: 0.50)

#### 5.3.2 Unified Event Log (`mcp-server/src/cross-system/unified-log.ts`)

Merges SFDC and SAP event sequences into a single timeline per correlation group:

```typescript
interface UnifiedEvent {
  correlation_id: string;      // Groups matched records
  system: 'sfdc' | 'sap';
  event_type: string;          // 'stage_change', 'order_created', 'delivery', 'invoice', 'activity'
  timestamp: string;           // ISO 8601
  entity_id: string;           // Opportunity ID or VBELN
  details: Record<string, unknown>;
}

interface UnifiedEventLog {
  correlation_id: string;
  sfdc_opportunity_id: string;
  sap_vbeln: string | null;
  match_confidence: number;
  events: UnifiedEvent[];      // Sorted by timestamp
  cross_system_metrics: {
    total_duration_days: number;
    sfdc_to_sap_gap_days: number | null;
    amount_discrepancy: number | null;
    stage_count_sfdc: number;
    doc_flow_count_sap: number;
  };
}
```

#### 5.3.3 Cross-System MCP Tools (`mcp-server/src/cross-system/index.ts`)

Three new MCP tools:

1. **`correlate_systems`** — Run entity resolution across loaded SFDC and SAP datasets
   - Input: adapter names (e.g., 'sfdc' + 'synthetic'), matching strategy, confidence threshold
   - Output: Array of matches with confidence scores

2. **`get_unified_log`** — Get the unified event timeline for a specific correlation
   - Input: correlation_id or sfdc_opportunity_id
   - Output: `UnifiedEventLog` with merged timeline and cross-system metrics

3. **`analyze_cross_system_gaps`** — Find timing discrepancies, amount mismatches, and missing handoffs across matched records
   - Input: correlation results
   - Output: Array of gap findings with severity and evidence

### 5.4 Pattern Engine Extensions (Python)

#### 5.4.1 SFDC Process Models (`pattern-engine/src/conformance/templates/opportunity_pipeline.py`)

Defines `ProcessModel` instances compatible with the existing conformance checker:

```python
from ..models import ProcessModel

def build_opportunity_pipeline(record_type: str = "New Business") -> ProcessModel:
    """Build a process model for SFDC Opportunity conformance checking."""
    # Maps record type to stage sequence
    # Returns ProcessModel with activities, transitions, terminal states

PIPELINES = {
    "New Business": [
        "Prospecting", "Qualification", "Needs Analysis",
        "Value Proposition", "Id. Decision Makers",
        "Perception Analysis", "Proposal/Price Quote",
        "Negotiation/Review"
    ],
    "Renewal": ["Qualification", "Proposal"],
    "Upsell": ["Discovery", "Proposal", "Negotiation"],
}
TERMINAL_STAGES = ["Closed Won", "Closed Lost"]
```

#### 5.4.2 SFDC Ingest Adapter (`pattern-engine/src/ingest/sfdc_adapter.py`)

Loads SFDC synthetic data and converts to the unified event-log format the pattern engine expects:

```python
def load_sfdc_data(data_dir: str) -> dict:
    """Load SFDC synthetic data files and build unified record structure.

    Returns:
        {
            "opportunities": [...],
            "stage_histories": {...},  # keyed by opp_id
            "line_items": {...},
            "activities": {...},
            "accounts": {...},
            "process_models": {...},   # keyed by record_type
        }
    """

def sfdc_to_event_log(data: dict) -> list[dict]:
    """Convert SFDC data to event-log records for pattern engine.

    Each record: {
        "case_id": opportunity_id,
        "activity": stage_name or activity type,
        "timestamp": ISO datetime,
        "resource": owner_id or changed_by,
        "attributes": { ... additional fields ... }
    }
    """
```

#### 5.4.3 Cross-System Correlator (`pattern-engine/src/correlate/cross_system.py`)

Python-side analysis that operates on unified event logs:

```python
def find_cross_system_anomalies(
    unified_logs: list[dict],
    gap_threshold_days: int = 30,
    amount_tolerance: float = 0.05,
) -> list[dict]:
    """Analyze unified event logs for cross-system anomalies.

    Detects:
    - Timing gaps: SFDC close → SAP order creation > threshold
    - Amount discrepancy: SFDC Amount vs SAP NETWR > tolerance
    - Missing handoff: SFDC Closed Won but no SAP order
    - Sequence violations: SAP order before SFDC close
    - Delivery-to-commit gap: SAP delivery date vs SFDC committed date
    """

def compute_cross_system_metrics(
    sfdc_data: dict,
    sap_data: dict,
    matches: list[dict],
) -> dict:
    """Compute aggregate metrics across matched records.

    Returns:
    {
        "total_matched": int,
        "total_unmatched_sfdc": int,
        "total_unmatched_sap": int,
        "avg_gap_days": float,
        "median_gap_days": float,
        "amount_discrepancy_rate": float,
        "missing_handoff_rate": float,
        "anomaly_counts_by_type": {...},
    }
    """
```

## 6. Testing Strategy

### 6.1 Test Matrix

| Layer | Location | Framework | Count |
|---|---|---|---|
| Synthetic generator | `synthetic-data/tests/test_generate_sfdc.py` | pytest | ~12 |
| Field mapper | `mcp-server/src/adapters/sfdc/__tests__/field-mapper.test.ts` | Jest | ~16 |
| SFDC adapter integration | `mcp-server/src/adapters/sfdc/__tests__/sfdc-synthetic.test.ts` | Jest | ~10 |
| Process models | `mcp-server/src/adapters/sfdc/__tests__/process-models.test.ts` | Jest | ~6 |
| Entity resolver | `mcp-server/src/cross-system/__tests__/entity-resolver.test.ts` | Jest | ~10 |
| Unified log | `mcp-server/src/cross-system/__tests__/unified-log.test.ts` | Jest | ~6 |
| SFDC conformance | `pattern-engine/tests/test_sfdc_conformance.py` | pytest | ~8 |
| SFDC ingest | `pattern-engine/tests/test_sfdc_ingest.py` | pytest | ~6 |
| Cross-system correlation | `pattern-engine/tests/test_cross_system.py` | pytest | ~10 |
| Pattern detection (planted) | `pattern-engine/tests/test_sfdc_patterns.py` | pytest | ~10 |
| **Total** | | | **~94** |

### 6.2 Pattern Detection Validation

For each of the 10 planted patterns, a specific test verifies:
1. Pattern records exist in synthetic data (precondition)
2. The appropriate analysis module detects them
3. Detection rate >= 80% of planted instances
4. False positive rate is documented (not necessarily zero — some patterns overlap)

### 6.3 Cross-System Test Scenarios

| Scenario | Setup | Expected |
|---|---|---|
| Perfect match | Explicit ID, identical amounts, sequential timing | Confidence 0.99, no anomalies |
| Timing gap | SFDC closed 45 days before SAP order | Gap anomaly detected |
| Amount mismatch | SFDC $100K, SAP $85K | Amount discrepancy flagged |
| Missing handoff | SFDC Closed Won, no SAP record | Unmatched SFDC flagged |
| Reverse sequence | SAP order created before SFDC close | Sequence violation detected |
| Fuzzy match | Account names differ slightly ("Acme Corp" vs "ACME CORPORATION") | Proximity match with reduced confidence |

## 7. File Inventory

### New Files (create)

| File | Language | Purpose |
|---|---|---|
| `synthetic-data/src/generate_sfdc.py` | Python | SFDC data generator |
| `synthetic-data/sfdc_templates/opportunity.json` | JSON | Schema template |
| `synthetic-data/sfdc_templates/stage_history.json` | JSON | Schema template |
| `synthetic-data/sfdc_templates/line_item.json` | JSON | Schema template |
| `synthetic-data/sfdc_templates/activity.json` | JSON | Schema template |
| `synthetic-data/sfdc_templates/account.json` | JSON | Schema template |
| `synthetic-data/sfdc_output/.gitkeep` | — | Output directory |
| `mcp-server/src/adapters/sfdc/index.ts` | TypeScript | SFDCSyntheticAdapter |
| `mcp-server/src/adapters/sfdc/sfdc-types.ts` | TypeScript | Salesforce type defs |
| `mcp-server/src/adapters/sfdc/field-mapper.ts` | TypeScript | SFDC→SAP normalization |
| `mcp-server/src/adapters/sfdc/process-models.ts` | TypeScript | Pipeline definitions |
| `mcp-server/src/adapters/sfdc/rest-client.ts` | TypeScript | REST API stub (Phase 2) |
| `mcp-server/src/adapters/sfdc/__tests__/field-mapper.test.ts` | TypeScript | Unit tests |
| `mcp-server/src/adapters/sfdc/__tests__/sfdc-synthetic.test.ts` | TypeScript | Integration tests |
| `mcp-server/src/adapters/sfdc/__tests__/process-models.test.ts` | TypeScript | Model tests |
| `mcp-server/src/cross-system/index.ts` | TypeScript | MCP tools |
| `mcp-server/src/cross-system/entity-resolver.ts` | TypeScript | Entity matching |
| `mcp-server/src/cross-system/unified-log.ts` | TypeScript | Merged event log |
| `mcp-server/src/cross-system/__tests__/entity-resolver.test.ts` | TypeScript | Resolver tests |
| `mcp-server/src/cross-system/__tests__/unified-log.test.ts` | TypeScript | Log tests |
| `pattern-engine/src/conformance/templates/opportunity_pipeline.py` | Python | SFDC process models |
| `pattern-engine/src/ingest/sfdc_adapter.py` | Python | SFDC data ingestion |
| `pattern-engine/src/correlate/cross_system.py` | Python | Cross-system analysis |
| `pattern-engine/tests/test_sfdc_conformance.py` | Python | Conformance tests |
| `pattern-engine/tests/test_sfdc_ingest.py` | Python | Ingest tests |
| `pattern-engine/tests/test_cross_system.py` | Python | Correlation tests |
| `pattern-engine/tests/test_sfdc_patterns.py` | Python | Pattern detection tests |
| `synthetic-data/tests/test_generate_sfdc.py` | Python | Generator tests |

### Modified Files (edit)

None. The existing adapter registry auto-discovers via `registerAdapter()` calls. The pattern engine modules are consumed, not modified.

## 8. Dependencies

### TypeScript (mcp-server)
- No new dependencies. Uses existing: `fs/promises`, `path`, `crypto`
- Entity resolver uses basic string distance (implement Levenshtein inline, ~20 lines)

### Python (pattern-engine, synthetic-data)
- No new dependencies. Uses existing: `json`, `random`, `datetime`, `dataclasses`
- Cross-system module uses existing `numpy`, `scipy` from pattern-engine requirements

## 9. Phases

**Phase 1 (this spec):**
- Synthetic data generator with 10 planted patterns
- SFDC adapter implementing IDataAdapter
- Field mapper with full normalization
- SFDC process models for conformance
- Cross-system entity resolver + unified log
- Python-side ingest, conformance templates, cross-system correlator
- ~94 tests

**Phase 2 (future):**
- Live Salesforce REST API client
- OAuth2 authentication flow
- Dynamic process model discovery from live org metadata
- Real-time CDC/streaming integration
- Dashboard visualization

## 10. Success Criteria

1. All 8 `IDataAdapter` methods return valid data from SFDC synthetic adapter
2. Conformance checker detects stage-skipping and regression patterns with >=80% recall
3. Temporal analysis detects quarter-end compression
4. Cross-system correlation correctly matches >=95% of explicitly-linked records
5. Cross-system timing gaps detected for all planted `CROSS_SYSTEM_GAP` patterns
6. All ~94 tests pass
7. Existing SAP tests continue to pass (no regressions)
