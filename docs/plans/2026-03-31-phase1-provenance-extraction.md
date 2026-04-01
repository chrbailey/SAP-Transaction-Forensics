# Phase 1: Provenance Graph + Extraction Registry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the evidence infrastructure that transforms probabilistic model output into domain-verifiable ERP findings with field-level provenance and deterministic, replay-verifiable extraction paths.

**Architecture:** Two new subsystems in `mcp-server/src/`: (1) `provenance/` — SQLite-backed DAG that traces every finding back to specific system/table/record/field/value/timestamp tuples, with replay hashes for independent verification; (2) `extraction-registry/` — a library of named, versioned, deterministic extraction paths (SQL/SOQL/SavedSearch) that produce identical results given identical inputs, eliminating the non-reproducibility of LLM-generated queries.

**Tech Stack:** TypeScript (ES2022, NodeNext), SQLite via better-sqlite3, Jest (ESM mode), crypto (SHA-256)

---

## File Structure

### New Files — Provenance System
- `src/provenance/types.ts` — ExtractionRecord, FindingEvidence, ProvenanceNode, ProvenanceDAG types
- `src/provenance/schema.ts` — SQLite schema, migrations, ProvenanceDB class
- `src/provenance/logger.ts` — ProvenanceLogger middleware wrapping IDataAdapter calls
- `src/provenance/replay.ts` — Deterministic hash computation for queries and result sets
- `src/provenance/query.ts` — Query API: trace finding → evidence → extraction chain
- `src/provenance/export.ts` — Export provenance DAG as JSON
- `src/provenance/index.ts` — Public API barrel export

### New Files — Extraction Registry
- `src/extraction-registry/types.ts` — ExtractionPath, ParameterDef, FieldDef, ExtractionResult types
- `src/extraction-registry/index.ts` — Registry loader, path lookup, deterministic executor
- `src/extraction-registry/metadata.ts` — Version management, path validation
- `src/extraction-registry/sap/o2c.ts` — 5 O2C extraction paths (VBAK, VBAP, VBFA, LIKP/LIPS, VBRK/VBRP)
- `src/extraction-registry/sap/fi-co.ts` — 4 FI/CO paths (BKPF, BSEG, SoD, GL)
- `src/extraction-registry/sap/p2p.ts` — 4 P2P paths (EKKO/EKPO, EBAN, EKBE, RBKP/RSEG)
- `src/extraction-registry/netsuite/user-audit.ts` — 3 NetSuite paths (users, transactions, logins)
- `src/extraction-registry/sfdc/pipeline.ts` — 3 SFDC paths (opportunities, activities, stages)

### New Test Files
- `src/__tests__/provenance-schema.test.ts`
- `src/__tests__/provenance-logger.test.ts`
- `src/__tests__/provenance-replay.test.ts`
- `src/__tests__/provenance-query.test.ts`
- `src/__tests__/extraction-registry.test.ts`
- `src/__tests__/extraction-sap-o2c.test.ts`
- `src/__tests__/extraction-sap-fico.test.ts`
- `src/__tests__/extraction-sap-p2p.test.ts`
- `src/__tests__/extraction-netsuite.test.ts`
- `src/__tests__/extraction-sfdc.test.ts`
- `src/__tests__/provenance-integration.test.ts`
- `src/__tests__/extraction-mcp-tools.test.ts`

### Modified Files
- `src/tools/index.ts` — Add 3 new MCP tools: query_provenance, list_extraction_paths, run_extraction
- `src/adapters/csv/index.ts` — Wire provenance logging into CSV adapter calls
- `src/adapters/sfdc/index.ts` — Wire provenance logging into SFDC adapter calls

---

## Shared Type Definitions

All tasks reference these canonical types. Defined in Task 1.

```typescript
// === provenance/types.ts ===
export type SystemType = 'SAP' | 'NetSuite' | 'Salesforce';
export type EvidenceRole = 'primary' | 'corroborating' | 'contradicting';

export interface ExtractionRecord {
  id: string;
  adapterId: string;
  systemType: SystemType;
  tableName: string;
  recordId: string;
  fieldName: string;
  rawValue: string;
  normalizedValue: string;
  extractionTimestamp: string;
  queryHash: string;
  replayHash: string;
  extractionPathId: string;
  extractionPathVersion: string;
}

export interface FindingEvidence {
  findingId: string;
  extractionId: string;
  role: EvidenceRole;
  addedAt: string;
}

export interface ProvenanceNode {
  type: 'finding' | 'evidence' | 'extraction';
  id: string;
  data: Record<string, unknown>;
  children: ProvenanceNode[];
}

export interface ProvenanceDAG {
  rootFindingId: string;
  nodes: ProvenanceNode[];
  generatedAt: string;
  replayable: boolean;
}

// === extraction-registry/types.ts ===
export type QueryType = 'sql' | 'saved-search' | 'soql' | 'rfc' | 'odata';
export type FieldType = 'string' | 'number' | 'date' | 'amount' | 'boolean';
export type ExtractionDomain = 'o2c' | 'fi-co' | 'p2p' | 'user-audit' | 'pipeline';

export interface ParameterDefinition {
  name: string;
  type: FieldType;
  required: boolean;
  description: string;
  defaultValue?: string;
}

export interface FieldDefinition {
  name: string;
  type: FieldType;
  sapFieldName?: string;
  description: string;
}

export interface ExtractionPath {
  id: string;
  version: string;
  name: string;
  description: string;
  systemType: SystemType;
  domain: ExtractionDomain;
  queryType: QueryType;
  query: string;
  parameters: ParameterDefinition[];
  expectedFields: FieldDefinition[];
  testData?: {
    inputParams: Record<string, string>;
    expectedRowCount?: number;
    expectedHash?: string;
  };
}

export interface ExtractionResult {
  pathId: string;
  pathVersion: string;
  parameters: Record<string, string>;
  rows: Record<string, string>[];
  rowCount: number;
  replayHash: string;
  extractedAt: string;
}
```

---

## Task Summary (16 tasks, Wave 1: 1-12 parallel, Wave 2: 13-16)

| Task | Component | Files Created | Depends On |
|------|-----------|--------------|-----------|
| 1 | Core Types | provenance/types.ts, extraction-registry/types.ts | — |
| 2 | Provenance Schema | provenance/schema.ts + test | — |
| 3 | Replay Hash | provenance/replay.ts + test | — |
| 4 | Provenance Logger | provenance/logger.ts + test | — |
| 5 | Provenance Query + Export | provenance/query.ts, export.ts + test | — |
| 6 | Registry Core | extraction-registry/index.ts, metadata.ts + test | — |
| 7 | SAP O2C Paths | extraction-registry/sap/o2c.ts + test | — |
| 8 | SAP FI/CO Paths | extraction-registry/sap/fi-co.ts + test | — |
| 9 | SAP P2P Paths | extraction-registry/sap/p2p.ts + test | — |
| 10 | SFDC Paths | extraction-registry/sfdc/pipeline.ts + test | — |
| 11 | NetSuite Paths | extraction-registry/netsuite/user-audit.ts + test | — |
| 12 | MCP Tools | tools/ additions + test | — |
| 13 | CSV Adapter Integration | adapters/csv/index.ts mod | 2, 4 |
| 14 | SFDC Adapter Integration | adapters/sfdc/index.ts mod | 2, 4 |
| 15 | Barrel Exports | provenance/index.ts, extraction-registry barrel | 1-12 |
| 16 | Integration Test | full pipeline test | 1-14 |

---

## Execution: Subagent-Driven with 12-agent Wave 1

All Wave 1 tasks create NEW files only — no git conflicts. Wave 2 modifies existing files sequentially.
